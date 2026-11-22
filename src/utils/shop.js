// src/utils/shop.js — the store's browser side: API calls (api/shop.js),
// the cart, and display helpers. Prices here are for display only — the
// server re-prices everything from Printify before checkout.

import { useEffect, useState } from "react";
import { auth } from "../firebase";

export const BLUE = "#0055a5";
export const GOLD = "#f6a21d";
export const NAVY = "#0b2545";

export const money = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: (cents % 100) ? 2 : 2 });

async function authHeader() {
  try {
    const t = await auth.currentUser?.getIdToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}

export class ShopError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}

async function handle(r) {
  let data = {};
  let isJson = false;
  try { data = await r.json(); isJson = true; } catch { /* empty */ }
  // No JSON back at all = the API itself isn't there (e.g. `npm start`
  // serves only the React app; /api/* runs on Vercel or `vercel dev`).
  if (!r.ok && !isJson && r.status === 404) {
    throw new ShopError("The store API isn't reachable from this server. /api routes only run on Vercel (or `vercel dev`), not `npm start`.", r.status, data);
  }
  if (!r.ok) throw new ShopError(data.error || "Something went wrong. Please try again.", r.status, data);
  return data;
}

export async function shopGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params });
  return handle(await fetch(`/api/shop?${qs}`));
}

export async function shopPost(action, body = {}) {
  return handle(await fetch("/api/shop", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action, ...body }),
  }));
}

export async function shopAdmin(action, body = {}) {
  return handle(await fetch("/api/shop-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ action, ...body }),
  }));
}

// ── Cart ─────────────────────────────────────────────────────────────
// [{ productId, variantKey, quantity, priceCents, title, variantTitle, image }]
// Lives in this browser only (localStorage), like any shop cart; it can
// vanish in a private window and the page still works.
const CART_KEY = "wd-shop-cart-v1";
const listeners = new Set();

function readCart() {
  try {
    const v = JSON.parse(window.localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => x && x.productId && x.variantKey && x.quantity > 0) : [];
  } catch { return []; }
}
let cartState = typeof window !== "undefined" ? readCart() : [];

function writeCart(next) {
  cartState = next;
  try { window.localStorage.setItem(CART_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(next));
}

export const cart = {
  get: () => cartState,
  add(item, qty = 1) {
    const i = cartState.findIndex((x) => x.productId === item.productId && x.variantKey === item.variantKey);
    if (i >= 0) {
      const next = [...cartState];
      next[i] = { ...next[i], ...item, quantity: Math.min(10, next[i].quantity + qty) };
      writeCart(next);
    } else writeCart([...cartState, { ...item, quantity: Math.min(10, qty) }]);
  },
  setQty(productId, variantKey, quantity) {
    writeCart(cartState.map((x) => (x.productId === productId && x.variantKey === variantKey ? { ...x, quantity } : x)).filter((x) => x.quantity > 0));
  },
  remove(productId, variantKey) { writeCart(cartState.filter((x) => !(x.productId === productId && x.variantKey === variantKey))); },
  update(fn) { writeCart(fn(cartState)); },
  clear() { writeCart([]); },
};

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { cartState = readCart(); listeners.forEach((fn) => fn(cartState)); } });
}

export function useCart() {
  const [items, setItems] = useState(cartState);
  useEffect(() => { listeners.add(setItems); return () => listeners.delete(setItems); }, []);
  return items;
}

export const cartCount = (items) => items.reduce((s, x) => s + x.quantity, 0);

// ── Labels ───────────────────────────────────────────────────────────
export const FULFILLMENT_LABELS = {
  not_started: ["Processing", "#8a6d00"],
  creating: ["Processing", "#8a6d00"],
  error: ["Processing", "#8a6d00"],
  on_hold: ["Preparing", "#8a6d00"],
  submitting: ["Preparing", "#8a6d00"],
  submitted: ["In production", BLUE],
  in_production: ["In production", BLUE],
  partially_shipped: ["Partially shipped", BLUE],
  fulfilled: ["Shipped", "#1e7d32"],
  canceled: ["Canceled", "#777"],
  needs_attention: ["Delayed — we're on it", "#b3261e"],
};
export const ORDER_LABELS = {
  paid: "Paid", refunded: "Refunded", partially_refunded: "Partially refunded",
  pending_payment: "Awaiting payment", expired: "Checkout expired", payment_failed: "Payment failed", checkout_failed: "Checkout failed",
};

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
  ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
  ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];
