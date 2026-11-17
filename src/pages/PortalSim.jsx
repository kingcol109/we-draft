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
// portal windows (config). Admin-only (App.js AdminRoute) for now.
//
// Setup choices (user, 2026-11-15): transfer frequency (Less / Default /
// More / Crazy — Default is the tuned model) and portal length (5, 7 — the
// default — or 10 windows). Beta: open to admins and Sim Beta users (App.js
// SimRoute), linked from their profile.
// Fullscreen (user, 2026-11-14), like the Draft Sim's: the icon beside
// Settings sends the whole run (header, console, desk, player cards) to the
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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import DepartureIcon from "../components/DepartureIcon";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import TransferStars from "../components/TransferStars";
import usePortalSim from "../components/portalSim/usePortalSim";
import PlayerCard from "../components/portalSim/PlayerCard";
import SimFeed from "../components/draftSim/SimFeed";
import { loadPortalSim, money } from "../utils/portalSim/data";
import { defaultTier, mergeConfig } from "../utils/portalSim/config";
import { FBS_CONFERENCES } from "../utils/portalTeams";
import { retainOdds, urgencyOf, teamNeeds, tiesOf, competitive } from "../utils/portalSim/engine";
import { gradeLabel } from "../utils/gradeScale";

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
const WANTS_LABEL = { level: "Wants a bigger stage", snaps: "Wants snaps", money: "Wants a bigger NIL deal", home: "Wants to be closer to home", winning: "Wants to win", development: "Wants to develop", roster: "Cut for roster space" };
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
      style={{ ...pillBtn(false), padding: "6px 9px", lineHeight: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  @media (prefers-reduced-motion: reduce) { .wd-sim-pop { animation: none; } }
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

export default function PortalSim() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { team: teamParam } = useParams();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState("");
  const [run, setRun] = useState(null); // { team, seed, live }

  useEffect(() => { loadPortalSim().then(setData).catch((e) => setFailed(e.message || "Couldn't load the Portal Sim.")); }, []);
  useEffect(() => { document.documentElement.classList.add("wd-sim-dark"); return () => document.documentElement.classList.remove("wd-sim-dark"); }, []);
  // /portalsim/ohio-state starts as that team.
  useEffect(() => {
    if (data && teamParam && !run && data.branding[teamParam] && !data.pool.teams.find((t) => t.slug === teamParam)?.fcs) setRun({ team: teamParam, seed: Math.floor(Math.random() * 1e9), live: false, frequency: "default", windows: mergeConfig(data.config).windows });
  }, [data, teamParam, run]);

  return (
    <div style={{ background: BG, minHeight: "100vh", color: INK, fontFamily: "Arial, sans-serif" }}>
      <style>{CSS}</style>
      <Helmet>
        <title>Portal Sim | We-Draft.com</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "18px 24px 60px" }}>
        {failed ? <div style={{ ...PANEL, padding: 40, textAlign: "center", color: SUB }}>{failed}</div>
          : !data ? <LoadingSpinner label="Loading every roster" size={48} minHeight="60vh" />
            : run ? <LiveSim key={`${run.team}-${run.seed}-${run.frequency}-${run.windows}`} data={data} run={run} isMobile={isMobile} onSettings={() => { setRun(null); navigate("/portalsim"); }} onRerun={() => setRun({ ...run, seed: Math.floor(Math.random() * 1e9) })} onOptions={(o) => setRun({ ...run, ...o })} />
              : <Setup data={data} isMobile={isMobile} onStart={(r) => { setRun(r); navigate(`/portalsim/${r.team}`); }} />}
      </div>
    </div>
  );
}

// A setting: a label, its pill options, a note under them.
const FREQ_OPTIONS = [["less", "Less"], ["default", "Default"], ["more", "More"], ["crazy", "Crazy"]];
const FREQ_NOTE = { less: "Fewer players hit the portal.", default: "The portal as we project it.", more: "More players looking to move.", crazy: "Everybody's on the move." };
function Choice({ label, note, options, value, onChange, on = BLUE }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: GOLD, textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map(([k, text]) => <button key={k} type="button" style={{ ...pillBtn(value === k, on), ...(value === k ? {} : { background: "rgba(0,0,0,0.2)" }) }} onClick={() => onChange(k)}>{text}</button>)}
      </div>
      {note && <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginTop: 6 }}>{note}</div>}
    </div>
  );
}

// The portal-length setting's note.
const windowNote = (n, cfg) => (n === cfg.windows ? "The default — a full recruiting cycle." : n < cfg.windows ? "A quick offseason." : "A longer portal: more rounds of offers.");

// ── Setup: pick a team ──
function Setup({ data, isMobile, onStart }) {
  const [team, setTeam] = useState("");
  const [live, setLive] = useState(false);
  const [frequency, setFrequency] = useState("default");
  const cfg = mergeConfig(data.config);
  const [windows, setWindows] = useState(cfg.windows);
  const liveCount = data.pool.players.filter((p) => p.live).length;
  const byConf = useMemo(() => {
    const groups = {};
    data.pool.teams.forEach((t) => { (groups[t.conference] = groups[t.conference] || []).push(t); });
    Object.values(groups).forEach((list) => list.sort((a, b) => a.school.localeCompare(b.school)));
    return FBS_CONFERENCES.filter((c) => groups[c]).map((c) => [c, groups[c]]);
  }, [data]);
  const tierOf = (t) => Number(data.tiers[t.slug]) || defaultTier(t.school, t.conference);
  const b = data.branding[team];
  return (
    <>
      <div style={{ ...PANEL, padding: isMobile ? "22px 16px" : "30px 34px", marginBottom: 14, background: "linear-gradient(120deg, #0d2f5c 0%, #0b1630 100%)" }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.2em", color: GOLD }}>BETA · {data.pool.season ? data.pool.season + 1 : ""} TRANSFER PORTAL</div>
        <h1 style={{ margin: "6px 0 6px", fontSize: isMobile ? 30 : 46, fontWeight: 900, textTransform: "uppercase", lineHeight: 1 }}>Portal Sim</h1>
        <div style={{ color: SUB, fontWeight: 700, fontSize: isMobile ? 13 : 15, maxWidth: 680 }}>
          Run a program through the offseason: decide who you can keep from the NFL, fight to hold the players who want to transfer, then work {windows} portal windows while every FBS school chases its needs with its NIL budget.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" style={pillBtn(!live)} onClick={() => setLive(false)}>Projected portal</button>
          <button type="button" style={{ ...pillBtn(live), opacity: liveCount ? 1 : 0.45, cursor: liveCount ? "pointer" : "default" }} disabled={!liveCount} onClick={() => setLive(true)}
            title={liveCount ? `${liveCount} players in the real portal` : "Opens with the real portal"}>
            Real portal{liveCount ? ` (${liveCount})` : " · opens with the portal"}
          </button>
        </div>
        {/* The run's settings. */}
        <div style={{ display: "flex", gap: isMobile ? 14 : 28, marginTop: 16, flexWrap: "wrap" }}>
          <Choice label="Transfer frequency" note={FREQ_NOTE[frequency]} options={FREQ_OPTIONS} value={frequency} onChange={setFrequency} />
          <Choice label="Portal windows" note={windowNote(windows, cfg)} options={(cfg.windowOptions || [5, 7, 10]).map((n) => [n, `${n}`])} value={windows} onChange={setWindows} />
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
                  <span style={{ fontSize: 10, fontWeight: 800, color: SUB }}>Tier {tierOf(t)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Sticky start bar. */}
      <div style={{ position: "sticky", bottom: 10, marginTop: 12, ...PANEL, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, background: b ? `linear-gradient(120deg, ${b.Color1 || BLUE}, #0e1626)` : "#0e1626" }}>
        {b ? <Logo onColor b={b} size={40} /> : null}
        <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: isMobile ? 14 : 17 }}>{b ? b.School : "Pick a program"}</div>
        <button type="button" disabled={!team} onClick={() => onStart({ team, seed: Math.floor(Math.random() * 1e9), live, frequency, windows })} style={{
          border: "none", borderRadius: 999, padding: "11px 22px", fontWeight: 900, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
          background: team ? (b?.Color2 || GOLD) : "#1a2438", color: "#fff", cursor: team ? "pointer" : "default",
        }}>Continue →</button>
      </div>
    </>
  );
}

// ── The sim ──
function LiveSim({ data, run, isMobile, onSettings, onRerun, onOptions }) {
  const sim = usePortalSim({ data, team: run.team, seed: run.seed, live: run.live, frequency: run.frequency, windows: run.windows });
  const { state, phase, view, stage } = sim;
  const portalOpen = stage === "window" || stage === "done";
  const b = data.branding[run.team] || {};
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const brand = (slug) => data.branding[slug];

  // Tabs by window: NFL Decisions (opening window 1), Leaving (opening
  // window 2), then — once the portal opens — Results first, the portal's
  // tabs, and Leaving. NFL decisions live in Roster & Needs from then on.
  // Each window lands on its first tab.
  const tabs = [
    ...(portalOpen ? [["results", "Results"], ["portal", `Portal (${sim.portal.length})`], ["board", `My Board (${sim.board.count}/${sim.board.limit})`]] : []),
    ...(!portalOpen ? [["nfl", stage === "nfl" ? `NFL Decisions (${view.considering.length})` : "NFL Decisions"]] : []),
    ...(stage !== "nfl" && stage !== "ready" ? [["leaving", stage === "retain" ? `Leaving (${view.considering.length})` : "Leaving"]] : []),
    ["needs", "Roster & Needs"],
    ...(isMobile ? [["desk", "The Desk"]] : []),
  ];
  const [tabPick, setTab] = useState(null);
  useEffect(() => { setTab(null); }, [stage, state.window]);
  const tab = tabs.some(([k]) => k === tabPick) ? tabPick : stage === "retain" ? "leaving" : portalOpen ? "results" : "nfl";

  const label = phase === "done" ? "PORTAL CLOSED" : phase === "simming" ? "SIMMING…" : stage === "ready" ? "READY TO START"
    : stage === "nfl" ? (isMobile ? "WINDOW 1 · NFL" : "OPENING WINDOW 1 · NFL DECISIONS") : stage === "retain" ? (isMobile ? "WINDOW 2 · LEAVING" : "OPENING WINDOW 2 · LEAVING")
      : sim.board.evalPeriod ? (isMobile ? `EVALUATION ${state.window}/${state.windows}` : `EVALUATION PERIOD · WINDOW ${state.window} OF ${state.windows}`)
        : isMobile ? `PORTAL ${state.window}/${state.windows}` : `PORTAL WINDOW ${state.window} OF ${state.windows}`;
  // Phones get the short labels so the school name fits.
  const advance = stage === "ready" ? ["Start", sim.start]
    : phase === "simming" ? ["Simming…", null]
      : phase === "window" ? [stage === "nfl" ? (isMobile ? "Lock In →" : "Lock NFL Decisions →") : stage === "retain" ? (isMobile ? "Open Portal →" : "Open the Portal →")
        : state.window >= state.windows ? (isMobile ? "Close →" : "Close the Portal →") : sim.board.evalPeriod ? (isMobile ? "Start Offers →" : "End Evaluation →") : isMobile ? "End Window →" : `End Window ${state.window} →`, sim.end]
        : null;
  const pctOf = (n) => `${Math.min(100, (n / Math.max(1, view.budget)) * 100)}%`;
  const fsRef = useRef(null);
  const [fs, toggleFs] = useFullscreen(fsRef);

  return (
    <div ref={fsRef} className={fs ? "wd-sim-scroll" : undefined} style={fs ? { background: BG, padding: 14, overflowY: "auto", height: "calc(100vh / var(--pz, 1))", boxSizing: "border-box", color: INK, fontFamily: "Arial, sans-serif" } : undefined}>
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
              {isMobile ? `${money(view.available)} left` : `Tier ${view.team.tier} · ${view.signings.length} signed · ${view.departures.length} gone`}
              {portalOpen && <span style={{ marginLeft: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "1px 7px", color: sim.board.full ? GOLD : undefined }} title="Contacts used — players on your board">{sim.board.count}/{sim.board.limit} contacts</span>}

            </div>
          </div>
          {!isMobile && (
            <div style={{ width: 220, background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "8px 10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: 900 }}>
                <span style={{ fontSize: 20 }}>{money(view.available)} <span style={{ fontSize: 11, opacity: 0.75 }}>left</span></span>
                <span style={{ fontSize: 11, opacity: 0.75 }}>of {money(view.budget)}</span>
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
          {advance && (
            <button type="button" disabled={!advance[1]} onClick={advance[1] || undefined} style={{
              border: "none", borderRadius: 999, padding: isMobile ? "10px 14px" : "12px 22px", fontWeight: 900, fontSize: isMobile ? 12 : 14, letterSpacing: "0.05em", textTransform: "uppercase",
              background: advance[1] ? GOLD : "rgba(0,0,0,0.35)", color: "#fff", cursor: advance[1] ? "pointer" : "default", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0,
            }}>{advance[0]}</button>
          )}
        </div>
        {/* Window track: the two opening windows, then the portal's. */}
        <div style={{ position: "relative", display: "flex", gap: 4, padding: isMobile ? "0 12px 10px" : "0 20px 12px" }}>
          {["nfl", "retain"].map((k, i) => {
            const done = portalOpen || (k === "nfl" && stage === "retain");
            return <div key={k} title={`Opening window ${i + 1}: ${STAGE_TITLE[k]}`} style={{ flex: 1.4, height: 5, borderRadius: 3, background: done ? c2 : stage === k ? "#fff" : "rgba(255,255,255,0.2)", marginRight: k === "retain" ? 8 : 0 }} />;
          })}
          {Array.from({ length: state.windows }, (_, i) => i + 1).map((w) => (
            <div key={w} title={w === (state.cfg.board?.evalWindow ?? 1) ? "Portal window 1: evaluation period" : `Portal window ${w}`} style={{ flex: 1, height: 5, borderRadius: 3, background: (portalOpen && w < state.window) || phase === "done" ? c2 : portalOpen && w === state.window ? "#fff" : "rgba(255,255,255,0.2)" }} />
          ))}
        </div>
      </div>

      {phase === "ready" && <Ready sim={sim} data={data} run={run} isMobile={isMobile} onOptions={onOptions} onSettings={onSettings} />}
      {phase === "done" && <Final state={state} team={run.team} brand={brand} isMobile={isMobile} onRerun={onRerun} onSettings={onSettings} />}

      {/* The Console. */}
      {phase !== "ready" && <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ ...PANEL, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, overflowX: "auto" }}>
          {tabs.map(([k, text]) => <button key={k} type="button" onClick={() => setTab(k)} style={pillBtn(tab === k, c1)}>{text}</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onSettings} style={pillBtn(false)}>Settings</button>
          {toggleFs && !isMobile && <FullscreenBtn on={fs} onClick={toggleFs} />}
        </div>
        {sim.error && <div style={{ padding: "8px 14px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13 }}>{sim.error}</div>}
        <div className="wd-sim-scroll" style={{ maxHeight: isMobile ? "70vh" : fs ? FS_LIST : 720, minHeight: fs ? FS_LIST : undefined, overflowY: "auto" }}>
          {tab === "desk" ? <SimFeed feed={sim.feed} branding={data.branding} height="auto" isMobile filters={DESK_FILTERS} />
            : tab === "nfl" ? <NflTab sim={sim} team={run.team} isMobile={isMobile} />
            : tab === "leaving" ? <LeavingTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
              : tab === "portal" ? <PortalTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
                : tab === "board" ? <BoardTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
                  : tab === "results" ? <ResultsTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
                    : <NeedsTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />}
        </div>
      </div>
      {!isMobile && (
        <div style={{ width: 340, flexShrink: 0 }}>
          <SimFeed feed={sim.feed} branding={data.branding} height={fs ? FS_DESK : DESK_HEIGHT} isMobile={false} filters={DESK_FILTERS} />
        </div>
      )}
      </div>}
      {sim.card && <PlayerCard pid={sim.card} sim={sim} team={run.team} brand={brand} isMobile={isMobile} onClose={sim.closeCard} />}
      <div style={{ marginTop: 10, fontSize: 11, color: SUB, fontWeight: 700 }}>
        Beta — the models are first passes. Seed {run.seed}. <Link to="/portal" style={{ color: SUB }}>Real portal →</Link>
      </div>
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
  const cfg = state.cfg;
  const facts = [
    ["Program", cfg.tierLabels?.[t.tier] || `Tier ${t.tier}`],
    ["NIL budget", money(view.budget)],
    [last ? `${last[0]} record` : "Last season", last ? `${last[1]}-${last[2]}` : "—"],
    ["Roster", `${roster} players`],
  ];
  const steps = [
    ["NFL Decisions", "Who's leaving for the draft — try to keep the ones on the fence."],
    ["Retention", "Players who want out. Keep them, or lose them to the portal."],
    [`The Portal · ${state.windows} windows`, "Offer NIL every window while every FBS school chases its needs."],
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
            <Choice label="Transfer frequency" note={FREQ_NOTE[run.frequency || "default"]} options={FREQ_OPTIONS} value={run.frequency || "default"} onChange={(frequency) => onOptions({ frequency })} on={GOLD} />
            <Choice label="Portal windows" note={windowNote(run.windows || cfg.windows, cfg)} options={(cfg.windowOptions || [5, 7, 10]).map((n) => [n, `${n}`])} value={run.windows || cfg.windows} onChange={(windows) => onOptions({ windows })} on={GOLD} />
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
          <button type="button" onClick={sim.start} style={{ border: "none", borderRadius: 999, padding: isMobile ? "14px 28px" : "16px 40px", fontWeight: 900, fontSize: isMobile ? 16 : 18, letterSpacing: "0.08em", textTransform: "uppercase", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}>Start the Offseason →</button>
          <button type="button" onClick={onSettings} style={{ ...pillBtn(false), background: "rgba(0,0,0,0.3)", borderColor: "transparent" }}>Change team</button>
        </div>
      </div>
    </div>
  );
}

// A player line: stars, position, name, where from (→ where to).
function PlayerLine({ p, brand, to, isMobile, right, extra, onOpen }) {
  return (
    <div className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "9px 10px" : "10px 16px", borderBottom: `1px solid ${LINE}` }}>
      <TransferStars stars={p.stars} size="sm" />
      <span style={{ width: isMobile ? 38 : 46, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "4px 0" }}>{p.sub || p.pos}</span>
      {brand(p.team, p) ? <Logo b={brand(p.team, p)} size={isMobile ? 22 : 26} /> : null}
      {to && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><Logo b={brand(to)} size={isMobile ? 22 : 26} /></>}
      {/* Off to the NFL, or out of eligibility (dark sim: the white cap). */}
      {!to && p.status === "declared" && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><DepartureIcon kind={p.reason === "exhausted" ? "grad" : "nfl"} dark size={isMobile ? 22 : 26} /></>}
      <div style={{ flex: 1, minWidth: 0 }}>
        {onOpen
          ? <button type="button" onClick={() => onOpen(p.id)} style={{ all: "unset", cursor: "pointer", fontWeight: 900, fontSize: isMobile ? 14 : 16, overflowWrap: "break-word", textDecoration: "underline", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: 3 }}>{p.name}</button>
          : <div style={{ fontWeight: 900, fontSize: isMobile ? 14 : 16, overflowWrap: "break-word" }}>{p.name}</div>}
        <div style={{ fontSize: 12, fontWeight: 700, color: SUB }}>{extra ? <span style={{ color: "#9fc3ff" }}>{extra} · </span> : null}{p.elig} yr{p.elig === 1 ? "" : "s"} left · {ROLE_LABEL[p.role] || "—"} last season</div>
      </div>
      {right}
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
  const list = useMemo(() => sortRows(portal.filter((p) => f.match(p))
    .sort((a, b) => b.stars - a.stars || b.elig - a.elig || a.name.localeCompare(b.name)), f), [portal, f]);
  const canOffer = sim.phase === "window";
  const cols = tableCols(f);
  return (
    <>
      <EvalBanner sim={sim} />
      <FilterBar f={f} view={view} />
      {list.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: SUB }}>No one available matches.</div> : <TableWrap cols={cols} f={f} isMobile={isMobile}>{list.slice(0, shown).map((p) => {
        const mine = p.offers[team];
        // Other schools interested: contacted or offering.
        const interested = Object.keys({ ...(p.evals || {}), ...p.offers }).filter((k) => k !== team).length;
        return (
          <div key={p.id}>
            <PlayerRow cols={cols} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} right={(
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {!isMobile && interested > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: "#9fc3ff", whiteSpace: "nowrap" }}>{interested} team{interested === 1 ? "" : "s"} interested</span>}
                {mine && <span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(mine.nil)}</span>}
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
// Fixed tracks so every row lines up with the header (the last: the row's
// actions / result text).
const colGrid = (cols, isMobile) => `${isMobile ? 40 : 48}px minmax(${isMobile ? 120 : 150}px, 1.5fr) ${cols.map(() => "minmax(44px, 0.5fr)").join(" ")} ${isMobile ? 150 : 210}px`;
// The table: a sortable header over its rows (none: the plain list).
function TableWrap({ cols, f, isMobile, children }) {
  if (!cols) return children;
  const head = (k, label) => {
    const on = f.sort.key === k;
    return (
      <button key={k} type="button" onClick={() => f.sortBy(k)} style={{ all: "unset", cursor: "pointer", fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: on ? GOLD : SUB, whiteSpace: "nowrap" }}>
        {label}{on ? (f.sort.dir < 0 ? " ▼" : " ▲") : ""}
      </button>
    );
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: isMobile ? 220 + cols.length * 56 : 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: colGrid(cols, isMobile), gap: 8, alignItems: "center", padding: isMobile ? "8px 10px" : "8px 16px", borderBottom: `1px solid ${LINE}`, background: "#0b1322", position: "sticky", top: 0, zIndex: 1 }}>
          {head("stars", "★")}{head("name", "Player")}
          {cols.map(([k, label]) => head(k, label))}
          <span />
        </div>
        {children}
      </div>
    </div>
  );
}
// A row: the plain PlayerLine, or a table row when the view has columns.
function PlayerRow({ cols, p, brand, to, isMobile, right, extra, onOpen }) {
  if (!cols) return <PlayerLine p={p} brand={brand} to={to} isMobile={isMobile} right={right} extra={extra} onOpen={onOpen} />;
  return (
    <div className="wd-sim-row" style={{ display: "grid", gridTemplateColumns: colGrid(cols, isMobile), gap: 8, alignItems: "center", padding: isMobile ? "8px 10px" : "8px 16px", borderBottom: `1px solid ${LINE}` }}>
      <TransferStars stars={p.stars} size="sm" />
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden" }}>
        {brand(p.team, p) ? <Logo b={brand(p.team, p)} size={22} /> : null}
        {to && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><Logo b={brand(to)} size={22} /></>}
        <div style={{ minWidth: 0 }}>
          <button type="button" onClick={() => onOpen?.(p.id)} style={{ all: "unset", cursor: onOpen ? "pointer" : "default", fontWeight: 900, fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: onOpen ? "underline" : "none", textDecorationColor: "rgba(255,255,255,0.25)", textUnderlineOffset: 3 }}>{p.name}</button>
          <div style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{p.sub || p.pos}{extra ? <span style={{ color: "#9fc3ff" }}> · {extra}</span> : null}</div>
        </div>
      </div>
      {cols.map(([k, , fmt]) => {
        const raw = INFO_KEYS.has(k) || k === "role" ? p[k] : p.stats?.[k];
        const v = fmt ? fmt(raw, p) : raw;
        return <span key={k} style={{ fontSize: 13, fontWeight: 800, color: v == null || v === "" ? "#3a4a66" : INK, whiteSpace: "nowrap" }}>{v == null || v === "" ? "—" : v}</span>;
      })}
      <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>{right}</div>
    </div>
  );
}

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
function FilterBar({ f, view }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}` }}>
      <button type="button" style={pillBtn(!f.pos)} onClick={() => f.setPos("")}>All</button>
      {POS_TABS.map((x) => <button key={x} type="button" style={pillBtn(f.pos === x)} onClick={() => f.setPos(f.pos === x ? "" : x)}>{x}{posGroup(x).some((k) => view.needs[k] > 0) ? " •" : ""}</button>)}
      <select value={f.minStars} onChange={(e) => f.setMinStars(Number(e.target.value))} style={{ background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "5px 10px", fontWeight: 800, fontSize: 12 }}>
        {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 2 ? "All stars" : `${n}★${n < 6 ? " and up" : ""}`}</option>)}
      </select>
      <button type="button" style={pillBtn(f.needsOnly, GOLD)} onClick={() => f.setNeedsOnly((v) => !v)}>My needs</button>
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
      {/* A single position: Info and (not OL) Stats tables. */}
      {f.pos && (
        <div style={{ display: "flex", gap: 4, flexBasis: "100%", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", color: SUB, marginRight: 4 }}>VIEW</span>
          {[["list", "List"], ["info", "Info"], ...(f.pos !== "OL" ? [["stats", "Stats"]] : [])].map(([k, label]) => (
            <button key={k} type="button" style={pillBtn(f.view === k, GOLD)} onClick={() => f.setView(k)}>{label}</button>
          ))}
          {f.view !== "list" && <span style={{ fontSize: 11, fontWeight: 800, color: SUB, marginLeft: 6 }}>Click a column to sort</span>}
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
function boardStanding(state, p, team) {
  const ties = tiesOf(state, p);
  const order = Object.entries(ties.grades).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const rank = order.indexOf(team) + 1;
  const n = order.length;
  if (!rank) return ["—", SUB];
  if (rank === 1) return [n === 1 ? "Only school on him" : `Leading · ${n} schools`, "#7ee2a8"];
  return competitive(state, ties, team) ? [`#${rank} of ${n} · in it`, GOLD] : [`#${rank} of ${n} · long shot`, "#ff8a7a"];
}
// The evaluation period, explained (Portal and My Board, window 1).
const EvalBanner = ({ sim }) => (!sim.board.evalPeriod ? null : (
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

// ── My Board: your contacts, each once by where it stands ──
// Open offers first, then contacts with no offer yet, then signed with you,
// then gone elsewhere (contacts and offers that signed somewhere else or
// went unsigned).
function BoardTab({ sim, team, brand, isMobile }) {
  const { state, view } = sim;
  const evalPeriod = sim.board.evalPeriod;
  const order = (a, b) => b.stars - a.stars || a.name.localeCompare(b.name);
  const mine = [...sim.starred].map((id) => state.players[id]).filter(Boolean);
  const offers = mine.filter((p) => p.status === "portal" && p.offers[team]).sort(order);
  const contacts = mine.filter((p) => p.status === "portal" && !p.offers[team]).sort(order);
  // Gone: contacts no longer in the portal and not yours, plus anyone you
  // offered who signed elsewhere (each once).
  const goneIds = new Set(mine.filter((p) => p.status !== "portal" && !(p.status === "committed" && p.to === team)).map((p) => p.id));
  state.log.forEach((e) => { if (e.kind === "committed" && e.to !== team && e.offeredBy?.includes(team)) goneIds.add(e.pid); });
  const gone = [...goneIds].map((id) => state.players[id]).filter(Boolean).sort(order);
  const standingLine = (p, top) => {
    const [text, color] = boardStanding(state, p, team);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: SUB, textAlign: "right" }}>{top ? <><span style={{ color: "#7ee2a8" }}>{top}</span><br /></> : null}<span style={{ color }}>{text}</span></span>
        <ContactBtn sim={sim} pid={p.id} />
      </div>
    );
  };
  return (
    <>
      <EvalBanner sim={sim} />
      {!evalPeriod && (
        <Section title={`Open offers (${offers.length})`}>
          {offers.length === 0 ? <Empty>No offers out. Offer your contacts from the Portal tab.</Empty> : offers.map((p) => (
            <PlayerLine key={p.id} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} right={standingLine(p, `Your offer ${money(p.offers[team].nil)}`)} />
          ))}
        </Section>
      )}
      <Section title={`${evalPeriod ? "Contacted" : "Contacted — no offer yet"} (${contacts.length})`}>
        {contacts.length === 0 ? <Empty>{evalPeriod ? `Contact players from the Portal tab — up to ${sim.board.limit}.` : "Everyone you've contacted has an offer."}</Empty>
          : contacts.map((p) => <PlayerLine key={p.id} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} right={standingLine(p)} />)}
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
    </>
  );
}

const M_value = (p) => p.stars * 10 + Math.min(p.elig || 0, 4);
const ROLE_RANK = { starter: 0, rotation: 1, reserve: 2, none: 3 };

// ── Needs: each position's need, and who's there, in the portal, or gone ──
function NeedsTab({ sim, team: myTeam, brand, isMobile }) {
  const { state, view } = sim;
  const [pos, setPos] = useState("QB");
  // Any FBS roster (user, 2026-11-14) — yours by default.
  const [team, setTeam] = useState(myTeam);
  const needs = useMemo(() => (team === myTeam ? view.needs : teamNeeds(state, team)), [team, myTeam, view.needs, state]);
  const schools = useMemo(() => Object.values(state.teams).filter((t) => !t.fcs).sort((a, b) => a.school.localeCompare(b.school)), [state.teams]);
  const all = useMemo(() => Object.values(state.players), [state.players]);
  const needOf = (x) => Math.max(...posGroup(x).map((k) => needs[k] || 0));
  const level = (n) => (n >= 2 ? ["Big need", "#ff6b5b"] : n >= 1 ? ["Need", GOLD] : n > 0 ? ["Depth", "#9fc3ff"] : ["Set", "#7ee2a8"]);
  const at = (p) => posGroup(pos).includes(p.pos);
  // Best first: star rating, then role, then eligibility (user, 2026-11-15).
  const rank = (a, b) => b.stars - a.stars || ROLE_RANK[a.role] - ROLE_RANK[b.role] || M_value(b) - M_value(a);
  // On the roster: stayed (or still deciding), plus signings coming in.
  const roster = all.filter((p) => at(p) && ((p.team === team && (p.status === "roster" || p.status === "considering")) || (p.status === "committed" && p.to === team))).sort(rank);
  const inPortal = all.filter((p) => at(p) && p.team === team && p.status === "portal").sort(rank);
  // Gone: portal departures first, then the NFL.
  const left = all.filter((p) => at(p) && p.team === team && (p.status === "unsigned" || (p.status === "committed" && p.to !== team))).sort(rank)
    .concat(sortNfl(all.filter((p) => at(p) && p.team === team && p.status === "declared")));
  const [lv, lc] = level(needOf(pos));
  // The opening windows' outcomes, for the NFL decisions baked in here.
  const opening = useMemo(() => Object.fromEntries(state.log.filter((e) => e.stage && e.team === team).map((e) => [e.pid, e])), [state.log, team]);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <Logo b={brand(team)} size={26} />
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Roster" style={{ background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontWeight: 900, fontSize: 13, fontFamily: "inherit", maxWidth: "100%" }}>
          {schools.map((t) => <option key={t.slug} value={t.slug}>{t.school}{t.slug === myTeam ? " (you)" : ""} · Tier {t.tier}</option>)}
        </select>
        {team !== myTeam && <button type="button" style={pillBtn(false)} onClick={() => setTeam(myTeam)}>Back to yours</button>}
      </div>
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, overflowX: "auto" }}>
        {POS_TABS.map((x) => {
          const c = level(needOf(x))[1];
          return (
            <button key={x} type="button" onClick={() => setPos(x)} style={{ ...pillBtn(pos === x), display: "inline-flex", alignItems: "center", gap: 6 }}>
              {x}<span style={{ width: 7, height: 7, borderRadius: 4, background: c }} />
            </button>
          );
        })}
      </div>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${LINE}`, fontWeight: 900, fontSize: 14 }}>
        {pos} · <span style={{ color: lc }}>{lv}</span>
        <span style={{ color: SUB, fontWeight: 700, fontSize: 12 }}> · plays {posGroup(pos).map((k) => state.cfg.starters[k] || 0).reduce((a, n) => a + n, 0)} starter{posGroup(pos).length > 1 || (state.cfg.starters[pos] || 0) !== 1 ? "s" : ""}</span>
      </div>
      <Section title={`On the roster (${roster.length})`}>
        {roster.length === 0 ? <Empty>No one.</Empty> : subGroups(pos, roster).map(([label, list]) => (
          <Fragment key={label || "all"}>
            {/* DB splits into CB / S, OL into OT / IOL. */}
            {label && <div style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: "#9fc3ff" }}>{label} ({list.length})</div>}
            {list.length === 0 ? <div style={{ padding: "4px 16px 10px", color: SUB, fontSize: 12, fontWeight: 700 }}>No one.</div> : list.map((p) => (
              <PlayerLine key={p.id} p={p} brand={brand} to={p.status === "committed" ? team : null} isMobile={isMobile} onOpen={sim.openCard} right={(
                <span style={{ fontSize: 12, fontWeight: 900, textAlign: "right", color: p.status === "committed" ? "#7ee2a8" : p.status === "considering" ? GOLD : SUB }}>
                  {p.status === "committed" ? `New · ${money(p.deal.nil)}` : p.status === "considering" ? (p.considering === "nfl" ? "Deciding on the NFL" : "Wants to leave")
                    : p.retained ? `Kept from the ${p.retained.stage === "nfl" ? "NFL" : "portal"} · ${money(p.retained.nil)}` : opening[p.id]?.kind === "stayed" ? "Passed on the NFL" : ROLE_LABEL[p.role]}
                </span>
              )} />
            ))}
          </Fragment>
        ))}
      </Section>
      {inPortal.length > 0 && (
        <Section title={`In the portal (${inPortal.length})`}>
          {inPortal.map((p) => <PlayerLine key={p.id} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} right={<span style={{ fontSize: 12, fontWeight: 800, color: GOLD }}>{Object.keys(p.offers).length} offer{Object.keys(p.offers).length === 1 ? "" : "s"}</span>} />)}
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

// ── Results: the last window, for my team and around the country ──
function ResultsTab({ sim, team, brand, isMobile }) {
  const [sub, setSub] = useState("mine");
  const { recap } = sim;
  const title = !recap ? "" : recap.stage ? "Opening window 2 · Leaving" : recap.evalPeriod ? "Evaluation period" : `Portal window ${recap.window}`;
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
  // In the mix: didn't accept yet, still open, and still considering you.
  const inMix = stillOut.filter((p) => !cutIds.has(p.id));
  // Your contacts with no offer yet, and where you stand with them.
  const contactsOnly = sim.portal.filter((p) => p.evals?.[team] != null && !p.offers[team]).sort((a, b) => b.stars - a.stars);
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
      <FilterBar f={f} view={view} />
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

// ── The end: your signing class, like a draft class (user, 2026-11-15) ──
// A report card in your colors — class rank and grade among every school's
// class, what it cost, the needs it filled — then your signings revealed one
// by one, reading down two columns (memory: boards fill columns), then the
// country's top classes.
// A class's letter by where it ranks (share of schools ahead of it).
const CLASS_GRADES = [[0.05, "A+"], [0.12, "A"], [0.2, "A-"], [0.3, "B+"], [0.42, "B"], [0.55, "B-"], [0.67, "C+"], [0.78, "C"], [0.88, "C-"], [1.01, "D"]];
const gradeColorOf = (g) => (g.startsWith("A") ? "#7ee2a8" : g.startsWith("B") ? "#9fc3ff" : g.startsWith("C") ? GOLD : "#ff8a7a");
function Final({ state, team, brand, isMobile, onRerun, onSettings }) {
  const classes = {};
  state.log.filter((e) => e.kind === "committed").forEach((e) => {
    const c = (classes[e.to] = classes[e.to] || { slug: e.to, n: 0, score: 0, spent: 0 });
    c.n += 1; c.score += state.players[e.pid].stars ** 2; c.spent += e.nil;
  });
  const ranked = Object.values(classes).sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex((c) => c.slug === team) + 1;
  const grade = rank ? CLASS_GRADES.find(([share]) => (rank - 1) / Math.max(1, ranked.length) < share)[1] : null;
  const mine = classes[team] || { n: 0, spent: 0 };
  // The class: best first (stars, then the deal).
  const signings = state.log.filter((e) => e.kind === "committed" && e.to === team).map((e) => ({ e, p: state.players[e.pid] }))
    .sort((a, b) => b.p.stars - a.p.stars || b.e.nil - a.e.nil);
  // Needs: positions that lost starters / rotation players — filled by a signing, or still open.
  const lost = Object.entries(urgencyOf(state, team)).filter(([, u]) => u.lost > 0).map(([pos]) => pos);
  const signedAt = new Set(signings.map(({ p }) => p.pos));
  const filled = lost.filter((pos) => signedAt.has(pos));
  const open = lost.filter((pos) => !signedAt.has(pos));
  const kept = state.log.filter((e) => e.kind === "retained" && e.team === team).length;
  const b = brand(team) || {};
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const rows = Math.ceil(signings.length / 2);
  return (
    <div className="wd-sim-pop" style={{ ...PANEL, marginBottom: 12 }}>
      {/* The report card header, in your colors. */}
      <div style={{ position: "relative", overflow: "hidden", background: `linear-gradient(115deg, ${c1} 0%, ${c1} 58%, color-mix(in srgb, ${c2} 70%, ${c1}) 100%)` }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.45))" }} />
        {(b.LogoDark || b.Logo1) && <img src={b.LogoDark || b.Logo1} alt="" aria-hidden="true" style={{ position: "absolute", right: -40, top: -50, width: isMobile ? 200 : 300, opacity: 0.1, pointerEvents: "none" }} />}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 12 : 18, padding: isMobile ? "16px 14px" : "20px 24px", flexWrap: "wrap" }}>
          <Logo onColor b={b} size={isMobile ? 52 : 72} />
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.18em", opacity: 0.85 }}>{state.season ? `${state.season + 1} ` : ""}PORTAL SIGNING CLASS</div>
            <div style={{ fontSize: isMobile ? 24 : 34, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.02, marginTop: 2 }}>{b.School || state.teams[team]?.school}</div>
            <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9, marginTop: 4 }}>
              {mine.n} signed · {money(mine.spent)} NIL{kept ? ` · ${kept} kept from the portal` : ""}{rank ? ` · Class rank #${rank} of ${ranked.length}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "center", background: "rgba(0,0,0,0.35)", borderRadius: 14, padding: isMobile ? "8px 14px" : "10px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", opacity: 0.85 }}>CLASS GRADE</div>
            <div style={{ fontSize: isMobile ? 34 : 46, fontWeight: 900, lineHeight: 1, color: grade ? gradeColorOf(grade) : SUB }}>{grade || "—"}</div>
          </div>
        </div>
        <div style={{ position: "relative", display: "flex", gap: 8, padding: isMobile ? "0 14px 14px" : "0 24px 18px", flexWrap: "wrap" }}>
          <button type="button" onClick={onRerun} style={pillBtn(true, GOLD)}>Run It Again</button>
          <button type="button" onClick={onSettings} style={{ ...pillBtn(false), background: "rgba(0,0,0,0.3)" }}>New Team</button>
        </div>
      </div>
      {/* Needs filled / still open. */}
      {lost.length > 0 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${LINE}`, fontSize: 12, fontWeight: 800 }}>
          <span style={{ color: "#7ee2a8" }}>Needs filled: {filled.length ? filled.join(", ") : "none"}</span>
          {open.length > 0 && <span style={{ color: "#ff8a7a" }}>Still open: {open.join(", ")}</span>}
        </div>
      )}
      {/* The class, revealed one by one, reading down two columns. */}
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
      <Section title="Top portal classes">
        {ranked.slice(0, 10).map((c, i) => (
          <div key={c.slug} className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: `1px solid ${LINE}`, background: c.slug === team ? "#13233f" : "transparent" }}>
            <span style={{ width: 24, textAlign: "right", fontWeight: 900, color: i < 3 ? GOLD : SUB }}>{i + 1}</span>
            <Logo b={brand(c.slug)} size={26} />
            <span style={{ flex: 1, fontWeight: 900 }}>{state.teams[c.slug]?.school}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{c.n} signed · {money(c.spent)}</span>
          </div>
        ))}
        {rank > 10 && (
          <div className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: `1px solid ${LINE}`, background: "#13233f" }}>
            <span style={{ width: 24, textAlign: "right", fontWeight: 900, color: SUB }}>{rank}</span>
            <Logo b={b} size={26} />
            <span style={{ flex: 1, fontWeight: 900 }}>{state.teams[team]?.school}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{mine.n} signed · {money(mine.spent)}</span>
          </div>
        )}
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
