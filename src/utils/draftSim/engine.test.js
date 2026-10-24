import {
  buildBoard, applyMyGrades, initSim, stepCpu, makePick, isUserOnClock, currentPick, findTradeUpOffers, acceptOffer,
  teamHaul, pickValue, letterFor, evaluateProposal, applyProposal, tradeablePicks, pickWorth, pickName, pickByKey, suggestionsFor,
  positionValue, earlyNudge, resolveNeeds, needKeysFor, needPull, specificFit, needFor, SPECIFIC_NEEDS, SPECIFIC_WEIGHT,
} from "./engine";
import { reactTo, LIVE_ANALYSTS, ANALYSTS, weDraftFacts, statFacts, pickVars, ISAAC_LINES, MAKALI_LINES, lineText, gradeTake, applyDeskLines, applyDeskLegends, davinSuggestion, applyPlayerTakes, takeSituation } from "./analysts";
import { bestGame } from "./data";

const TEAMS = ["AAA", "BBB", "CCC", "DDD"];
const POS = ["QB", "WR", "EDGE", "OL", "DB", "RB", "LB", "DL", "TE"];

// 4 teams × 3 rounds, 40 prospects graded in id order.
const order = [1, 2, 3].flatMap((round) => TEAMS.map((t, i) => ({ Pick: (round - 1) * 4 + i + 1, Round: round, Team: t })));
const prospects = Array.from({ length: 40 }, (_, i) => ({
  id: `p${String(i).padStart(2, "0")}`, First: "F", Last: `L${i}`, Position: POS[i % POS.length], School: "S", Slug: `s${i}`,
}));
const grades = Object.fromEntries(prospects.map((p, i) => [p.id, [1 + i * 0.2, 5]]));
const board = buildBoard(prospects, grades, { p10: [{ a: "AAA", s: 95, GM: 95 }] });
const sim = (opts = {}) => initSim({ order, board, seed: 42, rounds: 3, ...opts });

test("board: graded by grade, ungraded last by fit", () => {
  const b = buildBoard([...prospects.slice(0, 3), { id: "zz", Position: "QB" }, { id: "yy", Position: "WR" }], grades, { yy: [{ a: "AAA", s: 80 }] });
  expect(b.map((p) => p.id)).toEqual(["p00", "p01", "p02", "yy", "zz"]);
  expect(b[0].rank).toBe(1);
});

test("my board: their grades re-rank it, community fills the rest", () => {
  // p30's community grade is 7.0; they grade him Early First (1) → into the
  // first-round bucket, behind the community's p00–p02 (ties keep board order).
  const mine = applyMyGrades(board, { p30: 1, p01: 9, nope: 1 });
  expect(mine.slice(0, 4).map((p) => p.id)).toEqual(["p00", "p02", "p30", "p03"]);
  expect(mine.find((p) => p.id === "p30")).toMatchObject({ avg: 1, mine: true, rank: 3, count: 5 });
  expect(mine.find((p) => p.id === "p01")).toMatchObject({ avg: 9, mine: true });
  expect(mine.find((p) => p.id === "p02").mine).toBeUndefined();
  expect(mine.map((p) => p.rank)).toEqual(mine.map((_, i) => i + 1));
  const qbs = mine.filter((p) => p.Position === "QB");
  expect(qbs.map((p) => p.positionRank)).toEqual(qbs.map((_, i) => i + 1));
  // None of theirs on this board → the board untouched.
  expect(applyMyGrades(board, { nope: 1 })).toBe(board);
  expect(applyMyGrades(board)).toBe(board);
});

test("rounds limit the picks; traded picks belong to the new team", () => {
  const s = initSim({ order: order.map((p) => (p.Pick === 2 ? { ...p, Traded: "DDD" } : p)), board, rounds: 2, seed: 1 });
  expect(s.picks).toHaveLength(8);
  expect(s.picks[1]).toMatchObject({ owner: "DDD", via: "BBB", inRound: 2 });
});

test("a CPU-only sim is deterministic and never drafts a player twice", () => {
  const run = () => {
    let s = sim({ chaos: 0 });
    while (!s.done) s = stepCpu(s).state;
    return s.picks.map((p) => p.selection);
  };
  const a = run();
  expect(a).toEqual(run());
  expect(new Set(a).size).toBe(a.length);
  expect(a.every(Boolean)).toBe(true);
});

test("strong staff fit pulls a player up the board", () => {
  // p10 is No. 11 on the board but a 95 fit for AAA, picking 1st.
  const { event } = (() => { const r = stepCpu(sim({ chaos: 0 })); return { event: r.events.find((e) => e.type === "pick") }; })();
  expect(event.team).toBe("AAA");
  expect(["p00", "p10"]).toContain(event.prospect.id);
});

test("the CPU stops for the user's pick", () => {
  let s = sim({ userTeams: ["CCC"], chaos: 0 });
  s = stepCpu(s).state;
  s = stepCpu(s).state;
  expect(isUserOnClock(s)).toBe(true);
  expect(stepCpu(s).state).toBe(s);
  const { state, event } = makePick(s, board[30].id);
  expect(event).toMatchObject({ isUser: true, team: "CCC", value: 3 - 31 });
  expect(state.idx).toBe(3);
});

test("accepting a trade swaps the picks", () => {
  const s = sim({ userTeams: ["AAA"] });
  const offer = { team: "CCC", give: [3, 7], ratio: 1.1, value: 0, target: board[0] };
  const { state, event } = acceptOffer(s, offer);
  expect(currentPick(state)).toMatchObject({ owner: "CCC", via: "AAA" });
  expect(state.picks.filter((p) => p.owner === "AAA").map((p) => p.overall)).toEqual([3, 5, 7, 9]);
  expect(event).toMatchObject({ type: "trade", from: "AAA", to: "CCC", userInvolved: true });
});

test("trade-up offers pay at least the pick's chart value", () => {
  const s = { ...sim({ userTeams: ["AAA"] }), chart: {} };
  findTradeUpOffers(s, { threshold: 0 }).forEach((o) => {
    expect(o.value).toBeGreaterThanOrEqual(pickValue({}, 1));
    expect(o.give.every((n) => n > 1)).toBe(true);
  });
});

test("grades: letters and a team's haul", () => {
  expect(letterFor(1.2)).toBe("A+");
  expect(letterFor(0)).toBe("B");
  expect(letterFor(-5)).toBe("D");
  let s = sim({ chaos: 0 });
  while (!s.done) s = stepCpu(s).state;
  const h = teamHaul(s, "BBB");
  expect(h.rows).toHaveLength(3);
  expect(h.letter).toMatch(/^[A-D][+-]?$/);
  const take = gradeTake(h, { teamName: (t) => t, nickname: (t) => t, rand: () => 0.1 });
  expect(take.analyst.id).toBe("isaac");
  expect(take.text).not.toMatch(/[{}]/);
  expect(gradeTake({ ...h, rows: [], letter: "—" }, { rand: () => 0.1 })).toBeNull();
});

test("the desk: We-Draft always posts first, Davin's live", () => {
  const { events } = stepCpu(sim({ chaos: 0 }));
  const ctx = { teamName: (t) => t, nickname: (t) => t, staff: {}, rand: () => 0.1 };
  const posts = reactTo(events.find((e) => e.type === "pick"), ctx);
  expect(posts[0].analyst.id).toBe("wedraft");
  expect(posts[0].text).toMatch(/^PICK 1 · AAA/);
  expect(LIVE_ANALYSTS.map((a) => a.id)).toContain("davin");
});

test("board: official class rank wins, position ranks count within the position", () => {
  const b = buildBoard([
    { id: "a", Position: "QB", cr: 3 }, { id: "b", Position: "WR", cr: 1 }, { id: "c", Position: "QB", cr: 2 }, { id: "d", Position: "QB" },
  ], { d: [1, 9] });
  expect(b.map((p) => p.id)).toEqual(["b", "c", "a", "d"]);
  expect(b.map((p) => p.positionRank)).toEqual([1, 1, 2, 3]);
});

const deskCtx = (chatter, r = 0.99) => ({ teamName: (t) => t, nickname: (t) => t, staff: {}, season: 2026, chatter, memory: {}, rand: () => r });

test("personalities: always on the user's pick, per desk chatter otherwise", () => {
  // A quiet mid-round pick (No. 1 always gets a take — tested below).
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  const cpu = { ...first, pick: { ...first.pick, overall: 3 }, value: 0 };
  const ids = (ctx, e) => reactTo(e, ctx).map((p) => p.analyst.id);
  const personalities = ["isaac", "pp", "makali", "davin"];
  expect(ids(deskCtx("mine"), cpu)).toEqual(["wedraft"]);
  // Every pick (the default): We-Draft.com, then exactly one personality.
  for (let r = 0; r < 1; r += 0.1) {
    const out = ids(deskCtx("all", r), cpu);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("wedraft");
    expect(personalities).toContain(out[1]);
  }
  expect(ids(deskCtx("some", 0.99), cpu)).toEqual(["wedraft"]);
  expect(ids(deskCtx("mine"), { ...cpu, isUser: true })).toHaveLength(2);
  // Makali on Rutgers players and Eagles picks, almost always.
  const rutgers = { ...cpu, prospect: { ...cpu.prospect, School: "Rutgers" } };
  const hits = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8].filter((r) => ids(deskCtx("all", r), rutgers)[1] === "makali").length;
  expect(hits).toBeGreaterThanOrEqual(5);
  const ctx = { ...deskCtx("all", 0.5), memory: { lastVoice: "isaac" } };
  const post = reactTo({ ...rutgers, team: "PHI" }, ctx)[1];
  expect(post.analyst.id).toBe("makali");
  expect(MAKALI_LINES.rutgersEagles.lines.some((l) => post.text.startsWith(l.split("{")[0]))).toBe(true);
});

test("Isaac brings up a big CFBD game; the best one is picked from the log", () => {
  expect(bestGame([
    { opponent: "Ohio", stats: { defensive: { SACKS: "2", TOT: "5" } } },
    { opponent: "Tennessee", stats: { defensive: { SACKS: "4", TFL: "4" } } },
    { opponent: "Kent State", stats: { rushing: { YDS: "60" } } },
  ])).toEqual({ line: "4 sacks", opp: "Tennessee" });
  expect(bestGame([{ opponent: "Ohio", stats: { defensive: { SACKS: "1" } } }])).toBeNull();
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  const e = { ...first, pick: { ...first.pick, overall: 9 }, value: 0, fit: null, positionRun: 0, prospect: { ...first.prospect, Position: "EDGE" } };
  const games = { [e.prospect.id]: { line: "4 sacks", opp: "Tennessee" } };
  const kc = ANALYSTS.find((a) => a.id === "isaac").react(e, { ...deskCtx("all", 0.1), games });
  expect(kc.text).toMatch(/4 sacks/);
  expect(kc.text).toMatch(/Tennessee/);
});

test("We-Draft.com facts: national leader, community traits, position rank", () => {
  const p = {
    ...board[0], First: "Colin", Last: "Simmons", Position: "EDGE", positionRank: 1, strengths: ["Bend", "First Step"], weaknesses: ["Run Defense"],
    stats: { leaders: [{ key: "sacks", title: "Sacks", v: 10, rank: 1, tied: false }], lines: {} },
  };
  const e = { type: "pick", pick: { overall: 3, round: 1 }, team: "AAA", prospect: p, value: 2, fit: null, positionRun: 1, positionOrdinal: 1 };
  expect(weDraftFacts(e, deskCtx("some")).map((f) => f.cat)).toEqual(expect.arrayContaining(["traitsBoth", "posRankTop"]));
  expect(statFacts(e, deskCtx("some")).map((f) => f.cat)).toEqual(["leaderFirst"]);
  // We-Draft.com: board rank, then one fact.
  const post = reactTo(e, { ...deskCtx("mine"), rand: () => 0 })[0];
  expect(post.lines).toHaveLength(2);
  expect(post.lines[0]).toMatch(/We-Draft\.com board|board rank/);
  // Dr. PP Johnson reads the numbers.
  const pp = ANALYSTS.find((a) => a.id === "pp").react(e, { ...deskCtx("all"), rand: () => 0 });
  expect(pp.lines[0]).toBe("Simmons' 10 sacks in 2026 are the most in college football.");
});

test("No. 1 overall gets first-pick wording, never 'sitting there a few picks'", () => {
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  expect(first.pick.overall).toBe(1);
  for (let r = 0; r < 1; r += 0.05) {
    const posts = reactTo(first, { ...deskCtx("some"), year: "2027", rand: () => r });
    const kc = posts.find((p) => p.analyst.id === "isaac");
    expect(ISAAC_LINES.firstOverall.lines.map(lineText).some((l) => kc.text.startsWith(l.split("{")[0]))).toBe(true);
    expect(kc.text).not.toMatch(/sitting there/);
  }
  const later = { ...first, pick: { ...first.pick, overall: 3 }, value: 0, fit: null, positionRun: 0, prospect: { ...first.prospect, Position: "WR" } };
  const isaac = ANALYSTS.find((a) => a.id === "isaac");
  for (let r = 0; r < 1; r += 0.05) {
    expect(isaac.react(later, { ...deskCtx("all"), rand: () => r }).text).not.toMatch(/sitting there/);
  }
});

test("proposed trades: the CPU wants more than it gives, then the picks swap", () => {
  const s = { ...sim({ userTeams: ["DDD"] }), chart: { 4: 1800, 5: 1700, 8: 1400, 12: 1100, 1: 3000 } };
  // DDD's No. 8 for AAA's No. 5: not enough.
  expect(evaluateProposal(s, { give: [8], get: [5] }).accept).toBe(false);
  expect(applyProposal(s, { team: "DDD", partner: "AAA", give: [8], get: [5] }).event).toBe(null);
  // No. 8 + No. 12 (2500) for No. 5 (1700 × 1.05 = 1785): done.
  const { state, event } = applyProposal(s, { team: "DDD", partner: "AAA", give: [8, 12], get: [5] });
  expect(state.picks.find((p) => p.overall === 5)).toMatchObject({ owner: "DDD", via: "AAA" });
  expect(state.picks.filter((p) => [8, 12].includes(p.overall)).map((p) => p.owner)).toEqual(["AAA", "AAA"]);
  expect(event).toMatchObject({ type: "trade", to: "DDD", from: "AAA", userInvolved: true });
  expect(event.give.map((p) => p.overall)).toEqual([8, 12]);
  // Only undrafted picks after the clock are tradeable.
  expect(tradeablePicks(state, "DDD").map((p) => p.overall)).toEqual([4, 5]);
  // The pick on the clock: AAA's GM loves a player there (fit 95), so the
  // chart alone (No. 4 + No. 8 = 3200 for No. 1's 3150) isn't enough.
  expect(evaluateProposal(s, { give: [4, 8], get: [1] }).accept).toBe(false);
});

test("admin-edited desk lines replace a situation's built-ins, and reset back", () => {
  const before = MAKALI_LINES.any.lines;
  applyDeskLines({ makali: { any: ["{last} is my guy."] } });
  expect(MAKALI_LINES.any.lines).toEqual(["{last} is my guy."]);
  expect(MAKALI_LINES.rutgers.lines.length).toBeGreaterThan(1);
  applyDeskLines({});
  expect(MAKALI_LINES.any.lines).toBe(before);
});

test("coach and GM names fill in as variables", () => {
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  applyDeskLines({ makali: { any: ["{hc} and {gmLast} just got their guy."] } });
  const ctx = { ...deskCtx("all", 0.99), staff: { [first.team]: { HC: { n: "Kevin Stefanski" }, GM: { n: "Andrew Berry Jr." } } } };
  const e = { ...first, pick: { ...first.pick, overall: 9 }, value: 0, prospect: { ...first.prospect, Position: "WR" } };
  expect(ANALYSTS.find((a) => a.id === "makali").react(e, ctx).text).toBe("Kevin Stefanski and Berry just got their guy.");
  applyDeskLines({});
});

test("Davin: loves FSU, compares good picks to FSU legends", () => {
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  const davin = ANALYSTS.find((a) => a.id === "davin");
  const base = { ...first, team: "NYJ", pick: { ...first.pick, overall: 9, round: 1 }, value: 0 };
  const fsuQb = { ...base, prospect: { ...first.prospect, First: "Ashton", Last: "Daniels", School: "Florida State", Position: "QB" } };
  const nextLine = davin.react(fsuQb, { ...deskCtx("all", 0.1), nickname: () => "Jets" }).text;
  expect(nextLine).toMatch(/Jameis Winston|Seminole|Florida State|Doak/);
  expect(davin.weight(fsuQb)).toBeGreaterThan(10);
  // A good non-FSU RB pick (rand under 0.5) → the FSU legend at RB.
  const rb = { ...base, pick: { ...base.pick, round: 2 }, prospect: { ...first.prospect, School: "Oregon", Position: "RB" } };
  expect(davin.react(rb, deskCtx("all", 0.1)).text).toMatch(/Dalvin Cook|Greg Jones|Jashaun Corbin|Tim Riggins|Burt Reynolds/);
  for (let r = 0; r < 1; r += 0.05) expect(davin.react(rb, deskCtx("all", r)).text).not.toMatch(/[{}]/);
});

test("a line with a blank variable is skipped; {legend} fills in any Davin line", () => {
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  const e = { ...first, pick: { ...first.pick, overall: 40, round: 2 }, value: -30, prospect: { ...first.prospect, School: "Oregon", Position: "LB" } };
  const davin = ANALYSTS.find((a) => a.id === "davin");
  applyDeskLines({ davin: { nonsense: ["Has {legend} been picked yet?"], take: ["Has {legend} been picked yet?"] } });
  for (let r = 0; r < 1; r += 0.1) expect(davin.react(e, deskCtx("all", r)).text).toMatch(/^Has \S.* been picked yet\?$/);
  // {gm} with no GM on file: the other line runs instead.
  applyDeskLines({ makali: { any: ["{gm} nailed it.", "Love it."] } });
  const cpu = { ...e, value: 0 };
  for (let r = 0.6; r < 1; r += 0.1) expect(ANALYSTS.find((a) => a.id === "makali").react(cpu, deskCtx("all", r)).text).toBe("Love it.");
  applyDeskLines({});
});

test("kickers and punters: bottom of the board, never a CPU pick early on", () => {
  const b = buildBoard([{ id: "k", Position: "K", cr: 1 }, { id: "a", Position: "QB", cr: 2 }, { id: "p", Position: "P", cr: 3 }, { id: "b", Position: "WR", cr: 4 }]);
  expect(b.map((p) => p.id)).toEqual(["a", "b", "k", "p"]);
  expect(b.find((p) => p.id === "a").rank).toBe(1);
  // A CPU-only sim never takes one.
  let s = initSim({ order: [1, 2, 3, 4].map((n) => ({ Pick: n, Round: 1, Team: `T${n}` })), board: b, rounds: 1, seed: 5 });
  while (!s.done) s = stepCpu(s).state;
  expect(s.picks.map((p) => s.byId[p.selection]?.Position).filter(Boolean)).toEqual(expect.not.arrayContaining(["K", "P"]));
  // The user can, and it's graded as neither value nor reach.
  const u = initSim({ order: [{ Pick: 1, Round: 1, Team: "ME" }], board: b, userTeams: ["ME"], rounds: 1, seed: 5 });
  const { event } = makePick(u, "k");
  expect(event.prospect.Position).toBe("K");
  expect(event.value).toBe(0);
});

test("next year's picks trade at a 15% discount", () => {
  const order = [1, 2, 3, 4].map((n) => ({ Pick: n, Round: 1, Team: `T${n}` }));
  const chart = { 1: 3000, 2: 2600, 3: 2200, 4: 1800 };
  const s = initSim({ order, futureOrder: order, futureYear: 2028, board, chart, userTeams: ["T1"], rounds: 1, seed: 3 });
  const mine = tradeablePicks(s, "T1", { includeCurrent: true });
  const next = mine.find((p) => p.future);
  expect(next).toMatchObject({ year: 2028, number: 1, round: 1, overall: 1001 });
  expect(pickWorth(s, next)).toBe(2550);
  expect(pickName(next)).toBe("2028 R1 · No. 1");
  // T1's 2028 1st (2550) for T4's 2027 1st (1800): they take it, and the pick moves.
  expect(evaluateProposal(s, { give: [1001], get: [4] })).toMatchObject({ give: 2550, get: 1800, accept: true });
  const { state, event } = applyProposal(s, { team: "T1", partner: "T4", give: [1001], get: [4] });
  expect(event).not.toBeNull();
  expect(pickByKey(state, 1001).owner).toBe("T4");
  expect(pickByKey(state, 4).owner).toBe("T1");
});

test("suggestions: best value on the board, then the staff's favorite", () => {
  const b = buildBoard([
    { id: "v", Position: "QB", cr: 1 }, { id: "h", Position: "WR", cr: 2 }, { id: "g", Position: "LB", cr: 3 }, { id: "k", Position: "K", cr: 4 },
  ], {}, { h: [{ a: "T1", s: 85, HC: 92 }], g: [{ a: "T1", s: 82, GM: 84, HC: 60 }], v: [{ a: "T1", s: 90, HC: 99 }] });
  const s = initSim({ order: [{ Pick: 1, Round: 1, Team: "T1" }], board: b, userTeams: ["T1"], rounds: 1, seed: 1 });
  const { value, coach } = suggestionsFor(s, "T1");
  expect(value.id).toBe("v");
  // The HC's 99 is on the value pick, so his card is his next favorite.
  expect([coach.p.id, coach.slot]).toEqual(["h", "HC"]);
});

test("Davin's favorites are editable: positions, ANY, and his joke pick", () => {
  applyDeskLegends([{ name: "Thad Castle", positions: ["LB"], school: "Blue Mountain State" }, { name: "Burt Reynolds", positions: ["ANY"], school: "Florida State" }], [{ name: "Blue Mountain State", logo: "", color1: "#000" }]);
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  const davin = ANALYSTS.find((a) => a.id === "davin");
  const rb = { ...first, pick: { ...first.pick, overall: 40, round: 2 }, value: 2, prospect: { ...first.prospect, School: "Oregon", Position: "RB" } };
  // An RB comparison can only be the ANY favorite.
  expect(davin.react(rb, deskCtx("all", 0.1)).text).toMatch(/Burt Reynolds/);
  const joke = davinSuggestion("NYJ", { ...deskCtx("all", 0.1), nickname: () => "Jets" });
  expect(["Thad Castle", "Burt Reynolds"]).toContain(joke.legend.name);
  expect(joke.text).not.toMatch(/[{}]/);
  applyDeskLegends([], []);
});

test("position value comes from real drafts: QBs and EDGEs jump in round 1, LBs slide, it washes out late", () => {
  expect(positionValue("QB", 10)).toBeLessThan(0.7);
  expect(positionValue("EDGE", 10)).toBeLessThan(0.9);
  expect(positionValue("LB", 10)).toBeGreaterThan(1.05);
  ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"].forEach((pos) => {
    expect(positionValue(pos, 200)).toBeGreaterThan(0.85);
    expect(positionValue(pos, 200)).toBeLessThan(1.15);
  });
  expect(positionValue("ZZ", 10)).toBe(1);
});

test("the early nudge is a factor, not a rule: tiny for a WR at No. 1, big for a kicker in round 1, never a bonus", () => {
  expect(earlyNudge("WR", 1)).toBeLessThan(1.5);
  expect(earlyNudge("K", 30)).toBeGreaterThan(earlyNudge("TE", 5));
  expect(earlyNudge("QB", 1)).toBe(0);
  for (let n = 1; n <= 257; n += 16) ["QB", "WR", "RB", "K", "P"].forEach((pos) => expect(earlyNudge(pos, n)).toBeGreaterThanOrEqual(0));
});

// Pick 1 carries the engine's usual noise, so it's a favorite, not a lock.
test("a WR at the top of the board is still the most likely first overall pick", () => {
  const b = buildBoard([
    { id: "wr", Position: "WR", cr: 1 }, { id: "ol", Position: "OL", cr: 2 }, { id: "qb", Position: "QB", cr: 3 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, Position: POS[i % POS.length], cr: 4 + i })),
  ]);
  const firsts = {};
  for (let seed = 1; seed <= 200; seed++) {
    const id = stepCpu(initSim({ order: [{ Pick: 1, Round: 1, Team: "T1" }], board: b, rounds: 1, seed })).state.picks[0].selection;
    firsts[id] = (firsts[id] || 0) + 1;
  }
  expect(Object.entries(firsts).sort((x, y) => y[1] - x[1])[0][0]).toBe("wr");
});

test("over a full draft the CPU takes a kicker or punter late, never early, never two for one team", () => {
  const teams = Array.from({ length: 32 }, (_, i) => `T${String(i).padStart(2, "0")}`);
  const full = Array.from({ length: 7 * 32 }, (_, i) => ({ Pick: i + 1, Round: Math.floor(i / 32) + 1, Team: teams[i % 32] }));
  const b = buildBoard([
    ...Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, Position: POS[i % POS.length], cr: i + 1 })),
    ...["K", "K", "K", "K", "P", "P", "P"].map((Position, i) => ({ id: `s${i}`, Position })),
  ]);
  let s = initSim({ order: full, board: b, rounds: 7, seed: 9 });
  while (!s.done) s = stepCpu(s).state;
  const specials = s.picks.filter((p) => ["K", "P"].includes(s.byId[p.selection]?.Position));
  expect(specials.length).toBeGreaterThan(0);
  specials.forEach((p) => expect(p.overall).toBeGreaterThanOrEqual(59));
  const owners = specials.map((p) => `${p.owner}-${s.byId[p.selection].Position}`);
  expect(new Set(owners).size).toBe(owners.length);
});

// ── Team needs ──
// { QB: "Upgrade Needed" } → the stored shape, { QB: { labels: [...] } }.
const needsOf = (team, map) => ({ [team]: resolveNeeds(Object.fromEntries(Object.entries(map).map(([k, l]) => [k, { labels: [l] }]))) });

test("needs: the admin's labels and notes, known positions and labels only", () => {
  const r = resolveNeeds({
    QB: { labels: ["Aging Talent", "Expiring Contract"], note: "He turns 38" }, WR: { labels: [], note: "Only two under contract" },
    TE: { labels: ["Nope"] }, OL: { labels: ["Upgrade Needed"] }, RB: "Extreme Need",
  });
  expect(r.QB).toEqual({ labels: ["Aging Talent", "Expiring Contract"], note: "He turns 38" });
  expect(r.WR).toEqual({ labels: ["Set"], note: "Only two under contract" });
  expect(r.TE.labels).toEqual(["Set"]);
  expect(r.OL).toBeUndefined();
  expect(r.RB).toBeUndefined();
});

test("needs: OL and DB fill their sub-position, or half of each without one", () => {
  expect(needKeysFor({ Position: "OL", subPosition: "OT" })).toEqual([{ key: "OT", share: 1 }]);
  expect(needKeysFor({ Position: "DB" })).toEqual([{ key: "CB", share: 0.5 }, { key: "S", share: 0.5 }]);
  expect(needKeysFor({ Position: "DL" })).toEqual([{ key: "IDL", share: 1 }]);
  expect(needKeysFor({ Position: "K" })).toEqual([]);
});

test("needs: Upgrade Needed pulls hardest, depth waits for later rounds, a crowded room pushes away", () => {
  const s = initSim({ order, board, needs: needsOf("AAA", { QB: "Upgrade Needed", WR: "Upgrade Wanted", RB: "Depth Needed", TE: "Crowded Room", LB: "Set" }) });
  const qb = { Position: "QB", rank: 5 };
  expect(needPull(s, "AAA", qb, 5)).toBe(1);
  expect(needPull(s, "AAA", { Position: "WR", rank: 5 }, 5)).toBeLessThan(1);
  expect(needPull(s, "AAA", { Position: "RB", rank: 5 }, 1)).toBeLessThan(0.01);
  expect(needPull(s, "AAA", { Position: "RB", rank: 150 }, 150)).toBeGreaterThan(0.3);
  expect(needPull(s, "AAA", { Position: "TE", rank: 5 }, 5)).toBeLessThan(0);
  expect(needPull(s, "AAA", { Position: "LB", rank: 5 }, 5)).toBe(0);
  expect(needPull(s, "BBB", qb, 5)).toBe(0);
  // Once the team drafts for it, the need stops pulling.
  expect(needPull({ ...s, needFilled: { AAA: { QB: 1 } } }, "AAA", qb, 40)).toBe(0);
});

test("needs settle a close call at No. 1: the team that needs a QB takes him over the top WR", () => {
  const b = buildBoard([
    { id: "wr", Position: "WR", cr: 1 }, { id: "ol", Position: "OL", cr: 2 }, { id: "qb", Position: "QB", cr: 3 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, Position: POS[i % POS.length], cr: 4 + i })),
  ]);
  const firsts = (needs) => {
    const out = {};
    for (let seed = 1; seed <= 100; seed++) {
      const id = stepCpu(initSim({ order: [{ Pick: 1, Round: 1, Team: "T1" }], board: b, needs, rounds: 1, seed })).state.picks[0].selection;
      out[id] = (out[id] || 0) + 1;
    }
    return out;
  };
  const needsQb = firsts(needsOf("T1", { QB: "Upgrade Needed", WR: "Set" }));
  const needsWr = firsts(needsOf("T1", { QB: "Set", WR: "Upgrade Needed" }));
  expect(needsQb.qb).toBeGreaterThan(50);
  expect(needsWr.wr).toBeGreaterThan(50);
});

test("needs: a team that needs a corner takes the corner, not the safety ahead of him", () => {
  const b = buildBoard([
    { id: "saf", Position: "DB", subPosition: "S", cr: 1 }, { id: "cb", Position: "DB", subPosition: "CB", cr: 2 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, Position: POS[i % POS.length], cr: 3 + i })),
  ]);
  let cb = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const s = initSim({ order: [{ Pick: 1, Round: 1, Team: "T1" }], board: b, needs: needsOf("T1", { CB: "Upgrade Needed", S: "Crowded Room" }), rounds: 1, seed });
    if (stepCpu(s).state.picks[0].selection === "cb") cb++;
  }
  expect(cb).toBeGreaterThanOrEqual(35);
});

test("needs reach the desk: the pick event carries the need, and the lines fill in", () => {
  const s = initSim({ order, board, needs: { AAA: resolveNeeds({ QB: { labels: ["Aging Talent"], note: "Their starter turns 38" } }) } });
  const qb = board.find((p) => p.Position === "QB");
  const { event } = makePick(s, qb.id);
  expect(event.need).toEqual({ key: "QB", label: "Aging Talent", note: "Their starter turns 38" });
  const ev = { ...event, pick: { ...event.pick, overall: 9, round: 1 } };
  const isaac = ANALYSTS.find((a) => a.id === "isaac");
  for (let r = 0; r < 0.7; r += 0.1) {
    const text = isaac.react(ev, deskCtx("all", r)).text;
    expect(text).not.toMatch(/[{}]/);
  }
  // Needs are the analysts' — We-Draft.com sticks to the board.
  expect(weDraftFacts(ev, deskCtx("all")).map((f) => f.cat).filter((c) => /^need/.test(c))).toEqual([]);
  // A need the team already drafted for isn't a need any more.
  const after = makePick({ ...s, needFilled: { AAA: { QB: 1 } } }, qb.id).event;
  expect(after.need).toBeNull();
});

// ── Specific needs ──
const spec = (key) => SPECIFIC_NEEDS.find((s) => s.key === key);

test("specific fit: wanted strengths, ruled out by a listed weakness or the size limits", () => {
  const back = { Position: "RB", strengths: ["Receiving Ability", "Pass Protection"], weaknesses: [] };
  expect(specificFit(spec("RB3"), back)).toBe(1);
  expect(specificFit(spec("RB3"), { ...back, strengths: ["Receiving Ability"] })).toBe(1);
  expect(specificFit(spec("RB3"), { ...back, strengths: ["Downhill"] })).toBe(0);
  expect(specificFit(spec("RB3"), { ...back, weaknesses: ["Pass Protection"] })).toBe(0);
  expect(specificFit(spec("RB3"), { ...back, Position: "WR" })).toBe(0);
  const slot = { Position: "WR", strengths: ["Separation", "Short Routes"], weaknesses: [] };
  expect(specificFit(spec("SLOTWR"), { ...slot, height: 72 })).toBe(1);
  expect(specificFit(spec("SLOTWR"), { ...slot, height: 75 })).toBe(0);
  // Unknown size doesn't rule anyone out.
  expect(specificFit(spec("SLOTWR"), slot)).toBe(1);
});

test("specific fit: Frame counts for a prospect who's big for his position; DBs go by sub-position", () => {
  const tes = [240, 245, 250, 255, 262].map((w, i) => ({ id: `te${i}`, Position: "TE", weight: w, height: 74 + i }));
  // No wanted strength listed, but big for a tight end → Frame → fits.
  expect(specificFit(spec("BLOCKTE"), { ...tes[4], strengths: ["Hands"], weaknesses: [] }, tes)).toBe(1);
  expect(specificFit(spec("BLOCKTE"), { ...tes[0], strengths: ["Hands"], weaknesses: [] }, tes)).toBe(0);
  const db = { Position: "DB", strengths: ["Man Technique", "Hip Fluidity"], weaknesses: [] };
  expect(specificFit(spec("SLOTCB"), { ...db, subPosition: "CB" })).toBe(1);
  expect(specificFit(spec("SLOTCB"), { ...db, subPosition: "S" })).toBe(0);
  expect(specificFit(spec("SLOTCB"), db)).toBe(0.5);
});

test("suggestions: a need pick for the team's needs, and every card says which need it fills", () => {
  const b = buildBoard([
    { id: "wr", Position: "WR", cr: 1 }, { id: "ol", Position: "OL", cr: 2 }, { id: "cb", Position: "DB", subPosition: "CB", cr: 3 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, Position: ["RB", "LB", "TE"][i % 3], cr: 4 + i })),
  ]);
  const s = initSim({ order: [{ Pick: 5, Round: 1, Team: "T1" }], board: b, rounds: 1, needs: { T1: resolveNeeds({ CB: { labels: ["Upgrade Needed"], note: "Lost both starters" }, WR: { labels: ["Upgrade Wanted"] } }) } });
  const { value, need, needs } = suggestionsFor(s, "T1");
  expect(value.id).toBe("wr");
  expect(need.id).toBe("cb");
  expect(needs.cb).toEqual({ key: "CB", label: "Upgrade Needed", note: "Lost both starters" });
  expect(needs.wr.label).toBe("Upgrade Wanted");
  // No needs → no need pick.
  expect(suggestionsFor(initSim({ order: [{ Pick: 5, Round: 1, Team: "T1" }], board: b, rounds: 1 }), "T1").need).toBeNull();
});

test("a specific need pulls the same share of its position's pull for every role", () => {
  const pull = (key, p) => needPull(initSim({ order, board, needs: { AAA: resolveNeeds({ [key]: { labels: ["Upgrade Needed"] } }) } }), "AAA", p, 10);
  const nose = { Position: "DL", rank: 10, strengths: ["Run Defense"], weaknesses: [], weight: 320 };
  const nickel = { Position: "DB", subPosition: "CB", rank: 10, strengths: ["Man Technique"], weaknesses: [] };
  expect(pull("NOSE", nose) / pull("IDL", nose)).toBeCloseTo(SPECIFIC_WEIGHT);
  expect(pull("SLOTCB", nickel) / pull("CB", nickel)).toBeCloseTo(SPECIFIC_WEIGHT);
  expect(SPECIFIC_WEIGHT).toBeLessThan(1);
});

test("a specific need pulls only the prospects who fit it, and fills once one is drafted", () => {
  const needs = { AAA: resolveNeeds({ RB: { labels: ["Set"] }, RB3: { labels: ["Upgrade Needed"] } }) };
  const s = initSim({ order, board, needs });
  const receiver = { Position: "RB", rank: 10, strengths: ["Receiving Ability", "Pass Protection"], weaknesses: [] };
  const plodder = { Position: "RB", rank: 10, strengths: ["Downhill", "Contact Balance"], weaknesses: [] };
  expect(needPull(s, "AAA", receiver, 10)).toBeCloseTo(SPECIFIC_WEIGHT);
  expect(needPull(s, "AAA", plodder, 10)).toBe(0);
  expect(needFor(s, "AAA", receiver)).toEqual({ key: "RB3", label: "Upgrade Needed", note: "" });
  expect(needFor(s, "AAA", plodder)).toBeNull();
  // Draft him → filled.
  const rb = board.find((p) => p.Position === "RB");
  const withHim = { ...s, byId: { ...s.byId, [rb.id]: { ...rb, strengths: receiver.strengths, weaknesses: [] } } };
  const { state } = makePick(withHim, rb.id);
  expect(state.needFilled.AAA.RB3).toBe(1);
  expect(needPull(state, "AAA", receiver, 40)).toBe(0);
});

test("the desk says the specific need in words", () => {
  const s = initSim({ order, board, needs: { AAA: resolveNeeds({ SLOTCB: { labels: ["Upgrade Needed"], note: "" } }) } });
  const db = board.find((p) => p.Position === "DB");
  const withHim = { ...s, byId: { ...s.byId, [db.id]: { ...db, subPosition: "CB", strengths: ["Man Technique", "Transitions"], weaknesses: [] } } };
  const { event } = makePick(withHim, db.id);
  expect(event.need.key).toBe("SLOTCB");
  expect(pickVars({ ...event, pick: { ...event.pick, overall: 9 } }, deskCtx("all")).needPos).toBe("slot corner");
});

test("suggestions remember what the team drafted: no second QB, from the board or the coach", () => {
  const b = buildBoard([
    { id: "qb1", Position: "QB", cr: 1 }, { id: "qb2", Position: "QB", cr: 2 }, { id: "wr", Position: "WR", cr: 3 }, { id: "lb", Position: "LB", cr: 4 },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, Position: ["RB", "TE", "OL"][i % 3], cr: 5 + i })),
  ], {}, { qb2: [{ a: "T1", s: 95, HC: 95 }], lb: [{ a: "T1", s: 80, DC: 80 }] });
  const order = [{ Pick: 1, Round: 1, Team: "T1" }, { Pick: 2, Round: 1, Team: "T1" }];
  const needs = { T1: resolveNeeds({ QB: { labels: ["Upgrade Needed"] }, LB: { labels: ["Upgrade Wanted"] } }) };
  const s = makePick(initSim({ order, board: b, userTeams: ["T1"], rounds: 1, seed: 1, needs }), "qb1").state;
  const { value, need, coach, topNeed } = suggestionsFor(s, "T1");
  expect(value.Position).not.toBe("QB");
  expect(need.id).toBe("lb");
  // The HC's 95 is on the second QB — not suggested; nobody else he likes.
  expect(coach).toBeNull();
  expect(topNeed).toEqual({ key: "LB", label: "Upgrade Wanted" });
});

test("trades and doubling up go by need: a corner then a safety isn't doubling up", () => {
  const s0 = initSim({ order, board, needs: {} });
  const cb = board.find((p) => p.Position === "DB");
  const after = makePick({ ...s0, byId: { ...s0.byId, [cb.id]: { ...cb, subPosition: "CB" } } }, cb.id).state;
  const scoreOf = (p) => needPull(after, "AAA", p, 10);
  expect(after.needFilled.AAA.CB).toBe(1);
  expect(after.needFilled.AAA.S || 0).toBe(0);
  expect(scoreOf({ Position: "DB", subPosition: "S", rank: 5 })).toBe(0);
});

test("grades weigh needs: a pick that fills an Upgrade Needed grades better, and needs met count", () => {
  const needs = { AAA: resolveNeeds({ QB: { labels: ["Upgrade Needed"] }, WR: { labels: ["Upgrade Needed"] } }) };
  const s = initSim({ order, board, needs, rounds: 3 });
  const qb = board.find((p) => p.Position === "QB");
  const filled = makePick(s, qb.id).state;
  const h = teamHaul(filled, "AAA");
  expect(h.rows[0].need).toEqual({ key: "QB", label: "Upgrade Needed", note: "" });
  expect(h.needs.met.map((n) => n.key)).toEqual(["QB"]);
  expect(h.needs.open.map((n) => n.key)).toEqual(["WR"]);
  const plain = teamHaul(makePick(initSim({ order, board, rounds: 3 }), qb.id).state, "AAA");
  expect(h.rows[0].score).toBeGreaterThan(plain.rows[0].score);
});

test("trades: a team that loves who's there is hard to move; one that doesn't gets called", () => {
  const b = buildBoard([
    { id: "qb", Position: "QB", cr: 1 }, { id: "wr", Position: "WR", cr: 2 },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, Position: ["RB", "LB", "TE", "OL"][i % 4], cr: 3 + i })),
  ], {}, { qb: [{ a: "T5", s: 95, HC: 95 }] });
  // T5 at No. 6 loves the QB (fit + need); T1 is on the clock at No. 1.
  const order = [1, 2, 3, 4, 5, 6].map((n) => ({ Pick: n, Round: 1, Team: n === 6 ? "T5" : `T${n === 1 ? 1 : n + 10}` }))
    .concat([{ Pick: 40, Round: 2, Team: "T5" }, { Pick: 70, Round: 3, Team: "T5" }]);
  const callerNeeds = { T5: resolveNeeds({ QB: { labels: ["Upgrade Needed"] } }) };
  const offersWhen = (ownerNeeds) => findTradeUpOffers(initSim({ order, board: b, rounds: 3, seed: 1, needs: { ...callerNeeds, ...ownerNeeds } }), { threshold: 0.9 });
  // T1 doesn't love anyone there → T5 calls.
  expect(offersWhen({}).map((o) => o.team)).toContain("T5");
  // T1 needs a QB too → it asks more than the chart allows; no deal.
  expect(offersWhen({ T1: resolveNeeds({ QB: { labels: ["Upgrade Needed"] } }) }).map((o) => o.team)).not.toContain("T5");
});

test("the recap knows every trade: what each side got and gave, next year's picks too", () => {
  const order = [1, 2, 3, 4].map((n) => ({ Pick: n, Round: 1, Team: `T${n}` }));
  const s = initSim({ order, futureOrder: order, futureYear: 2028, board, chart: { 1: 3000, 2: 2600, 3: 2200, 4: 1800 }, userTeams: ["T1"], rounds: 1, seed: 3 });
  const { state } = applyProposal(s, { team: "T1", partner: "T4", give: [1001], get: [4] });
  const mine = teamHaul(state, "T1").trades;
  expect(mine).toHaveLength(1);
  expect(mine[0].partner).toBe("T4");
  expect(mine[0].got.map(pickName)).toEqual([pickName(pickByKey(s, 4))]);
  expect(mine[0].gave.map(pickName)).toEqual(["2028 R1 · No. 1"]);
  expect(teamHaul(state, "T4").trades[0]).toMatchObject({ partner: "T1" });
  expect(teamHaul(state, "T2").trades).toEqual([]);
});

test("Kenneth: his written take on the player, by situation; quiet without one", () => {
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  const base = { ...first, pick: { ...first.pick, overall: 20 }, value: 0, need: null };
  const kenneth = ANALYSTS.find((a) => a.id === "kenneth");
  expect(takeSituation({ ...base, value: 8 })).toBe("steal");
  expect(takeSituation({ ...base, value: -8 })).toBe("reach");
  expect(takeSituation({ ...base, need: { key: "QB", label: "Depth Needed", note: "" } })).toBe("depth");
  expect(takeSituation(base)).toBe("normal");
  applyPlayerTakes({});
  expect(kenneth.weight(base, deskCtx("all"))).toBe(0);
  expect(kenneth.react(base, deskCtx("all"))).toBeNull();
  applyPlayerTakes({ [base.prospect.id]: { normal: ["Normal take on {last} for the {nick}."], steal: ["Steal take."], depth: ["  "] } });
  expect(kenneth.react({ ...base, value: 8 }, deskCtx("all")).text).toBe("Steal take.");
  expect(kenneth.react(base, deskCtx("all")).text).toBe(`Normal take on ${base.prospect.Last} for the ${base.team}.`);
  // No reach (or only blank depth) lines → his normal lines.
  expect(kenneth.react({ ...base, value: -8 }, deskCtx("all")).text).toMatch(/^Normal take/);
  expect(kenneth.react({ ...base, need: { key: "QB", label: "Depth Needed", note: "" } }, deskCtx("all")).text).toMatch(/^Normal take/);
  expect(kenneth.weight(base, deskCtx("all"))).toBeGreaterThan(0);
  expect(kenneth.weight({ ...base, pick: { ...base.pick, overall: 1 } }, deskCtx("all"))).toBe(0);
  expect(kenneth.react({ type: "trade" }, deskCtx("all"))).toBeNull();
  applyPlayerTakes({});
});
