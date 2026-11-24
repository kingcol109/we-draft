// Admin → Shop: merchandise orders, contributions, storefront product
// settings (hide / feature / display order — product details stay in
// Printify for now), and setup checks. Every action goes through
// api/shop-admin.js, which re-checks the admin role server-side.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BLUE, GOLD, NAVY, money, shopAdmin, FULFILLMENT_LABELS, ORDER_LABELS } from "../utils/shop";

const BODY = "Arial, sans-serif";
const card = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)" };
const TABS = [["orders", "Orders"], ["contributions", "Contributions"], ["products", "Products"], ["setup", "Setup"]];
const fmt = (ms) => (ms ? new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const smallBtn = (variant = "secondary", extra = {}) => ({
  padding: "7px 12px", borderRadius: 6, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", cursor: "pointer", fontFamily: "inherit",
  border: `2px solid ${variant === "danger" ? "#b3261e" : variant === "gold" ? GOLD : BLUE}`,
  background: variant === "primary" ? BLUE : variant === "gold" ? GOLD : "#fff",
  color: variant === "primary" ? "#fff" : variant === "danger" ? "#b3261e" : variant === "gold" ? NAVY : BLUE, ...extra,
});
const th = { textAlign: "left", padding: "8px 10px", fontSize: 11, letterSpacing: "0.08em", color: "#667", borderBottom: "2px solid #e6ebf2", whiteSpace: "nowrap" };
const td = { padding: "9px 10px", borderBottom: "1px solid #eef1f5", fontFamily: BODY, fontSize: 13, verticalAlign: "top" };

function Pill({ text, color }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: `${color}18`, color, fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }}>{text}</span>;
}
const fulfillPill = (s) => {
  const internal = { error: ["Create failed", "#b3261e"], on_hold: ["Awaiting approval", "#8a6d00"], needs_attention: ["Needs attention", "#b3261e"], creating: ["Creating…", "#8a6d00"], not_started: ["Not started", "#777"] };
  const [t, c] = internal[s] || FULFILLMENT_LABELS[s] || [s, "#777"];
  return <Pill text={t} color={c} />;
};
const payPill = (s) => <Pill text={ORDER_LABELS[s] || s} color={s === "paid" ? "#1e7d32" : ["refunded", "partially_refunded"].includes(s) ? "#777" : s === "pending_payment" ? "#8a6d00" : "#b3261e"} />;

function useAction(after) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const run = async (key, action, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(key); setMsg(null);
    try {
      const r = await shopAdmin(action, body);
      setMsg({ ok: true, text: r?.result ? `${action}: ${r.result}${r.reason ? ` (${r.reason})` : ""}` : `${action}: done` });
      await after?.();
      return r;
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(null); }
  };
  return { busy, msg, run };
}

function Msg({ msg }) {
  if (!msg) return null;
  return <div role="status" style={{ margin: "10px 0", padding: "8px 12px", borderRadius: 8, background: msg.ok ? "#eaf6ec" : "#fdecea", color: msg.ok ? "#1e7d32" : "#b3261e", fontFamily: BODY, fontSize: 13, fontWeight: 700 }}>{msg.text}</div>;
}

// ── Orders ───────────────────────────────────────────────────────────
function OrderDetail({ orderId, onClose, onChanged }) {
  const [o, setO] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => shopAdmin("order", { orderId }).then((r) => setO(r.order)).catch((e) => setErr(e.message)), [orderId]);
  useEffect(() => { load(); }, [load]);
  const { busy, msg, run } = useAction(async () => { await load(); onChanged(); });
  if (err) return <div style={{ ...card, padding: 16, color: "#b3261e" }}>{err}</div>;
  if (!o) return <div style={{ ...card, padding: 16 }}>Loading…</div>;
  const f = o.fulfillment?.status;
  const cost = o.printify?.cost;
  const a = o.shippingAddress || {};
  return (
    <div style={{ ...card, padding: 18, marginBottom: 16, borderColor: BLUE }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>Order {o.orderId}</div>
        {payPill(o.status)} {fulfillPill(f)}
        <button onClick={onClose} style={{ ...smallBtn(), marginLeft: "auto" }}>CLOSE</button>
      </div>
      <Msg msg={msg} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {o.status === "paid" && f === "on_hold" && (
          <button disabled={!!busy} onClick={() => run("send", "sendToProduction", { orderId: o.orderId }, `Send to production? Printify will charge the store ${cost?.totalCents != null ? money(cost.totalCents) : "its cost"} now.`)} style={smallBtn("gold")}>
            {busy === "send" ? "SENDING…" : "SEND TO PRODUCTION"}
          </button>
        )}
        {o.status === "paid" && !o.printify?.orderId && ["error", "not_started", "needs_attention", "creating"].includes(f) && (
          <button disabled={!!busy} onClick={() => run("retry", "retryFulfillment", { orderId: o.orderId }, "Create the Printify order now?")} style={smallBtn("primary")}>
            {busy === "retry" ? "CREATING…" : "CREATE PRINTIFY ORDER"}
          </button>
        )}
        {o.printify?.orderId && <button disabled={!!busy} onClick={() => run("refresh", "refreshOrder", { orderId: o.orderId })} style={smallBtn()}>{busy === "refresh" ? "…" : "REFRESH FROM PRINTIFY"}</button>}
        {f !== "canceled" && ["not_started", "error", "on_hold", "needs_attention", "creating"].includes(f) && (
          <button disabled={!!busy} onClick={() => run("cancel", "cancelFulfillment", { orderId: o.orderId }, "Cancel fulfillment (Printify order)? This does NOT refund the customer.")} style={smallBtn("danger")}>CANCEL FULFILLMENT</button>
        )}
        {["paid", "partially_refunded"].includes(o.status) && (
          <button disabled={!!busy} onClick={() => run("refund", "refund", { orderId: o.orderId }, `Refund ${money(o.amountPaidCents - (o.amountRefundedCents || 0))} to the customer in Stripe? If the order hasn't gone to production, its Printify order is canceled too.`)} style={smallBtn("danger")}>FULL REFUND</button>
        )}
        {o.needsAttention && <button disabled={!!busy} onClick={() => run("clear", "clearAttention", { orderId: o.orderId })} style={smallBtn()}>MARK REVIEWED</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, fontFamily: BODY, fontSize: 13 }}>
        <div>
          <div style={th}>ITEMS</div>
          {o.lines.map((l, i) => (
            <div key={i} style={{ padding: "6px 0" }}>
              <b>{l.title}</b> — {l.variantTitle} × {l.quantity} · {money(l.lineTotalCents)}
              <div style={{ color: "#99a", fontSize: 11 }}>{l.productId} · Printify {l.fulfillment?.productId} / {l.fulfillment?.variantId}</div>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>Subtotal {money(o.subtotalCents)} · Shipping {money(o.shippingCents)} · Tax {money(o.taxCents)}</div>
          <div><b>Paid {money(o.amountPaidCents)}</b>{o.amountRefundedCents ? ` · Refunded ${money(o.amountRefundedCents)}` : ""}</div>
          {cost && <div style={{ marginTop: 4, color: "#555" }}>Printify cost: {cost.totalCents != null ? money(cost.totalCents) : "calculating"} (items {money(cost.totalPrice)}, ship {money(cost.totalShipping)}, tax {money(cost.totalTax)})</div>}
        </div>
        <div>
          <div style={th}>CUSTOMER / SHIP TO</div>
          <div style={{ padding: "6px 0", lineHeight: 1.5 }}>
            {o.email}{o.uid ? " · account" : " · guest"}<br />
            {a.firstName} {a.lastName}<br />{a.address1}{a.address2 ? `, ${a.address2}` : ""}<br />{a.city}, {a.region} {a.zip} {a.country}{a.phone ? <><br />{a.phone}</> : null}
          </div>
          <div style={th}>REFERENCES</div>
          <div style={{ padding: "6px 0", fontSize: 12, lineHeight: 1.6, wordBreak: "break-all" }}>
            Stripe session {o.stripe?.sessionId || "—"}<br />Payment intent {o.stripe?.paymentIntentId || "—"}<br />
            Printify order {o.printify?.orderId || "—"} ({o.printify?.status || "—"})<br />
            Created {fmt(o.createdAt)} · Paid {fmt(o.paidAt)} · Attempts {o.fulfillment?.attempts || 0}
          </div>
          {o.printify?.shipments?.length > 0 && (<>
            <div style={th}>SHIPMENTS</div>
            {o.printify.shipments.map((s, i) => <div key={i} style={{ padding: "4px 0" }}>{s.carrier} {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.number}</a> : s.number}{s.deliveredAt ? " · delivered" : ""}</div>)}
          </>)}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={th}>ISSUES & NOTES</div>
        {!o.issues?.length && <div style={{ ...td, borderBottom: "none", color: "#99a" }}>None.</div>}
        {(o.issues || []).slice().reverse().map((x, i) => (
          <div key={i} style={{ ...td, color: x.code === "admin_note" ? "#333" : "#b3261e" }}><b>{fmt(x.at)} · {x.code}</b> — {x.message}</div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" style={{ flex: 1, border: "2px solid #cfd8e3", borderRadius: 6, padding: "7px 10px", fontFamily: BODY }} />
          <button disabled={!note.trim() || !!busy} onClick={async () => { await run("note", "note", { orderId: o.orderId, note }); setNote(""); }} style={smallBtn()}>ADD</button>
        </div>
      </div>
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [attention, setAttention] = useState(false);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(() => shopAdmin("orders", { q, status, attention }).then((r) => { setOrders(r.orders); setErr(null); }).catch((e) => setErr(e.message)), [q, status, attention]);
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);
  const needCount = (orders || []).filter((o) => o.needsAttention).length;
  const holdCount = (orders || []).filter((o) => o.status === "paid" && o.fulfillment?.status === "on_hold").length;
  return (
    <div>
      {openId && <OrderDetail orderId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, name, order id, product…" style={{ flex: "1 1 260px", border: "2px solid #cfd8e3", borderRadius: 8, padding: "9px 12px", fontFamily: BODY, fontSize: 14 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ border: "2px solid #cfd8e3", borderRadius: 8, padding: "9px 8px", fontFamily: BODY }}>
          <option value="">All statuses</option>
          <optgroup label="Payment">{["paid", "pending_payment", "refunded", "partially_refunded", "expired", "payment_failed"].map((s) => <option key={s} value={s}>{ORDER_LABELS[s] || s}</option>)}</optgroup>
          <optgroup label="Fulfillment">{["on_hold", "error", "needs_attention", "submitted", "in_production", "partially_shipped", "fulfilled", "canceled"].map((s) => <option key={s} value={s}>{s}</option>)}</optgroup>
        </select>
        <label style={{ fontFamily: BODY, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Needs attention only</label>
        <button onClick={load} style={smallBtn()}>RELOAD</button>
      </div>
      {(needCount > 0 || holdCount > 0) && (
        <div style={{ marginBottom: 12, fontFamily: BODY, fontSize: 13, fontWeight: 700, color: "#8a6d00" }}>
          {holdCount > 0 && `${holdCount} paid order${holdCount === 1 ? "" : "s"} awaiting approval. `}{needCount > 0 && `${needCount} need${needCount === 1 ? "s" : ""} attention.`}
        </div>
      )}
      {err && <Msg msg={{ ok: false, text: err }} />}
      {!orders && !err && <div style={{ fontFamily: BODY }}>Loading…</div>}
      {orders && (
        <div style={{ ...card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>DATE</th><th style={th}>CUSTOMER</th><th style={th}>ITEMS</th><th style={th}>TOTAL</th><th style={th}>PAYMENT</th><th style={th}>FULFILLMENT</th><th style={th} /></tr></thead>
            <tbody>
              {!orders.length && <tr><td style={td} colSpan={7}>No orders.</td></tr>}
              {orders.map((o) => (
                <tr key={o.orderId} style={{ background: o.needsAttention ? "#fff6f5" : undefined }}>
                  <td style={td}>{fmt(o.createdAt)}</td>
                  <td style={td}>{o.email}<div style={{ color: "#99a", fontSize: 11 }}>{o.uid ? "account" : "guest"}</div></td>
                  <td style={td}>{o.lines.map((l) => `${l.title} (${l.variantTitle}) ×${l.quantity}`).join(", ")}</td>
                  <td style={td}>{money(o.amountPaidCents || o.totalCents)}</td>
                  <td style={td}>{payPill(o.status)}</td>
                  <td style={td}>{fulfillPill(o.fulfillment?.status)}{o.needsAttention && <div style={{ color: "#b3261e", fontSize: 11, fontWeight: 900, marginTop: 3 }}>⚠ attention</div>}</td>
                  <td style={td}><button onClick={() => { setOpenId(o.orderId); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={smallBtn()}>OPEN</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Contributions ────────────────────────────────────────────────────
function ContributionsTab() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { shopAdmin("contributions").then((r) => setRows(r.contributions)).catch((e) => setErr(e.message)); }, []);
  const shown = useMemo(() => (rows || []).filter((c) => showAll || !["pending", "expired", "checkout_failed"].includes(c.status)), [rows, showAll]);
  const totals = useMemo(() => {
    const done = (rows || []).filter((c) => c.totalPaidCents);
    return { total: done.reduce((s, c) => s + c.totalPaidCents, 0), monthly: (rows || []).filter((c) => c.recurring && c.status === "active").reduce((s, c) => s + c.amountCents, 0), count: done.length };
  }, [rows]);
  if (err) return <Msg msg={{ ok: false, text: err }} />;
  if (!rows) return <div style={{ fontFamily: BODY }}>Loading…</div>;
  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        {[["Received (all time)", money(totals.total)], ["Active monthly", `${money(totals.monthly)} / mo`], ["Contributors", totals.count]].map(([l, v]) => (
          <div key={l} style={{ ...card, padding: "12px 16px", minWidth: 160 }}><div style={{ fontSize: 11, color: "#667", letterSpacing: "0.08em" }}>{l.toUpperCase()}</div><div style={{ fontSize: 20, fontWeight: 900, color: NAVY }}>{v}</div></div>
        ))}
      </div>
      <label style={{ fontFamily: BODY, fontSize: 13, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include abandoned checkouts</label>
      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>DATE</th><th style={th}>EMAIL</th><th style={th}>AMOUNT</th><th style={th}>TYPE</th><th style={th}>STATUS</th><th style={th}>PAID TO DATE</th></tr></thead>
          <tbody>
            {!shown.length && <tr><td style={td} colSpan={6}>No contributions yet.</td></tr>}
            {shown.map((c) => (
              <tr key={c.contributionId}>
                <td style={td}>{fmt(c.createdAt)}</td>
                <td style={td}>{c.email || "—"}<div style={{ color: "#99a", fontSize: 11 }}>{c.uid ? "account" : "guest"}</div></td>
                <td style={td}>{money(c.amountCents)}</td>
                <td style={td}>{c.recurring ? "Monthly" : "One time"}</td>
                <td style={td}><Pill text={c.cancelAtPeriodEnd ? "ending" : c.status} color={["paid", "active"].includes(c.status) ? "#1e7d32" : c.status === "past_due" ? "#b3261e" : "#777"} /></td>
                <td style={td}>{money(c.totalPaidCents)}{c.paymentsCount > 1 ? ` (${c.paymentsCount})` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Products ─────────────────────────────────────────────────────────
function ProductsTab() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => shopAdmin("products").then((r) => { setRows(r.products); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const { busy, msg, run } = useAction(load);
  if (err) return <Msg msg={{ ok: false, text: err }} />;
  if (!rows) return <div style={{ fontFamily: BODY }}>Loading products from Printify…</div>;
  const notImported = rows.filter((r) => !r.imported);
  return (
    <div>
      <div style={{ fontFamily: BODY, fontSize: 13, color: "#555", marginBottom: 12, lineHeight: 1.5 }}>
        Products, variants, prices and images come from Printify — edit them there. Here you choose what the store shows.
        Changes appear in the store within about a minute.
      </div>
      <Msg msg={msg} />
      {notImported.length > 0 && (
        <div style={{ ...card, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontFamily: BODY, fontSize: 13, flex: 1 }}><b>{notImported.length}</b> Printify product{notImported.length === 1 ? " isn't" : "s aren't"} in the store yet.</div>
          <button disabled={!!busy} onClick={() => run("import", "importProducts", { hidden: true })} style={smallBtn()}>ADD ALL (HIDDEN)</button>
          <button disabled={!!busy} onClick={() => run("import", "importProducts", {})} style={smallBtn("primary")}>ADD ALL (VISIBLE)</button>
        </div>
      )}
      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th} /><th style={th}>PRODUCT</th><th style={th}>VARIANTS</th><th style={th}>PRICE</th><th style={th}>SHOWN</th><th style={th}>FEATURED</th><th style={th}>ORDER</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td style={td} colSpan={7}>No products in this Printify shop.</td></tr>}
            {rows.map((r) => (
              <tr key={r.printifyProductId} style={{ opacity: r.missing ? 0.55 : 1 }}>
                <td style={td}>{r.image && <img src={r.image} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />}</td>
                <td style={td}>
                  <b>{r.title}</b>
                  <div style={{ color: "#99a", fontSize: 11 }}>{r.id ? <a href={`/shop/${r.id}`} target="_blank" rel="noopener noreferrer">/shop/{r.id}</a> : "not in store"} · Printify {r.printifyProductId}</div>
                  {r.missing && <div style={{ color: "#b3261e", fontSize: 11, fontWeight: 900 }}>Deleted in Printify — not shown</div>}
                  {r.imported && !r.missing && <DescriptionEditor row={r} busy={busy} run={run} />}
                </td>
                <td style={td}>{r.missing ? "—" : `${r.availableCount}/${r.variantCount} available`}</td>
                <td style={td}>{r.priceRange ? (r.priceRange[0] === r.priceRange[1] ? money(r.priceRange[0]) : `${money(r.priceRange[0])}–${money(r.priceRange[1])}`) : "—"}</td>
                {r.imported ? (<>
                  <td style={td}><input type="checkbox" aria-label="Shown in store" checked={!r.hidden} disabled={!!busy || r.missing} onChange={(e) => run(`h${r.id}`, "updateProduct", { id: r.id, hidden: !e.target.checked })} /></td>
                  <td style={td}><input type="checkbox" aria-label="Featured" checked={r.featured} disabled={!!busy || r.missing} onChange={(e) => run(`f${r.id}`, "updateProduct", { id: r.id, featured: e.target.checked })} /></td>
                  <td style={td}>
                    <input type="number" defaultValue={r.sortOrder ?? ""} placeholder="auto" disabled={!!busy || r.missing} style={{ width: 70, border: "2px solid #cfd8e3", borderRadius: 6, padding: "4px 6px" }}
                      onBlur={(e) => { const v = e.target.value.trim(); if ((v === "" ? null : Number(v)) !== r.sortOrder) run(`o${r.id}`, "updateProduct", { id: r.id, sortOrder: v === "" ? null : Number(v) }); }} />
                  </td>
                </>) : (
                  <td style={td} colSpan={3}><button disabled={!!busy} onClick={() => run("import", "importProducts", { printifyProductIds: [r.printifyProductId] })} style={smallBtn("primary")}>ADD TO STORE</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontFamily: BODY, fontSize: 12, color: "#667", marginTop: 8 }}>Order: lower numbers first; featured products always lead; blank = alphabetical.</div>
    </div>
  );
}

// Our own description, shown above Printify's (which sits under "More
// product information" on the product page).
function DescriptionEditor({ row, busy, run }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(row.customDescription || "");
  useEffect(() => { setText(row.customDescription || ""); }, [row.customDescription]);
  const saved = row.customDescription || "";
  const dirty = text.trim() !== saved;
  if (!open) {
    return (
      <div style={{ marginTop: 6, fontSize: 12, display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
        <button onClick={() => setOpen(true)} style={{ ...smallBtn(), padding: "3px 8px", fontSize: 10 }}>{saved ? "EDIT DESCRIPTION" : "+ DESCRIPTION"}</button>
        {saved && <span style={{ color: "#667", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{saved.split(/\r?\n/)[0]}</span>}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8, minWidth: 300 }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={5000}
        placeholder="Your description. Shown first on the product page; Printify's text moves under &quot;More product information&quot;. Blank lines start new paragraphs."
        style={{ width: "100%", boxSizing: "border-box", border: "2px solid #cfd8e3", borderRadius: 6, padding: 8, fontFamily: BODY, fontSize: 13, lineHeight: 1.5, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
        <button disabled={!!busy || !dirty} onClick={async () => { await run(`d${row.id}`, "updateProduct", { id: row.id, customDescription: text }); }} style={{ ...smallBtn("primary"), opacity: dirty ? 1 : 0.5 }}>SAVE</button>
        <button disabled={!!busy} onClick={() => { setText(saved); setOpen(false); }} style={smallBtn()}>{dirty ? "CANCEL" : "CLOSE"}</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#99a" }}>{text.length}/5000</span>
      </div>
    </div>
  );
}

// Lulu (print products): keys set → sign-in → an authenticated read, for
// the sandbox and live environments.
function LuluCheck() {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const check = async () => {
    setBusy(true); setErr(null);
    try { setRes((await shopAdmin("luluCheck")).lulu); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const mark = (ok) => <span style={{ color: ok ? "#1e7d32" : "#b3261e", fontWeight: 900 }}>{ok ? "✓" : "✗"}</span>;
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "2px solid #eef1f5", fontFamily: BODY, fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <b style={{ flex: 1 }}>Lulu (print products)</b>
        <button disabled={busy} onClick={check} style={smallBtn("primary")}>{busy ? "CHECKING…" : "TEST LULU CONNECTION"}</button>
      </div>
      {err && <Msg msg={{ ok: false, text: err }} />}
      {res && ["sandbox", "live"].map((m) => {
        const r = res[m];
        return (
          <div key={m} style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "7px 0", borderBottom: "1px solid #eef1f5" }}>
            <b style={{ width: 70, textTransform: "uppercase" }}>{m}</b>
            <span>{mark(r.keysSet)} Keys set</span>
            <span>{mark(r.auth)} Sign-in</span>
            <span>{mark(r.api)} API read{r.api && r.printJobs != null ? ` (${r.printJobs} print job${r.printJobs === 1 ? "" : "s"})` : ""}</span>
            {r.error && <span style={{ color: "#b3261e", flexBasis: "100%" }}>{r.error}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Setup ────────────────────────────────────────────────────────────
function SetupTab() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(() => shopAdmin("setup").then(setS).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const { busy, msg, run } = useAction(load);
  if (err) return <Msg msg={{ ok: false, text: err }} />;
  if (!s) return <div style={{ fontFamily: BODY }}>Checking…</div>;
  const c = s.config;
  const check = (ok, label, detail) => (
    <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid #eef1f5", fontFamily: BODY, fontSize: 13 }}>
      <span style={{ color: ok ? "#1e7d32" : "#b3261e", fontWeight: 900, width: 18 }}>{ok ? "✓" : "✗"}</span>
      <span style={{ flex: 1 }}><b>{label}</b>{detail ? <span style={{ color: "#667" }}> — {detail}</span> : null}</span>
    </div>
  );
  const pfyHooks = s.webhooks || [];
  return (
    <div style={{ ...card, padding: 18, maxWidth: 820 }}>
      <Msg msg={msg} />
      {c.stripeMode === "live" && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#fff4e0", color: "#8a5300", fontFamily: BODY, fontSize: 13, fontWeight: 700 }}>Stripe is in LIVE mode — real cards are charged.</div>}
      {check(c.stripeSecretKey, "STRIPE_SECRET_KEY", c.stripeMode ? `${c.stripeMode} mode` : "missing")}
      {check(c.stripeWebhookSecret, "STRIPE_WEBHOOK_SECRET", `Stripe endpoint: ${s.stripeWebhookUrl}`)}
      {check(c.printifyToken, "PRINTIFY_API_TOKEN")}
      {check(!!c.printifyShopId, "PRINTIFY_SHOP_ID", c.printifyShopId || "missing — pick from the shops below")}
      {check(c.printifyWebhookSecret, "PRINTIFY_WEBHOOK_SECRET")}
      {check(pfyHooks.some((w) => w.url === s.printifyWebhookUrl), "Printify webhooks registered", pfyHooks.length ? pfyHooks.map((w) => w.topic).join(", ") : "none")}
      <div style={{ fontFamily: BODY, fontSize: 13, color: "#444", marginTop: 12, lineHeight: 1.6 }}>
        Site URL: {c.siteUrl} · Ships to: {c.shipCountries.join(", ")} · Auto-submit to production: <b>{c.autoSubmit ? "ON" : "OFF (admins approve each order)"}</b> · Stripe Tax: {c.automaticTax ? "on" : "off"}
      </div>
      {s.shops && (
        <div style={{ marginTop: 12, fontFamily: BODY, fontSize: 13 }}>
          <b>Printify shops on this token:</b>
          {s.shops.map((sh) => <div key={sh.id}>{String(sh.id) === String(c.printifyShopId) ? "→ " : ""}{sh.title} — id {sh.id} ({sh.channel})</div>)}
        </div>
      )}
      {s.errors?.length > 0 && <Msg msg={{ ok: false, text: s.errors.join(" · ") }} />}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button disabled={!!busy || !c.printifyShopId || !c.printifyWebhookSecret} onClick={() => run("hooks", "registerWebhooks", {}, `Register Printify webhooks to ${s.printifyWebhookUrl}?`)} style={smallBtn("primary")}>
          {busy === "hooks" ? "REGISTERING…" : "REGISTER PRINTIFY WEBHOOKS"}
        </button>
        <button onClick={load} style={smallBtn()}>RECHECK</button>
      </div>
      <LuluCheck />
      <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: "#fff7e8", fontFamily: BODY, fontSize: 12, color: "#6b4a00", lineHeight: 1.5 }}>
        In Printify, set this store&apos;s <b>Order approval</b> to <b>Manual</b>. New Printify stores auto-approve orders after 24 hours, which would send orders to production (and charge the store) without anyone pressing “Send to production”.
      </div>
    </div>
  );
}

export default function AdminShop() {
  const [tab, setTab] = useState("orders");
  return (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", borderRadius: 999, border: `2px solid ${BLUE}`, background: tab === k ? BLUE : "#fff", color: tab === k ? "#fff" : BLUE, fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", cursor: "pointer", fontFamily: "inherit" }}>{l.toUpperCase()}</button>
        ))}
      </div>
      {tab === "orders" && <OrdersTab />}
      {tab === "contributions" && <ContributionsTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "setup" && <SetupTab />}
    </div>
  );
}
