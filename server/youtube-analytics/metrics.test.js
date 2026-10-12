// server/youtube-analytics/metrics.test.js — the pure calculations.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const m = require("./metrics");

test("parseVideoId: every URL form stored in videos.Video", () => {
  for (const u of [
    "https://youtu.be/E96gYFGv9AM",
    "https://youtu.be/E96gYFGv9AM?si=abc&t=30",
    "https://youtube.com/shorts/E96gYFGv9AM?feature=share",
    "https://www.youtube.com/watch?v=E96gYFGv9AM&t=1s",
    "https://m.youtube.com/watch?v=E96gYFGv9AM",
    "https://www.youtube.com/embed/E96gYFGv9AM",
    "https://www.youtube.com/live/E96gYFGv9AM",
    " E96gYFGv9AM ",
    "https://youtu.be/E96gYFGv9AM.png", // real legacy typo
  ]) assert.equal(m.parseVideoId(u), "E96gYFGv9AM", u);
  for (const bad of ["Eli Heidenreich Draft Evaluation", "", null, "https://vimeo.com/123", "https://youtu.be/short", "https://youtube.com/watch?v=has spaces!", "https://youtu.be/E96gYFGv9AMX"]) {
    assert.equal(m.parseVideoId(bad), null, String(bad));
  }
});

test("parseDuration", () => {
  assert.equal(m.parseDuration("PT1H2M3S"), 3723);
  assert.equal(m.parseDuration("PT45S"), 45);
  assert.equal(m.parseDuration("P1DT1S"), 86401);
  assert.equal(m.parseDuration("P0D"), 0);
  assert.equal(m.parseDuration("junk"), null);
});

test("pacificDay / addDays / daysBetween", () => {
  // 2026-10-12 05:00 UTC is still Oct 11 in Los Angeles.
  assert.equal(m.pacificDay(Date.parse("2026-10-12T05:00:00Z")), "2026-10-11");
  assert.equal(m.pacificDay(Date.parse("2026-10-12T08:00:00Z")), "2026-10-12");
  assert.equal(m.addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(m.addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(m.daysBetween("2026-10-01", "2026-10-08"), 7);
});

test("normalizeMetrics keeps missing metrics null, not 0", () => {
  const r = m.normalizeMetrics({ views: "12", estimatedMinutesWatched: 30, likes: null });
  assert.equal(r.views, 12);
  assert.equal(r.minutesWatched, 30);
  assert.equal(r.likes, null);
  assert.equal(r.subsGained, null);
});

const rows = [
  { date: "2026-10-01", views: 100, minutesWatched: 50, subsGained: 3, subsLost: 1 },
  { date: "2026-10-02", views: 40, minutesWatched: 20, subsGained: 1, subsLost: 0 },
  // 10-03 missing: no activity
  { date: "2026-10-04", views: 10, minutesWatched: 5, subsGained: 0, subsLost: 0, impressions: 1000, impressionsCtr: 0.05 },
  { date: "2026-10-05", views: 5, minutesWatched: 2, subsGained: 0, subsLost: 0, impressions: 1000, impressionsCtr: 0.03 },
];

test("sumWindow sums daily rows (never cumulative totals) and weights CTR by impressions", () => {
  const s = m.sumWindow(rows, "2026-10-01", "2026-10-05");
  assert.equal(s.views, 155);
  assert.equal(s.subsGained, 4);
  assert.equal(s.impressions, 2000);
  assert.ok(Math.abs(s.impressionsCtr - 0.04) < 1e-12);
  assert.equal(m.sumWindow(rows, "2026-09-01", "2026-09-30"), null, "no rows in window → null, not 0");
});

test("firstDays: only complete windows get numbers", () => {
  const f1 = m.firstDays(rows, "2026-10-01", "2026-10-05", "2026-10-01", 1);
  assert.deepEqual([f1.complete, f1.views], [true, 100]);
  const f2 = m.firstDays(rows, "2026-10-01", "2026-10-05", "2026-10-01", 2);
  assert.equal(f2.views, 140);
  assert.equal(m.firstDays(rows, "2026-10-01", "2026-10-05", "2026-10-01", 7).complete, false, "not 7 days reported yet");
  assert.equal(m.firstDays(rows, "2026-10-01", "2026-10-05", "2026-10-02", 1).complete, false, "history doesn't reach the publish day");
});

test("growthRate", () => {
  assert.equal(m.growthRate(150, 100), 0.5);
  assert.equal(m.growthRate(10, 0), null);
  assert.equal(m.growthRate(null, 5), null);
});

test("snapshot ring: bounded, dedupes unchanged counts, deltas only near the target time", () => {
  const H = 3600e3, t0 = Date.parse("2026-10-10T00:00:00Z");
  let ring = [];
  for (let h = 0; h <= 48; h += 3) ring = m.pushRing(ring, t0 + h * H, 1000 + h * 10);
  assert.ok(ring.length <= m.RING_MAX);
  const now = t0 + 48 * H;
  assert.deepEqual(m.ringDelta(ring, 24, now).views, 240);
  assert.equal(m.ringDelta(ring, 72, now), null, "nothing within tolerance of 72h ago → null");
  assert.equal(m.pushRing(ring, now + 60e3, 1480).length, ring.length, "same count within the hour isn't a new point");
});

test("parseCsv + aggregateReach", () => {
  const csv = 'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261001,UCx,E96gYFGv9AM,1000,0.05\n20261001,UCx,E96gYFGv9AM,1000,0.03\n20261001,UCx,"bad",5,0.1\n';
  const agg = m.aggregateReach(m.parseCsv(csv));
  assert.equal(agg.size, 1);
  const a = agg.get("E96gYFGv9AM|2026-10-01");
  assert.equal(a.impressions, 2000);
  assert.ok(Math.abs(a.impressionsCtr - 0.04) < 1e-12);
});

test("rollupPlayers: sums per player, legacy associations win, ignored videos excluded", () => {
  const legacy = new Map([["L1", { playerIds: ["p1", "p2"] }]]);
  const vids = [
    { videoId: "a", legacyDocId: "L1", playerIds: ["pX"], stats: { views: 100 }, analytics: { last7: { views: 10 }, lifetime: { subsGained: 5 } }, yt: { title: "A" } },
    { videoId: "b", legacyDocId: null, playerIds: ["p1"], stats: { views: 300 }, analytics: { last7: { views: 30 }, lifetime: { subsGained: 2 } }, yt: { title: "B" } },
    { videoId: "c", legacyDocId: null, playerIds: ["p1"], stats: { views: 999 }, review: { status: "ignored" } },
  ];
  const r = m.rollupPlayers(vids, legacy);
  assert.deepEqual([...r.keys()].sort(), ["p1", "p2"], "pX is ignored: the linked legacy doc's associations are the record");
  const p1 = r.get("p1");
  assert.equal(p1.videoCount, 2);
  assert.equal(p1.publicViews, 400);
  assert.equal(p1.views7d, 40);
  assert.equal(p1.subsGained, 7);
  assert.equal(p1.best.videoId, "b");
  assert.equal(r.get("p2").publicViews, 100, "a 2-player video counts fully for each player");
});

test("applyReachDay: replaces a day instead of adding; reachWindow sums kept days", () => {
  let r = m.applyReachDay(null, "2026-10-01", 1000, 0.05);
  r = m.applyReachDay(r, "2026-10-02", 500, 0.02);
  assert.equal(r.impressions, 1500);
  assert.ok(Math.abs(r.clicks - 60) < 1e-9);
  r = m.applyReachDay(r, "2026-10-01", 1200, 0.05); // re-issued day
  assert.equal(r.impressions, 1700);
  assert.ok(Math.abs(r.ctr - 70 / 1700) < 1e-12);
  assert.deepEqual([r.firstDay, r.lastDay], ["2026-10-01", "2026-10-02"]);
  assert.equal(m.reachWindow(r, "2026-10-02", "2026-10-02").impressions, 500);
  assert.equal(m.reachWindow(r, "2026-09-01", "2026-09-30"), null);
  for (let i = 0; i < 120; i++) r = m.applyReachDay(r, m.addDays("2026-10-03", i), 10, 0.1);
  assert.equal(Object.keys(r.days).length, m.REACH_KEEP_DAYS, "bounded");
  assert.equal(r.impressions, 1700 + 1200, "totals keep days that aged out of the map");
});

test("parseStudioTable: finds columns by name, skips the Total row, reads CTR as a percent", () => {
  const csv = "﻿" + [
    "Content,Video title,Video publish time,Duration,Views,Impressions,Impressions click-through rate (%)",
    "Total,,,,9000,100000,4.5",
    'E96gYFGv9AM,"Legree, Jesse breakdown",Oct 1 2026,540,600,20000,5',
    "BBBBBBBBBB2,Other,Oct 5 2026,700,30,1000,",
    "not-an-id,x,,,,5,1",
    "",
  ].join("\n");
  const p = m.parseStudioTable(csv);
  assert.equal(p.error, undefined);
  assert.equal(p.rows.length, 2);
  assert.equal(p.skipped, 2);
  const a = p.rows.find((r) => r.videoId === "E96gYFGv9AM");
  assert.deepEqual([a.impressions, a.ctr, a.clicks, a.title], [20000, 0.05, 1000, "Legree, Jesse breakdown"]);
  assert.equal(p.rows.find((r) => r.videoId === "BBBBBBBBBB2").ctr, null, "blank CTR stays unknown");
  assert.match(m.parseStudioTable("Content,Views\nE96gYFGv9AM,5\n").error, /Impressions/);
});

test("Studio + API reach: each day counted once", () => {
  // API has 09-20 (before the export's end) and 10-14 (after it).
  let r = m.applyReachDay(null, "2026-09-20", 1000, 0.1);
  r = m.applyReachDay(r, "2026-10-14", 500, 0.02);
  r = m.withStudioCutoff(r, "2026-10-12");
  assert.deepEqual([r.after.impressions, r.after.clicks], [500, 10]);
  const studio = { impressions: 50000, clicks: 2500, ctr: 0.05, from: null, to: "2026-10-12" };
  const c = m.combinedReach(r, studio);
  assert.equal(c.impressions, 50500, "Studio total + only the API day after its end — 09-20 not added again");
  assert.deepEqual(c.sources, ["studio", "api"]);
  assert.equal(c.to, "2026-10-14");
  // A later API day (and a re-issue of one) lands in "after" too.
  r = m.applyReachDay(r, "2026-10-15", 100, 0.1);
  r = m.applyReachDay(r, "2026-10-14", 600, 0.02);
  assert.equal(r.after.impressions, 700);
  assert.equal(m.combinedReach(r, studio).impressions, 50700);
  // Without a Studio import, the API totals stand alone.
  assert.equal(m.combinedReach(r, null).impressions, 1700);
  assert.equal(m.combinedReach(null, null), null);
  // A cutoff can't be set once API days after it have aged out.
  let old = m.applyReachDay(null, "2026-01-01", 10, 0.1);
  for (let i = 0; i < 100; i++) old = m.applyReachDay(old, m.addDays("2026-03-01", i), 1, 0);
  assert.equal(m.withStudioCutoff(old, "2026-01-05"), null);
});
