// scripts/importSignees.js
//
// CLI for the high school class import (server/portal/signees.js) — CFBD
// committed recruits → recruits docs. Same code as the admin's Transfer
// Portal → Team Pages "Import signees" (api/portal-sync action "signees").
// Then rebuild the team pages (scripts/buildPortalPages.js) to show them.
//
//   node --env-file=.env scripts/importSignees.js --dry          report only
//   node --env-file=.env scripts/importSignees.js [--year 2027]  write

const { getFirestore } = require("./firebaseAdmin");
const { importSignees } = require("../server/portal/signees");

const args = process.argv.slice(2);
const year = Number(args[args.indexOf("--year") + 1]) || 2027;
importSignees(getFirestore(), { year, dry: args.includes("--dry") })
  .then((r) => { console.log(JSON.stringify(r, null, 1)); process.exit(0); })
  .catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
