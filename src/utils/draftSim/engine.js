// src/utils/draftSim/engine.js
//
// Draft Sim's engine — plain JS, no React or Firebase, so it's testable and
// the page (pages/DraftSim.jsx) just drives it. One sim is a state object
// that each step returns a new copy of, plus the events (picks, trades) that
// step produced for the analyst feed (utils/draftSim/analysts.js).
//
// How a CPU team picks (chooseCpuPick): every available prospect near the
// top of the board gets an "effective rank" for that team —
//   board rank (community grade consensus, see buildBoard)
//   × how NFL teams value the position at that spot (positionValue — at
//     the same grade, first-round QBs and EDGEs go earlier, LBs and TEs
//     slide; measured from the last 10 real drafts, positionHistory.json)
//   + a nudge when the position almost never goes this early (earlyNudge)
//   − the team's staff fit (compSnapshots/nflFit_{Position}: how closely
//     the prospect matches what this GM/HC/OC/DC have drafted before —
//     the "coach tendencies"), worth more spots the later the pick
//   + a penalty for doubling up at a position already taken this draft
//     (by need key — CB and S, OT and IOL count separately)
//   − the team's needs (needPull: nflTeamNeeds' labels by position — an
//     Upgrade Needed pulls hardest, a Crowded Room pushes away; a need
//     stops pulling once the team's drafted for it)
//   + noise (seeded, so a sim replays exactly from its seed)
// and the lowest effective rank is the pick.
//
// Trades (findTradeUpOffers / maybeCpuTrade) are pick-for-pick on the site's
// trade chart (config/draftTradeChart), driven by how much teams love the
// players on the board (love: value at the pick, needs, staff fit). A team
// that loves its options asks more to move off its pick — past a point, no
// package will do; a team behind it that loves someone the team on the
// clock doesn't is the one that calls. How often a deal happens comes from
// that gap, not a script.

import HISTORY from "./positionHistory.json";

export const SIM_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
// Kickers and punters sit at the bottom of the board (no one else's rank
// moves) and a pick of one is graded and reported as neither value nor
// reach. Community grades barely cover them, so a CPU team values one by
// where real drafts have taken the 1st, 2nd … of them (specialistRank) —
// never before the earliest one went in the last 10 drafts.
export const SPECIALISTS = ["K", "P"];
export const isSpecialist = (p) => SPECIALISTS.includes(p?.Position);

// ── Position value, from real drafts (scripts/buildPositionHistory.mjs) ──
// Factors, not rules: each sits next to the board, staff fit and noise, so
// a WR who's clearly the best player can still go first overall.
// A tier's measured ratio is pulled toward 1 by its sample size — n
// graded picks count against VALUE_SHRINK made-up neutral ones.
const VALUE_SHRINK = 20;
// The "unusually early" nudge, against this many made-up typical picks.
const EARLY_PRIOR = 3;
const HISTORY_YEARS = HISTORY.years[1] - HISTORY.years[0] + 1;
const HISTORY_TOTAL = Object.values(HISTORY.picks).reduce((t, a) => t + a.length, 0);

// × board rank: how much earlier (<1) or later (>1) teams take this
// position than a player graded at that spot. Interpolated between grade
// tiers on a log scale, flat past the last one. It fades to 1 at the top
// of the board — no one can go earlier than first overall, so a QB's
// first-round premium can't make the No. 3 player a No. 1.6.
export function positionValue(pos, rank) {
  const measured = (HISTORY.value[pos] || []).map((t) => ({ x: Math.log(t.at), y: Math.log(t.ratio) * (t.n / (t.n + VALUE_SHRINK)) }));
  if (!measured.length) return 1;
  const tiers = [{ x: 0, y: 0 }, ...measured];
  const x = Math.log(Math.max(1, rank));
  if (x <= tiers[0].x) return Math.exp(tiers[0].y);
  for (let i = 1; i < tiers.length; i++) {
    if (x <= tiers[i].x) {
      const f = (x - tiers[i - 1].x) / (tiers[i].x - tiers[i - 1].x);
      return Math.exp(tiers[i - 1].y + f * (tiers[i].y - tiers[i - 1].y));
    }
  }
  return Math.exp(tiers[tiers.length - 1].y);
}

// Spots added when a position has gone this early less often than its
// share of all picks would say — in units of the pick's own noise, and
// only ever a penalty. WRs at No. 1 barely register; a TE or RB in the
// top 5 a little more; a kicker in round 2 a lot.
export function earlyNudge(pos, overall) {
  const all = HISTORY.picks[pos];
  if (!all) return 0;
  const seen = all.filter((n) => n <= overall).length;
  const expected = (all.length / HISTORY_TOTAL) * overall * HISTORY_YEARS;
  return Math.max(0, -Math.log((seen + EARLY_PRIOR) / (expected + EARLY_PRIOR))) * (2.5 + 0.1 * overall);
}

// A specialist's stand-in board rank: where the next one of its position
// usually goes (the 1st kicker taken, the 2nd …), Infinity once real
// drafts rarely take that many, or before the earliest one ever went.
function specialistRank(state, pos, overall) {
  const h = HISTORY.specialists[pos];
  if (!h || overall < h.earliest) return Infinity;
  const taken = state.picks.filter((p) => p.selection && state.byId[p.selection]?.Position === pos).length;
  return h.slots[taken] ?? Infinity;
}

// ── Team needs ──
// nflTeamNeeds/{team}.needs — the admin's labels per position (Admin →
// Mock Draft → Team Needs, with suggestions from utils/
// teamNeedSuggestions.js) — as { [team]: { [NEED_KEY]: { labels, note } } };
// see resolveNeeds. Labels read the way a fan would say it; most to least
// urgent. MANUAL_LABELS are only ever set by hand, never suggested:
// Expiring Contract (no contract data). Set is neutral, not "not
// interested" — board value and staff fit still drive those picks.
export const NEED_LABELS = ["Upgrade Needed", "Expiring Contract", "Aging Talent", "Upgrade Wanted", "Depth Needed", "Set", "Crowded Room"];
export const MANUAL_LABELS = ["Expiring Contract"];
// OL and DB are split, so a team that needs a corner doesn't get a safety.
export const NEED_KEYS = ["QB", "RB", "WR", "TE", "OT", "IOL", "IDL", "EDGE", "LB", "CB", "S"];
// Specific needs: a role within a position, labeled like any position and
// listed under its parent (`parent`). Each pulls SPECIFIC_WEIGHT as hard as
// the same label at a position — one share for every role, so a nose
// tackle stands to the interior line as a slot corner does to the corners.
// A prospect at `pos` fits one (specificFit) with any community
// strength in `want` (Frame also counts for a prospect who's simply big
// for his position), none of `avoid` among his weaknesses, inside `size`
// (inches / lbs) when his measurements are known. `word` is how the
// analysts say it.
export const SPECIFIC_NEEDS = [
  { key: "RB3", name: "3rd Down RB", word: "third-down back", parent: "RB", pos: "RB",
    want: ["Receiving Ability", "Pass Protection", "Short Area Quickness"], avoid: ["Pass Protection", "Receiving Ability"] },
  { key: "SLOTWR", name: "Slot WR", word: "slot receiver", parent: "WR", pos: "WR",
    want: ["Separation", "Short Routes", "Route Running", "RAC Ability", "Short Area Quickness", "Change of Direction"], avoid: [], size: { hMax: 73 } },
  { key: "BIGWR", name: "WR Size", word: "big-bodied receiver", parent: "WR", pos: "WR",
    want: ["Frame", "Ball Skills", "Body Control", "Physicality", "Strength", "Run Blocking"], avoid: [], size: { hMin: 75, wMin: 200 } },
  { key: "DEEPWR", name: "Field Stretching WR", word: "deep threat", parent: "WR", pos: "WR",
    want: ["Long Speed", "Deep Routes", "Ball Tracking", "Acceleration", "Separation"], avoid: ["Long Speed"] },
  { key: "BLOCKTE", name: "Blocking TE", word: "blocking tight end", parent: "TE", pos: "TE",
    want: ["Run Blocking", "Pass Blocking", "Leg Drive", "Hand Usage", "Lower Body Strength", "Upper Body Strength", "Frame"], avoid: ["Run Blocking"] },
  { key: "RUSHEDGE", name: "Pass Rushing EDGE", word: "pass rusher", parent: "EDGE", pos: "EDGE",
    want: ["Bend", "First Step", "Pass Rush Moves", "Pass Rush Plan", "Speed Rush", "Speed to Power", "Closing Speed", "Power Rush", "Hand Usage"], avoid: [] },
  { key: "RUSHDL", name: "Pass Rushing DL", word: "interior pass rusher", parent: "IDL", pos: "DL",
    want: ["First Step", "Pass Rush Moves", "Pass Rush Plan", "Power Rush", "Hand Usage", "Speed Rush"], avoid: [] },
  { key: "NOSE", name: "Nose Tackle", word: "nose tackle", parent: "IDL", pos: "DL",
    want: ["Lower Body Strength", "Upper Body Strength", "Run Defense", "Block Shedding", "Strength", "Pad Level", "Balance", "Frame"], avoid: ["Pad Level"], size: { wMin: 310 } },
  { key: "SUBLB", name: "Sub LB", word: "coverage linebacker", parent: "LB", pos: "LB",
    want: ["Man Coverage", "Zone Instincts", "Sideline to Sideline", "Play Recognition", "Change of Direction", "Long Speed", "Short Area Quickness"], avoid: [] },
  { key: "SS", name: "Strong Safety", word: "strong safety", parent: "S", pos: "DB", sub: "S",
    want: ["Run Support", "Tackling", "Angle Tackling", "Physicality", "Block Shedding", "Pursuit Angles", "Frame"], avoid: [], size: { wMin: 195 } },
  { key: "FS", name: "Free Safety", word: "free safety", parent: "S", pos: "DB", sub: "S",
    want: ["Range", "Ball Hawk", "Ball Skills", "Zone Instincts", "Long Speed", "Instincts", "Recovery"], avoid: ["Range"] },
  { key: "SLOTCB", name: "Slot Corner", word: "slot corner", parent: "CB", pos: "DB", sub: "CB",
    want: ["Man Technique", "Hip Fluidity", "Transitions", "Short Area Quickness", "Change of Direction", "Patience", "Zone Instincts"], avoid: [] },
];
const SPECIFIC_BY_KEY = Object.fromEntries(SPECIFIC_NEEDS.map((s) => [s.key, s]));
export const SPECIFIC_WEIGHT = 0.6;
export const NEED_KEY_NAMES = {
  QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OT: "Offensive Tackle", IOL: "Interior O-Line",
  IDL: "Interior D-Line", EDGE: "Edge Rusher", LB: "Linebacker", CB: "Cornerback", S: "Safety",
  ...Object.fromEntries(SPECIFIC_NEEDS.map((s) => [s.key, s.name])),
};
// How the analysts say a need ("cornerback", "slot corner").
export const needWord = (key) => SPECIFIC_BY_KEY[key]?.word || (NEED_KEY_NAMES[key] || key).toLowerCase();

// One team's stored needs → { [key]: { labels, note } }: known positions
// and labels only, Set when a position has none.
export function resolveNeeds(needs = {}) {
  const out = {};
  Object.entries(needs || {}).forEach(([key, n]) => {
    if (!(NEED_KEYS.includes(key) || SPECIFIC_BY_KEY[key]) || !n || typeof n !== "object") return;
    const labels = (n.labels || []).filter((l) => NEED_LABELS.includes(l));
    out[key] = { labels: labels.length ? labels : ["Set"], note: n.note || "" };
  });
  return out;
}

// The need(s) a prospect fills: [{ key, share }]. An OL or DB with no
// sub-position (subPosition — OT / IOL, CB / S) counts half toward each.
export function needKeysFor(p) {
  if (!p || isSpecialist(p)) return [];
  const sub = p.subPosition;
  if (p.Position === "OL") return ["OT", "IOL"].includes(sub) ? [{ key: sub, share: 1 }] : [{ key: "OT", share: 0.5 }, { key: "IOL", share: 0.5 }];
  if (p.Position === "DB") return ["CB", "S"].includes(sub) ? [{ key: sub, share: 1 }] : [{ key: "CB", share: 0.5 }, { key: "S", share: 0.5 }];
  if (p.Position === "DL") return [{ key: "IDL", share: 1 }];
  return [{ key: p.Position, share: 1 }];
}

// How much one label makes a team want a prospect at this pick (1 = the
// most; negative pushes away). Factors like the rest: effectiveRank turns
// it into spots, more of them the later the pick.
function labelPull(label, key, p, overall) {
  switch (label) {
    case "Upgrade Needed": return 1;
    case "Expiring Contract": return 0.6;
    // Drafting the next one — teams do it early at QB.
    case "Aging Talent": return key === "QB" ? 0.8 : 0.45;
    // Only for a clear upgrade: a prospect the board has at or above the pick.
    case "Upgrade Wanted": return p.rank <= overall ? 0.5 : 0.2;
    // Backups are a mid/late-round thing — nothing at the top of round 1.
    case "Depth Needed": return 0.4 * Math.min(1, overall / 100);
    case "Crowded Room": return -0.6;
    default: return 0;
  }
}

// "Big for his position": weight or height in the top 30% of the board's
// prospects there — Frame without the community having to say so.
const FRAME_PCT = 0.7;
const frameCuts = new WeakMap();
function bigForPosition(board, p) {
  if (!board || (p.weight == null && p.height == null)) return false;
  if (!frameCuts.has(board)) frameCuts.set(board, {});
  const cuts = frameCuts.get(board);
  if (!cuts[p.Position]) {
    const at = (k) => {
      const vals = board.filter((x) => x.Position === p.Position && x[k] != null).map((x) => x[k]).sort((a, c) => a - c);
      return vals.length ? vals[Math.floor((vals.length - 1) * FRAME_PCT)] : Infinity;
    };
    cuts[p.Position] = { weight: at("weight"), height: at("height") };
  }
  const c = cuts[p.Position];
  return (p.weight != null && p.weight >= c.weight) || (p.height != null && p.height >= c.height);
}

// Whether a prospect fits a specific need: 1 when he does, 0 when he
// doesn't — any wanted strength, no `avoid` weakness, inside the size
// limits. A DB with no sub-position counts half toward a CB- or S-only
// need, the same share he counts toward CB or S as a position.
export function specificFit(spec, p, board) {
  if (!spec || p?.Position !== spec.pos) return 0;
  if (spec.sub && p.subPosition && p.subPosition !== spec.sub) return 0;
  const weak = p.weaknesses || [];
  if (spec.avoid.some((t) => weak.includes(t))) return 0;
  const s = spec.size || {};
  if (p.height != null && ((s.hMin && p.height < s.hMin) || (s.hMax && p.height > s.hMax))) return 0;
  if (p.weight != null && ((s.wMin && p.weight < s.wMin) || (s.wMax && p.weight > s.wMax))) return 0;
  const strong = p.strengths || [];
  const fits = spec.want.some((t) => strong.includes(t) || (t === "Frame" && bigForPosition(board, p)));
  return fits ? (spec.sub && !p.subPosition ? 0.5 : 1) : 0;
}
const specificsFor = (p) => SPECIFIC_NEEDS.filter((s) => s.pos === p?.Position);

// A team's pull toward a prospect from its needs: the strongest label that
// wants him — at his position, or (at SPECIFIC_WEIGHT) a specific need he
// fits — fading once the team's drafted for it (state.needFilled). A
// Crowded Room only counts when nothing wants him.
export function needPull(state, team, p, overall) {
  const needs = state.needs?.[team];
  if (!needs) return 0;
  const filledOf = (key) => state.needFilled?.[team]?.[key] || 0;
  const position = needKeysFor(p).reduce((total, { key, share }) => {
    const n = needs[key];
    if (!n) return total;
    const pulls = n.labels.map((l) => labelPull(l, key, p, overall));
    const want = Math.max(0, ...pulls);
    return total + share * (want > 0 ? want * Math.max(0, 1 - filledOf(key)) : Math.min(0, ...pulls));
  }, 0);
  const specific = Math.max(0, ...specificsFor(p).map((s) => {
    const n = needs[s.key];
    const fit = n ? specificFit(s, p, state.board) : 0;
    if (!fit) return 0;
    const want = Math.max(0, ...n.labels.map((l) => labelPull(l, s.parent, p, overall)));
    return want * fit * SPECIFIC_WEIGHT * Math.max(0, 1 - filledOf(s.key));
  }));
  return specific > 0 && specific > position ? specific : position;
}

// Premium capital: picks in rounds 1–PREMIUM_ROUNDS (1–QB_PREMIUM_ROUNDS
// for a quarterback). A team never spends one on a position it's only
// looking for depth at — Depth Needed and nothing more urgent there (an
// OL / DB with no sub-position only when both halves are), and no more
// urgent specific need he fits.
export const PREMIUM_ROUNDS = 2;
export const QB_PREMIUM_ROUNDS = 4;
const depthOnlyAt = (n) => !!n?.labels.includes("Depth Needed") && !n.labels.some((l) => URGENT.includes(l));
export function depthOnly(state, team, p) {
  const needs = state.needs?.[team];
  if (!needs) return false;
  const keys = needKeysFor(p);
  if (!keys.length || !keys.every(({ key }) => depthOnlyAt(needs[key]))) return false;
  return !specificsFor(p).some((s) => needs[s.key]?.labels.some((l) => URGENT.includes(l)) && specificFit(s, p, state.board));
}
const isPremium = (round, p) => round != null && round <= (p?.Position === "QB" ? QB_PREMIUM_ROUNDS : PREMIUM_ROUNDS);

// A team with its QB room filled in (Set, Crowded Room — or no QB label
// when it has needs entered at all) takes a quarterback with premium
// capital only when he's too good to pass up: this many spots on top,
// more the later the pick, half again for a crowded room.
const qbRoomFull = (state, team) => {
  const needs = state.needs?.[team];
  if (!needs || !Object.keys(needs).length) return false;
  const labels = needs.QB?.labels || [];
  return !labels.some((l) => URGENT.includes(l) || l === "Depth Needed");
};
function qbRoomPenalty(state, team, p, overall, round) {
  if (p.Position !== "QB" || !isPremium(round, p) || !qbRoomFull(state, team)) return 0;
  const spots = 18 + 0.6 * overall;
  return state.needs[team].QB?.labels.includes("Crowded Room") ? spots * 1.5 : spots;
}

// The specific needs a prospect fills: [{ key, fit }].
export const specificFits = (p, board) => specificsFor(p).map((s) => ({ key: s.key, fit: specificFit(s, p, board) })).filter((x) => x.fit > 0);

export function needFor(state, team, p) {
  const open = (key, label) => label && (label === "Crowded Room" || (state.needFilled?.[team]?.[key] || 0) < 1);
  const top = (n) => NEED_LABELS.find((l) => l !== "Set" && n.labels.includes(l));
  let best = null;
  needKeysFor(p).sort((a, c) => c.share - a.share).some(({ key }) => {
    const n = state.needs?.[team]?.[key];
    const label = n && top(n);
    if (open(key, label)) best = { key, label, note: n.note || "" };
    return !!best;
  });
  // A specific need he fits wins when it's at least as urgent.
  specificFits(p, state.board).forEach(({ key }) => {
    const n = state.needs?.[team]?.[key];
    const label = n && top(n);
    if (!open(key, label) || label === "Crowded Room") return;
    if (!best || best.label === "Crowded Room" || NEED_LABELS.indexOf(label) <= NEED_LABELS.indexOf(best.label)) best = { key, label, note: n.note || "" };
  });
  return best;
}

// Only this many of the best available (by board) are weighed per pick,
// plus anyone the team fits Very Strong (80+).
const CANDIDATES = 45;
const STRONG_FIT = 80;

// ── Trade tuning ──
// An offer must give the pick's owner at least this share of its chart value.
const TRADE_MIN_RATIO = 1.02;
// …and the CPU won't overpay past this.
const TRADE_MAX_RATIO = 1.3;
// How far ahead (in picks) a team will look to trade up.
const TRADE_WINDOW = 20;
// Per-pick chance two CPU teams make a deal anyway, by round (index 0 =
// round 1) — on top of the chance the love gap adds (TRADE_GAP_*).
const CPU_TRADE_CHANCE = [0.05, 0.035, 0.025, 0.02, 0.015, 0.015, 0.015];
// A love gap (caller's desire − owner's love) past TRADE_GAP_START adds
// TRADE_GAP_RATE of chance per point, up to TRADE_GAP_MAX in all.
const TRADE_GAP_START = 0.2;
const TRADE_GAP_RATE = 0.45;
const TRADE_GAP_MAX = 0.55;
// What a team asks on top of the chart to move off a pick, per point of
// love for its best option there — enough love and no deal clears it.
const ATTACHMENT_PREMIUM = 0.25;
const MAX_OFFERS = 2;
// Most picks one side will put in a deal.
const MAX_BUNDLE = 3;

// ── Seeded RNG (mulberry32) ──
export function rngNext(seed) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: (seed + 0x6d2b79f5) | 0 };
}
function gaussian(state) {
  const a = rngNext(state.seed);
  const b = rngNext(a.seed);
  state.seed = b.seed;
  return Math.sqrt(-2 * Math.log(a.value || 1e-9)) * Math.cos(2 * Math.PI * b.value);
}
function random(state) {
  const r = rngNext(state.seed);
  state.seed = r.seed;
  return r.value;
}

// ── Next year's picks ──
// The following draft's picks (its projected order) trade too, worth
// FUTURE_DISCOUNT of their slot on the chart. Each is keyed (its `overall`)
// as FUTURE_KEY + its pick number in that draft, so it can never collide
// with a pick in this one; `number` and `year` are what it's shown as.
export const FUTURE_DISCOUNT = 0.85;
export const FUTURE_KEY = 1000;

// ── Pick value ──
// The site's chart when it has the pick, else a curve shaped like it
// (≈ Jimmy Johnson: No. 1 ≈ 3000, No. 32 ≈ 830, No. 64 ≈ 230).
export function pickValue(chart, overall) {
  const v = Number(chart?.[overall]);
  return v > 0 ? v : Math.round(3000 * Math.exp(-0.0425 * (overall - 1)) + 30);
}

// A pick's trade-chart worth (next year's at FUTURE_DISCOUNT).
export function pickWorth(state, p) {
  if (!p) return 0;
  return p.future ? Math.round(pickValue(state.chart, p.number) * FUTURE_DISCOUNT) : pickValue(state.chart, p.overall);
}
// "No. 7", or "2028 R1 · No. 7" for next year's.
export const pickName = (p) => (p?.future ? `${p.year} R${p.round} · No. ${p.number}` : `No. ${p?.overall}`);
// A pick (this draft's, an unsimmed round's or next year's) by its key.
export const pickByKey = (state, key) => [...state.picks, ...(state.capital || [])].find((p) => p.overall === key) || null;

// ── Board ──
// prospects: [{ id, First, Last, Position, School, Slug, logo, cr? }] — cr
// is the official We-Draft.com class rank (compSnapshots/class_{year}_{pos});
// grades: { [id]: [avg, count, "s1|s2|s3", "w1|w2|w3"] } (the _grades
// snapshot's rows); fits: { [id]: [{ a: team, s, GM?, HC?, OC?, DC? }] };
// stats: { [slug]: { leaders, lines } } (data.js loadCfbStats).
// Order: class rank, then community grade (more evaluations breaking ties),
// then ungraded by best team fit. positionRank counts within the position.
export function buildBoard(prospects, grades = {}, fits = {}, stats = {}) {
  const split = (v) => (v ? String(v).split("|").filter(Boolean) : []);
  const rows = prospects.map((p) => {
    const g = grades[p.id];
    const teamFits = {};
    (fits[p.id] || []).forEach((f) => { teamFits[f.a] = f; });
    const bestFit = Math.max(0, ...(fits[p.id] || []).map((f) => f.s || 0));
    return {
      ...p, cr: p.cr ?? null, avg: g ? g[0] : null, count: g ? g[1] || 0 : 0,
      strengths: split(g?.[2]), weaknesses: split(g?.[3]),
      fits: teamFits, bestFit, stats: stats[p.Slug] || null,
    };
  });
  rows.sort((a, b) => {
    if (isSpecialist(a) !== isSpecialist(b)) return isSpecialist(a) ? 1 : -1;
    if (a.cr != null && b.cr != null) return a.cr - b.cr || a.id.localeCompare(b.id);
    if (a.cr != null) return -1;
    if (b.cr != null) return 1;
    if (a.avg != null && b.avg != null) return a.avg - b.avg || b.count - a.count || a.id.localeCompare(b.id);
    if (a.avg != null) return -1;
    if (b.avg != null) return 1;
    return b.bestFit - a.bestFit || a.id.localeCompare(b.id);
  });
  const seen = {};
  return rows.map((p, i) => {
    seen[p.Position] = (seen[p.Position] || 0) + 1;
    return { ...p, rank: i + 1, positionRank: seen[p.Position] };
  });
}

// The user's own board ("My Board" on the setup screen): their grades
// (myGrades: { [playerId]: 1 … 10 }) replace the community's, and the board
// is re-ranked by grade — a player they haven't graded keeps the community
// grade. Ranked the way the class rank is (the rounded grade, so the same
// buckets), ties in board order, so with no grades of theirs the board
// comes back unchanged. Strengths, weaknesses and the evaluation count stay
// the community's; graded players get mine: true.
export function applyMyGrades(board, myGrades = {}) {
  // (The class rank is weekly and the grades aren't, so a re-rank alone
  // could still shuffle a board none of whose players they've graded.)
  if (!board.some((p) => myGrades[p.id] != null)) return board;
  const rows = board.map((p) => (myGrades[p.id] != null ? { ...p, avg: myGrades[p.id], mine: true } : p));
  const key = (p) => (p.avg == null ? null : Math.round(p.avg));
  rows.sort((a, b) => {
    if (isSpecialist(a) !== isSpecialist(b)) return isSpecialist(a) ? 1 : -1;
    const ak = key(a), bk = key(b);
    if (ak != null && bk != null && ak !== bk) return ak - bk;
    if (ak != null && bk == null) return -1;
    if (ak == null && bk != null) return 1;
    return a.rank - b.rank;
  });
  const seen = {};
  return rows.map((p, i) => {
    seen[p.Position] = (seen[p.Position] || 0) + 1;
    return { ...p, rank: i + 1, positionRank: seen[p.Position] };
  });
}

// ── Team boards ──
// Every team's own read of the community board, drawn once per sim: each
// prospect's community rank plus a seeded random spread (standard
// deviation, in board spots) that widens down the board — teams agree on
// the top 15, disagree more and more after that. Re-ranked into the team's
// own 1…N. CPU teams pick off their own board; everything graded (board
// rank, value / reach, the desk, draft grades) stays on the community's.
// Specialists keep their community spot. chaos 0 → no spread.
export const BOARD_SPREAD = [[15, 1], [50, 6], [100, 11], [150, 17], [Infinity, 25]];
export const boardSpread = (rank) => BOARD_SPREAD.find(([upTo]) => rank <= upTo)[1];
const teamSeed = (seed, team) => [...team].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), seed ^ 0x811c9dc5) | 0;
export function buildTeamBoards(board, teams, seed, chaos = 1) {
  if (!chaos) return {};
  const players = board.filter((p) => !isSpecialist(p));
  return Object.fromEntries(teams.map((team) => {
    const work = { seed: teamSeed(seed, team) };
    const scored = players.map((p) => ({ id: p.id, s: p.rank + gaussian(work) * boardSpread(p.rank) * chaos }));
    scored.sort((a, b) => a.s - b.s);
    return [team, Object.fromEntries(scored.map((x, i) => [x.id, i + 1]))];
  }));
}
// Where a team has a prospect on its own board (the community rank without one).
export const teamRank = (state, team, p) => state.teamBoards?.[team]?.[p.id] ?? p.rank;

// ── Draft order ──
// A team map ({ [team]: team }) relabels the order: every team takes over
// another team's whole set of picks — round 1 slot, the rounds after it
// and any picks traded in or out — so the order's shape (comp picks,
// trades) stays real while who sits where changes. Needs and staff stay
// with the team. The setup screen's Randomize (a new map each run) and
// Custom (one the user builds by swapping teams) both come through here.
export const orderTeams = (order) => [...new Set(order.flatMap((p) => [p.Team, p.Traded]).filter(Boolean))].sort();
export function relabelOrder(order, to = {}) {
  return order.map((p) => ({ ...p, Team: to[p.Team] || p.Team, ...(p.Traded ? { Traded: to[p.Traded] || p.Traded } : {}) }));
}
// A random team map (seeded).
export function randomTeamMap(order, seed) {
  const teams = orderTeams(order);
  const work = { seed };
  const shuffled = [...teams];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random(work) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Object.fromEntries(teams.map((t, i) => [t, shuffled[i]]));
}
export const shuffleOrder = (order, seed) => relabelOrder(order, randomTeamMap(order, seed));
// Teams a and b trade places in a map: each takes the other's picks.
export function swapTeams(to, a, b) {
  const next = { ...to };
  const keyOf = (t) => Object.keys(next).find((k) => (next[k] || k) === t) || t;
  const ka = keyOf(a);
  const kb = keyOf(b);
  next[ka] = b;
  next[kb] = a;
  return next;
}

// ── Sim state ──
// order: [{ Pick, Round, Team, Traded }] (fetchDraft's picks).
// futureOrder / futureYear: next year's draft (same shape), traded as
// capital at FUTURE_DISCOUNT.
// cpuTrades: how often CPU teams trade with each other (CPU_TRADES key).
export function initSim({ order, board, chart = {}, userTeams = [], rounds = 1, seed = Date.now(), chaos = 1, staff = {}, needs = {}, futureOrder = [], futureYear = null, cpuTrades = "normal" }) {
  // Picks in rounds the sim doesn't draft still change hands in trades —
  // a one-round sim's teams can trade up with their 2nd-rounders — and so
  // do next year's.
  const capital = [
    ...order
      .filter((p) => p.Round > rounds)
      .map((p) => ({ overall: p.Pick, round: p.Round, original: p.Team, owner: p.Traded || p.Team, via: p.Traded ? p.Team : null, capital: true })),
    ...[...futureOrder]
      .sort((a, b) => a.Pick - b.Pick)
      .map((p) => ({
        overall: FUTURE_KEY + p.Pick, number: p.Pick, year: futureYear, future: true, round: p.Round,
        original: p.Team, owner: p.Traded || p.Team, via: p.Traded ? p.Team : null, capital: true,
      })),
  ];
  const picks = [...order]
    .filter((p) => p.Round <= rounds)
    .sort((a, b) => a.Pick - b.Pick)
    .map((p, i, all) => ({
      overall: p.Pick,
      round: p.Round,
      inRound: all.filter((q) => q.Round === p.Round && q.Pick <= p.Pick).length,
      original: p.Team,
      owner: p.Traded || p.Team,
      via: p.Traded ? p.Team : null,
      selection: null,
    }));
  const teams = [...new Set([...picks, ...capital].flatMap((p) => [p.owner, p.original]))];
  return {
    picks, capital, board, chart, staff, chaos, needs, cpuTrades,
    teamBoards: buildTeamBoards(board, teams, seed | 0, chaos),
    byId: Object.fromEntries(board.map((p) => [p.id, p])),
    taken: {},
    teamPos: {},
    // { [team]: { [NEED_KEY]: share drafted for it so far } }.
    needFilled: {},
    // Every trade made in this sim: [{ a, b, aGot: [pick], bGot: [pick] }].
    trades: [],
    userTeams: [...userTeams],
    idx: 0,
    seed: seed | 0,
    offers: [],
    done: picks.length === 0,
  };
}

export const currentPick = (state) => state.picks[state.idx] || null;
export const isUserOnClock = (state) => !state.done && state.userTeams.includes(currentPick(state)?.owner);
export const available = (state) => state.board.filter((p) => !state.taken[p.id]);
// What the CPU drafts from (and trades up for): no specialists — those
// come in on their own in candidatesFor.
const cpuAvailable = (state) => available(state).filter((p) => !isSpecialist(p));
export const fitFor = (prospect, team) => prospect?.fits?.[team]?.s ?? null;

// How many players a team has already drafted at a prospect's spot — by
// need key, so a corner then a safety (or a tackle then a guard) isn't
// doubling up; an OL / DB with no sub-position counts half toward each.
function repeatOf(state, team, p) {
  if (isSpecialist(p)) return state.teamPos[team]?.[p.Position] || 0;
  return needKeysFor(p).reduce((t, { key, share }) => t + share * (state.needFilled?.[team]?.[key] || 0), 0);
}

// A team's effective rank for a prospect at this pick (lower = wanted more).
function effectiveRank(state, team, p, overall, round, noise = 0) {
  const fit = fitFor(p, team);
  const fitPull = fit ? Math.max(0, (fit - 60) / 40) * (4 + 0.22 * overall) : 0;
  const repeatPenalty = repeatOf(state, team, p) * (6 + 0.3 * overall) * (isSpecialist(p) ? 10 : p.Position === "QB" ? 3 : 1);
  const need = needPull(state, team, p, overall);
  const rank = teamRank(state, team, p);
  const base = isSpecialist(p) ? specialistRank(state, p.Position, overall) : rank * positionValue(p.Position, rank);
  return base + earlyNudge(p.Position, overall) - fitPull + repeatPenalty - need * (5 + 0.25 * overall) + qbRoomPenalty(state, team, p, overall, round) + noise;
}

function candidatesFor(state, team) {
  // The top of this team's own board.
  const avail = state.teamBoards?.[team]
    ? cpuAvailable(state).sort((a, b) => teamRank(state, team, a) - teamRank(state, team, b))
    : cpuAvailable(state);
  const top = avail.slice(0, CANDIDATES);
  const fits = avail.slice(CANDIDATES).filter((p) => (fitFor(p, team) || 0) >= STRONG_FIT);
  // The best kicker and punter left, once one could realistically go.
  const overall = currentPick(state)?.overall || 0;
  const specialists = SPECIALISTS
    .filter((pos) => specialistRank(state, pos, overall) < Infinity)
    .map((pos) => available(state).find((p) => p.Position === pos))
    .filter(Boolean);
  const all = [...top, ...fits, ...specialists];
  // No premium pick on a depth-only position (unless that's all that's left).
  const round = currentPick(state)?.round;
  const allowed = all.filter((p) => !isPremium(round, p) || !depthOnly(state, team, p));
  return allowed.length ? allowed : all;
}

// Prospects a CPU team takes the moment they're on the clock with him on
// the board — unless (skip) the team has a bigger call to make. Jeremiah
// Smith goes No. 1 unless that team has an Upgrade Needed at QB (and
// hasn't drafted one yet); then he's the next team's.
const bigQbNeed = (state, team) => !!state.needs?.[team]?.QB?.labels?.includes("Upgrade Needed") && (state.needFilled?.[team]?.QB || 0) < 1;
export const MUST_PICKS = [
  { id: "row_183", name: "Jeremiah Smith", skip: bigQbNeed },
];

// The CPU's choice for the pick on the clock → prospect or null (board empty).
export function chooseCpuPick(state) {
  const pick = currentPick(state);
  if (!pick) return null;
  const must = MUST_PICKS.find((m) => state.byId[m.id] && !state.taken[m.id] && !m.skip(state, pick.owner));
  if (must) return { prospect: state.byId[must.id], seed: state.seed };
  const work = { seed: state.seed };
  let best = null;
  let bestScore = Infinity;
  candidatesFor(state, pick.owner).forEach((p) => {
    const noise = gaussian(work) * (2.5 + 0.1 * pick.overall) * state.chaos;
    const score = effectiveRank(state, pick.owner, p, pick.overall, pick.round, noise);
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return { prospect: best, seed: work.seed };
}

// Make the pick on the clock → { state, event }.
export function makePick(state, prospectId, seed = state.seed) {
  const pick = currentPick(state);
  const prospect = state.byId[prospectId];
  if (!pick || !prospect || state.taken[prospectId]) return { state, event: null };
  // The need he filled, kept on the pick (My Picks, grades).
  const need = needFor(state, pick.owner, prospect);
  const picks = state.picks.map((p, i) => (i === state.idx ? { ...p, selection: prospectId, need } : p));
  const teamPos = { ...state.teamPos, [pick.owner]: { ...(state.teamPos[pick.owner] || {}) } };
  teamPos[pick.owner][prospect.Position] = (teamPos[pick.owner][prospect.Position] || 0) + 1;
  const needFilled = { ...state.needFilled, [pick.owner]: { ...(state.needFilled?.[pick.owner] || {}) } };
  needKeysFor(prospect).forEach(({ key, share }) => { needFilled[pick.owner][key] = (needFilled[pick.owner][key] || 0) + share; });
  specificFits(prospect, state.board).forEach(({ key, fit }) => { needFilled[pick.owner][key] = (needFilled[pick.owner][key] || 0) + fit; });
  const prior = picks.slice(0, state.idx).map((p) => state.byId[p.selection]).filter(Boolean);
  const recent = prior.slice(-8);
  const event = {
    type: "pick",
    pick: { ...pick, selection: prospectId },
    team: pick.owner,
    prospect,
    isUser: state.userTeams.includes(pick.owner),
    // + = taken later than the board says (value); − = a reach.
    value: isSpecialist(prospect) ? 0 : pick.overall - prospect.rank,
    fit: prospect.fits?.[pick.owner] || null,
    need,
    positionOrdinal: prior.filter((p) => p.Position === prospect.Position).length + 1,
    positionRun: recent.filter((p) => p.Position === prospect.Position).length,
    bestLeftAtPosition: state.board.find((p) => p.Position === prospect.Position && !state.taken[p.id] && p.id !== prospectId) || null,
    // The quarterback this team took in round 1 of this sim, if any — the
    // desk's "protecting / a weapon for {qb}" lines on its later picks.
    rookieQb: state.byId[state.picks.slice(0, state.idx).find((p) => p.owner === pick.owner && p.round === 1 && state.byId[p.selection]?.Position === "QB")?.selection] || null,
  };
  const idx = state.idx + 1;
  const next = {
    ...state, picks, teamPos, needFilled, seed, offers: [],
    taken: { ...state.taken, [prospectId]: true },
    idx,
  };
  next.done = idx >= picks.length || available(next).length === 0;
  return { state: next, event };
}

// The Suggestions tab for a team's pick (overall: which pick — the one on
// the clock by default) → { value, need, coach, needs, topNeed }, three
// different players at most, all aware of what the team's already drafted
// (no second QB after it took one):
//   value    the best player left on the We-Draft.com board (community
//            grades) at a spot the team hasn't already drafted, no
//            specialists.
//   need     the best player left for the team's needs — ranked the way a
//            CPU team ranks with its needs (board rank × position value −
//            need pull + doubling up), without staff fit or noise — or null
//            when nothing near the top of the board fills one.
//   coach    the player a GM / head coach / coordinator wants most:
//            { p, slot, score } — a Strong (70+) staff fit, weighed with the
//            team's needs and what it's already drafted — or null.
//   needs    the need each of those fills (needFor), by prospect id.
//   topNeed  the team's most urgent need still open ({ key, label }) — what
//            a coach weighs a non-need pick against.
const COACH_FIT = 70;
export function suggestionsFor(state, team, overall = currentPick(state)?.overall || 1) {
  const avail = cpuAvailable(state);
  const repeat = (p) => repeatOf(state, team, p);
  const value = avail.find((p) => repeat(p) < 0.5) || avail[0] || null;
  let need = null;
  let needScore = Infinity;
  avail.slice(0, CANDIDATES).forEach((p) => {
    const pull = needPull(state, team, p, overall);
    if (p === value || pull <= 0) return;
    const score = p.rank * positionValue(p.Position, p.rank) - pull * (5 + 0.25 * overall) + repeat(p) * (6 + 0.3 * overall) * (p.Position === "QB" ? 3 : 1);
    if (score < needScore) { needScore = score; need = p; }
  });
  let coach = null;
  let coachScore = -Infinity;
  avail.slice(0, CANDIDATES * 2).forEach((p) => {
    if (p === value || p === need) return;
    if (p.Position === "QB" ? repeat(p) > 0 : repeat(p) >= 2) return;
    ["HC", "GM", "OC", "DC"].forEach((slot) => {
      const fit = p.fits?.[team]?.[slot];
      if (fit == null || fit < COACH_FIT) return;
      const score = fit + 25 * needPull(state, team, p, overall) - 30 * repeat(p) - 0.15 * Math.max(0, p.rank - overall);
      if (score > coachScore) { coachScore = score; coach = { p, slot, score: fit }; }
    });
  });
  const needs = {};
  [value, need, coach?.p].filter(Boolean).forEach((p) => {
    const n = needFor(state, team, p);
    if (n) needs[p.id] = n;
  });
  return { value, need, coach, needs, topNeed: openNeeds(state, team)[0] || null };
}

// A team's urgent needs it hasn't drafted for yet, most urgent first
// (positions before specific roles at the same label): [{ key, label }].
export function openNeeds(state, team) {
  return Object.entries(state.needs?.[team] || {})
    .map(([key, n]) => ({ key, label: NEED_LABELS.find((l) => URGENT.includes(l) && n.labels.includes(l)) }))
    .filter((n) => n.label && (state.needFilled?.[team]?.[n.key] || 0) < 1)
    .sort((a, c) => NEED_LABELS.indexOf(a.label) - NEED_LABELS.indexOf(c.label) || (SPECIFIC_BY_KEY[a.key] ? 1 : 0) - (SPECIFIC_BY_KEY[c.key] ? 1 : 0));
}

// One CPU pick (with the chance of a CPU–CPU trade first) → { state, events }.
export function stepCpu(state) {
  if (state.done || isUserOnClock(state)) return { state, events: [] };
  const events = [];
  let s = state;
  const traded = maybeCpuTrade(s);
  if (traded) { s = traded.state; events.push(traded.event); }
  const choice = chooseCpuPick(s);
  if (!choice?.prospect) return { state: { ...s, done: true }, events };
  const { state: after, event } = makePick(s, choice.prospect.id, choice.seed);
  if (event) events.push(event);
  return { state: after, events };
}

// ── Trades ──

// A team's tradeable picks after the one on the clock, earliest first: the
// sim's own, then its capital (rounds not being drafted).
const futurePicksOf = (state, team) => [
  ...state.picks.filter((p, i) => i > state.idx && p.owner === team && !p.selection),
  ...(state.capital || []).filter((p) => p.owner === team),
];

// The smallest bundle of a team's picks (their earliest first, then the
// best fillers) worth at least `target` — or null if they can't get there.
function bundleFor(state, team, target, maxValue) {
  const own = futurePicksOf(state, team);
  if (!own.length) return null;
  const [lead, ...rest] = own;
  // A deal is built around a pick in this draft; next year's only sweeten.
  if (lead.future) return null;
  const bundle = [lead];
  let total = pickWorth(state, lead);
  // Fill with the smallest pick that closes the gap, else the biggest left.
  const pool = [...rest].sort((a, b) => pickWorth(state, b) - pickWorth(state, a));
  while (total < target && pool.length && bundle.length < MAX_BUNDLE) {
    const gap = target - total;
    const closer = [...pool].reverse().find((p) => pickWorth(state, p) >= gap);
    const add = closer || pool[0];
    bundle.push(add);
    total += pickWorth(state, add);
    pool.splice(pool.indexOf(add), 1);
  }
  if (total < target || total > maxValue) return null;
  return { picks: bundle, total };
}

// How much a team loves a prospect at a pick: value (its own board has
// him better than the pick), its needs and its staff's fit — 0 to about 1.8.
function love(state, team, p, overall) {
  const value = Math.max(0, Math.min(1, (overall - teamRank(state, team, p)) / (6 + overall * 0.25)));
  const fit = Math.max(0, ((fitFor(p, team) || 0) - 70) / 30);
  return 0.6 * value + 0.6 * needPull(state, team, p, overall) + 0.6 * fit;
}
// A team's love for its best option on the board at a pick.
function bestLove(state, team, overall) {
  return Math.max(0, ...cpuAvailable(state).slice(0, 12).map((p) => love(state, team, p, overall)));
}

// How badly `team` wants a prospect that's on the board now (0 = not at all).
function desire(state, team, p, theirPick) {
  const fit = fitFor(p, team) || 0;
  const fitDesire = Math.max(0, (fit - 70) / 30);
  // Someone the board says won't last to their pick.
  const wontLast = p.rank < theirPick ? Math.min(1, (theirPick - p.rank) / 12) : 0;
  // Its needs: an Upgrade Needed is worth moving up for; a position it's
  // set at (or already drafted) isn't.
  const need = needPull(state, team, p, theirPick) * 0.6;
  return fitDesire * 0.8 + wontLast * 0.6 + need;
}

// Teams that would trade up into the pick on the clock, best offer first:
// [{ team, give: [pick], value, ratio, target: prospect }].
export function findTradeUpOffers(state, { max = MAX_OFFERS, threshold = 0.75 } = {}) {
  const pick = currentPick(state);
  if (!pick) return [];
  const target = pickValue(state.chart, pick.overall);
  const top = cpuAvailable(state).slice(0, 8);
  // A CPU team on the clock asks more the more it loves its options; the
  // user's own pick goes for the chart (they say yes or no themselves).
  const attachment = state.userTeams.includes(pick.owner) ? 0 : bestLove(state, pick.owner, pick.overall);
  const minRatio = TRADE_MIN_RATIO + ATTACHMENT_PREMIUM * attachment;
  const teams = [...new Set(state.picks.slice(state.idx + 1, state.idx + 1 + TRADE_WINDOW).map((p) => p.owner))]
    .filter((t) => t !== pick.owner && !state.userTeams.includes(t));
  const offers = [];
  teams.forEach((team) => {
    const theirs = futurePicksOf(state, team)[0];
    if (!theirs || theirs.future) return;
    let want = null;
    let wantScore = 0;
    // Moving up costs premium capital — not for a depth-only position, or
    // a quarterback when the room's full.
    top.forEach((p) => {
      if ((isPremium(pick.round, p) || isPremium(theirs.round, p)) && (depthOnly(state, team, p) || (p.Position === "QB" && qbRoomFull(state, team)))) return;
      const d = desire(state, team, p, theirs.overall);
      if (d > wantScore) { wantScore = d; want = p; }
    });
    if (!want || wantScore < threshold) return;
    // A team that really wants him will overpay a little more.
    const maxRatio = TRADE_MAX_RATIO + 0.2 * Math.max(0, wantScore - 1);
    if (minRatio > maxRatio) return;
    const bundle = bundleFor(state, team, target * minRatio, target * maxRatio);
    if (!bundle) return;
    offers.push({ team, give: bundle.picks.map((p) => p.overall), value: bundle.total, ratio: bundle.total / target, target: want, desire: wantScore, attachment });
  });
  return offers.sort((a, b) => b.desire - a.desire).slice(0, max);
}

// Swap the pick on the clock to offer.team for their offered picks.
export function acceptOffer(state, offer) {
  const pick = currentPick(state);
  if (!pick) return { state, event: null };
  const from = pick.owner;
  const swap = (p) => (offer.give.includes(p.overall) && !p.selection ? { ...p, owner: from, via: offer.team } : p);
  const swapped = [...state.picks.map(swap), ...(state.capital || []).map(swap)];
  const give = offer.give.map((o) => swapped.find((p) => p.overall === o));
  // tradeUp rides on the pick into its pick event: the desk tells the
  // trade and the selection together ("the Jets move up and get their guy").
  const picks = state.picks.map((p, i) => (i === state.idx ? { ...p, owner: offer.team, via: from, tradeUp: { from, give } } : swap(p)));
  const capital = (state.capital || []).map(swap);
  const event = {
    type: "trade",
    from, to: offer.team,
    pick: { ...pick },
    give,
    ratio: offer.ratio,
    target: offer.target,
    userInvolved: state.userTeams.includes(from),
  };
  const trades = [...(state.trades || []), { a: offer.team, b: from, aGot: [{ ...pick }], bGot: event.give }];
  return { state: { ...state, picks, capital, trades, offers: [] }, event };
}

// Before a CPU pick: sometimes a team behind it trades up for its guy.
// The setup screen's CPU Trades: a multiple of the usual chance (Frequent
// also lets a team that only fairly wants its guy call), capped at
// CPU_TRADE_CAP. Off: no CPU–CPU deals — the user's own offers still come.
export const CPU_TRADES = {
  off: { label: "Off", rate: 0, note: "No trades between CPU teams — offers to you still come in." },
  normal: { label: "Normal", rate: 1, threshold: 0.9, note: "Trades about as often as a real draft." },
  frequent: { label: "Frequent", rate: 2.5, threshold: 0.75, note: "Teams are on the phones — expect a lot more movement." },
};
const CPU_TRADE_CAP = 0.85;
function maybeCpuTrade(state) {
  const pick = currentPick(state);
  const level = CPU_TRADES[state.cpuTrades] || CPU_TRADES.normal;
  if (!pick || !level.rate) return null;
  const work = { seed: state.seed };
  const roll = random(work);
  const offer = findTradeUpOffers({ ...state, seed: work.seed }, { max: 1, threshold: level.threshold })[0];
  if (!offer) return null;
  // The bigger the gap between how much the caller wants his player and how
  // much the team on the clock loves its options, the likelier the deal.
  const gap = offer.desire - offer.attachment;
  const base = Math.min(TRADE_GAP_MAX, (CPU_TRADE_CHANCE[pick.round - 1] ?? 0.01) + TRADE_GAP_RATE * Math.max(0, gap - TRADE_GAP_START)) * state.chaos;
  const chance = Math.min(CPU_TRADE_CAP, base * level.rate);
  if (roll >= chance) return null;
  return acceptOffer({ ...state, seed: work.seed }, offer);
}

// User's pick on the clock: the trade offers waiting for them.
export function withOffers(state) {
  if (!isUserOnClock(state)) return state;
  return { ...state, offers: findTradeUpOffers(state) };
}

// ── Grades ──

const LETTERS = [[1.0, "A+"], [0.6, "A"], [0.3, "A-"], [0.1, "B+"], [-0.1, "B"], [-0.3, "B-"], [-0.6, "C+"], [-0.9, "C"], [-1.3, "C-"], [-Infinity, "D"]];
export const letterFor = (score) => LETTERS.find(([min]) => score >= min)[1];

// What filling a need adds to a pick's grade (a Crowded Room costs); a
// specific need counts SPECIFIC_WEIGHT of it.
const NEED_GRADE = { "Upgrade Needed": 0.5, "Expiring Contract": 0.35, "Aging Talent": 0.3, "Upgrade Wanted": 0.25, "Depth Needed": 0.15, "Crowded Room": -0.4 };
const needGrade = (need) => (need ? (NEED_GRADE[need.label] || 0) * (SPECIFIC_BY_KEY[need.key] ? SPECIFIC_WEIGHT : 1) : 0);

// One pick's grade score: board value for the slot, a little for staff
// fit, and the need it filled (need: the pick's own, from makePick) — so
// a reach that fills a hole can grade out, and value into a crowded room
// costs something.
export function pickScore(overall, prospect, team, need = null) {
  const value = isSpecialist(prospect) ? 0 : Math.max(-2, Math.min(2, (overall - prospect.rank) / (6 + overall * 0.25)));
  const fit = fitFor(prospect, team) || 0;
  return value + (fit >= 70 ? ((fit - 70) / 30) * 0.5 : 0) + needGrade(need);
}

// The needs a team came in with that a draft can be judged on (positions
// only, not specific roles or depth): [{ key, label }].
const URGENT = ["Upgrade Needed", "Expiring Contract", "Aging Talent", "Upgrade Wanted"];
function urgentNeeds(state, team) {
  return Object.entries(state.needs?.[team] || {})
    .filter(([key]) => NEED_KEYS.includes(key))
    .map(([key, n]) => ({ key, label: NEED_LABELS.find((l) => URGENT.includes(l) && n.labels.includes(l)) }))
    .filter((n) => n.label);
}

// A team's draft: [{ pick, prospect, score, letter, need }], its trades
// ([{ partner, got, gave }] — picks, this draft's and next year's), its needs
// ({ met, open }: the urgent ones it came in with — see urgentNeeds) and
// the overall grade: the picks' average, plus up to ±0.4 for how many of
// those needs it met (out of as many as it had picks to meet). The game is
// balancing the two: value alone leaves holes, needs alone are reaches.
export function teamHaul(state, team) {
  const rows = state.picks
    .filter((p) => p.owner === team && p.selection)
    .map((p) => {
      const prospect = state.byId[p.selection];
      const score = pickScore(p.overall, prospect, team, p.need);
      return { pick: p, prospect, score, letter: letterFor(score), need: p.need || null };
    });
  const urgent = urgentNeeds(state, team);
  const met = urgent.filter((n) => (state.needFilled?.[team]?.[n.key] || 0) >= 0.5);
  const open = urgent.filter((n) => !met.includes(n));
  const chances = Math.min(urgent.length, rows.length);
  const needScore = chances ? (Math.min(met.length, chances) / chances - 0.5) * 0.8 : 0;
  const avg = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length + needScore : 0;
  const trades = (state.trades || []).filter((t) => t.a === team || t.b === team)
    .map((t) => (t.a === team ? { partner: t.b, got: t.aGot, gave: t.bGot } : { partner: t.a, got: t.bGot, gave: t.aGot }));
  return { team, rows, score: avg, letter: rows.length ? letterFor(avg) : "—", needs: { met, open }, trades };
}

// ── User-proposed trades ──
// The CPU takes a deal when what it gets is worth at least this much of
// what it gives on the trade chart. Tune once players carry trade value.
export const CPU_ACCEPT_RATIO = 1.05;

// A team's picks that can still change hands: undrafted picks after the one
// on the clock (that one too when the user is on the clock), plus picks in
// rounds the sim isn't drafting. Earliest first.
export function tradeablePicks(state, team, { includeCurrent = false } = {}) {
  return [
    ...state.picks.filter((p, i) => p.owner === team && !p.selection && (i > state.idx || (includeCurrent && i === state.idx))),
    ...(state.capital || []).filter((p) => p.owner === team),
  ];
}

const chartTotal = (state, keys) => keys.reduce((a, k) => a + pickWorth(state, pickByKey(state, k)), 0);

// give: the user's pick numbers going to the partner; get: the partner's
// coming back. → { give, get (chart points), ratio (give / get), accept }.
export function evaluateProposal(state, { give = [], get = [] }) {
  const giveValue = chartTotal(state, give);
  const getValue = chartTotal(state, get);
  // Asking a CPU team for the pick it's on the clock with: it wants more the
  // more it loves who's there.
  const onClock = currentPick(state);
  const attachment = onClock && get.includes(onClock.overall) && !state.userTeams.includes(onClock.owner) ? bestLove(state, onClock.owner, onClock.overall) : 0;
  const accept = give.length > 0 && get.length > 0 && giveValue >= getValue * (CPU_ACCEPT_RATIO + ATTACHMENT_PREMIUM * attachment);
  return { give: giveValue, get: getValue, ratio: getValue ? giveValue / getValue : 0, accept };
}

// Swap the picks → { state, event } (event null when the CPU says no).
// force (Mock Draft mode): no CPU to ask — any two teams, any picks, even
// one side's picks for nothing.
export function applyProposal(state, { team, partner, give = [], get = [] }, { force = false } = {}) {
  // Every pick still there to trade — a CPU pick on the clock can be made
  // while the user's building the deal (stale: nothing swaps).
  const still = (n, owner) => tradeablePicks(state, owner, { includeCurrent: true }).some((p) => p.overall === n);
  if (!give.every((n) => still(n, team)) || !get.every((n) => still(n, partner))) {
    return { state, event: null, verdict: { ...evaluateProposal(state, { give, get }), accept: false, stale: true } };
  }
  const verdict = force
    ? { ...evaluateProposal(state, { give, get }), accept: give.length + get.length > 0 && team !== partner }
    : evaluateProposal(state, { give, get });
  if (!verdict.accept) return { state, event: null, verdict };
  const swap = (p) => {
    if (p.selection) return p;
    if (give.includes(p.overall) && p.owner === team) return { ...p, owner: partner, via: team };
    if (get.includes(p.overall) && p.owner === partner) return { ...p, owner: team, via: partner };
    return p;
  };
  let picks = state.picks.map(swap);
  const capital = (state.capital || []).map(swap);
  const all = [...picks, ...capital];
  const find = (n) => all.find((p) => p.overall === n);
  // Told the way the feed tells any trade: whoever lands the earliest pick
  // "moves up" to it.
  const earliest = Math.min(...give, ...get);
  const userMovesUp = get.includes(earliest);
  // A pick in this draft carries the trade up into its pick event (see acceptOffer).
  picks = picks.map((p) => (p.overall === earliest ? { ...p, tradeUp: { from: userMovesUp ? partner : team, give: (userMovesUp ? give : get).map(find) } } : p));
  const event = {
    type: "trade", proposed: true, userInvolved: true,
    to: userMovesUp ? team : partner, from: userMovesUp ? partner : team,
    pick: find(earliest),
    give: (userMovesUp ? give : get).map(find),
    ratio: userMovesUp ? verdict.ratio : verdict.ratio ? 1 / verdict.ratio : 0,
    target: null,
  };
  const trades = [...(state.trades || []), { a: team, b: partner, aGot: get.map(find), bGot: give.map(find) }];
  return { state: { ...state, picks, capital, trades, offers: [] }, event, verdict };
}
