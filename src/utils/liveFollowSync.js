// src/utils/liveFollowSync.js
//
// Follow a team or player for We-Draft Live from outside /live — the CFB
// team page's Follow button and the player page's Follow — writing the same
// place LivePage.js keeps follows: users/{uid}/liveSettings/main (teams:
// [CFBD team id], players: [{ id, name, teamId, team, position }]) when
// signed in, this browser's copy (utils/live.js loadFollows/saveFollows)
// when not. LivePage listens to that doc, so a follow made here shows up in
// its Customize page and Feed right away.
//
// Player follows are linked both ways: a We-Draft profile maps to a CFBD
// player through cfbdPlayers (wedraftPlayerId, suggested/verified links).
// Following on a player page adds the CFBD player to Live; following a
// player on /live writes the profile's users/{uid}/follows doc (what the
// player page's Follow button and My Feed read).
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, query, runTransaction, serverTimestamp, setDoc, where,
} from "firebase/firestore";
import { db } from "../firebase";
import { FOLLOW_PLAYERS_KEY, FOLLOW_TEAMS_KEY, loadFollows, saveFollows } from "./live";

const LINKED = ["suggested", "verified"];
const settingsRef = (uid) => doc(db, "users", uid, "liveSettings", "main");
const samePlayer = (a, b) => String(a.id) === String(b.id);

// Read-modify-write of the account's follows (creating the doc from this
// browser's follows the first time, same as LivePage does).
async function updateAccountFollows(uid, fn) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef(uid));
    const d = snap.exists() ? snap.data() : { teams: loadFollows(FOLLOW_TEAMS_KEY), players: loadFollows(FOLLOW_PLAYERS_KEY) };
    const next = fn({ teams: d.teams || [], players: d.players || [] });
    tx.set(settingsRef(uid), { teams: next.teams, players: next.players, updatedAt: serverTimestamp() }, { merge: true });
  });
}

async function updateFollows(uid, fn) {
  if (uid) return updateAccountFollows(uid, fn);
  const next = fn({ teams: loadFollows(FOLLOW_TEAMS_KEY), players: loadFollows(FOLLOW_PLAYERS_KEY) });
  saveFollows(FOLLOW_TEAMS_KEY, next.teams);
  saveFollows(FOLLOW_PLAYERS_KEY, next.players);
  return undefined;
}

// ── Teams ──

export async function isLiveTeamFollowed(uid, teamId) {
  const id = Number(teamId);
  if (!uid) return loadFollows(FOLLOW_TEAMS_KEY).includes(id);
  const snap = await getDoc(settingsRef(uid));
  return snap.exists() ? (snap.data().teams || []).includes(id) : loadFollows(FOLLOW_TEAMS_KEY).includes(id);
}

export function setLiveTeamFollow(uid, teamId, on) {
  const id = Number(teamId);
  return updateFollows(uid, (f) => ({
    ...f, teams: on ? (f.teams.includes(id) ? f.teams : [...f.teams, id]) : f.teams.filter((x) => x !== id),
  }));
}

// ── Players ──

// A We-Draft profile's CFBD player, as a Live follow entry — or null.
export async function cfbdPlayerFor(wedraftPlayerId) {
  const snap = await getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", wedraftPlayerId), limit(1)));
  const d = snap.docs[0];
  if (!d || !LINKED.includes(d.data().mappingStatus)) return null;
  const c = d.data();
  return { id: d.id, name: c.name, ...(c.teamId != null ? { teamId: c.teamId, team: c.team || null, position: c.position || null } : {}) };
}

export function setLivePlayerFollow(uid, player, on) {
  return updateFollows(uid, (f) => ({
    ...f,
    players: on
      ? (f.players.some((p) => samePlayer(p, player)) ? f.players : [...f.players, player])
      : f.players.filter((p) => !samePlayer(p, player)),
  }));
}

// /live → player page: mirror a Live player follow onto his We-Draft
// profile's users/{uid}/follows doc (signed-in only; no-op for a CFBD
// player without a profile).
export async function syncProfileFollow(uid, cfbdId, on) {
  if (!uid) return;
  const c = (await getDoc(doc(db, "cfbdPlayers", String(cfbdId)))).data();
  if (!c?.wedraftPlayerId || !LINKED.includes(c.mappingStatus)) return;
  const ref = doc(db, "users", uid, "follows", c.wedraftPlayerId);
  if (!on) { await deleteDoc(ref); return; }
  const p = (await getDoc(doc(db, "players", c.wedraftPlayerId))).data();
  if (!p) return;
  // Same fields PlayerProfile.js's handleToggleFollow writes.
  await setDoc(ref, {
    playerId: c.wedraftPlayerId,
    playerSlug: p.Slug || "",
    playerName: `${p.First || ""} ${p.Last || ""}`.trim(),
    playerSchool: p.School || "",
    playerPosition: p.Position || "",
    playerEligible: p.Eligible || "",
    followedAt: serverTimestamp(),
  });
}
