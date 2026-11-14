// src/utils/portalSim/models.js
//
// The Portal Sim's decisions, one small pure function each — the engine
// (./engine.js) only calls these, so each can be reworked on its own.
// FIRST PASSES (user, 2026-11-14): who declares, who enters the portal,
// what a player asks for, what a team needs, what a CPU team offers, and
// which offer a player takes. Numbers come from ./config.js.

// ── Geography ──
const R_MILES = 3959;
export function milesBetween(a, b) {
  if (!a || !b || a[0] == null || b[0] == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(h));
}
// 1 at home … 0 at 1,500+ miles (unknown: 0.5).
export const proximity = (miles) => (miles == null ? 0.5 : Math.max(0, 1 - miles / 1500));

// ── Draft declarations (window 1) ──
// p = { stars, elig, declared } — a We-Draft "Declared" player always goes.
export function declareChance(p, cfg) {
  if (p.declared) return 1;
  if (!p.elig) return 0;
  const row = cfg.declare[p.stars] || [0, 0];
  return p.elig <= 2 ? row[0] : row[1];
}

// ── Entering the portal ──
// p = { stars, role, elig, home }, team = { tier, loc }.
export function entryChance(p, team, cfg) {
  if (!p.elig) return 0;
  let chance = cfg.entryBase[p.role] ?? cfg.entryBase.none;
  const gap = team.tier - (cfg.idealTier[p.stars] ?? 4.5); // + : he's above his school
  if (gap > 0) chance *= 1 + gap * cfg.tierGapWeight;
  else if (gap < 0 && (p.role === "reserve" || p.role === "none")) chance *= 1 + -gap * cfg.overmatchedWeight;
  const miles = milesBetween(p.home, team.loc);
  if (miles != null && miles <= cfg.homeStayMiles) chance *= cfg.homeStayFactor;
  if (p.elig === 1) chance *= cfg.lastYearFactor;
  return Math.min(cfg.maxEntry, chance);
}

// ── A player's price and taste ──
// His NIL ask, with his own ±25% noise (rand 0..1).
export const askFor = (p, cfg, rand) => Math.round((cfg.askByStars[p.stars] || cfg.askByStars[2]) * (0.75 + rand * 0.5));
// His weights on tier / playing time / NIL / location (rand() each).
export function personalityFor(cfg, rand) {
  const w = cfg.choiceWeights;
  const s = cfg.personalitySpread;
  const draw = (base) => Math.max(0.05, base * (1 + (rand() * 2 - 1) * s));
  return { tier: draw(w.tier), pt: draw(w.pt), nil: draw(w.nil), loc: draw(w.loc) };
}
// A player's worth to a team (before team taste): stars, then seasons left.
export const playerValue = (p) => p.stars * 10 + Math.min(p.elig || 0, 4);

// ── Team needs ──
// have = { [pos]: { starter, rotation } } still on the roster (after the
// draft and transfers out, plus anyone signed), lost = { [pos]: starters
// lost }. → { [pos]: need score } (0 = set).
export function needsFrom(have, lost, cfg) {
  const out = {};
  Object.entries(cfg.starters).forEach(([pos, target]) => {
    const h = have[pos] || { starter: 0, rotation: 0 };
    const depth = h.starter + h.rotation * 0.5;
    out[pos] = Math.max(0, target - depth) + (lost[pos] || 0) * 0.5;
  });
  return out;
}

// ── CPU offers ──
// How much a CPU team wants a portal player: value × need × fit to its tier
// × its own board (boardTaste, ±cfg.boardNoise). 0 = not interested.
export function teamInterest(team, p, need, boardTaste, cfg) {
  if (!need) return 0;
  const ideal = cfg.idealTier[p.stars] ?? 4.5;
  // Teams aim at players around their level: reaching up is a long shot.
  const fit = 1 / (1 + Math.max(0, team.tier - ideal - 0.5) * 0.4 + Math.max(0, ideal - team.tier - 1.5) * 0.3);
  return playerValue(p) * Math.min(need, 3) * fit * (1 + boardTaste * cfg.boardNoise);
}
// The offer: NIL (ask × tier aggressiveness, ± noise) and the role promised —
// starter when he'd beat what's there, else rotation.
export function offerFor(team, p, wouldStart, cfg, rand) {
  const nil = Math.round(p.ask * (cfg.aggressiveness[team.tier] || 1) * (0.85 + rand * 0.3) / 1000) * 1000;
  return { nil, pt: wouldStart ? "starter" : "rotation" };
}

// ── The player's choice ──
// How much an offer appeals: tier, playing time, NIL vs his ask, distance
// from home — weighted by his personality, plus noise.
export function offerUtility(p, team, offer, cfg, noise) {
  const w = p.personality;
  const tierScore = (5 - team.tier) / 4; // tier 1 = 1 … tier 5 = 0
  const pt = cfg.ptValue[offer.pt] ?? 0.25;
  const nil = Math.min(1.5, offer.nil / Math.max(1, p.ask));
  const loc = proximity(milesBetween(p.home, team.loc));
  return w.tier * tierScore + w.pt * pt + w.nil * nil + w.loc * loc + noise * cfg.choiceNoise;
}
// The bar an offer must clear to commit, in window w of n.
export function commitBar(w, n, cfg) {
  const [start, end] = cfg.commitThreshold;
  return n <= 1 ? end : start + (end - start) * ((w - 1) / (n - 1));
}
