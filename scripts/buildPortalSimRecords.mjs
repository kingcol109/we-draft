// scripts/buildPortalSimRecords.mjs
//
// Builds src/utils/portalSim/teamRecords.json — each FBS team's win-loss
// record over the last few seasons, the Portal Sim's "recent success"
// (utils/portalSim/factors.js). One CFBD /records call per season (4 by
// default); no Firestore writes. Re-run after each season (and mid-season
// for the current one) and commit the JSON.
//
//   { years: [first, last], builtAt, teams: { [school]: [[year, wins, losses], …] } }
// School names are cfbRosters' (the Portal Sim pool's) — CFBD's, with the
// few /records spells differently mapped (ALIASES).
//
// Usage:
//   node --env-file=.env scripts/buildPortalSimRecords.mjs [lastSeason] [seasons]
import { createRequire } from "module";
import { writeFileSync } from "fs";

const require = createRequire(import.meta.url);
const { cfbd, getCallCount } = require("../server/live/cfbdClient");
const { cached } = require("./cfbdCache");

const OUT = "src/utils/portalSim/teamRecords.json";
const LAST = Number(process.argv[2]) || 2026;
const SEASONS = Number(process.argv[3]) || 4;
// /records spells a few schools differently from cfbRosters (the pool's names).
export const ALIASES = {
  "San José State": "San Jose State", "Hawai'i": "Hawaii", Massachusetts: "UMass",
  "App State": "Appalachian State", "UL Monroe": "Louisiana-Monroe", "Sam Houston": "Sam Houston State",
};

const teams = {};
for (let year = LAST - SEASONS + 1; year <= LAST; year += 1) {
  const rows = await cached(`records-${year}`, () => cfbd.records({ year }));
  let n = 0;
  (rows || []).forEach((r) => {
    if (r.classification && String(r.classification).toLowerCase() !== "fbs") return;
    const w = r.total?.wins ?? 0;
    const l = r.total?.losses ?? 0;
    if (!r.team || w + l === 0) return;
    const name = ALIASES[r.team] || r.team;
    (teams[name] = teams[name] || []).push([year, w, l]);
    n += 1;
  });
  console.log(year, n, "FBS teams");
}
writeFileSync(OUT, `${JSON.stringify({ years: [LAST - SEASONS + 1, LAST], builtAt: new Date().toISOString().slice(0, 10), teams })}\n`);
console.log(`Wrote ${OUT}: ${Object.keys(teams).length} teams, ${getCallCount()} CFBD calls.`);
