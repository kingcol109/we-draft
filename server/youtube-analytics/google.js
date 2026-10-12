// server/youtube-analytics/google.js
//
// YouTube Analytics' connection to Google (admin → YouTube Analytics,
// api/youtube-analytics.js). Server-side only: the client secret, refresh
// token and access tokens never reach the browser, a Firestore document a
// client can read, an API response or a log line.
//
// This is a separate connection from Stream Manager's
// (server/stream-manager/youtube.js): a different channel, its own stored
// token, and a narrower scope.
//
// Scope: https://www.googleapis.com/auth/yt-analytics.readonly — read-only
// YouTube Analytics and Reporting API data, nothing else. It can't list a
// channel's uploads or read private videos; uploads come from the public
// Data API with YOUTUBE_API_KEY (public and unlisted-by-ID videos only).
// Requesting youtube.readonly as well would let us find private/unlisted
// uploads and identify the channel automatically — not requested, because
// nothing here needs it yet.
//
// Credentials (env, server only — never REACT_APP_ / NEXT_PUBLIC_):
//   YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET   the OAuth web client
//     (falls back to YOUTUBE_OAUTH_CLIENT_ID / _SECRET, the client Stream
//     Manager already uses — the same Google Cloud project's web client)
//   YOUTUBE_API_KEY          Data API v3 key for public metadata/stats
//   YOUTUBE_REFRESH_TOKEN    optional: a refresh token minted elsewhere for
//     this client + scope; used only when no token has been stored through
//     the Connect button
//   STREAM_MANAGER_TOKEN_KEY encrypts the stored refresh token (AES-256-GCM,
//     shared with Stream Manager — same helper)
//   YOUTUBE_ANALYTICS_ORIGIN optional: pins the OAuth redirect origin
//
// Stored: ytAnalyticsPrivate/token (encrypted refresh token) and
// ytAnalyticsPrivate/oauth_<nonce> (single-use sign-in state) — both closed
// to every client in firestore.rules. ytAnalytics/status holds only the
// non-secret connection state the admin page shows.

const crypto = require("crypto");
const { encrypt, decrypt } = require("../stream-manager/youtube");

const SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
const STATUS = "ytAnalytics/status";
const TOKEN = "ytAnalyticsPrivate/token";
const stateDoc = (nonce) => `ytAnalyticsPrivate/oauth_${nonce}`;
const STATE_TTL_MS = 10 * 60 * 1000;

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const REPORTING_API = "https://youtubereporting.googleapis.com/v1";

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra || {});
}

function clientCreds() {
  const id = process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const secret = process.env.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw httpError(500, "YouTube OAuth isn't configured on the server (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET).");
  return { id, secret };
}
function apiKey() {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw httpError(500, "YOUTUBE_API_KEY isn't set on the server.");
  return k;
}

// Which settings exist — names and booleans only, never values.
function configCheck(req) {
  return {
    clientId: !!(process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_OAUTH_CLIENT_ID),
    clientSecret: !!(process.env.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_OAUTH_CLIENT_SECRET),
    apiKey: !!process.env.YOUTUBE_API_KEY,
    tokenKey: (process.env.STREAM_MANAGER_TOKEN_KEY || "").length >= 32,
    envRefreshToken: !!process.env.YOUTUBE_REFRESH_TOKEN,
    envChannelId: process.env.YOUTUBE_CHANNEL_ID || null, // a channel ID is public
    cronSecret: !!process.env.CRON_SECRET,
    redirectUri: req ? redirectUri(req) : null,
    scope: SCOPE,
  };
}

// ── OAuth ──

// <origin>/api/youtube-analytics — must be registered on the OAuth client
// as an authorized redirect URI (production: https://we-draft.com/api/youtube-analytics).
function redirectUri(req) {
  const origin = process.env.YOUTUBE_ANALYTICS_ORIGIN
    || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  return `${origin.replace(/\/$/, "")}/api/youtube-analytics`;
}

async function startOAuth(db, req, uid) {
  const { id } = clientCreds();
  encrypt("probe"); // fail on a missing STREAM_MANAGER_TOKEN_KEY before the round trip
  const nonce = crypto.randomBytes(24).toString("hex");
  const redirect = redirectUri(req);
  await db.doc(stateDoc(nonce)).set({ uid, redirect, createdAt: Date.now() });
  const p = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    // select_account: Google's channel / Brand Account picker; consent:
    // always issue a refresh token, even on a reconnect.
    prompt: "select_account consent",
    state: nonce,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// Google's redirect back (a plain browser GET: the single-use state an
// admin created is what authorizes it).
async function finishOAuth(db, { code, state, error }) {
  if (!/^[a-f0-9]{48}$/.test(String(state || ""))) throw httpError(400, "Bad OAuth state.");
  const ref = db.doc(stateDoc(state));
  const st = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) tx.delete(ref);
    return s.exists ? s.data() : null;
  });
  if (!st || Date.now() - st.createdAt > STATE_TTL_MS) throw httpError(400, "This YouTube sign-in link expired — start again from YouTube Analytics.");
  if (error) throw httpError(400, `Google sign-in was cancelled (${String(error).slice(0, 60)}).`);
  if (!code) throw httpError(400, "Google didn't return an authorization code.");

  const { id, secret } = clientCreds();
  const r = await timedFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: st.redirect, grant_type: "authorization_code" }),
  }, "Google token exchange");
  const tok = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(400, `Google token exchange failed: ${tok.error_description || tok.error || r.status}`);
  if (!String(tok.scope || "").split(" ").includes(SCOPE)) throw httpError(400, "The YouTube Analytics permission wasn't granted — reconnect and allow it.");
  if (!tok.refresh_token) throw httpError(400, "Google didn't return a refresh token — reconnect from YouTube Analytics.");

  const { FieldValue } = require("firebase-admin/firestore");
  await db.doc(TOKEN).set({ refreshToken: encrypt(tok.refresh_token), updatedAt: FieldValue.serverTimestamp() });
  cachedAccess = { token: tok.access_token, exp: Date.now() + ((tok.expires_in || 3600) - 120) * 1000 };
  const conn = { connected: true, needsReconnect: false, lastError: null, connectedBy: st.uid, connectedAt: Date.now(), tokenSource: "stored" };

  // The analytics scope can't tell us which channel was picked; if one is
  // already configured, check this authorization can read it.
  const status = (await db.doc(STATUS).get()).data() || {};
  const channelId = status.channelId || process.env.YOUTUBE_CHANNEL_ID || null;
  if (channelId) {
    const ok = await canReadChannel(db, channelId).catch(() => false);
    conn.channelVerified = ok;
    conn.lastError = ok ? null : `This Google sign-in can't read analytics for channel ${channelId}. Reconnect and pick that channel (or its Brand Account).`;
  }
  await db.doc(STATUS).set({ connection: conn }, { merge: true });
  return conn;
}

async function disconnect(db) {
  const snap = await db.doc(TOKEN).get();
  if (snap.exists) {
    try {
      const token = decrypt(snap.data().refreshToken);
      await timedFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }, "Google revoke");
    } catch { /* revoking is best-effort; the token is deleted either way */ }
  }
  await db.doc(TOKEN).delete();
  await db.doc(STATUS).set({ connection: { connected: !!process.env.YOUTUBE_REFRESH_TOKEN, tokenSource: process.env.YOUTUBE_REFRESH_TOKEN ? "env" : null, needsReconnect: false, lastError: null, channelVerified: null } }, { merge: true });
  cachedAccess = null;
}

async function refreshTokenSource(db) {
  const snap = await db.doc(TOKEN).get();
  if (snap.exists) return { source: "stored", token: decrypt(snap.data().refreshToken) };
  if (process.env.YOUTUBE_REFRESH_TOKEN) return { source: "env", token: process.env.YOUTUBE_REFRESH_TOKEN };
  return null;
}

// Access tokens last an hour; one per warm function instance.
let cachedAccess = null;
async function accessToken(db, { force = false } = {}) {
  if (!force && cachedAccess && cachedAccess.exp > Date.now()) return cachedAccess.token;
  const rt = await refreshTokenSource(db);
  if (!rt) throw httpError(409, "YouTube isn't connected — click Connect YouTube in Admin → YouTube Analytics.", { code: "not_connected" });
  const { id, secret } = clientCreds();
  const r = await timedFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: rt.token, grant_type: "refresh_token" }),
  }, "Google token refresh");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") {
      await db.doc(STATUS).set({ connection: { needsReconnect: true, lastError: "Google revoked or expired the YouTube Analytics authorization — reconnect." } }, { merge: true });
      throw httpError(409, "The YouTube Analytics authorization expired or was revoked — reconnect in Admin → YouTube Analytics.", { code: "needs_reconnect" });
    }
    throw httpError(502, `Google token refresh failed: ${j.error_description || j.error || r.status}`);
  }
  cachedAccess = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000 };
  return cachedAccess.token;
}
function resetAccessCache() { cachedAccess = null; }

// ── HTTP with timeouts, retries and credential-free errors ──

const TIMEOUT_MS = 20 * 1000;
async function timedFetch(url, opts, what) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw httpError(504, `${what} didn't respond (${e.name === "TimeoutError" ? "timed out" : "network error"}).`, { transient: true });
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET JSON with up to 3 retries on 429 / 5xx / network errors (1s, 2s, 4s).
// Quota exhaustion is never retried — it won't clear for hours. `what` is a
// short label used in errors (never the URL: it can carry the API key).
async function getJson(url, headers, what, { retries = 3, retryDelayMs = 1000 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let r;
    try {
      r = await timedFetch(url, { headers }, what);
    } catch (e) {
      last = e;
      if (attempt < retries) { await sleep(retryDelayMs * 2 ** attempt); continue; }
      throw e;
    }
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    const reason = j.error?.errors?.[0]?.reason || j.error?.status || "";
    const msg = `${what} failed: ${j.error?.message || r.status}${reason ? ` (${reason})` : ""}`;
    if (/quota|dailyLimitExceeded|rateLimitExceeded/i.test(reason) && r.status === 403) {
      throw httpError(429, `${msg} — YouTube API quota exhausted; try again after the daily reset (midnight Pacific).`, { code: "quota" });
    }
    if (r.status === 429 || r.status >= 500) {
      last = httpError(502, msg, { transient: true });
      if (attempt < retries) { await sleep(retryDelayMs * 2 ** attempt); continue; }
      throw last;
    }
    throw httpError(r.status === 401 ? 401 : r.status === 403 ? 403 : 400, msg, { code: r.status === 401 ? "unauthorized" : reason || undefined });
  }
  throw last;
}

// Authorized GET: on a 401 refreshes the access token once and retries.
async function authedGet(db, url, what, opts) {
  try {
    return await getJson(url, { Authorization: `Bearer ${await accessToken(db)}` }, what, opts);
  } catch (e) {
    if (e.status !== 401) throw e;
    return getJson(url, { Authorization: `Bearer ${await accessToken(db, { force: true })}` }, what, opts);
  }
}

// ── Data API v3 (API key; public data) ──
function dataApi(path, params, opts) {
  return getJson(`${DATA_API}/${path}?${new URLSearchParams({ ...params, key: apiKey() })}`, {}, `YouTube Data API ${path}`, opts);
}

// ── Analytics API ──
function analyticsQuery(db, channelId, params, opts) {
  return authedGet(db, `${ANALYTICS_API}?${new URLSearchParams({ ids: `channel==${channelId}`, ...params })}`, "YouTube Analytics query", opts);
}

// true when this authorization can read the channel's analytics.
async function canReadChannel(db, channelId) {
  const { pacificDay, addDays } = require("./metrics");
  const end = pacificDay();
  try {
    await analyticsQuery(db, channelId, { startDate: addDays(end, -7), endDate: end, metrics: "views" }, { retries: 1 });
    return true;
  } catch (e) {
    if (e.status === 403 || e.status === 400) return false;
    throw e;
  }
}

// ── Reporting API ──
function reportingGet(db, path, params = {}, what = "YouTube Reporting API") {
  const q = new URLSearchParams(params).toString();
  return authedGet(db, `${REPORTING_API}/${path}${q ? `?${q}` : ""}`, what);
}
async function reportingPost(db, path, body) {
  const r = await timedFetch(`${REPORTING_API}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(db)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "YouTube Reporting API");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status >= 500 ? 502 : 400, `YouTube Reporting API ${path} failed: ${j.error?.message || r.status}`);
  return j;
}
// Report files are downloaded with the same bearer token. Only Google's
// own download host is ever fetched.
async function reportingDownload(db, downloadUrl) {
  const u = new URL(downloadUrl);
  if (u.protocol !== "https:" || !/(^|\.)googleapis\.com$/.test(u.hostname)) throw httpError(502, "Unexpected report download host.");
  const r = await timedFetch(downloadUrl, { headers: { Authorization: `Bearer ${await accessToken(db)}` } }, "YouTube report download");
  if (!r.ok) throw httpError(502, `YouTube report download failed (${r.status}).`, { transient: r.status >= 500 });
  return r.text();
}

module.exports = {
  SCOPE, STATUS, TOKEN, httpError, configCheck, redirectUri,
  startOAuth, finishOAuth, disconnect, accessToken, resetAccessCache, refreshTokenSource,
  getJson, dataApi, analyticsQuery, canReadChannel, reportingGet, reportingPost, reportingDownload,
};
