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
// plays: the game's plays in game order (oldest first).
// Returns { listed, slot, justListed }:
//   listed      plays to show in the list (everything not queued / in the slot)
//   slot        the play currently held in the top slot, or null
//   justListed  id of the play that just dropped from the slot (for its slide-in)
//   queued      ids still waiting to be revealed (the rest of the page holds
//               these back too — Feed entries, the header score — so
//               nothing gets ahead of the game feed)
import { useEffect, useMemo, useState } from "react";

const HOLD_MS = 18 * 1000;
const GAP_MS = 5 * 1000;
const MAX_QUEUE = 3;

const empty = () => ({ init: false, known: new Set(), queue: [], slot: null, slotAt: 0, gapUntil: 0, justListed: null });

export function usePlayReveal(plays, resetKey) {
  const [s, setS] = useState(empty);

  useEffect(() => { setS(empty()); }, [resetKey]);

  // New plays → queue. "New" = later in the game than anything already
  // known, so loading older history (jump to a play) never animates.
  useEffect(() => {
    if (!plays.length) return;
    setS((prev) => {
      if (!prev.init) return { ...prev, init: true, known: new Set(plays.map((p) => p.id)) };
      let lastKnown = -1;
      plays.forEach((p, i) => { if (prev.known.has(p.id)) lastKnown = i; });
      const fresh = plays.slice(lastKnown + 1).filter((p) => !prev.known.has(p.id)).map((p) => p.id);
      const unseenOlder = plays.slice(0, lastKnown + 1).filter((p) => !prev.known.has(p.id));
      if (!fresh.length && !unseenOlder.length) return prev;
      const known = new Set(prev.known);
      plays.forEach((p) => known.add(p.id));
      let queue = [...prev.queue, ...fresh];
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      return { ...prev, known, queue };
    });
  }, [plays]);

  // Advance: hold → (gap with "next play" if more are waiting) → next.
  useEffect(() => {
    const t = setInterval(() => {
      setS((prev) => {
        const now = Date.now();
        if (prev.slot) {
          if (now - prev.slotAt < HOLD_MS) return prev;
          // Drop the held play into the list; if more are queued, show the
          // next-play card for GAP_MS before revealing the next one.
          return { ...prev, slot: null, slotAt: 0, gapUntil: prev.queue.length ? now + GAP_MS : 0, justListed: prev.slot };
        }
        if (prev.queue.length && now >= prev.gapUntil) {
          const [next, ...rest] = prev.queue;
          return { ...prev, slot: next, slotAt: now, queue: rest, gapUntil: 0 };
        }
        return prev;
      });
    }, 500);
    return () => clearInterval(t);
  }, []);

  return useMemo(() => {
    const hidden = new Set([...s.queue, ...(s.slot ? [s.slot] : [])]);
    return {
      listed: plays.filter((p) => !hidden.has(p.id)),
      slot: s.slot ? plays.find((p) => p.id === s.slot) || null : null,
      justListed: s.justListed,
      queued: s.queue,
    };
  }, [plays, s]);
}
