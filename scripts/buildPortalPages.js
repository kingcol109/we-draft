// scripts/buildPortalPages.js
//
// CLI for the public Transfer Portal's team data (server/portal/public.js):
// compSnapshots/_portal_{team} + _portal_board. Same code as the admin's
// Transfer Portal → Team Pages "Rebuild" (api/portal-sync action "pages").
//
//   node --env-file=.env scripts/buildPortalPages.js           write
//   node --env-file=.env scripts/buildPortalPages.js --dry     report only

const { getFirestore } = require("./firebaseAdmin");
const { buildPortalPages } = require("../server/portal/public");

const dry = process.argv.includes("--dry");
buildPortalPages(getFirestore(), { dry, log: (m) => console.log(m) })
  .then((r) => { const { sample, ...rest } = r; console.log(JSON.stringify(rest, null, 1)); if (sample) console.log(JSON.stringify({ needs: sample.needs, wants: sample.wants, targets: sample.targets.slice(0, 8), roster: sample.roster.slice(0, 3), counts: sample.roster.reduce((c, r) => ({ ...c, [r.f]: (c[r.f] || 0) + 1 }), {}) }, null, 1)); process.exit(0); })
  .catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
