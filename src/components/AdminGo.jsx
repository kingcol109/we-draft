// src/components/AdminGo.jsx
//
// Admin → Go (user, 2026-11-21): the admin's quick jobs, made for a phone —
// what /admin opens to there (pages/AdminPanel.js). On desktop too (user,
// 2026-11-24): the same tasks in a centered column, the task buttons in one row.
//   Write-ups  every player on a team's NFL Targets list without a generic
//              write-up (utils/prospectBlurbs.js) — write it, save, next
//   Portal     who's in the Transfer Portal now (→ committed to a school, or
//              withdrew), and a search to move anyone else in — the same
//              writes as the player editor (utils/portalMoves.js)
//   Sim takes  Kenneth Cold's lines on the Draft Sim desk, per player
//              (config/draftSimAnalysis via utils/playerTakes.js — the same
//              writes as Admin → Mock Draft → Personalities)
//   Bios       the longer Bio on the player page (players.Bio)
//   Birthdays  month / day / year pickers (2000 on), or mark it "can't
//              find" (Birthday "U")
//   Players    (desktop only — user, 2026-11-24) Write-ups, Sim takes and
//              Bios together: pick a player, edit all three for him, with
//              his college stats and King Cold's evaluation beside them.
//              On a desktop it replaces those three buttons.
//   Instagram  (desktop only — user, 2026-11-24) players' Instagram
//              usernames: the same save as Admin → Social (api/instagram.js
//              contact-save → a Pending account there), which keeps one
//              active account per player and per username
// Every task opens on who's missing one, best community grade first (user,
// 2026-11-23: "recommends guys without it… as default"), with a Missing /
// Has one toggle and a search to edit what's already in the system.
// Every save writes straight away, one player at a time.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { gradeLabel } from "../utils/gradeScale";
import { loadBlurbs, saveBlurb } from "../utils/prospectBlurbs";
import { NFL_TARGETS_DOC } from "../utils/nflTargets";
import { enterPortal, withdrawPortal, resolvePortal, applyMove } from "../utils/portalMoves";
import { igApi, cleanUsername } from "../utils/instagram/api";
import { loadStats } from "../utils/printLayouts";
import { useCareerPath } from "./PlayerEligibilityInfo";
import { loadTakes, saveTakes, withLine, linesOf, takeCount, unknownVars } from "../utils/playerTakes";
import { lineText, TAKE_KEY } from "../utils/draftSim/analysts";
import { SIM_YEARS } from "../utils/draftSim/years";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const GREEN = "#15803d";
const RED = "#c0392b";
const INK = "#0b1a2e";
const BODY = "Arial, sans-serif";
const CLASSES = ["2027", "2028", "2029", "2030"];
const PAGE = 25;
const KINGCOLD_UID = "pYSpX6IRyHdAlYpFP5NNbQ19ARI3"; // King Cold Sports — the admin's own evaluations

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
  const isMobile = useAdminMobile();
  const [task, setTask] = useState("blurbs");
  const [players, setPlayers] = useState(null); // the 2027–2030 classes
  const [grades, setGrades] = useState({}); // { id: avg }
  const [blurbs, setBlurbs] = useState(null);
  const [lists, setLists] = useState(null); // { TEAM: [entries] }
  const [takes, setTakes] = useState(null); // Kenneth's { [id]: takes }; false = load failed
  // Active Instagram accounts by player (instagramContacts — admin-only
  // reads), loaded once Go opens on a desktop: { [playerId]: contact }.
  const [igContacts, setIgContacts] = useState(null);
  useEffect(() => {
    if (isMobile || igContacts) return;
    getDocs(collection(db, "instagramContacts"))
      .then((s) => setIgContacts(Object.fromEntries(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.active && c.playerId).map((c) => [c.playerId, c]))))
      .catch(() => setIgContacts(false));
  }, [isMobile, igContacts]);
  const [toast, setToast] = useState(null); // { text, undo? }
  // Desktop: Write-ups / Sim takes / Bios live together on the Players desk;
  // a phone keeps the three separate (and has no desk or Instagram).
  useEffect(() => {
    if (!isMobile && ["blurbs", "takes", "bios"].includes(task)) setTask("desk");
    if (isMobile && ["desk", "ig"].includes(task)) setTask("blurbs");
  }, [isMobile, task]);

  useEffect(() => {
    const years = CLASSES.flatMap((y) => [y, Number(y)]);
    getDocs(query(collection(db, "players"), where("Eligible", "in", years)))
      .then((s) => setPlayers(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last)))
      .catch(() => setPlayers([]));
    getSiteSnapshot("_grades").then((g) => setGrades(Object.fromEntries(Object.entries(g?.rows || {}).map(([id, r]) => [id, r?.[0] ?? null])))).catch(() => {});
    loadBlurbs(true).then(setBlurbs).catch(() => setBlurbs({}));
    loadTakes().then(setTakes).catch(() => setTakes(false));
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
  const live = useMemo(() => (players || []).filter((p) => p.Live !== false), [players]);
  const simPlayers = useMemo(() => live.filter((p) => SIM_YEARS.includes(String(p.Eligible))), [live]);
  const takesMissing = players && takes ? simPlayers.filter((p) => !takeCount(takes[p.id])).length : null;
  const biosMissing = players ? live.filter((p) => !String(p.Bio || "").trim()).length : null;
  const igMissing = players && igContacts ? live.filter((p) => !igContacts[p.id]).length : null;
  // The desk's "needs work": missing a bio, or (a Sim class) takes, or (on
  // a team's NFL Targets list) the generic write-up.
  const simIds = useMemo(() => new Set(simPlayers.map((p) => p.id)), [simPlayers]);
  const needsOf = (p) => ({
    blurb: !!listed[p.id] && !!blurbs && !blurbs[p.id],
    takes: simIds.has(p.id) && !!takes && !takeCount(takes[p.id]),
    bio: !String(p.Bio || "").trim(),
  });
  const deskMissing = players && blurbs && takes ? live.filter((p) => Object.values(needsOf(p)).some(Boolean)).length : null;

  const tasks = [
    ...(isMobile ? [
      { key: "blurbs", icon: "✍️", label: "Write-ups", n: blurbsMissing, sub: "missing" },
      { key: "takes", icon: "🎙️", label: "Sim takes", n: takesMissing, sub: "missing" },
      { key: "bios", icon: "📝", label: "Bios", n: biosMissing, sub: "missing" },
    ] : [{ key: "desk", icon: "✍️", label: "Players", n: deskMissing, sub: "need work" }]),
    { key: "portal", icon: "🔁", label: "Portal", n: inPortal, sub: "in portal" },
    { key: "bdays", icon: "🎂", label: "Birthdays", n: bdaysMissing, sub: "missing" },
    // Desktop only.
    ...(isMobile ? [] : [{ key: "ig", icon: "📸", label: "Instagram", n: igMissing, sub: "missing" }]),
  ];

  return (
    <div style={{ display: "grid", gap: 14, fontFamily: BODY, ...(isMobile ? {} : { maxWidth: task === "desk" ? 1320 : 820, margin: "0 auto", width: "100%" }) }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 3 : tasks.length}, 1fr)`, gap: 8, ...(isMobile ? {} : { maxWidth: 820, width: "100%", margin: "0 auto" }) }}>
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
          : task === "takes" ? <TakesTask players={simPlayers} grades={grades} takes={takes} setTakes={setTakes} flash={flash} />
          : task === "bios" ? <BiosTask players={live} grades={grades} update={update} flash={flash} />
          : task === "portal" ? <PortalTask players={players} update={update} flash={flash} />
          : task === "desk" && !isMobile ? <PlayerDesk players={live} grades={grades} listed={listed} lists={lists} blurbs={blurbs} setBlurbs={setBlurbs}
            takes={takes} setTakes={setTakes} simIds={simIds} needsOf={needsOf} update={update} flash={flash} />
          : task === "ig" && !isMobile ? <InstagramTask players={live} grades={grades} contacts={igContacts} setContacts={setIgContacts} flash={flash} />
            : <BirthdaysTask players={players} grades={grades} update={update} flash={flash} />}

      {toast && (
        <div style={{ position: "fixed", left: 12, right: 12, bottom: 16, zIndex: 30000, ...(isMobile ? {} : { maxWidth: 520, margin: "0 auto" }), background: INK, color: "#fff", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontWeight: 800, fontSize: 14 }}>
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
      <Toggle options={[["Missing", false], ["Has one", true]]} value={showDone} onChange={setShowDone} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or school" style={field} />
      {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>{showDone ? "None written yet." : "Every listed player has one. 🎉"}</div>}
      {rows.slice(0, PAGE).map((r) => <BlurbCard key={r.id} r={r} value={blurbs[r.id] || ""} onSaved={onSaved} flash={flash} />)}
      {rows.length > PAGE && <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#7a8597" }}>{rows.length - PAGE} more after these</div>}
    </div>
  );
}

function BlurbCard({ r, value, onSaved, flash, bare = false }) {
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
      {!bare && (
        <div>
          <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>{name}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a" }}>{r.pos} · {r.school} · on {r.teams.join(", ")}</div>
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={`1–2 sentences on ${name}…`} style={{ ...field, resize: "vertical", lineHeight: 1.45 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: n > 320 ? RED : "#9aa4b2" }}>{n} chars{n > 320 ? " — trim it" : ""}</span>
        {!bare && <a href={`/player/${r.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 800, color: BLUE }}>Profile ↗</a>}
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

// ── Sim takes (Kenneth Cold) ──
// The Draft Sim classes (SIM_YEARS), best community grade first.
function TakesTask({ players, grades, takes, setTakes, flash }) {
  const [year, setYear] = useState("all");
  const [has, setHas] = useState(false);
  const [q, setQ] = useState("");
  if (takes === false) return <div style={{ ...card, color: RED, fontWeight: 800 }}>Couldn't load the takes — reload before saving.</div>;
  if (!takes) return <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Loading takes…</div>;
  const t = norm(q);
  const rows = players
    .filter((p) => (takeCount(takes[p.id]) > 0) === has && (year === "all" || String(p.Eligible) === year))
    .filter((p) => !t || norm(`${nameOf(p)} ${p.School} ${p.Position}`).includes(t))
    .sort((a, b) => (grades[a.id] ?? 99) - (grades[b.id] ?? 99) || nameOf(a).localeCompare(nameOf(b)));
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a", lineHeight: 1.45 }}>
        What Kenneth Cold says when the player's drafted on the Draft Sim. Write as many lines as you like — he rotates through them. Sim off keeps a line off the desk; Mock lets the Weekly Mock's pick notes use it.
      </div>
      <Toggle options={[["Missing", false], ["Has one", true]]} value={has} onChange={setHas} />
      <Toggle options={[["All", "all"], ...SIM_YEARS.map((y) => [y, y])]} value={year} onChange={setYear} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or school" style={field} />
      <SectionHead text={`${rows.length} ${has ? "with" : "without"} takes`} />
      {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>{has ? "Nobody matches." : "All done here. 🎉"}</div>}
      {rows.slice(0, PAGE).map((p) => <TakeCard key={p.id} p={p} grade={gradeLabel(grades[p.id])} saved={takes[p.id]} setTakes={setTakes} flash={flash} />)}
      {rows.length > PAGE && <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#7a8597" }}>{rows.length - PAGE} more after these</div>}
    </div>
  );
}

// The variables player takes use most; tap one to drop it in where you're typing.
const QUICK_VARS = ["last", "player", "pos", "posName", "school", "nick", "city", "n", "rank", "posRankOrd"];
const cleanLines = (ls) => JSON.stringify(ls.map((l) => withLine(l, { text: lineText(l).trim() })).filter((l) => lineText(l)));

function TakeCard({ p, grade, saved, setTakes, flash, bare = false }) {
  const start = () => { const l = linesOf(saved); return l.length ? l : [""]; };
  const [lines, setLines] = useState(start);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(null); // { i, el } — the line being typed in
  useEffect(() => { setLines(start()); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = nameOf(p);
  const dirty = cleanLines(lines) !== cleanLines(linesOf(saved));
  const set = (i, patch) => setLines((ls) => ls.map((x, k) => (k === i ? withLine(x, patch) : x)));
  const insert = (v) => {
    if (!focus || !lines[focus.i]) return;
    const { i, el } = focus;
    const text = lineText(lines[i]);
    const a = el.selectionStart ?? text.length;
    const b = el.selectionEnd ?? a;
    set(i, { text: `${text.slice(0, a)}{${v}}${text.slice(b)}` });
    requestAnimationFrame(() => { el.focus(); const c = a + v.length + 2; el.setSelectionRange(c, c); });
  };
  const save = async () => {
    setBusy(true);
    try {
      // Writes only this player's field; hands back everyone's as saved.
      setTakes(await saveTakes({ [p.id]: { [TAKE_KEY]: lines } }));
      flash(`Saved ${name}'s takes`);
    } catch (e) { flash(`Couldn't save: ${e.message}`); } finally { setBusy(false); }
  };
  const pill = (on, color) => ({ minHeight: 34, borderRadius: 999, padding: "0 12px", fontFamily: BODY, fontSize: 13, fontWeight: 900, cursor: "pointer", border: `2px solid ${on ? color : "#dfe5ee"}`, background: on ? color : "#fff", color: on ? "#fff" : "#7a8597" });
  return (
    <div style={card}>
      {!bare && (
        <div>
          <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>{name}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a" }}>{p.Position} · {p.School} · {p.Eligible}{grade ? ` · ${grade}` : ""}</div>
        </div>
      )}
      {lines.map((line, i) => {
        const text = lineText(line);
        const bad = unknownVars(text);
        return (
          <div key={i} style={{ display: "grid", gap: 6, paddingTop: i ? 8 : 0, borderTop: i ? "1px dashed #e3e8ef" : "none" }}>
            <textarea value={text} rows={3} placeholder={`Line ${i + 1} on ${name}…`}
              onFocus={(e) => setFocus({ i, el: e.target })}
              onChange={(e) => set(i, { text: e.target.value })}
              style={{ ...field, resize: "vertical", lineHeight: 1.45, borderColor: bad.length ? GOLD : "#d5dbe4", opacity: line.noSim && !line.mock ? 0.6 : 1 }} />
            {bad.length > 0 && <div style={{ fontSize: 12, fontWeight: 800, color: "#a06200" }}>Unknown: {bad.map((v) => `{${v}}`).join(" ")} — shows blank</div>}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" onClick={() => set(i, { noSim: !line.noSim })} style={pill(!line.noSim, GREEN)}>Sim</button>
              <button type="button" onClick={() => set(i, { mock: !line.mock })} style={pill(!!line.mock, BLUE)}>Mock</button>
              <button type="button" onClick={() => { setFocus(null); setLines((ls) => ls.filter((_, k) => k !== i)); }} style={{ ...pill(false, RED), marginLeft: "auto", color: RED }}>Remove</button>
            </div>
          </div>
        );
      })}
      {focus && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
          {QUICK_VARS.map((v) => (
            <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v)}
              style={{ flexShrink: 0, minHeight: 32, borderRadius: 8, border: "1px solid #c9d6ea", background: "#eef4fc", color: BLUE, fontFamily: "monospace", fontSize: 13, fontWeight: 800, padding: "0 9px", cursor: "pointer" }}>{`{${v}}`}</button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={() => setLines((ls) => [...ls, ""])} style={{ ...big(BLUE, false), borderStyle: "dashed" }}>+ Line</button>
        {!bare && p.Slug && <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 800, color: BLUE }}>Profile ↗</a>}
        <button type="button" disabled={!dirty || busy} onClick={save} style={{ ...big(GREEN), marginLeft: "auto", opacity: !dirty || busy ? 0.45 : 1 }}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// ── Bios ──
// The longer Bio behind Show Bio on the player page (a line starting "- " is a bullet there).
function BiosTask({ players, grades, update, flash }) {
  const [year, setYear] = useState("all");
  const [has, setHas] = useState(false);
  const [q, setQ] = useState("");
  const t = norm(q);
  const rows = players
    .filter((p) => !!String(p.Bio || "").trim() === has && (year === "all" || String(p.Eligible) === year))
    .filter((p) => !t || norm(`${nameOf(p)} ${p.School} ${p.Position}`).includes(t))
    .sort((a, b) => (grades[a.id] ?? 99) - (grades[b.id] ?? 99) || nameOf(a).localeCompare(nameOf(b)));

  const save = bioSaver(update, flash);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a", lineHeight: 1.45 }}>
        The longer bio behind Show Bio on the player page. Best community grade first. Start a line with "- " for a bullet. No PFF numbers.
      </div>
      <Toggle options={[["Missing", false], ["Has one", true]]} value={has} onChange={setHas} />
      <Toggle options={[["All", "all"], ...CLASSES.map((y) => [y, y])]} value={year} onChange={setYear} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or school" style={field} />
      <SectionHead text={`${rows.length} ${has ? "with" : "without"} a bio`} />
      {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>{has ? "Nobody matches." : "All done here. 🎉"}</div>}
      {rows.slice(0, PAGE).map((p) => <BioCard key={p.id} p={p} grade={gradeLabel(grades[p.id])} onSave={save} />)}
      {rows.length > PAGE && <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#7a8597" }}>{rows.length - PAGE} more after these</div>}
    </div>
  );
}

// Same fields as the player editor's save (Bio + updatedAt, the page's "last updated" stamp).
const bioSaver = (update, flash) => async (p, text) => {
  const prev = p.Bio || "";
  try {
    await updateDoc(doc(db, "players", p.id), { Bio: text, updatedAt: serverTimestamp() });
    update(p.id, (x) => ({ ...x, Bio: text }));
    const undo = async () => {
      await updateDoc(doc(db, "players", p.id), { Bio: prev }).catch(() => {});
      update(p.id, (x) => ({ ...x, Bio: prev }));
    };
    flash(text ? `Saved ${nameOf(p)}'s bio` : `${nameOf(p)}: bio removed`, undo);
  } catch (e) { flash(`Couldn't save: ${e.message}`); }
};

function BioCard({ p, grade, onSave, bare = false }) {
  const value = String(p.Bio || "");
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(value); }, [value]);
  const dirty = text.trim() !== value.trim();
  const go = async () => { setBusy(true); await onSave(p, text.trim()); setBusy(false); };
  return (
    <div style={card}>
      {!bare && (
        <div>
          <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>{nameOf(p)}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a" }}>{p.Position} · {p.School} · {p.Eligible}{grade ? ` · ${grade}` : ""}</div>
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={`${nameOf(p)}'s bio…`} style={{ ...field, resize: "vertical", lineHeight: 1.45 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#9aa4b2" }}>{text.trim().length} chars</span>
        {!bare && p.Slug && <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 800, color: BLUE }}>Profile ↗</a>}
        <button type="button" disabled={!dirty || busy} onClick={go} style={{ ...big(GREEN), marginLeft: "auto", opacity: !dirty || busy ? 0.45 : 1 }}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

// ── Players desk (desktop) ──
// Write-ups, Sim takes and Bios for one player at a time: a list to pick
// from on the left (who needs work first, best grade first), his three
// editors in the middle, and what to write from on the right — his college
// stats (ESPN, as the printed evaluation has them) and King Cold's own
// evaluation of him.
function PlayerDesk({ players, grades, listed, lists, blurbs, setBlurbs, takes, setTakes, simIds, needsOf, update, flash }) {
  const [year, setYear] = useState("all");
  const [needs, setNeeds] = useState(true);
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState("");
  const t = norm(q);
  const rows = players
    .filter((p) => year === "all" || String(p.Eligible) === year)
    .filter((p) => !needs || t || Object.values(needsOf(p)).some(Boolean))
    .filter((p) => !t || norm(`${nameOf(p)} ${p.School} ${p.Position}`).includes(t))
    .sort((a, b) => (grades[a.id] ?? 99) - (grades[b.id] ?? 99) || nameOf(a).localeCompare(nameOf(b)));
  const picked = players.find((p) => p.id === pickedId) || null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr) minmax(0, 400px)", gap: 14, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 8, position: "sticky", top: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any player or school" style={{ ...field, padding: "10px 12px", fontSize: 15 }} />
        <Toggle options={[["Needs work", true], ["Everyone", false]]} value={needs} onChange={setNeeds} />
        <Toggle options={[["All", "all"], ...CLASSES.map((y) => [y, y])]} value={year} onChange={setYear} />
        <SectionHead text={`${rows.length} ${needs && !t ? "need work" : "players"}`} />
        <div style={{ display: "grid", gap: 4, maxHeight: "calc(100vh - 260px)", overflowY: "auto", paddingRight: 2 }}>
          {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>{needs && !t ? "All done here. 🎉" : "Nobody matches."}</div>}
          {rows.slice(0, 150).map((p) => {
            const n = needsOf(p);
            const on = p.id === pickedId;
            const dot = (label, has, applies = true) => applies && (
              <span title={`${label}: ${has ? "has one" : "missing"}`} style={{ fontSize: 10, fontWeight: 900, borderRadius: 6, padding: "2px 5px", background: has ? (on ? "rgba(255,255,255,0.25)" : "#e7f5ec") : (on ? "#fff" : "#fdecea"), color: has ? (on ? "#fff" : GREEN) : RED }}>{label}</span>
            );
            return (
              <button key={p.id} type="button" onClick={() => setPickedId(p.id)} style={{
                textAlign: "left", cursor: "pointer", fontFamily: BODY, borderRadius: 10, padding: "8px 10px",
                border: `1px solid ${on ? BLUE : "#e3e8ef"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : INK, display: "grid", gap: 3,
              }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(p)}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, opacity: 0.75 }}>{p.Eligible}</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, opacity: on ? 0.9 : 0.7 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.Position} · {p.School}</span>
                  {dot("W", !!blurbs?.[p.id], !!listed[p.id] || !!blurbs?.[p.id])}
                  {dot("T", !n.takes, simIds.has(p.id))}
                  {dot("B", !n.bio)}
                </span>
              </button>
            );
          })}
          {rows.length > 150 && <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#7a8597" }}>{rows.length - 150} more — search to find them</div>}
        </div>
      </div>

      {!picked ? (
        <div style={{ ...card, gridColumn: "2 / 4", color: "#7a8597", fontWeight: 800 }}>Pick a player on the left to see his write-up, sim takes and bio.</div>
      ) : (
        <DeskPlayer key={picked.id} p={picked} grade={gradeLabel(grades[picked.id])} listed={listed[picked.id]} lists={lists} blurbs={blurbs} setBlurbs={setBlurbs}
          takes={takes} setTakes={setTakes} inSim={simIds.has(picked.id)} update={update} flash={flash} />
      )}
    </div>
  );
}

// One player's three editors and his reference column.
function DeskPlayer({ p, grade, listed, lists, blurbs, setBlurbs, takes, setTakes, inSim, update, flash }) {
  const name = nameOf(p);
  // His notes on teams' NFL Targets lists — those teams show theirs over the generic one.
  const teamNotes = Object.entries(lists || {}).flatMap(([team, l]) => {
    const en = l.find((x) => x?.id === p.id && String(x.note || "").trim());
    return en ? [[team, String(en.note).trim()]] : [];
  });
  const r = { id: p.id, first: p.First || "", last: p.Last || "", school: p.School || "", pos: p.Position || "", slug: p.Slug || "", teams: listed?.teams || [] };
  const onBlurb = (id, text) => setBlurbs((b) => { const n = { ...b }; if (text) n[id] = text; else delete n[id]; return n; });
  const head = (text, sub) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
      <SectionHead text={text} />
      {sub && <span style={{ fontSize: 12, fontWeight: 700, color: "#9aa4b2" }}>{sub}</span>}
    </div>
  );
  return (
    <>
      <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={{ ...card, gridTemplateColumns: "1fr auto", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: INK }}>{name}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a" }}>{p.Position} · {p.School} · {p.Eligible}{grade ? ` · ${grade}` : ""}</div>
          </div>
          {p.Slug && <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 800, color: BLUE }}>Profile ↗</a>}
        </div>

        {head("✍️ Write-up", listed ? `on ${listed.teams.join(", ")}` : "not on a team's list yet")}
        {!blurbs ? <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Loading…</div>
          : <BlurbCard bare r={r} value={blurbs[p.id] || ""} onSaved={onBlurb} flash={flash} />}
        {teamNotes.length > 0 && (
          <div style={{ ...card, gap: 6, background: "#f8fafc" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.06em" }}>TEAM WRITE-UPS (Admin → NFL Targets)</div>
            {teamNotes.map(([team, note]) => (
              <div key={team} style={{ fontSize: 13, lineHeight: 1.45, color: "#2a313d" }}><b style={{ color: INK }}>{team}</b> — {note}</div>
            ))}
          </div>
        )}

        {head("🎙️ Sim takes", inSim ? "Kenneth Cold, on the Draft Sim" : "")}
        {!inSim ? <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>His class isn't on the Draft Sim ({SIM_YEARS.join(", ")}).</div>
          : takes === false ? <div style={{ ...card, color: RED, fontWeight: 800 }}>Couldn't load the takes — reload before saving.</div>
          : !takes ? <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Loading…</div>
          : <TakeCard bare p={p} grade={grade} saved={takes[p.id]} setTakes={setTakes} flash={flash} />}

        {head("📝 Bio", "behind Show Bio on his page")}
        <BioCard bare p={p} grade={grade} onSave={bioSaver(update, flash)} />
      </div>

      <div style={{ display: "grid", gap: 8, minWidth: 0, position: "sticky", top: 12, maxHeight: "calc(100vh - 24px)", overflowY: "auto" }}>
        <DeskEval p={p} />
        <DeskStats p={p} />
        <DeskCareer p={p} />
      </div>
    </>
  );
}

// King Cold's evaluation of him: his own copy (users/{uid}/evaluations),
// else the player's (players/{id}/evaluations/{uid}).
const evalCache = new Map();
function DeskEval({ p }) {
  const [e, setE] = useState(evalCache.get(p.id));
  useEffect(() => {
    if (evalCache.has(p.id)) { setE(evalCache.get(p.id)); return undefined; }
    let live = true;
    const read = (ref) => getDoc(ref).then((x) => (x.exists() ? x.data() : null)).catch(() => null);
    read(doc(db, "users", KINGCOLD_UID, "evaluations", p.id))
      .then((mine) => mine || read(doc(db, "players", p.id, "evaluations", KINGCOLD_UID)))
      .then((v) => { evalCache.set(p.id, v || false); if (live) setE(v || false); });
    return () => { live = false; };
  }, [p.id]);
  const chips = (list, color, bg) => (list || []).map((x) => (
    <span key={x} style={{ fontSize: 12, fontWeight: 800, borderRadius: 999, padding: "3px 9px", background: bg, color }}>{x}</span>
  ));
  const text = String(e?.evaluation || "").trim();
  return (
    <div style={{ ...card, gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em", flex: 1 }}>KING COLD'S EVAL</div>
        {e?.grade && <span style={{ fontSize: 12, fontWeight: 900, color: "#fff", background: INK, borderRadius: 999, padding: "3px 10px" }}>{e.grade}</span>}
      </div>
      {e === undefined ? <div style={{ fontSize: 13, fontWeight: 800, color: "#9aa4b2" }}>Loading…</div>
        : !e ? <div style={{ fontSize: 13, fontWeight: 800, color: "#9aa4b2" }}>No evaluation from King Cold yet.{p.Slug && <> <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE }}>Grade him ↗</a></>}</div>
        : (
          <>
            {e.strengths?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{chips(e.strengths, GREEN, "#e7f5ec")}</div>}
            {e.weaknesses?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{chips(e.weaknesses, RED, "#fdecea")}</div>}
            {e.nflFit && <div style={{ fontSize: 13, fontWeight: 800, color: "#5f6b7a" }}>NFL fit: <span style={{ color: INK }}>{e.nflFit}</span></div>}
            {text ? <div style={{ fontSize: 14, lineHeight: 1.5, color: "#2a313d", whiteSpace: "pre-line" }}>{text}</div>
              : <div style={{ fontSize: 13, fontWeight: 700, color: "#9aa4b2" }}>No written evaluation.</div>}
            {e.visibility && <div style={{ fontSize: 11, fontWeight: 800, color: "#9aa4b2", textTransform: "capitalize" }}>{e.visibility}</div>}
          </>
        )}
    </div>
  );
}

// His college stats, season by season — the printed evaluation's
// (utils/printLayouts.js loadStats: his position's two main categories).
// His ESPN id (playerPhotos/{id}.headshot.espnId), once per player.
const espnIds = new Map();
const espnIdOf = (id) => {
  if (!espnIds.has(id)) espnIds.set(id, getDoc(doc(db, "playerPhotos", id)).then((x) => String((x.exists() && x.data().headshot?.espnId) || "")).catch(() => ""));
  return espnIds.get(id);
};

// His Career Path, as his player page has it (PlayerEligibilityInfo.jsx
// useCareerPath), newest first: logo, school, level · years, accolades.
function DeskCareer({ p }) {
  const [espnId, setEspnId] = useState("");
  useEffect(() => { let live = true; espnIdOf(p.id).then((e) => { if (live) setEspnId(e); }); return () => { live = false; }; }, [p.id]);
  const { rows } = useCareerPath(p, espnId, null);
  return (
    <div style={{ ...card, gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em" }}>CAREER PATH</div>
      {!rows.length ? <div style={{ fontSize: 13, fontWeight: 800, color: "#9aa4b2" }}>No career path yet.</div>
        : rows.map((r, i) => {
          const logo = r.brand?.Logo1 || r.brand?.LogoDark || "";
          return (
            <div key={r.key || i} style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: i ? 8 : 0, borderTop: i ? "1px solid #edf0f5" : "none" }}>
              <div style={{ width: 34, height: 34, flexShrink: 0, borderRadius: "50%", background: "#f1f4f8", display: "grid", placeItems: "center", border: `2px solid ${r.current ? BLUE : "transparent"}` }}>
                {logo ? <img src={logo} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
                  : <span style={{ fontSize: 10, fontWeight: 900, color: "#7a8597" }}>{String(r.fallback || r.state || "").slice(0, 3)}</span>}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: INK }}>{r.name}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#5f6b7a" }}>{[r.label, r.span].filter(Boolean).join(" · ")}</div>
                {(r.accolades || []).map((a, k) => (
                  <div key={k} style={{ fontSize: 12, fontWeight: 800, color: "#a06200" }}>{a.text}</div>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}

const statsCache = new Map();
function DeskStats({ p }) {
  const [stats, setStats] = useState(statsCache.get(p.id));
  useEffect(() => {
    if (statsCache.has(p.id)) { setStats(statsCache.get(p.id)); return undefined; }
    let live = true;
    espnIdOf(p.id)
      .then((espnId) => (espnId ? loadStats(espnId, p.Position) : []))
      .catch(() => [])
      .then((s) => { statsCache.set(p.id, s); if (live) setStats(s); });
    return () => { live = false; };
  }, [p.id, p.Position]);
  const cell = { padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  return (
    <div style={{ ...card, gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", letterSpacing: "0.08em" }}>COLLEGE STATS</div>
      {stats === undefined ? <div style={{ fontSize: 13, fontWeight: 800, color: "#9aa4b2" }}>Loading…</div>
        : !stats.length ? <div style={{ fontSize: 13, fontWeight: 800, color: "#9aa4b2" }}>No college stats on ESPN.</div>
        : stats.map((c) => (
          <div key={c.key} style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: INK }}>{c.title}</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, color: "#2a313d", width: "100%" }}>
                <thead>
                  <tr style={{ color: "#7a8597", fontWeight: 900 }}>
                    <th style={{ ...cell, textAlign: "left" }}>Year</th>
                    {c.labels.map((l) => <th key={l} style={cell}>{l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((row, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #edf0f5" }}>
                      <td style={{ ...cell, textAlign: "left", fontWeight: 800 }}>{row.year}{row.team ? ` ${row.team}` : ""}</td>
                      {row.stats.map((v, k) => <td key={k} style={cell}>{v}</td>)}
                    </tr>
                  ))}
                  {c.totals && (
                    <tr style={{ borderTop: "2px solid #d5dbe4", fontWeight: 900 }}>
                      <td style={{ ...cell, textAlign: "left" }}>Career</td>
                      {c.totals.map((v, k) => <td key={k} style={cell}>{v}</td>)}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}

// ── Instagram (desktop) ──
// Live 2027–2030 players with or without an Instagram account, best grade
// first. A save goes through api/instagram.js like Admin → Social's (a new
// Pending account, or replacing the player's current one); a username
// already on another player is refused there and the message shown here.
function InstagramTask({ players, grades, contacts, setContacts, flash }) {
  const [year, setYear] = useState("all");
  const [has, setHas] = useState(false);
  const [q, setQ] = useState("");
  if (contacts === false) return <div style={{ ...card, color: RED, fontWeight: 800 }}>Couldn't read the Instagram accounts — are the Social rules deployed?</div>;
  if (!contacts) return <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>Loading Instagram accounts…</div>;
  const t = norm(q);
  const rows = players
    .filter((p) => !!contacts[p.id] === has && (year === "all" || String(p.Eligible) === year))
    .filter((p) => !t || norm(`${nameOf(p)} ${p.School} ${p.Position} ${contacts[p.id]?.instagramUsername || ""}`).includes(t))
    .sort((a, b) => (grades[a.id] ?? 99) - (grades[b.id] ?? 99) || nameOf(a).localeCompare(nameOf(b)));

  const save = async (p, username) => {
    const r = await igApi("contact-save", { playerId: p.id, username, verificationMethod: "admin_manual", notes: "" });
    // The server answers with the saved account ({ contactId, …record }).
    const c = { playerId: p.id, accountStatus: "pending", active: true, ...(r && typeof r === "object" ? r : {}) };
    setContacts((m) => ({ ...m, [p.id]: { ...c, instagramUsername: c.instagramUsername || username } }));
    flash(`Saved @${username} for ${nameOf(p)}`);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a", lineHeight: 1.45 }}>
        Type a username or paste their profile link. It becomes a Pending account in Admin → Social until they message us. One account per player, and a username can only be on one player.
      </div>
      <Toggle options={[["Missing", false], ["Has one", true]]} value={has} onChange={setHas} />
      <Toggle options={[["All", "all"], ...CLASSES.map((y) => [y, y])]} value={year} onChange={setYear} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, school or @username" style={field} />
      <SectionHead text={`${rows.length} ${has ? "with" : "without"} an account`} />
      {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>{has ? "Nobody matches." : "All done here. 🎉"}</div>}
      {rows.slice(0, PAGE).map((p) => <InstagramRow key={p.id} p={p} grade={gradeLabel(grades[p.id])} contact={contacts[p.id]} onSave={save} />)}
      {rows.length > PAGE && <div style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: "#7a8597" }}>{rows.length - PAGE} more after these</div>}
    </div>
  );
}

// One player on a row: who he is, his current account (if any), a Google
// search for his Instagram, and the username box.
function InstagramRow({ p, grade, contact, onSave }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const clean = cleanUsername(text);
  const current = contact?.instagramUsername || "";
  const go = async () => {
    if (!clean) { setErr("That isn't a valid Instagram username."); return; }
    setBusy(true); setErr("");
    try { await onSave(p, clean); setText(""); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ ...card, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", alignItems: "center", gap: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: INK }}>{nameOf(p)}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#5f6b7a" }}>{p.Position} · {p.School} · {p.Eligible}{grade ? ` · ${grade}` : ""}</div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 4, fontSize: 13, fontWeight: 800 }}>
          {current && <a href={`https://www.instagram.com/${current}/`} target="_blank" rel="noopener noreferrer" style={{ color: "#c13584" }}>@{current} ↗</a>}
          {current && contact?.accountStatus && <span style={{ fontSize: 11, color: "#9aa4b2", textTransform: "capitalize" }}>{contact.accountStatus}</span>}
          <a href={google(`${nameOf(p)} ${p.School} football instagram`)} target="_blank" rel="noopener noreferrer" style={{ color: BLUE }}>Search Google ↗</a>
          {p.Slug && <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE }}>Profile ↗</a>}
        </div>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={text} onChange={(e) => { setText(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter" && clean && !busy) go(); }}
            placeholder={current ? `Replace @${current}…` : "@username or profile link"} style={{ ...field, padding: "9px 12px", fontSize: 14 }} />
          <button type="button" disabled={!clean || busy} onClick={go} style={{ ...big(GREEN), minHeight: 40, opacity: !clean || busy ? 0.45 : 1, whiteSpace: "nowrap" }}>
            {busy ? "Saving…" : current ? "Replace" : "Save"}
          </button>
        </div>
        {text && !clean && !err && <div style={{ fontSize: 12, fontWeight: 800, color: "#b45309" }}>Letters, numbers, periods and underscores only (up to 30).</div>}
        {err && <div style={{ fontSize: 12, fontWeight: 800, color: RED }}>{err}</div>}
      </div>
    </div>
  );
}

// ── Birthdays ──
function BirthdaysTask({ players, grades, update, flash }) {
  const [year, setYear] = useState("all");
  const [has, setHas] = useState(false);
  const [q, setQ] = useState("");
  const t = norm(q);
  const rows = players
    .filter((p) => !!p.Birthday === has && (year === "all" || String(p.Eligible) === year))
    .filter((p) => !t || norm(`${nameOf(p)} ${p.School} ${p.Position}`).includes(t))
    .sort((a, b) => (grades[a.id] ?? 99) - (grades[b.id] ?? 99) || nameOf(a).localeCompare(nameOf(b)));

  // value "" clears it; Undo puts back what was there before.
  const save = async (p, value) => {
    const prev = p.Birthday || "";
    const put = (v) => update(p.id, (x) => { const n = { ...x, Birthday: v }; if (!v) delete n.Birthday; return n; });
    try {
      await updateDoc(doc(db, "players", p.id), { Birthday: value || deleteField() });
      put(value);
      const undo = async () => {
        await updateDoc(doc(db, "players", p.id), { Birthday: prev || deleteField() }).catch(() => {});
        put(prev);
      };
      flash(!value ? `${nameOf(p)}: birthday cleared` : value === "U" ? `${nameOf(p)}: marked can't find` : `${nameOf(p)}: ${longDate(value)}`, undo);
    } catch (e) { flash(`Couldn't save: ${e.message}`); }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#5f6b7a", lineHeight: 1.45 }}>
        Best community grade first. Pick the month, day and year, then Save. Can't find it? Mark it and he drops off. Has one shows what's on file, to fix or clear.
      </div>
      <Toggle options={[["Missing", false], ["Has one", true]]} value={has} onChange={setHas} />
      <Toggle options={[["All", "all"], ...CLASSES.map((y) => [y, y])]} value={year} onChange={setYear} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or school" style={field} />
      <SectionHead text={`${rows.length} ${has ? "with" : "without"} a birthday`} />
      {!rows.length && <div style={{ ...card, color: "#7a8597", fontWeight: 800 }}>{has ? "Nobody matches." : "All done here. 🎉"}</div>}
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
  // A date already on file starts in the pickers, to fix it.
  const [, y0 = "", m0 = "", d0 = ""] = String(p.Birthday || "").match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  const [m, setM] = useState(m0 ? String(Number(m0)) : "");
  const [d, setD] = useState(d0 ? String(Number(d0)) : "");
  const [y, setY] = useState(y0);
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
          {p.Birthday && <div style={{ fontSize: 13, fontWeight: 800, color: p.Birthday === "U" ? "#7a8597" : INK }}>On file: {p.Birthday === "U" ? "can't find" : longDate(p.Birthday)}</div>}
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
      <div style={{ display: "grid", gridTemplateColumns: p.Birthday ? "2fr 1fr 1fr" : "2fr 1fr", gap: 8 }}>
        <button type="button" disabled={!iso || iso === p.Birthday || busy} onClick={() => go(iso)} style={{ ...big(GREEN), opacity: !iso || iso === p.Birthday || busy ? 0.45 : 1 }}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" disabled={busy || p.Birthday === "U"} onClick={() => go("U")} style={{ ...big("#7a8597", false), opacity: p.Birthday === "U" ? 0.45 : 1 }}>Can't find</button>
        {p.Birthday && <button type="button" disabled={busy} onClick={() => go("")} style={big(RED, false)}>Clear</button>}
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
