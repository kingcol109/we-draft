// scripts/mapCfbdTeams.js
//
// Links each schools/{id} doc to its CollegeFootballData team: writes
// CFBDTeamId, CFBDName and CFBDMatch { method: "auto", via, matchedAt }.
// A school whose CFBDMatch.method is "manual" is never touched — that's
// how a hand correction sticks across reruns. Matching rules (exact name →
// TEAM_ALIASES → CFBD alternate names) live in server/live/mapping.js.
//
// Dry run by default — prints the report and writes nothing. Add --write
// to apply. Costs 1 CFBD call (/teams); set CFBD_CACHE_DIR to reuse a
// saved response across reruns for free.
//
// Run with: node --env-file=.env scripts/mapCfbdTeams.js [--write]

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");
const { matchTeam } = require("../server/live/mapping");
const { cached } = require("./cfbdCache");

const SEASON = 2026;
const WRITE = process.argv.includes("--write");

async function run() {
  const db = getFirestore();
  const [teams, schoolsSnap] = await Promise.all([
    cached(`teams-${SEASON}`, () => cfbd.teams(SEASON)),
    db.collection("schools").get(),
  ]);

  const updates = [];
  const unmatched = [];
  let manual = 0, unchanged = 0;
  for (const d of schoolsSnap.docs) {
    const s = d.data();
    if (s.CFBDMatch?.method === "manual") { manual++; continue; }
    const { team, via, candidates } = matchTeam(s.School, teams);
    if (!team) { unmatched.push(`${s.School} → ${candidates?.length ? candidates.map((t) => t.school).join(" | ") : "no CFBD team"}`); continue; }
    if (s.CFBDTeamId === team.id && s.CFBDName === team.school) { unchanged++; continue; }
    updates.push({ ref: d.ref, school: s.School, team, via, was: s.CFBDTeamId });
  }

  for (const u of updates) {
    const note = u.via === "exact" ? "" : ` (${u.via})`;
    console.log(`${u.was != null ? "CHANGE" : "NEW   "} ${u.school} → ${u.team.school} #${u.team.id} [${u.team.classification}]${note}`);
  }
  if (unmatched.length) console.log(`\nUnmatched (add to TEAM_ALIASES in server/live/mapping.js if needed):\n  ${unmatched.join("\n  ")}`);
  console.log(`\n${updates.length} to write, ${unchanged} already mapped, ${manual} manual (skipped), ${unmatched.length} unmatched. CFBD calls: ${getCallCount()}.`);

  if (!WRITE) { console.log("Dry run — rerun with --write to apply."); return; }
  let batch = db.batch(), ops = 0;
  for (const u of updates) {
    batch.update(u.ref, {
      CFBDTeamId: u.team.id,
      CFBDName: u.team.school,
      CFBDMatch: { method: "auto", via: u.via, matchedAt: FieldValue.serverTimestamp() },
    });
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops) await batch.commit();
  console.log(`Wrote ${updates.length} schools.`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
