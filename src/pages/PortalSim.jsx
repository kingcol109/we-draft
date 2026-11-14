// src/pages/PortalSim.jsx
//
// /portalsim (/portalsim/:team) — the Portal Sim: the transfer portal's
// version of the Draft Sim (pages/DraftSim.jsx). Pick a team; window 1
// opens with draft declarations and transfer entries; each window the user
// makes NIL offers (with a role promised), then every other FBS school makes
// its own and players decide. Ten windows (config). Beta-gated
// (components/SimRoute.js) until launch.
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
import { loadPortalSim, money } from "../utils/portalSim/data";
import { defaultTier, mergeConfig } from "../utils/portalSim/config";
import { FBS_CONFERENCES } from "../utils/portalTeams";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const BG = "#070d18";
const PANEL = { background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, overflow: "hidden" };
const INK = "#eef2f8";
const SUB = "#8b9bb4";
const LINE = "#1f2b42";
const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K", "P"];
const ROLE_LABEL = { starter: "Starter", rotation: "Rotation", reserve: "Reserve", none: "Didn't play" };
const PT_LABEL = { starter: "Starter", rotation: "Rotation", depth: "Depth" };
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
    if (data && teamParam && !run && data.branding[teamParam]) setRun({ team: teamParam, seed: Math.floor(Math.random() * 1e9), live: false });
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
          Run a program through {cfg.windows} portal windows. Players declare and enter, every FBS school chases its needs with its NIL budget, and you make your offers before they do.
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
        }}>Open the Portal →</button>
      </div>
    </>
  );
}

// ── The sim ──
function LiveSim({ data, run, isMobile, onSettings, onRerun }) {
  const sim = usePortalSim({ data, team: run.team, seed: run.seed, live: run.live });
  const { state, phase, view } = sim;
  const [tab, setTab] = useState("portal");
  const b = data.branding[run.team] || {};
  const c1 = b.Color1 || BLUE;
  const c2 = b.Color2 || GOLD;
  const brand = (slug) => data.branding[slug];

  const entered = state.log.filter((e) => e.kind === "entered" && e.w === 1).length;
  const declared = state.log.filter((e) => e.kind === "declared").length;

  return (
    <>
      {/* Stage — the header, in the team's colors. */}
      <div style={{ ...PANEL, marginBottom: 12, background: `linear-gradient(115deg, ${c1} 0%, ${c1} 55%, color-mix(in srgb, ${c2} 60%, ${c1}) 100%)`, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.45))" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: isMobile ? 12 : 22, padding: isMobile ? "16px 14px" : "22px 28px", flexWrap: isMobile ? "wrap" : "nowrap" }}>
          <Logo b={b} size={isMobile ? 64 : 110} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "inline-block", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "3px 10px", fontWeight: 900, fontSize: isMobile ? 11 : 13, letterSpacing: "0.2em" }}>
              {phase === "done" ? "PORTAL CLOSED" : phase === "simming" ? "SIMMING…" : `WINDOW ${state.window} OF ${state.windows}`}
            </div>
            <div style={{ fontSize: isMobile ? 26 : 46, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, margin: "8px 0 6px" }}>{b.School}</div>
            <div style={{ fontSize: isMobile ? 12 : 14, fontWeight: 800, opacity: 0.85 }}>
              Tier {view.team.tier} · {view.signings.length} signed · {view.departures.length} gone
            </div>
          </div>
          <BudgetBox view={view} isMobile={isMobile} />
        </div>
        {/* Window track. */}
        <div style={{ position: "relative", display: "flex", gap: 4, padding: isMobile ? "0 14px 12px" : "0 28px 14px" }}>
          {Array.from({ length: state.windows }, (_, i) => i + 1).map((w) => (
            <div key={w} title={`Window ${w}`} style={{ flex: 1, height: 6, borderRadius: 3, background: w < state.window || phase === "done" ? c2 : w === state.window ? "#fff" : "rgba(255,255,255,0.2)" }} />
          ))}
        </div>
      </div>

      {/* Intro / recap / final — between windows. */}
      {phase === "intro" && (
        <Moment title="The portal is open" isMobile={isMobile} action="Start Window 1" onAction={sim.start}>
          {declared} players declared for the draft and {entered.toLocaleString()} entered the portal.
          {view.departures.length > 0 && <> {b.School} lost <b>{view.departures.length}</b>: {view.departures.slice(0, 6).map((p) => p.name).join(", ")}{view.departures.length > 6 ? "…" : ""}.</>}
        </Moment>
      )}
      {phase === "recap" && sim.recap && <Recap recap={sim.recap} state={state} team={run.team} brand={brand} isMobile={isMobile} onNext={sim.next} />}
      {phase === "done" && <Final state={state} team={run.team} brand={brand} isMobile={isMobile} onRerun={onRerun} onSettings={onSettings} />}

      {/* Phones: End Window gets its own button (the tab row scrolls). */}
      {isMobile && phase === "window" && (
        <button type="button" onClick={sim.end} style={{ display: "block", width: "100%", marginBottom: 10, border: "none", borderRadius: 999, padding: "13px 18px", fontWeight: 900, fontSize: 14, letterSpacing: "0.05em", textTransform: "uppercase", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
          {state.window >= state.windows ? "Close the Portal →" : `End Window ${state.window} →`}
        </button>
      )}
      {/* The Console. */}
      <div style={{ ...PANEL }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}`, overflowX: "auto" }}>
          {[["portal", `Portal (${sim.portal.length})`], ["board", `My Board (${view.offers.length})`], ["roster", "Roster & Needs"], ["activity", "Activity"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} style={pillBtn(tab === k, c1)}>{label}</button>
          ))}
          <span style={{ flex: 1 }} />
          {phase === "window" && !isMobile && (
            <button type="button" onClick={sim.end} style={{ border: "none", borderRadius: 999, padding: "8px 18px", fontWeight: 900, fontSize: 13, letterSpacing: "0.05em", textTransform: "uppercase", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              {state.window >= state.windows ? "Close the Portal →" : "End Window →"}
            </button>
          )}
          <button type="button" onClick={onSettings} style={pillBtn(false)}>Settings</button>
        </div>
        {sim.error && <div style={{ padding: "8px 14px", background: "#3a1219", color: "#ffb3a8", fontWeight: 800, fontSize: 13 }}>{sim.error}</div>}
        <div className="wd-sim-scroll" style={{ maxHeight: isMobile ? "70vh" : 720, overflowY: "auto" }}>
          {tab === "portal" ? <PortalTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
            : tab === "board" ? <BoardTab sim={sim} team={run.team} brand={brand} isMobile={isMobile} />
              : tab === "roster" ? <RosterTab sim={sim} state={state} isMobile={isMobile} />
                : <ActivityTab state={state} team={run.team} brand={brand} isMobile={isMobile} />}
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: SUB, fontWeight: 700 }}>
        Beta — the models are first passes. Seed {run.seed}. <Link to="/portal" style={{ color: SUB }}>Real portal →</Link>
      </div>
    </>
  );
}

function BudgetBox({ view, isMobile }) {
  const pct = (n) => `${Math.min(100, (n / Math.max(1, view.budget)) * 100)}%`;
  return (
    <div style={{ width: isMobile ? "100%" : 260, background: "rgba(0,0,0,0.3)", borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", opacity: 0.8 }}>
        <span>NIL BUDGET</span><span>{money(view.budget)}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, margin: "4px 0" }}>{money(view.available)} <span style={{ fontSize: 12, opacity: 0.75 }}>left</span></div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.15)" }}>
        <div style={{ width: pct(view.spent), background: GOLD }} />
        <div style={{ width: pct(view.reserved), background: "rgba(255,255,255,0.55)" }} />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 5, fontSize: 11, fontWeight: 800, opacity: 0.85 }}>
        <span><span style={{ color: GOLD }}>■</span> Signed {money(view.spent)}</span>
        <span><span style={{ color: "rgba(255,255,255,0.7)" }}>■</span> Offered {money(view.reserved)}</span>
      </div>
    </div>
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
function PlayerLine({ p, brand, to, isMobile, right }) {
  return (
    <div className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, padding: isMobile ? "9px 10px" : "10px 16px", borderBottom: `1px solid ${LINE}` }}>
      <TransferStars stars={p.stars} size="sm" />
      <span style={{ width: isMobile ? 38 : 46, flexShrink: 0, textAlign: "center", fontSize: 12, fontWeight: 900, color: "#9fc3ff", background: "#13233f", borderRadius: 6, padding: "4px 0" }}>{p.pos}</span>
      <Logo b={brand(p.team)} size={isMobile ? 22 : 26} />
      {to && <><span style={{ color: SUB, fontWeight: 900 }}>→</span><Logo b={brand(to)} size={isMobile ? 22 : 26} /></>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 900, fontSize: isMobile ? 14 : 16, overflowWrap: "anywhere" }}>{p.name}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: SUB }}>{p.elig} yr{p.elig === 1 ? "" : "s"} left · {ROLE_LABEL[p.role] || "—"} last season</div>
      </div>
      {right}
    </div>
  );
}

// ── Portal: who's available, and making offers ──
function PortalTab({ sim, team, brand, isMobile }) {
  const { portal, view } = sim;
  const [pos, setPos] = useState("");
  const [minStars, setMinStars] = useState(3);
  const [q, setQ] = useState("");
  const [needsOnly, setNeedsOnly] = useState(false);
  const [open, setOpen] = useState("");
  const [shown, setShown] = useState(60);
  const list = useMemo(() => portal
    .filter((p) => p.team !== team && (!pos || p.pos === pos) && p.stars >= minStars && (!needsOnly || view.needs[p.pos] > 0) && (!q || p.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.stars - a.stars || b.elig - a.elig || a.name.localeCompare(b.name)), [portal, team, pos, minStars, q, needsOnly, view.needs]);
  const canOffer = sim.phase === "window";
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px", borderBottom: `1px solid ${LINE}` }}>
        <button type="button" style={pillBtn(!pos)} onClick={() => setPos("")}>All</button>
        {POSITIONS.map((x) => <button key={x} type="button" style={pillBtn(pos === x)} onClick={() => setPos(pos === x ? "" : x)}>{x}{view.needs[x] > 0 ? " •" : ""}</button>)}
        <select value={minStars} onChange={(e) => setMinStars(Number(e.target.value))} style={{ background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "5px 10px", fontWeight: 800, fontSize: 12 }}>
          {[6, 5, 4, 3, 2].map((s) => <option key={s} value={s}>{s}★{s < 6 ? " and up" : ""}</option>)}
        </select>
        <button type="button" style={pillBtn(needsOnly, GOLD)} onClick={() => setNeedsOnly((v) => !v)}>My needs</button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ flex: "1 1 140px", minWidth: 0, background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 12px", fontWeight: 700, fontSize: 13, outline: "none" }} />
      </div>
      {list.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: SUB }}>No one available matches.</div> : list.slice(0, shown).map((p) => {
        const mine = p.offers[team];
        const others = Object.keys(p.offers).filter((k) => k !== team).length;
        return (
          <div key={p.id}>
            <PlayerLine p={p} brand={brand} isMobile={isMobile} right={(
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {!isMobile && <span style={{ fontSize: 12, fontWeight: 800, color: others ? GOLD : SUB }}>{others} offer{others === 1 ? "" : "s"}</span>}
                {mine && <span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(mine.nil)}</span>}
                {canOffer && <button type="button" onClick={() => setOpen(open === p.id ? "" : p.id)} style={pillBtn(open === p.id || !!mine, mine ? "#2e7d32" : BLUE)}>{mine ? "Edit" : "Offer"}</button>}
              </div>
            )} />
            {open === p.id && <OfferEditor p={p} sim={sim} team={team} view={view} onDone={() => setOpen("")} />}
          </div>
        );
      })}
      {list.length > shown && <button type="button" onClick={() => setShown((n) => n + 60)} style={{ display: "block", width: "100%", padding: 12, background: "#0b1322", color: GOLD, border: "none", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>Show more ({list.length - shown})</button>}
    </>
  );
}

function OfferEditor({ p, sim, team, view, onDone }) {
  const mine = p.offers[team];
  const [nil, setNil] = useState(mine?.nil ?? p.ask);
  const [pt, setPt] = useState(mine?.pt || "rotation");
  const max = view.available + (mine?.nil || 0);
  return (
    <div style={{ padding: "12px 16px", background: "#0b1322", borderBottom: `1px solid ${LINE}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: SUB }}>Asking about <b style={{ color: INK }}>{money(p.ask)}</b></div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: SUB }}>
        NIL $
        <input type="number" min={0} step={10000} value={nil} onChange={(e) => setNil(Number(e.target.value) || 0)} style={{ width: 120, background: "#111a2b", color: INK, border: `1px solid ${LINE}`, borderRadius: 8, padding: "6px 8px", fontWeight: 800 }} />
      </label>
      {[0.8, 1, 1.25].map((m) => <button key={m} type="button" style={pillBtn(false)} onClick={() => setNil(Math.min(max, Math.round((p.ask * m) / 1000) * 1000))}>{m === 1 ? "Ask" : `${Math.round(m * 100)}%`}</button>)}
      <span style={{ fontSize: 12, fontWeight: 900, color: SUB }}>Role</span>
      {Object.entries(PT_LABEL).map(([k, label]) => <button key={k} type="button" style={pillBtn(pt === k, GOLD)} onClick={() => setPt(k)}>{label}</button>)}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, fontWeight: 800, color: SUB }}>{money(max)} available</span>
      {mine && <button type="button" style={pillBtn(false)} onClick={() => { sim.retract(p.id); onDone(); }}>Pull Offer</button>}
      <button type="button" style={pillBtn(true, "#2e7d32")} onClick={() => { if (sim.offer(p.id, { nil, pt })) onDone(); }}>{mine ? "Update" : "Make Offer"}</button>
    </div>
  );
}

// ── My Board: my offers and how they're going ──
function BoardTab({ sim, team, brand, isMobile }) {
  const { state, view } = sim;
  // Players the user offered who signed somewhere else.
  const missed = state.log.filter((e) => e.kind === "committed" && e.to !== team && e.offeredBy?.includes(team));
  return (
    <>
      <Section title={`Signed (${view.signings.length})`}>
        {view.signings.length === 0 ? <Empty>No one yet.</Empty> : view.signings.map((p) => <PlayerLine key={p.id} p={p} brand={brand} to={team} isMobile={isMobile} right={<span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(p.deal.nil)} · {PT_LABEL[p.deal.pt]}</span>} />)}
      </Section>
      <Section title={`Open offers (${view.offers.length})`}>
        {view.offers.length === 0 ? <Empty>Make offers from the Portal tab.</Empty> : view.offers.map((p) => (
          <PlayerLine key={p.id} p={p} brand={brand} isMobile={isMobile} right={<span style={{ fontSize: 12, fontWeight: 800, color: SUB, textAlign: "right" }}>{money(p.offers[team].nil)} · {PT_LABEL[p.offers[team].pt]}<br /><span style={{ color: GOLD }}>{Object.keys(p.offers).length - 1} other offer{Object.keys(p.offers).length === 2 ? "" : "s"}</span></span>} />
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

// ── Roster & Needs ──
function RosterTab({ sim, isMobile }) {
  const { view } = sim;
  return (
    <>
      <Section title="Needs">
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 90 : 110}px, 1fr))`, gap: 8, padding: 12 }}>
          {POSITIONS.map((pos) => {
            const n = view.needs[pos] || 0;
            const level = n >= 2 ? ["Big need", "#c0392b"] : n >= 1 ? ["Need", GOLD] : n > 0 ? ["Depth", "#9fc3ff"] : ["Set", "#2e7d32"];
            return (
              <div key={pos} style={{ background: "#111a2b", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{pos}</div>
                <div style={{ fontSize: 12, fontWeight: 900, color: level[1] }}>{level[0]}</div>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title={`Gone (${view.departures.length})`}>
        {view.departures.length === 0 ? <Empty>No departures.</Empty> : view.departures.map((p) => (
          <div key={p.id} className="wd-sim-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: `1px solid ${LINE}` }}>
            <TransferStars stars={p.stars} size="sm" />
            <span style={{ width: 40, fontSize: 12, fontWeight: 900, color: "#9fc3ff" }}>{p.pos}</span>
            <span style={{ flex: 1, fontWeight: 900 }}>{p.name}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: SUB }}>{p.status === "declared" ? "NFL Draft" : p.status === "committed" ? `→ ${sim.state.teams[p.to]?.school}` : p.status === "unsigned" ? "Unsigned" : "In the portal"}</span>
          </div>
        ))}
      </Section>
    </>
  );
}

// ── Activity: commitments and notable entries ──
function ActivityTab({ state, team, brand, isMobile }) {
  const [mineOnly, setMineOnly] = useState(false);
  const events = state.log.filter((e) => {
    const p = state.players[e.pid];
    if (!p) return false;
    const mine = e.team === team || e.to === team;
    if (mineOnly) return mine;
    return mine || p.stars >= 4 || e.kind === "committed";
  }).slice(-400).reverse();
  const word = { declared: "Declared for the draft", entered: "Entered the portal", committed: "Committed", unsigned: "Went unsigned" };
  return (
    <>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${LINE}`, display: "flex", gap: 6 }}>
        <button type="button" style={pillBtn(!mineOnly)} onClick={() => setMineOnly(false)}>Everything</button>
        <button type="button" style={pillBtn(mineOnly)} onClick={() => setMineOnly(true)}>My team</button>
      </div>
      {events.length === 0 ? <Empty>Nothing yet.</Empty> : events.map((e, i) => {
        const p = state.players[e.pid];
        return <PlayerLine key={`${e.pid}-${e.kind}-${i}`} p={p} brand={brand} to={e.kind === "committed" ? e.to : null} isMobile={isMobile}
          right={<span style={{ fontSize: 12, fontWeight: 800, color: e.kind === "committed" ? "#7ee2a8" : SUB, textAlign: "right", flexShrink: 0 }}>W{e.w} · {word[e.kind]}{e.nil ? <><br />{money(e.nil)}</> : null}</span>} />;
      })}
    </>
  );
}

// ── Between windows ──
function Recap({ recap, state, team, brand, isMobile, onNext }) {
  const mineIn = recap.commits.filter((e) => e.to === team);
  const mineOut = recap.commits.filter((e) => e.team === team && e.to !== team);
  const notable = recap.commits.filter((e) => state.players[e.pid].stars >= 5).slice(0, 6);
  const last = state.phase === "done";
  return (
    <div className="wd-sim-pop" style={{ ...PANEL, marginBottom: 12 }}>
      <div style={{ padding: isMobile ? "14px" : "16px 22px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, textTransform: "uppercase" }}>Window {recap.window} closed</div>
          <div style={{ color: SUB, fontWeight: 700, fontSize: 14 }}>
            {recap.commits.length} commitments{recap.entered.length ? ` · ${recap.entered.length} new entries` : ""}{recap.unsigned.length ? ` · ${recap.unsigned.length} went unsigned` : ""}
          </div>
        </div>
        <button type="button" onClick={onNext} style={{ border: "none", borderRadius: 999, padding: "12px 22px", fontWeight: 900, fontSize: 14, textTransform: "uppercase", background: GOLD, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
          {last ? "See Results" : `Window ${recap.window + 1} →`}
        </button>
      </div>
      {[["You signed", mineIn], ["You lost", mineOut], ["Biggest moves", notable]].map(([title, list]) => list.length > 0 && (
        <Section key={title} title={title}>
          {list.map((e) => <PlayerLine key={`${title}-${e.pid}`} p={state.players[e.pid]} brand={brand} to={e.to} isMobile={isMobile} right={<span style={{ fontSize: 12, fontWeight: 900, color: "#7ee2a8" }}>{money(e.nil)}</span>} />)}
        </Section>
      ))}
    </div>
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

const Section = ({ title, children }) => (
  <div>
    <div style={{ padding: "8px 16px", background: "#0b1322", borderBottom: `1px solid ${LINE}`, borderTop: `1px solid ${LINE}`, fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: SUB, textTransform: "uppercase" }}>{title}</div>
    {children}
  </div>
);
const Empty = ({ children }) => <div style={{ padding: 24, textAlign: "center", color: SUB, fontWeight: 700 }}>{children}</div>;
