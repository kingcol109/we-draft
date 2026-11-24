import { dynastyBoard, draftOrder, pickLabel, initDynasty, simToUser, isUserOnClock, rosterOf, maxRoundsFor, makeDynastyPick, chooseDynastyPick } from "./engine";

const POS = ["QB", "RB", "WR", "TE", "EDGE", "OL"];
const big = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, First: "P", Last: String(i), Position: POS[i % POS.length], rank: i + 1 }));

test("board: other positions out, the rest renumbered in order", () => {
  const b = dynastyBoard([{ id: "a", Position: "EDGE", rank: 1 }, { id: "b", Position: "WR", rank: 2 }, { id: "c", Position: "QB", rank: 3 }]);
  expect(b.map((p) => [p.id, p.rank])).toEqual([["b", 1], ["c", 2]]);
});

test("order: snake reverses every other round, linear doesn't", () => {
  expect(draftOrder(4, 2, true).map((p) => p.slot)).toEqual([1, 2, 3, 4, 4, 3, 2, 1]);
  expect(draftOrder(4, 2, false).map((p) => p.slot)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  expect(pickLabel(draftOrder(12, 2, true)[13])).toBe("2.02");
});

test("rounds cap at what the board fills", () => {
  expect(maxRoundsFor(new Array(55), 12)).toBe(4);
  expect(maxRoundsFor(new Array(500), 6)).toBe(7);
});

test("CPU drafts up to the user, then the user picks", () => {
  const board = dynastyBoard(big);
  let s = initDynasty({ board, teams: 12, rounds: 4, userSlots: [5], seed: 7 });
  s = simToUser(s);
  expect(isUserOnClock(s)).toBe(true);
  expect(s.idx).toBe(4);
  s = makeDynastyPick(s, chooseDynastyPick(s).id);
  s = simToUser(s);
  expect(s.idx).toBe(19); // 2.08 — Team 5's second pick in a snake
});

test("a full CPU draft: every pick made once, no team hoards QBs or TEs", () => {
  const board = dynastyBoard(big);
  let s = simToUser(initDynasty({ board, teams: 12, rounds: 4, seed: 3 }));
  expect(s.done).toBe(true);
  const ids = s.picks.map((p) => p.selection);
  expect(new Set(ids).size).toBe(48);
  for (let slot = 1; slot <= 12; slot++) {
    const r = rosterOf(s, slot);
    expect(r.filter((p) => p.Position === "QB").length).toBeLessThanOrEqual(2);
    expect(r.filter((p) => p.Position === "TE").length).toBeLessThanOrEqual(2);
  }
});

test("sim data: moved picks go to their new team, via the old one; teams branded Team N", async () => {
  const { dynastySimData } = await import("./engine");
  const { initSim } = await import("../draftSim/engine");
  const board = dynastyBoard(big);
  const data = dynastySimData({ season: 2026 }, board, { year: "2027", teams: 6, rounds: 2, snake: false, owners: { 2: 4, 9: 4 } });
  expect(data.order[1]).toMatchObject({ Pick: 2, Team: "Team 2", Traded: "Team 4" });
  expect(data.order[0].Traded).toBe(null);
  expect(data.branding["Team 4"].Team).toBe("Team 4");
  const s = initSim({ order: data.order, board: data.board, rounds: 2, userTeams: ["Team 4"], noTrades: true, chooser: data.chooser, seed: 1 });
  expect(s.picks.filter((p) => p.owner === "Team 4").map((p) => p.overall)).toEqual([2, 4, 9, 10]);
  expect(s.picks[1].via).toBe("Team 2");
});
