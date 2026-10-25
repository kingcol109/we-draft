// src/utils/draftSim/data.js
//
// Everything a Draft Sim needs, loaded once per page session: the draft
// order (components/UpcomingPicks.jsx fetchDraft), the class board with the
// official We-Draft.com ranks (compSnapshots/class_{year}_{Position} —
// prospects_{Position} / live players queries only as a fallback), community
// grades + traits (_grades), every prospect's staff fit for all 32 teams
// plus the staffers' names (nflFit_{Position}), CFBD season stats
// (cfbLeaders/current + tables), each prospect's best game (simGames), the trade chart (config/draftTradeChart),
// team needs (compSnapshots/_teamNeeds — the admin's labels), team branding and the
// draft history (draftHistory.json, Thad Murphy's). The Expanded Board
// (loadExpandedBoard) adds the class's players hidden on the site.
import { doc, getDoc, getDocs, collection, query, where, orderBy, limit } from "firebase/firestore";
import { db } from "../../firebase";
import { fetchDraft, UPCOMING_DRAFTS } from "../../components/UpcomingPicks";
import { fetchProspects, fetchNflBranding } from "../draftProfileData";
import { getSiteSnapshot } from "../siteSnapshots";
import { averageGradesFor, GRADE_SCALE } from "../communityGrades";
import { NFL_TEAMS } from "../coachHistory";
import { SIM_POSITIONS, SPECIALISTS, buildBoard, resolveNeeds } from "./engine";
import { applyDeskLines, applyDeskAvatars, applyDeskLegends, applyPlayerTakes } from "./analysts";
import { bestGame } from "./bestGame.js";

// SIM_YEAR / SIM_YEARS (years.js): the class drafted by default, and every
// class it can draft. A thin class's board only fills a few rounds —
// maxRounds says how many.
import { SIM_YEAR, SIM_YEARS } from "./years";
export { SIM_YEAR, SIM_YEARS };
// Scored in bestGame.js (shared with the weekly snapshot build).
export { bestGame };
export const maxRounds = (board) => Math.max(1, Math.min(7, Math.floor(board.filter((p) => !SPECIALISTS.includes(p.Position)).length / 32)));

const cache = {};
const once = (key, load) => {
  if (!cache[key]) cache[key] = load().catch((e) => { delete cache[key]; throw e; });
  return cache[key];
};

// Just what the setup screen shows: order + branding + staff names.
export function loadSimSetup(year = SIM_YEAR) {
  return once(`setup:${year}`, async () => {
    const next = UPCOMING_DRAFTS.find((d) => Number(d.year) === Number(year) + 1);
    // (The fourth result, the desk lines, applies itself — nothing to keep.)
    const [draft, branding, staff, , future] = await Promise.all([
      fetchDraft(UPCOMING_DRAFTS.find((d) => d.year === year) || UPCOMING_DRAFTS[0]),
      fetchNflBranding().catch(() => ({})),
      getSiteSnapshot("nflFit_QB").then((s) => s?.staff || {}).catch(() => ({})),
      loadDeskLines(),
      // Next year's picks trade too (engine FUTURE_DISCOUNT).
      next ? fetchDraft(next).then((d) => d.picks || []).catch(() => []) : [],
    ]);
    return { year, order: draft.picks || [], futureOrder: future, futureYear: next ? Number(next.year) : null, branding, staff };
  });
}

// The desk's admin-edited lines and profile pictures (config/
// draftSimDesk), applied over the built-ins in analysts.js. Missing or
// unreadable → the built-ins.
export function loadDeskLines() {
  return once("deskLines", () => getDoc(doc(db, "config", "draftSimDesk"))
    .then((snap) => {
      const d = snap.exists() ? snap.data() : {};
      applyDeskLines(d.lines || {});
      applyDeskAvatars(d.avatars || {});
      applyDeskLegends(d.legends, d.otherSchools);
    })
    .catch(() => {}));
}

// Kenneth Cold's written player takes (config/draftSimAnalysis.players),
// applied to the desk. Missing or unreadable → none (he stays quiet).
export function loadPlayerTakes() {
  return once("playerTakes", () => getDoc(doc(db, "config", "draftSimAnalysis"))
    .then((snap) => { applyPlayerTakes(snap.exists() ? snap.data().players || {} : {}); })
    .catch(() => {}));
}

// A players doc's Height ("6-2", "6'2") in inches.
const inches = (h) => { const m = String(h || "").match(/^(\d)['-](\d{1,2})/); return m ? Number(m[1]) * 12 + Number(m[2]) : null; };

// The class's prospects with their official class rank (cr), plus the
// kickers and punters (SPECIALISTS — their snapshots are optional). Each
// carries `hiddenOf`: the snapshot's not-Live players at that position
// ({ [id]: { cr, F, L, … } }), for the Expanded Board.
const fromRow = (r, pos) => ({
  id: r.i, First: r.F || "", Last: r.L || "", Position: pos, School: r.s || "", Slug: r.sl, logo: r.lg || "", logoDark: r.ld, cr: r.cr ?? null,
  subPosition: r.sp || null, height: r.ht ?? null, weight: r.wt ?? null,
});
async function classProspects(year) {
  const fromSnapshot = (d, pos) => d.rows.map((r) => fromRow(r, pos));
  const hiddenOf = (d, pos) => Object.entries(d?.hidden || {}).map(([i, h]) => ({ ...h, i, pos }));
  const [docs, specialistDocs] = await Promise.all([
    Promise.all(SIM_POSITIONS.map((pos) => getSiteSnapshot(`class_${year}_${pos}`))),
    Promise.all(SPECIALISTS.map((pos) => getSiteSnapshot(`class_${year}_${pos}`).catch(() => null))),
  ]);
  const specialists = specialistDocs.map((d, i) => (Array.isArray(d?.rows) ? fromSnapshot(d, SPECIALISTS[i]) : []));
  const hidden = [...docs.flatMap((d, i) => hiddenOf(d, SIM_POSITIONS[i])), ...specialistDocs.flatMap((d, i) => hiddenOf(d, SPECIALISTS[i]))];
  if (docs.every((d) => Array.isArray(d?.rows))) {
    const list = [...docs.flatMap((d, i) => fromSnapshot(d, SIM_POSITIONS[i])), ...specialists.flat()];
    list.hidden = hidden;
    return list;
  }
  const lists = await Promise.all(SIM_POSITIONS.map((pos) => fetchProspects(year, pos).catch(() => [])));
  return [...lists.flat().map((p) => ({
    ...p, subPosition: p.subPosition || p.SubPositionOverride || p.SubPosition || null,
    height: p.height ?? inches(p.Height), weight: p.weight ?? (parseFloat(p.Weight) || null),
  })), ...specialists.flat()];
}

// Every team's needs: { [team]: { [NEED_KEY]: { labels, note } } }. None
// (an empty map — no team leans any way) if they can't be read. One read:
// compSnapshots/_teamNeeds, all 32 teams, kept in step with nflTeamNeeds by
// the admin's save (AdminTeamNeeds.jsx) — the 32 team docs only if it's
// missing.
async function loadNeeds() {
  const combined = await getSiteSnapshot("_teamNeeds");
  if (combined?.needs) return Object.fromEntries(Object.entries(combined.needs).map(([team, needs]) => [team, resolveNeeds(needs)]));
  const snap = await getDocs(collection(db, "nflTeamNeeds"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, resolveNeeds(d.data().needs)]));
}

// Every prospect's logoDark — LogoBlack, else LogoDark, else Logo1 — set
// before the sim renders, so no logo swaps in late. A class snapshot with
// `ld` already has it; older ones (and the fallback queries) get it from
// the schools docs, 30 names per query.
async function withDarkLogos(prospects) {
  const missing = [...new Set(prospects.filter((p) => p.logoDark == null && p.School).map((p) => p.School))];
  const bySchool = {};
  const chunks = [];
  for (let i = 0; i < missing.length; i += 30) chunks.push(missing.slice(i, i + 30));
  await Promise.all(chunks.map((c) => getDocs(query(collection(db, "schools"), where("School", "in", c)))
    .then((snap) => snap.docs.forEach((d) => {
      const s = d.data();
      bySchool[s.School] = s.LogoBlack || s.LogoDark || s.Logo1 || "";
    }))
    .catch(() => {})));
  return prospects.map((p) => ({ ...p, logoDark: p.logoDark || bySchool[p.School] || p.logo || "" }));
}

// A player's standout game this season, for Isaac: { line: "4 sacks",
// opp: "Tennessee" } or null. From his linked CFBD player's game logs
// (cfbdPlayers where wedraftPlayerId, then its games — see
// components/PlayerStatsCard.js). Cached per player for the page session.
// Every class prospect's best game this season, precomputed weekly
// (compSnapshots/simGames, scripts/buildSimGamesSnapshot.mjs): one read a
// session instead of ~20 per pick. null when it's missing or another
// season's.
const simGames = (season) => getSiteSnapshot("simGames").then((d) => (d?.rows && d.season === Number(season) ? d.rows : null));

export function loadBestGame(playerId, season) {
  return once(`game:${playerId}`, async () => {
    const rows = await simGames(season);
    if (rows) return rows[playerId] || null;
    // No snapshot: the player's own game log (two queries).
    const snap = await getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", playerId), limit(1)));
    const linked = snap.docs[0];
    if (!linked || !["verified", "suggested"].includes(linked.data().mappingStatus)) return null;
    const games = await getDocs(query(collection(db, "cfbdPlayers", linked.id, "games"), orderBy("startDate", "desc"), limit(20)));
    return bestGame(games.docs.map((d) => d.data()).filter((g) => !season || g.season === Number(season)));
  });
}

// CFBD season stats by player slug: { season, bySlug: { [slug]: {
//   leaders: [{ key, title, group, v, rank, tied }] — national top-50 spots,
//   lines: { passing|rushing|receiving|defensive|…: { STAT: value } } } } }.
export function loadCfbStats() {
  return once("cfbStats", async () => {
    const [cur, tables] = await Promise.all([
      getDoc(doc(db, "cfbLeaders", "current")).then((s) => s.data() || null).catch(() => null),
      getDoc(doc(db, "cfbLeaders", "tables")).then((s) => s.data() || null).catch(() => null),
    ]);
    const bySlug = {};
    const entry = (slug) => bySlug[slug] || (bySlug[slug] = { leaders: [], lines: {} });
    (cur?.categories || []).forEach((c) => {
      (c.rows || []).forEach((r) => {
        if (!r.slug) return;
        const first = c.rows.findIndex((x) => x.v === r.v);
        const tied = c.rows.filter((x) => x.v === r.v).length > 1;
        entry(r.slug).leaders.push({ key: c.key, title: c.title, group: c.group, v: r.v, rank: first + 1, tied });
      });
    });
    Object.values(tables?.tables || {}).flat().forEach((r) => {
      if (r.slug) Object.assign(entry(r.slug).lines, r.s || {});
    });
    return { season: cur?.season || tables?.season || null, bySlug };
  });
}

export function loadSimData(year = SIM_YEAR) {
  return once(`data:${year}`, async () => {
    const [setup, chart, gradesSnap, prospectList, fitDocs, cfb, needs, history] = await Promise.all([
      loadSimSetup(year),
      getDoc(doc(db, "config", "draftTradeChart")).then((s) => (s.exists() ? s.data().values || {} : {})).catch(() => ({})),
      getSiteSnapshot("_grades").catch(() => null),
      classProspects(year).then(async (list) => Object.assign(await withDarkLogos(list), { hidden: list.hidden || [] })),
      Promise.all(SIM_POSITIONS.map((pos) => getSiteSnapshot(`nflFit_${pos}`).catch(() => null))),
      loadCfbStats().catch(() => ({ season: null, bySlug: {} })),
      loadNeeds().catch(() => ({})),
      // Every real draft pick since 2000, for Thad Murphy (its own chunk).
      import("./draftHistory.json").then((m) => m.default || m).catch(() => null),
      loadDeskLines(),
      loadPlayerTakes(),
    ]);
    const prospects = prospectList.filter((p) => p.id && p.Slug);
    let grades = gradesSnap?.rows || null;
    if (!grades) {
      const avgs = await averageGradesFor(prospects.map((p) => p.id));
      grades = Object.fromEntries(Object.entries(avgs).filter(([, v]) => v != null).map(([id, v]) => [id, [v, 0]]));
    }
    const fits = {};
    const staff = { ...setup.staff };
    fitDocs.forEach((d) => {
      Object.assign(fits, d?.rows || {});
      Object.entries(d?.staff || {}).forEach(([team, slots]) => { staff[team] = { ...(staff[team] || {}), ...slots }; });
    });
    // Warm the best-games snapshot before the first pick needs it.
    simGames(cfb.season).catch(() => null);
    return {
      ...setup, staff, chart, needs, history, season: cfb.season, board: buildBoard(prospects, grades, fits, cfb.bySlug),
      // What loadExpandedBoard rebuilds the board from.
      inputs: { prospects, hidden: prospectList.hidden || [], grades, fits, stats: cfb.bySlug },
    };
  });
}

// The Expanded Board: the class board plus its players hidden on the site
// (players.Live === false), each at the class rank he'd hold with him added
// (the snapshot's `hidden` placement). Free once the class snapshots carry
// their names (snapshotBuilders.js); until a rebuild, one query for the
// class's hidden players.
export function loadExpandedBoard(year = SIM_YEAR) {
  return once(`expanded:${year}`, async () => {
    const { inputs } = await loadSimData(year);
    let extra = inputs.hidden.filter((h) => h.F && h.sl).map((h) => ({ ...fromRow(h, h.pos), hidden: true }));
    if (extra.length < inputs.hidden.length) {
      const placed = Object.fromEntries(inputs.hidden.map((h) => [h.i, h]));
      const snap = await getDocs(query(collection(db, "players"), where("Eligible", "==", String(year)), where("Live", "==", false)));
      extra = await withDarkLogos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.Slug && p.Position && (SIM_POSITIONS.includes(p.Position) || SPECIALISTS.includes(p.Position)))
        .map((p) => ({
          id: p.id, First: p.First || "", Last: p.Last || "", Position: p.Position, School: p.School || "", Slug: p.Slug,
          logo: placed[p.id]?.lg || "", cr: placed[p.id]?.cr ?? null, hidden: true,
          subPosition: p.SubPositionOverride || p.SubPosition || null, height: inches(p.Height), weight: parseFloat(p.Weight) || null,
        })));
    }
    const ids = new Set(inputs.prospects.map((p) => p.id));
    const prospects = [...inputs.prospects, ...extra.filter((p) => !ids.has(p.id))];
    return buildBoard(prospects, inputs.grades, inputs.fits, inputs.stats);
  });
}

// A signed-in user's own grades, for "My Board": { [playerId]: 1 … 10 }
// from their mirror (users/{uid}/evaluations — one query, every class; the
// board only uses its own players'). Watchlist and other non-round grades
// are left out, so those players keep the community grade. Not cached:
// a grade saved in another tab shows up on the next visit to setup.
export async function loadMyGrades(uid) {
  const snap = await getDocs(collection(db, "users", uid, "evaluations"));
  const out = {};
  snap.docs.forEach((d) => {
    const v = GRADE_SCALE[d.data().grade];
    if (v != null) out[d.data().playerId || d.id] = v;
  });
  return out;
}

// Display names, from branding when it's loaded.
export function teamNamer(branding = {}) {
  const teamName = (abbr) => {
    const b = branding[abbr];
    return b?.Team ? `${b.City || ""} ${b.Team}`.trim() : NFL_TEAMS[abbr] || abbr;
  };
  const nickname = (abbr) => branding[abbr]?.Team || (NFL_TEAMS[abbr] || abbr).split(" ").pop();
  const city = (abbr) => branding[abbr]?.City || (NFL_TEAMS[abbr] || "").split(" ").slice(0, -1).join(" ");
  return { teamName, nickname, city };
}
