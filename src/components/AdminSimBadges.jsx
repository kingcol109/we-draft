// src/components/AdminSimBadges.jsx
//
// Admin → Mock Draft → Badges: the Draft Sim's one-time achievements
// (utils/draftSim/badges.js) — a title, a description and a rarity
// (Common, Uncommon, Rare, Elite) each, all shown with the circle We-Draft
// logo. A new badge is saved with active: false. "Wired" means
// utils/draftSim/badgeRules.js has its rule (by doc id) — a badge that
// isn't does nothing until one's added there; only a wired badge can be
// switched Active (awarded to everyone — until then only admins earn it,
// to try it out). The preview is the pop-up a user will see in the sim
// when they earn one.
import { useEffect, useState } from "react";
import { addDoc, deleteDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { badgesCol, badgeRef, RARITIES, rarityOf } from "../utils/draftSim/badges";
import { isWired } from "../utils/draftSim/badgeRules";
import { BadgeIcon, BadgeToast } from "./draftSim/SimBadges";
import LoadingSpinner from "./LoadingSpinner";

const BLUE = "#0055a5";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden" };
const input = { border: "1px solid #d8dee8", borderRadius: "6px", padding: "7px 9px", fontSize: "13px", fontFamily: "Arial, sans-serif", width: "100%", boxSizing: "border-box" };
const smallBtn = { border: `1px solid ${BLUE}`, background: "#fff", color: BLUE, borderRadius: "6px", padding: "6px 12px", fontSize: "12px", fontWeight: 800, cursor: "pointer" };
const EMPTY = { title: "", description: "", rarity: "common" };

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
      const data = { title: form.title.trim(), description: form.description.trim(), rarity: form.rarity, updatedAt: serverTimestamp() };
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
  // Live for everyone, or back off. Only a wired badge goes live.
  const toggle = async (b) => {
    if (!b.active && !isWired(b.id)) { alert("This badge isn't wired yet — it needs its rule in badgeRules.js before it can go live."); return; }
    try {
      await updateDoc(badgeRef(b.id), { active: !b.active, updatedAt: serverTimestamp() });
      await load();
    } catch (e) {
      console.error("Badge toggle error:", e);
      alert("Couldn't change the badge — try again.");
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
        {" "}<strong>Wired</strong> badges have their rule in the sim&apos;s code (badgeRules.js); a new badge shows <strong>Not wired</strong> until it&apos;s added there.
        {" "}Only <strong>Active</strong> badges are shown and awarded to users — admins earn wired badges either way, to test them first.
      </div>

      {/* Add / edit */}
      <div style={card}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #eef1f5", fontWeight: 900, fontSize: "13px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {editing ? "Edit badge" : "New badge"}
        </div>
        <div style={{ display: "flex", gap: "18px", padding: "14px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: "1 1 320px", minWidth: 0 }}>
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
          Badges {badges ? `(${badges.length} · ${badges.filter((b) => isWired(b.id)).length} wired · ${badges.filter((b) => b.active).length} active)` : ""}
        </div>
        {error && <div style={{ padding: "12px 14px", color: "#b42318", fontSize: "13px" }}>{error}</div>}
        {!badges ? <LoadingSpinner size={24} minHeight="80px" /> : badges.length === 0 ? (
          <div style={{ padding: "16px 14px", color: "#888", fontSize: "13px" }}>No badges yet — add the first one above.</div>
        ) : badges.map((b) => {
          const r = rarityOf(b.rarity);
          return (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderTop: "1px solid #eef1f5", background: editing === b.id ? "#f4f8fd" : "#fff" }}>
              <BadgeIcon rarity={b.rarity} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: "14px", color: "#1a1f2b" }}>
                  {b.title} <span style={{ fontSize: "10px", fontWeight: 900, padding: "1px 7px", borderRadius: "999px", background: r.color, color: "#0b1322", marginLeft: "4px", textTransform: "uppercase" }}>{r.label}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#666", fontFamily: "Arial, sans-serif" }}>{b.description || <em>No description</em>}</div>
              </div>
              <span title={isWired(b.id) ? "Its rule is in badgeRules.js" : `Needs a rule in badgeRules.js — doc id ${b.id}`} style={{
                fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "999px", textTransform: "uppercase", whiteSpace: "nowrap",
                ...(isWired(b.id) ? { background: "#e7f5ea", color: "#2e7d32" } : { background: "#fdecea", color: "#b42318" }),
              }}>{isWired(b.id) ? "Wired" : "Not wired"}</span>
              <button onClick={() => toggle(b)} aria-pressed={!!b.active} title={b.active ? "Live — click to switch off" : "Off — click to go live"} style={{
                ...smallBtn, ...(b.active ? { background: "#2e7d32", borderColor: "#2e7d32", color: "#fff" } : { borderColor: "#d8dee8", color: "#888" }),
              }}>{b.active ? "Active" : "Not active"}</button>
              <button onClick={() => { setEditing(b.id); setForm({ title: b.title || "", description: b.description || "", rarity: b.rarity || "common" }); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={smallBtn}>Edit</button>
              <button onClick={() => remove(b)} style={{ ...smallBtn, borderColor: "#f1c4c0", color: "#b42318" }}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
