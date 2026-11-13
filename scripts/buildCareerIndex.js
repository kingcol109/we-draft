// scripts/buildCareerIndex.js
//
// CLI for server/offseason/careerIndex.js — rebuilds offseason/careers (the
// Eligibility Manager's CFBD career stops, high schools and JUCO stops).
// About 2 CFBD calls per season since 2019. Run once a season, after the
// new rosters are out.
//
//   node --env-file=.env scripts/buildCareerIndex.js

const { getFirestore } = require("./firebaseAdmin");
const { buildCareerIndex } = require("../server/offseason/careerIndex");

buildCareerIndex(getFirestore())
  .then((r) => { console.log(JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error(e.message || e); process.exit(1); });
