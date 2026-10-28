// src/components/AdminSimStats.jsx
//
// Admin → Mock Draft → Statistics: Draft Sim usage from the counters
// utils/draftSim/stats.js keeps (King Cold Sports not counted).
//   Sims by day     draftSimDaily — sims started, finished and user picks
//                   for the last 30 days (Eastern time), with totals.
//   Teams           draftSimTeams — which teams users draft as (every
//                   team of a multi-team sim, plus watching the CPU), by
//                   class and date range.
//   User picks      draftSimPicks — who users take, for which team, at
//                   which pick, and when: filter by class, date range, team
//                   and position; names from that class's Expanded Board
//                   (hidden players included), then the players doc for
//                   anyone since removed from it.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, documentId, getDoc, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { loadExpandedBoard, SIM_YEARS, SIM_YEAR } from "../utils/draftSim/data";
import { statsDay, WATCH_KEY } from "../utils/draftSim/stats";
import { NFL_TEAMS } from "../utils/coachHistory";
import { SIM_POSITIONS, SPECIALISTS } from "../utils/draftSim/engine";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", padding: "14px 16px" };
const th = { textAlign: "left", padding: "6px 8px", fontSize: "11px", fontWeight: 900, color: "#555", letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "2px solid #e3e8ef", whiteSpace: "nowrap" };
const td = { padding: "6px 8px", fontSize: "13px", borderBottom: "1px solid #eef1f5" };
const chip = (on) => ({ border: `1px solid ${on ? BLUE : "#d8dee8"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : BLUE, borderRadius: "999px", padding: "4px 11px", fontSize: "12px", fontWeight: 800, cursor: "pointer" });
const DAYS = 30;
const RANGES = [["", "All time"], [1, "Today"], [7, "Last 7 days"], [DAYS, `Last ${DAYS} days`]];
const shortDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function AdminSimStats() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <Daily />
      <Teams />
      <Picks />
    </div>
  );
}

function Daily() {
  const [days, setDays] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    // The last DAYS days by id, oldest first (a descending id sort would
    // need its own index), shown newest first.
    const from = statsDay(new Date(Date.now() - (DAYS - 1) * 86400000));
    getDocs(query(collection(db, "draftSimDaily"), where(documentId(), ">=", from), orderBy(documentId())))
      .then((snap) => setDays(snap.docs.map((d) => ({ day: d.id, sims: 0, completed: 0, picks: 0, ...d.data() })).reverse()))
      .catch((e) => { console.error("Sim stats load error:", e); setError("Couldn't load — check you're signed in as an admin."); });
  }, []);

  const totals = useMemo(() => {
    if (!days) return null;
    const since = (n) => statsDay(new Date(Date.now() - (n - 1) * 86400000));
    const sum = (n) => days.filter((d) => d.day >= since(n)).reduce((t, d) => ({ sims: t.sims + d.sims, completed: t.completed + d.completed, picks: t.picks + d.picks }), { sims: 0, completed: 0, picks: 0 });
    return [["Today", sum(1)], ["Last 7 days", sum(7)], [`Last ${DAYS} days`, sum(DAYS)]];
  }, [days]);
  const max = Math.max(1, ...(days || []).map((d) => d.sims));

  return (
    <div style={card}>
      <div style={{ fontWeight: 900, color: BLUE, fontSize: "16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Sims by day</div>
      <div style={{ fontSize: "12px", color: "#777", marginTop: "4px" }}>Every Draft Sim run, signed in or not, except King Cold Sports&apos;. Days are Eastern time. History was reset on Oct. 24, 2026.</div>
      {error && <div style={{ color: "#b42318", fontSize: "13px", marginTop: "10px" }}>{error}</div>}
      {!days && !error && <div style={{ fontSize: "13px", color: "#888", marginTop: "10px" }}>Loading…</div>}
      {totals && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginTop: "12px" }}>
          {totals.map(([label, t]) => (
            <div key={label} style={{ border: "1px solid #e3e8ef", borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#777", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
              <div style={{ fontSize: "26px", fontWeight: 900, color: "#1a1f2b", lineHeight: 1.2 }}>{t.sims.toLocaleString()} <span style={{ fontSize: "12px", color: "#777" }}>sims</span></div>
              <div style={{ fontSize: "12px", color: "#555" }}>{t.completed.toLocaleString()} finished · {t.picks.toLocaleString()} user picks</div>
            </div>
          ))}
        </div>
      )}
      {days && days.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "12px" }}>
          <thead><tr><th style={th}>Day</th><th style={th}>Sims</th><th style={{ ...th, width: "40%" }} /><th style={th}>Finished</th><th style={th}>User picks</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700 }}>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
                <td style={{ ...td, fontWeight: 900 }}>{d.sims}</td>
                <td style={td}><div style={{ height: "10px", width: `${(d.sims / max) * 100}%`, minWidth: d.sims ? "3px" : 0, background: GOLD, borderRadius: "5px" }} /></td>
                <td style={td}>{d.completed}</td>
                <td style={td}>{d.picks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {days && !days.length && <div style={{ fontSize: "13px", color: "#888", marginTop: "10px" }}>No sims counted yet.</div>}
    </div>
  );
}

// The date range's first day ("" for all time).
const rangeFrom = (range) => (range ? statsDay(new Date(Date.now() - (range - 1) * 86400000)) : "");

function Teams() {
  const [year, setYear] = useState(SIM_YEAR);
  const [range, setRange] = useState("");
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setDocs(null);
    setError("");
    getDocs(query(collection(db, "draftSimTeams"), where("year", "==", year)))
      .then((snap) => setDocs(snap.docs.map((d) => d.data())))
      .catch((e) => { console.error("Sim team stats load error:", e); setError("Couldn't load — check you're signed in as an admin."); });
  }, [year]);

  // [[team, starts]], most first; watching apart.
  const { rows, watch, total } = useMemo(() => {
    const from = rangeFrom(range);
    const m = {};
    (docs || []).filter((d) => d.day >= from).forEach((d) => Object.entries(d.t || {}).forEach(([k, n]) => { m[k] = (m[k] || 0) + (Number(n) || 0); }));
    const watching = m[WATCH_KEY] || 0;
    delete m[WATCH_KEY];
    const list = Object.entries(m).sort((a, b) => b[1] - a[1] || (NFL_TEAMS[a[0]] || a[0]).localeCompare(NFL_TEAMS[b[0]] || b[0]));
    return { rows: list, watch: watching, total: list.reduce((t, [, n]) => t + n, 0) };
  }, [docs, range]);
  const max = Math.max(1, ...rows.map(([, n]) => n));

  return (
    <div style={card}>
      <div style={{ fontWeight: 900, color: BLUE, fontSize: "16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Teams users draft as</div>
      <div style={{ fontSize: "12px", color: "#777", marginTop: "4px" }}>Counted when START THE DRAFT is pressed. A multi-team sim counts once for each of its teams, so the team total can be more than the number of sims.</div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "12px" }}>
        {SIM_YEARS.map((y) => <button key={y} onClick={() => setYear(y)} style={chip(year === y)}>{y}</button>)}
        <select value={range} onChange={(e) => setRange(e.target.value ? Number(e.target.value) : "")} style={{ border: "1px solid #d8dee8", borderRadius: "6px", padding: "5px 8px", fontSize: "13px", marginLeft: "6px" }}>
          {RANGES.map(([v, label]) => <option key={label} value={v}>{label}</option>)}
        </select>
      </div>
      {error && <div style={{ color: "#b42318", fontSize: "13px", marginTop: "10px" }}>{error}</div>}
      {!docs && !error && <div style={{ fontSize: "13px", color: "#888", marginTop: "10px" }}>Loading…</div>}
      {docs && !rows.length && !watch && <div style={{ fontSize: "13px", color: "#888", marginTop: "10px" }}>No {year} sims started{range ? " in that range" : ""} yet.</div>}
      {docs && (rows.length > 0 || watch > 0) && (
        <>
          <div style={{ fontSize: "12px", color: "#555", marginTop: "10px" }}>
            <b>{total.toLocaleString()}</b> team starts across {rows.length} teams · <b>{watch.toLocaleString()}</b> watching the CPU (no team)
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "10px" }}>
            <thead><tr><th style={th}>#</th><th style={th}>Team</th><th style={th}>Starts</th><th style={{ ...th, width: "40%" }} /><th style={th}>Share</th></tr></thead>
            <tbody>
              {rows.map(([t, n], i) => (
                <tr key={t}>
                  <td style={{ ...td, color: "#888", fontWeight: 800 }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>{NFL_TEAMS[t] || t}</td>
                  <td style={{ ...td, fontWeight: 900 }}>{n}</td>
                  <td style={td}><div style={{ height: "10px", width: `${(n / max) * 100}%`, minWidth: "3px", background: GOLD, borderRadius: "5px" }} /></td>
                  <td style={td}>{Math.round((n / Math.max(1, total)) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Picks() {
  const [year, setYear] = useState(SIM_YEAR);
  const [docs, setDocs] = useState(null);
  const [board, setBoard] = useState(null);
  const [team, setTeam] = useState("");
  const [pos, setPos] = useState("");
  const [range, setRange] = useState("");
  const [shown, setShown] = useState(100);
  const [error, setError] = useState("");

  useEffect(() => {
    setDocs(null);
    setBoard(null);
    setError("");
    let live = true;
    const picks = getDocs(query(collection(db, "draftSimPicks"), where("year", "==", year))).then((snap) => snap.docs.map((d) => d.data()));
    picks.then((list) => live && setDocs(list))
      .catch((e) => { console.error("Sim pick stats load error:", e); setError("Couldn't load — check you're signed in as an admin."); });
    Promise.all([picks.catch(() => []), loadExpandedBoard(year).catch(() => [])]).then(async ([list, b]) => {
      // Picked players no longer on the board: read their players docs.
      const have = new Set(b.map((p) => p.id));
      const missing = [...new Set(list.flatMap((d) => Object.keys(d.p || {}).map((k) => k.slice(k.indexOf("_") + 1))))].filter((id) => !have.has(id));
      const extra = await Promise.all(missing.map((id) => getDoc(doc(db, "players", id)).then((s) => (s.exists() ? { id, ...s.data() } : null)).catch(() => null)));
      if (live) setBoard([...b, ...extra.filter(Boolean)]);
    });
    return () => { live = false; };
  }, [year]);

  // [{ overall, team, id, n, share, first, last }] — one doc per team per
  // day, summed over the date range; share of the users who made that pick
  // for that team; first/last the days it was made.
  const rows = useMemo(() => {
    if (!docs) return [];
    const from = rangeFrom(range);
    const byKey = {};
    docs.filter((d) => d.day >= from).forEach((d) => {
      Object.entries(d.p || {}).forEach(([key, n]) => {
        const cut = key.indexOf("_");
        const k = `${d.team}|${key}`;
        const row = byKey[k] || (byKey[k] = { overall: Number(key.slice(0, cut)), team: d.team, id: key.slice(cut + 1), n: 0, first: d.day, last: d.day });
        row.n += Number(n) || 0;
        if (d.day < row.first) row.first = d.day;
        if (d.day > row.last) row.last = d.day;
      });
    });
    const out = Object.values(byKey);
    const slotTotal = {};
    out.forEach((r) => { slotTotal[`${r.team}|${r.overall}`] = (slotTotal[`${r.team}|${r.overall}`] || 0) + r.n; });
    out.forEach((r) => { const t = slotTotal[`${r.team}|${r.overall}`]; r.share = t ? r.n / t : 0; });
    return out.sort((a, b) => a.overall - b.overall || b.n - a.n);
  }, [docs, range]);
  const byId = useMemo(() => Object.fromEntries((board || []).map((p) => [p.id, p])), [board]);
  const visible = rows.filter((r) => (!team || r.team === team) && (!pos || byId[r.id]?.Position === pos));
  const teams = [...new Set(rows.map((r) => r.team))].sort((a, b) => (NFL_TEAMS[a] || a).localeCompare(NFL_TEAMS[b] || b));

  // Most-picked players across the filtered rows.
  const top = useMemo(() => {
    const m = {};
    visible.forEach((r) => { m[r.id] = (m[r.id] || 0) + r.n; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [visible]);

  const name = (id) => { const p = byId[id]; return p ? `${p.First} ${p.Last}` : id; };

  return (
    <div style={card}>
      <div style={{ fontWeight: 900, color: BLUE, fontSize: "16px", textTransform: "uppercase", letterSpacing: "0.05em" }}>User picks</div>
      <div style={{ fontSize: "12px", color: "#777", marginTop: "4px" }}>Who users draft, for which team, at which pick, and when (Eastern time). &ldquo;Share&rdquo; is that player&apos;s cut of every user pick made for that team at that spot in the date range.</div>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", marginTop: "12px" }}>
        {SIM_YEARS.map((y) => <button key={y} onClick={() => { setYear(y); setTeam(""); setShown(100); }} style={chip(year === y)}>{y}</button>)}
        <select value={team} onChange={(e) => { setTeam(e.target.value); setShown(100); }} style={{ border: "1px solid #d8dee8", borderRadius: "6px", padding: "5px 8px", fontSize: "13px", marginLeft: "6px" }}>
          <option value="">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{NFL_TEAMS[t] || t}</option>)}
        </select>
        <select value={range} onChange={(e) => { setRange(e.target.value ? Number(e.target.value) : ""); setShown(100); }} style={{ border: "1px solid #d8dee8", borderRadius: "6px", padding: "5px 8px", fontSize: "13px" }}>
          {RANGES.map(([v, label]) => <option key={label} value={v}>{label}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
        <button onClick={() => setPos("")} style={chip(!pos)}>All positions</button>
        {[...SIM_POSITIONS, ...SPECIALISTS].map((x) => <button key={x} onClick={() => setPos(pos === x ? "" : x)} style={chip(pos === x)}>{x}</button>)}
      </div>

      {error && <div style={{ color: "#b42318", fontSize: "13px", marginTop: "10px" }}>{error}</div>}
      {!docs && !error && <div style={{ fontSize: "13px", color: "#888", marginTop: "10px" }}>Loading…</div>}
      {docs && !rows.length && <div style={{ fontSize: "13px", color: "#888", marginTop: "10px" }}>No user picks counted for {year}{range ? " in that range" : ""} yet.</div>}

      {top.length > 0 && (
        <div style={{ marginTop: "12px", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "11px", fontWeight: 900, color: "#555", letterSpacing: "0.05em" }}>MOST PICKED:</span>
          {top.map(([id, n]) => <span key={id} style={{ background: "#eef3fa", color: BLUE, borderRadius: "999px", padding: "3px 10px", fontSize: "12px", fontWeight: 800 }}>{name(id)} · {n}</span>)}
        </div>
      )}

      {visible.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "12px" }}>
          <thead><tr><th style={th}>Pick</th><th style={th}>Team</th><th style={th}>Player</th><th style={th}>Pos</th><th style={th}>School</th><th style={th}>Times</th><th style={th}>Share</th><th style={th}>First picked</th><th style={th}>Last picked</th></tr></thead>
          <tbody>
            {visible.slice(0, shown).map((r) => {
              const p = byId[r.id];
              return (
                <tr key={`${r.team}-${r.overall}-${r.id}`}>
                  <td style={{ ...td, fontWeight: 900, whiteSpace: "nowrap" }}>No. {r.overall}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{NFL_TEAMS[r.team] || r.team}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{name(r.id)}</td>
                  <td style={td}>{p?.Position || "—"}</td>
                  <td style={td}>{p?.School || "—"}</td>
                  <td style={{ ...td, fontWeight: 900 }}>{r.n}</td>
                  <td style={td}>{Math.round(r.share * 100)}%</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{shortDay(r.first)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{shortDay(r.last)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {visible.length > shown && <button onClick={() => setShown((x) => x + 200)} style={{ ...chip(false), marginTop: "10px" }}>Show more ({visible.length - shown} left)</button>}
    </div>
  );
}
