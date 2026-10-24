// src/components/draftSim/useDraftSim.js
//
// Runs one Draft Sim for pages/DraftSim.jsx: the engine state
// (utils/draftSim/engine.js), the broadcast phase, the analyst feed and the
// clock. Phases:
//   intro    "Drafting as the Buccaneers" — waits for start()
//   clock    a CPU team is on the clock (broadcast speed)
//   trade    a CPU trade up, announced on the whole stage before the pick
//   pickIn   "the pick is in" — the CPU has picked, not shown yet
//   reveal   the pick (or trade) on screen
//   simming  Instant / Sim to My Pick: CPU picks one after another, fast,
//            the stage just reads "Simming"
//   user     one of the user's teams is up — waits for draft() / trades
//   done     the board's filled (or ran out of prospects)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initSim, stepCpu, makePick, acceptOffer, withOffers, isUserOnClock, rngNext, teamHaul, applyProposal,
} from "../../utils/draftSim/engine";
import { reactTo, openingPosts, wrapPost, DEFAULT_CHATTER } from "../../utils/draftSim/analysts";
import { teamNamer, loadBestGame } from "../../utils/draftSim/data";

// Timing (ms). Normal runs a 7-second clock, Broadcast a 15-second one;
// Normal holds each pick card 8 seconds, a trade announcement 5.
// Instant has none — it sims a pick every SIM_STEP_MS.
const BROADCAST = { clock: 15000, trade: 7000, pickIn: 5000, reveal: 10000 };
export const SPEEDS = {
  normal: { label: "Normal", note: "5 seconds on the clock — skip ahead any time.", clock: 5000, trade: 5000, pickIn: 2500, reveal: 8000 },
  broadcast: { label: "Broadcast", note: "15 seconds on the clock, with the full pick reveal — skip ahead any time.", ...BROADCAST },
  instant: { label: "Instant", note: "Sims straight through to your next pick." },
};
export const DEFAULT_SPEED = "normal";
const SIM_STEP_MS = 140;
const FEED_MAX = 300;

let postId = 0;

// onUserPick(event): each pick the user makes (Statistics — utils/draftSim/stats.js).
export default function useDraftSim(data, { userTeams, rounds, speed: initialSpeed = DEFAULT_SPEED, chatter = DEFAULT_CHATTER, seed, onUserPick }) {
  const [sim, setSim] = useState(() => initSim({ order: data.order, futureOrder: data.futureOrder, futureYear: data.futureYear, board: data.board, chart: data.chart, staff: data.staff, needs: data.needs, userTeams, rounds, seed }));
  const [phase, setPhase] = useState("intro");
  const [reveal, setReveal] = useState(null);
  const [feed, setFeed] = useState([]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[initialSpeed] ? initialSpeed : DEFAULT_SPEED);
  const [skipToUser, setSkipToUser] = useState(false);
  // The CPU pick made at the end of the clock, held through "the pick is in".
  const pending = useRef(null);
  const timers = useRef([]);
  const feedSeed = useRef((seed ^ 0x9e3779b9) | 0);

  // "broadcast" here: a timed speed (Normal or Broadcast), not simming.
  const broadcast = speed !== "instant" && !skipToUser;
  const timing = speed === "instant" ? SPEEDS.normal : SPEEDS[speed];

  const ctx = useMemo(() => ({
    ...teamNamer(data.branding),
    staff: data.staff,
    season: data.season,
    year: data.year,
    chatter,
    memory: {},
    rand: () => { const r = rngNext(feedSeed.current); feedSeed.current = r.seed; return r.value; },
    // Drafted players' standout CFBD games ({ [id]: { line, opp } }), for
    // Isaac — filled by loadGames below.
    games: {},
  }), [data, chatter]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Posts land on their analyst's delay (at once while simming), newest first.
  const publish = useCallback((posts, meta = {}, now = false) => {
    posts.forEach((p) => {
      const add = () => setFeed((f) => [{ id: ++postId, ...p, ...meta, at: Date.now() }, ...f].slice(0, FEED_MAX));
      if (now || !p.delay) add();
      else timers.current.push(setTimeout(add, p.delay));
    });
  }, []);

  const announce = useCallback((events, now = false) => {
    events.forEach((e) => publish(reactTo(e, ctx), {
      overall: e.pick?.overall, round: e.pick?.round, kind: e.type,
      teams: e.type === "trade" ? [e.to, e.from] : [e.team], userInvolved: e.isUser || e.userInvolved,
    }, now));
  }, [ctx, publish]);

  // Opening posts, once.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    publish(openingPosts({ year: data.year, userTeams, ctx }));
  }, [publish, data.year, userTeams, ctx]);

  // Each drafted player's standout game, into ctx.games. Resolves when
  // they're in or after `wait` ms, whichever's first.
  const loadGames = useCallback((events, wait) => {
    const loads = events.filter((e) => e.type === "pick").map((e) => loadBestGame(e.prospect.id, data.season)
      .then((g) => { if (g) ctx.games[e.prospect.id] = g; })
      .catch(() => {}));
    return Promise.race([Promise.all(loads), new Promise((r) => { setTimeout(r, wait); })]);
  }, [ctx, data.season]);

  // The desk posts once the game lookup's had a moment (a CPU pick's
  // started back at the end of the clock, so it's usually in already).
  const show = useCallback((state, events) => {
    setSim(state);
    loadGames(events, 1200).then(() => announce(events));
    setReveal({ events, at: Date.now() });
    setPhase("reveal");
  }, [announce, loadGames]);

  const applyPending = useCallback(() => {
    const r = pending.current;
    pending.current = null;
    if (r) show(r.state, r.events);
    else setPhase("clock");
  }, [show]);

  // The clock.
  useEffect(() => {
    if (paused || phase === "intro" || phase === "user" || phase === "done") return undefined;
    const after = (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); };
    if (phase === "trade") return after(timing.trade, () => setPhase("pickIn"));
    if (phase === "pickIn") return after(timing.pickIn, applyPending);
    if (phase === "reveal") return after(timing.reveal, () => setPhase("clock"));

    // clock / simming
    if (sim.done) { setPhase("done"); return undefined; }
    if (isUserOnClock(sim)) {
      setSkipToUser(false);
      setSim((s) => withOffers(s));
      setPhase("user");
      return undefined;
    }
    if (phase === "clock" && !broadcast) { setPhase("simming"); return undefined; }
    if (phase === "simming" && broadcast) { setPhase("clock"); return undefined; }
    if (phase === "simming") {
      return after(SIM_STEP_MS, () => {
        const r = stepCpu(sim);
        setSim(r.state);
        announce(r.events, true);
      });
    }
    return after(timing.clock, () => {
      pending.current = stepCpu(sim);
      loadGames(pending.current.events, 0);
      // A trade up gets its own beat on the stage before the pick is in.
      setPhase(pending.current.events.some((e) => e.type === "trade") ? "trade" : "pickIn");
    });
  }, [sim, phase, paused, broadcast, timing, announce, applyPending, loadGames]);

  // Wrap-up posts for the user's teams.
  const wrapped = useRef(false);
  useEffect(() => {
    if (phase !== "done" || wrapped.current) return;
    wrapped.current = true;
    sim.userTeams.forEach((t) => publish([wrapPost(teamHaul(sim, t), ctx)]));
  }, [phase, sim, ctx, publish]);

  // The user's own picks and trades always get the pick card for its full
  // reveal, even on Instant — the sim picks back up after.
  const draft = useCallback((prospectId) => {
    if (!isUserOnClock(sim)) return;
    const { state, event } = makePick(sim, prospectId);
    if (event) { show(state, [event]); onUserPick?.(event); }
  }, [sim, show, onUserPick]);

  const takeOffer = useCallback((offer) => {
    const { state, event } = acceptOffer(sim, offer);
    if (event) show(state, [event]);
  }, [sim, show]);

  const declineOffer = useCallback((offer) => {
    setSim((s) => ({ ...s, offers: s.offers.filter((o) => o !== offer) }));
  }, []);

  // A user-proposed trade (Trades tab). A CPU pick already "in" was made on
  // the old order, so it's redone after the swap. → the verdict.
  const proposeTrade = useCallback((proposal) => {
    const { state, event, verdict } = applyProposal(sim, proposal);
    if (event) {
      pending.current = null;
      setSim(state);
      announce([event]);
      if (phase === "pickIn" || phase === "trade") setPhase("clock");
    }
    return verdict;
  }, [sim, phase, announce]);

  // Broadcast "Skip": cut the wait — the pick on the clock is made and shown
  // now; from the pick, straight to the next team.
  const skip = useCallback(() => {
    if (phase === "intro" || phase === "reveal") setPhase("clock");
    else if (phase === "trade") setPhase("pickIn");
    else if (phase === "pickIn") applyPending();
    else if (phase === "clock" && !sim.done && !isUserOnClock(sim)) {
      const r = stepCpu(sim);
      show(r.state, r.events);
    }
  }, [phase, sim, applyPending, show]);

  const userPicksLeft = sim.picks.slice(sim.idx).some((p) => sim.userTeams.includes(p.owner));

  return {
    sim, phase, reveal, feed, paused, speed, timing, ctx, userPicksLeft, skipToUser, pendingEvents: pending.current?.events || null,
    setPaused, setSpeed, draft, takeOffer, declineOffer, skip, proposeTrade,
    start: () => { if (phase === "intro") setPhase("clock"); },
    simToMyPick: () => { if (userPicksLeft && phase !== "intro") { pending.current = null; setSkipToUser(true); setPhase("simming"); } },
  };
}
