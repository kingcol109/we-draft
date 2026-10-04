// src/utils/communityGrades.js
//
// Community grades without one evaluations query per player. Reads the
// precomputed compSnapshots/_grades and _top docs (utils/snapshotBuilders.js
// buildGradeSnapshotDocs, rebuilt every few hours by
// scripts/buildGradeSnapshots.mjs) — one read each per page session. If a
// snapshot is missing or from an older version, falls back to the original
// per-player evaluations reads, so a page never breaks, it just costs more.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { getSiteSnapshot } from "./siteSnapshots";

export const GRADE_SCALE = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
export const GRADE_LABELS = Object.fromEntries(Object.entries(GRADE_SCALE).map(([label, v]) => [v, label]));

// avg (1 = Early First … 10 = UDFA) → its label, e.g. "Second Round".
export const gradeLabel = (avg) => (avg == null ? null : GRADE_LABELS[Math.round(avg)] || null);

async function liveAverage(playerId) {
  try {
    const snap = await getDocs(collection(db, "players", playerId, "evaluations"));
    const grades = snap.docs.map((d) => GRADE_SCALE[d.data().grade]).filter(Boolean);
    return grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
  } catch {
    return null;
  }
}

/**
 * Average community grade for each player id: { [id]: avg | null }.
 * One snapshot read; per-player evaluations reads only if the snapshot is
 * unavailable.
 */
export async function averageGradesFor(ids) {
  const snap = await getSiteSnapshot("_grades");
  if (snap?.rows) return Object.fromEntries(ids.map((id) => [id, snap.rows[id]?.[0] ?? null]));
  const avgs = await Promise.all(ids.map(liveAverage));
  return Object.fromEntries(ids.map((id, i) => [id, avgs[i]]));
}

/**
 * Community grade + top traits for each player id:
 * { [id]: { avg, strengths: [], weaknesses: [] } }. One snapshot read;
 * per-player evaluations reads only if the snapshot is unavailable.
 */
export async function communityFor(ids) {
  const snap = await getSiteSnapshot("_grades");
  if (snap?.rows) {
    return Object.fromEntries(ids.map((id) => {
      const r = snap.rows[id];
      const split = (v) => (v ? String(v).split("|").filter(Boolean) : []);
      return [id, { avg: r?.[0] ?? null, strengths: split(r?.[2]), weaknesses: split(r?.[3]) }];
    }));
  }
  const rows = await Promise.all(ids.map(async (id) => {
    try {
      const evals = (await getDocs(collection(db, "players", id, "evaluations"))).docs.map((d) => d.data());
      const grades = evals.map((e) => GRADE_SCALE[e.grade]).filter(Boolean);
      const count = (key) => {
        const c = {};
        evals.forEach((e) => (Array.isArray(e[key]) ? e[key] : []).forEach((t) => { c[t] = (c[t] || 0) + 1; }));
        return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
      };
      return [id, { avg: grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null, strengths: count("strengths"), weaknesses: count("weaknesses") }];
    } catch {
      return [id, { avg: null, strengths: [], weaknesses: [] }];
    }
  }));
  return Object.fromEntries(rows);
}

/**
 * The top graded Live prospects for the given classes, best first:
 * [{ id, First, Last, Position, School, Eligible, Slug, avgGrade }], or null
 * when the _top snapshot is unavailable (callers keep their live query).
 */
export async function topProspects(years) {
  const snap = await getSiteSnapshot("_top");
  if (!snap?.years) return null;
  const rows = years.flatMap((y) => snap.years[y] || []);
  // Same order as each class list: rounded grade label, ties in list order.
  rows.sort((a, b) => GRADE_SCALE[gradeLabel(a.g)] - GRADE_SCALE[gradeLabel(b.g)]);
  return rows.map((r) => ({ id: r.i, First: r.F, Last: r.L, Position: r.P, School: r.S, Eligible: r.E, Slug: r.sl, avgGrade: r.g }));
}
