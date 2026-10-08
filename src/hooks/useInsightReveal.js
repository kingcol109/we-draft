// src/hooks/useInsightReveal.js
//
// Paces the insight cards in a live game's feed (/live GameView). An
// insight (server/live/insights.js — precomputed by the ingester, carried
// on the game doc) belongs to the play that caused it and sits right above
// it. It never appears with its play: it waits until that play has been
// revealed and dropped into the list (usePlayReveal), then DELAY_MS more —
// "here's why that play matters" a beat after the play itself.
//
// Insights already there when the game is opened show at once, with no
// animation (they're history, not news).
//
// insights: the game doc's `insights`. listed: the plays in the list
// (usePlayReveal's `listed`). Returns Map(sourcePlayId → [{ insight, fresh }]),
// newest first.
import { useEffect, useMemo, useRef, useState } from "react";

const DELAY_MS = 4 * 1000;
// Insights that arrive this soon after opening the game count as history.
const OPEN_GRACE_MS = 3 * 1000;

export function useInsightReveal(insights, listed, resetKey) {
  const [revealAt, setRevealAt] = useState(() => new Map()); // insight id → ms (0 = already there)
  const [, setWake] = useState(0);
  const openedAt = useRef(Date.now());

  useEffect(() => { setRevealAt(new Map()); openedAt.current = Date.now(); }, [resetKey]);

  const listedIds = useMemo(() => {
    const s = new Set();
    for (const p of listed) if (!p.presentation?.nullified) s.add(p.id);
    return s;
  }, [listed]);
  const ready = useMemo(() => (insights || []).filter((i) => i?.id && listedIds.has(i.sourcePlayId)), [insights, listedIds]);
  const readyKey = ready.map((i) => i.id).join(",");

  // An insight whose play is now listed gets its reveal time, once.
  useEffect(() => {
    if (!ready.some((i) => !revealAt.has(i.id))) return;
    const now = Date.now();
    const history = now - openedAt.current < OPEN_GRACE_MS;
    setRevealAt((prev) => {
      const m = new Map(prev);
      for (const i of ready) if (!m.has(i.id)) m.set(i.id, history ? 0 : now + DELAY_MS);
      return m;
    });
  }, [readyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render when the next pending one is due.
  useEffect(() => {
    const now = Date.now();
    const due = [...revealAt.values()].filter((t) => t > now);
    if (!due.length) return undefined;
    const t = setTimeout(() => setWake(Date.now()), Math.min(...due) - now + 30);
    return () => clearTimeout(t);
  });

  const now = Date.now();
  const byPlay = new Map();
  for (const i of [...ready].reverse()) {
    const t = revealAt.get(i.id);
    if (t == null || t > now) continue;
    if (!byPlay.has(i.sourcePlayId)) byPlay.set(i.sourcePlayId, []);
    byPlay.get(i.sourcePlayId).push({ insight: i, fresh: t > 0 });
  }
  return byPlay;
}

// Local dev only: cards and break summaries from
// `node scripts/replayInsights.js <gameId> --preview` (public/dev-insights/
// {gameId}.json, gitignored) stand in for the game doc's, so a finished game
// can be read through as if live. { insights, breaks, timeouts, trivia }, or null — always null
// in a production build.
export function useDevInsights(gameId) {
  const [cards, setCards] = useState(null);
  useEffect(() => {
    setCards(null);
    if (process.env.NODE_ENV !== "development" || !gameId) return undefined;
    let off = false;
    fetch(`/dev-insights/${gameId}.json`)
      .then((r) => (r.ok && /json/.test(r.headers.get("content-type") || "") ? r.json() : null))
      .then((j) => { if (!off && j) setCards(Array.isArray(j) ? { insights: j, breaks: [] } : { insights: j.insights || [], breaks: j.breaks || [], timeouts: j.timeouts || [], trivia: j.trivia || [] }); })
      .catch(() => {});
    return () => { off = true; };
  }, [gameId]);
  return cards;
}
