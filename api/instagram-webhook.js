// api/instagram-webhook.js
//
// Meta's webhook for @wedraftsite's Instagram messages (Instagram object,
// "messages" field). Each message is stored once, keyed by its message ID,
// and its sender (an Instagram-scoped user ID) is matched against
// instagramContacts — server/instagram/contacts.js; setup in
// server/instagram/README.md, "Social: player accounts".
//
// GET  hub.mode=subscribe&hub.verify_token=…&hub.challenge=…
//      Meta's subscription handshake: echoes the challenge when the token
//      matches INSTAGRAM_WEBHOOK_VERIFY_TOKEN.
// POST a delivery, signed: X-Hub-Signature-256 = sha256 HMAC of the exact
//      request bytes with the Meta app secret (META_APP_SECRET). Anything
//      unsigned or mis-signed is refused before it's read. Replies 200 once
//      handled (a retry of the same delivery changes nothing).
//
// Env (server only): META_APP_SECRET, INSTAGRAM_WEBHOOK_VERIFY_TOKEN, plus
// what api/instagram.js already uses (INSTAGRAM_ACCESS_TOKEN,
// INSTAGRAM_USER_ID, GOOGLE_SERVICE_ACCOUNT_KEY).

const crypto = require("crypto");

// The signature is over the raw bytes, so the body is read from the stream
// before anything parses it.
const config = { api: { bodyParser: false } };

function readRaw(req, timeoutMs = 8000) {
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody);
  if (typeof req.rawBody === "string") return Promise.resolve(Buffer.from(req.rawBody));
  if (typeof req.on !== "function" || req.readableEnded) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks = [];
    const done = (v) => { clearTimeout(t); resolve(v); };
    const t = setTimeout(() => done(chunks.length ? Buffer.concat(chunks) : null), timeoutMs);
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", () => done(null));
  });
}

function validSignature(raw, header, secret) {
  if (!raw || !secret || !/^sha256=[0-9a-f]{64}$/i.test(header || "")) return false;
  const want = crypto.createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function sameSecret(a, b) {
  if (!a || !b) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

async function noteStatus(db, fields) {
  try { await db.doc("igAnalytics/webhook").set(fields, { merge: true }); } catch { /* status only */ }
}

async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    if (q["hub.mode"] === "subscribe" && sameSecret(q["hub.verify_token"], process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN)) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(String(q["hub.challenge"] || ""));
    }
    return res.status(403).json({ error: "forbidden" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("instagram webhook: META_APP_SECRET isn't set");
    return res.status(500).json({ error: "not configured" });
  }
  const raw = await readRaw(req);
  if (!raw) return res.status(400).json({ error: "no body" });
  if (!validSignature(raw, req.headers["x-hub-signature-256"], secret)) return res.status(401).json({ error: "bad signature" });
  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "bad json" }); }

  const db = deps.db || require("../scripts/firebaseAdmin").getFirestore();
  const contacts = require("../server/instagram/contacts");
  let graph = deps.graph;
  if (graph === undefined) {
    try { require("../server/instagram/graph").credentials(); graph = require("../server/instagram/graph").graph; } catch { graph = null; }
  }
  try {
    const counts = await contacts.processWebhook(contacts.context(db, { graph, now: deps.now }), body, { accountId: process.env.INSTAGRAM_USER_ID || null });
    await noteStatus(db, { lastEventAt: Date.now(), lastCounts: counts });
    return res.status(200).json({ ok: true, counts });
  } catch (e) {
    // Firestore itself failed: 500, so Meta delivers it again later (the
    // message IDs keep that from doubling anything).
    console.error("instagram webhook failed:", e.message);
    await noteStatus(db, { lastErrorAt: Date.now(), lastError: String(e.message || e).slice(0, 300) });
    return res.status(500).json({ error: "failed" });
  }
}

module.exports = handler;
module.exports.config = config;
module.exports.validSignature = validSignature;
