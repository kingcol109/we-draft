// src/components/events/CombineProfiles.jsx
//
// The Combine hub's Position Averages tab (pages/EventPage.jsx CombineHub):
//   /events/combine                 All positions — a card per position, the
//                                   position ladder (drill picker) and the
//                                   records grid: the best ever at every
//                                   position in every drill.
//   /events/combine/{pos}           One position's profile — the best
//                                   all-around performers, each drill's
//                                   all-time top 10, and the average in every
//                                   measurement and drill (with the record
//                                   and where the position ranks).
// Data: _combineIndex.profiles + .performers (utils/combineData.js combineProfiles); until
// the snapshot is rebuilt with it, computed here from the year docs.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSchools } from "../DraftArchiveList";
import { combineProfiles, formatCombine } from "../../utils/combineData";
import { fetchCombineYear, playerHref, schoolHref } from "../../utils/events";
import { NAVY, GOLD, BODY_FONT, Icon, SectionHead } from "./EventKit";
import { useCombineGraphic, CombineGraphicCard } from "./CombineGraphic";
import CombineSearch from "./CombineSearch";
import { fetchNflBranding } from "../../utils/draftProfileData";
import { nflAbbrFromOrg } from "../../utils/coachHistory";

export const PROFILE_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB"];
// "Defensive Line" → one "Defensive Lineman", many "Defensive Linemen".
const person = (name) => name.replace(/ Line$/, " Lineman");
const plural = (name) => (/ Line$/.test(name) ? name.replace(/ Line$/, " Linemen") : `${name}s`);
export const combinePosPath = (pos) => `/events/combine/${String(pos).toLowerCase()}`;
// Each drill's ranking has its own URL (/events/combine/qb/40-yard-dash) and
// title; the measurements' leaderboards stay on the position's page.
export const DRILL_PAGES = {
  forty: { slug: "40-yard-dash", name: "40 Yard Dash", what: "fastest 40-yard dash times" },
  vertical: { slug: "vertical-jump", name: "Vertical Jump", what: "highest vertical jumps" },
  broad: { slug: "broad-jump", name: "Broad Jump", what: "longest broad jumps" },
  bench: { slug: "bench-press", name: "Bench Press", what: "most bench press reps" },
  threeCone: { slug: "3-cone-drill", name: "3 Cone Drill", what: "fastest 3-cone drill times" },
  shuttle: { slug: "20-yard-shuttle", name: "20 Yard Shuttle", what: "fastest 20-yard shuttle times" },
};
export const drillFromSlug = (slug) => Object.keys(DRILL_PAGES).find((k) => DRILL_PAGES[k].slug === slug) || null;
export const combineDrillPath = (pos, key) => `${combinePosPath(pos)}/${DRILL_PAGES[key].slug}`;
// "Best Quarterback Combine Performances" · "Best Quarterback 40 Yard Dash Performances"
export const combineHeadline = (pos, drill) => `Best ${person(POSITION_NAMES[pos] || pos)} ${drill ? DRILL_PAGES[drill].name : "Combine"} Performances`;
export const POSITION_NAMES = { QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OL: "Offensive Line", EDGE: "Edge Rusher", DL: "Defensive Line", LB: "Linebacker", DB: "Defensive Back" };
const DRILLS = [
  { key: "forty", label: "40-Yard Dash", short: "40", best: "Fastest", low: true },
  { key: "vertical", label: "Vertical Jump", short: "Vert", best: "Highest" },
  { key: "broad", label: "Broad Jump", short: "Broad", best: "Longest" },
  { key: "bench", label: "Bench Press", short: "Bench", best: "Most reps", unit: "reps of 225 lbs" },
  { key: "threeCone", label: "3-Cone Drill", short: "3-Cone", best: "Fastest", low: true },
  { key: "shuttle", label: "20-Yard Shuttle", short: "Shuttle", best: "Fastest", low: true },
];
const BUILD = [
  { key: "height", label: "Height", best: "Tallest" },
  { key: "weight", label: "Weight", best: "Heaviest", suffix: " lbs" },
  { key: "arm", label: "Arm Length", best: "Longest arms" },
  { key: "hand", label: "Hand Size", best: "Biggest hands" },
];
const fmt = (k, v) => `${formatCombine(k, v)}${k === "weight" ? " lbs" : ""}`;
const ord = (n) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const yy = (y) => `'${String(y).slice(2)}`;

// ── Data: the index's profiles, else built from every year's rows ──
let builtP = null;
const EMPTY = { profiles: {}, performers: {} };
export function useCombineProfiles(index) {
  const [built, setBuilt] = useState(null);
  const ready = index?.profiles && index?.performers ? index : null;
  useEffect(() => {
    if (ready || !index?.years) return undefined;
    let live = true;
    if (!builtP) {
      const years = Object.keys(index.years);
      builtP = Promise.all(years.map((y) => fetchCombineYear(y)))
        .then((lists) => combineProfiles(Object.fromEntries(years.map((y, i) => [y, lists[i] || []]))))
        .catch((e) => { builtP = null; console.error("Combine profiles error:", e); return null; });
    }
    builtP.then((p) => live && setBuilt(p || EMPTY));
    return () => { live = false; };
  }, [ready, index]);
  if (index === undefined) return undefined;
  if (!index) return EMPTY;
  return ready ? { profiles: ready.profiles, performers: ready.performers } : built || undefined;
}

// Where a position's average ranks among the nine in a drill (1 = best).
function rankOf(profiles, pos, key, low) {
  const list = PROFILE_POSITIONS.filter((p) => profiles[p]?.[key]?.n >= 5).map((p) => [p, profiles[p][key].avg])
    .sort((a, b) => (low ? a[1] - b[1] : b[1] - a[1]));
  const i = list.findIndex(([p]) => p === pos);
  return i < 0 ? null : { rank: i + 1, of: list.length };
}

const card = { background: "#fff", border: "1px solid #e2e7ef", borderRadius: 16, boxShadow: "0 4px 18px rgba(0,30,70,0.06)", overflow: "hidden" };
const kicker = (color = "#8a94a6") => ({ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color });

// A segmented bar of choices — the position sub-tabs and the leaderboard's
// drill picker: a tinted track, the picked one a raised navy tile.
function Segmented({ ev, children, innerRef, isMobile, style }) {
  return (
    <div style={{ background: "#eaf0f7", border: "1px solid #dbe4ef", borderRadius: 14, padding: 4, boxShadow: "inset 0 1px 2px rgba(0,30,70,0.06)", ...style }}>
      <div ref={innerRef} style={{ display: "flex", gap: isMobile ? 3 : 4, overflowX: "auto", scrollbarWidth: "none", position: "relative" }}>{children}</div>
    </div>
  );
}
const segStyle = (on, ev, isMobile, grow) => ({
  flex: grow ? "1 0 auto" : "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: isMobile ? "8px 12px" : "9px 14px", borderRadius: 10, border: "none", cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap",
  fontFamily: "'Arial Black', Arial, sans-serif", fontSize: isMobile ? 11.5 : 12.5, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase",
  background: on ? `linear-gradient(135deg, ${NAVY}, ${ev.color})` : "transparent", color: on ? "#fff" : "#4a5566",
  boxShadow: on ? "0 4px 12px rgba(0,48,92,0.28), inset 0 -2px 0 rgba(0,0,0,0.15)" : "none",
  transition: "background 0.15s, color 0.15s",
});

// The position sub-tabs: All · QB · RB …
export function PositionTabs({ ev, pos, isMobile }) {
  return (
    <Segmented ev={ev} isMobile={isMobile} style={{ margin: "0 0 14px" }}>
      <Link to="/events/combine" style={segStyle(!pos, ev, isMobile, true)}>All</Link>
      {PROFILE_POSITIONS.map((p) => <Link key={p} to={combinePosPath(p)} style={segStyle(pos === p, ev, isMobile, true)}>{p}</Link>)}
    </Segmented>
  );
}

// The leaderboard's drill picker: the drills, then the measurements.
const DRILL_ICON = { forty: "stopwatch", threeCone: "stopwatch", shuttle: "stopwatch", vertical: "podium", broad: "ruler", bench: "dumbbell", height: "ruler", weight: "dumbbell", arm: "ruler", hand: "badge" };
function DrillPicker({ ev, metrics, board, setBoard, chipsRef, isMobile }) {
  const drills = metrics.filter((m) => DRILLS.some((d) => d.key === m.key));
  const build = metrics.filter((m) => BUILD.some((b) => b.key === m.key));
  const btn = (x) => (
    <button key={x.key} type="button" onClick={() => setBoard(x.key)} aria-pressed={x.key === board}
      style={{ ...segStyle(x.key === board, ev, isMobile, !isMobile), ...(isMobile ? {} : { padding: "9px 8px", gap: 5, fontSize: 11.5 }) }}>
      <Icon name={DRILL_ICON[x.key] || "stopwatch"} size={13} stroke={2.4} style={{ opacity: x.key === board ? 1 : 0.6 }} />{x.short}
    </button>
  );
  const divider = <span aria-hidden="true" style={{ flex: "0 0 1px", alignSelf: "stretch", margin: "6px 4px", background: "#c9d5e3" }} />;
  return (
    <Segmented ev={ev} innerRef={chipsRef} isMobile={isMobile} style={{ marginBottom: 12 }}>
      {drills.map(btn)}{build.length > 0 && divider}{build.map(btn)}
    </Segmented>
  );
}

// ═══════════ All positions ═══════════
export function CombineAllPositions({ ev, profiles, performers, isMobile, span }) {
  return (
    <>
      <p style={{ margin: "0 0 14px", fontSize: isMobile ? 14 : 16, fontWeight: 600, color: "#3a4352", lineHeight: 1.6, fontFamily: BODY_FONT }}>
        What players measured and tested at the Combine{span ? `, ${span}` : ""} — the average prospect at each position, and the best ever. Pick a position for its full profile.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, minmax(0, 1fr))", gap: isMobile ? 8 : 12 }}>
        {PROFILE_POSITIONS.filter((p) => profiles[p]).map((p) => <PositionCard key={p} ev={ev} pos={p} prof={profiles[p]} profiles={profiles} best={performers?.[p]?.[0]} isMobile={isMobile} />)}
      </div>

      <SectionHead icon="podium" title="Position Ladder" isMobile={isMobile} color={ev.color} />
      <Ladder ev={ev} profiles={profiles} isMobile={isMobile} />

      <SectionHead icon="trophy" title="Combine Records by Position" isMobile={isMobile} color={ev.color} />
      <RecordsGrid ev={ev} profiles={profiles} isMobile={isMobile} />
      <Footnote span={span} />
    </>
  );
}

function PositionCard({ ev, pos, prof, profiles, best, isMobile }) {
  const forty = prof.forty;
  const r = forty && rankOf(profiles, pos, "forty", true);
  const rec = forty?.top?.[0];
  return (
    <Link to={combinePosPath(pos)} style={{ ...card, textDecoration: "none", color: "#1c2330", display: "flex", flexDirection: "column", position: "relative" }}>
      <div style={{ background: `linear-gradient(120deg, ${ev.dark}, ${ev.color})`, color: "#fff", padding: isMobile ? "10px 12px" : "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: isMobile ? 24 : 30, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.01em" }}>{pos}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 10 : 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{POSITION_NAMES[pos]}</span>
        <Icon name="right" size={16} stroke={3} style={{ color: GOLD }} />
      </div>
      <div style={{ padding: isMobile ? "10px 12px 12px" : "14px 16px 16px", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={kicker()}>Avg 40</div>
            <div style={{ fontSize: isMobile ? 26 : 34, fontWeight: 900, color: ev.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{forty ? formatCombine("forty", forty.avg) : "—"}</div>
          </div>
          {r && !isMobile && <span style={{ fontSize: 11, fontWeight: 900, color: ev.dark, background: "#eef4fb", borderRadius: 999, padding: "4px 9px" }}>{ord(r.rank)} fastest</span>}
        </div>
        <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 800, color: "#3a4352", fontFamily: BODY_FONT }}>
          {prof.height ? formatCombine("height", prof.height.avg) : "—"} · {prof.weight ? fmt("weight", Math.round(prof.weight.avg)) : "—"}
        </div>
        {rec && (
          <div style={{ borderTop: "1px solid #eef1f5", paddingTop: 8, fontSize: 11, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: GOLD, fontWeight: 900 }}>★</span> Fastest: <b style={{ color: "#1c2330" }}>{rec.name}</b> {formatCombine("forty", rec.value)}
          </div>
        )}
        {best && (
          <div style={{ marginTop: -4, fontSize: 11, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: GOLD, fontWeight: 900 }}>♛</span> Best performer: <b style={{ color: "#1c2330" }}>{best.name}</b> {yy(best.year)}
          </div>
        )}
      </div>
    </Link>
  );
}

// Every position's average in one drill, best first.
function Ladder({ ev, profiles, isMobile }) {
  const [key, setKey] = useState("forty");
  const d = DRILLS.find((x) => x.key === key);
  const rows = PROFILE_POSITIONS.filter((p) => profiles[p]?.[key]?.n >= 5).map((p) => ({ p, v: profiles[p][key].avg }))
    .sort((a, b) => (d.low ? a.v - b.v : b.v - a.v));
  const vals = rows.map((r) => r.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pct = (v) => (hi === lo ? 100 : 28 + 72 * (d.low ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo)));
  return (
    <div style={{ ...card, padding: isMobile ? 12 : 18 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {DRILLS.map((x) => (
          <button key={x.key} type="button" onClick={() => setKey(x.key)} aria-pressed={x.key === key} style={{
            border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase",
            background: x.key === key ? ev.color : "#eef2f7", color: x.key === key ? "#fff" : "#5a6475",
          }}>{x.short}</button>
        ))}
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {rows.map((r, i) => (
          <Link key={r.p} to={combinePosPath(r.p)} style={{ display: "grid", gridTemplateColumns: isMobile ? "20px 44px 1fr" : "24px 54px 1fr", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: i === 0 ? GOLD : "#8a94a6", textAlign: "right" }}>{i + 1}</span>
            <span style={{ fontSize: 13, fontWeight: 900, color: "#1c2330" }}>{r.p}</span>
            <span style={{ position: "relative", height: isMobile ? 24 : 28, background: "#f1f4f8", borderRadius: 8 }}>
              <span style={{
                position: "absolute", inset: "0 auto 0 0", width: `${pct(r.v)}%`, borderRadius: 8,
                background: i === 0 ? `linear-gradient(90deg, ${ev.color}, ${GOLD})` : `linear-gradient(90deg, ${ev.dark}, ${ev.color})`,
                display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 8, boxSizing: "border-box",
                color: "#fff", fontSize: isMobile ? 12 : 13, fontWeight: 900, fontVariantNumeric: "tabular-nums", transition: "width 0.35s ease",
              }}>{formatCombine(key, r.v)}</span>
            </span>
          </Link>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, fontStyle: "italic", color: "#8a94a6", fontFamily: BODY_FONT }}>
        Average {d.label.toLowerCase()}{d.unit ? ` (${d.unit})` : ""} by position, {d.low ? "fastest" : "best"} first.
      </div>
    </div>
  );
}

// Positions × drills: each cell the best ever, the column's overall best in gold.
function RecordsGrid({ ev, profiles, isMobile }) {
  const best = Object.fromEntries(DRILLS.map((d) => {
    const vals = PROFILE_POSITIONS.map((p) => profiles[p]?.[d.key]?.top?.[0]?.value).filter((v) => v != null);
    return [d.key, vals.length ? (d.low ? Math.min(...vals) : Math.max(...vals)) : null];
  }));
  const th = { padding: "10px 8px", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fff", background: ev.dark, whiteSpace: "nowrap", textAlign: "center" };
  return (
    <div style={{ ...card, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, zIndex: 1 }}>Pos</th>
            {DRILLS.map((d) => <th key={d.key} style={th}>{d.short}</th>)}
          </tr>
        </thead>
        <tbody>
          {PROFILE_POSITIONS.filter((p) => profiles[p]).map((p, i) => (
            <tr key={p} style={{ borderTop: "1px solid #eef1f5", background: i % 2 ? "#fafbfd" : "#fff" }}>
              <td style={{ padding: "8px 12px", position: "sticky", left: 0, background: i % 2 ? "#fafbfd" : "#fff", zIndex: 1 }}>
                <Link to={combinePosPath(p)} style={{ fontSize: 14, fontWeight: 900, color: ev.color, textDecoration: "none" }}>{p}</Link>
              </td>
              {DRILLS.map((d) => {
                const rec = profiles[p]?.[d.key]?.top?.[0];
                const top = rec && rec.value === best[d.key];
                return (
                  <td key={d.key} style={{ padding: "8px 6px", textAlign: "center", background: top ? "#fff6e5" : "transparent", boxShadow: top ? `inset 0 0 0 2px ${GOLD}` : "none" }}>
                    {rec ? (
                      <>
                        <div style={{ fontSize: 15, fontWeight: 900, color: top ? "#b06f00" : "#1c2330", fontVariantNumeric: "tabular-nums" }}>{top ? "★ " : ""}{formatCombine(d.key, rec.value)}</div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT, whiteSpace: "nowrap" }}>
                          <PlayerName p={rec} /> {yy(rec.year)}
                        </div>
                      </>
                    ) : <span style={{ color: "#c4ccd8" }}>—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PlayerName = ({ p, style }) => {
  const href = playerHref(p);
  return href ? <Link to={href} style={{ color: "inherit", textDecoration: "none", ...style }}>{p.name}</Link> : <span style={style}>{p.name}</span>;
};
const Footnote = ({ span }) => (
  <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, fontStyle: "italic", color: "#8a94a6", fontFamily: BODY_FONT }}>
    Every Combine result on file{span ? `, ${span}` : ""}.
  </div>
);

// ═══════════ One position's profile ═══════════
// Top to bottom: the header (the average build and 40), the best all-around
// performers, the leaderboards (the top 10 ever in whichever drill is
// picked) and the average in every drill (one plain table).
const ALL_METRICS = [...BUILD.map((b) => ({ ...b, short: b.label.replace(" Length", "").replace(" Size", "") })), ...DRILLS];
// "7th fastest of 9 positions" — the drill's own word for "best".
const RANK_WORD = { height: "tallest", weight: "heaviest", arm: "longest", hand: "biggest", forty: "fastest", threeCone: "quickest", shuttle: "quickest", vertical: "highest", broad: "longest", bench: "strongest" };

// drill: the drill whose ranking the URL names (its leaderboard open, its headline).
export function CombinePositionProfile({ ev, pos, profiles, performers, isMobile, span, drill = null }) {
  const prof = profiles[pos] || {};
  const n = Math.max(0, ...Object.values(prof).map((m) => m.n || 0));
  const best = performers?.[pos] || [];
  const players = useMemo(() => [...Object.values(profiles[pos] || {}).flatMap((m) => m.top || []), ...(performers?.[pos] || [])].map((t) => t.school), [profiles, performers, pos]);
  const brands = useSchools(players);
  const navigate = useNavigate();
  const [board, setBoardState] = useState(drill || "forty");
  useEffect(() => { if (drill) setBoardState(drill); }, [drill]);
  // A drill's leaderboard is its own page; a measurement's stays on the position's.
  const setBoard = (k) => {
    setBoardState(k);
    const to = DRILL_PAGES[k] ? combineDrillPath(pos, k) : combinePosPath(pos);
    if (window.location.pathname !== to) navigate(to, { replace: true, preventScrollReset: true });
  };
  const boardRef = useRef(null);
  const name = POSITION_NAMES[pos];
  const metrics = ALL_METRICS.filter((m) => prof[m.key]?.n >= 3);
  const openBoard = (k) => { setBoard(k); boardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const headline = [["height", "Height"], ["weight", "Weight"], ["forty", "40-Yard"]].filter(([k]) => prof[k]);

  return (
    <>
      {/* Header */}
      <div style={{
        position: "relative", borderRadius: 18, overflow: "hidden", color: "#fff",
        background: `linear-gradient(125deg, ${NAVY} 0%, ${ev.color} 75%, ${ev.accent} 140%)`, boxShadow: "0 12px 30px rgba(0,30,70,0.22)",
        display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto", gap: isMobile ? 14 : 24, alignItems: "center", padding: isMobile ? "16px" : "22px 26px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 18, minWidth: 0 }}>
          <div style={{
            width: isMobile ? 64 : 88, height: isMobile ? 64 : 88, flexShrink: 0, borderRadius: 18, background: "rgba(0,0,0,0.22)", border: `3px solid ${GOLD}`,
            display: "grid", placeItems: "center", fontSize: pos.length > 2 ? (isMobile ? 22 : 30) : (isMobile ? 30 : 40), fontWeight: 900,
          }}>{pos}</div>
          <div style={{ minWidth: 0 }}>
            <div style={kicker(GOLD)}>All-time player rankings</div>
            <h1 style={{ margin: "3px 0 4px", fontSize: isMobile ? 21 : 27, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.08 }}>{combineHeadline(pos, drill)}</h1>
            <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, color: "rgba(255,255,255,0.85)", fontFamily: BODY_FONT }}>
              {n.toLocaleString()} {plural(name).toLowerCase()} tested{span ? ` · ${span}` : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${headline.length}, minmax(0, 1fr))`, gap: 8 }}>
          {headline.map(([k, label]) => (
            <div key={k} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: isMobile ? "8px 6px" : "10px 16px", textAlign: "center" }}>
              <div style={kicker(GOLD)}>Avg {label}</div>
              <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, lineHeight: 1.1, marginTop: 3, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {formatCombine(k, k === "weight" ? Math.round(prof[k].avg) : prof[k].avg)}{k === "weight" ? <span style={{ fontSize: 12 }}> lbs</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {best.length > 0 && <BestPerformers ev={ev} pos={pos} list={best} brands={brands} isMobile={isMobile} pool={n} span={span} />}

      {/* Find a player: any player's whole Combine */}
      <CombineSearch ev={ev} pos={pos} isMobile={isMobile} />

      {/* Leaderboards */}
      <div ref={boardRef} style={{ scrollMarginTop: 80 }}>
        <SectionHead icon="podium" title="Leaderboards" isMobile={isMobile} color={ev.color} />
      </div>
      <Leaderboard ev={ev} m={ALL_METRICS.find((x) => x.key === board)} s={prof[board]} metrics={metrics} board={board} setBoard={setBoard} brands={brands} isMobile={isMobile} />

      {/* The average, drill by drill */}
      <SectionHead icon="clipboard" title={`The Average ${person(name)}`} isMobile={isMobile} color={ev.color} />
      <div style={card}>
        {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.8fr 1.6fr 1.2fr 24px", gap: 12, padding: "10px 18px", background: "#f1f4f8", ...kicker("#5a6475") }}>
            <span>Drill</span><span>Average</span><span>Best ever</span><span>Among positions</span><span />
          </div>
        )}
        {metrics.map((m, i) => {
          const s = prof[m.key];
          const rec = s.top?.[0];
          const r = rankOf(profiles, pos, m.key, m.low);
          const rankText = r ? `${ord(r.rank)} ${RANK_WORD[m.key]} of ${r.of}` : "";
          const top3 = r && r.rank <= 3;
          return (
            <button key={m.key} type="button" onClick={() => openBoard(m.key)} title={`${m.label} leaderboard`} style={{
              display: "grid", gridTemplateColumns: isMobile ? "minmax(0, 1fr) auto" : "1.1fr 0.8fr 1.6fr 1.2fr 24px", gap: isMobile ? 8 : 12, alignItems: "center",
              width: "100%", textAlign: "left", font: "inherit", cursor: "pointer", border: "none", borderTop: !i ? "none" : m.key === "forty" ? "3px solid #e2e7ef" : "1px solid #eef1f5",
              background: "#fff", padding: isMobile ? "11px 14px" : "11px 18px",
            }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: isMobile ? 14 : 15, fontWeight: 900, color: "#1c2330" }}>{m.label}</span>
                {isMobile && <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {rec ? <>Best: <b style={{ color: "#1c2330" }}>{rec.name}</b> {fmt(m.key, rec.value)}</> : null}
                </span>}
                {isMobile && rankText && <span style={{ display: "block", fontSize: 11, fontWeight: 800, color: top3 ? "#b06f00" : "#8a94a6", fontFamily: BODY_FONT, marginTop: 1 }}>{rankText} positions</span>}
              </span>
              <span style={{ fontSize: isMobile ? 20 : 20, fontWeight: 900, color: ev.color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: isMobile ? "right" : "left" }}>
                {formatCombine(m.key, m.key === "weight" ? Math.round(s.avg) : s.avg)}{m.key === "weight" ? <span style={{ fontSize: 12 }}> lbs</span> : null}
              </span>
              {!isMobile && (
                <span style={{ minWidth: 0, fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {rec ? <>
                    <b style={{ fontSize: 15, color: NAVY, fontFamily: "'Arial Black', Arial, sans-serif", fontVariantNumeric: "tabular-nums" }}>{fmt(m.key, rec.value)}</b>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#5a6475" }}> · {rec.name} {yy(rec.year)}</span>
                  </> : "—"}
                </span>
              )}
              {!isMobile && (
                <span>
                  {rankText ? <span style={{ fontSize: 12, fontWeight: 900, color: top3 ? "#8a5600" : "#3a4352", background: top3 ? "#fff6e5" : "#eef2f7", border: `1px solid ${top3 ? GOLD : "transparent"}`, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>{rankText}</span> : null}
                </span>
              )}
              {!isMobile && <Icon name="right" size={16} stroke={2.6} style={{ color: "#b4bfcc" }} />}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, fontStyle: "italic", color: "#8a94a6", fontFamily: BODY_FONT }}>
        Tap a drill to see its leaderboard. “Among positions” ranks the nine position groups' averages.
      </div>

      <Footnote span={span} />
    </>
  );
}

// The all-time top 10 in one drill: a podium for the top three (1-2-3, left
// to right), then the rest as ranked rows — school, class and draft slot.
const MEDAL = [
  { name: "Gold", bg: "radial-gradient(circle at 35% 30%, #fff1b8, #f6a21d 60%, #b8770a)", ring: "#ffd56b", ink: "#5a3a00" },
  { name: "Silver", bg: "radial-gradient(circle at 35% 30%, #ffffff, #b8c2cf 60%, #7d8896)", ring: "#dfe5ec", ink: "#2c3440" },
  { name: "Bronze", bg: "radial-gradient(circle at 35% 30%, #ffd9b5, #c07a3e 60%, #7a4417)", ring: "#e8a46a", ink: "#3d1f06" },
];
// A school's color for a card behind white type: its darker color, never too light.
const hexOk = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "")}` : null);
const lumOf = (h) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const shade = (h, k) => { const n = parseInt(h.slice(1), 16); const f = (v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0"); return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`; };
function stageColor(c1, c2) {
  const pick = [hexOk(c1), hexOk(c2)].find((c) => c && lumOf(c) < 0.6 && lumOf(c) > 0.04) || hexOk(c1) || "#0055a5";
  return lumOf(pick) > 0.45 ? shade(pick, 0.45) : pick;
}
const ROW_COLS = "44px minmax(0, 1fr) minmax(0, 0.8fr) 100px";
// NFL teams' logos by abbreviation (the _nflBranding snapshot, else the nfl collection).
function useNflLogos() {
  const [teams, setTeams] = useState({});
  useEffect(() => { let live = true; fetchNflBranding().then((t) => live && setTeams(t || {})).catch(() => {}); return () => { live = false; }; }, []);
  return teams;
}
// Where he was drafted: his team's logo, big, then the round stacked over the
// pick ("Rd 1" / "#11") — or "Undrafted". dark: on a colored card — the
// team's dark-background logo, white type.
function DraftMark({ t, logos, dark = false, small = false }) {
  const team = logos[nflAbbrFromOrg(t.team)] || {};
  const logo = dark ? team.LogoDark || team.Logo1 : team.Logo1;
  const size = small ? 26 : 38;
  if (!t.round) return <span style={{ fontSize: small ? 11 : 12, fontWeight: 800, color: dark ? "rgba(255,255,255,0.7)" : "#8a94a6", fontFamily: BODY_FONT }}>{t.undrafted ? "Undrafted" : "—"}</span>;
  return (
    <span title={t.team || undefined} style={{ display: "inline-flex", alignItems: "center", gap: small ? 7 : 10, minWidth: 0 }}>
      <span style={{ width: size, height: size, flexShrink: 0, display: "grid", placeItems: "center" }}>
        {logo ? <img src={logo} alt={t.team || ""} loading="lazy" style={{ width: size, height: size, objectFit: "contain" }} /> : null}
      </span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, fontFamily: BODY_FONT, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        <span style={{ fontSize: small ? 10 : 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: dark ? "rgba(255,255,255,0.75)" : "#6b7685" }}>Rd {t.round}</span>
        {t.pick ? <span style={{ fontSize: small ? 14 : 17, fontWeight: 900, color: dark ? "#fff" : NAVY }}>#{t.pick}</span> : null}
      </span>
    </span>
  );
}

function Leaderboard({ ev, m, s, metrics, board, setBoard, brands, isMobile }) {
  // Keep the picked drill's chip in view (the row scrolls sideways on phones).
  const chips = useRef(null);
  useEffect(() => {
    const row = chips.current;
    const on = row?.querySelector("[aria-pressed='true']");
    if (row && on) row.scrollTo({ left: on.offsetLeft - row.clientWidth / 2 + on.offsetWidth / 2, behavior: "smooth" });
  }, [board]);
  const nflLogos = useNflLogos();
  const list = s?.top || [];
  const podium = list.slice(0, 3);
  const rest = list.slice(3);
  return (
    <>
      <DrillPicker ev={ev} metrics={metrics} board={board} setBoard={setBoard} chipsRef={chips} isMobile={isMobile} />

      <div style={{ ...card, overflow: "hidden" }}>
        {/* Title bar */}
        <div style={{ background: `linear-gradient(120deg, ${NAVY}, ${ev.color})`, color: "#fff", padding: isMobile ? "12px 14px" : "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="podium" size={20} stroke={2.2} style={{ color: GOLD }} />
          <span style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, textTransform: "uppercase", flex: 1, minWidth: 0 }}>{m.label}</span>
          <span style={{ ...kicker(GOLD), whiteSpace: "nowrap" }}>All-time top {list.length}</span>
        </div>

        {/* Podium: 1-2-3 left to right, each card in his school's colors */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: isMobile ? 8 : 12, padding: isMobile ? 10 : 16, background: "#f6f8fb" }}>
          {podium.map((t, i) => {
            const md = MEDAL[i];
            const brand = brands[t.school];
            const c = stageColor(brand?.Color1, brand?.Color2);
            const logo = brand?.LogoDark || brand?.Logo1;
            const medal = <span style={{ width: 30, height: 30, borderRadius: 999, background: md.bg, color: md.ink, display: "grid", placeItems: "center", fontSize: 14, fontWeight: 900, boxShadow: "0 2px 6px rgba(0,0,0,0.25)", flexShrink: 0 }}>{i + 1}</span>;
            const nameBlock = (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 900, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><PlayerName p={t} /></div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)", fontFamily: BODY_FONT, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.school ? <Link to={schoolHref(t.school)} style={{ color: "inherit", textDecoration: "none" }}>{t.school}</Link> : null} · {t.year}
                </div>
              </div>
            );
            const cardStyle = {
              borderRadius: 14, color: "#fff", background: `linear-gradient(160deg, ${c}, ${shade(c, 0.45)})`,
              border: i === 0 ? `2px solid ${GOLD}` : "2px solid transparent", boxShadow: "0 6px 16px rgba(0,30,70,0.14)",
            };
            // Phone: one row — medal, name and draft, the result.
            if (isMobile) {
              return (
                <div key={`${t.name}-${t.year}`} style={{ ...cardStyle, padding: "11px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                  {medal}
                  <div style={{ flex: 1, minWidth: 0 }}>{nameBlock}<div style={{ marginTop: 6 }}><DraftMark t={t} logos={nflLogos} dark small /></div></div>
                  <div style={{ fontSize: 26, fontWeight: 900, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(m.key, t.value)}</div>
                </div>
              );
            }
            // Desktop: two columns — medal, the result and his name on the left;
            // his school's logo and where he was drafted on the right.
            return (
              <div key={`${t.name}-${t.year}`} style={{ ...cardStyle, padding: "16px 16px 14px 18px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, minHeight: 168 }}>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0, gap: 8 }}>
                  {medal}
                  <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(m.key, t.value)}</div>
                  {nameBlock}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ width: 64, height: 64, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.1)", borderRadius: 14 }}>
                    {logo ? <img src={logo} alt="" style={{ width: 48, height: 48, objectFit: "contain" }} /> : null}
                  </span>
                  <DraftMark t={t} logos={nflLogos} dark />
                </div>
              </div>
            );
          })}
        </div>

        {/* 4 – 10 */}
        {rest.length > 0 && !isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: ROW_COLS, gap: 12, padding: "9px 18px", borderTop: "1px solid #e2e7ef", ...kicker("#5a6475") }}>
            <span>Rank</span><span>Player</span><span>Draft</span><span style={{ textAlign: "right" }}>{m.short}</span>
          </div>
        )}
        {rest.map((t, j) => {
          const i = j + 3;
          const logo = brands[t.school]?.Logo1;
          const player = (
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ width: 28, height: 28, flexShrink: 0, display: "grid", placeItems: "center" }}>
                {logo ? <img src={logo} alt="" loading="lazy" style={{ width: 28, height: 28, objectFit: "contain" }} /> : null}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "#1c2330", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><PlayerName p={t} /></span>
                <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.school ? <Link to={schoolHref(t.school)} style={{ color: "inherit", textDecoration: "none" }}>{t.school}</Link> : null}
                  {` · ${t.year}`}
                </span>
                {isMobile && <span style={{ display: "block", marginTop: 3 }}><DraftMark t={t} logos={nflLogos} small /></span>}
              </span>
            </span>
          );
          const result = <span style={{ fontSize: isMobile ? 17 : 19, fontWeight: 900, color: NAVY, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: "right" }}>{fmt(m.key, t.value)}</span>;
          return isMobile ? (
            <div key={`${t.name}-${t.year}`} style={{ display: "grid", gridTemplateColumns: "26px minmax(0, 1fr) auto", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: "1px solid #eef1f5" }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: "#8a94a6", textAlign: "center" }}>{i + 1}</span>
              {player}{result}
            </div>
          ) : (
            <div key={`${t.name}-${t.year}`} style={{ display: "grid", gridTemplateColumns: ROW_COLS, alignItems: "center", gap: 12, padding: "10px 18px", borderTop: "1px solid #eef1f5", background: j % 2 ? "#fafbfd" : "#fff" }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#8a94a6" }}>{i + 1}</span>
              {player}
              <DraftMark t={t} logos={nflLogos} />
              {result}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Best performers: the position's best all-around testers ──
// score = his percentile among the position in each drill he ran, averaged
// (utils/combineData.js combineProfiles → performers).
// Places 2–5: rank, school logo, name, school and class, where he was
// drafted, and his score; then everything he did as a stat line under it —
// measurements, a divider, then drills, top-10% marks in gold.
const BUILD_STATS = [["height", "Height"], ["weight", "Weight"], ["arm", "Arm"], ["hand", "Hand"]];
const DRILL_STATS = [["forty", "40"], ["vertical", "Vert"], ["broad", "Broad"], ["bench", "Bench"], ["threeCone", "3-Cone"], ["shuttle", "Shuttle"]];
function RunnerUp({ p, rank, first, logo, nflLogos, isMobile }) {
  const stat = ([k, label]) => {
    const x = p.build?.[k] || p.drills?.[k];
    if (!x) return null;
    const elite = x.pct != null && x.pct >= 90;
    return (
      <span key={k} title={x.pct != null ? `${ord(Math.round(x.pct))} percentile` : undefined} style={{ flex: isMobile ? undefined : "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0, padding: "6px 4px" }}>
        <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a94a6" }}>{label}</span>
        <span style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900, color: elite ? "#c47f0a" : NAVY, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", marginTop: 2 }}>
          {k === "weight" ? Math.round(x.value) : formatCombine(k, x.value)}
        </span>
      </span>
    );
  };
  const builds = BUILD_STATS.map(stat).filter(Boolean);
  const drills = DRILL_STATS.map(stat).filter(Boolean);
  const stats = (
    <div style={isMobile
      ? { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 2, marginTop: 10, background: "#f6f8fb", borderRadius: 10, padding: 4 }
      : { display: "flex", alignItems: "stretch", gap: 2, background: "#f6f8fb", borderRadius: 10, padding: "4px 6px", marginTop: 10 }}>
      {builds}
      {!isMobile && builds.length > 0 && drills.length > 0 && <span aria-hidden="true" style={{ width: 1, background: "#d8dee8", margin: "6px 4px" }} />}
      {drills}
    </div>
  );
  const who = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span style={{ width: 26, fontSize: 18, fontWeight: 900, color: "#a3afc0", textAlign: "center", flexShrink: 0 }}>{rank}</span>
      <span style={{ width: 36, height: 36, flexShrink: 0, display: "grid", placeItems: "center", background: "#fff", border: "1px solid #e6ebf2", borderRadius: 10 }}>
        {logo ? <img src={logo} alt="" loading="lazy" style={{ width: 26, height: 26, objectFit: "contain" }} /> : null}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: "#1c2330", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><PlayerName p={p} /></div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.school ? <Link to={schoolHref(p.school)} style={{ color: "inherit", textDecoration: "none" }}>{p.school}</Link> : null}{p.year ? ` · ${p.year}` : ""}
        </div>
      </div>
    </div>
  );
  const score = (
    <div style={{ textAlign: "right", flexShrink: 0 }}>
      <div style={{ fontSize: isMobile ? 20 : 22, fontWeight: 900, color: NAVY, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{p.score.toFixed(1)}</div>
      <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#a3afc0", marginTop: 3 }}>Score</div>
    </div>
  );
  return isMobile ? (
    <div style={{ padding: "12px", borderTop: first ? "none" : "1px solid #eef1f5" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>{who}</div>{score}
      </div>
      <div style={{ marginTop: 8, marginLeft: 36 }}><DraftMark t={p} logos={nflLogos} small /></div>
      {stats}
    </div>
  ) : (
    <div style={{ padding: "14px 18px", borderTop: first ? "none" : "1px solid #eef1f5" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 150px 70px", alignItems: "center", gap: 14 }}>
        {who}
        <DraftMark t={p} logos={nflLogos} />
        {score}
      </div>
      {stats}
    </div>
  );
}
// The graphic's width beside his card (desktop).
const CARD_W = 340;
function BestPerformers({ ev, pos, list, brands, isMobile, pool, span }) {
  const [top, ...rest] = list;
  // His graphic (Admin → Content → Combine), when one's made for him.
  const graphic = useCombineGraphic(pos, top, pool, span);
  const nflLogos = useNflLogos();
  const logo = brands[top.school]?.Logo1;
  return (
    <>
      <SectionHead icon="trophy" title="Best Performer" isMobile={isMobile} color={ev.color} />
      {/* His graphic and his card side by side (the card as tall as the graphic); 2–5 below, full width */}
      <div style={graphic ? { display: "grid", gridTemplateColumns: isMobile ? "1fr" : `${CARD_W}px minmax(0, 1fr)`, gap: isMobile ? 12 : 16, alignItems: "stretch" } : undefined}>
      {graphic && (
        <div style={{ width: "100%", maxWidth: isMobile ? 420 : CARD_W, margin: isMobile ? "0 auto" : 0 }}>
          <CombineGraphicCard graphic={graphic} name={top.name} width="100%" isMobile={isMobile} />
        </div>
      )}
      <div style={{ minWidth: 0, display: "flex" }}>
      <div style={{ ...card, flex: 1, display: "flex", flexDirection: "column", border: `2px solid ${GOLD}`, boxShadow: "0 10px 26px rgba(246,162,29,0.18)" }}>
        <div style={{
          display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto", gap: isMobile ? 12 : 20, alignItems: "center",
          padding: isMobile ? "14px" : "18px 22px", background: "linear-gradient(120deg, #fff8ea 0%, #fff 70%)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 16, minWidth: 0 }}>
            <span style={{ width: isMobile ? 54 : 68, height: isMobile ? 54 : 68, flexShrink: 0, borderRadius: 16, background: "#fff", border: "1px solid #f1e2c2", display: "grid", placeItems: "center" }}>
              {logo ? <img src={logo} alt="" style={{ width: "74%", height: "74%", objectFit: "contain" }} /> : <Icon name="trophy" size={30} style={{ color: GOLD }} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={kicker("#b06f00")}>Best all-around {pos} · {top.year}</div>
              <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, color: NAVY, lineHeight: 1.1, margin: "3px 0" }}><PlayerName p={top} /></div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT }}>
                {top.school ? <Link to={schoolHref(top.school)} style={{ color: "inherit", textDecoration: "none" }}>{top.school}</Link> : null}
                {top.round ? ` · Rd ${top.round}${top.pick ? `, #${top.pick}` : ""}` : top.undrafted ? " · Undrafted" : ""}{top.team ? ` · ${top.team}` : ""}
              </div>
            </div>
          </div>
          <div style={{ textAlign: isMobile ? "left" : "center", display: isMobile ? "flex" : "block", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontSize: isMobile ? 34 : 46, fontWeight: 900, color: "#b06f00", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{top.score.toFixed(1)}</div>
            <div style={kicker("#8a94a6")}>Combine score</div>
          </div>
        </div>
        {/* His measurements */}
        {Object.keys(top.build || {}).length > 0 && (
          <div style={{ flex: graphic && !isMobile ? 0.8 : undefined, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderTop: "1px solid #f1e2c2", background: "#fbfcfe" }}>
            {BUILD.map((b, i) => (
              <div key={b.key} style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: isMobile ? "9px 6px" : "10px", textAlign: "center", borderLeft: i ? "1px solid #eef1f5" : "none" }}>
                <div style={kicker()}>{b.label.replace(" Length", "").replace(" Size", "")}</div>
                <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 900, color: top.build[b.key] ? NAVY : "#c4ccd8", marginTop: 3, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {top.build[b.key] ? fmt(b.key, b.key === "weight" ? Math.round(top.build[b.key].value) : top.build[b.key].value) : "—"}
                </div>
                {top.build[b.key] && <div style={{ fontSize: 10, fontWeight: 800, color: top.build[b.key].pct >= 90 ? "#b06f00" : "#8a94a6", marginTop: 2, fontFamily: BODY_FONT }}>{ord(Math.round(top.build[b.key].pct))} pct</div>}
              </div>
            ))}
          </div>
        )}
        {/* His drills, each with where it ranks among the position */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(6, minmax(0, 1fr))", borderTop: "1px solid #f1e2c2" }}>
          {DRILLS.map((d, i) => {
            const x = top.drills[d.key];
            return (
              <div key={d.key} style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: isMobile ? "10px 8px" : "12px 10px", textAlign: "center", borderLeft: (isMobile ? i % 3 : i) ? "1px solid #eef1f5" : "none", borderTop: isMobile && i >= 3 ? "1px solid #eef1f5" : "none" }}>
                <div style={kicker()}>{d.short}</div>
                <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 900, color: x ? NAVY : "#c4ccd8", margin: "3px 0 6px", fontVariantNumeric: "tabular-nums" }}>{x ? formatCombine(d.key, x.value) : "—"}</div>
                {x ? (
                  <>
                    <div style={{ height: 6, borderRadius: 999, background: "#eef1f5", overflow: "hidden" }}>
                      <div style={{ width: `${x.pct}%`, height: "100%", borderRadius: 999, background: x.pct >= 90 ? `linear-gradient(90deg, ${ev.color}, ${GOLD})` : ev.color }} />
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: x.pct >= 90 ? "#b06f00" : "#8a94a6", marginTop: 4, fontFamily: BODY_FONT }}>{ord(Math.round(x.pct))} pct</div>
                  </>
                ) : <div style={{ fontSize: 10, fontWeight: 800, color: "#c4ccd8", fontFamily: BODY_FONT }}>Didn't run</div>}
              </div>
            );
          })}
        </div>
      </div>
      </div>
      </div>

      {rest.length > 0 && (
        <div style={{ ...card, marginTop: 12 }}>
          {rest.map((p, i) => <RunnerUp key={`${p.name}-${p.year}`} p={p} rank={i + 2} first={!i} logo={brands[p.school]?.Logo1} nflLogos={nflLogos} isMobile={isMobile} />)}
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, fontStyle: "italic", color: "#8a94a6", fontFamily: BODY_FONT }}>
        Combine score: his percentile among {plural(POSITION_NAMES[pos]).toLowerCase()} in each drill he ran and each measurement (bigger is better), averaged — three drills minimum, not counting bench. Gold marks a top-10% result at the position.
      </div>
    </>
  );
}
