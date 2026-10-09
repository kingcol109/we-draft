// src/hooks/useBroadcastState.js
//
// The broadcast renderer's one window onto We-Draft Live: everything the
// screen shows, as one normalized object, built from the same listeners
// and the same derived feed state the /live game view uses —
//
//   useLiveGame / useLiveStats   liveGames/{id} (+ recent plays) and box/live
//   useGameFeed                  reveal pacing, score held to the play
//                                shown, next snap, possession, takeovers
//   useInsightReveal             insight cards, a beat after their play
//
// so the broadcast and the site stay in step. Components under
// src/broadcast/ only render what this returns; none of them read data.
//
//   { phase, game, ready, situation, ballSide, currentPlay, recentPlays,
//     breakInfo, playerWatch, event, health, replay }
//
// Cloud-friendly by design: three Firestore listeners (four before kickoff
// counts the prospects read), one 15s clock while a game is on, one timer
// for the event on screen — nothing else ticks.
//
// opts.replay: { stepMs, from } — read a finished game back as if it were
// live (one play per stepMs), for testing and demos; { manual: true, from }
// releases a play only on replay.next() (the preview's Next play button).
// Same pipeline, no writes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { communityFor, gradeLabel } from "../utils/communityGrades";
import { useLiveGame, useLiveStats } from "./useLiveGame";
import { useGameFeed } from "./useGameFeed";
import { useInsightReveal, useDevInsights } from "./useInsightReveal";
import { computeGameStats } from "../utils/liveStats";
import {
  broadcastPhase, eventForPlay, eventForInsight, playView, recentPlayRows, situationView, playerWatchList, subtractStats, EVENT_MS,
} from "../utils/broadcast";

// Live data counts as stale when a game that's on shows no change at all
// for this long (TV timeouts and reviews run a few minutes; halftime is
// exempt). The screen keeps its last state and says so.
const STALE_MS = 6 * 60 * 1000;
const TICK_MS = 15 * 1000;
const MAX_QUEUED_EVENTS = 3;

// ── Replay ──
// The finished game's plays released one at a time, with a game doc that
// follows them (score, period, clock, possession from the newest play).
// Step 0 is pregame (kickoff a few minutes out). dev: the local insight
// preview (scripts/replayInsights.js --preview → public/dev-insights,
// development only) — insight cards and break summaries for a game played
// before the ingester made them.
const REPLAY_KICK_MS = 5 * 60 * 1000;
function useReplay(src, replay, dev) {
  const [step, setStep] = useState(replay?.from ?? 1);
  useEffect(() => {
    if (!replay || replay.manual) return undefined;
    const t = setInterval(() => setStep((s) => s + 1), replay.stepMs);
    return () => clearInterval(t);
  }, [replay?.stepMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = src.plays.length;
  const next = useCallback(() => setStep((s) => Math.min(s + 1, total || s + 1)), [total]);
  const state = useMemo(() => {
    if (!replay || !src.game) return null;
    const all = src.plays;
    const plays = all.slice(0, Math.min(step, all.length));
    const last = plays[plays.length - 1];
    const done = all.length > 0 && step >= all.length;
    const ids = new Set(plays.map((p) => p.id));
    const g = src.game;
    // Points per quarter so far, from the released plays (the stored game
    // has the final line score).
    const lines = { home: [], away: [] };
    let prev = { home: 0, away: 0 };
    for (let q = 1; q <= (last?.period || 0); q++) {
      const lastIn = [...plays].reverse().find((p) => (p.period || 0) <= q && p.homeScore != null);
      const at = lastIn ? { home: lastIn.homeScore, away: lastIn.awayScore } : prev;
      lines.home.push(at.home - prev.home);
      lines.away.push(at.away - prev.away);
      prev = at;
    }
    const insights = dev?.insights?.length ? dev.insights : g.insights || [];
    const breaks = dev?.breaks?.length ? dev.breaks : g.breaks || [];
    const game = {
      ...g,
      status: step === 0 ? "scheduled" : done ? "final" : "in_progress",
      ...(step === 0 ? { startDate: new Date(Date.now() + REPLAY_KICK_MS).toISOString(), startTimeTBD: false } : {}),
      period: last?.period ?? 1,
      clock: last?.clock ?? "15:00",
      possession: last?.offense ?? null,
      home: { ...g.home, points: last?.homeScore ?? 0, lineScores: lines.home },
      away: { ...g.away, points: last?.awayScore ?? 0, lineScores: lines.away },
      insights: insights.filter((i) => ids.has(i.sourcePlayId)),
      breaks: breaks.filter((b) => ids.has(b.markerPlayId)),
    };
    return { game, plays, stats: computeGameStats(plays), step, total: all.length };
  }, [src.game, src.plays, step, !!replay, dev]); // eslint-disable-line react-hooks/exhaustive-deps
  return state ? { ...state, next, manual: !!replay?.manual } : null;
}

// Before kickoff (or for a game doc without prospects): each school's
// We-Draft players in the active classes — the same read /live's preview
// makes (LivePage.js useSchoolProspects). Two queries, once.
const PRE_CLASSES = ["2027", "2028", "2029"];
const HIDDEN = [false, null, 0, "false", "no"];
function useSchoolProspects(game, enabled) {
  const home = game?.home?.school;
  const away = game?.away?.school;
  const [list, setList] = useState([]);
  useEffect(() => {
    if (!enabled || (!home && !away)) return undefined;
    let alive = true;
    const load = async (school, side) => {
      if (!school) return [];
      const snap = await getDocs(query(collection(db, "players"), where("School", "==", school)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => PRE_CLASSES.includes(String(p.Eligible)) && !HIDDEN.includes(p.Live) && p.Slug)
        .map((p) => ({ id: p.id, name: `${p.First || ""} ${p.Last || ""}`.trim(), slug: p.Slug, side, pos: p.Position || null, cls: String(p.Eligible) }));
    };
    // Their community grades too (the game doc's prospects carry theirs).
    Promise.all([load(home, "home"), load(away, "away")])
      .then(async ([h, a]) => {
        const all = [...h, ...a];
        const comm = await communityFor(all.map((p) => p.id)).catch(() => ({}));
        const graded = all.map((p) => ({ ...p, gradeAvg: comm[p.id]?.avg ?? null, grade: gradeLabel(comm[p.id]?.avg) }));
        if (alive) setList(graded);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [home, away, enabled]);
  return list;
}

export function useBroadcastState(gameId, { replay = null, testEvent = null } = {}) {
  const src = useLiveGame(gameId, { plays: replay ? "all" : "recent", box: false });
  const dev = useDevInsights(replay ? gameId : null);
  const rep = useReplay(src, replay, dev);
  const live = rep ? rep.game : src.game;
  const plays = rep ? rep.plays : src.plays;
  const started = live && live.status !== "scheduled";
  const { stats: liveStats } = useLiveStats(!rep && started ? gameId : null);
  const stats = rep ? rep.stats : liveStats;

  // Manual test replay: each click shows its play at once (no reveal pacing).
  const feed = useGameFeed(gameId, live, plays, { instant: !!rep?.manual });
  const { g, slot, listed, newestListed, snapNext, next, ballSide, prevPts, slotTk } = feed;

  // The stats as of the plays on screen: the stats doc minus the plays
  // still queued for reveal (utils/broadcast.js subtractStats) — so a
  // player's line on a play never includes plays the viewer hasn't seen.
  const shownStats = useMemo(() => {
    if (!stats || !feed.queued.length) return stats;
    const q = new Set(feed.queued);
    const pending = plays.filter((p) => q.has(p.id));
    return pending.length ? subtractStats(stats, computeGameStats(pending)) : stats;
  }, [stats, feed.queuedKey, plays]); // eslint-disable-line react-hooks/exhaustive-deps

  // One clock for the countdown, the stale check and the phase.
  const on = !!live && live.status !== "final";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, [on]);

  const phase = broadcastPhase({ ready: src.ready, game: g, next, now });

  // ── Data health ── the last time anything arrived (a snapshot always
  // brings a new object), and whether the browser is online at all.
  const lastDataAt = useRef(Date.now());
  useEffect(() => { lastDataAt.current = Date.now(); }, [src.game, src.plays, liveStats]);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  const quiet = now - lastDataAt.current;
  const health = {
    stale: !rep && (!online || (phase === "live" && quiet > STALE_MS)),
    offline: !online,
    lastDataAt: lastDataAt.current,
  };

  // ── Events ── one on screen at a time, a short queue behind it. Each id
  // fires once (a play, an insight, a status change), never for history.
  const [ev, setEv] = useState({ current: null, queue: [] });
  const fired = useRef(new Set());
  const push = (e) => {
    if (!e || fired.current.has(e.id)) return;
    fired.current.add(e.id);
    setEv((s) => (s.current
      ? { ...s, queue: [...s.queue, e].slice(-MAX_QUEUED_EVENTS) }
      : { current: { ...e, startedAt: Date.now() }, queue: s.queue }));
  };
  useEffect(() => { fired.current = new Set(); setEv({ current: null, queue: [] }); }, [gameId]);
  useEffect(() => {
    if (!ev.current) return undefined;
    const t = setTimeout(() => setEv((s) => {
      const [nextEv, ...rest] = s.queue;
      return { current: nextEv ? { ...nextEv, startedAt: Date.now() } : null, queue: rest };
    }), ev.current.durationMs || 5000);
    return () => clearTimeout(t);
  }, [ev.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // A play as it's revealed (the slot) — never one already there on open.
  const slotEvent = slot && g?.status === "in_progress" ? eventForPlay(slot, slotTk, prevPts) : null;
  useEffect(() => { if (slotEvent) push(slotEvent); }, [slot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Insight cards, a beat after their play drops into the list.
  const insightsByPlay = useInsightReveal(live?.insights, listed, gameId);
  useEffect(() => {
    for (const list of insightsByPlay.values()) {
      for (const { insight, fresh } of list) {
        if (!fresh) { fired.current.add(`ins-${insight.id}`); continue; }
        push(eventForInsight(insight));
      }
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Halftime and the final whistle — only when seen happening.
  const prevPhase = useRef(null);
  useEffect(() => {
    const was = prevPhase.current;
    if (was === "live" && phase === "halftime") push({ id: "halftime", type: "HALFTIME", side: null, durationMs: EVENT_MS.HALFTIME });
    if ((was === "live" || was === "halftime") && phase === "final") {
      const hp = g?.home?.points ?? 0;
      const ap = g?.away?.points ?? 0;
      push({ id: "final", type: "END_OF_GAME", side: hp === ap ? null : hp > ap ? "home" : "away", durationMs: EVENT_MS.END_OF_GAME });
    }
    if (phase !== "loading") prevPhase.current = phase;
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?event=TOUCHDOWN — fire one test graphic once the game is in.
  useEffect(() => {
    if (!testEvent || !g) return;
    push({ id: `test-${testEvent.type}`, durationMs: EVENT_MS[testEvent.type] || 5000, ...testEvent,
      player: testEvent.player || null, hold: null });
  }, [!!g]); // eslint-disable-line react-hooks/exhaustive-deps

  // The score on the scorebug: held at the score before a scoring play
  // while its graphic runs (or is about to — known in the same render the
  // play appears, so the new score never flashes up first).
  const pendingHold = slotEvent?.hold && !fired.current.has(slotEvent.id) ? slotEvent.hold : null;
  const hold = ev.current?.hold || pendingHold || null;
  const shownGame = useMemo(() => {
    if (!g || !hold) return g;
    return { ...g, home: { ...g.home, points: hold.home ?? g.home?.points }, away: { ...g.away, points: hold.away ?? g.away?.points } };
  }, [g, hold?.home, hold?.away]); // eslint-disable-line react-hooks/exhaustive-deps

  const preProspects = useSchoolProspects(g, !!g && !g.prospects?.length && phase !== "loading");
  const playerWatch = useMemo(() => playerWatchList(g, shownStats, preProspects), [g?.prospects, shownStats, preProspects, g?.home, g?.away]); // eslint-disable-line react-hooks/exhaustive-deps

  // A quarter break / halftime summary (server/live/breaks.js) when play
  // has stopped at one.
  const breakInfo = useMemo(() => {
    if (!g || !next?.brk || next.brk.kind === "timeout") return null;
    const top = feed.shown[0];
    const summary = top?.presentation?.type === "period" ? (g.breaks || []).find((b) => b.period === top.period) || null : null;
    return { label: next.brk.label, detail: next.brk.detail || "", summary };
  }, [g, next, feed.shown]);
  const recentPlays = useMemo(() => recentPlayRows(newestListed, g, shownStats), [newestListed, g, shownStats]);
  const currentPlay = useMemo(() => playView(slot, g, shownStats), [slot, g, shownStats]);

  return {
    phase,
    ready: src.ready,
    game: shownGame,
    now,
    situation: situationView(snapNext, g),
    timeout: next?.brk?.kind === "timeout" ? next.brk : null,
    ballSide,
    currentPlay,
    recentPlays,
    breakInfo,
    halftime: (g?.breaks || []).find((b) => b.key === "half") || null,
    stats: shownStats,
    playerWatch,
    event: ev.current,
    health,
    replay: rep ? { step: Math.min(rep.step, rep.total), total: rep.total, manual: rep.manual, next: rep.next } : null,
  };
}
