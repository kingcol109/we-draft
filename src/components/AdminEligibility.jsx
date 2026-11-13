// src/components/AdminEligibility.jsx
//
// Admin → Players → Offseason Manager → Eligibility Manager. View and change
// every active prospect's draft class, tagged by recruiting class (True,
// +1, +2 — utils/eligibility.js), and work the offseason's gaps.
//
// Issues: what looks wrong, each with Fix (the suggested write) and Ignore
// (offseason/eligibility.ignored, keyed by player + issue + suggested
// value, so a new suggestion shows up again). Nothing is written without an
// admin click — CFBD data only suggests (offseason/cfbd, built by
// server/offseason/cfbdIndex.js).
// Class Board: one class at a time — Declare locks a player in (not
// final; it just files them away and hides their final-year issue),
// Return moves a current-class player to the next class as a +1/+2, the
// class menu moves them anywhere.
//
// Every class change goes through classChange(): Eligible, a ClassHistory
// entry ({ from, to, reason, at }), Declared cleared, and the slug deferred
// to the next Feb 1 (PendingSlugChangeAt, scripts/applyPendingSlugChanges.js)
// — the same path as a Transfer Portal resolve.
import { useEffect, useMemo, useState } from "react";
import { arrayUnion, deleteField, doc, FieldPath, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "../firebase";
import { averageGradesFor } from "../utils/communityGrades";
import { gradeLabel } from "../utils/gradeScale";
import {
  currentDraftClass, firstClassFor, lastClassFor, classTag, inFinalYear, classHistoryEntry, movedInto, nextFebFirstUTC,
} from "../utils/eligibility";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#c0392b";
const GREEN = "#2e7d32";
const ORANGE = "#b45309";
const PAGE = 100;
const btn = (on, color = BLUE) => ({
  padding: "6px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "8px", cursor: "pointer", background: on ? color : "#fff", color: on ? "#fff" : color, whiteSpace: "nowrap",
});
const small = (color = BLUE, on = false) => ({ ...btn(on, color), padding: "3px 8px", fontSize: "11px", borderRadius: "6px" });

// The writes for moving a player to class `to` — shared with the Transfer
// Portal's resolve. { fields } for updateDoc / a batch, { local, removed }
// for the admin panel's in-memory copy.
export function classChange(p, to, reason) {
  const entry = classHistoryEntry(p.Eligible, to, reason);
  const pending = nextFebFirstUTC();
  return {
    fields: {
      Eligible: String(to), ClassHistory: arrayUnion(entry), PendingSlugChangeAt: pending,
      Declared: deleteField(), DeclaredAt: deleteField(), updatedAt: serverTimestamp(),
    },
    local: { Eligible: String(to), ClassHistory: [...(p.ClassHistory || []), entry], PendingSlugChangeAt: pending },
    removed: ["Declared", "DeclaredAt"],
  };
}

// The write each Fix makes.
function fixWrite(p, fix, season) {
  if (fix.kind === "class") return classChange(p, fix.to, fix.reason || "fix");
  // No updatedAt (it drives the sitemap's lastmod) — nothing public changes.
  if (fix.kind === "recruit") return { fields: { RecruitYear: String(fix.value) }, local: { RecruitYear: String(fix.value) }, removed: [] };
  if (fix.kind === "declare") return { fields: { Declared: true, DeclaredAt: serverTimestamp() }, local: { Declared: true, DeclaredAt: new Date() }, removed: [] };
  if (fix.kind === "undeclare") return { fields: { Declared: deleteField(), DeclaredAt: deleteField() }, local: {}, removed: ["Declared", "DeclaredAt"] };
  if (fix.kind === "school") {
    const local = { School: fix.to, PriorSchool: p.School || "", PriorSchoolYear: String((season || new Date().getFullYear()) - 1) };
    return { fields: { ...local, updatedAt: serverTimestamp() }, local, removed: [] };
  }
  throw new Error("unknown fix " + fix.kind);
}

// Issue groups, most serious first.
const GROUPS = [
  { code: "early", title: "Listed before they're draft-eligible", color: RED },
  { code: "pastLimit", title: "Listed past their last year of eligibility", color: RED },
  { code: "beyondTrue", title: "Listed past their true class with no recorded return", color: ORANGE },
  { code: "school", title: "School doesn't match CFBD's roster", color: ORANGE },
  { code: "finalYear", title: "Final year of eligibility — not declared", color: ORANGE },
  { code: "recruitDiff", title: "Saved recruit year differs from CFBD", color: BLUE },
  { code: "recruit", title: "Recruit year from CFBD — not saved yet", color: BLUE },
  { code: "recruitNone", title: "No recruit year anywhere", color: "#777" },
];

function issuesFor(p, row, current, season) {
  const out = [];
  const E = Number(p.Eligible);
  const saved = p.RecruitYear ? Number(p.RecruitYear) : null;
  const rc = row?.rc ? Number(row.rc) : null;
  const ry = saved || rc;
  const src = saved ? "" : " (CFBD)";
  const add = (code, sig, text, fix) => out.push({ code, sig: String(sig ?? ""), text, fix });

  if (!saved && rc) add("recruit", rc, `CFBD recruiting class ${rc} → ${classTag(E, rc)} ${E}`, { kind: "recruit", value: rc, label: `Save ${rc}` });
  else if (!saved) add("recruitNone", "", `No recruiting class${row ? (row.yr ? ` — CFBD class year ${row.yr}` : "") : " — not linked to CFBD"}`, { kind: "recruit", value: E - 3, label: `Save ${E - 3} (true ${E})`, manual: true });
  else if (rc && saved !== rc) add("recruitDiff", rc, `Saved ${saved}, CFBD says ${rc}`, { kind: "recruit", value: rc, label: `Use ${rc}` });

  if (ry) {
    const first = firstClassFor(ry);
    const last = lastClassFor(ry, current);
    const tag = classTag(E, ry);
    if (E < first) add("early", first, `Recruited ${ry}${src} — not eligible until ${first}`, { kind: "class", to: first, label: `Move to ${first}` });
    else if (E > last) add("pastLimit", last, `Recruited ${ry}${src} — eligibility ends after the ${last - 1} season`, { kind: "class", to: last, label: `Move to ${last}` });
    else if (E > first && first >= Number(current) && !movedInto(p) && !p.Declared) add("beyondTrue", E, `Recruited ${ry}${src} — a true ${first}, listed ${E} (${tag})`, { kind: "class", to: first, label: `Move to ${first}` });
    if (inFinalYear(E, ry, current) && !p.Declared) add("finalYear", E, `Recruited ${ry}${src} (${tag}) — no eligibility after this season`, { kind: "declare", label: "Declare 🔒" });
  }
  if (row?.s && p.School && row.s !== p.School && !p.InPortal) {
    add("school", row.s, `CFBD's ${season || ""} roster has them at ${row.s}`, { kind: "school", to: row.s, label: `Move to ${row.s}` });
  }
  return out;
}

const issueKey = (p, i) => `${p.id}|${i.code}|${i.sig}`;
const fmtWhen = (t) => { const d = t?.toDate ? t.toDate() : t ? new Date(t) : null; return d ? d.toLocaleString() : ""; };

function Tag({ tag }) {
  if (!tag) return <span style={{ color: "#bbb", fontWeight: 800, fontSize: "11px" }}>—</span>;
  const color = tag === "True" ? GREEN : tag === "Early" ? RED : tag === "+1" ? BLUE : ORANGE;
  return <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: "10px", border: `1.5px solid ${color}`, color, fontWeight: 900, fontSize: "11px" }}>{tag}</span>;
}

function PlayerLink({ p }) {
  return (
    <>
      <a href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 900 }}>{p.First} {p.Last}</a>
      <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 800, color: "#888" }}>{p.Position} · {p.School}</span>
    </>
  );
}

// Recruit year cell: the saved year, or CFBD's (grey, unsaved); Enter or
// blur saves a typed one.
function RecruitInput({ p, rc, onSave }) {
  const [v, setV] = useState(p.RecruitYear || "");
  useEffect(() => setV(p.RecruitYear || ""), [p.RecruitYear]);
  const commit = () => { if (/^\d{4}$/.test(v) && v !== (p.RecruitYear || "")) onSave(v); };
  return (
    <input value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, "").slice(0, 4))} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={rc ? String(rc) : "—"} title={p.RecruitYear ? "Saved recruit year" : rc ? `CFBD: ${rc} (not saved)` : "No recruit year"}
      style={{ width: "54px", border: "1.5px solid #d6dce5", borderRadius: "6px", padding: "3px 5px", fontWeight: 800, fontSize: "12px", color: "#1d2733" }} />
  );
}

export default function AdminEligibility({ allPlayers, setAllPlayers }) {
  const current = currentDraftClass();
  const classes = [current, String(+current + 1), String(+current + 2)];
  const [cfbd, setCfbd] = useState(null);
  const [ignored, setIgnored] = useState({});
  const [grades, setGrades] = useState({});
  const [view, setView] = useState("issues");
  const [cls, setCls] = useState(current);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [showIgnored, setShowIgnored] = useState(false);
  const [open, setOpen] = useState({});
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    try {
      const [c, e] = await Promise.all([getDoc(doc(db, "offseason", "cfbd")), getDoc(doc(db, "offseason", "eligibility"))]);
      setCfbd(c.data() || { rows: {}, missing: true });
      setIgnored(e.data()?.ignored || {});
    } catch (err) {
      console.error("Eligibility load error:", err);
      setCfbd({ rows: {}, error: true });
    }
  };
  useEffect(() => { load(); }, []);

  const active = useMemo(() => allPlayers.filter((p) => Number(p.Eligible) >= Number(current)), [allPlayers, current]);
  useEffect(() => {
    if (!active.length) return;
    averageGradesFor(active.map((p) => p.id)).then(setGrades).catch(() => {});
  }, [active.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = cfbd?.rows || {};
  const season = cfbd?.season || null;
  const ryOf = (p) => (p.RecruitYear ? Number(p.RecruitYear) : rows[p.id]?.rc ? Number(rows[p.id].rc) : null);
  const byGrade = (a, b) => (grades[a.id] ?? 99) - (grades[b.id] ?? 99) || (a.Last || "").localeCompare(b.Last || "");

  const issues = useMemo(() => {
    if (!cfbd) return [];
    return active.flatMap((p) => issuesFor(p, rows[p.id], current, season).map((i) => ({ ...i, p, key: issueKey(p, i), ignored: !!ignored[issueKey(p, i)] })));
  }, [active, cfbd, ignored, current]); // eslint-disable-line react-hooks/exhaustive-deps
  const openIssues = issues.filter((i) => !i.ignored);

  const patch = (id, local, removed) => setAllPlayers((prev) => prev.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p, ...local };
    removed.forEach((k) => delete next[k]);
    return next;
  }));

  // Writes [{ p, fix }] — one batch per 400.
  const applyAll = async (items, doneText, busyKey) => {
    setBusy(busyKey); setMessage("");
    try {
      const writes = items.map(({ p, fix }) => ({ p, w: fixWrite(p, fix, season) }));
      for (let i = 0; i < writes.length; i += 400) {
        const batch = writeBatch(db);
        writes.slice(i, i + 400).forEach(({ p, w }) => batch.update(doc(db, "players", p.id), w.fields));
        await batch.commit();
        writes.slice(i, i + 400).forEach(({ p, w }) => patch(p.id, w.local, w.removed));
      }
      setMessage(doneText);
    } catch (e) {
      console.error("Eligibility update error:", e);
      setMessage("Update failed — check console.");
    } finally {
      setBusy(null);
    }
  };
  const apply = (p, fix, text) => applyAll([{ p, fix }], text || `${p.First} ${p.Last}: ${fix.label || "updated"}.`, p.id + fix.kind);
  const moveClass = (p, to, reason) => {
    const tag = classTag(to, ryOf(p));
    return apply(p, { kind: "class", to, reason }, `${p.First} ${p.Last} → ${to} class${tag ? ` (${tag})` : ""}. Slug updates Feb 1.`);
  };
  const returnToSchool = (p) => {
    const to = String(+p.Eligible + 1);
    if (inFinalYear(p.Eligible, ryOf(p), current)
      && !window.confirm(`${p.First} ${p.Last} has no eligibility left after this season (recruited ${ryOf(p)}). Move them to ${to} anyway (e.g. an injury waiver)?`)) return;
    moveClass(p, to, "returning");
  };

  const setIgnore = async (i, on) => {
    const ref = doc(db, "offseason", "eligibility");
    try {
      if (on) await setDoc(ref, { ignored: { [i.key]: true } }, { merge: true });
      else await updateDoc(ref, new FieldPath("ignored", i.key), deleteField());
      setIgnored((prev) => { const n = { ...prev }; if (on) n[i.key] = true; else delete n[i.key]; return n; });
    } catch (e) {
      console.error("Eligibility ignore error:", e);
      setMessage("Ignore failed — check console (firestore.rules needs the offseason rule deployed).");
    }
  };

  const refresh = async () => {
    setRefreshing(true); setMessage("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/portal-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "cfbdIndex" }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) throw new Error("the endpoint isn't deployed here (it runs on the live site). Locally: node --env-file=.env scripts/buildOffseasonIndex.js");
      if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setMessage(`CFBD data rebuilt — ${j.linked} linked players (${j.season} rosters).`);
      await load();
    } catch (e) {
      setMessage(`Refresh failed: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const matches = (p) => !needle || `${p.First} ${p.Last} ${p.School} ${p.Position}`.toLowerCase().includes(needle);

  // ── Current-class summary ──
  const inCurrent = active.filter((p) => p.Eligible === current);
  const finalOpen = inCurrent.filter((p) => !p.Declared && inFinalYear(p.Eligible, ryOf(p), current));
  const movedOut = allPlayers.filter((p) => (p.ClassHistory || []).some((h) => h.from === current && (h.reason === "returning" || h.reason === "transfer")) && p.Eligible !== current);
  const summary = [
    [`${current} class`, inCurrent.length, "#1d2733"],
    ["Declared 🔒", inCurrent.filter((p) => p.Declared).length, GREEN],
    ["Undecided", inCurrent.filter((p) => !p.Declared && !finalOpen.includes(p)).length, BLUE],
    ["Final year, not declared", finalOpen.length, ORANGE],
    [`Back in school → ${+current + 1}`, movedOut.length, "#6d28d9"],
  ];

  // ── Class Board rows ──
  const boardRows = useMemo(() => active.filter((p) => p.Eligible === cls && matches(p)).filter((p) => {
    if (status === "declared") return p.Declared;
    if (status === "undecided") return !p.Declared;
    if (status === "final") return !p.Declared && inFinalYear(p.Eligible, ryOf(p), current);
    if (status === "moved") return movedInto(p);
    return true;
  }).sort(byGrade), [active, cls, needle, status, grades, cfbd]); // eslint-disable-line react-hooks/exhaustive-deps

  const issueList = (showIgnored ? issues : openIssues).filter((i) => matches(i.p));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
        <button type="button" onClick={refresh} disabled={refreshing} style={{ ...btn(true, GOLD), color: "#121212", opacity: refreshing ? 0.6 : 1 }}>
          {refreshing ? "Rebuilding…" : "🔄 Refresh CFBD data"}
        </button>
        <span style={{ fontSize: "12px", fontWeight: 700, color: cfbd?.error || cfbd?.missing ? RED : "#777" }}>
          {!cfbd ? "Loading…" : cfbd.error ? "Couldn't read offseason/cfbd — is the offseason rule in firestore.rules deployed?"
            : cfbd.missing ? "No CFBD data yet — Refresh, or run scripts/buildOffseasonIndex.js."
            : `CFBD ${season} rosters · ${cfbd.linked} linked players · built ${fmtWhen(cfbd.builtAt)}`}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
        {summary.map(([label, n, color]) => (
          <div key={label} style={{ border: `2px solid ${color}`, borderRadius: "10px", padding: "6px 12px", background: "#fff" }}>
            <div style={{ fontSize: "20px", fontWeight: 900, color, lineHeight: 1 }}>{n}</div>
            <div style={{ fontSize: "11px", fontWeight: 800, color: "#666", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
          </div>
        ))}
      </div>

      {message && <div style={{ marginBottom: "12px", fontSize: "13px", fontWeight: 800, color: /failed/i.test(message) ? RED : GREEN }}>{message}</div>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "14px" }}>
        <button type="button" onClick={() => setView("issues")} style={btn(view === "issues")}>Issues ({openIssues.length})</button>
        <button type="button" onClick={() => setView("board")} style={btn(view === "board")}>Class Board</button>
        <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search name, school, position…"
          style={{ flex: "1 1 200px", maxWidth: "320px", border: "2px solid #d6dce5", borderRadius: "8px", padding: "6px 10px", fontWeight: 700 }} />
      </div>

      {view === "issues" ? (
        <div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#555", marginBottom: "10px" }}>
            <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> Show ignored
          </label>
          {!cfbd ? <div style={{ color: "#999", fontWeight: 700 }}>Loading…</div> : issueList.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#999", fontWeight: 700, border: "1px dashed #ccc", borderRadius: "8px" }}>No open issues.</div>
          ) : GROUPS.map((g) => {
            const list = issueList.filter((i) => i.code === g.code).sort((a, b) => byGrade(a.p, b.p));
            if (!list.length) return null;
            const fixable = list.filter((i) => !i.ignored);
            const isOpen = open[g.code] ?? list.length <= 25;
            return (
              <div key={g.code} style={{ border: "1px solid #e3e7ee", borderLeft: `4px solid ${g.color}`, borderRadius: "8px", marginBottom: "10px", background: "#fff" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", padding: "10px 12px", cursor: "pointer" }}
                  onClick={() => setOpen((o) => ({ ...o, [g.code]: !isOpen }))}>
                  <span style={{ fontWeight: 900, color: g.color, fontSize: "14px" }}>{isOpen ? "▾" : "▸"} {g.title}</span>
                  <span style={{ fontWeight: 900, color: "#888", fontSize: "13px" }}>{list.length}</span>
                  {fixable.length > 1 && (
                    <button type="button" disabled={!!busy} style={{ ...small(g.color, true), marginLeft: "auto" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!window.confirm(`Apply the suggested fix to all ${fixable.length}?\n\n${fixable.slice(0, 8).map((i) => `${i.p.First} ${i.p.Last}: ${i.fix.label}`).join("\n")}${fixable.length > 8 ? `\n…and ${fixable.length - 8} more` : ""}`)) return;
                        applyAll(fixable.map((i) => ({ p: i.p, fix: i.fix })), `Fixed ${fixable.length}: ${g.title.toLowerCase()}.`, "group" + g.code);
                      }}>
                      {busy === "group" + g.code ? "Saving…" : `Fix all ${fixable.length}`}
                    </button>
                  )}
                </div>
                {isOpen && list.map((i) => (
                  <div key={i.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", padding: "7px 12px", borderTop: "1px solid #f0f2f5", opacity: i.ignored ? 0.5 : 1 }}>
                    <div style={{ flex: "1 1 280px", minWidth: 0, fontSize: "13px" }}>
                      <PlayerLink p={i.p} />
                      <span style={{ marginLeft: "8px" }}><Tag tag={classTag(i.p.Eligible, ryOf(i.p))} /></span>
                      <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 900, color: "#555" }}>{i.p.Eligible}</span>
                      {grades[i.p.id] != null && <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 800, color: "#888" }}>{gradeLabel(grades[i.p.id])}</span>}
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#555", marginTop: "2px" }}>{i.text}</div>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      {i.fix.manual && !i.ignored && <RecruitInput p={i.p} rc={null} onSave={(v) => apply(i.p, { kind: "recruit", value: v, label: `recruit year ${v}` })} />}
                      {!i.ignored && <button type="button" disabled={!!busy} onClick={() => apply(i.p, i.fix)} style={small(BLUE, true)}>{busy === i.p.id + i.fix.kind ? "Saving…" : i.fix.label}</button>}
                      <button type="button" onClick={() => setIgnore(i, !i.ignored)} style={small("#888")}>{i.ignored ? "Restore" : "Ignore"}</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#999", marginTop: "8px" }}>
            First class = recruiting class + 3; last = + 5 (five seasons, no redshirts). Class moves defer the slug to Feb 1. Ignore hides an issue until its suggestion changes.
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", marginBottom: "10px" }}>
            {classes.map((c) => <button key={c} type="button" onClick={() => { setCls(c); setShown(PAGE); }} style={btn(cls === c, GOLD)}>{c}</button>)}
            <span style={{ width: "10px" }} />
            {[["all", "All"], ["undecided", "Undecided"], ["final", "Final year"], ["declared", "Declared"], ["moved", "Moved in"]].map(([v, label]) => (
              <button key={v} type="button" onClick={() => { setStatus(v); setShown(PAGE); }} style={small(BLUE, status === v)}>{label}</button>
            ))}
            <span style={{ fontSize: "12px", fontWeight: 800, color: "#888" }}>{boardRows.length} players</span>
          </div>
          <div style={{ border: "1px solid #e3e7ee", borderRadius: "8px", overflowX: "auto", background: "#fff" }}>
            <div style={{ minWidth: "860px" }}>
              <div style={{ display: "grid", gridTemplateColumns: BOARD_COLS, gap: "10px", padding: "7px 12px", fontSize: "11px", fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "2px solid #e3e7ee" }}>
                <span>Grade</span><span>Player</span><span>Recruit</span><span>Tag</span><span>Status</span><span>Class</span><span />
              </div>
              {boardRows.slice(0, shown).map((p, n) => {
                const ry = ryOf(p);
                const final = inFinalYear(p.Eligible, ry, current);
                const last = (p.ClassHistory || []).slice(-1)[0];
                const moved = movedInto(p) && last?.to === p.Eligible ? last : null;
                const b = (k) => busy === p.id + k;
                return (
                  <div key={p.id} style={{ display: "grid", gridTemplateColumns: BOARD_COLS, gap: "10px", alignItems: "center", padding: "6px 12px", fontSize: "13px", background: n % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0" }}>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: "#666" }}>{gradeLabel(grades[p.id]) || "—"}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><PlayerLink p={p} /></span>
                    <span><RecruitInput p={p} rc={rows[p.id]?.rc} onSave={(v) => apply(p, { kind: "recruit", value: v, label: `recruit year ${v}` })} /></span>
                    <span><Tag tag={classTag(p.Eligible, ry)} /></span>
                    <span style={{ fontSize: "11px", fontWeight: 900, color: p.Declared ? GREEN : moved ? "#6d28d9" : final ? ORANGE : "#888" }}>
                      {p.Declared ? "Declared 🔒" : moved ? (moved.reason === "transfer" ? `Transfer from ${moved.from}` : moved.reason === "returning" ? `Returned from ${moved.from}` : `Moved from ${moved.from}`) : final ? "Final year" : "Undecided"}
                    </span>
                    <span>
                      <select value={p.Eligible} disabled={!!busy}
                        onChange={(e) => { const to = e.target.value; if (window.confirm(`Move ${p.First} ${p.Last} from ${p.Eligible} to the ${to} class? Slug updates Feb 1.`)) moveClass(p, to, "admin"); }}
                        style={{ border: "1.5px solid #d6dce5", borderRadius: "6px", padding: "3px 4px", fontWeight: 800, fontSize: "12px" }}>
                        {[...new Set([...classes, String(+current + 3), p.Eligible])].sort().map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </span>
                    <span style={{ display: "flex", gap: "5px", justifyContent: "flex-end" }}>
                      {p.Declared
                        ? <button type="button" disabled={!!busy} onClick={() => apply(p, { kind: "undeclare", label: "unlocked" })} style={small("#888")}>{b("undeclare") ? "…" : "Unlock"}</button>
                        : <button type="button" disabled={!!busy} onClick={() => apply(p, { kind: "declare", label: "declared 🔒" })} style={small(GREEN, true)}>{b("declare") ? "…" : "Declare"}</button>}
                      {p.Eligible === current && !p.Declared && (
                        <button type="button" disabled={!!busy} onClick={() => returnToSchool(p)} style={small("#6d28d9")}>
                          {b("class") ? "…" : `Return → ${+current + 1}${ry ? ` (${classTag(+current + 1, ry)})` : ""}`}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
              {boardRows.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "#999", fontWeight: 700 }}>No players match.</div>}
            </div>
          </div>
          {boardRows.length > shown && <button type="button" onClick={() => setShown((s) => s + PAGE)} style={{ ...btn(false), marginTop: "10px" }}>Show more ({boardRows.length - shown} left)</button>}
        </div>
      )}
    </div>
  );
}

const BOARD_COLS = "90px minmax(220px, 2fr) 64px 56px 150px 78px minmax(170px, 1fr)";
