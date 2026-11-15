// src/utils/portalStars.mjs
//
// Transfer stars (2–6) — the portal's own grade for every college player,
// built ahead of time so a player has one the moment he enters the portal.
// The rules live here, once, shared by the builder (server/portal/stars.js),
// the admin's Grades tab (components/AdminPortalGrades.jsx) and the public
// portal (pages/TransferPortal.jsx). No imports, so the Vercel function can
// load it (vercel.json includeFiles).
//
// SUBJECT TO CHANGE — the user's first pass (2026-11-14):
//   6★  an extremely high draft grade      community grade Early First
//   5★  any other first-round draft grade  Middle / Late First
//   4★  a round 2–7 draft grade
//   3★  solid: a UDFA draft grade, or (no draft grade) a good PFF season
//       grade on real snaps, or (no usable PFF) solid production in
//       CFBD's season stats
//   2★  everyone else
// Recruiting pedigree (user, 2026-11-14) sets a floor under all of that: a
// 5★ or top-100 recruit is at least 4★, a 4★ recruit at least 3★ (basis "r"
// when the floor is what decided it).
// The admin's locked grade (config/portalGrades — the Grades tab's grader)
// always wins.
//
// PFF only ever decides a star here — its numbers never leave the admin
// side (memory: PFF data is admin-only; number-free derived outputs are OK).

export const STAR_LABELS = { 6: "6-Star", 5: "5-Star", 4: "4-Star", 3: "3-Star", 2: "2-Star" };

// What a grade came from: draft grade, PFF, stats, nothing — or an admin.
export const BASIS = { d: "Draft grade", p: "PFF", s: "Stats", r: "Recruiting", n: "No data", o: "Admin override" };

// Recruiting pedigree's floor: { stars (recruiting), rank (national) } → the
// fewest transfer stars he gets, or 0.
export function recruitFloor(recruit) {
  const st = Number(recruit?.stars) || 0;
  const rank = Number(recruit?.rank) || 0;
  if (st >= 5 || (rank && rank <= 100)) return 4;
  if (st >= 4) return 3;
  return 0;
}

// Community grade average (1 = Early First … 10 = UDFA, rounded as
// gradeScale.js gradeLabel does) → stars, or null without one.
export function starsFromDraft(avg) {
  if (avg == null || !Number.isFinite(Number(avg))) return null;
  const r = Math.round(Number(avg));
  if (r <= 1) return 6;
  if (r <= 3) return 5;
  if (r <= 9) return 4;
  return 3; // UDFA
}

// PFF: snaps it takes, per PFF category, for a season grade to count —
// and the grade that's "solid".
export const PFF_MIN_SNAPS = { passing: 100, rushing: 60, receiving: 100, blocking: 200, defense: 150, kicking: 8, punting: 15 };
export const PFF_SOLID = 65;
// No draft grade, but a grade this high on twice the snaps — flagged for the
// admin to look at (the rules cap PFF at 3★ without a draft grade).
export const PFF_REVIEW = 80;

// CFBD season totals (cfbRosters players[].s) that make a season "solid".
export function solidStats(s) {
  if (!s) return false;
  const v = (cat, k) => Number(s[cat]?.[k]) || 0;
  return v("passing", "YDS") >= 1000
    || v("rushing", "YDS") >= 400
    || v("receiving", "YDS") >= 300 || v("receiving", "REC") >= 25
    || v("defensive", "TOT") >= 30 || v("defensive", "SACKS") >= 3 || v("defensive", "TFL") >= 5
    || v("interceptions", "INT") >= 2
    || v("kicking", "FGM") >= 8
    || v("punting", "NO") >= 20;
}

// { draftAvg, pff: { g, sn, cat }, stats, recruit: { stars, rank } } →
// { stars, basis, review } — the recruiting floor laid over the rest.
export function autoStars({ draftAvg = null, pff = null, stats = null, recruit = null } = {}) {
  const g = baseStars({ draftAvg, pff, stats });
  const floor = recruitFloor(recruit);
  return floor > g.stars ? { stars: floor, basis: "r", review: g.review } : g;
}
function baseStars({ draftAvg = null, pff = null, stats = null } = {}) {
  const fromDraft = starsFromDraft(draftAvg);
  if (fromDraft) return { stars: fromDraft, basis: "d", review: false };
  const min = pff ? PFF_MIN_SNAPS[pff.cat] : null;
  if (pff && min && (pff.sn || 0) >= min && pff.g != null) {
    return { stars: pff.g >= PFF_SOLID ? 3 : 2, basis: "p", review: pff.g >= PFF_REVIEW && pff.sn >= min * 2 };
  }
  if (solidStats(stats)) return { stars: 3, basis: "s", review: false };
  return { stars: 2, basis: stats ? "s" : "n", review: false };
}

// The grade that shows: an override, else the auto grade.
export const effectiveStars = (auto, override) => (override?.s ? override.s : auto || null);

// ── The grader (Admin → Players → Transfer Portal → Grades) ──

// Seasons of eligibility left after this roster season (the 5-year rule:
// recruiting class + 5; without one, CFBD's class year). 0 = done.
// Shared by the stars builder and the Portal Sim pool.
export function eligLeft(p, season) {
  const next = (season || 2026) + 1;
  if (p?.rc) return Math.max(0, Math.min(4, p.rc + 5 - next));
  if (p?.yr) return Math.max(0, 5 - p.yr);
  return 1;
}

// CFBD season totals → a short line ("2,450 pass yds, 18 TD · 310 rush
// yds"), his two biggest categories.
export function statLine(s) {
  if (!s) return "";
  const v = (cat, k) => Number(s[cat]?.[k]) || 0;
  const n = (x) => Math.round(x).toLocaleString("en-US");
  const parts = [
    [v("passing", "YDS"), `${n(v("passing", "YDS"))} pass yds, ${v("passing", "TD")} TD, ${v("passing", "INT")} INT`],
    [v("rushing", "YDS"), `${n(v("rushing", "YDS"))} rush yds, ${v("rushing", "TD")} TD`],
    [v("receiving", "YDS") || v("receiving", "REC"), `${v("receiving", "REC")} rec, ${n(v("receiving", "YDS"))} yds, ${v("receiving", "TD")} TD`],
    [v("defensive", "TOT") * 15, `${v("defensive", "TOT")} tkl, ${v("defensive", "TFL")} TFL, ${v("defensive", "SACKS")} sk`],
    [v("interceptions", "INT") * 60, `${v("interceptions", "INT")} INT`],
    [v("kicking", "FGA") * 30, `${v("kicking", "FGM")}/${v("kicking", "FGA")} FG`],
    [v("punting", "NO") * 10, `${v("punting", "NO")} punts, ${v("punting", "YPP")} avg`],
  ].filter(([w]) => w > 0).sort((a, b) => b[0] - a[0]);
  return parts.slice(0, 2).map(([, t]) => t).join(" · ");
}

// Transfer likeliness (user, 2026-11-14), set by the admin: 3 almost always
// enters the portal, 2 less, 1 even less, 0 never. No value = the Portal
// Sim's own model alone decides. Chances: utils/portalSim/config.js.
export const LIKELY_LABELS = { 0: "Never", 1: "Unlikely", 2: "Likely", 3: "Very likely" };

// config/portalGrades { rows: { [cfbdId | "wd:"+wdId]: code } } — the
// admin's locks and likeliness, one compact string per player so ~25k fit
// in one doc: grade digit or "-", "a" (locked the auto grade) / "m" (set by
// hand) / "-", likeliness digit or "-". e.g. "4a-", "3m2", "--0".
export function decodeGrade(code) {
  const c = String(code || "");
  const s = Number(c[0]) || null;
  const l = /\d/.test(c[2] || "") ? Number(c[2]) : null;
  return { s, auto: c[1] === "a", l };
}
export function encodeGrade({ s = null, auto = false, l = null } = {}) {
  if (!s && l == null) return null; // nothing left — delete the row
  return `${s || "-"}${s ? (auto ? "a" : "m") : "-"}${l == null ? "-" : l}`;
}
