// src/components/AdminGo.jsx
//
// Admin → Go (user, 2026-11-21): the admin's quick jobs, made for a phone.
// The tab shows only on mobile, where it's what /admin opens to
// (pages/AdminPanel.js); everything else in the admin stays as it is.
//   Write-ups  every player on a team's NFL Targets list without a generic
//              write-up (utils/prospectBlurbs.js) — write it, save, next
//   Portal     who's in the Transfer Portal now (→ committed to a school, or
//              withdrew), and a search to move anyone else in — the same
//              writes as the player editor (utils/portalMoves.js)
//   Birthdays  the 2027–2030 classes without a birthday, best community
//              grade first — month / day / year pickers (2000 on), or mark
//              it "can't find" (Birthday "U")
// Every save writes straight away, one player at a time.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { gradeLabel } from "../utils/gradeScale";
import { loadBlurbs, saveBlurb } from "../utils/prospectBlurbs";
import { NFL_TARGETS_DOC } from "../utils/nflTargets";
import { enterPortal, withdrawPortal, resolvePortal, applyMove } from "../utils/portalMoves";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const GREEN = "#15803d";
const RED = "#c0392b";
const INK = "#0b1a2e";
const BODY = "Arial, sans-serif";
const CLASSES = ["2027", "2028", "2029", "2030"];
const PAGE = 25;

// The phone check the admin uses: under 768px wide.
export function useAdminMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const on = () => setM(window.innerWidth < 768);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return m;
}

const card = { background: "#fff", borderRadius: 14, border: "1px solid #e3e8ef", padding: 14, display: "grid", gap: 10 };
const big = (color, filled = true) => ({
  minHeight: 46, borderRadius: 10, border: `2px solid ${color}`, background: filled ? color : "#fff", color: filled ? "#fff" : color,
  fontFamily: BODY, fontSize: 15, fontWeight: 900, padding: "0 14px", cursor: "pointer",
});
const field = { width: "100%", boxSizing: "border-box", border: "2px solid #d5dbe4", borderRadius: 10, padding: "12px", fontSize: 16, fontFamily: BODY };
const nameOf = (p) => `${p.First || p.first || ""} ${p.Last || p.last || ""}`.trim();
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const google = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const ageOf = (iso) => ((Date.now() - new Date(`${iso}T12:00:00`).getTime()) / (365.2425 * 864e5)).toFixed(1);

export default function AdminGo() {
  const [task, setTask] = useState("blurbs");
  const [players, setPlayers] = useState(null); // the 2027–2030 classes
  const [grades, setGrades] = useState({}); // { id: avg }
  const [blurbs, setBlurbs] = useState(null);
  const [lists, setLists] = useState(null); // { TEAM: [entries] }
  const [toast, setToast] = useState(null); // { text, undo? }

  useEffect(() => {
    const years = CLASSES.flatMap((y) => [y, Number(y)]);
    getDocs(query(collection(db, "players"), where("Eligible", "in", years)))
      .then((s) => setPlayers(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last)))
      .catch(() => setPlayers([]));
    getSiteSnapshot("_grades").then((g) => setGrades(Object.fromEntries(Object.entries(g?.rows || {}).map(([id, r]) => [id, r?.[0] ?? null])))).catch(() => {});
    loadBlurbs(true).then(setBlurbs).catch(() => setBlurbs({}));
    getDocs(collection(db, NFL_TARGETS_DOC))
      .then((s) => setLists(Object.fromEntries(s.docs.map((d) => [d.id, [...(d.data().featured || []), ...(d.data().list || [])]]))))
      .catch(() => setLists({}));
  }, []);

  const update = (id, fn) => setPlayers((ps) => ps.map((p) => (p.id === id ? fn(p) : p)));
  const flash = (text, undo = null) => setToast({ text, undo, at: Date.now() });
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Counts for the task buttons.
  const listed = useMemo(() => {
    const out = {};
    Object.entries(lists || {}).forEach(([team, l]) => l.forEach((r) => {
      if (!r?.id) return;
      if (!out[r.id]) out[r.id] = { ...r, teams: [] };
      out[r.id].teams.push(team);
    }));
    return out;
  }, [lists]);
  const blurbsMissing = blurbs ? Object.keys(listed).filter((id) => !blurbs[id]).length : null;
  const inPortal = players ? players.filter((p) => p.InPortal).length : null;
  const bdaysMissing = players ? players.filter((p) => !p.Birthday).length : null;

  const tasks = [
    { key: "blurbs", icon: "✍️", label: "Write-ups", n: blurbsMissing, sub: "missing" },
    { key: "portal", icon: "🔁", label: "Portal", n: inPortal, sub: "in portal" },
    { key: "bdays", icon: "🎂", label: "Birthdays", n: bdaysMissing, sub: "missing" },
  ];

  return (
    <div style={{ display: "grid", gap: 14, fontFamily: BODY }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {tasks.map((t) => (
          <button key={t.key} type="button" onClick={() => setTask(t.key)} style={{
            borderRadius: 14, border: `2px solid ${task === t.key ? BLUE : "#dfe5ee"}`, background: task === t.key ? BLUE : "#fff",
            color: task === t.key ? "#fff" : INK, padding: "12px 6px", cursor: "pointer", fontFamily: BODY, display: "grid", gap: 2, justifyItems: "center",
          }}>
            <span style={{ fontSize: 22 }}>{t.icon}</span>
            <span style={{ fontSize: 14, fontWeight: 900 }}>{t.label}</span>
            <span style={{ fontSize: 11, fontWeight: 800, opacity: 0.8 }}>{t.n == null ? "…" : `${t.n} ${t.sub}`}</span>
          </button>
        ))}
      </div>

      {!players ? <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Loading players…</div>
        : task === "blurbs" ? <BlurbsTask listed={listed} blurbs={blurbs} setBlurbs={setBlurbs} flash={flash} loading={!blurbs || !lists} />
          : task === "portal" ? <PortalTask players={players} update={update} flash={flash} />
            : <BirthdaysTask players={players} grades={grades} update={update} flash={flash} />}

      {toast && (
        <div style={{ position: "fixed", left: 12, right: 12, bottom: 16, zIndex: 30000, background: INK, color: "#fff", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontWeight: 800, fontSize: 14 }}>
          <span style={{ flex: 1 }}>{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo(); setToast(null); }} style={{ ...big(GOLD), minHeight: 36 }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

// ── Write-ups ──
function BlurbsTask({ listed, blurbs, setBlurbs, flash, loading }) {
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState("");
  if (loading) return <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Loading lists…</div>;
  const t = norm(q);
  const rows = Object.values(listed)
    .filter((r) => (showDone ? !!blurbs[r.id] : !blurbs[r.id]))
    .filter((r) => !t || norm(`${r.first} ${r.last} ${r.school} ${r.pos}`).includes(t))
    .sort((a, b) => b.teams.length - a.teams.length || String(a.last).localeCompare(String(b.last)));
  const onSaved = (id, text) => setBlurbs((b) => { const n = { ...b }; if (text) n[id] = text; else delete n[id]; return n; });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a", lineHeight: 1.45 }}>
        1–2 sentences about the player — not about any team. Shows under his row on every team list he's on. No PFF numbers.
      </div>
      <Toggle options={[["Missing", false], ["Done", true]]} value={showDone} onChange={setShowDone} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or school" style={field} />
      {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>{showDone ? "None written yet." : "Every listed player has one. 🎉"}</div>}
      {rows.slice(0, PAGE).map((r) => <BlurbCard key={r.id} r={r} value={blurbs[r.id] || ""} onSaved={onSaved} flash={flash} />)}
      {rows.length > PAGE && <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#7a8597" }}>{rows.length - PAGE} more after these</div>}
    </div>
  );
}

function BlurbCard({ r, value, onSaved, flash }) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(value); }, [value]);
  const name = `${r.first} ${r.last}`;
  const dirty = text.trim() !== value.trim();
  const save = async () => {
    setBusy(true);
    try {
      await saveBlurb(r.id, text, name);
      onSaved(r.id, text.trim());
      flash(`Saved ${name}'s write-up`);
    } catch (e) { flash(`Couldn't save: ${e.message}`); } finally { setBusy(false); }
  };
  const n = text.trim().length;
  return (
    <div style={card}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>{name}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a" }}>{r.pos} · {r.school} · on {r.teams.join(", ")}</div>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={`1–2 sentences on ${name}…`} style={{ ...field, resize: "vertical", lineHeight: 1.45 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: n > 320 ? RED : "#9aa4b2" }}>{n} chars{n > 320 ? " — trim it" : ""}</span>
        <a href={`/player/${r.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 800, color: BLUE }}>Profile ↗</a>
        <button type="button" disabled={!dirty || busy} onClick={save} style={{ ...big(GREEN), marginLeft: "auto", opacity: !dirty || busy ? 0.45 : 1 }}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// ── Portal ──
function PortalTask({ players, update, flash }) {
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(null); // the player choosing his new school
  const [busy, setBusy] = useState("");
  const t = norm(q);
  const inPortal = players.filter((p) => p.InPortal).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const found = t.length >= 2 ? players.filter((p) => norm(`${nameOf(p)} ${p.School} ${p.Position}`).includes(t)).slice(0, 20) : [];

  // Writes a move; the toast's Undo puts the old fields back.
  const run = async (p, move) => {
    setBusy(p.id);
    try {
      await updateDoc(doc(db, "players", p.id), move.write);
      update(p.id, (x) => applyMove(x, move));
      flash(`${nameOf(p)}: ${move.message}`);
    } catch (e) { flash(`Couldn't update: ${e.message}`); } finally { setBusy(""); }
  };
  const enter = (p) => { if (window.confirm(`Move ${nameOf(p)} (${p.School}) into the Transfer Portal?`)) run(p, enterPortal(p)); };
  const withdraw = (p) => { if (window.confirm(`${nameOf(p)} withdrew — stays at ${p.School}?`)) run(p, withdrawPortal(p)); };
  const commit = (p, school) => {
    const move = resolvePortal(p, school);
    setPicking(null);
    if (window.confirm(`${nameOf(p)} committed to ${school}?${move.eligible !== p.Eligible ? `\n\nMoves him to the ${move.eligible} class (slug updates Feb 1).` : ""}`)) run(p, move);
  };

  const row = (p) => (
    <div key={p.id} style={card}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>{nameOf(p)}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a" }}>{p.Position} · {p.School} · {p.Eligible}</div>
        {p.InPortal && <div style={{ marginTop: 4, display: "inline-block", fontSize: 11, fontWeight: 900, color: "#fff", background: GOLD, borderRadius: 999, padding: "2px 9px" }}>IN THE PORTAL{p.PortalOriginalSchool ? ` · from ${p.PortalOriginalSchool}` : ""}</div>}
      </div>
      {p.InPortal ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" disabled={busy === p.id} onClick={() => setPicking(p)} style={big(GREEN)}>Committed to…</button>
          <button type="button" disabled={busy === p.id} onClick={() => withdraw(p)} style={big("#7a8597", false)}>Withdrew</button>
        </div>
      ) : (
        <button type="button" disabled={busy === p.id} onClick={() => enter(p)} style={big(BLUE)}>{busy === p.id ? "Saving…" : "Move to portal"}</button>
      )}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any 2027–2030 player or school" style={field} />
      {t.length >= 2 && (
        <>
          <SectionHead text={`Search · ${found.length}${found.length === 20 ? "+" : ""}`} />
          {!found.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Nobody matches.</div>}
          {found.map(row)}
        </>
      )}
      <SectionHead text={`In the portal now · ${inPortal.length}`} />
      {!inPortal.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Nobody's in the portal. Search above to move someone in.</div>}
      {inPortal.map(row)}
      {picking && <SchoolPicker player={picking} onPick={(s) => commit(picking, s)} onClose={() => setPicking(null)} />}
    </div>
  );
}

// A full-screen school search — our schools first, or what was typed.
let schoolsCache = null;
function SchoolPicker({ player, onPick, onClose }) {
  const [schools, setSchools] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!schoolsCache) schoolsCache = getDocs(collection(db, "schools")).then((s) => s.docs.map((d) => d.data()).filter((x) => x.School).map((x) => ({ name: x.School, logo: x.Logo1 || "" })).sort((a, b) => a.name.localeCompare(b.name))).catch(() => []);
    schoolsCache.then(setSchools);
  }, []);
  const t = norm(q);
  const hits = !schools ? [] : t ? schools.filter((s) => norm(s.name).includes(t)).sort((a, b) => Number(!norm(a.name).startsWith(t)) - Number(!norm(b.name).startsWith(t))).slice(0, 30) : [];
  const typed = q.trim();
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 25000, background: "#f4f6f9", display: "flex", flexDirection: "column", fontFamily: BODY }}>
      <div style={{ padding: 12, background: "#fff", borderBottom: "1px solid #e3e8ef", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 900, color: INK }}>{nameOf(player)} committed to…</div>
          <button type="button" onClick={onClose} style={big("#7a8597", false)}>Cancel</button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="School" style={field} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "grid", gap: 8, alignContent: "start" }}>
        {!schools && <div style={{ color: "#7a8597", fontWeight: 800 }}>Loading schools…</div>}
        {hits.map((s) => (
          <button key={s.name} type="button" onClick={() => onPick(s.name)} style={{ ...big(INK, false), display: "flex", alignItems: "center", gap: 10, textAlign: "left", borderColor: "#dfe5ee" }}>
            {s.logo ? <img src={s.logo} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} /> : <span style={{ width: 28 }} />}
            {s.name}
          </button>
        ))}
        {typed && schools && !schools.some((s) => norm(s.name) === t) && (
          <button type="button" onClick={() => onPick(typed)} style={big(GOLD, false)}>Use “{typed}” (not a We-Draft school)</button>
        )}
      </div>
    </div>
  );
}

// ── Birthdays ──
function BirthdaysTask({ players, grades, update, flash }) {
  const [year, setYear] = useState("all");
  const [q, setQ] = useState("");
  const t = norm(q);
  const rows = players
    .filter((p) => !p.Birthday && (year === "all" || String(p.Eligible) === year))
    .filter((p) => !t || norm(`${nameOf(p)} ${p.School} ${p.Position}`).includes(t))
    .sort((a, b) => (grades[a.id] ?? 99) - (grades[b.id] ?? 99) || nameOf(a).localeCompare(nameOf(b)));

  const save = async (p, value) => {
    try {
      await updateDoc(doc(db, "players", p.id), { Birthday: value });
      update(p.id, (x) => ({ ...x, Birthday: value }));
      const undo = async () => {
        await updateDoc(doc(db, "players", p.id), { Birthday: deleteField() }).catch(() => {});
        update(p.id, (x) => { const n = { ...x }; delete n.Birthday; return n; });
      };
      flash(value === "U" ? `${nameOf(p)}: marked can't find` : `${nameOf(p)}: ${longDate(value)}`, undo);
    } catch (e) { flash(`Couldn't save: ${e.message}`); }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a", lineHeight: 1.45 }}>
        Best community grade first. Pick the month, day and year, then Save. Can't find it? Mark it and he drops off.
      </div>
      <Toggle options={[["All", "all"], ...CLASSES.map((y) => [y, y])]} value={year} onChange={setYear} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or school" style={field} />
      <SectionHead text={`${rows.length} without a birthday`} />
      {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>All done here. 🎉</div>}
      {rows.slice(0, PAGE).map((p) => <BirthdayCard key={p.id} p={p} grade={gradeLabel(grades[p.id])} onSave={save} />)}
      {rows.length > PAGE && <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#7a8597" }}>{rows.length - PAGE} more after these</div>}
    </div>
  );
}

// Month / day / year pickers (a phone shows each as its own wheel). Years
// from 2000 on (user); the days follow the month (and leap years).
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FIRST_YEAR = 2000;
const BIRTH_YEARS = Array.from({ length: new Date().getFullYear() - 14 - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
const daysIn = (m, y) => (m ? new Date(Date.UTC(y || 2000, m, 0)).getUTCDate() : 31);
const pad = (n) => String(n).padStart(2, "0");

function BirthdayCard({ p, grade, onSave }) {
  const [m, setM] = useState("");
  const [d, setD] = useState("");
  const [y, setY] = useState("");
  const [busy, setBusy] = useState(false);
  const days = daysIn(Number(m), Number(y));
  // A day past the month's end (Jan 31 → Feb) drops back to blank.
  useEffect(() => { if (d && Number(d) > days) setD(""); }, [days, d]);
  const iso = m && d && y ? `${y}-${pad(m)}-${pad(d)}` : "";
  const pick = { ...field, padding: "12px 8px", background: "#fff", appearance: "auto" };
  const go = async (value) => { setBusy(true); await onSave(p, value); setBusy(false); };
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>{nameOf(p)}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a" }}>{p.Position} · {p.School} · {p.Eligible}{grade ? ` · ${grade}` : ""}</div>
        </div>
        <a href={google(`${nameOf(p)} ${p.School} football birthday`)} target="_blank" rel="noopener noreferrer"
          style={{ ...big(BLUE, false), display: "grid", placeItems: "center", textDecoration: "none", minHeight: 40, fontSize: 13 }}>🔍 Search</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1.2fr", gap: 6 }}>
        <select aria-label="Month" value={m} onChange={(e) => setM(e.target.value)} style={{ ...pick, borderColor: m ? GREEN : "#d5dbe4" }}>
          <option value="">Month</option>
          {MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
        </select>
        <select aria-label="Day" value={d} onChange={(e) => setD(e.target.value)} style={{ ...pick, borderColor: d ? GREEN : "#d5dbe4" }}>
          <option value="">Day</option>
          {Array.from({ length: days }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        <select aria-label="Year" value={y} onChange={(e) => setY(e.target.value)} style={{ ...pick, borderColor: y ? GREEN : "#d5dbe4" }}>
          <option value="">Year</option>
          {BIRTH_YEARS.map((yr) => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </div>
      {iso && <div style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>{longDate(iso)} · age {ageOf(iso)}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <button type="button" disabled={!iso || busy} onClick={() => go(iso)} style={{ ...big(GREEN), opacity: !iso || busy ? 0.45 : 1 }}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" disabled={busy} onClick={() => go("U")} style={big("#7a8597", false)}>Can't find</button>
      </div>
    </div>
  );
}

// ── Bits ──
function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
      {options.map(([label, v]) => (
        <button key={label} type="button" onClick={() => onChange(v)} style={{
          flexShrink: 0, minHeight: 38, borderRadius: 999, padding: "0 16px", fontFamily: BODY, fontSize: 14, fontWeight: 900, cursor: "pointer",
          border: `2px solid ${value === v ? BLUE : "#dfe5ee"}`, background: value === v ? BLUE : "#fff", color: value === v ? "#fff" : INK,
        }}>{label}</button>
      ))}
    </div>
  );
}
const SectionHead = ({ text }) => <div style={{ fontSize: 12, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>{text}</div>;
