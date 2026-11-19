// src/utils/recruitSim/events.js
//
// Structured history (spec §24–25). Every meaningful thing that happens is
// an event row — never prose — so the same history can later drive recruit
// communications, the Recruiting Desk, notifications and profile timelines:
//   { st: stage it happened in, k: kind, s: school (-1 = none), r: recruit, d: data }
// Kept: everything involving the user's school, plus national events
// (commitments, list announcements, signings). CPU-only staff chatter isn't
// stored. Prose is made at display time (./reports.js).
export const NATIONAL = new Set(["commit", "top10", "final", "signed", "unsigned", "reopen", "announce", "delay"]);
// Kinds:
//   coachVisit {role, region}   coachRecruit {role}   recommend {role}
//   boardAdd   boardRemove      lineUp {rank}          lineDown
//   nilOffer {from, to}         nilCut {before, now}   scout {slots}
//   interestUp / interestDown {from, to (labels)}      demand {type, …}
//   demandMet / demandLapsed    top10 {list}           final {list}
//   commit {to}                 dropped (removed you)  signed / unsigned
//   announce {list, field}      delay                  reopen

export function logEvent(state, s, k, r, d) {
  if (s !== state.user && !NATIONAL.has(k)) return;
  state.events.push(d ? { st: state.stage, k, s, r, d } : { st: state.stage, k, s, r });
}

// A recruit's history with the user's school (and his public moments).
export function historyOf(state, r) {
  return state.events.filter((e) => e.r === r && (e.s === state.user || NATIONAL.has(e.k)));
}
