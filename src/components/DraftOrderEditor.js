// src/components/DraftOrderEditor.js
//
// Admin → Players → Content → Draft Order: edits the projected draft order
// for the upcoming classes. Each class is its own collection, the same ones
// CreateMock.jsx reads to seed a new mock (keep PROJECTED_ORDERS in sync
// with its orderCollectionMap):
//   draftOrder2027/{r1p1..}, draftOrder2028/{r1p1..}
// One doc per pick: { Round, Pick, Team (the original owner), Traded (the
// team that holds it now, when it changed hands), Selection, updatedAt }.
// The live 2026 order (`draftOrder`) is the draft tracker's, not this.
//
// Reordering moves a team's pick (Team + Traded) between slots; the slot's
// Round/Pick stay put. Selection is never touched here.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../firebase";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
const PROJECTED_ORDERS = [
  { year: "2027", collection: "draftOrder2027" },
  { year: "2028", collection: "draftOrder2028" },
];

const slotKey = (p) => `r${p.Round}p${p.Pick}`;

export default function DraftOrderEditor() {
  const [year, setYear] = useState(PROJECTED_ORDERS[0].year);
  const [teams, setTeams] = useState([]);
  const [saved, setSaved] = useState(null); // picks as loaded / last saved
  const [picks, setPicks] = useState(null); // working copy
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const colName = PROJECTED_ORDERS.find((o) => o.year === year).collection;

  useEffect(() => {
    getDocs(collection(db, "nfl"))
      .then((snap) => setTeams(snap.docs.map((d) => ({ abbr: d.id, ...d.data() })).sort((a, b) => a.abbr.localeCompare(b.abbr))))
      .catch((e) => console.error("Draft order teams load error:", e));
  }, []);

  useEffect(() => {
    let live = true;
    setPicks(null);
    setSaved(null);
    setMsg("");
    getDocs(collection(db, colName))
      .then((snap) => {
        if (!live) return;
        const rows = snap.docs
          .map((d) => {
            const x = d.data();
            return { id: d.id, Round: Number(x.Round), Pick: Number(x.Pick), Team: x.Team || "", Traded: x.Traded || "" };
          })
          .sort((a, b) => a.Round - b.Round || a.Pick - b.Pick);
        setSaved(rows);
        setPicks(rows);
      })
      .catch((e) => { console.error("Draft order load error:", e); if (live) { setMsg("Failed to load — check console."); setPicks([]); setSaved([]); } });
    return () => { live = false; };
  }, [colName]);

  const teamsByAbbr = useMemo(() => new Map(teams.map((t) => [t.abbr, t])), [teams]);
  const savedById = useMemo(() => new Map((saved || []).map((p) => [p.id, p])), [saved]);
  const changedIds = useMemo(
    () => new Set((picks || []).filter((p) => { const s = savedById.get(p.id); return !s || s.Team !== p.Team || s.Traded !== p.Traded; }).map((p) => p.id)),
    [picks, savedById],
  );
  // Every team should own exactly one original pick per round.
  const dupes = useMemo(() => {
    const seen = new Map();
    (picks || []).forEach((p) => { const k = `${p.Round}:${p.Team}`; seen.set(k, (seen.get(k) || 0) + 1); });
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  }, [picks]);

  const setField = (idx, field, value) =>
    setPicks((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value, ...(field === "Team" && p.Traded === value ? { Traded: "" } : {}) } : p)));

  // Moves the team holding slot `from` to slot `to` (same round only),
  // shifting the picks in between — slots keep their Round/Pick.
  const move = (from, to) => {
    setPicks((prev) => {
      if (to < 0 || to >= prev.length || prev[from].Round !== prev[to].Round) return prev;
      const owners = prev.map((p) => ({ Team: p.Team, Traded: p.Traded }));
      const [moved] = owners.splice(from, 1);
      owners.splice(to, 0, moved);
      return prev.map((p, i) => ({ ...p, ...owners[i] }));
    });
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const batch = writeBatch(db);
      picks.filter((p) => changedIds.has(p.id)).forEach((p) => {
        batch.set(doc(db, colName, p.id || slotKey(p)), {
          Round: p.Round, Pick: p.Pick, Team: p.Team,
          Traded: p.Traded ? p.Traded : deleteField(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      setSaved(picks);
      setMsg(`Saved ${changedIds.size} pick${changedIds.size === 1 ? "" : "s"}.`);
    } catch (e) {
      console.error("Draft order save error:", e);
      setMsg("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const select = { padding: "5px 8px", fontSize: "12px", fontWeight: 800, border: "1px solid #c9d3e0", borderRadius: "6px", background: "#fff" };
  const th = { padding: "8px 10px", fontSize: "10px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", borderBottom: "2px solid #e3e8ef" };
  const td = { padding: "5px 10px", fontSize: "13px", fontWeight: 700, color: INK, borderBottom: "1px solid #f0f0f0" };
  const teamOptions = teams.map((t) => <option key={t.abbr} value={t.abbr}>{t.abbr} — {t.City} {t.Team}</option>);
  const logo = (abbr) => teamsByAbbr.get(abbr)?.Logo1;

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden", maxWidth: "900px" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Projected Draft Order</span>
        {PROJECTED_ORDERS.map((o) => (
          <button key={o.year} type="button" onClick={() => setYear(o.year)} disabled={saving}
            style={{ padding: "4px 12px", fontWeight: 900, fontSize: "12px", border: "2px solid #fff", borderRadius: "14px", cursor: "pointer", background: year === o.year ? "#fff" : "transparent", color: year === o.year ? BLUE : "#fff" }}>
            {o.year}
          </button>
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
          {msg && <span style={{ fontSize: "12px", fontWeight: 800, color: msg.startsWith("Failed") ? "#ffd2cc" : "#d4f5d6" }}>{msg}</span>}
          <button type="button" disabled={!changedIds.size || saving} onClick={() => { setPicks(saved); setMsg(""); }}
            style={{ background: "transparent", color: "#fff", border: "2px solid #fff", borderRadius: "6px", padding: "4px 10px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: changedIds.size ? "pointer" : "default", opacity: changedIds.size ? 1 : 0.4 }}>
            Reset
          </button>
          <button type="button" disabled={!changedIds.size || saving} onClick={save}
            style={{ background: GOLD, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 14px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: changedIds.size ? "pointer" : "default", opacity: changedIds.size && !saving ? 1 : 0.5 }}>
            {saving ? "Saving…" : `Save${changedIds.size ? ` (${changedIds.size})` : ""}`}
          </button>
        </span>
      </div>
      <div style={{ padding: "8px 16px", fontSize: "11px", fontWeight: 700, color: "#7a8597", background: "#f5f7fa", borderBottom: "1px solid #eee" }}>
        Drag a row (or use ▲▼) to move a team's pick. "Owned by" is who holds it after a trade. This is the order Create Mock starts a {year} mock from.
      </div>
      {dupes.size > 0 && (
        <div style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 800, color: RED, background: "#fff1ef", borderBottom: "1px solid #f5d0ca" }}>
          ⚠ A team has more than one original pick in a round: {[...dupes].map((k) => { const [r, t] = k.split(":"); return `${t} (R${r})`; }).join(", ")}
        </div>
      )}
      {!picks ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>Loading…</div>
      ) : picks.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "12px" }}>No picks in {colName} yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={{ ...th, width: "60px" }}>Pick</th><th style={th}>Team</th><th style={th}>Owned by</th><th style={{ ...th, width: "70px" }} /></tr>
          </thead>
          <tbody>
            {picks.map((p, i) => {
              const changed = changedIds.has(p.id);
              const owner = p.Traded || p.Team;
              const newRound = i === 0 || picks[i - 1].Round !== p.Round;
              return [
                newRound && (
                  <tr key={`round-${p.Round}`}>
                    <td colSpan={4} style={{ ...td, background: "#eef3fa", fontSize: "11px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Round {p.Round}</td>
                  </tr>
                ),
                <tr key={p.id}
                  draggable
                  onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { if (dragIdx !== null && picks[dragIdx].Round === p.Round) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
                  onDragEnd={() => setDragIdx(null)}
                  style={{ background: dragIdx === i ? "#eaf1ff" : changed ? "#fffbea" : "#fff", cursor: "grab" }}>
                  <td style={{ ...td, fontWeight: 900 }}>
                    <span style={{ color: "#c3cad4", marginRight: "6px" }}>⋮⋮</span>{p.Pick}
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {logo(owner) ? <img src={logo(owner)} alt="" style={{ width: "24px", height: "24px", objectFit: "contain" }} /> : <span style={{ width: "24px" }} />}
                      <select value={p.Team} onChange={(e) => setField(i, "Team", e.target.value)}
                        style={{ ...select, borderColor: dupes.has(`${p.Round}:${p.Team}`) ? RED : "#c9d3e0" }}>
                        {!teamsByAbbr.has(p.Team) && <option value={p.Team}>{p.Team || "—"}</option>}
                        {teamOptions}
                      </select>
                    </div>
                  </td>
                  <td style={td}>
                    <select value={p.Traded} onChange={(e) => setField(i, "Traded", e.target.value)} style={{ ...select, color: p.Traded ? INK : "#9aa5b4" }}>
                      <option value="">Own pick</option>
                      {teams.filter((t) => t.abbr !== p.Team).map((t) => <option key={t.abbr} value={t.abbr}>via trade → {t.abbr}</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {[["▲", i - 1], ["▼", i + 1]].map(([icon, to]) => {
                      const ok = to >= 0 && to < picks.length && picks[to].Round === p.Round;
                      return (
                        <button key={icon} type="button" disabled={!ok} onClick={() => move(i, to)}
                          style={{ border: "1px solid #c9d3e0", background: "#fff", borderRadius: "4px", width: "26px", height: "24px", marginRight: "4px", fontSize: "10px", color: BLUE, cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.3 }}>
                          {icon}
                        </button>
                      );
                    })}
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
