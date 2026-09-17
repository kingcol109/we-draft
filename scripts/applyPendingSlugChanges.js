// scripts/applyPendingSlugChanges.js
//
// Applies deferred slug changes once their scheduled date arrives. Right
// now the only thing that ever sets PendingSlugChangeAt is
// AdminPanel.js's handleResolvePortal (see PlayerDataSection there): a
// 2027-class player who transfers is, definitionally, not declaring for
// the draft — they're back for another season somewhere new — so they get
// bumped to the 2028 class immediately (Eligible drives grouping/grading
// everywhere on the site right away). Their slug, though, bakes the class
// year in (see AdminPanel.js's own generateSlug) and is deliberately left
// alone for SEO continuity until this runs.
//
// Runs daily (see .github/workflows/apply-pending-slug-changes.yml) via
// the Admin SDK, which bypasses security rules entirely — same setup as
// scripts/gradeWePickWeek.js/syncGoogleAnalytics.js. For every player
// whose PendingSlugChangeAt has arrived:
//   1. Recomputes their slug fresh from current First/Last/Position/
//      Eligible — not a value frozen back when the change was scheduled,
//      so a name-typo fix made in the meantime is still reflected.
//   2. If that differs from their current Slug, de-dupes against every
//      other player's slug (same "-1", "-2", ... scheme AdminPanel.js's
//      findUniqueSlug uses) and writes playerSlugRedirects/{oldSlug} ->
//      {newSlug} — the same collection AdminPanel.js's own handleSave
//      writes to for a manual slug change, and the one PlayerProfile.js's
//      player-fetch effect checks whenever a slug doesn't match a live
//      player, so a stale bookmark/search result still resolves.
//   3. Either way, clears PendingSlugChangeAt so this player isn't
//      reprocessed on the next run.
//
// Exports `runPendingSlugChanges()`, same two-ways-callable convention as
// scripts/gradeWePickWeek.js/syncGoogleAnalytics.js:
//   1. Directly as a CLI script:  node scripts/applyPendingSlugChanges.js
//   2. Required as a module, if an admin-triggered "Run Now" button ever
//      wants the identical code path a scheduled run uses.

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");

// ── Duplicated from AdminPanel.js's own generateSlug — see that file's
// header comment on the "small pure helper duplicated with a pointer
// back" convention this follows (this runs in plain Node, no React/
// browser dependency to import it from). Keep the two in sync. ──
function generateSlug(first, last, position, eligible) {
  const raw = (first || "") + "-" + (last || "") + "-" + (eligible || "") + "-" + (position || "");
  let s = raw.replace(/['’`.]/g, "");
  s = s.replace(/[^a-zA-Z0-9\- ]/g, "");
  s = s.replace(/\s+/g, "-");
  s = s.toLowerCase();
  s = s.replace(/-+/g, "-");
  return s;
}

async function runPendingSlugChanges() {
  const startedAt = Date.now();
  const db = getFirestore();
  const now = Timestamp.now();

  const dueSnap = await db.collection("players").where("PendingSlugChangeAt", "<=", now).get();
  if (dueSnap.empty) {
    return { ok: true, processed: 0, changed: 0, results: [], durationMs: Date.now() - startedAt };
  }

  // Every other player's current slug, for de-dupe — read once up front
  // rather than per-player, same as AdminPanel.js's own findUniqueSlug
  // (which reads off its already-loaded allPlayers list). Grown in place
  // as slugs are assigned below so two due players never collide with
  // each other in the same run either.
  const allSnap = await db.collection("players").get();
  const existingSlugs = new Set(allSnap.docs.map((d) => d.data().Slug).filter(Boolean));

  let changed = 0;
  const results = [];
  for (const docSnap of dueSnap.docs) {
    const p = docSnap.data();
    const currentSlug = p.Slug || "";
    const baseSlug = generateSlug(p.First, p.Last, p.Position, p.Eligible);

    if (!baseSlug || baseSlug === "-") {
      // Nothing sane to switch to (missing name/position/eligible) — just
      // clear the pending marker so this doesn't get retried forever.
      await docSnap.ref.update({ PendingSlugChangeAt: FieldValue.delete() });
      results.push({ id: docSnap.id, slug: currentSlug, changed: false, reason: "invalid base slug" });
      continue;
    }

    let newSlug = baseSlug;
    if (newSlug !== currentSlug && existingSlugs.has(newSlug)) {
      let n = 1;
      while (existingSlugs.has(`${baseSlug}-${n}`)) n += 1;
      newSlug = `${baseSlug}-${n}`;
    }

    if (newSlug !== currentSlug) {
      const batch = db.batch();
      batch.update(docSnap.ref, {
        Slug: newSlug,
        PendingSlugChangeAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection("playerSlugRedirects").doc(currentSlug), {
        newSlug,
        playerId: docSnap.id,
        changedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();
      existingSlugs.add(newSlug);
      changed += 1;
      results.push({ id: docSnap.id, oldSlug: currentSlug, newSlug, changed: true });
    } else {
      // Recomputed slug happens to already match (e.g. Eligible was bumped
      // back before this ran) — nothing to redirect, just clear the marker.
      await docSnap.ref.update({ PendingSlugChangeAt: FieldValue.delete() });
      results.push({ id: docSnap.id, slug: currentSlug, changed: false, reason: "already matches" });
    }
  }

  return { ok: true, processed: dueSnap.size, changed, results, durationMs: Date.now() - startedAt };
}

// ── CLI entry point — only runs when this file is executed directly
// (`node scripts/applyPendingSlugChanges.js`), not when required as a
// module. ──
if (require.main === module) {
  runPendingSlugChanges()
    .then((result) => {
      console.log("✅ Pending slug changes applied");
      if (result.processed === 0) {
        console.log("   Nothing due — no player's PendingSlugChangeAt has arrived yet.");
      } else {
        console.log(`   ${result.processed} due, ${result.changed} slug(s) actually changed.`);
        result.results.forEach((r) => {
          console.log(r.changed ? `   ${r.id}: ${r.oldSlug} -> ${r.newSlug}` : `   ${r.id}: ${r.slug} (${r.reason})`);
        });
      }
      console.log("   Duration: " + result.durationMs + "ms");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Pending slug changes failed:", err.message);
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runPendingSlugChanges, generateSlug };
