// src/components/AdminSocial.jsx
//
// Admin → Social. Which Instagram account belongs to which We-Draft player,
// built for messaging players later (interview questions, responses on
// their profiles, articles) — none of that is here yet.
//
//   Instagram Accounts   every association (instagramContacts): search,
//                        filter, sort; edit, verify, refresh, disconnect,
//                        and each one's history
//   Player Connections   every player, with or without an account — connect
//                        or replace one
//   Account Management   people who've messaged @wedraftsite
//                        (instagramSenders): confirm a suggested match,
//                        link to a player, or dismiss; webhook status
//
// A typed username is only "pending": the permanent identity is the
// Instagram-scoped ID (IGSID) Meta sends when that person messages us, and
// it's attached only when an admin confirms the match. Reads come straight
// from Firestore (admin-only rules); every write goes through
// api/instagram.js (server/instagram/contacts.js), which enforces one active
// account per player, per username and per IGSID, and keeps history.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { igApi } from "../utils/instagram/api";
import { renderShareImage } from "../utils/exportImages";
import { useSchools } from "./DraftArchiveList";
import PitchGraphic from "./PitchGraphic";
import { PITCH_MESSAGES, fillPitch, pitchText } from "../utils/pitchMessages";

const BLUE = "#0055a5";
const GREEN = "#2e7d32";
const RED = "#c0392b";
const ORANGE = "#b45309";
const GRAY = "#7a8594";
const PAGE = 50;

const STATUS = {
  pending: { label: "Pending", color: ORANGE, help: "Username entered; Instagram identity not yet established" },
  connected: { label: "Connected", color: BLUE, help: "Instagram-scoped ID linked from a message" },
  verified: { label: "Verified", color: GREEN, help: "Linked and confirmed by an admin" },
  inactive: { label: "Inactive", color: GRAY, help: "Disconnected or replaced (kept for history)" },
};
const METHODS = {
  admin_manual: "Entered by admin",
  player_provided: "Player provided",
  school_roster: "School roster / bio",
  inbound_message: "Matched from Instagram message",
  other: "Other",
};
const REVIEW = {
  needs_review: { label: "Needs review", color: ORANGE },
  unmatched: { label: "Unmatched", color: GRAY },
  matched: { label: "Linked", color: GREEN },
  dismissed: { label: "Dismissed", color: GRAY },
};

const btn = (on, color = BLUE) => ({
  padding: "6px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "8px", cursor: "pointer", background: on ? color : "#fff", color: on ? "#fff" : color, whiteSpace: "nowrap",
});
const small = (color = BLUE, on = false) => ({ ...btn(on, color), padding: "3px 8px", fontSize: "11px", borderRadius: "6px" });
const input = { border: "2px solid #d6dce5", borderRadius: "8px", padding: "6px 10px", fontWeight: 700, fontSize: "13px", background: "#fff" };
const th = { padding: "8px 10px", fontSize: "11px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "left", borderBottom: "2px solid #e3e7ee", whiteSpace: "nowrap", userSelect: "none" };
const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #f0f2f5", verticalAlign: "middle" };

const toMs = (t) => (t?.toMillis ? t.toMillis() : t?._seconds ? t._seconds * 1000 : typeof t === "number" ? t : 0);
const fmtWhen = (t) => {
  const m = toMs(t);
  return m ? new Date(m).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
};
const nameOf = (p) => [p?.First, p?.Last].filter(Boolean).join(" ");
const norm = (s) => String(s || "").toLowerCase();
// The same check the server makes (server/instagram/contacts.js).
const cleanUsername = (raw) => {
  let s = String(raw || "").trim();
  const url = /instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (url) s = url[1];
  s = s.replace(/^@+/, "").replace(/\/+$/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(s) && !/^\.|\.$|\.\./.test(s) ? s : null;
};

function Pill({ color, children, title }) {
  return (
    <span title={title} style={{ display: "inline-block", fontSize: "10px", fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", color: "#fff", background: color, borderRadius: "4px", padding: "2px 6px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function PlayerCell({ p, fallback }) {
  if (!p) return <span style={{ fontWeight: 800, color: "#555" }}>{fallback || "Unknown player"}</span>;
  return p.Slug
    ? <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, color: "#1a1f2b" }}>{nameOf(p)}</a>
    : <span style={{ fontWeight: 900 }}>{nameOf(p)}</span>;
}

function Handle({ username }) {
  if (!username) return <span style={{ color: GRAY, fontWeight: 700 }}>unknown</span>;
  return <a href={`https://www.instagram.com/${username}/`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 800, color: "#c13584" }}>@{username}</a>;
}

// Search existing players by name, school, position or class (one box —
// "texas qb", "2027 edge" and "manning" all work).
function PlayerPicker({ players, onPick, placeholder = "Search players: name, school, position, class…" }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return players.filter((p) => words.every((w) => p._search.includes(w))).slice(0, 8);
  }, [q, players]);
  return (
    <div style={{ position: "relative" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} style={{ ...input, width: "100%", boxSizing: "border-box" }} autoFocus />
      {hits.length > 0 && (
        <div style={{ position: "absolute", zIndex: 5, left: 0, right: 0, top: "100%", marginTop: "4px", background: "#fff", border: "1px solid #d6dce5", borderRadius: "8px", boxShadow: "0 6px 18px rgba(0,0,0,0.12)" }}>
          {hits.map((p) => (
            <button key={p.id} type="button" onClick={() => { onPick(p); setQ(""); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", border: "none", borderBottom: "1px solid #f0f2f5", background: "#fff", cursor: "pointer", fontSize: "13px" }}>
              <b>{nameOf(p)}</b> <span style={{ color: "#666", fontWeight: 700 }}>· {p.Position} · {p.School} · {p.Eligible}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Connect / replace / edit one association.
//   { player }              connect (replaces the player's active account)
//   { contact, player }     edit that account (never its player)
function Editor({ target, players, contactByPlayer, onClose, onSaved }) {
  const editing = target.contact || null;
  const [player, setPlayer] = useState(target.player || null);
  const [username, setUsername] = useState(editing?.instagramUsername || "");
  const [method, setMethod] = useState(editing?.verificationMethod || "admin_manual");
  const [notes, setNotes] = useState(editing?.notes || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const current = !editing && player ? contactByPlayer[player.id] : null;
  const clean = cleanUsername(username);

  const save = async () => {
    if (!clean) { setErr("Enter a valid Instagram username (letters, numbers, periods, underscores; up to 30)."); return; }
    if (current && current.usernameLower !== clean.toLowerCase() && !window.confirm(`${nameOf(player)} is connected to @${current.instagramUsername}${current.instagramScopedUserId ? " (with an Instagram ID)" : ""}.\n\nReplace it with @${clean}? The old association is kept as inactive.`)) return;
    setBusy(true); setErr("");
    try {
      const r = await igApi("contact-save", editing
        ? { contactId: editing.id, username: clean, verificationMethod: method, notes }
        : { playerId: player.id, username: clean, verificationMethod: method, notes });
      onSaved(r.unchanged ? `@${clean} was already connected to ${nameOf(player)}.` : editing ? `Saved @${clean}.` : `Connected @${clean} to ${nameOf(player)} (pending).`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(10,20,40,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "96px 16px 40px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "520px", background: "#fff", borderRadius: "12px", padding: "20px", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <div style={{ fontWeight: 900, fontSize: "16px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {editing ? "Edit Instagram account" : current ? "Replace Instagram account" : "Connect Instagram account"}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", fontSize: "20px", cursor: "pointer", color: "#888" }}>×</button>
        </div>

        <Field label="Player">
          {player ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ fontSize: "14px" }}><PlayerCell p={player} /> <span style={{ color: "#666", fontWeight: 700 }}>· {player.Position} · {player.School} · {player.Eligible}</span></div>
              {!editing && !target.player && <button type="button" onClick={() => setPlayer(null)} style={small(GRAY)}>Change</button>}
            </div>
          ) : <PlayerPicker players={players} onPick={setPlayer} />}
          {current && (
            <div style={{ marginTop: "6px", fontSize: "12px", fontWeight: 700, color: ORANGE }}>
              Currently @{current.instagramUsername} ({STATUS[current.accountStatus]?.label}). Saving a different username replaces it.
            </div>
          )}
        </Field>

        <Field label="Instagram username">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username or instagram.com/username" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
          {username && (clean ? <a href={`https://www.instagram.com/${clean}/`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", fontWeight: 800, color: "#c13584" }}>Open @{clean} on Instagram ↗</a>
            : <span style={{ fontSize: "12px", fontWeight: 800, color: RED }}>Not a valid username</span>)}
          {editing?.instagramScopedUserId && (
            <div style={{ marginTop: "6px", fontSize: "12px", fontWeight: 700, color: "#666" }}>
              This account has an Instagram ID, so its username also updates itself when Instagram reports a rename. Use this to fix the record by hand.
            </div>
          )}
        </Field>

        <Field label="How was it associated?">
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={input}>
            {Object.entries(METHODS).filter(([k]) => k !== "inbound_message" || method === "inbound_message").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>

        <Field label="Notes (admin only)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...input, width: "100%", boxSizing: "border-box", fontWeight: 600, resize: "vertical" }} />
        </Field>

        {!editing && (
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#666", background: "#f3f5f8", borderRadius: "8px", padding: "8px 10px", marginBottom: "12px" }}>
            Saved as <b>Pending</b>: the username alone isn't a permanent identity. It becomes Connected once this person messages @wedraftsite and you confirm the match under Account Management.
          </div>
        )}
        {err && <div style={{ color: RED, fontWeight: 800, fontSize: "13px", marginBottom: "10px" }}>{err}</div>}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={btn(false, GRAY)}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || !player} style={{ ...btn(true), opacity: busy || !player ? 0.6 : 1 }}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "11px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>{label}</div>
      {children}
    </div>
  );
}

const HISTORY_TEXT = {
  created: (h) => `Created${h.username ? ` as @${h.username}` : ""}${h.igsid ? " from an Instagram message" : ""}${h.replaces ? " (replacing an earlier account)" : ""}`,
  edited: (h) => `Edited${h.changes?.username ? `: @${h.changes.username[0]} → @${h.changes.username[1]}` : ""}${h.changes?.notes ? " (notes)" : ""}${h.changes?.verificationMethod ? ` (method: ${METHODS[h.changes.verificationMethod[1]] || h.changes.verificationMethod[1]})` : ""}`,
  linked: (h) => `Instagram ID linked${h.username ? ` (username now @${h.username[1]})` : ""}`,
  verified: () => "Verified",
  username_changed: (h) => `Instagram reported a rename: @${h.username?.[0]} → @${h.username?.[1]}`,
  replaced: (h) => `Replaced by @${h.username}`,
  disconnected: (h) => `Disconnected${h.reason ? `: ${h.reason}` : ""}`,
};

function History({ contactId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    getDocs(collection(db, "instagramContacts", contactId, "history"))
      .then((s) => setRows(s.docs.map((d) => d.data()).sort((a, b) => toMs(b.at) - toMs(a.at))))
      .catch(() => setRows([]));
  }, [contactId]);
  if (!rows) return <div style={{ color: GRAY, fontWeight: 700 }}>Loading…</div>;
  if (!rows.length) return <div style={{ color: GRAY, fontWeight: 700 }}>No history.</div>;
  return (
    <div style={{ display: "grid", gap: "4px" }}>
      {rows.map((h, i) => (
        <div key={i} style={{ fontSize: "12px", fontWeight: 700, color: "#444" }}>
          <span style={{ color: GRAY, marginRight: "8px" }}>{fmtWhen(h.at)}</span>
          {(HISTORY_TEXT[h.action] || (() => h.action))(h)}
          {h.by === "meta" && <span style={{ color: GRAY }}> · automatic</span>}
        </div>
      ))}
    </div>
  );
}

function SortTh({ k, label, sort, setSort }) {
  const on = sort.key === k;
  return (
    <th style={{ ...th, cursor: "pointer", color: on ? BLUE : th.color }} onClick={() => setSort({ key: k, dir: on && sort.dir === "asc" ? "desc" : "asc" })}>
      {label}{on ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}

function Filters({ players, f, setF, extra }) {
  const opts = (key) => [...new Set(players.map((p) => p[key]).filter(Boolean))].sort();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
      <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={extra?.placeholder || "Search player or @username…"} style={{ ...input, flex: "1 1 220px", maxWidth: "320px" }} />
      <select value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })} style={input}>
        <option value="">All schools</option>{opts("School").map((s) => <option key={s}>{s}</option>)}
      </select>
      <select value={f.pos} onChange={(e) => setF({ ...f, pos: e.target.value })} style={input}>
        <option value="">All positions</option>{opts("Position").map((s) => <option key={s}>{s}</option>)}
      </select>
      <select value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value })} style={input}>
        <option value="">All classes</option>{opts("Eligible").map((s) => <option key={s}>{s}</option>)}
      </select>
      {extra?.children}
    </div>
  );
}
const passes = (p, f) => p && (!f.school || p.School === f.school) && (!f.pos || p.Position === f.pos) && (!f.cls || String(p.Eligible) === f.cls);

// ── Instagram Accounts ──────────────────────────────────────────────────
function AccountsTab({ contacts, playerById, players, run, busy, openEditor, onShowMissing }) {
  const [f, setF] = useState({ q: "", school: "", pos: "", cls: "", status: "active", noId: false });
  const [sort, setSort] = useState({ key: "updated", dir: "desc" });
  const [shown, setShown] = useState(PAGE);
  const [openHistory, setOpenHistory] = useState(null);

  const rows = useMemo(() => {
    const q = norm(f.q).replace(/^@/, "");
    const list = contacts.filter((c) => {
      const p = playerById[c.playerId];
      if (f.status === "active" ? !c.active : f.status !== "all" && c.accountStatus !== f.status) return false;
      if (f.noId && c.instagramScopedUserId) return false;
      if ((f.school || f.pos || f.cls) && !passes(p, f)) return false;
      return !q || norm(c.instagramUsername).includes(q) || norm(p ? nameOf(p) : c.playerName).includes(q);
    });
    const val = (c) => {
      const p = playerById[c.playerId];
      switch (sort.key) {
        case "player": return norm(p ? `${p.Last} ${p.First}` : c.playerName);
        case "school": return norm(p?.School);
        case "pos": return norm(p?.Position);
        case "ig": return norm(c.instagramUsername);
        case "status": return Object.keys(STATUS).indexOf(c.accountStatus);
        case "igsid": return c.instagramScopedUserId ? 1 : 0;
        default: return toMs(c.lastUpdated);
      }
    };
    return list.sort((a, b) => {
      const x = val(a); const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === "asc" ? 1 : -1);
    });
  }, [contacts, playerById, f, sort]);

  const disconnect = (c) => {
    const reason = window.prompt(`Disconnect @${c.instagramUsername} from ${c.playerName}?\n\nThe record is kept as inactive. Reason (optional):`, "");
    if (reason === null) return;
    run(`disc${c.id}`, () => igApi("contact-disconnect", { contactId: c.id, reason }), `Disconnected @${c.instagramUsername}.`);
  };

  return (
    <div>
      <Filters players={players} f={f} setF={(v) => { setF(v); setShown(PAGE); }} extra={{
        children: (
          <>
            <select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setShown(PAGE); }} style={input}>
              <option value="active">Active (all)</option>
              {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              <option value="all">All incl. inactive</option>
            </select>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#555" }}>
              <input type="checkbox" checked={f.noId} onChange={(e) => setF({ ...f, noId: e.target.checked })} /> No Instagram ID only
            </label>
          </>
        ),
      }} />
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => openEditor({})} style={btn(true)}>+ Connect account</button>
        <button type="button" onClick={onShowMissing} style={btn(false)}>Players without Instagram</button>
        <span style={{ fontSize: "12px", fontWeight: 800, color: "#888" }}>{rows.length} account{rows.length === 1 ? "" : "s"}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#999", fontWeight: 700, border: "1px dashed #ccc", borderRadius: "8px" }}>
          {contacts.length ? "No accounts match." : "No Instagram accounts connected yet. Start from Player Connections, or + Connect account."}
        </div>
      ) : (
        <div style={{ border: "1px solid #e3e7ee", borderRadius: "8px", overflowX: "auto", background: "#fff" }}>
          <table style={{ width: "100%", minWidth: "980px", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <SortTh k="player" label="Player" sort={sort} setSort={setSort} />
                <SortTh k="school" label="School" sort={sort} setSort={setSort} />
                <SortTh k="pos" label="Pos" sort={sort} setSort={setSort} />
                <SortTh k="ig" label="Instagram" sort={sort} setSort={setSort} />
                <SortTh k="status" label="Connection" sort={sort} setSort={setSort} />
                <SortTh k="igsid" label="IG ID" sort={sort} setSort={setSort} />
                <SortTh k="updated" label="Last Updated" sort={sort} setSort={setSort} />
                <th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((c) => {
                const p = playerById[c.playerId];
                const st = STATUS[c.accountStatus] || STATUS.pending;
                return [
                  <tr key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}>
                    <td style={td}><PlayerCell p={p} fallback={c.playerName} />{p?.Eligible && <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 900, color: "#888" }}>{p.Eligible}</span>}</td>
                    <td style={td}>{p?.School || "—"}</td>
                    <td style={td}>{p?.Position || "—"}</td>
                    <td style={td}><Handle username={c.instagramUsername} />{c.notes ? <span title={c.notes} style={{ marginLeft: "6px", cursor: "help" }}>📝</span> : null}</td>
                    <td style={td}><Pill color={st.color} title={st.help}>{st.label}</Pill></td>
                    <td style={td}>
                      {c.instagramScopedUserId
                        ? <span title={c.instagramScopedUserId} style={{ fontSize: "12px", fontWeight: 800, color: GREEN }}>✓ Stored</span>
                        : <span title="Username only — no Instagram-scoped ID until they message @wedraftsite" style={{ fontSize: "12px", fontWeight: 900, color: ORANGE }}>⚠ None</span>}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontSize: "12px", color: "#555" }}>{fmtWhen(c.lastUpdated)}</td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: "4px" }}>
                        {c.active && <button type="button" onClick={() => openEditor({ contact: c, player: p })} style={small()}>Edit</button>}
                        {c.active && c.accountStatus !== "verified" && (
                          <button type="button" disabled={!c.instagramScopedUserId || !!busy}
                            title={c.instagramScopedUserId ? "Confirm this is the player" : "Needs an Instagram ID first (they message us, you confirm the match)"}
                            onClick={() => run(`ver${c.id}`, () => igApi("contact-verify", { contactId: c.id }), `Verified @${c.instagramUsername}.`)}
                            style={{ ...small(GREEN), opacity: c.instagramScopedUserId ? 1 : 0.4, cursor: c.instagramScopedUserId ? "pointer" : "not-allowed" }}>
                            {busy === `ver${c.id}` ? "…" : "Verify"}
                          </button>
                        )}
                        {c.active && c.instagramScopedUserId && (
                          <button type="button" disabled={!!busy} title="Re-read the username from Instagram"
                            onClick={() => run(`ref${c.id}`, () => igApi("contact-refresh", { contactId: c.id }), (r) => (r?.error ? `Instagram didn't return a profile: ${r.error}` : `Refreshed @${r?.username || c.instagramUsername}.`))}
                            style={small(GRAY)}>
                            {busy === `ref${c.id}` ? "…" : "Refresh"}
                          </button>
                        )}
                        {c.active && <button type="button" disabled={!!busy} onClick={() => disconnect(c)} style={small(RED)}>{busy === `disc${c.id}` ? "…" : "Disconnect"}</button>}
                        <button type="button" onClick={() => setOpenHistory(openHistory === c.id ? null : c.id)} style={small(GRAY, openHistory === c.id)}>History</button>
                      </span>
                    </td>
                  </tr>,
                  openHistory === c.id && (
                    <tr key={`${c.id}-h`}>
                      <td colSpan={8} style={{ ...td, background: "#f8f9fb" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: "12px", fontWeight: 700, color: "#555", marginBottom: "8px" }}>
                          <span>Method: {METHODS[c.verificationMethod] || c.verificationMethod || "—"}</span>
                          <span>Created {fmtWhen(c.createdAt)}</span>
                          {c.verifiedAt && <span>Verified {fmtWhen(c.verifiedAt)}</span>}
                          {c.instagramScopedUserId && <span>IGSID <code>{c.instagramScopedUserId}</code></span>}
                          {c.deactivatedAt && <span>Inactive since {fmtWhen(c.deactivatedAt)} ({c.deactivatedReason})</span>}
                        </div>
                        {c.notes && <div style={{ fontSize: "12px", color: "#444", marginBottom: "8px", whiteSpace: "pre-wrap" }}>📝 {c.notes}</div>}
                        <History contactId={c.id} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <button type="button" onClick={() => setShown(shown + PAGE)} style={{ ...btn(false), marginTop: "10px" }}>Show more ({rows.length - shown})</button>}
    </div>
  );
}

// ── Player Connections ──────────────────────────────────────────────────
function PlayersTab({ players, contactByPlayer, openEditor, initialHas }) {
  const [f, setF] = useState({ q: "", school: "", pos: "", cls: "", has: initialHas || "without", hidden: false });
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { if (initialHas) setF((x) => ({ ...x, has: initialHas })); }, [initialHas]);

  const rows = useMemo(() => {
    const words = norm(f.q).replace(/^@/, "").split(/\s+/).filter(Boolean);
    return players.filter((p) => {
      if (!f.hidden && p.Live === false) return false;
      const c = contactByPlayer[p.id];
      if (f.has === "without" && c) return false;
      if (f.has === "with" && !c) return false;
      if (f.has === "pending" && c?.accountStatus !== "pending") return false;
      if (!passes(p, f)) return false;
      return words.every((w) => p._search.includes(w) || norm(c?.instagramUsername).includes(w));
    }).sort((a, b) => String(a.Eligible).localeCompare(String(b.Eligible)) || norm(a.Last).localeCompare(norm(b.Last)) || norm(a.First).localeCompare(norm(b.First)));
  }, [players, contactByPlayer, f]);

  const set = (v) => { setF(v); setShown(PAGE); };
  return (
    <div>
      <Filters players={players} f={f} setF={set} extra={{
        placeholder: "Search name, school, position, class…",
        children: (
          <>
            {[["without", "Without Instagram"], ["pending", "Pending"], ["with", "With Instagram"], ["all", "All"]].map(([k, label]) => (
              <button key={k} type="button" onClick={() => set({ ...f, has: k })} style={small(BLUE, f.has === k)}>{label}</button>
            ))}
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#555" }}>
              <input type="checkbox" checked={f.hidden} onChange={(e) => set({ ...f, hidden: e.target.checked })} /> Include hidden players
            </label>
          </>
        ),
      }} />
      <div style={{ fontSize: "12px", fontWeight: 800, color: "#888", marginBottom: "8px" }}>{rows.length} player{rows.length === 1 ? "" : "s"}</div>
      <div style={{ border: "1px solid #e3e7ee", borderRadius: "8px", overflowX: "auto", background: "#fff" }}>
        <table style={{ width: "100%", minWidth: "760px", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Player</th><th style={th}>School</th><th style={th}>Pos</th><th style={th}>Class</th><th style={th}>Instagram</th><th style={{ ...th, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((p) => {
              const c = contactByPlayer[p.id];
              return (
                <tr key={p.id} style={{ opacity: p.Live === false ? 0.55 : 1 }}>
                  <td style={td}><PlayerCell p={p} /></td>
                  <td style={td}>{p.School || "—"}</td>
                  <td style={td}>{p.Position || "—"}</td>
                  <td style={td}>{p.Eligible || "—"}</td>
                  <td style={td}>
                    {c ? <span style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}><Handle username={c.instagramUsername} /><Pill color={STATUS[c.accountStatus]?.color || GRAY}>{STATUS[c.accountStatus]?.label}</Pill></span>
                      : <span style={{ color: "#bbb", fontWeight: 800 }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {c && <button type="button" onClick={() => openEditor({ contact: c, player: p })} style={{ ...small(GRAY), marginRight: "4px" }}>Edit</button>}
                    <button type="button" onClick={() => openEditor({ player: p, fixed: true })} style={small(BLUE, !c)}>{c ? "Replace" : "Connect"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown && <button type="button" onClick={() => setShown(shown + PAGE)} style={{ ...btn(false), marginTop: "10px" }}>Show more ({rows.length - shown})</button>}
    </div>
  );
}

// ── Account Management ──────────────────────────────────────────────────
function Messages({ igsid }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    getDocs(query(collection(db, "instagramMessages"), where("igsid", "==", igsid)))
      // Oldest first, like a thread: the latest 15.
      .then((s) => setRows(s.docs.map((d) => d.data()).sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp)).slice(-15)))
      .catch(() => setRows([]));
  }, [igsid]);
  if (!rows) return <div style={{ color: GRAY, fontWeight: 700, fontSize: "12px" }}>Loading messages…</div>;
  if (!rows.length) return <div style={{ color: GRAY, fontWeight: 700, fontSize: "12px" }}>No messages stored.</div>;
  return (
    <div style={{ display: "grid", gap: "6px" }}>
      {rows.map((m) => (
        <div key={m.mid} style={{ alignSelf: "start", maxWidth: "560px", marginLeft: m.direction === "out" ? "40px" : 0, background: m.direction === "out" ? "#e8f0fb" : "#fff", border: "1px solid #e3e7ee", borderRadius: "8px", padding: "6px 10px", fontSize: "13px" }}>
          <div style={{ fontSize: "11px", fontWeight: 800, color: GRAY }}>{m.direction === "out" ? "@wedraftsite" : "Them"} · {fmtWhen(m.timestamp)}{m.isDeleted ? " · deleted" : ""}</div>
          <div style={{ whiteSpace: "pre-wrap", color: m.isDeleted ? GRAY : "#1f2937" }}>{m.text || (m.attachments?.length ? `[${m.attachments.map((a) => a.type).join(", ")}]` : m.isUnsupported ? "[unsupported message]" : "")}</div>
        </div>
      ))}
    </div>
  );
}

function ManagementTab({ senders, contacts, contactById, playerById, players, run, busy, webhook }) {
  const [view, setView] = useState("review");
  const [linking, setLinking] = useState(null);
  const [openMsgs, setOpenMsgs] = useState(null);
  const counts = useMemo(() => {
    const n = { review: 0, unmatched: 0, matched: 0, dismissed: 0 };
    senders.forEach((s) => {
      const st = s.review?.state || "unmatched";
      if (st === "needs_review") n.review++; else if (n[st] != null) n[st]++;
    });
    return n;
  }, [senders]);
  const list = senders
    .filter((s) => {
      const st = s.review?.state || "unmatched";
      return view === "review" ? st === "needs_review" : st === view;
    })
    .sort((a, b) => toMs(b.lastMessageAt) - toMs(a.lastMessageAt));

  const pendingNoId = contacts.filter((c) => c.active && !c.instagramScopedUserId).length;

  // Everyone already in @wedraftsite's DMs → senders (server pages through
  // the conversations; the button keeps calling while there's more).
  const [dmSync, setDmSync] = useState(null);
  const [syncRuns, setSyncRuns] = useState(0);
  useEffect(() => { getDoc(doc(db, "igAnalytics", "dmSync")).then((s) => setDmSync(s.data() || null)).catch(() => {}); }, [syncRuns]);
  const syncDms = () => run("sync", async () => {
    const tot = { senders: 0, created: 0, suggested: 0 };
    let after = null;
    do {
      const r = await igApi("senders-sync", { after });
      tot.senders += r.senders; tot.created += r.created; tot.suggested += r.suggested;
      after = r.more ? r.after : null;
    } while (after);
    setSyncRuns((n) => n + 1);
    return tot;
  }, (t) => `Synced ${t.senders} DM conversation${t.senders === 1 ? "" : "s"}: ${t.created} new sender${t.created === 1 ? "" : "s"}, ${t.suggested} matching a pending account.`);

  return (
    <div>
      <SetupPanel webhook={webhook} senders={senders.length} pendingNoId={pendingNoId} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center", marginBottom: "12px" }}>
        <button type="button" onClick={syncDms} disabled={!!busy} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>{busy === "sync" ? "Syncing DMs…" : "Sync existing DMs"}</button>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#666" }}>
          {dmSync?.lastRunAt ? `Last sync ${fmtWhen(dmSync.lastRunAt)} · ${dmSync.lastResult?.senders ?? 0} conversations` : "Not synced yet"}
          {" · imports everyone already in @wedraftsite's DMs (Instagram ID + username), not their messages"}
        </span>
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
        {[["review", "Needs review", counts.review], ["unmatched", "Unmatched", counts.unmatched], ["matched", "Linked", counts.matched], ["dismissed", "Dismissed", counts.dismissed]].map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setView(k)} style={small(k === "review" && n ? ORANGE : BLUE, view === k)}>{label} ({n})</button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#999", fontWeight: 700, border: "1px dashed #ccc", borderRadius: "8px" }}>
          {senders.length ? "Nothing here." : "No senders yet. Sync existing DMs to bring in everyone already in @wedraftsite's inbox."}
        </div>
      ) : list.map((s) => {
        const sug = s.review?.suggestedContactId ? contactById[s.review.suggestedContactId] : null;
        const conflict = s.review?.conflictContactId ? contactById[s.review.conflictContactId] : null;
        const linked = s.contactId ? contactById[s.contactId] : null;
        const lp = linked ? playerById[linked.playerId] : null;
        return (
          <div key={s.id} style={{ border: "1px solid #e3e7ee", borderLeft: `4px solid ${REVIEW[s.review?.state || "unmatched"]?.color || GRAY}`, borderRadius: "8px", background: "#fff", padding: "10px 12px", marginBottom: "8px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px" }}>
              <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                <div style={{ fontSize: "14px" }}><Handle username={s.username} />{s.name && <span style={{ marginLeft: "6px", fontWeight: 700, color: "#555" }}>{s.name}</span>}</div>
                <div style={{ fontSize: "11px", fontWeight: 700, color: GRAY }}>
                  IGSID <code>{s.id}</code> · {s.messageCount || 0} message{s.messageCount === 1 ? "" : "s"} · last {fmtWhen(s.lastMessageAt)}
                </div>
                {s.profileError && !s.username && <div style={{ fontSize: "11px", fontWeight: 800, color: ORANGE }}>Instagram didn't return a username: {s.profileError.message}</div>}
                {sug && (
                  <div style={{ fontSize: "12px", fontWeight: 800, color: ORANGE, marginTop: "3px" }}>
                    Suggested: their username matches @{sug.instagramUsername}, entered for <PlayerCell p={playerById[sug.playerId]} fallback={sug.playerName} /> (pending)
                  </div>
                )}
                {conflict && (
                  <div style={{ fontSize: "12px", fontWeight: 800, color: RED, marginTop: "3px" }}>
                    They renamed to @{s.username}, which is entered for {conflict.playerName}. Fix one of the two records.
                  </div>
                )}
                {linked && <div style={{ fontSize: "12px", fontWeight: 800, color: GREEN, marginTop: "3px" }}>Linked to <PlayerCell p={lp} fallback={linked.playerName} /></div>}
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button type="button" onClick={() => setOpenMsgs(openMsgs === s.id ? null : s.id)} style={small(GRAY, openMsgs === s.id)}>Messages</button>
                {!s.contactId && sug && (
                  <button type="button" disabled={!!busy}
                    onClick={() => window.confirm(`Link this Instagram account to ${sug.playerName}?\n\nIts Instagram-scoped ID is saved on @${sug.instagramUsername}'s record and it becomes Connected.`)
                      && run(`link${s.id}`, () => igApi("sender-link", { igsid: s.id, contactId: sug.id }), (r) => `Linked to ${sug.playerName}${r?.messagesAttributed ? ` · ${r.messagesAttributed} message(s) attributed` : ""}.`)}
                    style={small(GREEN, true)}>
                    {busy === `link${s.id}` ? "…" : "Confirm match"}
                  </button>
                )}
                {!s.contactId && <button type="button" onClick={() => setLinking(linking === s.id ? null : s.id)} style={small(BLUE, linking === s.id)}>Link to player…</button>}
                {!s.contactId && s.review?.state !== "dismissed" && (
                  <button type="button" disabled={!!busy} onClick={() => run(`dis${s.id}`, () => igApi("sender-dismiss", { igsid: s.id }), "Dismissed.")} style={small(GRAY)}>Not a player</button>
                )}
              </div>
            </div>
            {linking === s.id && (
              <div style={{ marginTop: "10px", maxWidth: "460px" }}>
                <PlayerPicker players={players} placeholder="Which player is this?"
                  onPick={(p) => {
                    const cur = playerById[p.id] && contacts.find((c) => c.active && c.playerId === p.id);
                    const msg = cur
                      ? `${nameOf(p)} already has @${cur.instagramUsername} (${STATUS[cur.accountStatus]?.label}).\n\nLink this sender to that record? Its username becomes @${s.username || "unknown"} from Instagram.`
                      : `Create a Connected account for ${nameOf(p)} from this sender (@${s.username || "unknown"})?`;
                    if (!window.confirm(msg)) return;
                    setLinking(null);
                    run(`link${s.id}`, () => igApi("sender-link", { igsid: s.id, playerId: p.id }), (r) => `Linked to ${nameOf(p)}${r?.messagesAttributed ? ` · ${r.messagesAttributed} message(s) attributed` : ""}.`);
                  }} />
              </div>
            )}
            {openMsgs === s.id && <div style={{ marginTop: "10px" }}><Messages igsid={s.id} /></div>}
          </div>
        );
      })}
    </div>
  );
}

function SetupPanel({ webhook, senders, pendingNoId }) {
  const [open, setOpen] = useState(false);
  const live = !!webhook?.lastEventAt;
  return (
    <div style={{ border: `1px solid ${live ? "#cfe3d1" : "#f1d9b5"}`, background: live ? "#f4faf4" : "#fff8ee", borderRadius: "8px", padding: "10px 12px", marginBottom: "14px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", alignItems: "center", fontSize: "13px", fontWeight: 800 }}>
        <span style={{ color: live ? GREEN : ORANGE }}>{live ? `Messaging webhook: last delivery ${fmtWhen(webhook.lastEventAt)}` : "Messaging webhook: no deliveries yet"}</span>
        {webhook?.lastErrorAt && toMs(webhook.lastErrorAt) > toMs(webhook.lastEventAt) && <span style={{ color: RED }}>Last error {fmtWhen(webhook.lastErrorAt)}: {webhook.lastError}</span>}
        <span style={{ color: "#555" }}>{senders} sender{senders === 1 ? "" : "s"} on file · {pendingNoId} account{pendingNoId === 1 ? "" : "s"} waiting on an Instagram ID</span>
        <button type="button" onClick={() => setOpen(!open)} style={{ ...small(GRAY), marginLeft: "auto" }}>{open ? "Hide setup" : "How it works"}</button>
      </div>
      {open && (
        <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 600, color: "#444", lineHeight: 1.55 }}>
          Instagram doesn't let us look up an account's ID from a username. The permanent ID (Instagram-scoped ID) exists only for people in
          @wedraftsite's DMs. <b>Sync existing DMs</b> brings in everyone already there; new messages arrive at <code>/api/instagram-webhook</code> as
          they're sent. When a sender's username matches a pending account it shows here as <b>Needs review</b>. Nothing is linked until you confirm.
          Renames are picked up automatically once an account has its ID. The live webhook still needs Meta-side setup: see
          <code>server/instagram/README.md</code> → "Social: player accounts".
        </div>
      )}
    </div>
  );
}

// ── Pitch ───────────────────────────────────────────────────────────────
// Everything for one player's Instagram outreach, in sending order: the
// mock profile image (components/PitchGraphic.jsx: any player, or a 2027
// recruit not promoted yet — the 2030 class, drawn as their page will
// look), then each DM from utils/pitchMessages.js with their first name in.
const StepLabel = ({ n, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0 8px" }}>
    <span style={{ width: "22px", height: "22px", borderRadius: "50%", background: BLUE, color: "#fff", fontSize: "12px", fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
    <span style={{ fontSize: "12px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.08em" }}>{children}</span>
  </div>
);

function PitchMessage({ n, title, text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div style={{ marginBottom: "18px", maxWidth: "846px" }}>
      <StepLabel n={n}>{title}</StepLabel>
      {text ? (
        <div style={{ position: "relative", border: "1px solid #e3e8ef", borderRadius: "12px", background: "#fff", padding: "14px 16px" }}>
          <button type="button" onClick={copy} style={{ ...small(copied ? GREEN : BLUE, true), position: "absolute", top: "10px", right: "10px" }}>{copied ? "Copied ✓" : "Copy"}</button>
          <div style={{ whiteSpace: "pre-wrap", fontSize: "14px", lineHeight: 1.55, color: "#1f2937", paddingRight: "70px" }}>{text}</div>
        </div>
      ) : (
        <div style={{ padding: "14px 16px", border: "1px dashed #ccc", borderRadius: "12px", color: "#999", fontWeight: 700, fontSize: "13px" }}>Not written yet.</div>
      )}
    </div>
  );
}

function PitchTab({ players }) {
  const [recruits, setRecruits] = useState([]);
  const [nfl, setNfl] = useState([]);
  const [person, setPerson] = useState(null);
  const [number, setNumber] = useState("");
  const [fits, setFits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    getDocs(query(collection(db, "recruits"), where("RecruitClass", "==", "2027")))
      .then((s) => setRecruits(s.docs.map((d) => d.data()).filter((r) => !r.promotedPlayerId).map((r) => {
        const p = { id: `recruit-${r.First}-${r.Last}`, First: r.First, Last: r.Last, Position: r.Position, School: r.Commitment, Eligible: "2030", recruit: true };
        p._search = norm(`${p.First} ${p.Last} ${p.School} ${p.Position} 2030`);
        return p;
      })))
      .catch(() => setRecruits([]));
    getDocs(collection(db, "nfl"))
      .then((s) => setNfl(s.docs.map((d) => ({ abbr: d.id, logo: d.data().Logo1 || "" })).filter((t) => t.logo)))
      .catch(() => setNfl([]));
  }, []);
  const shuffle = () => setFits([...nfl].sort(() => Math.random() - 0.5).slice(0, 3));
  useEffect(() => { if (nfl.length && !fits.length) shuffle(); }, [nfl]); // eslint-disable-line react-hooks/exhaustive-deps

  // A player in the system: their real headshot and jersey number
  // (playerPhotos/{id}, as their page shows them); the number stays
  // editable. Recruits have neither, so it's the logo and a typed number.
  const [headshot, setHeadshot] = useState("");
  useEffect(() => {
    setHeadshot("");
    setNumber(""); // a new player starts clean
    if (!person || person.recruit) return undefined;
    let live = true;
    getDoc(doc(db, "playerPhotos", person.id)).then((s) => {
      if (!live) return;
      const d = s.data() || {};
      setHeadshot(d.headshot?.url || "");
      if (d.jersey != null && String(d.jersey).trim()) setNumber(String(d.jersey).replace(/[^0-9]/g, "").slice(0, 2));
    }).catch(() => {});
    return () => { live = false; };
  }, [person]);
  const brands = useSchools(person?.School ? [person.School] : []);
  const brand = person ? brands[person.School] : null;
  const everyone = useMemo(() => [...recruits, ...players], [recruits, players]);

  const download = async () => {
    setBusy(true); setErr("");
    try {
      // 2.5x: the graphic is drawn at the page's own size (846px), ~2100px out.
      const url = await renderShareImage(ref.current, { pixelRatio: 2.5, backgroundColor: "#f7f9fc" });
      const a = document.createElement("a");
      a.href = url;
      a.download = `pitch-${norm(`${person.First}-${person.Last}`).replace(/\s+/g, "-")}${number ? `-${number}` : ""}.png`;
      a.click();
    } catch (e) {
      setErr(`Couldn't make the image: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end", marginBottom: "14px" }}>
        <div style={{ flex: "1 1 320px", maxWidth: "420px" }}>
          <Field label="Player (2030 recruits included)">
            {person
              ? <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px" }}><b>{nameOf(person)}</b><span style={{ color: "#666", fontWeight: 700 }}>· {person.Position} · {person.School} · {person.Eligible}</span><button type="button" onClick={() => setPerson(null)} style={small(GRAY)}>Change</button></div>
              : <PlayerPicker players={everyone} onPick={setPerson} />}
          </Field>
        </div>
        <Field label="Number">
          <input value={number} onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} placeholder="7" style={{ ...input, width: "70px" }} />
        </Field>
        <div style={{ marginBottom: "12px", display: "flex", gap: "8px" }}>
          <button type="button" onClick={shuffle} disabled={!nfl.length} style={btn(false)}>Shuffle NFL fits</button>
          <button type="button" onClick={download} disabled={!person || busy} style={{ ...btn(true), opacity: !person || busy ? 0.6 : 1 }}>{busy ? "Making…" : "Download PNG"}</button>
        </div>
      </div>
      {err && <div style={{ color: RED, fontWeight: 800, fontSize: "13px", marginBottom: "10px" }}>{err}</div>}
      {person ? (
        <>
          <StepLabel n={1}>Graphic</StepLabel>
          <div style={{ overflowX: "auto", marginBottom: "18px" }}>
            <PitchGraphic ref={ref} person={person} brand={brand} number={number} fits={fits} headshot={headshot} />
          </div>
          {PITCH_MESSAGES.map((m, i) => (
            <PitchMessage key={m.title} n={i + 2}
              title={m.noPage ? `${m.title} (${person.recruit ? "no page yet" : "has a page"})` : m.title}
              text={m.text || m.noPage ? pitchText(m, person) : ""} />
          ))}
        </>
      ) : (
        <>
          <div style={{ padding: "24px", textAlign: "center", color: "#999", fontWeight: 700, border: "1px dashed #ccc", borderRadius: "8px", marginBottom: "18px", maxWidth: "846px", boxSizing: "border-box" }}>
            Search a player to get their pitch: the sample profile graphic (their school's look, their headshot and number when they're in the system), then each DM with their first name filled in, ready to copy.
          </div>
          {/* For reference with nobody picked: the messages as written,
              both versions where there are two. */}
          {PITCH_MESSAGES.flatMap((m, i) => (m.noPage
            ? [
              <PitchMessage key={`${m.title}-page`} n={i + 2} title={`${m.title} (has a page)`} text={pitchText(m, { First: "[First name]" })} />,
              <PitchMessage key={`${m.title}-nopage`} n={i + 2} title={`${m.title} (no page yet: 2030 recruits)`} text={pitchText(m, { First: "[First name]", recruit: true })} />,
            ]
            : [<PitchMessage key={m.title} n={i + 2} title={m.title} text={m.text ? fillPitch(m.text, { First: "[First name]" }) : ""} />]))}
        </>
      )}
    </div>
  );
}

// ── The section ─────────────────────────────────────────────────────────
const TABS = [
  { key: "accounts", label: "Instagram Accounts" },
  { key: "players", label: "Player Connections" },
  { key: "manage", label: "Account Management" },
  { key: "pitch", label: "Pitch" },
];

export default function AdminSocial() {
  const [tab, setTab] = useState("accounts");
  const [players, setPlayers] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [senders, setSenders] = useState([]);
  const [webhook, setWebhook] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState({ text: "", bad: false });
  const [playersHas, setPlayersHas] = useState(null);

  useEffect(() => {
    getDocs(collection(db, "players"))
      .then((s) => setPlayers(s.docs.map((d) => {
        const p = { id: d.id, ...d.data() };
        p._search = norm(`${p.First} ${p.Last} ${p.School} ${p.Position} ${p.Eligible}`);
        return p;
      })))
      .catch((e) => setLoadErr(`Couldn't load players: ${e.message}`));
    const fail = (what) => (e) => setLoadErr(`Couldn't read ${what} (${e.code || e.message}). Are the Social rules in firestore.rules deployed?`);
    const u1 = onSnapshot(collection(db, "instagramContacts"), (s) => setContacts(s.docs.map((d) => ({ id: d.id, ...d.data() }))), fail("instagramContacts"));
    const u2 = onSnapshot(collection(db, "instagramSenders"), (s) => setSenders(s.docs.map((d) => ({ id: d.id, ...d.data() }))), fail("instagramSenders"));
    getDoc(doc(db, "igAnalytics", "webhook")).then((s) => setWebhook(s.data() || null)).catch(() => {});
    return () => { u1(); u2(); };
  }, []);

  const playerById = useMemo(() => Object.fromEntries((players || []).map((p) => [p.id, p])), [players]);
  const contactById = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c])), [contacts]);
  const contactByPlayer = useMemo(() => Object.fromEntries(contacts.filter((c) => c.active).map((c) => [c.playerId, c])), [contacts]);

  // One write at a time; the live listeners redraw the tables.
  const run = async (key, fn, done) => {
    setBusy(key); setMessage({ text: "", bad: false });
    try {
      const r = await fn();
      setMessage({ text: typeof done === "function" ? done(r) : done, bad: false });
    } catch (e) {
      setMessage({ text: e.message, bad: true });
    } finally {
      setBusy(null);
    }
  };

  const summary = useMemo(() => {
    const active = contacts.filter((c) => c.active);
    const livePlayers = (players || []).filter((p) => p.Live !== false);
    return [
      ["Active accounts", active.length, BLUE],
      ["Pending (no IG ID)", active.filter((c) => !c.instagramScopedUserId).length, ORANGE],
      ["Connected", active.filter((c) => c.accountStatus === "connected").length, BLUE],
      ["Verified", active.filter((c) => c.accountStatus === "verified").length, GREEN],
      ["Players without Instagram", livePlayers.filter((p) => !contactByPlayer[p.id]).length, RED],
      ["Senders to review", senders.filter((s) => s.review?.state === "needs_review").length, ORANGE],
    ];
  }, [contacts, players, senders, contactByPlayer]);

  if (loadErr) return <div style={{ color: RED, fontWeight: 800 }}>{loadErr}</div>;
  if (!players) return <div style={{ color: GRAY, fontWeight: 700 }}>Loading…</div>;
  const reviewCount = summary[5][1];

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            style={{ padding: "8px 18px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", border: `2px solid ${BLUE}`, borderRadius: "8px", cursor: "pointer", background: tab === t.key ? BLUE : "#fff", color: tab === t.key ? "#fff" : BLUE }}>
            {t.label}{t.key === "manage" && reviewCount ? <span style={{ marginLeft: "6px", background: ORANGE, color: "#fff", borderRadius: "10px", padding: "0 6px", fontSize: "11px" }}>{reviewCount}</span> : null}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
        {summary.map(([label, n, color]) => (
          <div key={label} style={{ border: `2px solid ${color}`, borderRadius: "10px", padding: "6px 12px", background: "#fff" }}>
            <div style={{ fontSize: "20px", fontWeight: 900, color, lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
          </div>
        ))}
      </div>

      {message.text && <div style={{ marginBottom: "12px", fontSize: "13px", fontWeight: 800, color: message.bad ? RED : GREEN }}>{message.text}</div>}

      {tab === "accounts" && (
        <AccountsTab contacts={contacts} playerById={playerById} players={players} run={run} busy={busy}
          openEditor={setEditor} onShowMissing={() => { setPlayersHas("without"); setTab("players"); }} />
      )}
      {tab === "players" && <PlayersTab players={players} contactByPlayer={contactByPlayer} openEditor={setEditor} initialHas={playersHas} />}
      {tab === "pitch" && <PitchTab players={players} />}
      {tab === "manage" && (
        <ManagementTab senders={senders} contacts={contacts} contactById={contactById} playerById={playerById} players={players} run={run} busy={busy} webhook={webhook} />
      )}

      {editor && (
        <Editor target={editor} players={players} contactByPlayer={contactByPlayer}
          onClose={() => setEditor(null)} onSaved={(text) => { setEditor(null); setMessage({ text, bad: false }); }} />
      )}
    </div>
  );
}
