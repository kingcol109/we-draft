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

// ── Opening window 1: the NFL ──
// p = { elig, declared, dg (community draft grade, 1 = Early First … 10 =
// UDFA, null without one) } → { kind: gone | fence | stay, chance, reason }.
//   gone   out of eligibility, Declared on We-Draft, or a grade that always
//          goes (a high first-rounder)
//   fence  draft-eligible (3+ seasons in college) with a grade that might go —
//          his team can try to keep him
//   stay   not draft-eligible, no grade, or a grade that comes back
export function nflDecision(p, cfg) {
  if (p.elig === 0) return { kind: "gone", reason: "exhausted", chance: 1 };
  if (p.declared) return { kind: "gone", reason: "declared", chance: 1 };
  if (p.dg == null || p.elig > cfg.draftEligibleMaxElig) return { kind: "stay", chance: 0 };
  const chance = cfg.declareByGrade[Math.round(p.dg)] ?? 0;
  const [low, high] = cfg.nflFence;
  if (chance >= high) return { kind: "gone", reason: "grade", chance };
  if (chance >= low) return { kind: "fence", chance };
  return { kind: "stay", chance };
}
// What keeping a draft prospect costs: his ask × nflAskFactor.
export const nflAsk = (p, cfg) => Math.round((p.ask * cfg.nflAskFactor) / 1000) * 1000;
// His chance of leaving with a retention offer's pull (0..1) — the better his
// grade, the less an offer moves him.
export function nflLeaveChance(p, pull, cfg) {
  const power = cfg.nflRetainPower[Math.round(p.dg)] ?? 0.5;
  return Math.max(0, (p.lean || 0) * (1 - power * (pull || 0)));
}

// ── Retention (both opening windows) ──
// How much an NFL retention offer pulls, 0..1: NIL against what he asks,
// plus where he'd fit in the room coming back (roomPt — no promised roles).
export function retainPull(offer, ask, roomPt, cfg) {
  if (!offer) return 0;
  const nil = Math.min(1, (offer.nil || 0) / Math.max(1, ask));
  return cfg.retainMix.nil * nil + cfg.retainMix.pt * (roomPt || 0);
}
// How badly a team needs to hold a position: 1 + weight × core players
// (starters / rotation) lost there ÷ the starters it needs, capped.
export function urgency(lostCore, starters, cfg) {
  return Math.min(cfg.urgencyCap, 1 + cfg.urgencyWeight * ((lostCore || 0) / Math.max(1, starters || 1)));
}
// What keeping him is worth to a CPU team (≥ cfg.retainMinWorth to try).
export const retainWorth = (p, urg, cfg) => playerValue(p) * (cfg.roleWorth[p.role] ?? 0.2) * urg;

// ── Grading schools ──
// Every player grades every school — his own included — on six factors,
// each 0..1 (user, 2026-11-14). ctx = { nil (offered, or what he makes at
// home), pt (expected playing time, 0..1) }; team = { tier, loc, success,
// dev: { [pos] } }.
export const FACTORS = ["tier", "nil", "loc", "pt", "success", "dev"];
export function schoolScores(p, team, ctx, cfg) {
  return {
    tier: (5 - (team.tier || 5)) / 4,
    nil: Math.min(1.5, (ctx.nil || 0) / Math.max(1, p.ask)) / 1.5,
    loc: proximity(milesBetween(p.home, team.loc)),
    pt: ctx.pt ?? 0,
    success: team.success ?? 0.5,
    // Development only pays off for a player who sees the field.
    dev: (team.dev?.[p.pos] ?? 0) * (cfg.devPtFloor + (1 - cfg.devPtFloor) * (ctx.pt ?? 0)),
  };
}
// His grade of a school: his personality's weighted average of the scores.
export function gradeFrom(p, scores) {
  const w = p.personality;
  let num = 0;
  let den = 0;
  FACTORS.forEach((k) => { num += (w[k] || 0) * (scores[k] || 0); den += w[k] || 0; });
  return den ? num / den : 0;
}
export const schoolGrade = (p, team, ctx, cfg) => gradeFrom(p, schoolScores(p, team, ctx, cfg));
// The market: a typical school he could land at — between his stars' level
// and his school's (a player at a big program has bigger options; homeTier),
// his ask, an average location / success / development, the playing time
// his stars can find (marketPt).
export function marketGrade(p, cfg, homeTier) {
  return gradeFrom(p, marketScores(p, cfg, homeTier));
}
export function marketScores(p, cfg, homeTier) {
  const ideal = cfg.idealTier[p.stars] ?? 4.5;
  // At a bigger school than his stars: his options sit between the two. At a
  // smaller one: he aims at his own level — no lowering his sights.
  const tier = Math.max(1, Math.min(5, homeTier && homeTier < ideal ? ideal + (homeTier - ideal) * cfg.marketHomePull : ideal));
  return { tier: (5 - tier) / 4, nil: 1 / 1.5, loc: 0.5, pt: cfg.marketPt[p.stars] ?? 0.65, success: 0.5, dev: 0.3 };
}
// Ambition (user, 2026-11-14): a good player at a smaller school wants to
// move up — grade points per tier his school sits below his level, scaled by
// how much he played (a productive starter most). His own school can still
// win him over: this only adds to the market he weighs it against.
export function ambition(p, cfg, homeTier) {
  const gap = (homeTier || 0) - (cfg.idealTier[p.stars] ?? 4.5);
  if (gap <= 0) return 0;
  return cfg.ambition.perTier * gap * (cfg.ambition.role[p.role] ?? 0) * (cfg.ambition.stars[p.stars] ?? 1);
}
// Bench frustration (user, 2026-11-14): a talented player who won't play
// wants out — big programs feel it most. Grade points: his talent (stars) ×
// how little he'd play next season (the room after departures) × his years
// in school — slight after a true freshman season, growing after that.
export function benchFrustration(p, homePt, cfg) {
  const b = cfg.bench;
  const years = Math.max(1, Math.min(3, 5 - (p.elig || 0)));
  return (b.stars[p.stars] ?? 0) * (b.years[years] ?? 1) * Math.max(0, 1 - (homePt ?? 1));
}
// How many schools he's still listening to after portal window w (null: all).
export const listSize = (w, cfg) => (w < cfg.listSize.length ? cfg.listSize[w] : cfg.listSize[cfg.listSize.length - 1]);
// Chance he leaves: how far the market beats home.
export function leaveChance(home, market, cfg) {
  return cfg.maxEntry / (1 + Math.exp(-((market - home - cfg.entryBias) / cfg.entryTemp)));
}
// Transfer likeliness (the admin's 0–3, p.likely): 0 never enters, 1–3 add
// their own chance on top of the model's; null leaves the model alone.
export function withLikeliness(chance, likely, cfg) {
  if (likely == null) return chance;
  if (likely === 0) return 0;
  const l = cfg.likeliness?.[likely] ?? 0;
  return 1 - (1 - chance) * (1 - l);
}
// Playing time from the room: better players ahead of him at his position
// vs the starters it plays.
export function roomPt(ahead, starters, cfg) {
  const r = cfg.roomPt;
  const rotation = starters + Math.max(1, Math.ceil(starters / 2));
  return ahead < starters ? r.starter : ahead < rotation ? r.rotation : ahead < rotation + starters ? r.depth : r.buried;
}
// Who's better than whom in a room: stars, then last season's role.
// Last season's role weighs heavily: an established starter keeps his job
// over a benched higher-star player (a 2★ starter can still lose it).
const ROLE_PTS = { starter: 15, rotation: 8, reserve: 3, none: 0 };
export const talent = (p) => p.stars * 10 + (ROLE_PTS[p.role] ?? 0);
// Why he wants out (for the user): the factor where the market beats home
// most, weighted by what he cares about.
export const REASONS = { tier: "level", nil: "money", loc: "home", pt: "snaps", success: "winning", dev: "development" };
export function transferReason(p, homeScores, cfg, homeTier) {
  const market = marketScores(p, cfg, homeTier);
  let best = "pt";
  let gap = -Infinity;
  FACTORS.forEach((k) => {
    const g = (p.personality[k] || 0) * ((market[k] || 0) - (homeScores[k] || 0));
    if (g > gap) { gap = g; best = k; }
  });
  return REASONS[best];
}
// What he cares about most, best first.
export const topValues = (p, n = 3) => [...FACTORS].sort((a, b) => (p.personality[b] || 0) - (p.personality[a] || 0)).slice(0, n);

// ── A player's price and taste ──
// His NIL ask, with his own ±25% noise (rand 0..1).
export const askFor = (p, cfg, rand) => Math.round((cfg.askByStars[p.stars] || cfg.askByStars[2]) * (0.75 + rand * 0.5));
// His weights on the six factors — the base × a random factor each, so
// every run reshuffles who values what.
export function personalityFor(cfg, rand) {
  const out = {};
  FACTORS.forEach((k) => {
    const n = rand() + rand() + rand() - 1.5; // roughly normal, ±1.5
    out[k] = (cfg.choiceWeights[k] ?? 1) * Math.exp(cfg.personalitySpread * n);
  });
  return out;
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
// The offer: NIL (ask × tier aggressiveness, ± noise). (pt: a leftover the
// engine ignores — players judge the room, not promises.)
export function offerFor(team, p, wouldStart, cfg, rand) {
  const nil = Math.round(p.ask * (cfg.aggressiveness[team.tier] || 1) * (0.85 + rand * 0.3) / 1000) * 1000;
  return { nil, pt: wouldStart ? "starter" : "rotation" };
}

// ── The player's choice ──
// An offer's appeal: his grade of that school with the NIL offered and the
// playing time he'd get (ctx.pt from the engine — the room, or a believable
// promise), plus a little noise.
export function offerUtility(p, team, offer, ctx, cfg, noise) {
  return schoolGrade(p, team, { nil: offer.nil, pt: ctx.pt }, cfg) + noise * cfg.choiceNoise;
}
// The bar an offer must clear to commit, in window w of n: a share of his
// market grade, falling as the portal winds down.
export function commitBar(p, w, n, cfg, homeTier) {
  const [start, end] = cfg.commitShare;
  return marketGrade(p, cfg, homeTier) * (n <= 1 ? end : start + (end - start) * ((w - 1) / (n - 1)));
}
