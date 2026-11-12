// src/components/AdminUserTiers.jsx
//
// Admin → Users, above the table: every account in a tier (utils/userTiers.js
// — Stars, Active, Inactive, Dogs) with its count; pick one for its people
// (name, email, days on the site, evaluations, last visit). Then visitors
// without an account (utils/visitorVisits.js): how many came in the last 30
// days and the regulars among them — at least weekly, never signed in.
// users: UsersSection's rows; evals30: uid → evaluations saved in the
// window. Visit days: siteDailyAccounts and siteVisitors (read here).
import { useEffect, useMemo, useState } from "react";
import { collection, documentId, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { ACCOUNT_VISITS } from "../utils/accountVisits";
import { VISITORS, VISITOR_ACCOUNTS } from "../utils/visitorVisits";
import { statsDay, STATS_EXCLUDED_UIDS } from "../utils/draftSim/stats";
import { TIERS, TIER_RULES, tierOf, visitStats } from "../utils/userTiers";

const BLUE = "#0055a5";
const toMs = (v) => (v?.toMillis ? v.toMillis() : v?.toDate ? v.toDate().getTime() : v ? Date.parse(v) || 0 : 0);
const daysAgo = (today, n) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const lastSeen = (age) => (age == null ? "—" : age === 0 ? "Today" : age === 1 ? "Yesterday" : `${age} days ago`);
const th = { padding: "8px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: "12.5px", fontWeight: 700, color: "#333", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" };

export default function AdminUserTiers({ users, evals30 }) {
  const today = statsDay();
  const from = daysAgo(today, TIER_RULES.days - 1);
  const [visits, setVisits] = useState(null); // { byUid, trackedFrom, visitors, visitorsFrom, linked }
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, ACCOUNT_VISITS), where(documentId(), ">=", from))),
      getDocs(query(collection(db, ACCOUNT_VISITS), orderBy(documentId()), limit(1))),
      getDocs(query(collection(db, VISITORS), where("last", ">=", from))),
      getDocs(query(collection(db, VISITORS), orderBy("first"), limit(1))),
      getDocs(collection(db, VISITOR_ACCOUNTS)),
    ]).then(([days, firstDay, visitors, firstVisitor, linked]) => {
      const byUid = {};
      days.docs.forEach((d) => Object.keys(d.data().u || {}).forEach((uid) => { (byUid[uid] = byUid[uid] || []).push(d.id); }));
      setVisits({
        byUid, trackedFrom: firstDay.docs[0]?.id || today,
        visitors: visitors.docs.map((d) => ({ id: d.id, days: Object.keys(d.data().days || {}) })),
        visitorsFrom: firstVisitor.docs[0]?.data().first || today,
        linked: new Set(linked.docs.map((d) => d.id)),
      });
    }).catch((e) => { console.error("User tiers:", e); setError(e.message); });
  }, [from, today]);

  const rows = useMemo(() => {
    if (!visits) return [];
    return users.filter((u) => !STATS_EXCLUDED_UIDS.includes(u.id)).map((u) => {
      const ms = toMs(u.lastActiveAt);
      const t = tierOf({ visitDays: visits.byUid[u.id] || [], lastActiveDay: ms ? statsDay(new Date(ms)) : null, evals30: evals30[u.id] || 0, today, trackedFrom: visits.trackedFrom });
      return { ...u, ...t };
    });
  }, [users, evals30, visits, today]);

  const anon = useMemo(() => {
    if (!visits) return { all: 0, regulars: [] };
    const list = visits.visitors.filter((v) => !visits.linked.has(v.id)).map((v) => ({ id: v.id, ...visitStats(v.days, today, visits.visitorsFrom) })).filter((v) => v.days30 > 0);
    return { all: list.length, regulars: list.filter((v) => v.weekly).sort((a, b) => b.days30 - a.days30) };
  }, [visits, today]);

  if (error) return <div style={{ padding: "10px 14px", border: "2px solid #c0392b", borderRadius: 8, color: "#a52a1e", fontSize: 12, fontWeight: 700 }}>⚠ User tiers: {error}</div>;
  if (!visits) return <div style={{ fontSize: 12, fontWeight: 800, color: "#999" }}>Sorting users into tiers…</div>;
  return <UserTiersView rows={rows} anon={anon} />;
}

// The panel itself. rows: accounts with their tierOf() fields; anon: { all,
// regulars } — visitors without an account in the window, and the regulars.
export function UserTiersView({ rows, anon }) {
  const [open, setOpen] = useState("star");
  const people = rows.filter((r) => r.tier === open).sort((a, b) => b.days30 - a.days30 || b.evals30 - a.evals30);
  const tier = TIERS.find((t) => t.id === open);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {TIERS.map((t) => {
          const n = rows.filter((r) => r.tier === t.id).length;
          const on = t.id === open;
          return (
            <button key={t.id} onClick={() => setOpen(t.id)} aria-pressed={on} style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: on ? t.color : "#fff", color: on ? "#fff" : "#222", border: `2px solid ${t.color}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 900, lineHeight: 1 }}>{n}</span>
                <span style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: on ? "#fff" : t.color }}>{t.label}</span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, opacity: on ? 0.9 : 0.6 }}>{t.rule}</div>
            </button>
          );
        })}
        <div style={{ background: "#f5f7fb", border: "2px dashed #b6c2d3", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 900, lineHeight: 1, color: "#222" }}>{anon.regulars.length}</span>
            <span style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: BLUE }}>No account</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4, color: "#667" }}>At least weekly, never signed in · {anon.all} visitor{anon.all === 1 ? "" : "s"} without an account in {TIER_RULES.days} days</div>
        </div>
      </div>

      <div style={{ border: `2px solid ${tier.color}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ background: tier.color, color: "#fff", padding: "8px 12px", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {tier.label} · {people.length}
        </div>
        {people.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, fontWeight: 700, color: "#999", textAlign: "center" }}>Nobody in this tier yet.</div>
        ) : (
          <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#334155", position: "sticky", top: 0 }}>
                <th style={th}>User</th><th style={th}>Email</th><th style={{ ...th, textAlign: "center" }}>Days on site ({TIER_RULES.days}d)</th>
                <th style={{ ...th, textAlign: "center" }}>Weeks ({TIER_RULES.weeks})</th><th style={{ ...th, textAlign: "center" }}>Evaluations ({TIER_RULES.days}d)</th><th style={th}>Last visit</th>
              </tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 900, color: "#111" }}>{p.username || "(no username)"}</td>
                    <td style={td}>{p.email || "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>{p.days30}</td>
                    <td style={{ ...td, textAlign: "center" }}>{p.weeks}</td>
                    <td style={{ ...td, textAlign: "center" }}>{p.evals30}</td>
                    <td style={td}>{lastSeen(p.lastAge)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {anon.regulars.length > 0 && (
        <details style={{ border: "2px solid #b6c2d3", borderRadius: 10, padding: "8px 12px" }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Regular visitors without an account · {anon.regulars.length}</summary>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead><tr style={{ background: "#334155" }}><th style={th}>Visitor</th><th style={{ ...th, textAlign: "center" }}>Days on site ({TIER_RULES.days}d)</th><th style={{ ...th, textAlign: "center" }}>Weeks ({TIER_RULES.weeks})</th><th style={th}>Last visit</th></tr></thead>
            <tbody>
              {anon.regulars.map((v) => (
                <tr key={v.id}><td style={{ ...td, fontFamily: "monospace" }}>{v.id.slice(0, 8)}</td><td style={{ ...td, textAlign: "center" }}>{v.days30}</td><td style={{ ...td, textAlign: "center" }}>{v.weeks}</td><td style={td}>{lastSeen(v.lastAge)}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#888", marginTop: 6 }}>A random id per browser — counted since visitor tracking started; nothing about the person is stored.</div>
        </details>
      )}
    </div>
  );
}
