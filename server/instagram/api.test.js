// server/instagram/api.test.js — api/instagram.js itself, with Firebase and
// Storage faked: the cron tick (every minute: scheduled posts; at :47 also
// cleanup and analytics) and who gets in.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { fakeFirestore } = require("../stream-manager/__fakes__/firestore");

let db;
const bucket = { file: () => ({}), getFiles: async () => [[]] };
require.cache[path.resolve(__dirname, "../../scripts/firebaseAdmin.js")] = {
  id: "firebaseAdmin", loaded: true, exports: { getFirestore: () => db, getBucket: () => bucket },
};
process.env.INSTAGRAM_ACCESS_TOKEN = "EAAtest";
process.env.INSTAGRAM_USER_ID = "IG1";
process.env.CRON_SECRET = "cron-secret";
const handler = require("../../api/instagram");

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

test("cron tick: scheduled posts every minute; cleanup and analytics only at :47", async () => {
  db = fakeFirestore();
  const quiet = await handler.cronTick(db, new Date("2026-11-04T12:05:00Z"));
  assert.deepEqual(quiet, { scheduled: { due: 0, scheduled: 0 } });
  const hourly = await handler.cronTick(db, new Date("2026-11-04T12:47:00Z"));
  assert.deepEqual(hourly.scheduled, { due: 0, scheduled: 0 });
  assert.deepEqual(hourly.cleanup, { tried: 0, done: 0 });
  assert.equal(hourly.skipped, "scheduled sync is off");
});

test("only the cron secret runs the tick; only admins use the actions", async () => {
  db = fakeFirestore();
  let r = res();
  await handler({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 401);
  r = res();
  await handler({ method: "GET", headers: { authorization: "Bearer cron-secret" } }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.scheduled, { due: 0, scheduled: 0 });
  r = res();
  await handler({ method: "POST", headers: {}, body: { action: "status" } }, r);
  assert.equal(r.code, 401);
});
