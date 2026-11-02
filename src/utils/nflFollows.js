// src/utils/nflFollows.js
//
// NFL teams a user follows (the Follow button on /nfl/{team}, the profile's
// Following and Feed tabs): users/{uid}/liveSettings/nfl { teams: [abbr] }.
// Its own doc, not liveSettings/main — LivePage.js rewrites that one whole,
// which would drop a field it doesn't know about.
import { arrayRemove, arrayUnion, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const ref = (uid) => doc(db, "users", uid, "liveSettings", "nfl");

export async function loadNflFollows(uid) {
  if (!uid) return [];
  const snap = await getDoc(ref(uid));
  return snap.exists() ? snap.data().teams || [] : [];
}

export function setNflFollow(uid, abbr, on) {
  return setDoc(ref(uid), { teams: on ? arrayUnion(abbr) : arrayRemove(abbr), updatedAt: serverTimestamp() }, { merge: true });
}
