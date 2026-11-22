// api/stripe-webhook.js — Stripe → We-Draft.com store.
//
// Stripe dashboard → Developers → Webhooks → endpoint
// https://we-draft.com/api/stripe-webhook, with the events listed in
// server/shop/stripeWebhook.js; its signing secret is STRIPE_WEBHOOK_SECRET.
// The signature is verified with Stripe's own SDK (constructEvent) over the
// raw body before anything is read. 200 = handled (or ignored); 500 makes
// Stripe retry later.

const { getFirestore } = require("../scripts/firebaseAdmin");
const { readRaw } = require("../server/shop/http");
const { getStripe } = require("../server/shop/stripe");
const { requireEnv } = require("../server/shop/config");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  let event;
  try {
    const raw = await readRaw(req);
    event = getStripe().webhooks.constructEvent(raw, req.headers["stripe-signature"], requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (e) {
    console.warn("stripe-webhook: rejected", e.message);
    return res.status(400).json({ error: "invalid signature" });
  }
  try {
    const { handleEvent } = require("../server/shop/stripeWebhook");
    const r = await handleEvent(getFirestore(), event);
    return res.status(200).json({ received: true, ...r });
  } catch (e) {
    console.error(`stripe-webhook: ${event.type} ${event.id} failed:`, e.stack || e.message);
    return res.status(500).json({ error: "processing failed" });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
