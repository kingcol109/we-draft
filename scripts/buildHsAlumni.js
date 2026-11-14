// scripts/buildHsAlumni.js
//
// CLI for the high school pages' data: server/highSchools/hsIndex.js
// (hsAlumni/{id} per school with a logo — current college players, drafted
// alumni, national/state ranks — and the hsAlumni/_rankings_* leaderboards)
// and server/highSchools/alumniIndex.js (offseason/hsCfb, HS Research's
// counts). Built from what's already in Firestore — no CFBD calls. Also
// runs at the end of scripts/syncCfbdRosters.js.
//
//   node --env-file=.env scripts/buildHsAlumni.js

const { getFirestore } = require("./firebaseAdmin");
const { buildHsCfbCounts } = require("../server/highSchools/alumniIndex");
const { buildHsIndex } = require("../server/highSchools/hsIndex");

const db = getFirestore();
Promise.all([buildHsIndex(db), buildHsCfbCounts(db)])
  .then(([pages, counts]) => { console.log(JSON.stringify({ pages, counts })); process.exit(0); })
  .catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
