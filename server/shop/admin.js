// server/shop/admin.js — Admin → Shop. Every action here runs only after
// api/shop-admin.js has checked the caller is an admin (users/{uid}.role).
//
// Admins see order details needed to fulfil them (items, shipping address,
// payment/fulfillment state) — not users' profiles or other account data.

const { FieldValue } = require("firebase-admin/firestore");
const { ORDERS, adminView, addIssue } = require("./orders");
const { CONTRIBUTIONS } = require("./contributions");
const fulfillment = require("./fulfillment");
const catalog = require("./catalog");
const printify = require("./printify");
const lulu = require("./lulu");
const { getStripe } = require("./stripe");
const { configStatus, SITE_URL, env, userError } = require("./config");
const { ORDER_TOPICS } = require("./printifyWebhook");
const { ts } = require("./orders");

async function listOrders(db, { status = "", q = "", attention = false } = {}) {
  const snap = await db.collection(ORDERS).orderBy("createdAt", "desc").limit(500).get();
  const needle = String(q || "").trim().toLowerCase();
  return snap.docs.map((x) => x.data())
    .filter((d) => !status || d.status === status || d.fulfillment?.status === status)
    .filter((d) => !attention || d.needsAttention)
    .filter((d) => !needle || [d.orderId, d.email, d.printify?.orderId, d.stripe?.sessionId, d.stripe?.paymentIntentId,
      `${d.shippingAddress?.firstName || ""} ${d.shippingAddress?.lastName || ""}`, ...(d.lines || []).map((l) => l.title)]
      .some((v) => String(v || "").toLowerCase().includes(needle)))
    .slice(0, 200)
    .map(adminView);
}

async function getOrder(db, orderId) {
  const d = (await db.collection(ORDERS).doc(String(orderId)).get()).data();
  if (!d) throw userError(404, "Order not found.");
  return adminView(d);
}

async function listContributions(db) {
  const snap = await db.collection(CONTRIBUTIONS).orderBy("createdAt", "desc").limit(500).get();
  return snap.docs.map((x) => x.data()).map((d) => ({
    ...d, createdAt: ts(d.createdAt), updatedAt: ts(d.updatedAt), lastPaidAt: ts(d.lastPaidAt), canceledAt: ts(d.canceledAt),
  }));
}

async function clearAttention(db, orderId) {
  await db.collection(ORDERS).doc(String(orderId)).update({ needsAttention: false, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
}

// Full refund through Stripe; the charge.refunded webhook then updates the
// order and cancels the Printify order if it hasn't gone to production.
async function refundOrder(db, orderId) {
  const d = (await db.collection(ORDERS).doc(String(orderId)).get()).data();
  if (!d) throw userError(404, "Order not found.");
  if (!d.stripe?.paymentIntentId || !["paid", "partially_refunded"].includes(d.status)) throw userError(409, `This order can't be refunded (status: ${d.status}).`);
  const r = await getStripe().refunds.create({ payment_intent: d.stripe.paymentIntentId, metadata: { orderId: d.orderId } },
    { idempotencyKey: `wd-refund-${d.orderId}` });
  return { ok: true, refundId: r.id, status: r.status };
}

async function retryFulfillment(db, orderId) {
  const ref = db.collection(ORDERS).doc(String(orderId));
  const d = (await ref.get()).data();
  if (!d) throw userError(404, "Order not found.");
  if (d.fulfillment?.status === "needs_attention" && !d.printify?.orderId) {
    await ref.update({ "fulfillment.status": "error" }); // e.g. an amount mismatch an admin has checked
  }
  return fulfillment.createPrintifyOrder(db, String(orderId), { by: "admin" });
}

async function setup(db) {
  const status = configStatus();
  const out = { config: status, shops: null, webhooks: null, errors: [] };
  if (status.printifyToken) {
    try { out.shops = (await printify.listShops()).map((s) => ({ id: s.id, title: s.title, channel: s.sales_channel })); }
    catch (e) { out.errors.push(`Printify shops: ${e.message}`); }
    if (status.printifyShopId) {
      try { out.webhooks = (await printify.listWebhooks()).map((w) => ({ id: w.id, topic: w.topic, url: w.url })); }
      catch (e) { out.errors.push(`Printify webhooks: ${e.message}`); }
    }
  }
  out.printifyWebhookUrl = `${SITE_URL}/api/printify-webhook`;
  out.stripeWebhookUrl = `${SITE_URL}/api/stripe-webhook`;
  return out;
}

async function registerPrintifyWebhooks() {
  const secret = env("PRINTIFY_WEBHOOK_SECRET");
  if (!secret) throw userError(400, "Set PRINTIFY_WEBHOOK_SECRET in Vercel first.");
  const url = `${SITE_URL}/api/printify-webhook`;
  const existing = await printify.listWebhooks();
  const created = [];
  for (const topic of [...ORDER_TOPICS, "product:updated", "product:deleted"]) {
    if (existing.some((w) => w.topic === topic && w.url === url)) continue;
    await printify.createWebhook(topic, url, secret);
    created.push(topic);
  }
  return { created };
}

async function handle(db, action, body) {
  switch (action) {
    case "orders": return { orders: await listOrders(db, body) };
    case "order": return { order: await getOrder(db, body.orderId) };
    case "contributions": return { contributions: await listContributions(db) };
    case "retryFulfillment": return retryFulfillment(db, body.orderId);
    case "sendToProduction": return fulfillment.submitToProduction(db, String(body.orderId), { by: "admin" });
    case "cancelFulfillment": return fulfillment.cancelFulfillment(db, String(body.orderId), { reason: "admin" });
    case "refreshOrder": return fulfillment.refreshFromPrintify(db, String(body.orderId));
    case "refund": return refundOrder(db, body.orderId);
    case "clearAttention": return clearAttention(db, body.orderId);
    case "note": {
      const note = String(body.note || "").trim().slice(0, 500);
      if (!note) throw userError(400, "Empty note.");
      await addIssue(db.collection(ORDERS).doc(String(body.orderId)), "admin_note", note, { needsAttention: false });
      return { ok: true };
    }
    case "products": return { products: await catalog.adminProductList(db) };
    case "importProducts": return catalog.importProducts(db, { printifyProductIds: body.printifyProductIds || null, hidden: !!body.hidden });
    case "updateProduct": await catalog.updateProductSettings(db, body.id, body); return { ok: true };
    case "setup": return setup(db);
    case "registerWebhooks": return registerPrintifyWebhooks();
    case "luluCheck": return { lulu: await lulu.checkConnection() };
    default: throw userError(400, "Unknown action.");
  }
}

module.exports = { handle };
