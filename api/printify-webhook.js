// api/printify-webhook.js — Printify → We-Draft.com store (order status and
// shipments). Registered from Admin → Shop → Setup; signed with
// PRINTIFY_WEBHOOK_SECRET (X-Pfy-Signature: sha256=<hex HMAC of the body>).
// Printify retries a failed delivery up to 3 times, then pauses the webhook
// for an hour — Admin → Shop → Orders → Refresh pulls status by hand.

const { getFirestore } = require("../scripts/firebaseAdmin");
const { readRaw } = require("../server/shop/http");
const { validWebhookSignature } = require("../server/shop/printify");
const { env } = require("../server/shop/config");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const raw = await readRaw(req);
  if (!validWebhookSignature(raw, req.headers["x-pfy-signature"], env("PRINTIFY_WEBHOOK_SECRET"))) {
    return res.status(401).json({ error: "invalid signature" });
  }
  let evt;
  try { evt = JSON.parse(raw.toString("utf8")); } catch { return res.status(400).json({ error: "bad json" }); }
  try {
    const { handlePrintifyEvent } = require("../server/shop/printifyWebhook");
    const r = await handlePrintifyEvent(getFirestore(), evt);
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error(`printify-webhook: ${evt?.type} failed:`, e.stack || e.message);
    return res.status(500).json({ error: "processing failed" });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
