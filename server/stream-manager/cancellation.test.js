// server/stream-manager/cancellation.test.js — the cancelled status, the
// deletion guard and the status refresh (migration), on fake Firestore.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("./__fakes__/firestore");
const bc = require("./broadcasts");

const logs = [];
const realLog = console.log;

// ── deriveStatus ──

test("cancelled automation derives a distinct cancelled status", () => {
  const d = (auto, youtube = {}, worker = {}) => bc.deriveStatus({ auto, youtube, worker });
  assert.equal(d({ phase: "cancelled" }, {}, { status: "stopped" }), "cancelled");
  assert.equal(d({ phase: "cancelled" }, { broadcastId: "x", lifecycleStatus: "ready" }), "cancelled");
  // YouTube still on the air after a cancel → needs attention
  assert.equal(d({ phase: "cancelled" }, { lifecycleStatus: "live" }), "error");
  assert.equal(d({ phase: "cancelled" }, { lifecycleStatus: "testing" }), "error");
  // YouTube already ended wins
  assert.equal(d({ phase: "cancelled" }, { lifecycleStatus: "complete" }), "ended");
  // others unchanged
  assert.equal(d({ phase: "completed" }), "ended");
  assert.equal(d({ phase: "failed" }), "error");
  assert.equal(d({ phase: "selected" }), "scheduled");
  assert.equal(d({ phase: "worker" }), "preparing");
  assert.equal(bc.deriveStatus({ youtube: {}, worker: {} }), "scheduled");
});

// ── Deletion guard ──

function seed() {
  const rec = (auto, extra = {}) => ({ gameId: "1", status: "scheduled", youtube: { broadcastId: null, lifecycleStatus: null }, worker: { status: "idle" }, ...(auto ? { auto } : {}), ...extra });
  return fakeFirestore({
    "broadcasts/selected1": rec({ phase: "selected", open: true, active: false, enabled: true }),
    "broadcasts/active1": rec({ phase: "live", open: true, active: true, enabled: true }, { status: "live", youtube: { broadcastId: "b1", lifecycleStatus: "live" }, worker: { status: "running" } }),
    "broadcasts/staleActive": rec({ phase: "cancelled", open: false, active: true }),
    "broadcasts/workerUp": rec({ phase: "cancelled", open: false, active: false }, { worker: { status: "running" } }),
    "broadcasts/manualLive": rec(null, { status: "live", youtube: { broadcastId: "b2", lifecycleStatus: "live" } }),
    "broadcasts/manualTesting": rec(null, { youtube: { broadcastId: "b3", lifecycleStatus: "testing" } }),
    "broadcasts/cancelled1": rec({ phase: "cancelled", open: false, active: false, enabled: false }, { status: "cancelled", worker: { status: "stopped" } }),
    "broadcasts/ended1": rec({ phase: "completed", open: false, active: false }, { status: "ended", youtube: { broadcastId: "b4", lifecycleStatus: "complete" }, worker: { status: "stopped" } }),
    "broadcasts/manualReady": rec(null, { youtube: { broadcastId: "b5", lifecycleStatus: "ready" } }),
    "broadcasts/legacyFsu": rec({ phase: "cancelled", open: false, active: false, enabled: true }, { awayTeam: { school: "Florida State" }, homeTeam: { school: "Louisville" }, worker: { status: "stopped" } }),
    "broadcasts/openPrep": rec({ phase: "preparing", open: true, active: true, enabled: true }, { status: "preparing" }),
  });
}

test("delete is refused while automation is open/active or anything may still be running", async () => {
  const db = seed();
  const cases = {
    selected1: /still under automation/,
    active1: /still under automation/,
    staleActive: /still under automation/,
    workerUp: /worker may still be running/,
    manualLive: /testing or live/,
    manualTesting: /testing or live/,
  };
  for (const [id, re] of Object.entries(cases)) {
    await assert.rejects(bc.deleteRecord(db, { id }), (e) => e.status === 409 && re.test(e.message), id);
    assert.ok(db.data(`broadcasts/${id}`), `${id} must still exist`);
  }
});

test("delete works for safely closed records (cancelled, ended, manual not on air)", async () => {
  const db = seed();
  for (const id of ["cancelled1", "ended1", "manualReady", "legacyFsu"]) {
    assert.deepEqual(await bc.deleteRecord(db, { id }), { ok: true });
    assert.equal(db.data(`broadcasts/${id}`), undefined, id);
  }
  await assert.rejects(bc.deleteRecord(db, { id: "cancelled1" }), (e) => e.status === 404);
});

// ── Status refresh (migration) ──

test("refresh-statuses: dry run lists the legacy cancelled record and writes nothing", async () => {
  const db = seed();
  const before = JSON.stringify([...db.store.entries()]);
  const r = await bc.refreshStatuses(db, {});
  assert.equal(r.applied, false);
  const fsu = r.changes.find((c) => c.id === "legacyFsu");
  assert.deepEqual(fsu, { id: "legacyFsu", matchup: "Florida State vs Louisville", from: "scheduled", to: "cancelled", disableAuto: true });
  assert.ok(!r.changes.some((c) => ["selected1", "active1", "openPrep"].includes(c.id)), "open automation records are the orchestrator's");
  assert.equal(JSON.stringify([...db.store.entries()]), before, "dry run changed nothing");
});

test("refresh-statuses: apply fixes status + auto.enabled, deletes nothing, and is idempotent", async () => {
  console.log = (...a) => logs.push(a.join(" "));
  const db = seed();
  const count = db.store.size;
  const r = await bc.refreshStatuses(db, { apply: true });
  console.log = realLog;
  assert.equal(r.applied, true);
  const fsu = db.data("broadcasts/legacyFsu");
  assert.equal(fsu.status, "cancelled");
  assert.equal(fsu.auto.enabled, false);
  assert.equal(fsu.auto.phase, "cancelled", "phase untouched");
  assert.equal(db.store.size, count, "nothing deleted");
  assert.equal(db.data("broadcasts/openPrep").status, "preparing", "open record untouched");
  assert.equal(db.data("broadcasts/active1").status, "live", "open record untouched");
  assert.deepEqual((await bc.refreshStatuses(db, {})).changes, [], "second run: nothing left");
  assert.ok(logs.some((l) => /refresh-statuses applied=/.test(l)));
});

test("refresh-statuses only applies with apply === true", async () => {
  const db = seed();
  for (const apply of ["true", 1, "yes", undefined]) {
    const r = await bc.refreshStatuses(db, { apply });
    assert.equal(r.applied, false);
  }
  assert.equal(db.data("broadcasts/legacyFsu").status, "scheduled");
});
