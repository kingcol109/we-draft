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
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { useMobileStuckPageWatchdog } from "../hooks/useMobileStuckPageWatchdog";
import { NFL_TEAMS, NFL_TEAM_ABBRS } from "../utils/coachHistory";
import { loadSimSetup, loadSimData, loadExpandedBoard, loadMyGrades, SIM_YEAR, SIM_YEARS, maxRounds, teamNamer } from "../utils/draftSim/data";
import { applyMyGrades, teamHaul, shuffleOrder, relabelOrder, orderTeams, randomTeamMap, swapTeams, CPU_TRADES, VARIANCE, DEFAULT_VARIANCE } from "../utils/draftSim/engine";
import { useAuth } from "../context/AuthContext";
import { countSim, countTeams, countUserPick } from "../utils/draftSim/stats";
import { recordSimProfile, recordStreak, onDefaults, PROFILE_PATH } from "../utils/draftSim/simProfile";
import { CHATTER, DEFAULT_CHATTER } from "../utils/draftSim/analysts";
import { useIsMobile, BLUE, GOLD } from "../components/MockDraftKit";
import useDraftSim, { SPEEDS, DEFAULT_SPEED } from "../components/draftSim/useDraftSim";
import SimBroadcast, { SIM_CSS, introHeadline } from "../components/draftSim/SimBroadcast";
import SimResults from "../components/draftSim/SimResults";
import SavedSims from "../components/draftSim/SavedSims";
import SimProfile from "../components/draftSim/SimProfile";
import SimCommunity, { SubTabs } from "../components/draftSim/SimCommunity";
import useSimBadges from "../components/draftSim/useSimBadges";
import { BadgeToasts } from "../components/draftSim/SimBadges";
import { RECENT_PATH, COMMUNITY_PATH } from "../utils/draftSim/publicSims";
import MarginAds from "../components/MarginAds";
import { cssRect, viewportCssHeight } from "../utils/pageZoom";

const BODY = "Arial, sans-serif";
const FONT = "'Arial Black', Arial, sans-serif";
const STAGE_BG = "radial-gradient(1200px 500px at 50% -10%, #12305c 0%, #070d18 60%), #070d18";
const ROUND_OPTIONS = [1, 2, 3, 4, 5, 6, 7];
const DEFAULT_ROUNDS = 7;
// Classes whose sims and mocks start on the Expanded Board (a thin site board).
const EXPANDED_YEARS = ["2028"];
// Mock Draft mode's default.
const MOCK_ROUNDS = 1;
// App.js pads every page 25px below the navbar; the sim's dark stage runs
// up under the navbar instead of leaving a white strip.
const APP_TOP_PADDING = 25;
// On mobile it runs right up to the navbar's bottom edge (a 42px logo plus
// 12px padding top and bottom) — the body's 80px navbar padding
// (index.css pt-20) leaves a strip otherwise — and fills the screen below.
const BODY_TOP_PADDING = 80;
const MOBILE_NAV_HEIGHT = 66;

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// Enough rounds that the user gets a pick: stretched only when none of
// their teams picks in the rounds chosen (a lone team without a
// 1st-rounder still drafts) — not to reach every team's first pick, or one
// team that traded its 1st turns a one-round draft into two.
function roundsFor(order, teams, rounds) {
  const firsts = teams.map((t) => Math.min(...order.filter((p) => (p.Traded || p.Team) === t).map((p) => p.Round))).filter(Number.isFinite);
  return firsts.length ? Math.max(rounds, Math.min(...firsts)) : rounds;
}

// The centered content column. contentRef: the one the side ads center
// in the gutters beside.
function Column({ wide, isMobile, contentRef, children }) {
  return (
    <div ref={contentRef} style={{ maxWidth: wide ? 1320 : 1100, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "18px 20px 60px", fontFamily: FONT }}>
      {children}
    </div>
  );
}

// page: "profile" (/draftsim/profile), "community" (/draftsim/community)
// or "recent" (/draftsim/recent, Community's Recent Drafts) — a page of its
// own, with the setup screen's tabs over it.
const PAGE_PATHS = { profile: PROFILE_PATH, community: COMMUNITY_PATH };
const PROFILE_VIEWS = [["profile", "Profile"], ["drafts", "My Drafts"]];
export default function DraftSim({ page = null }) {
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
  // The Expanded Board (hidden players in), loaded the first time a run asks.
  const [expandedBoard, setExpandedBoard] = useState(null);
  // The teams picked on the setup screen (the side ads default to one).
  const [setupTeams, setSetupTeams] = useState([]);
  const contentRef = useRef(null);
  // The signed-in user's own grades ({} signed out or unreadable), for My Board.
  const [myGrades, setMyGrades] = useState(null);
  // A finished run: its results sit under the setup screen's tabs, "New
  // Draft" as "This Draft". Sim Profile and Community open in place (doneTab,
  // doneView) rather than by route — another route remounts the page and
  // the run's gone; This Draft brings the results back. null until the run's
  // finished.
  const [doneTab, setDoneTab] = useState(null);
  const [doneView, setDoneView] = useState({ profile: "profile", community: "insights" });
  useEffect(() => { setDoneTab(null); }, [config]);
  const openDoneTab = (t) => { setDoneTab(t); window.scrollTo(0, 0); };

  // The whole page dark while it's up — the strip the body's navbar padding
  // leaves above the stage, the footer and anything under it (SIM_CSS).
  useEffect(() => {
    document.documentElement.classList.add("wd-sim-dark");
    return () => document.documentElement.classList.remove("wd-sim-dark");
  }, []);

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
    setExpandedBoard(null);
    setError(false);
    let live = true;
    loadSimSetup(year).then((s) => live && setSetup(s)).catch((e) => { console.error("Draft sim setup error:", e); if (live) setError(true); });
    // Warm the full board while the user's choosing.
    loadSimData(year).then((d) => live && setData(d)).catch((e) => { console.error("Draft sim data error:", e); if (live) setError(true); });
    return () => { live = false; };
  }, [year]);

  // The Expanded Board, once a run (started or waiting to) wants it.
  const wantsExpanded = !!(config?.expanded || pending?.expanded);
  useEffect(() => {
    if (!wantsExpanded || expandedBoard) return;
    loadExpandedBoard(year).then(setExpandedBoard).catch((e) => { console.error("Draft sim expanded board error:", e); setError(true); });
  }, [wantsExpanded, expandedBoard, year]);

  // A start pressed before the board (or, for My Board, their grades) finished loading.
  useEffect(() => {
    if (pending && data && (pending.board !== "mine" || myGrades) && (!pending.expanded || expandedBoard)) { setConfig(pending); setPending(null); }
  }, [pending, data, myGrades, expandedBoard]);

  // Stuck on the spinner (a request a backgrounded tab abandoned, or one
  // that just never comes back): one real page reload after 5 seconds, as
  // player pages do — on desktop too.
  // A run on the Expanded Board waits for it too.
  const boardReady = !!data && (!config?.expanded || !!expandedBoard);
  const stuckLoading = !error && (!setup || ((config || pending) && !boardReady));
  useMobileStuckPageWatchdog(stuckLoading, `draftsim_${year}`, { enabled: true, timeoutMs: 5000 });
  // Loaded (its tags are DraftSimMeta's, set from the start): tell
  // Prerender.io the page is ready to snapshot (public/index.html starts it
  // false) — without it the bots' copy waits out Prerender's timeout.
  useEffect(() => {
    if (stuckLoading) return undefined;
    const frame = requestAnimationFrame(() => { window.prerenderReady = true; });
    return () => cancelAnimationFrame(frame);
  }, [stuckLoading]);

  // /draftsim/:team starts straight away on the default settings; /draftsim
  // is the setup screen.
  const validTeam = team && NFL_TEAMS[team] ? team : null;
  useEffect(() => {
    setPending(null);
    setConfig(validTeam && setup ? {
      teams: [validTeam], baseRounds: DEFAULT_ROUNDS, rounds: roundsFor(setup.order, [validTeam], DEFAULT_ROUNDS),
      speed: DEFAULT_SPEED, chatter: DEFAULT_CHATTER, board: "community", seed: newSeed(), expanded: EXPANDED_YEARS.includes(year),
    } : null);
  }, [validTeam, setup, year]);

  if ((team && !validTeam) || (params.year && !SIM_YEARS.includes(params.year))) return <Navigate to={`/draftsim${yearPath}`} replace />;

  // The setup screen's tabs: "new" (set up a draft), "profile" (Sim
  // Profile, /draftsim/profile — its sub-tabs the profile itself and My
  // Drafts, ?view=drafts) and "community" (/draftsim/community — Insights,
  // and Recent Drafts at /draftsim/recent). The old ?tab=profile /
  // ?tab=saved links land on the profile.
  const searchTab = new URLSearchParams(location.search).get("tab");
  if (!page && searchTab === "profile") return <Navigate to={PROFILE_PATH} replace />;
  if (!page && searchTab === "saved") return <Navigate to={`${PROFILE_PATH}?view=drafts`} replace />;
  const tab = page === "recent" || page === "community" ? "community" : page || "new";
  const view = page === "recent" ? "recent" : page === "community" ? "insights"
    : new URLSearchParams(location.search).get("view") === "drafts" ? "drafts" : "profile";
  const setTab = (t) => {
    if (PAGE_PATHS[t]) navigate(PAGE_PATHS[t]);
    else navigate({ pathname: page ? `/draftsim${yearPath}` : location.pathname, search: "" }, { replace: !page, state: location.state });
  };
  const setView = (v) => navigate(v === "drafts" ? `${PROFILE_PATH}?view=drafts` : v === "recent" ? RECENT_PATH : v === "insights" ? COMMUNITY_PATH : PROFILE_PATH, { replace: true });
  // The Sim Profile and Community tabs' contents, for the setup screen and a finished run.
  const tabBody = (t, v, onView) => (t === "profile" ? (
    <>
      <SubTabs views={PROFILE_VIEWS} view={v} onView={onView} />
      {v === "drafts" ? <SavedSims branding={setup.branding} isMobile={isMobile} /> : <SimProfile branding={setup.branding} names={names.teamName} isMobile={isMobile} />}
    </>
  ) : <SimCommunity view={v} onView={onView} branding={setup.branding} names={names.teamName} order={setup.order} orderYear={setup.year} isMobile={isMobile} />);
  const doneAway = doneTab && doneTab !== "new";

  const names = teamNamer(setup?.branding || {});
  // Title, description and canonical: components/draftSim/DraftSimMeta.jsx (App.js).

  // cfg.baseRounds: the rounds picked; rounds stretches them to reach each
  // team's first pick in this run's order (a random one is new every start).
  const start = (cfg) => {
    const seed = newSeed();
    const order = cfg.orderMode === "random" ? shuffleOrder(setup.order, seed) : cfg.orderMode === "custom" && cfg.orderMap ? relabelOrder(setup.order, cfg.orderMap) : null;
    const next = { ...cfg, seed, order, rounds: roundsFor(order || setup.order, cfg.teams, cfg.baseRounds ?? cfg.rounds) };
    if (data && (next.board !== "mine" || myGrades) && (!next.expanded || expandedBoard)) setConfig(next); else setPending(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Back to the setup screen with this sim's teams (and board) picked.
  // opts: the run's other setup choices ({ mode, orderMode, orderMap, cpuTrades, variance, expanded }),
  // with the year they were made for.
  const openSettings = (teams, board, runOpts) => {
    const opts = { ...runOpts, year };
    if (team) navigate(`/draftsim${yearPath}`, { state: { teams, board, opts } });
    else { navigate(`/draftsim${yearPath}`, { replace: true, state: { ...location.state, teams, board, opts } }); setConfig(null); setPending(null); }
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
        minHeight: isMobile ? `calc(100svh - ${MOBILE_NAV_HEIGHT}px)` : "calc(100vh / var(--pz, 1) - 35px)",
      }}>
        {error ? (
          <Column isMobile={isMobile}><div style={{ color: "#fff", textAlign: "center", padding: 60, fontFamily: BODY }}>Couldn&apos;t load the draft — try again.</div></Column>
        ) : !setup || (config && !boardReady) ? (
          <Column isMobile={isMobile}><LoadingSpinner label="Loading the draft" size={40} minHeight="50vh" /></Column>
        ) : config ? (
          <>
            {/* Kept mounted (hidden) while a finished run's other tab is open. */}
            <div style={doneAway ? { display: "none" } : undefined}>
              <SimErrorBoundary key={config.seed} isMobile={isMobile}
                onRestart={() => start(rerunOf(config))}
                onSettings={() => openSettings(config.teams, config.board, optsOf(config))}>
                <LiveSim data={config.expanded && expandedBoard ? { ...data, board: expandedBoard } : data} config={config} myGrades={myGrades} isMobile={isMobile} contentRef={contentRef}
                  onRerun={() => start(rerunOf(config))}
                  onSettings={() => openSettings(config.teams, config.board, optsOf(config))}
                  onPickTeam={pickAnother}
                  onDone={() => setDoneTab((t) => t || "new")}
                  tabs={<SetupTabs tab="new" thisDraft onTab={openDoneTab} isMobile={isMobile} />} />
              </SimErrorBoundary>
            </div>
            {doneAway && (
              <Column wide isMobile={isMobile}>
                <SetupTabs tab={doneTab} thisDraft onTab={openDoneTab} isMobile={isMobile} />
                {tabBody(doneTab, doneView[doneTab], (v) => setDoneView((d) => ({ ...d, [doneTab]: v })))}
              </Column>
            )}
          </>
        ) : (
          <Column isMobile={isMobile} contentRef={contentRef}>
            <SetupTabs tab={tab} onTab={setTab} isMobile={isMobile} />
            {tab !== "new" ? tabBody(tab, view, setView)
              : <Setup key={year} setup={setup} year={year} rounds={data ? maxRounds(data.board) : null} initialTeams={location.state?.teams || []} initialBoard={location.state?.board} initialOpts={location.state?.opts} signedIn={!!user} myCount={myCount} isMobile={isMobile} names={names} onStart={start} starting={!!pending} onTeams={setSetupTeams}
              onYear={(y) => navigate(`/draftsim${y === SIM_YEAR ? "" : `/${y}`}`, { replace: true, state: location.state })} />}
          </Column>
        )}
      </div>

      {/* Homage NFL ads in the gutters, desktop only, in the sim's dark
          colors: the user's team (the first, if several) by default, else
          random. */}
      {setup && !error && (
        <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} dark
          preferTeam={adTeam(config ? config.teams : tab === "new" ? setupTeams : [])}
          teamLogos={adLogos(setup.branding)} watch={[!!config, tab]} />
      )}
    </>
  );
}

// A run's setup choices, to run it again or take back to Settings.
const optsOf = (c) => ({ mode: c.mode, orderMode: c.orderMode, orderMap: c.orderMap, cpuTrades: c.cpuTrades, variance: c.variance, expanded: !!c.expanded });
const rerunOf = (c) => ({ mode: c.mode, teams: c.teams, baseRounds: c.baseRounds, rounds: c.rounds, speed: c.speed, chatter: c.chatter, board: c.board, ...optsOf(c) });

// The ad's team: the one the user's drafting as (the first of several);
// none — so random — when watching or drafting as all 32.
const adTeam = (teams) => (teams.length && teams.length < NFL_TEAM_ABBRS.length ? teams[0] : "");
// The picker's logos, dark-ready like the rest of the sim.
const adLogos = (branding) => Object.fromEntries(
  Object.entries(branding || {}).map(([t, b]) => [t, b.LogoDark || b.Logo1]).filter(([, logo]) => logo),
);

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
      fontSize: 12, letterSpacing: "0.06em", background: primary ? GOLD : "transparent", color: "#fff",
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

// onDone: the run's finished; tabs: the tab bar over its results.
function LiveSim({ data: communityData, config, myGrades, isMobile, contentRef, onRerun, onSettings, onPickTeam, onDone, tabs }) {
  // My Board: their grades over the community's (fixed for this run — the
  // sim remounts on every start).
  // A random order (config.order) over the real one.
  const [data] = useState(() => ({
    ...communityData,
    ...(config.board === "mine" && myGrades ? { board: applyMyGrades(communityData.board, myGrades) } : {}),
    ...(config.order ? { order: config.order } : {}),
  }));
  // No more rounds than the class's board can fill (2028 is thin).
  const rounds = Math.min(config.rounds, maxRounds(data.board));
  // Mock Draft mode: the same sim, no pause between picks (useDraftSim quick).
  const mock = config.mode === "mock";
  // Usage counts (Admin → Mock Draft → Statistics): this run once START THE
  // DRAFT takes it past the intro (not just opening it — /draftsim/{team}
  // lands on the intro) and the teams it's drafting as, its finish, and
  // every pick the user makes.
  const { user, profile } = useAuth();
  const uid = user?.uid || null;
  const onUserPick = useCallback((event) => countUserPick(uid, data.year, event), [uid, data.year]);
  const s = useDraftSim(data, { userTeams: config.teams, rounds, speed: config.speed, chatter: config.chatter, seed: config.seed, cpuTrades: config.cpuTrades, variance: config.variance, quick: mock, onUserPick });
  const started = s.phase !== "intro";
  useEffect(() => { if (started) { countSim(uid, "sims"); countTeams(uid, data.year, config.teams); } }, [started]); // eslint-disable-line react-hooks/exhaustive-deps
  const finished = s.phase === "done";
  useEffect(() => { if (finished) { countSim(uid, "completed"); onDone?.(); } }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps
  // The signed-in user's Sim Profile (utils/draftSim/simProfile.js), once
  // the draft's finished: any sim keeps their streak going; only a
  // single-team sim on the default settings (speed and chatter aside)
  // goes on the profile. Once a run — and a run finished signed out counts
  // when they sign in from the end screen (its sign-in prompt).
  const counted = onDefaults(config, { maxRounds: maxRounds(data.board), defaultRounds: DEFAULT_ROUNDS, defaultExpanded: EXPANDED_YEARS.includes(data.year) });
  const profiled = useRef(false);
  useEffect(() => {
    if (!finished || !uid || profiled.current) return;
    profiled.current = true;
    recordStreak(uid);
    if (counted) recordSimProfile(uid, { year: data.year, hauls: config.teams.map((t) => teamHaul(s.sim, t)) });
  }, [finished, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  // Badges (components/draftSim/useSimBadges.js): popped up as they're
  // earned, saved at the end. My Board's ranks don't count for the value ones.
  const badges = useSimBadges({ sim: s.sim, year: data.year, valueBoard: config.board !== "mine", uid, admin: profile?.role === "admin" });
  const toasts = <BadgeToasts queue={badges.queue} onDone={badges.dismiss} isMobile={isMobile} />;
  // Mobile, mid-draft: one anchored screen pinned to the viewport — the
  // stage never moves, and only the console's tab scrolls (SimBroadcast).
  // The page itself doesn't scroll (wd-sim-lock), the site footer is
  // hidden, and the navbar slides up out of the way, with an arrow tab at
  // the top to bring it back down (navOpen).
  const live = isMobile && !finished;
  const [navOpen, setNavOpen] = useState(false);
  const navHeight = useNavHeight(live);
  useEffect(() => {
    if (!live) return undefined;
    const html = document.documentElement;
    document.body.classList.add("wd-sim-nofooter");
    html.classList.add("wd-sim-lock", "wd-sim-navhide");
    return () => {
      document.body.classList.remove("wd-sim-nofooter");
      html.classList.remove("wd-sim-lock", "wd-sim-navhide", "wd-sim-navopen");
    };
  }, [live]);
  useEffect(() => { document.documentElement.classList.toggle("wd-sim-navopen", live && navOpen); }, [live, navOpen]);
  // iOS scrolls the page under the fixed screen when the keyboard opens (the
  // search box) and can leave it there — taps then land below what's shown
  // (on the board instead of the tabs). Back to the top whenever a field
  // lets go or the keyboard closes, and on the way in.
  useEffect(() => {
    if (!live) return undefined;
    const reset = () => setTimeout(() => window.scrollTo(0, 0), 60);
    reset();
    const vv = window.visualViewport;
    document.addEventListener("focusout", reset);
    vv?.addEventListener("resize", reset);
    return () => {
      document.removeEventListener("focusout", reset);
      vv?.removeEventListener("resize", reset);
    };
  }, [live]);
  if (live) {
    return (
      <>
        <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", padding: "6px 6px calc(6px + env(safe-area-inset-bottom))", boxSizing: "border-box", background: STAGE_BG, fontFamily: FONT }}>
          <SimBroadcast s={s} data={data} isMobile onSettings={onSettings} onPickTeam={onPickTeam} />
        </div>
        {toasts}
        <button onClick={() => setNavOpen((o) => !o)} aria-label={navOpen ? "Hide the menu" : "Show the menu"} aria-expanded={navOpen} style={{
          position: "fixed", top: navOpen ? navHeight : 0, left: "50%", transform: "translateX(-50%)", zIndex: 10002, transition: "top .25s ease",
          border: "none", borderRadius: "0 0 10px 10px", background: "#0055a5", color: "#fff", padding: "1px 16px 3px", fontSize: 11, lineHeight: 1.2, cursor: "pointer",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}>{navOpen ? "▲" : "▼"}</button>
      </>
    );
  }
  if (s.phase === "done") {
    return (
      <Column wide isMobile={isMobile} contentRef={contentRef}>
        {tabs}
        <SimResults sim={s.sim} data={data} ctx={s.ctx} speed={s.speed} isMobile={isMobile} onRerun={onRerun} onNew={onSettings} mock={mock} counted={counted} onUndo={mock && s.canUndo ? s.undo : undefined}
          badges={badges.runEarned} badgeTotal={badges.total} />
        {toasts}
      </Column>
    );
  }
  // Desktop, mid-draft: anchored too — the sim fills the window under the
  // navbar and only its console scrolls (SimBroadcast fill).
  return (
    <Column wide isMobile={isMobile} contentRef={contentRef}>
      <DesktopFill><SimBroadcast s={s} data={data} isMobile={isMobile} onSettings={onSettings} onPickTeam={onPickTeam} fill /></DesktopFill>
      {toasts}
    </Column>
  );
}

// The desktop sim's frame: from where it starts down to the window's
// bottom edge (in CSS px — the page zoom, utils/pageZoom.js), re-measured
// on resize. The page itself doesn't scroll meanwhile (wd-sim-lock), and
// the footer is hidden. Fullscreen (the broadcast bar's button —
// SimBroadcast.jsx SIM_FRAME) takes this frame to the whole screen.
const FILL_BOTTOM_GAP = 14;
const FULLSCREEN_PAD = 14;
function DesktopFill({ children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(null);
  const [full, setFull] = useState(false);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const html = document.documentElement;
    html.classList.add("wd-sim-lock");
    document.body.classList.add("wd-sim-nofooter");
    const read = () => {
      const fs = document.fullscreenElement === ref.current;
      setFull(fs);
      if (fs) setHeight(window.innerHeight - FULLSCREEN_PAD * 2);
      else if (ref.current) setHeight(Math.max(420, Math.floor(viewportCssHeight() - cssRect(ref.current).top - FILL_BOTTOM_GAP)));
    };
    read();
    window.addEventListener("resize", read);
    document.addEventListener("fullscreenchange", read);
    return () => {
      window.removeEventListener("resize", read);
      document.removeEventListener("fullscreenchange", read);
      html.classList.remove("wd-sim-lock");
      document.body.classList.remove("wd-sim-nofooter");
    };
  }, []);
  return (
    <div ref={ref} data-sim-frame="" style={{ height: full ? "100vh" : height ?? "calc(100vh / var(--pz, 1) - 120px)", ...(full ? { padding: FULLSCREEN_PAD, background: "#0b1220", boxSizing: "border-box" } : {}) }}>
      {full ? <div style={{ height: "100%" }}>{children}</div> : children}
    </div>
  );
}

// The fixed navbar's height (it can change — the LIVE button, a font
// loading), re-read on resize while `on`: where the arrow tab sits when the
// navbar's brought back down.
function useNavHeight(on) {
  const [height, setHeight] = useState(MOBILE_NAV_HEIGHT);
  useLayoutEffect(() => {
    if (!on) return undefined;
    const read = () => {
      const nav = document.querySelector("nav");
      if (nav) setHeight(Math.round(nav.getBoundingClientRect().height));
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [on]);
  return height;
}

// ── Setup ──

// thisDraft: over a finished run — "New Draft" is "This Draft", its results.
function SetupTabs({ tab, onTab, isMobile, thisDraft = false }) {
  const tabStyle = (on) => ({
    border: "none", borderBottom: `3px solid ${on ? GOLD : "transparent"}`, background: "none", color: on ? "#fff" : "#8b9bb4",
    padding: "8px 4px", marginRight: isMobile ? 12 : 18, cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: isMobile ? 11 : 13, letterSpacing: isMobile ? "0.05em" : "0.1em", textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0,
  });
  const tabs = [["new", thisDraft ? "This Draft" : "New Draft", thisDraft ? "This Draft" : "New"], ["profile", "Sim Profile", "Profile"], ["community", "Community", "Community"]];
  return (
    <div role="tablist" style={{ display: "flex", borderBottom: "1px solid #1f2b42", marginBottom: 14, overflowX: "auto" }}>
      {tabs.map(([key, label, short]) => (
        <button key={key} role="tab" aria-selected={tab === key} onClick={() => onTab(key)} style={tabStyle(tab === key)}>{isMobile ? short : label}</button>
      ))}
    </div>
  );
}

const chipStyle = (on) => ({
  border: `2px solid ${on ? GOLD : "#24324d"}`, background: on ? GOLD : "#0e1626", color: on ? "#fff" : "#c9d4e5",
  borderRadius: 999, padding: "7px 14px", cursor: "pointer", fontFamily: FONT, fontWeight: 900, fontSize: 12, letterSpacing: "0.05em",
});

// year / onYear: the class being drafted and switching it; rounds: how
// many rounds its board can fill (null while it loads).
// initialBoard / signedIn / myCount: the board choice coming back from a
// sim, whether there's a user to have grades, and how many of this class
// they've graded (null while it loads).
function Setup({ setup, year, rounds: maxRoundsForYear, onYear, initialTeams, initialBoard, initialOpts, signedIn, myCount, isMobile, names, onStart, starting, onTeams }) {
  const [teams, setTeams] = useState(() => initialTeams.filter((t) => NFL_TEAMS[t]));
  // "sim" or "mock" (Mock Draft: the same sim with no pause between picks,
  // all 32 by default, exports as a mock draft post). Switching to Mock
  // Draft picks all 32 and back restores the teams from before.
  const [mode, setMode] = useState(() => (initialOpts?.mode === "mock" ? "mock" : "sim"));
  const simTeams = useRef(null);
  const simRounds = useRef(null);
  const switchMode = (m) => {
    if (m === mode) return;
    if (m === "mock") {
      simTeams.current = teams;
      simRounds.current = chosenRounds;
      setTeams([...NFL_TEAM_ABBRS]);
      setRounds(MOCK_ROUNDS);
    } else {
      setTeams(simTeams.current || []);
      setRounds(simRounds.current || DEFAULT_ROUNDS);
    }
    setMode(m);
  };
  useEffect(() => { onTeams?.(teams); }, [teams]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chosenRounds, setRounds] = useState(() => (initialOpts?.mode === "mock" ? MOCK_ROUNDS : DEFAULT_ROUNDS));
  const rounds = maxRoundsForYear ? Math.min(chosenRounds, maxRoundsForYear) : chosenRounds;
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [chatter, setChatter] = useState(DEFAULT_CHATTER);
  const [board, setBoard] = useState(() => (initialBoard === "mine" && signedIn ? "mine" : "community"));
  const [orderMode, setOrderMode] = useState(() => (ORDER_MODES.some((m) => m.key === initialOpts?.orderMode) ? initialOpts.orderMode : "real"));
  // Custom: who holds each team's picks, every team listed so a swap stays
  // a one-for-one trade of places (Settings' map only if it's this year's teams).
  const [orderMap, setOrderMap] = useState(() => {
    const all = orderTeams(setup.order);
    const kept = initialOpts?.orderMap;
    return kept && all.every((t) => kept[t]) ? kept : Object.fromEntries(all.map((t) => [t, t]));
  });
  const [cpuTrades, setCpuTrades] = useState(() => (CPU_TRADES[initialOpts?.cpuTrades] ? initialOpts.cpuTrades : "normal"));
  const [variance, setVariance] = useState(() => (VARIANCE[initialOpts?.variance] ? initialOpts.variance : DEFAULT_VARIANCE));
  // Their own choice for this class (back from Settings), else the class's default.
  const [expanded, setExpanded] = useState(() => (initialOpts?.year === year ? !!initialOpts.expanded : EXPANDED_YEARS.includes(year)));
  // More Options: the choices off their defaults, shown on the closed
  // section — open from the start when there are any (back from Settings).
  const changed = [
    orderMode !== "real" && (orderMode === "custom" ? "Custom order" : "Random order"),
    mode === "sim" && cpuTrades !== "normal" && `CPU trades ${CPU_TRADES[cpuTrades].label.toLowerCase()}`,
    variance !== DEFAULT_VARIANCE && `Variance: ${VARIANCE[variance].label}`,
    expanded !== EXPANDED_YEARS.includes(year) && (expanded ? "Expanded Board" : "Site Board"),
    board === "mine" && "My Board",
    chatter !== DEFAULT_CHATTER && `Chatter: ${CHATTER.find((c) => c.key === chatter)?.label}`,
  ].filter(Boolean);
  const [moreOpen, setMoreOpen] = useState(() => changed.length > 0);
  const boardNote = !signedIn
    ? "Sign in to draft off your own grades."
    : board === "community"
      ? "Every team drafts off the We-Draft community grades."
      : `Your round grades replace the community's and re-rank the board. Players you haven't graded use the community grade, and strengths and weaknesses are always the community's.${myCount != null ? ` You've graded ${myCount} of the ${year} class.` : ""}`;

  const sortedTeams = useMemo(() => [...NFL_TEAM_ABBRS].sort((a, b) => names.teamName(a).localeCompare(names.teamName(b))), [names]);
  const toggle = (t) => setTeams((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const startLabel = starting ? "Loading the board…" : mode === "mock" ? (teams.length ? "Start the Mock Draft" : "Watch the CPU Mock") : teams.length === 0 ? "Watch the CPU Draft" : teams.length === 1 ? `Start the ${names.nickname(teams[0])}' Draft` : `Start Draft · ${teams.length} Teams`;

  return (
    <div className="wd-sim-in">
      <SimHero isMobile={isMobile} year={year} />

      <div style={{ background: "#0e1626", border: "1px solid #1f2b42", borderRadius: 16, padding: isMobile ? 14 : 22, marginTop: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
          {MODES.map((m) => (
            <button key={m.key} onClick={() => switchMode(m.key)} aria-pressed={mode === m.key} style={{
              textAlign: "left", borderRadius: 12, padding: isMobile ? "10px 12px" : "12px 16px", cursor: "pointer", fontFamily: FONT,
              border: `2px solid ${mode === m.key ? GOLD : "#1f2b42"}`, background: mode === m.key ? "rgba(246,162,29,0.12)" : "#0b1322",
            }}>
              <span style={{ display: "block", color: mode === m.key ? GOLD : "#fff", fontWeight: 900, fontSize: isMobile ? 14 : 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>{m.label}</span>
              <span style={{ display: "block", color: "#8b9bb4", fontSize: 12, fontFamily: BODY, marginTop: 2 }}>{m.note}</span>
            </button>
          ))}
        </div>
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
          {mode === "sim" && (
            <Field label="Speed" note={SPEEDS[speed]?.note}>
              {Object.entries(SPEEDS).map(([k, v]) => <button key={k} onClick={() => setSpeed(k)} aria-pressed={speed === k} style={chipStyle(speed === k)}>{v.label}</button>)}
            </Field>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={labelStyle}>Pick Your Teams</span>
            <span style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>
              {teams.length > 3 ? introHeadline(teams, names.nickname, year).title : teams.length ? teams.map((t) => names.nickname(t)).join(", ") : "None — the CPU drafts for everyone"}
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

        <button onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} style={{
          display: "flex", alignItems: "center", gap: 10, width: "100%", marginTop: 18, padding: "10px 0 0", border: "none", borderTop: "1px solid #1f2b42",
          background: "none", cursor: "pointer", fontFamily: FONT, textAlign: "left",
        }}>
          <span style={labelStyle}>More Options</span>
          {!moreOpen && changed.length > 0 && <span style={{ color: GOLD, fontSize: 12, fontWeight: 800, fontFamily: BODY }}>{changed.join(" · ")}</span>}
          <span style={{ marginLeft: "auto", color: "#8b9bb4", fontSize: 14, transform: moreOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
        </button>
        {moreOpen && (
          <div>
            <div style={{ marginTop: 14 }}>
              <Field label="Draft Order" note={ORDER_MODES.find((m) => m.key === orderMode).note(year)}>
                {ORDER_MODES.map((m) => <button key={m.key} onClick={() => setOrderMode(m.key)} aria-pressed={orderMode === m.key} style={chipStyle(orderMode === m.key)}>{m.label}</button>)}
              </Field>
              {orderMode === "custom" && <OrderEditor order={setup.order} map={orderMap} onMap={setOrderMap} branding={setup.branding} names={names} isMobile={isMobile} />}
            </div>

            {/* Mock Draft mode: no CPU trades — the user makes every deal. */}
            {mode === "sim" && (
              <div style={{ marginTop: 18 }}>
                <Field label="CPU Trades" note={CPU_TRADES[cpuTrades].note}>
                  {Object.entries(CPU_TRADES).map(([k, v]) => <button key={k} onClick={() => setCpuTrades(k)} aria-pressed={cpuTrades === k} style={chipStyle(cpuTrades === k)}>{v.label}</button>)}
                </Field>
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <Field label="Player Pool" note={expanded ? "We-Draft.com's expanded board — more of the class than the main board." : "We-Draft.com's class board."}>
                <button onClick={() => setExpanded(false)} aria-pressed={!expanded} style={chipStyle(!expanded)}>Site Board</button>
                <button onClick={() => setExpanded(true)} aria-pressed={expanded} style={chipStyle(expanded)}>Expanded Board</button>
              </Field>
            </div>

            <div style={{ marginTop: 18 }}>
              <Field label="Board" note={boardNote}>
                <button onClick={() => setBoard("community")} aria-pressed={board === "community"} style={chipStyle(board === "community")}>Community</button>
                <button onClick={() => signedIn && setBoard("mine")} disabled={!signedIn} aria-pressed={board === "mine"} style={{ ...chipStyle(board === "mine"), opacity: signedIn ? 1 : 0.35, cursor: signedIn ? "pointer" : "not-allowed" }}>My Board</button>
              </Field>
            </div>

            {/* Both modes: CPU teams draft off their own boards in each. */}
            <div style={{ marginTop: 18 }}>
              <Field label="Board Variance" note={VARIANCE[variance].note}>
                {Object.entries(VARIANCE).map(([k, v]) => <button key={k} onClick={() => setVariance(k)} aria-pressed={variance === k} style={chipStyle(variance === k)}>{v.label}</button>)}
              </Field>
            </div>

            <div style={{ marginTop: 18 }}>
              <Field label="Desk Chatter" note={CHATTER.find((c) => c.key === chatter)?.note}>
                {CHATTER.map((c) => <button key={c.key} onClick={() => setChatter(c.key)} aria-pressed={chatter === c.key} style={chipStyle(chatter === c.key)}>{c.label}</button>)}
              </Field>
            </div>
          </div>
        )}

        <button onClick={() => onStart({ mode, teams, baseRounds: rounds, speed, chatter, board, expanded, orderMode, orderMap: orderMode === "custom" ? orderMap : null, cpuTrades: mode === "mock" ? "off" : cpuTrades, variance })} disabled={starting} style={{
          marginTop: 20, width: "100%", border: "none", borderRadius: 14, padding: isMobile ? "15px 18px" : "18px 22px", cursor: starting ? "wait" : "pointer",
          background: `linear-gradient(90deg, ${GOLD}, #ffcc66)`, color: "#fff", fontFamily: FONT, fontWeight: 900, fontSize: isMobile ? 16 : 20, letterSpacing: "0.08em",
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

const MODES = [
  { key: "sim", label: "Draft Sim", note: "The broadcast: on the clock, the desk, trades." },
  { key: "mock", label: "Mock Draft", note: "The sim with no pauses between picks — then post it as a mock." },
];

const ORDER_MODES = [
  { key: "real", label: "Real", note: (year) => `The real ${year} draft order, trades included.` },
  { key: "custom", label: "Custom", note: () => "Tap two teams to swap them — each takes the other's picks in every round, trades included." },
  { key: "random", label: "Randomize", note: () => "Every team takes over a random team's picks — a new order each run." },
];

// Custom order: all 32 teams, each in its own first-round slot as it
// stands under the map — a slot traded away still shows its team, with who
// owns the pick now. Tap one team, then another, to swap them.
function OrderEditor({ order, map, onMap, branding, names, isMobile }) {
  const [picked, setPicked] = useState(null);
  const relabeled = useMemo(() => relabelOrder(order, map), [order, map]);
  const firsts = relabeled.filter((p) => p.Round === 1).sort((a, b) => a.Pick - b.Pick);
  const tap = (t) => {
    if (!picked) { setPicked(t); return; }
    if (picked !== t) onMap(swapTeams(map, picked, t));
    setPicked(null);
  };
  const isReal = Object.entries(map).every(([k, v]) => k === v);
  const cols = `repeat(${isMobile ? 3 : 8}, minmax(0, 1fr))`;
  const slot = (p) => {
    const t = p.Team;
    const owner = p.Traded && p.Traded !== t ? p.Traded : null;
    const b = branding[t] || {};
    const on = picked === t;
    return (
      <button key={p.Pick} onClick={() => tap(t)} aria-pressed={on} title={`${names.teamName(t)}${owner ? ` — pick owned by the ${names.teamName(owner)}` : ""}`} style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 10, cursor: "pointer", minWidth: 0,
        border: `2px solid ${on ? GOLD : "#1f2b42"}`, background: on ? `linear-gradient(160deg, ${b.Color1 || BLUE}, #0e1626 130%)` : "#0e1626", fontFamily: FONT,
      }}>
        <span style={{ color: "#6f7f99", fontSize: 10, fontWeight: 900, width: 16, textAlign: "right", flexShrink: 0 }}>{p.Pick}</span>
        {b.LogoDark || b.Logo1 ? <img src={b.LogoDark || b.Logo1} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: 22, flexShrink: 0 }} />}
        <span style={{ minWidth: 0, textAlign: "left" }}>
          <span style={{ display: "block", color: on ? "#fff" : "#c9d4e5", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em" }}>{t}</span>
          {owner && <span style={{ display: "block", color: GOLD, fontSize: 9, fontWeight: 900, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>OWNED BY {owner}</span>}
        </span>
      </button>
    );
  };
  return (
    <div style={{ marginTop: 10, background: "#0b1322", border: "1px solid #1f2b42", borderRadius: 12, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#8b9bb4", fontSize: 12, fontFamily: BODY }}>{picked ? `Now tap the team to swap with the ${names.nickname(picked)}.` : "Round 1"}</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => { onMap(randomTeamMap(order, Math.floor(Math.random() * 2 ** 31))); setPicked(null); }} style={{ ...chipStyle(false), padding: "5px 12px", fontSize: 11 }}>Shuffle</button>
        <button onClick={() => { onMap(Object.fromEntries(Object.keys(map).map((t) => [t, t]))); setPicked(null); }} disabled={isReal} style={{ ...chipStyle(false), padding: "5px 12px", fontSize: 11, opacity: isReal ? 0.35 : 1 }}>Reset</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 5 }}>
        {firsts.map(slot)}
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
