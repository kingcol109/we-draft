// server/instagram/feed.test.js — the Home page's public feed (feed.js).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("../stream-manager/__fakes__/firestore");
const { buildFeed, refreshFeed, FEED_DOC, FEED_SIZE } = require("./feed");

const media = [
  { id: "1", media_type: "IMAGE", media_url: "https://cdn/1.jpg", permalink: "https://instagram.com/p/1", caption: "First\n\npost", timestamp: "2026-11-01T12:00:00+0000" },
  { id: "2", media_type: "VIDEO", media_product_type: "REELS", thumbnail_url: "https://cdn/2t.jpg", media_url: "https://cdn/2.mp4", permalink: "https://instagram.com/reel/2", timestamp: "2026-11-03T12:00:00+0000" },
  { id: "3", media_type: "CAROUSEL_ALBUM", media_url: "https://cdn/3.jpg", permalink: "https://instagram.com/p/3", caption: "x".repeat(400), timestamp: "2026-11-02T12:00:00+0000" },
  { id: "4", media_type: "VIDEO", media_url: "https://cdn/4.mp4", permalink: "https://instagram.com/reel/4", timestamp: "2026-11-04T12:00:00+0000" },
  { id: "5", media_type: "IMAGE", media_product_type: "STORY", media_url: "https://cdn/5.jpg", permalink: "https://instagram.com/s/5", timestamp: "2026-11-05T12:00:00+0000" },
];

test("feed: newest first, the video's thumbnail, no stories or imageless videos, captions trimmed", () => {
  const f = buildFeed(media, { username: "wedraftsite", followers_count: 1234, profile_picture_url: "https://cdn/me.jpg" }, 99);
  assert.deepEqual(f.items.map((m) => m.id), ["2", "3", "1"]);
  assert.deepEqual(f.items.map((m) => m.kind), ["reel", "carousel", "image"]);
  assert.equal(f.items[0].image, "https://cdn/2t.jpg");
  assert.equal(f.items[2].caption, "First post");
  assert.ok(f.items[1].caption.length <= 220 && f.items[1].caption.endsWith("…"));
  assert.equal(f.followers, 1234);
  assert.equal(f.updatedAt, 99);
  assert.ok(!JSON.stringify(f).includes("token"));
});

test("feed: at most FEED_SIZE posts", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), media_type: "IMAGE", media_url: `https://cdn/${i}.jpg`, permalink: `https://instagram.com/p/${i}`, timestamp: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }));
  assert.equal(buildFeed(many, {}).items.length, FEED_SIZE);
});

test("refresh: two Graph calls, one write to the public doc", async () => {
  const db = fakeFirestore();
  const calls = [];
  const graph = async (path, opts) => { calls.push(path); return path.endsWith("/media") ? { data: media } : { username: "wedraftsite", followers_count: 10 }; };
  assert.deepEqual(await refreshFeed(db, { graph, userId: "IG1" }), { items: 3 });
  assert.deepEqual(calls.sort(), ["/IG1", "/IG1/media"]);
  const doc = (await db.doc(FEED_DOC).get()).data();
  assert.equal(doc.items.length, 3);
  assert.equal(doc.followers, 10);
});
