// src/utils/draftSim/badgeRules.js
//
// What earns each Draft Sim badge (badges.js) — the wiring. Keyed by the
// badge's simBadges doc id, so a title or description edited in Admin →
// Mock Draft → Badges keeps its rule; a badge with no rule here shows
// "Not wired" there and is never awarded. To wire a new one: add its id
// below with the test its description asks for.
//
// scope:
//   pick     a user team's class so far — checked after every pick and
//            trade, so it pops up mid-draft (and again at the end).
//   final    a user team's finished class — only once the draft's done.
//   run      the sim itself, once it's done (no team needed).
//   profile  the signed-in user's running totals (badges.js awardBadges):
//            { sims, teams: { [abbr]: sims }, drafted: { [id]: times }, streak }.
// A class rule gets c = { team, rows: [{ pick, prospect }], trades:
// [{ partner, got, gave }], state, year, valueBoard, evaluated }; it's
// earned when any of the user's teams earns it.
//   valueBoard  the board's ranks are the community's (not My Board) — the
//               value badges only count against those.
//   evaluated   a Set of the player ids the user has evaluated (signed in),
//               or null.
import { SIM_POSITIONS } from "./engine";
import { pickValueOf } from "./simProfile";

const CONFERENCES = {
  AFC: ["BUF", "MIA", "NE", "NYJ", "BAL", "CIN", "CLE", "PIT", "HOU", "IND", "JAX", "TEN", "DEN", "KC", "LV", "LAC"],
  NFC: ["DAL", "NYG", "PHI", "WAS", "CHI", "DET", "GB", "MIN", "ATL", "CAR", "NO", "TB", "ARI", "LAR", "SF", "SEA"],
};
const conferenceOf = (t) => Object.keys(CONFERENCES).find((c) => CONFERENCES[c].includes(t)) || null;
const NFL_TEAM_COUNT = 32;

// The value and "for value" badges need this many measured picks (no
// kickers / punters) — a one-pick class isn't "every time".
const VALUE_CLASS_MIN = 5;
// Homer: a whole class from one school, of at least this many.
const HOMER_MIN = 3;

const pos = (r) => r.prospect.Position;
const school = (r) => r.prospect.School || "";
const named = (r, first, last) => r.prospect.First === first && r.prospect.Last === last;
const count = (rows, f) => rows.filter(f).length;
// Each pick's value against the board (pickValueOf), kickers and punters left out.
const values = (rows) => rows.map((r) => pickValueOf(r.pick.overall, r.prospect)).filter((v) => v != null);
const stole = (c, spots, f = () => true) => c.valueBoard && c.rows.some((r) => f(r) && (pickValueOf(r.pick.overall, r.prospect) ?? -Infinity) >= spots);
// { key: picks } for a key of each pick.
const tally = (rows, key) => rows.reduce((m, r) => { const k = key(r); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
const most = (m) => Math.max(0, ...Object.values(m));
// A first-round pick in the 2028 draft — next year's when this is 2027's,
// this draft's own when it's 2028's.
const first2028 = (c, p) => p.round === 1 && (p.future ? String(p.year) === "2028" : c.year === "2028");

export const BADGE_RULES = {
  // Steal — Drafted a player after his board rank
  "7umEuHzFMqwG1r7pYoje": { scope: "pick", test: (c) => stole(c, 1) },
  // Petty Theft — Drafted a player 25 spots after his board rank
  ABUJEVcDpBmiQAVq9FtF: { scope: "pick", test: (c) => stole(c, 25) },
  // Highway Robbery — Drafted a player 50 spots after his board rank
  "1zZ2PcPdGjPaA9aIJdxk": { scope: "pick", test: (c) => stole(c, 50) },
  // Grand Larceny — Drafted a player 100 spots after his board rank (non QB)
  GLWdqqhHQYDxIx2sZSWK: { scope: "pick", test: (c) => stole(c, 100, (r) => pos(r) !== "QB") },
  // Value Hunter — Drafted for value every time
  NVdAkPt562NBn6KSFctm: { scope: "final", test: (c) => { const v = values(c.rows); return c.valueBoard && v.length >= VALUE_CLASS_MIN && v.every((x) => x > 0); } },
  // What Are We Doing Here — Did not draft for value once
  "1gsp6Xwt610tO9nvHwPd": { scope: "final", test: (c) => { const v = values(c.rows); return c.valueBoard && v.length >= VALUE_CLASS_MIN && v.every((x) => x <= 0); } },

  // Teammates — Drafted 2 players from the same school
  AeD71ygnbwF1t67mpuUf: { scope: "pick", test: (c) => most(tally(c.rows, school)) >= 2 },
  // We Want the Room — Drafted 2 players from the same school at the same position
  SSYUgQd4aML3QHbzWPs5: { scope: "pick", test: (c) => most(tally(c.rows, (r) => school(r) && `${school(r)}|${pos(r)}`)) >= 2 },
  // College Connection — Drafted a QB and WR/TE from the same school
  "6DRh8T9OGAxnnBVadQcV": { scope: "pick", test: (c) => c.rows.some((q) => pos(q) === "QB" && school(q) && c.rows.some((r) => ["WR", "TE"].includes(pos(r)) && school(r) === school(q))) },
  // The Big 3 — Drafted a Florida State, Florida, and Miami player
  xrKrqL7M0lEBzziXcBk2: { scope: "pick", test: (c) => ["Florida State", "Florida", "Miami"].every((s) => c.rows.some((r) => school(r) === s)) },
  // Homer — Drafted an entire class from the same school
  K59KXsIGcntfLHfaCI9S: { scope: "final", test: (c) => c.rows.length >= HOMER_MIN && school(c.rows[0]) !== "" && c.rows.every((r) => school(r) === school(c.rows[0])) },

  // Face of the Franchise — Drafted a quarterback in the first round
  jYanjTO1227Y2YteYDTb: { scope: "pick", test: (c) => c.rows.some((r) => pos(r) === "QB" && r.pick.round === 1) },
  // Establish the Run — Drafted a running back in the first round
  sEJIY2E6STRv5J9b2w2c: { scope: "pick", test: (c) => c.rows.some((r) => pos(r) === "RB" && r.pick.round === 1) },
  // Davin's MVP — Drafted a kicker before day 3
  wTDpCY54pAIUgDtmk9XK: { scope: "pick", test: (c) => c.rows.some((r) => pos(r) === "K" && r.pick.round <= 3) },
  // Big Shoes to Fill — Drafted a QB at pick 199
  YwomRUcf3lJ75GFB91FT: { scope: "pick", test: (c) => c.rows.some((r) => pos(r) === "QB" && r.pick.overall === 199) },
  // Mr. Irrelevant — Drafted the last player in the draft (the last pick of round 7)
  eruQUZWkizViaKahUqSE: { scope: "pick", test: (c) => { const last = c.state.picks[c.state.picks.length - 1]; return last?.round === 7 && c.rows.some((r) => r.pick.overall === last.overall); } },
  // Whose Gonna Break the News? — Drafted a 1st round QB into a crowded room
  Qrl603jl0so0VOB34Lan: { scope: "pick", test: (c) => c.rows.some((r) => pos(r) === "QB" && r.pick.round === 1 && r.pick.need?.label === "Crowded Room") },
  // What Need? — Drafted into a crowded room before day 3
  yZHafNuBbKiFyNq9zaoT: { scope: "pick", test: (c) => c.rows.some((r) => r.pick.round <= 3 && r.pick.need?.label === "Crowded Room") },

  // Crowded Room — Drafted 2 QBs in the same class
  axVqucIBcZiXDa9Ns6X6: { scope: "pick", test: (c) => count(c.rows, (r) => pos(r) === "QB") >= 2 },
  // 12 Personnel — Drafted 1 RB and 2 TEs
  aj62W37ZzXnxRnlUAUAg: { scope: "pick", test: (c) => count(c.rows, (r) => pos(r) === "RB") >= 1 && count(c.rows, (r) => pos(r) === "TE") >= 2 },
  // It Starts Up Front — Drafted 3 OL in the same class
  eBZq1P1nkuGeY5ZsncB4: { scope: "pick", test: (c) => count(c.rows, (r) => pos(r) === "OL") >= 3 },
  // The Trenches — Drafted 3 DL/EDGE players in same class
  lXUbgdJQPd2NcTyggPtV: { scope: "pick", test: (c) => count(c.rows, (r) => ["DL", "EDGE"].includes(pos(r))) >= 3 },
  // Cycle — Drafted a player at every position
  LOufBg9GUm0bSx92sqeE: { scope: "pick", test: (c) => SIM_POSITIONS.every((p) => c.rows.some((r) => pos(r) === p)) },
  // Big Class — Finished with a draft class with 10+ players
  YYNx1sgad6a0bhw8HGGl: { scope: "pick", test: (c) => c.rows.length >= 10 },
  // Zero Class — Finished with a class with no players (traded every pick away)
  k4XfHVc4qVamqOcGb60A: { scope: "final", test: (c) => c.rows.length === 0 && c.trades.length > 0 },

  // We Got Him — Drafted Ousmane Kromah
  KDsSzHz5Le9NFiPcLDz4: { scope: "pick", test: (c) => c.rows.some((r) => named(r, "Ousmane", "Kromah")) },
  // Generational Talent — Drafted Jeremiah Smith first overall
  T01Y4CB2op1MiDKMKLxU: { scope: "pick", test: (c) => c.rows.some((r) => r.pick.overall === 1 && named(r, "Jeremiah", "Smith")) },
  // Armchair Scout — Drafted a player you have evaluated on We-Draft.com
  p2qew4rKFOybcr1w5XcS: { scope: "pick", test: (c) => !!c.evaluated && c.rows.some((r) => c.evaluated.has(r.prospect.id)) },

  // Line is Busy — Traded 5 times in one draft
  KKAR9AYcegPBvlcidqZq: { scope: "pick", test: (c) => c.trades.length >= 5 },
  // The Future is Now — Traded away a 2028 first rounder
  JkNs00BfdC2SeJLO7GYw: { scope: "pick", test: (c) => c.trades.some((t) => t.gave.some((p) => first2028(c, p))) },
  // Building for the Future — Traded for a 2028 first round pick
  KoSCJ32nlBZkUr3weeLa: { scope: "pick", test: (c) => c.trades.some((t) => t.got.some((p) => first2028(c, p))) },
  // Lets Bury It — Traded with a conference rival
  QvwMpgPCYqKbaXp6MYa8: { scope: "pick", test: (c) => c.trades.some((t) => conferenceOf(t.partner) && conferenceOf(t.partner) === conferenceOf(c.team)) },

  // Advance Scouting — Completed a 2028 mock draft
  "9CaWtrPkWLxnhjCyGqS8": { scope: "run", test: (r) => r.year === "2028" },

  // 50 Piece — Completed 50 sims
  qGa6smMXNKNJw53szOHN: { scope: "profile", test: (p) => p.sims >= 50 },
  // Century Mark — Completed 100 sims
  xGyp1KMEYi2lzl3Rd9CL: { scope: "profile", test: (p) => p.sims >= 100 },
  // Week Streak — Completed a draft sim 7 days in a row
  GTm5V8dN8h38iJjX9I5r: { scope: "profile", test: (p) => p.streak >= 7 },
  // Busy Month — Completed a sim 30 days in a row
  "9pUy2ORBFTjhmIJhU4Rh": { scope: "profile", test: (p) => p.streak >= 30 },
  // League Wide — Completed a sim for all 32 NFL teams
  ZvL33nYspbGF8yT0IeV2: { scope: "profile", test: (p) => Object.values(p.teams || {}).filter((n) => n > 0).length >= NFL_TEAM_COUNT },
  // He's My Guy — Drafted the same player 5 times
  lkgjtb5Gw4FXD7QY4r5d: { scope: "profile", test: (p) => most(p.drafted || {}) >= 5 },
};

export const isWired = (id) => !!BADGE_RULES[id];

// A team's class so far: its picks made and its trades (teamHaul's shape,
// without the grades).
export function classOf(state, team) {
  const rows = state.picks.filter((p) => p.owner === team && p.selection).map((p) => ({ pick: p, prospect: state.byId[p.selection] })).filter((r) => r.prospect);
  const trades = (state.trades || []).filter((t) => t.a === team || t.b === team)
    .map((t) => (t.a === team ? { partner: t.b, got: t.aGot, gave: t.bGot } : { partner: t.a, got: t.bGot, gave: t.aGot }));
  return { team, rows, trades };
}

// The badge ids a sim's earned so far (pick rules always; final and run
// rules once state.done). opts: { year, valueBoard, evaluated }.
export function runBadges(state, { year, valueBoard = true, evaluated = null } = {}) {
  const y = String(year);
  const classes = state.userTeams.map((t) => ({ ...classOf(state, t), state, year: y, valueBoard, evaluated }));
  return Object.entries(BADGE_RULES).filter(([, rule]) => {
    if (rule.scope === "pick" || (rule.scope === "final" && state.done)) return classes.some((c) => rule.test(c));
    if (rule.scope === "run") return state.done && rule.test({ state, year: y });
    return false;
  }).map(([id]) => id);
}

// The profile badge ids the user's totals have earned.
export function profileBadges(totals) {
  return Object.entries(BADGE_RULES).filter(([, rule]) => rule.scope === "profile" && rule.test(totals)).map(([id]) => id);
}
