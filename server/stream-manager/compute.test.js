// server/stream-manager/compute.test.js
//
// Worker VM control through the real api/stream-manager.js handler, with
// Firebase auth, Firestore and Compute Engine faked — nothing leaves the
// machine and no VM is touched.
//
//   npm run stream-manager:test   (node --test)

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const crypto = require("crypto");

// ── Fakes ──

// A real-looking but throwaway key, so the "never logged" checks have
// something to look for.
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const SA = { type: "service_account", project_id: "we-draft-test", client_email: "wd-vm@we-draft-test.iam.gserviceaccount.com", private_key: PEM };
const FIRESTORE_SA = { ...SA, client_email: "firebase-adminsdk@we-draft-test.iam.gserviceaccount.com" };
const ACCESS_TOKEN = "ya29.fake-access-token-do-not-log";

const ENV = {
  GCE_SERVICE_ACCOUNT_KEY: JSON.stringify(SA).replace(/\n/g, "\\n"), // as Vercel stores it
  GCE_PROJECT_ID: "we-draft-test",
  GCE_ZONE: "us-east1-b",
  GCE_INSTANCE_NAME: "we-draft-broadcast-01",
  GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify(FIRESTORE_SA),
};
const VM_URL = "https://compute.googleapis.com/compute/v1/projects/we-draft-test/zones/us-east1-b/instances/we-draft-broadcast-01";

const USERS = { "tok-admin": { uid: "admin1", role: "admin" }, "tok-user": { uid: "user1", role: "user" } };
let state; // { vmStatus, liveBroadcast, computeCalls, computeFail }

const fakeDb = {
  collection(name) {
    return {
      doc: (id) => ({ get: async () => ({ data: () => (name === "users" ? Object.values(USERS).find((u) => u.uid === id) : undefined) }) }),
      where: () => ({ limit: () => ({ get: async () => ({ empty: !(name === "broadcasts" && state.liveBroadcast) }) }) }),
    };
  },
};
require.cache[path.resolve(__dirname, "../../scripts/firebaseAdmin.js")] = {
  id: "firebaseAdmin", loaded: true,
  exports: { getFirestore: () => fakeDb },
};

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith("https://identitytoolkit.googleapis.com/")) {
    const u = USERS[JSON.parse(opts.body).idToken];
    return u ? json(200, { users: [{ localId: u.uid }] }) : json(400, { error: { message: "INVALID_ID_TOKEN" } });
  }
  if (url.startsWith("https://compute.googleapis.com/")) {
    state.computeCalls.push({ method: opts.method, url, auth: opts.headers?.Authorization });
    if (state.computeFail) return json(state.computeFail, { error: { message: "Required 'compute.instances.start' permission" } });
    if (opts.method === "POST" && url.endsWith("/start")) { state.vmStatus = "STAGING"; return json(200, { name: "operation-start-1", status: "RUNNING" }); }
    if (opts.method === "POST" && url.endsWith("/stop")) { state.vmStatus = "STOPPING"; return json(200, { name: "operation-stop-1", status: "RUNNING" }); }
    if (opts.method === "GET") {
      return json(200, {
        name: "we-draft-broadcast-01", status: state.vmStatus,
        machineType: "https://www.googleapis.com/compute/v1/projects/we-draft-test/zones/us-east1-b/machineTypes/e2-standard-4",
        lastStartTimestamp: "2026-10-08T10:00:00.000-07:00",
        metadata: { items: [{ key: "startup-script", value: "export YOUTUBE_STREAM_KEY=SECRET-KEY" }] },
        serviceAccounts: [{ email: "vm-runtime@we-draft-test.iam.gserviceaccount.com" }],
        networkInterfaces: [{ accessConfigs: [{ natIP: "203.0.113.9" }] }],
      });
    }
  }
  throw new Error(`unexpected fetch ${opts.method || "GET"} ${url}`);
};

// Everything the handler and compute.js log, checked for secrets at the end.
const logged = [];
const realLog = console.log, realError = console.error;
console.log = (...a) => logged.push(a.join(" "));
console.error = (...a) => logged.push(a.join(" "));

const vm = require("./compute");
const handler = require("../../api/stream-manager");

async function call(body, { token = "tok-admin", method = "POST", query } = {}) {
  const res = {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h); },
    end() {},
  };
  await handler({ method, query: query || {}, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
}
const posts = () => state.computeCalls.filter((c) => c.method === "POST");

const savedEnv = {};
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { if (!(k in savedEnv)) savedEnv[k] = process.env[k]; process.env[k] = v; }
  state = { vmStatus: "TERMINATED", liveBroadcast: false, computeCalls: [], computeFail: 0 };
  vm._setTokenProvider(async () => ACCESS_TOKEN);
});

after(() => {
  global.fetch = realFetch;
  console.log = realLog; console.error = realError;
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

// ── Auth ──

test("vm actions need a signed-in admin, and never reach Compute Engine otherwise", async () => {
  for (const action of ["vm-status", "vm-start", "vm-stop"]) {
    assert.equal((await call({ action }, { token: null })).statusCode, 401);
    assert.equal((await call({ action }, { token: "tok-bogus" })).statusCode, 401);
    assert.equal((await call({ action }, { token: "tok-user" })).statusCode, 403);
  }
  assert.equal((await call({ action: "vm-start" }, { method: "GET" })).statusCode, 405);
  assert.equal(state.computeCalls.length, 0);
});

test("unknown actions are rejected", async () => {
  const r = await call({ action: "vm-delete" });
  assert.equal(r.statusCode, 400);
  assert.equal(state.computeCalls.length, 0);
});

// ── Status ──

test("vm-status returns only the sanitized instance", async () => {
  state.vmStatus = "RUNNING";
  const r = await call({ action: "vm-status" });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body, {
    instance: {
      name: "we-draft-broadcast-01", zone: "us-east1-b", status: "RUNNING", state: "running",
      machineType: "e2-standard-4", lastStartTimestamp: "2026-10-08T10:00:00.000-07:00", lastStopTimestamp: null,
    },
  });
  const raw = JSON.stringify(r.body);
  for (const s of ["SECRET-KEY", "startup-script", "vm-runtime@", "203.0.113.9"]) assert.ok(!raw.includes(s), `response leaks ${s}`);
  assert.deepEqual(state.computeCalls.map((c) => [c.method, c.url]), [["GET", VM_URL]]);
  assert.equal(state.computeCalls[0].auth, `Bearer ${ACCESS_TOKEN}`);
});

test("vm state mapping covers every Compute Engine status", () => {
  for (const s of ["PROVISIONING", "STAGING", "RUNNING", "STOPPING", "SUSPENDING", "SUSPENDED", "TERMINATED", "REPAIRING"]) {
    assert.notEqual(vm.sanitizeInstance({ status: s }, { zone: "z", instance: "i" }).state, "unknown", s);
  }
  assert.equal(vm.sanitizeInstance({ status: "NEW_THING" }, { zone: "z", instance: "i" }).state, "unknown");
});

// ── Start ──

test("vm-start starts a stopped VM", async () => {
  const r = await call({ action: "vm-start" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.result, "starting");
  assert.deepEqual(r.body.operation, { id: "operation-start-1", status: "RUNNING" });
  assert.equal(r.body.instance.state, "starting");
  assert.deepEqual(posts().map((c) => c.url), [`${VM_URL}/start`]);
});

test("vm-start is a no-op when the VM is already starting or running", async () => {
  for (const s of ["RUNNING", "STAGING", "PROVISIONING"]) {
    state.vmStatus = s;
    const r = await call({ action: "vm-start" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.result, "already-running");
  }
  assert.equal(posts().length, 0);
});

test("vm-start refuses while the VM is stopping or suspended", async () => {
  for (const s of ["STOPPING", "SUSPENDING", "SUSPENDED", "REPAIRING"]) {
    state.vmStatus = s;
    assert.equal((await call({ action: "vm-start" })).statusCode, 409, s);
  }
  assert.equal(posts().length, 0);
});

// ── Stop ──

test("vm-stop stops a running VM when nothing is live", async () => {
  state.vmStatus = "RUNNING";
  const r = await call({ action: "vm-stop" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.result, "stopping");
  assert.equal(r.body.instance.state, "stopping");
  assert.deepEqual(posts().map((c) => c.url), [`${VM_URL}/stop`]);
});

test("vm-stop refuses while a broadcast is live unless confirmLive is exactly true", async () => {
  state.vmStatus = "RUNNING";
  state.liveBroadcast = true;
  for (const confirmLive of [undefined, false, "true", 1]) {
    const r = await call({ action: "vm-stop", confirmLive });
    assert.equal(r.statusCode, 409, String(confirmLive));
    assert.match(r.body.error, /live/);
  }
  assert.equal(posts().length, 0);
  const r = await call({ action: "vm-stop", confirmLive: true });
  assert.equal(r.statusCode, 200);
  assert.equal(posts().length, 1);
});

test("vm-stop is a no-op when the VM is already stopped or stopping", async () => {
  for (const s of ["TERMINATED", "STOPPING"]) {
    state.vmStatus = s;
    const r = await call({ action: "vm-stop" });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.result, "already-stopped");
  }
  assert.equal(posts().length, 0);
});

// ── Target and config ──

test("a request can't redirect the call to another VM, zone or project", async () => {
  await call({ action: "vm-start", instance: "prod-db", zone: "europe-west1-b", project: "someone-else", name: "x" });
  assert.ok(state.computeCalls.length > 0);
  for (const c of state.computeCalls) assert.ok(c.url.startsWith(VM_URL), c.url);
});

test("instance name defaults to we-draft-broadcast-01", () => {
  delete process.env.GCE_INSTANCE_NAME;
  assert.equal(vm.target().instance, "we-draft-broadcast-01");
});

test("missing or malformed config fails with 500 naming the variable, before any Compute call", async () => {
  const cases = [
    ["GCE_SERVICE_ACCOUNT_KEY", undefined],
    ["GCE_PROJECT_ID", undefined],
    ["GCE_ZONE", undefined],
    ["GCE_ZONE", "us-east1-b/../../other"],
    ["GCE_PROJECT_ID", "We-Draft/../x"],
    ["GCE_INSTANCE_NAME", "Bad_Name"],
  ];
  for (const [k, v] of cases) {
    for (const [ek, ev] of Object.entries(ENV)) process.env[ek] = ev;
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
    const r = await call({ action: "vm-status" });
    assert.equal(r.statusCode, 500, `${k}=${v}`);
    assert.match(r.body.error, new RegExp(k));
  }
  assert.equal(state.computeCalls.length, 0);
});

test("Compute Engine errors come back as 502 with a useful message", async () => {
  state.computeFail = 403;
  let r = await call({ action: "vm-start" });
  assert.equal(r.statusCode, 502);
  assert.match(r.body.error, /refused the worker VM service account/);
  state.computeFail = 404;
  r = await call({ action: "vm-status" });
  assert.equal(r.statusCode, 502);
  assert.match(r.body.error, /can't find VM/);
});

// ── Credentials ──

test("the key loads from Vercel's escaped-newline form", () => {
  const sa = vm.credentials();
  assert.equal(sa.client_email, SA.client_email);
  assert.ok(sa.private_key.includes("\n-----END PRIVATE KEY-----"));
});

test("the Firestore service account can't be reused for VM control", () => {
  process.env.GCE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  assert.throws(() => vm.credentials(), /dedicated service account/);
});

test("a bad key fails as 502 without echoing the key", async () => {
  process.env.GCE_SERVICE_ACCOUNT_KEY = JSON.stringify({ ...SA, private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n" });
  vm._setTokenProvider(null); // the real google-auth-library path; signing fails before any network call
  const r = await call({ action: "vm-status" });
  assert.equal(r.statusCode, 502);
  assert.ok(!r.body.error.includes("not-a-key"));
  assert.equal(state.computeCalls.length, 0);
});

// Runs last (node:test runs a file's tests in order).
test("nothing logged contains the key or an access token", () => {
  assert.ok(logged.some((l) => l.includes("vm-start uid=admin1")), "actions are logged");
  const pemBody = PEM.split("\n")[1];
  for (const l of logged) {
    assert.ok(!l.includes(ACCESS_TOKEN), `token in log: ${l}`);
    assert.ok(!l.includes(pemBody), `key in log: ${l}`);
    assert.ok(!l.includes("PRIVATE KEY"), `key in log: ${l}`);
  }
});
