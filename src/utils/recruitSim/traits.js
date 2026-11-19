// src/utils/recruitSim/traits.js
//
// Position-specific traits (spec §4), the grade scale, and the formulas that
// turn underlying traits into category grades and the true overall. Category
// grades and overall are ALWAYS derived from traits — never stored as their
// own random numbers — so a trait change flows through everything.
//
// Trait slot order per position is fixed: slots 0..n-1 are the traits in the
// order listed (instincts, technique, physical); the last knowledge slot
// (POT_SLOT) is Potential.

export const CATS = ["ins", "tec", "phy"];
export const CAT_LABEL = { ins: "Instincts", tec: "Technique", phy: "Physical" };

// [name, category, weight within its category]
// 3 per group, 9 per position (user, 2026-11-17).
export const TRAIT_MAP = {
  QB: [["Processing", "ins", 1.1], ["Decision Making", "ins", 1.1], ["Pocket Presence", "ins", 0.8], ["Throwing Motion", "tec", 0.9], ["Arm Talent", "tec", 1.1], ["Footwork", "tec", 0.9], ["Arm Strength", "phy", 1], ["Athleticism", "phy", 0.8], ["Strength", "phy", 0.7]],
  RB: [["Patience", "ins", 0.8], ["Vision", "ins", 1.2], ["Timing", "ins", 0.9], ["Contact Balance", "tec", 1.1], ["Receiving Ability", "tec", 0.8], ["Elusiveness", "tec", 1.1], ["Explosiveness", "phy", 1.1], ["COD", "phy", 1], ["Speed", "phy", 1]],
  WR: [["RAC", "ins", 1], ["Spatial Awareness", "ins", 1], ["Physicality", "ins", 0.9], ["Release", "tec", 1], ["Route Running", "tec", 1.2], ["Ball Skills", "tec", 1], ["Explosiveness", "phy", 1], ["COD", "phy", 0.9], ["Speed", "phy", 1.1]],
  TE: [["RAC", "ins", 1], ["Spatial Awareness", "ins", 1], ["Physicality", "ins", 1], ["Route Running", "tec", 1], ["Blocking", "tec", 1], ["Ball Skills", "tec", 1], ["Explosiveness", "phy", 1], ["Strength", "phy", 1], ["Quickness", "phy", 0.9]],
  OL: [["Awareness", "ins", 1], ["Run Blocking Instincts", "ins", 1], ["Pass Protection Instincts", "ins", 1.1], ["Pass Protection Technique", "tec", 1.2], ["Run Blocking Technique", "tec", 1], ["Hand Use", "tec", 0.9], ["Strength", "phy", 1.1], ["Quickness", "phy", 0.9], ["Flexibility", "phy", 0.8]],
  EDGE: [["Play Recognition", "ins", 0.9], ["Pass Rush Plan", "ins", 1.1], ["Physicality", "ins", 0.9], ["Pad Level", "tec", 0.9], ["Power Rush", "tec", 1], ["Speed Rush", "tec", 1.1], ["Explosiveness", "phy", 1.2], ["Strength", "phy", 0.9], ["Quickness", "phy", 1]],
  DL: [["Play Recognition", "ins", 1.1], ["Pass Rush Plan", "ins", 0.9], ["Physicality", "ins", 1], ["Pad Level", "tec", 1.1], ["Power Rush", "tec", 1.1], ["Speed Rush", "tec", 0.9], ["Explosiveness", "phy", 1], ["Strength", "phy", 1.2], ["Quickness", "phy", 0.9]],
  LB: [["Play Recognition", "ins", 1.2], ["Zone Instincts", "ins", 0.9], ["Physicality", "ins", 1], ["Block Shedding", "tec", 0.9], ["Tackling", "tec", 1.1], ["Man Coverage", "tec", 0.8], ["Speed", "phy", 1.1], ["Stopping Power", "phy", 0.9], ["Quickness", "phy", 0.9]],
  DB: [["Zone Instincts", "ins", 1], ["Ball Hawk", "ins", 0.9], ["Play Recognition", "ins", 1], ["Run Support", "tec", 0.7], ["Man Coverage", "tec", 1.2], ["Ball Skills", "tec", 1], ["Speed", "phy", 1.2], ["Fluidity", "phy", 1], ["Explosiveness", "phy", 1]],
};
export const POSITIONS = Object.keys(TRAIT_MAP);
export const OFFENSE = new Set(["QB", "RB", "WR", "TE", "OL"]);
export const sideOf = (pos) => (OFFENSE.has(pos) ? "off" : "def");

// How much each category counts toward the true overall, by position — not
// an even average (spec §4).
export const CAT_WEIGHTS = {
  QB: { ins: 0.42, tec: 0.36, phy: 0.22 },
  RB: { ins: 0.27, tec: 0.3, phy: 0.43 },
  WR: { ins: 0.2, tec: 0.42, phy: 0.38 },
  TE: { ins: 0.2, tec: 0.42, phy: 0.38 },
  OL: { ins: 0.2, tec: 0.45, phy: 0.35 },
  EDGE: { ins: 0.24, tec: 0.31, phy: 0.45 },
  DL: { ins: 0.24, tec: 0.34, phy: 0.42 },
  LB: { ins: 0.36, tec: 0.32, phy: 0.32 },
  DB: { ins: 0.3, tec: 0.32, phy: 0.38 },
};

// Knowledge slots per recruit: max traits (9) + potential.
export const KT = 10;
export const POT_SLOT = 9;

export const traitsOf = (pos) => TRAIT_MAP[pos];

// Category values (weighted averages of its traits), from a trait array.
export function categoryValues(pos, traits) {
  const sums = { ins: 0, tec: 0, phy: 0 };
  const ws = { ins: 0, tec: 0, phy: 0 };
  TRAIT_MAP[pos].forEach(([, c, w], i) => { sums[c] += traits[i] * w; ws[c] += w; });
  return { ins: sums.ins / ws.ins, tec: sums.tec / ws.tec, phy: sums.phy / ws.phy };
}
export function overallOf(pos, traits) {
  const c = categoryValues(pos, traits);
  const w = CAT_WEIGHTS[pos];
  return c.ins * w.ins + c.tec * w.tec + c.phy * w.phy;
}
// Overall's sensitivity to each trait slot (for re-centering).
export function slotWeights(pos) {
  const ws = { ins: 0, tec: 0, phy: 0 };
  TRAIT_MAP[pos].forEach(([, c, w]) => { ws[c] += w; });
  return TRAIT_MAP[pos].map(([, c, w]) => (w / ws[c]) * CAT_WEIGHTS[pos][c]);
}

// ── Grades ──
const FAMILIES = ["A", "B", "C", "D", "F"];
export function gradeOf(v, cuts) {
  for (let i = 0; i < cuts.length; i += 1) if (v >= cuts[i][1]) return cuts[i][0];
  return "F";
}
export const familyOf = (grade) => grade[0];
// Two adjacent families containing the true one. pickHigh (0/1) chooses
// which neighbor when there are two (B → A–B or B–C). Encoded as the upper
// family index (0 = A–B, 1 = B–C, 2 = C–D, 3 = D–F).
export function rangeFor(grade, pickHigh) {
  const f = FAMILIES.indexOf(familyOf(grade));
  if (f <= 0) return 0;
  if (f >= 4) return 3;
  return pickHigh ? f - 1 : f;
}
export const rangeLabel = (r) => `${FAMILIES[r]}–${FAMILIES[r + 1]}`;
// The value window a range code covers (for estimates): the bottom of the
// lower family to the top of the upper.
export function rangeBounds(r, cuts) {
  const famTop = {};
  const famBottom = {};
  cuts.forEach(([g, v], i) => {
    const f = g[0];
    const top = i === 0 ? 100 : cuts[i - 1][1];
    if (famTop[f] == null) famTop[f] = top;
    famBottom[f] = v === -Infinity ? 50 : v;
  });
  return [famBottom[FAMILIES[r + 1]], famTop[FAMILIES[r]]];
}
// Grade → sort order (A+ = 12 … F = 0) for coloring and comparisons.
export function gradeRank(grade, cuts) {
  const i = cuts.findIndex(([g]) => g === grade);
  return i < 0 ? 0 : cuts.length - 1 - i;
}

// ── Knowledge codes (per school × recruit × slot) ──
//   0          unknown
//   1          exact
//   2..5       range (code − 2 = upper family index, rangeFor)
// Potential is 0 / 1 only.
export const K_UNKNOWN = 0;
export const K_EXACT = 1;
export const isRange = (k) => k >= 2;
export const rangeCode = (k) => k - 2;
