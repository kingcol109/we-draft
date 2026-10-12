// server/youtube-analytics/studio.js
//
// One-time (repeatable) import of impressions / CTR from a YouTube Studio
// export, for the history the API can't provide. The Reporting API only
// backfills ~30 days before its job was created; Studio's Advanced mode
// can export each video's impressions and CTR for a much longer range.
//
// The admin exports Analytics → Advanced mode → Content table with the
// Impressions and Impressions click-through rate metrics for a date range
// (e.g. Lifetime), unzips the download and uploads "Table data.csv" in
// Research. It's parsed here (metrics.parseStudioTable), never trusted from
// the browser.
//
// Stored per video as ytVideos.studioReach { impressions, clicks, ctr,
// from, to, importedAt } — a lump total for that range, kept apart from the
// API's daily rows (it has no per-day breakdown). To combine the two without
// counting a day twice, each video's reach.after sums only the API days
// after the export's end date (metrics.withStudioCutoff / combinedReach).
//
// An import REPLACES the previous one: videos missing from the new file
// lose their old Studio numbers. preview: true parses and matches without
// writing anything.

const g = require("./google");
const m = require("./metrics");
const { loadTracked, writeBatched } = require("./videos");

const MAX_CSV_BYTES = 3 * 1024 * 1024; // under Vercel's 4.5 MB request limit

function checkRange(from, to) {
  if (from != null && !m.isDay(from)) throw g.httpError(400, "Start date must be YYYY-MM-DD (or empty for lifetime).");
  if (!m.isDay(to)) throw g.httpError(400, "End date must be YYYY-MM-DD.");
  if (from && from > to) throw g.httpError(400, "Start date is after the end date.");
  const today = m.pacificDay();
  if (to > today) throw g.httpError(400, "End date is in the future.");
  // reach.after is summed from the API days still kept on each video (90).
  if (m.daysBetween(to, today) > 80) throw g.httpError(400, "Export a range that ends within the last 80 days (e.g. Lifetime, or through yesterday) so it can be joined to the API data without gaps or double counting.");
}

async function importStudio(ctx, body) {
  const { db, uid } = ctx;
  const csv = String(body.csv || "");
  if (!csv) throw g.httpError(400, "No file content.");
  if (Buffer.byteLength(csv) > MAX_CSV_BYTES) throw g.httpError(400, "That file is too large (3 MB max) — export just the Content table.");
  const from = body.from || null;
  const to = body.to;
  checkRange(from, to);

  const parsed = m.parseStudioTable(csv);
  if (parsed.error) throw g.httpError(400, parsed.error);
  const tracked = await loadTracked(db);
  const matched = parsed.rows.filter((r) => tracked.has(r.videoId));
  const unmatched = parsed.rows.filter((r) => !tracked.has(r.videoId));
  const sum = (rows) => rows.reduce((a, r) => ({ i: a.i + r.impressions, c: a.c + r.clicks }), { i: 0, c: 0 });
  const t = sum(matched);
  const summary = {
    from, to, fileName: String(body.fileName || "").slice(0, 120) || null,
    columns: parsed.columns, rows: parsed.rows.length, skipped: parsed.skipped,
    matched: matched.length, unmatched: unmatched.length,
    unmatchedSample: unmatched.slice(0, 10).map((r) => ({ videoId: r.videoId, title: r.title })),
    impressions: t.i, ctr: t.i ? t.c / t.i : null,
  };
  ctx.counts.rows = parsed.rows.length;
  ctx.counts.matched = matched.length;
  if (body.preview) return { preview: true, ...summary };
  if (!matched.length) throw g.httpError(400, "None of the file's video IDs are tracked here — run Sync Videos, or check the export is from King Cold Sports.");

  const now = Date.now();
  const byId = new Map(matched.map((r) => [r.videoId, r]));
  const ops = [];
  for (const [id, v] of tracked) {
    const row = byId.get(id);
    if (!row && !v.studioReach) continue;
    if (!row) {
      ops.push({ ref: db.collection("ytVideos").doc(id), data: { studioReach: null, reach: v.reach ? m.withStudioCutoff(v.reach, null) : null }, update: true });
      ctx.inc("cleared");
      continue;
    }
    const reach = m.withStudioCutoff(v.reach, to);
    if (!reach) { ctx.error(`${id}: API impression days after ${to} are no longer all stored — skipped.`); continue; }
    ops.push({
      ref: db.collection("ytVideos").doc(id),
      data: {
        studioReach: { impressions: row.impressions, clicks: row.clicks, ctr: row.ctr, from, to, importedAt: now, importedBy: uid, source: "youtube-studio-export" },
        reach,
      },
      update: true,
    });
    ctx.inc("imported");
  }
  await writeBatched(db, ops);
  await db.doc("ytAnalytics/status").set({ studioImport: { ...summary, at: now, by: uid } }, { merge: true });
  return { ...summary, message: `Imported Studio impressions/CTR for ${ctx.counts.imported || 0} videos (${from || "lifetime"} → ${to}).` };
}

module.exports = { importStudio, checkRange };
