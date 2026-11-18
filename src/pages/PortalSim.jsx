// src/pages/PortalSim.jsx
//
// /portalsim (/portalsim/:team) — the Portal Sim: the transfer portal's
// version of the Draft Sim (pages/DraftSim.jsx). Pick a team; two opening
// windows focus on that team alone (user, 2026-11-14):
//   Opening 1  NFL decisions — who's out of eligibility or gone to the draft;
//              the user can try to keep players on the fence
//   Opening 2  retention — who wants to transfer; keep them or lose them to
//              the portal
// Every window advances from the sticky header; each one's work and results
// live in tabs (NFL Decisions, Leaving, then the portal's). Players enter the
// portal only in opening window 2. Then the portal opens: each window the
// user makes NIL offers (with a role
// promised), every other FBS school makes its own and players decide. Ten
// portal windows (config). The "Transfer Portal Sim" — public, out of beta
// (user, 2026-11-18).
//
// Setup choices (user, 2026-11-15): transfer frequency (Less / Default /
// More, then Crazy set apart — Default is the tuned model; Crazy lets
// anyone go) and portal length (5, 7 — the default — or 10 windows). The
// real portal (opts.live) opens in January; it skips both opening windows
// and starts on a recap of who left and why (engine openLivePortal).
// Program tiers stay behind the scenes (user, 2026-11-18).
// The portal's shape (user, 2026-11-18): the two opening windows, then 8
// portal windows in two halves of 4 — the big signing wave first (window 1
// is the evaluation period; the players pursued hardest resolve around
// window 4), then MARKET WATCH (stage "market": players a signing pushed
// down the depth chart may enter; a few top players demand the market rate
// or enter — yours decide here), then 4 more where coming in late is easier.
// Coaching staffs (user, 2026-11-18 — engine "Coaching staffs",
// components/portalSim/StaffParts.jsx): five coaches per school. Yours go
// on players on My Board (interest builds every window); your staff
// recommends portal players with a quote (Portal tab ★ picks, My Board, the
// player card), and the head coach briefs you the moment the portal opens.
// Fullscreen (user, 2026-11-14), like the Draft Sim's: the icon in the
// header sends the whole run (header, console, desk, player cards) to the
// screen; the list and desk stretch to fill it.
// The analyst desk (utils/portalSim/desk.js, components/draftSim/SimFeed.jsx)
// runs beside the console on desktop — its own tab on phones. Roster & Needs
// can show any FBS roster. A single position in the Portal / Around the
// Country filters adds sortable Stats (not OL) and Info (height, weight, HS
// stars, state, eligibility) views.
//
// INFRASTRUCTURE FIRST (user, 2026-11-14) — the models are placeholders
// (utils/portalSim/models.js, config.js). Layout follows the Draft Sim: a
// team-colored stage header, then the Console (tabs).
//   engine   utils/portalSim/engine.js     data   utils/portalSim/data.js
//   flow     components/portalSim/usePortalSim.js
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchPortalTeamPage } from "../utils/portalData";
import DepartureIcon from "../components/DepartureIcon";
import { Link, useNavigate, useParams } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import TransferStars from "../components/TransferStars";
import usePortalSim from "../components/portalSim/usePortalSim";
import PlayerCard from "../components/portalSim/PlayerCard";
import { Briefing, StaffStrip, OnHim, RecQuote, RecChip, lastOf, CoachChip } from "../components/portalSim/StaffParts";
import { ROLE_SHORT, ROLE_COLOR, marketReport } from "../utils/portalSim/staff";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS as CSS_DND } from "@dnd-kit/utilities";
import SimFeed from "../components/draftSim/SimFeed";
import { loadPortalSim, money } from "../utils/portalSim/data";
import { mergeConfig } from "../utils/portalSim/config";
import { FBS_CONFERENCES } from "../utils/portalTeams";
import { retainOdds, urgencyOf, teamNeeds, tiesOf, competitive, needLevelOf, effOf, gradeOffer, likelyOffer, releaseValue } from "../utils/portalSim/engine";
import { gradeLabel } from "../utils/gradeScale";
import { SimTabs, MyClasses, PortalCommunity, SaveClassButton, ShareClass, DraftSimPromo, useBranding } from "../components/portalSim/PortalCommunity";
import PortalTutorial from "../components/portalSim/PortalTutorial";
import { useScrollLock } from "../utils/scrollLock";
import { CLASSES_PATH, COMMUNITY_PATH, RECENT_PATH, recordPortalResult } from "../utils/portalSim/publicSims";
import { portalSimYear } from "../utils/portalSim/meta";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const BG = "#070d18";
const PANEL = { background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, overflow: "hidden" };
const INK = "#eef2f8";
const SUB = "#8b9bb4";
const LINE = "#1f2b42";
// Position tabs — K and P share one so they fit a row.
const POS_TABS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K/P"];
const ROLE_LABEL = { starter: "Starter", rotation: "Rotation", reserve: "Reserve", none: "Didn't play" };
const GONE_LABEL = { exhausted: "Out of eligibility", declared: "Declared", grade: "First-round grade", chose: "Chose the draft" };
const WANTS_LABEL = { level: "Wants a bigger stage", snaps: "Wants snaps", money: "Wants a bigger NIL deal", home: "Wants to be closer to home", winning: "Wants to win", development: "Wants to develop", roster: "Cut for roster space", released: "Released" };
// The portal mark, in white (public/logos).
const PORTAL_MARK = "/logos/transfer-portal-white.svg";
const DESK_FILTERS = [["all", "All"], ["mine", "My Team"]];
const DESK_HEIGHT = 772; // the console: its tab bar + the 720px list
// Fullscreen: the list and desk fill the screen under the header.
const FS_LIST = "calc(100vh / var(--pz, 1) - 240px)"; // the page zoom (--pz) scales CSS px
const FS_DESK = "calc(100vh / var(--pz, 1) - 188px)";

// Is the run fullscreen? (and the toggle) — the browser's Fullscreen API on
// the run's wrapper; null where the browser can't (iPhone Safari).
function useFullscreen(ref) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const node = ref.current;
    const sync = () => setOn(!!document.fullscreenElement && document.fullscreenElement === node);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      // Leaving the run (Settings, a new team) leaves fullscreen too.
      if (document.fullscreenElement && document.fullscreenElement === node) document.exitFullscreen?.().catch(() => {});
    };
  }, [ref]);
  if (typeof document === "undefined" || !document.fullscreenEnabled) return [false, null];
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else ref.current?.requestFullscreen?.().catch(() => {});
  };
  return [on, toggle];
}
function FullscreenBtn({ on, onClick }) {
  return (
    <button type="button" onClick={onClick} title={on ? "Exit fullscreen (Esc)" : "Fullscreen"} aria-label={on ? "Exit fullscreen" : "Fullscreen"} aria-pressed={on}
      style={{ ...pillBtn(false), padding: "9px 11px", lineHeight: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.3)", borderColor: "rgba(255,255,255,0.25)", color: "#fff", flexShrink: 0 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {on ? <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /> : <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />}
      </svg>
    </button>
  );
}
const STAGE_TITLE = { nfl: "NFL Decisions", retain: "Retention" };
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
// How a draft prospect is leaning (chance he leaves).
const leanLabel = (c) => (c >= 0.7 ? ["Leaning NFL", "#ff8a7a"] : c >= 0.4 ? ["Toss-up", GOLD] : ["Leaning back", "#7ee2a8"]);
// The few Draft Sim styles this page uses (components/draftSim/SimBroadcast
// SIM_CSS) — copied rather than importing that whole module.
const CSS = `
  @keyframes wdSimPop { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
  .wd-sim-pop { animation: wdSimPop .5s cubic-bezier(.2,.8,.2,1) both; }
  .wd-sim-row:hover { background: #16213a !important; }
  .wd-sim-scroll { scrollbar-width: thin; scrollbar-color: #f6a21d #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar { width: 10px; }
  .wd-sim-scroll::-webkit-scrollbar-track { background: #0b1322; }
  .wd-sim-scroll::-webkit-scrollbar-thumb { background: linear-gradient(#f6a21d, #0055a5); border-radius: 999px; border: 2px solid #0b1322; }
  html.wd-sim-dark, html.wd-sim-dark body { background: #070d18; }
  html.wd-sim-lock, html.wd-sim-lock body { overflow: hidden; overscroll-behavior: none; }
  html.wd-sim-navhide .wd-navbar-wrap { transform: translateY(-100%); transition: transform .25s ease !important; }
  html.wd-sim-navhide.wd-sim-navopen .wd-navbar-wrap { transform: none; }
  .wd-sim-nofooter footer { display: none; }
  .wd-ps-tabs { scrollbar-width: none; }
  .wd-ps-right button { padding: 5px 10px !important; font-size: 11px !important; }
  .wd-ps-right > span, .wd-ps-right > div { min-width: 0; }
  .wd-ps-tabs::-webkit-scrollbar { display: none; }
  @keyframes psDrift { 0% { transform: translate(0, 0); } 100% { transform: translate(-80px, -46px); } }
  @keyframes psGlow { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  @keyframes psToast { 0% { opacity: 0; transform: translate(-50%, 10px); } 12%, 80% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -6px); } }
  @media (prefers-reduced-motion: reduce) { .wd-sim-pop, .ps-anim { animation: none !important; } }
`;

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return m;
}

// Logos on the sim's dark panels: LogoBlack, else LogoDark, else Logo1 (the
// pick /player and broadcasts/TeamLogo.js make). onColor — on a team-color
// fill — skips LogoBlack, which is often in the team's color and vanishes.
function Logo({ b, size = 28, onColor = false }) {
  const src = (onColor ? null : b?.LogoBlack) || b?.LogoDark || b?.Logo1;
  return (
    <span style={{ width: size, height: size, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {src ? <img src={src} alt={b?.School || ""} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
    </span>
  );
}

const pillBtn = (on, color = BLUE) => ({
  border: `1px solid ${on ? color : LINE}`, background: on ? color : "transparent", color: on ? "#fff" : INK,
  borderRadius: 999, padding: "6px 12px", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
});

// page: "classes" (/portalsim/classes — My Classes), "community"
// (/portalsim/community — Insights) or "recent" (/portalsim/recent —
// Community's Recent Classes); none: the sim itself (/portalsim,
// /portalsim/{team}). The tabs over it mirror the Draft Sim's (user,
// 2026-11-18): New Portal · My Classes · Community — by route on the setup
// screen, by state over a finished run (it stays mounted, hidden, while
// another tab is open). SEO tags: components/portalSim/PortalSimMeta.jsx
// (App.js) for the sim; each community view sets its own.
const PAGE_PATHS = { classes: CLASSES_PATH, community: COMMUNITY_PATH, recent: RECENT_PATH };
export default function PortalSim({ page = null }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { team: teamParam } = useParams();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState("");
  const [run, setRun] = useState(null); // { team, seed, live }
  const [doneTab, setDoneTab] = useState(null); // over a run's start or finish: "new" | "classes" | "community"
  const [finished, setFinished] = useState(false); // the run's portal has closed
  const [doneView, setDoneView] = useState("insights");
  const branding = useBranding(data?.branding);

  // The pool loads for the sim itself — the community pages only need branding.
  const needData = !page || !!run;
  useEffect(() => {
    if (!needData || data) return;
    loadPortalSim().then(setData).catch((e) => setFailed(e.message || "Couldn't load the Transfer Portal Sim."));
  }, [needData, data]);
  useEffect(() => { document.documentElement.classList.add("wd-sim-dark"); return () => document.documentElement.classList.remove("wd-sim-dark"); }, []);
  // /portalsim/ohio-state starts as that team.
  useEffect(() => {
    if (data && teamParam && !run && data.branding[teamParam] && !data.pool.teams.find((t) => t.slug === teamParam)?.fcs) setRun({ team: teamParam, seed: Math.floor(Math.random() * 1e9), live: false, frequency: "default", windows: mergeConfig(data.config).windows });
  }, [data, teamParam, run]);
  // A new run starts on its own tab.
  useEffect(() => { setDoneTab(null); setFinished(false); }, [run]);

  const tab = page === "recent" || page === "community" ? "community" : page || "new";
  const view = page === "recent" ? "recent" : "insights";
  const setTab = (t) => navigate(PAGE_PATHS[t] || "/portalsim");
  const setView = (v) => navigate(v === "recent" ? RECENT_PATH : COMMUNITY_PATH, { replace: true });
  const tabBody = (t, v, onView) => (t === "classes"
    ? <MyClasses branding={branding} isMobile={isMobile} />
    : <PortalCommunity view={v} onView={onView} branding={branding} isMobile={isMobile} />);
  const doneAway = run && doneTab && doneTab !== "new";
  // Before the run starts (the Ready screen) the first tab is "New Portal";
  // once it's closed, "This Portal" — its Final.
  const doneTabs = <SimTabs tab={doneTab || "new"} thisRun={finished} onTab={setDoneTab} isMobile={isMobile} />;

  return (
    <div style={{ background: BG, minHeight: "100vh", color: INK, fontFamily: "Arial, sans-serif" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "18px 24px 60px" }}>
        {page && !run ? (
          <>
            <SimTabs tab={tab} onTab={setTab} isMobile={isMobile} />
            {tabBody(tab, view, setView)}
          </>
        ) : failed ? <div style={{ ...PANEL, padding: 40, textAlign: "center", color: SUB }}>{failed}</div>
          : !data ? <LoadingSpinner label="Loading every roster" size={48} minHeight="60vh" />
            : run ? (
              <>
                <div style={doneAway ? { display: "none" } : undefined}>
                  <LiveSim key={`${run.team}-${run.seed}-${run.frequency}-${run.windows}`} data={data} run={run} isMobile={isMobile} tabs={doneTabs}
                    onDone={() => { setFinished(true); setDoneTab((t) => t || "new"); }}
                    onSettings={() => { setRun(null); navigate("/portalsim"); }} onRerun={() => setRun({ ...run, seed: Math.floor(Math.random() * 1e9) })} onOptions={(o) => setRun({ ...run, ...o })} />
                </div>
                {doneAway && (
                  <>
                    {doneTabs}
                    {tabBody(doneTab, doneView, setDoneView)}
                  </>
                )}
              </>
            )
              : (
                <>
                  <SimTabs tab="new" onTab={setTab} isMobile={isMobile} />
                  <Setup data={data} isMobile={isMobile} onStart={(r) => { setRun(r); navigate(`/portalsim/${r.team}`); }} />
                </>
              )}
      </div>
    </div>
  );
}

// A setting: a label, its pill options (one segmented group — any in
// `apart` sit a little away from it, in `apartColor`), a note under them.
const FREQ_OPTIONS = [["less", "Less"], ["default", "Default"], ["more", "More"], ["crazy", "Crazy"]];
const FREQ_NOTE = { less: "Fewer players hit the portal.", default: "The portal as the sim models it.", more: "More players looking to move.", crazy: "Total chaos — anyone can go, even players who'd never leave." };
function Choice({ label, note, options, value, onChange, on = BLUE, apart = [], apartColor = "#e5484d" }) {
  const seg = (k, text, color) => (
    <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k} style={{
      border: "none", borderRadius: 999, padding: "7px 14px", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
      background: value === k ? color : "transparent", color: "#fff",
    }}>{text}</button>
  );
  const main = options.filter(([k]) => !apart.includes(k));
  const rest = options.filter(([k]) => apart.includes(k));
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: GOLD, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 999, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)" }}>
          {main.map(([k, text]) => seg(k, text, on))}
        </div>
        {rest.map(([k, text]) => (
          <div key={k} style={{ display: "inline-flex", padding: 3, borderRadius: 999, background: "rgba(0,0,0,0.35)", border: `1px solid ${value === k ? apartColor : "rgba(255,255,255,0.12)"}` }}>
            {seg(k, `${text}${k === "crazy" ? " 🔥" : ""}`, apartColor)}
          </div>
        ))}
      </div>
      {note && <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginTop: 6 }}>{note}</div>}
    </div>
  );
}

// The portal-length setting's note.


// ── Setup: pick a team ──
// The header (user, 2026-11-18): the portal mark, the title, what's in the
// pool, the mode (projected — a disclaimer: these aren't We-Draft.com
// projections; real — opens in January), the run's settings and the way
// to the real Transfer Portal.
function Setup({ data, isMobile, onStart }) {
  const [team, setTeam] = useState("");
  const [live, setLive] = useState(false);
  const [frequency, setFrequency] = useState("default");
  const cfg = mergeConfig(data.config);
  const windows = cfg.windows;
  const liveCount = data.pool.players.filter((p) => p.live).length;
  const fbs = data.pool.teams.filter((t) => !t.fcs).length;
  const byConf = useMemo(() => {
    const groups = {};
    data.pool.teams.forEach((t) => { (groups[t.conference] = groups[t.conference] || []).push(t); });
    Object.values(groups).forEach((list) => list.sort((a, b) => a.school.localeCompare(b.school)));
    return FBS_CONFERENCES.filter((c) => groups[c]).map((c) => [c, groups[c]]);
  }, [data]);
  const b = data.branding[team];
  // The real-portal mode opens when the real portal does (January) — a few
  // early entries don't count (cfg.liveOpens players). Every run uses the
  // real entries regardless (data.js).
  const liveClosed = live && liveCount < (cfg.liveOpens ?? 150);
  const season = data.pool.season ? data.pool.season + 1 : "";
  const chip = (text) => <span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 900, letterSpacing: "0.06em", padding: "5px 11px", borderRadius: 999, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.14)", whiteSpace: "nowrap" }}>{text}</span>;
  const modeBtn = (on, onClick, children) => (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      display: "inline-flex", alignItems: "center", gap: 8, border: `2px solid ${on ? GOLD : "rgba(255,255,255,0.18)"}`, borderRadius: 12, padding: isMobile ? "9px 12px" : "10px 16px",
      background: on ? "rgba(246,162,29,0.16)" : "rgba(0,0,0,0.3)", color: "#fff", fontWeight: 900, fontSize: isMobile ? 13 : 14, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
    }}>{children}</button>
  );
  return (
    <>
      <div style={{ ...PANEL, position: "relative", marginBottom: 14, border: "1px solid #2a3c5e", boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
        background: "radial-gradient(circle at 12% 18%, rgba(246,162,29,0.28), transparent 42%), radial-gradient(circle at 88% 85%, rgba(0,85,165,0.65), transparent 55%), linear-gradient(120deg, #0d2f5c 0%, #0a1430 100%)" }}>
        <div aria-hidden="true" className="ps-anim" style={{ position: "absolute", inset: "-20%", pointerEvents: "none", background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 2px, transparent 2px, transparent 40px)", animation: "psDrift 18s linear infinite" }} />
        <div aria-hidden="true" className="ps-anim" style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(circle at 25% 35%, rgba(255,255,255,0.12), transparent 50%)", animation: "psGlow 5s ease-in-out infinite" }} />
        <img src={PORTAL_MARK} alt="" aria-hidden="true" style={{ position: "absolute", right: isMobile ? -50 : -20, top: "50%", transform: "translateY(-50%) rotate(-8deg)", height: isMobile ? 220 : 380, opacity: 0.07, pointerEvents: "none" }} />
        <div style={{ position: "relative", padding: isMobile ? "22px 16px" : "32px 36px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 14 : 22 }}>
            <img src={PORTAL_MARK} alt="" aria-hidden="true" style={{ width: isMobile ? 54 : 88, height: isMobile ? 54 : 88, flexShrink: 0, filter: "drop-shadow(0 4px 14px rgba(0,0,0,0.5))" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 900, letterSpacing: "0.22em", color: GOLD }}>{season} COLLEGE FOOTBALL</div>
              <h1 style={{ margin: "4px 0 0", fontSize: isMobile ? 32 : 58, fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, letterSpacing: "-0.01em", textShadow: "0 4px 24px rgba(0,0,0,0.45)" }}>
                Transfer <span style={{ color: GOLD }}>Portal</span> Sim
              </h1>
            </div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.86)", fontWeight: 700, fontSize: isMobile ? 13 : 16, maxWidth: 720, marginTop: isMobile ? 12 : 16, lineHeight: 1.45 }}>
            {live
              ? <>Take over a program in the real {season} transfer portal: see who left and why, then work {windows} portal windows against every FBS school.</>
              : <>Take over any FBS program: decide who you can keep from the NFL, fight to hold the players who want out, then work {windows} portal windows while every school chases its needs with its NIL budget.</>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
            {chip(`${fbs} FBS programs`)}
            {chip(`${data.pool.players.length.toLocaleString("en-US")} players`)}
            {chip(`${windows} portal windows`)}
          </div>

          {/* Mode. */}
          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            {modeBtn(!live, () => setLive(false), <>Projected Portal</>)}
            {modeBtn(live, () => setLive(true), <><img src={PORTAL_MARK} alt="" aria-hidden="true" style={{ width: 18, height: 18 }} />Real Portal{liveCount ? ` (${liveCount})` : ""}</>)}
          </div>
          {live ? (
            liveClosed && (
              <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, background: "rgba(246,162,29,0.12)", border: "1px solid rgba(246,162,29,0.5)", fontSize: 13, fontWeight: 800, maxWidth: 720, lineHeight: 1.45 }}>
                <b style={{ color: GOLD }}>Coming in January.</b> The real portal option opens when the transfer portal officially opens in January. Until then, run the projected portal.
              </div>
            )
          ) : (
            <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, background: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.14)", fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)", maxWidth: 720, lineHeight: 1.45 }}>
              <b style={{ color: "#fff" }}>For simulation purposes only.</b> These are not We-Draft.com projections — every entry, offer and commitment in the projected portal is generated by the sim.
            </div>
          )}

          {/* The run's settings. */}
          <div style={{ display: "flex", gap: isMobile ? 14 : 32, marginTop: 18, flexWrap: "wrap" }}>
            {!live && <Choice label="Transfer frequency" note={FREQ_NOTE[frequency]} options={FREQ_OPTIONS} value={frequency} onChange={setFrequency} apart={["crazy"]} />}

          </div>

          {/* How it works, and the real thing. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          <PortalTutorial isMobile={isMobile} />
          <Link to="/portal" style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: isMobile ? "10px 14px" : "11px 18px", borderRadius: 999, background: "#fff", color: BLUE, textDecoration: "none", fontWeight: 900, fontSize: isMobile ? 12 : 13, letterSpacing: "0.06em", textTransform: "uppercase", boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }}>
            <img src="/logos/transfer-portal.svg" alt="" aria-hidden="true" style={{ width: 20, height: 20, filter: "invert(19%) sepia(93%) saturate(2400%) hue-rotate(198deg) brightness(92%)" }} />
            Real Transfer Portal →
          </Link>
          </div>
        </div>
      </div>

      {byConf.map(([conf, list]) => (
        <div key={conf} style={{ ...PANEL, marginBottom: 10 }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${LINE}`, fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", color: SUB, textTransform: "uppercase" }}>{conf}</div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 96 : 120}px, 1fr))`, gap: 6, padding: 10 }}>
            {list.map((t) => {
              const tb = data.branding[t.slug];
              const on = team === t.slug;
              return (
                <button key={t.slug} type="button" onClick={() => setTeam(t.slug)} style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 6px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                  border: `2px solid ${on ? GOLD : "transparent"}`, background: on ? `color-mix(in srgb, ${tb?.Color1 || BLUE} 45%, #0e1626)` : "#111a2b", color: INK,
                }}>
                  <Logo b={tb} size={isMobile ? 34 : 40} />
                  <span style={{ fontSize: 12, fontWeight: 900, textAlign: "center", lineHeight: 1.15 }}>{t.school}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Sticky start bar. */}
      <div style={{ position: "sticky", bottom: 10, marginTop: 12, ...PANEL, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, background: b ? `linear-gradient(120deg, ${b.Color1 || BLUE}, #0e1626)` : "#0e1626" }}>
        {b ? <Logo onColor b={b} size={40} /> : null}
        <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: isMobile ? 14 : 17 }}>
          {b ? b.School : "Pick a program"}
          {liveClosed && <div style={{ fontSize: 11, fontWeight: 800, color: GOLD }}>The real portal opens in January</div>}
        </div>
        <button type="button" disabled={!team || liveClosed} onClick={() => onStart({ team, seed: Math.floor(Math.random() * 1e9), live, frequency: live ? "default" : frequency, windows })} style={{
          border: "none", borderRadius: 999, padding: "11px 22px", fontWeight: 900, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
          background: team && !liveClosed ? (b?.Color2 || GOLD) : "#1a2438", color: "#fff", cursor: team && !liveClosed ? "pointer" : "default",
        }}>Continue →</button>
      </div>
    </>
  );
}

// ── The sim ──
// tabs: the New / My Classes / Community bar, over the Final; onDone: the portal closed.
function LiveSim({ data, run, isMobile, onSettings, onRerun, onOptions, tabs: doneTabs, onDone }) {
  const sim = usePortalSim({ data, team: run.team, seed: run.seed, live: run.live, frequency: run.frequency, windows: run.windows });
  const { state, phase, view, stage } = sim;
  useEffect(() => { if (phase === "done" && onDone) onDone(); }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const portalOpen = stage === "window" || stage === "done" || stage === "market";
  const market = stage === "market";
  const split = state.cfg.split?.at ?? 0;
  const b = data.branding[run.team] || {};
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const brand = (slug) => data.branding[slug];

  // Tabs by window: NFL Decisions (opening window 1), Leaving (opening
  // window 2), then — once the portal opens — Results first, the portal's
  // tabs, and Leaving. NFL decisions live in Roster & Needs from then on.
  // Each window lands on its first tab.
  // Roster & Needs sits right after My Board (user, 2026-11-18).
  const tabs = [
    ...(market ? [["market", `Market Watch${view.considering.length ? ` (${view.considering.length})` : ""}`]] : []),
    ...(portalOpen && !market ? [["results", "Results"], ["portal", `Portal (${sim.portal.length})`], ["board", `My Board (${sim.board.count}/${sim.board.limit})`], ["needs", "Roster & Needs"]] : []),
    ...(!portalOpen ? [["nfl", stage === "nfl" ? `NFL Decisions (${view.considering.length})` : "NFL Decisions"]] : []),
    ...(stage !== "nfl" && stage !== "ready" && !market ? [["leaving", stage === "retain" ? `Leaving (${view.considering.length})` : "Leaving"]] : []),
    ...(!portalOpen ? [["needs", "Roster & Needs"]] : []),
    ...(isMobile ? [["desk", "The Desk"]] : []),
  ];
  const [tabPick, setTab] = useState(null);
  useEffect(() => { setTab(null); }, [stage, state.window]);
  const tab = tabs.some(([k]) => k === tabPick) ? tabPick : market ? "market" : stage === "retain" ? "leaving" : portalOpen ? "results" : "nfl";

  const label = phase === "done" ? "PORTAL CLOSED" : phase === "simming" ? "SIMMING…" : stage === "ready" ? "READY TO START"
    : stage === "nfl" ? (isMobile ? "WINDOW 1 · NFL" : "OPENING WINDOW 1 · NFL DECISIONS") : stage === "retain" ? (isMobile ? "WINDOW 2 · LEAVING" : "OPENING WINDOW 2 · LEAVING")
      : market ? (isMobile ? "MARKET WATCH" : `MARKET WATCH · BETWEEN WINDOWS ${split} & ${split + 1}`)
      : sim.board.evalPeriod ? (isMobile ? `EVALUATION ${state.window}/${state.windows}` : `EVALUATION PERIOD · WINDOW ${state.window} OF ${state.windows}`)
        : isMobile ? `PORTAL ${state.window}/${state.windows}` : `PORTAL WINDOW ${state.window} OF ${state.windows}`;
  // Phones get the short labels so the school name fits.
  const advance = stage === "ready" ? ["Start", sim.start]
    : phase === "simming" ? ["Simming…", null]
      : phase === "window" ? [stage === "nfl" ? (isMobile ? "Lock In →" : "Lock NFL Decisions →") : stage === "retain" ? (isMobile ? "Open Portal →" : "Open the Portal →")
        : market ? (isMobile ? "Continue →" : `On to Window ${split + 1} →`)
        : state.window >= state.windows ? (isMobile ? "Close →" : "Close the Portal →") : sim.board.evalPeriod ? (isMobile ? "Start Offers →" : "End Evaluation →") : isMobile ? "End Window →" : `End Window ${state.window} →`, sim.end]
        : null;
  const pctOf = (n) => `${Math.min(100, (n / Math.max(1, view.budget)) * 100)}%`;
  const fsRef = useRef(null);
  const [fs, toggleFs] = useFullscreen(fsRef);
  // The head coach's briefing: once, as portal window 1 opens (reopened
  // from the console's "Coach's Briefing").
  const [brief, setBrief] = useState(false);
  const briefed = useRef(false);
  useEffect(() => {
    if (stage === "window" && state.window === 1 && phase === "window" && !briefed.current) { briefed.current = true; setBrief(true); }
  }, [stage, state.window, phase]);

  const body = tab === "desk" ? <SimFeed feed={sim.feed} branding={data.branding} height="auto" isMobile filters={DESK_FILTERS} />
    : tab === "market" ? <MarketTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
      : tab === "nfl" ? <NflTab sim={sim} team={run.team} isMobile={isMobile} />
        : tab === "leaving" ? <LeavingTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
          : tab === "portal" ? <PortalTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
            : tab === "board" ? <BoardTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
              : tab === "results" ? <ResultsTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
                : <NeedsTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />;

  // ── Phones, mid-run (user, 2026-11-18 — the Draft Sim's way): one screen
  // pinned to the viewport. The header and the tab bar never move; only the
  // tab's content scrolls (up and down — nothing wider than the screen). The
  // page itself doesn't scroll (wd-sim-lock), the footer is hidden, and the
  // navbar slides up out of the way with an arrow tab to bring it back.
  const live = isMobile && (phase === "window" || phase === "simming");
  const [navOpen, setNavOpen] = useState(false);
  const bodyRef = useRef(null);
  useEffect(() => {
    if (!live) return undefined;
    const html = document.documentElement;
    window.scrollTo(0, 0);
    document.body.classList.add("wd-sim-nofooter");
    html.classList.add("wd-sim-lock", "wd-sim-navhide");
    return () => {
      document.body.classList.remove("wd-sim-nofooter");
      html.classList.remove("wd-sim-lock", "wd-sim-navhide", "wd-sim-navopen");
    };
  }, [live]);
  useEffect(() => { document.documentElement.classList.toggle("wd-sim-navopen", live && navOpen); }, [live, navOpen]);
  // A new tab (or window) starts at its top.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [tab, state.window, stage]);
  if (live) {
    const school = b.School || "";
    const schoolSize = Math.max(13, Math.min(19, Math.floor(168 / (Math.max(school.length, 1) * 0.68))));
    return (
      <>
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: BG, color: INK, fontFamily: "Arial, sans-serif", paddingBottom: "env(safe-area-inset-bottom)" }}>
          {/* Header: logo, window, school, money, the advance button; the track under it. */}
          <div style={{ position: "relative", flexShrink: 0, background: `linear-gradient(115deg, ${c1} 0%, ${c1} 55%, color-mix(in srgb, ${c2} 60%, ${c1}) 100%)`, boxShadow: "0 4px 14px rgba(0,0,0,0.45)" }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.45))" }} />
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "16px 10px 6px" }}>
              <Logo onColor b={b} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                <div style={{ fontSize: schoolSize, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{school}</div>
                <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ color: "#fff" }}>{money(view.available)}</span> left{portalOpen ? <> · <span style={{ color: sim.board.full ? GOLD : undefined }}>{sim.board.count}/{sim.board.limit} contacts</span></> : null}
                </div>
              </div>
              {advance && (
                <button type="button" disabled={!advance[1]} onClick={advance[1] || undefined} style={{
                  border: "none", borderRadius: 999, padding: "9px 12px", fontWeight: 900, fontSize: 12, letterSpacing: "0.04em", textTransform: "uppercase",
                  background: advance[1] ? GOLD : "rgba(0,0,0,0.35)", color: "#fff", cursor: advance[1] ? "pointer" : "default", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
                }}>{advance[0]}</button>
              )}
            </div>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 3, padding: "0 10px 8px" }}>
              {(run.live ? [] : ["nfl", "retain"]).map((k) => {
                const done = portalOpen || (k === "nfl" && stage === "retain");
                return <div key={k} style={{ flex: 1.4, height: 4, borderRadius: 2, background: done ? c2 : stage === k ? "#fff" : "rgba(255,255,255,0.2)", marginRight: k === "retain" ? 6 : 0 }} />;
              })}
              {Array.from({ length: state.windows }, (_, i) => i + 1).map((w) => (
                <Fragment key={w}>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: (portalOpen && (w < state.window || (market && w === state.window))) ? c2 : portalOpen && w === state.window ? "#fff" : "rgba(255,255,255,0.2)" }} />
                  {w === split && split < state.windows && <div style={{ width: 7, height: 7, transform: "rotate(45deg)", borderRadius: 1, flexShrink: 0, margin: "0 3px", background: market ? "#fff" : portalOpen && state.window > split ? c2 : "rgba(255,255,255,0.2)" }} />}
                </Fragment>
              ))}
            </div>
          </div>
          {/* Tab bar — scrolls sideways on its own; the screen never does. */}
          <div className="wd-ps-tabs" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, padding: "7px 8px", borderBottom: `1px solid ${LINE}`, background: "#0b1322", overflowX: "auto", overscrollBehaviorX: "contain" }}>
            {tabs.map(([k, text]) => <button key={k} type="button" onClick={() => setTab(k)} style={{ ...pillBtn(tab === k, c1), padding: "6px 11px", fontSize: 11, flexShrink: 0 }}>{text}</button>)}
            {portalOpen && !market && <button type="button" onClick={() => setBrief(true)} style={{ ...pillBtn(false), padding: "6px 11px", fontSize: 11, flexShrink: 0, color: GOLD, borderColor: "rgba(246,162,29,0.5)" }}>Briefing</button>}
            <button type="button" onClick={onSettings} aria-label="Settings" style={{ ...pillBtn(false), padding: "6px 10px", fontSize: 11, flexShrink: 0 }}>⚙ Settings</button>
          </div>
          {sim.error && <div style={{ flexShrink: 0, padding: "7px 12px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 12 }}>{sim.error}</div>}
          {/* The tab: the only thing that scrolls. */}
          <div ref={bodyRef} className="wd-sim-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
            {phase === "simming" ? <LoadingSpinner label="Simming the window" size={36} minHeight="40vh" /> : body}
            <div style={{ padding: "12px 12px 20px", fontSize: 10, color: SUB, fontWeight: 700 }}>For simulation purposes only — not We-Draft.com projections. Seed {run.seed}.</div>
          </div>
        </div>
        <button type="button" onClick={() => setNavOpen((o) => !o)} aria-label={navOpen ? "Hide the menu" : "Show the menu"} aria-expanded={navOpen} style={{
          position: "fixed", top: navOpen ? 66 : 0, left: "50%", transform: "translateX(-50%)", zIndex: 10002, transition: "top .25s ease",
          border: "none", borderRadius: "0 0 10px 10px", background: "#0055a5", color: "#fff", padding: "1px 16px 3px", fontSize: 11, lineHeight: 1.2, cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}>{navOpen ? "▲" : "▼"}</button>
        {brief && !sim.card && <Briefing sim={sim} team={run.team} brand={brand} isMobile onClose={() => setBrief(false)} />}
        {sim.card && <PlayerCard pid={sim.card} sim={sim} team={run.team} brand={brand} isMobile onClose={sim.closeCard} />}
      </>
    );
  }

  return (
    <div ref={fsRef} className={fs ? "wd-sim-scroll" : undefined} style={fs ? { background: BG, padding: 14, overflowY: "auto", height: "calc(100vh / var(--pz, 1))", boxSizing: "border-box", color: INK, fontFamily: "Arial, sans-serif" } : undefined}>
      {/* The New Portal / My Classes / Community tabs, at the very top before the
          run starts and after it closes (user, 2026-11-18). */}
      {(phase === "ready" || phase === "done") && !fs && doneTabs}
      {/* The header — anchored under the navbar (the screen's top when
          fullscreen); every window advances from its button. */}
      <div style={{ ...PANEL, position: "sticky", top: fs ? 0 : 66 /* the navbar, in CSS px (page zoom scales both) */, zIndex: 50, marginBottom: 12, background: `linear-gradient(115deg, ${c1} 0%, ${c1} 55%, color-mix(in srgb, ${c2} 60%, ${c1}) 100%)`, boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.45))" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 10 : 18, padding: isMobile ? "10px 12px 8px" : "12px 20px 10px" }}>
          <Logo onColor b={b} size={isMobile ? 40 : 58} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "inline-block", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "2px 8px", fontWeight: 900, fontSize: isMobile ? 9 : 11, letterSpacing: "0.16em" }}>{label}</div>
            <div style={{ fontSize: isMobile ? 18 : 28, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.School}</div>
            <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 800, opacity: 0.85 }}>
              {isMobile ? `${money(view.available)} left` : `${view.signings.length} signed · ${view.departures.length} gone`}
              {portalOpen && <span style={{ marginLeft: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "1px 7px", color: sim.board.full ? GOLD : undefined }} title="Contacts used — players on your board">{sim.board.count}/{sim.board.limit} contacts</span>}

            </div>
          </div>
          {!isMobile && (
            <div style={{ width: 220, background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 900 }}>
                <span style={{ fontSize: 20 }}>{money(view.available)} <span style={{ fontSize: 11, opacity: 0.75 }}>left</span></span>
                <span style={{ fontSize: 11, opacity: 0.75 }} title={view.freed ? `Includes ${money(view.freed)} freed by players released or lost` : undefined}>of {money(view.budget)}{view.freed ? <span style={{ color: "#7ee2a8" }}> (+{money(view.freed)})</span> : null}</span>
              </div>
              <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "rgba(255,255,255,0.15)", marginTop: 4 }}>
                <div style={{ width: pctOf(view.spent), background: GOLD }} />
                <div style={{ width: pctOf(view.reserved), background: "rgba(255,255,255,0.55)" }} />
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 10, fontWeight: 800, opacity: 0.85 }}>
                <span><span style={{ color: GOLD }}>■</span> Spent {money(view.spent)}</span>
                <span><span style={{ color: "rgba(255,255,255,0.7)" }}>■</span> Offered {money(view.reserved)}</span>
              </div>
            </div>
          )}
          {toggleFs && !isMobile && <FullscreenBtn on={fs} onClick={toggleFs} />}
          {advance && (
            <button type="button" disabled={!advance[1]} onClick={advance[1] || undefined} style={{
              border: "none", borderRadius: 999, padding: isMobile ? "10px 14px" : "12px 22px", fontWeight: 900, fontSize: isMobile ? 12 : 14, letterSpacing: "0.05em", textTransform: "uppercase",
              background: advance[1] ? GOLD : "rgba(0,0,0,0.35)", color: "#fff", cursor: advance[1] ? "pointer" : "default", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
            }}>{advance[0]}</button>
          )}
        </div>
        {/* Window track: the two opening windows, then the portal's. */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, padding: isMobile ? "0 12px 10px" : "0 20px 12px" }}>
          {(run.live ? [] : ["nfl", "retain"]).map((k, i) => {
            const done = portalOpen || (k === "nfl" && stage === "retain");
            return <div key={k} title={`Opening window ${i + 1}: ${STAGE_TITLE[k]}`} style={{ flex: 1.4, height: 5, borderRadius: 3, background: done ? c2 : stage === k ? "#fff" : "rgba(255,255,255,0.2)", marginRight: k === "retain" ? 8 : 0 }} />;
          })}
          {Array.from({ length: state.windows }, (_, i) => i + 1).map((w) => (
            <Fragment key={w}>
              <div title={w === (state.cfg.board?.evalWindow ?? 1) ? "Portal window 1: evaluation period" : `Portal window ${w}`} style={{ flex: 1, height: 5, borderRadius: 3, background: (portalOpen && (w < state.window || (market && w === state.window))) || phase === "done" ? c2 : portalOpen && w === state.window ? "#fff" : "rgba(255,255,255,0.2)" }} />
              {/* Market Watch, between the halves. */}
              {w === split && split < state.windows && <div title="Market Watch" style={{ width: 9, height: 9, transform: "rotate(45deg)", borderRadius: 2, flexShrink: 0, margin: "0 5px", background: market ? "#fff" : portalOpen && state.window > split ? c2 : phase === "done" ? c2 : "rgba(255,255,255,0.2)" }} />}
            </Fragment>
          ))}
        </div>
      </div>

      {phase === "ready" && <Ready sim={sim} data={data} run={run} isMobile={isMobile} onOptions={onOptions} onSettings={onSettings} />}
      {phase === "done" && <Final state={state} team={run.team} run={run} branding={data.branding} brand={brand} isMobile={isMobile} onRerun={onRerun} onSettings={onSettings} />}

      {/* The Console (not on the end screen — that's the report alone). */}
      {phase !== "ready" && phase !== "done" && <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ ...PANEL, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, overflowX: "auto" }}>
          {tabs.map(([k, text]) => <button key={k} type="button" onClick={() => setTab(k)} style={pillBtn(tab === k, c1)}>{text}</button>)}
          <span style={{ flex: 1 }} />
          {portalOpen && !market && phase !== "done" && <button type="button" onClick={() => setBrief(true)} style={{ ...pillBtn(false), color: GOLD, borderColor: "rgba(246,162,29,0.5)" }}>Coach's Briefing</button>}
          <button type="button" onClick={onSettings} style={pillBtn(false)}>Settings</button>
        </div>
        {sim.error && <div style={{ padding: "8px 14px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13 }}>{sim.error}</div>}
        <div className="wd-sim-scroll" style={{ maxHeight: isMobile ? "70vh" : fs ? FS_LIST : 720, minHeight: fs ? FS_LIST : undefined, overflowY: "auto" }}>
          {body}
        </div>
      </div>
      {!isMobile && (
        <div style={{ width: 340, flexShrink: 0 }}>
          <SimFeed feed={sim.feed} branding={data.branding} height={fs ? FS_DESK : DESK_HEIGHT} isMobile={false} filters={DESK_FILTERS} />
        </div>
      )}
      </div>}
      {brief && !sim.card && <Briefing sim={sim} team={run.team} brand={brand} isMobile={isMobile} onClose={() => setBrief(false)} />}
      {sim.card && <PlayerCard pid={sim.card} sim={sim} team={run.team} brand={brand} isMobile={isMobile} onClose={sim.closeCard} />}
      {phase !== "done" && (
        <div style={{ marginTop: 10, fontSize: 11, color: SUB, fontWeight: 700 }}>
          For simulation purposes only — not We-Draft.com projections. Seed {run.seed}.
        </div>
      )}
    </div>
  );
}

// ── Ready: the branded start screen (user, 2026-11-15) ──
// The program in its colors — tier, NIL budget, last season, roster — the
// run's settings (changeable until Start), what's ahead, and Start.
function Ready({ sim, data, run, isMobile, onOptions, onSettings }) {
  const { state, view } = sim;
  const b = data.branding[run.team] || {};
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const t = view.team;
  const rec = data.records?.teams?.[t.school];
  const last = rec?.[rec.length - 1];
  const roster = Object.values(state.players).filter((p) => p.team === run.team).length;
  const facts = [
    ["NIL budget", money(view.budget)],
    ["Portal windows", `${state.windows}`],
    [last ? `${last[0]} record` : "Last season", last ? `${last[1]}-${last[2]}` : "—"],
    ["Roster", `${roster} players`],
  ];
  const steps = run.live ? [
    ["Who left", "The real decisions are in: everyone from your roster headed to the NFL Draft or the portal, and why."],
    [`The Portal · ${state.windows} windows`, `The signing wave (${state.cfg.split?.at ?? 4} windows), Market Watch, then ${state.cfg.split?.after ?? 4} more — easier to come in late.`],
  ] : [
    ["NFL Decisions", "Who's leaving for the draft — try to keep the ones on the fence."],
    ["Retention", "Players who want out. Keep them, or lose them to the portal."],
    [`The Portal · ${state.windows} windows`, `The signing wave (${state.cfg.split?.at ?? 4} windows), then Market Watch — new entrants and stars who want the market rate — then ${state.cfg.split?.after ?? 4} more, where it's easier to come in late.`],
  ];
  return (
    <div className="wd-sim-pop" style={{ ...PANEL, marginBottom: 12, position: "relative", background: `linear-gradient(120deg, ${c1} 0%, ${c1} 52%, color-mix(in srgb, ${c2} 65%, ${c1}) 100%)` }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 85% 30%, rgba(0,0,0,0.05), rgba(0,0,0,0.55) 75%)" }} />
      {(b.LogoDark || b.Logo1) && <img src={b.LogoDark || b.Logo1} alt="" aria-hidden="true" style={{ position: "absolute", right: isMobile ? -60 : -30, top: isMobile ? -30 : -60, width: isMobile ? 260 : 440, opacity: 0.12, pointerEvents: "none" }} />}
      <div style={{ position: "relative", padding: isMobile ? "20px 16px" : "30px 34px" }}>
        {/* Who you are. */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 14 : 22 }}>
          <Logo onColor b={b} size={isMobile ? 70 : 108} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.2em", color: GOLD }}>{state.season ? `${state.season + 1} ` : ""}TRANSFER PORTAL · {t.conference}</div>
            <div style={{ fontSize: isMobile ? 30 : 52, fontWeight: 900, textTransform: "uppercase", lineHeight: 0.95, marginTop: 4, textShadow: "0 2px 14px rgba(0,0,0,0.35)" }}>{t.school}</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 4}, minmax(0, 1fr))`, gap: 8, marginTop: isMobile ? 16 : 22 }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.8, textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 900, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* The run's settings, then what's ahead. */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1.2fr)", gap: isMobile ? 14 : 22, marginTop: isMobile ? 16 : 22 }}>
          <div style={{ background: "rgba(0,0,0,0.32)", borderRadius: 14, padding: isMobile ? 14 : 18, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em" }}>SETTINGS</div>
            {!run.live && <Choice label="Transfer frequency" note={FREQ_NOTE[run.frequency || "default"]} options={FREQ_OPTIONS} value={run.frequency || "default"} onChange={(frequency) => onOptions({ frequency })} on={GOLD} apart={["crazy"]} />}

          </div>
          <div style={{ background: "rgba(0,0,0,0.32)", borderRadius: 14, padding: isMobile ? 14 : 18 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", marginBottom: 10 }}>THE OFFSEASON</div>
            {steps.map(([title, text], i) => (
              <div key={title} style={{ display: "flex", gap: 12, alignItems: "flex-start", marginTop: i ? 12 : 0 }}>
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: GOLD, color: "#111", fontWeight: 900, fontSize: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</span>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 15 }}>{title}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.85, lineHeight: 1.4 }}>{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: isMobile ? 18 : 24, flexWrap: "wrap" }}>
          <button type="button" onClick={sim.start} style={{ border: "none", borderRadius: 999, padding: isMobile ? "14px 28px" : "16px 40px", fontWeight: 900, fontSize: isMobile ? 16 : 18, letterSpacing: "0.08em", textTransform: "uppercase", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>{run.live ? "Open the Portal →" : "Start the Offseason →"}</button>
          <button type="button" onClick={onSettings} style={{ ...pillBtn(false), background: "rgba(0,0,0,0.3)", borderColor: "transparent" }}>Change team</button>
          <PortalTutorial isMobile={isMobile} onColor />
        </div>
      </div>
    </div>
  );
}

// Info / Stats columns (user, 2026-11-18): the rows keep their size — the
// columns sit between the name and the row's actions, under headers on the
// view selector's row (TableWrap).
const colW = (isMobile) => (isMobile ? 48 : 58);
const rightW = (isMobile) => (isMobile ? 160 : 300);
const cellValue = (k, fmt, p) => {
  const raw = INFO_KEYS.has(k) || k === "role" ? p[k] : p.stats?.[k];
  return fmt ? fmt(raw, p) : raw;
};
// Uncommitted: a dashed question mark where the new school goes.
const Undecided = ({ size }) => (
  <span aria-label="Undecided" title="In the portal — undecided" style={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", border: "2px dashed #5b6b84", display: "inline-flex", alignItems: "center", justifyContent: "center", color: SUB, fontWeight: 900, fontSize: Math.round(size * 0.5), lineHeight: 1 }}>?</span>
);

// A player line: stars, position, name, where from (→ where to — a "?"
// while he's in the portal undecided), then any Info / Stats columns.
// tag: a small mark beside the name (a coach's pick, coaches on him);
// note: a short value (your offer) — phones put them by the name and on the
// second line; desktop, ahead of the row's right side.
function PlayerLine({ p, brand, to, isMobile, right, extra, onOpen, cols, flush = false, tag = null, note = null }) {
  const lg = isMobile ? 22 : 26;
  if (isMobile) return <PlayerLineMobile p={p} brand={brand} to={to} right={right} extra={extra} onOpen={onOpen} cols={cols} flush={flush} tag={tag} note={note} />;
  if (tag || note) right = <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>{tag}{note}{right}</span>;
  return (
    <div className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "9px 10px" : "10px 16px", borderBottom: flush ? "none" : `1px solid ${LINE}` }}>
      <TransferStars stars={p.stars} size="sm" />
      <span style={{ width: isMobile ? 38 : 46, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "4px 0" }}>{p.sub || p.pos}</span>
      {brand(p.team, p) ? <Logo b={brand(p.team, p)} size={lg} /> : null}
      {to && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><Logo b={brand(to)} size={lg} /></>}
      {!to && p.status === "portal" && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><Undecided size={lg} /></>}
      {/* Off to the NFL, or out of eligibility (dark sim: the white cap). */}
      {!to && p.status === "declared" && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><DepartureIcon kind={p.reason === "exhausted" ? "grad" : "nfl"} dark size={lg} /></>}
      <div style={{ flex: 1, minWidth: cols ? (isMobile ? 120 : 150) : 0 }}>
        {onOpen
          ? <button type="button" onClick={() => onOpen(p.id)} style={{ all: "unset", cursor: "pointer", fontWeight: 900, fontSize: isMobile ? 14 : 16, overflowWrap: "break-word", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: 3 }}>{p.name}</button>
          : <div style={{ fontWeight: 900, fontSize: isMobile ? 14 : 16, overflowWrap: "break-word" }}>{p.name}</div>}
        <div style={{ fontSize: 12, fontWeight: 700, color: SUB, whiteSpace: cols ? "nowrap" : undefined, overflow: cols ? "hidden" : undefined, textOverflow: cols ? "ellipsis" : undefined }}>{extra ? <span style={{ color: "#9fc3ff" }}>{extra} · </span> : null}{p.elig} yr{p.elig === 1 ? "" : "s"} left · {ROLE_LABEL[p.role] || "—"} last season</div>
      </div>
      {cols && cols.map(([k, , fmt]) => {
        const v = cellValue(k, fmt, p);
        const blank = v == null || v === "";
        return <span key={k} style={{ width: colW(isMobile), flexShrink: 0, textAlign: "center", fontSize: 13, fontWeight: 800, color: blank ? "#3a4a66" : INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{blank ? "—" : v}</span>;
      })}
      {cols ? <div style={{ width: rightW(isMobile), flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>{right}</div> : right}
    </div>
  );
}

// Phones (user, 2026-11-18 — rows redesigned to fit): stars over the
// position on the left; the name gets the full line; under it, where he's
// from → where he's going and the row's note; then the row's own pieces
// (status, offers, buttons), wrapping as needed — never wider than the
// screen. Info / Stats columns become small labeled cells.
function PlayerLineMobile({ p, brand, to, right, extra, onOpen, cols, flush, tag, note }) {
  const lg = 18;
  const arrow = <span style={{ color: SUB, fontWeight: 900, fontSize: 11 }}>→</span>;
  const nameStyle = { fontWeight: 900, fontSize: 14, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
  return (
    <div className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: flush ? "none" : `1px solid ${LINE}`, minWidth: 0 }}>
      <div style={{ width: 40, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <TransferStars stars={p.stars} size="sm" />
        <span style={{ width: 40, textAlign: "center", fontSize: 10, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 5, padding: "2px 0" }}>{p.sub || p.pos}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Line 1: the name, and its tag (a coach's pick) right beside it. */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          {onOpen
            ? <button type="button" onClick={() => onOpen(p.id)} style={{ all: "unset", cursor: "pointer", ...nameStyle, textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: 3 }}>{p.name}</button>
            : <div style={nameStyle}>{p.name}</div>}
          {tag && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0 }}>{tag}</span>}
        </div>
        {/* Line 2: from → to, years left, the note (your offer) — the row's
            buttons on the right, never wrapping. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: 1 }}>
            {brand(p.team, p) ? <Logo b={brand(p.team, p)} size={lg} /> : null}
            {to && <>{arrow}<Logo b={brand(to)} size={lg} /></>}
            {!to && p.status === "portal" && <>{arrow}<Undecided size={lg} /></>}
            {!to && p.status === "declared" && <>{arrow}<DepartureIcon kind={p.reason === "exhausted" ? "grad" : "nfl"} dark size={lg} /></>}
            <span style={{ marginLeft: 2, minWidth: 0, fontSize: 11, fontWeight: 700, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {extra ? <span style={{ color: "#9fc3ff" }}>{extra} · </span> : null}{p.elig} yr{p.elig === 1 ? "" : "s"}
              {note ? <> · {note}</> : null}
            </span>
          </div>
          {right && !cols && <div className="wd-ps-right" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, flexShrink: 0, maxWidth: "62%", minWidth: 0 }}>{right}</div>}
        </div>
        {cols && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 5 }}>
            {cols.map(([k, label, fmt]) => {
              const v = cellValue(k, fmt, p);
              const blank = v == null || v === "";
              return (
                <span key={k} style={{ display: "inline-flex", alignItems: "baseline", gap: 3, fontSize: 12, fontWeight: 800, color: blank ? "#3a4a66" : INK, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.06em", color: SUB, textTransform: "uppercase" }}>{label}</span>{blank ? "—" : v}
                </span>
              );
            })}
          </div>
        )}
        {right && cols && <div className="wd-ps-right" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 6, minWidth: 0 }}>{right}</div>}
      </div>
    </div>
  );
}

// ── Portal: who's available, and making offers ──
function PortalTab({ sim, team, brand, isMobile }) {
  const { portal, view } = sim;
  const f = useFilters(view);
  const [shown, setShown] = useState(60);
  // Everyone in the portal, your own departures included (tagged).
  const evalPeriod = sim.board.evalPeriod;
  // Coach picks only (your staff's recommendations), best calls first.
  const [picks, setPicks] = useState(false);
  const recs = sim.recs;
  const list = useMemo(() => sortRows(portal.filter((p) => f.match(p) && (!picks || recs[p.id]))
    .sort((a, b) => (picks ? (recs[b.id]?.pri || 0) - (recs[a.id]?.pri || 0) : 0) || b.stars - a.stars || b.elig - a.elig || a.name.localeCompare(b.name)), f), [portal, f, picks, recs]);
  const canOffer = sim.phase === "window";
  const cols = tableCols(f);
  return (
    <>
      <EvalBanner sim={sim} isMobile={isMobile} />
      <FilterBar f={f} view={view} isMobile={isMobile} extra={<button type="button" style={{ ...pillBtn(picks, GOLD), ...(isMobile ? { padding: "5px 10px", fontSize: 11 } : {}) }} onClick={() => setPicks((v) => !v)} title="Players your staff recommends">★ Coach picks ({Object.keys(recs).filter((id) => sim.state.players[id]?.status === "portal").length})</button>} />
      {list.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: SUB }}>{picks ? "No coach picks match." : "No one available matches."}</div> : <TableWrap cols={cols} f={f} isMobile={isMobile}>{list.slice(0, shown).map((p) => {
        const mine = p.offers[team];
        // Other schools interested: contacted or offering.
        const interested = Object.keys({ ...(p.evals || {}), ...p.offers }).filter((k) => k !== team).length;
        return (
          <div key={p.id}>
            <PlayerRow cols={cols} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard}
              tag={!cols || isMobile ? <RecChip state={sim.state} pid={p.id} rec={recs[p.id]} compact={isMobile} /> : null}
              note={mine ? <span style={{ fontSize: isMobile ? 11 : 12, fontWeight: 900, color: "#7ee2a8" }}>{isMobile ? `Your offer ${money(mine.nil)}` : money(mine.nil)}</span> : null}
              right={(
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 5 : 8, flexShrink: 0 }}>
                {!isMobile && interested > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: "#9fc3ff", whiteSpace: "nowrap" }}>{interested} team{interested === 1 ? "" : "s"} interested</span>}
                <ContactBtn sim={sim} pid={p.id} />
                {canOffer && (p.cut?.[team]
                  ? <button type="button" onClick={() => sim.openCard(p.id)} style={{ ...pillBtn(false), color: "#ff8a7a", borderColor: "#5c1f28" }}>Cut you</button>
                  : !evalPeriod && <button type="button" onClick={() => sim.openCard(p.id)} style={pillBtn(!!mine, mine ? "#2e7d32" : BLUE)}>{p.touched?.[team] === sim.state.window ? "Offered" : mine ? "Re-offer" : "Offer"}</button>)}
              </div>
            )} />
          </div>
        );
      })}</TableWrap>}
      {list.length > shown && <ShowMore n={list.length - shown} onClick={() => setShown((n) => n + 60)} />}
    </>
  );
}

// ── Info / Stats views (a single position picked) — sortable tables ──
const ftIn = (i) => (i ? `${Math.floor(i / 12)}'${i % 12}"` : null);
const pctFmt = (v) => (v == null ? null : `${(v <= 1 ? v * 100 : v).toFixed(1)}%`);
const intFmt = (v) => (v == null ? null : Math.round(v).toLocaleString("en-US"));
const decFmt = (v) => (v == null ? null : Number(v).toFixed(1));
const RECV = [["rec", "Rec"], ["recYds", "Yds", intFmt], ["recYpr", "YPR", decFmt], ["recTd", "TD"], ["rushYds", "Rush", intFmt]];
const FRONT = [["tkl", "Tkl"], ["solo", "Solo"], ["tfl", "TFL"], ["sacks", "Sacks"], ["hur", "Hur"], ["pd", "PD"], ["int", "INT"]];
const STAT_COLS = {
  QB: [["passCmp", "Cmp"], ["passAtt", "Att"], ["passPct", "Pct", pctFmt], ["passYds", "Yds", intFmt], ["passTd", "TD"], ["passInt", "INT"], ["passYpa", "Y/A", decFmt], ["rushYds", "Rush", intFmt], ["rushTd", "Ru TD"]],
  RB: [["rushCar", "Car"], ["rushYds", "Yds", intFmt], ["rushYpc", "YPC", decFmt], ["rushTd", "TD"], ["rec", "Rec"], ["recYds", "Rec Yds", intFmt], ["recTd", "Rec TD"]],
  WR: RECV, TE: RECV, DL: FRONT, EDGE: FRONT, LB: FRONT,
  DB: [["tkl", "Tkl"], ["int", "INT"], ["pd", "PD"], ["tfl", "TFL"], ["solo", "Solo"], ["sacks", "Sacks"]],
  "K/P": [["fgm", "FGM"], ["fga", "FGA"], ["fgPct", "FG%", pctFmt], ["fgLong", "Long"], ["xpm", "XPM"], ["punts", "Punts"], ["puntYpp", "Avg", decFmt], ["puntIn20", "In 20"]],
};
const INFO_COLS = [["ht", "Ht", ftIn], ["wt", "Wt"], ["rStars", "HS ★", (v) => (v ? `${v}★` : null)], ["state", "State"], ["elig", "Yrs"], ["role", "Last yr", (v, p) => ROLE_LABEL[p.role]]];
const INFO_KEYS = new Set(["ht", "wt", "rStars", "state", "elig"]);
const tableCols = (f) => (f.view === "info" ? INFO_COLS : f.view === "stats" ? STAT_COLS[f.pos] || [] : null);
// A column's value for sorting.
function sortVal(p, k) {
  if (k === "stars") return p.stars;
  if (k === "name") return p.name;
  if (k === "role") return 3 - (ROLE_RANK[p.role] ?? 3);
  if (INFO_KEYS.has(k)) return p[k] ?? null;
  return p.stats?.[k] ?? null;
}
// The table's sort over a list (no table: the list's own order).
function sortRows(list, f) {
  if (!f.view || f.view === "list") return list;
  const { key, dir } = f.sort;
  return [...list].sort((a, b) => {
    const x = sortVal(a, key);
    const y = sortVal(b, key);
    if (x == null && y == null) return 0;
    if (x == null) return 1; // blanks last either way
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });
}
// The view selector (a single position picked): List, Info and — not OL —
// Stats.
function ViewPicker({ f }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, marginRight: 4 }}>VIEW</span>
      {[["list", "List"], ["info", "Info"], ...(f.pos !== "OL" ? [["stats", "Stats"]] : [])].map(([k, label]) => (
        <button key={k} type="button" style={{ ...pillBtn(f.view === k, GOLD), padding: "4px 10px" }} onClick={() => f.setView(k)}>{label}</button>
      ))}
    </div>
  );
}
// The list under the filters: with a position picked, the view selector on
// top — and in Info / Stats, the columns' headers on that same row, lined up
// with the rows' columns (PlayerLine). Phones scroll it sideways.
function TableWrap({ cols, f, isMobile, children }) {
  if (!f.pos) return children;
  const head = (k, label, width) => {
    const on = f.sort.key === k;
    return (
      <button key={k} type="button" onClick={() => f.sortBy(k)} title="Sort" style={{ all: "unset", cursor: "pointer", width, flexShrink: 0, textAlign: "center", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: on ? GOLD : SUB, whiteSpace: "nowrap" }}>
        {label}{on ? (f.sort.dir < 0 ? " ▼" : " ▲") : ""}
      </button>
    );
  };
  const row = (
    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "8px 10px" : "8px 16px", borderBottom: `1px solid ${LINE}`, background: "#0b1322", position: "sticky", top: 0, zIndex: 1 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <ViewPicker f={f} />
        {cols && <span style={{ display: "inline-flex", gap: 8 }}>{head("stars", "★")}{head("name", "Name")}</span>}
      </div>
      {cols && cols.map(([k, label]) => head(k, label, colW(isMobile)))}
      {cols && <span style={{ width: rightW(isMobile), flexShrink: 0 }} />}
    </div>
  );
  if (isMobile) {
    // Phones (user, 2026-11-18): nothing wider than the screen — the view
    // picker, then "Sort" chips (the columns sit in each row as cells).
    return (
      <>
        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${LINE}`, background: "#0b1322" }}>
          <ViewPicker f={f} />
          {cols && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, marginRight: 2 }}>SORT</span>
              {[["stars", "★"], ["name", "Name"], ...cols.map(([k, label]) => [k, label])].map(([k, label]) => {
                const on = f.sort.key === k;
                return <button key={k} type="button" onClick={() => f.sortBy(k)} style={{ ...pillBtn(on, GOLD), padding: "3px 8px", fontSize: 10 }}>{label}{on ? (f.sort.dir < 0 ? " ▼" : " ▲") : ""}</button>;
              })}
            </div>
          )}
        </div>
        {children}
      </>
    );
  }
  if (!cols) return <>{row}{children}</>;
  return <>{row}{children}</>;
}
// A row: the player line, with the view's columns when it has them.
function PlayerRow(props) { return <PlayerLine {...props} />; }

// The Portal tab's filters — position (K/P together), stars, my needs,
// search — shared with Results → Around the Country.
function useFilters(view) {
  const [pos, setPosRaw] = useState("");
  // Under DB: CB or S; under OL: OT or IOL (user, 2026-11-14).
  const [sub, setSub] = useState("");
  const setPos = (x) => { setPosRaw(x); setSub(""); };
  const [minStars, setMinStars] = useState(2); // every star level
  const [q, setQ] = useState("");
  const [needsOnly, setNeedsOnly] = useState(false);
  // List, Info or Stats (Stats: one position, not OL), and the table's sort.
  const [viewPick, setView] = useState("list");
  const [sort, setSort] = useState({ key: "stars", dir: -1 });
  const view_ = viewPick === "stats" && (!pos || pos === "OL") ? "list" : viewPick;
  return useMemo(() => {
    const needle = q.trim().toLowerCase();
    return {
      pos, setPos, sub, setSub, minStars, setMinStars, q, setQ, needsOnly, setNeedsOnly,
      view: view_, setView, sort,
      sortBy: (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: k === "name" || k === "state" ? 1 : -1 })),
      match: (p) => (!pos || posGroup(pos).includes(p.pos)) && (!sub || p.sub === sub) && p.stars >= minStars && (!needsOnly || view.needs[p.pos] > 0) && (!needle || p.name.toLowerCase().includes(needle)),
    };
  }, [pos, sub, minStars, q, needsOnly, view.needs, view_, sort]); // eslint-disable-line react-hooks/exhaustive-deps
}
// Sub-positions under a position filter.
const SUBS = { DB: [["", "All DBs"], ["CB", "CB"], ["S", "S"]], OL: [["", "All OL"], ["OT", "OT"], ["IOL", "IOL"]] };
// A position tab's need: its most urgent level (engine needsOf).
const needAt = (needs, x) => Math.max(...posGroup(x).map((k) => needs?.[k] || 0));
// A need's dot (user, 2026-11-18): red upgrade, orange talent, yellow
// depth, green set.
const NeedDot = ({ v, size = 8 }) => {
  const [, label, color] = needLevelOf(v);
  return <span title={label} style={{ width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />;
};
function FilterBar({ f, view, extra = null, isMobile = false }) {
  if (isMobile) {
    // Phones: the positions scroll sideways in their own strip; the rest
    // wraps under it — the screen itself never goes sideways.
    return (
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="wd-ps-tabs" style={{ display: "flex", gap: 5, padding: "8px 10px 6px", overflowX: "auto", overscrollBehaviorX: "contain" }}>
          <button type="button" style={{ ...pillBtn(!f.pos), padding: "5px 10px", fontSize: 11, flexShrink: 0 }} onClick={() => f.setPos("")}>All</button>
          {POS_TABS.map((x) => (
            <button key={x} type="button" style={{ ...pillBtn(f.pos === x), padding: "5px 10px", fontSize: 11, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }} onClick={() => f.setPos(f.pos === x ? "" : x)}>
              {x}<NeedDot v={needAt(view.needs, x)} size={6} />
            </button>
          ))}
        </div>
        {SUBS[f.pos] && (
          <div style={{ display: "flex", gap: 4, padding: "0 10px 6px", alignItems: "center" }}>
            {SUBS[f.pos].map(([k, label]) => <button key={k || "all"} type="button" style={{ ...pillBtn(f.sub === k), padding: "4px 9px", fontSize: 11 }} onClick={() => f.setSub(k)}>{label}</button>)}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 10px 8px", alignItems: "center" }}>
          <select value={f.minStars} onChange={(e) => f.setMinStars(Number(e.target.value))} aria-label="Stars" style={{ background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "5px 8px", fontWeight: 800, fontSize: 12, maxWidth: 120 }}>
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 2 ? "All stars" : `${n}★${n < 6 ? "+" : ""}`}</option>)}
          </select>
          <button type="button" style={{ ...pillBtn(f.needsOnly, GOLD), padding: "5px 10px", fontSize: 11 }} onClick={() => f.setNeedsOnly((v) => !v)}>My needs</button>
          {extra}
          <input value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder="Search…" style={{ flex: "1 1 110px", minWidth: 0, background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontWeight: 700, fontSize: 16, outline: "none" }} />
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}` }}>
      <button type="button" style={pillBtn(!f.pos)} onClick={() => f.setPos("")}>All</button>
      {/* Each position with your need there. */}
      {POS_TABS.map((x) => (
        <button key={x} type="button" style={{ ...pillBtn(f.pos === x), display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => f.setPos(f.pos === x ? "" : x)}>
          {x}<NeedDot v={needAt(view.needs, x)} size={7} />
        </button>
      ))}
      <select value={f.minStars} onChange={(e) => f.setMinStars(Number(e.target.value))} style={{ background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "5px 10px", fontWeight: 800, fontSize: 12 }}>
        {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 2 ? "All stars" : `${n}★${n < 6 ? " and up" : ""}`}</option>)}
      </select>
      <button type="button" style={pillBtn(f.needsOnly, GOLD)} onClick={() => f.setNeedsOnly((v) => !v)}>My needs</button>
      {extra}
      <input value={f.q} onChange={(e) => f.setQ(e.target.value)} placeholder="Search…" style={{ flex: "1 1 140px", minWidth: 0, background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontWeight: 700, fontSize: 13, outline: "none" }} />
      {/* DB: cornerbacks or safeties; OL: tackles or interior. */}
      {SUBS[f.pos] && (
        <div style={{ display: "flex", gap: 4, flexBasis: "100%", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, marginRight: 4 }}>{f.pos}</span>
          {SUBS[f.pos].map(([k, label]) => (
            <button key={k || "all"} type="button" style={pillBtn(f.sub === k)} onClick={() => f.setSub(k)}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
const ShowMore = ({ n, onClick }) => (
  <button type="button" onClick={onClick} style={{ display: "block", width: "100%", padding: 12, background: "#0b1322", color: GOLD, border: "none", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>Show more ({n})</button>
);
// Star a player onto My Board.
// Contact / Drop: one click, right from the list — no card. Contact puts a
// portal player on your board (off once your contacts are used up); Drop
// takes him off it, pulling any offer you have out to him.
function ContactBtn({ sim, pid }) {
  const on = sim.starred.has(pid);
  const p = sim.state.players[pid];
  if (p?.status !== "portal") return null;
  const team = sim.view.team.slug;
  const off = sim.phase !== "window" || (!on && (sim.board.full || !!p?.cut?.[team]));
  return (
    <button type="button" disabled={off} onClick={() => sim.toggleStar(pid)} aria-label={on ? "Drop" : "Contact"}
      title={on ? (p.offers[team] ? "Drop him — pulls your offer" : "Drop him from your board") : sim.board.full ? `All ${sim.board.limit} contacts used` : "Contact him — he goes on your board and interest starts building"} style={{
      ...pillBtn(false), opacity: off ? 0.4 : 1, cursor: off ? "default" : "pointer", whiteSpace: "nowrap",
      borderColor: on ? "#5c1f28" : LINE, color: on ? "#ff8a7a" : INK,
    }}>{on ? "Drop" : "Contact"}</button>
  );
}
// Where you stand with a contact in the portal: your rank among the
// schools on him (offering or contacted) and whether you're still in it —
// within the gap CPU schools use to decide to move on.
// (The evaluation period: everyone's contacting at once — no standings
// yet, user 2026-11-18.) → [text, color, rank].
function boardStanding(state, p, team, evalPeriod = false) {
  if (evalPeriod) return ["Evaluating", "#9fc3ff", null];
  const ties = tiesOf(state, p);
  const order = Object.entries(ties.grades).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const rank = order.indexOf(team) + 1;
  const n = order.length;
  if (!rank) return ["—", SUB, null];
  if (rank === 1) return [n === 1 ? "Only school on him" : `Leading · ${n} schools`, "#7ee2a8", 1];
  return competitive(state, ties, team) ? [`#${rank} of ${n} · in it`, GOLD, rank] : [`#${rank} of ${n} · long shot`, "#ff8a7a", rank];
}
// The evaluation period, explained (Portal and My Board, window 1).
const EvalBanner = ({ sim, isMobile }) => (!sim.board.evalPeriod ? null : isMobile ? (
  // Phones: the short version.
  <div style={{ margin: "8px 10px 0", padding: "8px 11px", borderRadius: 10, background: "rgba(246,162,29,0.1)", border: "1px solid rgba(246,162,29,0.45)", fontSize: 12, fontWeight: 700, lineHeight: 1.4 }}>
    <b style={{ color: GOLD, letterSpacing: "0.06em" }}>EVALUATION PERIOD</b> · No offers yet — contact players and interest starts building. <span style={{ color: SUB }}>{sim.board.count}/{sim.board.limit} contacts</span>
  </div>
) : (
  <div style={{ margin: "10px 12px 0", padding: "12px 14px", borderRadius: 12, background: "rgba(246,162,29,0.1)", border: "1px solid rgba(246,162,29,0.45)", fontSize: 13, fontWeight: 700, lineHeight: 1.45 }}>
    <b style={{ color: GOLD, letterSpacing: "0.08em" }}>EVALUATION PERIOD</b> · No offers this window. Contact up to {sim.board.limit} players — interest builds from today, so your offers start ahead. Every school is doing the same; the ones that fall behind move on. Contacts grow as the portal goes on ({(sim.state.cfg.board?.sizes || []).join(" → ")}).
    <span style={{ color: SUB }}> Contacts: {sim.board.count}/{sim.board.limit}</span>
  </div>
));
// Where a player stands now, for results lines: signed / still in the portal / unsigned.
function standing(state, p, team) {
  if (p.status === "committed") return p.to === team ? ["Signed with you", "#7ee2a8"] : [`Signed with ${state.teams[p.to]?.school || "?"}`, SUB];
  if (p.status === "unsigned") return ["Went unsigned", SUB];
  if (p.status === "portal") {
    const n = Object.keys(p.offers).length;
    return [`Still in the portal · ${n} offer${n === 1 ? "" : "s"}`, GOLD];
  }
  return [p.status === "roster" ? "Stayed" : "", SUB];
}

// ── My Board (user, 2026-11-18) ──
// Top: each position with its need level (red / orange / yellow / green —
// it moves as recruitments happen), players on your board there and any
// signed. Your staff (drag a coach onto a player — or tap, then tap). Then
// your board IN YOUR ORDER (a new contact goes last; drag the handle to
// move one), each with where you stand — ▲ / ▼ since you ended the last
// window — his offer, the coaches on him. Then signed, gone, and your
// staff's recommendations: position buttons, best stars first (then last
// name), "Pass" moves one to the bottom (he keeps the pick). Below the
// picks they talk about, the staff's full list: a few names at every
// position, always (engine staffSuggestions) — no message, just an easy
// place to find players. A dragged coach follows the pointer (DragOverlay).
// Being on your board builds interest on its own (earlyInterest — shown as
// "Interest +N").
function SortRow({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS_DND.Transform.toString(transform), transition, position: "relative", zIndex: isDragging ? 5 : undefined, opacity: isDragging ? 0.85 : 1, background: isDragging ? "#16213a" : undefined, outline: isOver ? `2px solid ${GOLD}` : undefined, outlineOffset: -2 }}>
      {children({ handle: { ...attributes, ...listeners } })}
    </div>
  );
}
function BoardTab({ sim, team, brand, isMobile }) {
  const { state, view } = sim;
  const evalPeriod = sim.board.evalPeriod;
  const [armed, setArmed] = useState(null); // a tapped coach, waiting for a player
  const [dragging, setDragging] = useState(null); // the coach being dragged
  // Contacting from the recommendations adds a row to the board above them;
  // hold the recommendations where they were on screen (user, 2026-11-18).
  const recHead = useRef(null);
  const anchor = useRef(null);
  useLayoutEffect(() => {
    const top = anchor.current;
    anchor.current = null;
    const el = recHead.current;
    if (top == null || !el) return;
    const delta = el.getBoundingClientRect().top - top;
    if (!delta) return;
    const sc = el.closest(".wd-sim-scroll");
    if (sc && sc.scrollHeight > sc.clientHeight) sc.scrollTop += delta;
    else window.scrollBy(0, delta);
  }, [sim.boardList.length]);
  const [recPos, setRecPos] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));
  const order = (a, b) => b.stars - a.stars || lastOf(a.name).localeCompare(lastOf(b.name));
  const board = sim.boardList; // in your order
  const mine = [...sim.starred].map((id) => state.players[id]).filter(Boolean);
  // Gone: contacts no longer in the portal and not yours, plus anyone you
  // offered who signed elsewhere (each once).
  const goneIds = new Set(mine.filter((p) => p.status !== "portal" && !(p.status === "committed" && p.to === team)).map((p) => p.id));
  state.log.forEach((e) => { if (e.kind === "committed" && e.to !== team && e.offeredBy?.includes(team)) goneIds.add(e.pid); });
  // Second half (user, 2026-11-18): the first half's losses are behind you
  // (Market Watch's "Missed" recapped them) — only this half's show.
  const half = state.cfg.split?.at ?? 0;
  const secondHalf = half > 0 && state.window > half;
  const goneAt = {};
  state.log.forEach((e) => { if (e.kind === "committed") goneAt[e.pid] = e.w; });
  const gone = [...goneIds].map((id) => state.players[id]).filter(Boolean)
    .filter((p) => !secondHalf || !(goneAt[p.id] != null && goneAt[p.id] <= half)).sort(order);
  const onDragStart = ({ active }) => { const a = String(active.id); if (a.startsWith("coach:")) setDragging(a.slice(6)); };
  const onDragEnd = ({ active, over }) => {
    setDragging(null);
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a.startsWith("coach:")) { sim.assign(a.slice(6), o); setArmed(null); return; }
    if (a !== o) sim.move(a, board.findIndex((p) => p.id === o));
  };
  const tapRow = (pid) => { if (armed) { sim.assign(armed, pid); setArmed(null); } };
  // Need strip: each position's level, on board and signed there.
  const strip = POS_TABS.map((x) => ({
    x, v: needAt(view.needs, x),
    on: board.filter((p) => posGroup(x).includes(p.pos)).length,
    signed: view.signings.filter((p) => posGroup(x).includes(p.pos)).length,
  }));
  const was = sim.rankWas;
  const standingLine = (p, i) => {
    const [text, color, rank] = boardStanding(state, p, team, evalPeriod);
    const before = was[p.id];
    const moved = rank && before ? before - rank : 0;
    const built = p.coach?.[team] || 0;
    const offer = p.offers[team];
    const held = gradeOffer(state, team, p, likelyOffer(state, team, p)).held;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: isMobile ? "wrap" : "nowrap", justifyContent: "flex-end" }}>
        <RecChip state={state} pid={p.id} rec={sim.recs[p.id]} />
        <OnHim sim={sim} pid={p.id} />
        <span style={{ fontSize: 12, fontWeight: 800, color: SUB, textAlign: "right" }}>
          {offer ? <><span style={{ color: "#7ee2a8" }}>Your offer {money(offer.nil)}</span><br /></> : null}
          <span style={{ color }}>{text}</span>
          {moved ? <span title={`#${before} when you ended last window`} style={{ marginLeft: 6, fontWeight: 900, color: moved > 0 ? "#7ee2a8" : "#ff8a7a" }}>{moved > 0 ? `▲${moved}` : `▼${-moved}`}</span> : null}
          {held > 0 || built > 0 ? <><br /><span style={{ color: GOLD }}>{held > 0 ? `Interest +${Math.round(held * 100)}` : ""}{held > 0 && built > 0 ? " · " : ""}{built > 0 ? `coaches +${Math.round(built * 100)}` : ""}</span></> : null}
        </span>
        <ContactBtn sim={sim} pid={p.id} />
      </div>
    );
  };
  // Phones: the same, in the row's slots — coach pick and coaches on him by
  // the name, your offer on line 2, the standing (one line) and Drop on the right.
  const boardTag = (p) => <><RecChip state={state} pid={p.id} rec={sim.recs[p.id]} compact /><OnHim sim={sim} pid={p.id} /></>;
  // Line 2 carries the standing (and its move since last window); the right
  // side, your offer as a short figure and Drop.
  const boardNote = (p) => {
    const [text, color, rank] = boardStanding(state, p, team, evalPeriod);
    const before = was[p.id];
    const moved = rank && before ? before - rank : 0;
    return (
      <span style={{ color, fontWeight: 900 }}>
        {text}{moved ? <span style={{ marginLeft: 4, color: moved > 0 ? "#7ee2a8" : "#ff8a7a" }}>{moved > 0 ? `▲${moved}` : `▼${-moved}`}</span> : null}
      </span>
    );
  };
  const standingShort = (p) => (
    <>
      {p.offers[team] && <span title="Your offer" style={{ fontSize: 11, fontWeight: 900, color: "#7ee2a8", whiteSpace: "nowrap" }}>{money(p.offers[team].nil)}</span>}
      <ContactBtn sim={sim} pid={p.id} />
    </>
  );
  // Your staff's picks you haven't contacted — by position, best stars
  // first, then last name; passed ones at the bottom.
  const recIds = Object.keys(sim.recs);
  const suggested = Object.values(sim.suggestions).flat().filter((id) => !sim.recs[id]);
  const picksAll = [...recIds, ...suggested].map((id) => ({ p: state.players[id], rec: sim.recs[id] || null }))
    .filter(({ p }) => p?.status === "portal" && p.evals?.[team] == null);
  const picks = picksAll.filter(({ p }) => !recPos || posGroup(recPos).includes(p.pos)).sort((a, b) => order(a.p, b.p));
  const live = picks.filter(({ p }) => !sim.passed.has(p.id));
  const passed = picks.filter(({ p }) => sim.passed.has(p.id));
  // Contact first; Pass in red.
  const recRow = ({ p, rec }, isPassed) => (
    <div key={p.id} style={{ opacity: isPassed ? 0.6 : 1 }}>
      <PlayerLine p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} flush={!isPassed && !!rec} tag={<RecChip state={state} pid={p.id} rec={rec} compact={isMobile} />} right={(
        <span style={{ display: "inline-flex", alignItems: "center", gap: isMobile ? 5 : 8 }}>
          <ContactBtn sim={sim} pid={p.id} />
          <button type="button" onClick={() => sim.pass(p.id)} style={isPassed ? { ...pillBtn(false), padding: "5px 10px" } : { ...pillBtn(false), padding: "5px 10px", color: "#ff8a7a", borderColor: "#5c1f28" }}>{isPassed ? "Restore" : "Pass"}</button>
        </span>
      )} />
      {!isPassed && rec && <div style={{ borderBottom: `1px solid ${LINE}` }}><RecQuote state={state} pid={p.id} rec={rec} compact /></div>}
    </div>
  );
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      {dragging && <style>{"body, body * { cursor: grabbing !important; }"}</style>}
      {/* The coach in your hand. */}
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, background: "#0e1626", border: `2px solid ${ROLE_COLOR[dragging]}`, boxShadow: `0 14px 34px rgba(0,0,0,0.6), 0 0 0 4px ${ROLE_COLOR[dragging]}33`, transform: "rotate(-4deg) scale(1.08)", color: INK, fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", pointerEvents: "none" }}>
            <CoachChip role={dragging} size="md" />{ROLE_SHORT[dragging]}
          </div>
        ) : null}
      </DragOverlay>
      <EvalBanner sim={sim} isMobile={isMobile} />
      {/* Needs by position — on board, signed. */}
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, overflowX: "auto" }}>
        {strip.map(({ x, v, on, signed }) => {
          const [, label, color] = needLevelOf(v);
          return (
            <div key={x} title={label} style={{ flex: "1 0 auto", minWidth: 58, textAlign: "center", padding: "6px 6px", borderRadius: 10, background: "#111a2b", border: `1px solid ${color}55`, borderTop: `3px solid ${color}` }}>
              <div style={{ fontSize: 13, fontWeight: 900, color }}>{x}</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: SUB, whiteSpace: "nowrap" }}>{on} on board</div>
              {signed > 0 && <div style={{ fontSize: 10, fontWeight: 900, color: "#7ee2a8", whiteSpace: "nowrap" }}>{signed} signed</div>}
            </div>
          );
        })}
      </div>
      <StaffStrip sim={sim} onOpen={sim.openCard} isMobile={isMobile} armed={armed} setArmed={setArmed} />
      <Section title={`My board (${board.length}/${sim.board.limit}) · ${isMobile ? "▲▼ to reorder" : "drag ⋮⋮ to reorder"}`}>
        {board.length === 0 ? <Empty>{evalPeriod ? `Contact players from the Portal tab — up to ${sim.board.limit}.` : "Your board is empty. Contact players from the Portal tab."}</Empty> : isMobile ? (
          // Phones (user, 2026-11-18): no dragging — arrows move a player up
          // or down one spot; the rank sits between them.
          board.map((p, i) => (
            <div key={p.id} style={{ display: "flex", alignItems: "stretch", borderBottom: `1px solid ${LINE}` }}>
              <div style={{ width: 34, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, borderRight: `1px solid ${LINE}`, background: "#0b1322" }}>
                <button type="button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => sim.move(p.id, i - 1)} style={{ all: "unset", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#2a3a58" : INK, fontSize: 13, padding: "4px 8px", lineHeight: 1 }}>▲</button>
                <span style={{ fontSize: 12, fontWeight: 900, color: i < 3 ? GOLD : SUB }}>{i + 1}</span>
                <button type="button" aria-label={`Move ${p.name} down`} disabled={i === board.length - 1} onClick={() => sim.move(p.id, i + 1)} style={{ all: "unset", cursor: i === board.length - 1 ? "default" : "pointer", color: i === board.length - 1 ? "#2a3a58" : INK, fontSize: 13, padding: "4px 8px", lineHeight: 1 }}>▼</button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PlayerLine p={p} brand={brand} isMobile onOpen={sim.openCard} flush tag={boardTag(p)} note={boardNote(p)} right={standingShort(p)} />
              </div>
            </div>
          ))
        ) : (
          <SortableContext items={board.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {board.map((p, i) => (
              <SortRow key={p.id} id={p.id}>
                {({ handle }) => (
                  <div onClick={() => tapRow(p.id)} style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${LINE}`, cursor: armed ? "copy" : undefined, background: armed || dragging ? "rgba(246,162,29,0.05)" : undefined, boxShadow: dragging ? `inset 3px 0 0 ${ROLE_COLOR[dragging]}` : undefined }}>
                    <span {...handle} title="Drag to reorder" style={{ flexShrink: 0, cursor: "grab", touchAction: "none", padding: isMobile ? "0 4px 0 8px" : "0 4px 0 12px", color: "#5b6b84", fontWeight: 900, userSelect: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      ⋮⋮<span style={{ width: 18, textAlign: "right", color: i < 3 ? GOLD : SUB, fontSize: 13 }}>{i + 1}</span>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <PlayerLine p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} flush right={standingLine(p, i)} />
                    </div>
                  </div>
                )}
              </SortRow>
            ))}
          </SortableContext>
        )}
      </Section>
      {!evalPeriod && (
        <Section title={`Signed (${view.signings.length})`}>
          {view.signings.length === 0 ? <Empty>No one yet.</Empty> : view.signings.map((p) => <PlayerLine key={p.id} p={p} brand={brand} to={team} isMobile={isMobile} onOpen={sim.openCard} right={<span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(p.deal.nil)}</span>} />)}
        </Section>
      )}
      {gone.length > 0 && (
        <Section tone="gone" title={`Gone elsewhere (${gone.length})`}>
          {gone.map((p) => {
            const [text, color] = standing(state, p, team);
            return <PlayerLine key={p.id} p={p} brand={brand} to={p.status === "committed" ? p.to : null} isMobile={isMobile} onOpen={sim.openCard} right={<span style={{ fontSize: 12, fontWeight: 800, color, textAlign: "right" }}>{text}{p.deal ? ` · ${money(p.deal.nil)}` : ""}</span>} />;
          })}
        </Section>
      )}
      <div ref={recHead} onClickCapture={() => { anchor.current = recHead.current?.getBoundingClientRect().top ?? null; }}>
      <Section title={`Staff recommendations · every position (${picksAll.filter(({ p }) => !sim.passed.has(p.id)).length})`}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 12px", borderBottom: `1px solid ${LINE}` }}>
          {[["", "All"], ...POS_TABS.map((x) => [x, x])].map(([k, label]) => {
            const n = picksAll.filter(({ p }) => !sim.passed.has(p.id) && (!k || posGroup(k).includes(p.pos))).length;
            if (k && !n) return null;
            return <button key={k || "all"} type="button" style={pillBtn(recPos === k, GOLD)} onClick={() => setRecPos(k)}>{label} <span style={{ opacity: 0.7 }}>{n}</span></button>;
          })}
        </div>
        {live.length === 0 ? <Empty>{recPos ? `No new ${recPos} names right now.` : "Your staff has no new names right now — they'll bring more every window."}</Empty> : live.map((x) => recRow(x, false))}
        {passed.length > 0 && (
          <>
            <div style={{ padding: "8px 16px", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB, borderBottom: `1px solid ${LINE}` }}>PASSED ({passed.length})</div>
            {passed.map((x) => recRow(x, true))}
          </>
        )}
      </Section>
      </div>
    </DndContext>
  );
}

const M_value = (p) => p.stars * 10 + Math.min(p.elig || 0, 4);
const ROLE_RANK = { starter: 0, rotation: 1, reserve: 2, none: 3 };

// ── Needs: each position's need, and who's there, committed, in the
// portal, or gone ──
// Need levels (user, 2026-11-18 — engine needsOf): Needs Upgrade (red),
// Needs Talent (orange), Needs Depth (yellow), Set (green) — the most
// urgent one shows. The school's 2027 high school commits are listed too
// (its team page snapshot — utils/portalData.js). On your own roster you
// can release a player into the portal (not a commit).
function NeedsTab({ sim, team: myTeam, brand, isMobile }) {
  const { state, view } = sim;
  const [pos, setPos] = useState("QB");
  // Any FBS roster (user, 2026-11-14) — yours by default.
  const [team, setTeam] = useState(myTeam);
  const [releasing, setReleasing] = useState(null); // pid awaiting confirm
  useScrollLock(!!releasing);
  const needs = useMemo(() => (team === myTeam ? view.needs : teamNeeds(state, team)), [team, myTeam, view.needs, state]);
  const schools = useMemo(() => Object.values(state.teams).filter((t) => !t.fcs).sort((a, b) => a.school.localeCompare(b.school)), [state.teams]);
  const all = useMemo(() => Object.values(state.players), [state.players]);
  // Its high school class (null while loading).
  const [signees, setSignees] = useState(null);
  useEffect(() => {
    let c = false;
    setSignees(null);
    fetchPortalTeamPage(team).then((d) => { if (!c) setSignees(d?.signees || []); }).catch(() => { if (!c) setSignees([]); });
    return () => { c = true; };
  }, [team]);
  const at = (p) => posGroup(pos).includes(p.pos);
  // Best first: star rating, then role, then eligibility (user, 2026-11-15).
  const rank = (a, b) => b.stars - a.stars || ROLE_RANK[a.role] - ROLE_RANK[b.role] || M_value(b) - M_value(a);
  // On the roster: stayed (or still deciding), plus signings coming in.
  const roster = all.filter((p) => at(p) && ((p.team === team && (p.status === "roster" || p.status === "considering")) || (p.status === "committed" && p.to === team))).sort(rank);
  const commits = (signees || []).filter((r) => posGroup(pos).includes(r.pos));
  const inPortal = all.filter((p) => at(p) && p.team === team && p.status === "portal").sort(rank);
  // Gone: portal departures first, then the NFL.
  const left = all.filter((p) => at(p) && p.team === team && (p.status === "unsigned" || (p.status === "committed" && p.to !== team))).sort(rank)
    .concat(sortNfl(all.filter((p) => at(p) && p.team === team && p.status === "declared")));
  const [, lv, lc] = needLevelOf(needAt(needs, pos));
  // The opening windows' outcomes, for the NFL decisions baked in here.
  const opening = useMemo(() => Object.fromEntries(state.log.filter((e) => e.stage && e.team === team).map((e) => [e.pid, e])), [state.log, team]);
  const season = state.season ? state.season + 1 : "";
  const canRelease = team === myTeam && sim.phase === "window";
  // Releasing frees his market ask (user, 2026-11-18); anyone re-signed this
  // offseason (kept, paid in Market Watch) can't be released.
  // "Free $X" (user, 2026-11-18) — what releasing him frees, in red; a tap
  // explains the release (he goes into the portal) before it happens.
  const releaseBtns = (p) => (p.retained ? null : (
    <button type="button" title={`Release him to the portal — frees ${money(releaseValue(state, p))}`} onClick={() => setReleasing(p.id)}
      style={{ ...pillBtn(false), padding: "5px 10px", color: "#ff6b5b", borderColor: "#7a2630", background: "rgba(229,72,77,0.1)" }}>
      Free {money(releaseValue(state, p))}
    </button>
  ));
  const releasingP = releasing ? state.players[releasing] : null;
  const releaseDialog = releasingP && (
    <div role="dialog" aria-modal="true" aria-label={`Release ${releasingP.name}`} onClick={() => setReleasing(null)}
      style={{ position: "fixed", inset: 0, zIndex: 19000, background: "rgba(3,7,14,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overscrollBehavior: "contain", touchAction: "none" }}>
      <div onClick={(e) => e.stopPropagation()} className="wd-sim-pop" style={{ ...PANEL, width: "100%", maxWidth: 440, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ padding: "12px 16px", background: "#2a1016", borderBottom: "1px solid #5c1f28", fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", color: "#ff8a7a" }}>RELEASE TO THE PORTAL</div>
        <div style={{ padding: "16px 18px", fontSize: 14, fontWeight: 700, lineHeight: 1.55 }}>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>{releasingP.name} <span style={{ fontSize: 12, color: SUB }}>{releasingP.stars}★ {releasingP.sub || releasingP.pos}</span></div>
          You&apos;re releasing him into the transfer portal. He leaves your roster and any school can sign him — you can&apos;t get him back unless you win him in the portal like anyone else.
          <div style={{ marginTop: 10, color: "#7ee2a8" }}>Frees <b>{money(releaseValue(state, releasingP))}</b> of NIL for your budget.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 16px 16px" }}>
          <button type="button" style={pillBtn(false)} onClick={() => setReleasing(null)}>Cancel</button>
          <button type="button" style={{ ...pillBtn(true, "#c0392b"), padding: "8px 16px" }} onClick={() => { sim.release(releasingP.id); setReleasing(null); }}>Release · Free {money(releaseValue(state, releasingP))}</button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <Logo b={brand(team)} size={26} />
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Roster" style={{ background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontWeight: 900, fontSize: 13, fontFamily: "inherit", maxWidth: "100%" }}>
          {schools.map((t) => <option key={t.slug} value={t.slug}>{t.school}{t.slug === myTeam ? " (you)" : ""}</option>)}
        </select>
        {team !== myTeam && <button type="button" style={pillBtn(false)} onClick={() => setTeam(myTeam)}>Back to yours</button>}
      </div>
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, overflowX: "auto" }}>
        {POS_TABS.map((x) => (
          <button key={x} type="button" onClick={() => setPos(x)} style={{ ...pillBtn(pos === x), display: "inline-flex", alignItems: "center", gap: 6 }}>
            {x}<NeedDot v={needAt(needs, x)} size={7} />
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE}`, fontWeight: 900, fontSize: 14 }}>
        <span>{pos} · <span style={{ color: lc }}>{lv}</span>
          <span style={{ color: SUB, fontWeight: 700, fontSize: 12 }}> · plays {posGroup(pos).map((k) => state.cfg.starters[k] || 0).reduce((a, n) => a + n, 0)} starter{posGroup(pos).length > 1 || (state.cfg.starters[pos] || 0) !== 1 ? "s" : ""}</span>
        </span>
        <span style={{ flex: 1 }} />
        {/* The key. */}
        <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", fontSize: 11, fontWeight: 800, color: SUB }}>
          {[3, 2, 1, 0].map((v) => <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><NeedDot v={v} size={7} />{needLevelOf(v)[1]}</span>)}
        </span>
      </div>
      <Section title={`On the roster (${roster.length})`}>
        {roster.length === 0 ? <Empty>No one.</Empty> : subGroups(pos, roster).map(([label, list]) => (
          <Fragment key={label || "all"}>
            {/* DB splits into CB / S, OL into OT / IOL. */}
            {label && <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: "#9fc3ff" }}>{label} ({list.length})</div>}
            {list.length === 0 ? <div style={{ padding: "4px 16px 10px", color: SUB, fontSize: 12, fontWeight: 700 }}>No one.</div> : list.map((p) => (
              <PlayerLine key={p.id} p={p} brand={brand} to={p.status === "committed" ? team : null} isMobile={isMobile} onOpen={sim.openCard} right={(
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, textAlign: "right", color: p.status === "committed" ? "#7ee2a8" : p.status === "considering" ? GOLD : SUB }}>
                    {p.status === "committed" ? `New · ${money(p.deal.nil)}` : p.status === "considering" ? (p.considering === "nfl" ? "Deciding on the NFL" : "Wants to leave")
                      : p.retained ? `Kept from the ${p.retained.stage === "nfl" ? "NFL" : "portal"} · ${money(p.retained.nil)}` : opening[p.id]?.kind === "stayed" ? "Passed on the NFL" : ROLE_LABEL[p.role]}
                  </span>
                  {canRelease && p.status === "roster" && p.team === myTeam && releaseBtns(p)}
                </span>
              )} />
            ))}
          </Fragment>
        ))}
      </Section>
      <Section title={`${season} commits (${signees ? commits.length : "…"})`}>
        {signees === null ? <Empty>Loading…</Empty> : commits.length === 0 ? <Empty>No {season} commits at {pos}.</Empty> : commits.map((r) => (
          <div key={r.id} className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "9px 10px" : "10px 16px", borderBottom: `1px solid ${LINE}` }}>
            <span title="Recruiting stars" style={{ width: isMobile ? 40 : 52, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 900, color: GOLD }}>{r.rs ? `${r.rs}★` : "—"}</span>
            <span style={{ width: isMobile ? 38 : 46, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "4px 0" }}>{r.sub || r.pos}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: isMobile ? 14 : 16 }}>{r.n}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: SUB }}>{[r.hs, r.st].filter(Boolean).join(", ")}{r.rr ? ` · No. ${r.rr} nationally` : ""}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8", flexShrink: 0 }}>Committed</span>
          </div>
        ))}
      </Section>
      {inPortal.length > 0 && (
        <Section title={`In the portal (${inPortal.length})`}>
          {inPortal.map((p) => <PlayerLine key={p.id} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} extra={p.released ? "Released" : null} right={<span style={{ fontSize: 12, fontWeight: 800, color: GOLD }}>{Object.keys(p.offers).length} offer{Object.keys(p.offers).length === 1 ? "" : "s"}</span>} />)}
        </Section>
      )}
      <Section tone="gone" title={`Gone — no longer on the team (${left.length})`}>
        {left.length === 0 ? <Empty>No one.</Empty> : left.map((p) => (
          <PlayerLine key={p.id} p={p} brand={brand} to={p.status === "committed" ? p.to : null} isMobile={isMobile} onOpen={sim.openCard} extra={p.status === "declared" && p.dg != null ? gradeLabel(p.dg) : null} right={(
            <span style={{ fontSize: 12, fontWeight: 800, color: SUB, textAlign: "right" }}>
              {p.status === "committed" ? `${p.to === p.team ? "Returned to" : "Transferred to"} ${state.teams[p.to]?.school}` : p.status === "unsigned" ? "Unsigned" : `NFL · ${GONE_LABEL[p.reason] || "Draft"}`}
              {opening[p.id]?.offered ? <><br /><span style={{ color: "#ff8a7a" }}>Turned down {money(opening[p.id].nil)}</span></> : null}
            </span>
          )} />
        ))}
      </Section>
      {releaseDialog}
    </>
  );
}

// A position's roster split by sub-position (DB → CB / S, OL → OT / IOL),
// each still in rank order; other positions are one unlabeled group.
// Anyone without a sub-position lands in a trailing "Other" group.
function subGroups(pos, list) {
  const subs = (SUBS[pos] || []).filter(([k]) => k);
  if (!subs.length) return [["", list]];
  const groups = subs.map(([k, label]) => [label, list.filter((p) => p.sub === k)]);
  const rest = list.filter((p) => !subs.some(([k]) => p.sub === k));
  return rest.length ? groups.concat([["Other", rest]]) : groups;
}

// Positions on a tab (K and P share one).
const posGroup = (x) => (x === "K/P" ? ["K", "P"] : [x]);
// NFL departures: drafted (a grade, Declared, chose it) first — best grade
// first — then out of eligibility.
const sortNfl = (list) => [...list].sort((a, b) => (a.reason === "exhausted") - (b.reason === "exhausted") || (a.dg ?? 99) - (b.dg ?? 99) || b.stars - a.stars);

// Starters/rotation lost at each position so far.
function LosingChips({ state, team }) {
  const losing = Object.entries(urgencyOf(state, team)).filter(([, u]) => u.lost > 0).sort((a, b) => b[1].lost - a[1].lost);
  if (!losing.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "10px 14px", borderBottom: `1px solid ${LINE}` }}>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB }}>LOSING</span>
      {losing.map(([pos, u]) => <span key={pos} style={{ fontSize: 12, fontWeight: 900, borderRadius: 999, padding: "3px 10px", background: u.urgency >= 1.4 ? "#3a1219" : "#13233f", color: u.urgency >= 1.4 ? "#ffb3a8" : "#9fc3ff" }}>{pos} {u.lost}</span>)}
    </div>
  );
}

// The fence / wants-out list with retention offers (an opening window's
// negotiating).
function Negotiate({ sim, isMobile }) {
  const { state, view, stage } = sim;
  const nfl = stage === "nfl";
  // Draft prospects best grade first; would-be transfers by stars, then role.
  const list = [...view.considering].sort((a, b) => (nfl ? (a.dg ?? 99) - (b.dg ?? 99) : b.stars - a.stars || ROLE_RANK[a.role] - ROLE_RANK[b.role]) || b.stars - a.stars || M_value(b) - M_value(a));
  const canAct = sim.phase === "window";
  return (
    <Section title={nfl ? `On the fence (${list.length})` : `Trying to leave (${list.length})`}>
      {list.length === 0 ? <Empty>{nfl ? "No one on the fence." : "No one wants out."}</Empty> : list.map((p) => {
        const odds = retainOdds(state, p);
        const [lean, leanColor] = nfl ? leanLabel(odds.chance) : odds.chance ? [`${pct(odds.chance)} to stay`, odds.chance >= 0.5 ? "#7ee2a8" : GOLD] : ["Gone without an offer", "#ff8a7a"];
        return (
          <div key={p.id}>
            <PlayerLine p={p} brand={() => null} isMobile={isMobile} onOpen={sim.openCard} extra={nfl ? gradeLabel(p.dg) : WANTS_LABEL[p.reason]} right={(
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, textAlign: "right" }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: leanColor }}>{lean}{nfl && !isMobile ? ` · ${pct(odds.chance)}` : ""}{p.retain ? <><br /><span style={{ color: "#7ee2a8" }}>{money(p.retain.nil)}</span></> : null}</span>
                {canAct && <button type="button" onClick={() => sim.openCard(p.id)} style={pillBtn(!!p.retain, p.retain ? "#2e7d32" : BLUE)}>{p.retain ? "Edit" : "Retain"}</button>}
              </div>
            )} />
          </div>
        );
      })}
    </Section>
  );
}

// What an opening window's log says about one of ours: kept, came back,
// turned down an offer.
const outcome = (e) => (!e ? null : e.kind === "retained" ? [`Kept · ${money(e.nil)}`, "#7ee2a8"] : e.kind === "stayed" ? ["Came back", SUB] : e.offered ? [`Turned down ${money(e.nil)}`, "#ff8a7a"] : null);

// ── NFL Decisions: opening window 1 — negotiating, then what happened ──
function NflTab({ sim, team, isMobile }) {
  const { state, stage } = sim;
  const events = state.log.filter((e) => e.stage === "nfl" && e.team === team);
  const byPid = Object.fromEntries(events.map((e) => [e.pid, e]));
  const back = events.filter((e) => e.kind === "retained" || e.kind === "stayed").map((e) => state.players[e.pid]);
  // Everyone who left for the draft — drafted first, then out of eligibility.
  const gone = sortNfl(Object.values(state.players).filter((p) => p.team === team && p.status === "declared"));
  return (
    <>
      <LosingChips state={state} team={team} />
      {stage === "nfl" ? <Negotiate sim={sim} isMobile={isMobile} /> : (
        <Section title={`Coming back (${back.length})`}>
          {back.length === 0 ? <Empty>No one on the fence came back.</Empty> : back.map((p) => {
            const [text, color] = outcome(byPid[p.id]) || ["", SUB];
            return <PlayerLine key={p.id} p={p} brand={() => null} isMobile={isMobile} onOpen={sim.openCard} extra={gradeLabel(p.dg)} right={<span style={{ fontSize: 12, fontWeight: 900, color }}>{text}</span>} />;
          })}
        </Section>
      )}
      <Section title={`Leaving for the NFL (${gone.length})`}>
        {gone.length === 0 ? <Empty>No one.</Empty> : gone.map((p) => {
          const o = outcome(byPid[p.id]);
          return <PlayerLine key={p.id} p={p} brand={() => null} isMobile={isMobile} onOpen={sim.openCard} extra={p.dg != null ? gradeLabel(p.dg) : null}
            right={<span style={{ fontSize: 12, fontWeight: 800, color: o ? o[1] : SUB, textAlign: "right" }}>{GONE_LABEL[p.reason] || "NFL Draft"}{o ? <><br />{o[0]}</> : null}</span>} />;
        })}
      </Section>
    </>
  );
}

// ── Leaving: opening window 2 — players trying to enter the portal ──
function LeavingTab({ sim, team, brand, isMobile }) {
  const { state, stage } = sim;
  const events = state.log.filter((e) => e.stage === "retain" && e.team === team);
  const kept = events.filter((e) => e.kind === "retained");
  const left = events.filter((e) => e.kind === "entered").map((e) => ({ e, p: state.players[e.pid] }));
  const offers = (p) => Object.keys(p.offers).length;
  const where = (p) => (p.status === "committed" ? [state.teams[p.to]?.school, "#7ee2a8"] : p.status === "unsigned" ? ["Unsigned", SUB]
    : [isMobile ? `In portal · ${offers(p)}` : `In the portal · ${offers(p)} offer${offers(p) === 1 ? "" : "s"}`, GOLD]);
  // Our own logo adds nothing on our own players — only where they went.
  const brandOut = (slug, p) => (slug === team && (p?.status === "roster" || p?.status === "considering") ? null : brand(slug));
  return (
    <>
      <LosingChips state={state} team={team} />
      {stage === "retain" ? <Negotiate sim={sim} isMobile={isMobile} /> : (
        <>
          <Section title={`Kept (${kept.length})`}>
            {kept.length === 0 ? <Empty>You didn't keep anyone who wanted out.</Empty> : kept.map((e) => (
              <PlayerLine key={e.pid} p={state.players[e.pid]} brand={() => null} isMobile={isMobile} onOpen={sim.openCard} extra={WANTS_LABEL[state.players[e.pid].reason]} right={<span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>Kept · {money(e.nil)}</span>} />
            ))}
          </Section>
          <Section title={`Entered the portal (${left.length})`}>
            {left.length === 0 ? <Empty>No one.</Empty> : left.map(({ e, p }) => {
              const [text, color] = where(p);
              return <PlayerLine key={p.id} p={p} brand={brandOut} to={p.status === "committed" ? p.to : null} isMobile={isMobile} onOpen={sim.openCard} extra={WANTS_LABEL[p.reason]}
                right={<span style={{ fontSize: 12, fontWeight: 800, color, textAlign: "right" }}>{text}{e.offered ? <><br /><span style={{ color: "#ff8a7a" }}>Turned down {money(e.nil)}</span></> : null}</span>} />;
            })}
          </Section>
        </>
      )}
    </>
  );
}

// ── Market Watch (user, 2026-11-18): between the portal's halves ──
// A quick stop, not a window: the halftime report (signed, missed, the head
// coach's read and the next window's priorities — staff.js marketReport),
// your ultimatums (pay or he enters) and who's leaving your roster — then
// the portal reopens. Around the country shows
// in Results once it does.
function MarketTab({ sim, team, brand, isMobile }) {
  const { state } = sim;
  const mine = Object.values(state.players).filter((p) => p.team === team && p.status === "considering" && p.considering === "demand");
  const events = state.log.filter((e) => e.stage === "market");
  const leaving = events.filter((e) => e.kind === "entered" && e.team === team).map((e) => ({ e, p: state.players[e.pid] })).filter((x) => x.p);
  const country = events.filter((e) => e.kind === "entered").length;
  const report = marketReport(state, team);
  const asks = events.filter((e) => e.kind === "demand").length + Object.values(state.players).filter((p) => p.considering === "demand").length;
  return (
    <>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${LINE}`, fontSize: 13, fontWeight: 700, color: SUB, lineHeight: 1.5 }}>
        <b style={{ color: GOLD, letterSpacing: "0.08em" }}>MARKET WATCH</b> · The signing wave is over. Settle your roster, then the portal reopens for {state.cfg.split?.after ?? 4} more windows.
        <span style={{ display: "block", marginTop: 4, color: "#9fc3ff" }}>Around the country: {country} new name{country === 1 ? "" : "s"} in the portal · {asks} star{asks === 1 ? "" : "s"} asked for the market rate.</span>
      </div>
      {/* The head coach's halftime read, and the second half's priorities. */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${LINE}`, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <CoachChip role="HC" size="md" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB, marginBottom: 4 }}>HEAD COACH · HALFTIME</div>
          {report.lines.map((l) => <div key={l} style={{ fontSize: isMobile ? 14 : 15, fontWeight: 800, fontStyle: "italic", lineHeight: 1.45, marginBottom: 3 }}>“{l}”</div>)}
          {report.priorities.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB }}>NEXT WINDOW</span>
              {report.priorities.slice(0, 5).map(({ pos, level }) => {
                const [, label, color] = needLevelOf(level);
                return <span key={pos} title={label} style={{ fontSize: 12, fontWeight: 900, color, border: `1px solid ${color}88`, borderRadius: 999, padding: "2px 10px" }}>{pos}</span>;
              })}
            </div>
          )}
        </div>
      </div>
      <Section title={`Your first half · signed (${report.signed.length})`}>
        {report.signed.length === 0 ? <Empty>No signings yet.</Empty> : report.signed.map((p) => (
          <PlayerLine key={p.id} p={p} brand={brand} to={team} isMobile={isMobile} onOpen={sim.openCard} right={<span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(p.deal?.nil || 0)}</span>} />
        ))}
      </Section>
      {report.missed.length > 0 && (
        <Section tone="gone" title={`Missed (${report.missed.length})`}>
          {report.missed.map((p) => (
            <PlayerLine key={p.id} p={p} brand={brand} to={p.to} isMobile={isMobile} onOpen={sim.openCard} right={<span style={{ fontSize: 12, fontWeight: 800, color: SUB, textAlign: "right" }}>Signed with {state.teams[p.to]?.school} · {money(p.deal?.nil || 0)}</span>} />
          ))}
        </Section>
      )}
      <Section title={`Ultimatums (${mine.length})`}>
        {mine.length === 0 ? <Empty>No one on your roster is asking for more.</Empty> : mine.map((p) => {
          const comp = state.players[p.demand.comp];
          const paying = p.retain && p.retain.nil >= p.demand.nil;
          return (
            <div key={p.id}>
              <PlayerLine p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} flush right={(
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: GOLD }}>{money(p.demand.nil)}</span>
                  <button type="button" disabled={!paying && sim.view.available < p.demand.nil} onClick={() => sim.retain(p.id, { nil: p.demand.nil })} style={{ ...pillBtn(paying, "#2e7d32"), opacity: !paying && sim.view.available < p.demand.nil ? 0.45 : 1 }}>{paying ? "Paying ✓" : "Pay him"}</button>
                  <button type="button" onClick={() => sim.unretain(p.id)} style={{ ...pillBtn(!paying, "#c0392b"), ...(paying ? { color: "#ff8a7a", borderColor: "#5c1f28" } : {}) }}>{paying ? "Let him go" : "Letting him go"}</button>
                </span>
              )} />
              <div style={{ padding: "0 16px 10px", fontSize: 12, fontWeight: 700, color: SUB, borderBottom: `1px solid ${LINE}` }}>
                {comp ? <>He saw <b style={{ color: INK }}>{comp.name}</b> ({comp.stars}★ {comp.pos}) sign with {state.teams[comp.to]?.school} for <b style={{ color: INK }}>{money(comp.deal?.nil || 0)}</b>. </> : null}
                He wants {money(p.demand.nil)} or he enters the portal.{sim.view.available < p.demand.nil && !paying ? <span style={{ color: "#ff8a7a" }}> You have {money(sim.view.available)} left.</span> : null}
              </div>
            </div>
          );
        })}
      </Section>
      {/* Leaving: you can make any of them an offer to come back (user,
          2026-11-18) — engine userOffer allows your own in Market Watch. */}
      <Section tone="gone" title={`Leaving your roster (${leaving.length})`}>
        {leaving.length > 0 && <div style={{ padding: "8px 16px", fontSize: 12, fontWeight: 700, color: SUB, borderBottom: `1px solid ${LINE}` }}>They're entering the portal — make an offer now to try to bring them back. Everyone else waits until window {(state.cfg.split?.at ?? 0) + 1}.</div>}
        {leaving.length === 0 ? <Empty>No one's leaving.</Empty> : leaving.map(({ e, p }) => {
          const o = p.offers?.[team];
          return (
            <PlayerLine key={p.id} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} extra={e.demand ? "Didn't get the market rate" : "Lost his spot to a signing"}
              right={p.status !== "portal" ? <span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{p.status === "committed" && p.to === team ? "Coming back" : "Gone"}</span>
                : <button type="button" onClick={() => sim.openCard(p.id)} style={{ ...pillBtn(!!o, "#2e7d32"), ...(o ? {} : { color: "#7ee2a8", borderColor: "#2e7d4f" }) }}>{o ? `Offered ${money(o.nil)}` : "Offer to keep"}</button>} />
          );
        })}
      </Section>
    </>
  );
}
// What Market Watch did: new entrants (yours first), demands around the
// country (paid / entered).
function MarketRecap({ sim, team, brand, isMobile, events, live = false }) {
  const { state } = sim;
  const entered = events.filter((e) => e.kind === "entered").map((e) => ({ e, p: state.players[e.pid] })).filter((x) => x.p)
    .sort((a, b) => (b.e.team === team) - (a.e.team === team) || b.p.stars - a.p.stars);
  const demands = events.filter((e) => e.kind === "demand").map((e) => ({ e, p: state.players[e.pid] })).filter((x) => x.p).sort((a, b) => b.p.stars - a.p.stars);
  const why = (e) => (e.demand ? "Didn't get the market rate" : e.reshuffle ? "Pushed down the depth chart" : WANTS_LABEL[e.reason] || "Entered");
  return (
    <>
      <Section title={`${live ? "New in the portal" : "Entered during Market Watch"} (${entered.length})`}>
        {entered.length === 0 ? <Empty>No new entrants.</Empty> : entered.slice(0, 120).map(({ e, p }) => (
          <PlayerLine key={`${p.id}-${e.kind}`} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} extra={why(e)}
            right={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{e.team === team ? <span style={{ fontSize: 12, fontWeight: 900, color: "#ff8a7a" }}>Your player</span> : null}<ContactBtn sim={sim} pid={p.id} /></span>} />
        ))}
      </Section>
      {demands.length > 0 && (
        <Section title={`Market rate demands (${demands.length})`}>
          {demands.map(({ e, p }) => (
            <PlayerLine key={`d-${p.id}`} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard}
              right={<span style={{ fontSize: 12, fontWeight: 900, textAlign: "right", color: e.paid ? "#7ee2a8" : "#ff8a7a" }}>{e.paid ? `Paid ${money(e.nil)} to stay` : `Wanted ${money(e.nil)} · entered the portal`}</span>} />
          ))}
        </Section>
      )}
    </>
  );
}

// ── Results: the last window, for my team and around the country ──
function ResultsTab({ sim, team, brand, isMobile }) {
  const [sub, setSub] = useState("mine");
  const { recap } = sim;
  const title = !recap ? "" : recap.stage === "market" ? "Market Watch" : recap.stage === "opening" ? "Who left" : recap.stage ? "Opening window 2 · Leaving" : recap.evalPeriod ? "Evaluation period" : `Portal window ${recap.window}`;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <button type="button" style={pillBtn(sub === "mine", GOLD)} onClick={() => setSub("mine")}>My Team</button>
        <button type="button" style={pillBtn(sub === "country", GOLD)} onClick={() => setSub("country")}>Around the Country</button>
        <span style={{ flex: 1 }} />
        {title && <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB, textTransform: "uppercase" }}>{title}</span>}
      </div>
      {!recap ? <Empty>Nothing yet.</Empty> : sub === "mine" ? <MyResults sim={sim} team={team} brand={brand} isMobile={isMobile} /> : <CountryResults sim={sim} team={team} brand={brand} isMobile={isMobile} />}
    </>
  );
}

const ResultLine = ({ p, brand, to, isMobile, extra, text, color, sim, cols }) => (
  <PlayerRow cols={cols} p={p} brand={brand} to={to} isMobile={isMobile} extra={extra} onOpen={sim?.openCard} right={(
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color, textAlign: "right" }}>{text}</span>
      {sim && <ContactBtn sim={sim} pid={p.id} />}
    </div>
  )} />
);

// My Team. After the opening: who took your offer to stay, who turned it
// down and entered the portal, who you let go. After a portal window: who
// accepted your offers, who didn't (signed elsewhere, or still in the
// portal), and starred players who signed.
function MyResults({ sim, team, brand, isMobile }) {
  const { state, recap } = sim;
  const brandOut = (slug, p) => (slug === team && (p?.status === "roster" || p?.status === "considering") ? null : brand(slug));
  if (recap.stage === "market") return <MarketRecap sim={sim} team={team} brand={brand} isMobile={isMobile} events={recap.events} />;
  // The real portal (user, 2026-11-18): no NFL or retention windows — one
  // recap of who from your team left, and why.
  if (recap.stage === "opening") {
    const mine = recap.events.filter((e) => e.team === team);
    const nfl = sortNfl(mine.filter((e) => e.kind === "declared").map((e) => state.players[e.pid]));
    const portal = mine.filter((e) => e.kind === "entered").map((e) => state.players[e.pid]).sort((a, b) => b.stars - a.stars);
    return (
      <>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${LINE}`, fontSize: 13, fontWeight: 700, color: SUB, lineHeight: 1.45 }}>
          The real decisions are in — no NFL or retention windows. {nfl.length + portal.length} player{nfl.length + portal.length === 1 ? "" : "s"} left your roster.
        </div>
        <Section tone="gone" title={`Entered the transfer portal (${portal.length})`}>
          {portal.length === 0 ? <Empty>No one.</Empty> : portal.map((p) => <ResultLine key={p.id} p={p} brand={brand} to={p.status === "committed" ? p.to : null} isMobile={isMobile} extra={WANTS_LABEL[p.reason] || "In the real portal"} text={standing(state, p, team)[0]} color={standing(state, p, team)[1]} sim={sim} />)}
        </Section>
        <Section tone="gone" title={`Left for the NFL (${nfl.length})`}>
          {nfl.length === 0 ? <Empty>No one.</Empty> : nfl.map((p) => <ResultLine key={p.id} p={p} brand={() => null} isMobile={isMobile} extra={p.dg != null ? gradeLabel(p.dg) : null} text={GONE_LABEL[p.reason] || "NFL Draft"} color={SUB} />)}
        </Section>
      </>
    );
  }
  if (recap.stage) {
    const mine = recap.events.filter((e) => e.team === team);
    const kept = mine.filter((e) => e.kind === "retained");
    const declined = mine.filter((e) => e.kind === "entered" && e.offered);
    const letGo = mine.filter((e) => e.kind === "entered" && !e.offered);
    const now = (p) => standing(state, p, team);
    return (
      <>
        <Section title={`Accepted your offer to stay (${kept.length})`}>
          {kept.length === 0 ? <Empty>No one.</Empty> : kept.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brandOut} isMobile={isMobile} extra={WANTS_LABEL[state.players[e.pid].reason]} text={`Kept · ${money(e.nil)}`} color="#7ee2a8" sim={sim} />)}
        </Section>
        <Section tone="gone" title={`Declined — entered the portal (${declined.length})`}>
          {declined.length === 0 ? <Empty>No one.</Empty> : declined.map((e) => {
            const p = state.players[e.pid];
            return <ResultLine key={e.pid} p={p} brand={brandOut} to={p.status === "committed" ? p.to : null} isMobile={isMobile} extra={`Turned down ${money(e.nil)}`} text={now(p)[0]} color={now(p)[1]} sim={sim} />;
          })}
        </Section>
        <Section tone="gone" title={`You let them go — entered the portal (${letGo.length})`}>
          {letGo.length === 0 ? <Empty>No one.</Empty> : letGo.map((e) => {
            const p = state.players[e.pid];
            return <ResultLine key={e.pid} p={p} brand={brandOut} to={p.status === "committed" ? p.to : null} isMobile={isMobile} extra={WANTS_LABEL[p.reason]} text={now(p)[0]} color={now(p)[1]} sim={sim} />;
          })}
        </Section>
      </>
    );
  }
  if (recap.evalPeriod) {
    const board = [...sim.starred].map((id) => state.players[id]).filter((p) => p?.status === "portal").sort((a, b) => b.stars - a.stars);
    return (
      <Section title={`Your contacts after the evaluation period (${board.length})`}>
        {board.length === 0 ? <Empty>You didn't contact anyone. Contact players from the Portal tab.</Empty> : board.map((p) => {
          const [text, color] = boardStanding(state, p, team);
          return <ResultLine key={p.id} p={p} brand={brand} isMobile={isMobile} text={text} color={color} sim={sim} />;
        })}
      </Section>
    );
  }
  const accepted = recap.commits.filter((e) => e.to === team);
  const signedAway = recap.commits.filter((e) => e.to !== team && e.offeredBy?.includes(team));
  // Offered before this window and still undecided.
  const stillOut = sim.portal.filter((p) => p.offers[team] && p.offers[team].window < state.window);
  const shownIds = new Set([...accepted, ...signedAway].map((e) => e.pid));
  const starredSigned = recap.commits.filter((e) => sim.starred.has(e.pid) && !shownIds.has(e.pid));
  const lostOwn = recap.commits.filter((e) => e.team === team && e.to !== team && !shownIds.has(e.pid));
  // Players who narrowed their lists and left you off (unless he signed
  // elsewhere this window — that line already says so).
  const signedIds = new Set(signedAway.map((e) => e.pid));
  const cutYou = (recap.cuts || []).filter((e) => e.to === team && !signedIds.has(e.pid));
  const cutIds = new Set(cutYou.map((e) => e.pid));
  // In the mix: didn't accept yet, still open, and still considering you —
  // in your board's order (user, 2026-11-18), as are your other contacts.
  const boardAt = new Map(sim.boardList.map((p, i) => [p.id, i]));
  const byBoard = (a, b) => (boardAt.get(a.id) ?? 999) - (boardAt.get(b.id) ?? 999);
  const inMix = stillOut.filter((p) => !cutIds.has(p.id)).sort(byBoard);
  // Your contacts with no offer yet, and where you stand with them.
  const contactsOnly = sim.portal.filter((p) => p.evals?.[team] != null && !p.offers[team]).sort(byBoard);
  // No longer negotiating: signed elsewhere, or cut you.
  const doneCount = signedAway.length + cutYou.length;
  return (
    <>
      <Section title={`Accepted your offer (${accepted.length})`}>
        {accepted.length === 0 ? <Empty>No one this window.</Empty> : accepted.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} to={team} isMobile={isMobile} text={`Signed · ${money(e.nil)}${e.blowout ? " · on the spot" : ""}`} color="#7ee2a8" sim={sim} />)}
      </Section>
      <Section title={`In the mix (${inMix.length})`}>
        {/* Where you rank with each — the same read as My Board. */}
        {inMix.length === 0 ? <Empty>No one.</Empty> : inMix.map((p) => {
          const [text, color] = boardStanding(state, p, team);
          return <ResultLine key={p.id} p={p} brand={brand} isMobile={isMobile} extra={`Your offer: ${money(p.offers[team].nil)}`} text={text} color={color} sim={sim} />;
        })}
      </Section>
      {contactsOnly.length > 0 && (
        <Section title={`Contacted — no offer yet (${contactsOnly.length})`}>
          {contactsOnly.map((p) => {
            const [text, color] = boardStanding(state, p, team);
            return <ResultLine key={p.id} p={p} brand={brand} isMobile={isMobile} text={text} color={color} sim={sim} />;
          })}
        </Section>
      )}
      <Section tone="gone" title={`No longer negotiating (${doneCount})`}>
        {doneCount === 0 ? <Empty>No one.</Empty> : (
          <>
            {signedAway.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} to={e.to} isMobile={isMobile} text={`Signed with ${state.teams[e.to]?.school} · ${money(e.nil)}`} color="#ff8a7a" sim={sim} />)}
            {cutYou.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} isMobile={isMobile} text={e.why === "fit" ? "Not a fit — cut you" : `Cut you · down to his top ${e.list}`} color="#ff8a7a" sim={sim} />)}
          </>
        )}
      </Section>
      {starredSigned.length > 0 && (
        <Section title={`Contacts who signed (${starredSigned.length})`}>
          {starredSigned.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} to={e.to} isMobile={isMobile} text={`Signed with ${state.teams[e.to]?.school} · ${money(e.nil)}`} color={SUB} sim={sim} />)}
        </Section>
      )}
      {lostOwn.length > 0 && (
        <Section tone="gone" title={`Your former players who signed (${lostOwn.length})`}>
          {lostOwn.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brandOut} to={e.to} isMobile={isMobile} text={`Transferred to ${state.teams[e.to]?.school} · ${money(e.nil)}`} color={SUB} sim={sim} />)}
        </Section>
      )}
    </>
  );
}

// Around the Country: every move from the last window, with the Portal
// tab's filters.
function CountryResults({ sim, team, brand, isMobile }) {
  const { state, recap, view } = sim;
  const f = useFilters(view);
  const [kind, setKind] = useState("");
  const [shown, setShown] = useState(60);
  const moves = useMemo(() => (recap.stage
    ? recap.events.filter((e) => e.kind === "entered" || e.kind === "retained")
    : [...recap.commits, ...recap.unsigned]
  ).map((e) => ({ e, p: state.players[e.pid] })), [recap, state.players]);
  const kinds = [...new Set(moves.map((m) => m.e.kind))];
  const word = { committed: "Signed", unsigned: "Unsigned", entered: "Entered the portal", retained: "Kept" };
  const list = useMemo(() => {
    const base = moves.filter(({ e, p }) => (!kind || e.kind === kind) && f.match(p)).sort((a, b) => b.p.stars - a.p.stars || a.p.name.localeCompare(b.p.name));
    const order = sortRows(base.map((m) => m.p), f);
    const at = new Map(order.map((p, i) => [p.id, i]));
    return [...base].sort((a, b) => at.get(a.p.id) - at.get(b.p.id));
  }, [moves, kind, f]);
  const cols = tableCols(f);
  useEffect(() => { setShown(60); }, [kind, f]);
  return (
    <>
      <FilterBar f={f} view={view} isMobile={isMobile} />
      {kinds.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
          <button type="button" style={pillBtn(!kind)} onClick={() => setKind("")}>All moves ({moves.length})</button>
          {kinds.map((k) => <button key={k} type="button" style={pillBtn(kind === k)} onClick={() => setKind(k)}>{word[k]} ({moves.filter((m) => m.e.kind === k).length})</button>)}
        </div>
      )}
      {list.length === 0 ? <Empty>No moves match.</Empty> : <TableWrap cols={cols} f={f} isMobile={isMobile}>{list.slice(0, shown).map(({ e, p }) => (
        <ResultLine key={`${e.kind}-${p.id}`} cols={cols} p={p} brand={brand} to={e.kind === "committed" ? e.to : null} isMobile={isMobile}
          text={e.kind === "committed" ? `${e.to === p.team ? "Returned" : e.to === team ? "Signed with you" : "Signed"} · ${money(e.nil)}` : e.kind === "retained" ? `Kept · ${money(e.nil)}` : word[e.kind]}
          color={e.kind === "committed" ? "#7ee2a8" : e.kind === "unsigned" ? SUB : e.kind === "retained" ? "#9fc3ff" : GOLD} sim={sim} />
      ))}</TableWrap>}
      {list.length > shown && <ShowMore n={list.length - shown} onClick={() => setShown((n) => n + 60)} />}
    </>
  );
}

// ── The end (user, 2026-11-18): how you did, against every team ──
// Any team's row opens its portal class (user, 2026-11-18), with what it
// cost and its money efficiency (class value per $1M, graded against every
// class).
// One screen, no console under it: your verdict — did the portal leave your
// roster Much Worse, Worse, Made Whole, Better or Much Better — your class
// (grade, rank, the signings revealed one by one, reading down two columns
// — memory: boards fill columns), then every FBS team's verdict.
// Roster strength: each position's starters plus its rotation (cpu.depth,
// at 35%) by effective level (engine effOf — stars, less for not having
// played), weighted like the CPU weighs positions; an empty spot counts as
// a walk-on (1). Before = the roster the offseason started with, less the
// players out of eligibility (every school loses those, and the sim has no
// freshmen to replace them); after = who stayed plus who signed.
// Thresholds calibrated on CPU-only runs (2026-11-18): the median team
// lands near Made Whole; ~10% Much Better, ~20% Much Worse.
const CLASS_GRADES = [[0.05, "A+"], [0.12, "A"], [0.2, "A-"], [0.3, "B+"], [0.42, "B"], [0.55, "B-"], [0.67, "C+"], [0.78, "C"], [0.88, "C-"], [1.01, "D"]];
const gradeColorOf = (g) => (g.startsWith("A") ? "#7ee2a8" : g.startsWith("B") ? "#9fc3ff" : g.startsWith("C") ? GOLD : "#ff8a7a");
// Change in roster strength (%) → the verdict.
const OUTCOMES = [
  [8, "Much Better", "#2ee08a"],
  [2, "Got Better", "#7ee2a8"],
  [-2, "Made Whole", "#9fc3ff"],
  [-8, "Got Worse", "#ff9f43"],
  [-Infinity, "Much Worse", "#ff6b5b"],
];
const outcomeOf = (pct) => OUTCOMES.find(([min]) => pct >= min);
function strengthOf(list, cfg) {
  const byPos = {};
  list.forEach((p) => { (byPos[p.pos] = byPos[p.pos] || []).push(effOf(p, cfg)); });
  let total = 0;
  Object.entries(cfg.starters).forEach(([pos, n]) => {
    const effs = (byPos[pos] || []).sort((a, b) => b - a);
    const d = cfg.cpu?.depth?.[pos] ?? 0;
    const w = cfg.cpu?.posWeight?.[pos] ?? 1;
    for (let i = 0; i < n + d; i += 1) total += w * (i < n ? 1 : 0.35) * (effs[i] ?? 1);
  });
  return total;
}
// Every FBS team's offseason: { slug, before, after, pct, label, color, in, out }.
function teamOutcomes(state) {
  const was = {};
  const now = {};
  const ins = {};
  const outs = {};
  const spent = {};
  Object.values(state.players).forEach((p) => {
    if (!(p.status === "declared" && p.reason === "exhausted")) (was[p.team] = was[p.team] || []).push(p);
    const stays = p.status === "roster" || (p.status === "committed" && p.to === p.team);
    if (stays) (now[p.team] = now[p.team] || []).push(p);
    else outs[p.team] = (outs[p.team] || 0) + 1;
    if (p.status === "committed" && p.to !== p.team) {
      (now[p.to] = now[p.to] || []).push(p);
      ins[p.to] = (ins[p.to] || 0) + 1;
      spent[p.to] = (spent[p.to] || 0) + (p.deal?.nil || 0);
    }
  });
  return Object.values(state.teams).filter((t) => !t.fcs).map((t) => {
    const before = strengthOf(was[t.slug] || [], state.cfg);
    const after = strengthOf(now[t.slug] || [], state.cfg);
    const pct = before ? ((after - before) / before) * 100 : 0;
    const [, label, color] = outcomeOf(pct);
    // What the class itself added: the roster with it, less without it —
    // holes filled and spots upgraded (a signing who doesn't crack the
    // two-deep adds little).
    const gain = after - strengthOf((now[t.slug] || []).filter((p) => !(p.status === "committed" && p.to === t.slug && p.team !== t.slug)), state.cfg);
    return { slug: t.slug, school: t.school, conference: t.conference, before, after, pct, label, color, in: ins[t.slug] || 0, out: outs[t.slug] || 0, gain, spent: spent[t.slug] || 0 };
  }).sort((a, b) => b.pct - a.pct);
}

function Final({ state, team, run, branding, brand, isMobile, onRerun, onSettings }) {
  const outcomes = useMemo(() => teamOutcomes(state), [state]);
  const [pick, setPick] = useState("");
  const [conf, setConf] = useState("");
  const [openTeam, setOpenTeam] = useState(null); // a team's class, opened from the list
  // Every school's signings (best first) and who it lost.
  const classOf = (slug) => state.log.filter((e) => e.kind === "committed" && e.to === slug && state.players[e.pid]?.team !== slug).map((e) => ({ e, p: state.players[e.pid] }))
    .sort((a, b) => b.p.stars - a.p.stars || b.e.nil - a.e.nil);
  const me = outcomes.find((o) => o.slug === team) || { pct: 0, label: "Made Whole", color: "#9fc3ff", in: 0, out: 0 };
  const myRank = outcomes.findIndex((o) => o.slug === team) + 1;
  // The class: score (stars²), rank and grade among every school's class.
  const classes = {};
  state.log.filter((e) => e.kind === "committed").forEach((e) => {
    const c = (classes[e.to] = classes[e.to] || { slug: e.to, n: 0, score: 0, spent: 0 });
    c.n += 1; c.score += state.players[e.pid].stars ** 2; c.spent += e.nil;
  });
  const ranked = Object.values(classes).sort((a, b) => b.score - a.score);
  // Money efficiency (user, 2026-11-18: bang for your buck — how well a
  // school spent to fill holes and upgrade spots): what its class added to
  // the roster (teamOutcomes gain — starters and the two-deep) per $1M of
  // NIL, graded by where it ranks among every class that cost something.
  const effOrder = outcomes.filter((o) => o.spent > 0).map((o) => ({ slug: o.slug, v: o.gain / (o.spent / 1e6) })).sort((a, b) => b.v - a.v);
  const costOf = Object.fromEntries(outcomes.map((o) => [o.slug, o.spent]));
  const effGrade = Object.fromEntries(effOrder.map((c, i) => [c.slug, CLASS_GRADES.find(([share]) => i / Math.max(1, effOrder.length) < share)[1]]));
  const rank = ranked.findIndex((c) => c.slug === team) + 1;
  const grade = rank ? CLASS_GRADES.find(([share]) => (rank - 1) / Math.max(1, ranked.length) < share)[1] : null;
  const mine = classes[team] || { n: 0, spent: 0 };
  const signings = state.log.filter((e) => e.kind === "committed" && e.to === team).map((e) => ({ e, p: state.players[e.pid] }))
    .sort((a, b) => b.p.stars - a.p.stars || b.e.nil - a.e.nil);
  const departed = Object.values(state.players).filter((p) => p.team === team && !(p.status === "roster" || (p.status === "committed" && p.to === team)));
  const toNfl = departed.filter((p) => p.status === "declared").length;
  const kept = state.log.filter((e) => e.kind === "retained" && e.team === team).length;
  const b = brand(team) || {};
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const rows = Math.ceil(signings.length / 2);
  const counts = Object.fromEntries(OUTCOMES.map(([, l]) => [l, outcomes.filter((o) => o.label === l).length]));
  const confs = FBS_CONFERENCES.filter((c) => outcomes.some((o) => o.conference === c));
  const shown = outcomes.filter((o) => (!pick || o.label === pick) && (!conf || o.conference === conf));
  const fmtPct = (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
  // The class as it's saved and shared (utils/portalSim/publicSims.js).
  const rec = {
    season: state.season ? state.season + 1 : portalSimYear(), team, school: b.School || state.teams[team]?.school || team,
    frequency: run?.frequency || "default", live: !!run?.live,
    grade: grade || null, rank: rank || null, of: ranked.length, eff: effGrade[team] || null, spent: Math.round(costOf[team] || 0),
    verdict: me.label, pct: Math.round(me.pct * 10) / 10, lost: departed.length, toNfl, kept,
    signings: signings.map(({ e, p }) => ({ id: String(p.id), name: p.name, pos: p.sub || p.pos, stars: p.stars, from: p.team, fromSchool: state.teams[p.team]?.school || "", nil: Math.round(e.nil || 0), w: e.w ?? null })),
  };
  // Every closed portal counts toward Community → Insights, saved or not
  // (user, 2026-11-18) — recorded once per run.
  useEffect(() => {
    recordPortalResult(`${team}-${run?.seed}`, rec).catch((e) => console.error("Portal result record error:", e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stat = (k, v, sub) => (
    <div style={{ background: "rgba(0,0,0,0.32)", borderRadius: 12, padding: isMobile ? "8px 10px" : "10px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", opacity: 0.8, textTransform: "uppercase" }}>{k}</div>
      <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.8 }}>{sub}</div>}
    </div>
  );
  return (
    <div className="wd-sim-pop" style={{ ...PANEL, marginBottom: 12 }}>
      {/* The verdict, in your colors. */}
      <div style={{ position: "relative", overflow: "hidden", background: `linear-gradient(115deg, ${c1} 0%, ${c1} 55%, color-mix(in srgb, ${c2} 70%, ${c1}) 100%)` }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.5))" }} />
        {(b.LogoDark || b.Logo1) && <img src={b.LogoDark || b.Logo1} alt="" aria-hidden="true" style={{ position: "absolute", right: -40, top: -50, width: isMobile ? 220 : 340, opacity: 0.1, pointerEvents: "none" }} />}
        <div style={{ position: "relative", padding: isMobile ? "18px 14px" : "24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 20, flexWrap: "wrap" }}>
            <Logo onColor b={b} size={isMobile ? 56 : 84} />
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.18em", opacity: 0.85 }}>{state.season ? `${state.season + 1} ` : ""}TRANSFER PORTAL · FINAL</div>
              <div style={{ fontSize: isMobile ? 26 : 40, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, marginTop: 3 }}>{b.School || state.teams[team]?.school}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: isMobile ? 18 : 24, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#0e1626", background: me.color, borderRadius: 10, padding: isMobile ? "5px 12px" : "6px 16px", boxShadow: "0 6px 18px rgba(0,0,0,0.35)" }}>{me.label}</span>
                <span style={{ fontSize: 13, fontWeight: 800, opacity: 0.92 }}>Roster strength {fmtPct(me.pct)} · #{myRank} of {outcomes.length} in the country</span>
              </div>
            </div>
            {effGrade[team] && (
              <div title="Bang for your buck: how much the class improved the roster (holes filled, spots upgraded) per dollar of NIL, against every class" style={{ textAlign: "center", background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: isMobile ? "8px 14px" : "10px 20px" }}>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", opacity: 0.85 }}>MONEY EFFICIENCY</div>
                <div style={{ fontSize: isMobile ? 34 : 46, fontWeight: 900, lineHeight: 1, color: gradeColorOf(effGrade[team]) }}>{effGrade[team]}</div>
                <div style={{ fontSize: 10, fontWeight: 900, opacity: 0.85, marginTop: 2 }}>{money(costOf[team] || 0)} SPENT</div>
              </div>
            )}
            <div style={{ textAlign: "center", background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: isMobile ? "8px 14px" : "10px 20px" }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", opacity: 0.85 }}>CLASS GRADE</div>
              <div style={{ fontSize: isMobile ? 34 : 46, fontWeight: 900, lineHeight: 1, color: grade ? gradeColorOf(grade) : SUB }}>{grade || "—"}</div>
              {rank ? <div style={{ fontSize: 10, fontWeight: 900, opacity: 0.85, marginTop: 2 }}>#{rank} CLASS</div> : null}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 2 : 4}, minmax(0, 1fr))`, gap: 8, marginTop: isMobile ? 14 : 18 }}>
            {stat("Signed", mine.n, `Class cost ${money(costOf[team] || 0)}`)}
            {stat("Lost", departed.length, `${toNfl} to the NFL · ${departed.length - toNfl} to the portal`)}
            {stat("Kept", kept, "who wanted out")}
            {stat("Net players", `${me.in - me.out > 0 ? "+" : ""}${me.in - me.out}`, `${me.in} in · ${me.out} out`)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" onClick={onRerun} style={pillBtn(true, GOLD)}>Run It Again</button>
            <button type="button" onClick={onSettings} style={{ ...pillBtn(false), background: "rgba(0,0,0,0.3)" }}>New Team</button>
            <span style={{ flex: 1 }} />
            <ShareClass rec={rec} branding={branding} isMobile={isMobile} />
            <SaveClassButton makeRec={() => rec} />
          </div>
        </div>
      </div>

      {/* On to the Draft Sim. */}
      <DraftSimPromo toNfl={toNfl} school={rec.school} isMobile={isMobile} />

      {/* Your class, revealed one by one, reading down two columns. */}
      <Section title={`Your portal class (${signings.length})`}>
        {signings.length === 0 ? <Empty>You didn't sign anyone out of the portal.</Empty> : (
          <div style={isMobile || signings.length < 3 ? { display: "grid" } : { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: `repeat(${rows}, auto)`, gridAutoFlow: "column" }}>
            {signings.map(({ e, p }, i) => (
              <div key={p.id} className="wd-sim-pop" style={{ animationDelay: `${0.25 + i * 0.12}s`, display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${LINE}`, minWidth: 0 }}>
                <span style={{ width: 22, textAlign: "right", fontWeight: 900, color: i < 3 ? GOLD : SUB, flexShrink: 0 }}>{i + 1}</span>
                <Headshot id={p.id} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, fontSize: 11, fontWeight: 800, color: SUB, minWidth: 0 }}>
                    <TransferStars stars={p.stars} size="sm" />
                    <span style={{ color: "#9fc3ff" }}>{p.sub || p.pos}</span>
                    <Logo b={brand(p.team)} size={16} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.teams[p.team]?.school}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: "#7ee2a8" }}>{money(e.nil)}</div>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", color: SUB }}>WINDOW {e.w}{e.blowout ? " · ON THE SPOT" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Around the country: every team's verdict. */}
      <Section title="Around the country">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "10px 12px", borderBottom: `1px solid ${LINE}` }}>
          <button type="button" style={pillBtn(!pick)} onClick={() => setPick("")}>All {outcomes.length}</button>
          {OUTCOMES.map(([, l, color]) => (
            <button key={l} type="button" onClick={() => setPick(pick === l ? "" : l)} style={{ ...pillBtn(pick === l, color), color: pick === l ? "#0e1626" : color, borderColor: pick === l ? color : `${color}66` }}>{l} {counts[l]}</button>
          ))}
          <span style={{ flex: 1 }} />
          <select value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Conference" style={{ background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontWeight: 800, fontSize: 12, fontFamily: "inherit" }}>
            <option value="">All conferences</option>
            {confs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="wd-sim-scroll" style={{ maxHeight: isMobile ? "60vh" : 620, overflowY: "auto" }}>
          {shown.length === 0 ? <Empty>No teams.</Empty> : shown.map((o) => (
            <Fragment key={o.slug}>
            <div role="button" tabIndex={0} aria-expanded={openTeam === o.slug} onClick={() => setOpenTeam(openTeam === o.slug ? null : o.slug)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenTeam(openTeam === o.slug ? null : o.slug); } }}
              className="wd-sim-row" title="See its portal class" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "8px 10px" : "9px 16px", borderBottom: `1px solid ${LINE}`, background: openTeam === o.slug ? "#16213a" : o.slug === team ? "#13233f" : "transparent" }}>
              <span style={{ width: 28, textAlign: "right", fontWeight: 900, color: SUB, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{outcomes.indexOf(o) + 1}</span>
              <Logo b={brand(o.slug)} size={isMobile ? 24 : 28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: isMobile ? 14 : 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.school}{o.slug === team ? " (you)" : ""}</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: SUB }}>
                  {o.conference} · {o.in} in · {o.out} out
                  {o.spent ? <> · {money(o.spent)}{effGrade[o.slug] ? <> · <span style={{ color: gradeColorOf(effGrade[o.slug]) }} title="Money efficiency: roster improvement per dollar">Eff {effGrade[o.slug]}</span></> : null}</> : null}
                </div>
              </div>
              <span style={{ width: isMobile ? 52 : 64, textAlign: "right", fontWeight: 900, fontSize: 13, color: o.color, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmtPct(o.pct)}</span>
              <span style={{ width: isMobile ? 92 : 112, flexShrink: 0, textAlign: "center", fontSize: isMobile ? 10 : 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#0e1626", background: o.color, borderRadius: 999, padding: "4px 0" }}>{o.label}</span>
              <span aria-hidden="true" style={{ width: 14, flexShrink: 0, color: SUB, fontWeight: 900, transform: openTeam === o.slug ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
            </div>
            {openTeam === o.slug && (() => {
              const cls = classOf(o.slug);
              return (
                <div style={{ background: "#0b1322", borderBottom: `1px solid ${LINE}`, padding: isMobile ? "6px 10px 10px" : "8px 16px 12px 56px" }}>
                  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: SUB, margin: "4px 0 6px" }}>
                    {o.school.toUpperCase()} PORTAL CLASS ({cls.length}){cls.length ? ` · ${money(cls.reduce((a, x) => a + x.e.nil, 0))}` : ""}{effGrade[o.slug] ? <> · MONEY EFFICIENCY <span style={{ color: gradeColorOf(effGrade[o.slug]) }}>{effGrade[o.slug]}</span></> : null}
                  </div>
                  {cls.length === 0 ? <div style={{ fontSize: 12, fontWeight: 700, color: SUB }}>No signings out of the portal.</div> : cls.map(({ e, p }) => (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", minWidth: 0 }}>
                      <TransferStars stars={p.stars} size="sm" />
                      <span style={{ width: 38, flexShrink: 0, textAlign: "center", fontSize: 11, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "2px 0" }}>{p.sub || p.pos}</span>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      <Logo b={brand(p.team)} size={18} />
                      {!isMobile && <span style={{ fontSize: 11, fontWeight: 800, color: SUB, whiteSpace: "nowrap", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{state.teams[p.team]?.school}</span>}
                      <span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8", width: 56, textAlign: "right", flexShrink: 0 }}>{money(e.nil)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            </Fragment>
          ))}
        </div>
      </Section>
    </div>
  );
}
// His ESPN headshot (CFBD ids are ESPN ids), or a blank circle.
function Headshot({ id, size = 42 }) {
  const [ok, setOk] = useState(true);
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: "#1a2438", overflow: "hidden", flexShrink: 0, display: "inline-flex", alignItems: "flex-end", justifyContent: "center" }}>
      {ok && <img src={`https://a.espncdn.com/i/headshots/college-football/players/full/${id}.png`} alt="" onError={() => setOk(false)} style={{ height: "125%", width: "auto", maxWidth: "none", objectFit: "cover", objectPosition: "center top", marginBottom: "-12%" }} />}
    </span>
  );
}

// tone "gone": a red header for players who've left.
const Section = ({ title, children, tone }) => (
  <div>
    <div style={{ padding: "8px 16px", background: tone === "gone" ? "#2a1016" : "#0b1322", borderBottom: `1px solid ${LINE}`, borderTop: `1px solid ${tone === "gone" ? "#5c1f28" : LINE}`, fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: tone === "gone" ? "#ff8a7a" : SUB, textTransform: "uppercase" }}>{title}</div>
    {children}
  </div>
);
const Empty = ({ children }) => <div style={{ padding: 24, textAlign: "center", color: SUB, fontWeight: 700 }}>{children}</div>;
