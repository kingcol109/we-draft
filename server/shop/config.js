// server/shop/config.js
//
// The store's settings and the secrets it reads from the environment
// (Vercel → Settings → Environment Variables). Nothing here is ever sent to
// the browser; the React app needs no Stripe key at all, because Checkout
// is a redirect to the URL the server hands back.
//
//   STRIPE_SECRET_KEY          sk_test_… (test mode) / sk_live_…
//   STRIPE_WEBHOOK_SECRET      whsec_… from the Stripe webhook endpoint
//   PRINTIFY_API_TOKEN         Printify personal access token (1-year expiry)
//   PRINTIFY_SHOP_ID           the numeric id of the Printify shop to sell from
//   PRINTIFY_WEBHOOK_SECRET    any long random string (openssl rand -hex 20);
//                              Printify signs its webhooks with it
//   SHOP_SITE_URL              optional, default https://we-draft.com — where
//                              Stripe sends customers back to
//   SHOP_AUTO_SUBMIT           "true" sends a paid order to Printify
//                              production right away; anything else holds it
//                              for an admin's "Send to production"
//   STRIPE_AUTOMATIC_TAX       "true" turns on Stripe Tax in Checkout (set up
//                              Stripe Tax in the dashboard first)

const SITE_URL = (process.env.SHOP_SITE_URL || "https://we-draft.com").replace(/\/+$/, "");

// Where we ship. Printify prices shipping per destination; start with the
// US only and add ISO country codes here when ready.
const SHIP_COUNTRIES = ["US"];

const LIMITS = {
  maxLines: 20,          // distinct variants in one cart
  maxQtyPerLine: 10,
  maxTotalQty: 25,
  contributionMinCents: 100,     // $1
  contributionMaxCents: 50000,   // $500
};

// Suggested contribution amounts shown on /support (the page reads these
// from the API so the two never drift).
const CONTRIBUTION_PRESETS_CENTS = [500, 1000, 2500, 5000];

function env(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}

function requireEnv(name) {
  const v = env(name);
  if (!v) {
    const e = new Error(`${name} is not configured`);
    e.status = 503;
    e.publicMessage = "The store isn't set up yet. Please try again later.";
    throw e;
  }
  return v;
}

const autoSubmit = () => env("SHOP_AUTO_SUBMIT") === "true";
const automaticTax = () => env("STRIPE_AUTOMATIC_TAX") === "true";

// Which keys are set (never their values) — the admin Setup tab shows this.
function configStatus() {
  const k = env("STRIPE_SECRET_KEY") || "";
  return {
    stripeSecretKey: !!k,
    stripeMode: k.startsWith("sk_live_") || k.startsWith("rk_live_") ? "live" : k ? "test" : null,
    stripeWebhookSecret: !!env("STRIPE_WEBHOOK_SECRET"),
    printifyToken: !!env("PRINTIFY_API_TOKEN"),
    printifyShopId: env("PRINTIFY_SHOP_ID"),
    printifyWebhookSecret: !!env("PRINTIFY_WEBHOOK_SECRET"),
    siteUrl: SITE_URL,
    autoSubmit: autoSubmit(),
    automaticTax: automaticTax(),
    shipCountries: SHIP_COUNTRIES,
  };
}

// An error whose message is safe to show the customer.
function userError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  e.publicMessage = message;
  if (extra) e.extra = extra;
  return e;
}

module.exports = {
  SITE_URL, SHIP_COUNTRIES, LIMITS, CONTRIBUTION_PRESETS_CENTS,
  env, requireEnv, autoSubmit, automaticTax, configStatus, userError,
};
