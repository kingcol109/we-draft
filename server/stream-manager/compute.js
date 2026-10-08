// server/stream-manager/compute.js
//
// Stream Manager's Compute Engine side (admin → Stream Manager,
// api/stream-manager.js): start, stop and read the status of the one
// broadcast worker VM (we-draft-broadcast-01). Server-side only.
//
// Credentials: a dedicated service account (not the Firestore one in
// GOOGLE_SERVICE_ACCOUNT_KEY) whose key is in GCE_SERVICE_ACCOUNT_KEY. It
// holds a custom role with compute.instances.get / start / stop, granted on
// this VM only (see server/stream-manager/README.md), so even a leaked key
// can't touch anything else in the project.
//
// The target VM comes from env only (GCE_PROJECT_ID, GCE_ZONE,
// GCE_INSTANCE_NAME) — nothing in a request can point these calls at a
// different instance.
//
// Calls return as soon as Compute Engine accepts them; a start or stop
// takes 10–60s to finish, so callers poll vm-status. Only a few fields of
// the instance come back (sanitizeInstance) — never metadata, which can
// hold startup scripts and secrets. Logs carry the action, the admin's uid
// and VM states — never the key or an access token.

const { loadServiceAccount } = require("../../scripts/googleAuth");
const { httpError } = require("./youtube");

const KEY_ENV = "GCE_SERVICE_ACCOUNT_KEY";
const DEFAULT_INSTANCE = "we-draft-broadcast-01";
const SCOPES = ["https://www.googleapis.com/auth/compute"];
const API = "https://compute.googleapis.com/compute/v1";
const TIMEOUT_MS = 10 * 1000;

// Compute Engine's instance status → what Stream Manager shows.
const STATES = {
  PROVISIONING: "starting",
  STAGING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  SUSPENDING: "stopping",
  SUSPENDED: "suspended",
  TERMINATED: "stopped", // a stopped VM's status is TERMINATED
  STOPPED: "stopped",
  REPAIRING: "repairing",
};
const STARTABLE = ["TERMINATED", "STOPPED"];
const STOPPABLE = ["PROVISIONING", "STAGING", "RUNNING", "REPAIRING"];

// GCE naming rules.
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const ZONE_RE = /^[a-z]+-[a-z]+[0-9]+-[a-z]$/;
const INSTANCE_RE = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

// Which settings are missing or malformed — names only, never values.
function configProblems(env = process.env) {
  const out = [];
  if (!env[KEY_ENV]) out.push(`${KEY_ENV} is not set`);
  if (!PROJECT_RE.test(env.GCE_PROJECT_ID || "")) out.push("GCE_PROJECT_ID is missing or not a valid project id");
  if (!ZONE_RE.test(env.GCE_ZONE || "")) out.push("GCE_ZONE is missing or not a valid zone (e.g. us-east1-b)");
  if (env.GCE_INSTANCE_NAME && !INSTANCE_RE.test(env.GCE_INSTANCE_NAME)) out.push("GCE_INSTANCE_NAME is not a valid instance name");
  return out;
}

function target(env = process.env) {
  const problems = configProblems(env);
  if (problems.length) throw httpError(500, `Worker VM control isn't configured on the server: ${problems.join("; ")}.`);
  return { project: env.GCE_PROJECT_ID, zone: env.GCE_ZONE, instance: env.GCE_INSTANCE_NAME || DEFAULT_INSTANCE };
}

function credentials() {
  let sa;
  try {
    sa = loadServiceAccount(KEY_ENV);
  } catch (e) {
    throw httpError(500, e.message); // the loader's messages name the variable, never its contents
  }
  // The point of a dedicated account: VM control can't use the broad
  // Firestore key, and the Firestore key can't control the VM.
  const fs = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (fs) {
    let fsEmail = null;
    try { fsEmail = JSON.parse(fs).client_email; } catch { /* the Firestore loader reports that */ }
    if (fsEmail && fsEmail === sa.client_email) {
      throw httpError(500, `${KEY_ENV} must be a dedicated service account, not the one in GOOGLE_SERVICE_ACCOUNT_KEY.`);
    }
  }
  return sa;
}

// Access tokens (~1h) are cached by the JWT client, one per warm instance.
let jwt = null;
async function defaultToken() {
  const sa = credentials();
  if (!jwt || jwt.email !== sa.client_email) {
    const { JWT } = require("google-auth-library");
    jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: SCOPES });
  }
  try {
    const { token } = await jwt.getAccessToken();
    if (!token) throw new Error("no access token returned");
    return token;
  } catch (e) {
    jwt = null;
    // google-auth-library errors don't include the key; keep it short anyway.
    throw httpError(502, `Couldn't authenticate the worker VM service account: ${String(e.message || e).slice(0, 200)}`);
  }
}
let getToken = defaultToken;

async function gce(method, t, suffix = "") {
  const token = await getToken();
  const url = `${API}/projects/${t.project}/zones/${t.zone}/instances/${t.instance}${suffix}`;
  let r;
  try {
    r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw httpError(504, `Compute Engine didn't respond (${e.name === "TimeoutError" ? "timed out" : "network error"}).`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(j.error?.message || r.status).slice(0, 300);
    if (r.status === 404) throw httpError(502, `Compute Engine can't find VM ${t.instance} in ${t.project}/${t.zone} — check GCE_PROJECT_ID / GCE_ZONE / GCE_INSTANCE_NAME. (${msg})`);
    if (r.status === 401 || r.status === 403) throw httpError(502, `Compute Engine refused the worker VM service account — check its role on ${t.instance}. (${msg})`);
    throw httpError(502, `Compute Engine ${method} failed: ${msg}`);
  }
  return j;
}

// Only what Stream Manager shows. Never metadata, disks, service accounts
// or network interfaces.
function sanitizeInstance(i, t) {
  return {
    name: i.name || t.instance,
    zone: t.zone,
    status: i.status || null,
    state: STATES[i.status] || "unknown",
    machineType: i.machineType ? String(i.machineType).split("/").pop() : null,
    lastStartTimestamp: i.lastStartTimestamp || null,
    lastStopTimestamp: i.lastStopTimestamp || null,
  };
}

const sanitizeOp = (op) => (op ? { id: op.name || op.id || null, status: op.status || null } : null);

async function getInstance(t) {
  return sanitizeInstance(await gce("GET", t), t);
}

function log(action, uid, detail) {
  console.log(`stream-manager ${action} uid=${uid} ${Object.entries(detail).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

async function status() {
  const t = target();
  return { instance: await getInstance(t) };
}

async function start(uid) {
  const t = target();
  const before = await getInstance(t);
  if (!STARTABLE.includes(before.status)) {
    if (["starting", "running"].includes(before.state)) {
      log("vm-start", uid, { instance: t.instance, from: before.status, result: "noop" });
      return { ok: true, result: "already-running", instance: before };
    }
    throw httpError(409, `The worker VM is ${before.state} (${before.status}) — it can only be started once it's stopped.`);
  }
  const op = await gce("POST", t, "/start");
  log("vm-start", uid, { instance: t.instance, from: before.status, op: op.name || "-" });
  return { ok: true, result: "starting", operation: sanitizeOp(op), instance: await getInstance(t) };
}

// db: refuses while a broadcast is live unless confirmLive === true —
// stopping the VM ends the stream.
async function stop(db, uid, body = {}) {
  const t = target();
  const before = await getInstance(t);
  if (!STOPPABLE.includes(before.status)) {
    if (before.state === "stopped" || before.state === "stopping") {
      log("vm-stop", uid, { instance: t.instance, from: before.status, result: "noop" });
      return { ok: true, result: "already-stopped", instance: before };
    }
    throw httpError(409, `The worker VM is ${before.state} (${before.status}) and can't be stopped from here.`);
  }
  const live = await db.collection("broadcasts").where("status", "==", "live").limit(1).get();
  if (!live.empty && body.confirmLive !== true) {
    throw httpError(409, "A broadcast is live — stopping the worker VM will end the stream. Send confirmLive: true to stop anyway.");
  }
  const op = await gce("POST", t, "/stop");
  log("vm-stop", uid, { instance: t.instance, from: before.status, op: op.name || "-", liveOverride: !live.empty });
  return { ok: true, result: "stopping", operation: sanitizeOp(op), instance: await getInstance(t) };
}

// Tests only: swap the token source so no real credentials are needed.
function _setTokenProvider(fn) {
  getToken = fn || defaultToken;
  jwt = null;
}

module.exports = {
  KEY_ENV, DEFAULT_INSTANCE, SCOPES, STATES,
  configProblems, target, credentials, sanitizeInstance,
  status, start, stop, _setTokenProvider,
};
