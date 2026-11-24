// server/shop/lulu.js
//
// Lulu Print API (print-on-demand for the printed products). Two
// environments, each with its own OAuth client:
//   live     LULU_CLIENT_KEY / LULU_CLIENT_SECRET                 api.lulu.com
//   sandbox  LULU_SANDBOX_CLIENT_KEY / LULU_SANDBOX_CLIENT_SECRET api.sandbox.lulu.com
// Auth is OAuth2 client credentials; tokens are cached per warm function
// until shortly before they expire.
const { env } = require("./config");

const HOSTS = { live: "https://api.lulu.com", sandbox: "https://api.sandbox.lulu.com" };
const CREDS = {
  live: ["LULU_CLIENT_KEY", "LULU_CLIENT_SECRET"],
  sandbox: ["LULU_SANDBOX_CLIENT_KEY", "LULU_SANDBOX_CLIENT_SECRET"],
};
const tokens = {}; // mode -> { token, exp }

function credentials(mode) {
  const [k, s] = CREDS[mode] || [];
  const key = k && env(k);
  const secret = s && env(s);
  return key && secret ? { key, secret } : null;
}

function luluError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  return e;
}

async function getToken(mode = "live") {
  const hit = tokens[mode];
  if (hit && hit.exp > Date.now() + 30_000) return hit.token;
  const c = credentials(mode);
  if (!c) throw luluError(500, `Lulu ${mode} keys are not set.`);
  const r = await fetch(`${HOSTS[mode]}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString("base64")}`,
    },
    body: "grant_type=client_credentials",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw luluError(r.status === 401 || r.status === 400 ? 401 : 502,
      `Lulu ${mode} sign-in failed (${r.status}${j.error_description ? `: ${j.error_description}` : j.error ? `: ${j.error}` : ""}).`);
  }
  tokens[mode] = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 };
  return j.access_token;
}

async function request(mode, path, { method = "GET", body } = {}) {
  const token = await getToken(mode);
  const r = await fetch(`${HOSTS[mode]}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw luluError(r.status, `Lulu ${mode} ${method} ${path} failed (${r.status}).`);
  return data;
}

// Admin connection check: for each environment, are the keys set, does the
// sign-in work, and does an authenticated read (the print-job list) work.
async function checkConnection() {
  const out = {};
  for (const mode of ["sandbox", "live"]) {
    const res = { mode, keysSet: !!credentials(mode), auth: false, api: false, printJobs: null, error: null };
    if (res.keysSet) {
      try {
        await getToken(mode);
        res.auth = true;
        const jobs = await request(mode, "/print-jobs/?page_size=1");
        res.api = true;
        res.printJobs = Number.isFinite(jobs?.count) ? jobs.count : null;
      } catch (e) {
        res.error = e.publicMessage || e.message;
      }
    }
    out[mode] = res;
  }
  return out;
}

module.exports = { getToken, request, checkConnection, HOSTS };
