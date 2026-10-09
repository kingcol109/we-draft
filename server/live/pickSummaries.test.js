// node --test server/live/pickSummaries.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");
const { buildPickSummaries } = require("./pickSummaries");
const { fakeDb } = require("./testDb");

const NOW = Date.parse("2026-10-07T15:00:00Z");
const KICK = Date.parse("2026-10-10T16:00:00Z");
const ts = (t) => Timestamp.fromMillis(t);
const pick = (o) => ({ displayName: "Fan", visibility: "public", updatedAt: ts(NOW - 3600e3), ...o });

function seeded() {
  return fakeDb({
    "schedule26/g1": { KickoffAt: ts(KICK) },
    "schedule26/old": { KickoffAt: ts(NOW - 3 * 86400e3) },
    "schedule26/g1/picks/u1": pick({ displayName: "Ann", awayScore: 31, homeScore: 17, pickedTeam: "away", prediction: "Easy", ranked: true }),
    "schedule26/g1/picks/u2": pick({ displayName: "Bo", awayScore: 14, homeScore: 21, visibility: "private" }),
    "schedule26/g1/picks/u3": pick({ displayName: "Cy", pickedTeam: "home", updatedAt: ts(NOW - 7200e3) }),
    "users/u1": { verified: true },
    "users/u3": {},
  });
}

test("first run: a full summary of the window's games — split, average, scores, public picks", async () => {
  const db = seeded();
  const { state, built } = await buildPickSummaries(db, { now: NOW });
  assert.deepEqual(built, { full: 1, merged: 0 });
  assert.deepEqual(state.games.map((g) => g.id), ["g1"]); // "old" is out of the window
  const s = db.store.get("wePickSummaries/g1");
  assert.equal(s.count, 3);
  assert.deepEqual(s.split, { away: 1, home: 2 });
  assert.equal(s.scored, 2);
  assert.deepEqual(s.sum, { away: 45, home: 38 });
  assert.deepEqual(s.scores, { "31-17": 1, "14-21": 1 });
  assert.equal(s.publicCount, 2);
  // newest first, private left out, verified looked up
  assert.deepEqual(s.recent.map((r) => [r.uid, r.name, r.verified, r.ranked]), [["u1", "Ann", true, true], ["u3", "Cy", false, false]]);
  assert.equal(s.recent[0].prediction, "Easy");
  assert.equal(s.locked, false);
});

test("later runs read only what changed: nothing → one read; an edit is merged in", async () => {
  const db = seeded();
  let { state } = await buildPickSummaries(db, { now: NOW });
  db.reads.n = 0;
  let r = await buildPickSummaries(db, { now: NOW + 5 * 60e3, state });
  assert.deepEqual(r.built, { full: 0, merged: 0 });
  assert.equal(db.reads.n, 1); // the one empty "changed since" query
  state = r.state;
  db.store.set("schedule26/g1/picks/u3", pick({ displayName: "Cy", awayScore: 10, homeScore: 40, updatedAt: ts(NOW + 6 * 60e3) }));
  db.store.set("schedule26/g1/picks/u4", pick({ displayName: "Di", awayScore: 28, homeScore: 24, updatedAt: ts(NOW + 7 * 60e3) }));
  r = await buildPickSummaries(db, { now: NOW + 10 * 60e3, state });
  assert.deepEqual(r.built, { full: 0, merged: 1 });
  const s = db.store.get("wePickSummaries/g1");
  assert.equal(s.count, 4);
  assert.deepEqual(s.split, { away: 2, home: 2 });
  assert.deepEqual(s.sum, { away: 83, home: 102 });
  assert.deepEqual(s.recent.map((x) => x.uid), ["u4", "u3", "u1"]);
});

test("after kickoff: one full rebuild, marked locked, then never touched again", async () => {
  const db = seeded();
  let { state } = await buildPickSummaries(db, { now: NOW });
  let r = await buildPickSummaries(db, { now: KICK + 60e3, state });
  assert.deepEqual(r.built, { full: 1, merged: 0 });
  assert.equal(db.store.get("wePickSummaries/g1").locked, true);
  db.reads.n = 0;
  r = await buildPickSummaries(db, { now: KICK + 10 * 60e3, state: r.state });
  assert.deepEqual(r.built, { full: 0, merged: 0 });
  assert.equal(db.reads.n, 0);
});

test("the index stays server-side; a deleted pick drops out at the next full rebuild", async () => {
  const db = seeded();
  const { state } = await buildPickSummaries(db, { now: NOW });
  assert.ok(db.store.get("wePickSummaries/g1/private/index").picks.u2);
  db.store.delete("schedule26/g1/picks/u1");
  await buildPickSummaries(db, { now: NOW + 6 * 3600e3 + 1, state });
  const s = db.store.get("wePickSummaries/g1");
  assert.equal(s.count, 2);
  assert.ok(!s.recent.some((x) => x.uid === "u1"));
});

test("a full rebuild looks verified badges up fresh", async () => {
  const db = seeded();
  const { state } = await buildPickSummaries(db, { now: NOW });
  assert.equal(db.store.get("wePickSummaries/g1").recent.find((r) => r.uid === "u3").verified, false);
  db.store.set("users/u3", { verified: true });
  await buildPickSummaries(db, { now: NOW + 6 * 3600e3 + 1, state });
  assert.equal(db.store.get("wePickSummaries/g1").recent.find((r) => r.uid === "u3").verified, true);
});
