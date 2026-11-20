// scripts/buildHsAlumni.js
//
// CLI for the high school pages' data: server/highSchools/hsIndex.js
// (hsAlumni/{id} per school with a logo — current college players, drafted
// alumni, national/state ranks — the hsAlumni/_rankings_* leaderboards, and
// the /hs hub + state docs hsAlumni/_hub, _state_{ST}) and
// server/highSchools/alumniIndex.js (offseason/hsCfb, HS Research's
// counts). Built from what's already in Firestore — no CFBD calls. Also
// runs at the end of scripts/syncCfbdRosters.js.
//
//   node --env-file=.env scripts/buildHsAlumni.js                  # everything
//   node --env-file=.env scripts/buildHsAlumni.js --geo-only       # only _hub + _state_* docs
//   node --env-file=.env scripts/buildHsAlumni.js --dry-run --out dir   # write nothing; hub/state docs as dir/{id}.json

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("./firebaseAdmin");
const { buildHsCfbCounts } = require("../server/highSchools/alumniIndex");
const { buildHsIndex } = require("../server/highSchools/hsIndex");

const db = getFirestore();
const DRY = process.argv.includes("--dry-run");
const GEO_ONLY = process.argv.includes("--geo-only");
const outAt = process.argv.indexOf("--out");
const OUT_DIR = outAt > 0 ? process.argv[outAt + 1] : "";

async function main() {
  if (DRY) {
    const { geoDocs } = await buildHsIndex(db, { dryRun: true });
    for (const [id, data] of geoDocs) {
      const json = JSON.stringify(data);
      console.log(`${id}: ${Math.round(Buffer.byteLength(json) / 1024)}KB${data.schools ? `, ${data.schools.length} schools, ${data.located} placed` : ""}`);
      if (OUT_DIR) { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), json); }
    }
    console.log("Dry run — nothing written.");
    return;
  }
  if (GEO_ONLY) { console.log(JSON.stringify(await buildHsIndex(db, { geoOnly: true }))); return; }
  const [pages, counts] = await Promise.all([buildHsIndex(db), buildHsCfbCounts(db)]);
  console.log(JSON.stringify({ pages, counts }));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
