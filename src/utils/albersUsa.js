// src/utils/albersUsa.js
//
// d3.geoAlbersUsa().scale(1300).translate([487.5, 305]) — the projection
// us-atlas's states-albers-10m.json is already drawn in (a 975 × 610 frame),
// written out so the builders (server/highSchools/hsIndex.js) can store each
// high school as ready-to-draw x/y and the page never projects anything. No
// d3 dependency. Alaska and Hawaii use d3's insets, picked by state (the
// caller knows it) rather than by bounding box.
const RAD = Math.PI / 180;
const K = 1300;
const TX = 487.5;
const TY = 305;

// A conic equal-area projection: rotate λ by `rot`, center [cλ, cφ] (in the
// rotated frame), standard parallels [p0, p1], scale k, translate [tx, ty].
function conic(rot, center, parallels, k, tx, ty) {
  const sy0 = Math.sin(parallels[0] * RAD);
  const n = (sy0 + Math.sin(parallels[1] * RAD)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;
  const raw = (lam, phi) => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    const x = lam * n;
    return [r * Math.sin(x), r0 - r * Math.cos(x)];
  };
  const [cx, cy] = raw(center[0] * RAD, center[1] * RAD);
  const dx = tx - k * cx;
  const dy = ty + k * cy;
  return (lng, lat) => {
    let lam = (lng + rot) * RAD;
    if (lam > Math.PI) lam -= 2 * Math.PI;
    if (lam < -Math.PI) lam += 2 * Math.PI;
    const [x, y] = raw(lam, lat * RAD);
    return [dx + k * x, dy - k * y];
  };
}

const lower48 = conic(96, [-0.6, 38.7], [29.5, 45.5], K, TX, TY);
const alaska = conic(154, [-2, 58.5], [55, 65], K * 0.35, TX - 0.307 * K, TY + 0.201 * K);
const hawaii = conic(157, [-3, 19.9], [8, 18], K, TX - 0.205 * K, TY + 0.212 * K);

// [x, y] in the 975 × 610 frame, rounded to 0.1; null without coordinates.
export function albersUsa(lat, lng, stateAbbr) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const f = stateAbbr === "AK" ? alaska : stateAbbr === "HI" ? hawaii : lower48;
  const [x, y] = f(lng, lat);
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

export const ALBERS_FRAME = [975, 610];
