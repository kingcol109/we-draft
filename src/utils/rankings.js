// src/utils/rankings.js
//
// Shared Top 25 rankings helpers. One doc per week — collection `rankings`,
// doc id is the exact schedule26 Week string (e.g. "Week 1") — each holding
// an ordered Top25 array of { Rank, School }. Entered in AdminPanel.js's CFB
// Schedule tab, directly below the schedule editor for whichever week is
// selected there.
//
// Week 0 has no doc of its own: the site only publishes one poll before the
// season opens, and it covers both Week 0 and Week 1's games — so every
// lookup here treats "Week 0" as an alias for "Week 1"'s doc (see
// rankingsWeekKey) rather than risking two docs that could drift apart.
//
// Once a game goes Final, AdminPanel.js's CFBScheduleSection snapshots that
// week's ranks onto the game doc itself (HomeRank/AwayRank) — ranksForGame
// below prefers that frozen snapshot over a live lookup, so a game page's
// numbers don't silently change if that week's poll gets corrected later.
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export const RANKINGS_LIMIT = 25;

// "Week 0" -> "Week 1" (case-insensitive, trimmed); every other Week string
// passes through unchanged.
export function rankingsWeekKey(week) {
  const w = (week || "").toString().trim();
  return w.toLowerCase() === "week 0" ? "Week 1" : w;
}

// Build a { School: Rank } lookup map from a rankings doc's Top25 array.
export function rankMapFromTop25(top25) {
  const map = {};
  (top25 || []).forEach((entry) => {
    if (entry?.School && entry?.Rank) map[entry.School] = entry.Rank;
  });
  return map;
}

// Fetches one week's rankings doc and returns a { School: Rank } map (empty
// if there's no doc for that week yet, e.g. it hasn't been entered). For
// pages centered on a single known week/game.
export async function fetchWeekRankMap(week) {
  const key = rankingsWeekKey(week);
  if (!key) return {};
  try {
    const snap = await getDoc(doc(db, "rankings", key));
    if (!snap.exists()) return {};
    return rankMapFromTop25(snap.data().Top25);
  } catch (e) {
    return {};
  }
}

// Fetches every rankings doc at once, keyed by the (already-aliased) week
// string — for pages resolving ranks across many different weeks' games at
// once (a full season schedule) without one round trip per game.
export async function fetchAllRankMaps() {
  try {
    const snap = await getDocs(collection(db, "rankings"));
    const byWeek = {};
    snap.docs.forEach((d) => { byWeek[d.id] = rankMapFromTop25(d.data().Top25); });
    return byWeek;
  } catch (e) {
    return {};
  }
}

// Ranks for one game. weekRankMap is a flat { School: Rank } map already
// resolved to *that game's* week (fetchWeekRankMap(game.Week), or
// byWeek[rankingsWeekKey(game.Week)] when starting from fetchAllRankMaps).
// Prefers the frozen HomeRank/AwayRank snapshot once the game is Final.
export function ranksForGame(game, weekRankMap) {
  if (!game) return { homeRank: null, awayRank: null };
  if (game.Final && (game.HomeRank != null || game.AwayRank != null)) {
    return { homeRank: game.HomeRank ?? null, awayRank: game.AwayRank ?? null };
  }
  const map = weekRankMap || {};
  return { homeRank: map[game.Home] ?? null, awayRank: map[game.Away] ?? null };
}

// "#25 Florida State" — the "#N " prefix used sitewide before a ranked
// team's name; returns the plain name (no leading space) when unranked.
export function withRank(name, rank) {
  return rank ? `#${rank} ${name || ""}`.trim() : (name || "");
}

// React hook — fetches one week's rank map on mount / week change. For a
// page anchored to a single week/game (GamePage.js). Pages spanning many
// weeks (a season schedule) should call fetchAllRankMaps() directly instead
// of mounting one of these per game.
export function useWeekRanks(week) {
  const [map, setMap] = useState({});
  useEffect(() => {
    let alive = true;
    fetchWeekRankMap(week).then((m) => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, [week]);
  return map;
}
