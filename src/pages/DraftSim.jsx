// src/pages/DraftSim.jsx
//
// Draft Sim — /draftsim and /draftsim/:team. A simulated NFL draft run like
// a broadcast: CPU teams pick off the community board weighted by their own
// staff's draft history (utils/draftSim/engine.js), trades happen on the
// site's trade chart, and an analyst desk reacts to every pick
// (utils/draftSim/analysts.js).
//
// /draftsim/2028 (and /draftsim/2028/:team) drafts the 2028 class instead of
// 2027 (SIM_YEARS) — only as
// many rounds as its board can fill (maxRounds); the setup screen switches
// between them.
//
// /draftsim/tb is the marketed entry: it skips setup and starts the draft
// right away with the default settings, the Buccaneers as the user's team
// ("Drafting as the Buccaneers" on the stage first). /draftsim is the setup
// screen — any number of teams (or none, and just watch), rounds, speed and
// desk chatter; the live sim's Settings button comes back here with its
// teams still picked. "My Board" drafts off the signed-in user's own round
// grades instead of the community's (engine applyMyGrades). The setup
// screen's My Drafts tab (?tab=saved) lists the user's saved sims
// (components/draftSim/SavedSims.jsx). Linked from the mock drafts hub (MockDraftHub.jsx) —
// the hand-built, written mocks stay there.
import { Component, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { loadSimSetup, loadSimData, loadMyGrades, SIM_YEAR, SIM_YEARS, maxRounds, teamNamer } from "../utils/draftSim/data";
import { applyMyGrades } from "../utils/draftSim/engine";
import { useAuth } from "../context/AuthContext";
import { countSim, countUserPick } from "../utils/draftSim/stats";
import { CHATTER, DEFAULT_CHATTER } from "../utils/draftSim/analysts";
import { useIsMobile, BLUE, GOLD } from "../components/MockDraftKit";
import useDraftSim, { SPEEDS, DEFAULT_SPEED } from "../components/draftSim/useDraftSim";
import SimBroadcast, { SIM_CSS, SimTicker } from "../components/draftSim/SimBroadcast";
import SimResults from "../components/draftSim/SimResults";
import SavedSims from "../components/draftSim/SavedSims";

const BODY = "Arial, sans-serif";
const FONT = "'Arial Black', Arial, sans-serif";
const STAGE_BG = "radial-gradient(1200px 500px at 50% -10%, #12305c 0%, #070d18 60%), #070d18";
const ROUND_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_ROUNDS = 7;
// App.js pads every page 25px below the navbar; the sim's dark stage runs
// up under the navbar instead of leaving a white strip.
const APP_TOP_PADDING = 25;
// On mobile it runs right up to the navbar's bottom edge (a 42px logo plus
// 12px padding top and bottom) — the body's 80px navbar padding
// (index.css pt-20) leaves a strip otherwise — and fills the screen below.
const BODY_TOP_PADDING = 80;
const MOBILE_NAV_HEIGHT = 66;

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
  // /draftsim/:team, /draftsim/:year (a SIM_YEARS year in the team slot) or
  // /draftsim/:year/:team.
  const params = useParams();
  const pathYear = params.year || (SIM_YEARS.includes(params.team) ? params.team : null);
  const teamParam = pathYear && !params.year ? null : params.team;
  const team = teamParam ? teamParam.toUpperCase() : null;
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const year = SIM_YEARS.includes(pathYear) ? pathYear : SIM_YEAR;
  const yearPath = year === SIM_YEAR ? "" : `/${year}`;
  const { user } = useAuth();
  const [setup, setSetup] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  // config: null on the setup screen; { teams, rounds, speed, chatter, board, seed } once started.
  const [config, setConfig] = useState(null);
  const [pending, setPending] = useState(null);
  // The signed-in user's own grades ({} signed out or unreadable), for My Board.
  const [myGrades, setMyGrades] = useState(null);

  useEffect(() => {
    setMyGrades(null);
    if (!user?.uid) { setMyGrades({}); return undefined; }
    let live = true;
    loadMyGrades(user.uid).then((g) => live && setMyGrades(g)).catch((e) => { console.error("Draft sim my grades error:", e); if (live) setMyGrades({}); });
    return () => { live = false; };
  }, [user?.uid]);
  // How many of this class's board they've graded (null while loading).
  const myCount = data && myGrades ? data.board.filter((p) => myGrades[p.id] != null).length : null;

  useEffect(() => {
    setSetup(null);
    setData(null);
    setError(false);
    let live = true;
    loadSimSetup(year).then((s) => live && setSetup(s)).catch((e) => { console.error("Draft sim setup error:", e); if (live) setError(true); });
    // Warm the full board while the user's choosing.
    loadSimData(year).then((d) => live && setData(d)).catch((e) => { console.error("Draft sim data error:", e); if (live) setError(true); });
    return () => { live = false; };
  }, [year]);

  // A start pressed before the board (or, for My Board, their grades) finished loading.
  useEffect(() => {
    if (pending && data && (pending.board !== "mine" || myGrades)) { setConfig(pending); setPending(null); }
  }, [pending, data, myGrades]);

  // /draftsim/:team starts straight away on the default settings; /draftsim
  // is the setup screen.
  const validTeam = team && NFL_TEAMS[team] ? team : null;
  useEffect(() => {
    setPending(null);
    setConfig(validTeam && setup ? {
      teams: [validTeam], rounds: roundsFor(setup.order, [validTeam], DEFAULT_ROUNDS),
      speed: DEFAULT_SPEED, chatter: DEFAULT_CHATTER, board: "community", seed: newSeed(),
    } : null);
  }, [validTeam, setup]);

  if ((team && !validTeam) || (params.year && !SIM_YEARS.includes(params.year))) return <Navigate to={`/draftsim${yearPath}`} replace />;

  // The setup screen's tab: "new" (set up a draft) or "saved" (My Drafts).
  const tab = new URLSearchParams(location.search).get("tab") === "saved" ? "saved" : "new";
  const setTab = (t) => navigate({ pathname: location.pathname, search: t === "saved" ? "?tab=saved" : "" }, { replace: true, state: location.state });

  const names = teamNamer(setup?.branding || {});
  // Title, description and canonical: components/draftSim/DraftSimMeta.jsx (App.js).

  const start = (cfg) => {
    const next = { ...cfg, seed: newSeed() };
    if (data && (next.board !== "mine" || myGrades)) setConfig(next); else setPending(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Back to the setup screen with this sim's teams (and board) picked.
  const openSettings = (teams, board) => {
    if (team) navigate(`/draftsim${yearPath}`, { state: { teams, board } });
    else { navigate(`/draftsim${yearPath}`, { replace: true, state: { ...location.state, teams, board } }); setConfig(null); setPending(null); }
  };
  // "Pick another team": a clean setup screen — no teams carried over (not
  // even ones from an earlier Settings trip, which ride in the history
  // state) and every option back to its default.
  const pickAnother = () => {
    setConfig(null);
    setPending(null);
    navigate(`/draftsim${yearPath}`, { replace: !team, state: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <style>{SIM_CSS}</style>

      <div style={{
        background: STAGE_BG,
        marginTop: isMobile ? -(APP_TOP_PADDING + BODY_TOP_PADDING - MOBILE_NAV_HEIGHT) : -APP_TOP_PADDING,
        minHeight: isMobile ? `calc(100dvh - ${MOBILE_NAV_HEIGHT}px)` : "calc(100vh / var(--pz, 1) - 35px)",
      }}>
        {error ? (
          <Column isMobile={isMobile}><div style={{ color: "#fff", textAlign: "center", padding: 60, fontFamily: BODY }}>Couldn&apos;t load the draft — try again.</div></Column>
        ) : !setup || (config && !data) ? (
          <Column isMobile={isMobile}><LoadingSpinner label="Loading the draft" size={40} minHeight="50vh" /></Column>
        ) : config ? (
          <SimErrorBoundary key={config.seed} isMobile={isMobile}
            onRestart={() => start({ teams: config.teams, rounds: config.rounds, speed: config.speed, chatter: config.chatter, board: config.board })}
            onSettings={() => openSettings(config.teams, config.board)}>
            <LiveSim data={data} config={config} myGrades={myGrades} isMobile={isMobile}
              onRerun={() => start({ teams: config.teams, rounds: config.rounds, speed: config.speed, chatter: config.chatter, board: config.board })}
              onSettings={() => openSettings(config.teams, config.board)}
              onPickTeam={pickAnother} />
          </SimErrorBoundary>
        ) : (
          <Column isMobile={isMobile}>
            <SetupTabs tab={tab} onTab={setTab} />
            {tab === "saved" ? <SavedSims branding={setup.branding} isMobile={isMobile} /> : <Setup key={year} setup={setup} year={year} rounds={data ? maxRounds(data.board) : null} initialTeams={location.state?.teams || []} initialBoard={location.state?.board} signedIn={!!user} myCount={myCount} isMobile={isMobile} names={names} onStart={start} starting={!!pending}
              onYear={(y) => navigate(`/draftsim${y === SIM_YEAR ? "" : `/${y}`}`, { replace: true, state: location.state })} />}
          </Column>
        )}
      </div>
    </>
  );
}

// Anything the live sim throws: a way back in instead of a blank page.
// Keyed by the run's seed, so a restart (a new seed) clears it.
class SimErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("Draft sim crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { onRestart, onSettings, isMobile } = this.props;
    const btn = (primary) => ({
      border: primary ? "none" : `1px solid ${GOLD}`, borderRadius: 999, padding: "10px 18px", cursor: "pointer", fontFamily: FONT, fontWeight: 900,
      fontSize: 12, letterSpacing: "0.06em", background: primary ? GOLD : "transparent", color: primary ? "#111" : "#fff",
    });
    return (
      <Column isMobile={isMobile}>
        <div style={{ background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, padding: 28, textAlign: "center", color: "#fff", fontFamily: BODY }}>
          <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: 20, textTransform: "uppercase" }}>The draft hit a snag</div>
          <p style={{ color: "#c9d4e5", margin: "8px 0 16px" }}>Something went wrong mid-draft. Restart it with the same settings, or head back to setup.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={onRestart} style={btn(true)}>RESTART DRAFT</button>
            <button onClick={onSettings} style={btn(false)}>BACK TO SETUP</button>
          </div>
        </div>
      </Column>
    );
  }
}

function LiveSim({ data: communityData, config, myGrades, isMobile, onRerun, onSettings, onPickTeam }) {
  // My Board: their grades over the community's (fixed for this run — the
  // sim remounts on every start).
  const [data] = useState(() => (config.board === "mine" && myGrades ? { ...communityData, board: applyMyGrades(communityData.board, myGrades) } : communityData));
  // No more rounds than the class's board can fill (2028 is thin).
  const rounds = Math.min(config.rounds, maxRounds(data.board));
  // Usage counts (Admin → Mock Draft → Statistics): this run, its finish,
  // and every pick the user makes.
  const { user } = useAuth();
  const uid = user?.uid || null;
  const onUserPick = useCallback((event) => countUserPick(uid, data.year, event), [uid, data.year]);
  const s = useDraftSim(data, { userTeams: config.teams, rounds, speed: config.speed, chatter: config.chatter, seed: config.seed, onUserPick });
  useEffect(() => { countSim(uid, "sims"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finished = s.phase === "done";
  useEffect(() => { if (finished) countSim(uid, "completed"); }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mobile, mid-draft: no ticker, and the sim fills the screen under the
  // navbar edge to edge (the console scrolls inside it, not the page).
  if (isMobile && !finished) {
    return (
      <div style={{ height: `calc(100dvh - ${MOBILE_NAV_HEIGHT}px)`, padding: 6, boxSizing: "border-box", fontFamily: FONT }}>
        <SimBroadcast s={s} data={data} isMobile onSettings={onSettings} onPickTeam={onPickTeam} />
      </div>
    );
  }
  return (
    <>
      {!isMobile && <SimTicker s={s} data={data} />}
      <Column wide isMobile={isMobile}>
        {s.phase === "done"
          ? <SimResults sim={s.sim} data={data} ctx={s.ctx} speed={s.speed} isMobile={isMobile} onRerun={onRerun} onNew={onSettings} />
          : <SimBroadcast s={s} data={data} isMobile={isMobile} onSettings={onSettings} onPickTeam={onPickTeam} />}
      </Column>
    </>
  );
}

// ── Setup ──

function SetupTabs({ tab, onTab }) {
  const tabStyle = (on) => ({
    border: "none", borderBottom: `3px solid ${on ? GOLD : "transparent"}`, background: "none", color: on ? "#fff" : "#8b9bb4",
    padding: "8px 4px", marginRight: 18, cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase",
  });
  return (
    <div role="tablist" style={{ display: "flex", borderBottom: "1px solid #1f2b42", marginBottom: 14 }}>
      <button role="tab" aria-selected={tab === "new"} onClick={() => onTab("new")} style={tabStyle(tab === "new")}>New Draft</button>
      <button role="tab" aria-selected={tab === "saved"} onClick={() => onTab("saved")} style={tabStyle(tab === "saved")}>My Drafts</button>
    </div>
  );
}

const chipStyle = (on) => ({
  border: `2px solid ${on ? GOLD : "#24324d"}`, background: on ? GOLD : "#0e1626", color: on ? "#111" : "#c9d4e5",
  borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: 12, letterSpacing: "0.05em",
});

// year / onYear: the class being drafted and switching it; rounds: how
// many rounds its board can fill (null while it loads).
// initialBoard / signedIn / myCount: the board choice coming back from a
// sim, whether there's a user to have grades, and how many of this class
// they've graded (null while it loads).
function Setup({ setup, year, rounds: maxRoundsForYear, onYear, initialTeams, initialBoard, signedIn, myCount, isMobile, names, onStart, starting }) {
  const [teams, setTeams] = useState(() => initialTeams.filter((t) => NFL_TEAMS[t]));
  const [chosenRounds, setRounds] = useState(DEFAULT_ROUNDS);
  const rounds = maxRoundsForYear ? Math.min(chosenRounds, maxRoundsForYear) : chosenRounds;
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [chatter, setChatter] = useState(DEFAULT_CHATTER);
  const [board, setBoard] = useState(() => (initialBoard === "mine" && signedIn ? "mine" : "community"));
  const boardNote = !signedIn
    ? "Sign in to draft off your own grades."
    : board === "community"
      ? "Every team drafts off the We-Draft community grades."
      : `Your round grades replace the community's and re-rank the board. Players you haven't graded use the community grade, and strengths and weaknesses are always the community's.${myCount != null ? ` You've graded ${myCount} of the ${year} class.` : ""}`;

  const sortedTeams = useMemo(() => [...NFL_TEAM_ABBRS].sort((a, b) => names.teamName(a).localeCompare(names.teamName(b))), [names]);
  const toggle = (t) => setTeams((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const startLabel = starting ? "Loading the board…" : teams.length === 0 ? "Watch the CPU Draft" : teams.length === 1 ? `Start the ${names.nickname(teams[0])}' Draft` : `Start Draft · ${teams.length} Teams`;

  return (
    <div className="wd-sim-in">
      <SimHero isMobile={isMobile} year={year} />

      <div style={{ background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, padding: isMobile ? 14 : 22, marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <Field label="Draft" note={maxRoundsForYear && maxRoundsForYear < 7 ? `The ${year} board fills ${maxRoundsForYear} round${maxRoundsForYear === 1 ? "" : "s"} so far.` : null}>
            {SIM_YEARS.map((y) => <button key={y} onClick={() => onYear(y)} aria-pressed={year === y} style={chipStyle(year === y)}>{y}</button>)}
          </Field>
          <Field label="Rounds">
            {ROUND_OPTIONS.map((r) => {
              const off = maxRoundsForYear != null && r > maxRoundsForYear;
              return <button key={r} onClick={() => !off && setRounds(r)} disabled={off} aria-pressed={rounds === r} style={{ ...chipStyle(rounds === r), opacity: off ? 0.35 : 1, cursor: off ? "not-allowed" : "pointer" }}>{r}</button>;
            })}
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
          <Field label="Board" note={boardNote}>
            <button onClick={() => setBoard("community")} aria-pressed={board === "community"} style={chipStyle(board === "community")}>Community</button>
            <button onClick={() => signedIn && setBoard("mine")} disabled={!signedIn} aria-pressed={board === "mine"} style={{ ...chipStyle(board === "mine"), opacity: signedIn ? 1 : 0.35, cursor: signedIn ? "pointer" : "not-allowed" }}>My Board</button>
          </Field>
        </div>

        <div style={{ marginTop: 18 }}>
          <Field label="Desk Chatter" note={CHATTER.find((c) => c.key === chatter)?.note}>
            {CHATTER.map((c) => <button key={c.key} onClick={() => setChatter(c.key)} aria-pressed={chatter === c.key} style={chipStyle(chatter === c.key)}>{c.label}</button>)}
          </Field>
        </div>

        <button onClick={() => onStart({ teams, rounds: roundsFor(setup.order, teams, rounds), speed, chatter, board })} disabled={starting} style={{
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

function SimHero({ isMobile, year }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 18, border: "1px solid #1f2b42", padding: isMobile ? "22px 16px" : "36px 34px", background: `linear-gradient(120deg, #00305c 0%, ${BLUE} 55%, #0b1220 120%)` }}>
      <div aria-hidden="true" style={{ position: "absolute", right: -20, top: "50%", transform: "translateY(-50%)", fontSize: isMobile ? 90 : 190, fontWeight: 900, color: "rgba(255,255,255,0.06)", lineHeight: 1 }}>{year}</div>
      <div style={{ position: "relative" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#c8102e", color: "#fff", borderRadius: 6, padding: "3px 9px", fontWeight: 900, fontSize: 11, letterSpacing: "0.14em" }}>
          <span className="wd-sim-live-dot" style={{ background: "#fff" }} /> DRAFT SIM
        </span>
        <h1 style={{ margin: "10px 0 10px", color: "#fff", fontSize: isMobile ? 30 : 52, fontWeight: 900, lineHeight: 1, textTransform: "uppercase" }}>
          {year} NFL Draft Simulator
        </h1>
        <p style={{ margin: 0, maxWidth: 680, color: "rgba(255,255,255,0.88)", fontSize: isMobile ? 14 : 16, lineHeight: 1.55, fontFamily: BODY, fontWeight: 600 }}>
          Take the war room for one team or several. Every other team drafts the way its front office actually drafts — community board, positional value and each staff&apos;s own pick history — and the desk reacts live to every card.
        </p>
      </div>
    </div>
  );
}
