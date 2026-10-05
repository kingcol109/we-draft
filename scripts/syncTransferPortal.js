// scripts/syncTransferPortal.js
//
// CLI for the transfer portal sync (server/portal/sync.js) — the same code
// the admin panel's "Run sync" button runs through api/portal-sync.js.
// Not scheduled: on demand only.
//
//   node --env-file=.env scripts/syncTransferPortal.js          2027 portal
//   node --env-file=.env scripts/syncTransferPortal.js --year 2026

const { getFirestore } = require("./firebaseAdmin");
const { runPortalSync } = require("../server/portal/sync");

const args = process.argv.slice(2);
const year = Number(args[args.indexOf("--year") + 1]) || 2027;

runPortalSync(getFirestore(), { year })
  .then((r) => console.log(JSON.stringify(r)))
  .catch((e) => { console.error(e.message || e); process.exit(1); });
