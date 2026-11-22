// server/shop/orders.js
//
// Firestore: shopOrders/{orderId} — one merchandise order. The id is a
// random Firestore id (never sequential), and the collection has no client
// access at all (firestore.rules): customers read their own orders, and
// guests their order status by Stripe session id, only through the API.
//
// Two status fields:
//   status — the money:
//     pending_payment → paid → refunded | partially_refunded
//     pending_payment → expired | payment_failed | checkout_failed
//   fulfillment.status — the goods (only ever moved by Printify's answers):
//     not_started → creating → on_hold (at Printify, awaiting approval)
//       → submitted (sent to production) → in_production
//       → partially_shipped → fulfilled (Printify: all shipped)
//     any → error (create failed; retried) | needs_attention | canceled
// needsAttention + issues[] mark what an admin has to look at
// (Admin → Shop → Orders).
//
// lines[] is a snapshot of every item at purchase time (title, options,
// price, image, and the Printify product/variant ids), so the order stays
// accurate when the product is later edited or deleted.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");

const ORDERS = "shopOrders";

function newOrderDoc({ id, uid, email, lines, address, shipping, totals }) {
  return {
    orderId: id,
    uid: uid || null,
    email,
    lines,
    currency: "usd",
    subtotalCents: totals.subtotalCents,
    shippingCents: totals.shippingCents,
    shippingMethod: shipping.method,
    totalCents: totals.totalCents,
    taxCents: 0,
    amountPaidCents: 0,
    amountRefundedCents: 0,
    shippingAddress: address,
    status: "pending_payment",
    fulfillment: { provider: "printify", status: "not_started", attempts: 0 },
    stripe: { sessionId: null, paymentIntentId: null, customerId: null },
    printify: { orderId: null, status: null, shipments: [] },
    needsAttention: false,
    issues: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// An admin-visible problem on the order (kept to the last 20).
function issue(code, message) {
  return { at: Timestamp.now(), code, message: String(message || "").slice(0, 500) };
}
async function addIssue(ref, code, message, extra = {}) {
  await ref.firestore.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() || {};
    tx.update(ref, {
      issues: [...(d.issues || []), issue(code, message)].slice(-20),
      needsAttention: true,
      updatedAt: FieldValue.serverTimestamp(),
      ...extra,
    });
  });
}

// Printify order status → our fulfillment.status.
function fulfillmentFromPrintify(s) {
  switch (s) {
    case "pending": case "on-hold": case "cost-calculation": return "on_hold";
    case "sending-to-production": case "sending_to_production_delegate": case "sending_to_production_delegate_sync": return "submitted";
    case "in-production": return "in_production";
    case "partially-fulfilled": return "partially_shipped";
    case "fulfilled": return "fulfilled";
    case "canceled": return "canceled";
    case "payment-not-received": case "has-issues": case "unfulfillable": case "source-check-failed": return "needs_attention";
    default: return null;
  }
}

// Printify shipment → ours. Field names differ between the order object
// and webhook payloads, so both are accepted.
function normalizeShipment(s) {
  const c = s?.carrier;
  return {
    carrier: (typeof c === "string" ? c : c?.code) || null,
    number: s?.number || s?.tracking_number || c?.tracking_number || null,
    url: s?.url || s?.tracking_url || c?.tracking_url || null,
    shippedAt: s?.shipped_at || null,
    deliveredAt: s?.delivered_at || null,
  };
}

const ts = (v) => (v?.toMillis ? v.toMillis() : v?._seconds ? v._seconds * 1000 : null);

// What a signed-in customer sees about their own order.
function customerView(d) {
  return {
    orderId: d.orderId,
    createdAt: ts(d.createdAt),
    paidAt: ts(d.paidAt),
    status: d.status,
    fulfillmentStatus: d.fulfillment?.status,
    lines: (d.lines || []).map(({ fulfillment, ...l }) => l),
    subtotalCents: d.subtotalCents, shippingCents: d.shippingCents, taxCents: d.taxCents || 0,
    totalCents: d.amountPaidCents || d.totalCents,
    amountRefundedCents: d.amountRefundedCents || 0,
    shippingAddress: d.shippingAddress ? {
      name: `${d.shippingAddress.firstName} ${d.shippingAddress.lastName}`,
      address1: d.shippingAddress.address1, address2: d.shippingAddress.address2,
      city: d.shippingAddress.city, region: d.shippingAddress.region, zip: d.shippingAddress.zip, country: d.shippingAddress.country,
    } : null,
    shipments: d.printify?.shipments || [],
  };
}

// The success page — anyone holding the Stripe session id (only the buyer
// gets it, in Stripe's redirect). No address, partial email.
function receiptView(d) {
  const [u, dom] = String(d.email || "").split("@");
  return {
    kind: "order",
    orderId: d.orderId,
    status: d.status,
    fulfillmentStatus: d.fulfillment?.status,
    email: u && dom ? `${u.slice(0, 2)}***@${dom}` : null,
    lines: (d.lines || []).map((l) => ({ title: l.title, variantTitle: l.variantTitle, quantity: l.quantity, image: l.image })),
    totalCents: d.amountPaidCents || d.totalCents,
  };
}

function adminView(d) {
  return {
    ...d,
    createdAt: ts(d.createdAt), updatedAt: ts(d.updatedAt), paidAt: ts(d.paidAt),
    issues: (d.issues || []).map((i) => ({ ...i, at: ts(i.at) })),
    fulfillment: { ...d.fulfillment, lockAt: ts(d.fulfillment?.lockAt) },
  };
}

async function ordersForUser(db, uid) {
  const snap = await db.collection(ORDERS).where("uid", "==", uid).get();
  return snap.docs.map((x) => x.data())
    .filter((d) => !["pending_payment", "expired", "checkout_failed", "payment_failed"].includes(d.status))
    .sort((a, b) => (ts(b.createdAt) || 0) - (ts(a.createdAt) || 0))
    .slice(0, 100)
    .map(customerView);
}

async function findBySession(db, sessionId) {
  const snap = await db.collection(ORDERS).where("stripe.sessionId", "==", sessionId).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

module.exports = {
  ORDERS, newOrderDoc, issue, addIssue, fulfillmentFromPrintify, normalizeShipment,
  customerView, receiptView, adminView, ordersForUser, findBySession, ts,
};
