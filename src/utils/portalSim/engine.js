// src/utils/portalSim/engine.js
//
// The Portal Sim — a pure, seeded state machine (no React, no Firestore),
// the portal's version of utils/draftSim/engine.js. Every decision is a
// model in ./models.js; every number is in ./config.js.
//
//   initPortalSim(pool, opts)  every FBS player on his roster, every team's
//                              tier and NIL budget
//   openNflWindow(state)       opening window 1 (phase "nfl"): who leaves for
//                              the draft — out of eligibility, Declared, a
//                              grade that always goes; draft-eligible players
//                              on the fence are "considering" the NFL
//   endNflWindow(state)        CPU teams make retention offers (harder at
//                              positions they're losing), fence players
//                              decide; opening window 2 (phase "retain")
//                              opens: who wants to transfer — modeled
//                              (playing time, school tier vs his stars, home
//                              distance), or the REAL portal once it's open
//                              (opts.live: players flagged live in the pool)
//   endRetainWindow(state)     CPU retention offers, then each player decides:
//                              kept, or into the portal; portal window 1 opens
//   userRetain / clearRetain   the user's retention offers (own players, both
//                              opening windows)
//   userOffer / retractOffer   the user's offers during a portal window (NIL
//                              within budget; players judge the room, not
//                              promised roles)
//   endWindow(state)           CPU teams make their offers (needs, budget,
//                              their own boards), players decide (tier,
//                              playing time, NIL, location), the next window
//                              opens (with a few late entries) — or, after
//                              the last one, the sim ends
//
// Randomness never lives in state: each draw comes from a hash of (seed,
// what, who), so a run replays exactly from its seed and any step can be
// recomputed.
//
// State (plain data, safe to JSON):
//   { seed, cfg, window, windows, phase: ready|nfl|retain|window|done,
//     userTeams,
//     teams:   { [slug]: { slug, school, tier, budget, spent, retainSpent,
//                          loc, user } },
//     players: { [id]: { id, name, pos, team, stars, elig, role, home, dg,
//                        ask, personality, status, considering (nfl |
//                        transfer), lean, reason, retain { nil, pt },
//                        retained, enteredWindow, offers:
//                        { [slug]: { nil, pt, window } }, to, deal } },
//     log: [{ w, stage, kind, pid, team, to, nil, pt, reason }] }
// status: roster | considering | declared | portal | committed | unsigned
// log w: 0 in the opening windows (stage "nfl" / "retain"), else the portal
// window.
import { mergeConfig, defaultTier } from "./config.js";
import * as M from "./models.js";

// ── Seeded randomness ──
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A generator for one decision: same seed + tag → same draws.
const rngFor = (state, tag) => mulberry(hash(`${state.seed}|${tag}`));
// One draw in 0..1, and one in -1..1.
const draw = (state, tag) => rngFor(state, tag)();
const signedDraw = (state, tag) => draw(state, tag) * 2 - 1;
// A team's own take on a player (its board), -1..1, fixed for the run.
export const boardTaste = (state, team, pid) => signedDraw(state, `board|${team}|${pid}`);

// ── Setup ──
// pool: { season, teams: [{ slug, school, conference, loc }], players: [{
//   id, name, pos, team, stars, elig, role, home, wdId, declared, live }] }
// opts: { config (admin overrides), tiers ({ slug: tier }), userTeams,
//   seed, live (use the real portal's entries), factors ({ [school]:
//   { success, dev } } — ./factors.js; missing → neutral) }
export function initPortalSim(pool, opts = {}) {
  const cfg = mergeConfig(opts.config);
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const userTeams = opts.userTeams || [];
  const state = { seed, cfg, season: pool.season, window: 0, windows: cfg.windows, phase: "ready", userTeams, live: !!opts.live, teams: {}, players: {}, log: [] };
  pool.teams.forEach((t) => {
    // An FCS school (graded FCS players' home) sits below tier 5 and never
    // recruits or retains.
    const tier = t.fcs ? 6 : Number(opts.tiers?.[t.slug]) || defaultTier(t.school, t.conference);
    state.teams[t.slug] = { slug: t.slug, school: t.school, conference: t.conference, tier, fcs: !!t.fcs, budget: cfg.budgets[tier] || 0, spent: 0, retainSpent: 0, loc: t.loc || null, user: userTeams.includes(t.slug),
      success: opts.factors?.[t.school]?.success ?? 0.5, dev: opts.factors?.[t.school]?.dev || {} };
  });
  pool.players.forEach((p) => {
    if (!state.teams[p.team]) return;
    const rand = rngFor(state, `player|${p.id}`);
    state.players[p.id] = {
      ...p, ask: M.askFor(p, cfg, rand()), personality: M.personalityFor(cfg, rand),
      dg: p.dg ?? null, status: "roster", considering: null, lean: null, reason: null, retain: null, retained: null,
      enteredWindow: null, offers: {}, to: null, deal: null,
    };
  });
  return state;
}

// ── Opening window 1: the NFL ──
export function openNflWindow(state) {
  if (state.phase !== "ready") return state;
  const players = { ...state.players };
  const log = [...state.log];
  Object.values(players).forEach((p) => {
    const d = M.nflDecision(p, state.cfg);
    // The real portal's season: only real decisions (Declared, out of
    // eligibility) — no modeled fence.
    if (d.kind === "gone") {
      players[p.id] = { ...p, status: "declared", reason: d.reason };
      log.push({ w: 0, stage: "nfl", kind: "declared", pid: p.id, team: p.team, reason: d.reason });
    } else if (d.kind === "fence" && !state.live) {
      players[p.id] = { ...p, status: "considering", considering: "nfl", lean: d.chance };
    }
  });
  return { ...state, players, log, phase: "nfl" };
}

// ── Reading the state ──
// One pass over every player → what each team has, lost, and has promised
// (cached per state object — states are never mutated).
const INDEX = new WeakMap();
function indexOf(state) {
  if (INDEX.has(state.players)) return INDEX.get(state.players);
  const teams = {};
  const T = (slug) => (teams[slug] = teams[slug] || { roster: [], have: {}, lost: {}, lostCore: {}, best: {}, reserved: 0, considering: [], offered: [] });
  Object.values(state.players).forEach((p) => {
    // Next season's roster: stayed, or committed here.
    // (A player still deciding counts as here until he does.)
    const here = p.status === "roster" || p.status === "considering" ? p.team : p.status === "committed" ? p.to : null;
    if (p.status === "considering") T(p.team).considering.push(p);
    if (here) {
      const t = T(here);
      t.roster.push(p);
      const role = p.status === "committed" ? (p.deal?.pt === "starter" ? "starter" : "rotation") : p.role;
      const h = (t.have[p.pos] = t.have[p.pos] || { starter: 0, rotation: 0 });
      if (role === "starter") h.starter += 1;
      else if (role === "rotation") h.rotation += 1;
      t.best[p.pos] = Math.max(t.best[p.pos] || 0, M.playerValue(p));
    }
    // Starters lost to the draft or the portal.
    // Starters (and core: starters + rotation) lost to the draft or the portal.
    const gone = p.status !== "roster" && p.status !== "considering" && !(p.status === "committed" && p.to === p.team);
    if (gone && p.role === "starter") {
      const t = T(p.team);
      t.lost[p.pos] = (t.lost[p.pos] || 0) + 1;
    }
    if (gone && (p.role === "starter" || p.role === "rotation")) {
      const t = T(p.team);
      t.lostCore[p.pos] = (t.lostCore[p.pos] || 0) + 1;
    }
    // NIL promised to keep him.
    if (p.status === "considering" && p.retain) T(p.team).reserved += p.retain.nil;
    // NIL promised in open offers.
    if (p.status === "portal") Object.entries(p.offers).forEach(([slug, o]) => { const t = T(slug); t.reserved += o.nil; t.offered.push(p); });
  });
  const idx = { teams, of: (slug) => teams[slug] || { roster: [], have: {}, lost: {}, lostCore: {}, best: {}, reserved: 0, considering: [], offered: [] } };
  INDEX.set(state.players, idx);
  return idx;
}
export const rosterOf = (state, slug) => indexOf(state).of(slug).roster;
export function teamNeeds(state, slug) {
  const t = indexOf(state).of(slug);
  return M.needsFrom(t.have, t.lost, state.cfg);
}
export function budgetOf(state, slug) {
  const t = state.teams[slug];
  const reserved = indexOf(state).of(slug).reserved;
  return { budget: t.budget, spent: t.spent, reserved, available: Math.max(0, t.budget - t.spent - reserved) };
}
// Would he start there? Better than anyone on next season's roster at his
// position.
const wouldStart = (state, slug, p) => M.playerValue(p) > (indexOf(state).of(slug).best[p.pos] || 0);

// Playing time he'd expect at a school: where he'd fit in that room next
// season — better players at his position (still there, or signed) vs the
// starters it plays; departures in front of him open it up. No promises
// (user, 2026-11-14): only who's actually in the room.
export function ptAt(state, slug, p) {
  const { ahead, starters } = roomAt(state, slug, p);
  return M.roomPt(ahead, starters, state.cfg);
}
// Where he'd fit at a school: { pt, fit: starter | rotation | depth, ahead,
// starters, better }.
export function fitAt(state, slug, p) {
  const room = roomAt(state, slug, p);
  const pt = M.roomPt(room.ahead, room.starters, state.cfg);
  return { ...room, pt, fit: pt >= state.cfg.roomPt.starter ? "starter" : pt >= state.cfg.roomPt.rotation ? "rotation" : "depth" };
}
// The room at a school for him: { ahead (better players count fully,
// equals — same stars, same role — half: a room of ten reserves like him
// doesn't leave him a rotation spot), starters, better: [the better players] }.
// Players it has already signed are on that roster; players it's still
// chasing at his position (outstanding offers) count part-way
// (offerRoomWeight) — he can see who else they're recruiting.
export function roomAt(state, slug, p) {
  const t = M.talent(p);
  const idx = indexOf(state).of(slug);
  let ahead = 0;
  const better = [];
  const chasing = [];
  idx.roster.forEach((x) => {
    if (x.id === p.id || x.pos !== p.pos) return;
    const tx = M.talent(x);
    if (tx > t) { ahead += 1; better.push(x); } else if (tx === t) ahead += 0.5;
  });
  idx.offered.forEach((x) => {
    if (x.id === p.id || x.pos !== p.pos || M.talent(x) < t) return;
    ahead += state.cfg.offerRoomWeight * (M.talent(x) > t ? 1 : 0.5);
    chasing.push(x);
  });
  return { ahead, starters: state.cfg.starters[p.pos] || 1, better, chasing };
}
// His grade of his own school: what he makes there (or a retention offer,
// if bigger) and the room he'd have.
export function homeScores(state, p, offer = null) {
  const nil = Math.max(p.ask * state.cfg.homeNil, offer?.nil || 0);
  return M.schoolScores(p, state.teams[p.team], { nil, pt: ptAt(state, p.team, p) }, state.cfg);
}
export const homeGrade = (state, p, offer = null) => M.gradeFrom(p, homeScores(state, p, offer));
// His chance of entering the portal: the market against home (with an offer).
export const transferLeave = (state, p, offer = null) => {
  const tier = state.teams[p.team].tier;
  const pull = M.ambition(p, state.cfg, tier) + M.benchFrustration(p, ptAt(state, p.team, p), state.cfg);
  const market = M.marketGrade(p, state.cfg, tier) + pull;
  const chance = M.leaveChance(homeGrade(state, p, offer), market, state.cfg);
  if (p.likely == null) return chance;
  return M.withLikeliness(chance, p.likely, state.cfg, offer ? M.leaveChance(homeGrade(state, p), market, state.cfg) : chance);
};
// Interest an offer has built by standing: offering early helps
// (earlyInterest per window it's been out, capped).
export function heldBonus(state, offer) {
  if (!offer?.since) return 0;
  const { perWindow, cap } = state.cfg.earlyInterest;
  return Math.min(cap, Math.max(0, (state.window - offer.since) * perWindow));
}
// His happiness with a school, 0–100 (100 to start): lowballs (offers well
// under his ask), offering less than before and pulling offers wear it down
// (user, 2026-11-14 — a brake on offer spam; CPU schools never do these).
// Below 100 it costs that school grade points.
export const happinessOf = (p, slug) => p.happy?.[slug] ?? 100;
// The recruiting process with a school, 0..1 (models.processGrade).
export const processFor = (state, slug, p, offer) => M.processGrade(happinessOf(p, slug), heldBonus(state, offer), state.cfg);
// His grade of any school's offer: { grade (overall: A–F × 3 + process),
// base (the A–F grade), held, happy (0–100), process, scores }.
export function gradeOffer(state, slug, p, offer) {
  const scores = M.schoolScores(p, state.teams[slug], { nil: offer?.nil || 0, pt: ptAt(state, slug, p) }, state.cfg);
  const base = M.gradeFrom(p, scores);
  const held = heldBonus(state, offer);
  const process = processFor(state, slug, p, offer);
  return { grade: M.overallGrade(base, process, state.cfg), base, held, happy: happinessOf(p, slug), process, scores };
}
// What an offer would cost his happiness with you: { lower, lowball, drop }.
export function offerHit(state, slug, p, nil) {
  const h = state.cfg.happiness;
  const prior = p.high?.[slug] || 0;
  const lower = prior > 0 && nil < prior;
  const lowball = nil < p.ask * h.lowballAsk;
  return { lower, lowball, prior, drop: (lower ? h.lower : 0) + (lowball ? h.lowball : 0) };
}
const sour = (p, slug, by) => ({ ...(p.happy || {}), [slug]: Math.max(0, happinessOf(p, slug) - by) });
// Has this school already made its move on him this window?
export const offeredThisWindow = (state, slug, p) => p.touched?.[slug] === state.window;
// A NIL offer this big (× his ask) commits him on the spot.
export const instantAmount = (state, p) => M.instantAsk(p, state.cfg);

// Where a player deciding stands, with an offer (default: his current one):
// { ask, chance, leaving } — chance of leaving (NFL) or of staying (transfer).
export function retainOdds(state, p, offer = p.retain) {
  const cfg = state.cfg;
  if (p.considering === "nfl") {
    const ask = M.nflAsk(p, cfg);
    return { ask, chance: M.nflLeaveChance(p, M.retainPull(offer, ask, ptAt(state, p.team, p), cfg), cfg), leaving: true };
  }
  // He wanted out (his draw fell under lean); an offer keeps him when it
  // pulls his chance of leaving back under that draw.
  const base = p.lean || transferLeave(state, p);
  const withOffer = offer ? transferLeave(state, p, offer) : base;
  return { ask: p.ask, chance: offer ? Math.max(0, Math.min(1, 1 - withOffer / Math.max(1e-6, base))) : 0, leaving: false };
}
// Starters/rotation lost at each position, and the urgency that adds.
export function urgencyOf(state, slug) {
  const t = indexOf(state).of(slug);
  const out = {};
  Object.entries(state.cfg.starters).forEach(([pos, n]) => { out[pos] = { lost: t.lostCore[pos] || 0, urgency: M.urgency(t.lostCore[pos], n, state.cfg) }; });
  return out;
}

// One team's view: budget, needs, who left, who's deciding, who's coming.
export function teamView(state, slug) {
  const all = Object.values(state.players);
  return {
    team: state.teams[slug],
    ...budgetOf(state, slug),
    needs: teamNeeds(state, slug),
    considering: all.filter((p) => p.team === slug && p.status === "considering"),
    retained: all.filter((p) => p.team === slug && p.retained),
    departures: all.filter((p) => p.team === slug && p.status !== "roster" && p.status !== "considering" && !(p.status === "committed" && p.to === slug)),
    signings: all.filter((p) => p.status === "committed" && p.to === slug),
    offers: all.filter((p) => p.status === "portal" && p.offers[slug]),
  };
}
export const portalPlayers = (state) => Object.values(state.players).filter((p) => p.status === "portal");

// ── The user's offers ──
// One move per player per window (an offer, a new offer, or pulling one).
// A lowball (well under his ask) or less than you offered before costs his
// happiness with you.
export function userOffer(state, slug, pid, { nil }) {
  const p = state.players[pid];
  if (state.phase !== "window") return { error: "The portal isn't open." };
  if (!state.userTeams.includes(slug)) return { error: "Not your team." };
  if (!p || p.status !== "portal") return { error: "He isn't available." };
  if (offeredThisWindow(state, slug, p)) return { error: "You've already made your move on him this window." };
  if (p.cut?.[slug]) return { error: "He's cut you from his list." };
  const amount = Math.max(0, Math.round(Number(nil) || 0));
  const { available } = budgetOf(state, slug);
  const current = p.offers[slug]?.nil || 0;
  if (amount > available + current) return { error: "Over your NIL budget." };
  const hit = offerHit(state, slug, p, amount);
  const offer = { nil: amount, window: state.window, since: p.offers[slug]?.since ?? state.window };
  const teams = state.teams;
  const q = {
    ...p,
    touched: { ...(p.touched || {}), [slug]: state.window },
    high: { ...(p.high || {}), [slug]: Math.max(hit.prior, amount) },
    happy: hit.drop ? sour(p, slug, hit.drop) : p.happy,
  };
  // A blowout offer commits him on the spot.
  if (amount >= instantAmount(state, p)) {
    const t = teams[slug];
    return {
      state: {
        ...state,
        players: { ...state.players, [pid]: { ...q, status: "committed", to: slug, deal: { ...offer }, offers: {} } },
        teams: { ...teams, [slug]: { ...t, spent: t.spent + amount } },
        log: [...state.log, { w: state.window, kind: "committed", pid, team: p.team, to: slug, nil: amount, offeredBy: Object.keys({ ...p.offers, [slug]: 1 }), blowout: true }],
      },
      committed: true,
    };
  }
  return { state: { ...state, players: { ...state.players, [pid]: { ...q, offers: { ...p.offers, [slug]: offer } } } } };
}
// Pulling an offer costs his happiness with you; the interest it built is
// gone, and it's your move for the window.
export function retractOffer(state, slug, pid) {
  const p = state.players[pid];
  if (!p?.offers[slug] || p.status !== "portal" || offeredThisWindow(state, slug, p)) return state;
  const offers = { ...p.offers };
  delete offers[slug];
  return {
    ...state,
    players: { ...state.players, [pid]: { ...p, offers, touched: { ...(p.touched || {}), [slug]: state.window }, happy: sour(p, slug, state.cfg.happiness.pulled) } },
  };
}

// ── Retention offers (opening windows): keep one of your own ──
export function userRetain(state, slug, pid, { nil }) {
  const p = state.players[pid];
  if (state.phase !== "nfl" && state.phase !== "retain") return { error: "Retention is closed." };
  if (!state.userTeams.includes(slug) || p?.team !== slug) return { error: "Not your player." };
  if (p.status !== "considering") return { error: "He's already decided." };
  const amount = Math.max(0, Math.round(Number(nil) || 0));
  const { available } = budgetOf(state, slug);
  if (amount > available + (p.retain?.nil || 0)) return { error: "Over your NIL budget." };
  const retain = { nil: amount };
  return { state: { ...state, players: { ...state.players, [pid]: { ...p, retain } } } };
}
export function clearRetain(state, slug, pid) {
  const p = state.players[pid];
  if (!p?.retain || p.team !== slug || p.status !== "considering") return state;
  return { ...state, players: { ...state.players, [pid]: { ...p, retain: null } } };
}

// CPU teams' retention offers: their most valuable players first, harder at
// the positions they're losing (urgency), within retentionShare of budget.
function cpuRetention(state) {
  const cfg = state.cfg;
  const players = { ...state.players };
  const idx = indexOf(state);
  Object.values(state.teams).forEach((team) => {
    if (team.user || team.fcs) return;
    const t = idx.of(team.slug);
    if (!t.considering.length) return;
    let room = Math.min(budgetOf(state, team.slug).available, team.budget * cfg.retentionShare - (team.retainSpent || 0));
    t.considering
      .map((p) => {
        const urg = M.urgency(t.lostCore[p.pos], cfg.starters[p.pos], cfg);
        return { p, urg, worth: M.retainWorth(p, urg, cfg) };
      })
      .filter((x) => x.worth >= cfg.retainMinWorth)
      .sort((a, b) => b.worth - a.worth)
      .forEach(({ p, urg }) => {
        const ask = p.considering === "nfl" ? M.nflAsk(p, cfg) : p.ask;
        const nil = Math.round((ask * (cfg.aggressiveness[team.tier] || 1) * Math.min(cfg.urgencyCap, urg)) / 1000) * 1000;
        if (nil > room) return;
        room -= nil;
        players[p.id] = { ...players[p.id], retain: { nil } };
      });
  });
  return { ...state, players };
}

// Everyone deciding makes up his mind.
function resolveConsidering(state, stage) {
  const players = { ...state.players };
  const teams = { ...state.teams };
  const log = [...state.log];
  Object.values(state.players).filter((p) => p.status === "considering").forEach((p) => {
    const { chance } = retainOdds(state, p);
    const offer = p.retain;
    const leaves = stage === "nfl" ? draw(state, `nfl|${p.id}`) < chance : draw(state, `enter|${p.id}`) < transferLeave(state, p, offer);
    if (leaves) {
      const nfl = stage === "nfl";
      players[p.id] = { ...p, status: nfl ? "declared" : "portal", considering: null, retain: null, reason: nfl ? "chose" : p.reason, enteredWindow: nfl ? null : 1 };
      log.push({ w: 0, stage, kind: nfl ? "declared" : "entered", pid: p.id, team: p.team, reason: nfl ? "chose" : p.reason, nil: offer?.nil || 0, offered: !!offer });
      return;
    }
    players[p.id] = { ...p, status: "roster", considering: null, retain: null, retained: offer ? { ...offer, stage } : null };
    if (offer) {
      const t = teams[p.team];
      teams[p.team] = { ...t, spent: t.spent + offer.nil, retainSpent: (t.retainSpent || 0) + offer.nil };
    }
    log.push({ w: 0, stage, kind: offer ? "retained" : "stayed", pid: p.id, team: p.team, nil: offer?.nil || 0 });
  });
  return { ...state, players, teams, log };
}

// Opening window 2 opens: who wants to transfer (not anyone just kept).
function openRetainWindow(state) {
  const players = { ...state.players };
  const log = [...state.log];
  Object.values(state.players).forEach((p) => {
    if (p.status !== "roster" || p.retained) return;
    if (state.live) {
      // The real portal: who's actually in it, straight in.
      if (!p.live) return;
      players[p.id] = { ...p, status: "portal", enteredWindow: 1 };
      log.push({ w: 0, stage: "retain", kind: "entered", pid: p.id, team: p.team });
      return;
    }
    const scores = homeScores(state, p);
    const homeTier = state.teams[p.team].tier;
    const pull = M.ambition(p, state.cfg, homeTier) + M.benchFrustration(p, scores.pt, state.cfg);
    const lean = M.withLikeliness(M.leaveChance(M.gradeFrom(p, scores), M.marketGrade(p, state.cfg, homeTier) + pull, state.cfg), p.likely, state.cfg);
    if (draw(state, `enter|${p.id}`) >= lean) return;
    players[p.id] = { ...p, status: "considering", considering: "transfer", lean, reason: M.transferReason(p, scores, state.cfg, homeTier) };
  });
  return { ...state, players, log, phase: "retain" };
}

// The user's done with an opening window. → { state, summary }
function endOpening(state, stage) {
  const before = state.log.length;
  let next = resolveConsidering(cpuRetention(state), stage);
  next = stage === "nfl" ? openRetainWindow(next) : { ...next, phase: "window", window: 1 };
  return { state: next, summary: { stage, events: next.log.slice(before) } };
}
export const endNflWindow = (state) => (state.phase === "nfl" ? endOpening(state, "nfl") : { state, summary: null });
export const endRetainWindow = (state) => (state.phase === "retain" ? endOpening(state, "retain") : { state, summary: null });

// ── CPU teams' offers ──
function cpuOffers(state) {
  const players = { ...state.players };
  const portal = Object.values(players).filter((p) => p.status === "portal");
  let made = 0;
  const cfg = state.cfg;
  const bars = new Map(); // his commit bar this window (the same for every school)
  const barOf = (p) => {
    if (!bars.has(p.id)) bars.set(p.id, M.commitBar(p, state.windows, state.windows, cfg, state.teams[p.team].tier));
    return bars.get(p.id);
  };
  Object.values(state.teams).forEach((team) => {
    if (team.user || team.fcs) return;
    const needs = teamNeeds(state, team.slug);
    const idx = indexOf(state).of(team.slug);
    // Open spots, every offer still out counted as a signing.
    const slots = M.openSlots(idx.have, cfg);
    idx.offered.forEach((x) => { slots[x.pos] = (slots[x.pos] || 0) - 1; });
    let open = Object.values(slots).reduce((a, n) => a + Math.max(0, n), 0);
    if (!open) return;
    let { available } = budgetOf(state, team.slug);
    const reserve = M.slotReserve(team, cfg);
    const ranked = portal
      .filter((p) => slots[p.pos] > 0 && !players[p.id].offers[team.slug] && !p.cut?.[team.slug]) // its own departures too
      .map((p) => {
        const taste = boardTaste(state, team.slug, p.id);
        return { p, taste, need: needs[p.pos] || cfg.cpu.depthNeed, score: M.teamInterest(team, p, needs[p.pos] || cfg.cpu.depthNeed, taste, cfg) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    let n = cfg.offersPerWindow[team.tier] || 4;
    for (const { p, taste, need } of ranked) {
      if (n <= 0 || open <= 0 || available <= 0) break;
      if (!(slots[p.pos] > 0)) continue;
      const offer = M.offerFor(team, p, wouldStart(state, team.slug, p), cfg, draw(state, `offer|${team.slug}|${p.id}|${state.window}`), { boardTaste: taste, need });
      // Spend with a plan: keep money back for the other open spots.
      const cap = available - reserve * (open - 1);
      if (offer.nil > cap) {
        if (cap < offer.nil * cfg.cpu.stretch || cap < p.ask * cfg.cpu.stretch) continue;
        offer.nil = Math.floor(cap / 1000) * 1000;
      }
      // Realistic: would he seriously consider it — and not cut it on the
      // spot for missing on his A's?
      const scores = M.schoolScores(p, team, { nil: offer.nil, pt: ptAt(state, team.slug, p) }, cfg);
      if (M.badAs(p, scores, cfg) >= cfg.cutBadA.count) continue;
      const grade = M.overallGrade(M.gradeFrom(p, scores), processFor(state, team.slug, p, null), cfg);
      if (grade < barOf(p) * cfg.cpu.realism) continue;
      const cur = players[p.id];
      players[p.id] = { ...cur, offers: { ...cur.offers, [team.slug]: { nil: offer.nil, window: state.window, since: state.window } }, high: { ...(cur.high || {}), [team.slug]: offer.nil } };
      available -= offer.nil;
      slots[p.pos] -= 1;
      open -= 1;
      n -= 1;
      made += 1;
    }
  });
  return { state: { ...state, players }, made };
}

// ── Players decide ──
// A recruitment, not a snap signing (user, 2026-11-14): an offer can't land
// in the window it's made — he takes it in first (so portal window 1 is
// mostly schools offering) — and interest builds the longer an offer
// stands. A blowout offer (instantCommitAsk × his ask) commits him on the
// spot. In the last window he takes his best offer.
function decisions(state, last) {
  const players = { ...state.players };
  const teams = { ...state.teams };
  const log = [...state.log];
  // Best players first, so a team's budget goes to its top target.
  Object.values(players)
    .filter((p) => p.status === "portal")
    .sort((a, b) => M.playerValue(b) - M.playerValue(a))
    .forEach((p) => {
      const scored = Object.entries(p.offers).map(([slug, offer]) => {
        const pt = ptAt(state, slug, p);
        return {
          slug, offer,
          u: M.overallGrade(M.offerUtility(p, teams[slug], offer, { pt }, state.cfg, signedDraw(state, `choose|${p.id}|${slug}|${state.window}`)), processFor(state, slug, p, offer), state.cfg),
          bad: M.badAs(p, M.schoolScores(p, teams[slug], { nil: offer.nil, pt }, state.cfg), state.cfg) >= state.cfg.cutBadA.count,
          blowout: offer.nil >= instantAmount(state, p),
        };
      }).sort((a, b) => b.u - a.u);
      const blowout = scored.filter((x) => x.blowout).sort((a, b) => b.offer.nil - a.offer.nil)[0];
      const ripe = scored.filter((x) => x.offer.since < state.window && !x.bad);
      const bar = M.commitBar(p, state.window, state.windows, state.cfg, state.teams[p.team].tier);
      const best = blowout || (last ? scored[0] : ripe[0] && ripe[0].u >= bar ? ripe[0] : null);
      if (best) {
        players[p.id] = { ...p, status: "committed", to: best.slug, deal: { ...best.offer, window: state.window }, offers: {} };
        teams[best.slug] = { ...teams[best.slug], spent: teams[best.slug].spent + best.offer.nil };
        log.push({ w: state.window, kind: "committed", pid: p.id, team: p.team, to: best.slug, nil: best.offer.nil, offeredBy: Object.keys(p.offers), blowout: !!best.blowout || undefined });
      } else if (last) {
        players[p.id] = { ...p, status: "unsigned", offers: {} };
        log.push({ w: state.window, kind: "unsigned", pid: p.id, team: p.team });
      } else {
        // Schools that miss on two of his A's are cut right away; then he
        // narrows his list: keeps the schools he likes most, cuts the rest.
        const keep = M.listSize(state.window, state.cfg);
        const fits = scored.filter((x) => !x.bad);
        const cut = [...scored.filter((x) => x.bad).map((x) => ({ ...x, why: "fit" })), ...(keep != null && fits.length > keep ? fits.slice(keep) : [])];
        if (!cut.length) return;
        const offers = { ...p.offers };
        const cutMap = { ...(p.cut || {}) };
        cut.forEach(({ slug, why }) => {
          delete offers[slug];
          cutMap[slug] = state.window;
          log.push({ w: state.window, kind: "cut", pid: p.id, team: p.team, to: slug, list: keep, why });
        });
        players[p.id] = { ...p, offers, cut: cutMap, list: keep ?? p.list };
      }
    });
  return { ...state, players, teams, log };
}

// Late entries at the start of a window (config.lateEntryWindows).
function lateEntries(state) {
  if (state.live || !state.cfg.lateEntryWindows.includes(state.window)) return state;
  const players = { ...state.players };
  const log = [...state.log];
  Object.values(players).forEach((p) => {
    if (p.status !== "roster" || p.retained) return;
    const chance = transferLeave(state, p) * state.cfg.lateEntryFactor;
    if (draw(state, `late|${p.id}|${state.window}`) >= chance) return;
    players[p.id] = { ...p, status: "portal", enteredWindow: state.window };
    log.push({ w: state.window, kind: "entered", pid: p.id, team: p.team, late: true });
  });
  return { ...state, players, log };
}

// The user's done with this window: CPU offers, decisions, next window.
// → { state, summary: { window, offers, commits, unsigned, entered } }
export function endWindow(state) {
  if (state.phase !== "window") return { state, summary: null };
  const w = state.window;
  const last = w >= state.windows;
  const before = state.log.length;
  const { state: offered, made } = cpuOffers(state);
  let next = decisions(offered, last);
  const fresh = next.log.slice(before);
  if (last) next = { ...next, phase: "done" };
  else next = lateEntries({ ...next, window: w + 1 });
  return {
    state: next,
    summary: {
      window: w, offers: made,
      // Every signing this window — on-the-spot ones made during it too.
      commits: next.log.filter((e) => e.kind === "committed" && e.w === w),
      cuts: fresh.filter((e) => e.kind === "cut"),
      unsigned: fresh.filter((e) => e.kind === "unsigned"),
      entered: next.log.slice(before).filter((e) => e.kind === "entered"),
    },
  };
}
