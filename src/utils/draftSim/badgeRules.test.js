import { BADGE_RULES, runBadges, profileBadges, isWired } from "./badgeRules";

jest.mock("../../firebase", () => ({ db: {} }));

// A sim state with the user's team's picks already made.
// rows: [{ overall, round, pos, school, rank, first, last, need }].
function stateWith(rows, { team = "NYJ", trades = [], done = true, lastPick = null } = {}) {
  const byId = {};
  const picks = rows.map((r, i) => {
    const id = `p${i}`;
    byId[id] = { id, First: r.first || "F", Last: r.last || `L${i}`, Position: r.pos, School: r.school || "", rank: r.rank ?? r.overall };
    return { overall: r.overall, round: r.round || 1, owner: team, selection: id, need: r.need || null };
  });
  if (lastPick) picks.push({ overall: lastPick.overall, round: lastPick.round, owner: "KC", selection: null });
  return { picks, byId, trades, userTeams: [team], done };
}
const has = (state, id, opts = {}) => runBadges(state, { year: "2027", ...opts }).includes(id);

test("every rule has a scope and a test", () => {
  Object.values(BADGE_RULES).forEach((r) => {
    expect(["pick", "final", "run", "profile"]).toContain(r.scope);
    expect(typeof r.test).toBe("function");
  });
  expect(isWired("7umEuHzFMqwG1r7pYoje")).toBe(true);
  expect(isWired("nope")).toBe(false);
});

test("value badges by spots after board rank, not on My Board", () => {
  const s = stateWith([{ overall: 120, round: 4, pos: "WR", rank: 15 }]);
  ["7umEuHzFMqwG1r7pYoje", "ABUJEVcDpBmiQAVq9FtF", "1zZ2PcPdGjPaA9aIJdxk", "GLWdqqhHQYDxIx2sZSWK"].forEach((id) => expect(has(s, id)).toBe(true));
  expect(has(s, "7umEuHzFMqwG1r7pYoje", { valueBoard: false })).toBe(false);
  // Grand Larceny: not for a quarterback.
  expect(has(stateWith([{ overall: 120, round: 4, pos: "QB", rank: 15 }]), "GLWdqqhHQYDxIx2sZSWK")).toBe(false);
  // A reach isn't a steal.
  expect(has(stateWith([{ overall: 10, pos: "WR", rank: 30 }]), "7umEuHzFMqwG1r7pYoje")).toBe(false);
});

test("Value Hunter and What Are We Doing Here need a finished class of 5", () => {
  const steals = [1, 2, 3, 4, 5].map((i) => ({ overall: i * 32, round: i, pos: "WR", rank: i * 32 - 5 }));
  expect(has(stateWith(steals), "NVdAkPt562NBn6KSFctm")).toBe(true);
  expect(has(stateWith(steals, { done: false }), "NVdAkPt562NBn6KSFctm")).toBe(false);
  expect(has(stateWith(steals.slice(0, 4)), "NVdAkPt562NBn6KSFctm")).toBe(false);
  const reaches = steals.map((r) => ({ ...r, rank: r.overall + 5 }));
  expect(has(stateWith(reaches), "1gsp6Xwt610tO9nvHwPd")).toBe(true);
  expect(has(stateWith(reaches), "NVdAkPt562NBn6KSFctm")).toBe(false);
});

test("school badges", () => {
  const s = stateWith([
    { overall: 5, pos: "QB", school: "Florida State" },
    { overall: 40, round: 2, pos: "WR", school: "Florida State" },
    { overall: 70, round: 3, pos: "WR", school: "Florida" },
    { overall: 100, round: 4, pos: "LB", school: "Miami" },
  ]);
  expect(has(s, "AeD71ygnbwF1t67mpuUf")).toBe(true); // Teammates
  expect(has(s, "6DRh8T9OGAxnnBVadQcV")).toBe(true); // College Connection
  expect(has(s, "xrKrqL7M0lEBzziXcBk2")).toBe(true); // The Big 3
  expect(has(s, "SSYUgQd4aML3QHbzWPs5")).toBe(false); // We Want the Room — two WRs, two schools
  expect(has(s, "K59KXsIGcntfLHfaCI9S")).toBe(false); // Homer
  const homer = stateWith([1, 2, 3].map((i) => ({ overall: i * 30, round: i, pos: "DB", school: "Georgia" })));
  expect(has(homer, "K59KXsIGcntfLHfaCI9S")).toBe(true);
  expect(has(homer, "SSYUgQd4aML3QHbzWPs5")).toBe(true);
});

test("pick badges", () => {
  const s = stateWith([
    { overall: 1, pos: "WR", first: "Jeremiah", last: "Smith" },
    { overall: 30, pos: "QB", need: { key: "QB", label: "Crowded Room" } },
    { overall: 70, round: 3, pos: "K" },
    { overall: 199, round: 6, pos: "QB" },
    { overall: 257, round: 7, pos: "TE" },
  ]);
  ["T01Y4CB2op1MiDKMKLxU", "jYanjTO1227Y2YteYDTb", "Qrl603jl0so0VOB34Lan", "yZHafNuBbKiFyNq9zaoT", "wTDpCY54pAIUgDtmk9XK", "YwomRUcf3lJ75GFB91FT", "eruQUZWkizViaKahUqSE", "axVqucIBcZiXDa9Ns6X6"]
    .forEach((id) => expect([id, has(s, id)]).toEqual([id, true]));
  expect(has(s, "sEJIY2E6STRv5J9b2w2c")).toBe(false); // no first-round RB
  // Not the last pick when another comes after it.
  expect(has(stateWith([{ overall: 250, round: 7, pos: "TE" }], { lastPick: { overall: 257, round: 7 } }), "eruQUZWkizViaKahUqSE")).toBe(false);
});

test("position counts", () => {
  const s = stateWith(["OL", "OL", "OL", "DL", "EDGE", "EDGE", "RB", "TE", "TE", "QB", "WR", "LB", "DB"].map((pos, i) => ({ overall: i * 20 + 1, round: Math.min(7, i + 1), pos })));
  ["eBZq1P1nkuGeY5ZsncB4", "lXUbgdJQPd2NcTyggPtV", "aj62W37ZzXnxRnlUAUAg", "LOufBg9GUm0bSx92sqeE", "YYNx1sgad6a0bhw8HGGl"].forEach((id) => expect([id, has(s, id)]).toEqual([id, true]));
});

test("trade badges", () => {
  const future1 = { overall: 1010, round: 1, future: true, year: 2028 };
  const s = stateWith([], { trades: [{ a: "NYJ", b: "BUF", aGot: [{ overall: 40, round: 2 }], bGot: [future1] }] });
  expect(has(s, "JkNs00BfdC2SeJLO7GYw")).toBe(true); // The Future is Now
  expect(has(s, "KoSCJ32nlBZkUr3weeLa")).toBe(false);
  expect(has(s, "QvwMpgPCYqKbaXp6MYa8")).toBe(true); // BUF: AFC
  expect(has(s, "k4XfHVc4qVamqOcGb60A")).toBe(true); // Zero Class
  expect(has(stateWith([]), "k4XfHVc4qVamqOcGb60A")).toBe(false); // never had a deal
  const nfc = stateWith([], { trades: [{ a: "DAL", b: "NYJ", aGot: [{ overall: 3, round: 1 }], bGot: [future1] }] });
  expect(has(nfc, "QvwMpgPCYqKbaXp6MYa8")).toBe(false);
  expect(has(nfc, "KoSCJ32nlBZkUr3weeLa")).toBe(true);
  // In the 2028 draft, its own first-rounders are 2028 firsts.
  const own = stateWith([], { trades: [{ a: "NYJ", b: "DAL", aGot: [{ overall: 40, round: 2 }], bGot: [{ overall: 12, round: 1 }] }] });
  expect(has(own, "JkNs00BfdC2SeJLO7GYw", { year: "2028" })).toBe(true);
  expect(has(own, "JkNs00BfdC2SeJLO7GYw")).toBe(false);
});

test("run and profile badges", () => {
  expect(runBadges({ picks: [], byId: {}, userTeams: [], done: true }, { year: 2028 })).toContain("9CaWtrPkWLxnhjCyGqS8");
  expect(runBadges({ picks: [], byId: {}, userTeams: [], done: false }, { year: 2028 })).not.toContain("9CaWtrPkWLxnhjCyGqS8");
  const teams = Object.fromEntries("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS".split(" ").map((t) => [t, 1]));
  expect(profileBadges({ sims: 100, teams, drafted: { x: 5 }, streak: 30 }).sort()).toEqual(["9pUy2ORBFTjhmIJhU4Rh", "GTm5V8dN8h38iJjX9I5r", "ZvL33nYspbGF8yT0IeV2", "lkgjtb5Gw4FXD7QY4r5d", "qGa6smMXNKNJw53szOHN", "xGyp1KMEYi2lzl3Rd9CL"].sort());
  expect(profileBadges({ sims: 49, teams: {}, drafted: { x: 4 }, streak: 6 })).toEqual([]);
});

test("Armchair Scout only with evaluations", () => {
  const s = stateWith([{ overall: 5, pos: "WR" }]);
  expect(has(s, "p2qew4rKFOybcr1w5XcS")).toBe(false);
  expect(has(s, "p2qew4rKFOybcr1w5XcS", { evaluated: new Set(["p0"]) })).toBe(true);
});
