// src/utils/portalSim/config.js
//
// Portal Sim knobs — every number the models (./models.js) use, in one
// place. ALL PLACEHOLDERS (user, 2026-11-14: "build the infrastructure now,
// we will iron out specifics later"). The admin can override any of them
// (config/portalSim — components/AdminPortalSim.jsx); mergeConfig() lays
// those over these defaults.

export const DEFAULT_CONFIG = {
  // Two opening windows (user, 2026-11-14), then the portal itself:
  //   Opening 1  NFL decisions — who leaves for the draft; on-the-fence
  //              players can be retained
  //   Opening 2  retention — players who want to transfer; teams negotiate
  //              to keep them, the rest enter the portal
  // Then `windows` portal windows. Players enter the portal only in opening
  // window 2 (user, 2026-11-14) — lateEntryWindows (portal windows that add
  // late entries) stays empty.
  windows: 5,
  // The run's choices at the start (user, 2026-11-15): portal length (5 —
  // the default — or 10 windows; each has its own list narrowing) and
  // transfer frequency — × each player's modeled chance of wanting out
  // (capped at entryCap). Default = the tuned model. Admin likeliness
  // (0–3) isn't scaled — those chances are set by hand.
  windowOptions: [5, 10],
  listSizeByWindows: { 5: [null, null, 8, 5, 3, 3], 10: [null, null, 10, 8, 6, 5, 4, 3, 3, 3, 3] },
  frequency: { less: 0.6, default: 1, more: 1.6, crazy: 2.6 },
  entryCap: 0.97,
  lateEntryWindows: [],
  lateEntryFactor: 0.15,

  // Team tiers: 1 = blue blood … 5 = bottom of FBS. A team's tier sets its
  // NIL budget, how many players it chases a window, and how attractive it is.
  tiers: [1, 2, 3, 4, 5],
  tierLabels: { 1: "Blue Blood", 2: "Power Contender", 3: "Power Program", 4: "Group of 5 Plus", 5: "Group of 5" },
  // Portal NIL budget by tier ($).
  budgets: { 1: 20000000, 2: 12000000, 3: 7000000, 4: 3000000, 5: 1500000 },
  // Offers a CPU team makes per window, by tier.
  offersPerWindow: { 1: 9, 2: 9, 3: 8, 4: 8, 5: 7 },
  // How hard a tier bids, × the player's ask.
  aggressiveness: { 1: 1.15, 2: 1.05, 3: 1.0, 4: 0.9, 5: 0.85 },

  // Players. What a transfer star asks for in NIL ($), before his own noise.
  askByStars: { 6: 2500000, 5: 1200000, 4: 500000, 3: 150000, 2: 40000 },
  // The tier a player "belongs" at, by stars — the bigger the gap to his
  // school's tier, the likelier he leaves.
  idealTier: { 6: 1, 5: 1.5, 4: 2.5, 3: 3.5, 2: 4.5 },

  // ── Opening window 1: the NFL ──
  // Out of eligibility (0 seasons left) or Declared on We-Draft: gone.
  // Draft-eligible = at least three seasons in college = this many seasons
  // of eligibility left, at most.
  draftEligibleMaxElig: 2,
  // Chance he leaves, by community draft grade (1 = Early First … 10 = UDFA).
  // High first-rounders always go; Day 2 often; Day 3 less often.
  declareByGrade: { 1: 1, 2: 0.97, 3: 0.88, 4: 0.75, 5: 0.62, 6: 0.4, 7: 0.3, 8: 0.22, 9: 0.15, 10: 0.05 },
  // On the fence (retainable) between these; at or above the top he's gone,
  // below the bottom he's back.
  nflFence: [0.1, 0.9],
  // What it takes to keep a draft prospect: his ask × this.
  nflAskFactor: 1.5,
  // How much a full retention offer can cut his chance of leaving, by grade —
  // first-rounders barely move, Day 3 guys can be talked into another year.
  nflRetainPower: { 1: 0, 2: 0.1, 3: 0.25, 4: 0.45, 5: 0.55, 6: 0.7, 7: 0.75, 8: 0.8, 9: 0.85, 10: 0.9 },

  // ── Grading schools (user, 2026-11-14) ──
  // Every player grades every school — his own included — on six factors,
  // each 0..1: program tier, NIL offered (vs his ask), proximity to home,
  // playing time (the room: how many better players it has at his position
  // vs the starters it plays — departures in front of him count), recent
  // success (team records) and player development (recent draft picks at his
  // position). His grade = his personality's weighted average of the six.
  // Interests (user, 2026-11-14): every player gets three A's, a B, a C and
  // an F across the six, drawn fresh every run — choiceWeights make a factor
  // likelier to be an A (and less likely to be the F). letterWeights: what
  // each letter counts in his grade (A's 80% together).
  choiceWeights: { tier: 0.8, nil: 1.2, loc: 0.6, pt: 2.2, success: 0.7, dev: 0.8 },
  letterWeights: { A: 0.8 / 3, B: 0.1, C: 0.07, F: 0.03 },
  // A school scoring under `below` on `count` or more of his A's: cut from
  // his list right away.
  cutBadA: { below: 0.35, count: 2 },
  // His overall grade of an offer: A–F grade × factors + the recruiting
  // process × process (3 : 1). The process: happiness × happy + interest
  // built (of earlyInterest.cap) × interest.
  gradeMix: { factors: 0.75, process: 0.25 },
  process: { happy: 0.7, interest: 0.3 },
  choiceNoise: 0.04, // ± grade noise on each offer
  // Recent success: win % weights, newest season first.
  successYearWeights: [0.4, 0.3, 0.2, 0.1],
  // Player development: drafts counted, pick weight by round (1st, 2nd–3rd,
  // 4th–7th), and the older half's weight.
  devDrafts: 8,
  devRoundWeight: [3, 2, 1],
  devOlderWeight: 0.6,
  // Development × (devPtFloor + (1 − devPtFloor) × playing time): a school's
  // NFL pipeline matters less to a player buried on its depth chart.
  devPtFloor: 0.35,
  // Playing time from the room: better players ahead of him vs starters.
  roomPt: { starter: 1, rotation: 0.6, depth: 0.3, buried: 0.1 },
  // What he already makes at his school, × his ask (his home NIL before any
  // retention offer).
  homeNil: 0.6,

  // ── Opening window 2: who wants to leave ──
  // Each player grades his school against the market — a typical school at
  // his level (his ideal tier, his ask, an average location / success /
  // development, the playing time below). The further the market beats home,
  // the likelier he enters: maxEntry × logistic((market − home − entryBias)
  // / entryTemp). A retention offer raises his home grade; he stays when that
  // pulls his chance of leaving below his draw.
  marketPt: { 6: 0.9, 5: 0.85, 4: 0.8, 3: 0.75, 2: 0.65 },
  // The market's tier: his stars' ideal tier, pulled this far toward his
  // school's (0 = stars only, 1 = his school's level).
  marketHomePull: 0.6,
  // Ambition: grade points added to the market per tier his school sits
  // below his stars' level, × how much he played and his stars.
  // Bench frustration: grade points added to the market for a talented
  // player who won't play — × (1 − the playing time his room leaves him) ×
  // his years in school (1 = after his true freshman season: slight).
  bench: { stars: { 2: 0.02, 3: 0.12, 4: 0.28, 5: 0.34, 6: 0.36 }, years: { 1: 0.25, 2: 0.7, 3: 1 } },
  // Narrowing his list: the schools he's still listening to after each
  // portal window (index = window; null = all). The rest are cut — and can't
  // offer him again.
  listSize: [null, null, 8, 5, 3, 3],
  ambition: { perTier: 0.15, role: { starter: 1, rotation: 0.6, reserve: 0.15, none: 0 }, stars: { 6: 1.3, 5: 1.2, 4: 1.1, 3: 1, 2: 0.4 } },
  // Transfer likeliness (user, 2026-11-14), set per player on the admin's
  // Grades tab: his chance of entering, replacing the model's — 3 every time
  // (no retention offer moves him), 2 about two runs in three, 1 about once
  // every 4 runs, 0 never (a retention offer scales 1s and 2s down, less the
  // likelier he is to go; set a bit over the targets for that). No
  // likeliness = the model alone.
  likeliness: { 1: 0.28, 2: 0.73, 3: 1 },
  entryBias: 0.21,
  entryTemp: 0.06,
  maxEntry: 0.85,
  retainMix: { nil: 0.6, pt: 0.4 }, // NFL fence retention offers' pull

  // ── CPU retention (both opening windows) ──
  // Share of the NIL budget a CPU team will spend keeping its own players.
  retentionShare: 0.35,
  // Urgency at a position: 1 + this × (starters/rotation players lost there
  // ÷ starters it needs) — lose a lot at a spot, fight harder to keep the rest.
  urgencyWeight: 0.6,
  urgencyCap: 1.6,
  // A player's worth to keep: value × role × urgency, at least retainMinWorth.
  roleWorth: { starter: 1, rotation: 0.7, reserve: 0.35, none: 0.2 },
  retainMinWorth: 15,

  // Home this close to campus counts as near (for "closer to home").
  homeStayMiles: 250,

  // Roster targets by position (starters a team wants) — drives needs.
  starters: { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 2, EDGE: 2, LB: 2, DB: 4, K: 1, P: 1 },

  // Recruitments: interest an offer builds each window it stands (grade
  // points, capped) — offering early helps.
  earlyInterest: { perWindow: 0.03, cap: 0.12 },
  // A NIL offer this many × his ask commits him on the spot, any window —
  // by his NIL letter: the less NIL matters, the more it takes (F: never).
  instantCommitAsk: { A: 3, B: 4, C: 6, F: null },
  // Happiness (user, 2026-11-14): each player's 0–100 feeling about each
  // school, 100 to start. A lowball (under lowballAsk × his ask), offering less
  // than before and pulling an offer each knock it down; below 100 it costs
  // that school up to `penalty` grade points (at 0). A brake on user offer
  // spam — CPU schools never do these.
  happiness: { lowballAsk: 0.6, lowball: 15, lower: 25, pulled: 35, penalty: 0.2 },
  // A player sizing up a room: better players a team is still chasing at his
  // position (outstanding offers) count this much each (signings count fully
  // — they're on the roster).
  offerRoomWeight: 0.5,
  // Commit when the best offer's grade reaches this share of his market
  // grade, falling window by window (start → end), so players get less
  // picky as the portal winds down.
  commitShare: [1.0, 0.75],


  // Team boards: how much each team's own taste moves its rankings (±).
  boardNoise: 0.25,

  // CPU schools' offers (user, 2026-11-14). An open offer counts as a
  // signing (one QB spot → one QB chased at a time).
  cpu: {
    // Rotation players a team wants behind its starters (open spots fill
    // these too); a depth-only spot ranks at depthNeed.
    depth: { QB: 0, RB: 1, WR: 2, TE: 1, OL: 2, DL: 2, EDGE: 1, LB: 1, DB: 2, K: 0, P: 0 },
    depthNeed: 0.4,
    // How hard a team chases a transfer by stars (× its interest) — the
    // top of the portal draws the most.
    starPull: { 6: 3, 5: 2.3, 4: 1.6, 3: 1, 2: 0.6 },
    // Its board's taste moves its price: ask × e^(taste × this), taste −1..1
    // (× valueCenter — ≈ 0.55×–1.8× before the best bid wins) — the market's randomness.
    valueSpread: 0.6,
    // Where teams' prices center, × his ask. Several bidders → the best bid
    // wins, so a bit under 1 keeps the deals themselves averaging near his
    // ask (the market price): some well over, some at a discount.
    valueCenter: 0.7,
    // Extra for a top transfer at a position it really needs.
    topPremium: { 6: 1.25, 5: 1.2, 4: 1.1 },
    // ± half of this on its price each window.
    windowNoise: 0.1,
    // Kept back for each other open spot: the ask of a typical target at
    // its tier (stars) × reserveShare.
    reserveStars: { 1: 4, 2: 4, 3: 3, 4: 3, 5: 2 },
    reserveShare: 0.75,
    // Short on money, it offers what's left if that's at least this share
    // of its price and of his ask — else it moves on.
    stretch: 0.85,
    // Realistic targets only: his grade of the school with its offer must
    // reach this share of his commit bar this window.
    realism: 0.9,
  },
};

// Admin overrides (config/portalSim) over the defaults, one level deep.
export function mergeConfig(over = {}) {
  const out = { ...DEFAULT_CONFIG };
  Object.entries(over || {}).forEach(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof DEFAULT_CONFIG[k] === "object" && !Array.isArray(DEFAULT_CONFIG[k])) out[k] = { ...DEFAULT_CONFIG[k], ...v };
    else if (v != null) out[k] = v;
  });
  return out;
}

// A starting tier per FBS team before the admin sets them: conference
// level, with a short list of blue bloods. The admin's tiers win.
const BLUE_BLOODS = ["Ohio State", "Georgia", "Alabama", "Texas", "Oregon", "Michigan", "LSU", "Notre Dame", "USC", "Penn State", "Miami", "Clemson", "Texas A&M", "Florida State", "Oklahoma", "Tennessee"];
const CONF_TIER = { SEC: 2, "Big 10": 2, ACC: 3, "Big 12": 3, "Pac 12": 4, Independent: 4, AAC: 4, "Mountain West": 4, "Sun Belt": 5, CUSA: 5, MAC: 5 };
export const defaultTier = (school, conference) => (BLUE_BLOODS.includes(school) ? 1 : CONF_TIER[conference] || 5);
