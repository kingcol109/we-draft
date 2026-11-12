// src/utils/visitorVisits.js
//
// Visitors without an account — so Admin → Users can find the ones who
// come back often (utils/userTiers.js). A signed-out browser gets a random
// id of its own (localStorage, wd_vid — nothing about the person), and each
// day it loads the site is added to its doc:
//   siteVisitors/{visitorId}  { first, last, days: { [YYYY-MM-DD]: true } }
// (Eastern-time days). When someone signs in on that browser, the id is
// tied to their account once:
//   siteVisitorAccounts/{visitorId}  { uid, at }
// so a regular who has an account isn't listed as one without. Once per
// browser per day, fire-and-forget like utils/accountVisits.js; admins read
// both (firestore.rules).
import { FieldPath, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { statsDay } from "./draftSim/stats";

export const VISITORS = "siteVisitors";
export const VISITOR_ACCOUNTS = "siteVisitorAccounts";
const ID_KEY = "wd_vid";
const DAY_KEY = "wd_vid_day";
const LINK_KEY = "wd_vid_linked";

function visitorId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!/^[a-z0-9]{16}$/.test(id || "")) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      id = Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
      localStorage.setItem(ID_KEY, id);
      localStorage.removeItem(DAY_KEY);
    }
    return id;
  } catch { return null; } // storage blocked — not counted
}

// A signed-out page load: today joins this browser's days (its doc is made
// on its first day).
export function countVisitorVisit() {
  const id = visitorId();
  if (!id) return;
  const day = statsDay();
  let lastDay = null;
  try { lastDay = localStorage.getItem(DAY_KEY); } catch { return; }
  if (lastDay === day) return;
  const ref = doc(db, VISITORS, id);
  const create = () => setDoc(ref, { first: day, last: day, days: { [day]: true } });
  (lastDay ? updateDoc(ref, "last", day, new FieldPath("days", day), true).catch(create) : create())
    .then(() => { try { localStorage.setItem(DAY_KEY, day); } catch { /* ignore */ } })
    .catch((e) => console.warn("Visitor visit:", e?.code || e));
}

// A signed-in page load: this browser's id belongs to uid (once).
export function linkVisitor(uid) {
  if (!uid) return;
  let id = null;
  try {
    id = localStorage.getItem(ID_KEY);
    if (!id || localStorage.getItem(LINK_KEY) === uid) return;
  } catch { return; }
  setDoc(doc(db, VISITOR_ACCOUNTS, id), { uid, at: new Date().toISOString() })
    .catch(() => { /* already tied to an account */ })
    .finally(() => { try { localStorage.setItem(LINK_KEY, uid); } catch { /* ignore */ } });
}
