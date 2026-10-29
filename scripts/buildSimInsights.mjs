// scripts/buildSimInsights.mjs
//
// Builds compSnapshots/simInsights — the Draft Sim's Community tab: the
// teams users draft as, the players they take, the community's first
// round, and sim totals (src/utils/draftSim/insights.js), from the usage
// counters (draftSimTeams, draftSimPicks, draftSimDaily — admin-only).
// Counts only, no users. Admin → Mock Draft → Statistics' "Publish
// community insights" builds the same doc on demand.
//
// Cost: every counter doc (one per class per day, one per class/team/day,
// one per day), each class's board snapshots (compSnapshots/class_{year}_
// {pos} — the community favorites' board spots) plus the named players — a few thousand reads a run, every
// 3 hours (.github/workflows/build-sim-insights.yml).
// Usage:
//   node --env-file=.env scripts/buildSimInsights.mjs            # write
//   node --env-file=.env scripts/buildSimInsights.mjs --dry-run  # build + report only
import { createRequire } from "module";
import { buildSimInsights, playerIds, withNames, boardRanks, BOARD_POSITIONS, INSIGHTS_DOC } from "../src/utils/draftSim/insights.js";
import { SIM_YEARS } from "../src/utils/draftSim/years.js";
import { COMP_SNAPSHOT_VERSION } from "../src/utils/historicalStats.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const DRY_RUN = process.argv.includes("--dry-run");
const db = getFirestore();

const all = async (name) => (await db.collection(name).get()).docs.map((d) => ({ day: d.id, ...d.data() }));
const [teams, picks, daily] = await Promise.all([all("draftSimTeams"), all("draftSimPicks"), all("draftSimDaily")]);
const boards = Object.fromEntries(await Promise.all(SIM_YEARS.map(async (y) => {
  const snaps = await db.getAll(...BOARD_POSITIONS.map((pos) => db.collection("compSnapshots").doc(`class_${y}_${pos}`)));
  return [String(y), boardRanks(Object.fromEntries(snaps.map((d, i) => [BOARD_POSITIONS[i], d.exists ? d.data().rows || [] : []])))];
})));
const built = buildSimInsights({ teams, picks, daily, years: SIM_YEARS, boards });
const ids = playerIds(built);
const docs = ids.length ? await db.getAll(...ids.map((id) => db.collection("players").doc(id))) : [];
const insights = withNames(built, docs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() })));
console.log(`${teams.length} team docs, ${picks.length} pick docs, ${daily.length} days → ${ids.length} players named; ${insights.totals.all.sims} sims all time, ${insights.totals.week.sims} this week`);

if (DRY_RUN) {
  console.log(JSON.stringify(insights.years, null, 1).slice(0, 2000));
} else {
  await db.collection("compSnapshots").doc(INSIGHTS_DOC).set({ version: COMP_SNAPSHOT_VERSION, ...insights, builtAt: FieldValue.serverTimestamp() });
  console.log(`Wrote compSnapshots/${INSIGHTS_DOC}`);
}
process.exit(0);
