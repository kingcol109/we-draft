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
//   toggleEval(state, slug, pid) the user's board (portal window 1 is the
//                              evaluation period: boards only, no offers)
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
//                        { [slug]: { nil, pt, window, since, made } },
//                        evals { [slug]: window put on its board }, to,
//                        deal } },
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
  let cfg = mergeConfig(opts.config);
  // The run's choices (pages/PortalSim.jsx setup): portal length and
  // transfer frequency.
  if (opts.windows && cfg.listSizeByWindows?.[opts.windows]) cfg = { ...cfg, windows: opts.windows, listSize: cfg.listSizeByWindows[opts.windows] };
  cfg = { ...cfg, entryScale: cfg.frequency?.[opts.frequency] ?? 1 };
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const userTeams = opts.userTeams || [];
  const state = { seed, cfg, season: pool.season, window: 0, windows: cfg.windows, phase: "ready", userTeams, live: !!opts.live, teams: {}, players: {}, log: [] };
  pool.teams.forEach((t) => {
    // An FCS school (graded FCS players' home) sits below tier 5 and never
    // recruits or retains.
    const tier = t.fcs ? 6 : Number(opts.tiers?.[t.slug]) || defaultTier(t.school, t.conference);
    // A service academy (cfg.academies): its players rarely transfer, and as
    // a CPU school it doesn't recruit the portal.
    const academy = !t.fcs && (cfg.academies?.schools || []).includes(t.school);
    state.teams[t.slug] = { slug: t.slug, school: t.school, conference: t.conference, tier, fcs: !!t.fcs, academy, budget: cfg.budgets[tier] || 0, spent: 0, retainSpent: 0, loc: t.loc || null, user: userTeams.includes(t.slug),
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
  const T = (slug) => (teams[slug] = teams[slug] || { roster: [], have: {}, lost: {}, lostCore: {}, best: {}, reserved: 0, considering: [], offered: [], board: [], departed: [] });
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
    // Everyone it's lost (NFL, the portal) — what it makes itself whole from.
    if (gone) T(p.team).departed.push(p);
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
    // Its board: portal players it's evaluating (offers included).
    if (p.status === "portal" && p.evals) Object.keys(p.evals).forEach((slug) => T(slug).board.push(p));
  });
  const idx = { teams, of: (slug) => teams[slug] || { roster: [], have: {}, lost: {}, lostCore: {}, best: {}, reserved: 0, considering: [], offered: [], board: [], departed: [] } };
  INDEX.set(state.players, idx);
  return idx;
}
export const rosterOf = (state, slug) => indexOf(state).of(slug).roster;
// Needs by position (the page's Roster & Needs and "My needs") — from the
// school's wants (wantsOf, below).
export const teamNeeds = (state, slug) => needsOf(state, slug);
export function budgetOf(state, slug) {
  const t = state.teams[slug];
  const reserved = indexOf(state).of(slug).reserved;
  return { budget: t.budget, spent: t.spent, reserved, available: Math.max(0, t.budget - t.spent - reserved) };
}

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
// A CB sizes up the corners, a tackle the tackles (cfg.cpu.subStarters) —
// players with no sub-position count in either room.
export function roomAt(state, slug, p) {
  const t = M.talent(p);
  const idx = indexOf(state).of(slug);
  const subs = p.sub ? state.cfg.cpu?.subStarters?.[p.pos] : null;
  const same = (x) => x.id !== p.id && x.pos === p.pos && (!subs || !x.sub || x.sub === p.sub);
  let ahead = 0;
  const better = [];
  const chasing = [];
  idx.roster.forEach((x) => {
    if (!same(x)) return;
    const tx = M.talent(x);
    if (tx > t) { ahead += 1; better.push(x); } else if (tx === t) ahead += 0.5;
  });
  idx.offered.forEach((x) => {
    if (!same(x) || M.talent(x) < t) return;
    ahead += state.cfg.offerRoomWeight * (M.talent(x) > t ? 1 : 0.5);
    chasing.push(x);
  });
  return { ahead, starters: subs?.[p.sub] ?? (state.cfg.starters[p.pos] || 1), better, chasing };
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
  const scale = state.cfg.entryScale;
  const chance = M.scaleEntry(M.leaveChance(homeGrade(state, p, offer), market, state.cfg), scale, state.cfg);
  // A service academy's players rarely leave (the admin's likeliness wins).
  if (p.likely == null) return state.teams[p.team].academy ? chance * (state.cfg.academies?.entry ?? 1) : chance;
  return M.withLikeliness(chance, p.likely, state.cfg, offer ? M.scaleEntry(M.leaveChance(homeGrade(state, p), market, state.cfg), scale, state.cfg) : chance);
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
  const scores = M.schoolScores(p, state.teams[slug], { nil: offer?.nil || 0, pt: ptAt(state, slug, p), field: fieldOf(p, slug) }, state.cfg);
  const base = M.gradeFrom(p, scores);
  const held = heldBonus(state, offer);
  const process = processFor(state, slug, p, offer);
  const snub = snubOf(state, slug, p);
  return { grade: M.overallGrade(base, process, state.cfg) - snub, base, held, happy: happinessOf(p, slug), process, scores, snub };
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
// ── Boards & the evaluation period (user, 2026-11-15) ──
// Portal window 1 is the evaluation period: no offers — every school puts
// up to board.sizes[0] players on its board (p.evals: { [slug]: window added }).
// Interest builds from the day he's on a board (an offer's `since` carries
// it), and after each window CPU schools read where they stand and move on
// from players they can't win (cpuPlan).
export const isEvalWindow = (state) => state.phase === "window" && state.window === (state.cfg.board?.evalWindow ?? 1);
export const boardOf = (state, slug) => indexOf(state).of(slug).board;
// Contacts allowed in a portal window (board.sizes, the last carries on).
// CPU schools fill their boards at a window's end with that window's
// number — their first 10 at the end of the evaluation period.
export const boardLimit = (state) => {
  const sizes = state.cfg.board?.sizes || [15];
  const i = Math.max(0, (state.window || 1) - (state.cfg.board?.evalWindow ?? 1));
  return sizes[Math.min(i, sizes.length - 1)];
};
// What a school's pursuit of others at his position costs it with him
// (user, 2026-11-15: he sees who else they're chasing) — board.snub × the
// others it's offered there ÷ its wants there (capped at 1); half if it's
// offered him too.
// Only offers to players at or near his level count (audit 2026-11-15: a
// 4★ QB doesn't mind a school also offering a 2★ walk-on).
export function snubOf(state, slug, p) {
  const t = indexOf(state).of(slug);
  const mine = effOf(p, state.cfg);
  const others = t.offered.filter((x) => x.pos === p.pos && x.id !== p.id && effOf(x, state.cfg) >= mine - 0.5).length;
  if (!others) return 0;
  const spots = Math.max(1, wantsOf(state, slug).filter((x) => x.pos === p.pos).length);
  return (state.cfg.board?.snub ?? 0) * Math.min(1, others / spots) * (p.offers?.[slug] ? 0.5 : 1);
}
// What a school would likely offer him: its actual offer, else (evaluating)
// his ask × its tier's aggressiveness — yours at his ask.
export const likelyOffer = (state, slug, p) => p.offers[slug] || { nil: Math.round(p.ask * (state.teams[slug]?.user ? 1 : state.cfg.aggressiveness[state.teams[slug]?.tier] || 1)), since: p.evals?.[slug] };
// Every school tied to him (offering or evaluating) → his grade of it.
// { grades: { [slug]: grade }, best }.
export function tiesOf(state, p) {
  const slugs = new Set([...Object.keys(p.offers || {}), ...Object.keys(p.evals || {})]);
  const grades = {};
  let best = 0;
  slugs.forEach((slug) => {
    if (!state.teams[slug]) return;
    const g = gradeOffer(state, slug, p, likelyOffer(state, slug, p)).grade;
    grades[slug] = g;
    if (g > best) best = g;
  });
  return { grades, best };
}
// Every school in the mix for him (offering or contacted) and its grade,
// best first — kept on him when he commits, for his card.
export function mixOf(state, p) {
  const t = tiesOf(state, p);
  return Object.entries(t.grades).sort((a, b) => b[1] - a[1]).map(([slug, g]) => ({ slug, g: Math.round(g * 1000) / 1000, nil: p.offers[slug]?.nil ?? null }));
}
// Is a school in it for him? Within board.gap of the school he likes best.
export const competitive = (state, ties, slug) => (ties.grades[slug] ?? 0) >= ties.best * (1 - (state.cfg.board?.gap ?? 0.25));
// The user's board: add or drop a portal player (no offer out to drop him).
export function toggleEval(state, slug, pid) {
  const p = state.players[pid];
  if (!state.userTeams.includes(slug)) return { error: "Not your team." };
  if (!p) return { error: "No such player." };
  if (p.evals?.[slug] != null) {
    // Dropping him pulls any offer out to him (it costs his happiness, as
    // pulling one does).
    const evals = { ...p.evals };
    delete evals[slug];
    if (p.status === "portal" && p.offers[slug]) {
      const offers = { ...p.offers };
      delete offers[slug];
      return { state: { ...state, players: { ...state.players, [pid]: { ...p, evals, offers, touched: { ...(p.touched || {}), [slug]: state.window }, happy: sour(p, slug, state.cfg.happiness.pulled) } } } };
    }
    return { state: { ...state, players: { ...state.players, [pid]: { ...p, evals } } } };
  }
  if (state.phase !== "window" || p.status !== "portal") return { error: "You can only contact players in the portal." };
  if (p.cut?.[slug]) return { error: "He's cut you from his list." };
  if (boardOf(state, slug).length >= boardLimit(state)) return { error: `You've used all ${boardLimit(state)} contacts. Remove someone from your board first.` };
  return { state: { ...state, players: { ...state.players, [pid]: { ...p, evals: { ...(p.evals || {}), [slug]: state.window } } } } };
}
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
  if (isEvalWindow(state)) return { error: "It's the evaluation period — no offers yet. Contact him to start building interest." };
  // An offer counts as a contact (if you have one left).
  const evalSince = p.evals?.[slug];
  if (evalSince == null && boardOf(state, slug).length >= boardLimit(state)) return { error: `You've used all ${boardLimit(state)} contacts. Remove someone from your board to offer him.` };
  const amount = Math.max(0, Math.round(Number(nil) || 0));
  const { available } = budgetOf(state, slug);
  const current = p.offers[slug]?.nil || 0;
  if (amount > available + current) return { error: "Over your NIL budget." };
  const hit = offerHit(state, slug, p, amount);
  // since: interest builds from his first day on your board; made: the
  // window you first offered (an offer lands the window after).
  const offer = { nil: amount, window: state.window, since: p.offers[slug]?.since ?? evalSince ?? state.window, made: p.offers[slug]?.made ?? state.window };
  const teams = state.teams;
  const q = {
    ...p,
    evals: { ...(p.evals || {}), [slug]: evalSince ?? state.window },
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
        players: { ...state.players, [pid]: { ...q, status: "committed", to: slug, deal: { ...offer }, offers: {}, mix: mixOf(state, { ...p, offers: { ...p.offers, [slug]: offer } }) } },
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
        // A recent blue-chip recruit is worth keeping on his pedigree, played
        // or not (as a rotation player at his recruit level).
        const rec = M.recruitLevel(p, cfg);
        const recWorth = rec != null ? rec * 10 * (cfg.roleWorth.rotation ?? 0.7) * urg : 0;
        return { p, urg, worth: Math.max(M.retainWorth(p, urg, cfg), recWorth) };
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
    // His chance of wanting out (the same model the retention window
    // resolves with — academies included).
    const lean = transferLeave(state, p);
    if (draw(state, `enter|${p.id}`) >= lean) return;
    players[p.id] = { ...p, status: "considering", considering: "transfer", lean, reason: M.transferReason(p, scores, state.cfg, homeTier) };
  });
  return { ...state, players, log, phase: "retain" };
}

// The user's done with an opening window. → { state, summary }
function endOpening(state, stage) {
  const before = state.log.length;
  let next = resolveConsidering(cpuRetention(state), stage);
  next = stage === "nfl" ? openRetainWindow(next) : rosterTargets({ ...shedRosters(next), phase: "window", window: 1 });
  return { state: next, summary: { stage, events: next.log.slice(before) } };
}

// ── Making room (user, 2026-11-15) ──
// A CPU school over the cap — who's staying, plus its high school class
// (cfg.hsClass) and the room it keeps for portal signings
// (cfg.portalRoom by tier) — cuts its least valuable players into the
// portal: walk-ons who never played first (its own read: effOf, recruits
// included). Never below a position's starters + depth + 1; kickers /
// punters stay. Service academies, FCS schools and the user's teams don't.
function shedRosters(state) {
  const cfg = state.cfg;
  const cap = cfg.rosterCap;
  if (!cap || state.live) return state;
  const players = { ...state.players };
  const log = [...state.log];
  const byTeam = {};
  Object.values(state.players).forEach((p) => { if (p.status === "roster") (byTeam[p.team] = byTeam[p.team] || []).push(p); });
  Object.values(state.teams).forEach((t) => {
    if (t.user || t.fcs || t.academy) return;
    const roster = byTeam[t.slug] || [];
    let over = roster.length + (cfg.hsClass ?? 0) + (cfg.portalRoom?.[t.tier] ?? 0) - cap;
    if (over <= 0) return;
    const count = {};
    roster.forEach((p) => { count[p.pos] = (count[p.pos] || 0) + 1; });
    const keepMin = (pos) => (cfg.starters[pos] || 0) + (cfg.cpu.depth?.[pos] ?? 0) + 1;
    const order = roster
      .filter((p) => p.pos !== "K" && p.pos !== "P" && p.likely !== 0)
      .map((p) => ({ p, v: effOf(p, cfg) + Math.min(p.elig || 0, 4) * 0.01 + draw(state, `shed|${p.id}`) * 0.01 }))
      .sort((a, b) => a.v - b.v);
    for (const { p } of order) {
      if (over <= 0) break;
      if (count[p.pos] <= keepMin(p.pos)) continue;
      count[p.pos] -= 1;
      over -= 1;
      players[p.id] = { ...p, status: "portal", enteredWindow: 1, reason: "roster" };
      log.push({ w: 0, stage: "retain", kind: "entered", pid: p.id, team: p.team, reason: "roster", cut: true });
    }
  });
  return { ...state, players, log };
}

// ── Roster targets (user, 2026-11-15) ──
// When the portal opens, every school draws how many it wants at each
// position from the real averages (cfg.rosterSize: [avg, sd], within 2 sd);
// DL covers DL + EDGE, split by its own mix of the two. An implied high
// school class (cfg.hsClass — the sim has no freshmen) covers part of the
// gap, most where it's shortest; the portal is for the rest. K / P aren't
// in the numbers — they keep what they have. → team.portalTarget { [pos] }.
function rosterTargets(state) {
  const cfg = state.cfg;
  const sizes = cfg.rosterSize || {};
  const now = {};
  const orig = {};
  Object.values(state.players).forEach((p) => {
    (orig[p.team] = orig[p.team] || {})[p.pos] = (orig[p.team][p.pos] || 0) + 1;
    if (p.status === "roster" || p.status === "considering") (now[p.team] = now[p.team] || {})[p.pos] = (now[p.team][p.pos] || 0) + 1;
  });
  const teams = { ...state.teams };
  Object.values(teams).forEach((t) => {
    if (t.fcs) return;
    const have = now[t.slug] || {};
    const was = orig[t.slug] || {};
    const target = {};
    Object.entries(sizes).forEach(([pos, [avg, sd]]) => {
      const r = rngFor(state, `roster|${t.slug}|${pos}`);
      const z = Math.max(-2, Math.min(2, Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r())));
      const n = Math.max(0, Math.round(avg + z * sd));
      if (pos === "DL") {
        // DL + EDGE together, split by its own roster's mix.
        const dl = was.DL || 0;
        const edge = was.EDGE || 0;
        const share = dl + edge ? dl / (dl + edge) : 0.55;
        target.DL = Math.round(n * share);
        target.EDGE = n - target.DL;
      } else target[pos] = n;
    });
    // The whole roster comes to cfg.rosterCap (K / P — what it has, at least
    // 2 — included): scale the draws, then floor each position at its
    // starters + depth + 1, or its average less a standard deviation (DL /
    // EDGE: starters + depth + 1 each — the split comes from roster labels).
    const cap = cfg.rosterCap;
    if (cap) {
      const kp = Math.max(2, (have.K || 0) + (have.P || 0));
      const sum = Object.values(target).reduce((a, n) => a + n, 0);
      const scale = sum ? (cap - kp) / sum : 1;
      Object.keys(target).forEach((pos) => {
        const base = (cfg.starters[pos] || 0) + (cfg.cpu.depth?.[pos] ?? 0) + 1;
        const [avg, sd] = pos === "DL" || pos === "EDGE" ? [0, 0] : sizes[pos];
        target[pos] = Math.max(base, Math.ceil(avg - sd), Math.round(target[pos] * scale));
      });
    }
    // The implied high school class, spread over its shortages.
    const short = Object.fromEntries(Object.entries(target).map(([pos, n]) => [pos, Math.max(0, n - (have[pos] || 0))]));
    const total = Object.values(short).reduce((a, n) => a + n, 0);
    const hs = cfg.hsClass ?? 22;
    const portalTarget = {};
    Object.entries(target).forEach(([pos, n]) => {
      const fresh = total ? Math.min(short[pos], Math.round((hs * short[pos]) / total)) : 0;
      portalTarget[pos] = n - fresh;
    });
    teams[t.slug] = { ...t, rosterTarget: target, portalTarget };
  });
  return { ...state, teams };
}
export const endNflWindow = (state) => (state.phase === "nfl" ? endOpening(state, "nfl") : { state, summary: null });
export const endRetainWindow = (state) => (state.phase === "retain" ? endOpening(state, "retain") : { state, summary: null });

// ── CPU schools: the plan (user, 2026-11-15) ──
// After every window (players decide first), each CPU school looks at its
// roster, the portal, and where it stands with everyone it's chasing — and
// acts. Teams lose players; they try to improve on what's left and replace
// what they lost, within their budget:
//  1. Wants (wantsOf) — per position, from the room it has now (stayed +
//     signed): each starting spot is a hole (no one, or no one close), an
//     upgrade (its starter is under its tier's standard — cpu.standard: a
//     blue blood wants 5★ starters, a Group of 5 is content with 3★) or set;
//     rotation players it's short are depth wants. A player fits a want only
//     if he'd be a real improvement (effOf: stars, less for not having
//     played). A want it can't fill with a real improvement just stays open
//     — no one's signed for the sake of it.
//  2. Its offers out each cover a want (best player first); one that covers
//     none — the spot's been filled — is pulled.
//  3. Standing (tiesOf: his grade of the school vs the school he likes
//     best): offers it's clearly losing (board.gap) are pulled, contacts
//     it's losing are dropped, and so are contacts at positions it's
//     already covered.
//  4. Offers (from the window after the evaluation period): each open want,
//     most important first, goes to the best player it's in it for — its
//     contacts, or later (cpu.directFrom windows on) straight from the
//     portal — within budget, keeping money back for the wants after it.
//     A big want it isn't leading for can carry a second offer.
//  5. Contacts, up to this window's allowance (board.sizes): board.perSpot
//     per open want, best value × chance first — it can aim a little high
//     and find out.
const EFF_ROLE = { starter: 0, rotation: 0.5, reserve: 1, none: 1.5 };
// A player's effective level: his stars, less for not having played — or,
// for a recent recruit, at least his recruiting profile (models
// recruitLevel: a 4★ freshman RB who wants snaps is still a 4★ prospect).
export const effOf = (p, cfg) => {
  const base = p.stars - (EFF_ROLE[p.role] ?? 0.6);
  const rec = cfg ? M.recruitLevel(p, cfg) : null;
  return rec != null && rec > base ? rec : base;
};
// Does a player fit a want? Its position (and sub-position, when both have
// one) and its bar, as the school sees him.
const fitsWant = (x, p, level) => x.pos === p.pos && (!x.sub || !p.sub || x.sub === p.sub) && level >= x.min - 1e-9 && (x.max == null || level <= x.max + 1e-9);
// How far into the portal: 0 at the evaluation period's end, 1 at the last
// offer pass — a hole gets more desperate as it goes (cfg.cpu.desperate).
const progressOf = (state, w) => {
  const evalW = state.cfg.board?.evalWindow ?? 1;
  return Math.max(0, Math.min(1, (w - evalW) / Math.max(1, state.windows - 1 - evalW)));
};
// Its wants this window: a hole's bar drops with desperation — never to a
// player no better than who it has.
export function planWants(state, slug, w = state.window) {
  const d = state.cfg.cpu.desperate;
  const pr = progressOf(state, w);
  return wantsOf(state, slug).map((x) => (x.kind === "hole" && d ? { ...x, min: Math.max((x.cur ?? -9) + 0.25, x.min - d.minDrop * pr) } : x));
}

// A school's own read of a player (user, 2026-11-15): his stars are the
// foundation, but each school sees him off them by a normal draw
// (cpu.opinionSd, fixed for the run) — one has a 5★ as a 5.5, another as a
// 4.6. It decides whom it chases and what it bids.
// (Cached per seed → school → player: it's read constantly.)
const OPINIONS = new Map();
export function opinionOf(state, slug, pid) {
  let bySeed = OPINIONS.get(state.seed);
  if (!bySeed) {
    if (OPINIONS.size > 4) OPINIONS.clear();
    bySeed = new Map();
    OPINIONS.set(state.seed, bySeed);
  }
  let bySchool = bySeed.get(slug);
  if (!bySchool) { bySchool = new Map(); bySeed.set(slug, bySchool); }
  let z = bySchool.get(pid);
  if (z == null) {
    const r = rngFor(state, `opinion|${slug}|${pid}`);
    const u = Math.max(1e-9, r());
    z = Math.max(-2.5, Math.min(2.5, Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())));
    bySchool.set(pid, z);
  }
  return z * (state.cfg.cpu.opinionSd ?? 0.45);
}
// His level as a school sees him.
export const seenEff = (state, slug, p) => effOf(p, state.cfg) + opinionOf(state, slug, p.id);

// A school's wants, most important first:
// [{ pos, sub (CB / S, OT / IOL — starters only), kind: hole | upgrade |
//   depth | body, min (the level he must reach — as it sees him), base (the
//   level he'd replace), cur (who it has there), pri }].
export function wantsOf(state, slug) {
  const t = indexOf(state).of(slug);
  if (t.wants) return t.wants;
  const cfg = state.cfg;
  const c = cfg.cpu;
  const team = state.teams[slug];
  const tierStd = c.standard?.[team?.tier] ?? 3.5;
  const eff = (x) => effOf(x, cfg);
  const starters = [];
  const extra = []; // depth + bodies (they stop at the roster cap)
  const bodyGap = {};
  Object.entries(cfg.starters).forEach(([pos, n]) => {
    const w = c.posWeight?.[pos] ?? 1;
    const std = tierStd + (c.standardBonus?.[pos] || 0);
    const players = t.roster.filter((x) => x.pos === pos);
    const byEff = (a, b) => b.e - a.e;
    const ranked = players.map((x) => ({ x, e: eff(x) })).sort(byEff);
    const room = ranked.map((y) => y.e);
    // Starting spots, by sub-position where it has them: a player with no
    // sub-position fills whichever is shorter.
    const subs = c.subStarters?.[pos];
    const groups = [];
    if (subs) {
      const lists = Object.fromEntries(Object.keys(subs).map((s) => [s, []]));
      const loose = [];
      ranked.forEach((y) => (lists[y.x.sub] ? lists[y.x.sub].push(y) : loose.push(y)));
      loose.forEach((y) => {
        const s = Object.keys(subs).sort((a, b) => lists[a].length / subs[a] - lists[b].length / subs[b])[0];
        lists[s].push(y);
      });
      Object.entries(subs).forEach(([s, k]) => groups.push({ sub: s, n: k, room: lists[s].sort(byEff) }));
    } else groups.push({ sub: null, n, room: ranked });
    groups.forEach(({ sub, n: k, room: r }) => {
      for (let i = 0; i < k; i += 1) {
        const cur = r[i]?.e;
        // A hole: no one, or no one close (holeBelow under the standard) —
        // anyone starter-worthy (holeMin under it) fills it.
        if (cur == null || cur < std - c.holeBelow) {
          starters.push({ pos, sub, kind: "hole", min: Math.max(std - c.holeMin, (cur ?? -9) + c.upgradeBy), base: cur ?? std - c.holeBelow, cur, pri: c.holePri * w });
        } else if (std - cur >= c.upgradeGap && pos !== "K" && pos !== "P" && r[i].x.status !== "committed") {
          // (Never over a player it signed this portal — it brought him in
          // to start.)
          starters.push({ pos, sub, kind: "upgrade", min: cur + c.upgradeBy, base: cur, cur, pri: (std - cur) * w });
        }
      }
    });
    // Rotation behind the starters: playable bodies (within depthBelow of
    // its standard).
    const playable = room.slice(n).filter((e) => e >= std - c.depthBelow).length;
    for (let i = playable; i < (c.depth?.[pos] ?? 0); i += 1) {
      extra.push({ pos, kind: "depth", min: std - c.depthBelow, base: std - c.depthBelow - 0.75, pri: c.depthPri * w });
    }
    // Bodies (user, 2026-11-15: a fixed environment — a team fills its
    // roster): up to its portal target at this position (rosterTargets —
    // the real roster numbers, less its implied high school class). Anyone
    // at least bodyBelowStd under its standard will do — a Group of 5 takes
    // 2★ depth, a blue blood doesn't.
    const goal = team?.portalTarget?.[pos];
    // A QB body is a backup: clearly under the starter it has and under a
    // starter's standard (no second starting QB through the back door).
    if (goal != null && goal > room.length) bodyGap[pos] = { left: goal - room.length, goal, min: Math.max(c.bodyFloor ?? 0.25, std - (c.bodyBelowStd ?? 2.5)), max: pos === "QB" ? Math.min(room.length ? room[0] - 0.75 : Infinity, std - 1.25) : null, w };
  });
  // At most cpu.maxUpgrades upgrade wants — its biggest.
  const maxUp = c.maxUpgrades?.[team?.tier];
  const ups = starters.filter((x) => x.kind === "upgrade").sort((a, b) => b.pri - a.pri);
  const keepUp = new Set(maxUp == null ? ups : ups.slice(0, maxUp));
  const out = starters.filter((x) => x.kind !== "upgrade" || keepUp.has(x));
  // Depth and bodies stop at the roster cap (its roster now + its implied
  // high school class): depth first, then bodies one at a time to the
  // position furthest short of its goal. (Schools over the cap made room
  // when the portal opened — shedRosters.)
  const fresh = team?.rosterTarget ? Object.values(team.rosterTarget).reduce((a, n) => a + n, 0) - Object.values(team.portalTarget || {}).reduce((a, n) => a + n, 0) : 0;
  let room = cfg.rosterCap ? cfg.rosterCap - t.roster.length - fresh : Infinity;
  extra.sort((a, b) => b.pri - a.pri).forEach((x) => { if (room > 0) { out.push(x); room -= 1; } });
  while (room > 0) {
    const pos = Object.keys(bodyGap).filter((k) => bodyGap[k].left > 0).sort((a, b) => bodyGap[b].left / bodyGap[b].goal - bodyGap[a].left / bodyGap[a].goal)[0];
    if (!pos) break;
    const g = bodyGap[pos];
    out.push({ pos, kind: "body", min: g.min, max: g.max, base: g.min - 0.75, pri: (c.bodyPri ?? 0.3) * g.w });
    g.left -= 1;
    room -= 1;
  }
  t.wants = out.sort((a, b) => b.pri - a.pri);
  return t.wants;
}
// Needs for the page (Roster & Needs, filters): per position, big (a hole
// or a big upgrade) 2, a need 1, depth 0.4, bodies 0.2, set 0.
export function needsOf(state, slug) {
  const out = {};
  Object.keys(state.cfg.starters).forEach((pos) => { out[pos] = 0; });
  wantsOf(state, slug).forEach((w) => {
    const v = w.kind === "hole" ? 2 : w.kind === "upgrade" ? (w.pri >= 1.5 ? 2 : 1) : w.kind === "depth" ? 0.4 : 0.2;
    out[w.pos] = Math.min(3, out[w.pos] + v);
  });
  return out;
}

// His standing with a school: its grade ÷ the best (1 = leading), and the
// chance factor 0..1 (0 at the board.gap line, 1 leading).
// rank: where it sits among the schools on him — in it only within
// board.gap of the best AND in his top board.maxRank (grades run close, so
// the rank does most of the telling).
// gate: { gap, maxRank } for a want that's widened them (desperation).
function standingOf(state, ties, slug, grade = ties.grades[slug], gate = null) {
  const gap = gate?.gap ?? state.cfg.board?.gap ?? 0.12;
  const maxRank = gate?.maxRank ?? state.cfg.board?.maxRank ?? 6;
  const g = grade ?? 0;
  const best = Math.max(ties.best, g);
  const ratio = best > 0 ? g / best : 1;
  const rank = 1 + Object.entries(ties.grades).filter(([k, v]) => k !== slug && v > g).length;
  const chance = Math.max(0, Math.min(1, (ratio - (1 - gap)) / gap)) * Math.max(0, (maxRank + 1 - rank) / maxRank);
  return { ratio, rank, chance, in: ratio >= 1 - gap && rank <= maxRank };
}

// What a school bids (user, 2026-11-15: his NIL ask is a starting point,
// not the price): ask × valueCenter × its tier's aggressiveness ×
// likeBase^(how much more it likes him than his stars), up for competition (other
// schools offering, cpu.bid.competition each) and for scarcity (few others
// it's in it for at a big want), ± window noise. cap: the most it would
// ever pay him (bid.maxMult × ask × likeBase^like).
function bidFor(state, team, p, x, alts) {
  const c = state.cfg.cpu;
  const b = c.bid;
  // Its opinion — plus, for a recent recruit, how far his recruiting
  // profile sits over his portal grade (a 4★ freshman with a 3★ portal
  // grade is priced as more than a 3★).
  const rec = M.recruitLevel(p, state.cfg);
  const like = opinionOf(state, team.slug, p.id) + (rec != null ? Math.max(0, rec - p.stars) : 0);
  const others = Object.keys(p.offers || {}).filter((k) => k !== team.slug).length;
  const scarce = x.kind === "depth" || x.kind === "body" ? 0 : Math.max(0, (b.scarceAlts - alts) / b.scarceAlts) * Math.min(1, x.pri / 2);
  const mult = (c.valueCenter ?? 0.85) * (state.cfg.aggressiveness[team.tier] || 1) * (b.likeBase ?? 2) ** like
    * (1 + b.competition * Math.min(others, b.competitionCap)) * (1 + b.scarcity * scarce)
    * (1 + (draw(state, `offer|${team.slug}|${p.id}|${state.window}`) - 0.5) * c.windowNoise);
  // His ask is where it starts: never under bid.floor × it.
  return { nil: Math.round((p.ask * Math.max(b.floor ?? 0, mult)) / 1000) * 1000, cap: Math.round((p.ask * b.maxMult * (b.likeBase ?? 2) ** like) / 1000) * 1000 };
}
// The best other offer on the table for him (what a school's bid is up
// against — and what a player weighs it against).
export const fieldOf = (p, slug) => Object.entries(p.offers || {}).reduce((m, [k, o]) => (k !== slug && o.nil > m ? o.nil : m), 0);

function cpuPlan(state) {
  const cfg = state.cfg;
  const c = cfg.cpu;
  const w = state.window;
  const evalW = cfg.board?.evalWindow ?? 1;
  const offering = w > evalW; // the evaluation period's end: contacts only
  // What it does now shows up in the next window, so that's when it counts
  // from — interest only builds BETWEEN windows (user, 2026-11-15). Its
  // first contacts are the evaluation period's own.
  const stamp = offering ? w + 1 : w;
  const direct = w >= evalW + (c.directFrom ?? 2);
  const players = { ...state.players };
  const log = [...state.log];
  const limit = boardLimit(state);
  const perSpot = cfg.board?.perSpot ?? 2;
  const portal = Object.values(state.players).filter((p) => p.status === "portal");
  const byPos = {};
  portal.forEach((p) => { (byPos[p.pos] = byPos[p.pos] || []).push(p); });
  // His ties, kept live through the pass: a school that contacts, offers,
  // raises or drops him changes them for the schools after it.
  const ties = new Map();
  const tiesFor = (p) => { if (!ties.has(p.id)) ties.set(p.id, tiesOf(state, players[p.id])); return ties.get(p.id); };
  const tieSet = (p, slug, grade) => { const t = tiesFor(p); t.grades[slug] = grade; t.best = Math.max(0, ...Object.values(t.grades)); };
  const tieDrop = (p, slug) => { const t = tiesFor(p); delete t.grades[slug]; t.best = Math.max(0, ...Object.values(t.grades)); };
  const regrade = (p, slug) => tieSet(p, slug, gradeOffer(state, slug, players[p.id], players[p.id].offers[slug] || likelyOffer(state, slug, players[p.id])).grade);
  // Who might fit a want: everyone at the position good enough (as it sees
  // him), best first — cpu.pool of them, not just the most contested few.
  const poolSize = c.pool ?? 80;
  // Turn order: shuffled every window (audit 2026-11-15 — in tier order the
  // blue bloods claimed every player before anyone else looked).
  const order = (slug) => hash(`${state.seed}|ord|${w}|${slug}`);
  const teams = Object.values(state.teams).filter((t) => !t.user && !t.fcs && !t.academy).sort((a, b) => order(a.slug) - order(b.slug));
  // Desperation (cfg.cpu.desperate): a hole widens what counts as "in it" as
  // the portal goes on, and in its last offer passes it takes the best fit
  // it can find, in it or not.
  const d = c.desperate || {};
  const pr = progressOf(state, w);
  const lastPasses = d.freeFrom != null && w >= state.windows - d.freeFrom;
  const gateOf = (x) => (x.kind === "hole" ? { gap: (cfg.board?.gap ?? 0.12) + (d.gap ?? 0) * pr, maxRank: (cfg.board?.maxRank ?? 6) + Math.round((d.rank ?? 0) * pr), free: lastPasses } : null);
  let made = 0;

  teams.forEach((team) => {
    const slug = team.slug;
    const idx = indexOf(state).of(slug);
    const wants = planWants(state, slug, w).map((x) => ({ ...x, offers: [], lead: false }));
    // How it sees each player — once per pass.
    const seenMemo = new Map();
    const seen = (p) => {
      let v = seenMemo.get(p.id);
      if (v == null) { v = seenEff(state, slug, p); seenMemo.set(p.id, v); }
      return v;
    };
    const fits = (x, p) => fitsWant(x, p, seen(p));
    const open = (x) => x.offers.length === 0 || (!x.lead && x.offers.length < 2 && x.pri >= c.backupPri);
    const bud = budgetOf(state, slug);
    let available = Math.max(0, bud.budget - bud.spent - bud.reserved);
    // Its read of where it stands with a player (his grade of it with a
    // likely offer) — once per pass.
    const est = new Map();
    const estimateOnce = (p) => {
      if (!est.has(p.id)) {
        const t = tiesFor(p);
        const grade = t.grades[slug] ?? gradeOffer(state, slug, players[p.id], { nil: Math.round(p.ask * (cfg.aggressiveness[team.tier] || 1)), since: w }).grade;
        est.set(p.id, { ...standingOf(state, t, slug, grade), grade });
      }
      return est.get(p.id);
    };
    // Paying to get in (audit 2026-11-15: money couldn't buy standing): the
    // least NIL that puts it in it for him at a want of cpu.payUpPri or
    // more — up to its cap on him and payShare of what it has left (on top
    // of an offer it already has out, `from`). null: no price gets it in.
    const priceIn = (p, x, gate, from = 0) => {
      if (!(x.pri >= (c.payUpPri ?? Infinity))) return null;
      const cur = players[p.id];
      const t = tiesFor(p);
      const share = x.pos === "QB" ? (c.payShareQB ?? c.payShare) : c.payShare;
      const lo = from || Math.round(p.ask * (cfg.aggressiveness[team.tier] || 1));
      const hi = Math.min(bidFor(state, team, cur, x, 0).cap, from + Math.floor(available * (share ?? 0.4)));
      if (hi <= lo) return null;
      const since = cur.offers[slug]?.since ?? cur.evals?.[slug] ?? w;
      const inAt = (nil) => standingOf(state, t, slug, gradeOffer(state, slug, cur, { nil, since }).grade, gate).in;
      if (!inAt(hi)) return null;
      let a = lo;
      let b = hi;
      for (let i = 0; i < 6; i += 1) { const m = (a + b) / 2; if (inAt(m)) b = m; else a = m; }
      return Math.ceil(b / 1000) * 1000;
    };
    // Is it in it for him at a want — as things stand, desperate enough not
    // to care, or for a price? → { in, st, grade, need (NIL it must offer) }.
    const reachMemo = new Map();
    const reach = (p, x) => {
      const gate = gateOf(x);
      const key = `${p.id}|${gate ? "h" : x.pri >= (c.payUpPri ?? Infinity) ? "p" : "n"}`;
      if (reachMemo.has(key)) return reachMemo.get(key);
      const e = estimateOnce(p);
      const st = standingOf(state, tiesFor(p), slug, e.grade, gate);
      let r = { in: st.in || !!gate?.free, st, grade: e.grade, need: 0 };
      if (!r.in) {
        const need = priceIn(p, x, gate);
        if (need != null) {
          const grade = gradeOffer(state, slug, players[p.id], { nil: need, since: players[p.id].evals?.[slug] ?? w }).grade;
          r = { in: true, st: standingOf(state, tiesFor(p), slug, grade, gate), grade, need };
        }
      }
      reachMemo.set(key, r);
      return r;
    };
    const drop = (p, why) => {
      const cur = players[p.id];
      const evals = { ...(cur.evals || {}) };
      delete evals[slug];
      const offers = { ...cur.offers };
      if (offers[slug]) {
        log.push({ w, kind: "pulled", pid: p.id, team: p.team, to: slug, nil: offers[slug].nil, why });
        available += offers[slug].nil;
        delete offers[slug];
      }
      players[p.id] = { ...cur, evals, offers };
      tieDrop(p, slug);
    };
    const setOffer = (p, nil) => {
      const cur = players[p.id];
      const prior = cur.offers[slug];
      const since = prior?.since ?? cur.evals?.[slug] ?? stamp;
      players[p.id] = { ...cur, evals: { ...(cur.evals || {}), [slug]: cur.evals?.[slug] ?? stamp }, offers: { ...cur.offers, [slug]: { nil, window: w, since, made: prior?.made ?? w } }, high: { ...(cur.high || {}), [slug]: Math.max(nil, cur.high?.[slug] || 0) } };
      available -= nil - (prior?.nil || 0);
      regrade(p, slug);
    };

    // 2–3. Offers out: losing ones go; the rest cover wants (best first) —
    // and where it's behind on a player it wants, it bids more (bid.raise
    // over its offer, or bid.overField over the best one on the table, up
    // to its cap).
    idx.board.filter((p) => p.offers[slug]).sort((a, b) => seen(b) - seen(a)).forEach((p) => {
      const x = wants.find((y) => fits(y, p) && open(y));
      if (!x) { drop(p, "filled"); return; }
      const gate = gateOf(x);
      let st = standingOf(state, tiesFor(p), slug, undefined, gate);
      if (!st.in && !gate?.free) {
        // Losing him: pay to get back in it, or move on.
        const mine = players[p.id].offers[slug].nil;
        const need = priceIn(p, x, gate, mine);
        if (need != null && need > mine) {
          setOffer(p, need);
          st = standingOf(state, tiesFor(p), slug, undefined, gate);
        } else if (p.offers[slug].made < w) { drop(p, "moved"); return; }
      }
      const cur = players[p.id];
      if (st.rank > 1 && (x.pri >= 1 || opinionOf(state, slug, p.id) > 0)) {
        const { cap } = bidFor(state, team, cur, x, 0);
        const mine = cur.offers[slug].nil;
        const target = Math.min(cap, Math.max(mine * (1 + c.bid.raise), fieldOf(cur, slug) * (1 + c.bid.overField)), mine + available);
        if (target >= mine + 1000) {
          setOffer(p, Math.round(target / 1000) * 1000);
          st = standingOf(state, tiesFor(p), slug, undefined, gate);
        }
      }
      x.offers.push(p);
      if (st.ratio >= 1) x.lead = true;
    });
    // Contacts: ones at positions it's covered, and ones it can't get in on
    // (even paying), go.
    const contacts = idx.board.filter((p) => !p.offers[slug] && players[p.id].evals?.[slug] != null).filter((p) => {
      const x = wants.find((y) => open(y) && fits(y, p));
      if (!x) { drop(p, "covered"); return false; }
      if (p.evals[slug] <= w && !reach(p, x).in) { drop(p, "moved"); return false; }
      return true;
    });

    // 4. Offers: each open want, most important first.
    const reserveFor = (x) => (x.kind === "depth" || x.kind === "body" ? 0 : (cfg.askByStars[Math.max(2, Math.min(6, Math.ceil(x.min)))] || 0) * c.reserveShare);
    let n = cfg.offersPerWindow[team.tier] || 6;
    const taken = new Set(); // offered or contacted this pass
    const offeredNow = new Set();
    let board = idx.board.filter((p) => players[p.id].evals?.[slug] != null).length;
    // A candidate's appeal for a want: the improvement (as it sees him) ×
    // the want's weight × his chance with it (est.: his grade of it with a
    // likely offer).
    const appeal = (x, p, st) => (seen(p) - x.base) * (c.posWeight?.[x.pos] ?? 1) * (0.1 + st.chance) ** 1.5;
    // For a body or depth spot it looks past the most contested: his level
    // less cpu.bodyCrowd per school already on him.
    const crowdMemo = new Map();
    const crowdOf = (p) => {
      let n = crowdMemo.get(p.id);
      if (n == null) {
        const cur = players[p.id];
        n = Object.keys(cur.offers).length + Object.keys(cur.evals || {}).filter((k) => !cur.offers[k]).length;
        crowdMemo.set(p.id, n);
      }
      return n;
    };
    const poolFor = (x, skip) => {
      const body = x.kind === "body" || x.kind === "depth";
      const out = [];
      (byPos[x.pos] || []).forEach((p) => {
        if (players[p.id].status !== "portal" || skip(p)) return;
        const v = seen(p);
        if (v < x.min - 1e-9 || (x.max != null && v > x.max + 1e-9)) return;
        out.push({ p, k: body ? v - (c.bodyCrowd ?? 0.4) * crowdOf(p) : v });
      });
      return out.sort((a, b2) => b2.k - a.k).slice(0, poolSize).map((y) => y.p);
    };
    // Players it's in it for at a want (as things stand, desperate, or for
    // a price — reach), best appeal first.
    const candidates = (x, pool) => pool
      // Its own entrants too (user, 2026-11-15: a school can recruit back a
      // player who left) — not ones it cut to make room.
      .filter((p) => fits(x, p) && !taken.has(p.id) && !players[p.id].offers[slug] && !players[p.id].cut?.[slug] && !(p.team === slug && p.reason === "roster"))
      .map((p) => ({ p, r: reach(p, x) }))
      .filter((y) => y.r.in)
      .map((y) => ({ p: y.p, st: y.r.st, need: y.r.need, grade: estimateOnce(y.p).grade, score: appeal(x, y.p, y.r.st) }))
      .sort((a, b2) => b2.score - a.score);
    // Straight-from-the-portal candidates, built once per kind of want and
    // narrowed as it goes (taken / offered drop out in candidates' filter).
    const portalLists = new Map();
    const portalFor = (x) => {
      const key = `${x.pos}|${x.sub || ""}|${x.kind === "body" || x.kind === "depth" ? "b" : x.kind}|${x.min.toFixed(2)}`;
      if (!portalLists.has(key)) portalLists.set(key, candidates(x, poolFor(x, () => false)));
      return portalLists.get(key).filter((y) => !taken.has(y.p.id) && !players[y.p.id].offers[slug]);
    };
    if (offering) {
      wants.forEach((x, i) => {
        while (open(x) && n > 0 && available > 0) {
          // Its contacts first; then (bodies and depth from the first offer
          // window, the rest later) anyone it's in it for — room permitting.
          let list = candidates(x, contacts.filter((p) => p.evals[slug] <= w));
          const directOk = (direct || x.kind === "body" || x.kind === "depth") && board < limit;
          if (!list.length && directOk) list = portalFor(x);
          // Money held back for what's next: the next few important wants
          // (cpu.reserveWants), never more than half of what's left.
          const keep = wants.slice(i + 1).filter((y) => open(y) && y.pri >= 1).slice(0, c.reserveWants ?? 3).reduce((a, y) => a + reserveFor(y), 0);
          const room = available - Math.min(keep, available * 0.5);
          // The best one it can afford (stretching a little) who wouldn't
          // cut it on sight.
          let pick = null;
          for (const y of list) {
            const { p } = y;
            // Its bid — at least what it takes to be in it for him.
            let nil = Math.max(bidFor(state, team, players[p.id], x, list.length - 1).nil, y.need || 0);
            if (nil > room) {
              if (room < nil * c.stretch || room < p.ask * c.stretch) continue;
              nil = Math.floor(room / 1000) * 1000;
            }
            if (M.badAs(p, M.schoolScores(p, team, { nil, pt: ptAt(state, slug, p) }, cfg), cfg) >= cfg.cutBadA.count) continue;
            pick = { ...y, nil };
            break;
          }
          if (!pick) break;
          if (players[pick.p.id].evals?.[slug] == null) board += 1;
          setOffer(pick.p, pick.nil);
          taken.add(pick.p.id);
          offeredNow.add(pick.p.id);
          x.offers.push(pick.p);
          if (standingOf(state, tiesFor(pick.p), slug, undefined, gateOf(x)).ratio >= 1) x.lead = true;
          n -= 1;
          made += 1;
        }
      });
    }

    // 5. Contacts: feel out board.perSpot per open want (one for a depth or
    // body want), handed out in rounds — one per position per round,
    // positions by their most important open want — so the board spreads
    // across needs.
    // (A position's sub-positions — corners, safeties — plan separately.)
    const groupOf = (x) => `${x.pos}|${x.sub || ""}`;
    const positions = [];
    wants.forEach((x) => { if (open(x) && !positions.some((y) => groupOf(y) === groupOf(x))) positions.push(x); });
    const plan = positions.map((x) => {
      const openHere = wants.filter((y) => groupOf(y) === groupOf(x) && open(y));
      const have = contacts.filter((p) => fits({ ...x, min: -9 }, p) && !offeredNow.has(p.id) && players[p.id].evals?.[slug] != null).length;
      return { x, loose: { ...x, min: Math.min(...openHere.map((y) => y.min)) }, room: openHere.reduce((acc, y) => acc + (y.kind === "depth" || y.kind === "body" ? 1 : perSpot), 0) - have, list: null };
    }).filter((q) => q.room > 0);
    let added = true;
    while (board < limit && added) {
      added = false;
      for (const q of plan) {
        if (board >= limit) break;
        if (q.room <= 0) continue;
        if (!q.list) q.list = candidates(q.loose, poolFor(q.loose, (r) => players[r.id].evals?.[slug] != null));
        const next = q.list.find(({ p }) => players[p.id].evals?.[slug] == null && !taken.has(p.id));
        if (!next) { q.room = 0; continue; }
        const cur = players[next.p.id];
        players[next.p.id] = { ...cur, evals: { ...(cur.evals || {}), [slug]: stamp } };
        tieSet(next.p, slug, next.grade);
        taken.add(next.p.id);
        contacts.push(next.p);
        board += 1;
        q.room -= 1;
        added = true;
      }
    }
  });
  return { state: { ...state, players, log }, made };
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
  // A CPU school's offer stands only while it still has a want he fits (a
  // backup offer loses out once the other one signs) and the money. Wants
  // left per school, used up as players sign.
  const left = {};
  const wantFor = (slug, p) => {
    if (!left[slug]) left[slug] = planWants(state, slug).slice();
    const level = seenEff(state, slug, p);
    return left[slug].findIndex((x) => fitsWant(x, p, level));
  };
  // Signings this window, so a room fills as players sign (audit
  // 2026-11-15: two players at a position could sign the same window, each
  // expecting to start). A signee was already in the room part-way (an open
  // offer — offerRoomWeight); now he counts fully.
  const signedNow = {};
  const ptNow = (slug, p) => {
    const room = roomAt(state, slug, p);
    const t = M.talent(p);
    let extra = 0;
    (signedNow[`${slug}|${p.pos}`] || []).forEach((x) => {
      if (p.sub && x.sub && x.sub !== p.sub && state.cfg.cpu?.subStarters?.[p.pos]) return;
      const tx = M.talent(x);
      if (tx >= t) extra += (tx > t ? 1 : 0.5) * (1 - state.cfg.offerRoomWeight);
    });
    return M.roomPt(room.ahead + extra, room.starters, state.cfg);
  };
  // Best players first, so a team's budget goes to its top target.
  Object.values(players)
    .filter((p) => p.status === "portal")
    .sort((a, b) => M.playerValue(b) - M.playerValue(a))
    .forEach((p) => {
      // A CPU school whose spot filled (or whose money ran out) pulls its offer.
      const pulled = Object.entries(p.offers).filter(([slug, offer]) => {
        const t = teams[slug];
        if (!t || t.user) return false;
        return wantFor(slug, p) < 0 || offer.nil > t.budget - t.spent;
      });
      if (pulled.length) {
        const offers = { ...p.offers };
        pulled.forEach(([slug, offer]) => {
          delete offers[slug];
          const why = wantFor(slug, p) < 0 ? "filled" : "money";
          log.push({ w: state.window, kind: "pulled", pid: p.id, team: p.team, to: slug, nil: offer.nil, why });
        });
        p = { ...p, offers };
        players[p.id] = p;
      }
      const scored = Object.entries(p.offers).map(([slug, offer]) => {
        const pt = ptNow(slug, p);
        return {
          slug, offer,
          u: M.overallGrade(M.offerUtility(p, teams[slug], offer, { pt, field: fieldOf(p, slug) }, state.cfg, signedDraw(state, `choose|${p.id}|${slug}|${state.window}`)), processFor(state, slug, p, offer), state.cfg) - snubOf(state, slug, p),
          bad: M.badAs(p, M.schoolScores(p, teams[slug], { nil: offer.nil, pt }, state.cfg), state.cfg) >= state.cfg.cutBadA.count,
          blowout: offer.nil >= instantAmount(state, p),
        };
      }).sort((a, b) => b.u - a.u);
      const blowout = scored.filter((x) => x.blowout).sort((a, b) => b.offer.nil - a.offer.nil)[0];
      // An offer lands the window after it's made (he takes it in first —
      // and every other school, the user included, sees it and can answer).
      // Interest from a board carries in `since`, not here.
      // Top players take longer (cfg.patience — windows an offer must stand,
      // by stars): their recruitments run, and everyone can answer.
      const wait = state.cfg.patience?.[p.stars] ?? 1;
      const ripe = scored.filter((x) => (x.offer.made ?? x.offer.since) <= state.window - wait && !x.bad);
      const bar = M.commitBar(p, state.window, state.windows, state.cfg, state.teams[p.team].tier);
      const best = blowout || (last ? scored[0] : ripe[0] && ripe[0].u >= bar ? ripe[0] : null);
      if (best) {
        players[p.id] = { ...p, status: "committed", to: best.slug, deal: { ...best.offer, window: state.window }, offers: {}, mix: mixOf(state, p) };
        teams[best.slug] = { ...teams[best.slug], spent: teams[best.slug].spent + best.offer.nil };
        if (!teams[best.slug].user) { const i = wantFor(best.slug, p); if (i >= 0) left[best.slug].splice(i, 1); }
        (signedNow[`${best.slug}|${p.pos}`] = signedNow[`${best.slug}|${p.pos}`] || []).push(p);
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
  // Players decide (not in the evaluation period — no offers yet), then
  // every CPU school re-reads its roster, the portal and its standings and
  // makes its moves for the next window (cpuPlan).
  const evalPeriod = isEvalWindow(state);
  let next = evalPeriod ? state : decisions(state, last);
  let made = 0;
  if (!last) ({ state: next, made } = cpuPlan(next));
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
      evalPeriod,
      unsigned: fresh.filter((e) => e.kind === "unsigned"),
      entered: next.log.slice(before).filter((e) => e.kind === "entered"),
    },
  };
}
