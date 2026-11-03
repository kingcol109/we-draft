// server/instagram/sync.test.js — Instagram Analytics' math (metrics.js) and
// syncs (sync.js) with Firestore and Meta faked: Pacific days across DST,
// the engagement rate, re-runs that overwrite instead of duplicating, and
// links to We-Draft posts that syncs never touch.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("../stream-manager/__fakes__/firestore");
const M = require("./metrics");
const sync = require("./sync");

test("Pacific days and midnights, across the November DST change", () => {
  assert.equal(M.pacificDay(Date.parse("2026-11-03T07:59:00Z")), "2026-11-02");
  assert.equal(M.pacificDay(Date.parse("2026-11-03T08:00:00Z")), "2026-11-03");
  assert.equal(new Date(M.pacificMidnight("2026-10-31")).toISOString(), "2026-10-31T07:00:00.000Z"); // PDT
  assert.equal(new Date(M.pacificMidnight("2026-11-02")).toISOString(), "2026-11-02T08:00:00.000Z"); // PST
  assert.equal(M.dayOfEndTime("2026-11-02T08:00:00+0000"), "2026-11-01");
  assert.equal(M.addDays("2026-03-01", -1), "2026-02-28");
});

test("reading Meta's insights: totals, lifetime values, breakdowns, series", () => {
  assert.deepEqual(M.readInsights({ data: [{ name: "reach", total_value: { value: 53 } }, { name: "views", values: [{ value: 281 }] }] }), { reach: 53, views: 281 });
  assert.deepEqual(M.readInsights({ data: [{ name: "follows_and_unfollows", total_value: { breakdowns: [{ results: [{ dimension_values: ["FOLLOWER"], value: 2 }, { dimension_values: ["NON_FOLLOWER"], value: 1 }] }] } }] }),
    { follows_and_unfollows: { FOLLOWER: 2, NON_FOLLOWER: 1 } });
  assert.deepEqual(M.readSeries({ data: [{ name: "reach", values: [{ value: 28, end_time: "2026-10-30T07:00:00+0000" }, { value: 40, end_time: "2026-11-02T08:00:00+0000" }] }] }, "reach"),
    { "2026-10-29": 28, "2026-11-01": 40 });
  assert.deepEqual(M.readBreakdown({ data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: ["F"], value: 13 }, { dimension_values: ["M"], value: 532 }] }] } }] }).map((r) => r.key), ["M", "F"]);
});

test("engagement rate: (likes + comments + saved + shares) ÷ reach, one denominator", () => {
  assert.deepEqual(M.postCalc({ reach: 200, likes: 10, comments: 2, saved: 3, shares: 5 }), { engagement: 20, engagementRate: 0.1 });
  // A missing insight falls back to the public count; no reach, no rate.
  assert.deepEqual(M.postCalc({ saved: 1 }, { likes: 4, comments: 1 }), { engagement: 6, engagementRate: null });
  assert.equal(M.postCalc({ reach: 0, likes: 3 }).engagementRate, null);
});

test("how often insights are re-read, and when a day is final", () => {
  const now = Date.parse("2026-11-03T18:00:00Z");
  const ago = (d) => new Date(now - d * 86400e3).toISOString();
  assert.equal(M.insightsDue({ timestamp: ago(1), metricsAt: now - 6 * 3600e3 }, now), true);
  assert.equal(M.insightsDue({ timestamp: ago(30), metricsAt: now - 6 * 3600e3 }, now), false);
  assert.equal(M.insightsDue({ timestamp: ago(300), metricsAt: now - 8 * 86400e3 }, now), true);
  assert.equal(M.dayFinal("2026-10-29", now), true);
  assert.equal(M.dayFinal("2026-11-01", now), false);
  assert.equal(M.dayFinal("2026-10-01", null), false);
});

// Meta, for the syncs.
function fakeMeta() {
  const m = { calls: [] };
  const media = [
    { id: "R1", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-01T16:00:00+0000", caption: "Reel", permalink: "https://www.instagram.com/reel/R1/", like_count: 87, comments_count: 1, thumbnail_url: "https://cdn/r1.jpg" },
    { id: "P1", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", timestamp: "2026-10-25T15:34:03+0000", caption: "Mock", permalink: "https://www.instagram.com/p/P1/", like_count: 3, comments_count: 0, media_url: "https://cdn/p1.jpg" },
  ];
  m.graph = async (path, { params = {} } = {}) => {
    m.calls.push({ path, params });
    if (path === "/IG1" ) return { username: "wedraftsite", followers_count: 731, follows_count: 10, media_count: 2 };
    if (path === "/IG1/media") return params.after ? { data: [media[1]] } : { data: [media[0]], paging: { next: "x", cursors: { after: "c1" } } };
    if (path === "/IG1/insights") {
      if (params.metric === "follower_count") return { data: [{ name: "follower_count", values: [{ value: 1, end_time: "2026-11-02T08:00:00+0000" }] }] };
      if (params.metric === "follows_and_unfollows") return { data: [{ name: "follows_and_unfollows", total_value: { breakdowns: [{ results: [{ dimension_values: ["FOLLOWER"], value: 2 }, { dimension_values: ["NON_FOLLOWER"], value: 1 }] }] } }] };
      if (/demographics/.test(params.metric)) return { data: [{ total_value: { breakdowns: [{ results: [{ dimension_values: ["US"], value: 500 }] }] } }] };
      return { data: params.metric.split(",").map((name) => ({ name, total_value: { value: 5 } })) };
    }
    const id = path.match(/^\/(\w+)\/insights$/)?.[1];
    if (id) {
      // A reel refuses profile_visits (not one of its metrics) — the set is reels' own, so it isn't asked.
      if (params.metric.includes("profile_visits") && id === "R1") throw Object.assign(new Error("(#100) unsupported"), { status: 400, metaCode: 100 });
      return { data: params.metric.split(",").map((name) => ({ name, values: [{ value: name === "reach" ? 100 : 4 }] })) };
    }
    throw new Error(`fake meta: no route ${path}`);
  };
  return m;
}

test("account sync: followers observed, days backfilled once, demographics; a re-run doesn't duplicate", async () => {
  const db = fakeFirestore();
  const meta = fakeMeta();
  let now = Date.parse("2026-11-03T18:00:00Z");
  const opts = { graph: meta.graph, userId: "IG1", now: () => now };
  const r = await sync.runOp(db, "account", opts);
  assert.equal(r.state, "ok");
  assert.equal(r.counts.days, sync.BACKFILL_DAYS);
  const today = db.data("igAccountDaily/2026-11-03");
  assert.equal(today.calc.followers, 731);
  assert.equal(today.meta.reach, 5);
  assert.equal(today.meta.follows, 2);
  assert.equal(today.meta.unfollows, 1);
  assert.equal(today.partial, true);
  assert.equal(db.data("igAccountDaily/2026-11-01").meta.newFollowers, 1);
  assert.equal(db.data("igAnalytics/demographics").follower.country[0].key, "US");
  assert.ok(db.data("igDemographics/2026-11"));
  const rows = () => [...db.store.keys()].filter((k) => k.startsWith("igAccountDaily/")).length;
  const before = rows();
  // An hour later: only the days that aren't final yet are read again.
  now += 3600e3;
  const r2 = await sync.runOp(db, "account", opts);
  assert.ok(r2.counts.days <= 4, `re-read ${r2.counts.days} days`);
  assert.equal(rows(), before);
  assert.equal(r2.counts.demographics, undefined); // once a day
  assert.equal(db.data("igAnalytics/status").sync.account.state, "ok");
  assert.equal(db.data("igAnalytics/lock"), undefined);
});

test("media sync: every page listed, insights by type, snapshot a day, the We-Draft link kept", async () => {
  const db = fakeFirestore({ "igMedia/P1": { id: "P1", postId: "post9", playerIds: ["row_939"], postName: "2027 Mock" }, "instagramPosts/post9": { status: "published", ig: { mediaId: "P1", permalink: null } } });
  const meta = fakeMeta();
  let now = Date.parse("2026-11-03T18:00:00Z");
  const opts = { graph: meta.graph, userId: "IG1", now: () => now };
  const r = await sync.runOp(db, "media", opts);
  assert.equal(r.counts.listed, 2);
  assert.equal(r.counts.insights, 2);
  const reel = db.data("igMedia/R1");
  assert.equal(reel.productType, "REELS");
  assert.equal(reel.meta.ig_reels_avg_watch_time, 4);
  assert.equal(reel.meta.profile_visits, undefined);
  assert.equal(reel.calc.engagementRate, (4 + 4 + 4 + 4) / 100);
  const post = db.data("igMedia/P1");
  assert.equal(post.postId, "post9");
  assert.deepEqual(post.playerIds, ["row_939"]);
  assert.equal(post.meta.profile_visits, 4);
  assert.ok(db.data("igMedia/P1/daily/2026-11-03"));
  assert.equal(db.data("instagramPosts/post9").ig.permalink, "https://www.instagram.com/p/P1/");
  // Two hours later: nothing is due yet, nothing duplicated.
  now += 2 * 3600e3;
  const r2 = await sync.runOp(db, "media", opts);
  assert.equal(r2.counts.insights, undefined);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith("igMedia/P1/daily/")).length, 1);
  assert.equal(r2.counts.deleted, undefined);
  // A post deleted on Instagram: marked, its record and link kept.
  db.store.set("igMedia/GONE", { id: "GONE", postId: "post8", timestampMs: 1 });
  const r3 = await sync.runOp(db, "media", opts);
  assert.equal(r3.counts.deleted, 1);
  assert.equal(db.data("igMedia/GONE").deleted, true);
  assert.equal(db.data("igMedia/GONE").postId, "post8");
  assert.equal(db.data("igMedia/R1").deleted, undefined);
});

test("one sync at a time", async () => {
  const db = fakeFirestore({ "igAnalytics/lock": { runId: "x", op: "media", startedAt: Date.now(), expiresAt: Date.now() + 60e3 } });
  await assert.rejects(sync.runOp(db, "account", { graph: fakeMeta().graph, userId: "IG1" }), (e) => e.status === 409 && e.code === "locked");
});
