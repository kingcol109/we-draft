// src/utils/recentEvaluations.js
//
// The home page's "Recent Evals" feed: the newest public, written
// evaluations on Live players. One collection-group query (newest public
// evaluations first) plus one players read for the handful shown — instead
// of reading every player and one evaluations query per player.
//
// Each evaluation is stored twice (players/{id}/evaluations/{uid} and the
// private mirror users/{uid}/evaluations/{id}); only the players copy is
// used. Needs the collection-group index on evaluations (visibility,
// updatedAt desc) in firestore.indexes.json — if the query fails (index not
// deployed yet), falls back to the old per-player scan.
import { collection, collectionGroup, documentId, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";

const HIDDEN_LIVE = [false, null, 0, "false", "no"];
const CANDIDATES = 40; // both copies of each evaluation come back, plus non-written ones
const PER_PLAYER = 2;  // same cap the per-player scan had (limit 2 each)

// Dummy evaluations (AdminPanel.js's Dummy Content tab) count toward
// everything else an eval touches on purpose — Community Grade, the Public
// Evaluations feed — but this feed is meant to surface genuine community
// activity, so it's the one place they're deliberately excluded.
const showable = (e) => e.visibility === "public" && e.evaluation?.trim() && !e.isDummy;

async function viaCollectionGroup(count) {
  const snap = await getDocs(query(
    collectionGroup(db, "evaluations"),
    where("visibility", "==", "public"),
    orderBy("updatedAt", "desc"),
    limit(CANDIDATES),
  ));
  const perPlayer = {};
  const candidates = snap.docs
    .filter((d) => d.ref.parent.parent?.parent?.id === "players")
    .map((d) => ({ ...d.data(), playerId: d.ref.parent.parent.id }))
    .filter(showable)
    .filter((e) => (perPlayer[e.playerId] = (perPlayer[e.playerId] || 0) + 1) <= PER_PLAYER)
    .slice(0, count * 2);
  const ids = [...new Set(candidates.map((e) => e.playerId))].slice(0, 30);
  const players = {};
  if (ids.length) {
    const ps = await getDocs(query(collection(db, "players"), where(documentId(), "in", ids)));
    ps.docs.forEach((d) => { players[d.id] = d.data(); });
  }
  return candidates
    .filter((e) => players[e.playerId] && !HIDDEN_LIVE.includes(players[e.playerId].Live))
    .slice(0, count)
    .map((e) => {
      const pd = players[e.playerId];
      return { ...e, playerName: `${pd.First || ""} ${pd.Last || ""}`.trim(), playerSlug: pd.Slug || e.playerId };
    });
}

async function viaPlayerScan(count) {
  const playersSnap = await getDocs(collection(db, "players"));
  const results = await Promise.all(playersSnap.docs
    .filter((p) => !HIDDEN_LIVE.includes(p.data().Live))
    .map((playerDoc) => {
      const pd = playerDoc.data();
      return getDocs(query(collection(db, "players", playerDoc.id, "evaluations"), orderBy("updatedAt", "desc"), limit(PER_PLAYER)))
        .then((snap) => snap.docs.map((d) => ({
          ...d.data(), playerId: playerDoc.id,
          playerName: `${pd.First || ""} ${pd.Last || ""}`.trim(), playerSlug: pd.Slug || playerDoc.id,
        })));
    }));
  return results.flat()
    .filter(showable)
    .sort((a, b) => (b.updatedAt?.toDate?.()?.getTime?.() || 0) - (a.updatedAt?.toDate?.()?.getTime?.() || 0))
    .slice(0, count);
}

export async function fetchRecentPublicEvals(count = 6) {
  try {
    return await viaCollectionGroup(count);
  } catch (err) {
    console.warn("Recent evals: collection-group query failed, using per-player scan.", err?.code || err);
    return viaPlayerScan(count);
  }
}
