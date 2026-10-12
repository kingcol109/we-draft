// server/youtube-analytics/analytics.js
//
// "Sync Analytics": processed YouTube Analytics API data for the channel and
// every tracked video. Analytics data is per Pacific-time day, typically
// 1–3 days behind and revised for a few days after; `through` (the newest
// day the API returned for the channel) is stored with every window so the
// admin always sees what period a number covers.
//
// Per run (N tracked videos, chunks of 50 video IDs per query):
//   1  channel daily, last 35 days            → ytChannelDaily/{YYYY-MM-DD}
//   1  top-200 videos (lifetime)              → finds owned videos the public
//                                               uploads list doesn't show
//   4×⌈N/50⌉ per-video window totals          → ytVideos.analytics.{lifetime,
//        (lifetime, last 7, prior 7, last 28)   last7, prev7, last28}
//   A  daily rows, last 10 days, for each video with views in the last 28
//      days or published in the last 14 days → ytVideos/{id}/daily/{day}
//   1  channel traffic sources, last 28 days  → ytAnalytics/channel
//   then the player rollup                    → ytPlayerStats/{playerId}
// Windows with no row for a video mean no activity in that window (0), not
// missing data: the query covered it. Averages are left null when there's
// nothing to average.
//
// Daily docs are keyed by date, so re-fetching a day replaces that day's
// numbers with YouTube's latest revision instead of adding to them. When a
// revision changes a stored day, the first observed values are kept in
// firstObserved.

const g = require("./google");
const m = require("./metrics");
const { pool } = require("./runs");
const { configuredChannel, loadLegacy, loadTracked, fetchAndUpsert, writeBatched } = require("./videos");

const LIFETIME_START = "2005-04-23"; // first day YouTube Analytics can cover
const RECENT_DAYS = 10;

// One Analytics query per chunk of ≤50 video IDs, `dimensions=video`.
async function videoTotals(db, channelId, ids, startDate, endDate) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rep = await g.analyticsQuery(db, channelId, {
      startDate, endDate, metrics: m.ANALYTICS_METRICS, dimensions: "video",
      filters: `video==${chunk.join(",")}`, sort: "-views", maxResults: "200",
    });
    for (const r of m.rowsToObjects(rep)) out.set(r.video, m.normalizeMetrics(r));
  }
  return out;
}

const ZERO = { views: 0, minutesWatched: 0, avgViewDurationSec: null, avgViewPct: null, subsGained: 0, subsLost: 0, likes: 0, comments: 0, shares: 0 };

// Daily rows → write ops, keeping firstObserved when YouTube revises a day.
function dailyOps(db, videoId, rows, existing, source, now) {
  const ops = [];
  for (const r of rows) {
    const ex = existing.get(r.date);
    const allZero = m.SUMMABLE.every((k) => !r[k]);
    if (!ex && allZero) continue; // a day with no activity: absence == 0
    const data = { ...r, source, fetchedAt: now };
    if (ex && !ex.firstObserved && (ex.views !== r.views || ex.minutesWatched !== r.minutesWatched || ex.subsGained !== r.subsGained)) {
      data.firstObserved = { views: ex.views ?? null, minutesWatched: ex.minutesWatched ?? null, subsGained: ex.subsGained ?? null, subsLost: ex.subsLost ?? null, fetchedAt: ex.fetchedAt ?? null };
      data.revisions = (ex.revisions || 0) + 1;
    }
    ops.push({ ref: db.collection("ytVideos").doc(videoId).collection("daily").doc(r.date), data });
  }
  return ops;
}

async function videoDaily(db, channelId, videoId, startDate, endDate) {
  const rep = await g.analyticsQuery(db, channelId, {
    startDate, endDate, metrics: m.ANALYTICS_METRICS, dimensions: "day", filters: `video==${videoId}`, sort: "day",
  });
  return m.rowsToObjects(rep).map((r) => ({ date: r.day, ...m.normalizeMetrics(r) }));
}

// First-1/2/7-day windows, written only when newly complete (a complete
// window never changes again, so it's never recomputed from partial data).
function firstWindows(rows, publishDay, through, coveredFrom, prev) {
  const out = {};
  for (const n of [1, 2, 7]) {
    const key = `first${n}`;
    if (prev?.[key]?.complete) continue;
    const w = m.firstDays(rows, publishDay, through, coveredFrom, n);
    if (w) out[key] = w;
  }
  return out;
}

async function syncAnalytics(ctx) {
  const { db } = ctx;
  const { id: channelId } = await configuredChannel(db);
  const now = Date.now();
  const today = m.pacificDay(now);

  // 1. Channel daily — also tells us the newest reported day.
  const chRep = await g.analyticsQuery(db, channelId, { startDate: m.addDays(today, -35), endDate: today, metrics: m.ANALYTICS_METRICS, dimensions: "day", sort: "day" });
  const chRows = m.rowsToObjects(chRep).map((r) => ({ date: r.day, ...m.normalizeMetrics(r) }));
  const through = chRows.length ? chRows[chRows.length - 1].date : null;
  await writeBatched(db, chRows.map((r) => ({ ref: db.collection("ytChannelDaily").doc(r.date), data: { ...r, source: "analytics-api", fetchedAt: now } })));
  ctx.inc("channelDays", chRows.length);
  if (!through) return { message: "YouTube Analytics returned no data for this channel yet (new channels and new authorizations can take a day or two)." };

  // 2. Owned videos the uploads list didn't show (e.g. unlisted): the
  // lifetime top-200 by views.
  const [legacy, tracked] = await Promise.all([loadLegacy(db), loadTracked(db)]);
  const top = await g.analyticsQuery(db, channelId, { startDate: LIFETIME_START, endDate: through, metrics: "views", dimensions: "video", sort: "-views", maxResults: "200" });
  const unknown = m.rowsToObjects(top).map((r) => r.video).filter((id) => m.ID_RE.test(String(id)) && !tracked.has(id));
  if (unknown.length) {
    await fetchAndUpsert(ctx, unknown, { legacy, tracked, uploadsSet: null, discoveredVia: "analytics" });
    ctx.inc("discovered", unknown.length);
  }

  // 3. Window totals for every video on this channel.
  const ids = [...tracked.entries()].filter(([, v]) => !v.channelId || v.channelId === channelId).map(([id]) => id);
  await ctx.progress({ step: "windows", total: ids.length }, true);
  const [lifetime, last7, prev7, last28] = await Promise.all([
    videoTotals(db, channelId, ids, LIFETIME_START, through),
    videoTotals(db, channelId, ids, m.addDays(through, -6), through),
    videoTotals(db, channelId, ids, m.addDays(through, -13), m.addDays(through, -7)),
    videoTotals(db, channelId, ids, m.addDays(through, -27), through),
  ]);

  // 4. Recent daily rows for active / new videos.
  const recentFrom = m.addDays(through, -(RECENT_DAYS - 1));
  const active = ids.filter((id) => {
    const pub = tracked.get(id)?.yt?.publishedAt;
    return (last28.get(id)?.views || 0) > 0 || (pub && m.daysBetween(m.pacificDay(Date.parse(pub)), today) <= 14);
  });
  const recent = new Map();
  let done = 0;
  await pool(active, 5, async (id) => {
    const rows = await videoDaily(db, channelId, id, recentFrom, today);
    const exSnap = await Promise.all(rows.map((r) => db.collection("ytVideos").doc(id).collection("daily").doc(r.date).get()));
    const existing = new Map(exSnap.filter((s) => s.exists).map((s) => [s.id, s.data()]));
    const ops = dailyOps(db, id, rows, existing, "analytics-api", now);
    await writeBatched(db, ops);
    ctx.inc("dailyRows", ops.length);
    recent.set(id, rows);
    await ctx.progress({ step: "daily", done: ++done, total: active.length });
  }, { shouldStop: () => ctx.timeLeft() < 30000, onError: (e, id) => ctx.error(`${id}: ${e.message}`) });
  if (done < active.length) ctx.error(`Stopped early for time: daily rows refreshed for ${done} of ${active.length} active videos (run again to finish).`);

  // 5. Per-video analytics + performance fields.
  const ops = [];
  for (const id of ids) {
    const v = tracked.get(id) || {};
    const rows = recent.get(id);
    const publishDay = v.yt?.publishedAt ? m.pacificDay(Date.parse(v.yt.publishedAt)) : null;
    const a = {
      lifetime: lifetime.get(id) || null,
      last7: { ...(last7.get(id) || ZERO), from: m.addDays(through, -6), to: through },
      prev7: { ...(prev7.get(id) || ZERO), from: m.addDays(through, -13), to: m.addDays(through, -7) },
      last28: { ...(last28.get(id) || ZERO), from: m.addDays(through, -27), to: through },
      through, fetchedAt: now, source: "analytics-api",
    };
    a.growth7 = m.growthRate(a.last7.views, a.prev7.views);
    a.viewsPerDay7 = a.last7.views / 7;
    const data = { analytics: a };
    if (rows) {
      a.last1 = m.sumWindow(rows, through, through) || { ...ZERO, from: through, to: through };
      a.last2 = m.sumWindow(rows, m.addDays(through, -1), through) || { ...ZERO, from: m.addDays(through, -1), to: through };
      const coveredFrom = [v.history?.from, recentFrom].filter(Boolean).sort()[0];
      const perf = firstWindows(rows, publishDay, through, coveredFrom, v.perf);
      if (Object.keys(perf).length) data.perf = perf;
      data.history = { ...(v.history || {}), through: [v.history?.through, through].filter(Boolean).sort().pop() };
    } else {
      // Not refreshed this run: no views in 28 days means the latest day(s)
      // were 0 too; otherwise (a failed or skipped fetch) unknown, not stale.
      const quiet = !a.last28.views;
      a.last1 = quiet ? { ...ZERO, from: through, to: through } : null;
      a.last2 = quiet ? { ...ZERO, from: m.addDays(through, -1), to: through } : null;
    }
    ops.push({ ref: db.collection("ytVideos").doc(id), data });
    Object.assign(v, data);
    ctx.inc("videos");
  }
  await writeBatched(db, ops);

  // 6. Channel traffic sources (last 28 reported days).
  try {
    const ts = await g.analyticsQuery(db, channelId, { startDate: m.addDays(through, -27), endDate: through, metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", sort: "-views" });
    await db.doc("ytAnalytics/channel").set({
      trafficSources: { from: m.addDays(through, -27), to: through, rows: m.rowsToObjects(ts).map((r) => ({ source: r.insightTrafficSourceType, views: Number(r.views) || 0, minutesWatched: Number(r.estimatedMinutesWatched) || 0 })), fetchedAt: now },
    }, { merge: true });
  } catch (e) { ctx.error(`Traffic sources: ${e.message}`); }

  // 7. Player rollup.
  await writePlayerRollup(ctx, [...tracked.values()], legacy);

  await db.doc("ytAnalytics/status").set({ analyticsSummary: { channelId, through, videos: ids.length, active: active.length, at: now } }, { merge: true });
  return { through, message: `Analytics through ${through} (Pacific) for ${ids.length} videos.` };
}

// ytPlayerStats/{playerId}: sums over each player's associated videos
// (metrics.rollupPlayers). Players who no longer have any videos are zeroed,
// not deleted.
async function writePlayerRollup(ctx, ytVideos, legacy) {
  const { db } = ctx;
  const legacyById = legacy.byDoc;
  const roll = m.rollupPlayers(ytVideos, legacyById);
  const now = Date.now();
  const existing = await db.collection("ytPlayerStats").get();
  const ops = [];
  for (const [pid, p] of roll) ops.push({ ref: db.collection("ytPlayerStats").doc(pid), data: { ...p, updatedAt: now }, merge: false });
  for (const d of existing.docs) {
    if (!roll.has(d.id)) ops.push({ ref: d.ref, data: { playerId: d.id, videoCount: 0, publicViews: 0, analyticsViews: 0, views7d: 0, views28d: 0, subsGained: 0, subsLost: 0, minutesWatched: 0, videoIds: [], best: null, latestPublishedAt: null, updatedAt: now }, merge: false });
  }
  await writeBatched(db, ops);
  ctx.counts.players = roll.size;
}

// Detail drawer: one video's lifetime traffic sources (one query).
async function videoTrafficSources(db, videoId) {
  if (!m.ID_RE.test(String(videoId || ""))) throw g.httpError(400, "Bad video ID.");
  const { id: channelId } = await configuredChannel(db);
  const v = (await db.collection("ytVideos").doc(videoId).get()).data();
  if (!v) throw g.httpError(404, "That video isn't tracked.");
  const today = m.pacificDay();
  const from = v.yt?.publishedAt ? m.pacificDay(Date.parse(v.yt.publishedAt)) : LIFETIME_START;
  const rep = await g.analyticsQuery(db, channelId, { startDate: from, endDate: today, metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", filters: `video==${videoId}`, sort: "-views" });
  const trafficSources = { from, to: today, rows: m.rowsToObjects(rep).map((r) => ({ source: r.insightTrafficSourceType, views: Number(r.views) || 0, minutesWatched: Number(r.estimatedMinutesWatched) || 0 })), fetchedAt: Date.now() };
  await db.collection("ytVideos").doc(videoId).set({ trafficSources }, { merge: true });
  return { trafficSources };
}

module.exports = { syncAnalytics, videoTotals, videoDaily, dailyOps, firstWindows, writePlayerRollup, videoTrafficSources, LIFETIME_START };
