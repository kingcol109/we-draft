// src/components/NflEvaluationTab.jsx
//
// The NFL player page's Evaluation tab (pages/NflPlayerPage.jsx) — the
// prospect page's evaluations for a drafted player, with a player or
// developmental grade instead of a round grade (utils/nflEvaluations.js):
//   Player Grade        the community's grade and top strengths/weaknesses,
//                       from his We-Draft baseline until evaluations outweigh it
//   My Evaluation       the signed-in user's grade, traits and take — save,
//                       archive or delete it, like the prospect page's
//   My Archived Evaluation  his read-only snapshot, if he archived one
//   Public Evaluations  everyone's public ones, verified scouts first
// Everything loads when the tab opens.
import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import VerifiedNameBadge from "./VerifiedNameBadge";
import {
  NFL_GRADES, DEV_GRADES, WATCHLIST, nflGradeLook, BAR_MIN_EVALS, MAX_TRAITS, depthSpot, adminGradeFor, baselineFor, communityView,
  loadNflEvaluations, loadMyNflEvaluation, saveNflEvaluation, loadTraitOptions,
  deleteNflEvaluation, loadMyNflArchive, archiveNflEvaluation, deleteNflArchive,
} from "../utils/nflEvaluations";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const MUTED = "#6b778a";
const HEAD = "'Arial Black', Arial, sans-serif";
const BODY = "Arial, sans-serif";
// The prospect page's public-feed filter.
const BANNED = ["faggot", "nigger", "monkey", "nigga", "fuck"];
const hasProfanity = (text) => BANNED.some((w) => String(text).toLowerCase().includes(w));

function Section({ title, right = null, children, pad = true }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 10px rgba(16,34,64,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 16px", borderBottom: "1px solid #eef1f5" }}>
        <h2 style={{ margin: 0, fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", color: BLUE, textTransform: "uppercase", fontFamily: HEAD }}>{title}</h2>
        {right}
      </div>
      <div style={pad ? { padding: 16 } : undefined}>{children}</div>
    </section>
  );
}

function GradeBadge({ label, size = "lg" }) {
  const g = nflGradeLook(label);
  if (!g) return <span style={{ fontFamily: BODY, fontSize: 13, color: "#98a3b3", fontStyle: "italic" }}>Not graded</span>;
  const big = size === "lg";
  // One fixed size for every grade; a long label wraps inside it.
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxSizing: "border-box", width: big ? 120 : 84, height: big ? 80 : 58, padding: big ? "6px 8px" : "4px 6px", borderRadius: 10, background: g.bg, border: `3px solid ${g.border}`, color: "#fff", textAlign: "center", flexShrink: 0 }}>
      <b style={{ fontFamily: HEAD, fontSize: big ? 26 : 18, lineHeight: 1 }}>{g.short}</b>
      <span style={{ fontSize: big ? 10 : 8, fontWeight: 900, marginTop: 4, letterSpacing: "0.06em", lineHeight: 1.15, textTransform: "uppercase" }}>{g.chip || g.label}</span>
    </span>
  );
}

// Where the grade sits on its scale — the prospect page's meter under its
// community grade: a marker along a bar, best to worst, in the grade's color.
function GradeMeter({ avg, scale }) {
  if (avg == null || !scale) return null;
  const color = scale[Math.min(scale.length, Math.max(1, Math.round(avg))) - 1].bg;
  const ends = [scale[0], scale[scale.length - 1]];
  return (
    <div style={{ width: 120 }}>
      <div style={{ height: 5, background: "#eee", borderRadius: 3, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: `${((avg - 1) / (scale.length - 1)) * 90}%`, width: "10%", height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontFamily: BODY, fontSize: 8, fontWeight: 700, color: "#bbb" }}>
        {ends.map((g) => <span key={g.label}>{g.short === "5★" ? g.short : g.label}</span>)}
      </div>
    </div>
  );
}

const head = (label) => (
  <h3 style={{ margin: "0 0 10px", paddingBottom: 6, borderBottom: `3px solid ${BLUE}`, color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" }}>{label}</h3>
);

function TraitRows({ items, color, bars }) {
  if (!items.length) return <span style={{ fontFamily: BODY, fontSize: 13, fontStyle: "italic", color: "#98a3b3" }}>None yet</span>;
  return items.map((t, i) => (
    <div key={t.term} style={{ padding: "7px 0", borderBottom: i < items.length - 1 ? "1px solid #f0f0f0" : "none" }}>
      <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", color: "#222", textTransform: "uppercase" }}>{t.term}</div>
      {bars && (
        <div style={{ height: 4, background: "#eee", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
          <div style={{ width: `${Math.pow(t.pct / 100, 0.3) * 100}%`, height: "100%", background: color, borderRadius: 2 }} />
        </div>
      )}
    </div>
  ));
}

export default function NflEvaluationTab({ slug, espnId, teamAbbr, position, draft, first, name, isMobile, user, login }) {
  const [evals, setEvals] = useState(null);
  const [spot, setSpot] = useState(undefined);
  const [adminGrade, setAdminGrade] = useState(undefined);
  const [feed, setFeed] = useState([]);
  const [shown, setShown] = useState(3);
  const [traitOptions, setTraitOptions] = useState({});
  // The form.
  const [grade, setGrade] = useState("");
  const [strengths, setStrengths] = useState([]);
  const [weaknesses, setWeaknesses] = useState([]);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState("");
  const [archive, setArchive] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    let live = true;
    loadNflEvaluations(slug).then((e) => { if (live) setEvals(e); });
    depthSpot(teamAbbr, espnId).then((s) => { if (live) setSpot(s); }).catch(() => { if (live) setSpot(null); });
    adminGradeFor(name, teamAbbr).then((g) => { if (live) setAdminGrade(g); });
    return () => { live = false; };
  }, [slug, teamAbbr, espnId, name]);

  useEffect(() => {
    if (!position) return;
    loadTraitOptions(position).then(setTraitOptions).catch(() => {});
  }, [position]);

  // His own evaluation into the form, and his archive.
  useEffect(() => {
    if (!user) return;
    let live = true;
    loadMyNflArchive(user.uid, slug).then((a) => { if (live) setArchive(a); });
    loadMyNflEvaluation(user.uid, slug).then((m) => {
      if (!live || !m) return;
      setGrade(m.grade || ""); setStrengths(m.strengths || []); setWeaknesses(m.weaknesses || []);
      setText(m.evaluation || ""); setVisibility(m.visibility || "public");
      setSaved(m.updatedAt?.toDate?.() || null);
    });
    return () => { live = false; };
  }, [user, slug]);

  // Public feed: public, written and clean, with usernames — verified first, then newest.
  useEffect(() => {
    const pub = (evals || []).filter((e) => e.visibility === "public" && e.evaluation?.trim() && !hasProfanity(e.evaluation));
    if (!pub.length) { setFeed([]); return undefined; }
    let live = true;
    Promise.all(pub.map((e) => getDoc(doc(db, "users", e.id)).catch(() => null))).then((snaps) => {
      if (!live) return;
      const ms = (t) => (t?.toDate ? t.toDate().getTime() : 0);
      setFeed(pub.map((e, i) => {
        const u = snaps[i]?.exists() ? snaps[i].data() : {};
        return { ...e, uid: e.id, username: u.username || "Anonymous User", verified: !!u.verified };
      }).sort((a, b) => (a.verified !== b.verified ? (a.verified ? -1 : 1) : ms(b.updatedAt) - ms(a.updatedAt))));
    });
    return () => { live = false; };
  }, [evals]);

  const baseline = useMemo(() => baselineFor(draft, spot, adminGrade), [draft, spot, adminGrade]);
  const view = useMemo(() => communityView(baseline, evals || []), [baseline, evals]);
  const bars = view.real >= BAR_MIN_EVALS;

  const toggle = (list, setList, other, t) => {
    if (list.includes(t)) setList(list.filter((x) => x !== t));
    else if (list.length < MAX_TRAITS && !other.includes(t)) setList([...list, t]);
  };
  const save = async () => {
    if (!user || !grade) return;
    setSaving(true); setError("");
    try {
      await saveNflEvaluation(user.uid, slug, { grade, strengths, weaknesses, evaluation: text.trim(), visibility });
      setSaved(new Date());
      setEvals(await loadNflEvaluations(slug));
    } catch (e) {
      setError("Couldn't save your evaluation. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const clearForm = () => {
    setGrade(""); setStrengths([]); setWeaknesses([]); setText(""); setVisibility("public"); setSaved(null);
  };
  const remove = async () => {
    if (!window.confirm("Remove your evaluation?")) return;
    try {
      await deleteNflEvaluation(user.uid, slug);
      clearForm();
      setEvals(await loadNflEvaluations(slug));
    } catch (e) {
      alert("❌ Failed to remove evaluation. Try again.");
    }
  };
  // The prospect page's archive: snapshot his saved evaluation, then clear it.
  const archiveIt = async () => {
    if (!saved) return;
    const overwrite = archive ? "\n\n⚠️ You already have an archived evaluation for this player. This will overwrite it." : "";
    if (!window.confirm(`📦 Archive this evaluation?\n\nArchiving takes a snapshot of your current evaluation and locks it as a read-only record. Your current evaluation will be cleared so you can start fresh.\n\nYou can only have one archive per player — archiving again will overwrite the previous snapshot.${overwrite}`)) return;
    setArchiving(true);
    try {
      const a = await archiveNflEvaluation(user.uid, slug, name);
      if (!a) { alert("Save your evaluation first before archiving."); return; }
      setArchive(a);
      clearForm();
      setEvals(await loadNflEvaluations(slug));
    } catch (e) {
      alert("❌ Failed to archive evaluation. Try again.");
    } finally {
      setArchiving(false);
    }
  };
  const removeArchive = async () => {
    if (!window.confirm("Delete your archived evaluation? This cannot be undone.")) return;
    try {
      await deleteNflArchive(user.uid, slug);
      setArchive(null);
    } catch (e) {
      alert("❌ Failed to delete archive. Try again.");
    }
  };

  // ── Player Grade ──
  const sourceLine = view.real === 0
    ? `We-Draft baseline${baseline.gradeNote ? ` · ${baseline.gradeNote}` : ""}`
    : view.fromBaseline
      ? `We-Draft baseline + ${view.real} evaluation${view.real === 1 ? "" : "s"}`
      : `Community grade · ${view.real} evaluation${view.real === 1 ? "" : "s"}`;
  const gradeCard = (
    <Section title="Player Grade" pad={false}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "200px 1fr 1fr" }}>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, borderRight: isMobile ? "none" : "1px solid #eef1f5", borderBottom: isMobile ? "1px solid #eef1f5" : "none" }}>
          {spot === undefined || adminGrade === undefined || evals == null ? <span style={{ fontFamily: BODY, fontSize: 13, color: MUTED }}>Loading…</span> : <><GradeBadge label={view.grade} /><GradeMeter avg={view.avg} scale={view.scale} /></>}
          <span style={{ fontFamily: BODY, fontSize: 11, color: MUTED, textAlign: "center", lineHeight: 1.4 }}>{sourceLine}</span>
        </div>
        <div style={{ padding: 18, borderRight: isMobile ? "none" : "1px solid #eef1f5", borderBottom: isMobile ? "1px solid #eef1f5" : "none" }}>
          {head("Top Strengths")}
          <TraitRows items={view.strengths} color="#16a34a" bars={bars} />
        </div>
        <div style={{ padding: 18 }}>
          {head("Top Weaknesses")}
          <TraitRows items={view.weaknesses} color="#dc2626" bars={bars} />
        </div>
      </div>
    </Section>
  );

  // ── My Evaluation — laid out like the prospect page's form: grade and
  // visibility dropdowns, strengths/weaknesses checkbox dropdowns, the
  // evaluation with its bullet button, then save.
  const label = (text, right = null) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 6, marginBottom: 10, borderBottom: `3px solid ${BLUE}` }}>
      <span style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 13, letterSpacing: "0.14em", color: BLUE, textTransform: "uppercase" }}>{text}</span>
      {right}
    </div>
  );
  const field = { width: "100%", boxSizing: "border-box", border: `2px solid ${BLUE}`, borderRadius: 6, padding: "8px 12px", fontFamily: BODY, fontWeight: 700, fontSize: 14, background: "#fff" };
  const pair = { display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 16 : 24 };
  const traitPicker = (title, list, setList, other) => (
    <div key={title}>
      {label(`${title} (max ${MAX_TRAITS})`)}
      <details style={{ border: `2px solid ${BLUE}`, borderRadius: 6, background: "#fff" }}>
        <summary style={{ cursor: "pointer", padding: "8px 12px", fontFamily: BODY, fontWeight: 700, fontSize: 14, color: list.length ? "#111" : "#999" }}>
          {list.length ? list.join(", ") : `Select ${title.toLowerCase()}`}
        </summary>
        <div style={{ padding: "8px 12px" }}>
          {Object.entries(traitOptions).map(([group, opts]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <p style={{ margin: "0 0 4px", fontFamily: HEAD, fontWeight: 900, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: BLUE }}>{group}</p>
              {opts.map((t) => (
                <label key={t} style={{ display: "block", padding: "4px 0", fontFamily: BODY, fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={list.includes(t)} disabled={(!list.includes(t) && list.length >= MAX_TRAITS) || other.includes(t)}
                    onChange={() => toggle(list, setList, other, t)} style={{ marginRight: 8 }} />
                  {t}
                </label>
              ))}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
  const insertBullet = () => {
    const el = textRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const insert = `${before && !before.endsWith("\n") ? "\n" : ""}• `;
    setText(before + insert + text.slice(end));
    const at = before.length + insert.length;
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at, at); });
  };
  const formCard = (
    <Section title="My Evaluation" right={saved && <span style={{ fontFamily: BODY, fontSize: 11, color: MUTED }}>Saved {saved.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}>
      {!user ? (
        <div style={{ textAlign: "center", padding: "6px 0" }}>
          <p style={{ margin: "0 0 12px", fontFamily: BODY, fontSize: 14, color: MUTED }}>Sign in to grade {first} and add your scouting report.</p>
          <button onClick={login} style={{ background: BLUE, color: "#fff", border: "none", borderRadius: 999, padding: "8px 20px", fontFamily: HEAD, fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", cursor: "pointer" }}>SIGN IN</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: isMobile ? 16 : 24 }}>
          <div style={pair}>
            <div>
              {label("Grade")}
              <select value={grade} onChange={(e) => setGrade(e.target.value)} style={{ ...field, color: grade ? "#111" : "#999" }}>
                <option value="">Select a grade</option>
                <option value={WATCHLIST.label}>{WATCHLIST.label}</option>
                <optgroup label="Player Grades">{NFL_GRADES.map((g) => <option key={g.label} value={g.label}>{g.label}</option>)}</optgroup>
                <optgroup label="Developmental Grades">{DEV_GRADES.map((g) => <option key={g.label} value={g.label}>{g.label}</option>)}</optgroup>
              </select>
            </div>
            <div>
              {label("Visibility")}
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={field}>
                <option value="public">🌍 Public</option>
                <option value="private">🔒 Private</option>
              </select>
            </div>
          </div>
          <div style={pair}>
            {traitPicker("Strengths", strengths, setStrengths, weaknesses)}
            {traitPicker("Weaknesses", weaknesses, setWeaknesses, strengths)}
          </div>
          <div>
            {label("Evaluation", (
              <button type="button" onClick={insertBullet} style={{ background: "#fff", border: `1.5px solid ${BLUE}`, color: BLUE, borderRadius: 6, padding: "4px 10px", fontFamily: BODY, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", cursor: "pointer" }}>• Add Bullet</button>
            ))}
            <textarea ref={textRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your evaluation... start a line with • or - for bullet points"
              style={{ ...field, fontWeight: 500, height: 128, resize: "vertical", lineHeight: 1.5 }} />
            <div style={{ fontFamily: BODY, fontSize: 11, color: "#999", marginTop: 4 }}>Tip: start any line with • or - to make it a bullet point.</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <button type="button" onClick={save} disabled={!grade || saving} style={{
              width: "100%", background: grade ? BLUE : "#d5dce6", color: "#fff", border: `2px solid ${grade ? GOLD : "#d5dce6"}`, borderRadius: 6, padding: "12px 0",
              fontFamily: HEAD, fontWeight: 900, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", cursor: grade ? "pointer" : "default",
            }}>{saving ? "Saving..." : "Save Evaluation"}</button>
            {(saved || archive) && (
              <button type="button" onClick={archiveIt} disabled={archiving || !saved} style={{
                width: "100%", background: "#fff", border: `2px solid ${GOLD}`, color: saved ? "#7a5c00" : "#bbb", borderRadius: 6, padding: "12px 0",
                fontFamily: HEAD, fontWeight: 900, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", cursor: saved ? "pointer" : "default",
              }}>{archiving ? "Archiving..." : archive ? "📦 Update Archive" : "📦 Archive This Evaluation"}</button>
            )}
            {saved && <button type="button" onClick={remove} style={{ background: "none", border: "none", padding: "4px 0 0", fontFamily: BODY, fontSize: 12, color: "#9ca3af", textDecoration: "underline", cursor: "pointer" }}>Delete Evaluation</button>}
            {!grade && <span style={{ fontFamily: BODY, fontSize: 12, color: MUTED, textAlign: "center" }}>Pick a grade to save.</span>}
            {error && <span style={{ fontFamily: BODY, fontSize: 12, color: "#c8102e", textAlign: "center" }}>{error}</span>}
          </div>
        </div>
      )}
    </Section>
  );

  // ── My Archived Evaluation — the prospect page's gold read-only card ──
  const archivedOn = archive && (archive.archivedAt?.toDate?.() || (archive.archivedAtISO ? new Date(archive.archivedAtISO) : null));
  const archiveHead = (t) => (
    <div style={{ fontFamily: HEAD, fontSize: 10, fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: `2px solid ${BLUE}`, paddingBottom: 4, marginBottom: 8 }}>{t}</div>
  );
  const archiveList = (items) => items.map((t, i) => (
    <div key={t} style={{ fontFamily: HEAD, fontSize: isMobile ? 12 : 13, fontWeight: 900, color: "#222", textTransform: "uppercase", letterSpacing: "0.04em", padding: "3px 0", borderBottom: i < items.length - 1 ? "1px solid #f0f0f0" : "none" }}>{t}</div>
  ));
  const archiveCard = user && archive && (
    <section>
      <h2 style={{ margin: "4px 0 12px 2px", color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: 14, letterSpacing: "0.14em", textTransform: "uppercase" }}>My Archived Evaluation</h2>
      <div style={{ background: "#fff", borderRadius: 8, overflow: "hidden", border: `2px solid ${GOLD}` }}>
        <div style={{ background: "linear-gradient(135deg, #7a5c00 0%, #b8860b 100%)", padding: isMobile ? "8px 12px" : "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>📦</span>
            <span style={{ fontFamily: HEAD, fontWeight: 900, color: "#fff", fontSize: isMobile ? 12 : 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>Archived Snapshot</span>
            <span style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontFamily: BODY, fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 20, letterSpacing: "0.08em" }}>READ ONLY</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {archivedOn && <span style={{ fontFamily: BODY, color: "#fff", fontSize: 14, fontWeight: 900 }}>{archivedOn.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
            <button type="button" onClick={removeArchive} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff", borderRadius: 6, padding: "4px 10px", fontFamily: BODY, fontSize: 11, fontWeight: 900, cursor: "pointer", letterSpacing: "0.04em" }}>Delete</button>
          </div>
        </div>
        <div style={{ padding: isMobile ? 12 : 20, display: "grid", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}><GradeBadge label={archive.grade} size="sm" /></div>
          {(archive.strengths?.length > 0 || archive.weaknesses?.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
              {archive.strengths?.length > 0 && <div>{archiveHead("Strengths")}{archiveList(archive.strengths)}</div>}
              {archive.weaknesses?.length > 0 && <div>{archiveHead("Weaknesses")}{archiveList(archive.weaknesses)}</div>}
            </div>
          )}
          {archive.evaluation && (
            <div>
              {archiveHead("Scout's Take")}
              <div style={{ fontFamily: BODY, fontStyle: "italic", fontSize: isMobile ? 13 : 15, color: "#222", lineHeight: 1.6, whiteSpace: "pre-line" }}>{archive.evaluation}</div>
            </div>
          )}
          <div style={{ fontFamily: BODY, fontSize: 11, fontWeight: 700, color: "#bbb", textAlign: "center", fontStyle: "italic" }}>
            This evaluation is locked and cannot be edited. Use "Archive This Evaluation" on your current eval to update it.
          </div>
        </div>
      </div>
    </section>
  );

  // ── Public Evaluations ──
  const feedHead = (label) => (
    <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 9 : 12, color: BLUE, textTransform: "uppercase", letterSpacing: "0.12em", borderBottom: `2px solid ${BLUE}`, paddingBottom: 3, marginBottom: 6 }}>{label}</div>
  );
  const feedList = (items) => (items?.length ? items : ["—"]).map((t) => (
    <div key={t} style={{ fontFamily: HEAD, fontWeight: 900, fontSize: isMobile ? 11 : 13, textTransform: "uppercase", color: "#222", letterSpacing: "0.05em", padding: "2px 0" }}>{t}</div>
  ));
  const feedCard = (ev) => (
    <div key={ev.uid} style={{ background: "#fff", borderRadius: 8, overflow: "hidden", border: `2px solid ${BLUE}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", background: BLUE }}>
        <span style={{ fontFamily: HEAD, fontWeight: 900, color: "#fff", textTransform: "uppercase", fontSize: isMobile ? 13 : 16 }}>
          <VerifiedNameBadge uid={ev.uid} name={ev.username} verified={ev.verified} size={16} />
        </span>
        {ev.updatedAt?.toDate && <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 700, fontFamily: BODY }}>{ev.updatedAt.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "auto 1fr 1fr" : "140px 1fr 1fr" }}>
        <div style={{ padding: isMobile ? 8 : 14, display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #e5e7eb" }}><GradeBadge label={ev.grade} size="sm" /></div>
        <div style={{ padding: isMobile ? 8 : 14, borderRight: "1px solid #e5e7eb", minWidth: 0 }}>{feedHead("Strengths")}{feedList(ev.strengths)}</div>
        <div style={{ padding: isMobile ? 8 : 14, minWidth: 0 }}>{feedHead("Weaknesses")}{feedList(ev.weaknesses)}</div>
      </div>
      <div style={{ borderTop: "1px solid #e5e7eb", padding: isMobile ? 10 : "12px 14px" }}>
        {feedHead("Scout's Take")}
        <div style={{ borderLeft: `3px solid ${BLUE}`, background: "#fafafa", borderRadius: "0 4px 4px 0", padding: "8px 12px", fontFamily: BODY, fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "#111", lineHeight: 1.65, whiteSpace: "pre-line" }}>{ev.evaluation}</div>
      </div>
    </div>
  );
  const feedSection = (
    <section>
      <h2 style={{ margin: "4px 0 12px 2px", color: BLUE, fontFamily: HEAD, fontWeight: 900, fontSize: 14, letterSpacing: "0.14em", textTransform: "uppercase" }}>Public Evaluations</h2>
      {feed.length ? (
        <div style={{ display: "grid", gap: 14 }}>
          {feed.slice(0, shown).map(feedCard)}
          {shown < feed.length && (
            <button onClick={() => setShown((n) => n + 3)} style={{ background: BLUE, border: `2px solid ${GOLD}`, color: "#fff", borderRadius: 8, padding: "10px 0", fontFamily: HEAD, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>Show More</button>
          )}
        </div>
      ) : <p style={{ margin: 0, fontFamily: BODY, fontSize: 14, fontStyle: "italic", color: "#98a3b3" }}>No public evaluations yet. Be the first to evaluate {first}.</p>}
    </section>
  );

  return <div style={{ display: "grid", gap: 16 }}>{gradeCard}{formCard}{archiveCard}{feedSection}</div>;
}
