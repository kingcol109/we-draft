// scripts/backfillFirstEvaluated.js
//
// One-time backfill for First Evaluated (firstEvaluatedAt) — the date a user
// first interacted with a player (a grade, a Watchlist add, any save). New
// saves stamp it themselves (PlayerProfile.js, CommunityBoard.js, the
// admin's Dummy Content); evaluations saved before that never had it.
//
// Saves overwrite the eval doc with setDoc, so updatedAt only says when it
// was LAST saved. Firestore's own document createTime does survive an
// overwrite, though (only a delete + re-create resets it), so the earliest
// of these is the real first-touch date:
//   - createTime of the public players/{playerId}/evaluations/{uid} copy,
//   - createTime of the owner's users/{uid}/evaluations/{playerId} mirror,
//   - any firstEvaluatedAt already on either copy,
//   - the archived eval (users/{uid}/archivedEvaluations/{playerId}), if
//     any: its firstEvaluatedAt, or else its updatedAt (the last save
//     before archiving — the best that's left once the original was
//     deleted).
// Both copies get the same value. Archived evals get their own earliest
// (their firstEvaluatedAt / updatedAt) so a fresh start after an archive
// inherits it. NFL evals (nflPlayers/…) aren't touched.
//
// Dry run by default:
//   node scripts/backfillFirstEvaluated.js
//   node scripts/backfillFirstEvaluated.js --apply

const ms = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : null);
const minTs = (list) => list.filter((t) => ms(t) != null).reduce((a, b) => (a == null || ms(b) < ms(a) ? b : a), null);

async function backfillFirstEvaluated(db, { apply = false, log = console.log } = {}) {
  const [evalSnap, archSnap] = await Promise.all([
    db.collectionGroup("evaluations").get(),
    db.collectionGroup("archivedEvaluations").get(),
  ]);

  // uid|playerId → { docs: [snap...], archived: snap|null }
  const pairs = new Map();
  const pair = (uid, pid) => {
    const k = `${uid}|${pid}`;
    if (!pairs.has(k)) pairs.set(k, { docs: [], archived: null });
    return pairs.get(k);
  };
  for (const d of evalSnap.docs) {
    const root = d.ref.parent.parent?.parent?.id; // "players" | "users" | "nflPlayers"
    if (root === "players") pair(d.id, d.ref.parent.parent.id).docs.push(d);
    else if (root === "users") pair(d.ref.parent.parent.id, d.id).docs.push(d);
  }
  for (const d of archSnap.docs) {
    if (d.ref.parent.parent?.parent?.id !== "users") continue;
    pair(d.ref.parent.parent.id, d.id).archived = d;
  }

  const writer = apply ? db.bulkWriter() : null;
  let evalWrites = 0, archWrites = 0, unchanged = 0;
  for (const { docs, archived } of pairs.values()) {
    const a = archived?.data();
    const archFirst = a ? minTs([a.firstEvaluatedAt, a.updatedAt]) : null;

    if (archived && archFirst && ms(a.firstEvaluatedAt) !== ms(archFirst)) {
      archWrites++;
      if (writer) writer.update(archived.ref, { firstEvaluatedAt: archFirst });
    }
    if (!docs.length) continue;

    const first = minTs([...docs.flatMap((d) => [d.createTime, d.data().firstEvaluatedAt]), archFirst]);
    if (!first) continue;
    for (const d of docs) {
      if (ms(d.data().firstEvaluatedAt) === ms(first)) { unchanged++; continue; }
      evalWrites++;
      if (evalWrites <= 10) log(`  ${d.ref.path} ← ${first.toDate().toISOString().slice(0, 10)}`);
      if (writer) writer.update(d.ref, { firstEvaluatedAt: first });
    }
  }
  if (writer) await writer.close();

  const verb = apply ? "" : "would be ";
  log(`${apply ? "APPLIED" : "DRY RUN"} — ${evalSnap.size} eval docs, ${archSnap.size} archived, ${pairs.size} user/player pairs.`);
  log(`  eval copies ${verb}set:      ${evalWrites}`);
  log(`  archived evals ${verb}set:   ${archWrites}`);
  log(`  already correct:            ${unchanged}`);
  if (!apply) log("Nothing was written. Re-run with --apply.");
  return { evalWrites, archWrites, unchanged };
}

module.exports = { backfillFirstEvaluated };

if (require.main === module) {
  const { getFirestore } = require("./firebaseAdmin");
  backfillFirstEvaluated(getFirestore(), { apply: process.argv.includes("--apply") })
    .catch((e) => { console.error(e); process.exit(1); });
}
