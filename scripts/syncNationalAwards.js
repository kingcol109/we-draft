// scripts/syncNationalAwards.js
//
// CLI for server/awards/nationalAwards.js — ESPN's college football national
// award winners (Heisman, Doak Walker, …) into awards/{season} and
// awards/_byAthlete, for the player page's Career Path. No API key.
//
//   node --env-file=.env scripts/syncNationalAwards.js
//   node --env-file=.env scripts/syncNationalAwards.js --through 2026

const { getFirestore } = require("./firebaseAdmin");
const { syncNationalAwards } = require("../server/awards/nationalAwards");

const args = process.argv.slice(2);
const through = Number(args[args.indexOf("--through") + 1]) || undefined;

syncNationalAwards(getFirestore(), { through })
  .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error(e.message || e); process.exit(1); });
