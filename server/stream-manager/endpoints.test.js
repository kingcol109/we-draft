// server/stream-manager/endpoints.test.js — auth on the cron and agent
// endpoints, and the admin auto-* actions through api/stream-manager.js,
// with Firebase faked.

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { fakeFirestore } = require("./__fakes__/firestore");

let db;
require.cache[path.resolve(__dirname, "../../scripts/firebaseAdmin.js")] = {
  id: "firebaseAdmin", loaded: true, exports: { getFirestore: () => db },
};
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).includes("identitytoolkit")) {
    const t = JSON.parse(opts.body).idToken;
    const uid = { "tok-admin": "admin1", "tok-user": "user1" }[t];
    return { ok: !!uid, status: uid ? 200 : 400, json: async () => ({ users: uid ? [{ localId: uid }] : [] }) };
  }
  throw new Error(`unexpected fetch ${url}`);
};
const logs = [];
const realLog = console.log, realErr = console.error;
console.log = (...a) => logs.push(a.join(" "));
console.error = (...a) => logs.push(a.join(" "));

const AGENT_TOKEN = "agent-token-0123456789-0123456789-abcdef";
const CRON = "cron-secret-xyz";
process.env.STREAM_AGENT_TOKEN = AGENT_TOKEN;
process.env.CRON_SECRET = CRON;

const agentApi = require("../../api/broadcast-agent");
const cronApi = require("../../api/stream-orchestrator");
const smApi = require("../../api/stream-manager");

async function call(handler, { method = "POST", auth, body } = {}) {
  const res = {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await handler({ method, query: {}, headers: auth ? { authorization: auth } : {}, body }, res);
  return res;
}

beforeEach(() => {
  db = fakeFirestore({
    "users/admin1": { role: "admin" },
    "users/user1": { role: "user" },
    "schedule26/s1": { Home: "LSU", Away: "Clemson", KickoffAt: { toMillis: () => Date.now() + 86400e3 }, CFBDGameId: 401001, Slug: "clemson-vs-lsu" },
  });
});
after(() => { global.fetch = realFetch; console.log = realLog; console.error = realErr; });

test("agent endpoint: wrong or missing token → 401, nothing written", async () => {
  for (const auth of [undefined, "Bearer nope", `Bearer ${AGENT_TOKEN}x`, AGENT_TOKEN]) {
    assert.equal((await call(agentApi, { auth, body: { containers: [] } })).statusCode, 401, String(auth));
  }
  assert.equal(db.data("streamManager/agent"), undefined);
  assert.equal((await call(agentApi, { method: "GET", auth: `Bearer ${AGENT_TOKEN}` })).statusCode, 405);
});

test("agent endpoint: a short configured token is refused outright", async () => {
  process.env.STREAM_AGENT_TOKEN = "short";
  assert.equal((await call(agentApi, { auth: "Bearer short", body: {} })).statusCode, 401);
  process.env.STREAM_AGENT_TOKEN = AGENT_TOKEN;
});

test("agent endpoint: a valid report is stored and answered with desired workers", async () => {
  const r = await call(agentApi, { auth: `Bearer ${AGENT_TOKEN}`, body: { containers: [], host: { version: "1.0.0", load1: 0.2 } } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, { desired: [], pollSec: 10 });
  assert.ok(db.data("streamManager/agent").lastSeenAt > 0);
  const bad = await call(agentApi, { auth: `Bearer ${AGENT_TOKEN}`, body: { containers: [{ id: "x; rm" }] } });
  assert.equal(bad.statusCode, 400);
});

test("agent endpoint: stores the agent's DRY_RUN flag (only an exact true counts)", async () => {
  await call(agentApi, { auth: `Bearer ${AGENT_TOKEN}`, body: { dryRun: true, containers: [] } });
  assert.equal(db.data("streamManager/agent").dryRun, true);
  await call(agentApi, { auth: `Bearer ${AGENT_TOKEN}`, body: { dryRun: "true", containers: [] } });
  assert.equal(db.data("streamManager/agent").dryRun, false);
});

test("cron endpoint: needs CRON_SECRET", async () => {
  assert.equal((await call(cronApi, { method: "GET" })).statusCode, 401);
  assert.equal((await call(cronApi, { method: "GET", auth: "Bearer wrong" })).statusCode, 401);
  assert.equal((await call(cronApi, { method: "GET", auth: CRON })).statusCode, 401, "no Bearer prefix");
  assert.equal((await call(cronApi, { method: "GET", auth: `Bearer ${CRON} ` })).statusCode, 401);
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal((await call(cronApi, { method: "GET", auth: "Bearer undefined" })).statusCode, 401, "unset secret never matches");
  process.env.CRON_SECRET = saved;
});

test("cron endpoint: the right secret runs one tick (nothing enabled → nothing happens)", async () => {
  const r = await call(cronApi, { method: "GET", auth: `Bearer ${CRON}` });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.records, 0);
  assert.deepEqual(r.body.changes, []);
  assert.equal(r.body.vm, null, "no VM call when nothing needs it");
});

test("auto-* actions are admin-only", async () => {
  for (const action of ["auto-select", "auto-national", "auto-start-now", "auto-cancel", "auto-retry", "auto-config"]) {
    assert.equal((await call(smApi, { auth: "Bearer tok-user", body: { action, scheduleId: "s1" } })).statusCode, 403);
    assert.equal((await call(smApi, { body: { action } })).statusCode, 401);
  }
  assert.equal(db.data("broadcasts/g401001"), undefined);
});

test("auto-select through the API creates the record; nothing else happens", async () => {
  const r = await call(smApi, { auth: "Bearer tok-admin", body: { action: "auto-select", scheduleId: "s1" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.id, "g401001");
  const d = db.data("broadcasts/g401001");
  assert.equal(d.auto.phase, "selected");
  assert.equal(d.auto.selectedBy, "admin1");
  assert.equal(d.youtube.broadcastId, null);
});

test("auto-config validates input", async () => {
  const bad = [
    { slotStreamIds: "x", maxConcurrent: 1 },
    { slotStreamIds: ["a", "a"], maxConcurrent: 1 },
    { slotStreamIds: ["a/b"], maxConcurrent: 1 },
    { slotStreamIds: ["a"], maxConcurrent: 0 },
    { slotStreamIds: ["a"], maxConcurrent: 7 },
  ];
  for (const b of bad) assert.equal((await call(smApi, { auth: "Bearer tok-admin", body: { action: "auto-config", ...b } })).statusCode, 400, JSON.stringify(b));
});

test("refresh-statuses and delete go through admin auth; delete's guard reaches the client", async () => {
  assert.equal((await call(smApi, { auth: "Bearer tok-user", body: { action: "refresh-statuses", apply: true } })).statusCode, 403);
  await db.doc("broadcasts/open1").set({ gameId: "1", status: "scheduled", youtube: {}, worker: {}, auto: { phase: "selected", open: true, active: false } });
  const r = await call(smApi, { auth: "Bearer tok-admin", body: { action: "delete", id: "open1" } });
  assert.equal(r.statusCode, 409);
  assert.match(r.body.error, /still under automation/);
  assert.ok(db.data("broadcasts/open1"));
  const dry = await call(smApi, { auth: "Bearer tok-admin", body: { action: "refresh-statuses" } });
  assert.equal(dry.statusCode, 200);
  assert.equal(dry.body.applied, false);
});

test("tokens never reach the logs", () => {
  for (const l of logs) assert.ok(!l.includes(AGENT_TOKEN) && !l.includes(CRON), l);
});
