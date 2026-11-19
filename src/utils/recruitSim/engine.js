// src/utils/recruitSim/engine.js
//
// Recruit Sim — the season engine. Pure, seeded, browser-side (runs in a Web
// Worker, ./worker.js, with a main-thread fallback). One save:
//   initSave()  → the school field, the whole 3,000-recruit class, every
//                 school's empty knowledge, CPU Winter plans
//   advance()   → closes the current window (spec §10 sequence):
//       1. every school's board, NIL and staff work → interest + scouting
//          (./work.js)
//       2. standings (each recruit's ranking of schools, ./model.js)
//       3. development (fall weeks, ./development.js)
//       4. lists, demands and commitments (./lifecycle.js)
//       5. next stage; NIL snapshots reset (cuts are measured per window)
//       6. CPU schools re-plan for the new window (./cpu.js)
//       7. the user's reports for the window just closed
// State is plain data + typed arrays (structured-clone / IndexedDB safe).
// `derived` (distance fit, fit ranks, area index) is rebuilt on load.
import { mergeConfig, STAGE_COUNT, STAGES } from "./config.js";
import { generateClass } from "./generate.js";
import { KT, POSITIONS, POT_SLOT } from "./traits.js";
import { rngFor, shuffle } from "./rng.js";
import { buildDerived, computeStandings, staticFit, placeOf, fallWeek, seenByUser } from "./model.js";
import { runSchool } from "./work.js";
import { devOverall, trendOf } from "./development.js";
import { runLifecycle } from "./lifecycle.js";
import { cpuPlan, cpuBias } from "./cpu.js";
import { REGIONS } from "./regions.js";

export const SAVE_VERSION = 5; // 2: nine traits per position · 3: potential-driven development · 4: season-long jump, decision dates, relationships · 5: relationships in a typed array, regional contact counts (old saves can't load)

// teams: [{ slug, school, conference, loc: [lat, lng] }] (FBS);
// tiers: { slug: 1..5 } (admin, else defaultTier); factors: { [school]:
// { success, dev: { pos } } } (utils/portalSim/factors.js).
export function initSave({ source, teams, tiers, factors, defaultTier, config, userSlug, seed }) {
  const cfg = mergeConfig(config);
  const sd = seed ?? Math.floor(Math.random() * 1e9);
  const maxBudget = Math.max(...Object.values(cfg.budgets));
  const schools = teams.map((t, i) => {
    const tier = Number(tiers?.[t.slug]) || defaultTier(t.school, t.conference);
    const f = factors?.[t.school] || {};
    const budget = cfg.budgets[tier] || cfg.budgets[5];
    return {
      i, slug: t.slug, name: t.school, conf: t.conference, tier,
      brand: cfg.brandOverrides?.[t.slug] ?? cfg.brandByTier[tier], loc: t.loc || null,
      win: f.success ?? 0.5, dev: f.dev || {}, budget, nilRep: Math.sqrt(budget / maxBudget),
      user: t.slug === userSlug,
      staff: [null, null, null, null, null, null], board: [], above: [], nil: {}, nilSnap: {}, spent: 0, paid: {}, commits: [],
      reach: null, bias: null,
    };
  });
  const user = schools.findIndex((s) => s.user);
  if (user < 0) throw new Error("Pick a school.");
  const recruits = generateClass(source, cfg, sd);
  const N = recruits.length;
  const S = schools.length;
  const state = {
    v: SAVE_VERSION, seed: sd, cfg, stage: 0, N, S, user, schools, recruits,
    interest: new Float32Array(S * N), bond: new Uint8Array(S * N * 6), know: new Uint8Array(S * N * KT), recMask: new Uint8Array(S * N), intel: new Uint8Array(N),
    events: [], reports: [], created: Date.now(), updated: Date.now(),
    // The user's standing with each recruit he's in contact with, per
    // window: { [r]: [[stage, place (0 = outside his top 12), pct of the
    // leader's score]] } — the recruitment's trend line.
    trend: {},
  };
  schools.forEach((sc, s) => { if (s !== user) sc.bias = cpuBias(state, s); });
  buildDerived(state);
  // A little interest from attractiveness alone (spec §16: minor).
  for (let s = 0; s < S; s += 1) for (let r = 0; r < N; r += 1) state.interest[s * N + r] = cfg.startInterest * staticFit(state, s, r) ** 2;
  computeStandings(state);
  planCpus(state);
  return state;
}

function planCpus(state) {
  const order = shuffle(rngFor(state.seed, `order|${state.stage}`), state.schools.map((_, s) => s));
  order.forEach((s) => { if (s !== state.user) cpuPlan(state, s); });
}

// Close the current window. Mutates and returns state.
export function advance(state) {
  if (state.stage >= STAGE_COUNT) return state;
  const closing = state.stage;
  const u = state.user;
  const usc = state.schools[u];
  const watch = new Set([...usc.board, ...usc.commits]);
  const before = new Map([...watch].map((r) => [r, placeOf(state.recruits[r], u)[0]]));
  const evFrom = state.events.length;
  const rep = { gain: {}, why: {}, scout: { board: [] }, staff: {}, cuts: [] };

  // 1. Work.
  const order = shuffle(rngFor(state.seed, `work-order|${closing}`), state.schools.map((_, s) => s));
  order.forEach((s) => runSchool(state, s, s === u ? rep : null));
  // 2. Standings.
  computeStandings(state);
  // 3. Development: the potential jump plays out across the fall
  // (development.js) — nothing to apply; trends are read from the path.
  // 4. Lists, demands, commitments.
  runLifecycle(state);
  // 5. Next stage.
  state.stage += 1;
  state.schools.forEach((sc) => { sc.nilSnap = { ...sc.nil }; });
  // The user's staff comes home every window (user, 2026-11-17); "Same as
  // last window" puts them back (actions.repeatStaff).
  usc.lastStaff = usc.staff.slice();
  usc.staff = usc.staff.map(() => null);
  // 6. CPU plans.
  if (state.stage < STAGE_COUNT) {
    computeStandings(state);
    planCpus(state);
  }
  computeStandings(state);
  trackTrend(state);
  // 7. Reports.
  state.reports.push(buildReport(state, closing, rep, before, evFrom));
  if (state.stage >= STAGE_COUNT) state.final = classRankings(state);
  state.updated = Date.now();
  return state;
}

// Record the user's place / share with everyone he's in contact with.
function trackTrend(state) {
  const u = state.user;
  const usc = state.schools[u];
  const watch = new Set(usc.board);
  for (let r = 0; r < state.N; r += 1) if (state.intel[r]) watch.add(r);
  watch.forEach((r) => {
    const x = state.recruits[r];
    if (x.commit >= 0 && x.commit !== u) return;
    const [place, mine] = placeOf(x, u);
    const lead = x.top?.[0]?.[1] || 0;
    const row = [state.stage, x.commit === u ? 1 : place, x.commit === u ? 100 : lead > 0 ? Math.round((mine / lead) * 100) : 0];
    const t = (state.trend[r] = state.trend[r] || []);
    if (t.length && t[t.length - 1][0] === state.stage) t[t.length - 1] = row; else t.push(row);
  });
}

// What the user's staff brings back from the window (shown at the top of the
// next one). Compact — ids and counts; prose is made in the UI (reports.js).
function buildReport(state, st, rep, before, evFrom) {
  const u = state.user;
  const usc = state.schools[u];
  const staff = {};
  Object.entries(rep.staff).forEach(([role, o]) => {
    if (!o) return;
    const byR = {};
    o.scout.forEach((c) => { const b = (byR[c.r] = byR[c.r] || { range: 0, exact: 0, pot: 0 }); if (c.slot === POT_SLOT) b.pot += 1; else if (c.to === 1) b.exact += 1; else b.range += 1; });
    staff[role] = { a: o.a, visits: o.visits, reached: o.reached.size, recs: o.recs, scouted: Object.entries(byR).map(([r, b]) => [Number(r), b.range, b.exact, b.pot]).sort((a, b) => (b[1] + b[2] * 2 + b[3] * 3) - (a[1] + a[2] * 2 + a[3] * 3)) };
  });
  const boardScout = {};
  rep.scout.board.forEach((c) => { const b = (boardScout[c.r] = boardScout[c.r] || [0, 0, 0]); if (c.slot === POT_SLOT) b[2] += 1; else if (c.to === 1) b[1] += 1; else b[0] += 1; });
  // Senior-season movers your staff has eyes on (the trend, never the
  // number): [r, dir −2..2, on your board]. Big moves only off your board.
  const devSeen = [];
  const wk = fallWeek(state);
  if (wk) {
    const onB = new Set(usc.board);
    for (let r = 0; r < state.N; r += 1) {
      const x = state.recruits[r];
      if (x.commit >= 0 && x.commit !== u) continue;
      if (!seenByUser(state, r)) continue;
      const t = trendOf(state, x, wk);
      const tp = trendOf(state, x, wk - 1);
      if (!t || !t.dir) continue;
      const newly = !tp || Math.abs(t.dir) > Math.abs(tp.dir) || Math.sign(t.dir) !== Math.sign(tp.dir);
      if (!newly) continue;
      if (onB.has(r) || x.commit === u || Math.abs(t.dir) === 2) devSeen.push([r, t.dir, onB.has(r) || x.commit === u ? 1 : 0]);
    }
    devSeen.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || b[2] - a[2]);
    devSeen.length = Math.min(devSeen.length, 40);
  }
  // Standing moves on recruits you're working.
  const moves = [];
  before.forEach((was, r) => {
    const x = state.recruits[r];
    if (x.commit >= 0) return;
    const now = placeOf(x, u)[0];
    if (now !== was) moves.push([r, was, now]);
  });
  const events = state.events.slice(evFrom).filter((e) => e.k !== "coachVisit" && e.k !== "coachRecruit");
  // Everyone the staff touched this window (players-to-watch lists).
  const touched = new Set();
  Object.values(rep.staff).forEach((o) => o && o.reached.forEach((r) => touched.add(r)));
  rep.scout.board.forEach((c) => touched.add(c.r));
  return { st, staff, boardScout, dev: devSeen, moves, events, cuts: rep.cuts, touched: [...touched].slice(0, 1500) };
}

// Class rankings: points by public rating, best signings weighted most
// (a composite-style sum). → [{ s, score, n, avg, stars: {5,4,3,2} }] best first.
// key: "rating" (the website's public ratings), "ovr" (true overall) or
// "dev" (developed overall after the potential jump — the final screen's
// real scoreboard).
export function classRankings(state, key = "rating") {
  const val = key === "dev" ? devOverall : (x) => x[key];
  const out = state.schools.map((sc, s) => {
    const rs = sc.commits.map((r) => state.recruits[r]).sort((a, b) => val(b) - val(a));
    let score = 0;
    rs.forEach((x, k) => { score += Math.pow(Math.max(0, val(x) - 60), 2) / 10 * Math.pow(0.93, k); });
    const stars = { 5: 0, 4: 0, 3: 0, 2: 0 };
    rs.forEach((x) => { stars[x.stars] += 1; });
    return { s, score: Math.round(score * 10) / 10, n: rs.length, avg: rs.length ? rs.reduce((a, x) => a + val(x), 0) / rs.length : 0, stars };
  });
  return out.sort((a, b) => b.score - a.score || b.n - a.n);
}
// Letter for a class rank (share of the field).
export function classGrade(rank, field) {
  const p = (rank - 1) / Math.max(1, field - 1);
  return p <= 0.03 ? "A+" : p <= 0.1 ? "A" : p <= 0.18 ? "A-" : p <= 0.28 ? "B+" : p <= 0.4 ? "B" : p <= 0.5 ? "B-" : p <= 0.6 ? "C+" : p <= 0.7 ? "C" : p <= 0.8 ? "C-" : p <= 0.9 ? "D" : "F";
}

// After loading a save: rebuild what isn't stored.
export function rehydrate(state) {
  buildDerived(state);
  return state;
}
// What a save stores (derived tables dropped).
export function toStorable(state) {
  const { derived, ctxs, ...rest } = state;
  return rest;
}

export { STAGES, STAGE_COUNT, REGIONS, POSITIONS };
