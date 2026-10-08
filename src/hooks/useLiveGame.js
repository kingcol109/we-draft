// src/hooks/useLiveGame.js
//
// Real-time subscription to one We-Draft Live game (liveGames/{id}),
// written by the server-side ingester — never fetched from CFBD here.
//
// Read cost is kept per-viewer small on purpose:
//   - the game doc (score, clock, scoring summary) is always one listener;
//   - plays: "recent" listens only to the newest RECENT_PLAYS (new plays
//     arrive as single-doc updates), "all" loads the full list, "none"
//     skips plays entirely (e.g. a game that hasn't started);
//   - the box score is one doc.
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { orderPlays } from "../utils/live";

const RECENT_PLAYS = 40;

export function useLiveGame(liveGameId, { plays: playsMode = "recent", box: withBox = true } = {}) {
  const [game, setGame] = useState(null);
  const [plays, setPlays] = useState([]);
  const [box, setBox] = useState(null);
  const [ready, setReady] = useState(false);
  const id = liveGameId != null ? String(liveGameId) : null;

  useEffect(() => {
    setGame(null);
    setReady(false);
    if (!id) return undefined;
    return onSnapshot(
      doc(db, "liveGames", id),
      (s) => { setGame(s.exists() ? { id: s.id, ...s.data() } : null); setReady(true); },
      () => setReady(true),
    );
  }, [id]);

  useEffect(() => {
    setPlays([]);
    if (!id || playsMode === "none") return undefined;
    const q = playsMode === "all"
      ? query(collection(db, "liveGames", id, "plays"), orderBy("seq", "desc"))
      : query(collection(db, "liveGames", id, "plays"), orderBy("seq", "desc"), limit(RECENT_PLAYS));
    return onSnapshot(
      q,
      (s) => setPlays(orderPlays(s.docs.map((d) => d.data()).filter((p) => !p.hidden && !p.removed))),
      () => {},
    );
  }, [id, playsMode]);

  useEffect(() => {
    setBox(null);
    if (!id || !withBox) return undefined;
    return onSnapshot(doc(db, "liveGames", id, "box", "players"), (s) => setBox(s.exists() ? s.data() : null), () => {});
  }, [id, withBox]);

  return { game, plays, box, ready };
}

// The ingester's live stats doc (liveGames/{id}/box/live: { teams, players },
// computed from the play-by-play — see src/utils/liveStats.mjs). One doc,
// so it costs one read per update instead of the whole play list.
// { stats: doc data or null, ready } — ready && !stats = an older game
// stored before the doc existed.
export function useLiveStats(liveGameId) {
  const [state, setState] = useState({ stats: null, ready: false });
  const id = liveGameId != null ? String(liveGameId) : null;
  useEffect(() => {
    setState({ stats: null, ready: false });
    if (!id) return undefined;
    return onSnapshot(
      doc(db, "liveGames", id, "box", "live"),
      (s) => setState({ stats: s.exists() ? s.data() : null, ready: true }),
      () => setState({ stats: null, ready: true }),
    );
  }, [id]);
  return state;
}
