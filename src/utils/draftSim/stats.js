// src/utils/draftSim/stats.js
//
// Draft Sim usage, for Admin → Mock Draft → Statistics. Counters only — no
// per-visit log to read back — written by anyone running the sim (signed
// in or not), read by admins (firestore.rules):
//   draftSimDaily/{YYYY-MM-DD}   { sims, completed, picks } — sims started,
//                                sims finished, picks users made, by day
//                                (Eastern time).
//   draftSimPicks/{year}_{team}  { year, team, p: { "{overall}_{playerId}": n } }
//                                — who users took for that team at each pick.
// The site's own account (King Cold Sports) isn't counted. Fire-and-forget:
// a failed write never touches the sim.
import { doc, setDoc, increment } from "firebase/firestore";
import { db } from "../../firebase";

export const STATS_EXCLUDED_UIDS = [
  "pYSpX6IRyHdAlYpFP5NNbQ19ARI3", // nycsportstalk1@gmail.com (King Cold Sports)
];
const counted = (uid) => !STATS_EXCLUDED_UIDS.includes(uid);

// Today in Eastern time, as YYYY-MM-DD.
export const statsDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

const quietly = (p) => p.catch((e) => console.warn("Draft sim stats:", e?.code || e));

// field: "sims" (a sim started), "completed" (one finished) or "picks".
export function countSim(uid, field) {
  if (!counted(uid)) return;
  quietly(setDoc(doc(db, "draftSimDaily", statsDay()), { [field]: increment(1) }, { merge: true }));
}

// A pick the user made: event is engine makePick's pick event.
export function countUserPick(uid, year, event) {
  if (!counted(uid) || !event?.prospect?.id) return;
  countSim(uid, "picks");
  const key = `${event.pick.overall}_${event.prospect.id}`;
  quietly(setDoc(doc(db, "draftSimPicks", `${year}_${event.team}`), { year: String(year), team: event.team, p: { [key]: increment(1) } }, { merge: true }));
}
