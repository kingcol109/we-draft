// server/shop/fulfillment.js
//
// Printify orders for paid shopOrders. Stripe collects the customer's
// money; Printify charges US separately when an order goes to production.
// So an order is created at Printify only after Stripe's webhook confirms
// payment, and then held "on-hold" until it's sent to production — by an
// admin (Admin → Shop → Orders → Send to production), or automatically
// when SHOP_AUTO_SUBMIT=true and Printify's cost fits within what the
// customer paid.
//
// IMPORTANT (Printify setting, not code): new Printify stores auto-approve
// orders after 24 hours. Set the store's Order approval to Manual in
// Printify, or held orders go to production on their own.
//
// Never twice: the create is guarded by a Firestore transaction
// (fulfillment.status "creating" + lock time), Printify itself rejects a
// second order with the same external_id (409) — we use our order id — and
// a 409 or lost response is resolved by looking the order up again.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const printify = require("./printify");
const { autoSubmit } = require("./config");
const { ORDERS, issue, addIssue, fulfillmentFromPrintify, normalizeShipment } = require("./orders");

const LOCK_MS = 3 * 60 * 1000;
const transient = (e) => !e.printify || e.status >= 500 || e.status === 429;

// What Printify will charge us (cents), from its order object.
function printifyCost(o) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const price = n(o?.total_price), ship = n(o?.total_shipping), tax = n(o?.total_tax);
  return { totalPrice: price, totalShipping: ship, totalTax: tax, totalCents: price == null || ship == null ? null : price + ship + (tax || 0) };
}

function printifyFields(o) {
  return {
    "printify.status": o.status || null,
    "printify.cost": printifyCost(o),
    "printify.shipments": (o.shipments || []).map(normalizeShipment),
    "printify.syncedAt": Timestamp.now(),
  };
}

// Paid order → Printify order. Returns { result } — "created", "exists",
// "skipped", "error" (transient: caller may retry) or "rejected" (needs an
// admin).
async function createPrintifyOrder(db, orderId, { by = "webhook" } = {}) {
  const ref = db.collection(ORDERS).doc(orderId);
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { skip: "missing" };
    const d = snap.data();
    if (d.status !== "paid") return { skip: `order is ${d.status}` };
    if (d.printify?.orderId) return { skip: "already at Printify" };
    const f = d.fulfillment || {};
    const stale = f.status === "creating" && Date.now() - (f.lockAt?.toMillis?.() || 0) > LOCK_MS;
    if (!(f.status === "not_started" || f.status === "error" || stale)) return { skip: `fulfillment is ${f.status}` };
    tx.update(ref, {
      "fulfillment.status": "creating",
      "fulfillment.lockAt": Timestamp.now(),
      "fulfillment.attempts": FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { order: d };
  });
  if (claim.skip) return { result: "skipped", reason: claim.skip };
  const d = claim.order;

  const body = {
    external_id: orderId,
    label: `WD-${orderId.slice(0, 8).toUpperCase()}`,
    line_items: d.lines.map((l) => ({ product_id: l.fulfillment.productId, variant_id: l.fulfillment.variantId, quantity: l.quantity })),
    shipping_method: 1, // standard — what the customer was quoted and paid
    send_shipping_notification: true,
    address_to: {
      first_name: d.shippingAddress.firstName, last_name: d.shippingAddress.lastName,
      email: d.shippingAddress.email || d.email, phone: d.shippingAddress.phone || undefined,
      country: d.shippingAddress.country, region: d.shippingAddress.region || undefined,
      address1: d.shippingAddress.address1, address2: d.shippingAddress.address2 || undefined,
      city: d.shippingAddress.city, zip: d.shippingAddress.zip,
    },
  };

  let pOrderId = null;
  let existed = false;
  try {
    const r = await printify.createOrder(body);
    pOrderId = r?.id ? String(r.id) : null;
  } catch (e) {
    if (e.printify && e.status === 409) {
      existed = true;
    } else if (transient(e)) {
      // Unknown whether Printify made it — check before calling it failed.
      const found = await printify.findOrderByExternalId(orderId).catch(() => null);
      if (found) { pOrderId = String(found.id); existed = true; }
      else {
        await ref.update({
          "fulfillment.status": "error", "fulfillment.retryable": true,
          issues: FieldValue.arrayUnion(issue("printify_unavailable", e.message)), needsAttention: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { result: "error", error: e.message };
      }
    } else {
      // 4xx: Printify refused it (bad address, product/variant gone, ...).
      await ref.update({
        "fulfillment.status": "error", "fulfillment.retryable": false,
        issues: FieldValue.arrayUnion(issue("printify_rejected", e.message)), needsAttention: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { result: "rejected", error: e.message };
    }
  }
  if (!pOrderId) {
    const found = await printify.findOrderByExternalId(orderId).catch(() => null);
    if (!found) {
      await addIssue(ref, "printify_missing", "Printify reported the order exists but it couldn't be found.", { "fulfillment.status": "error" });
      return { result: "error" };
    }
    pOrderId = String(found.id);
  }

  // Refunded while we were creating it: cancel straight away.
  const now = (await ref.get()).data();
  if (now?.status !== "paid") {
    await ref.update({ "printify.orderId": pOrderId, "fulfillment.status": "on_hold", updatedAt: FieldValue.serverTimestamp() });
    await cancelFulfillment(db, orderId, { reason: `order became ${now?.status} during create` });
    return { result: "skipped", reason: "refunded during create" };
  }

  let full = null;
  try { full = await printify.getOrder(pOrderId); } catch { /* costs come later via refresh/webhook */ }
  await ref.update({
    "printify.orderId": pOrderId,
    "printify.createdBy": by,
    "fulfillment.status": "on_hold",
    "fulfillment.retryable": FieldValue.delete(),
    ...(full ? printifyFields(full) : {}),
    ...(full && fulfillmentFromPrintify(full.status) && fulfillmentFromPrintify(full.status) !== "on_hold"
      ? { "fulfillment.status": fulfillmentFromPrintify(full.status) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (autoSubmit()) {
    const cost = full ? printifyCost(full) : null;
    const paid = (d.amountPaidCents || d.totalCents) - (d.taxCents || 0);
    if (cost?.totalCents != null && cost.totalCents <= paid) {
      await submitToProduction(db, orderId, { by: "auto" });
    } else {
      await addIssue(ref, "held_for_review", cost?.totalCents == null
        ? "Auto-submit skipped: Printify hasn't calculated the cost yet. Send to production manually."
        : `Auto-submit skipped: Printify cost ${cost.totalCents}¢ exceeds the ${paid}¢ paid.`);
    }
  }
  return { result: existed ? "exists" : "created", printifyOrderId: pOrderId };
}

// Held order → production (Printify charges us now).
async function submitToProduction(db, orderId, { by = "admin" } = {}) {
  const ref = db.collection(ORDERS).doc(orderId);
  const d = await db.runTransaction(async (tx) => {
    const x = (await tx.get(ref)).data();
    if (!x) throw Object.assign(new Error("Order not found"), { status: 404, publicMessage: "Order not found." });
    if (x.status !== "paid") throw Object.assign(new Error("not paid"), { status: 409, publicMessage: `Only paid orders can be produced (this one is ${x.status}).` });
    if (!x.printify?.orderId || x.fulfillment?.status !== "on_hold") {
      throw Object.assign(new Error("not on hold"), { status: 409, publicMessage: `The order isn't waiting for approval (fulfillment: ${x.fulfillment?.status}).` });
    }
    tx.update(ref, { "fulfillment.status": "submitting", updatedAt: FieldValue.serverTimestamp() });
    return x;
  });
  try {
    await printify.sendToProduction(d.printify.orderId);
  } catch (e) {
    await ref.update({
      "fulfillment.status": "on_hold",
      issues: FieldValue.arrayUnion(issue("send_to_production_failed", e.message)), needsAttention: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw Object.assign(new Error(e.message), { status: 502, publicMessage: `Printify refused: ${String(e.message).slice(0, 200)}` });
  }
  await ref.update({
    "fulfillment.status": "submitted", "fulfillment.submittedBy": by, "fulfillment.submittedAt": Timestamp.now(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

// Cancel at Printify (only possible while on-hold / payment-not-received),
// or stop an order from ever being created there.
async function cancelFulfillment(db, orderId, { reason = "admin" } = {}) {
  const ref = db.collection(ORDERS).doc(orderId);
  const d = (await ref.get()).data();
  if (!d) throw Object.assign(new Error("Order not found"), { status: 404, publicMessage: "Order not found." });
  if (d.printify?.orderId) {
    try {
      await printify.cancelOrder(d.printify.orderId);
    } catch (e) {
      await addIssue(ref, "cancel_failed", `Printify cancel failed (${reason}): ${e.message}. It may already be in production — check Printify.`);
      return { ok: false, error: e.message };
    }
  } else if (d.fulfillment?.status === "creating") {
    await addIssue(ref, "cancel_during_create", "Canceled while a Printify order was being created — check Printify for it.");
  }
  await ref.update({
    "fulfillment.status": "canceled", "fulfillment.canceledReason": reason,
    "printify.status": d.printify?.orderId ? "canceled" : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

// Pull the current Printify state into the order (webhook + admin Refresh).
async function refreshFromPrintify(db, orderId) {
  const ref = db.collection(ORDERS).doc(orderId);
  const d = (await ref.get()).data();
  if (!d?.printify?.orderId) return { ok: false, reason: "no Printify order" };
  const o = await printify.getOrder(d.printify.orderId);
  const mapped = fulfillmentFromPrintify(o.status);
  const update = { ...printifyFields(o), updatedAt: FieldValue.serverTimestamp() };
  if (mapped) update["fulfillment.status"] = mapped;
  if (mapped === "needs_attention" && d.fulfillment?.status !== "needs_attention") {
    update.needsAttention = true;
    update.issues = FieldValue.arrayUnion(issue(`printify_${o.status}`, o.status === "payment-not-received"
      ? "Printify couldn't charge the store's payment method. Fix billing in Printify, then retry there."
      : `Printify reports "${o.status}". Check the order in Printify.`));
  }
  await ref.update(update);
  return { ok: true, status: o.status };
}

async function findByPrintifyId(db, printifyOrderId) {
  const snap = await db.collection(ORDERS).where("printify.orderId", "==", String(printifyOrderId)).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

module.exports = { createPrintifyOrder, submitToProduction, cancelFulfillment, refreshFromPrintify, findByPrintifyId, transient };
