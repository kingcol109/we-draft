// src/utils/recruitSim/config.js
//
// Recruit Sim knobs — every number the simulation uses lives here so the
// game can be balanced without touching the engine (spec §30). An admin
// override doc (config/recruitSim, optional) is merged over these one level
// deep by mergeConfig(), like the Portal Sim's config/portalSim.
//
// Scales used throughout:
//   rating / trait / overall   0–100ish; HS recruits live in ~60–100
//   interest                   accumulated points (no decay, spec §16)
//   money                      dollars

export const DEFAULT_CONFIG = {
  // ── The class (spec §3) ──
  classSize: 3000,
  // Share of the class at each position (sums to 1).
  positions: { QB: 0.075, RB: 0.085, WR: 0.155, TE: 0.06, OL: 0.17, EDGE: 0.09, DL: 0.09, LB: 0.105, DB: 0.17 },
  // Public We-Draft rating by national rank — piecewise linear knots
  // [rank, rating]. Stars come from the rating (starCuts).
  ratingKnots: [[1, 99.6], [12, 97.4], [35, 95], [120, 91.5], [350, 88], [900, 84.5], [2000, 79], [3000, 70.5]],
  starCuts: { 5: 95, 4: 88, 3: 79, 2: 0 },
  // True overall = public rating + noise. Most are close; a fat tail makes
  // real over- and under-rated prospects (a 97 who's really 87, an 85 who's
  // really 94). sd's in rating points.
  trueNoise: { sd: 2.4, tailShare: 0.2, tailSd: 5.5, clamp: [55, 99] },
  // How far a trait strays from his overall (before the formula is
  // re-centered on his true overall), and how much each category drifts as
  // a block — a "raw athlete" has Physical up, Technique down, etc.
  traitSd: 4.5,
  categorySd: 4,
  // Raw-vs-polished pull: a positive draw lifts Physical and sinks the
  // skill categories (or the reverse) — the profile development reads.
  rawPolishSd: 3.5,
  traitClamp: [40, 100],
  // Potential (user, 2026-11-18): its own grade on the trait scale —
  // center ± sd, correlated (athleticCorr) with how good his Physical grades
  // are against the class, so athletic traits hint at it without defining it.
  // On commitment it sets his jump: (pot − center) × jumpPerPoint ± noise.
  //   A+ ≈ +6 · B ≈ +1 · C+ ≈ 0 · D ≈ −5 · F ≈ −7
  // The jump plays out over his senior season (user, 2026-11-18): fall
  // weeks 1–12 each carry a share of it (a seeded, uneven path — some kids
  // take off early, some late), done by Signing Day. Anyone whose staff has
  // seen him can read the trend (not the number).
  potential: { center: 80, sd: 8, athleticCorr: 0.55, clamp: [50, 100], jumpPerPoint: 0.35, jumpNoise: 1, jumpMax: 10, pathSd: 0.9 },
  // Geographic balance: no region's share of the class may fall below `min`
  // or above `max` of the class (spec §9 "avoid extreme imbalances").
  regionShare: { min: 0.08, max: 0.24 },
  // Body jitter around the real roster frame drawn (in, lb), and how much
  // lighter a HS senior is than a college freshman.
  body: { htJitter: 1, wtJitter: 8, hsLighter: 6 },
  // Name variety: a last name appears at most this many times per class.
  maxLastName: 9,

  // ── Grades (spec §4) ──
  // Exact grades with plus / minus: value ≥ cut. Ranges use the letter
  // families (A, B, C, D, F) — two adjacent families, always containing the
  // true one (spec §7).
  gradeCuts: [["A+", 96], ["A", 93], ["A-", 90], ["B+", 87], ["B", 84], ["B-", 81], ["C+", 78], ["C", 75], ["C-", 72], ["D+", 69], ["D", 66], ["D-", 63], ["F", -Infinity]],

  // ── Calendar (spec §10) ──
  // 16 stages; fall weeks are dated from Sept 1.
  fallStart: "09-01",

  // ── Board (spec §12–15) ──
  board: {
    size: { spring: 10, summer: 25, fall: 35 }, // spring 10 (user, 2026-11-17)
    line: { spring: 0, summer: 10, fall: 25 },
    // Interest a window from being on the board at all (below the line, or
    // anyone in spring).
    baseGain: 2.2,
    // Above the line: rank 1 gets max, the last ranked min; curve > 1 makes
    // the top of the line count more.
    above: { max: 13, min: 5.5, curve: 1.35 },
    // Closer to campus = bigger board boosts (user, 2026-11-17). df is the
    // 0..1 proximity (1 = in your backyard): interest × (1 + interest·df),
    // and one extra scouting look with chance scout·df.
    near: { interest: 0.45, scout: 1 },
    // How a recruit sees his school's playing time (spec §16 "playing-time
    // opportunity"): recruits at his position ranked above him on that
    // school's board (and already committed there) count against him.
    ptAheadPenalty: 0.22, // per recruit ahead, at his position (× his PT weight)
    ptCommitPenalty: 0.3, // per committed recruit at his position
    ptRoomFree: { QB: 0, RB: 1, WR: 2, TE: 1, OL: 3, EDGE: 1, DL: 1, LB: 1, DB: 2 }, // ahead-of-him a room absorbs before it hurts
  },
  // A school signs at most this many (scholarships). A recruit won't pick a
  // school that's full.
  classLimit: 25,

  // ── Staff (spec §8) ──
  staff: {
    // Coaches' interest per window with one recruit (× his fit).
    coachGain: { HC: 9, OC: 7, DC: 7 },
    // Area work: visits a window (recruits chosen by public rating,
    // weightPow), interest each.
    areaVisits: { HC: 40, OC: 34, DC: 34 },
    areaGain: 1.6,
    areaWeightPow: 2.2,
    // Recommendations: per area visit, chance the coach falls for a prospect
    // he saw — driven by how much better the kid really is than his public
    // rating (underrated), or simply very good. maxPerWindow per coach.
    recommend: { underBy: 3, chancePerPoint: 0.035, eliteOvr: 92, eliteChance: 0.012, maxPerWindow: 2, individualChance: 0.08 },
    // Scouts build a little interest too — less than coaches (user, 2026-11-18):
    // per window on an individual target, and per recruit looked at in an area.
    scoutGain: { recruit: 3, area: 0.5 },
    // Relationships (user, 2026-11-18): every window a staffer spends on a
    // kid makes the next one count more — own visits (that staffer) and,
    // less, the rest of the staff's. Capped. A coach on the kid he
    // recommended ("his guy") gets more; a coordinator can recruit the other
    // side of the ball, just not as well. Contact on a regional trip counts
    // as `area` of a window (once per staffer per kid per window).
    bond: { own: 0.15, others: 0.05, cap: 6, hisGuy: 1.3, offSide: 0.6, area: 0.25 },
  },
  // ── Scouting (spec §7) ──
  scouting: {
    boardRolls: [2, 3], // per board recruit per window (inclusive) — user, 2026-11-17
    // Individual assignment rolls: [scout][side of the ball].
    individual: { HS: { off: 12, def: 12 }, OS: { off: 10, def: 5 }, DS: { off: 5, def: 10 } },
    // Regional / positional scouting: many more rolls, spread across the
    // eligible recruits; ranges only. Rolls for a scout covering only one
    // position are concentrated (posFocusBonus).
    regional: { HS: 150, OS: 130, DS: 130 },
    regionalPosFocus: 0.75, // × rolls when the scout narrows to one position (fewer kids, deeper looks)
    regionalWeightPow: 0.8, // how much public rating steers regional looks (0 = even)
    // Trait selection weights.
    pick: { unknown: 1, range: 0.85, rangeRegional: 0.12, exact: 0.04 },
    // Potential is revealed on ~1 look in 500 (user, 2026-11-18).
    potentialChance: 0.002,
  },

  // ── Interest & preferences (spec §16–17) ──
  // Preference factors and how likely each is to be one he cares about.
  prefFactors: ["brand", "dist", "dev", "nil", "pt", "win"],
  prefBias: { brand: 1.1, dist: 0.9, dev: 1, nil: 1.05, pt: 1.15, win: 0.85 },
  prefShape: 1.6, // gamma-ish shape: higher → flatter profiles
  // Brand by tier (spec §21; overrides per school in brandOverrides).
  brandByTier: { 1: 1, 2: 0.8, 3: 0.6, 4: 0.38, 5: 0.22 },
  brandOverrides: {},
  // Distance: full credit within near miles, none past far.
  distance: { near: 120, far: 1400 },
  // Activity gains × (fitFloor + fitSpan × his fit with that school).
  fitFloor: 0.4,
  fitSpan: 1.2,
  // Starting interest from attractiveness alone — small (spec §16).
  startInterest: 3,
  // Standing (his ranking of schools) = interest × (fit / 0.5)^fitPow.
  fitPow: 1.3,

  // ── NIL (spec §20) ──
  budgets: { 1: 15000000, 2: 10000000, 3: 6000000, 4: 3000000, 5: 1500000 },
  // Expected NIL by national rank (knots), × his NIL care (nilCare) and noise.
  askKnots: [[1, 1600000], [10, 1200000], [35, 800000], [120, 450000], [350, 220000], [900, 90000], [2000, 30000], [3000, 12000]],
  nilCare: { low: 0.75, high: 1.3 },
  askNoise: 0.15,
  askDevPerPoint: 0.06, // ask × (1 + this × his overall change)
  minOffer: 5000,
  offerStep: 5000,
  // NIL interest a window = gain × his NIL weight factor × saturation(offer / ask).
  nilGain: 9,
  nilSat: 1.6, // 1 − e^(−sat × ratio), normalized at ratio 1
  nilCap: 1.6, // ratios above this add nothing
  // Cutting an offer: −penalty × share cut (× regressShield if he's regressed).
  nilCutPenalty: 14,
  regressShield: 0.4,
  requireOffers: { summer: false, fall: false }, // NIL never required (user, 2026-11-18)

  // ── Lifecycle (spec §18) ──
  lifecycle: {
    // Top 10 announcement week (fall week numbers), by draw.
    top10: [1, 5],
    finalAfter: [1, 3], // weeks after his top 10
    finalSize: [2, 4],
    // When he commits (user, 2026-11-18: spread through the fall, not all at
    // the end): early (W1–4), mid (5–8), late (9–12), signing day. He can
    // commit straight from his top 10 — a final list isn't required.
    commitShares: { early: 0.26, mid: 0.32, late: 0.28, signing: 0.14 },
    commitWeeks: { early: [1, 3], mid: [4, 7], late: [8, 11] },
    earliestCommit: 1,
    // Readiness: the leader needs interest ≥ this (× his rating factor) or he waits.
    ready: 30,
    readyDelay: [1, 3],
    // Decision softmax temperature: p ∝ exp(sharp × score / best).
    sharp: 9,
    // Top 10 is binding (schools off it can't make his finals).
    top10Binding: true,
    minInterestToList: 4,
    // A clear favorite pulls a commitment forward (user, 2026-11-18: "if he
    // likes a school, it has him high and nobody else is really recruiting
    // him, he should commit sooner"). Chance per window:
    //   base + dom × (lead over No. 2, scaled) + alone (no real rival)
    // × how high the leader has him on its line, × summer / elite damping.
    pull: { base: 0.05, dom: 0.24, domFrom: 1.25, domSpan: 1.5, alone: 0.2, rival: 0.35, max: 0.65, summer: 0.45, elite: 0.6, lineTop: 8, lineMid: 15, readyShare: 0.5 },
    // Decision dates: when he's ready he sets a date — the end of the next
    // window — and picks between his finalists (up to 3, anyone within
    // `close` of the leader) then. One last week to push. Signing Day,
    // demands and a list of one are immediate.
    announce: { finalists: 3, close: 0.35 },
  },
  demands: {
    chance: 0.05, // per fall week, a recruit with you in his top 3 (above the line)
    // NIL ultimatums only late in a recruitment (user, 2026-11-17): from this
    // fall week, with him down to a top 10 / final list and the school in his
    // top 2. Meeting the number commits him on the spot (actions.setOffer).
    nilFromWeek: 8,
    nilOver: [1.1, 1.35], // asks this × his ask (or your offer + 15%)
    ptChance: 0.5, // of a demand, PT when he cares about PT and you have someone ahead
    ptGain: 12,
    expires: 1, // windows
  },

  // ── Final class report card (user, 2026-11-18) ──
  // Parts graded against the whole field (talent, NIL value, evaluation) or
  // outright (needs, size); the overall is the weighted mix.
  report: { weights: { talent: 0.42, nil: 0.16, needs: 0.2, eval: 0.12, size: 0.1 } },

  // ── CPU (spec §23) ──
  cpu: {
    // Staff bias: each CPU staff likes some positions / categories more.
    biasSd: 1.6,
    catBiasSd: 0.12,
    // Target value = (eval − floor)^pow; tier floors (who's worth chasing).
    valueFloor: { 1: 80, 2: 77, 3: 74, 4: 70, 5: 66 },
    valuePow: { 1: 2.4, 2: 2.1, 3: 1.8, 4: 1.5, 5: 1.3 },
    // Attainability weight: utility = value × pWin^attain.
    // Lower = aims higher (user, 2026-11-18: more schools in on each kid).
    attain: { 1: 0.45, 2: 0.6, 3: 0.8, 4: 1.0, 5: 1.15 },
    // Distance pull for low tiers: utility × (1 − distPull × (1 − dist fit)).
    distPull: { 1: 0, 2: 0.08, 3: 0.2, 4: 0.38, 5: 0.5 },
    // Reach slots: low tiers occasionally go after an elite prospect.
    reach: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
    reachChance: 0.5,
    // Class plan by position (scaled to classLimit).
    plan: { QB: 1.5, RB: 2, WR: 4, TE: 1.5, OL: 5, EDGE: 2.5, DL: 2.5, LB: 3, DB: 5 },
    boardPerPlan: 1.5, // board slots per planned signing
    // Keep a target unless a replacement is this much better (no churn).
    replaceMargin: 2.0,
    // A target whose list still includes us is kept harder still.
    listKeep: 2.5,
    // Candidates scored a window (top by quick score).
    candidates: 260,
    // NIL: × his ask, by tier, then × value share.
    nilAggr: { 1: 1.15, 2: 1.05, 3: 1, 4: 0.95, 5: 0.9 },
    nilReserve: 0.12, // keep this share of the budget back until late fall
    // Spend what you have: offers scale up toward the budget, at most this × his ask.
    nilMaxOver: { 1: 1.8, 2: 1.6, 3: 1.4, 4: 1.3, 5: 1.2 },
    // Urgency as the season runs out with spots open: the value floor drops
    // by up to lowerFloor points and attainability weighs up to attainLate more.
    lowerFloor: 9,
    attainLate: 0.8,
    // pWin prior before interest builds: 1 / (1 + his fit rank of us / priorDiv)^priorPow.
    priorDiv: 5,
    priorPow: 1.3,
    // Catch-up: windows left × typical gain vs. the gap to the leader.
    catchUpGain: 16,
    catchUpCut: 0.35, // × pWin when it can't realistically catch up (was 0.1 — gave up too easily)
    // NIL bidding (user, 2026-11-18): for the players a school wants most
    // (top `matchTop` on its line), a bigger offer elsewhere gets matched or
    // beaten by matchOver, up to matchCap × his ask, if the money is there.
    matchTop: 8,
    matchOver: [1.02, 1.12],
    matchCap: { 1: 2.6, 2: 2.3, 3: 2.0, 4: 1.8, 5: 1.6 },
  },
};

// Admin overrides (config/recruitSim .config) over the defaults, one level deep.
export function mergeConfig(over = {}) {
  const out = { ...DEFAULT_CONFIG };
  Object.entries(over || {}).forEach(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof DEFAULT_CONFIG[k] === "object" && !Array.isArray(DEFAULT_CONFIG[k])) out[k] = { ...DEFAULT_CONFIG[k], ...v };
    else if (v != null) out[k] = v;
  });
  return out;
}

// ── Calendar (spec §10) ──
// 16 stages. key, label, phase (board rules), fall week (0 = not fall).
export const STAGES = [
  { key: "winter", label: "Winter", phase: "winter", week: 0 },
  { key: "spring", label: "Spring", phase: "spring", week: 0 },
  { key: "summer", label: "Summer", phase: "summer", week: 0 },
  ...Array.from({ length: 12 }, (_, i) => ({ key: `fall${i + 1}`, label: `Fall Week ${i + 1}`, phase: "fall", week: i + 1 })),
  { key: "signing", label: "Signing Day", phase: "signing", week: 13 },
];
export const STAGE_COUNT = STAGES.length; // 16

// Fall week n's date ("Sep 1" + 7(n−1) days), for headers.
export function stageDate(stage, year = 2026) {
  const s = STAGES[stage];
  if (!s) return "";
  if (s.phase !== "fall" && s.phase !== "signing") return { winter: "January", spring: "April", summer: "June" }[s.phase] || "";
  if (s.phase === "signing") return "December";
  const d = new Date(Date.UTC(year, 8, 1 + 7 * (s.week - 1)));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
