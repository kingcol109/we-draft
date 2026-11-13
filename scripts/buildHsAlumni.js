// scripts/buildHsAlumni.js
//
// CLI for server/highSchools/alumniIndex.js — rebuilds hsAlumni/{id} (every
// current college player from each high school with a team page) and
// offseason/hsCfb (HS Research's college-player counts per high school) from
// the rosters already in Firestore. No CFBD calls. Also runs at the end of
// scripts/syncCfbdRosters.js.
//
//   node --env-file=.env scripts/buildHsAlumni.js

const { getFirestore } = require("./firebaseAdmin");
const { buildHsAlumni, buildHsCfbCounts } = require("../server/highSchools/alumniIndex");

const db = getFirestore();
Promise.all([buildHsAlumni(db), buildHsCfbCounts(db)])
  .then(([alumni, counts]) => { console.log(JSON.stringify({ alumni, counts })); process.exit(0); })
  .catch((e) => { console.error(e.message || e); process.exit(1); });
