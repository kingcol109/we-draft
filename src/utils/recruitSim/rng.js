// src/utils/recruitSim/rng.js
//
// Seeded randomness. Every decision draws from a generator keyed by the save's
// seed + a tag (stage, school, recruit…), so the same save replays the same
// way — the Portal Sim's approach (utils/portalSim/engine.js rngFor).

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A generator for one tagged decision.
export const rngFor = (seed, tag) => mulberry(hash(`${seed}|${tag}`));

// Helpers on a generator.
export function normal(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
export const between = (rand, lo, hi) => lo + rand() * (hi - lo);
export const intBetween = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
// Pick an index by weights (array of numbers ≥ 0). -1 when all zero.
export function pickWeighted(rand, weights, total) {
  let t = total;
  if (t == null) { t = 0; for (let i = 0; i < weights.length; i += 1) t += weights[i]; }
  if (t <= 0) return -1;
  let x = rand() * t;
  for (let i = 0; i < weights.length; i += 1) { x -= weights[i]; if (x < 0) return i; }
  return weights.length - 1;
}
// Cumulative table for repeated weighted draws over a big list.
export function cumulative(weights) {
  const c = new Float64Array(weights.length);
  let t = 0;
  for (let i = 0; i < weights.length; i += 1) { t += weights[i]; c[i] = t; }
  return c;
}
export function drawCumulative(rand, cum) {
  const t = cum[cum.length - 1];
  if (!(t > 0)) return -1;
  const x = rand() * t;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > x) hi = mid; else lo = mid + 1; }
  return lo;
}
export function shuffle(rand, arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// Piecewise-linear interpolation over [[x, y], …] knots (x ascending).
export function knots(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    if (x <= x1) { const [x0, y0] = points[i - 1]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
  }
  return points[points.length - 1][1];
}
// Log-scale interpolation (money curves).
export function logKnots(points, x) {
  return Math.exp(knots(points.map(([a, b]) => [a, Math.log(b)]), x));
}
