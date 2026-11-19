// src/utils/recruitSim/model.js
//
// The shared math every system uses — school fit, playing time, NIL
// satisfaction, activity multipliers and standings. Same functions for the
// user's school and every CPU school (spec §16, §23: same rules).
//
// Index conventions (state built in ./engine.js):
//   interest[s * N + r]           accumulated interest points
//   know[(s * N + r) * KT + slot] knowledge code (./traits.js)
//   distFit[s * N + r]            0..1 proximity (derived, not saved)
import { STAGES } from "./config.js";
import { KT, TRAIT_MAP, overallOf, categoryValues, rangeBounds, isRange, rangeCode, K_EXACT, K_UNKNOWN, POT_SLOT } from "./traits.js";
import { miles } from "./regions.js";
import { clamp } from "./rng.js";

export const at = (state, s, r) => s * state.N + r;
export const stageInfo = (state) => STAGES[Math.min(state.stage, STAGES.length - 1)];
export const phaseOf = (state) => (state.stage >= STAGES.length ? "done" : STAGES[state.stage].phase);
export const fallWeek = (state) => (STAGES[state.stage]?.phase === "fall" ? STAGES[state.stage].week : state.stage >= STAGES.length - 1 ? 13 : 0);
export function boardLimits(state) {
  const p = phaseOf(state);
  const b = state.cfg.board;
  if (p === "winter" || p === "done") return { size: 0, line: 0 };
  if (p === "signing") return { size: b.size.fall, line: b.line.fall };
  return { size: b.size[p], line: b.line[p] };
}

// ── Derived per-pair tables (rebuilt on load) ──
export function buildDerived(state) {
  const { N, S, cfg } = state;
  const distFit = new Float32Array(S * N);
  const { near, far } = cfg.distance;
  for (let s = 0; s < S; s += 1) {
    const loc = state.schools[s].loc;
    for (let r = 0; r < N; r += 1) {
      const d = miles(loc, state.recruits[r].loc);
      distFit[s * N + r] = d <= near ? 1 : d >= far ? 0 : 1 - Math.sqrt((d - near) / (far - near));
    }
  }
  // Region × position index for area work.
  const area = {};
  state.recruits.forEach((x) => { ((area[x.region] = area[x.region] || {})[x.pos] = area[x.region][x.pos] || []).push(x.i); });
  state.derived = { distFit, area };
  // Each recruit's rank of every school on fit alone (a CPU's prior read
  // of its chances before interest builds).
  const fitRank = new Uint8Array(S * N);
  const order = Array.from({ length: S }, (_, i) => i);
  const sc = new Float32Array(S);
  for (let r = 0; r < N; r += 1) {
    for (let s = 0; s < S; s += 1) sc[s] = staticFit(state, s, r) + 0.35 * state.schools[s].nilRep * state.recruits[r].prefs.nil;
    order.sort((a, b) => sc[b] - sc[a]);
    for (let k = 0; k < S; k += 1) fitRank[order[k] * N + r] = Math.min(255, k);
  }
  state.derived.fitRank = fitRank;
  return state;
}

// ── School attributes a recruit weighs (0..1 each) ──
// Relational fit: brand, distance, development, winning, playing time —
// what makes coach / board work land better (spec §16 example).
export function staticFit(state, s, r) {
  const x = state.recruits[r];
  const sc = state.schools[s];
  const p = x.prefs;
  const den = p.brand + p.dist + p.dev + p.win;
  return (p.brand * sc.brand + p.dist * state.derived.distFit[s * state.N + r] + p.dev * (sc.dev[x.pos] ?? 0.3) + p.win * sc.win) / den;
}

// Playing time at school s for recruit r, 0..1: recruits at his position
// ranked above him on its board, and commits at his position, crowd him.
// ctx: per-school position counts (ptContext) for speed.
export function ptContext(state, s) {
  const sc = state.schools[s];
  const commits = {};
  sc.commits.forEach((r) => { const p = state.recruits[r].pos; commits[p] = (commits[p] || 0) + 1; });
  const aboveCount = {};
  const ahead = new Map(); // r → above-line recruits at his position ranked ahead
  const seen = {};
  sc.above.forEach((r) => {
    const p = state.recruits[r].pos;
    ahead.set(r, seen[p] || 0);
    seen[p] = (seen[p] || 0) + 1;
    aboveCount[p] = seen[p];
  });
  return { commits, aboveCount, ahead };
}
export function ptAt(state, s, r, ctx) {
  const cfg = state.cfg.board;
  const x = state.recruits[r];
  const c = ctx || ptContext(state, s);
  const aheadBoard = c.ahead.has(r) ? c.ahead.get(r) : c.aboveCount[x.pos] || 0;
  const crowd = aheadBoard * cfg.ptAheadPenalty + (c.commits[x.pos] || 0) * cfg.ptCommitPenalty;
  const free = (cfg.ptRoomFree[x.pos] || 0) * cfg.ptAheadPenalty;
  return clamp(1 - Math.max(0, crowd - free), 0, 1);
}

// NIL satisfaction from an offer vs his ask (1 = met).
export function nilSat(state, offer, ask) {
  if (!(offer > 0)) return 0;
  const k = state.cfg.nilSat;
  const x = Math.min(offer / Math.max(1, ask), state.cfg.nilCap);
  return (1 - Math.exp(-k * x)) / (1 - Math.exp(-k));
}
// NIL attribute: the offer when there is one, else the school's NIL
// reputation (budget) before offers exist.
export function nilAttr(state, s, r) {
  const offer = state.schools[s].nil[r];
  if (offer > 0) return Math.min(1.15, nilSat(state, offer, state.recruits[r].ask));
  return 0.5 * state.schools[s].nilRep;
}

// Full fit, 0..~1: his weighted view of the school on all six factors.
export function fullFit(state, s, r, ctx) {
  const x = state.recruits[r];
  const p = x.prefs;
  const sc = state.schools[s];
  return p.brand * sc.brand + p.dist * state.derived.distFit[s * state.N + r] + p.dev * (sc.dev[x.pos] ?? 0.3) + p.win * sc.win
    + p.nil * nilAttr(state, s, r) + p.pt * ptAt(state, s, r, ctx);
}
// How well relationship work (board, coaches) lands with him at school s.
export function relMult(state, s, r, ctx) {
  const x = state.recruits[r];
  const p = x.prefs;
  const den = p.brand + p.dist + p.dev + p.win + p.pt;
  const rel = (staticFit(state, s, r) * (den - p.pt) + p.pt * ptAt(state, s, r, ctx)) / den;
  return state.cfg.fitFloor + state.cfg.fitSpan * rel;
}
// How much NIL moves him.
export const nilMult = (x) => 0.3 + 4 * x.prefs.nil;

// His standing score for school s: interest × (fit / 0.5)^fitPow — how
// he actually ranks schools (spec §17).
export function standingScore(state, s, r, ctx) {
  const i = state.interest[s * state.N + r];
  if (i <= 0) return 0;
  return i * Math.pow(Math.max(0.05, fullFit(state, s, r, ctx)) / 0.5, state.cfg.fitPow);
}

// Every recruit's school ranking (top 12 kept): r.top = [[s, score], …].
export function computeStandings(state) {
  const { N, S } = state;
  const ctxs = state.schools.map((_, s) => ptContext(state, s));
  const scores = new Float32Array(S);
  for (let r = 0; r < N; r += 1) {
    const x = state.recruits[r];
    if (x.commit >= 0) continue;
    for (let s = 0; s < S; s += 1) scores[s] = standingScore(state, s, r, ctxs[s]);
    const top = [];
    for (let s = 0; s < S; s += 1) {
      const v = scores[s];
      if (v <= 0) continue;
      if (top.length < 12) { top.push([s, v]); top.sort((a, b) => b[1] - a[1]); } else if (v > top[11][1]) { top[11] = [s, v]; top.sort((a, b) => b[1] - a[1]); }
    }
    x.top = top.map(([s, v]) => [s, Math.round(v * 10) / 10]);
  }
  state.ctxs = ctxs;
}
// School s's place in his ranking (1-based; 0 = not in his top 12) and score.
export function placeOf(x, s) {
  const k = (x.top || []).findIndex(([t]) => t === s);
  return k < 0 ? [0, 0] : [k + 1, x.top[k][1]];
}

// ── Evaluations (spec §6) ──
// A school's estimate of a recruit from what it has uncovered: exact
// grades are exact, ranges count at their midpoint, unknowns fall back to
// his public rating. bias (CPU only) shifts it. Returns { est, known }:
// known = share of trait weight uncovered (range counts half).
export function evaluate(state, s, r, bias = null) {
  const x = state.recruits[r];
  const map = TRAIT_MAP[x.pos];
  const base = (s * state.N + r) * KT;
  const cuts = state.cfg.gradeCuts;
  const est = new Array(map.length);
  let known = 0;
  for (let i = 0; i < map.length; i += 1) {
    const k = state.know[base + i];
    if (k === K_EXACT) { est[i] = x.t[i]; known += 1; } else if (isRange(k)) { const [lo, hi] = rangeBounds(rangeCode(k), cuts); est[i] = (lo + hi) / 2 * 0.6 + x.rating * 0.4; known += 0.5; } else est[i] = x.rating;
  }
  let e = overallOf(x.pos, est);
  if (bias) {
    // A CPU staff that likes athletes (or technicians) leans toward kids
    // strong in that category, plus its own position taste.
    const c = categoryValues(x.pos, est);
    e += (bias.pos[x.pos] || 0) + bias.cat.ins * (c.ins - e) + bias.cat.tec * (c.tec - e) + bias.cat.phy * (c.phy - e);
  }
  return { est: e, known: known / map.length };
}

// Has the user's staff seen him at all — any grade, any contact, a
// recommendation? Enough to read his season trend (user, 2026-11-18).
export function seenByUser(state, r) {
  if (state.intel[r] || state.recMask[state.user * state.N + r]) return true;
  const x = state.recruits[r];
  const base = (state.user * state.N + r) * KT;
  for (let i = 0; i < TRAIT_MAP[x.pos].length; i += 1) if (state.know[base + i] !== K_UNKNOWN) return true;
  return !!state.know[base + POT_SLOT];
}
