import { buildList, listPills, movesFrom, nextHistory, pickBaseline } from "./whiteboardLists";

const P = (id, round, extra = {}) => ({ id, round, ...extra });

test("risers and fallers compare with the earlier order", () => {
  const players = [P("a", "ROUND 1"), P("b", "ROUND 1"), P("c", "ROUND 2"), P("d", "ROUND 3")];
  const baseline = ["c", "a", "b"]; // d is new — left out
  const up = buildList("risers", players, { baseline });
  expect(up.map((p) => p.id)).toEqual(["a", "b"]);
  const moves = movesFrom(players, baseline);
  expect(listPills("risers", moves, "a")).toEqual([{ text: "▲ 1", tone: "accent" }]);
  expect(listPills("sleepers", moves, "a")).toEqual([]);
  const down = buildList("fallers", players, { baseline });
  expect(down.map((p) => p.id)).toEqual(["c"]);
  expect(listPills("fallers", moves, "c")[0].text).toBe("▼ 2");
  expect(buildList("risers", players, { baseline: null })).toEqual([]);
});

test("community lists", () => {
  const players = [P("a", "ROUND 1"), P("b", "ROUND 2"), P("c", "ROUND 2", { flagged: true }), P("d", "ROUND 5"), P("e", "ROUND 6")];
  const community = { a: 2.2, b: 7, c: 3, d: 1.5, e: null };
  expect(buildList("gems", players, { community }).map((p) => p.id)).toEqual(["b", "e"]);
  expect(buildList("sleepers", players, { community }).map((p) => p.id)).toEqual(["b"]);
  expect(buildList("safe", players, { community }).map((p) => p.id)).toEqual(["a"]);
  expect(buildList("busts", players, { community }).map((p) => p.id)).toEqual(["c", "d"]);
});

test("history keeps the loaded board and picks a baseline", () => {
  const h = nextHistory({}, { loadedDay: "2026-11-01", loadedOrder: ["a", "b"], today: "2026-11-12", order: ["b", "a"] });
  expect(h).toEqual({ "2026-11-12": "b,a", "2026-11-01": "a,b" });
  expect(pickBaseline(h, "2026-11-12")).toEqual({ day: "2026-11-01", ids: ["a", "b"] });
  expect(pickBaseline({ "2026-11-12": "a" }, "2026-11-12")).toBeNull();
  expect(pickBaseline({ "2026-08-01": "x", "2026-11-05": "y", "2026-11-09": "z" }, "2026-11-12").day).toBe("2026-11-05");
});
