// server/shop/printify.js
//
// The Printify REST API (v1, https://developers.printify.com/) — only the
// calls the store uses. All amounts Printify returns are integer cents.
//
//   GET  /shops.json
//   GET  /shops/{shop}/products.json            (limit ≤ 50, page)
//   GET  /shops/{shop}/products/{id}.json
//   POST /shops/{shop}/orders/shipping.json     shipping quote before checkout
//   POST /shops/{shop}/orders.json              create (external_id unique → 409)
//   GET  /shops/{shop}/orders.json              (limit ≤ 50, page)
//   GET  /shops/{shop}/orders/{id}.json
//   POST /shops/{shop}/orders/{id}/send_to_production.json
//   POST /shops/{shop}/orders/{id}/cancel.json  only "on-hold" / "payment-not-received"
//   GET/POST /shops/{shop}/webhooks.json
//
// Limits: 600 requests/minute overall; error responses must stay under 5%.

const crypto = require("crypto");
const { requireEnv } = require("./config");

const BASE = "https://api.printify.com/v1";

class PrintifyError extends Error {
  constructor(status, body, path) {
    super(`Printify ${status} on ${path}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.printify = true;
  }
}

async function call(method, path, body) {
  const token = requireEnv("PRINTIFY_API_TOKEN");
  const r = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json;charset=utf-8",
      "User-Agent": "WeDraftStore/1.0", // Printify requires a User-Agent
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = text;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!r.ok) throw new PrintifyError(r.status, data, path);
  return data;
}

const shopPath = () => `/shops/${encodeURIComponent(requireEnv("PRINTIFY_SHOP_ID"))}`;

const listShops = () => call("GET", "/shops.json");

async function listAllProducts() {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await call("GET", `${shopPath()}/products.json?limit=50&page=${page}`);
    out.push(...(r?.data || []));
    if (!r?.last_page || page >= r.last_page) break;
  }
  return out;
}

const getProduct = (id) => call("GET", `${shopPath()}/products/${encodeURIComponent(id)}.json`);

// → { standard, express, priority, printify_express, economy } in cents
// (keys missing when that method isn't offered).
const quoteShipping = (lineItems, addressTo) =>
  call("POST", `${shopPath()}/orders/shipping.json`, { line_items: lineItems, address_to: addressTo });

const createOrder = (order) => call("POST", `${shopPath()}/orders.json`, order);
const getOrder = (id) => call("GET", `${shopPath()}/orders/${encodeURIComponent(id)}.json`);
const sendToProduction = (id) => call("POST", `${shopPath()}/orders/${encodeURIComponent(id)}/send_to_production.json`);
const cancelOrder = (id) => call("POST", `${shopPath()}/orders/${encodeURIComponent(id)}/cancel.json`);

// The order we created with this external_id, if any — used when a create
// came back 409 (already exists) or a previous attempt's response was lost.
// Printify can't filter by external_id, so this scans the newest orders.
async function findOrderByExternalId(externalId, pages = 4) {
  for (let page = 1; page <= pages; page++) {
    const r = await call("GET", `${shopPath()}/orders.json?limit=50&page=${page}`);
    const hit = (r?.data || []).find((o) => o.external_id === externalId);
    if (hit) return hit;
    if (!r?.last_page || page >= r.last_page) break;
  }
  return null;
}

const listWebhooks = () => call("GET", `${shopPath()}/webhooks.json`);
const createWebhook = (topic, url, secret) => call("POST", `${shopPath()}/webhooks.json`, { topic, url, secret });

// X-Pfy-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed by our secret>
function validWebhookSignature(raw, header, secret) {
  if (!raw || !secret || !/^sha256=[0-9a-f]{64}$/i.test(header || "")) return false;
  const want = crypto.createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = {
  PrintifyError, listShops, listAllProducts, getProduct, quoteShipping,
  createOrder, getOrder, sendToProduction, cancelOrder, findOrderByExternalId,
  listWebhooks, createWebhook, validWebhookSignature,
};
