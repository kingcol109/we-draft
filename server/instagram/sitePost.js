// server/instagram/sitePost.js
//
// A saved Instagram post put on the site as an article (Admin → Content →
// Instagram → Post to site; the article renders at /news/{slug} with the
// slides as a gallery — pages/NewsArticle.jsx). The browser draws the slides
// and writes the article itself (admins can write articles); this keeps the
// slides and clips, which the site shows to everyone, in the bucket:
//
//   site-posts/{postId}/{rev}/{nn}.jpg   a slide (a clip: {nn}.mp4 / .mov,
//                                        copied from ig-videos/ — videos.js)
//     postId  the instagramPosts doc
//     rev     128 random bits, new each time the post is (re)put on the site
//
// The bucket stays private (storage.rules; Public access prevention on): each
// file gets a Firebase download token, and the site links to it by that
// token's URL, which opens that one file and nothing else. Re-posting writes
// a new rev; clean then deletes every other rev, so a file the live article
// doesn't use doesn't stay readable.

const crypto = require("crypto");
const { httpError } = require("./graph");
const staging = require("./staging");
const videos = require("./videos");

const ROOT = "site-posts";
const MAX_SLIDES = 20;
const POST_RE = /^[A-Za-z0-9]{10,40}$/;
const REV_RE = /^[0-9a-f]{32}$/;

const newRev = () => crypto.randomBytes(16).toString("hex");
function checkIds({ postId, rev, index } = {}) {
  if (!POST_RE.test(String(postId || ""))) throw httpError(400, "Unknown post.");
  if (!REV_RE.test(String(rev || ""))) throw httpError(400, "Unknown upload.");
  if (index !== undefined && !(Number.isInteger(index) && index >= 0 && index < MAX_SLIDES)) throw httpError(400, "Bad slide number.");
}
const filePath = (postId, rev, index, ext) => `${ROOT}/${postId}/${rev}/${String(index + 1).padStart(2, "0")}.${ext}`;
const tokenUrl = (b, path, token) => `https://firebasestorage.googleapis.com/v0/b/${b.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

// A file under a token: written (or copied) with one, → its URL.
async function withToken(b, path, write) {
  const token = crypto.randomUUID();
  await write(token);
  return tokenUrl(b, path, token);
}

// { postId, rev, index, jpeg (base64) } → { url, w, h }. Any shape (a Short's
// is 1080×1920), up to staging's size limit.
async function saveSlide(b, { postId, rev, index, jpeg } = {}) {
  checkIds({ postId, rev, index });
  const buf = Buffer.from(String(jpeg || ""), "base64");
  if (!buf.length) throw httpError(400, "The slide is empty.");
  if (buf.length > staging.MAX_BYTES) throw httpError(400, `The slide is ${(buf.length / 1048576).toFixed(1)} MB; the limit is 8 MB.`);
  const info = staging.jpegInfo(buf);
  if (!info) throw httpError(400, "The slide isn't a JPEG.");
  const path = filePath(postId, rev, index, "jpg");
  const url = await withToken(b, path, (token) => b.file(path).save(buf, {
    contentType: "image/jpeg", resumable: false,
    metadata: { cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } },
  }));
  return { url, w: info.w, h: info.h };
}

// { postId, rev, index, path (ig-videos/…) } → { url }: the clip copied in.
async function saveVideo(b, { postId, rev, index, path } = {}) {
  checkIds({ postId, rev, index });
  if (!videos.isVideoPath(path)) throw httpError(400, "That isn't an uploaded video.");
  const dest = filePath(postId, rev, index, videos.extOf(path));
  const url = await withToken(b, dest, async (token) => {
    await videos.copyTo(b, path, dest);
    await b.file(dest).setMetadata({ contentType: videos.contentTypeOf(path), cacheControl: "public, max-age=31536000", metadata: { firebaseStorageDownloadTokens: token } });
  });
  return { url };
}

// { postId, keep } → { deleted }: every rev of the post's site files but keep
// (keep omitted: all of them — the article's gone).
async function clean(b, { postId, keep } = {}) {
  if (!POST_RE.test(String(postId || ""))) throw httpError(400, "Unknown post.");
  if (keep !== undefined && keep !== null && !REV_RE.test(String(keep))) throw httpError(400, "Unknown upload.");
  const [files] = await b.getFiles({ prefix: `${ROOT}/${postId}/` });
  let deleted = 0;
  for (const f of files) {
    if (keep && f.name.startsWith(`${ROOT}/${postId}/${keep}/`)) continue;
    await f.delete({ ignoreNotFound: true });
    deleted++;
  }
  return { deleted };
}

module.exports = { ROOT, MAX_SLIDES, newRev, filePath, tokenUrl, saveSlide, saveVideo, clean };
