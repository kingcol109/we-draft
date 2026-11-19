// src/components/recruitSim/USMap.jsx
//
// A map of the US carved into the seven recruiting regions (user, 2026-11-17:
// "a regionalized map of the US"). Real state shapes (us-atlas, Albers USA,
// merged per region in usRegions.json — thin lines mark states inside a
// region, a heavy outline marks each region). Three jobs:
//   • heatmap   scouting progress, your interest, talent, or your board,
//               per region — how your recruitment is spreading
//   • drop zone drag a staff member onto a region to send him there
//               (or tap a staff chip, then a region)
//   • filter    click a region to filter (Recruits tab)
// Drop/tap ids keep the "state:XX" form (the region's first state) so the
// board/staff handlers resolve it with regionOfState.
import { useMemo } from "react";
import { useDroppable, pointerWithin } from "@dnd-kit/core";
import { REGIONS } from "../../utils/recruitSim/regions";
import { scoutProgress, interestView } from "../../utils/recruitSim/view";
import { SUB, GOLD, INK, pillBtn } from "./ui";
import GEO from "./usRegions.json";

// Region tints (borders / labels).
export const REGION_COLOR = { NE: "#5b8def", MA: "#33b6a8", SE: "#e2a33a", DS: "#d0663f", TX: "#c9554f", MW: "#8a7ad8", W: "#4fa3d9" };
export const METRICS = [["scout", "Scouting"], ["interest", "Interest"], ["talent", "Talent"], ["board", "Board"]];
const METRIC_NOTE = {
  scout: "How much your staff has uncovered on the top recruits in each region",
  interest: "Your standing with the recruits you've contacted there",
  talent: "4- and 5-star recruits still open",
  board: "Recruits on your board",
};

// Per-region value 0..1 (+ raw label) for a metric.
function useHeat(state, ver, metric) {
  return useMemo(() => {
    const by = {};
    const usc = state.schools[state.user];
    const onBoard = new Set(usc.board);
    state.recruits.forEach((x) => {
      if (x.commit >= 0 && x.commit !== state.user) return;
      const b = (by[x.region] = by[x.region] || { n: 0, sum: 0, top: 0, cnt: 0 });
      if (metric === "scout") { if (x.rating >= 80) { b.n += 1; b.sum += scoutProgress(state, x.i); } }
      else if (metric === "interest") { const v = interestView(state, x.i); if (v.level) { b.n += 1; b.sum += (v.lvl + 1) / 5; } }
      else if (metric === "talent") { if (x.stars >= 4 && x.commit < 0) b.cnt += 1; }
      else if (metric === "board") { if (onBoard.has(x.i)) b.cnt += 1; }
    });
    const out = {};
    const maxCnt = Math.max(1, ...Object.values(by).map((b) => b.cnt));
    Object.entries(by).forEach(([rg, b]) => {
      if (metric === "talent" || metric === "board") out[rg] = { v: b.cnt / maxCnt, label: b.cnt ? String(b.cnt) : "" };
      else out[rg] = { v: b.n ? b.sum / b.n : 0, label: b.n ? `${Math.round((b.sum / b.n) * 100)}` : "" };
    });
    return out;
  }, [state, ver, metric]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Region shapes overlap as rectangles (the West's box takes in Alaska and
// Hawaii), so a staff drop only counts where the pointer is inside the fill.
export function staffCollide(args) {
  const p = args.pointerCoordinates;
  return pointerWithin(args).filter((h) => {
    if (!String(h.id).startsWith("state:")) return true;
    const el = args.droppableContainers.find((c) => c.id === h.id)?.node.current;
    if (!p || !el?.isPointInFill || !el.getScreenCTM) return true;
    const m = el.getScreenCTM().inverse();
    const pt = new DOMPoint(p.x, p.y).matrixTransform(m);
    return el.isPointInFill(pt);
  });
}

export default function USMap({ state, ver, metric, setMetric, selected, onPick, armed, staffByRegion = {}, compact = false, droppable = true, labelScale = 1 }) {
  const heat = useHeat(state, ver, metric);
  return (
    <div>
      {setMetric && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          {METRICS.map(([k, l]) => <button key={k} type="button" style={{ ...pillBtn(metric === k), padding: "4px 9px", fontSize: 11 }} onClick={() => setMetric(k)}>{l}</button>)}
        </div>
      )}
      <svg viewBox={`0 0 ${GEO.w} ${GEO.h}`} style={{ width: "100%", height: "auto", display: "block", touchAction: "manipulation" }}>
        {REGIONS.map((r) => (
          <Region key={r.key} r={r} heat={heat[r.key]} selected={selected === r.key} armed={armed} onPick={onPick} droppable={droppable} />
        ))}
        <path d={GEO.inner} fill="none" stroke="rgba(10,16,28,0.45)" strokeWidth={1} pointerEvents="none" />
        {REGIONS.map((r) => <path key={r.key} d={GEO.regions[r.key]} fill="none" stroke={selected === r.key ? "#fff" : "#0b1220"} strokeWidth={selected === r.key ? 4 : 2.5} pointerEvents="none" />)}
        {REGIONS.map((r) => <Label key={r.key} r={r} heat={heat[r.key]} staff={staffByRegion[r.key]} scale={compact ? 1.7 : labelScale} />)}
      </svg>
      <div style={{ fontSize: 11, color: SUB, fontWeight: 700, marginTop: 6, textAlign: "center" }}>{METRIC_NOTE[metric]}{armed ? " · tap a region to send them there" : ""}</div>
    </div>
  );
}

function fillOf(r, v) {
  // Region color underneath, gold heat on top.
  return v > 0 ? `color-mix(in srgb, ${GOLD} ${Math.round(18 + v * 72)}%, ${REGION_COLOR[r.key]} 35%)` : `color-mix(in srgb, ${REGION_COLOR[r.key]} 28%, #121b2c)`;
}

function Region({ r, heat, selected, armed, onPick, droppable }) {
  const { setNodeRef, isOver } = useDroppable({ id: `state:${r.states[0]}`, disabled: !droppable });
  const v = heat?.v || 0;
  return (
    <path ref={setNodeRef} d={GEO.regions[r.key]} onClick={() => onPick?.(r.states[0])}
      fillOpacity={isOver ? 0.9 : 1}
      stroke={armed ? "rgba(255,255,255,0.5)" : "none"} strokeDasharray={armed ? "6 5" : undefined} strokeWidth={2}
      style={{ fill: isOver ? "#fff" : fillOf(r, v), cursor: onPick ? "pointer" : "default", transition: "fill .15s" }}>
      <title>{`${r.label}: ${r.states.join(", ")}${heat?.label ? ` · ${heat.label}` : ""}`}</title>
    </path>
  );
}

function Label({ r, heat, staff, scale }) {
  const [x, y] = GEO.label[r.key];
  const big = 26 * scale;
  const small = 16 * scale;
  const halo = { paintOrder: "stroke", stroke: "rgba(6,10,18,0.85)", strokeWidth: 5, strokeLinejoin: "round" };
  return (
    <g pointerEvents="none" textAnchor="middle" style={{ fontFamily: "inherit", fontWeight: 900 }}>
      <text x={x} y={y - big * 0.55} fontSize={small} fill={INK} style={halo}>{r.label}</text>
      <text x={x} y={y + big * 0.45} fontSize={big} fill={GOLD} style={halo}>{heat?.label || "–"}</text>
      {staff?.length ? <text x={x} y={y + big * 0.45 + small * 1.2} fontSize={small} fill="#fff" style={halo}>{staff.join(" ")}</text> : null}
    </g>
  );
}
