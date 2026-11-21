// src/components/StateShape.jsx
//
// A state's own silhouette, filled with a gradient — the /hs pages' state
// marks (pages/HighSchoolHub.jsx), shared (user, 2026-11-21) with the portal
// Targets rows and the career path's high school stop when the school has
// no logo (PlayerEligibilityInfo.jsx, ScoutCard, the Draft Sim card).
//
// The outlines (utils/usStatesGeo.js — us-atlas + topojson) are loaded on
// first use, so pages that only sometimes draw a state don't carry them in
// their bundle. Until they're in, the mark holds its space.
//   abbr   two-letter code ("FL"); unknown → nothing
//   glow   soft blue drop shadow (the /hs hero)
//   light  white gradient, for dark backgrounds
import { useEffect, useState } from "react";

let geo = null;
let loading = null;
const loadGeo = () => {
  if (!loading) loading = import("../utils/usStatesGeo").then((m) => { geo = m.usStates(); return geo; });
  return loading;
};

// A page that already has the outlines (the /hs hub) hands them over, so
// its marks draw on the first frame.
export function primeStateShapes(states) {
  if (geo || !states) return;
  geo = states;
  loading = Promise.resolve(states);
}

//   straight  north up (default — a state on its own, user 2026-11-21);
//          false keeps the map's Albers lean (the /hs hub, where states sit
//          as they do on its map)
export default function StateShape({ abbr, size = 80, glow = true, light = false, title, straight = true }) {
  const [states, setStates] = useState(geo);
  useEffect(() => {
    if (states) return undefined;
    let c = false;
    loadGeo().then((g) => { if (!c) setStates(g); }).catch(() => {});
    return () => { c = true; };
  }, [states]);
  if (!states) return <span aria-hidden="true" style={{ display: "inline-block", width: size, height: size, flexShrink: 0 }} />;
  const s = states[abbr];
  if (!s) return null;
  const [x0, y0, x1, y1] = straight ? s.bboxS : s.bbox;
  const d = straight ? s.ds : s.d;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  const gid = `wdstate-g-${abbr}-${light ? "l" : "d"}`;
  return (
    <svg viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`} width={size} height={size}
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : "true"}
      style={{ flexShrink: 0, overflow: "visible", filter: glow ? `drop-shadow(0 6px 14px rgba(0,85,165,${light ? 0.5 : 0.3}))` : undefined }}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light ? "#ffffff" : "#5b9be6"} />
          <stop offset="1" stopColor={light ? "#cfe1f7" : "#0055a5"} />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${gid})`} stroke="#fff" strokeWidth={(x1 - x0) / 120} />
    </svg>
  );
}
