// src/components/AdminUserTiers.jsx
//
// Admin → Users, above the table: every account in a tier (utils/userTiers.js
// — Stars, Active, Inactive, Dogs) with its count; pick one for its people
// (name, email, days on the site, evaluations, last visit).
// users: UsersSection's rows; evals30: uid → evaluations saved in the
// window. Visit days: siteDailyAccounts (read here).
import { useEffect, useMemo, useState } from "react";
import { collection, documentId, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { ACCOUNT_VISITS } from "../utils/accountVisits";
import { statsDay, STATS_EXCLUDED_UIDS } from "../utils/draftSim/stats";
import { TIERS, TIER_RULES, tierOf } from "../utils/userTiers";

const toMs = (v) => (v?.toMillis ? v.toMillis() : v?.toDate ? v.toDate().getTime() : v ? Date.parse(v) || 0 : 0);
const daysAgo = (today, n) => new Date(Date.parse(`${today}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const lastSeen = (age) => (age == null ? "—" : age === 0 ? "Today" : age === 1 ? "Yesterday" : `${age} days ago`);
const th = { padding: "8px 10px", fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: "12.5px", fontWeight: 700, color: "#333", borderBottom: "1px solid #f0f0f0", whiteSpace: "nowrap" };

export default function AdminUserTiers({ users, evals30 }) {
  const today = statsDay();
  const from = daysAgo(today, TIER_RULES.days - 1);
  const [visits, setVisits] = useState(null); // { byUid, trackedFrom }
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, ACCOUNT_VISITS), where(documentId(), ">=", from))),
      getDocs(query(collection(db, ACCOUNT_VISITS), orderBy(documentId()), limit(1))),
    ]).then(([days, firstDay]) => {
      const byUid = {};
      days.docs.forEach((d) => Object.keys(d.data().u || {}).forEach((uid) => { (byUid[uid] = byUid[uid] || []).push(d.id); }));
      setVisits({ byUid, trackedFrom: firstDay.docs[0]?.id || today });
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

  if (error) return <div style={{ padding: "10px 14px", border: "2px solid #c0392b", borderRadius: 8, color: "#a52a1e", fontSize: 12, fontWeight: 700 }}>⚠ User tiers: {error}</div>;
  if (!visits) return <div style={{ fontSize: 12, fontWeight: 800, color: "#999" }}>Sorting users into tiers…</div>;
  return <UserTiersView rows={rows} />;
}

// The panel itself. rows: accounts with their tierOf() fields.
export function UserTiersView({ rows }) {
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

    </div>
  );
}
