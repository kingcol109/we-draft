// scripts/buildVoiceDraftHistory.mjs
//
// compSnapshots/_draftHistory — every NFL draft pick on file (historical,
// 2000 on, plus the latest class from players + draftOrder), one compact
// string each ("year|round|pick|name|position|school|NFL team", see
// src/utils/voice/draft.js). /voice reads it once to answer draft-history
// questions without scanning `historical`.
//
//   node -r dotenv/config scripts/buildVoiceDraftHistory.mjs            # write
//   node -r dotenv/config scripts/buildVoiceDraftHistory.mjs --dry-run  # build + report only
//
// Runs weekly with the other snapshots (.github/workflows/build-site-snapshots.yml).
import { createRequire } from "module";
import { draftedPlayersAsHistorical, COMP_SNAPSHOT_VERSION } from "../src/utils/historicalStats.js";
import { draftRows } from "../src/utils/voice/draftRows.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const LATEST_DRAFT_YEAR = "2026"; // keep in sync with buildSiteSnapshots.mjs / buildMapSnapshots.mjs
const MAX_DOC_BYTES = 900 * 1024;
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = getFirestore();
  const [histSnap, playerSnap, orderSnap] = await Promise.all([
    db.collection("historical").get(),
    db.collection("players").where("Eligible", "==", LATEST_DRAFT_YEAR).get(),
    db.collection("draftOrder").get(),
  ]);
  const drafted = [
    ...histSnap.docs.map((d) => d.data()).filter((r) => String(r.Year) !== LATEST_DRAFT_YEAR),
    ...draftedPlayersAsHistorical(playerSnap.docs.map((d) => ({ id: d.id, ...d.data() })), orderSnap.docs.map((d) => d.data()), LATEST_DRAFT_YEAR),
  ];
  const rows = draftRows(drafted);
  const years = [...new Set(rows.map((r) => r.split("|")[0]))].sort();
  const data = { version: COMP_SNAPSHOT_VERSION, from: years[0], to: years[years.length - 1], total: rows.length, rows };
  const bytes = Buffer.byteLength(JSON.stringify(data));
  if (bytes > MAX_DOC_BYTES) throw new Error(`_draftHistory is ${Math.round(bytes / 1024)}KB — too large for one document`);
  console.log(`_draftHistory: ${rows.length} picks, ${data.from}–${data.to}, ${Math.round(bytes / 1024)}KB`);
  if (DRY_RUN) { console.log("Dry run — nothing written."); return; }
  await db.collection("compSnapshots").doc("_draftHistory").set({ ...data, builtAt: FieldValue.serverTimestamp(), builtBy: "draftHistory" });
  console.log("Wrote compSnapshots/_draftHistory.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
