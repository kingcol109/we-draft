// src/hooks/usePlayReveal.js
//
// Paces how new plays appear in a live game's feed (/live GameView), to
// follow the rhythm of the game rather than the rhythm of the data. The top
// slot turns into each new play as it arrives and holds it for HOLD_MS,
// then the play drops into the list and the slot goes back to "next play".
// Plays usually land in batches (the ingester fetches every 30-60s): the
// rest wait in a queue, and the "next play" card shows for GAP_MS between
// them — like the real gap between snaps — before the next one is revealed.
// That trades a little up-to-the-second freshness for a natural flow; a big
// backlog (e.g. after a stall) only plays out the newest MAX_QUEUE, the
// rest drop straight into the list so the feed never falls far behind.
//
// Each play is revealed in two beats: its call first (stage "call": PASS /
// RUSH and the player, utils/playCall.js) for CALL_MS, then its result
// (stage "result": yards, touchdown …), held HOLD_MS. A play with no call
// (a flag, a timeout, a quarter break) goes straight to its result.
//
// From the start: a viewer who was here before the first play (the play
// list loaded empty — opts.loaded) sees every play as it comes, the first
// batch included, and the first one waits KICKOFF_MS behind the kickoff
// animation (kickoffAt). Opened mid-game, the plays already there are
// history and never animate.
//
// plays: the game's plays in game order (oldest first).
// Returns { listed, slot, stage, justListed, queued, kickoffAt }:
//   listed      plays to show in the list (everything not queued / in the slot)
//   slot        the play currently held in the top slot, or null
//   stage       "call" | "result" — which beat of the slot's play is on
//   justListed  id of the play that just dropped from the slot (for its slide-in)
//   queued      ids still waiting to be revealed (the rest of the page holds
//               these back too — Feed entries, the header score — so
//               nothing gets ahead of the game feed)
//   kickoffAt   when the game's first play arrived while watching (the
//               kickoff animation's start), else null
import { useEffect, useMemo, useRef, useState } from "react";
import { playCall } from "../utils/playCall";

export const HOLD_MS = 18 * 1000;
export const CALL_MS = 2200;
export const KICKOFF_MS = 4200;
const GAP_MS = 5 * 1000;
const MAX_QUEUE = 4;

const empty = () => ({ init: false, fromStart: false, known: new Set(), queue: [], slot: null, slotAt: 0, stage: "result", gapUntil: 0, justListed: null, kickoffAt: null });

export function usePlayReveal(plays, resetKey, { loaded = false } = {}) {
  const [s, setS] = useState(empty);
  const byId = useRef(new Map());
  byId.current = new Map(plays.map((p) => [p.id, p]));

  useEffect(() => { setS(empty()); }, [resetKey]);

  // New plays → queue. "New" = later in the game than anything already
  // known, so loading older history (jump to a play) never animates.
  useEffect(() => {
    setS((prev) => {
      if (!prev.init) {
        if (plays.length) return { ...prev, init: true, known: new Set(plays.map((p) => p.id)) };
        // Loaded and empty: the game hasn't had a play yet — watch from the start.
        return loaded ? { ...prev, init: true, fromStart: true } : prev;
      }
      if (!plays.length) return prev;
      let lastKnown = -1;
      plays.forEach((p, i) => { if (prev.known.has(p.id)) lastKnown = i; });
      const fresh = plays.slice(lastKnown + 1).filter((p) => !prev.known.has(p.id)).map((p) => p.id);
      const unseenOlder = plays.slice(0, lastKnown + 1).filter((p) => !prev.known.has(p.id));
      if (!fresh.length && !unseenOlder.length) return prev;
      const known = new Set(prev.known);
      plays.forEach((p) => known.add(p.id));
      let queue = [...prev.queue, ...fresh];
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      // The game's first plays, seen live: the kickoff animation goes first.
      const kick = prev.fromStart && !prev.kickoffAt && !prev.known.size && fresh.length;
      const now = Date.now();
      return { ...prev, known, queue, ...(kick ? { kickoffAt: now, gapUntil: now + KICKOFF_MS } : {}) };
    });
  }, [plays, loaded]);

  // Advance: call → result (held) → (gap with "next play" if more are waiting) → next.
  useEffect(() => {
    const t = setInterval(() => {
      setS((prev) => {
        const now = Date.now();
        if (prev.slot) {
          if (prev.stage === "call") {
            return now - prev.slotAt < CALL_MS ? prev : { ...prev, stage: "result", slotAt: now };
          }
          if (now - prev.slotAt < HOLD_MS) return prev;
          // Drop the held play into the list; if more are queued, show the
          // next-play card for GAP_MS before revealing the next one.
          return { ...prev, slot: null, slotAt: 0, gapUntil: prev.queue.length ? now + GAP_MS : 0, justListed: prev.slot };
        }
        if (prev.queue.length && now >= prev.gapUntil) {
          const [next, ...rest] = prev.queue;
          const stage = playCall(byId.current.get(next)) ? "call" : "result";
          return { ...prev, slot: next, slotAt: now, stage, queue: rest, gapUntil: 0 };
        }
        return prev;
      });
    }, 250);
    return () => clearInterval(t);
  }, []);

  return useMemo(() => {
    const hidden = new Set([...s.queue, ...(s.slot ? [s.slot] : [])]);
    // A play that just arrived isn't queued until the effect above runs —
    // keep it hidden for that render too, so its score (and the header's)
    // never shows before its reveal.
    const unseen = s.init ? plays.filter((p) => !s.known.has(p.id)).map((p) => p.id) : [];
    unseen.forEach((id) => hidden.add(id));
    return {
      listed: plays.filter((p) => !hidden.has(p.id)),
      slot: s.slot ? plays.find((p) => p.id === s.slot) || null : null,
      stage: s.stage,
      justListed: s.justListed,
      queued: [...s.queue, ...unseen],
      kickoffAt: s.kickoffAt,
    };
  }, [plays, s]);
}
