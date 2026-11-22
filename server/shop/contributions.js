// server/shop/contributions.js
//
// Voluntary contributions to We-Draft.com (/support) — not merchandise, no
// Printify, not charitable donations. One-time payments use Checkout in
// "payment" mode; monthly ones use "subscription" mode, and customers
// manage or cancel them in Stripe's Customer Portal (signed in: a portal
// session for their own Stripe customer; guests: Stripe's emailed
// login link, configured in the Stripe dashboard).
//
// Firestore: shopContributions/{id} (random id; no client access)
//   { contributionId, uid, email, amountCents, currency, recurring,
//     interval ("month"|null), status, stripe: { sessionId,
//     paymentIntentId, subscriptionId, customerId }, paymentsCount,
//     totalPaidCents, lastPaidAt, cancelAtPeriodEnd, createdAt, updatedAt }
//   status: pending → paid (one-time) | active → past_due → canceled
//           | expired (checkout abandoned) | refunded
//   …/payments/{invoiceId or paymentIntentId}: one doc per successful
//   charge, so renewals are counted exactly once.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { SITE_URL, LIMITS, CONTRIBUTION_PRESETS_CENTS, userError } = require("./config");
const { validEmail } = require("./validate");
const { getStripe } = require("./stripe");
const { ts } = require("./orders");

const CONTRIBUTIONS = "shopContributions";

async function createContributionCheckout(db, body, user) {
  const amountCents = Number(body?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < LIMITS.contributionMinCents || amountCents > LIMITS.contributionMaxCents) {
    throw userError(400, `Please choose an amount between $${LIMITS.contributionMinCents / 100} and $${LIMITS.contributionMaxCents / 100}.`);
  }
  const recurring = body?.recurring === true;
  const email = validEmail(body?.email) || validEmail(user?.email) || null;

  const ref = db.collection(CONTRIBUTIONS).doc();
  await ref.set({
    contributionId: ref.id,
    uid: user?.uid || null,
    email,
    amountCents,
    currency: "usd",
    recurring,
    interval: recurring ? "month" : null,
    status: "pending",
    stripe: { sessionId: null, paymentIntentId: null, subscriptionId: null, customerId: null },
    paymentsCount: 0,
    totalPaidCents: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const meta = { kind: "contribution", contributionId: ref.id };
  const priceData = {
    currency: "usd",
    unit_amount: amountCents,
    product_data: {
      name: recurring ? "Monthly support for We-Draft.com" : "Support We-Draft.com",
      description: "A voluntary contribution to keep We-Draft.com's scouting content free. Not a charitable donation and not tax-deductible.",
    },
    ...(recurring ? { recurring: { interval: "month" } } : {}),
  };
  let session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: recurring ? "subscription" : "payment",
      line_items: [{ quantity: 1, price_data: priceData }],
      ...(email ? { customer_email: email } : {}),
      // One-time payers get a Customer too, so a signed-in user can open
      // the portal later for their receipts.
      ...(recurring ? {} : { customer_creation: "always" }),
      client_reference_id: ref.id,
      metadata: meta,
      ...(recurring ? { subscription_data: { metadata: meta } } : { payment_intent_data: { metadata: meta } }),
      success_url: `${SITE_URL}/support/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/support`,
    }, { idempotencyKey: `wd-contrib-${ref.id}` });
  } catch (e) {
    await ref.update({ status: "checkout_failed", updatedAt: FieldValue.serverTimestamp() });
    throw userError(502, "We couldn't start checkout. Please try again.");
  }
  await ref.update({ "stripe.sessionId": session.id, updatedAt: FieldValue.serverTimestamp() });
  return { url: session.url };
}

// ── Webhook updates ───────────────────────────────────────────────────
async function onCheckoutCompleted(db, session) {
  const id = session.metadata?.contributionId;
  if (!id) return;
  const ref = db.collection(CONTRIBUTIONS).doc(id);
  const d = (await ref.get()).data();
  if (!d || d.stripe?.sessionId !== session.id) return;
  const update = {
    "stripe.customerId": typeof session.customer === "string" ? session.customer : session.customer?.id || null,
    email: session.customer_details?.email || d.email || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (session.mode === "subscription") {
    update["stripe.subscriptionId"] = typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
    if (d.status === "pending") update.status = "active";
    await ref.update(update);
    return;
  }
  if (session.payment_status !== "paid") { await ref.update(update); return; }
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  update["stripe.paymentIntentId"] = pi;
  await ref.update(update);
  await recordPayment(db, ref, pi || session.id, session.amount_total, "paid");
}

// Count a successful charge once (the payments/{key} doc is the guard).
async function recordPayment(db, ref, key, amountCents, status) {
  const pref = ref.collection("payments").doc(String(key));
  await db.runTransaction(async (tx) => {
    const [p, c] = await Promise.all([tx.get(pref), tx.get(ref)]);
    if (p.exists || !c.exists) return;
    tx.set(pref, { amountCents: amountCents || 0, at: Timestamp.now() });
    const upd = {
      paymentsCount: FieldValue.increment(1),
      totalPaidCents: FieldValue.increment(amountCents || 0),
      lastPaidAt: Timestamp.now(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (status && ["pending", "past_due", "active"].includes(c.data().status)) upd.status = status;
    tx.update(ref, upd);
  });
}

function subscriptionIdOf(invoice) {
  const s = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  return typeof s === "string" ? s : s?.id || null;
}

async function contributionForSubscription(db, subId, metaId) {
  if (metaId) {
    const ref = db.collection(CONTRIBUTIONS).doc(metaId);
    if ((await ref.get()).exists) return ref;
  }
  if (!subId) return null;
  const snap = await db.collection(CONTRIBUTIONS).where("stripe.subscriptionId", "==", subId).limit(1).get();
  if (!snap.empty) return snap.docs[0].ref;
  // invoice.paid can arrive before checkout.session.completed: read the
  // subscription's own metadata.
  const sub = await getStripe().subscriptions.retrieve(subId);
  const id = sub.metadata?.contributionId;
  if (!id) return null;
  const ref = db.collection(CONTRIBUTIONS).doc(id);
  if (!(await ref.get()).exists) return null;
  await ref.update({ "stripe.subscriptionId": subId });
  return ref;
}

async function onInvoicePaid(db, invoice) {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return;
  const ref = await contributionForSubscription(db, subId, invoice.parent?.subscription_details?.metadata?.contributionId);
  if (!ref) return;
  await recordPayment(db, ref, invoice.id, invoice.amount_paid, "active");
}

async function onInvoiceFailed(db, invoice) {
  const subId = subscriptionIdOf(invoice);
  const ref = subId && await contributionForSubscription(db, subId, invoice.parent?.subscription_details?.metadata?.contributionId);
  if (ref) await ref.update({ status: "past_due", updatedAt: FieldValue.serverTimestamp() });
}

async function onSubscriptionChanged(db, sub) {
  const ref = await contributionForSubscription(db, sub.id, sub.metadata?.contributionId);
  if (!ref) return;
  const map = { active: "active", trialing: "active", past_due: "past_due", unpaid: "past_due", canceled: "canceled", incomplete_expired: "expired", incomplete: "pending", paused: "paused" };
  // A scheduled cancellation shows up as cancel_at_period_end, or — newer
  // API versions / the Customer Portal — as a cancel_at date.
  const cancelAt = Number(sub.cancel_at) || null;
  await ref.update({
    status: map[sub.status] || sub.status,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || (!!cancelAt && sub.status !== "canceled"),
    cancelAt: cancelAt ? Timestamp.fromMillis(cancelAt * 1000) : null,
    ...(sub.status === "canceled" ? { canceledAt: Timestamp.now() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function onCheckoutExpired(db, session) {
  const id = session.metadata?.contributionId;
  if (!id) return;
  const ref = db.collection(CONTRIBUTIONS).doc(id);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    if (d?.status === "pending") tx.update(ref, { status: "expired", updatedAt: FieldValue.serverTimestamp() });
  });
}

// One-time contribution refunds (charge.refunded).
async function onRefund(db, paymentIntentId, refundedCents, fullyRefunded) {
  if (!paymentIntentId) return false;
  const snap = await db.collection(CONTRIBUTIONS).where("stripe.paymentIntentId", "==", paymentIntentId).limit(1).get();
  if (snap.empty) return false;
  await snap.docs[0].ref.update({
    status: fullyRefunded ? "refunded" : snap.docs[0].data().status,
    amountRefundedCents: refundedCents,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return true;
}

// ── Customers ─────────────────────────────────────────────────────────
function contributionView(d) {
  return {
    contributionId: d.contributionId, createdAt: ts(d.createdAt), amountCents: d.amountCents,
    recurring: !!d.recurring, interval: d.interval, status: d.status,
    paymentsCount: d.paymentsCount || 0, totalPaidCents: d.totalPaidCents || 0,
    lastPaidAt: ts(d.lastPaidAt), cancelAtPeriodEnd: !!d.cancelAtPeriodEnd, cancelAt: ts(d.cancelAt),
  };
}

async function contributionsForUser(db, uid) {
  const snap = await db.collection(CONTRIBUTIONS).where("uid", "==", uid).get();
  return snap.docs.map((x) => x.data())
    .filter((d) => !["pending", "expired", "checkout_failed"].includes(d.status))
    .sort((a, b) => (ts(b.createdAt) || 0) - (ts(a.createdAt) || 0))
    .map(contributionView);
}

// Stripe Customer Portal for the signed-in user's own Stripe customer —
// the secure place to cancel or change a monthly contribution.
async function billingPortal(db, uid) {
  const snap = await db.collection(CONTRIBUTIONS).where("uid", "==", uid).get();
  const withCustomer = snap.docs.map((x) => x.data()).filter((d) => d.stripe?.customerId)
    .sort((a, b) => (b.recurring - a.recurring) || ((ts(b.createdAt) || 0) - (ts(a.createdAt) || 0)));
  if (!withCustomer.length) throw userError(404, "We couldn't find a contribution on your account.");
  const s = await getStripe().billingPortal.sessions.create({
    customer: withCustomer[0].stripe.customerId,
    return_url: `${SITE_URL}/profile?tab=store`,
  });
  return { url: s.url };
}

async function receipt(db, sessionId) {
  const snap = await db.collection(CONTRIBUTIONS).where("stripe.sessionId", "==", sessionId).limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  return { kind: "contribution", amountCents: d.amountCents, recurring: !!d.recurring, status: d.status };
}

module.exports = {
  CONTRIBUTIONS, CONTRIBUTION_PRESETS_CENTS, createContributionCheckout,
  onCheckoutCompleted, onCheckoutExpired, onInvoicePaid, onInvoiceFailed, onSubscriptionChanged, onRefund,
  contributionsForUser, contributionView, billingPortal, receipt,
};
