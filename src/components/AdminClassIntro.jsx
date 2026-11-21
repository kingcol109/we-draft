// src/components/AdminClassIntro.jsx
//
// Admin → Content → Class of 2030: "Meet the Class of 2030"
// (/class-of-2030 — utils/classIntro.js, pages/ClassIntro.jsx), the one-time
// WX article for the class's launch. Pick 3–5 players at each position
// (search the class at that position — or any position, for an athlete),
// order them, write each one up, preview his graphic. Save writes
// classIntro/{year} (no editions — one article). Release makes it public:
// the page leaves admin-only, goes in the sitemap, and the news / player /
// team page items turn on.
//
// It ties every player to the school he signed with (players.School): the
// card links its team page, and "Where They're Headed" groups the class by
// school. A pick with no school, or a school with no branding on file, is
// flagged here.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { useSchools } from "./DraftArchiveList";
import { drawProspect } from "./ProspectIntroGraphic";
import { placedShots } from "./RiserGraphic";
import { CLASS_INTRO_YEAR, CLASS_INTRO_DOC, CI_POSITIONS, CI_MIN, CI_MAX, classIntroPath, picksIn } from "../utils/classIntro";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#c0392b";
const GREEN = "#15803d";
const INK = "#0b1a2e";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12, overflow: "hidden" };
const input = { border: "1px solid #d5dbe4", borderRadius: 6, padding: "7px 9px", fontSize: 13, fontFamily: "Arial, sans-serif", boxSizing: "border-box" };
const btn = (color, filled = false) => ({
  border: `2px solid ${color}`, background: filled ? color : "#fff", color: filled ? "#fff" : color,
  borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 900, cursor: "pointer", textTransform: "uppercase", whiteSpace: "nowrap",
});
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// A drawn graphic (an SVG object URL) saved as a 1080×1350 PNG.
export async function downloadPng(svgUrl, filename) {
  const kit = await import("./SocialMakerKit");
  const svg = await (await fetch(svgUrl)).text();
  const blob = await kit.svgToPng(svg);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// His fields, fresh from his players doc.
const fieldsOf = (p) => ({
  slug: p.Slug || "", first: p.First || "", last: p.Last || "", pos: p.Position || "", school: p.School || "",
  hs: p.HighSchool || "", state: p.State || "", ht: p.Height || "", wt: p.Weight || "",
});

export default function AdminClassIntro() {
  const year = CLASS_INTRO_YEAR;
  const [players, setPlayers] = useState(null);
  const [state, setState] = useState(null); // { intro, positions, live, releasedAt }
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    getDocs(query(collection(db, "players"), where("Eligible", "in", [year, Number(year)])))
      .then((s) => live && setPlayers(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last)))
      .catch(() => live && setPlayers([]));
    getDoc(doc(db, CLASS_INTRO_DOC, year))
      .then((s) => live && setState(s.exists() ? { intro: "", positions: {}, live: false, ...s.data() } : { intro: "", positions: {}, live: false }))
      .catch((e) => { console.error("Class intro load error:", e); if (live) setState({ intro: "", positions: {}, live: false }); });
    return () => { live = false; };
  }, [year]);

  const byId = useMemo(() => new Map((players || []).map((p) => [p.id, p])), [players]);
  const allIds = Object.values(state?.positions || {}).flat().map((r) => r.id);
  const schools = useSchools(Object.values(state?.positions || {}).flat().map((r) => r.school));
  const change = (fn) => { setState((s) => fn(s)); setDirty(true); setMsg(""); };
  const setPos = (pos, list) => change((s) => ({ ...s, positions: { ...s.positions, [pos]: list.map((r, i) => ({ ...r, order: i })) } }));

  const add = (pos, p) => {
    if (allIds.includes(p.id)) return;
    setPos(pos, [...picksIn(state.positions, pos), { id: p.id, ...fieldsOf(p), note: "", addedAt: Date.now() }]);
  };
  const remove = (pos, id) => setPos(pos, picksIn(state.positions, pos).filter((r) => r.id !== id));
  const move = (pos, id, d) => {
    const l = picksIn(state.positions, pos);
    const i = l.findIndex((r) => r.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setPos(pos, l);
  };
  const patch = (pos, id, fields) => setPos(pos, picksIn(state.positions, pos).map((r) => (r.id === id ? { ...r, ...fields } : r)));

  async function write(extra = {}) {
    setBusy(true); setMsg("");
    try {
      // Names, schools and high schools fresh from each players doc.
      const positions = Object.fromEntries(CI_POSITIONS.map(({ key }) => [key, picksIn(state.positions, key).map((r, i) => {
        const p = byId.get(r.id);
        return { ...r, ...(p ? fieldsOf(p) : {}), order: i };
      })]).filter(([, l]) => l.length));
      const next = { ...state, ...extra, positions };
      const out = { intro: next.intro || "", positions, live: !!next.live, updatedAt: serverTimestamp() };
      if (next.live && !state.releasedAt) out.releasedAt = serverTimestamp();
      else if (state.releasedAt) out.releasedAt = state.releasedAt;
      await setDoc(doc(db, CLASS_INTRO_DOC, year), out);
      setState({ ...next, releasedAt: out.releasedAt === state.releasedAt ? state.releasedAt : new Date() });
      setDirty(false);
      return true;
    } catch (e) {
      console.error("Class intro save error:", e);
      setMsg(`Couldn't save: ${e.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = async () => { if (await write()) setMsg("Saved."); };
  const toggleRelease = async () => {
    const on = !state.live;
    if (!window.confirm(on
      ? `Release "Meet the Class of ${year}"? It goes public at ${classIntroPath(year)}: in search, the sitemap, News and the players' and schools' pages.`
      : "Take the article back down? It goes admin-only again.")) return;
    if (await write({ live: on })) setMsg(on ? "Released — the article is public." : "Unreleased — admin-only again.");
  };

  // His graphic with his placed action shot when he has one (Content →
  // Photos, placed for First Pick) — the one picked here, else his first.
  // shotUrl: switch to that shot (kept on his pick; Save locks it in).
  async function showPreview(r, pos, shotUrl = "") {
    setPreview({ id: r.id, pos, name: `${r.first} ${r.last}`, src: "", shots: [], shot: "" });
    const ph = await getDoc(doc(db, "playerPhotos", r.id)).catch(() => null);
    const shots = placedShots(ph?.exists() ? ph.data() : null);
    const want = shotUrl || r.shot || "";
    const shot = shots.find((s) => s.url === want) || shots[0] || null;
    if (shotUrl && shotUrl !== r.shot) patch(pos, r.id, { shot: shotUrl });
    setPreview((pv) => (pv?.id === r.id ? { ...pv, shots, shot: shot?.url || "" } : pv));
    const src = await drawProspect({ kind: "intro", entry: r, tag: `CLASS OF ${year}`, kicker: "MEET THE CLASS", address: `WE-DRAFT.COM/CLASS-OF-${year}`, shot }).catch(() => "");
    setPreview((pv) => (pv?.id === r.id ? { ...pv, src, failed: !src } : pv));
  }

  if (!state || !players) return <div style={{ padding: 20, color: "#9aa4b2", fontWeight: 800 }}>Loading…</div>;
  const counts = CI_POSITIONS.map(({ key }) => picksIn(state.positions, key).length);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15 }}>Meet the Class of {year}</div>
        <span style={{ fontSize: 11, fontWeight: 900, padding: "3px 9px", borderRadius: 999, color: "#fff", background: state.live ? GREEN : "#8a94a6" }}>{state.live ? "Released" : "Not released"}</span>
        <a href={classIntroPath(year)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 800, color: BLUE }}>View page ↗</a>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>{total} players · {CI_MIN}–{CI_MAX} per position</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {msg && <span style={{ fontSize: 12, fontWeight: 800, color: msg.startsWith("Couldn't") ? RED : GREEN }}>{msg}</span>}
          <button type="button" onClick={toggleRelease} disabled={busy} style={btn(state.live ? RED : GREEN)}>{state.live ? "Unrelease" : "Release…"}</button>
          <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...btn(GOLD, true), opacity: busy || !dirty ? 0.5 : 1 }}>{busy ? "Working…" : dirty ? "Save" : "Saved"}</button>
        </span>
      </div>

      <div style={{ ...card, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Intro — the article's lead (blank line between paragraphs)</div>
        <textarea value={state.intro || ""} onChange={(e) => change((s) => ({ ...s, intro: e.target.value }))} rows={4} placeholder={`Introduce the class of ${year}…`}
          style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
      </div>

      {CI_POSITIONS.map((pos, i) => (
        <PositionCard key={pos.key} pos={pos} count={counts[i]} list={picksIn(state.positions, pos.key)} players={players} takenIds={allIds} byId={byId} schools={schools}
          onAdd={(p) => add(pos.key, p)} onRemove={(id) => remove(pos.key, id)} onMove={(id, d) => move(pos.key, id, d)} onPatch={(id, f) => patch(pos.key, id, f)} onPreview={(r) => showPreview(r, pos.key)} />
      ))}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 20000, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 12, maxWidth: 440, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <b style={{ color: INK }}>{preview.name}</b>
              {preview.src && <button type="button" onClick={() => downloadPng(preview.src, `${norm(preview.name).replace(/ /g, "-")}-class-of-${year}.png`)} style={{ ...btn(BLUE), marginLeft: "auto" }}>Download PNG</button>}
              <button type="button" onClick={() => setPreview(null)} style={{ ...btn(BLUE), marginLeft: preview.src ? 8 : "auto" }}>Close</button>
            </div>
            {preview.src ? <img src={preview.src} alt="" style={{ width: "100%", display: "block", borderRadius: 8 }} />
              : <div style={{ padding: 40, textAlign: "center", color: preview.failed ? RED : "#9aa4b2", fontWeight: 800 }}>{preview.failed ? "Couldn't draw it." : "Drawing…"}</div>}
            {preview.shots?.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>His shot — pick one</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {preview.shots.map((sh) => {
                    const r = picksIn(state.positions, preview.pos).find((x) => x.id === preview.id);
                    return (
                      <button key={sh.url} type="button" onClick={() => r && showPreview(r, preview.pos, sh.url)}
                        style={{ width: 56, height: 70, padding: 0, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#f1f4f8", border: `3px solid ${sh.url === preview.shot ? GOLD : "#e3e8ef"}` }}>
                        <img src={sh.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#7a8597", fontWeight: 700, marginTop: 8 }}>
              {preview.shots?.length ? "Uses his action shot placed for First Pick (Content → Photos)." : "No action shot placed for him — place one for First Pick in Content → Photos to put him on it."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PositionCard({ pos, count, list, players, takenIds, byId, schools, onAdd, onRemove, onMove, onPatch, onPreview }) {
  const [q, setQ] = useState("");
  const [any, setAny] = useState(false);
  const [open, setOpen] = useState(null);
  const t = norm(q);
  const matches = useMemo(() => {
    const pool = players.filter((p) => any || p.Position === pos.key);
    const hit = t.length >= 2 ? pool.filter((p) => norm(`${p.First} ${p.Last} ${p.School} ${p.HighSchool}`).includes(t)) : [];
    return hit.slice(0, 8);
  }, [players, any, pos.key, t]);
  const color = count === 0 ? "#9aa4b2" : count < CI_MIN ? GOLD : count > CI_MAX ? RED : GREEN;
  const inPos = players.filter((p) => p.Position === pos.key).length;
  return (
    <div style={card}>
      <div style={{ padding: "9px 14px", background: INK, color: "#fff", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>{pos.key} · {pos.name}</b>
        <span style={{ fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 999, background: color, color: "#fff" }}>{count} / {CI_MIN}–{CI_MAX}</span>
        <span style={{ fontSize: 11, color: "#9fb0c8", fontWeight: 700 }}>{inPos} {pos.key}s in the class</span>
      </div>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #eef1f5", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Add a ${pos.key} — name, school or high school`} style={{ ...input, flex: "1 1 260px" }} />
        <label style={{ fontSize: 11, fontWeight: 800, color: "#7a8597", display: "inline-flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={any} onChange={(e) => setAny(e.target.checked)} /> Any position
        </label>
      </div>
      {matches.length > 0 && (
        <div style={{ padding: "6px 14px 10px", display: "grid", gap: 4, borderBottom: "1px solid #eef1f5" }}>
          {matches.map((p) => {
            const taken = takenIds.includes(p.id);
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <b style={{ color: INK }}>{p.First} {p.Last}</b>
                <span style={{ color: "#7a8597" }}>{p.Position} · {p.School || "no school"} · {p.HighSchool}{p.State ? `, ${p.State}` : ""}</span>
                <button type="button" disabled={taken} onClick={() => { onAdd(p); setQ(""); }} style={{ ...btn(BLUE), marginLeft: "auto", opacity: taken ? 0.4 : 1 }}>{taken ? "Picked" : "+ Add"}</button>
              </div>
            );
          })}
        </div>
      )}
      {!list.length && <div style={{ padding: "10px 14px", fontSize: 12, color: "#9aa4b2", fontWeight: 700 }}>No {pos.key}s picked yet.</div>}
      {list.map((r, i) => {
        const p = byId.get(r.id);
        const s = schools[r.school];
        const changed = p && (p.School !== r.school || p.HighSchool !== r.hs || p.First !== r.first || p.Last !== r.last);
        return (
          <div key={r.id} style={{ borderTop: i ? "1px solid #eef1f5" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", flexWrap: "wrap" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button type="button" disabled={i === 0} onClick={() => onMove(r.id, -1)} style={{ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
                <button type="button" disabled={i === list.length - 1} onClick={() => onMove(r.id, 1)} style={{ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: i === list.length - 1 ? 0.3 : 1 }}>▼</button>
              </span>
              <span style={{ width: 30, height: 30, flexShrink: 0, display: "grid", placeItems: "center" }}>
                {s?.Logo1 && <img src={s.Logo1} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
              </span>
              <span style={{ minWidth: 200, flex: 1 }}>
                <a href={`/player/${r.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, color: INK, textDecoration: "none", fontSize: 14 }}>{r.first} {r.last}</a>
                <span style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}> · {r.pos} · {r.hs}{r.state ? `, ${r.state}` : ""}</span>
                <div style={{ fontSize: 11, fontWeight: 800, marginTop: 2 }}>
                  {!r.school ? <span style={{ color: RED }}>⚠ No commitment on his profile — no team to connect</span>
                    : s === null ? <span style={{ color: GOLD }}>⚠ "{r.school}" has no school branding on file</span>
                    : <span style={{ color: GREEN }}>→ {r.school}</span>}
                  {changed && <span style={{ color: GOLD }}> · profile changed, Save to update</span>}
                </div>
                {r.note && open !== r.id && <div style={{ fontSize: 11, fontWeight: 600, color: "#3b4756", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 520 }}>📝 {r.note}</div>}
              </span>
              <button type="button" onClick={() => onPreview(r)} style={btn(BLUE)}>Graphic</button>
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} style={btn(BLUE, open === r.id)}>{r.note ? "Edit note" : "Add note"}</button>
              <button type="button" onClick={() => { if (window.confirm(`Take ${r.first} ${r.last} out?`)) onRemove(r.id); }} style={btn(RED)}>Remove</button>
            </div>
            {open === r.id && (
              <div style={{ padding: "4px 14px 12px 56px", background: "#fafbfd" }}>
                <textarea value={r.note || ""} onChange={(e) => onPatch(r.id, { note: e.target.value })} rows={4} placeholder={`Why ${r.first} ${r.last} matters…`}
                  style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
                <div style={{ fontSize: 11, color: "#9aa4b2", fontWeight: 700, marginTop: 4 }}>Public — no PFF numbers. Blank line between paragraphs. Save at the top.</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
