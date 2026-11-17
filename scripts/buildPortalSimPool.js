// scripts/buildPortalSimPool.js
//
// CLI for server/portalSim/pool.js — the Portal Sim's compact player pool
// (portalSimPool/*), from Firestore only. Also runs at the end of
// scripts/syncCfbdRosters.js. A written pool rebuilds the public portal
// team pages after it (server/portal/public.js).
//
//   node --env-file=.env scripts/buildPortalSimPool.js         # write
//   node --env-file=.env scripts/buildPortalSimPool.js --dry   # report only

const { getFirestore } = require("./firebaseAdmin");
const { buildPortalSimPool } = require("../server/portalSim/pool");
const { buildPortalPages } = require("../server/portal/public");

const dry = process.argv.includes("--dry");
buildPortalSimPool(getFirestore(), { dry })
  .then(async (r) => {
    console.log(JSON.stringify(r));
    if (!dry) console.log(JSON.stringify(await buildPortalPages(getFirestore())));
    process.exit(0);
  })
  .catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
