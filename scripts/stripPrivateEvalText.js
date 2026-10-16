// scripts/stripPrivateEvalText.js
//
// One-time cleanup that goes with the evaluation-privacy fix in
// firestore.rules / src/utils/evaluationCopies.js. Before that fix, every
// save wrote the identical evalData (written take, game notes and the
// author's email included) to both players/{playerId}/evaluations/{uid} —
// public-read — and the users/{uid}/evaluations/{playerId} mirror (public
// mirrors are readable too, via the {path=**}/evaluations rule). New saves
// keep that data off anything public; this removes it from docs already in
// Firestore.
//
// What changes (nothing else is touched — grade, strengths, weaknesses,
// nflFit, visibility, uid, updatedAt etc. all stay, so Community Grade and
// the strengths/weaknesses/NFL fit aggregates are unchanged):
//   - every canonical players/ copy: `email` removed;
//   - every canonical copy whose visibility isn't "public": `evaluation`
//     and `gameNotes` removed — after making sure the owner's mirror has
//     them: a missing mirror is created from the canonical data, and a
//     mirror missing a value the canonical copy has gets it backfilled.
//     If the mirror already holds a *different* non-empty value, that
//     canonical copy is skipped and listed for manual review, so no
//     written take is ever lost;
//   - every *public* mirror: `email` removed. Private mirrors are owner-
//     only and are never modified except for the backfill above.
//
// Dry run by default (reads only, prints what it would do):
//   node scripts/stripPrivateEvalText.js
//   node scripts/stripPrivateEvalText.js --apply
// Admin SDK, so security rules don't apply — same setup as the other
// scripts here.

const { FieldValue } = require("firebase-admin/firestore");

const PRIVATE_EVAL_FIELDS = ["evaluation", "gameNotes"];
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function stripPrivateEvalText(db, { apply = false, log = console.log } = {}) {
  const snap = await db.collectionGroup("evaluations").get();
  const summary = {
    docsRead: snap.size, canonicalEmailOnly: 0, canonicalPrivateStripped: 0,
    mirrorsCreated: 0, mirrorsBackfilled: 0, publicMirrorsEmailStripped: 0, conflictsSkipped: [],
  };

  for (const d of snap.docs) {
    const data = d.data();
    const parentRoot = d.ref.parent.parent?.parent?.id; // "players" or "users"

    if (parentRoot === "users") {
      if (data.visibility === "public" && "email" in data) {
        summary.publicMirrorsEmailStripped++;
        if (apply) await d.ref.update({ email: FieldValue.delete() });
      }
      continue;
    }
    if (parentRoot !== "players") continue;

    const playerId = d.ref.parent.parent.id;
    const uid = d.id;
    const isPrivate = data.visibility !== "public";
    const privateFieldsPresent = isPrivate ? PRIVATE_EVAL_FIELDS.filter((f) => f in data) : [];
    if (!("email" in data) && privateFieldsPresent.length === 0) continue;

    if (privateFieldsPresent.length > 0) {
      const mirrorRef = db.doc(`users/${uid}/evaluations/${playerId}`);
      const mirror = await mirrorRef.get();
      if (!mirror.exists) {
        const { email, ...rest } = data; // eslint-disable-line no-unused-vars
        log(`  mirror missing: users/${uid}/evaluations/${playerId} — ${apply ? "creating" : "would create"} from canonical`);
        summary.mirrorsCreated++;
        if (apply) await mirrorRef.set(rest);
      } else {
        const m = mirror.data();
        const backfill = {};
        let conflict = false;
        for (const f of PRIVATE_EVAL_FIELDS) {
          if (isEmpty(data[f]) || same(data[f], m[f])) continue;
          if (isEmpty(m[f])) backfill[f] = data[f];
          else conflict = true;
        }
        if (conflict) {
          log(`  CONFLICT, skipped: players/${playerId}/evaluations/${uid} — mirror has different text/notes; review by hand`);
          summary.conflictsSkipped.push(`players/${playerId}/evaluations/${uid}`);
          continue;
        }
        if (Object.keys(backfill).length) {
          log(`  mirror backfill: users/${uid}/evaluations/${playerId} ← ${Object.keys(backfill).join(", ")}`);
          summary.mirrorsBackfilled++;
          if (apply) await mirrorRef.update(backfill);
        }
      }
    }

    const toDelete = [...("email" in data ? ["email"] : []), ...privateFieldsPresent];
    if (privateFieldsPresent.length) summary.canonicalPrivateStripped++;
    else summary.canonicalEmailOnly++;
    if (apply) await d.ref.update(Object.fromEntries(toDelete.map((f) => [f, FieldValue.delete()])));
  }

  const verb = apply ? "" : "would be ";
  log(`${apply ? "APPLIED" : "DRY RUN"} — ${summary.docsRead} evaluation docs read.`);
  log(`  public copies of private evals ${verb}stripped of text/notes/email: ${summary.canonicalPrivateStripped}`);
  log(`  public copies ${verb}stripped of email only:                      ${summary.canonicalEmailOnly}`);
  log(`  owner mirrors ${verb}created:                                     ${summary.mirrorsCreated}`);
  log(`  owner mirrors ${verb}backfilled:                                  ${summary.mirrorsBackfilled}`);
  log(`  public mirrors ${verb}stripped of email:                          ${summary.publicMirrorsEmailStripped}`);
  log(`  conflicts skipped (left unchanged, need manual review):           ${summary.conflictsSkipped.length}`);
  if (!apply) log("Nothing was written. Re-run with --apply to make these changes.");
  return summary;
}

module.exports = { stripPrivateEvalText };

if (require.main === module) {
  const { getFirestore } = require("./firebaseAdmin");
  stripPrivateEvalText(getFirestore(), { apply: process.argv.includes("--apply") })
    .catch((e) => { console.error(e); process.exit(1); });
}
