// src/sim/math.js — small vector/angle helpers shared by every system.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

// Signed smallest difference a − b, wrapped to (−π, π].
export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

// Exponential approach toward a target with time constant tau (seconds) —
// frame-rate independent smoothing used for every "registers over time" value.
export const approach = (cur, target, dt, tau) =>
  cur + (target - cur) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));

// Rotate an angle toward a target by at most maxStep.
export function turnToward(cur, target, maxStep) {
  const d = angDiff(target, cur);
  return cur + clamp(d, -maxStep, maxStep);
}

// Deterministic PRNG so a rep can be replayed from its seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
export const pct = (v) => `${Math.round(clamp(v, 0, 1) * 100)}%`;
