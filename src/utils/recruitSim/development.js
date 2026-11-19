// src/utils/recruitSim/development.js
//
// Development = potential (user, 2026-11-18). Traits never change. Every
// recruit carries a hidden Potential grade (A+ … F, generate.js) — correlated
// with his athletic (Physical) grades, not defined by them — that decides the
// jump he makes:
//   jump = (pot − center) × jumpPerPoint + noise, capped at ± jumpMax
// The jump plays out over his senior season (fall weeks 1–12, an uneven
// seeded path — done by Signing Day). That's the in-season trend: anyone
// whose staff has seen him can read the direction, never the number.
// His final overall (ovr + jump) is what a class is judged on.
// Potential itself is the hardest thing to scout (scouting.js: ~1 in 500).
import { rngFor, normal, clamp } from "./rng.js";
import { fallWeek } from "./model.js";

// What a potential score means for his jump, before the noise.
export function expectedJump(cfg, pot) {
  const p = cfg.potential;
  return clamp((pot - p.center) * p.jumpPerPoint, -p.jumpMax, p.jumpMax);
}

// His full jump (seeded per recruit — the same kid makes the same jump
// wherever he signs) and the share of it done after each fall week (0..12).
function pathOf(state, x) {
  if (x.jp) return x.jp;
  const p = state.cfg.potential;
  const rand = rngFor(state.seed, `jump|${x.i}`);
  const j = clamp(expectedJump(state.cfg, x.pot) + normal(rand) * p.jumpNoise, -p.jumpMax, p.jumpMax);
  // Uneven weeks: some kids take off early, some late.
  const tilt = normal(rand) * 0.6;
  const w = Array.from({ length: 12 }, (_, k) => Math.max(0.05, Math.exp(tilt * (k - 5.5) / 5.5 + normal(rand) * p.pathSd * 0.5)));
  const tot = w.reduce((a, b) => a + b, 0);
  const share = [0];
  w.forEach((v) => share.push(share[share.length - 1] + v / tot));
  x.jp = { j: Math.round(j * 10) / 10, s: share.map((v) => Math.round(v * 1000) / 1000) };
  return x.jp;
}
export const jumpOf = (state, x) => pathOf(state, x).j;

// How much of his jump has happened by fall week w (0 before the season,
// all of it from Signing Day on).
export function jumpSoFar(state, x, w = fallWeek(state)) {
  if (!w) return 0;
  const p = pathOf(state, x);
  return Math.round(p.j * p.s[Math.min(12, w)] * 10) / 10;
}

// Called when he commits (lifecycle.commitRecruit): his full jump is what
// his class gets — the rest of it still plays out on the field.
export function applyJump(state, x) {
  if (x.devJump != null) return;
  x.devJump = jumpOf(state, x);
  x.ovrDev = Math.round((x.ovr + x.devJump) * 10) / 10;
}

// His developed overall once committed (else his true overall).
export const devOverall = (x) => (x.ovrDev != null ? x.ovrDev : x.ovr);

// The season trend: where he's heading, from what he's done so far and this
// week. dir −2..2 (big slide … breaking out). Null before the season.
export function trendOf(state, x, w = fallWeek(state)) {
  if (!w) return null;
  const wk = Math.min(12, w);
  const so = jumpSoFar(state, x, wk);
  const last = so - jumpSoFar(state, x, wk - 1);
  const dir = so >= 2.5 ? 2 : so >= 0.8 || last >= 0.5 ? 1 : so <= -2.5 ? -2 : so <= -0.8 || last <= -0.5 ? -1 : 0;
  return { dir, so, last };
}
