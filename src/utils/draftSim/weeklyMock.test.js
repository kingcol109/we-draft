import { buildBoard } from "./engine";
import { acceptOffer } from "./engine";
import { WEEKLY_TRADES_BY_YEAR, slotKeys, runWeeklyMock, weeklyFromSim, weeklyNotes, teamWeek, teamChanges, tradesFromSim, nextYearNeeds, qbEligibleTeams, nextYearLabel, mockPicksFrom, weeklyPicksFromMock, nextYearRules, qbTeamsOf, carryTrades } from "./weeklyMock";
import { pickNote } from "./pickNotes";

const TEAMS = ["AAA", "BBB", "CCC", "DDD"];
const POS = ["QB", "WR", "EDGE", "OL", "DB", "RB", "LB", "DL", "TE"];
const order = [1, 2, 3].flatMap((round) => TEAMS.map((t, i) => ({ Pick: (round - 1) * 4 + i + 1, Round: round, Team: t })));
const board = buildBoard(Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, First: "F", Last: `L${i}`, Position: POS[i % POS.length], School: "S", Slug: `s${i}`, cr: i + 1 })));
const data = { order, futureOrder: [], futureYear: null, board, chart: {}, staff: {}, needs: {} };

test("slots: a pick is its round, original team and which of that team's picks it is", () => {
  const keys = slotKeys([
    { overall: 3, round: 1, original: "NYJ" }, { overall: 10, round: 1, original: "DAL" },
    { overall: 40, round: 2, original: "NYJ" }, { overall: 33, round: 2, original: "NYJ" },
  ]);
  expect(keys).toEqual({ 3: "1-NYJ-1", 10: "1-DAL-1", 33: "2-NYJ-1", 40: "2-NYJ-2" });
});

test("weekly mock: every pick made by the CPU, saved by slot", () => {
  const sim = runWeeklyMock(data, { seed: 3, rounds: 3 });
  expect(sim.done).toBe(true);
  expect(sim.variance).toBe("less");
  const w = weeklyFromSim(sim, "2027");
  expect(w.rounds).toBe(3);
  expect(w.picks).toHaveLength(12);
  expect(w.picks.every((p) => p.player && p.slot)).toBe(true);
  expect(w.picks[0]).toMatchObject({ slot: "1-AAA-1", overall: 1, round: 1, original: "AAA" });
});

test("trades: who moved up, to which pick, and every pick each side got — next year's too", () => {
  const s = runWeeklyMock(data, { seed: 3, rounds: 3 });
  // CCC moves up to No. 1 with its 3rd and 7th.
  const fresh = { ...s, trades: [] };
  const { state } = acceptOffer({ ...fresh, idx: 0, picks: fresh.picks.map((p) => ({ ...p, selection: null, owner: p.original })) },
    { team: "CCC", give: [3, 7], ratio: 1.1, value: 0, target: board[0] });
  const withFuture = { ...state, trades: [...state.trades, { a: "BBB", b: "DDD", aGot: [{ overall: 10002, number: 2, year: "2028", future: true, round: 1, original: "DDD" }], bGot: [{ overall: 6, round: 2, original: "BBB" }] }] };
  expect(tradesFromSim(withFuture, "2027")).toEqual([
    { up: "CCC", down: "AAA", at: 1, upGot: [{ year: "2027", round: 1, original: "AAA", overall: 1 }],
      downGot: [{ year: "2027", round: 1, original: "CCC", overall: 3 }, { year: "2027", round: 2, original: "CCC", overall: 7 }] },
    { up: "DDD", down: "BBB", at: 6, upGot: [{ year: "2027", round: 2, original: "BBB", overall: 6 }],
      downGot: [{ year: "2028", round: 1, original: "DDD", overall: null }] },
  ]);
});

test("mock editor round trip: slots ride along, and edited picks get theirs back", () => {
  const w = weeklyFromSim(runWeeklyMock(data, { seed: 3, rounds: 2 }), "2027");
  const mock = mockPicksFrom(w.picks);
  expect(mock[1]).toMatchObject({ pickNumber: 1, round: 1, originalTeam: "AAA", currentTeam: w.picks[0].owner, slot: "1-AAA-1" });
  // The admin gives No. 2 to DDD and swaps in a different player.
  mock[2] = { ...mock[2], currentTeam: "DDD", tradedFrom: "BBB", selection: { id: "x", First: "New", Last: "Guy", Position: "QB", School: "S", Slug: "ng", Eligible: "2027" } };
  const back = weeklyPicksFromMock(mock);
  expect(back[1]).toEqual({ slot: "1-BBB-1", overall: 2, round: 1, original: "BBB", owner: "DDD", player: { id: "x", First: "New", Last: "Guy", Position: "QB", School: "S", Slug: "ng" }, note: "" });
  expect(back.map((p) => p.slot)).toEqual(w.picks.map((p) => p.slot));
});

test("notes: every pick gets one, no holes, PFF only near the top with snaps (credited), team history when it's there", () => {
  const sim = runWeeklyMock(data, { seed: 3, rounds: 3 });
  let seed = 9;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const p0 = sim.pickEvents[0].prospect;
  const history = {
    years: [2000], teams: [sim.pickEvents[0].team], schools: ["S"],
    picks: [[2010, 2, 40, 0, p0.Position, 0, "Old Guy"], [2015, 3, 80, 0, p0.Position, 0, "Older Guy"]],
  };
  const ctx = {
    teamName: (t) => t, nickname: (t) => t, staff: {}, season: 2026, year: "2027", history, rand,
    pff: { [p0.id]: { rk: 2, sn: 400, pos: "ED" }, [sim.pickEvents[1].prospect.id]: { rk: 2, sn: 90, pos: "ED" }, [sim.pickEvents[2].prospect.id]: { rk: 40, sn: 500, pos: "ED" } },
  };
  const notes = weeklyNotes(sim, ctx);
  expect(Object.keys(notes)).toHaveLength(12);
  Object.values(notes).forEach((n) => { expect(n.length).toBeGreaterThan(20); expect(n).not.toMatch(/[{}]|undefined/); });
  // Low snaps or outside the top: never PFF.
  expect(notes[2]).not.toMatch(/Pro Football Focus|PFF/);
  expect(notes[3]).not.toMatch(/Pro Football Focus|PFF/);
  // The first pick's facts, every one: PFF (credited) and the team's history with his school at his position are among them.
  const all = new Set();
  for (let k = 0; k < 40; k++) all.add(pickNote(sim.pickEvents[0], { ...ctx, used: {} }));
  const text = [...all].join(" ");
  expect(text).toMatch(/Pro Football Focus/);
  // The team's history: in every one of his notes, and last.
  [...all].forEach((n) => expect(n).toMatch(/since 2000[^.]*\.$|\d{4}\)?\.$/));
  expect(text).toMatch(/3rd .* since 2000|since 2000.*3rd/);
});

test("notes: a GM or head coach in a staff-fit line links to his staff page; an OC doesn't", () => {
  const sim = runWeeklyMock(data, { seed: 3, rounds: 1 });
  const e = sim.pickEvents[0];
  let seed = 5;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const ctx = (slot) => ({
    teamName: (t) => t, nickname: (t) => t, season: 2026, year: "2027", rand,
    staff: { [e.team]: { [slot]: { n: "Darren Mougey", id: "darren-mougey" } } },
  });
  const notes = (slot) => {
    const ev = { ...e, fit: { s: 92, [slot]: 92 }, prospect: { ...e.prospect, strengths: [], weaknesses: [], count: 0, stats: null } };
    return Array.from({ length: 30 }, () => pickNote(ev, { ...ctx(slot), used: {} })).join(" ");
  };
  expect(notes("GM")).toMatch(/\[Darren Mougey\]\(\/staff\/darren-mougey\)/);
  expect(notes("OC")).not.toMatch(/\]\(\/staff/);
  expect(notes("OC")).toMatch(/Darren Mougey/);
});

test("team page: each pick with the same slot last week, its number and who had it; its trades", () => {
  const prev = { picks: [
    { slot: "1-NYJ-1", overall: 14, owner: "NYJ", player: { Last: "Ringo" } },
    { slot: "1-DAL-1", overall: 20, owner: "DAL", player: { Last: "Smith" } },
  ] };
  const latest = { picks: [
    { slot: "1-NYJ-1", overall: 9, round: 1, original: "NYJ", owner: "NYJ", player: { Last: "Moore" } },
    { slot: "1-DAL-1", overall: 22, round: 1, original: "DAL", owner: "NYJ", player: { Last: "Cole" } },
    { slot: "2-NYJ-1", overall: 41, round: 2, original: "NYJ", owner: "BUF", player: { Last: "Lacy" } },
  ], trades: [
    { up: "NYJ", down: "DAL", at: 22, upGot: [{ year: "2027", round: 1, original: "DAL", overall: 22 }], downGot: [{ year: "2027", round: 2, original: "NYJ", overall: 41 }] },
    { up: "BUF", down: "MIA", at: 30, upGot: [], downGot: [] },
  ] };
  const w = teamWeek(latest, prev, "NYJ");
  expect(w.picks.map((p) => [p.overall, p.prev?.overall, p.prev?.owner])).toEqual([[9, 14, "NYJ"], [22, 20, "DAL"]]);
  expect(w.trades).toEqual([{ up: true, with: "DAL", at: 22, got: [{ year: "2027", round: 1, original: "DAL", overall: 22 }], gave: [{ year: "2027", round: 2, original: "NYJ", overall: 41 }] }]);
  expect(teamWeek(latest, prev, "DAL").trades[0]).toMatchObject({ up: false, with: "NYJ", got: [{ overall: 41 }] });
  // No last week: every pick is new.
  expect(teamWeek(latest, null, "NYJ").picks.every((p) => p.prev === null)).toBe(true);
});

test("what changed: players new to the team's picks, gone from them, moved a round; position counts that changed", () => {
  const pl = (id, Position) => ({ id, First: "A", Last: id, Position });
  const prev = { picks: [
    { overall: 10, round: 1, owner: "NYJ", player: pl("a", "QB") },
    { overall: 42, round: 2, owner: "NYJ", player: pl("b", "WR") },
    { overall: 75, round: 3, owner: "NYJ", player: pl("c", "OL") },
    { overall: 11, round: 1, owner: "MIA", player: pl("z", "QB") },
  ] };
  const latest = { picks: [
    { overall: 9, round: 1, owner: "NYJ", player: pl("b", "WR") },
    { overall: 41, round: 2, owner: "NYJ", player: pl("d", "WR") },
    { overall: 74, round: 3, owner: "NYJ", player: pl("c", "OL") },
    { overall: 90, round: 3, owner: "NYJ", player: null },
  ] };
  const c = teamChanges(latest, prev, "NYJ");
  expect(c.added).toEqual([{ player: pl("d", "WR"), round: 2, overall: 41 }]);
  expect(c.dropped).toEqual([{ player: pl("a", "QB"), round: 1 }]);
  expect(c.moved).toEqual([{ player: pl("b", "WR"), from: 2, to: 1 }]);
  expect(c.positions).toEqual([{ pos: "QB", was: 1, now: 0 }, { pos: "WR", was: 1, now: 2 }]);
  // No last week: nothing to compare, so no section.
  expect(teamChanges(latest, null, "NYJ")).toBeNull();
  expect(teamChanges(latest, { picks: [] }, "NYJ")).toBeNull();
});

test("a need a year on: up a tier with nothing drafted for it; a starter fills it, a contributor holds it, depth only answers depth", () => {
  expect(nextYearLabel("Upgrade Wanted", null)).toBe("Upgrade Needed");
  expect(nextYearLabel("Depth Needed", null)).toBe("Upgrade Wanted");
  expect(nextYearLabel("Expiring Contract", null)).toBe("Upgrade Needed");
  expect(nextYearLabel("Aging Talent", null)).toBe("Upgrade Needed");
  expect(nextYearLabel("Crowded Room", null)).toBe("Crowded Room");
  expect(nextYearLabel("Set", null)).toBe("Set");
  expect(nextYearLabel("Upgrade Needed", "starter")).toBe("Set");
  expect(nextYearLabel("Upgrade Needed", "contributor")).toBe("Upgrade Needed");
  expect(nextYearLabel("Aging Talent", "contributor")).toBe("Upgrade Wanted");
  expect(nextYearLabel("Depth Needed", "depth")).toBe("Set");
  expect(nextYearLabel("Upgrade Wanted", "depth")).toBe("Upgrade Needed");
  expect(nextYearLabel("Crowded Room", "depth")).toBe("Crowded Room");
  // A backup QB need stays a backup need; any QB answers it.
  expect(nextYearLabel("Depth Needed", null, "QB")).toBe("Depth Needed");
  expect(nextYearLabel("Depth Needed", "depth", "QB")).toBe("Set");
  expect(nextYearLabel("Upgrade Wanted", "depth", "QB")).toBe("Upgrade Needed");
});

test("next year's needs: a 6th-round QB doesn't answer an upgrade; a 1st-rounder does; OL/DB by sub-position", () => {
  const needs = {
    NYJ: { QB: { labels: ["Upgrade Wanted"], note: "" }, WR: { labels: ["Depth Needed"], note: "" }, CB: { labels: ["Upgrade Needed"], note: "" }, OT: { labels: ["Aging Talent", "Depth Needed"], note: "x" } },
    DAL: { QB: { labels: ["Upgrade Wanted"], note: "" } },
    CIN: { QB: { labels: ["Depth Needed"], note: "" } },
    NYG: { QB: { labels: ["Depth Needed"], note: "" } },
    MIA: { QB: { labels: ["Upgrade Needed"], note: "" }, EDGE: { labels: ["Upgrade Wanted"], note: "" }, S: { labels: ["Upgrade Wanted"], note: "" } },
  };
  const board = [{ id: "ot", First: "A", Last: "B", Position: "OL", subPosition: "OT" }];
  const picks = [
    { owner: "NYJ", round: 6, player: { id: "q", Position: "QB" } },
    { owner: "NYJ", round: 5, player: { id: "w", Position: "WR" } },
    { owner: "NYJ", round: 3, player: { id: "ot", Position: "OL" } },
    { owner: "MIA", round: 1, player: { id: "q2", Position: "QB" } },
    // A 2nd-round QB doesn't count: the need still moves up.
    { owner: "DAL", round: 2, player: { id: "q3", Position: "QB" } },
    { owner: "CIN", round: 7, player: { id: "q4", Position: "QB" } },
    { owner: "MIA", round: 3, player: { id: "e1", Position: "EDGE" } },
    { owner: "MIA", round: 4, player: { id: "e2", Position: "EDGE" } },
    // No sub-position: half a share toward CB and S — still answers each.
    { owner: "MIA", round: 2, player: { id: "db", Position: "DB" } },
  ];
  const { needs: out, changes } = nextYearNeeds(needs, picks, board);
  expect(out.NYJ.QB.labels).toEqual(["Upgrade Needed"]);
  expect(out.NYJ.WR.labels).toEqual(["Set"]);
  expect(out.NYJ.CB.labels).toEqual(["Upgrade Needed"]);
  // A 3rd-round tackle: the aging starter eases to a wanted upgrade, the depth is answered (Set drops out beside it).
  expect(out.NYJ.OT).toEqual({ labels: ["Upgrade Wanted"], note: "x" });
  expect(out.MIA.QB.labels).toEqual(["Set"]);
  expect(out.DAL.QB.labels).toEqual(["Upgrade Needed"]);
  // Backup QB needs: answered by a late QB (CIN), or still just a backup need (NYG).
  expect(out.CIN.QB.labels).toEqual(["Set"]);
  expect(out.NYG.QB.labels).toEqual(["Depth Needed"]);
  // Two contributors count as a starter.
  expect(out.MIA.EDGE.labels).toEqual(["Set"]);
  expect(out.MIA.S.labels).toEqual(["Set"]);
  expect(changes.find((c) => c.team === "NYJ" && c.key === "QB")).toEqual({ team: "NYJ", key: "QB", from: ["Upgrade Wanted"], to: ["Upgrade Needed"], cover: "depth" });
});

test("light notes (the next class's): board rank, grade, traits, stats, staff fit, PFF — no need, value, pick spot or team history", () => {
  const sim = runWeeklyMock(data, { seed: 3, rounds: 3 });
  let seed = 9;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const p0 = sim.pickEvents[0].prospect;
  const history = { years: [2000], teams: [sim.pickEvents[0].team], schools: [p0.School || "S"], picks: [[2010, 2, 40, 0, p0.Position, 0, "Old Guy"]] };
  const ctx = { teamName: (t) => t, nickname: (t) => t, staff: {}, season: 2026, year: "2028", history, rand, light: true, pff: { [p0.id]: { rk: 1, sn: 500, pos: "ED" } } };
  const notes = weeklyNotes(sim, ctx);
  const all = Object.values(notes);
  expect(all.length).toBe(sim.pickEvents.length);
  all.forEach((n) => {
    expect(n.length).toBeGreaterThan(0);
    // No pick number ("at 12", "at No. 12"), value or reach, need, or the team's draft history.
    expect(n).not.toMatch(/\bat (No\. )?\d+\b|spots|value|steal|reach|need|since \d{4}|first-round|pipeline|\{/i);
  });
  // PFF (credited, top of the list) can still come up.
  expect(notes[sim.pickEvents[0].pick.overall]).toMatch(/Pro Football Focus|PFF/);
});

test("the next class's mock runs with no trades", () => {
  const sim = runWeeklyMock(data, { seed: 3, rounds: 3, trades: WEEKLY_TRADES_BY_YEAR[2028] });
  expect(sim.trades).toEqual([]);
  expect(sim.picks.every((p) => p.selection)).toBe(true);
});

test("QB-eligible teams: a need, want or Set at QB, and no first-round QB in this year's mock", () => {
  const needs = {
    ARI: { QB: { labels: ["Upgrade Needed"] } }, CLE: { QB: { labels: ["Upgrade Wanted"] } }, PHI: { QB: { labels: ["Set"] } },
    PIT: { QB: { labels: ["Aging Talent", "Upgrade Needed"] } }, BUF: { QB: { labels: ["Crowded Room"] } }, NYG: { QB: { labels: ["Depth Needed"] } },
    SEA: { WR: { labels: ["Upgrade Needed"] } },
  };
  const picks = [
    { owner: "ARI", round: 1, player: { Position: "QB" } },
    { owner: "CLE", round: 2, player: { Position: "QB" } },
    { owner: "PIT", round: 1, player: { Position: "WR" } },
  ];
  expect(qbEligibleTeams(needs, picks)).toEqual(["CLE", "PHI", "PIT"]);
});

test("the next class's mock: only the eligible teams take a QB", () => {
  const sim0 = runWeeklyMock(data, { seed: 3, rounds: 3 });
  const qbTeams = [...new Set(sim0.picks.filter((p) => sim0.byId[p.selection]?.Position === "QB").map((p) => p.owner))];
  // Without the rule the same draft does take QBs.
  expect(qbTeams.length).toBeGreaterThan(0);
  const sim = runWeeklyMock(data, { seed: 3, rounds: 3, qbTeams: [] });
  expect(sim.picks.filter((p) => sim.byId[p.selection]?.Position === "QB")).toEqual([]);
  const one = qbTeams[0];
  const sim2 = runWeeklyMock(data, { seed: 3, rounds: 3, qbTeams: [one] });
  const theirs = sim2.picks.filter((p) => sim2.byId[p.selection]?.Position === "QB");
  // Only that team, and only one.
  expect(theirs.length).toBeLessThanOrEqual(1);
  expect(theirs.every((p) => p.owner === one)).toBe(true);
});

test("next class's position rules: rounds 1–2 a need, want or Set not taken in this year's round 1; a round-3 QB only while one's still needed", () => {
  const needs = {
    AAA: { QB: { labels: ["Upgrade Needed"] }, WR: { labels: ["Upgrade Wanted"] }, RB: { labels: ["Depth Needed"] }, TE: { labels: ["Set"] }, LB: { labels: ["Crowded Room"] } },
    BBB: { QB: { labels: ["Depth Needed"] }, OT: { labels: ["Upgrade Needed"] }, IOL: { labels: ["Upgrade Needed"] } },
    CCC: { QB: { labels: ["Set"] }, CB: { labels: ["Aging Talent"] } },
  };
  const picks = [
    { owner: "AAA", round: 1, player: { id: "q", Position: "QB" } },
    { owner: "AAA", round: 2, player: { id: "w", Position: "WR" } },
    // An OL with no sub-position answers both halves.
    { owner: "BBB", round: 1, player: { id: "o", Position: "OL" } },
  ];
  const rules = nextYearRules(needs, picks);
  expect(rules.AAA).toEqual({ early: ["WR", "TE"], qbLate: false });
  expect(rules.BBB).toEqual({ early: [], qbLate: true });
  expect(rules.CCC).toEqual({ early: ["QB", "CB"], qbLate: false });
  expect(qbTeamsOf(rules)).toEqual(["BBB", "CCC"]);
});

test("next class's mock with position rules: rounds 1–2 only eligible positions, never one twice, a round-3 QB only with qbLate", () => {
  const keyOf = (p) => (p.Position === "OL" ? "OL" : p.Position === "DB" ? "DB" : p.Position);
  const posRules = {
    AAA: { early: ["WR", "EDGE"], qbLate: false }, BBB: { early: ["RB", "LB", "TE"], qbLate: true },
    CCC: { early: ["QB", "IDL"], qbLate: false }, DDD: { early: ["WR", "LB"], qbLate: false },
  };
  const sim = runWeeklyMock(data, { seed: 5, rounds: 3, trades: "off", posRules, qbTeams: qbTeamsOf(posRules) });
  expect(sim.picks.every((p) => p.selection)).toBe(true);
  const early = { WR: "WR", EDGE: "EDGE", RB: "RB", LB: "LB", TE: "TE", QB: "QB", IDL: "DL" };
  TEAMS.forEach((t) => {
    const mine = sim.picks.filter((p) => p.owner === t).map((p) => ({ round: p.round, p: sim.byId[p.selection] }));
    mine.filter((m) => m.round <= 2).forEach((m) => expect(posRules[t].early.map((k) => early[k])).toContain(m.p.Position));
    mine.filter((m) => m.round === 3 && m.p.Position === "QB").forEach(() => expect(posRules[t].qbLate).toBe(true));
    const keys = mine.map((m) => keyOf(m.p));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

test("this year's trades of next year's picks carry onto its order", () => {
  const next = [{ Pick: 1, Round: 1, Team: "AAA" }, { Pick: 2, Round: 1, Team: "BBB" }, { Pick: 5, Round: 2, Team: "AAA" }, { Pick: 6, Round: 2, Team: "BBB", Traded: "CCC" }];
  const trades = [
    { up: "CCC", down: "AAA", at: 3, upGot: [{ year: "2027", round: 1, original: "AAA", overall: 1 }], downGot: [{ year: "2028", round: 1, original: "AAA", overall: null }] },
    { up: "DDD", down: "CCC", at: 9, upGot: [{ year: "2027", round: 3, original: "CCC", overall: 9 }], downGot: [{ year: "2028", round: 2, original: "BBB", overall: null }, { year: "2029", round: 1, original: "DDD", overall: null }] },
    { up: "BBB", down: "CCC", at: 10, upGot: [{ year: "2027", round: 3, original: "DDD", overall: 10 }], downGot: [{ year: "2028", round: 1, original: "BBB", overall: null }] },
  ];
  const { order: moved, carried } = carryTrades(next, trades, 2028);
  expect(moved.map((p) => p.Traded || p.Team)).toEqual(["AAA", "CCC", "AAA", "CCC"]);
  // AAA "got" the pick it already held, and CCC the BBB 2nd it already had (real order), so only BBB's 1st moved; 2029 picks are ignored.
  expect(carried).toEqual([{ round: 1, original: "BBB", from: "BBB", to: "CCC" }]);
  expect(next[1].Traded).toBeUndefined();
});

