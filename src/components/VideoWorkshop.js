// src/components/VideoWorkshop.js
//
// Admin → Videos → Video Creation → Video Workshop: a shared board of video
// ideas, one player each, with talking points worth putting in the video.
// An idea comes from the Suggest Video panel's "+ Create Video" (title
// prefilled) or from searching a player here. Each idea is a
// videoWorkshop/{id} doc (admin-only): playerId, title, status, notes, kept
// (the talking points the team picked), createdAt/updatedAt.
//
// Talking points (videoFacts.js) are worked out fresh each time an idea is
// opened — CFBD season stats and PFF grades/advanced stats ranked against
// every FBS player, grade trends, recruiting and size. "Keep" saves a
// point's text on the idea so it survives the next refresh.
//
// "Create Video" opens the regular new-video form (Video Management) with
// the player tagged and the title filled in.
//
// PFF data is back office only — never displayed on the public site.
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { loadFactsUniverse, rowFor, factsFor, statsFor, STAT_SCOPES } from "./videoFacts";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
const STATUSES = ["Idea", "Researching", "Scripted", "Filmed", "Published"];
const KIND_LABEL = { stat: "📊 Stat", pff: "🎯 Grade", trend: "📈 Trend", recruit: "⭐ Recruiting", size: "📏 Size" };

const msOf = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : 0);
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Shared with AdminPanel.js VideosSection (Suggest Video's "+ Create Video").
export async function addWorkshopIdea(player, title) {
  const ref = await addDoc(collection(db, "videoWorkshop"), {
    playerId: player.id, title: title || "", status: "Idea", notes: "", kept: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export default function VideoWorkshop({ players, focusId, onCreateVideo }) {
  const [ideas, setIdeas] = useState(null);
  const [selectedId, setSelectedId] = useState(focusId || null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getDocs(collection(db, "videoWorkshop"))
      .then((snap) => setIdeas(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt))))
      .catch((e) => { console.error("Workshop load error:", e); setError("Couldn't load the workshop — check console."); setIdeas([]); });
  }, []);
  useEffect(() => { if (focusId) setSelectedId(focusId); }, [focusId]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const searchResults = useMemo(() => {
    const t = norm(q);
    if (t.length < 2) return [];
    return players.filter((p) => norm(`${p.First} ${p.Last}`).includes(t) || norm(p.School).includes(t)).slice(0, 8);
  }, [players, q]);

  const addIdea = async (player) => {
    try {
      const id = await addWorkshopIdea(player, "");
      setIdeas((prev) => [{ id, playerId: player.id, title: "", status: "Idea", notes: "", kept: [], createdAt: { seconds: Date.now() / 1000 } }, ...(prev || [])]);
      setSelectedId(id);
      setQ("");
    } catch (e) {
      console.error("Workshop add error:", e);
      alert("Failed to add — check console.");
    }
  };

  const patchIdea = (id, patch) => setIdeas((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeIdea = async (idea) => {
    const p = playersById.get(idea.playerId);
    if (!window.confirm(`Delete the workshop idea for ${p ? `${p.First} ${p.Last}` : "this player"}?`)) return;
    await deleteDoc(doc(db, "videoWorkshop", idea.id));
    setIdeas((prev) => prev.filter((x) => x.id !== idea.id));
    setSelectedId(null);
  };

  const selected = ideas?.find((x) => x.id === selectedId) || null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
        <div style={{ background: BLUE, padding: "10px 16px", color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Video Workshop
        </div>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid #eee", position: "relative" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Add a player…"
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: "13px", fontWeight: 700, border: "2px solid " + BLUE, borderRadius: "8px" }} />
          {searchResults.length > 0 && (
            <div style={{ marginTop: "6px", border: "1px solid #dde3ea", borderRadius: "8px", overflow: "hidden" }}>
              {searchResults.map((p) => (
                <button key={p.id} type="button" onClick={() => addIdea(p)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderBottom: "1px solid #f0f0f0", background: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 800, color: INK }}>
                  {p.First} {p.Last} <span style={{ color: "#7a8597", fontWeight: 700 }}>· {p.Position} · {p.School} · {p.Eligible}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {error && <div style={{ padding: "10px 12px", color: RED, fontWeight: 700, fontSize: "12px" }}>{error}</div>}
        {!ideas ? (
          <div style={{ padding: "18px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>Loading…</div>
        ) : ideas.length === 0 ? (
          <div style={{ padding: "18px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "12px" }}>No ideas yet — add a player above, or use Suggest Video.</div>
        ) : (
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            {ideas.map((idea) => {
              const p = playersById.get(idea.playerId);
              const active = idea.id === selectedId;
              return (
                <button key={idea.id} type="button" onClick={() => setSelectedId(idea.id)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: "1px solid #f0f0f0", borderLeft: "4px solid " + (active ? GOLD : "transparent"), background: active ? "#eaf1ff" : "#fff", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontWeight: 900, fontSize: "13px", color: INK }}>{p ? `${p.First} ${p.Last}` : "Unknown player"}</span>
                    <span style={{ marginLeft: "auto", fontSize: "9px", fontWeight: 900, color: "#8a5a00", background: "#fff3d9", borderRadius: "8px", padding: "1px 6px", textTransform: "uppercase" }}>{idea.status || "Idea"}</span>
                  </div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#7a8597", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {idea.title || (p ? `${p.Position} · ${p.School}` : "")}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected ? (
        <IdeaDetail key={selected.id} idea={selected} player={playersById.get(selected.playerId)} players={players}
          onPatch={(patch) => patchIdea(selected.id, patch)} onDelete={() => removeIdea(selected)} onCreateVideo={onCreateVideo} />
      ) : (
        <div style={{ border: "2px dashed #dde3ea", borderRadius: "10px", padding: "48px 24px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "13px" }}>
          Pick an idea on the left, or add a player to start one.
        </div>
      )}
    </div>
  );
}

function IdeaDetail({ idea, player, players, onPatch, onDelete, onCreateVideo }) {
  const [form, setForm] = useState({ title: idea.title || "", status: idea.status || "Idea", notes: idea.notes || "" });
  const [kept, setKept] = useState(idea.kept || []);
  const [facts, setFacts] = useState(null);
  const [stats, setStats] = useState(null);
  const [showStats, setShowStats] = useState(true);
  const [factError, setFactError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!player) return;
    let live = true;
    loadFactsUniverse(players)
      .then((u) => {
        if (!live) return;
        const row = rowFor(u, player);
        if (!row) { setFacts([]); setStats([]); setFactError("No FBS roster row linked to this player — no stats to rank."); return; }
        setFacts(factsFor(u, row));
        setStats(statsFor(u, row));
      })
      .catch((e) => { console.error("Workshop facts error:", e); if (live) { setFacts([]); setFactError("Couldn't build talking points — check console."); } });
    return () => { live = false; };
  }, [player, players]);

  const save = async (patch) => {
    setSaving(true);
    setSaved("");
    try {
      await updateDoc(doc(db, "videoWorkshop", idea.id), { ...patch, updatedAt: serverTimestamp() });
      onPatch(patch);
      setSaved("Saved.");
    } catch (e) {
      console.error("Workshop save error:", e);
      setSaved("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const toggleKeep = (text) => {
    const next = kept.includes(text) ? kept.filter((t) => t !== text) : [...kept, text];
    setKept(next);
    save({ kept: next });
  };

  if (!player) {
    return (
      <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", padding: "20px", color: "#7a8597", fontWeight: 700 }}>
        This idea's player is no longer on We-Draft.
        <button type="button" onClick={onDelete} style={{ marginLeft: "12px", color: RED, background: "none", border: "none", fontWeight: 900, cursor: "pointer" }}>Delete idea</button>
      </div>
    );
  }

  // Kept points that this refresh no longer produces (the stat moved) stay
  // listed under Kept.
  const fresh = facts || [];
  const staleKept = kept.filter((t) => !fresh.some((f) => f.text === t));
  const input = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: "13px", fontWeight: 700, border: "1px solid #c9d3e0", borderRadius: "6px" };
  const label = { fontSize: "10px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" };

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <a href={"/player/" + player.Slug} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontWeight: 900, fontSize: "16px", textDecoration: "none" }}>
          {player.First} {player.Last} <span style={{ color: GOLD }}>↗</span>
        </a>
        <span style={{ color: "#cfe0f5", fontSize: "12px", fontWeight: 700 }}>{player.Position} · {player.School} · {player.Eligible}</span>
        <button type="button" onClick={() => onCreateVideo(player, form.title)}
          style={{ marginLeft: "auto", background: GOLD, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 14px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: "pointer" }}>
          Create Video →
        </button>
        <button type="button" onClick={onDelete}
          style={{ background: "transparent", color: "#fff", border: "2px solid #fff", borderRadius: "6px", padding: "4px 10px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: "pointer" }}>
          Delete
        </button>
      </div>

      <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "1fr 170px", gap: "12px", borderBottom: "1px solid #eee" }}>
        <div>
          <div style={label}>Working title</div>
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={input} placeholder="Video title…" />
        </div>
        <div>
          <div style={label}>Status</div>
          <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} style={input}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <div style={label}>Notes</div>
          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} placeholder="Angle, clips to pull, who to compare him to…" />
        </div>
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "10px" }}>
          <button type="button" disabled={saving} onClick={() => save(form)}
            style={{ background: BLUE, color: "#fff", border: "none", borderRadius: "6px", padding: "7px 16px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span style={{ fontSize: "12px", fontWeight: 700, color: saved.startsWith("Failed") ? RED : "#2e7d32" }}>{saved}</span>}
        </div>
      </div>

      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", background: "#f5f7fa", borderBottom: "1px solid #eee" }}>
        <div style={{ fontSize: "12px", fontWeight: 900, color: INK, textTransform: "uppercase", letterSpacing: "0.06em" }}>Season stats</div>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#7a8597" }}>Rank among FBS players · at his position · in his conference · in his draft class</div>
        <button type="button" onClick={() => setShowStats((s) => !s)}
          style={{ marginLeft: "auto", background: "transparent", color: BLUE, border: "none", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: "pointer" }}>
          {showStats ? "Hide ▴" : "Show ▾"}
        </button>
      </div>
      {showStats && <StatsTable stats={stats} error={factError} />}

      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", background: "#f5f7fa", borderBottom: "1px solid #eee", borderTop: "1px solid #eee" }}>
        <div style={{ fontSize: "12px", fontWeight: 900, color: INK, textTransform: "uppercase", letterSpacing: "0.06em" }}>Talking points</div>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#7a8597" }}>Ranked against every FBS player · ✓ Keep to save one on this idea</div>
      </div>
      {(kept.length > 0) && (
        <div style={{ padding: "10px 16px", borderBottom: "1px solid #eee" }}>
          <div style={{ ...label, color: "#2e7d32" }}>Kept ({kept.length})</div>
          {kept.map((t) => (
            <FactRow key={t} text={t} kept onToggle={() => toggleKeep(t)} stale={staleKept.includes(t)} />
          ))}
        </div>
      )}
      {!facts ? (
        <div style={{ padding: "22px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>Crunching every FBS player… (first time takes a few seconds)</div>
      ) : factError ? (
        <div style={{ padding: "18px 16px", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>{factError}</div>
      ) : fresh.length === 0 ? (
        <div style={{ padding: "18px 16px", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>Nothing stands out nationally yet — try his conference or class angle in the notes.</div>
      ) : (
        <div style={{ padding: "6px 16px 14px" }}>
          {fresh.filter((f) => !kept.includes(f.text)).map((f) => (
            <FactRow key={f.text} text={f.text} kind={f.kind} src={f.src} onToggle={() => toggleKeep(f.text)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Season stats with ranks: top 10 in a scope in green, top 25 in blue.
function StatsTable({ stats, error }) {
  if (!stats) return <div style={{ padding: "18px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>Loading stats…</div>;
  if (!stats.length) return <div style={{ padding: "14px 16px", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>{error || "No season stats yet."}</div>;
  const th = { padding: "6px 10px", fontSize: "10px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", borderBottom: "2px solid #e3e8ef", whiteSpace: "nowrap" };
  const td = { padding: "5px 10px", fontSize: "12px", fontWeight: 700, color: "#1d2733", borderBottom: "1px solid #f3f4f6", whiteSpace: "nowrap" };
  const rankCell = (x) => {
    if (!x) return <span style={{ color: "#c3cad4" }}>—</span>;
    const color = x.rank <= 10 ? "#2e7d32" : x.rank <= 25 ? BLUE : "#3b4756";
    return (
      <span style={{ color, fontWeight: x.rank <= 25 ? 900 : 700 }}>
        {x.tied ? "T-" : "#"}{x.rank}<span style={{ color: "#9aa5b4", fontWeight: 700, fontSize: "10px" }}> /{x.of.toLocaleString()}</span>
      </span>
    );
  };
  const rows = [];
  let lastGroup = null;
  stats.forEach((s) => {
    const group = `${s.src}:${s.group}`;
    if (group !== lastGroup) {
      rows.push(
        <tr key={group}>
          <td colSpan={7} style={{ ...td, paddingTop: "10px", fontSize: "10px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {s.group}{s.src === "PFF" && <span style={{ color: RED }}> · PFF</span>}
          </td>
        </tr>,
      );
      lastGroup = group;
    }
    rows.push(
      <tr key={`${s.src}-${s.label}`}>
        <td style={td}>{s.label}</td>
        <td style={{ ...td, fontWeight: 900 }}>{s.value}</td>
        {STAT_SCOPES.map((sc) => <td key={sc.key} style={td}>{rankCell(s.ranks[sc.key])}</td>)}
        <td style={{ ...td, fontSize: "10px", color: "#9aa5b4" }}>{s.qualified ? "" : "not enough volume to rank"}</td>
      </tr>,
    );
  });
  return (
    <div style={{ overflowX: "auto", padding: "4px 6px 10px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Stat</th><th style={th}>Value</th>
            {STAT_SCOPES.map((s) => <th key={s.key} style={th}>{s.label}</th>)}
            <th style={th} />
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

function FactRow({ text, kind, src, kept, stale, onToggle }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: "1px solid #f3f4f6" }}>
      <button type="button" onClick={onToggle} title={kept ? "Remove from kept" : "Keep this point"}
        style={{ flexShrink: 0, width: "62px", padding: "3px 0", borderRadius: "12px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: "pointer", border: "2px solid #2e7d32", background: kept ? "#2e7d32" : "#fff", color: kept ? "#fff" : "#2e7d32" }}>
        {kept ? "✓ Kept" : "Keep"}
      </button>
      <div style={{ flex: 1, fontSize: "13px", fontWeight: 700, color: stale ? "#9aa5b4" : "#1d2733" }}>
        {text}{stale && <span style={{ fontSize: "10px", fontWeight: 800, color: "#9aa5b4" }}> (no longer current)</span>}
      </div>
      {kind && <span style={{ flexShrink: 0, fontSize: "10px", fontWeight: 800, color: "#7a8597" }}>{KIND_LABEL[kind]}</span>}
      {src && <span style={{ flexShrink: 0, fontSize: "9px", fontWeight: 900, borderRadius: "8px", padding: "1px 6px", background: src === "PFF" ? "#ffe9e4" : "#e8f0fb", color: src === "PFF" ? RED : BLUE }}>{src}</span>}
    </div>
  );
}
