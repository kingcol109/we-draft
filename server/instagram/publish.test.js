// server/instagram/publish.test.js — publishing end to end (start → stage →
// run) with Firestore, Storage and Meta faked. The point: a post is
// published once and only once, marked published only after Meta says so,
// and its staged files are deleted only then.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fakeFirestore } = require("../stream-manager/__fakes__/firestore");
const pub = require("./publish");
const { redact, tokenKind, hostFor } = require("./graph");

// A JPEG header (SOI + SOF0) of the given size — enough for checkSlide.
const jpeg = (w = 1080, h = 1350) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, ...Array(14).fill(0)]).toString("base64");

function fakeBucket() {
  const files = new Map();
  const failDelete = new Set();
  const file = (name) => ({
    name,
    save: async (buf) => { files.set(name, buf); },
    exists: async () => [files.has(name)],
    delete: async () => { if (failDelete.has(name)) throw new Error("503 backend"); files.delete(name); },
    getSignedUrl: async ({ expires }) => [`https://storage.googleapis.com/b/${name}?X-Goog-Expires=${expires}&X-Goog-Signature=sig`],
  });
  return { files, failDelete, file, getFiles: async ({ prefix }) => [[...files.keys()].filter((k) => k.startsWith(prefix)).map(file)] };
}

const metaErr = (msg, code = 9004, status = 400) => Object.assign(new Error(msg), { status, meta: true, metaCode: code, code, fbtraceId: "TRACE1" });

// Meta, as far as publishing goes. script: the status_code each poll of a
// new container returns, in turn (the last one sticks).
function fakeMeta({ script = ["IN_PROGRESS", "FINISHED"], used = 0, publishError = null, publishThrowsAfter = false, readBackFails = false } = {}) {
  const m = { containers: {}, media: [], calls: [], published: 0, n: 0, script, used, publishError, publishThrowsAfter, readBackFails };
  m.graph = async (path, { method = "GET", params = {} } = {}) => {
    m.calls.push({ method, path, params });
    if (path === "/IG1/content_publishing_limit") return { data: [{ quota_usage: m.used, config: { quota_total: 100, quota_duration: 86400 } }] };
    if (method === "POST" && path === "/IG1/media") {
      const id = `C${++m.n}`;
      m.containers[id] = { params, polls: 0, script: [...m.script] };
      return { id };
    }
    if (method === "POST" && path === "/IG1/media_publish") {
      if (m.publishError) throw m.publishError;
      const c = m.containers[params.creation_id];
      if (!c || c.state === "PUBLISHED") throw metaErr("The media has already been published", 9007);
      c.state = "PUBLISHED";
      m.published++;
      const id = `M${m.published}`;
      m.media.unshift({ id, caption: c.params.caption || "", timestamp: new Date(clock).toISOString() });
      if (m.publishThrowsAfter) throw metaErr("Connection reset", 2, 500);
      return { id };
    }
    if (path === "/IG1/media") return { data: m.media };
    const c = m.containers[path.slice(1)];
    if (c) {
      if (c.state === "PUBLISHED") return { status_code: "PUBLISHED" };
      const s = c.script[Math.min(c.polls++, c.script.length - 1)];
      return { status_code: s, status: s === "ERROR" ? "Error: The image could not be fetched from the URI (2207052)" : s };
    }
    const media = m.media.find((x) => `/${x.id}` === path);
    if (media) {
      if (m.readBackFails) throw metaErr("Temporary", 1, 500);
      return { id: media.id, permalink: `https://www.instagram.com/p/${media.id}/`, timestamp: media.timestamp, media_type: "IMAGE" };
    }
    throw new Error(`fake meta: no route ${method} ${path}`);
  };
  return m;
}

let clock = Date.parse("2026-11-03T18:00:00Z");
function setup(meta, post = {}) {
  const db = fakeFirestore({
    "instagramPosts/P1": { type: "player", name: "Player · Mark Bowman", status: "ready", caption: "Mark Bowman. #NFLDraft", state: { playerId: "row_939" }, playerIds: ["row_939"], slides: 1, ...post },
  });
  const bucket = fakeBucket();
  const ctx = { db, bucket, graph: meta.graph, userId: "IG1", now: () => clock, sleep: async (ms) => { clock += ms; }, pollMs: [1000] };
  return { db, bucket, ctx };
}
const post = (db) => db.data("instagramPosts/P1");
const publishCalls = (m) => m.calls.filter((c) => c.path === "/IG1/media_publish").length;

async function stageAll(ctx, attempt, n) {
  for (let i = 0; i < n; i++) await pub.stageSlide(ctx, "admin1", { postId: "P1", attempt, index: i, jpeg: jpeg() });
}

test("single image: staged, contained, published once, linked, files cleaned", async () => {
  const meta = fakeMeta();
  const { db, bucket, ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  assert.equal(post(db).status, "publishing");
  await stageAll(ctx, attempt, 1);
  assert.equal(bucket.files.size, 1);
  const [path] = bucket.files.keys();
  assert.match(path, new RegExp(`^ig-staging/P1/${attempt}/01\\.jpg$`));
  assert.match(attempt, /^[0-9a-f]{32}$/);

  const r = await pub.runPublish(ctx, "admin1", { postId: "P1", attempt });
  assert.equal(r.published, true);
  assert.equal(r.mediaId, "M1");
  assert.equal(r.permalink, "https://www.instagram.com/p/M1/");
  assert.equal(publishCalls(meta), 1);
  const created = meta.calls.find((c) => c.method === "POST" && c.path === "/IG1/media");
  assert.equal(created.params.caption, "Mark Bowman. #NFLDraft");
  assert.match(created.params.image_url, /X-Goog-Signature/);

  const p = post(db);
  assert.equal(p.status, "published");
  assert.equal(p.ig.mediaId, "M1");
  assert.equal(p.ig.permalink, "https://www.instagram.com/p/M1/");
  assert.equal(p.ig.step, "done");
  assert.equal(p.ig.cleanup, "done");
  assert.equal(p.ig.leaseUntil, null);
  assert.ok(p.ig.publishedAt);
  // The settings that draw the post are untouched.
  assert.deepEqual(p.state, { playerId: "row_939" });
  assert.equal(bucket.files.size, 0);
  const link = db.data("igMedia/M1");
  assert.equal(link.postId, "P1");
  assert.deepEqual(link.playerIds, ["row_939"]);
});

test("no second post: a second start, a second run, and a run after publishing", async () => {
  const meta = fakeMeta();
  const { ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  await assert.rejects(pub.startPublish(ctx, "admin2", { postId: "P1", slides: 1 }), (e) => e.status === 409 && e.code === "publishing");
  await stageAll(ctx, attempt, 1);
  // Two runs at once (a double click): one holds the lease, the other is refused.
  const [a, b] = await Promise.allSettled([pub.runPublish(ctx, "admin1", { postId: "P1", attempt }), pub.runPublish(ctx, "admin1", { postId: "P1", attempt })]);
  assert.equal([a, b].filter((x) => x.status === "fulfilled").length, 1);
  assert.equal([a, b].find((x) => x.status === "rejected").reason.code, "running");
  assert.equal(publishCalls(meta), 1);
  // Afterwards: run is a no-op, start is refused.
  const again = await pub.runPublish(ctx, "admin1", { postId: "P1", attempt });
  assert.equal(again.published, true);
  await assert.rejects(pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 }), (e) => e.status === 409 && e.code === "published");
  assert.equal(publishCalls(meta), 1);
});

test("carousel: an item container per slide in order, the caption on the carousel", async () => {
  const meta = fakeMeta();
  const { db, ctx } = setup(meta, { type: "mock", slides: 3 });
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 3 });
  await stageAll(ctx, attempt, 3);
  const r = await pub.runPublish(ctx, "admin1", { postId: "P1", attempt });
  assert.equal(r.published, true);
  const posts = meta.calls.filter((c) => c.method === "POST" && c.path === "/IG1/media");
  assert.equal(posts.length, 4);
  posts.slice(0, 3).forEach((c, i) => {
    assert.equal(c.params.is_carousel_item, "true");
    assert.equal(c.params.caption, undefined);
    assert.match(c.params.image_url, new RegExp(`/0${i + 1}\\.jpg`));
  });
  assert.equal(posts[3].params.media_type, "CAROUSEL");
  assert.equal(posts[3].params.children, "C1,C2,C3");
  assert.equal(posts[3].params.caption, "Mark Bowman. #NFLDraft");
  assert.equal(post(db).ig.mediaType, "IMAGE"); // as Meta reads it back (the fake says IMAGE)
});

test("a container Meta can't process: failed with Meta's words, files kept, nothing published", async () => {
  const meta = fakeMeta({ script: ["IN_PROGRESS", "ERROR"] });
  const { db, bucket, ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  await stageAll(ctx, attempt, 1);
  await assert.rejects(pub.runPublish(ctx, "admin1", { postId: "P1", attempt }), /could not be fetched/);
  const p = post(db);
  assert.equal(p.status, "failed");
  assert.match(p.ig.error.message, /2207052/);
  assert.equal(p.ig.error.step, "containers");
  assert.equal(bucket.files.size, 1);
  assert.equal(publishCalls(meta), 0);
  // Retry: a fresh attempt, the old files still there until it publishes.
  const re = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  assert.notEqual(re.attempt, attempt);
  assert.equal(post(db).ig.lastError.message, p.ig.error.message);
  meta.script = ["FINISHED"];
  await stageAll(ctx, re.attempt, 1);
  assert.equal(bucket.files.size, 2);
  await pub.runPublish(ctx, "admin1", { postId: "P1", attempt: re.attempt });
  assert.equal(post(db).status, "published");
  assert.equal(bucket.files.size, 0); // both attempts' files
});

test("media_publish errors: failed; the retry finds the post Instagram made instead of posting twice", async () => {
  const meta = fakeMeta({ publishThrowsAfter: true });
  const { db, ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  await stageAll(ctx, attempt, 1);
  await assert.rejects(pub.runPublish(ctx, "admin1", { postId: "P1", attempt }), /Connection reset/);
  assert.equal(post(db).status, "failed");
  assert.equal(post(db).ig.step, "publishing");
  const r = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  assert.equal(r.alreadyPublished, true);
  assert.equal(r.mediaId, "M1");
  assert.equal(post(db).status, "published");
  assert.equal(meta.published, 1);
});

test("Meta refuses media_publish outright: failed, not published, retry publishes once", async () => {
  const meta = fakeMeta({ publishError: metaErr("Application request limit reached", 4) });
  const { db, bucket, ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  await stageAll(ctx, attempt, 1);
  await assert.rejects(pub.runPublish(ctx, "admin1", { postId: "P1", attempt }), /request limit/);
  assert.equal(post(db).status, "failed");
  assert.equal(post(db).ig.error.code, 4);
  assert.equal(post(db).ig.error.fbtraceId, "TRACE1");
  assert.equal(bucket.files.size, 1);
  meta.publishError = null;
  const re = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  await stageAll(ctx, re.attempt, 1);
  await pub.runPublish(ctx, "admin1", { postId: "P1", attempt: re.attempt });
  assert.equal(meta.published, 1);
});

test("out of time while Meta processes: pending, then resumed on the same container", async () => {
  const meta = fakeMeta({ script: Array(400).fill("IN_PROGRESS") });
  const { db, ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  await stageAll(ctx, attempt, 1);
  const r1 = await pub.runPublish(ctx, "admin1", { postId: "P1", attempt });
  assert.equal(r1.pending, true);
  assert.equal(post(db).status, "publishing");
  assert.equal(post(db).ig.leaseUntil, null);
  assert.equal(post(db).ig.container, "C1");
  meta.containers.C1.script = ["FINISHED"];
  meta.containers.C1.polls = 0;
  const r2 = await pub.runPublish(ctx, "admin1", { postId: "P1", attempt });
  assert.equal(r2.published, true);
  assert.equal(meta.calls.filter((c) => c.method === "POST" && c.path === "/IG1/media").length, 1);
});

test("published, then a file won't delete: cleanup pending, retried later", async () => {
  const meta = fakeMeta();
  const { db, bucket, ctx } = setup(meta, { slides: 2 });
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 2 });
  await stageAll(ctx, attempt, 2);
  bucket.failDelete.add(`ig-staging/P1/${attempt}/02.jpg`);
  const r = await pub.runPublish(ctx, "admin1", { postId: "P1", attempt });
  assert.equal(r.published, true);
  assert.equal(r.cleanup, "pending");
  assert.equal(post(db).status, "published");
  assert.equal(bucket.files.size, 1);
  bucket.failDelete.clear();
  const c = await pub.cleanupPending(ctx);
  assert.deepEqual(c, { tried: 1, done: 1 });
  assert.equal(post(db).ig.cleanup, "done");
  assert.equal(bucket.files.size, 0);
});

test("published even when reading it back fails: no permalink yet, still published", async () => {
  const meta = fakeMeta({ readBackFails: true });
  const { db, ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "admin1", { postId: "P1", slides: 1 });
  await stageAll(ctx, attempt, 1);
  const r = await pub.runPublish(ctx, "admin1", { postId: "P1", attempt });
  assert.equal(r.published, true);
  assert.equal(post(db).status, "published");
  assert.equal(post(db).ig.permalink, null);
});

test("refusals: bad slides, wrong attempt, missing slides, caption, posted by hand, quota", async () => {
  const meta = fakeMeta();
  const { db, ctx } = setup(meta);
  await assert.rejects(pub.startPublish(ctx, "a", { postId: "P1", slides: 0 }), (e) => e.status === 400);
  await assert.rejects(pub.startPublish(ctx, "a", { postId: "P1", slides: 21 }), (e) => e.status === 400);
  await assert.rejects(pub.startPublish(ctx, "a", { postId: "nope", slides: 1 }), (e) => e.status === 404);
  const { attempt } = await pub.startPublish(ctx, "a", { postId: "P1", slides: 2 });
  await assert.rejects(pub.stageSlide(ctx, "a", { postId: "P1", attempt, index: 0, jpeg: Buffer.from("png?").toString("base64") }), /isn't a JPEG/);
  await assert.rejects(pub.stageSlide(ctx, "a", { postId: "P1", attempt, index: 0, jpeg: jpeg(1080, 1920) }), /4:5 to 1\.91:1/);
  await assert.rejects(pub.stageSlide(ctx, "a", { postId: "P1", attempt, index: 2, jpeg: jpeg() }), (e) => e.status === 400);
  await assert.rejects(pub.stageSlide(ctx, "a", { postId: "P1", attempt: "x".repeat(32), index: 0, jpeg: jpeg() }), (e) => e.code === "stale_attempt");
  await pub.stageSlide(ctx, "a", { postId: "P1", attempt, index: 0, jpeg: jpeg() });
  await assert.rejects(pub.runPublish(ctx, "a", { postId: "P1", attempt }), (e) => e.code === "not_staged");
  assert.equal(post(db).status, "failed");

  db.store.set("instagramPosts/P2", { status: "draft", caption: "x".repeat(2201) });
  await assert.rejects(pub.startPublish(ctx, "a", { postId: "P2", slides: 1 }), /2201 characters/);
  db.store.set("instagramPosts/P3", { status: "draft", caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ") });
  await assert.rejects(pub.startPublish(ctx, "a", { postId: "P3", slides: 1 }), /31 hashtags/);
  db.store.set("instagramPosts/P4", { status: "posted", caption: "hi" });
  await assert.rejects(pub.startPublish(ctx, "a", { postId: "P4", slides: 1 }), (e) => e.code === "posted");

  db.store.set("instagramPosts/P5", { status: "draft", caption: "hi" });
  meta.used = 100;
  const q = await pub.startPublish(ctx, "a", { postId: "P5", slides: 1 });
  await pub.stageSlide(ctx, "a", { postId: "P5", attempt: q.attempt, index: 0, jpeg: jpeg() });
  await assert.rejects(pub.runPublish(ctx, "a", { postId: "P5", attempt: q.attempt }), (e) => e.code === "quota");
  assert.equal(db.data("instagramPosts/P5").status, "failed");
  assert.equal(publishCalls(meta), 0);
});

test("deleting a post takes its staged files; not while it's publishing", async () => {
  const meta = fakeMeta({ script: ["ERROR"] });
  const { db, bucket, ctx } = setup(meta);
  const { attempt } = await pub.startPublish(ctx, "a", { postId: "P1", slides: 1 });
  await stageAll(ctx, attempt, 1);
  await assert.rejects(pub.deletePost(ctx, "a", { postId: "P1" }), (e) => e.code === "publishing");
  await assert.rejects(pub.runPublish(ctx, "a", { postId: "P1", attempt }));
  assert.equal(bucket.files.size, 1);
  const r = await pub.deletePost(ctx, "a", { postId: "P1" });
  assert.deepEqual(r, { deleted: true, files: 1 });
  assert.equal(db.data("instagramPosts/P1"), undefined);
  assert.equal(bucket.files.size, 0);
});

test("the token never shows: redacted from Meta's messages; host by token type", () => {
  const tk = "EAAG" + "z".repeat(60);
  assert.equal(redact(`GET /me?access_token=${tk}&x=1 failed: ${tk}`, tk), "GET /me?access_token=[token]&x=1 failed: [token]");
  assert.equal(tokenKind("IGAAabc"), "instagram-login");
  assert.equal(tokenKind(tk), "facebook");
  assert.equal(hostFor(tk), "https://graph.facebook.com");
  assert.equal(hostFor("IGAAabc"), "https://graph.instagram.com");
});
