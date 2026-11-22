// api/shop.js — the public store + support API (/shop, /support, profile).
//
//   GET  ?action=catalog                     storefront products (cached 60s at the edge)
//   GET  ?action=receipt&session_id=cs_…     success/thanks page status
//   GET  ?action=supportConfig               contribution presets + limits
//   POST { action: "quote", items, address }            prices + Printify shipping
//   POST { action: "checkout", items, address, email, expectedTotalCents }
//   POST { action: "contribute", amountCents, recurring, email }
//   POST { action: "myHistory" }        (signed in) own orders + contributions
//   POST { action: "billingPortal" }    (signed in) Stripe portal for own subscription
//
// Open to everyone (no sign-in needed to buy); a valid Firebase ID token
// (Authorization: Bearer …) attaches the purchase to that account. Server
// code: server/shop/*.

const { getFirestore } = require("../scripts/firebaseAdmin");
const { optionalUser, requireUser } = require("../server/shop/auth");
const { rateLimit } = require("../server/shop/rateLimit");
const { sendError } = require("../server/shop/http");
const { LIMITS, CONTRIBUTION_PRESETS_CENTS, SHIP_COUNTRIES, env } = require("../server/shop/config");

module.exports = async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex");
  const db = getFirestore();
  try {
    if (req.method === "GET") {
      const action = req.query?.action;
      if (action === "catalog") {
        const { publicCatalog } = require("../server/shop/catalog");
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.status(200).json({ products: await publicCatalog(db), shipCountries: SHIP_COUNTRIES, limits: LIMITS });
      }
      if (action === "supportConfig") {
        res.setHeader("Cache-Control", "public, s-maxage=300");
        return res.status(200).json({
          presetsCents: CONTRIBUTION_PRESETS_CENTS,
          minCents: LIMITS.contributionMinCents, maxCents: LIMITS.contributionMaxCents,
          portalLoginUrl: env("STRIPE_PORTAL_LOGIN_URL"),
        });
      }
      if (action === "receipt") {
        const sid = String(req.query?.session_id || "");
        if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) return res.status(400).json({ error: "Bad session." });
        await rateLimit(db, req, "receipt", 60, 600);
        res.setHeader("Cache-Control", "no-store");
        const { findBySession, receiptView } = require("../server/shop/orders");
        const doc = await findBySession(db, sid);
        if (doc) return res.status(200).json(receiptView(doc.data()));
        const { receipt } = require("../server/shop/contributions");
        const c = await receipt(db, sid);
        return c ? res.status(200).json(c) : res.status(404).json({ error: "Not found." });
      }
      return res.status(400).json({ error: "Unknown action." });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only." });
    res.setHeader("Cache-Control", "no-store");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    switch (body.action) {
      case "quote": {
        await rateLimit(db, req, "quote", 40, 600);
        const { quote } = require("../server/shop/checkout");
        return res.status(200).json(await quote(db, body));
      }
      case "checkout": {
        await rateLimit(db, req, "checkout", 10, 600);
        const user = await optionalUser(req);
        const { createCheckout } = require("../server/shop/checkout");
        return res.status(200).json(await createCheckout(db, body, user));
      }
      case "contribute": {
        await rateLimit(db, req, "contribute", 10, 600);
        const user = await optionalUser(req);
        const { createContributionCheckout } = require("../server/shop/contributions");
        return res.status(200).json(await createContributionCheckout(db, body, user));
      }
      case "myHistory": {
        const user = await requireUser(req);
        const { ordersForUser } = require("../server/shop/orders");
        const { contributionsForUser } = require("../server/shop/contributions");
        const [orders, contributions] = await Promise.all([ordersForUser(db, user.uid), contributionsForUser(db, user.uid)]);
        return res.status(200).json({ orders, contributions });
      }
      case "billingPortal": {
        await rateLimit(db, req, "portal", 10, 600);
        const user = await requireUser(req);
        const { billingPortal } = require("../server/shop/contributions");
        return res.status(200).json(await billingPortal(db, user.uid));
      }
      default:
        return res.status(400).json({ error: "Unknown action." });
    }
  } catch (e) {
    return sendError(res, e, "shop");
  }
};
