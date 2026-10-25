// src/utils/draftSim/stats.js
//
// Draft Sim usage, for Admin → Mock Draft → Statistics. Counters only — no
// per-visit log to read back — written by anyone running the sim (signed
// in or not), read by admins (firestore.rules):
//   draftSimDaily/{YYYY-MM-DD}   { sims, completed, picks } — sims started,
//                                sims finished, picks users made, by day
//                                (Eastern time).
//   draftSimPicks/{year}_{team}_{YYYY-MM-DD}
//                                { year, team, day, p: { "{overall}_{playerId}": n } }
//                                — who users took for that team at each pick,
//                                on that day (Eastern time).
//   draftSimTeams/{year}_{YYYY-MM-DD}
//                                { year, day, t: { [team]: n, WATCH: n } } —
//                                the teams users drafted as when they pressed
//                                START THE DRAFT (every team of a multi-team
//                                sim; WATCH: no team, watching the CPU).
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
  const day = statsDay();
  quietly(setDoc(doc(db, "draftSimPicks", `${year}_${event.team}_${day}`), { year: String(year), team: event.team, day, p: { [key]: increment(1) } }, { merge: true }));
}

// The teams a started sim drafts as (none → WATCH), once per start.
export const WATCH_KEY = "WATCH";
export function countTeams(uid, year, teams) {
  if (!counted(uid)) return;
  const day = statsDay();
  const keys = teams.length ? teams : [WATCH_KEY];
  quietly(setDoc(doc(db, "draftSimTeams", `${year}_${day}`), {
    year: String(year), day, t: Object.fromEntries(keys.map((k) => [k, increment(1)])),
  }, { merge: true }));
}
