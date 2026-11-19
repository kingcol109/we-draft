// scripts/buildMapSnapshots.mjs
//
// The interactive maps' data (src/utils/mapData.js → pages/MapPage.jsx):
//   compSnapshots/_mapDraft             every FBS school's NFL draftees
//   compSnapshots/_mapRecruits_{slug}   each FBS school's HS recruits by class
// Reads historical + players + draftOrder + schools, and CFBD's recruiting
// classes (FIRST_CLASS through this year + 1). Overwrites the docs each run.
//
//   node --env-file=.env scripts/buildMapSnapshots.mjs                  # write
//   node --env-file=.env scripts/buildMapSnapshots.mjs --dry-run        # build + report only
//   node --env-file=.env scripts/buildMapSnapshots.mjs --dry-run --out dir   # + each doc as dir/{id}.json
//
// Runs weekly after the site snapshots (.github/workflows/build-site-snapshots.yml).
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { buildDraftMapDoc, buildRecruitMapDocs } from "../src/utils/mapData.js";
import { draftedPlayersAsHistorical, COMP_SNAPSHOT_VERSION } from "../src/utils/historicalStats.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const LATEST_DRAFT_YEAR = "2026"; // keep in sync with buildSiteSnapshots.mjs
const FIRST_CLASS = 2010;
const MAX_DOC_BYTES = 900 * 1024;
const DRY_RUN = process.argv.includes("--dry-run");
const outAt = process.argv.indexOf("--out");
const OUT_DIR = outAt > 0 ? process.argv[outAt + 1] : "";

async function cfbdRecruits(year) {
  const res = await fetch(`https://api.collegefootballdata.com/recruiting/players?year=${year}&classification=HighSchool`, {
    headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` },
  });
  if (!res.ok) throw new Error(`CFBD recruiting ${year}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  if (!process.env.CFBD_API_KEY) throw new Error("CFBD_API_KEY is not set.");
  const db = getFirestore();
  const [histSnap, playerSnap, orderSnap, schoolSnap] = await Promise.all([
    db.collection("historical").get(), db.collection("players").get(), db.collection("draftOrder").get(), db.collection("schools").get(),
  ]);
  const players = playerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const schools = schoolSnap.docs.map((d) => d.data());
  // Every draftee: historical, plus the latest class from players + draftOrder.
  const drafted = [
    ...histSnap.docs.map((d) => d.data()).filter((r) => String(r.Year) !== LATEST_DRAFT_YEAR),
    ...draftedPlayersAsHistorical(players.filter((p) => String(p.Eligible) === LATEST_DRAFT_YEAR), orderSnap.docs.map((d) => d.data()), LATEST_DRAFT_YEAR),
  ];

  const lastClass = new Date().getFullYear() + 1;
  const recruits = [];
  for (let y = FIRST_CLASS; y <= lastClass; y++) {
    const rows = await cfbdRecruits(y).catch((e) => { console.warn(e.message); return []; });
    recruits.push(...rows);
    console.log(`CFBD ${y}: ${rows.length} recruits`);
  }

  const docs = [
    { id: "_mapDraft", data: buildDraftMapDoc({ drafted, schools, version: COMP_SNAPSHOT_VERSION }) },
    ...buildRecruitMapDocs({ recruits, schools, players, drafted, version: COMP_SNAPSHOT_VERSION }),
  ];
  let largest = { id: "", bytes: 0 };
  for (const { id, data } of docs) {
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > largest.bytes) largest = { id, bytes };
    if (bytes > MAX_DOC_BYTES) throw new Error(`${id} is ${Math.round(bytes / 1024)}KB — too large for one document`);
  }
  console.log(`Built ${docs.length} docs — ${docs[0].data.total} draftees at ${docs[0].data.schools.length} schools, ${docs.length - 1} recruiting maps. Largest: ${largest.id} ${Math.round(largest.bytes / 1024)}KB`);

  if (DRY_RUN) {
    if (OUT_DIR) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      docs.forEach(({ id, data }) => fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(data)));
      console.log(`Dry run — wrote ${docs.length} files to ${OUT_DIR}, nothing to Firestore.`);
    } else console.log("Dry run — nothing written.");
    return;
  }
  for (let i = 0; i < docs.length; i += 100) {
    const batch = db.batch();
    docs.slice(i, i + 100).forEach(({ id, data }) => batch.set(db.collection("compSnapshots").doc(id), { ...data, builtAt: FieldValue.serverTimestamp(), builtBy: "maps" }));
    await batch.commit();
  }
  console.log(`Wrote ${docs.length} compSnapshots docs.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
