// src/components/AdminSimBadges.jsx
//
// Admin → Mock Draft → Badges: the Draft Sim's one-time achievements
// (utils/draftSim/badges.js) — an icon, a title, a description and a
// rarity (Common, Uncommon, Rare, Elite) each. Not live yet: saved with
// active: false, and nothing in the sim awards them. The preview is the
// pop-up a user will see in the sim when they earn one.
import { useEffect, useRef, useState } from "react";
import { addDoc, deleteDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { badgesCol, badgeRef, RARITIES, rarityOf, BADGE_ICON_PX } from "../utils/draftSim/badges";
import { squareImage } from "../utils/squareImage";
import LoadingSpinner from "./LoadingSpinner";

const BLUE = "#0055a5";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };
const input = { border: "1px solid #d8dee8", borderRadius: "6px", padding: "7px 9px", fontSize: "13px", fontFamily: "Arial, sans-serif", width: "100%", boxSizing: "border-box" };
const smallBtn = { border: `1px solid ${BLUE}`, background: "#fff", color: BLUE, borderRadius: "6px", padding: "6px 12px", fontSize: "12px", fontWeight: 800, cursor: "pointer" };
const EMPTY = { title: "", description: "", rarity: "common", icon: "" };

export default function AdminSimBadges() {
  const [badges, setBadges] = useState(null);
  const [error, setError] = useState("");
  // The form: a new badge (id null) or one being edited.
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => getDocs(query(badgesCol(), orderBy("createdAt", "asc")))
    .then((snap) => setBadges(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
    .catch((e) => { console.error("Badges load error:", e); setError("Couldn't load badges — check you're signed in as an admin."); setBadges([]); });
  useEffect(() => { load(); }, []);

  const reset = () => { setForm(EMPTY); setEditing(null); };
  const save = async () => {
    if (!form.title.trim()) { alert("Give the badge a title."); return; }
    setBusy(true);
    try {
      const data = { title: form.title.trim(), description: form.description.trim(), rarity: form.rarity, icon: form.icon || "", updatedAt: serverTimestamp() };
      if (editing) await updateDoc(badgeRef(editing), data);
      else await addDoc(badgesCol(), { ...data, active: false, createdAt: serverTimestamp() });
      reset();
      await load();
    } catch (e) {
      console.error("Badge save error:", e);
      alert("Couldn't save the badge — try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (b) => {
    if (!window.confirm(`Delete the "${b.title}" badge?`)) return;
    try {
      await deleteDoc(badgeRef(b.id));
      if (editing === b.id) reset();
      await load();
    } catch (e) {
      console.error("Badge delete error:", e);
      alert("Couldn't delete the badge — try again.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ fontSize: "13px", color: "#555", lineHeight: 1.5 }}>
        One-time achievements for the Draft Sim — each can be earned once, pops up in the sim when it is, and goes on the user&apos;s Sim Profile (signed-out users are asked to make an account to keep theirs).
        {" "}<strong>Not live yet</strong> — badges saved here aren&apos;t shown or awarded anywhere until they&apos;re switched on.
      </div>

      {/* Add / edit */}
      <div style={card}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #eef1f5", fontWeight: 900, fontSize: "13px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {editing ? "Edit badge" : "New badge"}
        </div>
        <div style={{ display: "flex", gap: "18px", padding: "14px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: "1 1 320px", minWidth: 0 }}>
            <IconField value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} rarity={form.rarity} />
            <label style={{ fontSize: "12px", fontWeight: 800, color: "#333" }}>Title
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={60} placeholder="e.g. Steal of the Draft" style={{ ...input, marginTop: "4px" }} />
            </label>
            <label style={{ fontSize: "12px", fontWeight: 800, color: "#333" }}>Description
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={200} rows={3} placeholder="e.g. Draft a player 40+ spots after his board rank." style={{ ...input, marginTop: "4px", resize: "vertical" }} />
            </label>
            <div style={{ fontSize: "12px", fontWeight: 800, color: "#333" }}>Rarity
              <div style={{ display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" }}>
                {RARITIES.map((r) => (
                  <button key={r.key} onClick={() => setForm((f) => ({ ...f, rarity: r.key }))} aria-pressed={form.rarity === r.key} style={{
                    ...smallBtn, borderColor: r.color, background: form.rarity === r.key ? r.color : "#fff", color: form.rarity === r.key ? "#0b1322" : "#333",
                  }}>{r.label}</button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={save} disabled={busy} style={{ ...smallBtn, background: BLUE, color: "#fff" }}>{busy ? "Saving…" : editing ? "Save changes" : "Add badge"}</button>
              {editing && <button onClick={reset} style={{ ...smallBtn, borderColor: "#d8dee8", color: "#888" }}>Cancel</button>}
            </div>
          </div>
          <div style={{ flex: "0 1 340px", minWidth: 0 }}>
            <div style={{ fontSize: "11px", fontWeight: 900, color: "#888", letterSpacing: "0.08em", marginBottom: "6px" }}>IN-SIM PREVIEW</div>
            <BadgeToast b={form} />
          </div>
        </div>
      </div>

      {/* Every badge */}
      <div style={card}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #eef1f5", fontWeight: 900, fontSize: "13px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Badges {badges ? `(${badges.length})` : ""}
        </div>
        {error && <div style={{ padding: "12px 14px", color: "#b42318", fontSize: "13px" }}>{error}</div>}
        {!badges ? <LoadingSpinner size={24} minHeight="80px" /> : badges.length === 0 ? (
          <div style={{ padding: "16px 14px", color: "#888", fontSize: "13px" }}>No badges yet — add the first one above.</div>
        ) : badges.map((b) => {
          const r = rarityOf(b.rarity);
          return (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderTop: "1px solid #eef1f5", background: editing === b.id ? "#f4f8fd" : "#fff" }}>
              <BadgeIcon icon={b.icon} rarity={b.rarity} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: "14px", color: "#1a1f2b" }}>
                  {b.title} <span style={{ fontSize: "10px", fontWeight: 900, padding: "1px 7px", borderRadius: "999px", background: r.color, color: "#0b1322", marginLeft: "4px", textTransform: "uppercase" }}>{r.label}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#666", fontFamily: "Arial, sans-serif" }}>{b.description || <em>No description</em>}</div>
              </div>
              <span style={{ fontSize: "11px", fontWeight: 800, color: b.active ? "#2e7d32" : "#999" }}>{b.active ? "Active" : "Not active"}</span>
              <button onClick={() => { setEditing(b.id); setForm({ title: b.title || "", description: b.description || "", rarity: b.rarity || "common", icon: b.icon || "" }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={smallBtn}>Edit</button>
              <button onClick={() => remove(b)} style={{ ...smallBtn, borderColor: "#f1c4c0", color: "#b42318" }}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The icon: upload (shrunk to a square data: URL) or paste a URL.
function IconField({ value, onChange, rarity }) {
  const fileRef = useRef(null);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setErr(""); onChange(await squareImage(f, BADGE_ICON_PX, "contain")); } catch { setErr("Couldn't read that image."); }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      <BadgeIcon icon={value} rarity={rarity} size={56} />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: 220 }}>
        <span style={{ fontSize: "12px", fontWeight: 800, color: "#333" }}>Icon</span>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => fileRef.current?.click()} style={{ ...smallBtn, background: BLUE, color: "#fff" }}>Upload icon</button>
          <input ref={fileRef} type="file" accept="image/*" onChange={pick} style={{ display: "none" }} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste an image URL" style={{ ...input, flex: "1 1 160px", width: "auto", padding: "5px 8px", fontSize: "12px" }} />
          <button onClick={() => { if (/^https?:\/\//i.test(url.trim())) { onChange(url.trim()); setUrl(""); setErr(""); } else setErr("Paste a full https:// image URL."); }} style={smallBtn}>Use URL</button>
          {value && <button onClick={() => onChange("")} style={{ ...smallBtn, borderColor: "#d8dee8", color: "#888" }}>Remove</button>}
        </div>
        <span style={{ fontSize: "11px", color: err ? "#b42318" : "#888" }}>{err || `Square works best — uploads are fit into ${BADGE_ICON_PX}×${BADGE_ICON_PX}, transparency kept.`}</span>
      </div>
    </div>
  );
}

// The icon in a ring of its rarity's color (a trophy with none yet).
export function BadgeIcon({ icon, rarity, size = 48 }) {
  const r = rarityOf(rarity);
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", border: `3px solid ${r.color}`, background: "#0b1322", display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden", boxShadow: `0 0 10px ${r.color}55` }}>
      {icon ? <img src={icon} alt="" style={{ width: "78%", height: "78%", objectFit: "contain" }} /> : <span style={{ fontSize: size * 0.45 }}>🏆</span>}
    </span>
  );
}

// The pop-up when a badge is earned, in the sim's colors.
function BadgeToast({ b }) {
  const r = rarityOf(b.rarity);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "linear-gradient(90deg, #0e1626, #14213a)", border: `1px solid ${r.color}`, borderRadius: "999px", padding: "8px 18px 8px 8px", boxShadow: "0 8px 24px rgba(0,0,0,0.25)", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <BadgeIcon icon={b.icon} rarity={b.rarity} size={48} />
      <div style={{ minWidth: 0 }}>
        <div style={{ color: r.color, fontSize: "10px", fontWeight: 900, letterSpacing: "0.12em" }}>BADGE UNLOCKED · {r.label.toUpperCase()}</div>
        <div style={{ color: "#fff", fontSize: "14px", fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.title || "Badge title"}</div>
        <div style={{ color: "#9fb0c8", fontSize: "11px", fontFamily: "Arial, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.description || "What it takes to earn it."}</div>
      </div>
    </div>
  );
}
