// scripts/buildSiteSnapshots.mjs
//
// Weekly rebuild of every precomputed `compSnapshots` doc — the read-saving
// snapshots the public pages load instead of scanning whole collections
// per visit (comparison comp pools + search index, class sidebar lists with
// grades/ranks, margin ads, navbar draft ticker). What goes in each doc is
// defined once in src/utils/snapshotBuilders.js and shared with the admin
// panel's on-demand "Rebuild Site Snapshots" button, so both produce
// identical output; this script only does the Admin SDK reads + writes.
//
// Runs from .github/workflows/build-site-snapshots.yml (weekly, plus
// workflow_dispatch). Idempotent — every run fully overwrites the docs
// from current data. ~12k reads per run (all of historical, players, and
// each player's evaluations), vs. the ~1,500+ per page view it replaces.
//
// ESM (.mjs) so it can import the app's own builder directly; needs Node
// 22+ (the builder's .js files use ESM syntax in a package without
// "type": "module", which Node 22 detects automatically).
//
// Usage:
//   node --env-file=.env scripts/buildSiteSnapshots.mjs            # write
//   node --env-file=.env scripts/buildSiteSnapshots.mjs --dry-run  # build + report only
import { createRequire } from "module";
import { buildSiteSnapshotDocs } from "../src/utils/snapshotBuilders.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

// Keep in sync with Comparison.js / AdminPanel.js (LATEST_DRAFT_YEAR,
// ACTIVE_YEARS) — the class that's drafted but not yet migrated into
// `historical`, and the classes that are still prospects.
const LATEST_DRAFT_YEAR = "2026";
const ACTIVE_YEARS = ["2027", "2028", "2029"];
const MAX_DOC_BYTES = 900 * 1024; // under Firestore's 1 MiB doc cap
const EVAL_READ_CHUNK = 100;
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = getFirestore();
  const t0 = Date.now();

  const [histSnap, playerSnap, orderSnap, schoolSnap, adSnap, nflSnap] = await Promise.all([
    db.collection("historical").get(),
    db.collection("players").get(),
    db.collection("draftOrder").get(),
    db.collection("schools").get(),
    db.collection("ads").get(),
    db.collection("nfl").get(),
  ]);
  const players = playerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`Read historical ${histSnap.size}, players ${players.length}, draftOrder ${orderSnap.size}, schools ${schoolSnap.size}, ads ${adSnap.size}`);

  const evalsByPlayerId = {};
  let evalDocs = 0;
  for (let i = 0; i < playerSnap.docs.length; i += EVAL_READ_CHUNK) {
    const chunk = playerSnap.docs.slice(i, i + EVAL_READ_CHUNK);
    const snaps = await Promise.all(chunk.map((d) => d.ref.collection("evaluations").get()));
    snaps.forEach((snap, j) => { evalsByPlayerId[chunk[j].id] = snap.docs.map((e) => e.data()); evalDocs += snap.size; });
  }
  console.log(`Read ${evalDocs} evaluations across ${players.length} players`);

  const docs = buildSiteSnapshotDocs({
    historical: histSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    players,
    draftOrder: orderSnap.docs.map((d) => d.data()),
    evalsByPlayerId,
    schools: schoolSnap.docs.map((d) => d.data()),
    ads: adSnap.docs.map((d) => d.data()),
    nflTeams: nflSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    latestDraftYear: LATEST_DRAFT_YEAR,
    activeYears: ACTIVE_YEARS,
  });

  let largest = { id: "", bytes: 0 };
  for (const { id, data } of docs) {
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > largest.bytes) largest = { id, bytes };
    if (bytes > MAX_DOC_BYTES) throw new Error(`${id} is ${Math.round(bytes / 1024)}KB — too large for one document`);
  }
  const meta = docs.find((d) => d.id === "_meta").data;
  console.log(`Built ${docs.length} docs — ${meta.gradedComps} graded comps, ${meta.classLists} class lists, ${meta.searchRows} searchable prospects, ${meta.ads} ads. Largest: ${largest.id} ${Math.round(largest.bytes / 1024)}KB`);

  if (DRY_RUN) {
    console.log("Dry run — nothing written.");
    return;
  }
  const batch = db.batch();
  docs.forEach(({ id, data }) => {
    batch.set(db.collection("compSnapshots").doc(id), { ...data, builtAt: FieldValue.serverTimestamp(), builtBy: "schedule" });
  });
  await batch.commit();
  console.log(`Wrote ${docs.length} compSnapshots docs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
