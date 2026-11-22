// Profile → Store: links to /shop and /support (shown only here, to
// signed-in users — not in the public nav), the user's own merchandise
// orders, and their contributions with a way to manage a monthly one.
// Data: api/shop.js "myHistory" (server returns only this user's records).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import LoadingSpinner from "../LoadingSpinner";
import { BLUE, GOLD, NAVY, money, shopPost, FULFILLMENT_LABELS, ORDER_LABELS } from "../../utils/shop";

const BODY = "Arial, sans-serif";
const card = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)" };
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function Pill({ text, color }) {
  return <span style={{ display: "inline-block", padding: "3px 9px", borderRadius: 999, background: `${color}18`, color, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{text}</span>;
}

function OrderRow({ o, isMobile }) {
  const [open, setOpen] = useState(false);
  const refunded = o.status === "refunded" || o.status === "partially_refunded";
  const [label, color] = refunded ? [ORDER_LABELS[o.status], "#777"] : (FULFILLMENT_LABELS[o.fulfillmentStatus] || ["Processing", "#8a6d00"]);
  const items = o.lines.reduce((s, l) => s + l.quantity, 0);
  return (
    <div style={{ ...card, padding: isMobile ? 14 : 18, marginBottom: 12 }}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "inherit" }}>
        <div style={{ display: "flex", flexShrink: 0 }}>
          {o.lines.slice(0, 3).map((l, i) => (
            <div key={i} style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: "#f3f6fa", border: "2px solid #fff", marginLeft: i ? -14 : 0 }}>
              {l.image && <img src={l.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {o.lines[0]?.title}{o.lines.length > 1 ? ` + ${o.lines.length - 1} more` : ""}
          </div>
          <div style={{ fontSize: 12, color: "#667", fontFamily: BODY, marginTop: 2 }}>{fmtDate(o.createdAt)} · {items} item{items === 1 ? "" : "s"} · {money(o.totalCents)}</div>
        </div>
        <Pill text={label} color={color} />
        <span aria-hidden="true" style={{ color: "#99a", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef1f5", fontFamily: BODY, fontSize: 13 }}>
          {o.lines.map((l, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "4px 0" }}>
              <span><b>{l.title}</b> — {l.variantTitle} × {l.quantity}</span>
              <span style={{ whiteSpace: "nowrap" }}>{money(l.lineTotalCents)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#555" }}><span>Shipping</span><span>{money(o.shippingCents)}</span></div>
          {!!o.taxCents && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#555" }}><span>Tax</span><span>{money(o.taxCents)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", fontWeight: 900 }}><span>Total paid</span><span>{money(o.totalCents)}</span></div>
          {!!o.amountRefundedCents && <div style={{ color: "#777", marginTop: 4 }}>Refunded: {money(o.amountRefundedCents)}</div>}
          {o.shippingAddress && (
            <div style={{ marginTop: 10, color: "#444", lineHeight: 1.45 }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", color: "#667", fontFamily: "inherit" }}>SHIPPING TO</div>
              {o.shippingAddress.name}<br />{o.shippingAddress.address1}{o.shippingAddress.address2 ? `, ${o.shippingAddress.address2}` : ""}<br />
              {o.shippingAddress.city}, {o.shippingAddress.region} {o.shippingAddress.zip}
            </div>
          )}
          {o.shipments?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", color: "#667" }}>TRACKING</div>
              {o.shipments.map((s, i) => (
                <div key={i} style={{ marginTop: 4 }}>
                  {(s.carrier || "Carrier").toUpperCase()} · {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 700 }}>{s.number || "Track package"}</a> : s.number}
                  {s.deliveredAt && <span style={{ color: "#1e7d32", fontWeight: 700 }}> · Delivered</span>}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: "#99a" }}>Order {o.orderId.slice(0, 8).toUpperCase()}</div>
        </div>
      )}
    </div>
  );
}

export default function StoreTab({ isMobile }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    let live = true;
    shopPost("myHistory").then((r) => live && setData(r)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, []);

  const openPortal = async () => {
    setPortalBusy(true);
    try { window.location.assign((await shopPost("billingPortal")).url); }
    catch (e) { setErr(e.message); setPortalBusy(false); }
  };

  const monthly = (data?.contributions || []).filter((c) => c.recurring && ["active", "past_due"].includes(c.status));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14 }}>
        {[
          { to: "/shop", icon: "🛍️", title: "We-Draft.com Shop", blurb: "Official We-Draft.com gear, printed to order and shipped to you.", cta: "Visit the shop" },
          { to: "/support", icon: "💛", title: "Support We-Draft.com", blurb: "Chip in once or monthly to help keep the site free for everyone.", cta: "Support the site" },
        ].map((b) => (
          <Link key={b.to} to={b.to} style={{ ...card, display: "flex", flexDirection: "column", gap: 8, padding: isMobile ? 16 : 20, textDecoration: "none", color: "#0f1b2d" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 26 }} aria-hidden="true">{b.icon}</span>
              <span style={{ fontSize: 17, fontWeight: 900 }}>{b.title}</span>
            </div>
            <div style={{ fontSize: 13, color: "#555", fontFamily: BODY, lineHeight: 1.45, flex: 1 }}>{b.blurb}</div>
            <div style={{ color: BLUE, fontSize: 13, fontWeight: 900 }}>{b.cta} →</div>
          </Link>
        ))}
      </div>

      <div style={{ color: GOLD, fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", margin: "26px 0 10px" }}>MY ORDERS</div>
      {err && <div role="alert" style={{ ...card, padding: 14, color: "#b3261e", fontFamily: BODY, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{err}</div>}
      {!data && !err && <LoadingSpinner size={28} minHeight="16vh" />}
      {data && !data.orders.length && (
        <div style={{ ...card, padding: 18, fontFamily: BODY, fontSize: 13, color: "#555" }}>
          No orders yet. Orders you place while signed in show up here.
        </div>
      )}
      {data?.orders.map((o) => <OrderRow key={o.orderId} o={o} isMobile={isMobile} />)}

      {data && data.contributions.length > 0 && (
        <>
          <div style={{ color: GOLD, fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", margin: "26px 0 10px" }}>MY CONTRIBUTIONS</div>
          <div style={{ ...card, padding: isMobile ? 14 : 18 }}>
            {data.contributions.map((c) => (
              <div key={c.contributionId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #eef1f5", fontFamily: BODY, fontSize: 13 }}>
                <div style={{ flex: 1 }}>
                  <b style={{ color: NAVY }}>{money(c.amountCents)}{c.recurring ? " / month" : ""}</b>
                  <span style={{ color: "#667" }}> · since {fmtDate(c.createdAt)}{c.recurring && c.paymentsCount ? ` · ${c.paymentsCount} payment${c.paymentsCount === 1 ? "" : "s"}` : ""}</span>
                </div>
                <Pill
                  text={c.cancelAtPeriodEnd ? "Ends this period" : { paid: "Thank you", active: "Active", past_due: "Payment issue", canceled: "Canceled", refunded: "Refunded", paused: "Paused" }[c.status] || c.status}
                  color={c.status === "past_due" ? "#b3261e" : ["canceled", "refunded"].includes(c.status) ? "#777" : "#1e7d32"} />
              </div>
            ))}
            {monthly.length > 0 && (
              <button onClick={openPortal} disabled={portalBusy} style={{ marginTop: 12, padding: "10px 16px", borderRadius: 8, border: `2px solid ${BLUE}`, background: "#fff", color: BLUE, fontWeight: 900, fontSize: 12, letterSpacing: "0.08em", cursor: "pointer", fontFamily: "inherit" }}>
                {portalBusy ? "OPENING…" : "MANAGE OR CANCEL MONTHLY SUPPORT"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
