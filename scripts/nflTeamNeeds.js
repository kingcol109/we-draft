// scripts/nflTeamNeeds.js
//
// Two things derived from the PFF NFL depth charts (pffNflRosters/{abbr},
// scripts/syncPffNflRosters.js), each written to its own public collection
// — neither carries a grade, snap count or any other PFF number, since PFF
// data itself is back office only:
//
//   nflDepthOrder/{abbr}  { season, order: [name, …] } — the team's players
//       by season snaps, most first (depth-chart order breaks ties and
//       orders anyone who hasn't played). NFLTeamPage.jsx sorts each
//       position group of its ESPN roster by it. Order only — the snaps
//       themselves are never shown.
//   nflTeamNeeds/{abbr}   { season, needs: { QB: "Not a Need", … } } — one
//       NEED_LABELS value for every POSITION. Saved for display later.
//
// The reasoning behind each need (starter grade, its rank among the 32,
// starter age, quality backups) goes on the admin-only pffNflRosters doc as
// `needs`, for the back office.
//
// How a position's need is decided, first match wins:
//   Extreme Need   starters (top `starters` by snaps, snap-weighted grade)
//                  rank 28th or worse in the league, or grade under 50
//   Needs Talent   starters rank 20th–27th
//   Aging Talent   starters rank top 19, but their snap-weighted age is at
//                  or past the position's `old` age
//   Needs Depth    starters are fine, but fewer than `backups` backups have
//                  played real snaps (MIN_BACKUP_SNAPS) at a 60+ grade
//   Not a Need     otherwise
//
// syncPffNflRosters.js runs this after each sync. Also runnable on its own
// against the docs already in Firestore (no PFF calls):
//   node --env-file=.env scripts/nflTeamNeeds.js        add --dry to print only

const NEED_LABELS = ["Not a Need", "Extreme Need", "Needs Depth", "Needs Talent", "Aging Talent"];

// Same groups as src/components/AdminResearch.js GROUPS. starters: how many
// of the group's top players by snaps start; old: the starters' age where
// the group counts as aging; backups: how many proven backups it should
// carry.
const POSITIONS = [
  { key: "QB", pos: ["QB"], starters: 1, old: 35, backups: 0 },
  { key: "RB", pos: ["HB", "FB"], starters: 1, old: 28, backups: 1 },
  { key: "WR", pos: ["WR"], starters: 3, old: 30, backups: 1 },
  { key: "TE", pos: ["TE"], starters: 1, old: 31, backups: 1 },
  { key: "OL", pos: ["T", "G", "C"], starters: 5, old: 31, backups: 1 },
  { key: "IDL", pos: ["DI"], starters: 2, old: 31, backups: 1 },
  { key: "EDGE", pos: ["ED"], starters: 2, old: 30, backups: 1 },
  { key: "LB", pos: ["LB"], starters: 2, old: 30, backups: 1 },
  { key: "CB", pos: ["CB"], starters: 3, old: 29, backups: 1 },
  { key: "S", pos: ["S"], starters: 2, old: 30, backups: 1 },
];
const EXTREME_RANK = 28;
const TALENT_RANK = 20;
const EXTREME_GRADE = 50;
const BACKUP_GRADE = 60;
const MIN_BACKUP_SNAPS = 15;

const ageOf = (dob) => (dob ? (Date.now() - Date.parse(dob)) / (365.25 * 24 * 3600 * 1000) : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
// Weighted mean of value(p) by weight(p), over players with both.
function weighted(list, value, weight) {
  const vals = list.map((p) => [value(p), weight(p)]).filter(([v, w]) => v != null && w > 0);
  const total = vals.reduce((a, [, w]) => a + w, 0);
  return total ? vals.reduce((a, [v, w]) => a + v * w, 0) / total : null;
}
const bySnaps = (a, b) => (b.sn || 0) - (a.sn || 0) || (a.d || 99) - (b.d || 99);

// One team doc's position → { starters, grade, age, backups }.
function summarize(team) {
  const current = (team.players || []).filter((p) => !p.off);
  const out = {};
  POSITIONS.forEach((P) => {
    const list = current.filter((p) => P.pos.includes(p.pos)).sort(bySnaps);
    const hasSnaps = list.some((p) => p.sn);
    // Before anyone has snaps (preseason), PFF's depth-chart starters.
    const starters = hasSnaps ? list.slice(0, P.starters) : list.filter((p) => p.d === 1).slice(0, P.starters);
    const ids = new Set(starters.map((p) => p.id));
    out[P.key] = {
      starters: starters.map((p) => p.n),
      grade: weighted(starters, (p) => p.g, (p) => (hasSnaps ? p.sn || 0 : 1)),
      age: weighted(starters, (p) => ageOf(p.dob), (p) => (hasSnaps ? p.sn || 0 : 1) || 1),
      backups: list.filter((p) => !ids.has(p.id) && (p.g || 0) >= BACKUP_GRADE && (p.sn || 0) >= MIN_BACKUP_SNAPS).length,
    };
  });
  return out;
}

// teams: pffNflRosters docs → { [abbr]: { [pos]: { need, grade, rank, age, backups, starters } } }.
function computeNeeds(teams) {
  const summaries = Object.fromEntries(teams.map((t) => [t.abbr, summarize(t)]));
  const result = Object.fromEntries(teams.map((t) => [t.abbr, {}]));
  POSITIONS.forEach((P) => {
    const ranked = teams.map((t) => t.abbr).filter((a) => summaries[a][P.key].grade != null)
      .sort((a, b) => summaries[b][P.key].grade - summaries[a][P.key].grade);
    teams.forEach(({ abbr }) => {
      const s = summaries[abbr][P.key];
      const rank = ranked.includes(abbr) ? ranked.indexOf(abbr) + 1 : null;
      let need;
      if (rank == null || rank >= EXTREME_RANK || s.grade < EXTREME_GRADE) need = "Extreme Need";
      else if (rank >= TALENT_RANK) need = "Needs Talent";
      else if (s.age != null && s.age >= P.old) need = "Aging Talent";
      else if (s.backups < P.backups) need = "Needs Depth";
      else need = "Not a Need";
      result[abbr][P.key] = { need, grade: round1(s.grade), rank, age: round1(s.age), backups: s.backups, starters: s.starters };
    });
  });
  return result;
}

// One team doc → its players' names by season snaps, most first.
const depthOrder = (team) => (team.players || []).filter((p) => !p.off).sort(bySnaps).map((p) => p.n);

// Writes nflDepthOrder + nflTeamNeeds for every team, and the reasoning onto
// pffNflRosters. teams: pffNflRosters docs (each with abbr + season).
async function writeNeeds(db, FieldValue, teams, { dry = false } = {}) {
  const needs = computeNeeds(teams);
  if (dry) return needs;
  const batch = db.batch();
  teams.forEach((t) => {
    const n = needs[t.abbr];
    const at = FieldValue.serverTimestamp();
    batch.set(db.collection("nflDepthOrder").doc(t.abbr), { abbr: t.abbr, season: t.season, order: depthOrder(t), updatedAt: at });
    batch.set(db.collection("nflTeamNeeds").doc(t.abbr), {
      abbr: t.abbr, season: t.season,
      needs: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, v.need])),
      updatedAt: at,
    });
    batch.set(db.collection("pffNflRosters").doc(t.abbr), { needs: n }, { merge: true });
  });
  await batch.commit();
  return needs;
}

module.exports = { NEED_LABELS, POSITIONS, computeNeeds, depthOrder, writeNeeds };

if (require.main === module) {
  const { getFirestore } = require("./firebaseAdmin");
  const { FieldValue } = require("firebase-admin/firestore");
  const dry = process.argv.includes("--dry");
  (async () => {
    const db = getFirestore();
    const teams = (await db.collection("pffNflRosters").get()).docs.map((d) => d.data());
    const needs = await writeNeeds(db, FieldValue, teams, { dry });
    const tally = {};
    Object.entries(needs).sort(([a], [b]) => a.localeCompare(b)).forEach(([abbr, n]) => {
      console.log(abbr.padEnd(4), POSITIONS.map((P) => `${P.key}:${n[P.key].need}`).join("  "));
      Object.values(n).forEach((v) => { tally[v.need] = (tally[v.need] || 0) + 1; });
    });
    console.log(`${dry ? "[dry] " : ""}${teams.length} teams.`, tally);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
