// src/pages/Shop.jsx — the We-Draft.com store.
//   /shop            product grid
//   /shop/cart       cart, shipping address, Printify shipping quote, checkout
//   /shop/success    after Stripe Checkout (?session_id=…)
//   /shop/:slug      one product (variant picker)
// Public (anyone with the link can buy), linked only from signed-in
// profiles (Profile → Store), noindex. API: api/shop.js; prices shown here
// are re-checked on the server before Stripe is ever involved.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "../components/LoadingSpinner";
import {
  BLUE, GOLD, NAVY, money, shopGet, shopPost, cart, useCart, cartCount, US_STATES, FULFILLMENT_LABELS,
} from "../utils/shop";

const FONT = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
const card = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)" };

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const on = () => setM(window.innerWidth < 640);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return m;
}

// One catalog request per visit, shared by the grid and product pages.
let catalogPromise = null;
function loadCatalog(force = false) {
  if (!catalogPromise || force) {
    catalogPromise = shopGet("catalog").catch((e) => { catalogPromise = null; throw e; });
  }
  return catalogPromise;
}
function useCatalog() {
  const [state, setState] = useState({ loading: true, error: null, products: [] });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    loadCatalog(n > 0)
      .then((r) => live && setState({ loading: false, error: null, products: r.products || [] }))
      .catch((e) => live && setState({ loading: false, error: e.message, products: [] }));
    return () => { live = false; };
  }, [n]);
  return { ...state, retry: () => { setState((s) => ({ ...s, loading: true })); setN((x) => x + 1); } };
}

function Shell({ title, children, isMobile, back }) {
  const items = useCart();
  const count = cartCount(items);
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: isMobile ? "12px 16px 60px" : "24px 20px 60px", fontFamily: FONT, color: "#0f1b2d" }}>
      <Helmet>
        <title>{title ? `${title} | We-Draft.com Shop` : "Shop | We-Draft.com"}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 18, background: "linear-gradient(120deg, #062a55 0%, #0055a5 70%, #1f74c8 100%)", color: "#fff", padding: isMobile ? "16px 16px" : "20px 26px", boxShadow: "0 10px 30px rgba(0,40,90,.18)", display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" style={{ position: "absolute", right: -10, top: 0, font: "italic 900 80px/1 Arial, sans-serif", color: "rgba(255,255,255,.06)", pointerEvents: "none", whiteSpace: "nowrap" }}>We-Draft.com</span>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          {back && <Link to={back[0]} style={{ color: "rgba(255,255,255,.8)", fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", textDecoration: "none" }}>← {back[1]}</Link>}
          <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.1 }}>We-Draft.com Shop</div>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,.75)", fontFamily: BODY }}>Official gear. Every order helps keep the scouting free.</div>
        </div>
        <Link to="/shop/cart" style={{ position: "relative", flexShrink: 0, background: GOLD, color: NAVY, borderRadius: 999, padding: "9px 16px", fontWeight: 900, fontSize: 12, letterSpacing: "0.08em", textDecoration: "none", whiteSpace: "nowrap" }}>
          CART{count ? ` (${count})` : ""}
        </Link>
      </div>
      <div style={{ marginTop: 22 }}>{children}</div>
    </div>
  );
}

function StateBox({ title, text, action }) {
  return (
    <div style={{ ...card, padding: "36px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: NAVY }}>{title}</div>
      {text && <div style={{ marginTop: 8, fontSize: 14, color: "#555", fontFamily: BODY, lineHeight: 1.5 }}>{text}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

const btn = (variant = "primary", extra = {}) => ({
  display: "inline-block", borderRadius: 8, padding: "12px 20px", fontWeight: 900, fontSize: 14, letterSpacing: "0.08em",
  textTransform: "uppercase", cursor: "pointer", textDecoration: "none", fontFamily: FONT, textAlign: "center",
  border: `2px solid ${variant === "primary" ? BLUE : variant === "gold" ? GOLD : BLUE}`,
  background: variant === "primary" ? BLUE : variant === "gold" ? GOLD : "#fff",
  color: variant === "primary" ? "#fff" : variant === "gold" ? NAVY : BLUE,
  ...extra,
});

// ── Grid ─────────────────────────────────────────────────────────────
function ShopGrid({ isMobile }) {
  const { loading, error, products, retry } = useCatalog();
  if (loading) return <LoadingSpinner size={36} minHeight="40vh" />;
  if (error) return <StateBox title="The shop didn't load" text={error} action={<button onClick={retry} style={btn()}>Try again</button>} />;
  if (!products.length) return <StateBox title="Nothing here yet" text="New We-Draft.com gear is on the way. Check back soon." />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 230}px, 1fr))`, gap: isMobile ? 12 : 18 }}>
      {products.map((p) => {
        const img = p.images.find((i) => i.isDefault)?.src || p.images[0]?.src;
        return (
          <Link key={p.id} to={`/shop/${p.id}`} style={{ ...card, overflow: "hidden", textDecoration: "none", color: "#0f1b2d", display: "flex", flexDirection: "column" }}>
            <div style={{ position: "relative", aspectRatio: "1 / 1", background: "#f3f6fa" }}>
              {img && <img src={img} alt={p.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
              {p.featured && <span style={{ position: "absolute", top: 8, left: 8, background: GOLD, color: NAVY, fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", padding: "4px 8px", borderRadius: 999 }}>FEATURED</span>}
              {!p.available && <span style={{ position: "absolute", top: 8, right: 8, background: "#333", color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", padding: "4px 8px", borderRadius: 999 }}>SOLD OUT</span>}
            </div>
            <div style={{ padding: isMobile ? "10px 12px 12px" : "12px 14px 14px", display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 900, lineHeight: 1.25 }}>{p.title}</div>
              <div style={{ marginTop: "auto", color: BLUE, fontSize: 14, fontWeight: 900 }}>
                {p.variants.some((v) => v.priceCents !== p.priceFromCents) ? "From " : ""}{money(p.priceFromCents)}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── Product ──────────────────────────────────────────────────────────
function variantMatches(v, sel) {
  return Object.entries(sel).every(([i, id]) => v.optionValueIds[Number(i)] === id);
}

function ProductView({ id, isMobile }) {
  const { loading, error, products, retry } = useCatalog();
  const product = products.find((p) => p.id === id);
  const [sel, setSel] = useState(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);

  useEffect(() => {
    if (!product) return;
    const start = product.variants.find((v) => v.isDefault && v.available) || product.variants.find((v) => v.available) || product.variants[0];
    if (start) setSel(Object.fromEntries(start.optionValueIds.map((vid, i) => [i, vid])));
  }, [product]);

  const variant = useMemo(() => (product && sel ? product.variants.find((v) => variantMatches(v, sel)) : null), [product, sel]);
  const images = useMemo(() => {
    if (!product) return [];
    const forVariant = variant ? product.images.filter((im) => im.variantKeys.includes(variant.key)) : [];
    return forVariant.length ? forVariant : product.images;
  }, [product, variant]);
  useEffect(() => { setImgIdx(0); }, [variant?.key]);

  if (loading) return <LoadingSpinner size={36} minHeight="40vh" />;
  if (error) return <StateBox title="This product didn't load" text={error} action={<button onClick={retry} style={btn()}>Try again</button>} />;
  if (!product) return <StateBox title="Product not found" text="It may have sold out or been removed." action={<Link to="/shop" style={btn()}>Back to the shop</Link>} />;

  const pick = (optIdx, valueId) => {
    const next = { ...sel, [optIdx]: valueId };
    if (product.variants.some((v) => v.available && variantMatches(v, next))) return setSel(next);
    // That combination doesn't exist / is sold out: keep the new choice and
    // move the other options to the nearest available variant.
    const alt = product.variants.find((v) => v.available && v.optionValueIds[optIdx] === valueId)
      || product.variants.find((v) => v.optionValueIds[optIdx] === valueId);
    if (alt) setSel(Object.fromEntries(alt.optionValueIds.map((vid, i) => [i, vid])));
  };
  const valueState = (optIdx, valueId) => {
    const next = { ...sel, [optIdx]: valueId };
    return product.variants.some((v) => v.available && variantMatches(v, next)) ? "ok"
      : product.variants.some((v) => v.available && v.optionValueIds[optIdx] === valueId) ? "other" : "none";
  };

  const add = () => {
    if (!variant?.available) return;
    const img = images[0]?.src || product.images[0]?.src || null;
    cart.add({ productId: product.id, variantKey: variant.key, priceCents: variant.priceCents, title: product.title, variantTitle: variant.title, image: img }, qty);
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  };

  const main = images[imgIdx]?.src || images[0]?.src;
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.1fr) minmax(0, 1fr)", gap: isMobile ? 16 : 28, alignItems: "start" }}>
      <div>
        <div style={{ ...card, overflow: "hidden", aspectRatio: "1 / 1", background: "#f3f6fa" }}>
          {main && <img src={main} alt={product.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        </div>
        {images.length > 1 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
            {images.slice(0, 12).map((im, i) => (
              <button key={im.src} onClick={() => setImgIdx(i)} aria-label={`Image ${i + 1}`} style={{ flexShrink: 0, width: 64, height: 64, padding: 0, borderRadius: 8, overflow: "hidden", cursor: "pointer", border: `2px solid ${i === imgIdx ? BLUE : "#e6ebf2"}`, background: "#f3f6fa" }}>
                <img src={im.src} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...card, padding: isMobile ? 16 : 24 }}>
        <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 28, fontWeight: 900, lineHeight: 1.15, color: NAVY }}>{product.title}</h1>
        <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900, color: BLUE }}>{money(variant?.priceCents ?? product.priceFromCents)}</div>

        {product.options.map((o, oi) => (
          <div key={o.name} style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", color: "#667", textTransform: "uppercase" }}>
              {o.name}{sel && o.values.find((v) => v.id === sel[oi]) ? `: ${o.values.find((v) => v.id === sel[oi]).title}` : ""}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {o.values.map((v) => {
                const on = sel?.[oi] === v.id;
                const st = valueState(oi, v.id);
                const isColor = o.type === "color" && v.colors?.length;
                return (
                  <button key={v.id} onClick={() => pick(oi, v.id)} title={v.title + (st === "none" ? " (sold out)" : "")} aria-pressed={on}
                    style={isColor ? {
                      width: 34, height: 34, borderRadius: "50%", cursor: "pointer", padding: 0, background: v.colors[0],
                      border: `3px solid ${on ? BLUE : "#fff"}`, boxShadow: on ? `0 0 0 2px ${BLUE}` : "0 0 0 1px #cfd8e3",
                      opacity: st === "none" ? 0.35 : 1,
                    } : {
                      minWidth: 46, padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 900,
                      border: `2px solid ${on ? BLUE : "#cfd8e3"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : NAVY,
                      opacity: st === "none" ? 0.4 : 1, textDecoration: st === "none" ? "line-through" : "none",
                    }}>
                    {isColor ? <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{v.title}</span> : v.title}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
          <QtyStepper value={qty} onChange={setQty} />
          <button onClick={add} disabled={!variant?.available} style={btn("primary", { flex: 1, minWidth: 180, opacity: variant?.available ? 1 : 0.5, cursor: variant?.available ? "pointer" : "not-allowed" })}>
            {!variant ? "Choose options" : variant.available ? "Add to cart" : "Sold out"}
          </button>
        </div>
        {added && (
          <div role="status" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#eef6ff", color: BLUE, fontSize: 13, fontWeight: 900, display: "flex", justifyContent: "space-between", gap: 10 }}>
            Added to your cart. <Link to="/shop/cart" style={{ color: BLUE }}>View cart →</Link>
          </div>
        )}
        {product.description && (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #eef1f5", fontFamily: BODY, fontSize: 14, color: "#333", lineHeight: 1.6, whiteSpace: "pre-line" }}>
            {product.description}
          </div>
        )}
      </div>
    </div>
  );
}

function QtyStepper({ value, onChange, max = 10 }) {
  const b = { width: 34, height: 38, border: "none", background: "#f3f6fa", color: NAVY, fontSize: 18, fontWeight: 900, cursor: "pointer" };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", border: "2px solid #cfd8e3", borderRadius: 8, overflow: "hidden" }}>
      <button onClick={() => onChange(Math.max(1, value - 1))} aria-label="Decrease quantity" style={b}>−</button>
      <span style={{ minWidth: 34, textAlign: "center", fontWeight: 900, fontSize: 14 }}>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase quantity" style={b}>+</button>
    </div>
  );
}

// ── Cart + checkout ──────────────────────────────────────────────────
const ADDRESS_KEY = "wd-shop-address-v1";
const EMPTY_ADDRESS = { firstName: "", lastName: "", email: "", phone: "", country: "US", region: "", address1: "", address2: "", city: "", zip: "" };

function CartView({ isMobile }) {
  const items = useCart();
  const { user } = useAuth();
  const [address, setAddress] = useState(() => {
    try { return { ...EMPTY_ADDRESS, ...JSON.parse(window.localStorage.getItem(ADDRESS_KEY) || "{}") }; } catch { return EMPTY_ADDRESS; }
  });
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(null); // "quote" | "checkout"
  const [msg, setMsg] = useState(null);   // { text, field? }

  useEffect(() => { if (user?.email && !address.email) setAddress((a) => ({ ...a, email: user.email })); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQuote(null); }, [items, address]);
  useEffect(() => {
    try { window.localStorage.setItem(ADDRESS_KEY, JSON.stringify({ ...address })); } catch { /* ignore */ }
  }, [address]);

  const payloadItems = items.map(({ productId, variantKey, quantity, priceCents }) => ({ productId, variantKey, quantity, priceCents }));
  const subtotal = items.reduce((s, x) => s + x.priceCents * x.quantity, 0);

  // A 409 from the server: fix the cart from its answer.
  const applyProblems = (problems = []) => {
    cart.update((list) => list.map((x) => {
      const p = problems.find((q) => q.productId === x.productId && q.variantKey === x.variantKey);
      if (!p) return x;
      if (p.code === "price_changed") return { ...x, priceCents: p.priceCents };
      return { ...x, flag: p.code === "out_of_stock" ? "Sold out — please remove" : "No longer available — please remove" };
    }));
  };

  const run = async (kind) => {
    setMsg(null);
    setBusy(kind);
    try {
      if (kind === "quote") {
        setQuote(await shopPost("quote", { items: payloadItems, address }));
      } else {
        const r = await shopPost("checkout", { items: payloadItems, address, email: address.email, expectedTotalCents: quote?.totalCents });
        window.location.assign(r.url);
        return; // keep the button busy while Stripe loads
      }
    } catch (e) {
      if (e.status === 409 && e.data.problems) applyProblems(e.data.problems);
      if (e.status === 409 && e.data.quote) setQuote(e.data.quote);
      setMsg({ text: e.message, field: e.data.field });
    }
    setBusy(null);
  };

  if (!items.length) {
    return <StateBox title="Your cart is empty" text="Find something you like in the shop." action={<Link to="/shop" style={btn()}>Browse the shop</Link>} />;
  }

  const hasFlags = items.some((x) => x.flag);
  const field = (name, label, props = {}) => (
    <label style={{ display: "block", flex: props.flex || "1 1 100%", minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", color: msg?.field === name ? "#b3261e" : "#667", textTransform: "uppercase", marginBottom: 4 }}>{label}</span>
      {props.children || (
        <input value={address[name]} onChange={(e) => setAddress((a) => ({ ...a, [name]: e.target.value }))} autoComplete={props.autoComplete} inputMode={props.inputMode} type={props.type || "text"}
          style={{ width: "100%", boxSizing: "border-box", border: `2px solid ${msg?.field === name ? "#b3261e" : "#cfd8e3"}`, borderRadius: 8, padding: "10px 12px", fontSize: 16, fontFamily: BODY, outline: "none" }} />
      )}
    </label>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.2fr) minmax(0, 1fr)", gap: isMobile ? 16 : 24, alignItems: "start" }}>
      <div style={{ ...card, padding: isMobile ? 14 : 20 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", color: GOLD, marginBottom: 10 }}>YOUR CART</div>
        {items.map((x) => (
          <div key={`${x.productId}:${x.variantKey}`} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: "1px solid #eef1f5", alignItems: "center" }}>
            <Link to={`/shop/${x.productId}`} style={{ flexShrink: 0 }}>
              <div style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", background: "#f3f6fa" }}>
                {x.image && <img src={x.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 900, lineHeight: 1.2 }}>{x.title}</div>
              <div style={{ fontSize: 12, color: "#667", fontFamily: BODY, marginTop: 2 }}>{x.variantTitle}</div>
              {x.flag && <div style={{ fontSize: 12, fontWeight: 900, color: "#b3261e", marginTop: 4 }}>{x.flag}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <QtyStepper value={x.quantity} onChange={(q) => cart.setQty(x.productId, x.variantKey, q)} />
                <button onClick={() => cart.remove(x.productId, x.variantKey)} style={{ background: "none", border: "none", color: "#b3261e", fontSize: 12, fontWeight: 900, cursor: "pointer", padding: 0, fontFamily: FONT }}>Remove</button>
              </div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 900, color: NAVY, whiteSpace: "nowrap" }}>{money(x.priceCents * x.quantity)}</div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid #eef1f5", fontWeight: 900 }}>
          <span>Subtotal</span><span>{money(subtotal)}</span>
        </div>
        <Link to="/shop" style={{ display: "inline-block", marginTop: 14, color: BLUE, fontSize: 13, fontWeight: 900, textDecoration: "none" }}>← Keep shopping</Link>
      </div>

      <div style={{ ...card, padding: isMobile ? 14 : 20 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", color: GOLD, marginBottom: 12 }}>SHIP TO</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {field("firstName", "First name", { flex: "1 1 140px", autoComplete: "given-name" })}
          {field("lastName", "Last name", { flex: "1 1 140px", autoComplete: "family-name" })}
          {field("email", "Email (for your receipt)", { type: "email", autoComplete: "email", inputMode: "email" })}
          {field("address1", "Street address", { autoComplete: "address-line1" })}
          {field("address2", "Apt, suite (optional)", { autoComplete: "address-line2" })}
          {field("city", "City", { flex: "1 1 160px", autoComplete: "address-level2" })}
          {field("region", "State", {
            flex: "1 1 120px",
            children: (
              <select value={address.region} onChange={(e) => setAddress((a) => ({ ...a, region: e.target.value }))} autoComplete="address-level1"
                style={{ width: "100%", boxSizing: "border-box", border: `2px solid ${msg?.field === "region" ? "#b3261e" : "#cfd8e3"}`, borderRadius: 8, padding: "10px 8px", fontSize: 16, fontFamily: BODY, background: "#fff" }}>
                <option value="">Choose…</option>
                {US_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            ),
          })}
          {field("zip", "ZIP", { flex: "1 1 100px", autoComplete: "postal-code", inputMode: "numeric" })}
          {field("phone", "Phone (optional, for delivery issues)", { type: "tel", autoComplete: "tel", inputMode: "tel" })}
        </div>
        <div style={{ fontSize: 12, color: "#667", fontFamily: BODY, marginTop: 8 }}>We currently ship within the United States.</div>

        {quote && (
          <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: "#f6f9fd", border: "1px solid #e1e9f3", fontSize: 14 }}>
            <Row label="Subtotal" value={money(quote.subtotalCents)} />
            <Row label="Shipping (standard)" value={money(quote.shippingCents)} />
            <div style={{ fontSize: 11, color: "#667", fontFamily: BODY, margin: "2px 0 6px" }}>Any sales tax is shown at checkout.</div>
            <Row label="Total" value={money(quote.totalCents)} strong />
          </div>
        )}
        {msg && <div role="alert" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#fdecea", color: "#b3261e", fontSize: 13, fontWeight: 900, fontFamily: BODY }}>{msg.text}</div>}

        <div style={{ marginTop: 16 }}>
          {!quote ? (
            <button onClick={() => run("quote")} disabled={!!busy || hasFlags} style={btn("primary", { width: "100%", opacity: busy || hasFlags ? 0.6 : 1 })}>
              {busy === "quote" ? "Calculating…" : "Calculate shipping"}
            </button>
          ) : (
            <button onClick={() => run("checkout")} disabled={!!busy || hasFlags} style={btn("gold", { width: "100%", opacity: busy || hasFlags ? 0.6 : 1 })}>
              {busy === "checkout" ? "Opening secure checkout…" : `Checkout · ${money(quote.totalCents)}`}
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#667", fontFamily: BODY, textAlign: "center" }}>
          Payment is handled securely by Stripe. We never see your card details.
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: strong ? 900 : 700, fontSize: strong ? 16 : 14, padding: "3px 0", fontFamily: strong ? FONT : BODY }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

// ── Success ──────────────────────────────────────────────────────────
// Stripe sends the buyer here, but only Stripe's webhook marks the order
// paid — so this waits for that, polling a few times.
function SuccessView() {
  const [params] = useSearchParams();
  const sid = params.get("session_id") || "";
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let live = true;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      try {
        const r = await shopGet("receipt", { session_id: sid });
        if (!live) return;
        if (r.kind === "order") cart.clear();
        if (r.status === "pending_payment" && tries < 10) { setState({ loading: false, r, waiting: true }); setTimeout(tick, 2500); return; }
        setState({ loading: false, r });
      } catch (e) {
        if (!live) return;
        if (e.status === 404 && tries < 6) { setTimeout(tick, 2500); return; }
        setState({ loading: false, error: e.message });
      }
    };
    if (sid) tick(); else setState({ loading: false, error: "Missing order reference." });
    return () => { live = false; };
  }, [sid]);

  if (state.loading) return <LoadingSpinner size={36} minHeight="40vh" />;
  if (state.error) return <StateBox title="We couldn't find that order" text="If you were charged, you'll get a receipt by email from Stripe. Questions? Contact us from your profile's Settings tab." action={<Link to="/shop" style={btn()}>Back to the shop</Link>} />;
  const r = state.r;
  const paid = r.status === "paid";
  return (
    <div style={{ ...card, padding: "28px 20px", maxWidth: 620, margin: "0 auto" }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", color: GOLD }}>{paid ? "ORDER CONFIRMED" : "ORDER RECEIVED"}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: NAVY, marginTop: 6 }}>{paid ? "Thanks for supporting We-Draft.com!" : "Confirming your payment…"}</div>
      <div style={{ marginTop: 8, fontSize: 14, color: "#444", fontFamily: BODY, lineHeight: 1.5 }}>
        {paid
          ? <>Your order is being prepared. A receipt is on its way to {r.email || "your email"}, and you'll get tracking once it ships.</>
          : <>This usually takes a few seconds. You can safely leave this page — you'll get an email from Stripe once payment is confirmed.</>}
      </div>
      <div style={{ marginTop: 16 }}>
        {(r.lines || []).map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid #eef1f5" }}>
            <div style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "#f3f6fa", flexShrink: 0 }}>{l.image && <img src={l.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 900 }}>{l.title}<div style={{ fontWeight: 400, color: "#667", fontFamily: BODY }}>{l.variantTitle} × {l.quantity}</div></div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid #eef1f5", fontWeight: 900 }}><span>Total</span><span>{money(r.totalCents)}</span></div>
      </div>
      {paid && r.fulfillmentStatus && <div style={{ marginTop: 10, fontSize: 12, color: "#667", fontFamily: BODY }}>Status: {(FULFILLMENT_LABELS[r.fulfillmentStatus] || ["Processing"])[0]}</div>}
      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link to="/shop" style={btn("secondary")}>Keep shopping</Link>
        <Link to="/profile?tab=store" style={btn()}>My orders</Link>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "#667", fontFamily: BODY }}>Order history appears on your profile when you checked out while signed in.</div>
    </div>
  );
}

export default function Shop({ view = "grid" }) {
  const { slug } = useParams();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  useEffect(() => { window.scrollTo(0, 0); }, [view, slug]);
  useEffect(() => { if (view === "product" && slug && slug !== slug.toLowerCase()) navigate(`/shop/${slug.toLowerCase()}`, { replace: true }); }, [view, slug, navigate]);

  if (view === "cart") return <Shell title="Cart" isMobile={isMobile} back={["/shop", "Shop"]}><CartView isMobile={isMobile} /></Shell>;
  if (view === "success") return <Shell title="Order" isMobile={isMobile}><SuccessView /></Shell>;
  if (view === "product") return <Shell title="Product" isMobile={isMobile} back={["/shop", "All products"]}><ProductView id={(slug || "").toLowerCase()} isMobile={isMobile} /></Shell>;
  return <Shell isMobile={isMobile}><ShopGrid isMobile={isMobile} /></Shell>;
}
