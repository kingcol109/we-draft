// scripts/buildOffseasonIndex.js
//
// CLI for server/offseason/cfbdIndex.js — rebuilds offseason/cfbd (the
// Eligibility Manager's CFBD recruit years and roster schools) from the
// cfbRosters / cfbdPlayers already in Firestore. No CFBD calls.
//
//   node --env-file=.env scripts/buildOffseasonIndex.js

const { getFirestore } = require("./firebaseAdmin");
const { buildCfbdIndex } = require("../server/offseason/cfbdIndex");

buildCfbdIndex(getFirestore())
  .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error(e.message || e); process.exit(1); });
