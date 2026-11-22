// src/components/profileHub/MyBinderTab.jsx
//
// Profile → My Binder: the user's own things to keep. For now, printing
// their evaluations — pick any of them, preview, print (or Save as PDF).
// One player per page, the personal print format (utils/printLayouts.js):
// letter size, centered, room to hole-punch, no page numbers.
//
// Each page is theirs ("My evaluation": their grade, traits, NFL fit,
// written evaluation and their own ranks — from their grades or their
// Whiteboard), the community's ("Community page": the community grade,
// breakdown, traits and a public scouting report), or a blank to fill in
// by hand ("Fill-in": grade bubbles to darken, lines for strengths,
// weaknesses, NFL fit and the evaluation, boxes for ranks) — picked per
// page, or for all at once. Fill-in sheets work for any player, not just
// ones they've evaluated: "Add any player" searches the whole prospect
// list (compSnapshots/_search). The player's measurables, bio, career path
// and college stats are on every version.
//
// Customize: the same layout controls admins have (components/print/
// LayoutControls.jsx), saved to their account
// (users/{uid}/printSettings/evaluation); "Reset to default" goes back to
// the layout admins set in Admin → Print → Personal.
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import LoadingSpinner from "../LoadingSpinner";
import EvaluationPage from "../print/EvaluationPage";
import PrintRoot, { printAs } from "../print/PrintRoot";
import LayoutControls, { Seg } from "../print/LayoutControls";
import BinderBoards from "./BinderBoards";
import {
  FORMATS, loadLayout, loadMyRanks, loadPrintPlayer, loadUserLayout, mineFrom, normalizeLayout, resetUserLayout, saveUserLayout,
} from "../../utils/printLayouts";
import { gradeLook } from "../../utils/gradeScale";
import { getSiteSnapshot } from "../../utils/siteSnapshots";
import { isUnreleasedYear } from "../../utils/prospectYears";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const NAVY = "#0f1b2d";
const BODY = "Arial, sans-serif";
const card = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)" };
const MAX_PAGES = 25; // per print job — each page reads its player's data
const F = FORMATS.personal;
const toMs = (ts) => (ts?.toDate?.() ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function MyBinderTab({ uid, isMobile }) {
  const [evals, setEvals] = useState(null);
  const [username, setUsername] = useState("");
  const [baseLayout, setBaseLayout] = useState(null); // the admins' personal layout
  const [layout, setLayout] = useState(null); // what the pages use (theirs, or the base)
  const [savedJson, setSavedJson] = useState("");
  const [custom, setCustom] = useState(false); // they have their own saved layout
  const [picked, setPicked] = useState([]); // player ids, in list order
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState(null); // null | "loading" | [{ id, data | null }]
  const [version, setVersion] = useState({}); // id → "mine" | "community" | "blank"
  const [extra, setExtra] = useState({}); // players added for fill-in sheets: id → { id, First, Last, Position, School, Eligible }
  const [allPlayers, setAllPlayers] = useState(null); // the _search index, loaded on first use
  const [addSearch, setAddSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState({}); // the sections that are open — none at first
  const [boardsOpen, setBoardsOpen] = useState(false); // Board Lists is previewing
  const [msg, setMsg] = useState("");
  const [width, setWidth] = useState(800);
  const stageRef = useRef(null);

  useEffect(() => {
    let live = true;
    getDocs(collection(db, "users", uid, "evaluations"))
      .then((s) => live && setEvals(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => toMs(b.updatedAt) - toMs(a.updatedAt))))
      .catch((e) => { console.error("My Binder evaluations error:", e); if (live) setEvals([]); });
    getDoc(doc(db, "users", uid)).then((s) => live && setUsername(s.data()?.username || "")).catch(() => {});
    Promise.all([
      loadLayout("personal").catch(() => normalizeLayout(null, F.defaults)),
      loadUserLayout(uid).catch(() => null),
    ]).then(([base, mine]) => {
      if (!live) return;
      const l = mine || base;
      setBaseLayout(base); setLayout(l); setSavedJson(JSON.stringify(l)); setCustom(!!mine);
    });
    return () => { live = false; };
  }, [uid]);

  // Previews fit their column's width.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pages, editing]);
  const scale = Math.min(1, (width - 2) / F.w);

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (evals || []).filter((e) => !q || String(e.playerName || "").toLowerCase().includes(q)), [evals, q]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_PAGES ? p : [...p, id]));

  // Every prospect, for "Add any player" (one snapshot read).
  useEffect(() => {
    if (allPlayers || addSearch.trim().length < 2) return;
    getSiteSnapshot("_search").then((d) => setAllPlayers((d?.rows || [])
      .filter((r) => !isUnreleasedYear(r.E))
      .map((r) => ({ id: r.i, First: r.F, Last: r.L, Position: r.P, School: r.S, Eligible: r.E }))));
  }, [addSearch, allPlayers]);
  const addQ = addSearch.trim().toLowerCase();
  const addMatches = !allPlayers || addQ.length < 2 ? [] : allPlayers
    .filter((r) => `${r.First} ${r.Last} ${r.School}`.toLowerCase().includes(addQ)).slice(0, 8);
  const addPlayer = (r) => {
    setExtra((x) => ({ ...x, [r.id]: r }));
    setPicked((p) => (p.includes(r.id) || p.length >= MAX_PAGES ? p : [...p, r.id]));
    setAddSearch("");
  };

  async function preview() {
    setPages("loading"); setMsg("");
    const byId = new Map(evals.map((e) => [e.id, e]));
    const ids = [...evals.map((e) => e.id), ...Object.keys(extra).filter((id) => !byId.has(id))].filter((id) => picked.includes(id));
    const out = await Promise.all(ids.map(async (id) => {
      try {
        const ps = await getDoc(doc(db, "players", id));
        if (!ps.exists()) return { id, data: null };
        const data = await loadPrintPlayer({ id, ...ps.data() }, { reports: false });
        // Not evaluated: a fill-in sheet unless they pick the community's.
        return { id, data: { ...data, mine: byId.has(id) ? mineFrom(byId.get(id), username) : null } };
      } catch (e) {
        console.error("My Binder print load error:", e);
        return { id, data: null };
      }
    }));
    // Their own ranks — by their grades and on their Whiteboard.
    const targets = out.filter((p) => p.data).map((p) => ({ id: p.id, Eligible: p.data.eligible, Position: p.data.position }));
    const ranks = await loadMyRanks(uid, evals, targets).catch(() => ({}));
    setPages(out.map((p) => (p.data ? { ...p, data: { ...p.data, myRanks: ranks[p.id] || { mine: null, whiteboard: null } } } : p)));
  }

  const setPageVersion = (id, v) => setVersion((x) => ({ ...x, [id]: v }));
  // A page's version: picked for it, else their default (layout.pageVersion)
  // — "mine" only when they've evaluated him (a fill-in sheet otherwise).
  const versionOf = (p) => {
    const v = version[p.id] || layout.pageVersion || "mine";
    return v === "mine" && !p.data.mine ? "blank" : v;
  };
  const pageData = (p) => {
    const v = versionOf(p);
    if (v === "mine") return p.data;
    const { mine, myRanks, ...rest } = p.data;
    return v === "blank" ? { ...rest, blank: true } : rest;
  };
  // Every page at once (an unevaluated player's page can't be "mine").
  const setAll = (v) => (Array.isArray(pages) ? pages : []).filter((p) => p.data).forEach((p) => setPageVersion(p.id, v === "mine" && !p.data.mine ? "blank" : v));
  const VERSIONS = [["mine", "My evaluation"], ["community", "Community"], ["blank", "Fill-in"]];

  // The saved file's name: one page — "Jeremiah Smith - Prospect
  // Evaluation" (or Community Evaluation / Fill-in Sheet); several — "My
  // Evaluations - 12 Players" (or Fill-in Sheets / Community Evaluations
  // when they're all one kind).
  const PRINT_KINDS = { mine: ["Prospect Evaluation", "My Evaluations"], community: ["Community Evaluation", "Community Evaluations"], blank: ["Fill-in Sheet", "Fill-in Sheets"] };
  const printName = () => {
    const list = (Array.isArray(pages) ? pages : []).filter((p) => p.data);
    const kinds = [...new Set(list.map(versionOf))];
    if (list.length === 1) return `${list[0].data.first} ${list[0].data.last} - ${PRINT_KINDS[kinds[0]][0]}`;
    return `${kinds.length === 1 ? PRINT_KINDS[kinds[0]][1] : "My Evaluations"} - ${list.length} Players`;
  };

  const dirty = layout && JSON.stringify(layout) !== savedJson;
  // One default per account: saving replaces it.
  async function saveMine() {
    if (custom && !window.confirm("Replace your saved default with these settings?")) return;
    try {
      await saveUserLayout(uid, layout);
      setSavedJson(JSON.stringify(layout)); setCustom(true); setMsg("Saved as your default — your pages will open with these settings.");
    } catch (e) {
      console.error("My Binder layout save error:", e); setMsg("Couldn't save your layout.");
    }
  }
  async function resetMine() {
    if (!window.confirm("Go back to the We-Draft.com layout?")) return;
    try {
      if (custom) await resetUserLayout(uid);
      setLayout(baseLayout); setSavedJson(JSON.stringify(baseLayout)); setCustom(false); setMsg("Back to the We-Draft.com layout.");
    } catch (e) {
      console.error("My Binder layout reset error:", e); setMsg("Couldn't reset your layout.");
    }
  }

  if (!evals || !layout) return <LoadingSpinner size={32} minHeight="30vh" />;

  const ready = Array.isArray(pages) ? pages.filter((p) => p.data) : [];
  const btn = (filled, disabled) => ({
    border: `2px solid ${filled ? GOLD : BLUE}`, background: filled ? BLUE : "#fff", color: filled ? "#fff" : BLUE, borderRadius: 8,
    padding: "10px 16px", fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase", cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.45 : 1, fontFamily: "inherit",
  });

  // ── Preview + print ──
  if (pages) {
    const controls = editing && (
      <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
        <LayoutControls layout={layout} setLayout={(fn) => { setLayout(fn); setMsg(""); }} personal user onReset={resetMine} />
        <button type="button" onClick={saveMine} disabled={!dirty} style={btn(true, !dirty)}>{dirty ? "⭐ Save as my default" : custom ? "Your default ✓" : "Using We-Draft.com default"}</button>
        <div style={{ fontSize: 11, color: "#667", fontFamily: BODY, lineHeight: 1.4 }}>You get one default — saving again replaces it. "Reset to default" goes back to We-Draft.com's.</div>
      </div>
    );
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ ...card, padding: isMobile ? 14 : 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => { setPages(null); setEditing(false); }} style={btn(false)}>← Back</button>
          <div style={{ fontSize: 13, color: "#556", fontFamily: BODY, fontWeight: 700 }}>
            {pages === "loading" ? "Getting your pages ready…" : `${ready.length} page${ready.length === 1 ? "" : "s"} · letter size · one player per page`}
          </div>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setEditing((v) => !v)} style={btn(false)}>{editing ? "Done customizing" : "✏️ Customize"}</button>
            <button type="button" onClick={() => printAs(printName())} disabled={!ready.length} style={btn(true, !ready.length)}>🖨️ Print</button>
          </span>
        </div>
        {msg && <div style={{ fontSize: 12, fontWeight: 800, fontFamily: BODY, color: msg.startsWith("Couldn't") ? "#c0392b" : "#15803d" }}>{msg}</div>}
        {Array.isArray(pages) && pages.length > ready.length && (
          <div style={{ fontSize: 12, color: "#a33", fontFamily: BODY, fontWeight: 700 }}>{pages.length - ready.length} couldn't be loaded and were left out.</div>
        )}
        {ready.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#556", fontFamily: BODY, textTransform: "uppercase", letterSpacing: "0.06em" }}>All pages:</span>
            <div style={{ width: 360, maxWidth: "100%" }}><Seg value={null} onChange={setAll} options={VERSIONS} /></div>
          </div>
        )}
        {Array.isArray(pages) && (
          <div style={{ fontSize: 12, color: "#667", fontFamily: BODY }}>
            Tip: in the print dialog, set margins to <b>None</b> (or Default) and scale to <b>100%</b>. "Save as PDF" works too.
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: editing && !isMobile ? "290px minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
          {controls}
          <div ref={stageRef} style={{ display: "grid", gap: 22, justifyItems: "center", minWidth: 0 }}>
            {pages === "loading" && <LoadingSpinner size={32} minHeight="30vh" />}
            {ready.map((p) => (
              <div key={p.id} style={{ display: "grid", gap: 8, justifyItems: "center" }}>
                <div style={{ width: Math.min(420, F.w * scale) }}>
                  <Seg value={versionOf(p)} onChange={(v) => setPageVersion(p.id, v)} options={p.data.mine ? VERSIONS : VERSIONS.slice(1)} />
                </div>
                <div style={{ width: F.w * scale, height: F.h * scale, boxShadow: "0 6px 24px rgba(10,20,40,.18)", overflow: "hidden" }}>
                  <div style={{ width: F.w, height: F.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                    <EvaluationPage data={pageData(p)} layout={layout} format="personal" guides={false} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <PrintRoot pageSize={F.pageSize}>
          {ready.map((p) => <EvaluationPage key={p.id} data={pageData(p)} layout={layout} format="personal" guides={false} />)}
        </PrintRoot>
      </div>
    );
  }

  // ── The binder's sections, each collapsed until opened ──
  const section = (key, title, blurb, body) => (
    <div style={{ ...card, padding: isMobile ? 14 : 22 }}>
      <button type="button" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} aria-expanded={!!open[key]} style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 18, fontWeight: 900, color: NAVY, textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</span>
          <span style={{ display: "block", fontSize: 13, color: "#667", fontFamily: BODY, marginTop: 4, lineHeight: 1.45 }}>{blurb}</span>
        </span>
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 18, color: BLUE, transform: open[key] ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
      </button>
      {open[key] && <div style={{ marginTop: 16 }}>{body}</div>}
    </div>
  );

  // Board Lists stays mounted (its preview keeps its state); while it
  // previews, the evaluations section steps aside.
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {!boardsOpen && section("evals", "🖨️ Print My Evaluations", "One player per page with room to hole-punch — your evaluation, the community's, or a fill-in sheet to write by hand.", (
    <div>
      {/* Any player, for a fill-in sheet */}
      <div style={{ position: "relative", marginBottom: 14, padding: 12, borderRadius: 10, background: "#f6f8fb", border: "1px solid #e6ebf2" }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: NAVY, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>✍️ Add any player for a fill-in sheet</div>
        <input value={addSearch} onChange={(e) => setAddSearch(e.target.value)} placeholder="Search any prospect by name or school" style={{ width: "100%", boxSizing: "border-box", border: "2px solid #d8e0ea", borderRadius: 8, padding: "9px 11px", fontSize: isMobile ? 16 : 14, fontFamily: BODY, outline: "none" }} />
        {addQ.length >= 2 && (
          <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
            {!allPlayers && <div style={{ fontSize: 12, color: "#889", fontFamily: BODY }}>Loading…</div>}
            {allPlayers && !addMatches.length && <div style={{ fontSize: 12, color: "#889", fontFamily: BODY }}>No matches</div>}
            {addMatches.map((r) => {
              const on = picked.includes(r.id);
              return (
                <button key={r.id} type="button" onClick={() => addPlayer(r)} disabled={on} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: "#fff", border: "1px solid #e6ebf2", borderRadius: 8, padding: "8px 10px", cursor: on ? "default" : "pointer", fontFamily: "inherit" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 900, color: NAVY }}>{r.First} {r.Last}</span>
                    <span style={{ fontSize: 12, color: "#667", fontFamily: BODY }}> · {[r.Position, r.School, r.Eligible].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 900, color: on ? "#15803d" : BLUE, textTransform: "uppercase" }}>{on ? "Added" : "+ Add"}</span>
                </button>
              );
            })}
          </div>
        )}
        {Object.values(extra).some((r) => picked.includes(r.id)) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {Object.values(extra).filter((r) => picked.includes(r.id)).map((r) => (
              <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: `2px solid ${BLUE}`, borderRadius: 999, padding: "3px 6px 3px 10px", fontSize: 12, fontWeight: 900, color: NAVY }}>
                {r.First} {r.Last}
                <button type="button" onClick={() => toggle(r.id)} aria-label={`Remove ${r.First} ${r.Last}`} style={{ border: "none", background: "none", color: "#889", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      {!evals.length ? (
        <>
          <div style={{ fontSize: 14, color: "#667", fontFamily: BODY, padding: "8px 0 4px" }}>You haven't evaluated anyone yet — grade a player on their page and it'll show up here, or add any player above for a fill-in sheet.</div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button type="button" onClick={preview} disabled={!picked.length} style={btn(true, !picked.length)}>Preview & Print</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your evaluations" style={{ flex: "1 1 220px", border: "2px solid #d8e0ea", borderRadius: 8, padding: "9px 11px", fontSize: isMobile ? 16 : 14, fontFamily: BODY, outline: "none" }} />
            <button type="button" onClick={() => setPicked(shown.slice(0, MAX_PAGES).map((e) => e.id))} style={{ ...btn(false), padding: "8px 12px", fontSize: 11 }}>Select {shown.length > MAX_PAGES ? `first ${MAX_PAGES}` : "all"}</button>
            {picked.length > 0 && <button type="button" onClick={() => setPicked([])} style={{ ...btn(false), padding: "8px 12px", fontSize: 11 }}>Clear</button>}
          </div>
          <div style={{ display: "grid", gap: 6, maxHeight: 520, overflowY: "auto" }}>
            {shown.map((e) => {
              const on = picked.includes(e.id);
              const look = e.grade && e.grade !== "Watchlist" ? gradeLook(e.grade) : null;
              return (
                <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: `2px solid ${on ? BLUE : "#e6ebf2"}`, borderRadius: 10, cursor: "pointer", background: on ? "#f2f7fd" : "#fff" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(e.id)} style={{ width: 18, height: 18, accentColor: BLUE }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.playerName || "Player"}</div>
                    <div style={{ fontSize: 12, color: "#667", fontFamily: BODY, marginTop: 2 }}>
                      {[e.grade || "No grade", String(e.evaluation || "").trim() ? "Written report" : "", fmtDate(toMs(e.updatedAt))].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {look && <span style={{ flexShrink: 0, minWidth: 36, textAlign: "center", padding: "4px 6px", borderRadius: 6, background: look.bg, color: "#fff", fontSize: 12, fontWeight: 900 }}>{look.short}</span>}
                </label>
              );
            })}
            {!shown.length && <div style={{ fontSize: 13, color: "#889", fontFamily: BODY, padding: 8 }}>No matches</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#556", fontFamily: BODY }}>
              {picked.length} selected{picked.length >= MAX_PAGES ? ` (max ${MAX_PAGES} per print)` : ""}
            </span>
            <button type="button" onClick={preview} disabled={!picked.length} style={{ ...btn(true, !picked.length), marginLeft: "auto" }}>Preview & Print</button>
          </div>
        </>
      )}
    </div>
      ))}
      <BinderBoards uid={uid} evals={evals} isMobile={isMobile} bw={!!layout.bw} card={card} btn={btn} section={section} onPreview={setBoardsOpen} />
    </div>
  );
}
