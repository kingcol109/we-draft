// src/utils/snapshotBuilders.js
//
// Builds every precomputed doc in `compSnapshots` — the read-saving
// snapshots the public pages load instead of scanning whole collections on
// every visit. Pure: takes plain arrays, returns [{ id, data }], touches no
// Firestore SDK — so the exact same build runs from both places that write
// them:
//   - the admin "Rebuild Site Snapshots" button (AdminPanel.js's
//     CompSnapshotRebuild, client SDK), and
//   - the weekly scheduled job (scripts/buildSiteSnapshots.mjs, Admin SDK,
//     .github/workflows/build-site-snapshots.yml).
// Each caller only does its own fetching + writing (adding builtAt).
//
// Docs produced (all carry version: COMP_SNAPSHOT_VERSION — readers ignore
// a doc from a different version and fall back to live reads):
//   {Position}              Comparison.js comp pool — every drafted player
//                           at the position (see encodeCompSnapshotRows).
//   _search                 Comparison.js prospect search box list.
//   class_{Eligible}_{Pos}  Class sidebar lists (PlayerProfile.js +
//                           Comparison.js): Live players only, already in
//                           ranked order, each row with avg community
//                           grade (g), overall class rank (cr), and school
//                           logo (lg); classSize on the doc; `hidden` holds
//                           each not-Live player's own-page placement.
//                           The latest drafted class's docs are instead
//                           ordered by draft pick (order: "draft"), each
//                           row adding rd/pk (round, overall pick), tm
//                           (team abbreviation), tl (team logo) — drafted
//                           players first in pick order, then undrafted
//                           ones in grade order.
//   pct_{Position}          Percentile tables for the player page's
//                           measurement pills (see encodePercentileTable):
//                           cutoffs.all = every drafted player at the
//                           position; cutoffs[latestDraftYear] = classes
//                           before it, so the latest class's own pages
//                           aren't ranked against themselves (same rule
//                           Comparison.js applies).
//   _ads                    Homage margin ads (PlayerProfile.js,
//                           MarginAds.js).
//   _draftTicker            Navbar ticker's draft-pick lines.
//   _grades                 Every player's community grade + traits: rows
//                           { [playerId]: [avg, count, "s1|s2|s3",
//                           "w1|w2|w3"] } (graded players only; top 3
//                           traits each, "|"-joined since Firestore has no
//                           arrays inside arrays) — read through
//                           utils/communityGrades.js instead of one
//                           evaluations query per player.
//   _top                    Top TOP_PER_CLASS graded Live prospects per
//                           active class, best first: years { [Eligible]:
//                           [{ i, F, L, P, S, E, sl, g }] } — the home page
//                           boards and the margin sidebar's leaderboard.
//   _meta                   Summary for the admin panel.
// _grades and _top are also rebuilt on their own, more often, by
// scripts/buildGradeSnapshots.mjs (buildGradeSnapshotDocs below) so
// community grades don't wait for the weekly full build.
import {
  COMP_SNAPSHOT_VERSION, encodeCompSnapshotRows, draftedPlayersAsHistorical,
  communityTraits, isGraded, positionPercentileTables,
} from "./historicalStats.js";

// Same scale PlayerProfile.js / Comparison.js rank the class list by.
const GRADE_SCALE = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
const GRADE_LABELS = Object.fromEntries(Object.entries(GRADE_SCALE).map(([label, v]) => [v, label]));

export function averageGrade(evaluations) {
  const grades = evaluations.map((e) => GRADE_SCALE[e.grade]).filter(Boolean);
  return grades.length ? grades.reduce((a, b) => a + b, 0) / grades.length : null;
}

// PlayerProfile.js's class ranking, exactly: sort by the *rounded* grade
// label's scale value, ungraded last, ties left in input order (callers
// pass players in Firestore's natural document-ID order, which is what the
// live query returns — Array.prototype.sort is stable, so that order
// survives for ties).
export function rankByGrade(list, gradeOf = (x) => x.avgGrade) {
  const rank = (x) => { const g = gradeOf(x); return g != null ? GRADE_SCALE[GRADE_LABELS[Math.round(g)]] : null; };
  return list.sort((a, b) => {
    const aV = rank(a), bV = rank(b);
    if (aV && bV) return aV - bV;
    if (aV && !bV) return -1;
    if (!aV && bV) return 1;
    return 0;
  });
}

const TOP_PER_CLASS = 25;
// Live values the home page boards have always treated as hidden.
const HIDDEN_LIVE = [false, null, 0, "false", "no"];

/**
 * The two grade docs (_grades, _top) on their own — shared by the full
 * build below and scripts/buildGradeSnapshots.mjs.
 * @param {object} input
 * @param {object[]} input.players          every players doc, { id, ...data }
 * @param {object}   input.evalsByPlayerId  { [playerId]: evaluation data[] }
 * @param {string[]} input.activeYears      e.g. ["2027","2028","2029"]
 */
export function buildGradeSnapshotDocs({ players, evalsByPlayerId, activeYears }) {
  const version = COMP_SNAPSHOT_VERSION;
  const rows = {};
  const avgById = {};
  players.forEach((p) => {
    const evals = evalsByPlayerId[p.id] || [];
    const avg = averageGrade(evals);
    if (avg == null) return;
    avgById[p.id] = avg;
    const { strengths, weaknesses } = communityTraits(evals);
    rows[p.id] = [Math.round(avg * 1000) / 1000, evals.filter((e) => GRADE_SCALE[e.grade]).length, strengths.slice(0, 3).join("|"), weaknesses.slice(0, 3).join("|")];
  });
  const years = {};
  activeYears.forEach((yr) => {
    const graded = [...players].sort(byDocId)
      .filter((p) => String(p.Eligible) === String(yr) && !HIDDEN_LIVE.includes(p.Live) && p.Slug && avgById[p.id] != null);
    years[yr] = rankByGrade(graded, (p) => avgById[p.id]).slice(0, TOP_PER_CLASS).map((p) => ({
      i: p.id, F: p.First || "", L: p.Last || "", P: p.Position || "", S: p.School || "", E: String(p.Eligible), sl: p.Slug, g: avgById[p.id],
    }));
  });
  return [
    { id: "_grades", data: { version, rows } },
    { id: "_top", data: { version, years } },
  ];
}

// Firestore returns documents in ascending document-ID order (byte-wise);
// a plain JS string comparison matches that for these ASCII auto-ids.
const byDocId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param {object} input
 * @param {object[]} input.historical   historical docs' data
 * @param {object[]} input.players      every players doc, { id, ...data }
 * @param {object[]} input.draftOrder   draftOrder docs' data
 * @param {object}   input.evalsByPlayerId  { [playerId]: evaluation data[] }
 * @param {object[]} input.schools      schools docs' data
 * @param {object[]} input.ads          ads docs' data
 * @param {object[]} [input.nflTeams]   nfl docs, { id: abbreviation, ...data }
 *                                       (team logos for the drafted class's
 *                                       class lists)
 * @param {string}   input.latestDraftYear  e.g. "2026"
 * @param {string[]} input.activeYears  e.g. ["2027","2028","2029"]
 */
export function buildSiteSnapshotDocs({ historical, players, draftOrder, evalsByPlayerId, schools, ads, nflTeams = [], latestDraftYear, activeYears }) {
  const docs = [];
  const version = COMP_SNAPSHOT_VERSION;
  const evalsOf = (id) => evalsByPlayerId[id] || [];

  // ── Comp pools: historical + the latest drafted class (community traits) ──
  const latestRows = draftedPlayersAsHistorical(
    players.filter((p) => String(p.Eligible) === String(latestDraftYear)),
    draftOrder,
    latestDraftYear
  ).map((r) => {
    const { strengths, weaknesses } = communityTraits(evalsOf(r.id));
    return { ...r, Strengths: strengths, Weaknesses: weaknesses };
  });
  const pool = [...historical.filter((r) => String(r.Year) !== String(latestDraftYear)), ...latestRows];
  const positions = [...new Set(pool.map((r) => r.Position).filter(Boolean))].sort();
  const positionSummary = {};
  positions.forEach((pos) => {
    const rows = encodeCompSnapshotRows(pool.filter((r) => r.Position === pos));
    positionSummary[pos] = { rows: rows.length, graded: rows.filter((r) => r.S).length };
    docs.push({ id: pos, data: { version, position: pos, rows } });
    const posPool = pool.filter((r) => r.Position === pos);
    docs.push({
      id: `pct_${pos}`,
      data: {
        version, position: pos,
        cutoffs: {
          all: positionPercentileTables(posPool),
          [String(latestDraftYear)]: positionPercentileTables(posPool.filter((r) => Number(r.Year) < Number(latestDraftYear))),
        },
      },
    });
  });

  // ── Prospect search index ──
  const searchRows = players
    .filter((p) => activeYears.includes(String(p.Eligible)) && p.Slug)
    .sort((a, b) => `${a.Last || ""} ${a.First || ""}`.localeCompare(`${b.Last || ""} ${b.First || ""}`))
    .map((p) => ({ i: p.id, F: p.First || "", L: p.Last || "", P: p.Position || "", S: p.School || "", E: String(p.Eligible || ""), sl: p.Slug }));
  docs.push({ id: "_search", data: { version, rows: searchRows } });

  // ── Class lists (ranked, with overall class rank + size) ──
  // A not-Live player's own page still shows the sidebar with *them*
  // slotted in (PlayerProfile.js ranks the Live class + self), but they're
  // not in anyone else's list — so each one gets a precomputed placement in
  // its group doc's `hidden` map: { cr: overall rank with them added, pi:
  // their index in the position list, g, lg }. classSize on the doc is the
  // Live count; their page adds 1.
  const logoBySchool = Object.fromEntries(schools.filter((s) => s.School).map((s) => [s.School, s.Logo1 || ""]));
  const avgGradeById = {};
  const byClass = {};
  const hiddenByClass = {};
  [...players].sort(byDocId).forEach((p) => {
    if (!p.Eligible) return;
    avgGradeById[p.id] = averageGrade(evalsOf(p.id));
    const bucket = p.Live === false ? hiddenByClass : byClass;
    (bucket[String(p.Eligible)] || (bucket[String(p.Eligible)] = [])).push(p);
  });
  const gradeOf = (p) => avgGradeById[p.id];
  let classListCount = 0;
  [...new Set([...Object.keys(byClass), ...Object.keys(hiddenByClass)])].forEach((eligible) => {
    const classPlayers = byClass[eligible] || [];
    const ranked = rankByGrade([...classPlayers], gradeOf);
    const classSize = ranked.length;
    const groups = {};
    const group = (pos) => groups[pos] || (groups[pos] = { rows: [], hidden: {} });
    ranked.forEach((p, idx) => {
      if (!p.Position) return;
      group(p.Position).rows.push({
        i: p.id, F: p.First || "", L: p.Last || "", s: p.School || "", sl: p.Slug || "",
        g: gradeOf(p), cr: idx + 1, lg: logoBySchool[p.School] || "",
      });
    });
    (hiddenByClass[eligible] || []).forEach((self) => {
      if (!self.Position) return;
      const withSelf = rankByGrade([...classPlayers, self].sort(byDocId), gradeOf);
      group(self.Position).hidden[self.id] = {
        cr: withSelf.indexOf(self) + 1,
        pi: withSelf.filter((p) => p.Position === self.Position).indexOf(self),
        g: gradeOf(self),
        lg: logoBySchool[self.School] || "",
      };
    });
    const isDraftedClass = eligible === String(latestDraftYear);
    if (isDraftedClass) {
      const pickBySlug = Object.fromEntries(draftOrder.filter((d) => d.Selection).map((d) => [d.Selection, d]));
      const teamLogo = Object.fromEntries(nflTeams.map((t) => [t.id, t.Logo1 || t.LogoDark || ""]));
      const slugById = Object.fromEntries(players.map((p) => [p.id, p.Slug]));
      // Drafted first by overall pick, undrafted after in their existing
      // (grade) order — ties can't happen between real picks.
      const orderKey = (id, fallbackIdx) => { const d = pickBySlug[slugById[id]]; return d ? Number(d.Pick) : 100000 + fallbackIdx; };
      Object.values(groups).forEach((g) => {
        g.rows.forEach((r) => {
          const d = pickBySlug[r.sl];
          if (d) { r.rd = Number(d.Round); r.pk = Number(d.Pick); r.tm = d.Team || ""; r.tl = teamLogo[d.Team] || ""; }
        });
        const keyed = g.rows.map((r, idx) => ({ r, k: orderKey(r.i, idx) }));
        keyed.sort((a, b) => a.k - b.k);
        g.rows = keyed.map((x) => x.r);
        Object.entries(g.hidden).forEach(([id, h]) => {
          const d = pickBySlug[slugById[id]];
          if (d) { h.rd = Number(d.Round); h.pk = Number(d.Pick); h.tm = d.Team || ""; h.tl = teamLogo[d.Team] || ""; }
          const selfKey = orderKey(id, h.pi);
          h.pi = keyed.filter((x) => x.k < selfKey).length;
        });
      });
    }
    Object.entries(groups).forEach(([pos, { rows, hidden }]) => {
      classListCount += 1;
      docs.push({ id: `class_${eligible}_${pos}`, data: { version, eligible, position: pos, classSize, rows, hidden, ...(isDraftedClass ? { order: "draft" } : {}) } });
    });
  });

  // ── Ads (only complete ones, same filter every reader applies) ──
  docs.push({ id: "_ads", data: { version, rows: ads.filter((a) => a.Link && a.Image1) } });

  // ── Navbar ticker's draft lines: rounds 1-2 in pick order, same text ──
  const parts = [];
  let currentRound = null;
  draftOrder
    .filter((p) => Number(p.Round) <= 2)
    .sort((a, b) => Number(a.Round) - Number(b.Round) || Number(a.Pick) - Number(b.Pick))
    .forEach((p) => {
      if (p.Round !== currentRound) { currentRound = p.Round; parts.push(`ROUND ${currentRound}`); }
      parts.push(p.Selection ? `PICK ${p.Pick}: ${p.Team} ${p.Selection.toUpperCase()}` : `PICK ${p.Pick}: ${p.Team}`);
    });
  docs.push({ id: "_draftTicker", data: { version, parts } });

  docs.push(...buildGradeSnapshotDocs({ players, evalsByPlayerId, activeYears }));

  const gradedComps = Object.values(positionSummary).reduce((a, s) => a + s.graded, 0);
  docs.push({
    id: "_meta",
    data: {
      version, positions: positionSummary, searchRows: searchRows.length, classLists: classListCount,
      ads: ads.length, gradedComps, gradedHistorical: historical.filter(isGraded).length,
    },
  });
  return docs;
}
