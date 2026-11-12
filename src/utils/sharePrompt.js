// src/utils/sharePrompt.js
//
// "Share it?" after a save — the player page's Save Evaluation and the
// Whiteboard's Save open the share sheet (components/ShareSheet.jsx) with
// the graphic, as an offer — at most once a day per user, across every
// kind of save. The day (local, "2026-11-12") is kept on users/{uid}
// (sharePromptDay, so it holds across devices) and in this browser (so a
// second save today doesn't wait on the profile to know).
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

const today = () => new Date().toLocaleDateString("en-CA");
const key = (uid) => `wd_sharePrompt_${uid}`;

// True when this user hasn't been offered one today — and marks today as
// used, so the caller should show it. profile: AuthContext's (its
// sharePromptDay, from another device).
export function claimSharePrompt(uid, profile) {
  if (!uid) return false;
  const day = today();
  let used = profile?.sharePromptDay === day;
  try { if (localStorage.getItem(key(uid)) === day) used = true; } catch { /* storage blocked */ }
  if (used) return false;
  try { localStorage.setItem(key(uid), day); } catch { /* storage blocked */ }
  updateDoc(doc(db, "users", uid), { sharePromptDay: day }).catch(() => {});
  return true;
}
