// scripts/syncGoogleAnalytics.js
//
// Pulls page-view data from GA4, keeps only pages under /player/, and
// merge-writes it into Firestore's analytics/{slug} collection — separate
// from the players collection entirely, joined only by the slug string at
// read time (see AdminPanel.js).
//
// Exports `runSync()` so this same logic can be called two ways:
//   1. Directly as a CLI script:      node scripts/syncGoogleAnalytics.js
//   2. From api/sync-analytics.js, so the admin panel's "Sync Google
//      Analytics" button can trigger the identical code path a scheduled
//      job would use — no separate "manual" vs "automated" implementation
//      to keep in sync with each other.

const { fetchPageViewsByPath } = require("./ga4Client");
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const PLAYER_PATH_PREFIX = "/player/";
const FIRESTORE_BATCH_LIMIT = 500; // Firestore's hard cap on ops per batch

// ── /player/kani-walker-2026-db  ->  kani-walker-2026-db
// Strips the known prefix and any trailing slash or query string GA
// sometimes retains on pagePath. Returns null for anything that isn't
// actually a player page, so the caller can skip it. ──
function extractSlug(pagePath) {
  if (!pagePath || !pagePath.startsWith(PLAYER_PATH_PREFIX)) return null;
  let slug = pagePath.slice(PLAYER_PATH_PREFIX.length);
  slug = slug.split("?")[0].split("#")[0];
  slug = slug.replace(/\/+$/, ""); // trailing slash(es)
  return slug || null;
}

// ── Reshapes GA4's row-per-(pagePath, dateRange) format into one object
// per slug: { last24Hours, last7Days, last30Days, last90Days, lastYear,
// total }. Rows for paths outside /player/ are dropped here — this is the
// one place that decides what counts as "a player page", so future path
// patterns (e.g. if /team/{slug} analytics gets added later) only need a
// change here. ──
function aggregateBySlug(rows) {
  const bySlug = new Map();

  for (const row of rows) {
    const pagePath = row.dimensionValues[0].value;
    const dateRangeName = row.dimensionValues[1].value;
    const views = Number(row.metricValues[0].value || 0);

    const slug = extractSlug(pagePath);
    if (!slug) continue;

    if (!bySlug.has(slug)) {
      bySlug.set(slug, { last24Hours: 0, last7Days: 0, last30Days: 0, last90Days: 0, lastYear: 0, total: 0 });
    }
    const entry = bySlug.get(slug);

    // GA can return multiple pagePath variants for the same logical page
    // (e.g. differing only in a tracked query param); sum rather than
    // overwrite so nothing gets silently dropped.
    if (dateRangeName === "last24Hours") entry.last24Hours += views;
    else if (dateRangeName === "last7Days") entry.last7Days += views;
    else if (dateRangeName === "last30Days") entry.last30Days += views;
    else if (dateRangeName === "last90Days") entry.last90Days += views;
    else if (dateRangeName === "lastYear") entry.lastYear += views;
    else if (dateRangeName === "total") entry.total += views;
  }

  return bySlug;
}

// ── Writes analytics/{slug} for every slug in the map, merging rather than
// overwriting so this stays additive alongside future metric sources
// (YouTube, X mentions, Search Console, etc.) that will write their own
// top-level keys into the same documents without this script needing to
// know about them. Batched in chunks of FIRESTORE_BATCH_LIMIT since a
// large player catalog can exceed Firestore's per-batch operation cap. ──
async function writeAnalyticsDocs(db, bySlug) {
  const slugs = Array.from(bySlug.keys());
  let written = 0;

  for (let i = 0; i < slugs.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = slugs.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = db.batch();

    for (const slug of chunk) {
      const pageViews = bySlug.get(slug);
      const ref = db.collection("analytics").doc(slug);
      batch.set(
        ref,
        {
          slug,
          pageViews,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

// ── The actual sync, callable from anywhere (CLI or the API route). Always
// returns a plain summary object rather than throwing on partial failure —
// a GA4 error should be visible to the caller (and shown in the admin
// panel), not crash a scheduled job silently. ──
async function runSync() {
  const startedAt = Date.now();

  const rows = await fetchPageViewsByPath();
  const bySlug = aggregateBySlug(rows);

  const db = getFirestore();
  const written = await writeAnalyticsDocs(db, bySlug);

  const totalPageViews = Array.from(bySlug.values()).reduce((sum, v) => sum + v.total, 0);

  return {
    ok: true,
    slugsSynced: written,
    totalPageViews,
    durationMs: Date.now() - startedAt,
    syncedAt: new Date().toISOString(),
  };
}

// ── CLI entry point — only runs when this file is executed directly
// (`node scripts/syncGoogleAnalytics.js`), not when required as a module
// by api/sync-analytics.js. ──
if (require.main === module) {
  runSync()
    .then((result) => {
      console.log("✅ Analytics sync complete");
      console.log("   Slugs synced:     " + result.slugsSynced);
      console.log("   Total page views: " + result.totalPageViews);
      console.log("   Duration:         " + result.durationMs + "ms");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Analytics sync failed:", err.message);
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runSync, extractSlug, aggregateBySlug };