// src/utils/usStatesGeo.js
//
// US state outlines as SVG path strings in us-atlas's pre-projected Albers
// USA frame (975 × 610) — the same frame the /hs heatmap points are stored
// in (utils/albersUsa.js, server/highSchools/hsGeo.js). Already projected,
// so no d3 / WebGL: each ring is just "M x y L … Z". Built once, on first
// use, and only inside the lazily loaded page that imports it.
import { feature } from "topojson-client";
import topo from "us-atlas/states-albers-10m.json";
import { STATE_ABBR } from "./highSchoolMatch";

let cache = null;

const r1 = (v) => Math.round(v * 10) / 10;

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
    out[abbr] = { abbr, name: f.properties.name, d, bbox: [x0, y0, x1, y1] };
  });
  cache = out;
  return out;
}

export const US_FRAME = [975, 610];
