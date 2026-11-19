// src/pages/MapPage.jsx
//
// Interactive 3D maps (deck.gl over the US states outline — no tiles):
//   /map          the maps directory
//   /map/draft    where NFL draftees come from — a heat glow plus a column
//                 per FBS school (height = draftees); click a school for its
//                 draft history: positions, rounds, years, top picks
//   /map/{team}   where a school's recruits come from — zoomed out, a column
//                 per recruiting area (metro); zoomed in, per high school
//                 (height = recruits, color = average stars); click a school
//                 for every recruit it sent
// Data: compSnapshots _mapDraft / _mapRecruits_{slug} (utils/mapData.js,
// built by scripts/buildMapSnapshots.mjs); team branding from _cfbTeams.
import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator } from "@deck.gl/core";
import { GeoJsonLayer, ColumnLayer, ArcLayer, IconLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { feature } from "topojson-client";
import usTopo from "us-atlas/states-10m.json";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { isUnreleasedSlug } from "../utils/prospectYears";
import { sanitizeImgur } from "../components/MarginAds";

const SITE = "https://we-draft.com";
const GOLD = "#f6a21d";
const BLUE = "#0055a5";
const BG = "#050d1f";
const BODY = "Arial, sans-serif";
const HEAD = "'Arial Black', Arial, sans-serif";
const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P"];
const STATES = feature(usTopo, usTopo.objects.states).features;
const STATE_NAME = Object.fromEntries(STATES.map((f) => [f.id, f.properties.name]));
const HOME_VIEW = (mobile) => ({ longitude: mobile ? -97 : -95.5, latitude: mobile ? 33 : 37.2, zoom: mobile ? 2.15 : 3.65, pitch: 48, bearing: -10 });

// ── helpers ──
const hexRgb = (h, fallback = [0, 85, 165]) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// Low → high: deep blue → teal → gold → orange-red.
const HEAT = [[29, 78, 216], [14, 165, 233], [250, 204, 21], [249, 115, 22], [220, 38, 38]];
const heat = (t) => {
  const x = Math.max(0, Math.min(1, t)) * (HEAT.length - 1);
  const i = Math.min(HEAT.length - 2, Math.floor(x));
  return mix(HEAT[i], HEAT[i + 1], x - i);
};
const loadDoc = (id) => getSiteSnapshot(id).catch(() => null);
const playerHref = (slug) => (slug && !isUnreleasedSlug(slug) ? `/player/${slug}` : "");
const teamHref = (school) => `/team/${String(school).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-")}`;

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 820);
  useEffect(() => { const f = () => setM(window.innerWidth < 820); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return m;
}
function useTeams() {
  const [teams, setTeams] = useState(null);
  useEffect(() => { getSiteSnapshot("_cfbTeams").then((s) => setTeams(s?.teams || {})).catch(() => setTeams({})); }, []);
  return teams;
}

export default function MapPage() {
  const { team } = useParams();
  if (!team) return <MapIndex />;
  if (team === "draft") return <DraftMap />;
  return <RecruitMap slug={team} />;
}

// ════════════════════════ shared shell ════════════════════════
function Shell({ isMobile, children, panel, overlay, legend, onReset, flat, setFlat, loading, empty }) {
  return (
    // Flush under the navbar: the body's top padding (80px) and the layout's
    // (25px) run past the navbar (62px, 66px on phones) — taken back here.
    <div style={{ position: "relative", marginTop: isMobile ? -39 : -38, height: isMobile ? "calc(100vh - 66px)" : "calc(100vh - 62px)", minHeight: 540, background: `radial-gradient(ellipse at 50% 35%, #0f2a5a 0%, ${BG} 70%)`, overflow: "hidden", fontFamily: HEAD }}>
      {children}
      {loading && <Center>Loading map…</Center>}
      {empty && <Center>{empty}</Center>}
      {/* Top-left: title, stats, filters */}
      <div style={{ position: "absolute", top: isMobile ? 10 : 18, left: isMobile ? 10 : 18, right: isMobile ? 10 : "auto", width: isMobile ? "auto" : 360, zIndex: 2, ...glass, padding: isMobile ? "12px 14px" : "16px 18px" }}>
        {overlay}
      </div>
      {/* Right: details (bottom sheet on phones) */}
      {panel && (
        <div style={{
          position: "absolute", zIndex: 2, ...glass, overflowY: "auto",
          ...(isMobile ? { left: 8, right: 8, bottom: 8, maxHeight: "42%", borderRadius: 18 } : { top: 18, right: 18, bottom: 18, width: 390 }),
        }}>{panel}</div>
      )}
      {/* Bottom-left: legend + view buttons */}
      {!isMobile && (
        <div style={{ position: "absolute", left: 18, bottom: 18, zIndex: 2, display: "flex", alignItems: "flex-end", gap: 10 }}>
          {legend && <div style={{ ...glass, padding: "10px 14px" }}>{legend}</div>}
          <div style={{ ...glass, padding: 6, display: "flex", gap: 4 }}>
            <IconBtn onClick={onReset} title="Reset view">⟲</IconBtn>
            <IconBtn onClick={() => setFlat(!flat)} title={flat ? "3D view" : "Flat view"}>{flat ? "3D" : "2D"}</IconBtn>
          </div>
        </div>
      )}
      {!isMobile && (
        <div style={{ position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 1, color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 700, fontFamily: BODY, pointerEvents: "none", whiteSpace: "nowrap" }}>
          Drag to move · Scroll to zoom · Right-drag or Ctrl-drag to tilt and turn
        </div>
      )}
    </div>
  );
}
const glass = { background: "rgba(8, 20, 46, 0.82)", border: "1px solid rgba(120, 160, 230, 0.22)", borderRadius: 16, boxShadow: "0 18px 40px rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", color: "#e8eefb" };
const Center = ({ children }) => <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.7)", fontWeight: 800, fontFamily: BODY, zIndex: 1, pointerEvents: "none" }}>{children}</div>;
const IconBtn = ({ children, ...p }) => <button type="button" {...p} style={{ width: 38, height: 34, borderRadius: 10, border: "none", background: "rgba(255,255,255,0.08)", color: "#fff", fontWeight: 900, fontSize: 13, cursor: "pointer" }}>{children}</button>;
const Kicker = ({ children, color = GOLD }) => <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color }}>{children}</div>;
const Crumbs = ({ here }) => (
  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
    <Link to="/map" style={{ color: GOLD, textDecoration: "none" }}>Maps</Link> › {here}
  </div>
);
function Chips({ options, value, onChange, accent = GOLD }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
      {options.map(([k, label]) => (
        <button key={k || "all"} type="button" onClick={() => onChange(k)} style={{
          border: "none", borderRadius: 999, padding: "5px 10px", fontSize: 11, fontWeight: 900, cursor: "pointer", fontFamily: HEAD,
          background: value === k ? accent : "rgba(255,255,255,0.08)", color: value === k ? "#0b1530" : "rgba(255,255,255,0.8)",
        }}>{label}</button>
      ))}
    </div>
  );
}
const Stat = ({ label, value, accent = "#fff" }) => (
  <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
    <div style={{ fontSize: 22, fontWeight: 900, color: accent, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", marginTop: 5 }}>{label}</div>
  </div>
);
const H = ({ children }) => <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", margin: "18px 0 8px" }}>{children}</div>;
function Bars({ rows, color, onClick }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {rows.map((r) => (
        <div key={r.k} onClick={onClick ? () => onClick(r.k) : undefined} style={{ display: "flex", alignItems: "center", gap: 8, cursor: onClick ? "pointer" : "default" }}>
          <span style={{ width: 132, flexShrink: 0, fontSize: 12, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
          <span style={{ flex: 1, height: 10, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(r.n / max) * 100}%`, background: color, borderRadius: 999 }} />
          </span>
          <span style={{ width: 30, textAlign: "right", fontSize: 12, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{r.n}</span>
        </div>
      ))}
    </div>
  );
}
function Legend({ title, lo, hi }) {
  return (
    <div style={{ minWidth: 170 }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", marginBottom: 6 }}>{title}</div>
      <div style={{ height: 8, borderRadius: 999, background: `linear-gradient(90deg, ${HEAT.map((c) => `rgb(${c.join(",")})`).join(", ")})` }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.6)", marginTop: 4, fontFamily: BODY }}><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
}
const stars = (n) => "★".repeat(n || 0);
const Logo = ({ src, size = 36 }) => (src ? <img src={src} alt="" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} /> : <span style={{ width: size, flexShrink: 0 }} />);

function useView(isMobile) {
  const [view, setView] = useState(() => HOME_VIEW(isMobile));
  const fly = useCallback((v) => setView((cur) => ({ ...cur, ...v, transitionDuration: 1100, transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }) })), []);
  const reset = useCallback(() => fly(HOME_VIEW(isMobile)), [fly, isMobile]);
  return { view, setView, fly, reset };
}
const statesLayer = (id, props = {}) => new GeoJsonLayer({
  id, data: STATES, stroked: true, filled: true, lineWidthMinPixels: 1,
  getFillColor: [16, 38, 78, 255], getLineColor: [60, 100, 170, 160], ...props,
});

// ════════════════════════ /map/draft ════════════════════════
function DraftMap() {
  const isMobile = useIsMobile();
  const [doc, setDoc] = useState(undefined);
  const [pos, setPos] = useState("");
  const [conf, setConf] = useState("");
  const [sel, setSel] = useState(null);
  const [flat, setFlat] = useState(false);
  const { view, setView, fly, reset } = useView(isMobile);
  useEffect(() => { loadDoc("_mapDraft").then(setDoc); }, []);

  const countOf = useCallback((s) => (pos ? s.pos?.[pos] || 0 : s.n), [pos]);
  const schools = useMemo(() => (doc?.schools || []).filter((s) => !conf || s.cf === conf), [doc, conf]);
  const max = Math.max(1, ...schools.map(countOf));
  const ranked = useMemo(() => [...schools].sort((a, b) => countOf(b) - countOf(a)), [schools, countOf]);
  const school = sel ? (doc?.schools || []).find((s) => s.k === sel) : null;
  const confs = [...new Set((doc?.schools || []).map((s) => s.cf))].sort();
  const pick = (k) => {
    const s = (doc?.schools || []).find((x) => x.k === k);
    setSel(k);
    if (s) fly({ longitude: s.lng, latitude: s.lat - (isMobile ? 1.6 : 0.4), zoom: isMobile ? 4.6 : 5.4, pitch: flat ? 0 : 55 });
  };

  const layers = [
    statesLayer("states"),
    new HeatmapLayer({ id: "glow", data: schools.filter((s) => countOf(s) > 0), getPosition: (s) => [s.lng, s.lat], getWeight: (s) => countOf(s), radiusPixels: isMobile ? 40 : 70, intensity: 1.2, threshold: 0.04, colorRange: HEAT.map((c, i) => [...c, 60 + i * 35]), updateTriggers: { getWeight: [pos] } }),
    new ColumnLayer({
      id: "columns", data: schools, diskResolution: 28, radius: isMobile ? 18000 : 15000, extruded: true, pickable: true, autoHighlight: true,
      highlightColor: [255, 255, 255, 90], elevationScale: flat ? 0 : 1, getPosition: (s) => [s.lng, s.lat],
      getElevation: (s) => (countOf(s) / max) * 420000 + 6000,
      getFillColor: (s) => (s.k === sel ? [255, 255, 255, 255] : [...heat(countOf(s) / max), 235]),
      material: { ambient: 0.55, diffuse: 0.6, shininess: 40 },
      onClick: ({ object }) => object && pick(object.k),
      transitions: { getElevation: 500, elevationScale: 500 },
      updateTriggers: { getElevation: [pos, max], getFillColor: [pos, max, sel] },
    }),
  ];

  const total = schools.reduce((a, s) => a + countOf(s), 0);
  const title = "NFL Draft Map: Where Draft Picks Come From";
  const description = `Every NFL draft pick since ${doc?.from || 2000}, mapped to his FBS school in 3D — click any school for its draft history, top picks and position breakdown.`;
  return (
    <>
      <Meta title={title} description={description} path="/map/draft" />
      <Shell isMobile={isMobile} onReset={reset} flat={flat} setFlat={(f) => { setFlat(f); fly({ pitch: f ? 0 : 48 }); }}
        loading={doc === undefined} empty={doc === null ? "The draft map is being built." : null}
        legend={<Legend title={`Draftees${pos ? ` · ${pos}` : ""}`} lo="Fewer" hi={`${max}`} />}
        overlay={
          <>
            <Crumbs here="NFL Draft" />
            <h1 style={{ margin: 0, fontSize: isMobile ? 19 : 24, lineHeight: 1.05, color: "#fff", textTransform: "uppercase" }}>Where Draft Picks Come From</h1>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", fontFamily: BODY, marginTop: 6 }}>
              {doc ? `${total.toLocaleString()} ${pos || ""} picks · ${schools.filter((s) => countOf(s)).length} FBS schools · ${doc.from}–${doc.to}` : "Every FBS school's NFL draftees"}
            </div>
            {!isMobile && (
              <>
                <H>Position</H>
                <Chips options={[["", "All"], ...POSITIONS.map((p) => [p, p])]} value={pos} onChange={setPos} />
                <H>Conference</H>
                <Chips options={[["", "All"], ...confs.map((c) => [c, c])]} value={conf} onChange={setConf} />
              </>
            )}
            {isMobile && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <MiniSelect value={pos} onChange={setPos} options={[["", "All positions"], ...POSITIONS.map((p) => [p, p])]} />
                <MiniSelect value={conf} onChange={setConf} options={[["", "All conferences"], ...confs.map((c) => [c, c])]} />
              </div>
            )}
          </>
        }
        panel={doc ? (school ? <SchoolPanel s={school} pos={pos} onBack={() => { setSel(null); reset(); }} isMobile={isMobile} /> : (
          <div style={{ padding: isMobile ? 14 : 18 }}>
            <Kicker>Leaderboard</Kicker>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", marginTop: 4 }}>Most {pos ? `${pos} ` : ""}Draftees</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.6)", fontFamily: BODY, marginTop: 2 }}>{doc.from}–{doc.to}{conf ? ` · ${conf}` : ""} · tap a school</div>
            <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
              {ranked.slice(0, isMobile ? 10 : 25).map((s, i) => (
                <button key={s.k} type="button" onClick={() => pick(s.k)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 10, border: "none", background: i < 3 ? "rgba(246,162,29,0.1)" : "transparent", color: "#fff", cursor: "pointer", textAlign: "left", fontFamily: HEAD }}>
                  <span style={{ width: 20, fontSize: 12, fontWeight: 900, color: i < 3 ? GOLD : "rgba(255,255,255,0.5)" }}>{i + 1}</span>
                  <Logo src={s.ld || s.l} size={26} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.s}</span>
                  <span style={{ fontSize: 14, fontWeight: 900, color: `rgb(${heat(countOf(s) / max).join(",")})` }}>{countOf(s)}</span>
                </button>
              ))}
            </div>
          </div>
        )) : null}
      >
        <DeckGL viewState={view} onViewStateChange={({ viewState }) => setView(viewState)} controller={{ dragRotate: true, touchRotate: true }} layers={layers}
          getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
          getTooltip={({ object }) => object && object.s && { html: `<b>${object.s}</b><br/>${countOf(object)} ${pos || ""} draftees${object.r1 && !pos ? ` · ${object.r1} first-rounders` : ""}`, style: tipStyle }} />
      </Shell>
    </>
  );
}
const tipStyle = { background: "rgba(8,20,46,0.95)", color: "#fff", borderRadius: "10px", padding: "8px 10px", fontFamily: BODY, fontSize: "12px", border: "1px solid rgba(120,160,230,0.3)" };
const MiniSelect = ({ value, onChange, options }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "6px 8px", fontSize: 12, fontWeight: 800 }}>
    {options.map(([k, l]) => <option key={k} value={k} style={{ color: "#000" }}>{l}</option>)}
  </select>
);

function SchoolPanel({ s, pos, onBack, isMobile }) {
  const c1 = /^#?[0-9a-f]{6}$/i.test(s.c1 || "") ? s.c1 : BLUE;
  const years = Object.keys(s.yr || {}).map(Number);
  const allYears = [];
  for (let y = Math.min(...years, 2000); y <= Math.max(...years, 2026); y++) allYears.push(y);
  const peak = Math.max(1, ...allYears.map((y) => s.yr?.[y] || 0));
  const best = allYears.reduce((b, y) => ((s.yr?.[y] || 0) > (s.yr?.[b] || 0) ? y : b), allYears[0]);
  const posRows = Object.entries(s.pos || {}).map(([k, n]) => ({ k, n, label: k })).sort((a, b) => b.n - a.n);
  return (
    <div>
      <div style={{ position: "relative", padding: isMobile ? "14px" : "18px", background: `linear-gradient(135deg, ${c1}, ${c1}aa 60%, rgba(8,20,46,0.2))`, borderRadius: "16px 16px 0 0" }}>
        <button type="button" onClick={onBack} style={{ position: "absolute", top: 10, right: 10, border: "none", background: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 999, width: 30, height: 30, cursor: "pointer", fontWeight: 900 }}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo src={s.ld || s.l} size={isMobile ? 48 : 60} />
          <div>
            <Kicker color="rgba(255,255,255,0.8)">{s.cf}</Kicker>
            <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: "#fff", lineHeight: 1.05 }}>{s.s}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <Link to={teamHref(s.s)} style={pillLink}>Team page →</Link>
          <Link to={`/map/${s.k}`} style={pillLink}>Recruiting map →</Link>
        </div>
      </div>
      <div style={{ padding: isMobile ? "12px 14px 16px" : "14px 18px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          <Stat label={pos ? `${pos} picks` : "Draftees"} value={pos ? s.pos?.[pos] || 0 : s.n} accent={GOLD} />
          <Stat label="1st round" value={s.r1} />
          <Stat label={`Best (${best})`} value={s.yr?.[best] || 0} />
        </div>
        <H>Picks by year</H>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56 }}>
          {allYears.map((y) => (
            <div key={y} title={`${y}: ${s.yr?.[y] || 0}`} style={{ flex: 1, height: `${((s.yr?.[y] || 0) / peak) * 100}%`, minHeight: 2, background: y === best ? GOLD : `rgb(${heat((s.yr?.[y] || 0) / peak).join(",")})`, borderRadius: 2, opacity: s.yr?.[y] ? 1 : 0.25 }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.5)", marginTop: 3, fontFamily: BODY }}><span>{allYears[0]}</span><span>{allYears[allYears.length - 1]}</span></div>
        <H>By position</H>
        <Bars rows={posRows} color={`linear-gradient(90deg, ${c1}, ${GOLD})`} />
        <H>By round</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {(s.rd || []).map((n, i) => (
            <div key={i} style={{ textAlign: "center", background: i === 0 ? "rgba(246,162,29,0.16)" : "rgba(255,255,255,0.05)", borderRadius: 8, padding: "6px 0" }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: i === 0 ? GOLD : "#fff" }}>{n}</div>
              <div style={{ fontSize: 9, fontWeight: 900, color: "rgba(255,255,255,0.5)" }}>RD {i + 1}</div>
            </div>
          ))}
        </div>
        <H>Top picks</H>
        <div style={{ display: "grid", gap: 2 }}>
          {(s.top || []).map((t, i) => {
            const href = playerHref(t.sl);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                <span style={{ width: 44, flexShrink: 0, textAlign: "center", fontSize: 11, fontWeight: 900, color: t.r === 1 ? "#0b1530" : "#fff", background: t.r === 1 ? GOLD : "rgba(255,255,255,0.08)", borderRadius: 6, padding: "3px 0" }}>{t.r === 1 ? `#${t.k}` : `R${t.r}`}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {href ? <Link to={href} style={{ color: "#fff", textDecoration: "none" }}>{t.n}</Link> : t.n} <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{t.p}</span>
                  </span>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", fontFamily: BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.y} · {t.t}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
const pillLink = { padding: "6px 12px", borderRadius: 999, background: "rgba(0,0,0,0.28)", color: "#fff", fontSize: 11, fontWeight: 900, textDecoration: "none", letterSpacing: "0.03em" };

// Recruiting areas are named for the metro they sit in: a high school joins
// the nearest of these within 90 km (else its own area, named for its town).
const METROS = [
  ["South Florida", 25.95, -80.2], ["Palm Beach", 26.72, -80.07], ["Tampa Bay", 27.95, -82.46], ["Sarasota–Bradenton", 27.4, -82.55], ["Orlando", 28.54, -81.38],
  ["Jacksonville", 30.33, -81.66], ["Tallahassee", 30.44, -84.28], ["Gainesville", 29.65, -82.32], ["Daytona Beach", 29.21, -81.02], ["Fort Myers", 26.64, -81.87],
  ["Pensacola", 30.42, -87.22], ["Lakeland–Polk County", 28.04, -81.95], ["Atlanta", 33.75, -84.39], ["Savannah", 32.08, -81.09], ["Macon", 32.84, -83.63],
  ["Augusta", 33.47, -81.97], ["Valdosta–South Georgia", 30.83, -83.28], ["Columbus, GA", 32.46, -84.99], ["Houston", 29.76, -95.37], ["Dallas–Fort Worth", 32.8, -96.95],
  ["San Antonio", 29.42, -98.49], ["Austin", 30.27, -97.74], ["East Texas", 32.35, -95.3], ["Corpus Christi", 27.8, -97.4], ["Lubbock", 33.58, -101.86],
  ["El Paso", 31.76, -106.49], ["New Orleans", 29.95, -90.07], ["Baton Rouge", 30.45, -91.19], ["Lafayette, LA", 30.22, -92.02], ["Shreveport", 32.52, -93.75],
  ["Birmingham", 33.52, -86.8], ["Mobile", 30.69, -88.04], ["Montgomery", 32.38, -86.3], ["Huntsville", 34.73, -86.59], ["Jackson, MS", 32.3, -90.18],
  ["Memphis", 35.15, -90.05], ["Nashville", 36.16, -86.78], ["Knoxville", 35.96, -83.92], ["Chattanooga", 35.05, -85.31], ["Charlotte", 35.23, -80.84],
  ["Raleigh–Durham", 35.9, -78.8], ["Greensboro", 36.07, -79.79], ["Columbia, SC", 34.0, -81.03], ["Charleston", 32.78, -79.93], ["Greenville–Spartanburg", 34.9, -82.2],
  ["Washington, D.C.", 38.95, -77.03], ["Baltimore", 39.29, -76.61], ["Richmond", 37.54, -77.44], ["Hampton Roads", 36.85, -76.29], ["Philadelphia", 39.95, -75.17],
  ["New York–North Jersey", 40.8, -74.1], ["Pittsburgh", 40.44, -79.99], ["Cleveland–Akron", 41.35, -81.6], ["Columbus", 39.96, -83.0], ["Cincinnati", 39.1, -84.51],
  ["Dayton", 39.76, -84.19], ["Toledo", 41.65, -83.54], ["Youngstown", 41.1, -80.65], ["Detroit", 42.4, -83.1], ["Chicago", 41.85, -87.75],
  ["Indianapolis", 39.77, -86.16], ["Louisville", 38.25, -85.76], ["Lexington", 38.04, -84.5], ["St. Louis", 38.63, -90.2], ["Kansas City", 39.05, -94.6],
  ["Oklahoma City", 35.47, -97.52], ["Tulsa", 36.15, -95.99], ["Little Rock", 34.75, -92.29], ["Omaha", 41.26, -95.93], ["Minneapolis", 44.98, -93.27],
  ["Milwaukee", 43.04, -87.91], ["Buffalo", 42.89, -78.88], ["Boston", 42.36, -71.06], ["Denver", 39.74, -104.99], ["Phoenix", 33.45, -112.07],
  ["Las Vegas", 36.17, -115.14], ["Salt Lake City", 40.76, -111.89], ["Los Angeles", 33.95, -118.1], ["Inland Empire", 34.0, -117.35], ["San Diego", 32.8, -117.1],
  ["Bay Area", 37.65, -122.15], ["Sacramento", 38.58, -121.49], ["Fresno", 36.74, -119.79], ["Seattle", 47.55, -122.3], ["Portland", 45.52, -122.68],
  ["Honolulu", 21.35, -157.9], ["Tucson", 32.22, -110.97], ["Albuquerque", 35.08, -106.65], ["Boise", 43.62, -116.2], ["Wichita", 37.69, -97.34],
];
const kmBetween = (a, b) => {
  const dy = (a.lat - b.lat) * 111, dx = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
};

// ════════════════════════ /map/{team} ════════════════════════
const RANGES = [["all", "All classes"], ["10", "Last 10"], ["5", "Last 5"], ["1", "Latest"]];
// A recruit's high school: name + city + state (the same name turns up in many towns).
const hsKey = (r) => `${r.h || "?"}|${r.c || ""}|${r.st || ""}`;

function RecruitMap({ slug }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const teams = useTeams();
  const [doc, setDoc] = useState(undefined);
  const [range, setRange] = useState("all");
  const [sel, setSel] = useState(null);
  const [flat, setFlat] = useState(false);
  const { view, setView, fly, reset } = useView(isMobile);
  useEffect(() => { setDoc(undefined); setSel(null); loadDoc(`_mapRecruits_${slug}`).then(setDoc); }, [slug]);
  // The campus (the arcs' end, the logo pin) — from the draft map's school list.
  const [campusAt, setCampusAt] = useState(null);
  useEffect(() => { loadDoc("_mapDraft").then((d) => { const s = d?.schools?.find((x) => x.k === slug); setCampusAt(s ? [s.lng, s.lat] : null); }); }, [slug]);

  const team = teams?.[slug];
  const c1 = hexRgb(team?.Color1);
  // Accent: the second color — unless it's a gray (Ohio State) or near-black, then a lighter primary.
  const rawC2 = hexRgb(team?.Color2, [246, 162, 29]);
  const dull = Math.max(...rawC2) - Math.min(...rawC2) < 40 || rawC2.reduce((x, y) => x + y, 0) < 200;
  const c2 = dull ? mix(c1, [255, 255, 255], 0.3) : rawC2;
  const accent = `rgb(${c2.join(",")})`;
  const latest = doc?.to || 0;
  const rows = useMemo(() => (doc?.rows || []).filter((r) => range === "all" || r.y > latest - Number(range)), [doc, range, latest]);

  // High schools: their recruits, the spot (the hometowns' average), the best recruit.
  const schools = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      const k = hsKey(r);
      const h = (m[k] = m[k] || { k, name: r.h || "Unknown", city: r.c, st: r.st, f: r.f, list: [], la: 0, lo: 0, pts: 0, best: null });
      h.list.push(r);
      if (r.la != null) { h.la += r.la; h.lo += r.lo; h.pts += 1; }
      if (!h.best || r.r > h.best.r) h.best = r;
    });
    return Object.values(m).filter((h) => h.pts).map((h) => ({
      ...h, lat: h.la / h.pts, lng: h.lo / h.pts, n: h.list.length,
      stars: h.list.reduce((x, r) => x + (r.s || 0), 0) / h.list.length,
    })).sort((x, y) => y.n - x.n || y.best.r - x.best.r);
  }, [rows]);
  const maxN = Math.max(1, ...schools.map((h) => h.n));
  // Recruiting areas: each high school joins the nearest metro within 90 km
  // (METROS); the rest group around their biggest school (80 km). The
  // national view shows these instead of a pile of single schools.
  const regions = useMemo(() => {
    const groups = {};
    const loose = [];
    schools.forEach((h) => {
      let best = null, bestKm = 90;
      METROS.forEach(([name, lat, lng]) => { const d = kmBetween({ lat, lng }, h); if (d < bestKm) { best = name; bestKm = d; } });
      if (best) (groups[best] = groups[best] || { name: best, members: [] }).members.push(h);
      else loose.push(h);
    });
    const extra = [];
    loose.forEach((h) => {
      const r = extra.find((x) => kmBetween(x.anchor, h) < 80);
      if (r) r.members.push(h); else extra.push({ anchor: h, name: `${h.city || h.name}${h.st ? `, ${h.st}` : ""}`, members: [h] });
    });
    return [...Object.values(groups), ...extra].map((r, i) => {
      const n = r.members.reduce((x, h) => x + h.n, 0);
      const list = r.members.flatMap((h) => h.list);
      return {
        k: `r${i}`, name: r.name, n, list, schools: r.members,
        lat: r.members.reduce((x, h) => x + h.lat * h.n, 0) / n, lng: r.members.reduce((x, h) => x + h.lng * h.n, 0) / n,
        stars: list.reduce((x, rr) => x + (rr.s || 0), 0) / list.length,
        best: list.reduce((b, rr) => (!b || rr.r > b.r ? rr : b), null),
      };
    }).sort((x, y) => y.n - x.n);
  }, [schools]);
  const maxR = Math.max(1, ...regions.map((r) => r.n));
  // Zoomed out: the areas. Zoomed in (or a school picked): the high schools.
  const showRegions = !sel && view.zoom < 5.2;
  const school = sel ? schools.find((h) => h.k === sel) : null;
  const byState = useMemo(() => {
    const m = {};
    rows.forEach((r) => { if (r.f) (m[r.f] = m[r.f] || []).push(r); });
    return m;
  }, [rows]);

  const pickSchool = (k) => {
    const h = schools.find((x) => x.k === k);
    setSel(k);
    if (h) fly({ longitude: h.lng, latitude: h.lat - (isMobile ? 1.1 : 0.25), zoom: isMobile ? 5.3 : 6, pitch: flat ? 0 : 50 });
  };
  const flyToRegion = (r) => fly({ longitude: r.lng, latitude: r.lat - (isMobile ? 0.9 : 0.2), zoom: isMobile ? 5.8 : 6.4, pitch: flat ? 0 : 50 });
  const flyToState = (f) => {
    const pts = (byState[f] || []).filter((r) => r.la != null);
    if (!pts.length) return;
    setSel(null);
    fly({ longitude: pts.reduce((x, r) => x + r.lo, 0) / pts.length, latitude: pts.reduce((x, r) => x + r.la, 0) / pts.length - (isMobile ? 2 : 0.5), zoom: isMobile ? 4.4 : 5.4, pitch: flat ? 0 : 50 });
  };
  // Columns: height by recruits (a square root, so one pipeline doesn't flatten the rest), color by average stars.
  const height = (h) => Math.sqrt(h.n / maxN) * 180000 + 4000;
  const starColor = (st) => heat(Math.max(0, Math.min(1, (st - 2.6) / 2.2)));

  const arcs = (school ? school.list : rows.filter((r) => r.s >= 4)).filter((r) => r.la != null && campusAt);
  const layers = [
    statesLayer("states"),
    new HeatmapLayer({ id: "glow", data: schools, getPosition: (h) => [h.lng, h.lat], getWeight: (h) => h.n, radiusPixels: isMobile ? 30 : 45, intensity: 1, threshold: 0.05,
      colorRange: [[...c1, 0], [...c1, 70], [...mix(c1, c2, 0.5), 110], [...c2, 150], [...mix(c2, [255, 255, 255], 0.3), 190], [255, 255, 255, 210]], updateTriggers: { colorRange: [slug, team?.Color1] } }),
    new ColumnLayer({
      id: "regions", data: regions, visible: showRegions, diskResolution: 36, radius: isMobile ? 52000 : 44000, extruded: true, pickable: true, autoHighlight: true,
      highlightColor: [255, 255, 255, 110], elevationScale: flat ? 0 : 1, getPosition: (r) => [r.lng, r.lat],
      getElevation: (r) => Math.sqrt(r.n / maxR) * 520000 + 10000,
      getFillColor: (r) => [...starColor(r.stars), 240],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 40 },
      onClick: ({ object }) => object && flyToRegion(object),
      transitions: { getElevation: 500, elevationScale: 500 },
      updateTriggers: { getElevation: [rows], getFillColor: [rows] },
    }),
    new ColumnLayer({
      id: "schools", data: schools, visible: !showRegions, diskResolution: 20, radius: isMobile ? 9000 : 6500, extruded: true, pickable: true, autoHighlight: true,
      highlightColor: [255, 255, 255, 110], elevationScale: flat ? 0 : 1, getPosition: (h) => [h.lng, h.lat], getElevation: height,
      getFillColor: (h) => (h.k === sel ? [255, 255, 255, 255] : [...starColor(h.stars), 235]),
      material: { ambient: 0.55, diffuse: 0.6, shininess: 40 },
      onClick: ({ object }) => object && pickSchool(object.k),
      transitions: { getElevation: 500, elevationScale: 500 },
      updateTriggers: { getElevation: [rows], getFillColor: [rows, sel] },
    }),
    new ArcLayer({
      id: "arcs", data: arcs, getSourcePosition: (r) => [r.lo, r.la, 0], getTargetPosition: () => [...campusAt, 0],
      getSourceColor: [...c2, school ? 255 : 170], getTargetColor: [255, 255, 255, 220], getWidth: (r) => (school ? 2.5 : r.s >= 5 ? 2.2 : 1.2), getHeight: 0.5,
      updateTriggers: { getSourceColor: [team?.Color2, sel], getWidth: [sel] },
    }),
    ...(campusAt && team?.Logo1 ? [new IconLayer({
      id: "campus", data: [{ p: campusAt }], getPosition: (d) => [...d.p, 0], getIcon: () => ({ url: sanitizeImgur(team.Logo1 || team.LogoDark) || team.Logo1 || team.LogoDark, width: 128, height: 128, anchorY: 128 }),
      getSize: isMobile ? 34 : 46, sizeUnits: "pixels", billboard: true,
    })] : []),
  ];

  const name = team?.School || doc?.s || slug;
  const avgStars = rows.length ? rows.reduce((x, r) => x + (r.s || 0), 0) / rows.length : 0;
  const stateRank = Object.entries(byState).map(([f, l]) => ({ k: f, n: l.length, label: STATE_NAME[f] || f })).sort((x, y) => y.n - x.n);
  const homeState = stateRank[0]?.k;
  const title = `${name} Recruiting Map: Where ${name} Recruits Come From`;
  const description = `Every ${name} high school recruit${doc ? ` since ${doc.from}` : ""} on an interactive 3D map — the high schools they came from, star ratings and NFL draft picks.`;
  const teamOptions = useMemo(() => Object.entries(teams || {}).map(([k, t]) => [k, t.School]).sort((x, y) => x[1].localeCompare(y[1])), [teams]);

  return (
    <>
      <Meta title={title} description={description} path={`/map/${slug}`} />
      <Shell isMobile={isMobile} onReset={() => { setSel(null); reset(); }} flat={flat} setFlat={(f) => { setFlat(f); fly({ pitch: f ? 0 : 48 }); }}
        loading={doc === undefined} empty={doc === null ? (teams && !team ? "We don't have a recruiting map for that school." : "This recruiting map is being built.") : null}
        legend={<div style={{ minWidth: 200 }}>
          <Legend title="Average stars" lo="3★" hi="5★" />
          <div style={{ fontFamily: BODY, fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.6)", marginTop: 6 }}>{showRegions ? "Each column = a recruiting area · zoom in for high schools" : "Each column = a high school · taller = more recruits"}</div>
        </div>}
        overlay={
          <>
            <Crumbs here="Recruiting" />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Logo src={team?.LogoDark || team?.Logo1} size={isMobile ? 40 : 52} />
              <div style={{ minWidth: 0 }}>
                <Kicker color={accent}>Recruiting Map</Kicker>
                <h1 style={{ margin: 0, fontSize: isMobile ? 18 : 22, lineHeight: 1.05, color: "#fff", textTransform: "uppercase" }}>Where {name} Recruits Come From</h1>
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", fontFamily: BODY, marginTop: 8 }}>
              {doc ? `${rows.length} recruits · ${schools.length} high schools · ${regions.length} areas · ${range === "all" ? `${doc.from}–${doc.to}` : range === "1" ? `${latest} class` : `${latest - Number(range) + 1}–${latest}`}` : ""}
            </div>
            <div style={{ marginTop: 10 }}><Chips options={RANGES} value={range} onChange={(r) => { setRange(r); setSel(null); }} accent={accent} /></div>
            <div style={{ marginTop: 10 }}>
              <MiniSelect value={slug} onChange={(k) => navigate(`/map/${k}`)} options={teamOptions.length ? teamOptions : [[slug, name]]} />
            </div>
          </>
        }
        panel={doc ? (school ? (
          <HighSchoolPanel h={school} total={rows.length} accent={accent} c1={team?.Color1} onBack={() => { setSel(null); reset(); }} isMobile={isMobile} />
        ) : (
          <div style={{ padding: isMobile ? 14 : 18 }}>
            <Kicker color={accent}>{range === "all" ? `${doc.from}–${doc.to}` : range === "1" ? `${latest} class` : `Last ${range} classes`}</Kicker>
            <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", marginTop: 4 }}>{name} Recruiting</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 12 }}>
              <Stat label="Recruits" value={rows.length} accent={accent} />
              <Stat label="Avg stars" value={avgStars.toFixed(2)} />
              <Stat label="Drafted" value={rows.filter((r) => r.d).length} />
              <Stat label="5-stars" value={rows.filter((r) => r.s >= 5).length} accent="#ffd600" />
              <Stat label="4-stars" value={rows.filter((r) => r.s === 4).length} />
              <Stat label={homeState && STATE_NAME[homeState] ? `From ${STATE_NAME[homeState].slice(0, 10)}` : "Top state"} value={rows.length && homeState ? `${Math.round(((byState[homeState]?.length || 0) / rows.length) * 100)}%` : "—"} />
            </div>
            <H>Top recruiting areas · tap one</H>
            <Bars rows={regions.slice(0, 10).map((r) => ({ k: r.k, n: r.n, label: r.name }))} color={`linear-gradient(90deg, rgb(${c1.join(",")}), ${accent})`}
              onClick={(k) => { const r = regions.find((x) => x.k === k); if (r) flyToRegion(r); }} />
            <H>Top high schools · tap one</H>
            <div style={{ display: "grid", gap: 2 }}>
              {schools.slice(0, 8).map((h, i) => (
                <button key={h.k} type="button" onClick={() => pickSchool(h.k)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", border: "none", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none", background: "transparent", color: "#fff", cursor: "pointer", textAlign: "left", fontFamily: HEAD }}>
                  <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, display: "grid", placeItems: "center", background: i < 3 ? accent : "rgba(255,255,255,0.08)", color: i < 3 ? "#0b1530" : "#fff", fontSize: 12, fontWeight: 900 }}>{h.n}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</span>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", fontFamily: BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[h.city, h.st].filter(Boolean).join(", ")} · best: {h.best.n}</span>
                  </span>
                </button>
              ))}
            </div>
            <H>Top states</H>
            <Bars rows={stateRank.slice(0, 6)} color={`linear-gradient(90deg, rgb(${c1.join(",")}), ${accent})`} onClick={flyToState} />
            <H>Top recruits</H>
            <RecruitList list={[...rows].sort((x, y) => y.r - x.r).slice(0, 12)} accent={accent} />
          </div>
        )) : null}
      >
        <DeckGL viewState={view} onViewStateChange={({ viewState }) => setView(viewState)} controller={{ dragRotate: true, touchRotate: true }} layers={layers}
          getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
          getTooltip={({ object, layer }) => {
            if (object && layer?.id === "regions") {
              return { html: `<b>${object.name}</b><br/>${object.n} recruit${object.n === 1 ? "" : "s"} from ${object.schools.length} high school${object.schools.length === 1 ? "" : "s"}<br/>best: ${object.best.n} ${stars(object.best.s)}<br/><i>click to zoom in</i>`, style: tipStyle };
            }
            if (!object || layer?.id !== "schools") return null;
            return { html: `<b>${object.name}</b><br/>${[object.city, object.st].filter(Boolean).join(", ")}<br/>${object.n} recruit${object.n === 1 ? "" : "s"} · best: ${object.best.n} ${stars(object.best.s)}`, style: tipStyle };
          }} />
      </Shell>
    </>
  );
}

// One high school: its numbers and every recruit from it.
function HighSchoolPanel({ h, total, accent, c1, onBack, isMobile }) {
  const color = /^#?[0-9a-f]{6}$/i.test(c1 || "") ? c1 : BLUE;
  const years = h.list.map((r) => r.y);
  return (
    <div>
      <div style={{ position: "relative", padding: isMobile ? 14 : 18, background: `linear-gradient(135deg, ${color}, rgba(8,20,46,0.2))`, borderRadius: "16px 16px 0 0" }}>
        <button type="button" onClick={onBack} style={{ position: "absolute", top: 10, right: 10, border: "none", background: "rgba(0,0,0,0.3)", color: "#fff", borderRadius: 999, width: 30, height: 30, cursor: "pointer", fontWeight: 900 }}>✕</button>
        <Kicker color="rgba(255,255,255,0.8)">High School</Kicker>
        <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: "#fff", lineHeight: 1.1, paddingRight: 30 }}>{h.name}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)", fontFamily: BODY, marginTop: 2 }}>
          {[h.city, STATE_NAME[h.f] || h.st].filter(Boolean).join(", ")} · {Math.min(...years) === Math.max(...years) ? Math.min(...years) : `${Math.min(...years)}–${Math.max(...years)}`}
        </div>
      </div>
      <div style={{ padding: isMobile ? "12px 14px 16px" : "14px 18px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          <Stat label="Recruits" value={h.n} accent={accent} />
          <Stat label="Avg ★" value={h.stars.toFixed(1)} />
          <Stat label="4★+" value={h.list.filter((r) => r.s >= 4).length} />
          <Stat label="Drafted" value={h.list.filter((r) => r.d).length} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", fontFamily: BODY, marginTop: 8 }}>
          {Math.round((h.n / Math.max(1, total)) * 1000) / 10}% of the recruits shown
        </div>
        <H>Every recruit</H>
        <RecruitList list={[...h.list].sort((x, y) => y.y - x.y || y.r - x.r)} accent={accent} />
      </div>
    </div>
  );
}

function RecruitList({ list, accent }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {list.map((r, i) => {
        const href = playerHref(r.sl);
        return (
          <div key={`${r.n}-${r.y}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <span style={{ width: 52, flexShrink: 0, fontSize: 11, color: r.s >= 5 ? "#ffd600" : accent, letterSpacing: "-1px" }}>{stars(r.s)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {href ? <Link to={href} style={{ color: "#fff", textDecoration: "none", borderBottom: `1px solid ${accent}` }}>{r.n}</Link> : r.n}
                <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}> {r.p}</span>
              </span>
              <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", fontFamily: BODY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.y} · {r.h}{r.c ? `, ${r.c}` : ""}
              </span>
            </span>
            {r.d && <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 900, color: "#0b1530", background: GOLD, borderRadius: 6, padding: "3px 6px" }}>NFL {r.d}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════ /map ════════════════════════
function MapIndex() {
  const isMobile = useIsMobile();
  const teams = useTeams();
  const [q, setQ] = useState("");
  const list = Object.entries(teams || {}).map(([k, t]) => ({ k, ...t })).filter((t) => !q || t.School.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.School.localeCompare(b.School));
  return (
    <>
      <Meta title="Interactive College Football and NFL Draft Maps" description="Explore 3D maps of where NFL draft picks come from and where every FBS school finds its recruits." path="/map" />
      <div style={{ marginTop: isMobile ? -39 : -38, background: `radial-gradient(ellipse at 50% 0%, #12306a 0%, ${BG} 65%)`, minHeight: "calc(100vh - 62px)", padding: isMobile ? "18px 12px 60px" : "36px 24px 80px", fontFamily: HEAD, color: "#fff" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>
          <Kicker>We-Draft.com Maps</Kicker>
          <h1 style={{ margin: "6px 0 8px", fontSize: isMobile ? 30 : 46, textTransform: "uppercase", lineHeight: 1 }}>Interactive Maps</h1>
          <p style={{ margin: 0, maxWidth: 620, fontSize: isMobile ? 14 : 16, fontWeight: 600, color: "rgba(255,255,255,0.75)", fontFamily: BODY, lineHeight: 1.55 }}>
            Spin, tilt and zoom through 3D maps of college football's talent pipeline — where the NFL finds its picks, and where every program finds its players.
          </p>

          <Link to="/map/draft" style={{ display: "block", marginTop: 24, textDecoration: "none", color: "#fff", ...glass, padding: isMobile ? 18 : 28, background: "linear-gradient(120deg, rgba(0,85,165,0.55), rgba(246,162,29,0.25)), rgba(8,20,46,0.85)" }}>
            <Kicker>3D Map</Kicker>
            <div style={{ fontSize: isMobile ? 22 : 30, fontWeight: 900, textTransform: "uppercase", marginTop: 4 }}>Where NFL Draft Picks Come From</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.8)", fontFamily: BODY, marginTop: 6, maxWidth: 560 }}>Every pick since 2000 at its FBS school — filter by position and conference, then open any school's draft history.</div>
            <div style={{ display: "inline-block", marginTop: 14, padding: "8px 16px", borderRadius: 999, background: GOLD, color: "#0b1530", fontSize: 12, fontWeight: 900 }}>Open the draft map →</div>
          </Link>

          <div style={{ marginTop: 30, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <Kicker>3D Maps · every FBS school</Kicker>
              <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 900, textTransform: "uppercase", marginTop: 4 }}>Recruiting Maps</div>
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a school" style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "9px 16px", fontSize: 14, fontWeight: 700, width: isMobile ? "100%" : 260 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginTop: 14 }}>
            {list.map((t) => (
              <Link key={t.k} to={`/map/${t.k}`} style={{ textDecoration: "none", color: "#fff", ...glass, borderRadius: 14, padding: "14px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center", borderTop: `3px solid ${/^#?[0-9a-f]{6}$/i.test(t.Color1 || "") ? t.Color1 : BLUE}` }}>
                <Logo src={t.LogoDark || t.Logo1} size={isMobile ? 38 : 46} />
                <span style={{ fontSize: 11, fontWeight: 900, lineHeight: 1.15 }}>{t.School}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Meta({ title, description, path }) {
  return (
    <Helmet>
      <title>{`${title} | We-Draft.com`}</title>
      <meta name="description" content={description} />
      {/* Unreleased (admin-only route) — drop with the AdminRoute in App.js. */}
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={`${SITE}${path}`} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={`${SITE}${path}`} />
      <meta property="og:site_name" content="We-Draft.com" />
      <meta name="twitter:card" content="summary_large_image" />
    </Helmet>
  );
}
