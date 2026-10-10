// src/hooks/useGameFeed.js
//
// What a live game looks like "as of the plays on screen" — shared by
// /live's game view (LivePage.js GameView) and the broadcast renderer
// (/broadcast/:slug, hooks/useBroadcastState.js), so the two always show
// the same score, clock, down & distance and possession at the same pace.
//
// Everything follows the reveal (hooks/usePlayReveal.js), not the raw
// game doc: the game doc often gets a new score before its play lands, and
// the score must never change ahead of the play that caused it.
//
// gLive: the game (liveGames doc, or a slate / schedule stand-in).
// plays: the game's plays in game order (useLiveGame).
// Returns
//   listed, slot, justListed, queued   usePlayReveal's output (queuedKey: queued joined)
//   calling       the play being revealed while only its call is on (PASS /
//                 RUSH and the player — utils/playCall.js); slot stays null
//                 until its result, so the score, takeovers and broadcast
//                 events all wait for the result. It counts as queued.
//   preKick       the game hasn't had a snap on screen yet but its kickoff
//                 time has come (still "scheduled" past kickoff, or live with
//                 no play shown): g reads 1st 15:00, 0–0
//   kickoffAt     when the first play arrived while watching (the kickoff
//                 animation, KICKOFF_MS — usePlayReveal.js), else null
//   g             gLive with the score (and, while plays are queued, the
//                 period and clock) of the newest play shown
//   newestListed  listed plays, newest first
//   shown         [slot, ...newestListed] — everything on screen, newest first
//   stalled       no new play and no clock movement for STALL_MS (a stoppage)
//   next          the upcoming snap (utils/live.js nextSituation), null when not live
//   snapNext      next when it's a real snap (not a quarter break / halftime)
//   ballSide      who has the ball as of the plays shown — nobody at a break or after a score
//   prevPts       the score before the slot's play
//   slotTk        the takeover the slot's play calls for (HeaderTakeover.js), or null
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayReveal, HOLD_MS, KICKOFF_MS } from "./usePlayReveal";
import { nextSituation } from "../utils/live";
import { takeoverForPlay, checkScorer } from "../components/HeaderTakeover";

export const STALL_MS = 100 * 1000;

const NO_PLAYS = [];

// opts.instant: no queue — the newest play is the slot the moment it
// arrives (the broadcast's manual test replay, one play per click), held
// HOLD_MS like a paced play, then the slot goes back to "next play". A
// quarter break or timeout goes straight to the list, so the break /
// timeout card shows instead.
export { KICKOFF_MS };

// opts.playsReady: the play list has loaded (useLiveGame) — an empty one
// means the viewer is here from the start.
export function useGameFeed(gameId, gLive, plays, { instant = false, playsReady = false } = {}) {
  // New plays are revealed through the top slot one at a time (each held
  // ~18s before it drops into the list) — see hooks/usePlayReveal.js.
  const paced = usePlayReveal(instant ? NO_PLAYS : plays, gameId, { loaded: playsReady });
  const newestId = instant ? plays[plays.length - 1]?.id ?? null : null;
  const [heldOut, setHeldOut] = useState(null); // the instant play whose hold is up
  useEffect(() => {
    if (!newestId) return undefined;
    const t = setTimeout(() => setHeldOut(newestId), HOLD_MS);
    return () => clearTimeout(t);
  }, [newestId]);
  const { listed, slot, justListed, queued, calling } = useMemo(() => {
    if (!instant) {
      // While only its call is on, the play isn't "shown" yet.
      if (paced.slot && paced.stage === "call") return { ...paced, slot: null, calling: paced.slot, queued: [paced.slot.id, ...paced.queued] };
      return { ...paced, calling: null };
    }
    const last = plays[plays.length - 1];
    const slotted = last && last.id !== heldOut && !["period", "timeout"].includes(last.presentation?.type) ? last : null;
    return {
      listed: slotted ? plays.slice(0, -1) : plays,
      slot: slotted,
      justListed: slotted ? plays[plays.length - 2]?.id ?? null : null,
      queued: NO_PLAYS,
      calling: null,
    };
  }, [instant, paced, plays, heldOut]);
  const queuedKey = queued.join(",");

  // Kickoff time has come but nothing has been snapped on screen yet: the
  // board reads 1st 15:00, 0–0 ("Kickoff shortly"). A scheduled game flips
  // at its kickoff time.
  const kickMs = gLive?.status === "scheduled" && !gLive.startTimeTBD ? Date.parse(gLive.startDate || "") : NaN;
  const [, setKickTick] = useState(0);
  useEffect(() => {
    const ms = kickMs - Date.now();
    if (!(ms > 0) || ms > 2 ** 31 - 1) return undefined;
    const t = setTimeout(() => setKickTick((x) => x + 1), ms + 50);
    return () => clearTimeout(t);
  }, [kickMs]);
  const preKick = (Number.isFinite(kickMs) && Date.now() >= kickMs)
    || (gLive?.status === "in_progress" && (playsReady || instant) && !slot && !listed.length);

  // A live game's score is always the score after the last play revealed.
  // While plays are queued the quarter and clock follow the reveal too.
  const g = useMemo(() => {
    if (gLive && preKick) {
      return { ...gLive, period: 1, clock: "15:00", home: { ...gLive.home, points: 0 }, away: { ...gLive.away, points: 0 } };
    }
    if (!gLive || gLive.status !== "in_progress") return gLive;
    const shownNewest = slot || listed[listed.length - 1];
    if (!shownNewest || shownNewest.homeScore == null) return gLive;
    return {
      ...gLive,
      home: { ...gLive.home, points: shownNewest.homeScore },
      away: { ...gLive.away, points: shownNewest.awayScore },
      ...(queued.length ? { period: shownNewest.period ?? gLive.period, clock: shownNewest.clock ?? gLive.clock } : {}),
    };
  }, [gLive, queuedKey, slot, listed, preKick]); // eslint-disable-line react-hooks/exhaustive-deps
  const newestListed = useMemo(() => [...listed].reverse(), [listed]);

  // Stoppage watch: no new play revealed and the game clock not moving for
  // STALL_MS → play has stopped (a TV timeout, an injury, a review) and the
  // next-play card reads "TIMEOUT" instead of waiting on a snap.
  const newestShownId = (slot || newestListed[0])?.id ?? null;
  const stall = useRef({ playId: null, playAt: 0, clock: null, clockAt: 0 });
  const [tick, setTick] = useState(() => Date.now());
  const liveNow = gLive?.status === "in_progress";
  useEffect(() => {
    if (!liveNow) return undefined;
    const id = setInterval(() => setTick(Date.now()), 5000);
    return () => clearInterval(id);
  }, [liveNow]);
  {
    const st = stall.current;
    const t = Date.now();
    if (st.playId !== newestShownId) { st.playId = newestShownId; st.playAt = t; }
    const clk = gLive ? `${gLive.period}|${gLive.clock}` : null;
    if (st.clock !== clk) { st.clock = clk; st.clockAt = t; }
  }
  const stalled = liveNow && !queued.length && !slot
    && tick - stall.current.playAt > STALL_MS && tick - stall.current.clockAt > STALL_MS;

  // The score before the play in the slot: the newest play under it (else
  // the last score shown).
  const lastPoints = useRef({ away: null, home: null });
  const prevPts = useMemo(() => {
    const p = [...listed].reverse().find((x) => x.homeScore != null);
    return p ? { home: p.homeScore, away: p.awayScore } : { ...lastPoints.current };
  }, [listed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { lastPoints.current = { away: g?.away?.points ?? null, home: g?.home?.points ?? null }; });

  // The takeover the slot's play calls for — known in the same render the
  // play appears, so a held score never flashes ahead of it.
  const slotTk = slot && gLive?.status === "in_progress" ? checkScorer(takeoverForPlay(slot), slot, prevPts) : null;

  // The upcoming snap, inferred from the plays on screen — so it always
  // follows from what the viewer just saw.
  const isLive = g?.status === "in_progress";
  const shown = slot ? [slot, ...newestListed] : newestListed;
  const next = isLive && !preKick ? nextSituation(shown, g, { stalled }) : null;
  const snapNext = next && (!next.brk || next.brk.kind === "timeout") ? next : null;
  const ballSide = !isLive || preKick ? null : !shown.length ? g.possession : snapNext?.offense || null;

  return { listed, slot, calling, justListed, queued, queuedKey, g, newestListed, shown, stalled, next, snapNext, ballSide, prevPts, slotTk, preKick, kickoffAt: instant ? null : paced.kickoffAt };
}
