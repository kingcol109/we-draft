// scripts/backfillLiveStats.js
//
// Builds the live stats doc (liveGames/{id}/box/live) and the per-game
// statLeaders for every game on the current slate from plays already in
// Firestore, then rewrites liveSlate/performances (Top Performances). For
// games stored before the ingester did this itself. No CFBD calls.
//
//   node --env-file=.env scripts/backfillLiveStats.js         write
//   node --env-file=.env scripts/backfillLiveStats.js --dry   just print the leaders

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const S = require("../server/live/store");

const DRY = process.argv.includes("--dry");

async function main() {
  const db = getFirestore();
  const { computeGameStats, gameLeaders, statLine, LEADER_CATS } = await import("../src/utils/liveStats.mjs");
  const slate = (await db.collection("liveSlate").doc("current").get()).data();
  if (!slate) throw new Error("no liveSlate/current");
  const ids = slate.games.filter((g) => g.status !== "scheduled").map((g) => String(g.id));
  const leadersById = new Map();
  for (const id of ids) {
    const snap = await db.collection("liveGames").doc(id).collection("plays").get();
    const plays = snap.docs.map((d) => d.data()).filter((p) => !p.removed && !p.hidden).sort(require("../server/live/provider").comparePlays);
    if (!plays.length) continue;
    const stats = computeGameStats(plays);
    const leaders = JSON.parse(JSON.stringify(gameLeaders(stats)));
    leadersById.set(id, leaders);
    if (!DRY) {
      await S.saveLiveStats(db, id, stats);
      await S.setGameFields(db, id, { statLeaders: leaders });
    }
    console.log(`${id}: ${plays.length} plays`);
  }
  // Same merge as server/live/store.js slatePerformances.
  const out = {};
  for (const cat of LEADER_CATS) {
    out[cat] = [...leadersById.entries()].flatMap(([gameId, l]) => (l[cat] || []).map((e) => ({ ...e, gameId })))
      .sort((a, b) => b.v - a.v).slice(0, 15);
    console.log(`\n${cat.toUpperCase()}`);
    out[cat].slice(0, 5).forEach((e, i) => console.log(`  ${i + 1}. ${e.name} (${e.gameId}) — ${statLine(cat, e.stats)}`));
  }
  if (!DRY) {
    await db.collection("liveSlate").doc("performances").set({ season: slate.season, week: slate.week, seasonType: slate.seasonType, ...out, updatedAt: FieldValue.serverTimestamp() });
    console.log("\nwrote liveSlate/performances");
  }
  process.exit(0);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
