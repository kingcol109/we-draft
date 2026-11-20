// src/pages/HighSchoolHub.jsx
//
// /hs        where college football players come from: states by default
//            (current college players, or NFL draft picks since 2000), with a
//            toggle to the top high schools. Numbers on top (the top 3 as
//            cards, 1-2-3 left to right, then 4–10, "show all" for the rest),
//            heatmap below — a state choropleth, or a high school heat glow.
// /hs/{st}   one state (/hs/ga): its totals and national ranks, players by
//            position, every high school, and a heatmap of the state's schools.
// The NFL Draft view is its own path: /hs/nfl, /hs/{st}/nfl (In College is
// the bare path). hubPath() builds them; old ?m=nfl links redirect.
// School pages live under their state: /hs/{st}/{school} (HighSchoolTeamPage,
// utils/hsRanks.js hsPath); /hs/rankings is the leaderboards. Player pages'
// high school row links to the state page.
//
// Efficiency (the old deck.gl maps were heavy): ONE Firestore read per view —
// hsAlumni/_hub or hsAlumni/_state_{ST}, precomputed by
// server/highSchools/hsGeo.js with every school's point already projected
// into us-atlas's Albers frame. No WebGL, no projection library: state
// outlines are SVG paths (utils/usStatesGeo.js), the heat is one canvas drawn
// per data/size/zoom change. Zoom = a smaller SVG viewBox (+/−, drag to pan,
// Ctrl/⌘+scroll or pinch). Docs are cached for the session.
// Indexed (released 2026-11-20): SeoMeta gives each view its own title,
// description and canonical; /hs, /hs/nfl and every /hs/{st}(/nfl) are in
// the sitemap (scripts/generate-sitemap.js).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import { STATE_NAME } from "../utils/highSchoolMatch";
import { POS_GROUPS, rankText, hsPath } from "../utils/hsRanks";
import { usStates, US_FRAME } from "../utils/usStatesGeo";

// ── look: light, site blue + gold, varsity type ──
const BLUE = "#0055a5";
const NAVY = "#0b2a5c";
const GOLD = "#f6a21d";
const PAPER = "#ffffff";
const CARD = "#ffffff";
const EDGE = "#e3e8ef";
const TEXT = "#0f1b2d";
const DIM = "#5b6676";
const FAINT = "#8a94a3";
const TRACK = "#eef1f5";
const DISPLAY = "'Anton', 'Arial Black', Arial, sans-serif";
const HEAD = "'Arial Black', Arial, sans-serif";
const MEDAL = ["#f6a21d", "#9aa7b8", "#c97b3d"];
const LIST_TOP = 10;
const METRIC = {
  cfb: { label: "In College", unit: "players", long: "Current college football players" },
  nfl: { label: "NFL Draft", unit: "picks", long: "NFL draft picks" },
};
const fmt = (n) => (n || 0).toLocaleString("en-US");

// Sequential, one hue (site blue): light → navy.
const RAMP = [[230, 238, 248], [147, 190, 236], [47, 127, 208], [0, 85, 165], [11, 42, 92]];
const rampAt = (t) => {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  return RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
};
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

const STYLE = `
  @keyframes wdHubDrift { from { transform: translate(0,0); } to { transform: translate(-80px,-46px); } }
  @keyframes wdHubRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes wdHubPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
  .wd-hub-rise { animation: wdHubRise .5s cubic-bezier(.2,.7,.2,1) both; }
  .wd-hub-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
  .wd-hub-card:hover { transform: translateY(-3px); box-shadow: 0 14px 30px rgba(15,27,45,0.14) !important; border-color: ${GOLD} !important; }
  .wd-hub-row { transition: background .15s ease; }
  .wd-hub-row:hover { background: #f5f8fc !important; }
  .wd-hub-scroll::-webkit-scrollbar { height: 0; }
  .wd-hub-flip { perspective: 1400px; height: 100%; }
  .wd-hub-flip-inner { position: relative; height: 100%; display: grid; transition: transform .65s cubic-bezier(.2,.7,.2,1); transform-style: preserve-3d; }
  .wd-hub-flip.on .wd-hub-flip-inner { transform: rotateY(180deg); }
  @media (hover: hover) { .wd-hub-flip.can:hover .wd-hub-flip-inner { transform: rotateY(180deg); } }
  .wd-hub-face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
  .wd-hub-zoom:hover:not(:disabled) { border-color: ${BLUE} !important; color: ${BLUE} !important; }
  @media (prefers-reduced-motion: reduce) { .wd-hub-rise, .wd-hub-drift { animation: none !important; } }
`;

// ── data: one doc per view, cached ──
const docCache = new Map();
function useHsDoc(id) {
  const [data, setData] = useState(() => docCache.get(id));
  useEffect(() => {
    if (!id) return undefined;
    if (docCache.has(id)) { setData(docCache.get(id)); return undefined; }
    let cancelled = false;
    setData(undefined);
    getDoc(doc(db, "hsAlumni", id))
      .then((s) => { const v = s.exists() ? s.data() : null; docCache.set(id, v); if (!cancelled) setData(v); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [id]);
  return data;
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const h = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return m;
}

// An element's size, kept current (CSS px as laid out — the site's page
// zoom included, unlike window.innerHeight).
function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// A number that counts up to its value (from wherever it was).
function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const to = target || 0;
    if (reducedMotion()) { setV(to); from.current = to; return undefined; }
    const start = from.current;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const val = Math.round(start + (to - start) * (1 - (1 - p) ** 3));
      setV(val);
      from.current = val;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
function CountUp({ value }) {
  return <>{fmt(useCountUp(value))}</>;
}

// Competition ranks over [{ key, v }] (v > 0), best first.
function ranked(rows) {
  const sorted = rows.filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
  const ties = new Map();
  sorted.forEach((r) => ties.set(r.v, (ties.get(r.v) || 0) + 1));
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.v !== sorted[i - 1].v) rank = i + 1;
    return { ...r, r: rank, t: ties.get(r.v) > 1 };
  });
}

// /hs, /hs/nfl, /hs/{st}, /hs/{st}/nfl
export const hubPath = (st, metric) => `/hs${st ? `/${String(st).toLowerCase()}` : ""}${metric === "nfl" ? "/nfl" : ""}`;
function useHubRoute() {
  const { slug, st: stParam } = useParams();
  const { pathname } = useLocation();
  const metric = /\/nfl\/?$/.test(pathname) ? "nfl" : "cfb";
  const raw = stParam || (slug && slug !== "nfl" ? slug : null);
  return { st: raw ? raw.toUpperCase() : null, metric };
}

export default function HighSchoolHub() {
  const { st } = useHubRoute();
  const [params] = useSearchParams();
  // Old ?m=nfl links → the /nfl path.
  if (params.get("m") === "nfl") {
    const next = new URLSearchParams(params);
    next.delete("m");
    const qs = next.toString();
    return <Navigate to={`${hubPath(st && STATE_NAME[st] ? st : null, "nfl")}${qs ? `?${qs}` : ""}`} replace />;
  }
  return (
    <>
      <style>{STYLE}</style>
      <Helmet>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
      </Helmet>
      {st && !STATE_NAME[st] ? (
        <Stage>
          <SeoMeta title="State Not Found | We-Draft.com" description="That state isn't on We-Draft.com." path="/hs" noindex />
          <div style={{ padding: "80px 20px", textAlign: "center", color: DIM }}>
            No state found. <Link to="/hs" style={{ color: BLUE }}>All states</Link>
          </div>
        </Stage>
      ) : st ? <StateView st={st} /> : <NationalView />}
    </>
  );
}

// ── SEO ──
const SITE = "https://we-draft.com";
// crumbs: [[name, path], …] after We-Draft.com → a BreadcrumbList (JSON-LD).
function SeoMeta({ title, description, path, noindex, crumbs }) {
  const url = `${SITE}${path}`;
  const ld = crumbs?.length ? {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [["We-Draft.com", "/"], ...crumbs].map(([name, p], i) => ({
      "@type": "ListItem", position: i + 1, name, item: `${SITE}${p}`,
    })),
  } : null;
  return (
    <Helmet>
      <title>{title}</title>
      {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="We-Draft.com" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {ld ? <script type="application/ld+json">{JSON.stringify(ld)}</script> : null}
    </Helmet>
  );
}

// ── shared bits ──
// Wide screens: the stage between two sticky columns (left = state rankings,
// right = top players / picks). Narrower: the columns follow the stage.
function useWide() {
  const [w, setW] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1280);
  useEffect(() => {
    const h = () => setW(window.innerWidth >= 1280);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

function Stage({ children, isMobile, left, right }) {
  const wide = useWide();
  const stage = <StagePanel isMobile={isMobile}>{children}</StagePanel>;
  if (!left && !right) {
    return <div style={{ maxWidth: "1240px", margin: "0 auto", padding: isMobile ? "8px 8px 50px" : "20px 24px 60px" }}>{stage}</div>;
  }
  if (wide) {
    return (
      <div style={{ maxWidth: "1720px", margin: "0 auto", padding: "20px 24px 60px", display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) 260px", gap: "20px", alignItems: "start" }}>
        <div style={{ position: "sticky", top: "84px" }}>{left}</div>
        {stage}
        <div style={{ position: "sticky", top: "84px" }}>{right}</div>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: "1240px", margin: "0 auto", padding: isMobile ? "8px 8px 50px" : "20px 24px 60px" }}>
      {stage}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "16px", marginTop: "16px", alignItems: "start" }}>
        {left}{right}
      </div>
    </div>
  );
}

function SideCard({ title, sub, children }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${EDGE}`, borderRadius: "16px", overflow: "hidden", boxShadow: "0 4px 14px rgba(15,27,45,0.06)", fontFamily: HEAD }}>
      <div style={{ background: `linear-gradient(120deg, ${BLUE}, ${NAVY})`, padding: "12px 14px" }}>
        <div style={{ color: "#fff", fontSize: "12px", fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase" }}>{title}</div>
        {sub && <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "10px", fontWeight: 800, marginTop: "2px" }}>{sub}</div>}
      </div>
      <div style={{ height: "3px", background: GOLD }} />
      {children}
    </div>
  );
}

// Left column: every state ranked by the current view — also the way to
// another state's page (same view).
function StateRankSide({ hub, metric, current }) {
  const rows = useMemo(() => ranked((hub?.states || []).map((s) => ({ key: s.a, v: s[metric]?.ALL || 0 }))), [hub, metric]);
  const listRef = useRef(null);
  const curRef = useRef(null);
  useEffect(() => {
    // Only when the current state would be out of view.
    const list = listRef.current;
    const row = curRef.current;
    if (list && row && row.offsetTop + row.offsetHeight > list.clientHeight) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2);
  }, [current, rows.length]);
  return (
    <SideCard title="State Rankings" sub={metric === "cfb" ? "Current college players" : `NFL draft picks ${hub?.draftFrom || 2000}–${hub?.draftTo || ""}`}>
      <div ref={listRef} style={{ maxHeight: "calc(100vh - 190px)", overflowY: "auto", position: "relative" }}>
        <Link to={hubPath(null, metric)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 14px", textDecoration: "none", borderBottom: `1px solid ${TRACK}`, background: !current ? "rgba(0,85,165,0.07)" : "#fff", boxShadow: !current ? `inset 3px 0 0 ${GOLD}` : "none" }}>
          <span style={{ fontSize: "12px", fontWeight: 900, color: BLUE }}>All states</span>
          <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 900, color: FAINT }}>{fmt(rows.reduce((n, r) => n + r.v, 0))}</span>
        </Link>
        {rows.map((r) => {
          const on = r.key === current;
          return (
            <Link key={r.key} ref={on ? curRef : undefined} to={hubPath(r.key, metric)} className="wd-hub-row" style={{
              display: "flex", alignItems: "center", gap: "8px", padding: "7px 14px", textDecoration: "none", borderBottom: `1px solid ${TRACK}`,
              background: on ? "rgba(0,85,165,0.07)" : "#fff", boxShadow: on ? `inset 3px 0 0 ${GOLD}` : "none",
            }}>
              <span style={{ width: "28px", flexShrink: 0, textAlign: "right", fontSize: "11px", fontWeight: 900, color: r.r <= 3 ? GOLD : FAINT }}>{rankText(r.r, r.t)}</span>
              <StateShape abbr={r.key} size={18} glow={false} />
              <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 900, color: on ? BLUE : TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{STATE_NAME[r.key]}</span>
              <span style={{ fontSize: "12px", fontWeight: 900, color: TEXT, fontVariantNumeric: "tabular-nums" }}>{fmt(r.v)}</span>
            </Link>
          );
        })}
      </div>
    </SideCard>
  );
}

// Right column: the scope's top current college players (ordered upstream,
// no numbers) or its highest draft picks (by round, "R1").
function TopSide({ doc, metric, scopeName }) {
  const cfb = metric === "cfb";
  const rows = (cfb ? doc?.sideCfb : doc?.sidePicks) || [];
  return (
    <SideCard title={cfb ? "Top College Players" : "Top Draft Picks"} sub={cfb ? `From ${scopeName} high schools` : `${scopeName} high schools · ${doc?.draftFrom || 2000}–${doc?.draftTo || ""}`}>
      {rows.length === 0 && <div style={{ padding: "24px 14px", textAlign: "center", fontSize: "12px", fontStyle: "italic", color: FAINT }}>None yet.</div>}
      {rows.map((x, i) => {
        const logo = cfb ? doc?.collegeLogos?.[x[2]] : doc?.nflLogos?.[x[5]];
        const src = logo?.[1] || logo?.[0];
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 14px", borderBottom: i < rows.length - 1 ? `1px solid ${TRACK}` : "none" }}>
            {cfb ? (
              <span style={{ width: "30px", height: "30px", flexShrink: 0, borderRadius: "50%", background: "#fff", border: `1px solid ${EDGE}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {src ? <img src={src} alt="" style={{ width: "72%", height: "72%", objectFit: "contain" }} /> : null}
              </span>
            ) : (
              <span style={{ width: "30px", flexShrink: 0, fontFamily: DISPLAY, fontSize: "20px", lineHeight: 1, color: x[2] === 1 ? GOLD : BLUE }}>{x[2] ? `R${x[2]}` : "—"}</span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: "13px", fontWeight: 900, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfb ? x[0] : x[3]}</span>
              <span style={{ display: "block", fontSize: "10px", fontWeight: 800, color: DIM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cfb ? [x[1], x[2]].filter(Boolean).join(" · ") : [x[4], x[0]].filter(Boolean).join(" · ")}
              </span>
              <span style={{ display: "block", fontSize: "10px", fontWeight: 700, color: FAINT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cfb ? x[3] : x[6]}</span>
            </span>
            {!cfb && src ? <img src={src} alt={x[5]} style={{ width: "26px", height: "26px", objectFit: "contain", flexShrink: 0 }} /> : null}
          </div>
        );
      })}
    </SideCard>
  );
}

function StagePanel({ children, isMobile }) {
  return (
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: isMobile ? "16px" : "24px", background: PAPER, color: TEXT, fontFamily: HEAD,
        border: `1px solid ${EDGE}`, boxShadow: "0 18px 50px rgba(15,27,45,0.08)", padding: isMobile ? "18px 14px 22px" : "34px 38px 40px",
      }}>
        <div aria-hidden="true" className="wd-hub-drift" style={{
          position: "absolute", inset: "-20%", pointerEvents: "none",
          background: "repeating-linear-gradient(115deg, rgba(0,85,165,0.03) 0 2px, transparent 2px 42px)",
          animation: "wdHubDrift 22s linear infinite",
        }} />
        <div aria-hidden="true" style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(900px 380px at 10% -10%, rgba(0,85,165,0.12), transparent 65%), radial-gradient(700px 340px at 105% 0%, rgba(246,162,29,0.12), transparent 60%)",
        }} />
        <div style={{ position: "relative" }}>{children}</div>
      </div>
  );
}

function Hero({ kicker, title, sub, big, bigLabel, art, isMobile }) {
  return (
    <div className="wd-hub-rise" style={{ display: "flex", alignItems: isMobile ? "flex-start" : "flex-end", gap: "20px", flexDirection: isMobile ? "column" : "row", marginBottom: isMobile ? "18px" : "26px" }}>
      {art}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: 900, letterSpacing: "0.22em", textTransform: "uppercase", color: GOLD }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: GOLD, boxShadow: `0 0 10px ${GOLD}`, animation: "wdHubPulse 2.4s ease-in-out infinite" }} />
          {kicker}
        </div>
        <h1 style={{ fontFamily: DISPLAY, fontWeight: 400, fontSize: isMobile ? "38px" : "68px", lineHeight: 0.95, margin: "8px 0 0", textTransform: "uppercase", letterSpacing: "0.01em", color: TEXT }}>
          {title}
        </h1>
        <div style={{ marginTop: "10px", fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: DIM, maxWidth: "640px" }}>{sub}</div>
      </div>
      {big != null && (
        <div style={{ textAlign: isMobile ? "left" : "right", flexShrink: 0 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: isMobile ? "52px" : "84px", lineHeight: 0.9, color: BLUE, fontVariantNumeric: "tabular-nums" }}>
            <CountUp value={big} />
          </div>
          <div style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD, marginTop: "4px" }}>{bigLabel}</div>
        </div>
      )}
    </div>
  );
}

function Segmented({ options, value, onChange, big }) {
  return (
    <div role="tablist" style={{ display: "inline-flex", padding: "4px", borderRadius: "999px", background: "#eef2f7", border: `1px solid ${EDGE}` }}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => onChange(k)} style={{
            padding: big ? "9px 20px" : "8px 16px", borderRadius: "999px", border: "none", cursor: "pointer", fontFamily: HEAD, fontWeight: 900,
            fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em", transition: "all .18s ease",
            background: on ? (big ? BLUE : "#fff") : "transparent", color: on ? (big ? "#fff" : BLUE) : DIM,
            boxShadow: on ? (big ? "0 4px 14px rgba(0,85,165,0.35)" : "0 2px 8px rgba(15,27,45,0.12)") : "none",
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function StateSelect({ value, isMobile, metric }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const all = Object.entries(STATE_NAME).sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <select value={value || ""} aria-label="State" onChange={(e) => {
      // The national page's own view/position filters don't carry into a state.
      const qs = e.target.value ? "" : params.toString();
      navigate(`${hubPath(e.target.value || null, metric)}${qs ? `?${qs}` : ""}`);
    }}
      style={{
        marginLeft: isMobile ? 0 : "auto", padding: "10px 14px", borderRadius: "999px", border: `1px solid ${EDGE}`, background: "#fff",
        color: TEXT, fontWeight: 900, fontSize: "12px", fontFamily: HEAD, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
      <option value="">All States</option>
      {all.map(([a, n]) => <option key={a} value={a}>{n}</option>)}
    </select>
  );
}

// A state's own silhouette, filled with a gradient.
function StateShape({ abbr, size = 80, glow = true, light = false }) {
  const s = usStates()[abbr];
  if (!s) return null;
  const [x0, y0, x1, y1] = s.bbox;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  const gid = `wdhub-g-${abbr}-${light ? "l" : "d"}`;
  return (
    <svg viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`} width={size} height={size} aria-hidden="true"
      style={{ flexShrink: 0, overflow: "visible", filter: glow ? `drop-shadow(0 6px 14px rgba(0,85,165,${light ? 0.5 : 0.3}))` : undefined }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light ? "#ffffff" : "#5b9be6"} />
          <stop offset="1" stopColor={light ? "#cfe1f7" : BLUE} />
        </linearGradient>
      </defs>
      <path d={s.d} fill={`url(#${gid})`} stroke="#fff" strokeWidth={(x1 - x0) / 120} />
    </svg>
  );
}

function SchoolMark({ logo, size }) {
  return (
    <div style={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", background: "#fff", border: `1px solid ${EDGE}`, boxShadow: "0 2px 8px rgba(15,27,45,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {logo
        ? <img src={logo} alt="" loading="lazy" style={{ width: "74%", height: "74%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        : <span style={{ fontFamily: DISPLAY, fontSize: size * 0.3, color: FAINT }}>HS</span>}
    </div>
  );
}

function Tile({ label, value, note, accent, delay = 0, isMobile }) {
  // Names (a school, a state) never get cut off: the type steps down for
  // longer ones, and anything still too long wraps.
  const text = typeof value === "string" ? value : null;
  const len = text ? text.length : 0;
  const size = !text ? (isMobile ? 28 : 38)
    : len <= 10 ? (isMobile ? 26 : 38) : len <= 16 ? (isMobile ? 21 : 30) : len <= 24 ? (isMobile ? 17 : 24) : (isMobile ? 15 : 20);
  return (
    <div className="wd-hub-rise" style={{
      animationDelay: `${delay}s`, background: CARD, border: `1px solid ${EDGE}`, borderRadius: "16px", padding: isMobile ? "12px 14px" : "16px 18px", minWidth: 0,
      boxShadow: accent ? `inset 0 3px 0 ${GOLD}, 0 4px 14px rgba(15,27,45,0.05)` : "0 4px 14px rgba(15,27,45,0.05)",
    }}>
      <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: FAINT }}>{label}</div>
      <div style={{
        fontFamily: DISPLAY, fontSize: `${size}px`, lineHeight: text ? 1.08 : 1.05, marginTop: "6px", fontVariantNumeric: "tabular-nums", textTransform: "uppercase", color: TEXT,
        ...(text ? { overflowWrap: "anywhere", minHeight: `${isMobile ? 28 : 38}px`, display: "flex", alignItems: "center" } : { whiteSpace: "nowrap" }),
      }}>
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </div>
      {note && <div style={{ fontSize: "11px", fontWeight: 800, color: DIM, marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</div>}
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "30px 0 14px" }}>
      <span style={{ width: "4px", height: "22px", borderRadius: "2px", background: GOLD }} />
      <span style={{ fontFamily: DISPLAY, fontSize: "24px", textTransform: "uppercase", letterSpacing: "0.02em", color: TEXT }}>{children}</span>
      {right && <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 900, color: FAINT, letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right" }}>{right}</span>}
    </div>
  );
}

// A school's showcase list, by metric — In College: its current college
// players (ordered by transfer stars upstream, never shown); NFL Draft: its
// highest picks — "R1" in the list chips; the top-3 cards add the pick.
// → [{ key, tag, name, meta, logo: [onDark, onLight] }]
const shortName = (n) => { const p = String(n || "").split(" "); return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : n; };
function showcase(metric, players, picks, nflLogos, collegeLogos) {
  if (metric === "nfl") {
    return (picks || []).map((p, i) => ({
      key: `p${i}`, tag: p[2] ? `R${p[2]}` : "", first: p[2] === 1, name: p[3], meta: [p[4], p[0]].filter(Boolean).join(" · "),
      // The top-3 cards also show the overall pick; the list chips don't.
      cardMeta: [p[1] ? `Pick ${p[1]}` : null, p[4], p[0]].filter(Boolean).join(" · "),
      year: p[0], logo: nflLogos?.[p[5]] || null,
    }));
  }
  return (players || []).map((x, i) => ({
    key: `c${i}`, tag: "", name: x[0], meta: [x[1], x[2]].filter(Boolean).join(" · "), college: x[2], logo: collegeLogos?.[x[2]] || null,
  }));
}

// Under a list row: the school's showcase as chips.
function ShowChips({ items }) {
  if (!items?.length) return null;
  return (
    <span className="wd-hub-scroll" style={{ display: "flex", gap: "6px", marginTop: "7px", overflowX: "auto", minWidth: 0 }}>
      {items.map((it) => (
        <span key={it.key} title={`${it.name}${it.meta ? ` · ${it.meta}` : ""}`} style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 8px 3px 5px", borderRadius: "999px",
          background: it.first ? "rgba(246,162,29,0.12)" : "#f3f6fa", border: `1px solid ${it.first ? "rgba(246,162,29,0.45)" : EDGE}`,
          fontSize: "10px", fontWeight: 900, color: TEXT, whiteSpace: "nowrap",
        }}>
          {it.logo?.[1] ? <img src={it.logo[1]} alt="" style={{ width: "14px", height: "14px", objectFit: "contain" }} /> : null}
          {it.tag && <span style={{ color: it.first ? "#b06d00" : BLUE }}>{it.tag}</span>}
          {it.year && <span style={{ color: FAINT }}>{"\u2019"}{String(it.year).slice(2)}</span>}
          <span>{shortName(it.name)}</span>
          {!it.tag && it.meta && <span style={{ color: FAINT }}>{it.meta.split(" · ")[0]}</span>}
        </span>
      ))}
    </span>
  );
}

// An animated bar (grows in on mount, glides on change).
// A school's color for text/bars on white: Color1, else Color2 when Color1
// is too light to read, else site blue.
const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const inkOf = (colors) => {
  const ok = (c) => { const l = lum(c); return l != null && l < 0.72; };
  if (colors?.[0] && ok(colors[0])) return colors[0].startsWith("#") ? colors[0] : `#${colors[0]}`;
  if (colors?.[1] && ok(colors[1])) return colors[1].startsWith("#") ? colors[1] : `#${colors[1]}`;
  return null;
};

function Bar({ pct, color = BLUE, height = 6 }) {
  const [w, setW] = useState(0);
  useEffect(() => { const r = requestAnimationFrame(() => setW(pct)); return () => cancelAnimationFrame(r); }, [pct]);
  return (
    <span style={{ display: "block", height, borderRadius: height, background: TRACK, overflow: "hidden" }}>
      <span style={{ display: "block", height: "100%", width: `${Math.max(1.5, w)}%`, borderRadius: height, background: color === BLUE ? `linear-gradient(90deg, #4f8fd6, ${color})` : `linear-gradient(90deg, ${color}99, ${color})`, transition: "width .8s cubic-bezier(.2,.7,.2,1)" }} />
    </span>
  );
}

// The top three as cards, #1 → #3 left to right. A school with branding
// wears its colors (else #1 in site blue, #2/#3 white). The front: logo,
// name, both numbers, and its headliner (top college player / top pick /
// a state's top school). Hover (or the "↻" pill on touch) flips it to the
// full showcase list.
function TopThree({ items, isMobile }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: isMobile ? "10px" : "16px", alignItems: "stretch", marginBottom: "14px" }}>
      {items.map((it) => <TopCard key={it.key} it={it} isMobile={isMobile} />)}
    </div>
  );
}

function TopCard({ it, isMobile }) {
  const [flipped, setFlipped] = useState(false);
  const first = it.r === 1 && it.i === 0;
  const medal = MEDAL[Math.min(2, it.r - 1)];
  const [c1, c2] = it.colors || [];
  const team = !!c1;
  const dark = team || first;
  const ink = dark ? "#fff" : TEXT;
  const soft = dark ? "rgba(255,255,255,0.68)" : DIM;
  const list = it.list || [];
  const canFlip = list.length > 1;
  // The college list's order isn't a ranking — no headliner from it.
  const head = it.headliner || (list[0] && it.listTitle1 ? { label: it.listTitle1, ...list[0] } : null);
  // Both faces share one grid cell, so the card is as tall as its taller side.
  const longestWord = Math.max(...String(it.name || "").split(/\s+/).map((w) => w.length));
  const nameSize = isMobile ? (longestWord > 12 ? 17 : longestWord > 9 ? 19 : 22) : (longestWord > 12 ? 19 : longestWord > 9 ? 22 : 28);
  const faceBase = { gridArea: "1 / 1", borderRadius: "18px", overflow: "hidden", boxSizing: "border-box", height: "100%" };
  const frontBg = team
    ? `linear-gradient(rgba(0,0,0,0.26), rgba(0,0,0,0.42)), linear-gradient(130deg, ${c1} 0%, ${c1} 45%, ${c2} 100%)`
    : first ? `linear-gradient(150deg, ${BLUE} 0%, ${NAVY} 100%)` : CARD;
  const backBg = team
    ? `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.66)), linear-gradient(130deg, ${c1} 0%, ${c2} 100%)`
    : `linear-gradient(150deg, ${NAVY} 0%, #06173a 100%)`;
  const toggle = (e) => { e.preventDefault(); e.stopPropagation(); setFlipped((f) => !f); };
  const stat = (v, label, big) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: DISPLAY, fontSize: big ? (isMobile ? "30px" : "44px") : (isMobile ? "20px" : "26px"), lineHeight: 1, color: big ? (team ? "#fff" : first ? GOLD : BLUE) : ink, opacity: big ? 1 : 0.85, fontVariantNumeric: "tabular-nums", textShadow: team ? "0 2px 10px rgba(0,0,0,0.3)" : "none" }}>
        {big ? <CountUp value={v} /> : fmt(v)}
      </div>
      <div style={{ fontSize: "10px", fontWeight: 900, color: soft, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: "3px" }}>{label}</div>
    </div>
  );

  const front = (
    <div className="wd-hub-face" style={{
      ...faceBase, position: "relative", color: ink, background: frontBg,
      border: `${team ? 2 : 1}px solid ${team ? c2 : first ? NAVY : EDGE}`,
      padding: isMobile ? "14px" : "20px 20px 16px", display: "flex", flexDirection: "column", gap: isMobile ? "10px" : "14px",
      boxShadow: dark ? "0 16px 36px rgba(15,27,45,0.25)" : "0 4px 14px rgba(15,27,45,0.06)",
    }}>
      {dark && <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 36px)" }} />}
      <div aria-hidden="true" style={{ position: "absolute", right: "14px", top: "6px", fontFamily: DISPLAY, fontSize: isMobile ? "60px" : "96px", lineHeight: 1, color: dark ? "#fff" : medal, opacity: dark ? 0.14 : 0.2 }}>
        {it.r}
      </div>
      {/* Identity */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "14px", minWidth: 0, paddingRight: isMobile ? "40px" : "56px" }}>
        {it.art}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "inline-block", fontSize: "10px", fontWeight: 900, letterSpacing: "0.14em", padding: "3px 8px", borderRadius: "999px", background: medal, color: "#fff" }}>
            {rankText(it.r, it.t)}
          </div>
          {/* Sized to the longest word, so a name wraps between words, never inside one. */}
          <div style={{ fontFamily: DISPLAY, fontSize: `${nameSize}px`, lineHeight: 1.02, marginTop: "6px", textTransform: "uppercase", textShadow: dark ? "0 2px 8px rgba(0,0,0,0.3)" : "none", overflowWrap: "break-word", wordBreak: "normal", hyphens: "none" }}>{it.name}</div>
          {it.sub && <div style={{ fontSize: "11px", fontWeight: 800, color: soft, marginTop: "3px" }}>{it.sub}</div>}
        </div>
      </div>
      {/* Numbers */}
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: isMobile ? "18px" : "26px" }}>
        {stat(it.v, it.unit, true)}
        {it.other != null && stat(it.other, it.otherLabel, false)}
      </div>
      {/* College view: where its players play, and its position mix. */}
      {!head && (it.colleges?.length || it.posMix) && (
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "12px" }}>
          {it.colleges?.length > 0 && (
            <div>
              <div style={{ fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: dark ? GOLD : "#b06d00", marginBottom: "6px" }}>Where they play</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {it.colleges.map(([school, n]) => {
                  const logo = it.collegeLogos?.[school]?.[1] || it.collegeLogos?.[school]?.[0];
                  return (
                    <span key={school} title={`${school}: ${n}`} style={{
                      display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 8px 3px 3px", borderRadius: "999px",
                      background: dark ? "rgba(255,255,255,0.14)" : "#f3f6fa", border: `1px solid ${dark ? "rgba(255,255,255,0.18)" : EDGE}`,
                    }}>
                      <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {logo ? <img src={logo} alt={school} style={{ width: "16px", height: "16px", objectFit: "contain" }} /> : <span style={{ fontSize: "8px", fontWeight: 900, color: FAINT }}>{school.slice(0, 3).toUpperCase()}</span>}
                      </span>
                      <span style={{ fontFamily: DISPLAY, fontSize: "14px", lineHeight: 1, color: ink }}>{n}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {it.posMix && (
            <div>
              <div style={{ fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: dark ? GOLD : "#b06d00", marginBottom: "6px" }}>By position</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(9, minmax(0, 1fr))", gap: "4px", alignItems: "end" }}>
                {POS_GROUPS.map(([g, label], gi) => {
                  const v = it.posMix[gi] || 0;
                  const mx = Math.max(1, ...it.posMix);
                  return (
                    <div key={g} title={`${label}: ${v}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                      <span style={{ fontSize: "10px", fontWeight: 900, color: ink, opacity: v ? 0.95 : 0.4 }}>{v}</span>
                      <span style={{ width: "100%", maxWidth: "22px", height: "30px", display: "flex", alignItems: "flex-end", borderRadius: "4px", background: dark ? "rgba(255,255,255,0.1)" : TRACK, overflow: "hidden", marginTop: "2px" }}>
                        <span style={{ width: "100%", height: `${v ? Math.max(8, (v / mx) * 100) : 0}%`, borderRadius: "4px", background: dark ? "rgba(255,255,255,0.85)" : BLUE }} />
                      </span>
                      <span style={{ fontSize: "8px", fontWeight: 900, color: soft, marginTop: "3px", letterSpacing: "0.02em" }}>{g}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {/* No headliner (college view): just the way to the list. */}
      {!head && canFlip && (
        <div style={{ position: "relative", marginTop: "auto", paddingTop: "12px", borderTop: `1px solid ${dark ? "rgba(255,255,255,0.16)" : TRACK}`, display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: soft }}>{it.listTitle}</span>
          <button type="button" onClick={toggle} title={it.listTitle} style={{ marginLeft: "auto", flexShrink: 0, padding: "6px 10px", borderRadius: "999px", border: "none", cursor: "pointer", background: dark ? "rgba(255,255,255,0.16)" : "#eef2f7", color: ink, fontFamily: HEAD, fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            {it.flipLabel} ↻
          </button>
        </div>
      )}
      {/* Headliner */}
      {head && (
        <div style={{ position: "relative", marginTop: "auto", paddingTop: "12px", borderTop: `1px solid ${dark ? "rgba(255,255,255,0.16)" : TRACK}`, display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          {head.logo ? <img src={dark ? head.logo[0] : head.logo[1]} alt="" style={{ width: "30px", height: "30px", objectFit: "contain", flexShrink: 0, filter: dark ? "drop-shadow(0 1px 3px rgba(0,0,0,0.35))" : "none" }} /> : null}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "9px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: dark ? GOLD : "#b06d00" }}>{head.label}</div>
            <div style={{ fontSize: "14px", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {head.tag ? <span style={{ color: dark ? GOLD : BLUE, marginRight: "6px" }}>{head.tag}</span> : null}{head.name}
            </div>
            {(head.cardMeta || head.meta) && <div style={{ fontSize: "10px", fontWeight: 800, color: soft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{head.cardMeta || head.meta}</div>}
          </div>
          {canFlip && (
            <button type="button" onClick={toggle} title={it.listTitle} style={{ flexShrink: 0, padding: "6px 10px", borderRadius: "999px", border: "none", cursor: "pointer", background: dark ? "rgba(255,255,255,0.16)" : "#eef2f7", color: ink, fontFamily: HEAD, fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
              {it.flipLabel} ↻
            </button>
          )}
        </div>
      )}
    </div>
  );

  const back = canFlip && (
    <div className="wd-hub-face" style={{
      ...faceBase, position: "relative", transform: "rotateY(180deg)", color: "#fff", background: backBg,
      border: `${team ? 2 : 1}px solid ${team ? c2 : NAVY}`, padding: isMobile ? "12px 14px 16px" : "16px 18px 20px", display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD }}>{it.listTitle}</span>
        <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
        <button type="button" onClick={toggle} aria-label="Flip back" style={{ border: "none", background: "rgba(255,255,255,0.18)", color: "#fff", borderRadius: "999px", width: "24px", height: "24px", cursor: "pointer", fontWeight: 900, padding: 0, flexShrink: 0 }}>↺</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        {list.map((x, i) => (
          <div key={x.key} style={{ display: "flex", alignItems: "center", gap: "12px", padding: x.tag ? "6px 0" : "8px 0", borderTop: i ? "1px solid rgba(255,255,255,0.1)" : "none", minWidth: 0 }}>
            {x.tag ? <span style={{ flexShrink: 0, width: "34px", fontFamily: DISPLAY, fontSize: "22px", lineHeight: 1, color: x.first ? GOLD : "#fff" }}>{x.tag}</span> : (
              // College view: the player's college logo leads the row.
              <span style={{ flexShrink: 0, width: isMobile ? "38px" : "42px", height: isMobile ? "38px" : "42px", borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
                {x.logo?.[1] || x.logo?.[0] ? <img src={x.logo[1] || x.logo[0]} alt="" style={{ width: "70%", height: "70%", objectFit: "contain" }} /> : null}
              </span>
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: x.tag ? HEAD : DISPLAY, fontSize: x.tag ? "13px" : (isMobile ? "19px" : "21px"), fontWeight: x.tag ? 900 : 400, lineHeight: 1.1, textTransform: x.tag ? "none" : "uppercase", letterSpacing: x.tag ? 0 : "0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
              <span style={{ display: "block", fontSize: x.tag ? "10px" : "11px", fontWeight: 800, color: "rgba(255,255,255,0.62)", marginTop: x.tag ? 0 : "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.cardMeta || x.meta}</span>
            </span>
            {x.tag && x.logo?.[0] ? <img src={x.logo[0]} alt="" style={{ flexShrink: 0, width: "26px", height: "26px", objectFit: "contain", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" }} /> : null}
          </div>
        ))}
      </div>
    </div>
  );

  const body = (
    <div className={`wd-hub-flip wd-hub-rise${canFlip ? " can" : ""}${flipped ? " on" : ""}`} style={{ animationDelay: `${(it.i || 0) * 0.08}s` }}>
      <div className="wd-hub-flip-inner">{front}{back}</div>
    </div>
  );
  return it.to
    ? <Link to={it.to} style={{ textDecoration: "none", color: "inherit", display: "block", height: "100%" }}>{body}</Link>
    : <div style={{ height: "100%" }}>{body}</div>;
}

// Ranks 4+: compact rows.
function RankRows({ rows, max, isMobile, onMore, moreLabel, startDelay = 0 }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${EDGE}`, borderRadius: "18px", overflow: "hidden", boxShadow: "0 4px 14px rgba(15,27,45,0.05)" }}>
      {rows.map((r, i) => {
        const inner = (
          <>
            <span style={{ flexShrink: 0, width: isMobile ? "34px" : "44px", textAlign: "right", fontFamily: DISPLAY, fontSize: isMobile ? "18px" : "22px", color: FAINT, fontVariantNumeric: "tabular-nums" }}>{rankText(r.r, r.t).replace("#", "")}</span>
            {r.art}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
                <span style={{ fontSize: isMobile ? "15px" : "16px", fontWeight: 900, color: inkOf(r.colors) || (r.to ? BLUE : TEXT), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                {r.sub && <span style={{ fontSize: "11px", fontWeight: 700, color: FAINT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sub}</span>}
              </span>
              <span style={{ display: "block", marginTop: "7px" }}><Bar pct={(r.v / (max || 1)) * 100} color={inkOf(r.colors) || BLUE} /></span>
              <ShowChips items={r.chips} />
            </span>
            {r.extra}
            <span style={{ flexShrink: 0, fontFamily: DISPLAY, fontSize: isMobile ? "22px" : "26px", minWidth: "52px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: TEXT }}>{fmt(r.v)}</span>
          </>
        );
        const style = {
          display: "flex", alignItems: "center", gap: isMobile ? "10px" : "16px", padding: isMobile ? "11px 12px" : "12px 20px", textDecoration: "none", color: "inherit", background: CARD,
          borderBottom: i < rows.length - 1 || onMore ? `1px solid ${TRACK}` : "none", animationDelay: `${startDelay + Math.min(i, 12) * 0.03}s`,
        };
        return r.to
          ? <Link key={r.key} to={r.to} className="wd-hub-row wd-hub-rise" style={style}>{inner}</Link>
          : <div key={r.key} className="wd-hub-row wd-hub-rise" style={style}>{inner}</div>;
      })}
      {onMore && (
        <button type="button" onClick={onMore} style={{ width: "100%", padding: "14px", border: "none", background: "#f7f9fc", cursor: "pointer", fontFamily: HEAD, fontWeight: 900, fontSize: "12px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.12em" }}>
          {moreLabel} ↓
        </button>
      )}
    </div>
  );
}

function Loading({ text }) {
  return <div style={{ padding: "40px 0" }}><LoadingSpinner label={text || "Loading"} size={36} minHeight="260px" /></div>;
}

// ── /hs ──
function NationalView() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "schools" ? "schools" : "states";
  const { metric } = useHubRoute();
  const pos = view === "states" && POS_GROUPS.some(([g]) => g === params.get("pos")) ? params.get("pos") : "ALL";
  const set = (k, v, dflt) => {
    const next = new URLSearchParams(params);
    if (v === dflt) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };
  const [count, setCount] = useState(LIST_TOP);
  const hub = useHsDoc("_hub");

  const stateRows = useMemo(() => ranked((hub?.states || []).map((s) => ({
    key: s.a, v: s[metric]?.[pos] || 0, lead: s.lead?.[metric], schools: metric === "cfb" ? s.sc : s.sn,
  }))), [hub, metric, pos]);
  const total = stateRows.reduce((n, r) => n + r.v, 0);
  const schools = hub?.top?.[metric] || [];
  const heat = useMemo(() => (hub?.heat || []).map((h) => [h[0], h[1], metric === "cfb" ? h[2] : h[3]]).filter((h) => h[2] > 0), [hub, metric]);
  const fills = useMemo(() => Object.fromEntries(stateRows.map((r) => [r.key, r.v])), [stateRows]);
  const posName = pos === "ALL" ? "" : POS_GROUPS.find(([g]) => g === pos)[1];
  const years = `${hub?.draftFrom || 2000}–${hub?.draftTo || ""}`;
  const unit = METRIC[metric].unit;

  const stateItem = (r, i) => ({
    key: r.key, r: r.r, t: r.t, i, v: r.v, unit, name: STATE_NAME[r.key], to: hubPath(r.key, metric),
    sub: `${Math.round((r.v / (total || 1)) * 1000) / 10}% of the nation${pos === "ALL" && r.lead ? ` · led by ${r.lead[0]}` : ""}`,
    other: r.schools, otherLabel: "high schools",
    headliner: pos === "ALL" && r.lead ? { label: "Top high school", name: r.lead[0], meta: `${fmt(r.lead[1])} ${unit}` } : null,
  });
  const listTitle = metric === "cfb" ? "In college football" : "Highest draft picks";
  const schoolItem = (r, i) => {
    const list = showcase(metric, r.pl, r.pk, hub?.nflLogos, hub?.collegeLogos);
    return {
      key: `${r.k}|${r.st}`, r: r.r, t: r.t, i, v: r.v, unit, name: r.k, sub: STATE_NAME[r.st] || r.st, to: r.slug ? hsPath(r.slug) : null,
      colors: r.c || null, list, chips: list, listTitle, listTitle1: metric === "cfb" ? null : "Highest pick", flipLabel: metric === "cfb" ? "Players" : `Top ${list.length}`,
      ...(metric === "cfb" ? { posMix: r.pm || null, colleges: r.co || null, collegeLogos: hub?.collegeLogos } : {}),
    };
  };
  const top3 = view === "states"
    ? stateRows.slice(0, 3).map((r, i) => ({ ...stateItem(r, i), art: <StateShape abbr={r.key} size={isMobile ? 54 : 84} light={i === 0} /> }))
    : schools.slice(0, 3).map((r, i) => ({ ...schoolItem(r, i), art: <SchoolMark logo={r.logo} size={isMobile ? 54 : 72} /> }));
  const restSrc = view === "states" ? stateRows.slice(3) : schools.slice(3);
  const rest = restSrc.slice(0, count - 3).map((r, i) => (view === "states"
    ? { ...stateItem(r, i), art: <StateShape abbr={r.key} size={isMobile ? 26 : 30} glow={false} /> }
    : { ...schoolItem(r, i), art: <SchoolMark logo={r.logo} size={isMobile ? 38 : 48} /> }));
  const max = view === "states" ? stateRows[0]?.v : schools[0]?.v;

  return (
    <>
      {metric === "cfb" ? (
        <SeoMeta path="/hs" crumbs={[["High Schools", "/hs"]]}
          title="States & High Schools Producing the Most College Football Players | We-Draft.com"
          description={`Which states and high schools have the most players on ${hub?.season || "this season's"} FBS rosters? Rankings, a nationwide heatmap, and every state's top programs.`} />
      ) : (
        <SeoMeta path="/hs/nfl" crumbs={[["High Schools", "/hs"], ["NFL Draft", "/hs/nfl"]]}
          title="Which States & High Schools Produce the Most NFL Draft Picks | We-Draft.com"
          description={`Every NFL draft pick since ${hub?.draftFrom || 2000}, traced to the high school they played for. Top states, top high schools, and the highest picks.`} />
      )}
      <Stage isMobile={isMobile}
        left={hub ? <StateRankSide hub={hub} metric={metric} current={null} /> : null}
        right={hub ? <TopSide doc={hub} metric={metric} scopeName="U.S." /> : null}>
        <Hero isMobile={isMobile} kicker="High School Football"
          title={<>Where the talent<br />comes from</>}
          sub={metric === "cfb"
            ? `The states and high schools producing the most college football players: every player on a ${hub?.season || ""} FBS roster, traced back to the high school they played for${posName ? ` · ${posName}` : ""}.`
            : `The states and high schools producing the most NFL draft picks: every pick ${years}, traced back to the high school they played for${posName ? ` · ${posName}` : ""}.`}
          big={hub ? total : null} bigLabel={metric === "cfb" ? "College players" : "Draft picks"} />

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <Segmented big options={[["states", "States"], ["schools", "High Schools"]]} value={view} onChange={(v) => { setCount(LIST_TOP); set("view", v, "states"); }} />
          <Segmented options={Object.entries(METRIC).map(([k, m]) => [k, m.label])} value={metric} onChange={(k) => navigate({ pathname: hubPath(null, k), search: params.toString() }, { replace: true })} />
          <StateSelect isMobile={isMobile} metric={metric} />
        </div>
        {view === "states" && (
          <div className="wd-hub-scroll" style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "2px", marginBottom: "8px" }}>
            {[["ALL", "All"], ...POS_GROUPS.map(([g]) => [g, g])].map(([g, label]) => (
              <button key={g} type="button" onClick={() => set("pos", g, "ALL")} style={{
                flexShrink: 0, padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontWeight: 900, fontSize: "11px", fontFamily: HEAD, letterSpacing: "0.06em",
                border: `1px solid ${pos === g ? GOLD : EDGE}`, background: pos === g ? GOLD : "#fff", color: pos === g ? "#fff" : DIM,
              }}>{label}</button>
            ))}
          </div>
        )}

        {hub === undefined ? <Loading /> : !hub ? (
          <div style={{ padding: "60px", textAlign: "center", color: DIM, fontStyle: "italic" }}>Being built — check back soon.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: "10px", margin: "14px 0 6px" }}>
              <Tile isMobile={isMobile} delay={0} label="High schools" value={stateRows.reduce((n, r) => n + (r.schools || 0), 0)} note={`with at least one ${metric === "cfb" ? "player" : "pick"}`} />
              <Tile isMobile={isMobile} delay={0.05} label="States" value={stateRows.length} note={`sending ${unit}`} />
              <Tile isMobile={isMobile} delay={0.1} accent label="Top state" value={stateRows[0] ? STATE_NAME[stateRows[0].key] : "—"} note={stateRows[0] ? `${Math.round((stateRows[0].v / (total || 1)) * 100)}% of all ${unit}` : ""} />
              <Tile isMobile={isMobile} delay={0.15} accent label="Top high school" value={schools[0]?.k || "—"} note={schools[0] ? `${STATE_NAME[schools[0].st] || schools[0].st} · ${fmt(schools[0].v)}` : ""} />
            </div>

            <SectionTitle right={view === "states" ? (posName || "All positions") : "National"}>{view === "states" ? "Top States" : "Top High Schools"}</SectionTitle>
            <TopThree key={`${view}${metric}${pos}`} items={top3} isMobile={isMobile} />
            {rest.length > 0 && (
              <RankRows rows={rest} max={max} isMobile={isMobile}
                onMore={restSrc.length > count - 3 ? () => setCount((c) => c + 10) : null}
                moreLabel={`Show next ${Math.min(10, restSrc.length - (count - 3))}`} startDelay={0.15} />
            )}

            <SectionTitle right={view === "states" ? "Click a state for its page" : "Click a state for its schools"}>
              {view === "states" ? `${METRIC[metric].label} heatmap` : "High school heatmap"}
            </SectionTitle>
            <MapPanel
              isMobile={isMobile}
              title={view === "states" ? `${METRIC[metric].label} by state` : "High school heatmap"}
              mode={view === "states" ? "choropleth" : "heat"}
              values={fills}
              heat={view === "schools" ? heat : null}
              metric={metric}
              onState={(a) => navigate(hubPath(a, metric))}
              rankOf={(a) => stateRows.find((r) => r.key === a)}
            />
          </>
        )}
      </Stage>
    </>
  );
}

// ── /hs/{st} ──
function StateView({ st }) {
  const isMobile = useIsMobile();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { metric } = useHubRoute();
  const setMetric = (k) => navigate({ pathname: hubPath(st, k), search: params.toString() }, { replace: true });
  const [count, setCount] = useState(LIST_TOP);
  const [q, setQ] = useState("");
  useEffect(() => { setCount(LIST_TOP); setQ(""); window.scrollTo(0, 0); }, [st]);
  const data = useHsDoc(`_state_${st}`);
  const hub = useHsDoc("_hub"); // national ranks (cached after /hs)
  const name = STATE_NAME[st];

  const nat = useMemo(() => {
    const out = {};
    ["cfb", "nfl"].forEach((m) => ["ALL", ...POS_GROUPS.map(([g]) => g)].forEach((g) => {
      out[`${m}${g}`] = ranked((hub?.states || []).map((s) => ({ key: s.a, v: s[m]?.[g] || 0 }))).find((x) => x.key === st);
    }));
    return out;
  }, [hub, st]);
  const nStates = hub?.states?.length || 51;
  const idx = metric === "cfb" ? 1 : 2;
  const schools = useMemo(() => ranked((data?.schools || []).map((x) => ({ key: `${x[0]}|${x[7] || ""}`, row: x, v: x[idx] }))), [data, idx]);
  // Mapped schools inside the state's outline (a school placed by its
  // players' hometowns can land over the line — it stays in the numbers).
  const placed = useMemo(() => {
    const shape = usStates()[st];
    if (!shape || !data?.schools) return [];
    const path = new Path2D(shape.d);
    const ctx = document.createElement("canvas").getContext("2d");
    return data.schools.filter((x) => x[3] != null && ctx.isPointInPath(path, x[3], x[4]));
  }, [data, st]);
  const dots = useMemo(() => placed.filter((x) => x[idx] > 0), [placed, idx]);
  const heat = useMemo(() => dots.map((x) => [x[3], x[4], x[idx]]), [dots, idx]);
  const years = `${data?.draftFrom || 2000}–${data?.draftTo || ""}`;
  const unit = METRIC[metric].unit;
  const posMax = Math.max(1, ...POS_GROUPS.map(([g]) => data?.[metric]?.[g] || 0));
  // Search: every school in the state (even ones with 0 here), by name or
  // city — the state doc is already loaded, so no reads.
  const term = q.trim().toLowerCase();
  const rankByKey = new Map(schools.map((r) => [r.key, r]));
  const results = term ? (data?.schools || [])
    .filter((x) => x[0].toLowerCase().includes(term) || String(x[7] || "").toLowerCase().includes(term))
    .sort((a, b) => b[idx] - a[idx] || a[0].localeCompare(b[0]))
    .slice(0, 25)
    .map((x) => {
      const key = `${x[0]}|${x[7] || ""}`;
      const rk = rankByKey.get(key);
      return { key, row: x, v: x[idx], r: rk?.r || null, t: rk?.t || false };
    }) : null;
  const natHere = nat[`${metric}ALL`];

  const listTitle = metric === "cfb" ? "In college football" : "Highest draft picks";
  const item = (r, i) => {
    const list = showcase(metric, r.row[10], r.row[9], data?.nflLogos, data?.collegeLogos);
    return {
      key: r.key, r: r.r, t: r.t, i, v: r.v, unit, name: r.row[0], sub: r.row[7] || null, to: r.row[5] ? hsPath(r.row[5]) : null,
      colors: r.row[8] || null, list, chips: list, listTitle, listTitle1: metric === "cfb" ? null : "Highest pick", flipLabel: metric === "cfb" ? "Players" : `Top ${list.length}`,
      ...(metric === "cfb" ? { posMix: r.row[11] || null, colleges: r.row[12] || null, collegeLogos: data?.collegeLogos } : {}),
      other: metric === "cfb" ? r.row[2] : r.row[1], otherLabel: metric === "cfb" ? "drafted" : "in college",
    };
  };
  const top3 = schools.slice(0, 3).map((r, i) => ({ ...item(r, i), art: <SchoolMark logo={r.row[6]} size={isMobile ? 54 : 72} /> }));
  const restSrc = schools.slice(3);
  const rowItem = (r, i) => {
    const other = metric === "cfb" ? r.row[2] : r.row[1];
    return {
      ...item(r, i), art: <SchoolMark logo={r.row[6]} size={isMobile ? 38 : 48} />,
      extra: other ? (
        <span title={metric === "cfb" ? "NFL draft picks" : "Current college players"} style={{ flexShrink: 0, fontSize: "11px", fontWeight: 900, color: FAINT, whiteSpace: "nowrap" }}>
          {fmt(other)} {metric === "cfb" ? "drafted" : "in college"}
        </span>
      ) : null,
    };
  };
  const rest = restSrc.slice(0, count - 3).map(rowItem);

  return (
    <>
      {(() => {
        const lead = schools[0] ? `, led by ${schools[0].row[0]} (${fmt(schools[0].v)})` : "";
        const n = fmt(data?.[metric]?.ALL || 0);
        return metric === "cfb" ? (
          <SeoMeta path={hubPath(st, "cfb")} crumbs={[["High Schools", "/hs"], [name, hubPath(st, "cfb")]]}
            title={`Best ${name} High Schools for College Football${data?.season ? ` (${data.season})` : ""} | We-Draft.com`}
            description={`${name} high schools ranked by current college football players: ${n} on ${data?.season || "this season's"} FBS rosters${lead}. Top programs, where they play, and a statewide heatmap.`} />
        ) : (
          <SeoMeta path={hubPath(st, "nfl")} crumbs={[["High Schools", "/hs"], [name, hubPath(st, "cfb")], ["NFL Draft", hubPath(st, "nfl")]]}
            title={`${name} High Schools With the Most NFL Draft Picks | We-Draft.com`}
            description={`Every NFL draft pick from a ${name} high school since ${data?.draftFrom || 2000}: ${n} picks${lead}. Top programs, highest picks, and ${name}'s rank among all states.`} />
        );
      })()}
      <Stage isMobile={isMobile}
        left={hub ? <StateRankSide hub={hub} metric={metric} current={st} /> : null}
        right={data ? <TopSide doc={data} metric={metric} scopeName={name} /> : null}>
        <Link to={hubPath(null, metric)} style={{ display: "inline-block", marginBottom: "14px", color: BLUE, textDecoration: "none", fontSize: "11px", fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>← All states</Link>
        <Hero isMobile={isMobile} kicker={natHere ? `${rankText(natHere.r, natHere.t)} of ${nStates} states · ${METRIC[metric].label}` : "High School Football"}
          // The <h1> reads "Georgia High School Football"; the extra words ride small.
          title={<>{name}<span style={{ display: "block", fontSize: "0.36em", letterSpacing: "0.08em", color: DIM, marginTop: "6px" }}>High School Football</span></>}
          sub={metric === "cfb" ? `${METRIC.cfb.long} on ${data?.season || ""} rosters who played high school in ${name}.` : `NFL draft picks ${years} who played high school in ${name}.`}
          art={<StateShape abbr={st} size={isMobile ? 90 : 150} />}
          big={data ? data[metric]?.ALL || 0 : null} bigLabel={metric === "cfb" ? "College players" : "Draft picks"} />

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <Segmented big options={Object.entries(METRIC).map(([k, m]) => [k, m.label])} value={metric} onChange={setMetric} />
          <StateSelect value={st} isMobile={isMobile} metric={metric} />
        </div>

        {data === undefined ? <Loading /> : !data ? (
          <div style={{ padding: "60px", textAlign: "center", color: DIM, fontStyle: "italic" }}>No players from {name} high schools yet.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: "10px", marginBottom: "6px" }}>
              <Tile isMobile={isMobile} delay={0} label="College players" value={data.cfb?.ALL || 0} note={nat.cfbALL ? `${rankText(nat.cfbALL.r, nat.cfbALL.t)} nationally` : `${data.season} FBS rosters`} />
              <Tile isMobile={isMobile} delay={0.05} label="NFL draft picks" value={data.nfl?.ALL || 0} note={nat.nflALL ? `${rankText(nat.nflALL.r, nat.nflALL.t)} nationally · ${years}` : years} />
              <Tile isMobile={isMobile} delay={0.1} label="High schools" value={metric === "cfb" ? data.sc : data.sn} note={`with at least one ${metric === "cfb" ? "player" : "pick"}`} />
              <Tile isMobile={isMobile} delay={0.15} accent label="Top high school" value={schools[0]?.row[0] || "—"} note={schools[0] ? `${fmt(schools[0].v)} ${unit}` : ""} />
            </div>

            {/* By position: a bar per group, its count, and the state's national rank there. */}
            <SectionTitle right="National rank among states">By position</SectionTitle>
            <div className="wd-hub-scroll" style={{ display: "grid", gridTemplateColumns: `repeat(9, minmax(${isMobile ? "52px" : "0"}, 1fr))`, gap: isMobile ? "6px" : "10px", overflowX: isMobile ? "auto" : "visible", background: CARD, border: `1px solid ${EDGE}`, borderRadius: "18px", padding: isMobile ? "14px 10px" : "20px 22px", boxShadow: "0 4px 14px rgba(15,27,45,0.05)" }}>
              {POS_GROUPS.map(([g, label]) => {
                const r = nat[`${metric}${g}`];
                const v = data[metric]?.[g] || 0;
                const hot = r && r.r <= 5;
                return (
                  <div key={g} title={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
                    <div style={{ fontFamily: DISPLAY, fontSize: isMobile ? "18px" : "24px", fontVariantNumeric: "tabular-nums", color: TEXT }}>{fmt(v)}</div>
                    <PosColumn pct={(v / posMax) * 100} hot={hot} height={isMobile ? 70 : 110} />
                    <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 900, color: TEXT }}>{g}</div>
                    <div style={{ fontSize: "10px", fontWeight: 900, color: hot ? GOLD : FAINT, marginTop: "2px" }}>{r ? rankText(r.r, r.t) : "—"}</div>
                  </div>
                );
              })}
            </div>

            <SectionTitle right={`${fmt(schools.length)} schools`}>{term ? `${name} high schools` : `Top ${name} high schools`}</SectionTitle>
            <div style={{ position: "relative", marginBottom: "14px" }}>
              <span aria-hidden="true" style={{ position: "absolute", left: "16px", top: "50%", transform: "translateY(-50%)", fontSize: "15px", color: FAINT }}>⌕</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${name} high schools or cities…`} aria-label={`Search ${name} high schools`}
                style={{ width: "100%", boxSizing: "border-box", padding: "13px 16px 13px 40px", borderRadius: "14px", border: `1px solid ${EDGE}`, background: "#fff", fontFamily: HEAD, fontWeight: 800, fontSize: "14px", color: TEXT, outline: "none", boxShadow: "0 4px 14px rgba(15,27,45,0.05)" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BLUE; }} onBlur={(e) => { e.currentTarget.style.borderColor = EDGE; }} />
            </div>
            {results ? (
              results.length ? (
                <RankRows rows={results.map(rowItem)} max={schools[0]?.v} isMobile={isMobile} />
              ) : <div style={{ padding: "30px", textAlign: "center", color: DIM, fontStyle: "italic", background: CARD, border: `1px solid ${EDGE}`, borderRadius: "18px" }}>No {name} high schools match &ldquo;{q.trim()}&rdquo;.</div>
            ) : schools.length === 0 ? <div style={{ padding: "30px", textAlign: "center", color: DIM, fontStyle: "italic" }}>None yet.</div> : (
              <>
                <TopThree key={`${st}${metric}`} items={top3} isMobile={isMobile} />
                {rest.length > 0 && <RankRows rows={rest} max={schools[0]?.v} isMobile={isMobile}
                  onMore={restSrc.length > count - 3 ? () => setCount((c) => c + 10) : null}
                  moreLabel={`Show next ${Math.min(10, restSrc.length - (count - 3))}`} startDelay={0.15} />}
              </>
            )}

            <SectionTitle right={`${fmt(dots.length)} of ${fmt(schools.length)} schools mapped`}>{`${name} heatmap`}</SectionTitle>
            <MapPanel isMobile={isMobile} title={`${name} heatmap`} mode="heat" focus={st} heat={heat} dots={dots} metric={metric} idx={idx} />
          </>
        )}
      </Stage>
    </>
  );
}

function PosColumn({ pct, hot, height }) {
  const [h, setH] = useState(0);
  useEffect(() => { const r = requestAnimationFrame(() => setH(pct)); return () => cancelAnimationFrame(r); }, [pct]);
  const c = hot ? GOLD : BLUE;
  return (
    <div style={{ width: "100%", maxWidth: "46px", height, marginTop: "6px", borderRadius: "8px", background: TRACK, display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
      <div style={{ width: "100%", height: `${Math.max(3, h)}%`, borderRadius: "8px", background: `linear-gradient(180deg, ${c}, ${c}99)`, transition: "height .9s cubic-bezier(.2,.7,.2,1)" }} />
    </div>
  );
}

const ZOOM_BTN = {
  width: "34px", height: "34px", padding: 0, margin: 0, borderRadius: "10px", border: `1px solid ${EDGE}`, background: "#fff", color: TEXT,
  fontFamily: HEAD, fontWeight: 900, fontSize: "18px", lineHeight: 1, cursor: "pointer", boxShadow: "0 2px 8px rgba(15,27,45,0.12)",
  display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, textTransform: "none", letterSpacing: 0,
};

// ── the map: SVG outlines (+ choropleth fills) under one heat canvas ──
// mode "choropleth": states filled by values[abbr]; "heat": a glow from
// heat [[x, y, w]] (frame coords), clipped to the land (or to `focus`).
// dots (state view): every school, hover/click for its numbers.
// Zoom: { z, cx, cy } over the base frame — the viewBox shrinks around
// (cx, cy); strokes, dots and the heat brush stay a constant screen size.
const ZMAX = 10;
function MapPanel({ isMobile, title, mode, values, heat, dots, focus, metric, idx, onState, rankOf }) {
  const navigate = useNavigate();
  // Full screen: the panel fills the window (Esc or ✕ to leave); a plain
  // wheel zooms there since there's no page to scroll.
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setFull(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [full]);
  const shapes = useMemo(() => usStates(), []);
  const wrapRef = useRef(null);
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { w: avail, h: availH } = useSize(wrapRef);
  const [tip, setTip] = useState(null);

  // Base frame: the whole country, or the focused state padded. Inline the
  // panel takes the frame's shape; full screen fills the window, so the
  // frame widens (or heightens) around its center to the window's shape.
  const raw = useMemo(() => {
    if (!focus || !shapes[focus]) return [0, 0, US_FRAME[0], US_FRAME[1]];
    const [x0, y0, x1, y1] = shapes[focus].bbox;
    const pad = Math.max(x1 - x0, y1 - y0) * 0.08;
    return [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2];
  }, [focus, shapes]);
  const maxH = full ? Math.max(200, availH) : isMobile ? 420 : 600;
  const W = full ? avail : Math.max(0, Math.min(avail, (maxH * raw[2]) / raw[3]));
  const H = full ? maxH : W ? (W * raw[3]) / raw[2] : 0;
  const base = useMemo(() => {
    if (!full || !W || !H) return raw;
    const aspect = W / H;
    const [x, y, w, h] = raw;
    if (w / h < aspect) { const w2 = h * aspect; return [x - (w2 - w) / 2, y, w2, h]; }
    const h2 = w / aspect;
    return [x, y - (h2 - h) / 2, w, h2];
  }, [raw, full, W, H]);
  const home = useMemo(() => ({ z: 1, cx: base[0] + base[2] / 2, cy: base[1] + base[3] / 2 }), [base]);
  const [zoom, setZoom] = useState(home);
  useEffect(() => setZoom(home), [home]);
  const clampZoom = useCallback((z, cx, cy) => {
    const zz = Math.max(1, Math.min(ZMAX, z));
    const hw = base[2] / (2 * zz);
    const hh = base[3] / (2 * zz);
    return {
      z: zz,
      cx: Math.max(base[0] + hw, Math.min(base[0] + base[2] - hw, cx)),
      cy: Math.max(base[1] + hh, Math.min(base[1] + base[3] - hh, cy)),
    };
  }, [base]);
  const vb = useMemo(() => {
    const w = base[2] / zoom.z;
    const h = base[3] / zoom.z;
    return [zoom.cx - w / 2, zoom.cy - h / 2, w, h];
  }, [base, zoom]);

  const k = W ? W / vb[2] : 1;

  // Zoom by `f` keeping the frame point under screen (sx, sy) in place.
  const zoomAt = useCallback((f, sx = W / 2, sy = H / 2) => {
    setZoom((cur) => {
      const w = base[2] / cur.z;
      const h = base[3] / cur.z;
      const kk = W / w;
      const fx = cur.cx - w / 2 + sx / kk;
      const fy = cur.cy - h / 2 + sy / kk;
      const z2 = Math.max(1, Math.min(ZMAX, cur.z * f));
      const w2 = base[2] / z2;
      const h2 = base[3] / z2;
      const k2 = W / w2;
      return clampZoom(z2, fx - sx / k2 + w2 / 2, fy - sy / k2 + h2 / 2);
    });
  }, [W, H, base, clampZoom]);

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms;
  // a plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!full && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, W, full]);

  // Drag to pan (when zoomed); two fingers pinch.
  const ptrs = useRef(new Map());
  const drag = useRef(null);
  const moved = useRef(false);
  const onPointerDown = (e) => {
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (ptrs.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, cx: zoom.cx, cy: zoom.cy };
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      drag.current = { pinch: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  };
  const onPointerMove = (e) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (d && ptrs.current.size === 2 && d.pinch) {
      const [a, b] = [...ptrs.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = boxRef.current.getBoundingClientRect();
      zoomAt(dist / d.pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      d.pinch = dist;
      moved.current = true;
      return;
    }
    if (d && !d.pinch && ptrs.current.size === 1 && zoom.z > 1) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
      if (moved.current) {
        if (!boxRef.current.hasPointerCapture?.(e.pointerId)) boxRef.current.setPointerCapture?.(e.pointerId);
        setTip(null);
        setZoom(clampZoom(zoom.z, d.cx - dx / k, d.cy - dy / k));
        return;
      }
    }
    if (dots) onHover(e);
  };
  const onPointerUp = (e) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) drag.current = null;
  };

  const max = useMemo(() => Math.max(1, ...Object.values(values || {})), [values]);
  const fillOf = (a) => {
    if (mode !== "choropleth") return !focus ? "#e6ecf4" : a === focus ? "#e4ebf5" : "#f4f6fa";
    const v = values?.[a] || 0;
    return v ? rgb(rampAt(0.06 + 0.94 * Math.sqrt(v / max))) : "#f1f4f8";
  };

  // Heat: alpha pass with one blurred brush, colorize through the ramp,
  // clip to the land. Redrawn when the points, size or zoom change.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !W || mode !== "heat" || !heat?.length) { if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext("2d");
    const r = Math.round((focus ? (isMobile ? 18 : 26) : (isMobile ? 9 : 14)) * Math.min(2.4, Math.sqrt(zoom.z)) * dpr);
    const brush = document.createElement("canvas");
    brush.width = brush.height = r * 2;
    const b = brush.getContext("2d");
    const g = b.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    b.fillStyle = g;
    b.fillRect(0, 0, r * 2, r * 2);

    const sorted = heat.map((p) => p[2]).sort((a, c) => a - c);
    const top = sorted[Math.floor(sorted.length * 0.98)] || sorted[sorted.length - 1] || 1;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const pad = r / (k * dpr);
    heat.forEach(([x, y, w]) => {
      if (x < vb[0] - pad || x > vb[0] + vb[2] + pad || y < vb[1] - pad || y > vb[1] + vb[3] + pad) return;
      ctx.globalAlpha = Math.max(0.12, Math.min(1, Math.sqrt(w / top)));
      ctx.drawImage(brush, (x - vb[0]) * k * dpr - r, (y - vb[1]) * k * dpr - r);
    });
    ctx.globalAlpha = 1;

    // 256-step lookup from the ramp; alpha grows with intensity.
    const lut = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const c = rampAt(0.18 + (i / 255) * 0.82);
      lut.set([c[0], c[1], c[2], Math.min(255, 40 + i * 1.25)], i * 4);
    }
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const px = img.data;
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      if (!a) continue;
      const j = a * 4;
      px[i - 3] = lut[j]; px[i - 2] = lut[j + 1]; px[i - 1] = lut[j + 2]; px[i] = lut[j + 3];
    }
    ctx.putImageData(img, 0, 0);

    ctx.globalCompositeOperation = "destination-in";
    ctx.setTransform(k * dpr, 0, 0, k * dpr, -vb[0] * k * dpr, -vb[1] * k * dpr);
    ctx.fillStyle = "#000";
    // One combined path: destination-in per shape would erase all but the last.
    ctx.fill(new Path2D((focus ? [shapes[focus]] : Object.values(shapes)).map((s) => s.d).join("")));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }, [heat, W, H, k, vb, zoom.z, mode, focus, shapes, isMobile]);

  // Nearest school to the pointer (state view).
  const onHover = (e) => {
    if (!dots?.length) return;
    const rect = boxRef.current.getBoundingClientRect();
    const fx = vb[0] + (e.clientX - rect.left) / k;
    const fy = vb[1] + (e.clientY - rect.top) / k;
    let best = null; let bd = (14 / k) ** 2;
    dots.forEach((d) => { const dd = (d[3] - fx) ** 2 + (d[4] - fy) ** 2; if (dd < bd) { bd = dd; best = d; } });
    setTip(best ? { x: (best[3] - vb[0]) * k, y: (best[4] - vb[1]) * k, school: best } : null);
  };
  const stateTipAt = (e, abbr) => {
    if (drag.current && moved.current) return;
    const r = boxRef.current.getBoundingClientRect();
    setTip({ state: abbr, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const dotMax = useMemo(() => Math.max(1, ...(dots || []).map((d) => d[idx])), [dots, idx]);
  const stateTip = tip?.state && rankOf?.(tip.state);
  const zoomed = zoom.z > 1.001;

  return (
    <div style={full ? {
      position: "fixed", inset: 0, zIndex: 100000, background: "#fff", padding: isMobile ? "10px" : "16px 24px", display: "flex", flexDirection: "column", fontFamily: HEAD,
    } : { position: "relative", background: "radial-gradient(ellipse at 50% 40%, rgba(0,85,165,0.06), #fff 70%)", border: `1px solid ${EDGE}`, borderRadius: "20px", padding: isMobile ? "12px" : "22px", boxShadow: "0 4px 14px rgba(15,27,45,0.05)" }}>
      {full && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
          <span style={{ width: "4px", height: "22px", borderRadius: "2px", background: GOLD }} />
          <span style={{ fontFamily: DISPLAY, fontSize: isMobile ? "20px" : "26px", textTransform: "uppercase", color: TEXT }}>{title}</span>
          <button type="button" onClick={() => setFull(false)} aria-label="Exit full screen" style={{ ...ZOOM_BTN, marginLeft: "auto", fontSize: "16px" }}>✕</button>
        </div>
      )}
      <div ref={wrapRef} style={{ width: "100%", flex: full ? 1 : undefined, minHeight: 0, position: "relative" }}>
        {W > 0 && (
          <div ref={boxRef}
            style={{ position: "relative", width: W, height: H, margin: "0 auto", overflow: "hidden", borderRadius: "12px", userSelect: "none", WebkitUserSelect: "none", touchAction: zoomed ? "none" : "pan-y", cursor: zoomed ? (drag.current ? "grabbing" : "grab") : tip?.school?.[5] ? "pointer" : "default" }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onMouseLeave={() => setTip(null)}
            onClick={() => { if (!moved.current && tip?.school?.[5]) navigate(hsPath(tip.school[5])); }}>
            <svg viewBox={vb.join(" ")} width={W} height={H} style={{ position: "absolute", inset: 0, display: "block" }} role="img"
              aria-label={focus ? `${STATE_NAME[focus]} high school heatmap` : "US map"}>
              {Object.values(shapes).map((s) => (
                <path key={s.abbr} d={s.d} fill={fillOf(s.abbr)}
                  stroke={focus && s.abbr === focus ? "#9fb0c6" : "#fff"}
                  strokeWidth={(focus && s.abbr === focus ? 1.6 : 1) / k}
                  style={{ cursor: onState && !zoomed ? "pointer" : undefined, transition: "fill .5s ease" }}
                  onMouseEnter={onState ? (e) => stateTipAt(e, s.abbr) : undefined}
                  onMouseMove={onState ? (e) => stateTipAt(e, s.abbr) : undefined}
                  onClick={onState ? () => { if (!moved.current) onState(s.abbr); } : undefined} />
              ))}
              {tip?.state && <path d={shapes[tip.state].d} fill="rgba(246,162,29,0.14)" stroke={GOLD} strokeWidth={2.4 / k} pointerEvents="none" />}
            </svg>
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: W, height: H, pointerEvents: "none", display: mode === "heat" ? "block" : "none" }} />
            {dots && (
              <svg viewBox={vb.join(" ")} width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {dots.map((d, i) => (
                  <circle key={i} cx={d[3]} cy={d[4]} r={(1.6 + 3.4 * Math.sqrt(d[idx] / dotMax)) * Math.min(1.8, Math.sqrt(zoom.z)) / k} fill="#fff" fillOpacity={0.95} stroke={NAVY} strokeWidth={0.8 / k} />
                ))}
                {tip?.school && <circle cx={tip.school[3]} cy={tip.school[4]} r={8 / k} fill="none" stroke={GOLD} strokeWidth={2.5 / k} />}
                {/* Zoomed in: the bigger schools get names. */}
                {zoom.z >= 2.5 && dots.filter((d) => d[idx] >= Math.max(2, dotMax / (zoom.z * 1.5)) && d[3] >= vb[0] && d[3] <= vb[0] + vb[2] && d[4] >= vb[1] && d[4] <= vb[1] + vb[3]).slice(0, 40).map((d, i) => (
                  <text key={`l${i}`} x={d[3] + 7 / k} y={d[4] + 4 / k} fontSize={11 / k} fontWeight="900" fill={TEXT} stroke="#fff" strokeWidth={3 / k} paintOrder="stroke" style={{ fontFamily: HEAD }}>{d[0]}</text>
                ))}
              </svg>
            )}
            {tip && (tip.school || tip.state) && (
              <div style={{
                position: "absolute", left: Math.min(Math.max(tip.x, 100), W - 100), top: tip.y, transform: `translate(-50%, ${tip.y < 100 ? "18px" : "calc(-100% - 16px)"})`,
                background: TEXT, color: "#fff", borderRadius: "12px", padding: "10px 14px", pointerEvents: "none", whiteSpace: "nowrap",
                boxShadow: "0 12px 30px rgba(15,27,45,0.3)", fontSize: "12px", fontWeight: 800, zIndex: 2, borderTop: `3px solid ${GOLD}`,
              }}>
                {tip.school ? (
                  <>
                    <div style={{ fontFamily: DISPLAY, fontSize: "18px", textTransform: "uppercase", lineHeight: 1.1 }}>{tip.school[0]}</div>
                    {tip.school[7] && <div style={{ color: "rgba(255,255,255,0.65)", fontSize: "11px" }}>{tip.school[7]}</div>}
                    <div style={{ display: "flex", gap: "14px", marginTop: "6px" }}>
                      <span><b style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 400, color: metric === "cfb" ? GOLD : "#fff" }}>{fmt(tip.school[1])}</b> in college</span>
                      <span><b style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 400, color: metric === "nfl" ? GOLD : "#fff" }}>{fmt(tip.school[2])}</b> drafted</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontFamily: DISPLAY, fontSize: "18px", textTransform: "uppercase", lineHeight: 1.1 }}>{STATE_NAME[tip.state]}</div>
                    <div style={{ marginTop: "4px" }}>
                      <b style={{ fontFamily: DISPLAY, fontSize: "18px", fontWeight: 400, color: GOLD }}>{fmt(stateTip?.v || 0)}</b> {METRIC[metric].unit}{stateTip ? ` · ${rankText(stateTip.r, stateTip.t)}` : ""}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Zoom controls */}
            <div style={{ position: "absolute", top: "10px", right: "10px", display: "flex", flexDirection: "column", gap: "6px", zIndex: 3 }}
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="wd-hub-zoom" aria-label="Zoom in" disabled={zoom.z >= ZMAX} onClick={() => zoomAt(1.6)} style={{ ...ZOOM_BTN, opacity: zoom.z >= ZMAX ? 0.4 : 1 }}>+</button>
              <button type="button" className="wd-hub-zoom" aria-label="Zoom out" disabled={!zoomed} onClick={() => zoomAt(1 / 1.6)} style={{ ...ZOOM_BTN, opacity: zoomed ? 1 : 0.4, cursor: zoomed ? "pointer" : "default" }}>−</button>
              {zoomed && <button type="button" className="wd-hub-zoom" aria-label="Reset zoom" title="Reset" onClick={() => setZoom(home)} style={{ ...ZOOM_BTN, fontSize: "15px" }}>⟲</button>}
              <button type="button" className="wd-hub-zoom" aria-label={full ? "Exit full screen map" : "Full screen map"} title={full ? "Exit full screen" : "Full screen map"}
                onClick={() => setFull((f) => !f)} style={{ ...ZOOM_BTN, fontSize: "15px", marginTop: "4px" }}>{full ? "✕" : "⛶"}</button>
            </div>
          </div>
        )}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "14px", fontSize: "10px", fontWeight: 900, color: FAINT, textTransform: "uppercase", letterSpacing: "0.1em", flexWrap: "wrap" }}>
        <span>Fewer</span>
        <span style={{ width: "150px", height: "8px", borderRadius: "4px", background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => rgb(rampAt(0.06 + 0.94 * t))).join(",")})` }} />
        <span>More {METRIC[metric].unit}</span>
        <span style={{ marginLeft: "auto", letterSpacing: "0.04em", textAlign: "right" }}>
          {isMobile ? "+ / − or pinch to zoom · drag to move" : full ? "Scroll or + / − to zoom · drag to move · Esc to exit" : "+ / − or Ctrl + scroll to zoom · drag to move · ⛶ full screen"}
          {mode === "choropleth" ? ` · highest ${fmt(max)}` : dots ? " · hover a school" : ""}
        </span>
      </div>
    </div>
  );
}
