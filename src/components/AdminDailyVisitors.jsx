// src/components/AdminDailyVisitors.jsx
//
// Admin → Analytics → Daily Visitors: a row a day — new and returning
// visitors (GA4's newVsReturning, analyticsDaily/{day}, written by the
// daily analytics sync, scripts/syncGoogleAnalytics.js) and the accounts
// that visited (siteDailyAccounts/{day}, utils/accountVisits.js — live).
// GA4's numbers land with the next sync (every morning, or Admin's Sync
// button), so today's GA columns are partial or empty until then.
import { useEffect, useState } from "react";
import { collection, documentId, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { ACCOUNT_VISITS } from "../utils/accountVisits";
import { statsDay } from "../utils/draftSim/stats";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const DAYS = 30;
const th = { padding: "8px 12px", fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" };
const td = { padding: "7px 12px", fontSize: "13px", fontWeight: 800, color: "#222", textAlign: "right", fontVariantNumeric: "tabular-nums" };
const recent = (name) => getDocs(query(collection(db, name), orderBy(documentId(), "desc"), limit(DAYS)));
const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export default function AdminDailyVisitors() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([recent("analyticsDaily"), recent(ACCOUNT_VISITS)]).then(([ga, accts]) => {
      const byDay = {};
      ga.docs.forEach((d) => { byDay[d.id] = { ...(byDay[d.id] || {}), ga: d.data() }; });
      accts.docs.forEach((d) => { byDay[d.id] = { ...(byDay[d.id] || {}), accounts: Object.keys(d.data().u || {}).length }; });
      setRows(Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)).slice(0, DAYS).map(([day, v]) => ({ day, ...v })));
    }).catch((e) => { console.error("Daily visitors:", e); setError(e.message); setRows([]); });
  }, []);

  const today = statsDay();
  const num = (v) => (v == null ? "—" : v.toLocaleString());

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Daily Visitors</div>
        <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Google Analytics + accounts</div>
      </div>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #eee", fontSize: "12px", fontWeight: 700, color: "#999", lineHeight: 1.5 }}>
        New: first visit on that browser. Returning: that browser has been here before. Accounts: signed-in users who visited (live; they&apos;re also counted in new / returning).
        Google&apos;s numbers update with each morning&apos;s sync, so today&apos;s fill in tomorrow.
        {error && <div style={{ color: "#a52a1e" }}>⚠ {error}</div>}
      </div>
      {rows === null ? (
        <div style={{ padding: "16px", fontSize: "13px", color: "#999", fontWeight: 700 }}>Loading…</div>
      ) : !rows.length ? (
        <div style={{ padding: "16px", fontSize: "13px", color: "#999", fontWeight: 700 }}>No days yet — they start with the next analytics sync.</div>
      ) : (
        <div style={{ maxHeight: "420px", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "#fafbfd" }}>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Day</th>
                <th style={th}>New</th>
                <th style={th}>Returning</th>
                <th style={th}>Total</th>
                <th style={th}>Accounts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = r.ga ? (r.ga.new || 0) + (r.ga.returning || 0) + (r.ga.other || 0) : null;
                return (
                  <tr key={r.day} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td style={{ ...td, textAlign: "left", color: BLUE }}>{dayLabel(r.day)}{r.day === today ? <span style={{ color: "#bbb", fontWeight: 700 }}> · today</span> : null}</td>
                    <td style={td}>{num(r.ga?.new)}</td>
                    <td style={td}>{num(r.ga?.returning)}</td>
                    <td style={{ ...td, color: "#777" }}>{num(total)}</td>
                    <td style={{ ...td, color: "#2e7d32" }}>{num(r.accounts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
