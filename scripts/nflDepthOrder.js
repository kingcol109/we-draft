// scripts/nflDepthOrder.js
//
// Derived from the PFF NFL depth charts (pffNflRosters/{abbr},
// scripts/syncPffNflRosters.js) into a public collection — no grade, snap
// count or any other PFF number, since PFF data itself is back office only:
//
//   nflDepthOrder/{abbr}  { season, order: [name, …] } — the team's players
//       by season snaps, most first (depth-chart order breaks ties and
//       orders anyone who hasn't played). NFLTeamPage.jsx sorts each
//       position group of its ESPN roster by it. Order only — the snaps
//       themselves are never shown.
//
// Team needs (nflTeamNeeds/{abbr}) aren't written here any more: they're the
// admin's, set in Admin → Mock Draft → Team Needs from suggestions computed
// on demand (src/utils/teamNeedSuggestions.js).
//
// syncPffNflRosters.js runs this after each sync. Also runnable on its own
// against the docs already in Firestore (no PFF calls):
//   node --env-file=.env scripts/nflDepthOrder.js        add --dry to print only

const bySnaps = (a, b) => (b.sn || 0) - (a.sn || 0) || (a.d || 99) - (b.d || 99);

// One team doc → its players' names by season snaps, most first.
const depthOrder = (team) => (team.players || []).filter((p) => !p.off).sort(bySnaps).map((p) => p.n);

// Writes nflDepthOrder for every team. teams: pffNflRosters docs (each with
// abbr + season). → { [abbr]: order }.
async function writeDepthOrder(db, FieldValue, teams, { dry = false } = {}) {
  const orders = Object.fromEntries(teams.map((t) => [t.abbr, depthOrder(t)]));
  if (dry) return orders;
  const batch = db.batch();
  teams.forEach((t) => {
    batch.set(db.collection("nflDepthOrder").doc(t.abbr), { abbr: t.abbr, season: t.season, order: orders[t.abbr], updatedAt: FieldValue.serverTimestamp() });
  });
  await batch.commit();
  return orders;
}

module.exports = { depthOrder, writeDepthOrder };

if (require.main === module) {
  const { getFirestore } = require("./firebaseAdmin");
  const { FieldValue } = require("firebase-admin/firestore");
  const dry = process.argv.includes("--dry");
  (async () => {
    const db = getFirestore();
    const teams = (await db.collection("pffNflRosters").get()).docs.map((d) => d.data());
    const orders = await writeDepthOrder(db, FieldValue, teams, { dry });
    Object.entries(orders).sort(([a], [b]) => a.localeCompare(b)).forEach(([abbr, order]) => console.log(abbr.padEnd(4), order.slice(0, 6).join(", ")));
    console.log(`${dry ? "[dry] " : ""}${teams.length} teams.`);
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
