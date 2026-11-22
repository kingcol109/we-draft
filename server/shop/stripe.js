// server/shop/stripe.js — the Stripe client (official SDK), created once
// per warm function. The SDK pins its own API version.

const Stripe = require("stripe");
const { requireEnv } = require("./config");

let client = null;
function getStripe() {
  if (!client) {
    client = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
      appInfo: { name: "We-Draft.com Store" },
      maxNetworkRetries: 2,
    });
  }
  return client;
}

module.exports = { getStripe };
