// server/shop/stripeWebhook.js
//
// Stripe webhook events → orders and contributions. The endpoint
// (api/stripe-webhook.js) has already verified the signature with
// stripe.webhooks.constructEvent before anything here runs.
//
// Subscribe the Stripe endpoint to:
//   checkout.session.completed, checkout.session.expired,
//   checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
//   charge.refunded, charge.dispute.created,
//   invoice.paid, invoice.payment_failed,
//   customer.subscription.updated, customer.subscription.deleted
//
// Duplicates: stripeEvents/{event.id} records finished events, and every
// handler is idempotent on its own (status transitions in transactions,
// the Printify create lock in fulfillment.js). A handler that throws makes
// the endpoint answer 500, so Stripe retries the event later (for up to
// three days) — that's how a Printify outage recovers by itself.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { ORDERS, issue, addIssue } = require("./orders");
const { createPrintifyOrder, cancelFulfillment, transient } = require("./fulfillment");
const contributions = require("./contributions");

const idOf = (v) => (typeof v === "string" ? v : v?.id || null);

// pending_payment → paid, recording what Stripe actually charged.
async function markOrderPaid(db, session) {
  const orderId = session.metadata?.orderId;
  const ref = db.collection(ORDERS).doc(orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "unknown order" };
    const d = snap.data();
    if (d.stripe?.sessionId !== session.id) return { ok: false, reason: "session mismatch" };
    if (d.status !== "pending_payment" && d.status !== "payment_failed") return { ok: true, already: true };
    const shippingPaid = session.shipping_cost?.amount_total ?? null;
    const mismatch = session.amount_subtotal !== d.subtotalCents || (shippingPaid !== null && shippingPaid !== d.shippingCents);
    const upd = {
      status: "paid",
      paidAt: Timestamp.now(),
      amountPaidCents: session.amount_total,
      taxCents: session.total_details?.amount_tax || 0,
      "stripe.paymentIntentId": idOf(session.payment_intent),
      "stripe.customerId": idOf(session.customer),
      email: session.customer_details?.email || d.email,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (mismatch) {
      // Shouldn't happen (the session was built from this order) — hold it.
      upd["fulfillment.status"] = "needs_attention";
      upd.needsAttention = true;
      upd.issues = [...(d.issues || []), issue("amount_mismatch", `Stripe subtotal ${session.amount_subtotal}¢ / shipping ${shippingPaid}¢ ≠ order ${d.subtotalCents}¢ / ${d.shippingCents}¢. Not sent to Printify.`)];
    }
    tx.update(ref, upd);
    return { ok: true, mismatch };
  });
}

async function fulfillOrThrow(db, orderId) {
  const r = await createPrintifyOrder(db, orderId, { by: "webhook" });
  // A transient Printify failure: fail the webhook so Stripe redelivers it.
  if (r.result === "error") throw Object.assign(new Error(`Printify unavailable: ${r.error || ""}`), { retry: true });
  return r;
}

async function onOrderCheckout(db, session) {
  if (session.payment_status !== "paid") return; // async methods: wait for async_payment_succeeded
  const paid = await markOrderPaid(db, session);
  if (!paid.ok || paid.mismatch) return;
  await fulfillOrThrow(db, session.metadata.orderId);
}

async function onOrderStatus(db, session, status) {
  const ref = db.collection(ORDERS).doc(session.metadata.orderId);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (d && d.status === "pending_payment" && d.stripe?.sessionId === session.id) {
      tx.update(ref, { status, updatedAt: FieldValue.serverTimestamp() });
    }
  });
}

async function onChargeRefunded(db, charge) {
  const pi = idOf(charge.payment_intent);
  const full = charge.amount_refunded >= charge.amount;
  if (await contributions.onRefund(db, pi, charge.amount_refunded, full)) return;
  if (!pi) return;
  const snap = await db.collection(ORDERS).where("stripe.paymentIntentId", "==", pi).limit(1).get();
  if (snap.empty) return;
  const ref = snap.docs[0].ref;
  const d = snap.docs[0].data();
  await ref.update({
    status: full ? "refunded" : "partially_refunded",
    amountRefundedCents: charge.amount_refunded,
    updatedAt: FieldValue.serverTimestamp(),
  });
  if (!full) {
    await addIssue(ref, "partial_refund", `Partially refunded (${charge.amount_refunded}¢). Fulfillment unchanged — adjust in Printify if needed.`);
    return;
  }
  // Fully refunded: stop the goods if they haven't gone to production.
  const f = d.fulfillment?.status;
  if (["not_started", "error", "on_hold", "needs_attention", "creating"].includes(f)) {
    const r = await cancelFulfillment(db, d.orderId, { reason: "refunded" });
    if (!r.ok) return; // cancelFulfillment logged the issue
  } else if (f !== "canceled") {
    await addIssue(ref, "refunded_after_production", `Refunded after it was sent to production (fulfillment: ${f}). Printify has already charged for it — cancel in Printify if still possible.`);
  }
}

async function onDispute(db, dispute) {
  const pi = idOf(dispute.payment_intent);
  if (!pi) return;
  const snap = await db.collection(ORDERS).where("stripe.paymentIntentId", "==", pi).limit(1).get();
  if (!snap.empty) await addIssue(snap.docs[0].ref, "dispute", `Payment disputed (${dispute.reason || "unknown reason"}). Respond in the Stripe dashboard.`);
}

async function handleEvent(db, event) {
  const evRef = db.collection("stripeEvents").doc(event.id);
  if ((await evRef.get()).data()?.status === "done") return { duplicate: true };

  const o = event.data.object;
  const kind = o?.metadata?.kind;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (kind === "order") await onOrderCheckout(db, o);
      else if (kind === "contribution") await contributions.onCheckoutCompleted(db, o);
      break;
    case "checkout.session.async_payment_failed":
      if (kind === "order") await onOrderStatus(db, o, "payment_failed");
      break;
    case "checkout.session.expired":
      if (kind === "order") await onOrderStatus(db, o, "expired");
      else if (kind === "contribution") await contributions.onCheckoutExpired(db, o);
      break;
    case "charge.refunded": await onChargeRefunded(db, o); break;
    case "charge.dispute.created": await onDispute(db, o); break;
    case "invoice.paid": await contributions.onInvoicePaid(db, o); break;
    case "invoice.payment_failed": await contributions.onInvoiceFailed(db, o); break;
    case "customer.subscription.updated":
    case "customer.subscription.deleted": await contributions.onSubscriptionChanged(db, o); break;
    default: return { ignored: true };
  }
  await evRef.set({ type: event.type, status: "done", livemode: !!event.livemode, at: Timestamp.now(),
    expireAt: Timestamp.fromMillis(Date.now() + 30 * 864e5) });
  return { ok: true };
}

module.exports = { handleEvent, transient };
