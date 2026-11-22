// server/shop/catalog.js
//
// The storefront catalog: Printify's products joined with our small
// Firestore config. This is the only module that knows products come from
// Printify — everything else (checkout, orders, the React store) works with
// the normalized We-Draft product below, so a future admin-managed catalog
// can replace loadSourceProducts()/fetchSourceProduct() while Printify
// stays the fulfillment provider (each variant carries its own
// `fulfillment` mapping).
//
// Firestore: shopProducts/{productId}  — productId is our stable id (a slug
// chosen when the product was first imported; never renamed after that):
//   { source: "printify", printifyProductId, title (admin label only),
//     hidden, featured, sortOrder (number|null), createdAt, updatedAt }
// Product details, variants, prices and images are NOT copied — Printify
// stays the source of truth.
//
// Normalized product:
//   { id, title, description, featured, sortOrder, images[], options[],
//     variants[{ key, title, priceCents, available, optionValueIds[],
//                fulfillment: { provider: "printify", productId, variantId } }],
//     priceFromCents, available }
// A variant's `key` is the string Printify variant id — stable for that
// product; the display title and position are never used as identifiers.

const printify = require("./printify");
const { FieldValue } = require("firebase-admin/firestore");

const COLLECTION = "shopProducts";
const RESERVED_SLUGS = new Set(["cart", "success", "checkout", "orders", "p"]);

// ── Text ──────────────────────────────────────────────────────────────
// Printify descriptions are HTML; the store shows them as plain text.
function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(p|div|h\d)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "product";
}

// ── Printify → normalized ─────────────────────────────────────────────
function normalizePrintifyProduct(p, cfg) {
  const options = (p.options || []).map((o) => ({
    name: o.name, type: o.type,
    values: (o.values || []).map((v) => ({ id: v.id, title: v.title, colors: v.colors || [] })),
  }));
  const variants = (p.variants || [])
    .filter((v) => v.is_enabled !== false)
    .map((v) => ({
      key: String(v.id),
      title: v.title,
      priceCents: Number(v.price) || 0,
      available: v.is_available !== false,
      isDefault: !!v.is_default,
      optionValueIds: v.options || [],
      fulfillment: { provider: "printify", productId: String(p.id), variantId: Number(v.id) },
    }))
    .filter((v) => v.priceCents > 0);
  const enabledKeys = new Set(variants.map((v) => v.key));
  // Option values no enabled variant uses (Printify lists the blueprint's
  // full range) are dropped so the picker only offers real choices.
  options.forEach((o, i) => {
    const used = new Set(variants.map((v) => v.optionValueIds[i]));
    o.values = o.values.filter((v) => used.has(v.id));
  });
  const images = (p.images || [])
    .map((im) => ({
      src: im.src,
      variantKeys: (im.variant_ids || []).map(String).filter((k) => enabledKeys.has(k)),
      isDefault: !!im.is_default,
      position: im.position || "",
    }))
    .filter((im) => im.src);
  const avail = variants.filter((v) => v.available);
  return {
    id: cfg.id,
    title: p.title,
    description: htmlToText(p.description),
    featured: !!cfg.featured,
    sortOrder: Number.isFinite(cfg.sortOrder) ? cfg.sortOrder : null,
    hidden: !!cfg.hidden,
    options, variants, images,
    priceFromCents: (avail.length ? avail : variants).reduce((m, v) => Math.min(m, v.priceCents), Infinity) || 0,
    available: avail.length > 0,
  };
}

// What the browser gets: no fulfillment ids, no admin flags.
function publicProduct(p) {
  return {
    id: p.id, title: p.title, description: p.description, featured: p.featured,
    options: p.options, images: p.images, priceFromCents: p.priceFromCents, available: p.available,
    variants: p.variants.map(({ key, title, priceCents, available, optionValueIds, isDefault }) =>
      ({ key, title, priceCents, available, optionValueIds, isDefault })),
  };
}

function sortProducts(list) {
  return list.sort((a, b) =>
    (b.featured - a.featured)
    || ((a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9))
    || a.title.localeCompare(b.title));
}

// ── Config ────────────────────────────────────────────────────────────
async function loadConfigs(db) {
  const snap = await db.collection(COLLECTION).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Catalog (cached per warm function for a minute) ───────────────────
let cache = null; // { at, products }
const TTL_MS = 60 * 1000;

// Every configured product, hidden ones included (admin + checkout use the
// hidden flag; the public listing filters it).
async function loadCatalog(db, { fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.products;
  const [configs, source] = await Promise.all([loadConfigs(db), printify.listAllProducts()]);
  const byPid = new Map(source.map((p) => [String(p.id), p]));
  const products = sortProducts(configs
    .filter((c) => c.source === "printify" && byPid.has(String(c.printifyProductId)))
    .map((c) => normalizePrintifyProduct(byPid.get(String(c.printifyProductId)), c)));
  cache = { at: Date.now(), products };
  return products;
}

function clearCatalogCache() { cache = null; }

async function publicCatalog(db) {
  return (await loadCatalog(db)).filter((p) => !p.hidden && p.variants.length).map(publicProduct);
}

// One product straight from the source — never cached. Checkout prices
// come from here, not from the browser or the minute-old listing.
async function fetchProductFresh(db, productId) {
  const cfgDoc = await db.collection(COLLECTION).doc(String(productId)).get();
  if (!cfgDoc.exists) return null;
  const cfg = { id: cfgDoc.id, ...cfgDoc.data() };
  if (cfg.source !== "printify") return null;
  try {
    return normalizePrintifyProduct(await printify.getProduct(cfg.printifyProductId), cfg);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// ── Admin: import / settings ──────────────────────────────────────────
// Printify products alongside their config (or lack of one).
async function adminProductList(db) {
  const [configs, source] = await Promise.all([loadConfigs(db), printify.listAllProducts()]);
  const byPid = new Map(configs.map((c) => [String(c.printifyProductId), c]));
  const rows = source.map((p) => {
    const c = byPid.get(String(p.id));
    const enabled = (p.variants || []).filter((v) => v.is_enabled !== false);
    return {
      id: c?.id || null,
      printifyProductId: String(p.id),
      title: p.title,
      image: (p.images || []).find((i) => i.is_default)?.src || p.images?.[0]?.src || null,
      variantCount: enabled.length,
      availableCount: enabled.filter((v) => v.is_available !== false).length,
      priceRange: enabled.length ? [Math.min(...enabled.map((v) => v.price)), Math.max(...enabled.map((v) => v.price))] : null,
      imported: !!c,
      hidden: !!c?.hidden, featured: !!c?.featured,
      sortOrder: Number.isFinite(c?.sortOrder) ? c.sortOrder : null,
    };
  });
  // Config docs whose Printify product is gone (deleted in Printify).
  const live = new Set(source.map((p) => String(p.id)));
  const missing = configs.filter((c) => !live.has(String(c.printifyProductId)))
    .map((c) => ({ id: c.id, printifyProductId: String(c.printifyProductId), title: c.title, missing: true, imported: true, hidden: !!c.hidden, featured: !!c.featured }));
  return [...rows, ...missing];
}

// Give each Printify product without a config doc one, with a new stable id
// (shown in the store unless `hidden` is passed).
async function importProducts(db, { printifyProductIds = null, hidden = false } = {}) {
  const [configs, source] = await Promise.all([loadConfigs(db), printify.listAllProducts()]);
  const have = new Set(configs.map((c) => String(c.printifyProductId)));
  const taken = new Set(configs.map((c) => c.id));
  const want = source.filter((p) => !have.has(String(p.id))
    && (!printifyProductIds || printifyProductIds.includes(String(p.id))));
  const created = [];
  for (const p of want) {
    let base = slugify(p.title);
    if (RESERVED_SLUGS.has(base)) base += "-item";
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    await db.collection(COLLECTION).doc(id).create({
      source: "printify",
      printifyProductId: String(p.id),
      title: p.title,
      hidden: !!hidden,
      featured: false,
      sortOrder: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    taken.add(id);
    created.push({ id, title: p.title });
  }
  clearCatalogCache();
  return { created };
}

// Only the display flags are editable — never the Printify mapping.
async function updateProductSettings(db, id, patch) {
  const ref = db.collection(COLLECTION).doc(String(id));
  if (!(await ref.get()).exists) {
    const e = new Error("Unknown product"); e.status = 404; e.publicMessage = "Unknown product."; throw e;
  }
  const out = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof patch.hidden === "boolean") out.hidden = patch.hidden;
  if (typeof patch.featured === "boolean") out.featured = patch.featured;
  if (patch.sortOrder === null || patch.sortOrder === "") out.sortOrder = null;
  else if (patch.sortOrder !== undefined) {
    const n = Number(patch.sortOrder);
    if (!Number.isInteger(n) || n < -9999 || n > 9999) {
      const e = new Error("bad sortOrder"); e.status = 400; e.publicMessage = "Display order must be a whole number."; throw e;
    }
    out.sortOrder = n;
  }
  await ref.update(out);
  clearCatalogCache();
}

module.exports = {
  loadCatalog, publicCatalog, fetchProductFresh, publicProduct, clearCatalogCache,
  adminProductList, importProducts, updateProductSettings, htmlToText, normalizePrintifyProduct,
};
