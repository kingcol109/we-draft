// src/components/AdminProspectRoles.jsx
//
// Admin → Players → Data Management → Roles: the jobs a draft prospect can
// fill within his position (engine ROLES — 3rd Down RB, Slot WR, Nose
// Tackle, Slot Corner…), per draft class — players/{id}.Roles, a list of
// role keys. The Draft Sim's role needs pull only the prospects given that
// role here (engine roleFit), so an untagged prospect fills his position's
// need but no role's. The class snapshots (utils/snapshotBuilders.js ro)
// carry them to the sim after the next Rebuild Site Snapshots.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { SIM_YEAR } from "../utils/draftSim/data";
import { ROLES, rolesFor } from "../utils/draftSim/engine";

const BLUE = "#0055a5";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };
// The positions with roles, in ROLES order.
const POSITIONS = [...new Set(ROLES.flatMap((r) => r.pos))];
const rolesAt = rolesFor;
const pill = (on) => ({
  border: `1px solid ${on ? BLUE : "#d5dce6"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : "#33415a",
  borderRadius: "999px", padding: "4px 12px", fontWeight: 800, fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap",
});

export default function AdminProspectRoles() {
  const [players, setPlayers] = useState(null);
  const [year, setYear] = useState(String(SIM_YEAR));
  const [pos, setPos] = useState(POSITIONS[0]);
  const [search, setSearch] = useState("");
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getDocs(query(collection(db, "players"), where("Position", "in", POSITIONS)))
      .then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !(p.Live === false || p.Live === "false" || p.Live === "no"))
        .sort((a, b) => (a.Last || "").localeCompare(b.Last || ""))))
      .catch((e) => setError(e.message));
  }, []);

  const toggle = async (p, key) => {
    const cur = p.Roles || [];
    const next = rolesAt(p.Position).map((r) => r.key).filter((k) => (k === key ? !cur.includes(k) : cur.includes(k)));
    try {
      await updateDoc(doc(db, "players", p.id), { Roles: next.length ? next : deleteField() });
      setPlayers((all) => all.map((x) => (x.id === p.id ? { ...x, Roles: next } : x)));
    } catch (e) {
      setError(e.message);
    }
  };

  const years = useMemo(() => [...new Set((players || []).map((p) => String(p.Eligible || "")).filter(Boolean))].sort(), [players]);
  if (error) return <div style={{ padding: 20, color: "#c8102e" }}>{error}</div>;
  if (!players) return <div style={{ padding: 20, color: "#777" }}>Loading prospects…</div>;
  const inClass = players.filter((p) => String(p.Eligible) === year);
  const tagged = (p) => (p.Roles || []).length > 0;
  const q = search.trim().toLowerCase();
  const shown = inClass.filter((p) => p.Position === pos && (!untaggedOnly || !tagged(p))
    && (!q || `${p.First} ${p.Last} ${p.School}`.toLowerCase().includes(q)));
  const counts = Object.fromEntries(rolesAt(pos).map((r) => [r.key, inClass.filter((p) => p.Position === pos && (p.Roles || []).includes(r.key)).length]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ ...card, padding: "14px 16px", fontSize: "13px", color: "#33415a", lineHeight: 1.5 }}>
        Roles are the jobs within a position a team can need — a slot receiver, a nose tackle, a slot corner. In the Draft Sim a
        team&apos;s role need only pulls the prospects given that role here; everyone still fills his position. A prospect can have
        more than one. Changes reach the sim after the next <b>Rebuild Site Snapshots</b>.
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {years.map((y) => <button key={y} onClick={() => setYear(y)} style={pill(year === y)}>{y}</button>)}
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {POSITIONS.map((x) => {
          const n = inClass.filter((p) => p.Position === x).length;
          const t = inClass.filter((p) => p.Position === x && tagged(p)).length;
          return <button key={x} onClick={() => setPos(x)} style={pill(pos === x)}>{x} <span style={{ opacity: 0.75 }}>({t}/{n})</span></button>;
        })}
      </div>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "10px 16px", background: "#f7f9fc", borderBottom: "1px solid #eef1f5", fontSize: "12px", fontWeight: 800 }}>
          <span>{rolesAt(pos).map((r) => `${r.name}: ${counts[r.key]}`).join(" · ")}</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or school"
            style={{ marginLeft: "auto", border: "1px solid #d5dce6", borderRadius: "999px", padding: "5px 12px", fontSize: "12px", width: "200px" }} />
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input type="checkbox" checked={untaggedOnly} onChange={(e) => setUntaggedOnly(e.target.checked)} /> No role yet
          </label>
        </div>
        {shown.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "8px 16px", borderTop: "1px solid #eef1f5", fontSize: "13px" }}>
            <span style={{ fontWeight: 800, color: "#0f1b2d", minWidth: "220px", flex: 1 }}>
              {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 600 }}>· {p.School}</span>
              {(p.SubPositionOverride || p.SubPosition) && <span style={{ color: "#8a97ab", fontWeight: 600 }}> · {[].concat(p.SubPositionOverride || p.SubPosition).join("/")}</span>}
            </span>
            {rolesAt(p.Position).map((r) => (
              <button key={r.key} onClick={() => toggle(p, r.key)} aria-pressed={(p.Roles || []).includes(r.key)} style={pill((p.Roles || []).includes(r.key))}>{r.name}</button>
            ))}
          </div>
        ))}
        {!shown.length && <div style={{ padding: "16px", color: "#5b6b84", fontSize: "13px" }}>No {year} {pos} prospects{untaggedOnly ? " without a role" : ""}{q ? " match" : ""}.</div>}
      </div>
    </div>
  );
}
