// server/shop/checkout.js
//
// Merchandise checkout:
//   quote()           cart + address → trusted prices + Printify's shipping
//                     quote (POST /orders/shipping.json) — nothing saved
//   createCheckout()  the same checks again, then a shopOrders doc
//                     (status "pending_payment") and a Stripe Checkout
//                     Session priced entirely from server data
// The order is only paid — and only sent to Printify — when Stripe's
// signed webhook says so (server/shop/stripeWebhook.js). Reaching the
// success page proves nothing.
//
// Prices come from a fresh Printify product read at this moment; the
// browser's prices are only compared, never used. A changed price or an
// unavailable variant returns 409 with the details so the cart can update.

const { FieldValue } = require("firebase-admin/firestore");
const { SITE_URL, userError, automaticTax } = require("./config");
const { fetchProductFresh } = require("./catalog");
const { validateAddress, toPrintifyAddress, validateCartItems, validEmail } = require("./validate");
const printify = require("./printify");
const { getStripe } = require("./stripe");
const { newOrderDoc, ORDERS } = require("./orders");

// Cart items → trusted line snapshots (what the order stores forever).
async function resolveCart(db, rawItems) {
  const items = validateCartItems(rawItems);
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = new Map(await Promise.all(ids.map(async (id) => [id, await fetchProductFresh(db, id)])));
  const problems = [];
  const lines = [];
  for (const it of items) {
    const p = products.get(it.productId);
    const v = p?.variants.find((x) => x.key === it.variantKey);
    if (!p || p.hidden || !v) { problems.push({ productId: it.productId, variantKey: it.variantKey, code: "unavailable" }); continue; }
    if (!v.available) { problems.push({ productId: it.productId, variantKey: it.variantKey, code: "out_of_stock" }); continue; }
    if (it.expectedPriceCents !== null && it.expectedPriceCents !== v.priceCents) {
      problems.push({ productId: it.productId, variantKey: it.variantKey, code: "price_changed", priceCents: v.priceCents });
      continue;
    }
    const selected = {};
    p.options.forEach((o, i) => {
      const val = o.values.find((x) => x.id === v.optionValueIds[i]);
      if (val) selected[o.name] = val.title;
    });
    const image = p.images.find((im) => im.variantKeys.includes(v.key) && im.isDefault)?.src
      || p.images.find((im) => im.variantKeys.includes(v.key))?.src || p.images[0]?.src || null;
    lines.push({
      productId: p.id,
      variantKey: v.key,
      title: p.title,
      variantTitle: v.title,
      options: selected,
      image,
      quantity: it.quantity,
      unitPriceCents: v.priceCents,
      lineTotalCents: v.priceCents * it.quantity,
      fulfillment: v.fulfillment,
    });
  }
  if (problems.length) {
    throw userError(409, problems.some((p) => p.code === "price_changed")
      ? "Some prices changed since you added them. Your cart has been updated."
      : "Some items in your cart are no longer available.", { problems });
  }
  return lines;
}

async function shippingQuote(lines, address) {
  let rates;
  try {
    rates = await printify.quoteShipping(
      lines.map((l) => ({ product_id: l.fulfillment.productId, variant_id: l.fulfillment.variantId, quantity: l.quantity })),
      toPrintifyAddress(address),
    );
  } catch (e) {
    if (e.printify && e.status >= 400 && e.status < 500) {
      throw userError(422, "We couldn't calculate shipping to that address. Please check it and try again.");
    }
    throw userError(503, "Shipping rates are temporarily unavailable. Please try again in a few minutes.");
  }
  const cents = Number(rates?.standard);
  if (!Number.isInteger(cents) || cents < 0) throw userError(422, "These items can't ship to that address.");
  return { method: "standard", printifyMethod: 1, cents };
}

function totals(lines, shipping) {
  const subtotalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
  return { subtotalCents, shippingCents: shipping.cents, totalCents: subtotalCents + shipping.cents };
}

function publicLine(l) {
  const { fulfillment, ...rest } = l;
  return rest;
}

async function quote(db, body) {
  const address = validateAddress(body?.address);
  const lines = await resolveCart(db, body?.items);
  const shipping = await shippingQuote(lines, address);
  return { lines: lines.map(publicLine), shippingMethod: shipping.method, ...totals(lines, shipping) };
}

async function createCheckout(db, body, user) {
  const address = validateAddress(body?.address);
  const email = validEmail(body?.email) || address.email;
  const lines = await resolveCart(db, body?.items);
  const shipping = await shippingQuote(lines, address);
  const t = totals(lines, shipping);
  // The quote the customer saw must still be the price they'll pay.
  if (Number.isInteger(body?.expectedTotalCents) && body.expectedTotalCents !== t.totalCents) {
    throw userError(409, "Your total changed (shipping or prices were updated). Please review it and try again.", { quote: { lines: lines.map(publicLine), ...t } });
  }

  const ref = db.collection(ORDERS).doc(); // random 20-char id — not guessable
  await ref.set(newOrderDoc({ id: ref.id, uid: user?.uid || null, email, lines, address, shipping, totals: t }));

  const stripe = getStripe();
  const stripeAddress = { line1: address.address1, line2: address.address2 || undefined, city: address.city, state: address.region, postal_code: address.zip, country: address.country };
  const shipTo = { name: `${address.firstName} ${address.lastName}`, phone: address.phone || undefined, address: stripeAddress };
  let session;
  try {
    // Stripe Tax on shipped goods taxes by the shipping address, which only
    // a Customer can carry into Checkout (we collect the address ourselves,
    // because the shipping price was quoted for it).
    const customer = automaticTax()
      ? (await stripe.customers.create({ email, name: shipTo.name, shipping: shipTo, metadata: { orderId: ref.id } }, { idempotencyKey: `wd-order-cust-${ref.id}` })).id
      : null;
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      ...(customer ? { customer, customer_update: { shipping: "never" } } : { customer_email: email }),
      client_reference_id: ref.id,
      line_items: lines.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: "usd",
          unit_amount: l.unitPriceCents,
          product_data: {
            name: l.title,
            description: [l.variantTitle].filter(Boolean).join(" ").slice(0, 300) || undefined,
            images: l.image ? [l.image] : undefined,
            metadata: { productId: l.productId, variantKey: l.variantKey },
          },
        },
      })),
      shipping_options: [{
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Standard shipping",
          fixed_amount: { amount: shipping.cents, currency: "usd" },
        },
      }],
      payment_intent_data: {
        metadata: { kind: "order", orderId: ref.id },
        ...(customer ? {} : { shipping: shipTo }),
      },
      metadata: { kind: "order", orderId: ref.id },
      automatic_tax: automaticTax() ? { enabled: true } : undefined,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // shipping quote is good for an hour
      success_url: `${SITE_URL}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/shop/cart`,
    }, { idempotencyKey: `wd-order-${ref.id}` });
  } catch (e) {
    await ref.update({ status: "checkout_failed", updatedAt: FieldValue.serverTimestamp(), lastError: String(e.message || e).slice(0, 300) });
    throw userError(502, "We couldn't start checkout. Please try again.");
  }
  await ref.update({ "stripe.sessionId": session.id, updatedAt: FieldValue.serverTimestamp() });
  return { url: session.url };
}

module.exports = { quote, createCheckout, resolveCart };
