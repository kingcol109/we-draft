// src/hooks/useLiveSlate.js
//
// One real-time listener on liveSlate/current — the compact doc the
// We-Draft Live ingester (server/live/*) rewrites whenever a score, clock
// or status changes — exposed as Map(liveGameId → slate game). Lets any
// schedule26-driven list overlay live scores via a game's CFBDGameId
// without a per-game listener (one doc read per update, however many
// games are on screen).
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { statusLabel } from "../utils/live";

const EMPTY = new Map();

export function useLiveSlate(enabled = true) {
  const [byId, setById] = useState(EMPTY);
  useEffect(() => {
    if (!enabled) return undefined;
    return onSnapshot(
      doc(db, "liveSlate", "current"),
      (s) => setById(new Map((s.data()?.games || []).map((g) => [String(g.id), g]))),
      () => setById(EMPTY),
    );
  }, [enabled]);
  return byId;
}

// Live score for a schedule26 game, oriented to ITS Home/Away (a
// CFBDMatch.swapped game lists them the other way round at the provider).
// null unless the game is underway/finished with real points.
//   { live: bool, final: bool, home, away, label }
export function liveScoreFor(game, byId) {
  if (!game?.CFBDGameId) return null;
  const lg = byId.get(String(game.CFBDGameId));
  if (!lg || (lg.status !== "in_progress" && lg.status !== "final")) return null;
  const swapped = !!game.CFBDMatch?.swapped;
  const home = (swapped ? lg.away : lg.home)?.points;
  const away = (swapped ? lg.home : lg.away)?.points;
  if (home == null || away == null) return null;
  return { live: lg.status === "in_progress", final: lg.status === "final", home, away, label: statusLabel(lg) };
}

// The score a schedule26-driven game row should show: the admin-entered
// final wins once set (it's what We-Pick grades against); otherwise the
// We-Draft Live running/final score, if any. `scored` = there's a score to
// show at all; `live` = in progress; `liveFinal` = provider says final but
// not admin-finalized yet.
export function scheduleScore(g, byId) {
  if (g.Final && g.HomeScore != null && g.AwayScore != null) {
    return { scored: true, live: false, liveFinal: false, home: g.HomeScore, away: g.AwayScore, homeWon: g.HomeScore > g.AwayScore, awayWon: g.AwayScore > g.HomeScore };
  }
  const lv = liveScoreFor(g, byId);
  if (!lv) return { scored: false, live: false, liveFinal: false };
  return {
    scored: true, live: lv.live, liveFinal: lv.final, label: lv.label, home: lv.home, away: lv.away,
    homeWon: lv.final && lv.home > lv.away, awayWon: lv.final && lv.away > lv.home,
  };
}
