// src/utils/gradeWindow.js
//
// The community grade refresh. For the classes in FRESH_GRADE_CLASSES (2027
// and 2028), a player's community grade — the average round grade, shown
// sitewide and behind the class ranks, boards and the Draft Sim — only
// counts evaluations saved on or after FRESH_GRADE_SINCE (Aug 1, 2026).
// Older evaluations stay: they're still on the player page, and their
// strengths, weaknesses and NFL fit still count toward the community's —
// only their grade is left out of the average. Every other class counts
// every grade.
//
// Evaluations carry only updatedAt (last saved), so "saved" is the test: a
// grader who re-saves an older evaluation after the cutoff counts as a new
// grade.
//
// Graders in NEVER_EXPIRE_UIDS are exempt: every grade they've saved counts,
// whenever it was saved. Matched on the evaluation's uid field (every
// evaluation stores its grader's uid; the public copy drops the email).
//
// No imports, so the snapshot builder (run by Node scripts) and the site
// share it.
export const FRESH_GRADE_CLASSES = ["2027", "2028"];
export const FRESH_GRADE_SINCE = Date.UTC(2026, 7, 1);
export const NEVER_EXPIRE_UIDS = [
  "pYSpX6IRyHdAlYpFP5NNbQ19ARI3", // nycsportstalk1@gmail.com (King Cold Sports)
];

// An evaluation's last-saved time in ms (Firestore Timestamp from either
// SDK, a { seconds } object, a precomputed updatedAtMs, a date string), or null.
function savedMs(e) {
  if (typeof e?.updatedAtMs === "number") return e.updatedAtMs;
  const t = e?.updatedAt;
  if (!t) return null;
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  if (typeof t._seconds === "number") return t._seconds * 1000;
  const n = typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(n) ? n : null;
}

// Is this evaluation's grade fresh — saved since the cutoff, or by an exempt
// grader? (Ignores class; see gradeCounts.)
export function gradeIsFresh(evaluation) {
  if (NEVER_EXPIRE_UIDS.includes(evaluation?.uid)) return true;
  const ms = savedMs(evaluation);
  return ms != null && ms >= FRESH_GRADE_SINCE;
}

// Does this evaluation's grade count toward the community grade of a player
// in class `eligible`?
export function gradeCounts(evaluation, eligible) {
  if (!FRESH_GRADE_CLASSES.includes(String(eligible))) return true;
  return gradeIsFresh(evaluation);
}

// The grade values that count (scale: label → 1 … 10).
export function countedGrades(evaluations, eligible, scale) {
  return (evaluations || []).filter((e) => scale[e?.grade] && gradeCounts(e, eligible)).map((e) => scale[e.grade]);
}

// The community grade: the average of the grades that count, or null.
export function communityAverage(evaluations, eligible, scale) {
  const vals = countedGrades(evaluations, eligible, scale);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
