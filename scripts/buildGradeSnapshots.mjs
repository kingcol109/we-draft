// scripts/buildGradeSnapshots.mjs
//
// Rebuilds just the two community-grade snapshot docs — compSnapshots/_grades
// (every player's average grade) and compSnapshots/_top (top prospects per
// class) — between the weekly full build (buildSiteSnapshots.mjs), so a new
// evaluation shows up in grades within a few hours instead of a week. What
// goes in each doc is defined in src/utils/snapshotBuilders.js
// (buildGradeSnapshotDocs), the same code the full build uses.
//
// Cost: every players doc + each player's evaluations subcollection — about
// 3k reads a run (one per player plus one per evaluation), vs. the ~1,500-
// 8,000 per page view the snapshots replace.
//
// Runs from .github/workflows/build-grade-snapshots.yml.
//
// Usage:
//   node --env-file=.env scripts/buildGradeSnapshots.mjs            # write
//   node --env-file=.env scripts/buildGradeSnapshots.mjs --dry-run  # build + report only
import { createRequire } from "module";
import { buildGradeSnapshotDocs } from "../src/utils/snapshotBuilders.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

// Keep in sync with buildSiteSnapshots.mjs.
const ACTIVE_YEARS = ["2027", "2028", "2029"];
const EVAL_READ_CHUNK = 100;
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = getFirestore();
  const playerSnap = await db.collection("players").get();
  const players = playerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const evalsByPlayerId = {};
  let evalDocs = 0;
  for (let i = 0; i < playerSnap.docs.length; i += EVAL_READ_CHUNK) {
    const chunk = playerSnap.docs.slice(i, i + EVAL_READ_CHUNK);
    const snaps = await Promise.all(chunk.map((d) => d.ref.collection("evaluations").select("grade", "strengths", "weaknesses").get()));
    snaps.forEach((snap, j) => { evalsByPlayerId[chunk[j].id] = snap.docs.map((e) => e.data()); evalDocs += snap.size; });
  }

  const docs = buildGradeSnapshotDocs({ players, evalsByPlayerId, activeYears: ACTIVE_YEARS });
  const graded = Object.keys(docs.find((d) => d.id === "_grades").data.rows).length;
  const top = docs.find((d) => d.id === "_top").data.years;
  console.log(`${players.length} players, ${evalDocs} evaluations → ${graded} graded; top lists: ${ACTIVE_YEARS.map((y) => `${y} ${top[y].length}`).join(", ")}`);
  docs.forEach(({ id, data }) => console.log(`  ${id}: ${Math.round(Buffer.byteLength(JSON.stringify(data)) / 1024)}KB`));

  if (DRY_RUN) { console.log("Dry run — nothing written."); return; }
  const batch = db.batch();
  docs.forEach(({ id, data }) => batch.set(db.collection("compSnapshots").doc(id), { ...data, builtAt: FieldValue.serverTimestamp(), builtBy: "grades" }));
  await batch.commit();
  console.log(`Wrote ${docs.length} compSnapshots docs.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
