// src/components/AdminPortalSimStats.jsx
//
// Admin → Players → Transfer Portal → Portal Sim Stats (user, 2026-11-18):
// how many Transfer Portal Sims are run and finished, by day.
//   Runs by day     portalSimDaily (utils/portalSim/usage.js) — runs started
//                   and portals closed, last 30 days (Eastern), with totals
//                   and the finish rate. Counting began 2026-11-18.
//   All time        every closed portal (portalSimResults — what Community →
//                   Insights counts) and the classes users saved / shared.
//   Latest          the newest closed portals: school, signings, grade, NIL.
import { useEffect, useState } from "react";
import { collection, collectionGroup, count, getAggregateFromServer, getDocs, limit, orderBy, query, where, documentId } from "firebase/firestore";
import { db } from "../firebase";
import { PORTAL_DAILY, statsDay } from "../utils/portalSim/usage";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", padding: "14px 16px" };
const th = { textAlign: "left", padding: "6px 8px", fontSize: "11px", fontWeight: 900, color: "#555", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "2px solid #e3e8ef", whiteSpace: "nowrap" };
const td = { padding: "6px 8px", fontSize: "13px", borderBottom: "1px solid #f0f2f5", whiteSpace: "nowrap" };
const DAYS = 30;
const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);

// The last n days (Eastern), newest first, as YYYY-MM-DD.
const lastDays = (n) => Array.from({ length: n }, (_, i) => statsDay(new Date(Date.now() - i * 86400000)));

export default function AdminPortalSimStats() {
  const [days, setDays] = useState(null);
  const [totals, setTotals] = useState(null);
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setError("");
    const range = lastDays(DAYS);
    const load = async () => {
      const [daily, results, saved, shared, recent] = await Promise.all([
        getDocs(query(collection(db, PORTAL_DAILY), where(documentId(), ">=", range[range.length - 1]))),
        getAggregateFromServer(collection(db, "portalSimResults"), { n: count() }),
        getAggregateFromServer(collectionGroup(db, "portalSims"), { n: count() }).catch(() => null),
        getAggregateFromServer(collection(db, "publicPortalSims"), { n: count() }),
        getDocs(query(collection(db, "portalSimResults"), orderBy("createdAt", "desc"), limit(15))),
      ]);
      const byDay = Object.fromEntries(daily.docs.map((d) => [d.id, d.data()]));
      return {
        days: range.map((day) => ({ day, started: byDay[day]?.started || 0, finished: byDay[day]?.finished || 0 })),
        totals: { results: results.data().n, saved: saved ? saved.data().n : null, shared: shared.data().n },
        latest: recent.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    };
    load().then((r) => { if (!live) return; setDays(r.days); setTotals(r.totals); setLatest(r.latest); })
      .catch((e) => { console.error("Portal sim stats load error:", e); if (live) setError(e.message || "Couldn't load the stats."); });
    return () => { live = false; };
  }, [nonce]);

  if (error) return <div style={{ ...card, color: "#b42318", fontWeight: 700 }}>{error} <button type="button" onClick={() => setNonce((n) => n + 1)} style={{ marginLeft: 8 }}>Retry</button></div>;
  if (!days) return <div style={{ ...card, color: "#667" }}>Loading Portal Sim stats…</div>;

  const sum = (k, list = days) => list.reduce((t, d) => t + d[k], 0);
  const week = days.slice(0, 7);
  const rate = (f, s) => (s ? `${Math.round((f / s) * 100)}%` : "—");
  const max = Math.max(1, ...days.map((d) => Math.max(d.started, d.finished)));
  const tile = (label, value, sub) => (
    <div style={{ ...card, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", color: "#667", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: "#111", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#667", fontWeight: 700 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: BLUE }}>Transfer Portal Sim · Statistics</div>
        <div style={{ fontSize: 12, color: "#667", fontWeight: 700 }}>Every run counts (signed in or not, the site's own account included). Daily counts began Nov 18, 2026 · Eastern time.</div>
        <button type="button" onClick={() => setNonce((n) => n + 1)} style={{ marginLeft: "auto", border: `1px solid ${BLUE}`, background: "#fff", color: BLUE, borderRadius: 8, padding: "6px 12px", fontWeight: 800, cursor: "pointer" }}>Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
        {tile("Today", `${days[0].started} / ${days[0].finished}`, "started / finished")}
        {tile("Last 7 days", `${sum("started", week)} / ${sum("finished", week)}`, `finish rate ${rate(sum("finished", week), sum("started", week))}`)}
        {tile(`Last ${DAYS} days`, `${sum("started")} / ${sum("finished")}`, `finish rate ${rate(sum("finished"), sum("started"))}`)}
        {tile("All-time finished", totals.results.toLocaleString(), "every closed portal (Insights)")}
        {tile("Classes saved", totals.saved == null ? "—" : totals.saved.toLocaleString(), `${totals.shared.toLocaleString()} public`)}
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
          <div style={{ fontWeight: 900, color: "#111" }}>Runs by day</div>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#667" }}><span style={{ color: BLUE }}>■</span> Started <span style={{ color: GOLD, marginLeft: 8 }}>■</span> Finished</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={th}>Day</th><th style={th}>Started</th><th style={th}>Finished</th><th style={th}>Finish rate</th><th style={{ ...th, width: "45%" }} /></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} style={{ opacity: d.started || d.finished ? 1 : 0.45 }}>
                  <td style={{ ...td, fontWeight: 800 }}>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td style={{ ...td, fontWeight: 900, color: BLUE }}>{d.started}</td>
                  <td style={{ ...td, fontWeight: 900, color: "#b26a00" }}>{d.finished}</td>
                  <td style={td}>{rate(d.finished, d.started)}</td>
                  <td style={td}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <span style={{ display: "block", height: 6, width: `${(d.started / max) * 100}%`, background: BLUE, borderRadius: 3 }} />
                      <span style={{ display: "block", height: 6, width: `${(d.finished / max) * 100}%`, background: GOLD, borderRadius: 3 }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 900, color: "#111", marginBottom: 8 }}>Latest closed portals</div>
        {latest.length === 0 ? <div style={{ color: "#667", fontSize: 13 }}>None yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr><th style={th}>When</th><th style={th}>School</th><th style={th}>Mode</th><th style={th}>Signed</th><th style={th}>NIL</th><th style={th}>Grade</th><th style={th}>Roster</th></tr></thead>
              <tbody>
                {latest.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{r.school || r.team}</td>
                    <td style={td}>{r.live ? "Real" : r.frequency && r.frequency !== "default" ? r.frequency : "Projected"}</td>
                    <td style={td}>{r.n ?? (r.signings || []).length}</td>
                    <td style={td}>{money(r.spent)}</td>
                    <td style={{ ...td, fontWeight: 900 }}>{r.grade || "—"}</td>
                    <td style={td}>{r.verdict || "—"}{r.pct != null ? ` (${r.pct > 0 ? "+" : ""}${r.pct}%)` : ""}</td>
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
