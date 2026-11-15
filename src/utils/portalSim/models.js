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
    tier: Math.max(0, (5 - (team.tier || 5)) / 4), // FCS (tier 6): 0
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
// The run's transfer frequency (cfg.frequency — Less / Default / More /
// Crazy): × his modeled chance of wanting out, capped.
export const scaleEntry = (chance, scale, cfg) => (scale == null || scale === 1 ? chance : Math.min(cfg.entryCap ?? 0.97, chance * scale));
// Transfer likeliness (the admin's 0–3, p.likely) SETS his chance of
// entering (user, 2026-11-14: a 1 enters about once every 4 runs): 0 never,
// 1–3 cfg.likeliness. A retention offer still works — it scales that chance
// by how much it cuts the model's (chance / base: the model with / without
// the offer), less the likelier he is to go (^(1 − his chance): a 3 barely
// moves, a 1 nearly as much as anyone). null leaves the model alone.
export function withLikeliness(chance, likely, cfg, base = chance) {
  if (likely == null) return chance;
  if (likely === 0) return 0;
  const l = cfg.likeliness?.[likely] ?? 0;
  const ratio = base > 0 ? Math.min(1, chance / base) : 1;
  return Math.min(1, l * ratio ** (1 - l));
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
export const topValues = (p, n = 3) => byLetter(p).slice(0, n);

// ── A player's price and taste ──
// His NIL ask, with his own ±25% noise (rand 0..1).
export const askFor = (p, cfg, rand) => Math.round((cfg.askByStars[p.stars] || cfg.askByStars[2]) * (0.75 + rand * 0.5));
// His interests (user, 2026-11-14): letters, not percentages — three A's,
// then a B, a C and an F (cfg.letterWeights: the A's make 80% of what he
// weighs, 26.67% each; B 10%, C 7%, F 3%). Which factors land where is drawn
// fresh every run, weighted by cfg.choiceWeights (playing time is the most
// common A). → { [factor]: weight }, the weights summing to 1.
export const LETTER_SLOTS = ["A", "A", "A", "B", "C", "F"];
export function personalityFor(cfg, rand) {
  const pool = FACTORS.map((k) => [k, cfg.choiceWeights[k] ?? 1]);
  const out = {};
  LETTER_SLOTS.forEach((letter) => {
    let r = rand() * pool.reduce((a, [, w]) => a + w, 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= pool[i][1]) > 0) i += 1;
    out[pool.splice(i, 1)[0][0]] = cfg.letterWeights[letter];
  });
  return out;
}
// The letter for one of his factors (from its weight).
export function letterOf(p, k, cfg) {
  const w = p.personality?.[k] || 0;
  const L = cfg.letterWeights;
  return w >= L.A - 1e-9 ? "A" : w >= L.B - 1e-9 ? "B" : w >= L.C - 1e-9 ? "C" : "F";
}
// His factors, A's first, F last.
export const byLetter = (p) => [...FACTORS].sort((a, b) => (p.personality[b] || 0) - (p.personality[a] || 0));
// How many of his A factors a school scores badly on (scores from
// schoolScores) — two or more and he cuts it (cfg.cutBadA).
export function badAs(p, scores, cfg) {
  return FACTORS.filter((k) => letterOf(p, k, cfg) === "A" && (scores[k] ?? 0) < cfg.cutBadA.below).length;
}

// ── The recruiting process (user, 2026-11-14) ──
// Separate from his A–F grade of a school: how the recruitment has gone —
// his happiness with them (0–100; lowballs, lower offers and pulled offers
// wear it down) and the interest an offer has built by standing (0..cap).
// 0..1. A fresh offer from a school he's happy with: cfg.process.happy.
export function processGrade(happy, held, cfg) {
  const c = cfg.process;
  return c.happy * ((happy ?? 100) / 100) + c.interest * Math.min(1, (held || 0) / Math.max(1e-9, cfg.earlyInterest.cap));
}
// His overall grade of an offer: the A–F grade counts 3× the process
// (cfg.gradeMix 0.75 / 0.25).
export const overallGrade = (base, process, cfg) => cfg.gradeMix.factors * base + cfg.gradeMix.process * process;
// The process of a fresh offer from a school he's happy with.
export const neutralProcess = (cfg) => processGrade(100, 0, cfg);
// The NIL that commits him on the spot: his ask × cfg.instantCommitAsk by
// his NIL letter — the less NIL matters to him, the more it takes (F: never).
export function instantAsk(p, cfg) {
  const m = cfg.instantCommitAsk[letterOf(p, "nil", cfg)];
  return m ? Math.round((p.ask * m) / 1000) * 1000 : Infinity;
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

// ── CPU offers (user, 2026-11-14) ──
// Schools offer as if every offer will be accepted: an open offer fills a
// roster spot, so a team with one QB spot chases one QB at a time and moves
// on only when he signs elsewhere or cuts them. They spend with a plan (money
// kept back for the other spots still open), chase players they can
// realistically land, and go hard after top transfers at positions of need.
// Every team prices players its own way — its board (boardTaste) moves both
// its ranking and its price, so a player can go well over his ask or be had
// at a discount. His ask is the market average.

// Open spots by position: the starters it's short (a rotation player covers
// half a spot), or the starters + rotation (cfg.cpu.depth) it wants minus
// both — whichever is more. A lost starter's extra need ranks the spot, it
// doesn't add one.
export function openSlots(have, cfg) {
  const out = {};
  Object.entries(cfg.starters).forEach(([pos, target]) => {
    const h = have[pos] || { starter: 0, rotation: 0 };
    const starters = Math.ceil(target - h.starter - h.rotation * 0.5 - 1e-9);
    const depth = target + (cfg.cpu.depth?.[pos] ?? 0) - h.starter - h.rotation;
    out[pos] = Math.max(0, starters, depth);
  });
  return out;
}
// How much a CPU team wants a portal player: value (top transfers pull
// hardest — cfg.cpu.starPull) × need × fit to its tier × its own board
// (boardTaste, ±cfg.boardNoise). 0 = not interested.
export function teamInterest(team, p, need, boardTaste, cfg) {
  if (!need) return 0;
  const ideal = cfg.idealTier[p.stars] ?? 4.5;
  // Teams aim at players around their level: reaching up is a long shot.
  const fit = 1 / (1 + Math.max(0, team.tier - ideal - 0.5) * 0.4 + Math.max(0, ideal - team.tier - 1.5) * 0.3);
  return playerValue(p) * (cfg.cpu.starPull[p.stars] ?? 1) * Math.min(need, 3) * fit * (1 + boardTaste * cfg.boardNoise);
}
// What a team thinks he's worth: his ask × valueCenter × its tier's aggressiveness × its
// board's taste (e^(taste × cfg.cpu.valueSpread)) × a premium for a top
// transfer at a real need, ± a little noise each window (rand 0..1).
export function teamValuation(team, p, boardTaste, need, cfg, rand) {
  const c = cfg.cpu;
  const premium = need >= 1 ? (c.topPremium[p.stars] ?? 1) : 1;
  const mult = (c.valueCenter ?? 1) * (cfg.aggressiveness[team.tier] || 1) * Math.exp(boardTaste * c.valueSpread) * premium * (1 + (rand - 0.5) * c.windowNoise);
  return Math.round((p.ask * mult) / 1000) * 1000;
}
// Money a team keeps back for each other open spot while it bids.
export const slotReserve = (team, cfg) => (cfg.askByStars[cfg.cpu.reserveStars[team.tier] ?? 2] || 0) * cfg.cpu.reserveShare;
// The offer: NIL at the team's valuation. (pt: a leftover the engine
// ignores — players judge the room, not promises.)
export function offerFor(team, p, wouldStart, cfg, rand, { boardTaste = 0, need = 1 } = {}) {
  return { nil: teamValuation(team, p, boardTaste, need, cfg, rand), pt: wouldStart ? "starter" : "rotation" };
}

// ── The player's choice ──
// An offer's appeal: his grade of that school with the NIL offered and the
// playing time he'd get (ctx.pt from the engine — the room, or a believable
// promise), plus a little noise.
export function offerUtility(p, team, offer, ctx, cfg, noise) {
  return schoolGrade(p, team, { nil: offer.nil, pt: ctx.pt }, cfg) + noise * cfg.choiceNoise;
}
// The bar an offer's overall grade must clear to commit, in window w of n:
// a share of his market (a typical school's A–F grade with a fresh, happy
// process), falling as the portal winds down.
export function commitBar(p, w, n, cfg, homeTier) {
  const [start, end] = cfg.commitShare;
  const market = overallGrade(marketGrade(p, cfg, homeTier), neutralProcess(cfg), cfg);
  return market * (n <= 1 ? end : start + (end - start) * ((w - 1) / (n - 1)));
}
