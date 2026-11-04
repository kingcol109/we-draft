// server/instagram/videos.js
//
// Video clips for a post's carousel (the Player Spotlight's highlights),
// uploaded from the admin's computer into the same private bucket as the
// staged slides (staging.js):
//
//   ig-videos/{32 hex}.mp4|.mov
//
// The browser can't write to the bucket (storage.rules closes it), and a
// clip is too big for an API request, so the server opens a resumable
// upload session for it (startUpload) and the browser PUTs the file straight
// to that session's URL. The session was opened with the page's Origin, so
// Storage answers the browser's PUT with CORS for that origin; nothing about
// the bucket changes. finishUpload then checks what arrived.
//
// A saved post lists its clips in videoPaths (and its state). Publishing
// copies each into the attempt's staging folder (publish.js), so a
// published post's cleanup never touches the originals. A clip is deleted
// when no saved post lists it any more: with its post (deletePost), or by
// the hourly sweep once it's sat unsaved for ORPHAN_MS.

const crypto = require("crypto");
const { httpError } = require("./graph");

const ROOT = "ig-videos";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // Instagram's limit for a carousel video
const TYPES = { "video/mp4": "mp4", "video/quicktime": "mov" };
const READ_URL_MS = 3600e3;
const ORPHAN_MS = 3 * 86400e3;
const PATH_RE = /^ig-videos\/[0-9a-f]{32}\.(mp4|mov)$/;

const isVideoPath = (p) => typeof p === "string" && PATH_RE.test(p);
const extOf = (p) => String(p).split(".").pop();
const contentTypeOf = (p) => (extOf(p) === "mov" ? "video/quicktime" : "video/mp4");

function checkPath(path) {
  if (!isVideoPath(path)) throw httpError(400, "That isn't an uploaded video.");
  return path;
}

// A new clip's upload session → { path, uploadUrl }. origin: the page's
// (the request's Origin header), which the session answers CORS for.
async function startUpload(b, { type, bytes, origin } = {}) {
  const ext = TYPES[type];
  if (!ext) throw httpError(400, "Instagram takes MP4 or MOV videos.");
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) throw httpError(400, "The video is empty.");
  if (n > MAX_VIDEO_BYTES) throw httpError(400, `The video is ${(n / 1048576).toFixed(0)} MB; Instagram takes up to ${MAX_VIDEO_BYTES / 1048576} MB.`);
  const path = `${ROOT}/${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const [uploadUrl] = await b.file(path).createResumableUpload({
    ...(origin ? { origin } : {}),
    metadata: { contentType: type, cacheControl: "private, max-age=0" },
  });
  return { path, uploadUrl };
}

// The upload's arrived: it's there, and not too big (deleted if it is). → { path, bytes }
async function finishUpload(b, path) {
  checkPath(path);
  const f = b.file(path);
  const [ok] = await f.exists();
  if (!ok) throw httpError(409, "The video didn't finish uploading. Try again.", { code: "not_uploaded" });
  const [meta] = await f.getMetadata();
  const size = Number(meta.size) || 0;
  if (size > MAX_VIDEO_BYTES) {
    await f.delete({ ignoreNotFound: true }).catch(() => {});
    throw httpError(400, `The video is ${(size / 1048576).toFixed(0)} MB; Instagram takes up to ${MAX_VIDEO_BYTES / 1048576} MB.`);
  }
  return { path, bytes: size };
}

// A short-lived link to watch a clip in the Post Manager.
async function readUrl(b, path, now = Date.now()) {
  checkPath(path);
  const [url] = await b.file(path).getSignedUrl({ version: "v4", action: "read", expires: now + READ_URL_MS });
  return { url, expires: now + READ_URL_MS };
}

// The clip copied to a publish attempt's staging path.
async function copyTo(b, path, dest) {
  checkPath(path);
  const [ok] = await b.file(path).exists();
  if (!ok) throw httpError(409, "One of the post's videos is gone from Storage. Remove it and upload it again.", { code: "video_missing" });
  await b.file(path).copy(b.file(dest));
}

// Clips no saved post (but exceptPostId) lists any more, deleted. → { deleted, kept }
async function deleteUnlisted(ctx, paths, exceptPostId = null) {
  const out = { deleted: 0, kept: 0 };
  for (const path of [...new Set((paths || []).filter(isVideoPath))]) {
    const snap = await ctx.db.collection("instagramPosts").where("videoPaths", "array-contains", path).get();
    if (snap.docs.some((d) => d.id !== exceptPostId)) { out.kept++; continue; }
    await ctx.bucket.file(path).delete({ ignoreNotFound: true });
    out.deleted++;
  }
  return out;
}

// The hourly sweep: clips uploaded over ORPHAN_MS ago that no saved post
// lists (uploaded, then never saved, or removed from a post).
async function sweepOrphans(ctx, max = 20) {
  const [files] = await ctx.bucket.getFiles({ prefix: `${ROOT}/` });
  const old = [];
  for (const f of files) {
    if (old.length >= max) break;
    const created = Date.parse(f.metadata?.timeCreated || "") || 0;
    if (created && ctx.now() - created > ORPHAN_MS) old.push(f.name);
  }
  return deleteUnlisted(ctx, old);
}

module.exports = { ROOT, MAX_VIDEO_BYTES, TYPES, ORPHAN_MS, isVideoPath, extOf, contentTypeOf, startUpload, finishUpload, readUrl, copyTo, deleteUnlisted, sweepOrphans };
