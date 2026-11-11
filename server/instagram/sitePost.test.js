// server/instagram/sitePost.test.js — a saved post's files for its site article (sitePost.js).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const site = require("./sitePost");

// A bucket in memory: files by name, with their metadata.
function fakeBucket(seed = {}) {
  const files = new Map(Object.entries(seed).map(([k, v]) => [k, { data: v, meta: {} }]));
  const file = (name) => ({
    name,
    save: async (data, opts) => { files.set(name, { data, meta: opts.metadata, contentType: opts.contentType }); },
    exists: async () => [files.has(name)],
    copy: async (dest) => { files.set(dest.name, { ...files.get(name) }); },
    setMetadata: async (m) => { files.get(name).meta = m; },
    delete: async () => { files.delete(name); },
  });
  return { name: "bucket", files, file, getFiles: async ({ prefix }) => [[...files.keys()].filter((k) => k.startsWith(prefix)).map(file)] };
}
// The smallest JPEG header with a size: SOI, then an SOF0 frame of w×h.
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64");
const postId = "AbCdEfGhIjKlMn12";
const rev = "a".repeat(32);

test("site slide: saved under the post's rev with a download token; any shape", async () => {
  const b = fakeBucket();
  const r = await site.saveSlide(b, { postId, rev, index: 0, jpeg: jpeg(1080, 1920) });
  assert.deepEqual([r.w, r.h], [1080, 1920]);
  const path = `site-posts/${postId}/${rev}/01.jpg`;
  const f = b.files.get(path);
  const token = f.meta.metadata.firebaseStorageDownloadTokens;
  assert.ok(token);
  assert.equal(r.url, `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(path)}?alt=media&token=${token}`);
});

test("site slide: bad ids, numbers and files refused", async () => {
  const b = fakeBucket();
  await assert.rejects(site.saveSlide(b, { postId: "../x", rev, index: 0, jpeg: jpeg(10, 10) }), /Unknown post/);
  await assert.rejects(site.saveSlide(b, { postId, rev: "zz", index: 0, jpeg: jpeg(10, 10) }), /Unknown upload/);
  await assert.rejects(site.saveSlide(b, { postId, rev, index: 25, jpeg: jpeg(10, 10) }), /Bad slide/);
  await assert.rejects(site.saveSlide(b, { postId, rev, index: 0, jpeg: Buffer.from("png").toString("base64") }), /isn't a JPEG/);
  assert.equal(b.files.size, 0);
});

test("site video: the clip copied in with a token; only uploaded clips", async () => {
  const clip = `ig-videos/${"b".repeat(32)}.mp4`;
  const b = fakeBucket({ [clip]: "video" });
  const r = await site.saveVideo(b, { postId, rev, index: 1, path: clip });
  const dest = `site-posts/${postId}/${rev}/02.mp4`;
  assert.equal(b.files.get(dest).data, "video");
  assert.ok(r.url.includes(encodeURIComponent(dest)));
  assert.ok(b.files.has(clip), "the original stays");
  await assert.rejects(site.saveVideo(b, { postId, rev, index: 1, path: "site-posts/x.mp4" }), /isn't an uploaded video/);
});

test("clean: every other rev of the post deleted; nothing else", async () => {
  const other = "c".repeat(32);
  const b = fakeBucket({
    [`site-posts/${postId}/${rev}/01.jpg`]: 1, [`site-posts/${postId}/${other}/01.jpg`]: 1,
    [`site-posts/ZzZzZzZzZzZzZz99/${other}/01.jpg`]: 1, [`ig-videos/${"d".repeat(32)}.mp4`]: 1,
  });
  assert.deepEqual(await site.clean(b, { postId, keep: rev }), { deleted: 1 });
  assert.deepEqual([...b.files.keys()].sort(), [`ig-videos/${"d".repeat(32)}.mp4`, `site-posts/${postId}/${rev}/01.jpg`, `site-posts/ZzZzZzZzZzZzZz99/${other}/01.jpg`].sort());
  assert.deepEqual(await site.clean(b, { postId }), { deleted: 1 });
});
