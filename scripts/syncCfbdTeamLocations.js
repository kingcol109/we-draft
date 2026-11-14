// scripts/syncCfbdTeamLocations.js
//
// Adds each school's location from its CollegeFootballData team (linked by
// CFBDTeamId — scripts/mapCfbdTeams.js): City, State (two-letter), and
// Latitude/Longitude of its home stadium (for nearest-NFL-team math).
// Only writes fields that changed; a school with no CFBDTeamId is listed
// and skipped.
//
// Dry run by default. 1 CFBD call (/teams); CFBD_CACHE_DIR reuses a saved
// response.
//
// Run with: node --env-file=.env scripts/syncCfbdTeamLocations.js [--write]

const { getFirestore } = require("./firebaseAdmin");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");
const { cached } = require("./cfbdCache");

const SEASON = 2026;
const WRITE = process.argv.includes("--write");

async function run() {
  const db = getFirestore();
  const [teams, schoolsSnap] = await Promise.all([
    cached(`teams-${SEASON}`, () => cfbd.teams(SEASON)),
    db.collection("schools").get(),
  ]);
  const byId = new Map(teams.map((t) => [t.id, t]));

  const updates = [];
  const skipped = [];
  for (const d of schoolsSnap.docs) {
    const s = d.data();
    const t = s.CFBDTeamId != null ? byId.get(Number(s.CFBDTeamId)) : null;
    const loc = t?.location || {};
    if (!t || !loc.city) { skipped.push(`${s.School} (${t ? "no location" : "no CFBD team"})`); continue; }
    const next = {
      City: loc.city,
      State: loc.state || "",
      Latitude: loc.latitude ?? null,
      Longitude: loc.longitude ?? null,
    };
    const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => s[k] !== v));
    if (Object.keys(changed).length) updates.push({ ref: d.ref, school: s.School, changed, next });
  }

  updates.forEach((u) => console.log(`${u.school} → ${u.next.City}, ${u.next.State} (${u.next.Latitude}, ${u.next.Longitude})`));
  if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);
  console.log(`\n${updates.length} to write, ${schoolsSnap.size - updates.length - skipped.length} unchanged, ${skipped.length} skipped. CFBD calls: ${getCallCount()}.`);

  if (!WRITE) { console.log("Dry run — rerun with --write to apply."); return; }
  let batch = db.batch(), ops = 0;
  for (const u of updates) {
    batch.update(u.ref, u.changed);
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops) await batch.commit();
  console.log(`Wrote ${updates.length}.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
