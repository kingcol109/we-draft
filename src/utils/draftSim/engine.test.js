import {
  buildBoard, initSim, stepCpu, makePick, isUserOnClock, currentPick, findTradeUpOffers, acceptOffer,
  teamHaul, pickValue, letterFor, evaluateProposal, applyProposal, tradeablePicks, pickWorth, pickName, pickByKey, suggestionsFor,
} from "./engine";
import { reactTo, LIVE_ANALYSTS, ANALYSTS, weDraftFacts, statFacts, KENNETH_LINES, MAKALI_LINES, lineText, gradeTake, applyDeskLines, applyDeskLegends, davinSuggestion } from "./analysts";
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
  expect(take.analyst.id).toBe("kenneth");
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
  const personalities = ["kenneth", "pp", "makali", "davin"];
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
  const ctx = { ...deskCtx("all", 0.5), memory: { lastVoice: "kenneth" } };
  const post = reactTo({ ...rutgers, team: "PHI" }, ctx)[1];
  expect(post.analyst.id).toBe("makali");
  expect(MAKALI_LINES.rutgersEagles.lines.some((l) => post.text.startsWith(l.split("{")[0]))).toBe(true);
});

test("Kenneth brings up a big CFBD game; the best one is picked from the log", () => {
  expect(bestGame([
    { opponent: "Ohio", stats: { defensive: { SACKS: "2", TOT: "5" } } },
    { opponent: "Tennessee", stats: { defensive: { SACKS: "4", TFL: "4" } } },
    { opponent: "Kent State", stats: { rushing: { YDS: "60" } } },
  ])).toEqual({ line: "4 sacks", opp: "Tennessee" });
  expect(bestGame([{ opponent: "Ohio", stats: { defensive: { SACKS: "1" } } }])).toBeNull();
  const first = stepCpu(sim({ chaos: 0 })).events.find((e) => e.type === "pick");
  const e = { ...first, pick: { ...first.pick, overall: 9 }, value: 0, fit: null, positionRun: 0, prospect: { ...first.prospect, Position: "EDGE" } };
  const games = { [e.prospect.id]: { line: "4 sacks", opp: "Tennessee" } };
  const kc = ANALYSTS.find((a) => a.id === "kenneth").react(e, { ...deskCtx("all", 0.1), games });
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
    const kc = posts.find((p) => p.analyst.id === "kenneth");
    expect(KENNETH_LINES.firstOverall.lines.map(lineText).some((l) => kc.text.startsWith(l.split("{")[0]))).toBe(true);
    expect(kc.text).not.toMatch(/sitting there/);
  }
  const later = { ...first, pick: { ...first.pick, overall: 3 }, value: 0, fit: null, positionRun: 0, prospect: { ...first.prospect, Position: "WR" } };
  const kenneth = ANALYSTS.find((a) => a.id === "kenneth");
  for (let r = 0; r < 1; r += 0.05) {
    expect(kenneth.react(later, { ...deskCtx("all"), rand: () => r }).text).not.toMatch(/sitting there/);
  }
});

test("proposed trades: the CPU wants more than it gives, then the picks swap", () => {
  const s = { ...sim({ userTeams: ["DDD"] }), chart: { 4: 1800, 5: 1700, 8: 1400, 12: 1100, 1: 3000 } };
  // DDD's No. 4 for AAA's No. 1: not enough.
  expect(evaluateProposal(s, { give: [4], get: [1] }).accept).toBe(false);
  expect(applyProposal(s, { team: "DDD", partner: "AAA", give: [4], get: [1] }).event).toBe(null);
  // No. 4 + No. 8 (3200) for No. 1 (3000 × 1.05 = 3150): done.
  const { state, event } = applyProposal(s, { team: "DDD", partner: "AAA", give: [4, 8], get: [1] });
  expect(state.picks.find((p) => p.overall === 1)).toMatchObject({ owner: "DDD", via: "AAA" });
  expect(state.picks.filter((p) => [4, 8].includes(p.overall)).map((p) => p.owner)).toEqual(["AAA", "AAA"]);
  expect(event).toMatchObject({ type: "trade", to: "DDD", from: "AAA", userInvolved: true });
  expect(event.give.map((p) => p.overall)).toEqual([4, 8]);
  // Only undrafted picks after the clock are tradeable (the one on it too, when it's yours).
  expect(tradeablePicks(state, "DDD").map((p) => p.overall)).toEqual([12]);
  expect(tradeablePicks(state, "DDD", { includeCurrent: true }).map((p) => p.overall)).toEqual([1, 12]);
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

test("kickers and punters: bottom of the board, the user's to take, never the CPU's", () => {
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

test("next year's picks trade at a 10% discount", () => {
  const order = [1, 2, 3, 4].map((n) => ({ Pick: n, Round: 1, Team: `T${n}` }));
  const chart = { 1: 3000, 2: 2600, 3: 2200, 4: 1800 };
  const s = initSim({ order, futureOrder: order, futureYear: 2028, board, chart, userTeams: ["T1"], rounds: 1, seed: 3 });
  const mine = tradeablePicks(s, "T1", { includeCurrent: true });
  const next = mine.find((p) => p.future);
  expect(next).toMatchObject({ year: 2028, number: 1, round: 1, overall: 1001 });
  expect(pickWorth(s, next)).toBe(2700);
  expect(pickName(next)).toBe("2028 R1 · No. 1");
  // T1's 2028 1st (2700) for T4's 2027 1st (1800): they take it, and the pick moves.
  expect(evaluateProposal(s, { give: [1001], get: [4] })).toMatchObject({ give: 2700, get: 1800, accept: true });
  const { state, event } = applyProposal(s, { team: "T1", partner: "T4", give: [1001], get: [4] });
  expect(event).not.toBeNull();
  expect(pickByKey(state, 1001).owner).toBe("T4");
  expect(pickByKey(state, 4).owner).toBe("T1");
});

test("suggestions: best value on the board, then the staff's strong preferences", () => {
  const b = buildBoard([
    { id: "v", Position: "QB", cr: 1 }, { id: "h", Position: "WR", cr: 2 }, { id: "g", Position: "LB", cr: 3 }, { id: "k", Position: "K", cr: 4 },
  ], {}, { h: [{ a: "T1", s: 85, HC: 92 }], g: [{ a: "T1", s: 82, GM: 84, HC: 60 }], v: [{ a: "T1", s: 90, HC: 99 }] });
  const s = initSim({ order: [{ Pick: 1, Round: 1, Team: "T1" }], board: b, userTeams: ["T1"], rounds: 1, seed: 1 });
  const { value, staff } = suggestionsFor(s, "T1");
  expect(value.id).toBe("v");
  // The HC's 99 is on the value pick, so his card is his next favorite.
  expect(staff.map((x) => [x.p.id, x.slot])).toEqual([["h", "HC"], ["g", "GM"]]);
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
