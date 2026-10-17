// src/components/VideoConcepts.js
//
// Admin → Videos → Video Creation → Concepts: planning video concepts and
// the series they belong to, before anything is filmed. Two lists:
//   - Videos — one concept each: title, notes, tagged players, an optional
//     Date (a dated concept shows on the Content Calendar, see
//     ContentCalendarManager.js's conceptEntries), and an optional Series.
//     Picking a series can just tag it, or "Prefill from series" copies the
//     series' notes and players onto the concept.
//   - Series — a recurring format. No date; it's tagged to a Period
//     (In-Season, Off Season, Pre-Season) instead.
// Both live in videoConcepts/{id} (admin-only), split by `kind`:
//   { kind: "video", title, notes, playerIds, date (UTC midnight | null),
//     seriesId, status, createdAt, updatedAt }
//   { kind: "series", title, notes, playerIds, period, createdAt, updatedAt }
//
// "Create Video" opens the regular new-video form (Video Management) with
// the first three players tagged and the title/date filled in.
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0b1a2e";
const RED = "#c0392b";
export const SERIES_PERIODS = ["Pre-Season", "In-Season", "Off Season"];
const PERIOD_COLOR = { "Pre-Season": "#7c3aed", "In-Season": "#2e7d32", "Off Season": "#b45309" };
const STATUSES = ["Concept", "Researching", "Scripted", "Filmed", "Published"];

const msOf = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : ts instanceof Date ? ts.getTime() : 0);
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// Dates are stored as UTC midnight, same as videos.Date / contentCalendar.date.
const toDateInput = (ts) => {
  const ms = msOf(ts);
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
};
const fromDateInput = (s) => (s ? new Date(s + "T00:00:00Z") : null);
const fmtDate = (ts) => {
  const ms = msOf(ts);
  return ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
};

const BLANK = {
  video: { kind: "video", title: "", notes: "", playerIds: [], date: "", seriesId: "", status: "Concept" },
  series: { kind: "series", title: "", notes: "", playerIds: [], period: SERIES_PERIODS[1] },
};

export default function VideoConcepts({ players, onCreateVideo }) {
  const [concepts, setConcepts] = useState(null);
  const [view, setView] = useState("video"); // "video" | "series"
  const [selectedId, setSelectedId] = useState(null); // doc id, or "new"
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(""); // series id or period filter for the list

  useEffect(() => {
    getDocs(collection(db, "videoConcepts"))
      .then((snap) => setConcepts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => { console.error("Concepts load error:", e); setError("Couldn't load concepts — check console."); setConcepts([]); });
  }, []);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const series = useMemo(
    () => (concepts || []).filter((c) => c.kind === "series").sort((a, b) => (a.title || "").localeCompare(b.title || "")),
    [concepts],
  );
  const seriesById = useMemo(() => new Map(series.map((s) => [s.id, s])), [series]);

  // Videos: dated ones first, soonest first; undated after, newest first.
  const videos = useMemo(() => {
    return (concepts || [])
      .filter((c) => c.kind === "video")
      .filter((c) => !filter || c.seriesId === filter)
      .sort((a, b) => {
        const da = msOf(a.date), dbb = msOf(b.date);
        if (da && dbb) return da - dbb;
        if (da || dbb) return da ? -1 : 1;
        return msOf(b.createdAt) - msOf(a.createdAt);
      });
  }, [concepts, filter]);
  const seriesList = useMemo(() => series.filter((s) => !filter || s.period === filter), [series, filter]);

  const switchView = (v) => { setView(v); setSelectedId(null); setFilter(""); };
  const selected = selectedId === "new" ? null : (concepts || []).find((c) => c.id === selectedId) || null;

  const handleSaved = (saved, isNew) => {
    setConcepts((prev) => (isNew ? [saved, ...prev] : prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c))));
    setSelectedId(saved.id);
  };
  const handleDelete = async (c) => {
    const usedBy = c.kind === "series" ? (concepts || []).filter((x) => x.seriesId === c.id) : [];
    const msg = `Delete "${c.title || "this " + c.kind}"?` + (usedBy.length ? ` ${usedBy.length} video concept(s) are tagged to it and will be untagged.` : "");
    if (!window.confirm(msg)) return;
    try {
      await deleteDoc(doc(db, "videoConcepts", c.id));
      await Promise.all(usedBy.map((x) => updateDoc(doc(db, "videoConcepts", x.id), { seriesId: "", updatedAt: serverTimestamp() })));
      setConcepts((prev) => prev.filter((x) => x.id !== c.id).map((x) => (x.seriesId === c.id ? { ...x, seriesId: "" } : x)));
      setSelectedId(null);
    } catch (e) {
      console.error("Concept delete error:", e);
      alert("Failed to delete — check console.");
    }
  };

  const list = view === "video" ? videos : seriesList;

  return (
    <div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
        {[["video", "Videos"], ["series", "Series"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => switchView(k)}
            style={{ padding: "5px 16px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em", border: "2px solid " + BLUE, borderRadius: "8px", cursor: "pointer", background: view === k ? BLUE : "#fff", color: view === k ? "#fff" : BLUE }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "18px", alignItems: "start" }}>
        <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center" }}>
            <span style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {view === "video" ? "Video Concepts" : "Series"}
            </span>
            <button type="button" onClick={() => setSelectedId("new")}
              style={{ marginLeft: "auto", background: GOLD, color: "#fff", border: "none", borderRadius: "6px", padding: "4px 12px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: "pointer" }}>
              + New
            </button>
          </div>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", fontSize: "12px", fontWeight: 700, border: "1px solid #c9d3e0", borderRadius: "6px" }}>
              {view === "video" ? (
                <>
                  <option value="">All series</option>
                  {series.map((s) => <option key={s.id} value={s.id}>{s.title || "Untitled series"}</option>)}
                </>
              ) : (
                <>
                  <option value="">All periods</option>
                  {SERIES_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                </>
              )}
            </select>
          </div>
          {error && <div style={{ padding: "10px 12px", color: RED, fontWeight: 700, fontSize: "12px" }}>{error}</div>}
          {!concepts ? (
            <div style={{ padding: "18px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "12px" }}>Loading…</div>
          ) : list.length === 0 ? (
            <div style={{ padding: "18px", textAlign: "center", color: "#999", fontWeight: 700, fontSize: "12px" }}>
              {view === "video" ? "No video concepts yet." : "No series yet."} Hit + New to start one.
            </div>
          ) : (
            <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
              {list.map((c) => {
                const active = c.id === selectedId;
                const s = c.kind === "video" ? seriesById.get(c.seriesId) : null;
                const names = (c.playerIds || []).map((id) => playersById.get(id)).filter(Boolean).map((p) => p.Last).join(", ");
                const badge = c.kind === "series" ? c.period : fmtDate(c.date);
                return (
                  <button key={c.id} type="button" onClick={() => setSelectedId(c.id)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: "none", borderBottom: "1px solid #f0f0f0", borderLeft: "4px solid " + (active ? GOLD : "transparent"), background: active ? "#eaf1ff" : "#fff", cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontWeight: 900, fontSize: "13px", color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "Untitled"}</span>
                      {badge && (
                        <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: "9px", fontWeight: 900, borderRadius: "8px", padding: "1px 6px", textTransform: "uppercase", color: "#fff", background: c.kind === "series" ? PERIOD_COLOR[c.period] || BLUE : BLUE }}>
                          {badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#7a8597", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[s && `📺 ${s.title}`, c.kind === "video" && c.status, names].filter(Boolean).join(" · ") || "No players yet"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedId ? (
          <ConceptEditor
            key={`${view}:${selectedId}`}
            concept={selected || { ...BLANK[view] }}
            isNew={selectedId === "new"}
            players={players}
            playersById={playersById}
            series={series}
            seriesById={seriesById}
            onSaved={handleSaved}
            onDelete={() => selected && handleDelete(selected)}
            onCreateVideo={onCreateVideo}
          />
        ) : (
          <div style={{ border: "2px dashed #dde3ea", borderRadius: "10px", padding: "48px 24px", textAlign: "center", color: "#7a8597", fontWeight: 700, fontSize: "13px" }}>
            {view === "video"
              ? "Pick a video concept on the left, or hit + New. Give it a date to put it on the Content Calendar."
              : "Pick a series on the left, or hit + New. Video concepts can be tagged to a series or prefilled from it."}
          </div>
        )}
      </div>
    </div>
  );
}

function ConceptEditor({ concept, isNew, players, playersById, series, seriesById, onSaved, onDelete, onCreateVideo }) {
  const isVideo = concept.kind === "video";
  const [form, setForm] = useState(() => ({
    ...concept,
    playerIds: concept.playerIds || [],
    date: isVideo ? toDateInput(concept.date) : undefined,
  }));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const searchResults = useMemo(() => {
    const t = norm(q);
    if (t.length < 2) return [];
    return players
      .filter((p) => !form.playerIds.includes(p.id))
      .filter((p) => norm(`${p.First} ${p.Last}`).includes(t) || norm(p.School).includes(t))
      .slice(0, 8);
  }, [players, q, form.playerIds]);

  const addPlayer = (p) => { set({ playerIds: [...form.playerIds, p.id] }); setQ(""); };
  const removePlayer = (id) => set({ playerIds: form.playerIds.filter((x) => x !== id) });

  // Copies the series' notes and players onto this concept, keeping anything
  // already here (players are merged, notes appended).
  const prefillFromSeries = () => {
    const s = seriesById.get(form.seriesId);
    if (!s) return;
    const mergedPlayers = [...form.playerIds, ...(s.playerIds || []).filter((id) => !form.playerIds.includes(id))];
    const notes = !form.notes.trim() ? s.notes || "" : s.notes && !form.notes.includes(s.notes) ? `${form.notes}\n\n${s.notes}` : form.notes;
    set({ playerIds: mergedPlayers, notes, title: form.title || (s.title ? `${s.title}: ` : "") });
    setMsg("Prefilled from series — Save to keep.");
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    const payload = {
      kind: concept.kind,
      title: (form.title || "").trim(),
      notes: form.notes || "",
      playerIds: form.playerIds,
      ...(isVideo
        ? { date: fromDateInput(form.date), seriesId: form.seriesId || "", status: form.status || "Concept" }
        : { period: form.period || SERIES_PERIODS[1] }),
      updatedAt: serverTimestamp(),
    };
    try {
      if (isNew) {
        const ref = await addDoc(collection(db, "videoConcepts"), { ...payload, createdAt: serverTimestamp() });
        onSaved({ id: ref.id, ...payload, createdAt: new Date(), updatedAt: new Date() }, true);
      } else {
        await updateDoc(doc(db, "videoConcepts", concept.id), payload);
        onSaved({ id: concept.id, ...payload, updatedAt: new Date() }, false);
      }
      setMsg("Saved.");
    } catch (e) {
      console.error("Concept save error:", e);
      setMsg("Failed to save — check console.");
    } finally {
      setSaving(false);
    }
  };

  const input = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: "13px", fontWeight: 700, border: "1px solid #c9d3e0", borderRadius: "6px", fontFamily: "inherit" };
  const label = { fontSize: "10px", fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" };
  const selectedSeries = isVideo ? seriesById.get(form.seriesId) : null;
  const firstPlayers = form.playerIds.map((id) => playersById.get(id)).filter(Boolean);

  return (
    <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ color: "#fff", fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {isNew ? (isVideo ? "New Video Concept" : "New Series") : isVideo ? "Video Concept" : "Series"}
        </span>
        {isVideo && !isNew && onCreateVideo && (
          <button type="button" onClick={() => onCreateVideo({ playerIds: form.playerIds, title: form.title, date: form.date })}
            style={{ marginLeft: "auto", background: GOLD, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 14px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: "pointer" }}>
            Create Video →
          </button>
        )}
        {!isNew && (
          <button type="button" onClick={onDelete}
            style={{ marginLeft: isVideo && onCreateVideo ? 0 : "auto", background: "transparent", color: "#fff", border: "2px solid #fff", borderRadius: "6px", padding: "4px 10px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: "pointer" }}>
            Delete
          </button>
        )}
      </div>

      <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "1fr 170px", gap: "12px" }}>
        {isVideo && (
          <div style={{ gridColumn: "1 / -1", background: "#f5f7fa", border: "1px solid #e3e8ef", borderRadius: "8px", padding: "10px 12px" }}>
            <div style={label}>Series</div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <select value={form.seriesId || ""} onChange={(e) => set({ seriesId: e.target.value })} style={{ ...input, flex: 1 }}>
                <option value="">— No series —</option>
                {series.map((s) => <option key={s.id} value={s.id}>{s.title || "Untitled series"} ({s.period})</option>)}
              </select>
              <button type="button" disabled={!selectedSeries} onClick={prefillFromSeries}
                title="Copy the series' notes and players onto this concept"
                style={{ flexShrink: 0, background: "#fff", color: BLUE, border: "2px solid " + BLUE, borderRadius: "6px", padding: "6px 12px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", cursor: selectedSeries ? "pointer" : "default", opacity: selectedSeries ? 1 : 0.4 }}>
                Prefill from series
              </button>
            </div>
            {series.length === 0 && <div style={{ fontSize: "11px", fontWeight: 700, color: "#9aa5b4", marginTop: "6px" }}>No series yet — create one under Series.</div>}
          </div>
        )}

        <div>
          <div style={label}>{isVideo ? "Title" : "Series name"}</div>
          <input value={form.title} onChange={(e) => set({ title: e.target.value })} style={input} placeholder={isVideo ? "Video title…" : "Series name…"} />
        </div>
        {isVideo ? (
          <div>
            <div style={label}>Date</div>
            <input type="date" value={form.date || ""} onChange={(e) => set({ date: e.target.value })} style={input} />
          </div>
        ) : (
          <div>
            <div style={label}>Period</div>
            <select value={form.period} onChange={(e) => set({ period: e.target.value })} style={input}>
              {SERIES_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        {isVideo && (
          <div>
            <div style={label}>Status</div>
            <select value={form.status || "Concept"} onChange={(e) => set({ status: e.target.value })} style={input}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        {isVideo && (
          <div style={{ alignSelf: "end", fontSize: "11px", fontWeight: 700, color: "#7a8597", paddingBottom: "8px" }}>
            {form.date ? "📅 Shows on the Content Calendar" : "No date — not on the calendar"}
          </div>
        )}

        <div style={{ gridColumn: "1 / -1" }}>
          <div style={label}>Players</div>
          {firstPlayers.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
              {firstPlayers.map((p) => (
                <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#eaf1ff", border: "1px solid #c7d8f2", borderRadius: "14px", padding: "3px 4px 3px 10px", fontSize: "12px", fontWeight: 800, color: INK }}>
                  <a href={"/player/" + p.Slug} target="_blank" rel="noopener noreferrer" style={{ color: INK, textDecoration: "none" }}>{p.First} {p.Last}</a>
                  <span style={{ color: "#7a8597", fontWeight: 700, fontSize: "11px" }}>{p.Position} · {p.School}</span>
                  <button type="button" onClick={() => removePlayer(p.id)} title="Remove"
                    style={{ border: "none", background: "#fff", color: RED, borderRadius: "50%", width: "18px", height: "18px", lineHeight: "16px", fontWeight: 900, cursor: "pointer", padding: 0 }}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="+ Add a player…" style={input} />
          {searchResults.length > 0 && (
            <div style={{ marginTop: "6px", border: "1px solid #dde3ea", borderRadius: "8px", overflow: "hidden" }}>
              {searchResults.map((p) => (
                <button key={p.id} type="button" onClick={() => addPlayer(p)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderBottom: "1px solid #f0f0f0", background: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 800, color: INK }}>
                  {p.First} {p.Last} <span style={{ color: "#7a8597", fontWeight: 700 }}>· {p.Position} · {p.School} · {p.Eligible}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <div style={label}>Notes</div>
          <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={6} style={{ ...input, resize: "vertical" }}
            placeholder={isVideo ? "Angle, clips to pull, talking points…" : "Format, recurring segments, what every episode covers…"} />
        </div>

        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "10px" }}>
          <button type="button" disabled={saving} onClick={save}
            style={{ background: BLUE, color: "#fff", border: "none", borderRadius: "6px", padding: "7px 16px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </button>
          {msg && <span style={{ fontSize: "12px", fontWeight: 700, color: msg.startsWith("Failed") ? RED : "#2e7d32" }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}
