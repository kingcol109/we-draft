// src/utils/portalSim/engine.js
//
// The Portal Sim — a pure, seeded state machine (no React, no Firestore),
// the portal's version of utils/draftSim/engine.js. Every decision is a
// model in ./models.js; every number is in ./config.js.
//
//   initPortalSim(pool, opts)  every FBS player on his roster, every team's
//                              tier and NIL budget
//   openPortal(state)          window 1: draft declarations and transfer
//                              entries — modeled (playing time, school tier
//                              vs his stars, home distance), or the REAL
//                              portal once it's open (opts.live: players
//                              flagged live in the pool)
//   userOffer / retractOffer   the user's offers during a window (NIL within
//                              budget, a role promised)
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
//   { seed, cfg, window, windows, phase: ready|window|done, userTeams,
//     teams:   { [slug]: { slug, school, tier, budget, spent, loc, user } },
//     players: { [id]: { id, name, pos, team, stars, elig, role, home, ask,
//                        personality, status, enteredWindow, offers:
//                        { [slug]: { nil, pt, window } }, to, deal } },
//     log: [{ w, kind, pid, team, to, nil, pt }] }
// status: roster | declared | portal | committed | unsigned
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
//   seed, live (use the real portal's entries) }
export function initPortalSim(pool, opts = {}) {
  const cfg = mergeConfig(opts.config);
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const userTeams = opts.userTeams || [];
  const state = { seed, cfg, season: pool.season, window: 0, windows: cfg.windows, phase: "ready", userTeams, live: !!opts.live, teams: {}, players: {}, log: [] };
  pool.teams.forEach((t) => {
    const tier = Number(opts.tiers?.[t.slug]) || defaultTier(t.school, t.conference);
    state.teams[t.slug] = { slug: t.slug, school: t.school, conference: t.conference, tier, budget: cfg.budgets[tier] || 0, spent: 0, loc: t.loc || null, user: userTeams.includes(t.slug) };
  });
  pool.players.forEach((p) => {
    if (!state.teams[p.team]) return;
    const rand = rngFor(state, `player|${p.id}`);
    state.players[p.id] = {
      ...p, ask: M.askFor(p, cfg, rand()), personality: M.personalityFor(cfg, rand),
      status: "roster", enteredWindow: null, offers: {}, to: null, deal: null,
    };
  });
  return state;
}

// ── Window 1: declarations and entries ──
export function openPortal(state) {
  if (state.phase !== "ready") return state;
  const players = { ...state.players };
  const log = [...state.log];
  Object.values(players).forEach((p) => {
    const team = state.teams[p.team];
    let status = "roster";
    if (state.live) {
      // The real portal: who's actually in it (and who declared).
      if (p.declared) status = "declared";
      else if (p.live) status = "portal";
    } else if (draw(state, `declare|${p.id}`) < M.declareChance(p, state.cfg)) status = "declared";
    else if (draw(state, `enter|${p.id}`) < M.entryChance(p, team, state.cfg)) status = "portal";
    if (status === "roster") return;
    players[p.id] = { ...p, status, enteredWindow: status === "portal" ? 1 : null };
    log.push({ w: 1, kind: status === "declared" ? "declared" : "entered", pid: p.id, team: p.team });
  });
  return { ...state, players, log, window: 1, phase: "window" };
}

// ── Reading the state ──
// One pass over every player → what each team has, lost, and has promised
// (cached per state object — states are never mutated).
const INDEX = new WeakMap();
function indexOf(state) {
  if (INDEX.has(state.players)) return INDEX.get(state.players);
  const teams = {};
  const T = (slug) => (teams[slug] = teams[slug] || { roster: [], have: {}, lost: {}, best: {}, reserved: 0 });
  Object.values(state.players).forEach((p) => {
    // Next season's roster: stayed, or committed here.
    const here = p.status === "roster" ? p.team : p.status === "committed" ? p.to : null;
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
    if (p.role === "starter" && p.status !== "roster" && !(p.status === "committed" && p.to === p.team)) {
      const t = T(p.team);
      t.lost[p.pos] = (t.lost[p.pos] || 0) + 1;
    }
    // NIL promised in open offers.
    if (p.status === "portal") Object.entries(p.offers).forEach(([slug, o]) => { T(slug).reserved += o.nil; });
  });
  const idx = { teams, of: (slug) => teams[slug] || { roster: [], have: {}, lost: {}, best: {}, reserved: 0 } };
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

// One team's view: budget, needs, who left, who's coming.
export function teamView(state, slug) {
  const all = Object.values(state.players);
  return {
    team: state.teams[slug],
    ...budgetOf(state, slug),
    needs: teamNeeds(state, slug),
    departures: all.filter((p) => p.team === slug && p.status !== "roster" && !(p.status === "committed" && p.to === slug)),
    signings: all.filter((p) => p.status === "committed" && p.to === slug),
    offers: all.filter((p) => p.status === "portal" && p.offers[slug]),
  };
}
export const portalPlayers = (state) => Object.values(state.players).filter((p) => p.status === "portal");

// ── The user's offers ──
const PTS = ["starter", "rotation", "depth"];
export function userOffer(state, slug, pid, { nil, pt }) {
  const p = state.players[pid];
  if (state.phase !== "window") return { error: "The portal isn't open." };
  if (!state.userTeams.includes(slug)) return { error: "Not your team." };
  if (!p || p.status !== "portal") return { error: "He isn't available." };
  if (p.team === slug) return { error: "He's leaving your program." };
  const amount = Math.max(0, Math.round(Number(nil) || 0));
  const { available } = budgetOf(state, slug);
  const current = p.offers[slug]?.nil || 0;
  if (amount > available + current) return { error: "Over your NIL budget." };
  const offer = { nil: amount, pt: PTS.includes(pt) ? pt : "rotation", window: state.window };
  return { state: { ...state, players: { ...state.players, [pid]: { ...p, offers: { ...p.offers, [slug]: offer } } } } };
}
export function retractOffer(state, slug, pid) {
  const p = state.players[pid];
  if (!p?.offers[slug] || p.status !== "portal") return state;
  const offers = { ...p.offers };
  delete offers[slug];
  return { ...state, players: { ...state.players, [pid]: { ...p, offers } } };
}

// ── CPU teams' offers ──
function cpuOffers(state) {
  const players = { ...state.players };
  const portal = Object.values(players).filter((p) => p.status === "portal");
  let made = 0;
  Object.values(state.teams).forEach((team) => {
    if (team.user) return;
    const needs = teamNeeds(state, team.slug);
    let { available } = budgetOf(state, team.slug);
    const left = { ...needs };
    const ranked = portal
      .filter((p) => p.team !== team.slug && !players[p.id].offers[team.slug])
      .map((p) => ({ p, score: M.teamInterest(team, p, left[p.pos] || 0, boardTaste(state, team.slug, p.id), state.cfg) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    let n = state.cfg.offersPerWindow[team.tier] || 4;
    for (const { p } of ranked) {
      if (n <= 0 || available <= 0) break;
      if (!(left[p.pos] > 0)) continue;
      const offer = M.offerFor(team, p, wouldStart(state, team.slug, p), state.cfg, draw(state, `offer|${team.slug}|${p.id}|${state.window}`));
      if (offer.nil > available) continue;
      const cur = players[p.id];
      players[p.id] = { ...cur, offers: { ...cur.offers, [team.slug]: { ...offer, window: state.window } } };
      available -= offer.nil;
      left[p.pos] -= 1;
      n -= 1;
      made += 1;
    }
  });
  return { state: { ...state, players }, made };
}

// ── Players decide ──
function decisions(state, last) {
  const players = { ...state.players };
  const teams = { ...state.teams };
  const log = [...state.log];
  const bar = M.commitBar(state.window, state.windows, state.cfg);
  // Best players first, so a team's budget goes to its top target.
  Object.values(players)
    .filter((p) => p.status === "portal")
    .sort((a, b) => M.playerValue(b) - M.playerValue(a))
    .forEach((p) => {
      const scored = Object.entries(p.offers).map(([slug, offer]) => ({
        slug, offer, u: M.offerUtility(p, teams[slug], offer, state.cfg, signedDraw(state, `choose|${p.id}|${slug}|${state.window}`)),
      })).sort((a, b) => b.u - a.u);
      const best = scored[0];
      if (best && (best.u >= bar || last)) {
        players[p.id] = { ...p, status: "committed", to: best.slug, deal: { ...best.offer, window: state.window }, offers: {} };
        teams[best.slug] = { ...teams[best.slug], spent: teams[best.slug].spent + best.offer.nil };
        log.push({ w: state.window, kind: "committed", pid: p.id, team: p.team, to: best.slug, nil: best.offer.nil, pt: best.offer.pt, offeredBy: Object.keys(p.offers) });
      } else if (last) {
        players[p.id] = { ...p, status: "unsigned", offers: {} };
        log.push({ w: state.window, kind: "unsigned", pid: p.id, team: p.team });
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
    if (p.status !== "roster") return;
    const chance = M.entryChance(p, state.teams[p.team], state.cfg) * state.cfg.lateEntryFactor;
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
      commits: fresh.filter((e) => e.kind === "committed"),
      unsigned: fresh.filter((e) => e.kind === "unsigned"),
      entered: next.log.slice(before).filter((e) => e.kind === "entered"),
    },
  };
}
