// node --test server/live/store.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./store");
const { fakeDb } = require("./testDb");

test("writePlayArchive: a final game's plays in one doc, in order, hidden/removed left out", async () => {
  const db = fakeDb({
    "liveGames/9": { status: "final", playsRev: 4 },
    "liveGames/9/plays/b": { id: "b", seq: 2, text: "second" },
    "liveGames/9/plays/a": { id: "a", seq: 1, text: "first" },
    "liveGames/9/plays/h": { id: "h", seq: 3, text: "hidden", hidden: true },
    "liveGames/9/plays/r": { id: "r", seq: 4, text: "removed", removed: true },
  });
  const res = await S.writePlayArchive(db, 9, 4);
  assert.deepEqual(res, { plays: 2, chunks: 1 });
  const doc = db.store.get("liveGames/9/box/pbp0");
  assert.deepEqual(doc.plays.map((p) => p.id), ["a", "b"]);
  assert.deepEqual([doc.i, doc.of], [0, 1]);
  const g = db.store.get("liveGames/9");
  assert.equal(g.status, "final"); // merged, not replaced
  assert.deepEqual({ ...g.playArchive, at: 0 }, { rev: 4, chunks: 1, count: 2, at: 0 });
});

test("writePlayArchive: a game too big for one doc is split across several", async () => {
  const seed = { "liveGames/7": {} };
  const filler = "x".repeat(10 * 1024);
  for (let i = 0; i < 150; i++) seed[`liveGames/7/plays/p${i}`] = { id: `p${i}`, seq: i, text: filler };
  const db = fakeDb(seed);
  const res = await S.writePlayArchive(db, 7, 1);
  assert.equal(res.chunks, 3);
  const all = [0, 1, 2].flatMap((i) => db.store.get(`liveGames/7/box/pbp${i}`).plays.map((p) => p.seq));
  assert.deepEqual(all, [...Array(150).keys()]);
  assert.equal(db.store.get("liveGames/7").playArchive.chunks, 3);
});
