// src/utils/usStatesGeo.js
//
// US state outlines as SVG path strings in us-atlas's pre-projected Albers
// USA frame (975 × 610) — the same frame the /hs heatmap points are stored
// in (utils/albersUsa.js, server/highSchools/hsGeo.js). Already projected,
// so no d3 / WebGL: each ring is just "M x y L … Z". Built once, on first
// use, and only inside the lazily loaded page that imports it.
//
// Each state also gets a STRAIGHT version (ds / bboxS — user 2026-11-21:
// on player profiles the states "have a weird tilt"). Albers is a cone:
// meridians fan out from an apex above the map, so a state away from the
// central meridian leans toward it (Maine and Florida tip left, Washington
// right). Straight = the state turned about its middle by its meridian's
// angle, so north points up — how a state looks on its own.
import { feature } from "topojson-client";
import topo from "us-atlas/states-albers-10m.json";
import { STATE_ABBR } from "./highSchoolMatch";

let cache = null;

const r1 = (v) => Math.round(v * 10) / 10;
const RAD = Math.PI / 180;

// Where the meridians meet, in the frame — d3's geoAlbersUsa as us-atlas
// built it (scale 1300, translate [487.5, 305]): the lower 48's conic
// equal-area plus the Alaska and Hawaii insets, each its own cone.
const K = 1300;
const T = [487.5, 305];
function apexOf({ parallels: [p0, p1], center: [clon, clat], scale, translate: [tx, ty] }) {
  const s0 = Math.sin(p0 * RAD);
  const n = (s0 + Math.sin(p1 * RAD)) / 2;
  const c = 1 + s0 * (2 * n - s0);
  const r0 = Math.sqrt(c) / n;
  // The projection's center lands on translate.
  const r = Math.sqrt(c - 2 * n * Math.sin(clat * RAD)) / n;
  const pcx = r * Math.sin(clon * RAD * n);
  const pcy = r0 - r * Math.cos(clon * RAD * n);
  // The apex is ρ = 0: projected (0, r0).
  return [tx + scale * (0 - pcx), ty - scale * (r0 - pcy)];
}
const APEX = {
  lower48: apexOf({ parallels: [29.5, 45.5], center: [-0.6, 38.7], scale: K, translate: T }),
  AK: apexOf({ parallels: [55, 65], center: [-2, 58.5], scale: K * 0.35, translate: [T[0] - 0.307 * K, T[1] + 0.201 * K] }),
  HI: apexOf({ parallels: [8, 18], center: [-3, 19.9], scale: K, translate: [T[0] - 0.205 * K, T[1] + 0.212 * K] }),
};

export function usStates() {
  if (cache) return cache;
  const out = {};
  feature(topo, topo.objects.states).features.forEach((f) => {
    const abbr = STATE_ABBR[f.properties.name];
    if (!abbr) return;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    let d = "";
    polys.forEach((poly) => poly.forEach((ring) => {
      ring.forEach(([x, y], i) => {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        d += `${i ? "L" : "M"}${r1(x)} ${r1(y)}`;
      });
      d += "Z";
    }));
    // Straight: its meridian runs from the apex through its middle; turn
    // the state by that angle about the middle.
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const [ax, ay] = APEX[abbr] || APEX.lower48;
    const th = Math.atan2(mx - ax, my - ay);
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    let sx0 = Infinity; let sy0 = Infinity; let sx1 = -Infinity; let sy1 = -Infinity;
    let ds = "";
    polys.forEach((poly) => poly.forEach((ring) => {
      ring.forEach(([x, y], i) => {
        const dx = x - mx;
        const dy = y - my;
        const rx = mx + dx * cos - dy * sin;
        const ry = my + dx * sin + dy * cos;
        if (rx < sx0) sx0 = rx; if (rx > sx1) sx1 = rx; if (ry < sy0) sy0 = ry; if (ry > sy1) sy1 = ry;
        ds += `${i ? "L" : "M"}${r1(rx)} ${r1(ry)}`;
      });
      ds += "Z";
    }));
    out[abbr] = { abbr, name: f.properties.name, d, bbox: [x0, y0, x1, y1], ds, bboxS: [sx0, sy0, sx1, sy1] };
  });
  cache = out;
  return out;
}

export const US_FRAME = [975, 610];
