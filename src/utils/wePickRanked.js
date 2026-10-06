// src/utils/wePickRanked.js
//
// The Ranked 6's size limit, shared by every place a pick can be made or
// starred — We-Pick's My Picks (WePickHub.js), /live's game pick card
// (LivePage.js PreviewPickCard) and GamePage.js. The Ranked 6 is exactly 6
// (a 7th ranked pick disqualifies the week), so:
//   - a new score pick counts toward it only while there's room
//     (hasRankedRoom) — otherwise it saves unranked;
//   - ranking one more when it's full is a swap: one ranked pick out, the
//     new one in, in one batch (swapRanked), chosen in components/
//     RankedSwap.js.
// Counts the same picks My Picks does: ranked, with a score, on a game in
// that week that isn't RankedDisqualified.
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { hasScorePick } from "./wePickScoring";

export const RANKED_SIZE = 6;

// The week's ranked picks: [{ id, game, pick }] (game = the schedule26 doc
// with its id), plus every game in the week by id. Two reads.
export async function loadWeekRanked(uid, week) {
  if (!uid || !week) return { ranked: [], games: new Map() };
  const [weekGames, ranked] = await Promise.all([
    getDocs(query(collection(db, "schedule26"), where("Week", "==", week))),
    getDocs(query(collection(db, "users", uid, "picks"), where("ranked", "==", true))),
  ]);
  const games = new Map(weekGames.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  return {
    games,
    ranked: ranked.docs
      .filter((d) => games.has(d.id) && !games.get(d.id).RankedDisqualified && hasScorePick(d.data()))
      .map((d) => ({ id: d.id, game: games.get(d.id), pick: d.data() })),
  };
}

// Room for one more ranked pick this week (gameId itself never counts).
export async function hasRankedRoom(uid, week, gameId) {
  const { ranked } = await loadWeekRanked(uid, week);
  return ranked.filter((r) => r.id !== gameId).length < RANKED_SIZE;
}

// Rank inId and un-rank outId together (or just rank inId when outId is
// null) — both copies of each pick (schedule26/{id}/picks/{uid} and the
// users/{uid}/picks mirror), one batch, so it never lands half-done.
export async function swapRanked(uid, outId, inId) {
  const batch = writeBatch(db);
  const set = (gameId, ranked) => {
    const data = { ranked, updatedAt: serverTimestamp() };
    batch.set(doc(db, "schedule26", gameId, "picks", uid), data, { merge: true });
    batch.set(doc(db, "users", uid, "picks", gameId), data, { merge: true });
  };
  if (outId) set(outId, false);
  if (inId) set(inId, true);
  await batch.commit();
}

// What a set of ranked games is still missing to qualify (WePickHub.js
// rankedStatus's rules): [] when it qualifies.
export function rankedNeeds(games, week) {
  const needs = [];
  if (games.length !== RANKED_SIZE) needs.push(`${RANKED_SIZE} games`);
  if (week !== "Week 0") {
    if (!games.some((g) => g.GameOfWeek)) needs.push("the Game of the Week");
    if (games.filter((g) => g.Featured).length < 2) needs.push("2 Featured games");
  }
  return needs;
}
