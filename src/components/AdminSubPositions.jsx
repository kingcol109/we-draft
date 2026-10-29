// src/components/AdminSubPositions.jsx
//
// Admin → Players → Data Management → Sub-positions: OL → OT / G / C and
// DB → CB / S, per draft class (players/{id}.SubPositionOverride over the
// synced SubPosition — scripts/syncSubPositions.mjs, from PFF's position,
// which PFF sets by where a player lines up). Mostly for the prospects PFF
// couldn't place. A player can have both (a swing tackle-guard, a
// corner-safety) — the override is then a list, ["G", "C"]; one stays a
// plain string. An old "IOL" (before guards and centers split) shows as
// both G and C, and is saved as them the next time he's set. The Draft Sim reads them from the class snapshots
// (compSnapshots/class_{year}_{pos}), so a save patches his row there too —
// no Rebuild Site Snapshots needed.
import { useEffect, useState } from "react";
import { collection, deleteField, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { SIM_YEAR } from "../utils/draftSim/data";

const BLUE = "#0055a5";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };
const SUBS = { OL: ["OT", "G", "C"], DB: ["CB", "S"] };
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => (x === "IOL" ? ["G", "C"] : [x]));
const hasSub = (p) => asList(p.SubPositionOverride).length > 0 || !!p.SubPosition;

// His row (or hidden entry) in the class snapshot takes the new sub-position(s).
async function patchSnapshot(p, sp) {
  const ref = doc(db, "compSnapshots", `class_${p.Eligible}_${p.Position}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const { rows = [], hidden = {} } = snap.data();
  const put = (r) => { const out = { ...r }; delete out.sp; return sp ? { ...out, sp } : out; };
  const i = rows.findIndex((r) => r.i === p.id);
  if (i >= 0) await updateDoc(ref, { rows: rows.map((r, j) => (j === i ? put(r) : r)) });
  else if (hidden[p.id]) await updateDoc(ref, { [`hidden.${p.id}`]: put(hidden[p.id]) });
}

export default function AdminSubPositions() {
  const [players, setPlayers] = useState(null);
  const [year, setYear] = useState(String(SIM_YEAR));
  const [missingOnly, setMissingOnly] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getDocs(query(collection(db, "players"), where("Position", "in", Object.keys(SUBS))))
      .then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !(p.Live === false || p.Live === "false" || p.Live === "no"))
        .sort((a, b) => (a.Position + a.Last).localeCompare(b.Position + b.Last))))
      .catch((e) => setError(e.message));
  }, []);

  // subs: the sub-positions to save, in SUBS order; none = back to PFF's.
  const set = async (p, subs) => {
    const value = subs.length > 1 ? subs : subs[0] || null;
    try {
      await updateDoc(doc(db, "players", p.id), { SubPositionOverride: value || deleteField() });
      await patchSnapshot(p, value || p.SubPosition || null);
      setPlayers((all) => all.map((x) => (x.id === p.id ? { ...x, SubPositionOverride: value || undefined } : x)));
    } catch (e) {
      setError(e.message);
    }
  };
  // Each button adds or takes off its sub-position — never the last one.
  const toggle = (p, s, current) => {
    const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s];
    if (next.length) set(p, SUBS[p.Position].filter((x) => next.includes(x)));
  };

  if (error) return <div style={{ padding: 20, color: "#c8102e" }}>{error}</div>;
  if (!players) return <div style={{ padding: 20, color: "#777" }}>Loading OL and DBs…</div>;
  const years = [...new Set(players.map((p) => String(p.Eligible || "")).filter(Boolean))].sort();
  const missingIn = (y) => players.filter((p) => String(p.Eligible) === y && !hasSub(p)).length;
  const inYear = players.filter((p) => String(p.Eligible) === year);
  const missing = inYear.filter((p) => !hasSub(p));
  const shown = missingOnly ? missing : inYear;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ ...card, padding: "14px 16px", fontSize: "13px", color: "#33415a", lineHeight: 1.5 }}>
        Team needs split OL into tackles, guards and centers, and DBs into corners and safeties. Most prospects get theirs from PFF
        (scripts/syncSubPositions.mjs, run with the PFF sync); set the rest here, or correct one. Click more than one for a player who
        plays either. An OL or DB with none counts an equal share toward each in the Draft Sim. Changes reach the sim after the next <b>Rebuild Site Snapshots</b>.
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {years.map((y) => {
          const n = missingIn(y);
          return (
            <button key={y} onClick={() => setYear(y)} style={{
              border: `1px solid ${year === y ? BLUE : "#d5dce6"}`, background: year === y ? BLUE : "#fff", color: year === y ? "#fff" : "#33415a",
              borderRadius: "999px", padding: "5px 14px", fontWeight: 900, fontSize: "12px", cursor: "pointer",
            }}>{y}{n > 0 && <span style={{ marginLeft: 6, opacity: 0.75 }}>({n})</span>}</button>
          );
        })}
      </div>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", background: "#f7f9fc", borderBottom: "1px solid #eef1f5", fontSize: "12px", fontWeight: 800 }}>
          <span>{missing.length} of {inYear.length} without a sub-position</span>
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only
          </label>
        </div>
        {shown.map((p) => {
          const current = asList(p.SubPositionOverride).length ? asList(p.SubPositionOverride) : asList(p.SubPosition);
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 16px", borderTop: "1px solid #eef1f5", fontSize: "13px" }}>
              <span style={{ fontWeight: 900, color: BLUE, width: "34px" }}>{p.Position}</span>
              <span style={{ fontWeight: 800, color: "#0f1b2d", minWidth: 0, flex: 1 }}>{p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 600 }}>· {p.School}</span></span>
              {p.SubPosition && <span style={{ fontSize: "11px", color: "#8a97ab" }}>PFF: {p.SubPosition}</span>}
              {SUBS[p.Position].map((s) => (
                <button key={s} onClick={() => toggle(p, s, current)} aria-pressed={current.includes(s)} style={{
                  border: `1px solid ${current.includes(s) ? BLUE : "#d5dce6"}`, background: current.includes(s) ? BLUE : "#fff", color: current.includes(s) ? "#fff" : "#33415a",
                  borderRadius: "999px", padding: "4px 12px", fontWeight: 800, fontSize: "11px", cursor: "pointer",
                }}>{s}</button>
              ))}
              <button onClick={() => set(p, [])} disabled={!p.SubPositionOverride} title="Back to PFF's" style={{ border: "none", background: "none", color: p.SubPositionOverride ? BLUE : "#c9d2de", fontSize: "11px", fontWeight: 800, cursor: p.SubPositionOverride ? "pointer" : "default", textDecoration: "underline" }}>
                Reset
              </button>
            </div>
          );
        })}
        {!shown.length && <div style={{ padding: "16px", color: "#5b6b84", fontSize: "13px" }}>Every {year} OL and DB has a sub-position.</div>}
      </div>
    </div>
  );
}
