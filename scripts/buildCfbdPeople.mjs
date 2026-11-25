// scripts/buildCfbdPeople.mjs
//
// compSnapshots/_cfbdPeople (+ _cfbdPeople_0, _1, …) — every player on a
// CFBD roster (cfbRosters/*), one compact string each (see
// src/utils/voice/cfbdRows.js). /voice reads it only when a name isn't on
// We-Draft.com's board, so it can still answer stats for him.
//
//   node -r dotenv/config scripts/buildCfbdPeople.mjs            # write
//   node -r dotenv/config scripts/buildCfbdPeople.mjs --dry-run  # build + report only
//
// Runs weekly with the other snapshots (.github/workflows/build-site-snapshots.yml),
// after the roster sync has refreshed cfbRosters.
import { createRequire } from "module";
import { COMP_SNAPSHOT_VERSION } from "../src/utils/historicalStats.js";
import { cfbdPeopleRows } from "../src/utils/voice/cfbdRows.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const PART_BYTES = 800 * 1024; // each part under Firestore's 1 MiB doc limit
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = getFirestore();
  const snap = await db.collection("cfbRosters").get();
  const { teams, rows } = cfbdPeopleRows(snap.docs.map((d) => d.data()));
  // Split into parts by size.
  const parts = [[]];
  let size = 0;
  rows.forEach((r) => {
    const b = Buffer.byteLength(r) + 3;
    if (size + b > PART_BYTES) { parts.push([]); size = 0; }
    parts[parts.length - 1].push(r);
    size += b;
  });
  const meta = { version: COMP_SNAPSHOT_VERSION, parts: parts.length, total: rows.length, teams };
  const metaBytes = Buffer.byteLength(JSON.stringify(meta));
  console.log(`_cfbdPeople: ${rows.length} players on ${teams.length} rosters, ${parts.length} part(s) of ${parts.map((p) => `${Math.round(Buffer.byteLength(JSON.stringify(p)) / 1024)}KB`).join(", ")}; meta ${Math.round(metaBytes / 1024)}KB`);
  if (DRY_RUN) { console.log("Dry run — nothing written."); return; }
  for (let i = 0; i < parts.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    // One newline-joined string, not an array: Firestore indexes every array
    // entry and caps a doc at 40k index entries (26k rows went over).
    await db.collection("compSnapshots").doc(`_cfbdPeople_${i}`).set({ version: COMP_SNAPSHOT_VERSION, text: parts[i].join("\n"), builtAt: FieldValue.serverTimestamp(), builtBy: "cfbdPeople" });
  }
  await db.collection("compSnapshots").doc("_cfbdPeople").set({ ...meta, builtAt: FieldValue.serverTimestamp(), builtBy: "cfbdPeople" });
  console.log(`Wrote compSnapshots/_cfbdPeople and ${parts.length} part(s).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
