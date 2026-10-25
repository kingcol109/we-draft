// scripts/buildSimGamesSnapshot.mjs
//
// Builds compSnapshots/simGames — every Draft Sim prospect's standout game
// this season ({ line: "4 sacks", opp: "Tennessee" }), for Isaac Walker's
// big-game takes. Without it the sim looks each drafted player up as he's
// picked (his cfbdPlayers link, then up to 20 game-log docs) — ~3–4.5k reads
// over a full seven-round sim at Normal speed. With it: one read a session
// (utils/draftSim/data.js loadBestGame). Scored by the sim's own bestGame
// (utils/draftSim/bestGame.js), so a game reads the same either way.
//
//   { version, season, rows: { [playerId]: { line, opp } }, builtAt }
//
// Only players with a big game are in rows; the sim treats a missing one as
// "no big game", same as before. Prospects: every class the sim drafts
// (SIM_YEARS), linked to CFBD ("verified" / "suggested").
//
// Cost: the linked cfbdPlayers docs (~1,300) + each sim prospect's games
// this season (~5 each so far) — about 5–10k reads a run, once a week
// (.github/workflows/build-sim-games.yml, after Saturday's games).
// Usage:
//   node --env-file=.env scripts/buildSimGamesSnapshot.mjs            # write
//   node --env-file=.env scripts/buildSimGamesSnapshot.mjs --dry-run  # build + report only
import { createRequire } from "module";
import { bestGame } from "../src/utils/draftSim/bestGame.js";
import { SIM_YEARS } from "../src/utils/draftSim/years.js";
import { COMP_SNAPSHOT_VERSION } from "../src/utils/historicalStats.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const DRY_RUN = process.argv.includes("--dry-run");
const CHUNK = 50;

const db = getFirestore();
// The season the sim reads stats from (data.js loadCfbStats).
const season = Number((await db.collection("cfbLeaders").doc("current").get()).data()?.season);
if (!season) throw new Error("cfbLeaders/current has no season");

const [linkedSnap, ...classSnaps] = await Promise.all([
  db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftPlayerId").get(),
  ...SIM_YEARS.map((y) => db.collection("players").where("Eligible", "==", y).select().get()),
]);
const prospects = new Set(classSnaps.flatMap((s) => s.docs.map((d) => d.id)));
const linked = linkedSnap.docs.filter((d) => prospects.has(d.data().wedraftPlayerId));
console.log(`Season ${season}: ${prospects.size} sim prospects (${SIM_YEARS.join(", ")}), ${linked.length} linked to CFBD`);

const rows = {};
let gameDocs = 0;
for (let i = 0; i < linked.length; i += CHUNK) {
  const chunk = linked.slice(i, i + CHUNK);
  const logs = await Promise.all(chunk.map((d) => d.ref.collection("games").where("season", "==", season).get()));
  logs.forEach((snap, j) => {
    gameDocs += snap.size;
    const best = bestGame(snap.docs.map((g) => g.data()));
    if (best) rows[chunk[j].data().wedraftPlayerId] = best;
  });
}
const doc = { version: COMP_SNAPSHOT_VERSION, season, rows };
const bytes = Buffer.byteLength(JSON.stringify(doc));
console.log(`Read ${gameDocs} game docs; ${Object.keys(rows).length} prospects with a big game (${Math.round(bytes / 1024)} KB)`);
if (bytes > 900 * 1024) throw new Error("simGames would be over Firestore's 1 MB doc limit");

if (DRY_RUN) {
  console.log("Dry run — sample:", JSON.stringify(Object.entries(rows).slice(0, 3)));
} else {
  await db.collection("compSnapshots").doc("simGames").set({ ...doc, builtAt: FieldValue.serverTimestamp() });
  console.log("Wrote compSnapshots/simGames");
}
