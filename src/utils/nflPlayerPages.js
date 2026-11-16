// src/utils/nflPlayerPages.js
//
// NFL player pages (concept): a drafted player's page at his prospect slug
// (/player/sam-darnold-2018-qb), built from ESPN's NFL athlete API for the
// live side — bio, team, season-by-season stats, game log, news — and our
// own data for the draft side (fetchDraftProfile), from one of two sources:
//   historical  a player drafted before the site — his `historical` row
//               (pick, We-Draft retro grade, strengths/weaknesses, combine)
//               and his class from `historical`
//   prospect    a player who had a We-Draft page before the draft — his
//               `players` doc (measurements, bio), the community's grade and
//               traits from his evaluations, his pick from `draftOrder`, and
//               his class from its class snapshot (the prospect page's own
//               drafted-class list)
//
// Which slugs get one, and from which source: ./nflPlayerSlugs.js.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { NFL_TEAMS } from "./coachHistory";
import { GRADE_SCALE, gradeLabel } from "./communityGrades";
import { gradeCounts } from "./gradeWindow";
import { getSiteSnapshot } from "./siteSnapshots";
import { classSnapshotRanks } from "./classRanks";

export { NFL_PLAYER_PAGES } from "./nflPlayerSlugs";

// site.web.api — site.api.espn.com fails CORS in the browser.
const BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes";
const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export const fetchNflAthlete = (id) => getJson(`${BASE}/${id}`).then((j) => j?.athlete || null);
export const fetchNflOverview = (id) => getJson(`${BASE}/${id}/overview`);
export const fetchNflCareer = (id) => getJson(`${BASE}/${id}/stats`);
export const fetchNflGameLog = (id, season) => getJson(`${BASE}/${id}/gamelog${season ? `?season=${season}` : ""}`);

async function fetchHistoricalRow(id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, "historical", id)).catch(() => null);
  return snap?.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ESPN's career stats → { [category]: { labels, rows: [{ year, team, stats }], totals } },
// team being its abbreviation (ESPN's `teams` is keyed by slug).
export function careerTables(career) {
  if (!career?.categories) return {};
  const abbrOf = (slug) => career.teams?.[slug]?.abbreviation || "";
  return Object.fromEntries(career.categories.map((c) => [c.name, {
    labels: (c.labels || []).map((l) => String(l).trim()),
    rows: (c.statistics || []).map((r) => ({ year: r.season?.year, team: abbrOf(r.teamSlug), stats: r.stats || [] })),
    totals: c.totals || [],
  }]));
}

// Consecutive seasons with one team → [{ team, from, to }], oldest first.
export function teamStints(rows) {
  const out = [];
  [...rows].sort((a, b) => a.year - b.year).forEach((r) => {
    const last = out[out.length - 1];
    if (last && last.team === r.team) last.to = r.year;
    else if (r.team) out.push({ team: r.team, from: r.year, to: r.year });
  });
  return out;
}

// ESPN's game log → [{ id, week, date, atVs, opp, oppLogo, result, score, stats }],
// newest first, with its column labels and their unique stat keys (names —
// labels repeat: rushing and receiving "YDS").
export function gameLogRows(log) {
  const cat = log?.seasonTypes?.find((t) => /regular/i.test(t.displayName || ""))?.categories?.[0] || log?.seasonTypes?.[0]?.categories?.[0];
  const rows = (cat?.events || []).map((ev) => {
    const g = log.events?.[ev.eventId] || {};
    return {
      id: ev.eventId, week: g.week, date: g.gameDate, atVs: g.atVs || "", opp: g.opponent?.abbreviation || "",
      oppLogo: g.opponent?.logo || "", result: g.gameResult || "", score: g.score || "", stats: ev.stats || [],
    };
  });
  return { labels: (log?.labels || []).map((l) => String(l).trim()), names: log?.names || [], rows: rows.sort((a, b) => (b.week || 0) - (a.week || 0)) };
}

// His draft class at his position from `historical`, in pick order:
// [{ id, First, Last, Round, Pick, team, School, slug }]. Two equality
// filters — Firestore serves those from its single-field indexes.
async function fetchHistoricalClass(year, position) {
  if (!year || !position) return [];
  const snap = await getDocs(query(collection(db, "historical"), where("Year", "==", String(year)), where("Position", "==", position))).catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const r = d.data();
    return {
      id: d.id, First: r.First || "", Last: r.Last || "", Round: parseInt(r.Round, 10) || null, Pick: parseInt(r.Pick, 10) || null,
      teamName: r["NFL Team"] || "", School: r.School || "", slug: prospectSlug(r.First, r.Last, year, position),
    };
  }).sort((a, b) => (a.Pick ?? 999) - (b.Pick ?? 999));
}

// A prospect slug: "sam-darnold-2018-qb".
export const prospectSlug = (first, last, year, pos) => `${first} ${last} ${year} ${pos}`.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s-]+/g, "-");

// Strength/weakness bars need enough evaluations to mean something — the
// prospect page's own threshold.
export const TRAIT_BAR_MIN_EVALS = 5;

// The draft side of the page, in the historical row's shape whichever the
// source — { id, First, Last, Position, School, Year, Round, Pick,
// "NFL Team", RoundGrade, Strengths, Weaknesses, ...measurements } plus
// source, gradeTitle, traitPct ({ [trait]: share of evaluations }, prospect
// with enough evaluations only), classRank/classSize/positionRank and Bio —
// and his class: [{ id, First, Last, Round, Pick, teamName, slug }] in pick
// order, drafted first — and, for a prospect, his evaluations [{ id (the
// author's uid), grade, strengths, weaknesses, nflFit, evaluation, … }].
export async function fetchDraftProfile(cfg) {
  if (!cfg.historicalId && !cfg.playerId) return { draft: null, classRows: [] };
  if (cfg.historicalId) {
    const row = await fetchHistoricalRow(cfg.historicalId);
    if (!row) return { draft: null, classRows: [] };
    const classRows = await fetchHistoricalClass(row.Year, row.Position);
    return { draft: { ...row, source: "historical", gradeTitle: "We-Draft Grade", gradeNote: "Graded from his pre-draft profile" }, classRows };
  }
  const snap = await getDoc(doc(db, "players", cfg.playerId)).catch(() => null);
  if (!snap?.exists()) return { draft: null, classRows: [] };
  const p = { id: snap.id, ...snap.data() };
  const [picks, evals, classDoc] = await Promise.all([
    getDocs(query(collection(db, "draftOrder"), where("Selection", "==", p.Slug))).catch(() => null),
    getDocs(collection(db, "players", p.id, "evaluations")).catch(() => null),
    getSiteSnapshot(`class_${p.Eligible}_${p.Position}`).catch(() => null),
  ]);
  const pick = picks?.docs[0]?.data() || null;

  // The community's grade and traits, as the prospect page counts them.
  const evalDocs = evals ? evals.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  const grades = evalDocs.filter((e) => GRADE_SCALE[e.grade] && gradeCounts(e, p.Eligible)).map((e) => GRADE_SCALE[e.grade]);
  const sC = {};
  const wC = {};
  evalDocs.forEach((e) => {
    (e.strengths || []).forEach((t) => { sC[t] = (sC[t] || 0) + 1; });
    (e.weaknesses || []).forEach((t) => { wC[t] = (wC[t] || 0) + 1; });
  });
  const reports = evalDocs.filter((e) => e.grade !== "Watchlist" || (e.strengths?.length || 0) + (e.weaknesses?.length || 0) > 0).length || 1;
  const top = (counts, other, strict) => Object.entries(counts).filter(([t, c]) => (strict ? c > (other[t] ?? -Infinity) : c >= (other[t] ?? -Infinity)))
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  const strengths = top(sC, wC, false);
  const weaknesses = top(wC, sC, true);
  const traitPct = evalDocs.length >= TRAIT_BAR_MIN_EVALS
    ? Object.fromEntries([...strengths, ...weaknesses].map(([t, c]) => [t, (c / reports) * 100])) : null;

  const ranks = classSnapshotRanks(classDoc)[p.id] || {};
  const classRows = (classDoc?.rows || []).map((r) => ({
    id: r.i, First: r.F || "", Last: r.L || "", Round: r.rd ?? null, Pick: r.pk ?? null, teamName: NFL_TEAMS[r.tm] || "", slug: r.sl || "",
  }));

  return {
    draft: {
      ...p, source: "prospect", Year: String(p.Eligible), Round: pick?.Round ?? null, Pick: pick?.Pick ?? null, "NFL Team": NFL_TEAMS[pick?.Team] || "",
      RoundGrade: grades.length ? gradeLabel(grades.reduce((a, b) => a + b, 0) / grades.length) : "",
      gradeTitle: "Community Grade", gradeNote: "His final pre-draft grade from the We-Draft community",
      Strengths: strengths.map(([t]) => t), Weaknesses: weaknesses.map(([t]) => t), traitPct,
      classRank: ranks.classRank ?? null, classSize: classDoc?.classSize || 0, positionRank: ranks.positionRank ?? null, Bio: p.bio || p.Bio || "",
    },
    classRows,
    // Each evaluation's doc id is its author's uid — the page shows the
    // signed-in user his own.
    evaluations: evalDocs,
  };
}
