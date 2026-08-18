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

// Same digit-extraction weekNumber() every page already has its own copy
// of (AdminPanel.js, GamePage.js, CFBPage.js, ...) — needed here just to
// pick out the *highest* week among a byWeek map's keys.
function weekNumberOf(w) {
  const m = /(\d+)/.exec(w || "");
  return m ? Number(m[1]) : -1;
}

// The "current" rank map — whichever week in a byWeek map (fetchAllRankMaps())
// has the highest week number AND actually has entries. "Current" means the
// most recently *published* poll, not anything tied to today's calendar date
// or any specific game's own Week — a team's rank should read the same
// (its latest) whether you're looking at an already-past week's schedule row
// or a week that hasn't happened yet.
export function currentRankMap(byWeek) {
  let bestKey = null;
  let bestNum = -1;
  Object.entries(byWeek || {}).forEach(([key, map]) => {
    if (!map || Object.keys(map).length === 0) return;
    const n = weekNumberOf(key);
    if (n > bestNum) { bestNum = n; bestKey = key; }
  });
  return bestKey ? byWeek[bestKey] : {};
}

// fetchAllRankMaps() + currentRankMap() in one call — for pages that don't
// otherwise need per-week granularity (GamePage.js, CFBPage.js). Pages that
// already fetch fetchAllRankMaps() for other reasons (a full season
// schedule) should call currentRankMap() directly on what they already
// have instead of fetching twice.
export async function fetchCurrentRankMap() {
  return currentRankMap(await fetchAllRankMaps());
}

// React hook version of fetchCurrentRankMap() — fetches once on mount.
export function useCurrentRankMap() {
  const [map, setMap] = useState({});
  useEffect(() => {
    let alive = true;
    fetchCurrentRankMap().then((m) => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, []);
  return map;
}

// Ranks for one game. currentMap is the *current* (latest-published) rank
// map — currentRankMap(byWeek), fetchCurrentRankMap(), or useCurrentRankMap().
// Once a game is Final, its own frozen HomeRank/AwayRank snapshot (captured
// at that week's poll, see AdminPanel.js's CFBScheduleSection) always wins
// over currentMap — a past/finished game's numbers stay exactly what they
// were then, never drifting to a later week's poll. Every other game —
// upcoming or in progress, regardless of which week it's actually in —
// shows each team's current standing instead of that specific week's poll,
// so e.g. a Week 1 game viewed from a Week 6 schedule still shows Week 6's
// numbers, not stale Week 1 ones.
export function ranksForGame(game, currentMap) {
  if (!game) return { homeRank: null, awayRank: null };
  if (game.Final && (game.HomeRank != null || game.AwayRank != null)) {
    return { homeRank: game.HomeRank ?? null, awayRank: game.AwayRank ?? null };
  }
  const map = currentMap || {};
  return { homeRank: map[game.Home] ?? null, awayRank: map[game.Away] ?? null };
}

// "#25 Florida State" — the "#N " prefix used sitewide before a ranked
// team's name; returns the plain name (no leading space) when unranked.
export function withRank(name, rank) {
  return rank ? `#${rank} ${name || ""}`.trim() : (name || "");
}
