// scripts/buildPortalSimPool.js
//
// CLI for server/portalSim/pool.js — the Portal Sim's compact player pool
// (portalSimPool/*), from Firestore only. Also runs at the end of
// scripts/syncCfbdRosters.js.
//
//   node --env-file=.env scripts/buildPortalSimPool.js         # write
//   node --env-file=.env scripts/buildPortalSimPool.js --dry   # report only

const { getFirestore } = require("./firebaseAdmin");
const { buildPortalSimPool } = require("../server/portalSim/pool");

buildPortalSimPool(getFirestore(), { dry: process.argv.includes("--dry") })
  .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
