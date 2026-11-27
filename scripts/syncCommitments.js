// scripts/syncCommitments.js
//
// CLI for the recruits' CFBD commitment sync (server/recruits/commitments.js)
// — the same code as Admin → Players → Recruits "Sync CFBD commitments"
// (api/portal-sync action "commitments") and the daily workflow
// (.github/workflows/sync-recruit-commitments.yml).
//
//   node --env-file=.env scripts/syncCommitments.js --dry        report only
//   node --env-file=.env scripts/syncCommitments.js              write
//   node --env-file=.env scripts/syncCommitments.js --year 2027  one class

const { getFirestore } = require("./firebaseAdmin");
const { syncCommitments } = require("../server/recruits/commitments");

const args = process.argv.slice(2);
const at = args.indexOf("--year");
const years = at >= 0 && Number(args[at + 1]) ? [Number(args[at + 1])] : null;
syncCommitments(getFirestore(), { years, dry: args.includes("--dry") })
  .then((r) => { console.log(JSON.stringify(r, null, 1)); process.exit(0); })
  .catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
