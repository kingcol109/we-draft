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
import { useEffect, useMemo, useState } from "react";
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
import { retainOdds, urgencyOf, teamNeeds } from "../utils/portalSim/engine";
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
const WANTS_LABEL = { level: "Wants a bigger stage", snaps: "Wants snaps", money: "Wants a bigger NIL deal", home: "Wants to be closer to home", winning: "Wants to win", development: "Wants to develop" };
const DESK_FILTERS = [["all", "All"], ["mine", "My Team"]];
const DESK_HEIGHT = 772; // the console: its tab bar + the 720px list
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

// Dark-background logo (memory: dark logos on dark fills).
function Logo({ b, size = 28 }) {
  const src = b?.LogoDark || b?.Logo1;
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
    if (data && teamParam && !run && data.branding[teamParam] && !data.pool.teams.find((t) => t.slug === teamParam)?.fcs) setRun({ team: teamParam, seed: Math.floor(Math.random() * 1e9), live: false });
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
            : run ? <LiveSim key={`${run.team}-${run.seed}`} data={data} run={run} isMobile={isMobile} onSettings={() => { setRun(null); navigate("/portalsim"); }} onRerun={() => setRun({ ...run, seed: Math.floor(Math.random() * 1e9) })} />
              : <Setup data={data} isMobile={isMobile} onStart={(r) => { setRun(r); navigate(`/portalsim/${r.team}`); }} />}
      </div>
    </div>
  );
}

// ── Setup: pick a team ──
function Setup({ data, isMobile, onStart }) {
  const [team, setTeam] = useState("");
  const [live, setLive] = useState(false);
  const cfg = mergeConfig(data.config);
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
          Run a program through the offseason: decide who you can keep from the NFL, fight to hold the players who want to transfer, then work {cfg.windows} portal windows while every FBS school chases its needs with its NIL budget.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" style={pillBtn(!live)} onClick={() => setLive(false)}>Projected portal</button>
          <button type="button" style={{ ...pillBtn(live), opacity: liveCount ? 1 : 0.45, cursor: liveCount ? "pointer" : "default" }} disabled={!liveCount} onClick={() => setLive(true)}
            title={liveCount ? `${liveCount} players in the real portal` : "Opens with the real portal"}>
            Real portal{liveCount ? ` (${liveCount})` : " · opens with the portal"}
          </button>
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
        {b ? <Logo b={b} size={40} /> : null}
        <div style={{ flex: 1, minWidth: 0, fontWeight: 900, fontSize: isMobile ? 14 : 17 }}>{b ? b.School : "Pick a program"}</div>
        <button type="button" disabled={!team} onClick={() => onStart({ team, seed: Math.floor(Math.random() * 1e9), live })} style={{
          border: "none", borderRadius: 999, padding: "11px 22px", fontWeight: 900, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "inherit",
          background: team ? (b?.Color2 || GOLD) : "#1a2438", color: "#fff", cursor: team ? "pointer" : "default",
        }}>Continue →</button>
      </div>
    </>
  );
}

// ── The sim ──
function LiveSim({ data, run, isMobile, onSettings, onRerun }) {
  const sim = usePortalSim({ data, team: run.team, seed: run.seed, live: run.live });
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
    ...(portalOpen ? [["results", "Results"], ["portal", `Portal (${sim.portal.length})`], ["board", `My Board (${view.offers.length + sim.starred.size})`]] : []),
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
      : isMobile ? `PORTAL ${state.window}/${state.windows}` : `PORTAL WINDOW ${state.window} OF ${state.windows}`;
  // Phones get the short labels so the school name fits.
  const advance = stage === "ready" ? ["Start", sim.start]
    : phase === "simming" ? ["Simming…", null]
      : phase === "window" ? [stage === "nfl" ? (isMobile ? "Lock In →" : "Lock NFL Decisions →") : stage === "retain" ? (isMobile ? "Open Portal →" : "Open the Portal →")
        : state.window >= state.windows ? (isMobile ? "Close →" : "Close the Portal →") : isMobile ? "End Window →" : `End Window ${state.window} →`, sim.end]
        : null;
  const pctOf = (n) => `${Math.min(100, (n / Math.max(1, view.budget)) * 100)}%`;

  return (
    <>
      {/* The header — anchored under the navbar; every window advances from
          its button. */}
      <div style={{ ...PANEL, position: "sticky", top: 66 /* the navbar, in CSS px (page zoom scales both) */, zIndex: 50, marginBottom: 12, background: `linear-gradient(115deg, ${c1} 0%, ${c1} 55%, color-mix(in srgb, ${c2} 60%, ${c1}) 100%)`, boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.45))" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 10 : 18, padding: isMobile ? "10px 12px 8px" : "12px 20px 10px" }}>
          <Logo b={b} size={isMobile ? 40 : 58} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "inline-block", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "2px 8px", fontWeight: 900, fontSize: isMobile ? 9 : 11, letterSpacing: "0.16em" }}>{label}</div>
            <div style={{ fontSize: isMobile ? 18 : 28, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.School}</div>
            <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 800, opacity: 0.85 }}>
              {isMobile ? `${money(view.available)} left` : `Tier ${view.team.tier} · ${view.signings.length} signed · ${view.departures.length} gone`}

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
            <div key={w} title={`Portal window ${w}`} style={{ flex: 1, height: 5, borderRadius: 3, background: (portalOpen && w < state.window) || phase === "done" ? c2 : portalOpen && w === state.window ? "#fff" : "rgba(255,255,255,0.2)" }} />
          ))}
        </div>
      </div>

      {phase === "ready" && (
        <Moment title="Ready when you are" isMobile={isMobile}>
          First, the NFL: see who's leaving for the draft and try to keep the ones on the fence. Then the players trying to leave for the portal — keep them or lose them. Then the portal opens. Press <b style={{ color: INK }}>Start</b> up top.
        </Moment>
      )}
      {phase === "done" && <Final state={state} team={run.team} brand={brand} isMobile={isMobile} onRerun={onRerun} onSettings={onSettings} />}

      {/* The Console. */}
      {phase !== "ready" && <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ ...PANEL, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, overflowX: "auto" }}>
          {tabs.map(([k, text]) => <button key={k} type="button" onClick={() => setTab(k)} style={pillBtn(tab === k, c1)}>{text}</button>)}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onSettings} style={pillBtn(false)}>Settings</button>
        </div>
        {sim.error && <div style={{ padding: "8px 14px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13 }}>{sim.error}</div>}
        <div className="wd-sim-scroll" style={{ maxHeight: isMobile ? "70vh" : 720, overflowY: "auto" }}>
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
          <SimFeed feed={sim.feed} branding={data.branding} height={DESK_HEIGHT} isMobile={false} filters={DESK_FILTERS} />
        </div>
      )}
      </div>}
      {sim.card && <PlayerCard pid={sim.card} sim={sim} team={run.team} brand={brand} isMobile={isMobile} onClose={sim.closeCard} />}
      <div style={{ marginTop: 10, fontSize: 11, color: SUB, fontWeight: 700 }}>
        Beta — the models are first passes. Seed {run.seed}. <Link to="/portal" style={{ color: SUB }}>Real portal →</Link>
      </div>
    </>
  );
}

function Moment({ title, children, action, onAction, isMobile }) {
  return (
    <div className="wd-sim-pop" style={{ ...PANEL, marginBottom: 12, padding: isMobile ? "16px 14px" : "18px 24px", display: "flex", alignItems: isMobile ? "stretch" : "center", gap: 16, flexDirection: isMobile ? "column" : "row" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, textTransform: "uppercase", marginBottom: 6 }}>{title}</div>
        <div style={{ color: SUB, fontWeight: 700, fontSize: 14, lineHeight: 1.5 }}>{children}</div>
      </div>
      {action && <button type="button" onClick={onAction} style={{ border: "none", borderRadius: 999, padding: "12px 22px", fontWeight: 900, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{action}</button>}
    </div>
  );
}

// A player line: stars, position, name, where from (→ where to).
function PlayerLine({ p, brand, to, isMobile, right, extra, onOpen }) {
  return (
    <div className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "9px 10px" : "10px 16px", borderBottom: `1px solid ${LINE}` }}>
      <TransferStars stars={p.stars} size="sm" />
      <span style={{ width: isMobile ? 38 : 46, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "4px 0" }}>{p.pos}</span>
      {brand(p.team, p) ? <Logo b={brand(p.team, p)} size={isMobile ? 22 : 26} /> : null}
      {to && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><Logo b={brand(to)} size={isMobile ? 22 : 26} /></>}
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
  const list = useMemo(() => sortRows(portal.filter((p) => f.match(p))
    .sort((a, b) => b.stars - a.stars || b.elig - a.elig || a.name.localeCompare(b.name)), f), [portal, f]);
  const canOffer = sim.phase === "window";
  const cols = tableCols(f);
  return (
    <>
      <FilterBar f={f} view={view} />
      {list.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: SUB }}>No one available matches.</div> : <TableWrap cols={cols} f={f} isMobile={isMobile}>{list.slice(0, shown).map((p) => {
        const mine = p.offers[team];
        const others = Object.keys(p.offers).filter((k) => k !== team).length;
        return (
          <div key={p.id}>
            <PlayerRow cols={cols} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} right={(
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {!isMobile && <span style={{ fontSize: 12, fontWeight: 800, color: others ? GOLD : SUB }}>{others} offer{others === 1 ? "" : "s"}</span>}
                {mine && <span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(mine.nil)}</span>}
                <StarBtn sim={sim} pid={p.id} />
                {p.team === team && <span style={{ fontSize: 11, fontWeight: 900, color: "#ff8a7a", border: "1px solid #5c1f28", borderRadius: 999, padding: "5px 10px", whiteSpace: "nowrap" }}>Your player</span>}
                {canOffer && (p.cut?.[team]
                  ? <button type="button" onClick={() => sim.openCard(p.id)} style={{ ...pillBtn(false), color: "#ff8a7a", borderColor: "#5c1f28" }}>Cut you</button>
                  : <button type="button" onClick={() => sim.openCard(p.id)} style={pillBtn(!!mine, mine ? "#2e7d32" : BLUE)}>{p.touched?.[team] === sim.state.window ? "Offered" : mine ? "Re-offer" : "Offer"}</button>)}
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
          <div style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{p.pos}{extra ? <span style={{ color: "#9fc3ff" }}> · {extra}</span> : null}</div>
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
  const [pos, setPos] = useState("");
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
      pos, setPos, minStars, setMinStars, q, setQ, needsOnly, setNeedsOnly,
      view: view_, setView, sort,
      sortBy: (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: k === "name" || k === "state" ? 1 : -1 })),
      match: (p) => (!pos || posGroup(pos).includes(p.pos)) && p.stars >= minStars && (!needsOnly || view.needs[p.pos] > 0) && (!needle || p.name.toLowerCase().includes(needle)),
    };
  }, [pos, minStars, q, needsOnly, view.needs, view_, sort]);
}
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
function StarBtn({ sim, pid }) {
  const on = sim.starred.has(pid);
  return (
    <button type="button" onClick={() => sim.toggleStar(pid)} aria-label={on ? "Unstar" : "Star"} title={on ? "On your board — unstar" : "Star to your board"} style={{
      border: `1px solid ${on ? GOLD : LINE}`, background: on ? "rgba(246,162,29,0.15)" : "transparent", color: on ? GOLD : SUB,
      borderRadius: 999, width: 32, height: 30, fontSize: 15, lineHeight: 1, cursor: "pointer", flexShrink: 0, fontFamily: "inherit",
    }}>{on ? "★" : "☆"}</button>
  );
}
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

// ── My Board: my offers and how they're going ──
function BoardTab({ sim, team, brand, isMobile }) {
  const { state, view } = sim;
  // Players the user offered who signed somewhere else.
  const missed = state.log.filter((e) => e.kind === "committed" && e.to !== team && e.offeredBy?.includes(team));
  const starred = [...sim.starred].map((id) => state.players[id]).filter(Boolean).sort((a, b) => b.stars - a.stars);
  return (
    <>
      <Section title={`Starred (${starred.length})`}>
        {starred.length === 0 ? <Empty>Star players (☆) in the Portal or Results to track them here.</Empty> : starred.map((p) => {
          const [text, color] = standing(state, p, team);
          return <PlayerLine key={p.id} p={p} brand={brand} to={p.status === "committed" ? p.to : null} isMobile={isMobile} onOpen={sim.openCard} right={(
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color, textAlign: "right" }}>{text}</span>
              <StarBtn sim={sim} pid={p.id} />
            </div>
          )} />;
        })}
      </Section>
      <Section title={`Signed (${view.signings.length})`}>
        {view.signings.length === 0 ? <Empty>No one yet.</Empty> : view.signings.map((p) => <PlayerLine key={p.id} p={p} brand={brand} to={team} isMobile={isMobile} right={<span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(p.deal.nil)}</span>} />)}
      </Section>
      <Section title={`Open offers (${view.offers.length})`}>
        {view.offers.length === 0 ? <Empty>Make offers from the Portal tab.</Empty> : view.offers.map((p) => (
          <PlayerLine key={p.id} p={p} brand={brand} isMobile={isMobile} onOpen={sim.openCard} right={<span style={{ fontSize: 12, fontWeight: 800, color: SUB, textAlign: "right" }}>{money(p.offers[team].nil)}<br /><span style={{ color: GOLD }}>{Object.keys(p.offers).length - 1} other offer{Object.keys(p.offers).length === 2 ? "" : "s"}</span></span>} />
        ))}
      </Section>
      {missed.length > 0 && (
        <Section title={`Signed elsewhere (${missed.length})`}>
          {missed.map((e) => <PlayerLine key={e.pid} p={state.players[e.pid]} brand={brand} to={e.to} isMobile={isMobile} right={<span style={{ fontSize: 12, fontWeight: 900, color: SUB }}>{money(e.nil)}</span>} />)}
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
  const rank = (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || b.stars - a.stars || M_value(b) - M_value(a);
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
        {roster.length === 0 ? <Empty>No one.</Empty> : roster.map((p) => (
          <PlayerLine key={p.id} p={p} brand={brand} to={p.status === "committed" ? team : null} isMobile={isMobile} onOpen={sim.openCard} right={(
            <span style={{ fontSize: 12, fontWeight: 900, textAlign: "right", color: p.status === "committed" ? "#7ee2a8" : p.status === "considering" ? GOLD : SUB }}>
              {p.status === "committed" ? `New · ${money(p.deal.nil)}` : p.status === "considering" ? (p.considering === "nfl" ? "Deciding on the NFL" : "Wants to leave")
                : p.retained ? `Kept from the ${p.retained.stage === "nfl" ? "NFL" : "portal"} · ${money(p.retained.nil)}` : opening[p.id]?.kind === "stayed" ? "Passed on the NFL" : ROLE_LABEL[p.role]}
            </span>
          )} />
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
              {p.status === "committed" ? `Transferred to ${state.teams[p.to]?.school}` : p.status === "unsigned" ? "Unsigned" : `NFL · ${GONE_LABEL[p.reason] || "Draft"}`}
              {opening[p.id]?.offered ? <><br /><span style={{ color: "#ff8a7a" }}>Turned down {money(opening[p.id].nil)}</span></> : null}
            </span>
          )} />
        ))}
      </Section>
    </>
  );
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
  const title = !recap ? "" : recap.stage ? "Opening window 2 · Leaving" : `Portal window ${recap.window}`;
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
      {sim && <StarBtn sim={sim} pid={p.id} />}
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
  const accepted = recap.commits.filter((e) => e.to === team);
  const signedAway = recap.commits.filter((e) => e.to !== team && e.offeredBy?.includes(team));
  // Offered before this window and still undecided.
  const stillOut = sim.portal.filter((p) => p.offers[team] && p.offers[team].window < state.window);
  const shownIds = new Set([...accepted, ...signedAway].map((e) => e.pid));
  const starredSigned = recap.commits.filter((e) => sim.starred.has(e.pid) && !shownIds.has(e.pid));
  const lostOwn = recap.commits.filter((e) => e.team === team && e.to !== team && !shownIds.has(e.pid));
  // Players who narrowed their lists and left you off.
  const cutYou = (recap.cuts || []).filter((e) => e.to === team);
  return (
    <>
      <Section title={`Accepted your offer (${accepted.length})`}>
        {accepted.length === 0 ? <Empty>No one this window.</Empty> : accepted.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} to={team} isMobile={isMobile} text={`Signed · ${money(e.nil)}${e.blowout ? " · on the spot" : ""}`} color="#7ee2a8" sim={sim} />)}
      </Section>
      <Section tone="gone" title={`Didn't accept (${signedAway.length + stillOut.length})`}>
        {signedAway.length + stillOut.length === 0 ? <Empty>No one.</Empty> : (
          <>
            {signedAway.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} to={e.to} isMobile={isMobile} text={`Signed with ${state.teams[e.to]?.school} · ${money(e.nil)}`} color="#ff8a7a" sim={sim} />)}
            {stillOut.map((p) => <ResultLine key={p.id} p={p} brand={brand} isMobile={isMobile} extra={`Your offer: ${money(p.offers[team].nil)}`} text={standing(state, p, team)[0]} color={GOLD} sim={sim} />)}
          </>
        )}
      </Section>
      {starredSigned.length > 0 && (
        <Section title={`Starred players who signed (${starredSigned.length})`}>
          {starredSigned.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} to={e.to} isMobile={isMobile} text={`Signed with ${state.teams[e.to]?.school} · ${money(e.nil)}`} color={SUB} sim={sim} />)}
        </Section>
      )}
      {cutYou.length > 0 && (
        <Section tone="gone" title={`Cut you from his list (${cutYou.length})`}>
          {cutYou.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brand} isMobile={isMobile} text={e.why === "fit" ? "Not a fit — cut you" : `Down to his top ${e.list}`} color="#ff8a7a" sim={sim} />)}
        </Section>
      )}
      {lostOwn.length > 0 && (
        <Section tone="gone" title={`Your former players who signed (${lostOwn.length})`}>
          {lostOwn.map((e) => <ResultLine key={e.pid} p={state.players[e.pid]} brand={brandOut} to={e.to} isMobile={isMobile} text={`Transferred to ${state.teams[e.to]?.school}`} color={SUB} sim={sim} />)}
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
          text={e.kind === "committed" ? `${e.to === team ? "Signed with you" : "Signed"} · ${money(e.nil)}` : e.kind === "retained" ? `Kept · ${money(e.nil)}` : word[e.kind]}
          color={e.kind === "committed" ? "#7ee2a8" : e.kind === "unsigned" ? SUB : e.kind === "retained" ? "#9fc3ff" : GOLD} sim={sim} />
      ))}</TableWrap>}
      {list.length > shown && <ShowMore n={list.length - shown} onClick={() => setShown((n) => n + 60)} />}
    </>
  );
}

// ── The end: your class and the country's best ──
function Final({ state, team, brand, isMobile, onRerun, onSettings }) {
  const classes = {};
  state.log.filter((e) => e.kind === "committed").forEach((e) => {
    const c = (classes[e.to] = classes[e.to] || { slug: e.to, n: 0, score: 0, spent: 0 });
    c.n += 1; c.score += state.players[e.pid].stars ** 2; c.spent += e.nil;
  });
  const ranked = Object.values(classes).sort((a, b) => b.score - a.score);
  const mineRank = ranked.findIndex((c) => c.slug === team) + 1;
  return (
    <div className="wd-sim-pop" style={{ ...PANEL, marginBottom: 12 }}>
      <div style={{ padding: isMobile ? 14 : "18px 24px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: isMobile ? 20 : 26, fontWeight: 900, textTransform: "uppercase" }}>The portal is closed</div>
          <div style={{ color: SUB, fontWeight: 700, fontSize: 14 }}>{mineRank ? `Your class ranks #${mineRank} of ${ranked.length}.` : "You didn't sign anyone."}</div>
        </div>
        <button type="button" onClick={onRerun} style={pillBtn(true, GOLD)}>Run It Again</button>
        <button type="button" onClick={onSettings} style={pillBtn(false)}>New Team</button>
      </div>
      <Section title="Top portal classes">
        {ranked.slice(0, 10).map((c, i) => (
          <div key={c.slug} className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px", borderBottom: `1px solid ${LINE}`, background: c.slug === team ? "#13233f" : "transparent" }}>
            <span style={{ width: 24, textAlign: "right", fontWeight: 900, color: i < 3 ? GOLD : SUB }}>{i + 1}</span>
            <Logo b={brand(c.slug)} size={26} />
            <span style={{ flex: 1, fontWeight: 900 }}>{state.teams[c.slug]?.school}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{c.n} signed · {money(c.spent)}</span>
          </div>
        ))}
      </Section>
    </div>
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
