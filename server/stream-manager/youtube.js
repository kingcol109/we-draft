// server/stream-manager/youtube.js
//
// Stream Manager's YouTube side (admin → Stream Manager, api/stream-manager.js):
// the OAuth connection to the streaming channel and the few YouTube Data API v3
// live calls it needs. Server-side only — the client secret, refresh token,
// access tokens and stream keys never reach the browser.
//
// OAuth: the We-Draft Google Cloud project's existing OAuth 2.0 web client
// (YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET), authorization-code
// flow with offline access. Google's consent screen asks which channel (the
// Google account itself or one of its Brand Accounts) to authorize — that
// choice is the Stream Manager channel, read back with channels.list mine=true,
// and is independent of any other channel (e.g. the King Cold Sports one).
//
// The refresh token is encrypted (AES-256-GCM, key from
// STREAM_MANAGER_TOKEN_KEY) and kept in streamManagerPrivate/youtubeToken,
// which firestore.rules closes to every client — only the Admin SDK reads it.
//
// Stream keys: liveStreams.insert returns the stream's key in
// cdn.ingestionInfo. sanitizeStream() drops the whole cdn block, and nothing
// else here ever requests the cdn part, so a key is never stored, returned or
// logged. The broadcast worker gets its key from its VM, as before.

const crypto = require("crypto");

const SCOPES = ["https://www.googleapis.com/auth/youtube.force-ssl"];
const API = "https://www.googleapis.com/youtube/v3";
const STATE_TTL_MS = 10 * 60 * 1000;
const WORKER_STREAM_TITLE = "We-Draft Live Worker";

const SETTINGS = ["streamManager", "youtube"];          // admin-readable connection status
const TOKEN = ["streamManagerPrivate", "youtubeToken"];  // closed to clients
const stateDoc = (nonce) => ["streamManagerPrivate", `oauth_${nonce}`];

function clientCreds() {
  const id = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const secret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw httpError(500, "YouTube OAuth isn't configured on the server (YOUTUBE_OAUTH_CLIENT_ID / YOUTUBE_OAUTH_CLIENT_SECRET).");
  return { id, secret };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ── Refresh-token encryption ──
function tokenKey() {
  const raw = process.env.STREAM_MANAGER_TOKEN_KEY || "";
  if (raw.length < 32) throw httpError(500, "STREAM_MANAGER_TOKEN_KEY isn't set (32+ random characters, e.g. `openssl rand -base64 32`).");
  return crypto.createHash("sha256").update(raw).digest();
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", tokenKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ── OAuth ──

// Same origin the admin page is on (Vercel sets x-forwarded-host), unless
// pinned with STREAM_MANAGER_ORIGIN. Must be registered on the OAuth client
// as an authorized redirect URI: <origin>/api/stream-manager
function redirectUri(req) {
  const origin = process.env.STREAM_MANAGER_ORIGIN
    || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  return `${origin.replace(/\/$/, "")}/api/stream-manager`;
}

async function startOAuth(db, req, uid) {
  const { id } = clientCreds();
  tokenKey(); // fail before the round trip, not after
  const nonce = crypto.randomBytes(24).toString("hex");
  const redirect = redirectUri(req);
  await db.doc(stateDoc(nonce).join("/")).set({ uid, redirect, createdAt: Date.now() });
  const p = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    // select_account: Google's channel / Brand Account picker. consent:
    // always issue a refresh token, even on a reconnect.
    prompt: "select_account consent",
    state: nonce,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// The redirect back from Google (a plain browser GET — no Firebase token;
// the single-use state an admin created is what authorizes it).
async function finishOAuth(db, { code, state, error }) {
  if (!/^[a-f0-9]{48}$/.test(String(state || ""))) throw httpError(400, "Bad OAuth state.");
  const ref = db.doc(stateDoc(state).join("/"));
  const st = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) tx.delete(ref);
    return s.exists ? s.data() : null;
  });
  if (!st || Date.now() - st.createdAt > STATE_TTL_MS) throw httpError(400, "This YouTube sign-in link expired — start again from Stream Manager.");
  if (error) throw httpError(400, `Google sign-in was cancelled (${error}).`);
  if (!code) throw httpError(400, "Google didn't return an authorization code.");

  const { id, secret } = clientCreds();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: st.redirect, grant_type: "authorization_code" }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(400, `Google token exchange failed: ${tok.error_description || tok.error || r.status}`);
  const granted = String(tok.scope || "").split(" ");
  if (!SCOPES.every((s) => granted.includes(s))) throw httpError(400, "The YouTube permission wasn't granted — reconnect and allow managing your YouTube account.");
  if (!tok.refresh_token) throw httpError(400, "Google didn't return a refresh token — reconnect from Stream Manager.");

  const channel = await mineChannel(tok.access_token);
  if (!channel) throw httpError(400, "That Google identity has no YouTube channel. Reconnect and pick the We-Draft Live channel.");

  const { FieldValue } = require("firebase-admin/firestore");
  const prev = (await db.doc(SETTINGS.join("/")).get()).data() || {};
  await db.doc(TOKEN.join("/")).set({ refreshToken: encrypt(tok.refresh_token), channelId: channel.id, updatedAt: FieldValue.serverTimestamp() });
  await db.doc(SETTINGS.join("/")).set({
    connected: true,
    needsReconnect: false,
    lastError: null,
    channelId: channel.id,
    channelTitle: channel.title,
    channelCustomUrl: channel.customUrl,
    channelThumb: channel.thumb,
    scopes: granted.filter((s) => s.includes("youtube")),
    connectedBy: st.uid,
    connectedAt: FieldValue.serverTimestamp(),
    // A different channel's streams aren't usable — forget the old choice.
    workerStreamId: prev.channelId === channel.id ? prev.workerStreamId || null : null,
    workerStreamTitle: prev.channelId === channel.id ? prev.workerStreamTitle || null : null,
  }, { merge: true });
  cachedAccess = null;
  return channel;
}

async function disconnect(db) {
  const snap = await db.doc(TOKEN.join("/")).get();
  if (snap.exists) {
    try {
      const token = decrypt(snap.data().refreshToken);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
    } catch { /* revoking is best-effort; the token is deleted either way */ }
  }
  await db.doc(TOKEN.join("/")).delete();
  await db.doc(SETTINGS.join("/")).set({ connected: false, needsReconnect: false, lastError: null }, { merge: true });
  cachedAccess = null;
}

// Access tokens last an hour; one per warm function instance.
let cachedAccess = null;
async function accessToken(db) {
  if (cachedAccess && cachedAccess.exp > Date.now()) return cachedAccess.token;
  const snap = await db.doc(TOKEN.join("/")).get();
  if (!snap.exists) throw httpError(409, "No YouTube channel is connected — connect one in Stream Manager → Channel.");
  const { id, secret } = clientCreds();
  const r = await timedFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: decrypt(snap.data().refreshToken), grant_type: "refresh_token" }),
  }, "Google token refresh");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") {
      await db.doc(SETTINGS.join("/")).set({ needsReconnect: true, lastError: "Google revoked or expired the YouTube authorization — reconnect the channel." }, { merge: true });
      throw httpError(409, "The YouTube authorization expired or was revoked — reconnect the channel in Stream Manager.");
    }
    throw httpError(502, `Google token refresh failed: ${j.error_description || j.error || r.status}`);
  }
  cachedAccess = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000 };
  return cachedAccess.token;
}

// ── YouTube Data API v3 ──

// Every Google call is bounded, so a hung request can't stall an
// orchestrator tick (api/stream-orchestrator.js) past its lease.
const TIMEOUT_MS = 15 * 1000;
async function timedFetch(url, opts, what) {
  try {
    return await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw httpError(504, `${what} didn't respond (${e.name === "TimeoutError" ? "timed out" : "network error"}).`);
  }
}

async function yt(token, method, path, params, body) {
  const r = await timedFetch(`${API}/${path}?${new URLSearchParams(params)}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }, `YouTube ${path}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason;
    throw httpError(r.status >= 500 || r.status === 401 ? 502 : 400,
      `YouTube ${path} failed: ${j.error?.message || r.status}${reason ? ` (${reason})` : ""}`);
  }
  return j;
}

async function mineChannel(token) {
  const j = await yt(token, "GET", "channels", { part: "snippet", mine: "true" });
  const c = j.items?.[0];
  if (!c) return null;
  return {
    id: c.id,
    title: c.snippet?.title || null,
    customUrl: c.snippet?.customUrl || null,
    thumb: c.snippet?.thumbnails?.default?.url || null,
  };
}

// Only the fields Stream Manager shows. Never carries cdn (the stream key).
function sanitizeStream(s) {
  if (!s) return null;
  return {
    id: s.id,
    title: s.snippet?.title || null,
    isReusable: s.contentDetails?.isReusable ?? null,
    streamStatus: s.status?.streamStatus || null,          // active | created | error | inactive | ready
    healthStatus: s.status?.healthStatus?.status || null,  // good | ok | bad | noData
  };
}

function sanitizeBroadcast(b) {
  if (!b) return null;
  return {
    id: b.id,
    title: b.snippet?.title || null,
    scheduledStartTime: b.snippet?.scheduledStartTime || null,
    actualStartTime: b.snippet?.actualStartTime || null,
    actualEndTime: b.snippet?.actualEndTime || null,
    privacyStatus: b.status?.privacyStatus || null,
    lifeCycleStatus: b.status?.lifeCycleStatus || null,
    boundStreamId: b.contentDetails?.boundStreamId || null,
  };
}

async function listStreams(token) {
  const j = await yt(token, "GET", "liveStreams", { part: "id,snippet,status,contentDetails", mine: "true", maxResults: "50" });
  return (j.items || []).map(sanitizeStream);
}

async function getStream(token, id) {
  const j = await yt(token, "GET", "liveStreams", { part: "id,snippet,status,contentDetails", id });
  return sanitizeStream(j.items?.[0]);
}

// A reusable 1080p30 RTMP stream — what the broadcast worker sends.
async function insertWorkerStream(token) {
  const j = await yt(token, "POST", "liveStreams", { part: "snippet,cdn,contentDetails,status" }, {
    snippet: { title: WORKER_STREAM_TITLE, description: "We-Draft broadcast worker (Chromium → FFmpeg, H.264 1080p30). Created by Stream Manager." },
    cdn: { ingestionType: "rtmp", resolution: "1080p", frameRate: "30fps" },
    contentDetails: { isReusable: true },
  });
  return sanitizeStream(j); // drops cdn.ingestionInfo (the key) right here
}

async function insertBroadcast(token, { title, description, scheduledStart, privacyStatus }) {
  const j = await yt(token, "POST", "liveBroadcasts", { part: "snippet,status,contentDetails" }, {
    snippet: { title, description, scheduledStartTime: scheduledStart },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
    // No automatic transitions this phase: going live / ending stay manual.
    contentDetails: { enableAutoStart: false, enableAutoStop: false, enableDvr: true, latencyPreference: "normal" },
  });
  return sanitizeBroadcast(j);
}

async function bindBroadcast(token, broadcastId, streamId) {
  const j = await yt(token, "POST", "liveBroadcasts/bind", { part: "id,snippet,status,contentDetails", id: broadcastId, streamId });
  return sanitizeBroadcast(j);
}

async function getBroadcast(token, id) {
  const j = await yt(token, "GET", "liveBroadcasts", { part: "id,snippet,status,contentDetails", id });
  return sanitizeBroadcast(j.items?.[0]);
}

// testing | live | complete — the orchestrator's lifecycle steps
// (server/stream-manager/orchestrator.js). YouTube only allows live/testing
// once the bound stream is receiving data.
async function transitionBroadcast(token, id, broadcastStatus) {
  if (!["testing", "live", "complete"].includes(broadcastStatus)) throw httpError(400, "Bad broadcast transition.");
  const j = await yt(token, "POST", "liveBroadcasts/transition", { part: "id,snippet,status,contentDetails", id, broadcastStatus });
  return sanitizeBroadcast(j);
}

// Sets a video's (a live broadcast's) custom thumbnail from a PNG. Only
// ever called by an admin's explicit "Upload Thumbnail" on a created
// broadcast (broadcasts.js youtubeThumbnail) — never by generating or saving
// one. YouTube needs the channel to be allowed custom thumbnails.
async function setThumbnail(token, videoId, png) {
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(String(videoId || ""))) throw httpError(400, "Bad YouTube video id.");
  const r = await timedFetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?${new URLSearchParams({ videoId, uploadType: "media" })}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png", "Content-Length": String(png.length) },
    body: png,
  }, "YouTube thumbnails/set");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason;
    throw httpError(r.status >= 500 || r.status === 401 ? 502 : 400, `YouTube thumbnails/set failed: ${j.error?.message || r.status}${reason ? ` (${reason})` : ""}`);
  }
  return { url: j.items?.[0]?.maxres?.url || j.items?.[0]?.high?.url || j.items?.[0]?.default?.url || null };
}

module.exports = {
  SETTINGS, WORKER_STREAM_TITLE, SCOPES, httpError,
  startOAuth, finishOAuth, disconnect, accessToken,
  mineChannel, listStreams, getStream, insertWorkerStream, insertBroadcast, bindBroadcast, getBroadcast, transitionBroadcast, setThumbnail,
  sanitizeStream, sanitizeBroadcast, encrypt, decrypt,
};
