// server/shop/printifyWebhook.js
//
// Printify webhook events → order fulfillment status. Signature is checked
// in api/printify-webhook.js (X-Pfy-Signature). The payload is only a hint:
// we re-read the order from Printify's API, so a forged or stale payload
// can't move an order's status.
//
// Topics registered (Admin → Shop → Setup → Register webhooks):
//   order:updated, order:sent-to-production, order:shipment:created,
//   order:shipment:delivered
// product:* events clear the catalog cache.

const { refreshFromPrintify, findByPrintifyId } = require("./fulfillment");
const { clearCatalogCache } = require("./catalog");
const { env } = require("./config");

const ORDER_TOPICS = ["order:updated", "order:sent-to-production", "order:shipment:created", "order:shipment:delivered"];
const PRODUCT_TOPICS = ["product:updated", "product:deleted", "product:publish:started"];

async function handlePrintifyEvent(db, evt) {
  const type = evt?.type;
  const res = evt?.resource;
  const shopId = res?.data?.shop_id;
  if (shopId != null && String(shopId) !== String(env("PRINTIFY_SHOP_ID"))) return { ignored: "other shop" };
  if (PRODUCT_TOPICS.includes(type)) { clearCatalogCache(); return { ok: true }; }
  if (!ORDER_TOPICS.includes(type) || res?.type !== "order" || !res.id) return { ignored: true };
  const doc = await findByPrintifyId(db, res.id);
  if (!doc) return { ignored: "not our order" };
  return refreshFromPrintify(db, doc.id);
}

module.exports = { handlePrintifyEvent, ORDER_TOPICS };
