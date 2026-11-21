// src/components/AdminEarlyLook.jsx
//
// Admin → Content → Early Look (working name — utils/earlyLook.js): the
// high school prospects page (pages/EarlyLook.jsx), WX content like the
// Draft Risers. Search the high school recruits in the classes after 2030
// (recruits, RecruitClass 2028+ — add new kids in Players → Recruits
// first), rank them, write each one up, preview his graphic. Save writes
// earlyLook/current and publishes it as today's edition
// (earlyLookEditions/{date}; a second Save the same day replaces it).
// Release makes the page public — and marks every edition so far public
// too (the rules keep an edition private until then).
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { drawProspect } from "./ProspectIntroGraphic";
import { downloadPng } from "./AdminClassIntro";
import {
  EARLY_LOOK, EL_DOC, EL_ID, EL_EDITIONS, EL_FIRST_RECRUIT_CLASS, draftClassOf, earlyRanked, earlyEditionDate, earlyEditionLabel,
} from "../utils/earlyLook";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#c0392b";
const GREEN = "#15803d";
const TEAL = "#0e7c86";
const INK = "#0b1a2e";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12, overflow: "hidden" };
const input = { border: "1px solid #d5dbe4", borderRadius: 6, padding: "7px 9px", fontSize: 13, fontFamily: "Arial, sans-serif", boxSizing: "border-box" };
const btn = (color, filled = false) => ({
  border: `2px solid ${color}`, background: filled ? color : "#fff", color: filled ? "#fff" : color,
  borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 900, cursor: "pointer", textTransform: "uppercase", whiteSpace: "nowrap",
});
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The recruit classes to search: 2028 and the next few.
const RECRUIT_CLASSES = Array.from({ length: 5 }, (_, i) => String(EL_FIRST_RECRUIT_CLASS + i));
const fieldsOf = (r) => ({
  first: r.First || "", last: r.Last || "", pos: r.Position || "", rc: String(r.RecruitClass || ""), hs: r.HighSchool || "",
  state: r.State || "", commit: r.Commitment || "", ht: r.Height || "", wt: r.Weight || "",
});

export default function AdminEarlyLook() {
  const [recruits, setRecruits] = useState(null);
  const [state, setState] = useState(null); // { intro, players, live, releasedAt }
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    getDocs(query(collection(db, "recruits"), where("RecruitClass", "in", RECRUIT_CLASSES)))
      .then((s) => live && setRecruits(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.First || r.Last)))
      .catch(() => live && setRecruits([]));
    getDoc(doc(db, EL_DOC, EL_ID))
      .then((s) => live && setState({ intro: "", players: [], live: false, ...(s.exists() ? s.data() : {}) }))
      .catch((e) => { console.error("Early look load error:", e); if (live) setState({ intro: "", players: [], live: false }); });
    return () => { live = false; };
  }, []);

  const byId = useMemo(() => new Map((recruits || []).map((r) => [r.id, r])), [recruits]);
  const list = earlyRanked(state?.players);
  const change = (fn) => { setState((s) => fn(s)); setDirty(true); setMsg(""); };
  const setList = (l) => change((s) => ({ ...s, players: l.map((r, i) => ({ ...r, order: i })) }));
  const has = (id) => list.some((r) => r.id === id);
  const add = (r) => { if (!has(r.id)) setList([...list, { id: r.id, ...fieldsOf(r), note: "", addedAt: Date.now() }]); };
  const remove = (id) => setList(list.filter((r) => r.id !== id));
  const moveTo = (id, to) => {
    const l = [...list];
    const i = l.findIndex((r) => r.id === id);
    const j = Math.max(0, Math.min(l.length - 1, to - 1));
    if (i < 0 || i === j) return;
    const [x] = l.splice(i, 1);
    l.splice(j, 0, x);
    setList(l);
  };
  const patch = (id, f) => setList(list.map((r) => (r.id === id ? { ...r, ...f } : r)));

  async function write({ live = state.live, publish = true } = {}) {
    setBusy(true); setMsg("");
    try {
      const players = list.map((r, i) => {
        const fresh = byId.get(r.id);
        return { ...r, ...(fresh ? fieldsOf(fresh) : {}), order: i };
      });
      const out = { intro: state.intro || "", players, live: !!live, updatedAt: serverTimestamp() };
      if (live && !state.releasedAt) out.releasedAt = serverTimestamp();
      else if (state.releasedAt) out.releasedAt = state.releasedAt;
      await setDoc(doc(db, EL_DOC, EL_ID), out);
      const date = earlyEditionDate();
      if (publish) await setDoc(doc(db, EL_EDITIONS, date), { date, publishedAt: serverTimestamp(), live: !!live, players });
      // Releasing (or pulling it back): every edition follows.
      if (live !== state.live) {
        const eds = await getDocs(collection(db, EL_EDITIONS));
        for (let i = 0; i < eds.docs.length; i += 400) {
          const b = writeBatch(db);
          eds.docs.slice(i, i + 400).forEach((d) => b.update(d.ref, { live: !!live }));
          await b.commit();
        }
      }
      setState((s) => ({ ...s, players, live: !!live, releasedAt: out.releasedAt ? s.releasedAt || new Date() : s.releasedAt }));
      setDirty(false);
      return date;
    } catch (e) {
      console.error("Early look save error:", e);
      setMsg(`Couldn't save: ${e.message}`);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const save = async () => {
    const date = await write();
    if (date) setMsg(`Saved — published as the ${earlyEditionLabel(date, { month: "short", day: "numeric" })} edition${state.live ? "" : " (private until release)"}.`);
  };
  const toggleRelease = async () => {
    const on = !state.live;
    if (!window.confirm(on
      ? `Release the ${EARLY_LOOK.name}? It goes public at ${EARLY_LOOK.path} — with every edition so far — in search, the sitemap and News.`
      : `Take the ${EARLY_LOOK.name} back down? It and its editions go admin-only again.`)) return;
    if (await write({ live: on, publish: dirty })) setMsg(on ? "Released — the page is public." : "Unreleased — admin-only again.");
  };

  async function showPreview(r) {
    setPreview({ name: `${r.first} ${r.last}`, src: "" });
    const src = await drawProspect({ kind: "early", entry: { ...r, school: r.commit }, tag: `CLASS OF ${draftClassOf(r.rc)}`, kicker: EARLY_LOOK.tag, address: `WE-DRAFT.COM${EARLY_LOOK.path.toUpperCase()}` }).catch(() => "");
    setPreview((pv) => (pv ? { ...pv, src, failed: !src } : pv));
  }

  const t = norm(q);
  const matches = useMemo(() => (t.length < 2 || !recruits ? [] : recruits.filter((r) => norm(`${r.First} ${r.Last} ${r.HighSchool} ${r.State} ${r.Commitment}`).includes(t)).slice(0, 10)), [t, recruits]);

  if (!state || !recruits) return <div style={{ padding: 20, color: "#9aa4b2", fontWeight: 800 }}>Loading…</div>;
  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15 }}>{EARLY_LOOK.name}</div>
        <span style={{ fontSize: 11, fontWeight: 900, padding: "3px 9px", borderRadius: 999, color: "#fff", background: state.live ? GREEN : "#8a94a6" }}>{state.live ? "Released" : "Not released"}</span>
        <a href={EARLY_LOOK.path} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 800, color: BLUE }}>View page ↗</a>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>{list.length} prospects · {recruits.length} recruits in the {RECRUIT_CLASSES[0]}+ classes</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {msg && <span style={{ fontSize: 12, fontWeight: 800, color: msg.startsWith("Couldn't") ? RED : GREEN }}>{msg}</span>}
          <button type="button" onClick={toggleRelease} disabled={busy} style={btn(state.live ? RED : GREEN)}>{state.live ? "Unrelease" : "Release…"}</button>
          <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...btn(GOLD, true), opacity: busy || !dirty ? 0.5 : 1 }}>{busy ? "Working…" : dirty ? "Save & publish" : "Saved"}</button>
        </span>
      </div>

      <div style={{ ...card, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Intro (blank line between paragraphs)</div>
        <textarea value={state.intro || ""} onChange={(e) => change((s) => ({ ...s, intro: e.target.value }))} rows={3} placeholder="What this page is and who's on it…"
          style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
      </div>

      <div style={{ ...card, padding: "12px 14px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a prospect — name, high school, state or commitment" style={{ ...input, width: "100%" }} />
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: "#9aa4b2" }}>High school recruits in the {RECRUIT_CLASSES[0]} class and later (draft class {draftClassOf(RECRUIT_CLASSES[0])}+). Someone missing? Add him in Players → Recruits first.</div>
        {matches.length > 0 && (
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {matches.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <b style={{ color: INK }}>{r.First} {r.Last}</b>
                <span style={{ color: "#7a8597" }}>{r.Position} · {r.HighSchool}{r.State ? `, ${r.State}` : ""} · HS {r.RecruitClass} → class of {draftClassOf(r.RecruitClass)}{r.Commitment ? ` · ${r.Commitment}` : ""}</span>
                <button type="button" disabled={has(r.id)} onClick={() => { add(r); setQ(""); }} style={{ ...btn(TEAL), marginLeft: "auto", opacity: has(r.id) ? 0.4 : 1 }}>{has(r.id) ? "On the list" : "+ Add"}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ padding: "10px 14px", background: INK, color: "#fff", display: "flex", gap: 8, alignItems: "center", borderBottom: `3px solid ${TEAL}` }}>
          <b style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>The list</b>
          <span style={{ fontSize: 12, color: "#9fb0c8", fontWeight: 700 }}>{list.length} · one ranking across classes (the page filters by class)</span>
        </div>
        {!list.length && <div style={{ padding: 14, fontSize: 13, color: "#9aa4b2", fontWeight: 700 }}>Nobody yet — add a prospect above.</div>}
        {list.map((r, i) => (
          <div key={r.id} style={{ borderTop: i ? "1px solid #eef1f5" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", flexWrap: "wrap" }}>
              <b style={{ width: 26, textAlign: "right", color: INK }}>{i + 1}</b>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button type="button" disabled={i === 0} onClick={() => moveTo(r.id, i)} style={{ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                <button type="button" disabled={i === list.length - 1} onClick={() => moveTo(r.id, i + 2)} style={{ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: i === list.length - 1 ? 0.3 : 1 }}>▼</button>
              </span>
              <span style={{ minWidth: 220, flex: 1 }}>
                <b style={{ color: INK, fontSize: 14 }}>{r.first} {r.last}</b>
                <span style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}> · {r.pos} · {r.hs}{r.state ? `, ${r.state}` : ""} · </span>
                <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: TEAL, borderRadius: 999, padding: "1px 7px" }}>Class of {draftClassOf(r.rc)}</span>
                <span style={{ fontSize: 12, color: r.commit ? GREEN : "#9aa4b2", fontWeight: 800 }}> {r.commit ? `→ ${r.commit}` : "· uncommitted"}</span>
                {r.note && open !== r.id && <div style={{ fontSize: 11, fontWeight: 600, color: "#3b4756", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 520 }}>📝 {r.note}</div>}
              </span>
              <button type="button" onClick={() => showPreview(r)} style={btn(BLUE)}>Graphic</button>
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} style={btn(BLUE, open === r.id)}>{r.note ? "Edit note" : "Add note"}</button>
              <button type="button" onClick={() => { if (window.confirm(`Take ${r.first} ${r.last} off?`)) remove(r.id); }} style={btn(RED)}>Remove</button>
            </div>
            {open === r.id && (
              <div style={{ padding: "4px 14px 12px 60px", background: "#fafbfd" }}>
                <textarea value={r.note || ""} onChange={(e) => patch(r.id, { note: e.target.value })} rows={4} placeholder={`Why ${r.first} ${r.last} is one to know…`}
                  style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
                <div style={{ fontSize: 11, color: "#9aa4b2", fontWeight: 700, marginTop: 4 }}>Public. Blank line between paragraphs. Save at the top publishes.</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 20000, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 12, maxWidth: 440, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <b style={{ color: INK }}>{preview.name}</b>
              {preview.src && <button type="button" onClick={() => downloadPng(preview.src, `${norm(preview.name).replace(/ /g, "-")}-early-look.png`)} style={{ ...btn(BLUE), marginLeft: "auto" }}>Download PNG</button>}
              <button type="button" onClick={() => setPreview(null)} style={{ ...btn(BLUE), marginLeft: preview.src ? 8 : "auto" }}>Close</button>
            </div>
            {preview.src ? <img src={preview.src} alt="" style={{ width: "100%", display: "block", borderRadius: 8 }} />
              : <div style={{ padding: 40, textAlign: "center", color: preview.failed ? RED : "#9aa4b2", fontWeight: 800 }}>{preview.failed ? "Couldn't draw it." : "Drawing…"}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
