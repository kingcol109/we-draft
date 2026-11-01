// src/components/AdminPhotos.jsx
//
// Admin → Content → Photos. Each player's headshot and action shots, saved
// for YouTube thumbnails (and, later, the share images). Image links, the
// same as team logos — imgur, pasted in. One doc per player in
// playerPhotos/{playerId}:
//   { name, slug, headshot: Photo | null, action: Photo[], updatedAt }
//   Photo: { url, width, height, source, credit, addedAt }
//   — an action shot also has orientation: which way the player is facing,
//   "left" | "center" (toward the camera) | "right".
// Source (where it came from) and credit (who to credit) are kept with
// every photo, so any one can be credited on a page or taken down on request.
// Most headshots come from ESPN's rosters (scripts/importEspnHeadshots.js);
// the players it couldn't match for sure are in config/headshotReview —
// "Needs review" here, with ESPN's likely candidates to pick from.
import { useEffect, useMemo, useState } from "react";
import { arrayUnion, collection, deleteField, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import { sanitizeImgur } from "./MarginAds";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const ORIENTATIONS = ["left", "center", "right"];
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };
const label = { fontSize: "11px", fontWeight: 900, color: "#7a8597", letterSpacing: "0.1em", textTransform: "uppercase" };
const input = { border: "1px solid #d5dbe4", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", fontFamily: "Arial, sans-serif", width: "100%", boxSizing: "border-box" };
const smallBtn = (color, filled) => ({
  border: `1px solid ${color}`, background: filled ? color : "#fff", color: filled ? "#fff" : color,
  borderRadius: "6px", padding: "5px 10px", fontSize: "12px", fontWeight: 800, cursor: "pointer",
});
const FILTERS = [{ key: "all", label: "All" }, { key: "review", label: "Needs review" }, { key: "has", label: "Has photos" }, { key: "noHeadshot", label: "No headshot" }, { key: "noAction", label: "No action shots" }];

// The link as an image: imgur page links become the direct i.imgur.com
// link (MarginAds.js sanitizeImgur, as logos are), then it's loaded to
// check it is one and get its pixel size.
const loadImage = (raw) => new Promise((resolve, reject) => {
  const url = sanitizeImgur(raw.trim());
  if (!/^https:\/\//i.test(url)) { reject(new Error(/imgur\.com\/(a|gallery)\//i.test(raw) ? "That's an imgur album — paste the image's own link." : "Paste an https:// image link.")); return; }
  const img = new Image();
  img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
  img.onerror = () => reject(new Error("That link didn't load as an image."));
  img.src = url;
});

export default function AdminPhotos() {
  const [players, setPlayers] = useState([]);
  const [photos, setPhotos] = useState({}); // { [playerId]: playerPhotos doc }
  const [review, setReview] = useState({}); // config/headshotReview.items
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([getDocs(collection(db, "players")), getDocs(collection(db, "playerPhotos")), getDoc(doc(db, "config", "headshotReview"))])
      .then(([pl, ph, rv]) => {
        setReview(rv.exists() ? rv.data().items || {} : {});
        setPlayers(pl.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last).sort((a, b) => (a.Last || "").localeCompare(b.Last || "") || (a.First || "").localeCompare(b.First || "")));
        setPhotos(Object.fromEntries(ph.docs.map((d) => [d.id, d.data()])));
      })
      .catch((e) => { console.error("Admin photos load error:", e); setErr("Couldn't load players or photos — check console."); })
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter((p) => {
      const ph = photos[p.id];
      if (filter === "review" && !review[p.id]) return false;
      if (filter === "has" && !(ph?.headshot || ph?.action?.length)) return false;
      if (filter === "noHeadshot" && ph?.headshot) return false;
      if (filter === "noAction" && ph?.action?.length) return false;
      return !q || `${p.First || ""} ${p.Last || ""} ${p.School || ""}`.toLowerCase().includes(q);
    });
  }, [players, photos, review, search, filter]);
  const counts = useMemo(() => {
    const docs = Object.values(photos);
    return { headshots: docs.filter((d) => d.headshot).length, action: docs.reduce((n, d) => n + (d.action?.length || 0), 0) };
  }, [photos]);

  const player = players.find((p) => p.id === selectedId) || null;
  const current = (player && photos[player.id]) || { headshot: null, action: [] };

  // Writes the player's doc with these changes and keeps the local copy in step.
  const save = async (changes) => {
    const next = { ...current, ...changes, name: `${player.First || ""} ${player.Last || ""}`.trim(), slug: player.Slug || "" };
    await setDoc(doc(db, "playerPhotos", player.id), { ...next, updatedAt: serverTimestamp() });
    setPhotos((prev) => ({ ...prev, [player.id]: { ...next, updatedAt: Timestamp.now() } }));
  };
  // Runs one change; true when it went through.
  const run = async (key, fn) => {
    setBusy(key); setErr("");
    try { await fn(); return true; } catch (e) { console.error("Admin photos error:", e); setErr(e.message || "Something went wrong — check console."); return false; }
    finally { setBusy(""); }
  };

  const setHeadshot = (link) => run("headshot", async () => {
    const img = await loadImage(link);
    const old = current.headshot;
    // A replacement keeps the source and credit typed for the old one.
    await save({ headshot: { ...img, source: old?.source || "", credit: old?.credit || "", addedAt: Timestamp.now() } });
  });
  const removeHeadshot = () => run("headshot", async () => {
    if (!window.confirm("Remove this headshot?")) return;
    await save({ headshot: null });
  });
  const addAction = (link, orientation) => run("addAction", async () => {
    const img = await loadImage(link);
    if ((current.action || []).some((a) => a.url === img.url)) throw new Error("That action shot is already saved.");
    await save({ action: [...(current.action || []), { ...img, orientation, source: "", credit: "", addedAt: Timestamp.now() }] });
  });
  const removeAction = (i) => run(`action:${i}`, async () => {
    if (!window.confirm("Remove this action shot?")) return;
    await save({ action: current.action.filter((_, j) => j !== i) });
  });
  // Needs review: one of ESPN's candidates is him — or none is (dismissed,
  // so the import doesn't list him again).
  const clearReview = async (dismiss) => {
    await updateDoc(doc(db, "config", "headshotReview"), { [`items.${player.id}`]: deleteField(), ...(dismiss ? { dismissed: arrayUnion(player.id) } : {}) });
    setReview((prev) => { const next = { ...prev }; delete next[player.id]; return next; });
  };
  const pickCandidate = (c) => run("headshot", async () => {
    const img = await loadImage(c.url);
    await save({ headshot: { ...img, source: `ESPN roster (id ${c.espnId})`, credit: "ESPN", espnId: c.espnId, addedAt: Timestamp.now() } });
    await clearReview(false);
  });
  const dismissReview = () => run("headshot", () => clearReview(true));
  const editHeadshot = (changes) => run("headshot", () => save({ headshot: { ...current.headshot, ...changes } }));
  const editAction = (i, changes) => run(`action:${i}`, () => save({ action: current.action.map((a, j) => (j === i ? { ...a, ...changes } : a)) }));

  if (loading) return <div style={{ padding: "20px", fontFamily: "Arial, sans-serif", color: "#777" }}>Loading players…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "18px", alignItems: "start", fontFamily: "Arial, sans-serif" }}>
      <div style={card}>
        <div style={{ background: BLUE, color: "#fff", padding: "10px 14px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Players <span style={{ fontWeight: 700, opacity: 0.8, textTransform: "none", letterSpacing: 0 }}>· {counts.headshots} headshots · {counts.action} action shots</span>
        </div>
        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "8px", borderBottom: "1px solid #eef1f5" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or school" style={input} />
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} style={{ ...smallBtn(GOLD, filter === f.key), borderRadius: "20px", padding: "3px 10px", fontSize: "11px", color: filter === f.key ? "#fff" : "#8a5a00" }}>{f.label}{f.key === "review" ? ` (${Object.keys(review).length})` : ""}</button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {shown.slice(0, 300).map((p) => {
            const ph = photos[p.id];
            const active = p.id === selectedId;
            return (
              <button key={p.id} onClick={() => { setSelectedId(p.id); setErr(""); }} style={{
                display: "flex", alignItems: "center", gap: "10px", width: "100%", textAlign: "left", padding: "8px 12px",
                border: "none", borderBottom: "1px solid #f1f3f7", background: active ? "#eef3fa" : "#fff", cursor: "pointer",
              }}>
                {ph?.headshot
                  ? <img src={ph.headshot.url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#eef1f5", flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 800, fontSize: "13px", color: "#1a1f2b" }}>{p.First} {p.Last}</span>
                  <span style={{ display: "block", fontSize: "11px", color: "#7a8597" }}>{[p.Position, p.School, p.Eligible].filter(Boolean).join(" · ")}</span>
                </span>
                {ph?.action?.length > 0 && <span style={{ fontSize: "10px", fontWeight: 900, color: BLUE, background: "#eef3fa", borderRadius: "999px", padding: "1px 7px" }}>{ph.action.length} action</span>}
              </button>
            );
          })}
          {shown.length > 300 && <div style={{ padding: "10px 12px", fontSize: "12px", color: "#7a8597" }}>Showing 300 of {shown.length} — search to narrow it down.</div>}
          {!shown.length && <div style={{ padding: "14px 12px", fontSize: "12px", color: "#7a8597" }}>No players match.</div>}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {!player ? (
          <div style={{ ...card, padding: "24px", color: "#7a8597", fontSize: "14px" }}>Pick a player to add their headshot and action shots.</div>
        ) : (
          <>
            <div style={{ fontWeight: 900, fontSize: "20px", color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
              {player.First} {player.Last}
              <span style={{ fontSize: "13px", color: "#7a8597", fontFamily: "Arial, sans-serif", marginLeft: "8px" }}>{[player.Position, player.School, player.Eligible].filter(Boolean).join(" · ")}</span>
            </div>
            {review[player.id] && (
              <div style={{ ...card, padding: "14px 16px", borderColor: GOLD }}>
                <div style={label}>Needs review — {review[player.id].reason}</div>
                <div style={{ fontSize: "12px", color: "#555", margin: "6px 0 10px" }}>
                  ESPN&apos;s {review[player.id].school} roster has no exact match for {review[player.id].name}. Is one of these him?
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {review[player.id].candidates.map((c) => (
                    <div key={c.espnId} style={{ border: "1px solid #e3e8ef", borderRadius: "10px", padding: "8px", width: 150, textAlign: "center" }}>
                      <img src={c.url} alt={c.name} style={{ width: "100%", height: 100, objectFit: "contain", background: "#eef1f5", borderRadius: "6px" }} />
                      <div style={{ fontWeight: 800, fontSize: "12px", marginTop: "6px" }}>{c.name}</div>
                      <div style={{ fontSize: "11px", color: "#7a8597" }}>{c.position || "—"}</div>
                      <button disabled={!!busy} onClick={() => pickCandidate(c)} style={{ ...smallBtn(BLUE, true), marginTop: "6px" }}>Use this</button>
                    </div>
                  ))}
                </div>
                <button disabled={!!busy} onClick={dismissReview} style={{ ...smallBtn("#7a8597"), marginTop: "10px" }}>None of these</button>
              </div>
            )}
            {err && <div style={{ background: "#fff5f5", border: "1px solid #c0392b", color: "#c0392b", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", fontWeight: 700 }}>{err}</div>}

            <div style={{ ...card, padding: "14px 16px" }}>
              <div style={label}>Headshot</div>
              <div style={{ display: "flex", gap: "16px", marginTop: "10px", alignItems: "flex-start" }}>
                {current.headshot
                  ? <img src={current.headshot.url} alt={`${player.First} ${player.Last} headshot`} style={{ width: 140, height: 140, objectFit: "cover", borderRadius: "10px", background: "#eef1f5" }} />
                  : <div style={{ width: 140, height: 140, borderRadius: "10px", background: "#eef1f5", display: "flex", alignItems: "center", justifyContent: "center", color: "#9aa4b2", fontSize: "12px" }}>No headshot</div>}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <LinkAdd button={current.headshot ? "Replace" : "Save headshot"} disabled={!!busy} onAdd={setHeadshot} />
                  {current.headshot && (
                    <>
                      <a href={current.headshot.url} target="_blank" rel="noreferrer" style={{ fontSize: "11px", color: BLUE, wordBreak: "break-all" }}>{current.headshot.url}</a>
                      <PhotoMeta photo={current.headshot} disabled={!!busy} onSave={editHeadshot} />
                      <button disabled={!!busy} onClick={removeHeadshot} style={{ ...smallBtn("#c0392b"), alignSelf: "flex-start" }}>Remove</button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div style={{ ...card, padding: "14px 16px" }}>
              <div style={label}>Action shots</div>
              <AddAction disabled={!!busy} onAdd={addAction} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px", marginTop: "12px" }}>
                {(current.action || []).map((a, i) => (
                  <div key={a.url} style={{ border: "1px solid #e3e8ef", borderRadius: "10px", overflow: "hidden" }}>
                    <a href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={`${player.First} ${player.Last} action shot`} style={{ width: "100%", height: 160, objectFit: "cover", display: "block", background: "#eef1f5" }} /></a>
                    <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <OrientationPick value={a.orientation} disabled={!!busy} onChange={(orientation) => editAction(i, { orientation })} />
                      <PhotoMeta photo={a} disabled={!!busy} onSave={(changes) => editAction(i, changes)} />
                      <button disabled={!!busy} onClick={() => removeAction(i)} style={{ ...smallBtn("#c0392b"), alignSelf: "flex-start" }}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
              {!current.action?.length && <div style={{ fontSize: "12px", color: "#9aa4b2", marginTop: "10px" }}>No action shots yet.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// An image link and a button; cleared once it saves.
function LinkAdd({ button, disabled, onAdd }) {
  const [link, setLink] = useState("");
  const add = async () => { if (link.trim() && (await onAdd(link))) setLink(""); };
  return (
    <div style={{ display: "flex", gap: "6px", flex: 1, minWidth: 260 }}>
      <input value={link} disabled={disabled} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="https://i.imgur.com/xxxx.jpg" style={input} />
      <button disabled={disabled || !link.trim()} onClick={add} style={{ ...smallBtn(BLUE, true), whiteSpace: "nowrap", opacity: disabled || !link.trim() ? 0.6 : 1 }}>{button}</button>
    </div>
  );
}

function OrientationPick({ value, disabled, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span title="Which way the player is facing" style={{ ...label, fontSize: "10px" }}>Facing</span>
      {ORIENTATIONS.map((o) => (
        <button key={o} disabled={disabled} onClick={() => o !== value && onChange(o)}
          style={{ ...smallBtn(GOLD, value === o), color: value === o ? "#fff" : "#8a5a00", padding: "3px 9px", fontSize: "11px", textTransform: "capitalize" }}>{o}</button>
      ))}
    </div>
  );
}

// The orientation is chosen with the link, so every shot is saved with one.
function AddAction({ disabled, onAdd }) {
  const [orientation, setOrientation] = useState("center");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px", flexWrap: "wrap" }}>
      <OrientationPick value={orientation} disabled={disabled} onChange={setOrientation} />
      <LinkAdd button="+ Add action shot" disabled={disabled} onAdd={(link) => onAdd(link, orientation)} />
    </div>
  );
}

// Source and credit, saved when the field loses focus (only if changed).
function PhotoMeta({ photo, disabled, onSave }) {
  const [source, setSource] = useState(photo.source || "");
  const [credit, setCredit] = useState(photo.credit || "");
  useEffect(() => { setSource(photo.source || ""); setCredit(photo.credit || ""); }, [photo.source, photo.credit]);
  const commit = (key, value) => { if (value.trim() !== (photo[key] || "")) onSave({ [key]: value.trim() }); };
  return (
    <>
      <input value={source} disabled={disabled} onChange={(e) => setSource(e.target.value)} onBlur={() => commit("source", source)} placeholder="Source (page it came from)" style={input} />
      <input value={credit} disabled={disabled} onChange={(e) => setCredit(e.target.value)} onBlur={() => commit("credit", credit)} placeholder="Credit (e.g. Michigan Athletics)" style={input} />
      {photo.width && <span style={{ fontSize: "11px", color: "#9aa4b2" }}>{photo.width}×{photo.height}</span>}
    </>
  );
}
