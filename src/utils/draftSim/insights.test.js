import { buildSimInsights, playerIds, withNames, sinceDay, boardRanks, BOARD_POSITIONS, favoritesReady } from "./insights";
import { SIM_POSITIONS } from "./engine";

test("community insights: teams, players and the first round, this week and all time", () => {
  const now = Date.parse("2026-10-29T15:00:00Z");
  const today = sinceDay(1, now);
  const old = "2026-09-01";
  const out = buildSimInsights({
    years: ["2027"], now,
    teams: [{ year: "2027", day: today, t: { NYJ: 3, CLE: 1, WATCH: 9 } }, { year: "2027", day: old, t: { CLE: 5 } }, { year: "2028", day: today, t: { DAL: 4 } }],
    picks: [
      { year: "2027", team: "NYJ", day: today, p: { "7_a": 2, "7_b": 1, "40_c": 3 } },
      { year: "2027", team: "CLE", day: old, p: { "1_a": 4 } },
    ],
    daily: [{ day: today, sims: 5, completed: 2, picks: 9 }, { day: old, sims: 10, completed: 8, picks: 30 }],
  });
  expect(out.totals.week).toEqual({ sims: 5, completed: 2, picks: 9 });
  expect(out.totals.all.sims).toBe(15);
  const y = out.years["2027"];
  // Watching the CPU isn't a team; the 2028 class stays out.
  expect(y.week.teams).toEqual([{ t: "NYJ", n: 3 }, { t: "CLE", n: 1 }]);
  expect(y.all.teams[0]).toEqual({ t: "CLE", n: 6 });
  expect(y.all.players[0]).toEqual({ id: "a", n: 6 });
  // Round 1 only, its most common pick and every pick made there.
  expect(y.week.firstRound).toEqual([{ overall: 7, id: "a", n: 2, of: 3 }]);
  expect(y.all.firstRound.map((p) => p.overall)).toEqual([1, 7]);
  expect(playerIds(out).sort()).toEqual(["a", "b", "c"]);
  expect(withNames(out, [{ id: "a", First: "Will", Last: "Echoles", Position: "DL", School: "Ole Miss", Slug: "will" }]).players.a).toEqual({ F: "Will", L: "Echoles", pos: "DL", s: "Ole Miss", sl: "will" });
});

test("community favorites: the median pick furthest ahead of the board, 10 picks at least", () => {
  expect(BOARD_POSITIONS).toEqual(SIM_POSITIONS);
  const ranks = boardRanks({ QB: [{ i: "q", cr: 3 }], WR: [{ i: "w", cr: 1 }, { i: "x", cr: 50 }, { i: "y", cr: 90 }], K: [{ i: "k", cr: 2 }] });
  expect(ranks).toEqual({ w: 1, q: 2, x: 3, y: 4 });
  const boards = { 2027: { a: 40, b: 60, c: 5, d: 100, e: 60 } };
  const out = buildSimInsights({
    years: ["2027"], boards,
    picks: [{ year: "2027", team: "NYJ", day: "2026-09-01", p: {
      "20_a": 10, // 20 spots early, 10 picks
      "30_b": 6, "50_b": 6, // 30 and 10 early: a median of 20, 12 picks (ahead of a on the tie)
      "59_e": 7, "1_e": 4, // 1 early 7 times, 59 early 4: the median's 1, not the average
      "10_c": 20, // a slide, not a favorite
      "1_d": 9, // 99 early but only 9 picks
    } }],
  });
  expect(out.years["2027"].all.favorites).toEqual([{ id: "b", n: 12, median: 20 }, { id: "a", n: 10, median: 20 }, { id: "e", n: 11, median: 1 }]);
  // Three's not a full list: the page stays on the most picked.
  expect(favoritesReady(out.years["2027"].all.favorites)).toBe(false);
  expect(favoritesReady(Array.from({ length: 10 }, (_, i) => ({ id: `${i}` })))).toBe(true);
});
