// server/youtube-analytics/history.js
//
// "Sync Historical Data": two sources, both idempotent.
//
// 1. YouTube Reporting API — impressions and impressions click-through rate.
//    The Analytics API has no thumbnail-impression metrics; they're only in
//    the Reporting API's channel_reach_basic_a1 report (one row per video
//    per day: video_thumbnail_impressions, video_thumbnail_impressions_ctr).
//    The first run creates a reporting job for that report type. YouTube
//    then generates one report per Pacific day, starting within ~48 hours,
//    plus (usually) reports for the 30 days before the job was created;
//    reports stay downloadable for 60 days (30 for historical ones). Days
//    before that window can't be recovered — impressions history starts
//    there. Each import merges { impressions, impressionsCtr } into
//    ytVideos/{id}/daily/{date} and ytChannelDaily/{date}. When YouTube
//    re-issues a day (a backfill/correction: same startTime, newer
//    createTime) only the newest report for that day is imported, and its
//    numbers replace the old ones — never added to them.
//
// 2. YouTube Analytics API backfill — every tracked video's daily views,
//    watch time, average view duration/percentage, subscribers gained/lost,
//    likes, comments and shares from its publish day to today, one query
//    per video. Newest videos first, as many as fit in the time budget;
//    progress is kept on ytAnalytics/status backfill and per video in
//    ytVideos.history { from, through, complete }, so the next run (another
//    click, or the "continue" loop the admin page runs automatically)
//    resumes where this one stopped. Days with no activity aren't stored
//    (inside a backfilled range, a missing day means 0). Also backfills
//    channel-level daily totals once.

const g = require("./google");
const m = require("./metrics");
const { pool } = require("./runs");
const { configuredChannel, loadTracked, writeBatched } = require("./videos");
const { videoDaily, dailyOps, firstWindows, LIFETIME_START } = require("./analytics");

const REACH_REPORT = "channel_reach_basic_a1";
const REPORTING = "ytAnalytics/reporting";
// Bump to rebuild every video's reach totals from the reports YouTube still
// offers (the import below then starts from empty totals).
const REACH_TOTALS_VERSION = 1;

// ── Reporting API ──

async function ensureReachJob(db, ctx) {
  const state = (await db.doc(REPORTING).get()).data() || {};
  if (state.jobId) return state;
  const types = await g.reportingGet(db, "reportTypes");
  if (!(types.reportTypes || []).some((t) => t.id === REACH_REPORT)) {
    await db.doc(REPORTING).set({ unavailable: `Report type ${REACH_REPORT} isn't offered to this channel.`, checkedAt: Date.now() }, { merge: true });
    return { unavailable: true };
  }
  const jobs = await g.reportingGet(db, "jobs");
  let job = (jobs.jobs || []).find((j) => j.reportTypeId === REACH_REPORT);
  if (!job) {
    job = await g.reportingPost(db, "jobs", { reportTypeId: REACH_REPORT, name: "We-Draft reach (impressions/CTR)" });
    ctx.inc("reportingJobCreated");
  }
  const next = { jobId: job.id, reportTypeId: REACH_REPORT, jobCreatedAt: job.createTime || null, lastCreateTime: null, importedDays: {}, unavailable: null };
  await db.doc(REPORTING).set(next, { merge: true });
  return next;
}

async function importReach(ctx, tracked) {
  const { db } = ctx;
  const state = await ensureReachJob(db, ctx);
  if (state.unavailable) return { reach: "unavailable" };

  // All reports, paginated. createdAfter would skip a re-issued day whose
  // createTime is older than our newest import, so the full (≤60-day) list
  // is compared against importedDays instead.
  const reports = [];
  let pageToken;
  do {
    const j = await g.reportingGet(db, `jobs/${state.jobId}/reports`, pageToken ? { pageToken } : {});
    reports.push(...(j.reports || []));
    pageToken = j.nextPageToken;
  } while (pageToken);

  // Newest report per day.
  const byDay = new Map();
  for (const r of reports) {
    const day = m.pacificDay(Date.parse(r.startTime) + 12 * 3600e3); // startTime is midnight PT
    if (!byDay.has(day) || r.createTime > byDay.get(day).createTime) byDay.set(day, r);
  }
  // Per-video totals (ytVideos.reach) didn't exist before version 1: start
  // them empty and re-import every report still available.
  const rebuild = state.totalsVersion !== REACH_TOTALS_VERSION;
  const imported = rebuild ? {} : state.importedDays || {};
  // A rebuilt total keeps the video's Studio cutoff (studio.js), so API days
  // after an imported Studio export are still counted separately.
  const fresh = (v) => (v.studioReach?.to ? m.emptyReach(v.studioReach.to) : null);
  const reach = new Map([...tracked].map(([id, v]) => [id, rebuild ? fresh(v) : v.reach || null]));
  if (rebuild) {
    await writeBatched(db, [...tracked.keys()].map((id) => ({ ref: db.collection("ytVideos").doc(id), data: { reach: reach.get(id) }, update: true })));
    await db.doc(REPORTING).update({ totalsVersion: REACH_TOTALS_VERSION, importedDays: {} });
    ctx.inc("reachTotalsRebuilt");
  }
  const todo = [...byDay.entries()].filter(([day, r]) => imported[day] !== r.createTime).sort(([a], [b]) => (a < b ? -1 : 1));
  ctx.counts.reportsAvailable = byDay.size;
  if (!reports.length) return { reach: "waiting", message: "The reach reporting job exists; YouTube hasn't generated its first report yet (usually within 48 hours of the job being created)." };

  for (const [day, r] of todo) {
    if (ctx.timeLeft() < 60000) { ctx.error(`Stopped importing reach reports for time; ${todo.length - (ctx.counts.reportsImported || 0)} left for the next run.`); break; }
    const csv = await g.reportingDownload(db, r.downloadUrl);
    const agg = m.aggregateReach(m.parseCsv(csv));
    const ops = [];
    const perDay = new Map();
    const changed = new Set();
    const seen = new Set();
    for (const a of agg.values()) {
      const t = perDay.get(a.date) || { impressions: 0, clicks: 0 };
      t.impressions += a.impressions; t.clicks += a.impressions * (a.impressionsCtr || 0);
      perDay.set(a.date, t);
      if (!tracked.has(a.videoId)) { ctx.inc("reachRowsUntracked"); continue; }
      seen.add(`${a.videoId}|${a.date}`);
      ops.push({ ref: db.collection("ytVideos").doc(a.videoId).collection("daily").doc(a.date), data: { date: a.date, impressions: a.impressions, impressionsCtr: a.impressionsCtr, reachSource: "reporting-api", reachReportCreateTime: r.createTime } });
      reach.set(a.videoId, m.applyReachDay(reach.get(a.videoId), a.date, a.impressions, a.impressionsCtr));
      changed.add(a.videoId);
    }
    // A re-issued day replaces the old one completely: a video that had
    // impressions that day but isn't in the new report goes to 0.
    for (const [id, rc] of reach) {
      for (const d of Object.keys(rc?.days || {})) {
        if (d !== day || seen.has(`${id}|${d}`) || !rc.days[d][0]) continue;
        reach.set(id, m.applyReachDay(rc, d, 0, null));
        ops.push({ ref: db.collection("ytVideos").doc(id).collection("daily").doc(d), data: { impressions: 0, impressionsCtr: null, reachReportCreateTime: r.createTime } });
        changed.add(id);
      }
    }
    for (const id of changed) ops.push({ ref: db.collection("ytVideos").doc(id), data: { reach: reach.get(id) }, update: true });
    for (const [date, t] of perDay) {
      ops.push({ ref: db.collection("ytChannelDaily").doc(date), data: { date, impressions: t.impressions, impressionsCtr: t.impressions ? t.clicks / t.impressions : null, reachReportCreateTime: r.createTime } });
    }
    await writeBatched(db, ops);
    imported[day] = r.createTime;
    // Bounded: only the days YouTube still offers (≤60) are kept.
    const keep = Object.fromEntries(Object.entries(imported).filter(([d]) => byDay.has(d)));
    await db.doc(REPORTING).update({ importedDays: keep, lastImportAt: Date.now() }); // update: replaces the map
    ctx.inc("reportsImported");
    ctx.inc("reachRows", ops.length);
    await ctx.progress({ step: "reach", done: ctx.counts.reportsImported, total: todo.length });
  }
  return { reach: "ok" };
}

// ── Analytics API backfill ──

async function backfillChannel(ctx, channelId, earliestDay, today) {
  const { db } = ctx;
  const st = (await db.doc("ytAnalytics/status").get()).data()?.backfill || {};
  if (st.channelFrom && st.channelFrom <= earliestDay) return;
  const rows = [];
  // ≤ 1 year per query keeps responses small.
  for (let from = earliestDay; from <= today; from = m.addDays(from, 365)) {
    const to = [m.addDays(from, 364), today].sort()[0];
    const rep = await g.analyticsQuery(db, channelId, { startDate: from, endDate: to, metrics: m.ANALYTICS_METRICS, dimensions: "day", sort: "day" });
    rows.push(...m.rowsToObjects(rep).map((r) => ({ date: r.day, ...m.normalizeMetrics(r) })));
  }
  const now = Date.now();
  await writeBatched(db, rows.filter((r) => m.SUMMABLE.some((k) => r[k])).map((r) => ({ ref: db.collection("ytChannelDaily").doc(r.date), data: { ...r, source: "analytics-api", fetchedAt: now } })));
  ctx.inc("channelDays", rows.length);
  await db.doc("ytAnalytics/status").set({ backfill: { channelFrom: earliestDay } }, { merge: true });
}

async function syncHistory(ctx) {
  const { db } = ctx;
  const { id: channelId } = await configuredChannel(db);
  const tracked = await loadTracked(db);
  const today = m.pacificDay();
  const out = {};

  // 1. Reach reports (impressions / CTR).
  try { Object.assign(out, await importReach(ctx, tracked)); } catch (e) {
    if (e.code === "quota" || e.code === "needs_reconnect" || e.code === "not_connected") throw e;
    ctx.error(`Reporting API (impressions/CTR): ${e.message}`);
  }

  // 2. Per-video backfill, newest first.
  const mine = [...tracked.values()].filter((v) => (!v.channelId || v.channelId === channelId) && v.yt?.publishedAt);
  const todo = mine.filter((v) => !v.history?.complete).sort((a, b) => (a.yt.publishedAt < b.yt.publishedAt ? 1 : -1));
  const total = mine.length;
  let done = total - todo.length;
  const earliest = mine.map((v) => m.pacificDay(Date.parse(v.yt.publishedAt))).sort()[0];
  if (earliest) {
    try { await backfillChannel(ctx, channelId, earliest < LIFETIME_START ? LIFETIME_START : earliest, today); } catch (e) {
      if (e.code === "quota" || e.code === "needs_reconnect" || e.code === "not_connected") throw e;
      ctx.error(`Channel daily backfill: ${e.message}`);
    }
  }
  await ctx.progress({ step: "backfill", done, total }, true);

  const now = Date.now();
  await pool(todo, 4, async (v) => {
    const publishDay = m.pacificDay(Date.parse(v.yt.publishedAt));
    const rows = await videoDaily(db, channelId, v.videoId, publishDay, today);
    const ops = dailyOps(db, v.videoId, rows, new Map(), "analytics-api", now);
    const through = rows.length ? rows[rows.length - 1].date : null;
    const history = { from: publishDay, through: [v.history?.through, through].filter(Boolean).sort().pop() || null, complete: true, backfilledAt: now, days: rows.length };
    const perf = history.through ? firstWindows(rows, publishDay, history.through, publishDay, v.perf) : {};
    ops.push({ ref: db.collection("ytVideos").doc(v.videoId), data: { history, ...(Object.keys(perf).length ? { perf } : {}) } });
    await writeBatched(db, ops);
    ctx.inc("videosBackfilled");
    ctx.inc("dailyRows", ops.length - 1);
    done++;
    await ctx.progress({ step: "backfill", done, total, last: v.videoId });
  }, {
    shouldStop: () => ctx.timeLeft() < 25000,
    onError: (e, v) => ctx.error(`${v.videoId}: ${e.message}`),
  });

  const remaining = total - done;
  const progress = { step: "backfill", done, total, remaining };
  await db.doc("ytAnalytics/status").set({ backfill: { done, total, remaining, updatedAt: Date.now() } }, { merge: true });
  return {
    ...out, progress,
    more: remaining > 0 && (ctx.counts.videosBackfilled || 0) > 0,
    message: remaining ? `Backfilled ${done} of ${total} videos — ${remaining} left.` : `All ${total} videos backfilled.`,
  };
}

module.exports = { syncHistory, importReach, REACH_REPORT };
