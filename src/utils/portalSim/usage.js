// src/utils/portalSim/usage.js
//
// Transfer Portal Sim usage, for Admin → Players → Transfer Portal → Portal
// Sim Stats (components/AdminPortalSimStats.jsx). Counters only, written by
// anyone running the sim (signed in or not), read by admins
// (firestore.rules):
//   portalSimDaily/{YYYY-MM-DD}  { started, finished } — runs started (the
//                                Start button) and portals closed, by day
//                                (Eastern time, as the Draft Sim's).
// Every run counts, the site's own account included (user, 2026-11-18 —
// unlike the Draft Sim's counters). Fire-and-forget: a failed write never
// touches the sim.
import { doc, increment, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { statsDay } from "../draftSim/stats";

export const PORTAL_DAILY = "portalSimDaily";
export { statsDay };

// field: "started" or "finished".
export function countPortalSim(field) {
  setDoc(doc(db, PORTAL_DAILY, statsDay()), { [field]: increment(1) }, { merge: true })
    .catch((e) => console.warn("Portal sim stats:", e?.code || e));
}
