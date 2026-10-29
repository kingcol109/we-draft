import { starLinks, starVars, roomWord } from "./stars";
import { teamStars } from "../teamNeedSuggestions";
import { ANALYSTS, ISAAC_LINES } from "./analysts";
import { buildBoard, initSim, makePick, resolveNeeds, evaluateProposal, CPU_ACCEPT_RATIO, askRatio, pickInterest, counterOffer, pickOddity } from "./engine";

const stars = {
  BUF: [{ n: "Josh Allen", k: "QB", t: "franchise" }, { n: "James Cook", k: "RB", t: "difference" }],
  NYJ: [{ n: "Garrett Wilson", k: "WR", t: "difference" }],
  CLE: [{ n: "Myles Garrett", k: "EDGE", t: "franchise" }],
};
const p = (Position, extra = {}) => ({ id: "x", First: "KJ", Last: "Duff", Position, rank: 20, ...extra });

test("star links: a weapon or protection for the star QB, lanes for the star back, a second star in the room", () => {
  expect(starLinks(stars, "BUF", p("WR"), 1).map((l) => l.kind)).toEqual(["weapon"]);
  expect(starLinks(stars, "BUF", p("OL"), 2).map((l) => l.kind)).toEqual(["protect", "lanes"]);
  expect(starLinks(stars, "BUF", p("QB"), 1)).toEqual([{ kind: "qbShade", star: stars.BUF[0] }]);
  // A later-round backup QB isn't worth a word.
  expect(starLinks(stars, "BUF", p("QB"), 4)).toEqual([]);
  expect(starLinks(stars, "NYJ", p("WR"), 1)).toEqual([{ kind: "pair", star: stars.NYJ[0] }]);
  // Pass rushers: edges and DL tagged as pass rushers, with the star edge.
  expect(starLinks(stars, "CLE", p("EDGE"), 1)[0].kind).toBe("rush");
  expect(starLinks(stars, "CLE", p("DL", { roles: ["RUSHDL"] }), 1)[0].kind).toBe("rush");
  expect(starLinks(stars, "CLE", p("DL"), 1)).toEqual([]);
  // No stars, nothing to say.
  expect(starLinks({}, "NYJ", p("WR"), 1)).toEqual([]);
  expect(starLinks(undefined, "NYJ", p("WR"), 1)).toEqual([]);
  expect(starVars({ star: { n: "Odell Beckham Jr." } }, p("WR"))).toEqual({ star: "Odell Beckham Jr.", starLast: "Beckham", room: "receiver room" });
  expect(roomWord(p("EDGE"))).toBe("pass rush");
});

test("team stars: Franchise and Difference Maker players where they play now", () => {
  const rosters = [{ abbr: "BUF", players: [
    { id: 1, n: "Josh Allen", pos: "QB" }, { id: 2, n: "James Cook", pos: "HB" }, { id: 3, n: "Backup", pos: "QB" }, { id: 4, n: "Gone", pos: "WR", off: true },
  ] }];
  const tags = { 1: { talent: "franchise" }, 2: { talent: "difference", roles: ["RB3"] }, 3: { talent: "average" }, 4: { talent: "franchise" } };
  expect(teamStars(rosters, tags)).toEqual({ BUF: [{ n: "Josh Allen", k: "QB", t: "franchise" }, { n: "James Cook", k: "RB", t: "difference", ro: ["RB3"] }] });
});

test("the desk names the team's stars", () => {
  const isaac = ANALYSTS.find((a) => a.id === "isaac");
  const ctx = { teamName: (t) => t, nickname: () => "Bills", staff: {}, season: 2026, chatter: "all", memory: {}, rand: () => 0.1, stars };
  const e = { type: "pick", team: "BUF", value: 0, fit: null, positionRun: 0, pick: { overall: 20, round: 1 }, prospect: { ...p("WR"), First: "Garrett", Last: "Wilson" } };
  const text = isaac.react(e, ctx).text;
  expect(ISAAC_LINES.starWeapon.lines.some((l) => text === l.replace("{nick}", "Bills").replace("{star}", "Josh Allen").replace("{starLast}", "Allen").replace("{player}", "Garrett Wilson").replace("{last}", "Wilson").replace("{n}", "20"))).toBe(true);
  // A first-round QB behind Josh Allen, every time.
  const qb = isaac.react({ ...e, prospect: p("QB") }, { ...ctx, memory: {}, rand: () => 0.95 }).text;
  expect(qb).toMatch(/Allen/);
});

test("a pick fills his position's need and his role's", () => {
  const b = buildBoard([{ id: "echoles", Position: "DL", cr: 1, roles: ["RUSHDL", "RUNDL"] }, ...Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, Position: "WR", cr: 2 + i }))]);
  const s = initSim({ order: [{ Pick: 1, Round: 1, Team: "NYJ" }, { Pick: 33, Round: 2, Team: "NYJ" }], board: b, userTeams: ["NYJ"], rounds: 2, seed: 1,
    needs: { NYJ: resolveNeeds({ IDL: { labels: ["Upgrade Wanted"] }, RUSHDL: { labels: ["Upgrade Needed"] } }) } });
  const after = makePick(s, "echoles").state;
  expect(after.needFilled.NYJ).toMatchObject({ IDL: 1, RUSHDL: 1 });
});

test("a trade's shortfall counts what the CPU really wants", () => {
  const b = buildBoard(Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, Position: "WR", cr: 1 + i })));
  const s = initSim({ order: [{ Pick: 1, Round: 1, Team: "AAA" }, { Pick: 2, Round: 1, Team: "BBB" }, { Pick: 40, Round: 2, Team: "AAA" }, { Pick: 41, Round: 2, Team: "BBB" }], board: b, userTeams: ["BBB"], rounds: 2, seed: 1 });
  // A lowball for the pick on the clock: short by what it really asks.
  const v = evaluateProposal(s, { give: [41], get: [1] });
  expect(v.accept).toBe(false);
  expect(v.short).toBeGreaterThan(0);
  // It likes no one, so what it asks is the discounted price.
  expect(v.give + v.short).toBeCloseTo(v.get * askRatio(CPU_ACCEPT_RATIO, 0), -1);
  // The team on the clock likes no one here (no needs, no fits, a flat
  // board): it takes a little under the chart to move back.
  const back = evaluateProposal(s, { give: [2], get: [1] });
  expect(back.give).toBeLessThan(back.get);
  expect(back.accept).toBe(true);
});

test("asking price: a premium for a player a team loves, a discount when it likes no one", () => {
  expect(askRatio(1.05, null)).toBe(1.05);
  expect(askRatio(1.05, 1)).toBeCloseTo(1.3);
  expect(askRatio(1.05, 0)).toBeCloseTo(0.9);
  expect(askRatio(1.05, 0.6)).toBeCloseTo(1.2);
});

test("the desk doesn't call a QB-needy team's trade up a reach", () => {
  const isaac = ANALYSTS.find((a) => a.id === "isaac");
  const ctx = { teamName: (t) => t, nickname: (t) => ({ NYJ: "Jets", LV: "Raiders" }[t] || t), city: () => "New York", staff: {}, memory: {}, rand: () => 0.5 };
  const e = { type: "pick", team: "NYJ", value: -30, fit: null, positionRun: 0, need: { key: "QB", label: "Upgrade Needed", note: "" },
    pick: { overall: 8, round: 1, tradeUp: { from: "LV", give: [{ overall: 15 }] } }, prospect: { ...p("QB"), rank: 38 } };
  const text = isaac.react(e, ctx).text;
  expect(ISAAC_LINES.tradeUpQb.lines.map((l) => l.split("{")[0]).some((start) => text.startsWith(start))).toBe(true);
  // Without the need, it's the usual reach take.
  const reach = isaac.react({ ...e, need: null }, { ...ctx, memory: {} }).text;
  expect(ISAAC_LINES.tradeUpReach.lines.map((l) => l.split("{")[0]).some((start) => reach.startsWith(start))).toBe(true);
});

test("trading back: a team that wants the user's pick gives more for it, one that's cool asks a bargain", () => {
  const b = buildBoard(Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, Position: "WR", cr: 1 + i })));
  const order = [{ Pick: 5, Round: 1, Team: "USR" }, { Pick: 12, Round: 1, Team: "CPU" }, { Pick: 44, Round: 2, Team: "USR" }, { Pick: 51, Round: 2, Team: "CPU" }];
  const sim = (needs) => initSim({ order, board: b, userTeams: ["USR"], rounds: 2, seed: 1, needs });
  const keen = sim({ CPU: resolveNeeds({ WR: { labels: ["Upgrade Needed"] } }) });
  const cool = sim({ CPU: resolveNeeds({ WR: { labels: ["Crowded Room"] } }) });
  const level = (st) => ["cool", "interested", "eager"].indexOf(pickInterest(st, "CPU"));
  expect(level(keen)).toBeGreaterThan(level(cool));
  // The same deal — their No. 12 + No. 51 for the user's No. 5 — is easier to land with the keen team.
  const deal = { give: [5], get: [12, 51] };
  expect(evaluateProposal(keen, deal).short).toBeLessThan(evaluateProposal(cool, deal).short);
});

test("get offer: the partner fills the open side with a deal it would sign", () => {
  const b = buildBoard(Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, Position: "WR", cr: 1 + i })));
  const order = [{ Pick: 3, Round: 1, Team: "CPU" }, { Pick: 9, Round: 1, Team: "USR" }, { Pick: 20, Round: 1, Team: "CPU" }, { Pick: 41, Round: 2, Team: "USR" }, { Pick: 52, Round: 2, Team: "CPU" }, { Pick: 73, Round: 3, Team: "USR" }];
  const s = initSim({ order, board: b, userTeams: ["USR"], rounds: 3, seed: 1 });
  // Asking for its pick on the clock: the user's package it wants.
  const ask = counterOffer(s, { team: "USR", partner: "CPU", give: [], get: [] });
  expect(ask.get[0]).toBe(3);
  expect(ask.give[0]).toBe(9);
  expect(evaluateProposal(s, ask).accept).toBe(true);
  // The user's next pick first: a trade down — No. 9 for their No. 20 and more.
  const down = counterOffer({ ...s, idx: 1 }, { team: "USR", partner: "CPU" });
  expect(down.give).toEqual([9]);
  expect(down.get[0]).toBe(20);
  expect(evaluateProposal({ ...s, idx: 1 }, down).accept).toBe(true);
  // Offering it a pick: what it gives back still gets a yes.
  const back = counterOffer(s, { team: "USR", partner: "CPU", give: [41], get: [] });
  expect(back.give).toEqual([41]);
  expect(evaluateProposal(s, back).accept).toBe(true);
  // Both sides started: it balances from either one, keeping what's in.
  const short = counterOffer(s, { team: "USR", partner: "CPU", give: [73], get: [20] });
  expect(short.give.slice(0, 1)).toEqual([73]);
  expect(short.give.length).toBeGreaterThan(1);
  expect(short.get[0]).toBe(20);
  expect(evaluateProposal(s, short).accept).toBe(true);
  const over = counterOffer({ ...s, idx: 1 }, { team: "USR", partner: "CPU", give: [9], get: [52] });
  expect(over.give).toEqual([9]);
  expect(over.get.length).toBeGreaterThan(1);
  expect(evaluateProposal({ ...s, idx: 1 }, over).accept).toBe(true);
  // Nothing on either side and neither team on the clock: no deal to build.
  const later = { ...s, idx: s.picks.findIndex((p) => p.overall === 73) };
  expect(counterOffer(later, { team: "USR", partner: "CPU" })).toBeNull();
});

test("war room: a pick that makes no sense says so", () => {
  const b = buildBoard(Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, Position: i % 2 ? "WR" : "QB", cr: 1 + i })));
  const order = [{ Pick: 5, Round: 1, Team: "USR" }, { Pick: 12, Round: 1, Team: "CPU" }, { Pick: 44, Round: 2, Team: "USR" }, { Pick: 51, Round: 2, Team: "CPU" }];
  let s = initSim({ order, board: b, userTeams: ["USR"], rounds: 2, seed: 1 });
  const qb = s.board.find((p) => p.Position === "QB");
  const wr = s.board.find((p) => p.Position === "WR");
  expect(pickOddity(s, "USR", qb, 5)).toBeNull();
  s = makePick(s, qb.id).state;
  s = makePick(s, s.board.find((p) => !s.taken[p.id]).id).state;
  const nextQb = s.board.find((p) => p.Position === "QB" && !s.taken[p.id]);
  expect(pickOddity(s, "USR", nextQb, 44)).toBe("secondQb");
  expect(pickOddity(s, "USR", s.board.find((p) => p.id !== wr.id && p.Position === "WR" && !s.taken[p.id]) || wr, 44)).toBeNull();
});
