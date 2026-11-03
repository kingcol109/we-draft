// src/utils/accountVisits.js
//
// Signed-in visitors by day, for Admin → Analytics → Daily Visitors (GA4
// has the new / returning split but doesn't know who has an account):
//   siteDailyAccounts/{YYYY-MM-DD}  { u: { [uid]: true } } — every account
//                                   that loaded the site that day (Eastern
//                                   time); the day's count is its size.
// Written by the signed-in user themself (each may add only their own uid —
// firestore.rules), read by admins. Once per browser per day (localStorage
// remembers the day), fire-and-forget: a failed write never touches the
// page. The site's own account isn't counted (stats.js STATS_EXCLUDED_UIDS).
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { statsDay, STATS_EXCLUDED_UIDS } from "./draftSim/stats";

export const ACCOUNT_VISITS = "siteDailyAccounts";

export function countAccountVisit(uid) {
  if (!uid || STATS_EXCLUDED_UIDS.includes(uid)) return;
  const day = statsDay();
  const key = `wd_acct_visit_${uid}`;
  try {
    if (localStorage.getItem(key) === day) return;
  } catch { /* storage blocked — count anyway */ }
  setDoc(doc(db, ACCOUNT_VISITS, day), { u: { [uid]: true } }, { merge: true })
    .then(() => { try { localStorage.setItem(key, day); } catch { /* ignore */ } })
    .catch((e) => console.warn("Account visit:", e?.code || e));
}
