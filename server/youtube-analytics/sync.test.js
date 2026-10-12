// server/youtube-analytics/sync.test.js — the syncs and admin actions end to
// end through api/youtube-analytics.js, with Firebase and every Google API
// faked. The point: legacy video records come through untouched, re-runs
// never duplicate or double count, and only admins (or the cron secret) get in.

const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { fakeFirestore } = require("../stream-manager/__fakes__/firestore");

let db;
require.cache[path.resolve(__dirname, "../../scripts/firebaseAdmin.js")] = {
  id: "firebaseAdmin", loaded: true, exports: { getFirestore: () => db },
};

const API_KEY = "test-api-key-SECRET123";
process.env.YOUTUBE_API_KEY = API_KEY;
process.env.YOUTUBE_CLIENT_ID = "cid";
process.env.YOUTUBE_CLIENT_SECRET = "csecret";
process.env.YOUTUBE_REFRESH_TOKEN = "env-refresh-token";
process.env.STREAM_MANAGER_TOKEN_KEY = "k".repeat(40);
process.env.CRON_SECRET = "cron-secret";
delete process.env.YOUTUBE_CHANNEL_ID;

const CH = "UC" + "a".repeat(22);
// Channel content: V1 linked to a legacy record, V2 new, V3 legacy Short.
const V = { V1: "AAAAAAAAAA1", V2: "BBBBBBBBBB2", V3: "CCCCCCCCCC3", UNL: "DDDDDDDDDD4" };

let yt; // fake YouTube state, reset per test
function freshYt() {
  return {
    uploads: [V.V2, V.V1, V.V3],
    videos: {
      [V.V1]: { title: "Jesse Legree Draft Scouting Report", publishedAt: "2026-10-01T16:00:00Z", duration: "PT9M", views: 1000 },
      [V.V2]: { title: "Three Defensive Backs to Watch in 2027", publishedAt: "2026-10-05T16:00:00Z", duration: "PT12M", views: 200, description: "Featuring https://we-draft.com/player/jesse-legree-2027-db" },
      [V.V3]: { title: "Big hit", publishedAt: "2026-09-20T16:00:00Z", duration: "PT40S", views: 5000 },
      [V.UNL]: { title: "Unlisted one", publishedAt: "2026-09-01T16:00:00Z", duration: "PT5M", views: 7 },
    },
    // daily analytics: videoId → { day: views }
    daily: {
      [V.V1]: { "2026-10-01": 300, "2026-10-02": 200, "2026-10-03": 100, "2026-10-08": 50, "2026-10-09": 40, "2026-10-10": 30 },
      [V.V2]: { "2026-10-05": 120, "2026-10-06": 50, "2026-10-09": 20, "2026-10-10": 10 },
      [V.V3]: { "2026-09-20": 4000, "2026-10-10": 1 },
      [V.UNL]: { "2026-09-01": 7 },
    },
    reports: [],
    files: {},
    jobs: [],
    calls: [],
    tokenError: null,
    quotaError: false,
  };
}

const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

function analyticsResponse(p) {
  const metrics = p.get("metrics").split(",");
  const dims = p.get("dimensions") || "";
  const from = p.get("startDate"), to = p.get("endDate");
  const filt = (p.get("filters") || "").replace(/^video==/, "");
  const vids = filt ? filt.split(",") : Object.keys(yt.daily);
  const val = (m, views) => ({ views, estimatedMinutesWatched: views * 2, averageViewDuration: 120, averageViewPercentage: 40, subscribersGained: Math.floor(views / 100), subscribersLost: 0, likes: Math.floor(views / 10), comments: 0, shares: 0, engagedViews: views }[m] ?? 0);
  const rowsFor = (vid) => Object.entries(yt.daily[vid] || {}).filter(([d]) => d >= from && d <= to);
  let rows;
  if (dims === "day") {
    const byDay = {};
    for (const v of vids) for (const [d, n] of rowsFor(v)) byDay[d] = (byDay[d] || 0) + n;
    rows = Object.keys(byDay).sort().map((d) => [d, ...metrics.map((m) => val(m, byDay[d]))]);
  } else if (dims === "video") {
    rows = vids.map((v) => [v, rowsFor(v).reduce((s, [, n]) => s + n, 0)]).filter(([, n]) => n > 0).map(([v, n]) => [v, ...metrics.map((m) => val(m, n))]);
  } else if (dims === "insightTrafficSourceType") {
    rows = [["YT_SEARCH", 10, 20], ["SUBSCRIBER", 5, 9]];
  } else rows = [[...metrics.map(() => 1)]];
  const headers = [...(dims ? dims.split(",") : []), ...metrics].map((name) => ({ name }));
  return { columnHeaders: headers, rows };
}

const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  yt.calls.push(u.hostname + u.pathname);
  if (u.hostname === "identitytoolkit.googleapis.com") {
    const t = JSON.parse(opts.body).idToken;
    const uid = { "tok-admin": "admin1", "tok-user": "user1" }[t];
    return json(uid ? 200 : 400, { users: uid ? [{ localId: uid }] : [] });
  }
  if (u.hostname === "oauth2.googleapis.com") {
    if (yt.tokenError) return json(400, { error: yt.tokenError });
    return json(200, { access_token: "access-1", expires_in: 3600 });
  }
  if (u.hostname === "www.youtube.com" && u.pathname.startsWith("/shorts/")) {
    return { ok: true, status: u.pathname.endsWith(V.V3) ? 200 : 303 };
  }
  if (u.hostname === "www.googleapis.com" && u.pathname.startsWith("/youtube/v3/")) {
    assert.equal(u.searchParams.get("key"), API_KEY);
    if (yt.quotaError) return json(403, { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } });
    const what = u.pathname.split("/").pop();
    if (what === "channels") return json(200, { items: [{ id: CH, snippet: { title: "We-Draft", customUrl: "@wedraft" }, contentDetails: { relatedPlaylists: { uploads: "UU" + CH.slice(2) } } }] });
    if (what === "playlistItems") return json(200, { items: yt.uploads.map((videoId) => ({ contentDetails: { videoId } })) });
    if (what === "videos") {
      const ids = u.searchParams.get("id").split(",");
      return json(200, {
        items: ids.filter((id) => yt.videos[id]).map((id) => {
          const v = yt.videos[id];
          return {
            id,
            snippet: { title: v.title, description: v.description || "", publishedAt: v.publishedAt, channelId: CH, liveBroadcastContent: "none", thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hq.jpg` } } },
            contentDetails: { duration: v.duration },
            statistics: { viewCount: String(v.views), likeCount: "5", commentCount: "1" },
            status: { privacyStatus: "public", uploadStatus: "processed" },
          };
        }),
      });
    }
  }
  if (u.hostname === "youtubeanalytics.googleapis.com") {
    assert.equal(opts.headers?.Authorization, "Bearer access-1");
    return json(200, analyticsResponse(u.searchParams));
  }
  if (u.hostname === "youtubereporting.googleapis.com") {
    const p = u.pathname.replace("/v1/", "");
    if (p === "reportTypes") return json(200, { reportTypes: [{ id: "channel_reach_basic_a1" }] });
    if (p === "jobs" && opts.method === "POST") { const j = { id: "job1", reportTypeId: "channel_reach_basic_a1", createTime: "2026-10-01T00:00:00Z" }; yt.jobs.push(j); return json(200, j); }
    if (p === "jobs") return json(200, { jobs: yt.jobs });
    if (p === "jobs/job1/reports") return json(200, { reports: yt.reports });
  }
  if (u.hostname === "youtubereporting.googleapis.com" || u.hostname === "download.googleapis.com") {
    const f = yt.files[u.pathname];
    return { ok: !!f, status: f ? 200 : 404, text: async () => f };
  }
  throw new Error(`unexpected fetch ${url}`);
};
const logs = [];
const realErr = console.error;
console.error = (...a) => logs.push(a.join(" "));
after(() => { global.fetch = realFetch; console.error = realErr; });

const api = require("../../api/youtube-analytics");

async function call({ method = "POST", auth = "Bearer tok-admin", body, query = {} } = {}) {
  const res = {
    statusCode: 200, body: undefined, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h); },
    end() {},
  };
  await api({ method, query, headers: { ...(auth ? { authorization: auth } : {}), host: "we-draft.com" }, body }, res);
  return res;
}
const sync = (op) => call({ body: { action: "sync", op } });

const LEGACY_V1 = {
  Video: `https://youtu.be/${V.V1}?si=x`, Date: new Date("2026-10-01"), Tags: ["Draft"],
  GenTitle: "Custom Title", GenThumb: "https://imgur.com/custom.png", PublishAt: null,
  items: [{ type: "player", playerId: "p1", title: "Legree Breakdown", thumb: "https://imgur.com/p1.png" }, { type: "recruit", recruitId: "r1", commitment: "LSU", title: "", thumb: "" }],
  playerIds: ["p1"], recruitIds: ["r1"], recruitSchools: ["LSU"], sheetKey: "legacy-key", slugs: ["old-slug"], featured: true, order: 3,
};
const LEGACY_V3 = { Video: `https://youtube.com/shorts/${V.V3}`, Date: new Date("2026-09-20"), Tags: ["CFB"], Short: true, items: [], playerIds: [] };
const LEGACY_OTHER = { Video: "https://youtu.be/ZZZZZZZZZZ9", Date: new Date("2025-01-01"), Tags: [], items: [], playerIds: [] };
const LEGACY_TEXT = { Video: "Eli Heidenreich Draft Evaluation", Date: new Date("2025-01-01"), items: [], playerIds: [] };

beforeEach(() => {
  yt = freshYt();
  require("./google").resetAccessCache();
  db = fakeFirestore({
    "users/admin1": { role: "admin" },
    "users/user1": { role: "user" },
    "players/p1": { First: "Jesse", Last: "Legree", Slug: "jesse-legree-2027-db" },
    "players/p2": { First: "Sam", Last: "Smith", Slug: "sam-smith-2027-db" },
    "players/p3": { First: "Al", Last: "Jones", Slug: "al-jones-2027-db" },
    "videos/legacy1": LEGACY_V1,
    "videos/legacy3": LEGACY_V3,
    "videos/legacyOther": LEGACY_OTHER,
    "videos/legacyText": LEGACY_TEXT,
    "ytAnalytics/status": { channelId: CH, channel: { id: CH, uploadsPlaylistId: "UU" + CH.slice(2) } },
  });
});

const legacySnapshot = () => Object.fromEntries([...db.store.entries()].filter(([k]) => k.startsWith("videos/")).map(([k, v]) => [k, JSON.stringify(v)]));

// ── Auth ──

test("admin actions: no token → 401, non-admin → 403, nothing synced", async () => {
  assert.equal((await call({ auth: null, body: { action: "sync", op: "videos" } })).statusCode, 401);
  assert.equal((await call({ auth: "Bearer tok-user", body: { action: "sync", op: "videos" } })).statusCode, 403);
  assert.equal((await call({ auth: "Bearer bogus", body: { action: "config" } })).statusCode, 401);
  assert.equal(db.data(`ytVideos/${V.V1}`), undefined);
});

test("cron: wrong secret → 401; schedule off → skipped without any YouTube call", async () => {
  assert.equal((await call({ method: "GET", auth: "Bearer nope" })).statusCode, 401);
  const r = await call({ method: "GET", auth: "Bearer cron-secret" });
  assert.equal(r.statusCode, 200);
  assert.match(r.body.skipped, /off/);
  assert.ok(!yt.calls.some((c) => c.includes("youtube")));
});

test("config never returns secret values", async () => {
  const r = await call({ body: { action: "config" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.redirectUri, "https://we-draft.com/api/youtube-analytics");
  const s = JSON.stringify(r.body);
  for (const secret of ["csecret", "env-refresh-token", API_KEY, "k".repeat(40)]) assert.ok(!s.includes(secret));
});

// ── Video sync ──

test("video sync links by video ID, finds new videos, and never touches legacy records", async () => {
  const before = legacySnapshot();
  const r = await sync("videos");
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(legacySnapshot(), before, "legacy videos docs byte-for-byte unchanged");

  const v1 = db.data(`ytVideos/${V.V1}`);
  assert.equal(v1.legacyDocId, "legacy1");
  assert.equal(v1.yt.title, "Jesse Legree Draft Scouting Report");
  assert.equal(v1.stats.views, 1000);
  assert.equal(v1.type, "long");
  const v2 = db.data(`ytVideos/${V.V2}`);
  assert.equal(v2.legacyDocId, null);
  assert.equal(v2.discoveredVia, "uploads");
  const v3 = db.data(`ytVideos/${V.V3}`);
  assert.equal(v3.legacyDocId, "legacy3");
  assert.deepEqual([v3.type, v3.typeSource], ["short", "editorial"], "the legacy Short flag wins");
  assert.equal(r.body.counts.new, 3);
  assert.equal(r.body.counts.newUnlinked, 1);
  assert.equal(r.body.counts.legacyNotOnChannel, 1);
  assert.equal(r.body.counts.legacyUnparsed, 1);
  const st = db.data("ytAnalytics/status");
  assert.equal(st.sync.videos.state, "ok");
  assert.ok(st.sync.videos.lastSuccessAt > 0);
  assert.equal(db.data("ytAnalytics/lock"), undefined, "lock released");
});

test("video sync is idempotent: re-runs update in place, no duplicates, admin fields survive", async () => {
  await sync("videos");
  await call({ body: { action: "associate", videoId: V.V2, add: ["p1", "p2", "p3"] } });
  await call({ body: { action: "ignore", videoId: V.V3, ignored: true } });
  const count = () => [...db.store.keys()].filter((k) => /^ytVideos\/[^/]+$/.test(k)).length;
  const snaps = () => [...db.store.keys()].filter((k) => k.includes("/snapshots/")).length;
  const n0 = count(), s0 = snaps();
  yt.videos[V.V2].title = "Renamed on YouTube";
  const r = await sync("videos");
  assert.equal(r.body.counts.new || 0, 0);
  assert.equal(r.body.counts.updated, 3);
  assert.equal(count(), n0);
  assert.equal(snaps(), s0, "same view counts in the same hour → no new snapshot docs");
  const v2 = db.data(`ytVideos/${V.V2}`);
  assert.equal(v2.yt.title, "Renamed on YouTube");
  assert.deepEqual(v2.playerIds, ["p1", "p2", "p3"], "admin associations untouched by sync");
  assert.equal(db.data(`ytVideos/${V.V3}`).review.status, "ignored", "ignored stays ignored across syncs");
});

test("a video removed from YouTube is flagged, never deleted", async () => {
  await sync("videos");
  delete yt.videos[V.V2];
  yt.uploads = yt.uploads.filter((x) => x !== V.V2);
  await sync("videos");
  const v2 = db.data(`ytVideos/${V.V2}`);
  assert.equal(v2.unavailable, true);
  assert.equal(v2.yt.title, "Three Defensive Backs to Watch in 2027", "last known metadata kept");
});

test("a second sync while one runs gets 409", async () => {
  await db.doc("ytAnalytics/lock").set({ runId: "x", op: "history", startedAt: Date.now(), expiresAt: Date.now() + 60e3 });
  const r = await sync("videos");
  assert.equal(r.statusCode, 409);
  assert.match(r.body.error, /already running/);
  // An expired lease doesn't block.
  await db.doc("ytAnalytics/lock").set({ runId: "x", op: "history", startedAt: 0, expiresAt: Date.now() - 1 });
  assert.equal((await sync("videos")).statusCode, 200);
});

test("quota exhaustion fails the run with a clear message and no API key in it", async () => {
  yt.quotaError = true;
  const r = await sync("videos");
  assert.equal(r.statusCode, 429);
  assert.match(r.body.error, /quota/i);
  assert.ok(!JSON.stringify(r.body).includes(API_KEY));
  const st = db.data("ytAnalytics/status").sync.videos;
  assert.equal(st.state, "error");
  assert.ok(!JSON.stringify(st).includes(API_KEY));
  assert.ok(!logs.join("\n").includes(API_KEY));
});

test("a revoked authorization marks the connection for reconnect", async () => {
  await sync("videos");
  yt.tokenError = "invalid_grant";
  const r = await sync("analytics");
  assert.equal(r.statusCode, 409);
  assert.equal(db.data("ytAnalytics/status").connection.needsReconnect, true);
  assert.ok(!JSON.stringify(db.data("ytAnalytics/status")).includes("env-refresh-token"));
});

// ── Associations ──

test("associate on a site video appends a tag and keeps every editorial field", async () => {
  await sync("videos");
  const r = await call({ body: { action: "associate", videoId: V.V1, add: ["p2", "p3", "p2"] } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const leg = db.data("videos/legacy1");
  assert.deepEqual(leg.playerIds, ["p1", "p2", "p3"]);
  assert.deepEqual(leg.items[0], LEGACY_V1.items[0], "custom per-player title/thumb kept");
  assert.deepEqual(leg.items[1], LEGACY_V1.items[1], "recruit tag kept");
  assert.equal(leg.items.length, 4);
  for (const k of ["GenTitle", "GenThumb", "Tags", "sheetKey", "slugs", "featured", "order", "recruitIds", "recruitSchools", "Video"]) {
    assert.deepEqual(leg[k], LEGACY_V1[k], k);
  }
});

test("removing a tag with a custom title/thumbnail is refused; a plain tag can be removed", async () => {
  await sync("videos");
  const r = await call({ body: { action: "associate", videoId: V.V1, remove: ["p1"] } });
  assert.equal(r.statusCode, 409);
  assert.deepEqual(db.data("videos/legacy1").playerIds, ["p1"]);
  await call({ body: { action: "associate", videoId: V.V1, add: ["p2"] } });
  const ok = await call({ body: { action: "associate", videoId: V.V1, remove: ["p2"] } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(db.data("videos/legacy1").playerIds, ["p1"]);
});

test("associate validates players and video IDs", async () => {
  await sync("videos");
  assert.equal((await call({ body: { action: "associate", videoId: V.V2, add: ["nope"] } })).statusCode, 400);
  assert.equal((await call({ body: { action: "associate", videoId: "bad", add: ["p1"] } })).statusCode, 400);
  assert.equal((await call({ body: { action: "associate", videoId: V.V2, add: ["p1/../x"] } })).statusCode, 400);
});

test("publish needs confirmation, creates one site record, and is not repeatable", async () => {
  await sync("videos");
  await call({ body: { action: "associate", videoId: V.V2, add: ["p1", "p2"] } });
  assert.equal((await call({ body: { action: "publish", videoId: V.V2 } })).statusCode, 400);
  const r = await call({ body: { action: "publish", videoId: V.V2, confirm: true, tags: ["Draft", "Evil"] } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const leg = db.data(`videos/${r.body.legacyDocId}`);
  assert.equal(leg.Video, `https://youtu.be/${V.V2}`);
  assert.deepEqual(leg.playerIds, ["p1", "p2"]);
  assert.deepEqual(leg.Tags, ["Draft"]);
  assert.equal(db.data(`ytVideos/${V.V2}`).legacyDocId, r.body.legacyDocId);
  const again = await call({ body: { action: "publish", videoId: V.V2, confirm: true } });
  assert.equal(again.body.alreadyOnSite, true);
  assert.equal([...db.store.keys()].filter((k) => k.startsWith("videos/")).length, 5);
  await sync("videos");
  assert.equal(db.data(`ytVideos/${V.V2}`).legacyDocId, r.body.legacyDocId, "the next sync agrees");
});

// ── Analytics & history ──

test("analytics: windows, daily rows, no double counting on re-run, revisions keep first observations", async () => {
  await sync("videos");
  const r = await sync("analytics");
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.through, "2026-10-10");
  const v1 = db.data(`ytVideos/${V.V1}`);
  assert.equal(v1.analytics.lifetime.views, 720);
  assert.equal(v1.analytics.last7.views, 120); // 10-04..10-10
  assert.equal(v1.analytics.through, "2026-10-10");
  assert.equal(db.data(`ytVideos/${V.UNL}`).discoveredVia, "analytics", "owned unlisted video found via analytics");
  const d = db.data(`ytVideos/${V.V1}/daily/2026-10-10`);
  assert.equal(d.views, 30);

  await sync("analytics");
  assert.equal(db.data(`ytVideos/${V.V1}/daily/2026-10-10`).views, 30, "re-run replaces, never adds");
  assert.equal(db.data(`ytVideos/${V.V1}`).analytics.lifetime.views, 720);

  yt.daily[V.V1]["2026-10-10"] = 35; // YouTube revises a recent day
  await sync("analytics");
  const rev = db.data(`ytVideos/${V.V1}/daily/2026-10-10`);
  assert.equal(rev.views, 35);
  assert.equal(rev.firstObserved.views, 30);

  const ch = db.data("ytChannelDaily/2026-10-10");
  assert.equal(ch.views, 35 + 10 + 1);
  const p1 = db.data("ytPlayerStats/p1");
  assert.equal(p1.videoCount, 1);
  assert.equal(p1.publicViews, 1000);
});

test("history backfill: daily rows from publish day, first-N-day windows, resumable and idempotent", async () => {
  await sync("videos");
  const r = await sync("history");
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.progress.remaining, 0);
  const v1 = db.data(`ytVideos/${V.V1}`);
  assert.equal(v1.history.complete, true);
  assert.equal(v1.history.from, "2026-10-01");
  assert.equal(v1.perf.first1.views, 300);
  assert.equal(v1.perf.first2.views, 500);
  assert.equal(v1.perf.first7.views, 600);
  const days = () => [...db.store.keys()].filter((k) => k.startsWith(`ytVideos/${V.V1}/daily/`)).length;
  assert.equal(days(), 6, "only days with activity stored");
  const again = await sync("history");
  assert.equal(again.body.counts.videosBackfilled || 0, 0, "nothing left to backfill");
  assert.equal(days(), 6);
});

test("reach reports: impressions merged into daily rows; a re-issued day replaces, never adds", async () => {
  await sync("videos");
  await sync("history"); // creates the job
  assert.equal(yt.jobs.length, 1);
  const csv = (imp) => `date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261009,${CH},${V.V1},${imp},0.05\n`;
  yt.files["/r1"] = csv(1000);
  yt.reports = [{ id: "r1", startTime: "2026-10-09T07:00:00Z", createTime: "2026-10-11T00:00:00Z", downloadUrl: "https://youtubereporting.googleapis.com/r1" }];
  await sync("history");
  let d = db.data(`ytVideos/${V.V1}/daily/2026-10-09`);
  assert.equal(d.impressions, 1000);
  assert.equal(d.views, 40, "Analytics API numbers on the same day kept");
  await sync("history");
  assert.equal(db.data(`ytVideos/${V.V1}/daily/2026-10-09`).impressions, 1000, "same report not imported twice");
  yt.files["/r2"] = csv(1200);
  yt.reports.push({ id: "r2", startTime: "2026-10-09T07:00:00Z", createTime: "2026-10-12T00:00:00Z", downloadUrl: "https://youtubereporting.googleapis.com/r2" });
  await sync("history");
  d = db.data(`ytVideos/${V.V1}/daily/2026-10-09`);
  assert.equal(d.impressions, 1200, "backfilled report replaces the day");
  assert.equal(db.data("ytChannelDaily/2026-10-09").impressions, 1200);
});

test("cron runs one due step once the schedule is on", async () => {
  await call({ body: { action: "set-auto", enabled: true } });
  const r = await call({ method: "GET", auth: "Bearer cron-secret" });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.op, "videos");
  assert.equal(db.data("ytAnalytics/status").sync.videos.trigger, "cron");
  const r2 = await call({ method: "GET", auth: "Bearer cron-secret" });
  assert.equal(r2.body.op, "analytics");
});
