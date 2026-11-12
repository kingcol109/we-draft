// scripts/importEspnHeadshots.js
//
// Fills players' headshots (playerPhotos/{playerId}.headshot — Admin →
// Content → Photos, shown on player pages) from ESPN's college rosters.
// How players are matched lives in src/utils/espnHeadshots.js, shared with
// the weekly site-snapshot job (scripts/buildSiteSnapshots.mjs, which calls
// run() below) and the admin "Rebuild Site Snapshots" button — so a newly
// added player gets his photo on the next rebuild without running this.
//
// Never replaces a headshot that's already saved. Players in the draft
// classes from this one on only (--from to change it). Each write run
// replaces config/headshotReview's list with its own; dismissals carry over.
//
//   node --env-file=.env scripts/importEspnHeadshots.js            dry run: what it would do
//   node --env-file=.env scripts/importEspnHeadshots.js --write    save the matches and the review list
//   node --env-file=.env scripts/importEspnHeadshots.js --from 2028 --write

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

// ESM module from src/ — Node 22 detects its ESM syntax (same as
// buildSiteSnapshots.mjs importing snapshotBuilders.js).
const shared = () => import("../src/utils/espnHeadshots.js");

async function run({ write = false, from, log = console.log } = {}) {
  const { planEspnHeadshots, headshotPhotoDoc, currentHeadshotClass, knownEspnPlayers } = await shared();
  const db = getFirestore();
  const FROM = from || currentHeadshotClass();
  log(`ESPN headshots: ${write ? "WRITE" : "DRY RUN"} — classes ${FROM} and later`);

  const [playersSnap, schoolsSnap, photosSnap, reviewSnap] = await Promise.all([
    db.collection("players").get(),
    db.collection("schools").get(),
    db.collection("playerPhotos").get(),
    db.collection("config").doc("headshotReview").get(),
  ]);
  const dismissed = new Set(reviewSnap.exists ? reviewSnap.data().dismissed || [] : []);
  const { matches, review, jerseyUpdates, stats, notFound } = await planEspnHeadshots({
    players: playersSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    schools: schoolsSnap.docs.map((d) => d.data()),
    hasHeadshot: new Set(photosSnap.docs.filter((d) => d.data().headshot?.url).map((d) => d.id)),
    dismissed,
    known: knownEspnPlayers(photosSnap.docs.map((d) => ({ id: d.id, data: d.data() }))),
    from: FROM,
  });

  log(`${stats.without} players without a headshot · ${stats.schools} schools fetched · ${stats.noTeamId} at a school with no ESPN/CFBD id`);
  log(`Matched: ${stats.matched} · Needs review: ${stats.review} · On the roster, no ESPN headshot: ${stats.noHeadshot} · Not found: ${stats.noCandidates} · Previously dismissed: ${stats.dismissed}`);
  log(`Jersey numbers to update: ${stats.jerseys}`);
  if (stats.rosterFailed) log(`Roster fetch failed: ${stats.rosterFailed} players`);
  matches.slice(0, 8).forEach(({ player, athlete }) => log(`  ✓ ${player.First} ${player.Last} (${player.School}) → ${athlete.url}`));
  Object.values(review).slice(0, 8).forEach((r) => log(`  ? ${r.name} (${r.school}): ${r.candidates.map((c) => c.name).join(", ")}`));
  if (notFound.length) log(`  Not found, e.g.: ${notFound.slice(0, 12).join(", ")}`);
  if (!write) { log("Dry run — nothing saved."); return stats; }

  const addedAt = Timestamp.now();
  for (let i = 0; i < matches.length; i += 400) {
    const batch = db.batch();
    matches.slice(i, i + 400).forEach((m) => {
      batch.set(db.collection("playerPhotos").doc(m.player.id), { ...headshotPhotoDoc(m, addedAt), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await batch.commit();
  }
  for (let i = 0; i < jerseyUpdates.length; i += 400) {
    const batch = db.batch();
    jerseyUpdates.slice(i, i + 400).forEach((j) => {
      batch.set(db.collection("playerPhotos").doc(j.id), { jersey: j.jersey, jerseyEspnId: j.espnId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    await batch.commit();
  }
  // The review list is this run's; dismissals carry over.
  await db.collection("config").doc("headshotReview").set({ items: review, dismissed: [...dismissed], updatedAt: FieldValue.serverTimestamp() });
  log(`Saved ${matches.length} headshots, ${jerseyUpdates.length} jersey numbers, and ${stats.review} to review.`);
  return stats;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fromArg = args.indexOf("--from");
  run({ write: args.includes("--write"), from: fromArg >= 0 ? Number(args[fromArg + 1]) : undefined })
    .then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
