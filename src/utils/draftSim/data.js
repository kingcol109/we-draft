// src/utils/draftSim/data.js
//
// Everything a Draft Sim needs, loaded once per page session: the draft
// order (components/UpcomingPicks.jsx fetchDraft), the class board with the
// official We-Draft.com ranks (compSnapshots/class_{year}_{Position} —
// prospects_{Position} / live players queries only as a fallback), community
// grades + traits (_grades), every prospect's staff fit for all 32 teams
// plus the staffers' names (nflFit_{Position}), CFBD season stats
// (cfbLeaders/current + tables), the trade chart (config/draftTradeChart),
// team needs (nflTeamNeeds — the admin's labels), team branding and the
// draft history (draftHistory.json, Thad Murphy's).
import { doc, getDoc, getDocs, collection, query, where, orderBy, limit } from "firebase/firestore";
import { db } from "../../firebase";
import { fetchDraft, UPCOMING_DRAFTS } from "../../components/UpcomingPicks";
import { fetchProspects, fetchNflBranding } from "../draftProfileData";
import { getSiteSnapshot } from "../siteSnapshots";
import { averageGradesFor, GRADE_SCALE } from "../communityGrades";
import { NFL_TEAMS } from "../coachHistory";
import { SIM_POSITIONS, SPECIALISTS, buildBoard, resolveNeeds } from "./engine";
import { applyDeskLines, applyDeskAvatars, applyDeskLegends, applyPlayerTakes } from "./analysts";

// SIM_YEAR / SIM_YEARS (years.js): the class drafted by default, and every
// class it can draft. A thin class's board only fills a few rounds —
// maxRounds says how many.
import { SIM_YEAR, SIM_YEARS } from "./years";
export { SIM_YEAR, SIM_YEARS };
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

// The class's prospects with their official class rank (cr), plus the
// kickers and punters (SPECIALISTS — their snapshots are optional).
async function classProspects(year) {
  const fromSnapshot = (d, pos) => d.rows.map((r) => ({
    id: r.i, First: r.F || "", Last: r.L || "", Position: pos, School: r.s || "", Slug: r.sl, logo: r.lg || "", logoDark: r.ld, cr: r.cr ?? null,
    subPosition: r.sp || null, height: r.ht ?? null, weight: r.wt ?? null,
  }));
  const [docs, specialists] = await Promise.all([
    Promise.all(SIM_POSITIONS.map((pos) => getSiteSnapshot(`class_${year}_${pos}`))),
    Promise.all(SPECIALISTS.map((pos) => getSiteSnapshot(`class_${year}_${pos}`).then((d) => (Array.isArray(d?.rows) ? fromSnapshot(d, pos) : [])))),
  ]);
  if (docs.every((d) => Array.isArray(d?.rows))) {
    return [...docs.flatMap((d, i) => fromSnapshot(d, SIM_POSITIONS[i])), ...specialists.flat()];
  }
  const lists = await Promise.all(SIM_POSITIONS.map((pos) => fetchProspects(year, pos).catch(() => [])));
  const inches = (h) => { const m = String(h || "").match(/^(\d)['-](\d{1,2})/); return m ? Number(m[1]) * 12 + Number(m[2]) : null; };
  return [...lists.flat().map((p) => ({
    ...p, subPosition: p.subPosition || p.SubPositionOverride || p.SubPosition || null,
    height: p.height ?? inches(p.Height), weight: p.weight ?? (parseFloat(p.Weight) || null),
  })), ...specialists.flat()];
}

// Every team's needs: { [team]: { [NEED_KEY]: { labels, note } } }. None
// (an empty map — no team leans any way) if they can't be read.
async function loadNeeds() {
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
export function loadBestGame(playerId, season) {
  return once(`game:${playerId}`, async () => {
    const snap = await getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", playerId), limit(1)));
    const linked = snap.docs[0];
    if (!linked || !["verified", "suggested"].includes(linked.data().mappingStatus)) return null;
    const games = await getDocs(query(collection(db, "cfbdPlayers", linked.id, "games"), orderBy("startDate", "desc"), limit(20)));
    return bestGame(games.docs.map((d) => d.data()).filter((g) => !season || g.season === Number(season)));
  });
}

// The best single-game line across a game log (box-score format:
// { defensive: { SACKS: "4" } }), only if it's genuinely big.
export function bestGame(games) {
  const num = (v) => parseFloat(v) || 0;
  const plural = (n, one, many) => `${n % 1 ? n.toFixed(1) : n} ${n === 1 ? one : many}`;
  let best = null;
  games.forEach((g) => {
    const s = g.stats || {};
    const d = s.defensive || {}, ints = s.interceptions || {}, pa = s.passing || {}, ru = s.rushing || {}, re = s.receiving || {};
    const options = [
      [num(d.SACKS) >= 2, num(d.SACKS) * 3, plural(num(d.SACKS), "sack", "sacks")],
      [num(ints.INT) >= 2, num(ints.INT) * 3.5, plural(num(ints.INT), "interception", "interceptions")],
      [num(d.TFL) >= 3, num(d.TFL) * 2, plural(num(d.TFL), "tackle for loss", "tackles for loss")],
      [num(d.TOT) >= 12, num(d.TOT) * 0.5, plural(num(d.TOT), "tackle", "tackles")],
      [num(pa.YDS) >= 350, num(pa.YDS) / 60, `${num(pa.YDS)} passing yards`],
      [num(pa.TD) >= 4, num(pa.TD) * 1.8, plural(num(pa.TD), "touchdown pass", "touchdown passes")],
      [num(ru.YDS) >= 150, num(ru.YDS) / 30, `${num(ru.YDS)} rushing yards`],
      [num(ru.TD) >= 3, num(ru.TD) * 2, plural(num(ru.TD), "rushing touchdown", "rushing touchdowns")],
      [num(re.YDS) >= 150, num(re.YDS) / 30, `${num(re.YDS)} receiving yards`],
      [num(re.REC) >= 10, num(re.REC) * 0.6, plural(num(re.REC), "catch", "catches")],
      [num(re.TD) >= 3, num(re.TD) * 2, plural(num(re.TD), "touchdown catch", "touchdown catches")],
    ];
    options.forEach(([ok, score, line]) => {
      if (ok && g.opponent && (!best || score > best.score)) best = { score, line, opp: g.opponent };
    });
  });
  return best && { line: best.line, opp: best.opp };
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
      classProspects(year).then(withDarkLogos),
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
    return { ...setup, staff, chart, needs, history, season: cfb.season, board: buildBoard(prospects, grades, fits, cfb.bySlug) };
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
