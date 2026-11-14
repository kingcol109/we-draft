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
// An admin override (portalStars/_overrides) always wins.
//
// PFF only ever decides a star here — its numbers never leave the admin
// side (memory: PFF data is admin-only; number-free derived outputs are OK).

export const STAR_LABELS = { 6: "6-Star", 5: "5-Star", 4: "4-Star", 3: "3-Star", 2: "2-Star" };

// What a grade came from: draft grade, PFF, stats, nothing — or an admin.
export const BASIS = { d: "Draft grade", p: "PFF", s: "Stats", n: "No data", o: "Admin override" };

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

// { draftAvg, pff: { g, sn, cat }, stats } → { stars, basis, review }.
export function autoStars({ draftAvg = null, pff = null, stats = null } = {}) {
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
