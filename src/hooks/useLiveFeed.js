// src/hooks/useLiveFeed.js
//
// Data hooks for /live's My Feed.
//
//   useLiveGameDocs(ids)  — real-time liveGames/{id} docs for a handful of
//                           games (each carries its full `feedPlays` list).
//                           One listener per game, capped at MAX_GAMES.
//   useRankedSixIds(uid, weeks) — schedule26 ids of the user's official
//                           We-Pick Ranked 6 (wePickSubmissions/{week}/
//                           entries/{uid}.gameIds) for the given weeks.
import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

const MAX_GAMES = 20;

export function useLiveGameDocs(ids) {
  const key = [...new Set(ids)].sort().slice(0, MAX_GAMES).join(",");
  const [byId, setById] = useState(() => new Map());
  useEffect(() => {
    const list = key ? key.split(",") : [];
    setById(new Map());
    const unsubs = list.map((id) => onSnapshot(
      doc(db, "liveGames", id),
      (s) => setById((prev) => {
        const next = new Map(prev);
        if (s.exists()) next.set(id, { id, ...s.data() }); else next.delete(id);
        return next;
      }),
      () => {},
    ));
    return () => unsubs.forEach((u) => u());
  }, [key]);
  return byId;
}

export function useRankedSixIds(uid, weeks) {
  const weekKey = [...new Set(weeks.filter(Boolean))].sort().join("|");
  const [byWeek, setByWeek] = useState({});
  useEffect(() => {
    setByWeek({});
    if (!uid || !weekKey) return undefined;
    const unsubs = weekKey.split("|").map((week) => onSnapshot(
      doc(db, "wePickSubmissions", week, "entries", uid),
      (s) => setByWeek((prev) => ({ ...prev, [week]: s.exists() ? s.data().gameIds || [] : [] })),
      () => {},
    ));
    return () => unsubs.forEach((u) => u());
  }, [uid, weekKey]);
  return useMemo(() => new Set(Object.values(byWeek).flat()), [byWeek]);
}
