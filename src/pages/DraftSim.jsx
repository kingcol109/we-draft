// src/pages/DraftSim.jsx
//
// Draft Sim — /draftsim and /draftsim/:team. A simulated NFL draft run like
// a broadcast: CPU teams pick off the community board weighted by their own
// staff's draft history (utils/draftSim/engine.js), trades happen on the
// site's trade chart, and an analyst desk reacts to every pick
// (utils/draftSim/analysts.js).
//
// /draftsim/tb is the marketed entry: it skips setup and starts the draft
// right away with the default settings, the Buccaneers as the user's team
// ("Drafting as the Buccaneers" on the stage first). /draftsim is the setup
// screen — any number of teams (or none, and just watch), rounds, speed and
// desk chatter; the live sim's Settings button comes back here with its
// teams still picked. Linked from the mock drafts hub (MockDraftHub.jsx) —
// the hand-built, written mocks stay there.
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import LoadingSpinner from "../components/LoadingSpinner";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { loadSimSetup, loadSimData, SIM_YEAR, teamNamer } from "../utils/draftSim/data";
import { CHATTER, DEFAULT_CHATTER } from "../utils/draftSim/analysts";
import { useIsMobile, BLUE, GOLD } from "../components/MockDraftKit";
import useDraftSim, { SPEEDS, DEFAULT_SPEED } from "../components/draftSim/useDraftSim";
import SimBroadcast, { SIM_CSS, SimTicker } from "../components/draftSim/SimBroadcast";
import SimResults from "../components/draftSim/SimResults";

const BODY = "Arial, sans-serif";
const FONT = "'Arial Black', Arial, sans-serif";
const STAGE_BG = "radial-gradient(1200px 500px at 50% -10%, #12305c 0%, #070d18 60%), #070d18";
const ROUND_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_ROUNDS = 7;
// App.js pads every page 25px below the navbar; the sim's dark stage runs
// up under the navbar instead of leaving a white strip.
const APP_TOP_PADDING = 25;

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// Enough rounds to reach a team's first pick (a team without a 1st-rounder
// still gets to draft on default settings).
function roundsFor(order, teams, rounds) {
  const firsts = teams.map((t) => Math.min(...order.filter((p) => (p.Traded || p.Team) === t).map((p) => p.Round)));
  return Math.max(rounds, ...firsts.filter(Number.isFinite));
}

// The centered content column.
function Column({ wide, isMobile, children }) {
  return (
    <div style={{ maxWidth: wide ? 1320 : 1100, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "18px 20px 60px", fontFamily: FONT }}>
      {children}
    </div>
  );
}

export default function DraftSim() {
  const { team: teamParam } = useParams();
  const team = teamParam ? teamParam.toUpperCase() : null;
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [setup, setSetup] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  // config: null on the setup screen; { teams, rounds, speed, chatter, seed } once started.
  const [config, setConfig] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    loadSimSetup(SIM_YEAR).then(setSetup).catch((e) => { console.error("Draft sim setup error:", e); setError(true); });
    // Warm the full board while the user's choosing.
    loadSimData(SIM_YEAR).then(setData).catch((e) => { console.error("Draft sim data error:", e); setError(true); });
  }, []);

  // A start pressed before the board finished loading.
  useEffect(() => {
    if (pending && data) { setConfig(pending); setPending(null); }
  }, [pending, data]);

  // /draftsim/:team starts straight away on the default settings; /draftsim
  // is the setup screen.
  const validTeam = team && NFL_TEAMS[team] ? team : null;
  useEffect(() => {
    setPending(null);
    setConfig(validTeam && setup ? {
      teams: [validTeam], rounds: roundsFor(setup.order, [validTeam], DEFAULT_ROUNDS),
      speed: DEFAULT_SPEED, chatter: DEFAULT_CHATTER, seed: newSeed(),
    } : null);
  }, [validTeam, setup]);

  if (team && !validTeam) return <Navigate to="/draftsim" replace />;

  const names = teamNamer(setup?.branding || {});
  const title = team
    ? `${names.teamName(team)} Mock Draft Simulator ${SIM_YEAR} | We-Draft Draft Sim`
    : `${SIM_YEAR} NFL Mock Draft Simulator | We-Draft Draft Sim`;
  const description = team
    ? `Run the ${names.teamName(team)}' ${SIM_YEAR} draft. Every other team picks off the We-Draft community board and its own staff's draft history, trades included, with live analyst reactions to every pick.`
    : `Simulate the ${SIM_YEAR} NFL Draft live: pick for one team or several, field trade offers, and get instant reactions from the We-Draft analyst desk. CPU teams draft by community grades and each staff's own draft tendencies.`;
  const url = `https://we-draft.com/draftsim${team ? `/${team.toLowerCase()}` : ""}`;

  const start = (cfg) => {
    const next = { ...cfg, seed: newSeed() };
    if (data) setConfig(next); else setPending(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Back to the setup screen with this sim's teams picked.
  const openSettings = (teams) => {
    if (team) navigate("/draftsim", { state: { teams } });
    else { setConfig(null); setPending(null); }
  };

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
      </Helmet>
      <style>{SIM_CSS}</style>

      <div style={{ background: STAGE_BG, marginTop: -APP_TOP_PADDING, minHeight: "calc(100vh / var(--pz, 1) - 35px)" }}>
        {error ? (
          <Column isMobile={isMobile}><div style={{ color: "#fff", textAlign: "center", padding: 60, fontFamily: BODY }}>Couldn&apos;t load the draft — try again.</div></Column>
        ) : !setup || (config && !data) ? (
          <Column isMobile={isMobile}><LoadingSpinner label="Loading the draft" size={40} minHeight="50vh" /></Column>
        ) : config ? (
          <LiveSim key={config.seed} data={data} config={config} isMobile={isMobile}
            onRerun={() => start({ teams: config.teams, rounds: config.rounds, speed: config.speed, chatter: config.chatter })}
            onSettings={() => openSettings(config.teams)} />
        ) : (
          <Column isMobile={isMobile}>
            <Setup setup={setup} initialTeams={location.state?.teams || []} isMobile={isMobile} names={names} onStart={start} starting={!!pending} />
          </Column>
        )}
      </div>
    </>
  );
}

function LiveSim({ data, config, isMobile, onRerun, onSettings }) {
  const s = useDraftSim(data, { userTeams: config.teams, rounds: config.rounds, speed: config.speed, chatter: config.chatter, seed: config.seed });
  return (
    <>
      <SimTicker s={s} data={data} />
      <Column wide isMobile={isMobile}>
        {s.phase === "done"
          ? <SimResults sim={s.sim} data={data} ctx={s.ctx} speed={s.speed} isMobile={isMobile} onRerun={onRerun} onNew={onSettings} />
          : <SimBroadcast s={s} data={data} isMobile={isMobile} onSettings={onSettings} />}
      </Column>
    </>
  );
}

// ── Setup ──

const chipStyle = (on) => ({
  border: `2px solid ${on ? GOLD : "#24324d"}`, background: on ? GOLD : "#0e1626", color: on ? "#111" : "#c9d4e5",
  borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: 12, letterSpacing: "0.05em",
});

function Setup({ setup, initialTeams, isMobile, names, onStart, starting }) {
  const [teams, setTeams] = useState(() => initialTeams.filter((t) => NFL_TEAMS[t]));
  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [chatter, setChatter] = useState(DEFAULT_CHATTER);

  const sortedTeams = useMemo(() => [...NFL_TEAM_ABBRS].sort((a, b) => names.teamName(a).localeCompare(names.teamName(b))), [names]);
  const toggle = (t) => setTeams((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const startLabel = starting ? "Loading the board…" : teams.length === 0 ? "Watch the CPU Draft" : teams.length === 1 ? `Start the ${names.nickname(teams[0])}' Draft` : `Start Draft · ${teams.length} Teams`;

  return (
    <div className="wd-sim-in">
      <SimHero isMobile={isMobile} />

      <div style={{ background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, padding: isMobile ? 14 : 22, marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <Field label="Rounds">
            {ROUND_OPTIONS.map((r) => <button key={r} onClick={() => setRounds(r)} aria-pressed={rounds === r} style={chipStyle(rounds === r)}>{r}</button>)}
          </Field>
          <Field label="Speed" note={SPEEDS[speed]?.note}>
            {Object.entries(SPEEDS).map(([k, v]) => <button key={k} onClick={() => setSpeed(k)} aria-pressed={speed === k} style={chipStyle(speed === k)}>{v.label}</button>)}
          </Field>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={labelStyle}>Pick Your Teams</span>
            <span style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>
              {teams.length ? teams.map((t) => names.nickname(t)).join(", ") : "None — the CPU drafts for everyone"}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setTeams([...NFL_TEAM_ABBRS])} style={{ ...chipStyle(false), padding: "5px 12px", fontSize: 11 }}>All 32</button>
            <button onClick={() => setTeams([])} style={{ ...chipStyle(false), padding: "5px 12px", fontSize: 11 }}>Clear</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 4 : 8}, minmax(0, 1fr))`, gap: 6 }}>
            {sortedTeams.map((t) => {
              const b = setup.branding[t] || {};
              const on = teams.includes(t);
              return (
                <button key={t} onClick={() => toggle(t)} aria-pressed={on} title={names.teamName(t)} style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 4px", borderRadius: 12, cursor: "pointer",
                  border: `2px solid ${on ? GOLD : "#1f2b42"}`, background: on ? `linear-gradient(160deg, ${b.Color1 || BLUE}, #0e1626 130%)` : "#0b1322",
                  fontFamily: FONT,
                }}>
                  {b.LogoDark || b.Logo1 ? <img src={b.LogoDark || b.Logo1} alt="" style={{ width: isMobile ? 34 : 40, height: isMobile ? 34 : 40, objectFit: "contain", filter: on ? "drop-shadow(0 2px 6px rgba(0,0,0,0.4))" : "grayscale(0.4)", opacity: on ? 1 : 0.8 }} /> : <span style={{ height: 40 }} />}
                  <span style={{ color: on ? "#fff" : "#8b9bb4", fontSize: 10, fontWeight: 900, letterSpacing: "0.04em" }}>{t}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <Field label="Desk Chatter" note={CHATTER.find((c) => c.key === chatter)?.note}>
            {CHATTER.map((c) => <button key={c.key} onClick={() => setChatter(c.key)} aria-pressed={chatter === c.key} style={chipStyle(chatter === c.key)}>{c.label}</button>)}
          </Field>
        </div>

        <button onClick={() => onStart({ teams, rounds: roundsFor(setup.order, teams, rounds), speed, chatter })} disabled={starting} style={{
          marginTop: 20, width: "100%", border: "none", borderRadius: 14, padding: isMobile ? "15px 18px" : "18px 22px", cursor: starting ? "wait" : "pointer",
          background: `linear-gradient(90deg, ${GOLD}, #ffcc66)`, color: "#111", fontFamily: FONT, fontWeight: 900, fontSize: isMobile ? 16 : 20, letterSpacing: "0.08em",
          textTransform: "uppercase", boxShadow: "0 10px 30px rgba(246,162,29,0.25)",
        }}>
          {startLabel} →
        </button>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 14, flexWrap: "wrap", color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>
        <span>Prefer to build it by hand?</span>
        <Link to="/mocks" style={{ color: GOLD, fontWeight: 800 }}>Write a mock draft →</Link>
        <Link to="/draftorder" style={{ color: GOLD, fontWeight: 800 }}>See the full draft order →</Link>
      </div>
    </div>
  );
}

const labelStyle = { color: "#fff", fontWeight: 900, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" };

function Field({ label, note, children }) {
  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{children}</div>
      {note && <div style={{ marginTop: 6, color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>{note}</div>}
    </div>
  );
}

function SimHero({ isMobile }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 18, border: "1px solid #1f2b42", padding: isMobile ? "22px 16px" : "36px 34px", background: `linear-gradient(120deg, #00305c 0%, ${BLUE} 55%, #0b1220 120%)` }}>
      <div aria-hidden="true" style={{ position: "absolute", right: -20, top: "50%", transform: "translateY(-50%)", fontSize: isMobile ? 90 : 190, fontWeight: 900, color: "rgba(255,255,255,0.06)", lineHeight: 1 }}>{SIM_YEAR}</div>
      <div style={{ position: "relative" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#c8102e", color: "#fff", borderRadius: 6, padding: "3px 9px", fontWeight: 900, fontSize: 11, letterSpacing: "0.14em" }}>
          <span className="wd-sim-live-dot" style={{ background: "#fff" }} /> DRAFT SIM
        </span>
        <h1 style={{ margin: "10px 0 10px", color: "#fff", fontSize: isMobile ? 30 : 52, fontWeight: 900, lineHeight: 1, textTransform: "uppercase" }}>
          {SIM_YEAR} NFL Draft Simulator
        </h1>
        <p style={{ margin: 0, maxWidth: 680, color: "rgba(255,255,255,0.88)", fontSize: isMobile ? 14 : 16, lineHeight: 1.55, fontFamily: BODY, fontWeight: 600 }}>
          Take the war room for one team or several. Every other team drafts the way its front office actually drafts — community board, positional value and each staff&apos;s own pick history — and the desk reacts live to every card.
        </p>
      </div>
    </div>
  );
}
