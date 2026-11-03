// server/instagram/graph.js
//
// We-Draft's connection to Instagram (@wedraftsite). The Meta app (We-Draft
// Social) is set up with the Instagram API with Unified Login: calls go to
// graph.facebook.com with a System-user access token (SUAT) that belongs to
// the business portfolio — /me is the system user, not the Instagram
// account; the account is one of /me/assigned_instagram_accounts.
// Permissions are the instagram_* family: instagram_basic (account, media),
// instagram_content_publish, instagram_manage_insights. Standard Access
// covers an account the app's own business manages — no App Review.
// (A token from the older Business Login for Instagram setup — IG… prefix —
// goes to graph.instagram.com instead, with instagram_business_* scopes.)
//
// Server-side only: the token never reaches the browser, a Firestore
// document a client can read, an API response or a log line (redact()
// scrubs it out of anything Meta echoes back).
//
// Credentials (env, server only — never REACT_APP_):
//   INSTAGRAM_ACCESS_TOKEN   the SUAT (its expiry is the login
//                            configuration's — "never" by default)
//   INSTAGRAM_USER_ID        @wedraftsite's Instagram professional account ID
// Vercel Production has both. Locally, put them in .env (gitignored, read by
// scripts/instagramCheck.mjs) — never commit them.

const API_VERSION = "v26.0";
const FB_HOST = "https://graph.facebook.com";
const IG_HOST = "https://graph.instagram.com";

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra || {});
}

function credentials() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN || "";
  const userId = process.env.INSTAGRAM_USER_ID || "";
  if (!token || !userId) throw httpError(500, "Instagram isn't configured on the server (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID).");
  return { token, userId };
}

// Which setup a token is from, by its prefix — never the token itself:
// IG… is Business Login for Instagram's; anything else (Unified Login's
// SUAT, Facebook Login's tokens) is a Facebook token.
function tokenKind(token) {
  if (/^IG/.test(token)) return "instagram-login";
  if (/^EAA/.test(token)) return "facebook";
  return "unknown";
}
const hostFor = (token) => (tokenKind(token) === "instagram-login" ? IG_HOST : FB_HOST);

// Any copy of the token taken out of a string (Meta's errors can echo URLs).
function redact(s, token) {
  let out = String(s ?? "");
  if (token) out = out.split(token).join("[token]");
  return out.replace(/access_token=[^&\s"]+/g, "access_token=[token]");
}

// One Graph call. path: "/me" or "/{id}/media"; params go in the query (GET)
// or the form body (POST). The token rides in the Authorization header only.
// Meta's error comes back as an Error with status, code, subcode, type and
// fbtraceId, its message as Meta wrote it (redacted).
async function graph(path, { method = "GET", params = {}, token, retries = 2 } = {}) {
  const tk = token || credentials().token;
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
  const url = `${hostFor(tk)}/${API_VERSION}${path}${method === "GET" && [...qs].length ? `?${qs}` : ""}`;
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${tk}`, ...(method === "GET" ? {} : { "Content-Type": "application/x-www-form-urlencoded" }) },
        body: method === "GET" ? undefined : qs.toString(),
      });
    } catch (e) {
      if (attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
      throw httpError(502, `Couldn't reach Instagram: ${redact(e.message, tk)}`);
    }
    noteUsage(r.headers);
    const text = await r.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
    if (r.ok && !body.error) return body;
    const e = body.error || {};
    // Meta's transient errors (code 1, 2, or is_transient) and 5xx: once more, after a beat.
    if (attempt < retries && (r.status >= 500 || e.is_transient || e.code === 1 || e.code === 2)) { await sleep(800 * (attempt + 1)); continue; }
    throw httpError(r.status >= 400 && r.status < 500 ? r.status : 502, redact(e.error_user_msg || e.message || body.raw || `HTTP ${r.status}`, tk), {
      code: RATE_CODES.has(e.code) ? "rate_limited" : e.code, metaCode: e.code, subcode: e.error_subcode, type: e.type, fbtraceId: e.fbtrace_id, meta: true,
    });
  }
}

// ── Rate limits ──
// Meta reports how much of the rolling hourly allowance is used on every
// response (X-App-Usage, X-Business-Use-Case-Usage: percentages). usage()
// is the highest seen in this process lately; the syncs stop starting new
// calls past USAGE_STOP. Meta's throttling error codes become
// code "rate_limited".
const RATE_CODES = new Set([4, 17, 32, 613, 80002]);
const USAGE_STOP = 80;
let lastUsage = { pct: 0, at: 0 };
function noteUsage(headers) {
  let pct = 0;
  for (const h of ["x-app-usage", "x-business-use-case-usage", "x-ad-account-usage"]) {
    const raw = headers?.get?.(h);
    if (!raw) continue;
    try {
      JSON.stringify(JSON.parse(raw), (k, v) => {
        if (["call_count", "total_time", "total_cputime"].includes(k) && typeof v === "number") pct = Math.max(pct, v);
        return v;
      });
    } catch { /* not JSON */ }
  }
  lastUsage = { pct, at: Date.now() };
}
// Readings older than an hour don't count (Meta's window is an hour).
const usage = () => (Date.now() - lastUsage.at < 3600e3 ? lastUsage.pct : 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { API_VERSION, graph, credentials, tokenKind, hostFor, redact, httpError, sleep, usage, USAGE_STOP };
