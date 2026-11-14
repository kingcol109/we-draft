// src/utils/portalSim/config.js
//
// Portal Sim knobs — every number the models (./models.js) use, in one
// place. ALL PLACEHOLDERS (user, 2026-11-14: "build the infrastructure now,
// we will iron out specifics later"). The admin can override any of them
// (config/portalSim — components/AdminPortalSim.jsx); mergeConfig() lays
// those over these defaults.

export const DEFAULT_CONFIG = {
  // Signing windows. Window 1 opens with draft declarations and transfer
  // entries; later windows can add a few late entries.
  windows: 10,
  lateEntryWindows: [2, 3, 4],
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

  // Entering the portal (window 1).
  entryBase: { starter: 0.04, rotation: 0.12, reserve: 0.25, none: 0.15 },
  tierGapWeight: 0.6, // × per tier he's above his school
  overmatchedWeight: 0.25, // a reserve below his school's level looks for snaps
  homeStayMiles: 250, // home this close to campus…
  homeStayFactor: 0.6, // …makes leaving this much less likely
  lastYearFactor: 1.2, // one season left: graduate transfers
  maxEntry: 0.85,

  // Declaring for the draft (window 1), by stars: [≤2 seasons left, more].
  declare: { 6: [0.85, 0.6], 5: [0.6, 0.3], 4: [0.25, 0.08], 3: [0.02, 0], 2: [0, 0] },

  // Roster targets by position (starters a team wants) — drives needs.
  starters: { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 2, EDGE: 2, LB: 2, DB: 4, K: 1, P: 1 },

  // Choosing a school: weights on tier, playing time, NIL, location. Each
  // player draws his own around these (personality), plus a little noise.
  choiceWeights: { tier: 1.0, pt: 1.0, nil: 1.2, loc: 0.5 },
  personalitySpread: 0.35,
  choiceNoise: 0.15,
  // Commit when the best offer clears this, falling window by window
  // (start → end), so players get less picky as the portal winds down.
  commitThreshold: [1.7, 0.9],
  // Playing time a role offer is worth.
  ptValue: { starter: 1, rotation: 0.6, depth: 0.25 },

  // Team boards: how much each team's own taste moves its rankings (±).
  boardNoise: 0.25,
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
