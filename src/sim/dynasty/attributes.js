// src/sim/dynasty/attributes.js
// ── Dynasty ratings: the attribute list, which positions carry which
// attributes, what an average NFL starter at each position rates, and how
// each position's overall (OVR) is weighted. Shared by the roster generator
// (scripts/generateDynastyRosters.mjs) and the game (traits.js, the UI).
// Every rating is 1–99. ──

export const ATTR_LABELS = {
  // Everyone
  explosiveness: "Explosiveness",
  longSpeed: "Long Speed",
  cod: "Change of Direction",
  saq: "Short Area Quickness",
  strength: "Strength",
  instincts: "Instincts",
  // QB
  armStrength: "Arm Strength",
  accShort: "Short Accuracy",
  accMid: "Intermediate Accuracy",
  accDeep: "Deep Accuracy",
  throwOnRun: "Throw on the Run",
  // RB / WR / TE
  contactBalance: "Contact Balance",
  hands: "Hands",
  contestedCatch: "Contested Catch",
  routeShort: "Short Routes",
  routeMid: "Intermediate Routes",
  routeDeep: "Deep Routes",
  ballTracking: "Ball Tracking",
  // OL
  passBlockPower: "Pass Block Power",
  passBlockFinesse: "Pass Block Finesse",
  runBlock: "Drive (Run Block)",
  handUse: "Hand Use",
  // EDGE / DL
  speedRush: "Speed Rush",
  powerRush: "Power Rush",
  runDefense: "Run Defense",
  // LB / DB
  zone: "Zone Instincts",
  man: "Man Technique",
  // All defense
  angleTackling: "Angle Tackling",
  tackling: "Tackling Technique",
  // K / P
  kickPower: "Kick Power",
  kickAccuracy: "Kick Accuracy",
};

export const ATTR_SHORT = {
  explosiveness: "EXP", longSpeed: "SPD", cod: "COD", saq: "SAQ", strength: "STR", instincts: "INS",
  armStrength: "ARM", accShort: "SAC", accMid: "MAC", accDeep: "DAC", throwOnRun: "TOR",
  contactBalance: "BAL", hands: "HND", contestedCatch: "CIT", routeShort: "SRR", routeMid: "MRR", routeDeep: "DRR", ballTracking: "TRK",
  passBlockPower: "PBP", passBlockFinesse: "PBF", runBlock: "RBK", handUse: "HAN",
  speedRush: "SPR", powerRush: "PWR", runDefense: "RDF",
  zone: "ZON", man: "MAN", angleTackling: "ANG", tackling: "TAK",
  kickPower: "KPW", kickAccuracy: "KAC",
};

const UNIVERSAL = ["explosiveness", "longSpeed", "cod", "saq", "strength", "instincts"];
const QB = ["armStrength", "accShort", "accMid", "accDeep", "throwOnRun"];
const SKILL = ["contactBalance", "hands", "contestedCatch", "routeShort", "routeMid", "routeDeep", "ballTracking"];
const OL = ["passBlockPower", "passBlockFinesse", "runBlock", "handUse"];
const RUSH = ["speedRush", "powerRush", "handUse", "runDefense"];
const COVER = ["zone", "man"];
const DEF = ["angleTackling", "tackling"];
const KICK = ["kickPower", "kickAccuracy"];

// Roster positions → the attributes each one is rated on.
export const POSITION_ATTRS = {
  QB: [...UNIVERSAL, ...QB],
  RB: [...UNIVERSAL, ...SKILL],
  WR: [...UNIVERSAL, ...SKILL],
  TE: [...UNIVERSAL, ...SKILL],
  OT: [...UNIVERSAL, ...OL],
  OG: [...UNIVERSAL, ...OL],
  C: [...UNIVERSAL, ...OL],
  EDGE: [...UNIVERSAL, ...RUSH, ...DEF],
  DL: [...UNIVERSAL, ...RUSH, ...DEF],
  LB: [...UNIVERSAL, ...COVER, ...DEF],
  CB: [...UNIVERSAL, ...COVER, ...DEF],
  S: [...UNIVERSAL, ...COVER, ...DEF],
  K: [...UNIVERSAL, ...KICK],
  P: [...UNIVERSAL, ...KICK],
  LS: [...UNIVERSAL],
};

export const POSITION_ORDER = ["QB", "RB", "WR", "TE", "OT", "OG", "C", "EDGE", "DL", "LB", "CB", "S", "K", "P", "LS"];
export const OFFENSE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "OT", "OG", "C"]);
export const DEFENSE_POSITIONS = new Set(["EDGE", "DL", "LB", "CB", "S"]);

// 53-man roster: how many at each position, and how many of them start.
export const ROSTER_SHAPE = {
  QB: { count: 3, starters: 1 },
  RB: { count: 4, starters: 1 },
  WR: { count: 6, starters: 3 },
  TE: { count: 3, starters: 1 },
  OT: { count: 4, starters: 2 },
  OG: { count: 3, starters: 2 },
  C: { count: 2, starters: 1 },
  EDGE: { count: 5, starters: 2 },
  DL: { count: 5, starters: 2 },
  LB: { count: 5, starters: 3 },
  CB: { count: 6, starters: 2 },
  S: { count: 4, starters: 2 },
  K: { count: 1, starters: 1 },
  P: { count: 1, starters: 1 },
  LS: { count: 1, starters: 1 },
};

// What an average NFL starter rates. Physical traits are on one league-wide
// scale (a 90 in long speed is a 90 at any position); skills are rated
// against the position. Anything not listed is 72.
const SKILL_MEAN = 72;
export const STARTER_MEAN = {
  QB: { explosiveness: 66, longSpeed: 70, cod: 68, saq: 72, strength: 55, instincts: 74, armStrength: 78 },
  RB: { explosiveness: 87, longSpeed: 88, cod: 87, saq: 88, strength: 64, instincts: 72, contestedCatch: 58, routeDeep: 60, routeMid: 64 },
  WR: { explosiveness: 86, longSpeed: 90, cod: 87, saq: 87, strength: 50, instincts: 70, contactBalance: 64 },
  TE: { explosiveness: 78, longSpeed: 79, cod: 74, saq: 76, strength: 72, instincts: 70, routeDeep: 64 },
  OT: { explosiveness: 62, longSpeed: 55, cod: 52, saq: 60, strength: 84, instincts: 70 },
  OG: { explosiveness: 60, longSpeed: 50, cod: 50, saq: 60, strength: 88, instincts: 70 },
  C: { explosiveness: 60, longSpeed: 50, cod: 52, saq: 62, strength: 85, instincts: 76 },
  EDGE: { explosiveness: 84, longSpeed: 80, cod: 74, saq: 78, strength: 78, instincts: 70 },
  DL: { explosiveness: 76, longSpeed: 62, cod: 58, saq: 70, strength: 89, instincts: 70, speedRush: 64 },
  LB: { explosiveness: 82, longSpeed: 81, cod: 77, saq: 80, strength: 70, instincts: 74, man: 64 },
  CB: { explosiveness: 87, longSpeed: 91, cod: 89, saq: 89, strength: 48, instincts: 70, tackling: 64, angleTackling: 66 },
  S: { explosiveness: 85, longSpeed: 88, cod: 84, saq: 85, strength: 58, instincts: 74, man: 66 },
  K: { explosiveness: 50, longSpeed: 55, cod: 50, saq: 50, strength: 40, instincts: 60, kickPower: 80, kickAccuracy: 80 },
  P: { explosiveness: 50, longSpeed: 55, cod: 50, saq: 50, strength: 42, instincts: 60, kickPower: 80, kickAccuracy: 78 },
  LS: { explosiveness: 55, longSpeed: 55, cod: 50, saq: 55, strength: 70, instincts: 62 },
};
export function starterMean(pos, attr) {
  const m = STARTER_MEAN[pos] || {};
  return m[attr] ?? SKILL_MEAN;
}

// OVR weights. Unlisted attributes count for nothing toward OVR (they
// still matter on the field).
export const OVR_WEIGHTS = {
  QB: { accShort: 3, accMid: 3, accDeep: 2, armStrength: 2, instincts: 3, throwOnRun: 1, saq: 0.5, explosiveness: 0.5, cod: 0.3, longSpeed: 0.3 },
  RB: { longSpeed: 1.5, explosiveness: 2, cod: 2, saq: 1.5, contactBalance: 2, strength: 0.7, hands: 0.8, instincts: 1.2, routeShort: 0.5, ballTracking: 0.3 },
  WR: { longSpeed: 2, explosiveness: 1.2, cod: 1, saq: 1, hands: 2, routeShort: 1.2, routeMid: 1.5, routeDeep: 1.2, contestedCatch: 1, ballTracking: 1, contactBalance: 0.5, instincts: 0.5 },
  TE: { hands: 1.5, contestedCatch: 1, routeShort: 1, routeMid: 1, strength: 1.3, longSpeed: 0.8, explosiveness: 0.7, contactBalance: 0.8, ballTracking: 0.5, instincts: 0.6 },
  OT: { passBlockPower: 2, passBlockFinesse: 2.2, runBlock: 1.6, handUse: 1.5, strength: 1.5, instincts: 0.7, saq: 0.6, explosiveness: 0.5, cod: 0.3 },
  OG: { passBlockPower: 2, passBlockFinesse: 1.6, runBlock: 2.2, handUse: 1.5, strength: 1.7, instincts: 0.7, saq: 0.5, explosiveness: 0.4 },
  C: { passBlockPower: 1.8, passBlockFinesse: 1.6, runBlock: 2, handUse: 1.6, strength: 1.5, instincts: 1.4, saq: 0.5, explosiveness: 0.4 },
  EDGE: { speedRush: 2, powerRush: 1.5, handUse: 1.3, runDefense: 1.2, explosiveness: 1.5, saq: 0.8, cod: 0.7, longSpeed: 0.5, strength: 0.8, tackling: 0.6, angleTackling: 0.4, instincts: 0.6 },
  DL: { powerRush: 2, runDefense: 2, handUse: 1.5, strength: 1.8, speedRush: 0.8, explosiveness: 1, saq: 0.6, tackling: 0.6, instincts: 0.6 },
  LB: { tackling: 1.5, angleTackling: 1.3, zone: 1.3, man: 0.8, instincts: 1.5, longSpeed: 1, explosiveness: 1, cod: 0.6, saq: 0.6, strength: 0.6 },
  CB: { man: 2, zone: 1.5, longSpeed: 1.8, cod: 1.5, saq: 1.2, explosiveness: 1, instincts: 0.8, tackling: 0.4, angleTackling: 0.4 },
  S: { zone: 2, man: 1, instincts: 1.5, longSpeed: 1.3, explosiveness: 0.8, cod: 0.8, tackling: 1, angleTackling: 1, saq: 0.6 },
  K: { kickPower: 1, kickAccuracy: 1.2 },
  P: { kickPower: 1.2, kickAccuracy: 1 },
  LS: { instincts: 1, strength: 1 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Overall: 75 is an average starter; it moves with the weighted gap between
// his ratings and the position's starter mean.
export function overall(pos, ratings) {
  const W = OVR_WEIGHTS[pos];
  let s = 0;
  let ws = 0;
  for (const [k, w] of Object.entries(W)) {
    if (ratings[k] == null) continue;
    s += w * (ratings[k] - starterMean(pos, k));
    ws += w;
  }
  return Math.round(clamp(75 + (1.15 * s) / Math.max(1e-6, ws), 35, 99));
}

// Feet and inches: 74 → 6'2".
export const heightLabel = (inches) => `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;
