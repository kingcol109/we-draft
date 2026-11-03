// src/utils/nflEvaluations.js
//
// NFL player evaluations — the NFL page's Evaluation tab (components/
// NflEvaluationTab.jsx), a drafted player's version of the prospect page's
// evaluations: a player or developmental grade instead of a round grade,
// plus strengths, weaknesses and a written take, public or private.
//
//   nflPlayers/{slug}/evaluations/{uid}   each user's evaluation (public-read,
//                                         like players/{id}/evaluations — a
//                                         private one holds no written take)
//   users/{uid}/nflEvaluations/{slug}     the owner's own full copy (private)
//   users/{uid}/nflArchivedEvaluations/{slug}
//                                         his archived snapshot — one per
//                                         player, read-only, owner-only
//
// Pages aren't empty on day one: every player starts from a We-Draft
// baseline (baselineFor) that counts as BASELINE_VOTES evaluations, so the
// community's evaluations fade it out as they come in (communityView):
//   grade   the admin's grade from Admin → Research (depthNotes.js tags,
//           mirrored public in nflPlayerGrades — adminGradeFor); without
//           one, his team's depth chart — a starter at his position is an
//           Average Starter, the next few Quality Depth, the rest Depth
//   traits  his pre-draft strengths/weaknesses — the community's for a
//           player who had a prospect page, his historical card's otherwise
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { POSITION_GROUPS, fetchEspnRoster, fetchDepthOrder, depthRanker } from "./nflRoster";

// Two grade scales, best first, and an evaluation holds one grade from
// either: the player grades for what he is now, the developmental grades
// for a younger player's ceiling. `chip` is a shorter label for the grade
// badge, where the full one runs long. Watchlist is on neither — like the
// prospect page's, it counts toward no average.
export const NFL_GRADES = [
  { label: "Elite", short: "ELT", bg: "#3B6D11", border: "#27500A" },
  { label: "Difference Maker", short: "DM", bg: "#0F6E56", border: "#085041" },
  { label: "Quality Starter", short: "QS", bg: "#185FA5", border: "#0C447C" },
  { label: "Average Starter", chip: "Starter", short: "AS", bg: "#378ADD", border: "#185FA5" },
  { label: "Quality Depth", short: "QD", bg: "#BA7517", border: "#854F0B" },
  { label: "Depth", short: "DP", bg: "#5F5E5A", border: "#444441" },
  { label: "Practice Squad", short: "PS", bg: "#2C2C2A", border: "#1A1A19" },
];
export const DEV_GRADES = [
  { label: "5-Star", short: "5★", bg: "#3C3489", border: "#26215C" },
  { label: "4-Star", short: "4★", bg: "#534AB7", border: "#3C3489" },
  { label: "3-Star", short: "3★", bg: "#7F77DD", border: "#534AB7" },
  { label: "Camp Body", short: "CB", bg: "#6E6A86", border: "#4F4B66" },
];
export const WATCHLIST = { label: "Watchlist", short: "W", bg: "#5F5E5A", border: "#444441" };
// Grades saved under earlier scales, read as their current tier.
const LEGACY = { "Pro Bowl": "Difference Maker", Starter: "Average Starter", Rotational: "Quality Depth", "Plus Depth": "Quality Depth", Backup: "Depth" };
const current = (label) => LEGACY[label] || label;
const SCALES = [NFL_GRADES, DEV_GRADES];
const scaleOf = (label) => SCALES.find((s) => s.some((g) => g.label === current(label))) || null;
export const nflGradeLook = (label) => [WATCHLIST, ...NFL_GRADES, ...DEV_GRADES].find((g) => g.label === current(label)) || null;
const valueOf = (label) => { const s = scaleOf(label); return s ? s.findIndex((g) => g.label === current(label)) + 1 : 0; };
const labelOf = (scale, value) => scale[Math.min(scale.length, Math.max(1, Math.round(value))) - 1].label;

// How many evaluations the baseline counts as, and each baseline trait's
// votes — 3 community picks of a new trait pass a baseline one.
export const BASELINE_VOTES = 5;
const BASELINE_TRAIT_VOTES = 2;
// Strength bars need this many real evaluations (the prospect page's rule).
export const BAR_MIN_EVALS = 5;
export const MAX_TRAITS = 5;

// The NFL season an evaluation belongs to: March starts the next one.
export const currentSeason = (d = new Date()) => (d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1);
// Last season's evaluations count half; older ones a quarter.
const seasonWeight = (season, now) => (season == null || season >= now ? 1 : season === now - 1 ? 0.5 : 0.25);

// Starters at each position group, for the depth-chart baseline.
const STARTERS = {
  Quarterbacks: 1, "Running Backs": 1, "Wide Receivers": 3, "Tight Ends": 1, "Offensive Line": 5,
  "Defensive Line": 3, "Edge Rushers": 2, Linebackers: 2, Cornerbacks: 2, Safeties: 2, "Defensive Backs": 4, Specialists: 1,
};
const groupOf = (pos) => Object.keys(POSITION_GROUPS).find((g) => POSITION_GROUPS[g].includes(pos)) || null;

// His place at his position on his team's depth chart: { rank, starters,
// group } or null. Two reads — ESPN's roster and nflDepthOrder.
export async function depthSpot(teamAbbr, espnId) {
  if (!teamAbbr) return null;
  const [roster, order] = await Promise.all([fetchEspnRoster(teamAbbr).catch(() => []), fetchDepthOrder(teamAbbr).catch(() => [])]);
  const me = roster.find((p) => String(p.id) === String(espnId));
  const group = me && groupOf(me.position);
  if (!group || !order.length) return null;
  const rankOf = depthRanker(order);
  const mates = roster.filter((p) => groupOf(p.position) === group && p.rosterStatus === "active").sort((a, b) => rankOf(a) - rankOf(b));
  const at = mates.findIndex((p) => String(p.id) === String(espnId));
  return at < 0 || rankOf(me) === Infinity ? null : { rank: at + 1, starters: STARTERS[group] || 1, group };
}

// A name as nflPlayerGrades keys it, so ESPN's and PFF's spellings meet:
// "Harold Fannin Jr." → "haroldfannin".
export const nameKey = (name) => String(name || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

// The admin's grade for him (nflPlayerGrades — written with each Research
// tag, depthNotes.js): his name on his team, else his name alone if only
// one player has it. → a grade label or null.
export async function adminGradeFor(name, teamAbbr) {
  const snap = await getDocs(query(collection(db, "nflPlayerGrades"), where("k", "==", nameKey(name)))).catch(() => null);
  const rows = snap ? snap.docs.map((d) => d.data()) : [];
  const row = rows.find((r) => r.team === teamAbbr) || (rows.length === 1 ? rows[0] : null);
  return row?.grade || null;
}

// The baseline: { grade, gradeNote, strengths, weaknesses } — the admin's
// grade, else one from the depth chart (null without either); traits from
// his draft profile.
export function baselineFor(draft, spot, adminGrade = null) {
  let grade = null;
  let gradeNote = "";
  if (adminGrade) {
    grade = adminGrade;
  } else if (spot) {
    grade = spot.rank <= spot.starters ? "Average Starter" : spot.rank <= spot.starters * 2 ? "Quality Depth" : "Depth";
    gradeNote = `No. ${spot.rank} at his position on the depth chart`;
  }
  return { grade, gradeNote, strengths: (draft?.Strengths || []).slice(0, MAX_TRAITS), weaknesses: (draft?.Weaknesses || []).slice(0, MAX_TRAITS) };
}

// The community view — baseline plus evaluations, each weighted by season:
// { grade, avg (its unrounded place on its scale, 1 = best; null for
// Watchlist or none), scale (NFL_GRADES or DEV_GRADES, for the grade's
// meter), real (evaluations counted), weight (their season-weighted total),
// fromBaseline (the baseline still outweighs them), strengths/weaknesses:
// [{ term, pct (share of real evaluations, for bars) }] }.
export function communityView(baseline, evals, now = currentSeason()) {
  // Each scale's season-weighted sum and weight (the baseline is a player
  // grade); the grade comes from whichever scale carries more weight, and
  // is Watchlist when there's nothing to average but a Watchlist.
  const tally = new Map(SCALES.map((sc) => [sc, { sum: 0, w: 0 }]));
  // A Watchlist baseline is no score — it shows only while nothing else does.
  const baseW = scaleOf(baseline?.grade) ? BASELINE_VOTES : 0;
  if (baseW) { const t = tally.get(scaleOf(baseline.grade)); t.sum += valueOf(baseline.grade) * baseW; t.w += baseW; }
  let w = 0;
  evals.forEach((e) => {
    const sc = scaleOf(e.grade);
    if (!sc) return;
    const k = seasonWeight(e.season, now);
    const t = tally.get(sc);
    t.sum += valueOf(e.grade) * k; t.w += k; w += k;
  });
  const [scale, t] = [...tally].sort((a, b) => b[1].w - a[1].w)[0];
  const grade = t.w ? labelOf(scale, t.sum / t.w) : [baseline, ...evals].some((e) => e?.grade === WATCHLIST.label) ? WATCHLIST.label : null;

  const sC = {};
  const wC = {};
  const realS = {};
  const realW = {};
  (baseline?.strengths || []).forEach((t) => { sC[t] = (sC[t] || 0) + BASELINE_TRAIT_VOTES; });
  (baseline?.weaknesses || []).forEach((t) => { wC[t] = (wC[t] || 0) + BASELINE_TRAIT_VOTES; });
  evals.forEach((e) => {
    const k = seasonWeight(e.season, now);
    (e.strengths || []).forEach((t) => { sC[t] = (sC[t] || 0) + k; realS[t] = (realS[t] || 0) + 1; });
    (e.weaknesses || []).forEach((t) => { wC[t] = (wC[t] || 0) + k; realW[t] = (realW[t] || 0) + 1; });
  });
  const reports = evals.length || 1;
  const top = (counts, other, real, strict) => Object.entries(counts)
    .filter(([t, c]) => (strict ? c > (other[t] ?? -Infinity) : c >= (other[t] ?? -Infinity)))
    .sort((a, b) => b[1] - a[1]).slice(0, MAX_TRAITS)
    .map(([term]) => ({ term, pct: ((real[term] || 0) / reports) * 100 }));
  return {
    grade, avg: t.w ? t.sum / t.w : null, scale: t.w ? scale : null, real: evals.length, weight: w, fromBaseline: baseW > w,
    strengths: top(sC, wC, realS, false), weaknesses: top(wC, sC, realW, true),
  };
}

export async function loadNflEvaluations(slug) {
  const snap = await getDocs(collection(db, "nflPlayers", slug, "evaluations")).catch(() => null);
  return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
}

// The signed-in user's own copy (has his private written take).
export async function loadMyNflEvaluation(uid, slug) {
  const snap = await getDoc(doc(db, "users", uid, "nflEvaluations", slug)).catch(() => null);
  return snap?.exists() ? snap.data() : null;
}

// Saves both copies. The public-read one drops the written take when it's
// private (the rules require it).
export async function saveNflEvaluation(uid, slug, data) {
  const full = { ...data, uid, slug, season: currentSeason(), updatedAt: serverTimestamp() };
  const pub = full.visibility === "public" ? full : { ...full, evaluation: "" };
  await Promise.all([
    setDoc(doc(db, "nflPlayers", slug, "evaluations", uid), pub),
    setDoc(doc(db, "users", uid, "nflEvaluations", slug), full),
  ]);
}

// Deletes both copies.
export async function deleteNflEvaluation(uid, slug) {
  await Promise.all([
    deleteDoc(doc(db, "nflPlayers", slug, "evaluations", uid)),
    deleteDoc(doc(db, "users", uid, "nflEvaluations", slug)),
  ]);
}

export async function loadMyNflArchive(uid, slug) {
  const snap = await getDoc(doc(db, "users", uid, "nflArchivedEvaluations", slug)).catch(() => null);
  return snap?.exists() ? snap.data() : null;
}

// Snapshots his saved evaluation as the archive (overwriting any earlier
// one), then deletes the evaluation so he starts fresh — the prospect
// page's archive. Returns the archive, or null when nothing was saved.
export async function archiveNflEvaluation(uid, slug, playerName) {
  const mine = await loadMyNflEvaluation(uid, slug);
  if (!mine) return null;
  const now = new Date();
  const archive = { ...mine, archivedAt: serverTimestamp(), archivedAtISO: now.toISOString(), playerName };
  await setDoc(doc(db, "users", uid, "nflArchivedEvaluations", slug), archive);
  await deleteNflEvaluation(uid, slug);
  return { ...archive, archivedAt: { toDate: () => now } };
}

export const deleteNflArchive = (uid, slug) => deleteDoc(doc(db, "users", uid, "nflArchivedEvaluations", slug));

// ESPN's positions → the traits/ lists' (QB, RB, WR, TE, OL, DL, EDGE,
// LB, DB, K, P); the draft side's positions are those already.
const TRAIT_POS = { FB: "RB", OT: "OL", T: "OL", G: "OL", OG: "OL", C: "OL", DE: "EDGE", DT: "DL", NT: "DL", ILB: "LB", OLB: "LB", MLB: "LB", CB: "DB", S: "DB", FS: "DB", SS: "DB", PK: "K" };

// The trait choices for his position: { "Position Specific": [...], Generic: [...] }.
export async function loadTraitOptions(espnOrDraftPosition) {
  const position = TRAIT_POS[espnOrDraftPosition] || espnOrDraftPosition;
  const [posSnap, genSnap] = await Promise.all([getDoc(doc(db, "traits", position)), getDoc(doc(db, "traits", "Generic"))].map((p) => p.catch(() => null)));
  const out = {};
  if (posSnap?.exists()) out["Position Specific"] = [...(posSnap.data().traits || [])].sort();
  if (genSnap?.exists() && position !== "K" && position !== "P") out.Generic = [...(genSnap.data().traits || [])].sort();
  return out;
}
