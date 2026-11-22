// src/utils/portalSim/usage.js
//
// Transfer Portal Sim usage, for Admin → Players → Transfer Portal → Portal
// Sim Stats (components/AdminPortalSimStats.jsx). Counters only, written by
// anyone running the sim (signed in or not), read by admins
// (firestore.rules):
//   portalSimDaily/{YYYY-MM-DD}  { started, finished } — runs started (the
//                                Start button) and portals closed, by day
//                                (Eastern time, as the Draft Sim's).
//   portalSimTeams/{slug}        { started, finished, lastAt } — the same two
//                                counts per school played (all time; counting
//                                began 2026-11-22), so admins see which
//                                schools people use.
// Every run counts, the site's own account included (user, 2026-11-18 —
// unlike the Draft Sim's counters). Fire-and-forget: a failed write never
// touches the sim.
import { doc, increment, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { statsDay } from "../draftSim/stats";

export const PORTAL_DAILY = "portalSimDaily";
export const PORTAL_TEAMS = "portalSimTeams";
export { statsDay };

// field: "started" or "finished"; team: the school's slug, when known.
export function countPortalSim(field, team) {
  setDoc(doc(db, PORTAL_DAILY, statsDay()), { [field]: increment(1) }, { merge: true })
    .catch((e) => console.warn("Portal sim stats:", e?.code || e));
  if (team && /^[a-z0-9-]{1,63}$/.test(team)) {
    setDoc(doc(db, PORTAL_TEAMS, team), { [field]: increment(1), lastAt: serverTimestamp() }, { merge: true })
      .catch((e) => console.warn("Portal sim school stats:", e?.code || e));
  }
}
