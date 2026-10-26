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
//   simming  Instant / Skip to My Pick: CPU picks one after another, fast,
//            the stage just reads "Simming"
//   user     one of the user's teams is up — waits for draft() / trades
//   done     the board's filled (or ran out of prospects)
//
// quick (Mock Draft mode): the same sim with no pause between picks — CPU
// teams sim straight through (Instant) and the user's own picks and trades
// skip the reveal hold, straight on to the next pick. The desk still posts.
// simPick() / simRound(): the CPU makes the user's pick on the clock, or
// every pick left in the round (theirs too); simToEnd(): every pick left in
// the draft. undo(): back one of the
// user's picks (or trades) — and the CPU picks after it — as far back as
// the first; the desk's posts for those picks come down too.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  initSim, stepCpu, makePick, acceptOffer, withOffers, isUserOnClock, rngNext, teamHaul, applyProposal, chooseCpuPick, currentPick,
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
export default function useDraftSim(data, { userTeams, rounds, speed: initialSpeed = DEFAULT_SPEED, chatter = DEFAULT_CHATTER, seed, cpuTrades, variance, quick = false, onUserPick }) {
  const [sim, setSim] = useState(() => initSim({ order: data.order, futureOrder: data.futureOrder, futureYear: data.futureYear, board: data.board, chart: data.chart, staff: data.staff, needs: data.needs, userTeams, rounds, seed, cpuTrades, variance }));
  const [phase, setPhase] = useState("intro");
  const [reveal, setReveal] = useState(null);
  const [feed, setFeed] = useState([]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(quick ? "instant" : SPEEDS[initialSpeed] ? initialSpeed : DEFAULT_SPEED);
  // The sim before each of the user's picks and trades, for undo().
  const history = useRef([]);
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
    history: data.history,
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
  // Events already posted (a CPU trade up, at its announcement) aren't again.
  // Quick, for the user's own pick or trade: no card to sit through.
  const show = useCallback((state, events, posted = [], hold = true) => {
    setSim(state);
    loadGames(events, 1200).then(() => announce(events.filter((e) => !posted.includes(e))));
    if (!hold) { setPhase("clock"); return; }
    setReveal({ events, at: Date.now() });
    setPhase("reveal");
  }, [announce, loadGames]);

  const applyPending = useCallback(() => {
    const r = pending.current;
    pending.current = null;
    if (r) show(r.state, r.events, r.posted);
    else setPhase("clock");
  }, [show]);

  // The clock.
  useEffect(() => {
    if (phase === "intro" || phase === "user" || phase === "done") return undefined;
    const toUser = () => {
      setSkipToUser(false);
      // Mock Draft mode: no CPU teams calling.
      if (!quick) setSim((s) => withOffers(s));
      setPhase("user");
    };
    // Paused, nothing runs — but a pick that's the user's (say, just traded
    // up for) is still theirs to make.
    if (paused) {
      if (["clock", "reveal"].includes(phase) && isUserOnClock(sim)) toUser();
      return undefined;
    }
    const after = (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); };
    if (phase === "trade") return after(timing.trade, () => setPhase("pickIn"));
    if (phase === "pickIn") return after(timing.pickIn, applyPending);
    if (phase === "reveal") return after(timing.reveal, () => setPhase("clock"));

    // clock / simming
    if (sim.done) { setPhase("done"); return undefined; }
    if (isUserOnClock(sim)) { toUser(); return undefined; }
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
      // A trade up gets its own beat on the stage before the pick is in,
      // and its posts go up then — not held for the pick.
      const trades = pending.current.events.filter((e) => e.type === "trade");
      if (trades.length) { announce(trades); pending.current.posted = trades; }
      setPhase(trades.length ? "trade" : "pickIn");
    });
  }, [sim, phase, paused, broadcast, timing, announce, applyPending, loadGames, quick]);

  // Wrap-up posts for the user's teams.
  const wrapped = useRef(false);
  useEffect(() => {
    // Mock Draft mode: no grades, so no grade wrap-up.
    if (phase !== "done" || wrapped.current || quick) return;
    wrapped.current = true;
    sim.userTeams.forEach((t) => publish([wrapPost(teamHaul(sim, t), ctx)]));
  }, [phase, sim, ctx, publish, quick]);

  // The user's own picks and trades always get the pick card for its full
  // reveal, even on Instant — the sim picks back up after.
  const draft = useCallback((prospectId) => {
    if (!isUserOnClock(sim)) return;
    const { state, event } = makePick(sim, prospectId);
    if (event) { history.current.push(sim); show(state, [event], [], !quick); onUserPick?.(event); }
  }, [sim, show, onUserPick, quick]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    pending.current = null;
    const cut = currentPick(prev)?.overall ?? Infinity;
    setFeed((f) => f.filter((p) => p.overall == null || p.overall < cut));
    setReveal(null);
    setSkipToUser(false);
    setSim(prev);
    setPhase(isUserOnClock(prev) ? "user" : "clock");
  }, []);

  // The CPU's pick for one of the user's teams → { state, event } or null.
  const cpuForUser = (s) => {
    const choice = chooseCpuPick(s);
    return choice?.prospect ? makePick(s, choice.prospect.id, choice.seed) : null;
  };
  const simPick = useCallback(() => {
    if (!isUserOnClock(sim)) return;
    const r = cpuForUser(sim);
    if (r?.event) { history.current.push(sim); show(r.state, [r.event], [], !quick); }
  }, [sim, show, quick]);
  // The CPU makes every pick while `more(state)` holds — the user's too.
  const simThrough = useCallback((more) => {
    pending.current = null;
    let s = sim;
    const events = [];
    while (!s.done && more(s)) {
      // Each of the user's picks undoes on its own.
      if (isUserOnClock(s)) history.current.push(s);
      const r = isUserOnClock(s) ? cpuForUser(s) : stepCpu(s);
      if (!r) break;
      s = r.state;
      events.push(...(r.events || (r.event ? [r.event] : [])));
    }
    setSim(s);
    announce(events, true);
    setSkipToUser(false);
    setReveal(null);
    setPhase(s.done ? "done" : "clock");
  }, [sim, announce]);
  const simRound = useCallback(() => {
    const round = currentPick(sim)?.round;
    if (round != null) simThrough((s) => currentPick(s)?.round === round);
  }, [sim, simThrough]);
  // Sim to End: the rest of the draft, every pick, at once.
  const simToEnd = useCallback(() => {
    if (phase !== "intro") simThrough(() => true);
  }, [phase, simThrough]);

  const takeOffer = useCallback((offer) => {
    const { state, event } = acceptOffer(sim, offer);
    if (event) { history.current.push(sim); show(state, [event], [], !quick); }
  }, [sim, show, quick]);

  const declineOffer = useCallback((offer) => {
    setSim((s) => ({ ...s, offers: s.offers.filter((o) => o !== offer) }));
  }, []);

  // A user-proposed trade (Trades tab). A CPU pick already "in" was made on
  // the old order, so it's redone after the swap. → the verdict.
  const proposeTrade = useCallback((proposal) => {
    const { state, event, verdict } = applyProposal(sim, proposal, { force: quick });
    if (event) {
      history.current.push(sim);
      pending.current = null;
      setSim(state);
      announce([event]);
      if (phase === "pickIn" || phase === "trade") setPhase("clock");
    }
    return verdict;
  }, [sim, phase, announce, quick]);

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
  // A pick of the user's after the one on the clock now.
  const userPicksAfter = sim.picks.slice(sim.idx + 1).some((p) => sim.userTeams.includes(p.owner));

  // Skip to My Pick. On the user's own clock: the CPU makes this pick for
  // them, then sims to the one after.
  const simToMyPick = useCallback(() => {
    if (phase === "intro") return;
    if (phase === "user") {
      if (!userPicksAfter) return;
      const r = cpuForUser(sim);
      if (!r?.event) return;
      history.current.push(sim);
      setSim(r.state);
      announce([r.event], true);
    } else if (!userPicksLeft) return;
    pending.current = null;
    setSkipToUser(true);
    setPhase("simming");
  }, [phase, sim, userPicksLeft, userPicksAfter, announce]);

  return {
    sim, phase, reveal, feed, paused, speed, timing, ctx, userPicksLeft, userPicksAfter, skipToUser, pendingEvents: pending.current?.events || null,
    setPaused, setSpeed, draft, takeOffer, declineOffer, skip, proposeTrade, simPick, simRound, simToEnd, undo, canUndo: history.current.length > 0, quick,
    start: () => { if (phase === "intro") setPhase("clock"); },
    simToMyPick,
  };
}
