import { classSnapshotRanks, compareRanks } from "./classRanks";

const doc = {
  rows: [{ i: "a", cr: 2 }, { i: "b", cr: 7 }, { i: "c", cr: 15 }, { i: "d" }],
  hidden: { h: { cr: 9, pi: 2 } },
};

test("class rank is cr; position rank counts better cr in the group", () => {
  const r = classSnapshotRanks(doc);
  expect(r.a).toEqual({ classRank: 2, positionRank: 1 });
  expect(r.b).toEqual({ classRank: 7, positionRank: 2 });
  expect(r.c).toEqual({ classRank: 15, positionRank: 3 });
});

test("hidden (not-Live) players ranked the same way PlayerProfile.js does", () => {
  expect(classSnapshotRanks(doc).h).toEqual({ classRank: 9, positionRank: 3 });
});

test("missing cr / missing doc give no rank, never 0", () => {
  expect(classSnapshotRanks(doc).d).toEqual({ classRank: null, positionRank: null });
  expect(classSnapshotRanks(null)).toEqual({});
});

test("compareRanks: ascending/descending, missing always last", () => {
  // (undefined is moved to the end by Array#sort itself, so NaN stands in.)
  const list = [5, null, 1, NaN, 3, 0];
  expect([...list].sort((x, y) => compareRanks(x, y, "asc"))).toEqual([1, 3, 5, null, NaN, 0]);
  expect([...list].sort((x, y) => compareRanks(x, y, "desc")).slice(0, 3)).toEqual([5, 3, 1]);
});
