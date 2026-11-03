// server/instagram/staging.js
//
// A post's finished slides, held in Firebase Storage just long enough for
// Instagram to fetch them (publish.js). The bucket is private (storage.rules
// closes it to every client; Public access prevention on): Meta gets V4
// signed URLs, signed here with the service account key, that open one file
// each and expire.
//
//   ig-staging/{postId}/{attempt}/{nn}.jpg
//     postId   the instagramPosts doc (a random Firestore id)
//     attempt  128 random bits, new for each publish attempt
// Files stay put while a publish is running or after it fails (to retry or
// look into); they're deleted only once Instagram confirms the post is
// published — the whole ig-staging/{postId}/ folder, every attempt's.
//
// Needs the server's service account (GOOGLE_SERVICE_ACCOUNT_KEY) to hold
// Storage Object User on the bucket — and nothing on the project.

const crypto = require("crypto");
const { httpError } = require("./graph");

const BUCKET = process.env.INSTAGRAM_STAGING_BUCKET || "we-draft.firebasestorage.app";
const ROOT = "ig-staging";
const SIGNED_URL_MS = 24 * 3600e3; // as long as Meta keeps an unpublished container
const MAX_BYTES = 8 * 1024 * 1024; // Instagram's image limit

function bucket() {
  return require("../../scripts/firebaseAdmin").getBucket(BUCKET);
}

const newAttempt = () => crypto.randomBytes(16).toString("hex");
const postDir = (postId) => `${ROOT}/${postId}/`;
const slidePath = (postId, attempt, index) => `${ROOT}/${postId}/${attempt}/${String(index + 1).padStart(2, "0")}.jpg`;

// A JPEG's { w, h } from its frame header, or null when it isn't a JPEG.
function jpegInfo(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// What Instagram takes for a feed image: JPEG, ≤ 8 MB, 320–1440 wide, and
// between 4:5 (tall) and 1.91:1 (wide). Throws a 400 saying which.
function checkSlide(buf) {
  if (!buf?.length) throw httpError(400, "The slide is empty.");
  if (buf.length > MAX_BYTES) throw httpError(400, `The slide is ${(buf.length / 1048576).toFixed(1)} MB; Instagram takes up to 8 MB.`);
  const info = jpegInfo(buf);
  if (!info) throw httpError(400, "The slide isn't a JPEG (Instagram takes JPEG only).");
  const ratio = info.w / info.h;
  if (info.w < 320 || info.w > 1440) throw httpError(400, `The slide is ${info.w} px wide; Instagram takes 320–1440.`);
  if (ratio < 0.8 - 0.005 || ratio > 1.91 + 0.005) throw httpError(400, `The slide is ${info.w}×${info.h}; Instagram takes 4:5 to 1.91:1.`);
  return info;
}

async function saveSlide(b, path, buf) {
  await b.file(path).save(buf, { contentType: "image/jpeg", resumable: false, metadata: { cacheControl: "private, max-age=0" } });
}

async function signedUrl(b, path, now = Date.now()) {
  const [url] = await b.file(path).getSignedUrl({ version: "v4", action: "read", expires: now + SIGNED_URL_MS });
  return url;
}

async function exists(b, path) {
  const [ok] = await b.file(path).exists();
  return ok;
}

// Every file under a post's folder deleted → { deleted, failed: [paths] }.
// One that won't delete doesn't stop the rest; the caller retries later.
async function deletePostFiles(b, postId) {
  const [files] = await b.getFiles({ prefix: postDir(postId) });
  const failed = [];
  let deleted = 0;
  for (const f of files) {
    try {
      await f.delete({ ignoreNotFound: true });
      deleted++;
    } catch (e) {
      failed.push(f.name);
      console.error("instagram staging delete failed:", f.name, e.message);
    }
  }
  return { deleted, failed };
}

module.exports = { BUCKET, ROOT, SIGNED_URL_MS, MAX_BYTES, bucket, newAttempt, postDir, slidePath, jpegInfo, checkSlide, saveSlide, signedUrl, exists, deletePostFiles };
