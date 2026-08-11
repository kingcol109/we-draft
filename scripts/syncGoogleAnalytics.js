// scripts/syncGoogleAnalytics.js
//
// Pulls page-view data from GA4, keeps only pages under one of
// PAGE_TYPES' prefixes below, and merge-writes it into Firestore's
// analytics/{doc} collection — separate from the players/schedule26/
// performances/articles collections entirely, joined only by slug (+ type)
// at read time (see AdminPanel.js's AnalyticsSection).
//
// Doc IDs: "player" keeps the original bare-slug scheme (analytics/{slug})
// for backward compatibility with every doc already written before other
// types existed — every other type is namespaced as analytics/{type}_{slug}
// so a game/performance/article slug can never collide with a player slug
// (or each other) in the same flat collection. Every doc, including
// player ones, now carries an explicit `type` field going forward; a doc
// with no `type` at all (only possible for player docs written before this
// change) is still treated as "player" on read.
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

// One entry per trackable page type — this is the one place that decides
// what counts as "a page worth tracking" and how its URL maps to a slug, so
// a future path pattern (e.g. /team/{slug}) only needs a new entry here.
// Order matters only in that prefixes must not be prefixes of each other,
// which none of these are.
const PAGE_TYPES = [
  { type: "player", prefix: "/player/" },
  { type: "game", prefix: "/game/" },
  { type: "performance", prefix: "/performance/" },
  // Articles and plain news items share the /news/:id route (see
  // NewsArticle.jsx) — both are tracked under the same "article" type here
  // since there's no separate URL prefix to tell them apart by.
  { type: "article", prefix: "/news/" },
];

const FIRESTORE_BATCH_LIMIT = 500; // Firestore's hard cap on ops per batch

// ── /player/kani-walker-2026-db  ->  { type: "player", slug: "kani-walker-2026-db" }
// Checks pagePath against every PAGE_TYPES prefix, strips the matched
// prefix plus any trailing slash or query string GA sometimes retains, and
// returns null for anything that doesn't match a tracked page type at all
// (the vast majority of paths — home, hubs, admin, etc.), so the caller
// can skip it. ──
function classifyPath(pagePath) {
  if (!pagePath) return null;
  for (const { type, prefix } of PAGE_TYPES) {
    if (!pagePath.startsWith(prefix)) continue;
    let slug = pagePath.slice(prefix.length);
    slug = slug.split("?")[0].split("#")[0];
    slug = slug.replace(/\/+$/, ""); // trailing slash(es)
    return slug ? { type, slug } : null;
  }
  return null;
}

// ── Reshapes GA4's row-per-(pagePath, dateRange) format into one entry per
// (type, slug): { type, slug, pageViews: { last24Hours, last7Days,
// last30Days, last90Days, lastYear, total } }, keyed internally by
// "type:slug" so a game and a player can never collide even if their slugs
// ever happened to match. ──
function aggregateByTypeAndSlug(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const pagePath = row.dimensionValues[0].value;
    const dateRangeName = row.dimensionValues[1].value;
    const views = Number(row.metricValues[0].value || 0);

    const classified = classifyPath(pagePath);
    if (!classified) continue;
    const { type, slug } = classified;
    const key = type + ":" + slug;

    if (!byKey.has(key)) {
      byKey.set(key, {
        type, slug,
        pageViews: { last24Hours: 0, last7Days: 0, last30Days: 0, last90Days: 0, lastYear: 0, total: 0 },
      });
    }
    const entry = byKey.get(key).pageViews;

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

  return byKey;
}

// ── Writes analytics/{docId} for every entry in the map, merging rather
// than overwriting so this stays additive alongside future metric sources
// (YouTube, X mentions, Search Console, etc.) that will write their own
// top-level keys into the same documents without this script needing to
// know about them. Batched in chunks of FIRESTORE_BATCH_LIMIT since a
// large catalog can exceed Firestore's per-batch operation cap. ──
async function writeAnalyticsDocs(db, byKey) {
  const keys = Array.from(byKey.keys());
  let written = 0;

  for (let i = 0; i < keys.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = keys.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = db.batch();

    for (const key of chunk) {
      const { type, slug, pageViews } = byKey.get(key);
      // Player keeps the original bare-slug doc ID every existing reader
      // already keys off of; every other type is namespaced so it can't
      // collide with a player slug (or another type's) in the same
      // flat collection.
      const docId = type === "player" ? slug : type + "_" + slug;
      const ref = db.collection("analytics").doc(docId);
      batch.set(
        ref,
        {
          slug,
          type,
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
  const byKey = aggregateByTypeAndSlug(rows);

  const db = getFirestore();
  const written = await writeAnalyticsDocs(db, byKey);

  const totalPageViews = Array.from(byKey.values()).reduce((sum, v) => sum + v.pageViews.total, 0);
  const byType = {};
  for (const { type } of byKey.values()) byType[type] = (byType[type] || 0) + 1;

  return {
    ok: true,
    slugsSynced: written,
    docsByType: byType,
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
      console.log("   Docs synced:      " + result.slugsSynced);
      console.log("   By type:          " + JSON.stringify(result.docsByType));
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

module.exports = { runSync, classifyPath, aggregateByTypeAndSlug };