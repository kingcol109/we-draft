// server/shop/rateLimit.js
//
// Fixed-window request limits per client IP, counted in Firestore so they
// hold across serverless instances. Used on the endpoints that create
// Stripe sessions or call Printify, so a script can't flood either.
//
// shopRateLimits/{bucket_ipHash_window}: { count, expireAt }. A Firestore
// TTL policy on `expireAt` (optional) clears old windows automatically.

const crypto = require("crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { userError } = require("./config");

function clientIp(req) {
  const fwd = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || String(req.headers?.["x-real-ip"] || "") || req.socket?.remoteAddress || "unknown";
}

async function rateLimit(db, req, bucket, max, windowSec) {
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const ipHash = crypto.createHash("sha256").update(`wd-shop:${clientIp(req)}`).digest("hex").slice(0, 24);
  const ref = db.collection("shopRateLimits").doc(`${bucket}_${ipHash}_${window}`);
  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = (snap.data()?.count || 0) + 1;
    if (snap.exists) tx.update(ref, { count: FieldValue.increment(1) });
    else tx.set(ref, { count: 1, expireAt: Timestamp.fromMillis((window + 2) * windowSec * 1000) });
    return n;
  });
  if (count > max) throw userError(429, "Too many requests. Please wait a few minutes and try again.");
}

module.exports = { rateLimit };
