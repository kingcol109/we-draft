// server/shop/validate.js — checks on everything the browser sends.

const { SHIP_COUNTRIES, LIMITS, userError } = require("./config");

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT "
  + "NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i;

function clean(v, max) {
  // eslint-disable-next-line no-control-regex
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function validEmail(v) {
  const e = clean(v, 254).toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

// → { firstName, lastName, email, phone, country, region, address1, address2, city, zip }
// Throws a 400 naming the first bad field.
function validateAddress(a) {
  if (!a || typeof a !== "object") throw userError(400, "Please enter a shipping address.");
  const out = {
    firstName: clean(a.firstName, 60),
    lastName: clean(a.lastName, 60),
    email: validEmail(a.email),
    phone: clean(a.phone, 30),
    country: clean(a.country, 2).toUpperCase(),
    region: clean(a.region, 40).toUpperCase(),
    address1: clean(a.address1, 100),
    address2: clean(a.address2, 100),
    city: clean(a.city, 60),
    zip: clean(a.zip, 12).toUpperCase(),
  };
  const bad = (field, msg) => { throw userError(400, msg, { field }); };
  if (!out.firstName) bad("firstName", "Please enter a first name.");
  if (!out.lastName) bad("lastName", "Please enter a last name.");
  if (!out.email) bad("email", "Please enter a valid email address.");
  if (out.phone && !/^[0-9+().\-\s]{7,30}$/.test(out.phone)) bad("phone", "Please enter a valid phone number.");
  if (!SHIP_COUNTRIES.includes(out.country)) bad("country", "We can only ship to the United States right now.");
  if (!out.address1) bad("address1", "Please enter a street address.");
  if (!out.city) bad("city", "Please enter a city.");
  if (out.country === "US") {
    if (!US_STATES.has(out.region)) bad("region", "Please choose a state.");
    if (!/^\d{5}(-\d{4})?$/.test(out.zip)) bad("zip", "Please enter a valid ZIP code.");
  } else if (!out.zip) bad("zip", "Please enter a postal code.");
  return out;
}

// Printify's address_to.
function toPrintifyAddress(a) {
  return {
    first_name: a.firstName, last_name: a.lastName, email: a.email,
    phone: a.phone || undefined, country: a.country, region: a.region || undefined,
    address1: a.address1, address2: a.address2 || undefined, city: a.city, zip: a.zip,
  };
}

// Cart items from the browser → [{ productId, variantKey, quantity, expectedPriceCents }],
// duplicate variants merged.
function validateCartItems(items) {
  if (!Array.isArray(items) || !items.length) throw userError(400, "Your cart is empty.");
  const merged = new Map();
  for (const it of items.slice(0, 100)) {
    const productId = clean(it?.productId, 80);
    const variantKey = clean(it?.variantKey, 40);
    const quantity = Number(it?.quantity);
    const expected = it?.priceCents == null ? null : Number(it.priceCents);
    if (!/^[a-z0-9-]{1,80}$/.test(productId) || !/^[0-9]{1,20}$/.test(variantKey)) throw userError(400, "Your cart has an item we don't recognize. Please remove it and try again.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > LIMITS.maxQtyPerLine) throw userError(400, `Quantities must be between 1 and ${LIMITS.maxQtyPerLine}.`);
    if (expected !== null && (!Number.isInteger(expected) || expected < 0)) throw userError(400, "Your cart is out of date. Please refresh the page.");
    const k = `${productId}:${variantKey}`;
    const prev = merged.get(k);
    merged.set(k, { productId, variantKey, quantity: (prev?.quantity || 0) + quantity, expectedPriceCents: expected ?? prev?.expectedPriceCents ?? null });
  }
  const lines = [...merged.values()];
  if (lines.length > LIMITS.maxLines) throw userError(400, `Carts are limited to ${LIMITS.maxLines} different items.`);
  if (lines.some((l) => l.quantity > LIMITS.maxQtyPerLine)) throw userError(400, `Quantities must be between 1 and ${LIMITS.maxQtyPerLine}.`);
  if (lines.reduce((s, l) => s + l.quantity, 0) > LIMITS.maxTotalQty) throw userError(400, `Orders are limited to ${LIMITS.maxTotalQty} items.`);
  return lines;
}

module.exports = { validateAddress, toPrintifyAddress, validateCartItems, validEmail, clean };
