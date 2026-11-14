// scripts/buildPortalStars.js
//
// CLI for server/portal/stars.js — transfer stars (2–6) for every college
// player, from Firestore only (rosters, PFF, community grades). Also runs at
// the end of scripts/syncCfbdRosters.js and from Admin → Players → Transfer
// Portal → Grades "Rebuild".
//
//   node --env-file=.env scripts/buildPortalStars.js         # write
//   node --env-file=.env scripts/buildPortalStars.js --dry   # report only

const { getFirestore } = require("./firebaseAdmin");
const { buildPortalStars } = require("../server/portal/stars");

buildPortalStars(getFirestore(), { dry: process.argv.includes("--dry") })
  .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
