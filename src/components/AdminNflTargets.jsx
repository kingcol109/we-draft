// src/components/AdminNflTargets.jsx
//
// Admin → Content → WX → NFL Targets: each NFL team's curated 2027 draft
// targets (utils/nflTargets.js), the team page's Targets tab once published
// (components/TeamTargetsWX.jsx). One living list per team:
//   Featured  5 players — a write-up each, and his draft card (the action
//             shot is picked in the card preview)
//   List      up to 30 more, in order
// The coach-fit system stays: "Coach fit suggestions" lists the class's
// prospects who fit this team's staff (the weekly teamTargets snapshot —
// staff blend, GM / HC / coordinator fits, draft-history matches), each
// with one click to Featured or the list; every picked player shows his fit
// here, and the page puts it on his snapshot. Search covers the whole class.
// Save writes nflTargets/{TEAM}; Publish makes it the team's Targets tab
// (until then it's an admin-only preview there).
//
// Also here (user, 2026-11-21):
//   Write-ups  generic 1–2 sentences per player (utils/prospectBlurbs.js) —
//              not about any team; shown under his row on every list he's
//              on, and as a featured player's write-up until the team has
//              its own. Edit them on a team's rows, or all at once in
//              "Player write-ups" (every listed player, missing first).
//   Needs      a team's needs (nflTeamNeeds — edited in Mock Draft → Team
//              Needs), shown read-only when the team is opened.
//   Search     saving a published list (or publishing / unpublishing) asks
//              api/recache-page.js to re-render /nfl/{team} for bots now.
//   No shot    a featured player with no action shot placed shows in the
//              list on the page until he has one — flagged on his row.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import { drawDraftCard, playerShots } from "./DraftCardGraphic";
import { LOCAL } from "./RiserGraphic";
import { downloadPng } from "./AdminClassIntro";
import { NFL_TEAMS } from "../utils/coachHistory";
import { fetchTeamTargets } from "../utils/draftProfileData";
import { NFL_TARGETS_DOC, TARGETS_YEAR, FEATURED_MAX, LIST_MAX, byOrder, fitFor, fitSuggestions } from "../utils/nflTargets";
import { loadBlurbs, saveBlurb } from "../utils/prospectBlurbs";
import { NEED_LABELS, resolveNeeds, needName } from "../utils/draftSim/engine";
import { LABEL_COLOR } from "./AdminTeamNeeds";

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
const TEAMS = Object.keys(NFL_TEAMS).sort((a, b) => NFL_TEAMS[a].localeCompare(NFL_TEAMS[b]));
const fieldsOf = (p) => ({ slug: p.Slug || "", first: p.First || "", last: p.Last || "", pos: p.Position || "", school: p.School || "" });
const EMPTY = { featured: [], list: [], intro: "", published: false };

// "Fit 84 · Match 91" — his best fit numbers, short.
function fitLabel(fit) {
  if (!fit) return "";
  const best = Math.max(fit.score || 0, ...fit.parts.map((x) => x.score));
  return [best ? `Fit ${Math.round(best)}` : "", fit.matches.length ? `Match ${Math.round(fit.matches[0].s)}` : ""].filter(Boolean).join(" · ");
}

// Asks for a fresh render of a public page for search bots (api/recache-page.js
// — Prerender.io re-renders it now, not on its own timer). Fire and forget:
// a failure only means bots wait for the usual recache. Not on localhost (no api/).
function recachePage(pagePath) {
  if (LOCAL) return;
  auth.currentUser?.getIdToken()
    .then((token) => fetch("/api/recache-page", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ path: pagePath }) }))
    .then((r) => { if (!r.ok) console.warn("recache-page:", r.status); })
    .catch((e) => console.warn("recache-page failed:", e.message));
}

// One player's generic write-up: a small box with its own Save (it's
// shared by every team, so it saves on its own — not with the team's list).
function BlurbEditor({ id, name, value, onSaved, team = "" }) {
  const [text, setText] = useState(value || "");
  const [note, setNote] = useState("");
  useEffect(() => { setText(value || ""); }, [value]);
  const dirty = text.trim() !== String(value || "").trim();
  const save = async () => {
    setNote("Saving…");
    try { await saveBlurb(id, text, name); onSaved(id, text.trim()); setNote("Saved"); } catch (e) { setNote(`Couldn't save: ${e.message}`); }
  };
  const n = text.trim().length;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setNote(""); }} rows={2}
        placeholder={`1–2 sentences on ${name || "him"} — about him, not ${team ? `the ${team}` : "any team"}.`}
        style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.45, fontSize: 13 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "#9aa4b2" }}>
        <span style={{ color: n > 320 ? RED : "#9aa4b2" }}>{n} chars{n > 320 ? " — keep it to 1–2 sentences" : ""}</span>
        {note && <span style={{ color: note.startsWith("Couldn't") ? RED : GREEN }}>{note}</span>}
        <button type="button" onClick={save} disabled={!dirty} style={{ ...btn(BLUE, dirty), marginLeft: "auto", opacity: dirty ? 1 : 0.4 }}>Save write-up</button>
      </div>
    </div>
  );
}

// The team's needs (read-only — edited in Mock Draft → Team Needs): every
// position that isn't Set, most urgent first, with the admin's note.
function NeedsPanel({ needs }) {
  const head = (
    <div style={{ padding: "9px 12px", background: "#7c2d12", color: "#fff" }}>
      <b style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>Team needs</b>
      <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>From Mock Draft → Team Needs</div>
    </div>
  );
  if (needs === null) return <div style={card}>{head}<div style={{ padding: 12, color: "#9aa4b2", fontWeight: 700, fontSize: 12 }}>Loading…</div></div>;
  const rank = (labels) => Math.min(...labels.map((l) => NEED_LABELS.indexOf(l)));
  const open = Object.entries(needs).filter(([, n]) => n.labels.some((l) => l !== "Set")).sort((a, b) => rank(a[1].labels) - rank(b[1].labels));
  const set = Object.entries(needs).filter(([, n]) => n.labels.every((l) => l === "Set")).map(([k]) => needName(k));
  return (
    <div style={card}>
      {head}
      {!open.length && <div style={{ padding: 12, fontSize: 12, color: "#9aa4b2", fontWeight: 700 }}>No needs set for this team yet.</div>}
      {open.map(([k, n], i) => (
        <div key={k} style={{ padding: "7px 12px", borderTop: i ? "1px solid #eef1f5" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <b style={{ color: INK, fontSize: 13, minWidth: 120 }}>{needName(k)}</b>
            {n.labels.filter((l) => l !== "Set").map((l) => (
              <span key={l} style={{ fontSize: 10, fontWeight: 900, color: "#fff", background: LABEL_COLOR[l] || BLUE, borderRadius: 999, padding: "2px 8px" }}>{l}</span>
            ))}
          </div>
          {n.note && <div style={{ fontSize: 11, fontWeight: 700, color: "#5f6b7a", marginTop: 2 }}>{n.note}</div>}
        </div>
      ))}
      {set.length > 0 && <div style={{ padding: "7px 12px", borderTop: "1px solid #eef1f5", fontSize: 11, fontWeight: 700, color: "#9aa4b2" }}>Set: {set.join(", ")}</div>}
    </div>
  );
}

export default function AdminNflTargets() {
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState({}); // { [TEAM]: { published, n } }
  const [players, setPlayers] = useState(null); // the 2027 class
  const [state, setState] = useState(null);
  const [targets, setTargets] = useState(null); // teamTargets data
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [preview, setPreview] = useState(null);
  const [allFits, setAllFits] = useState(false);
  const [blurbs, setBlurbs] = useState({}); // { [playerId]: text } — generic write-ups
  const [allLists, setAllLists] = useState({}); // { [TEAM]: [entries] } — everyone on any list
  const [needs, setNeeds] = useState(null); // this team's needs (resolveNeeds)
  const [shotless, setShotless] = useState({}); // { [id]: true } — featured with no action shot
  const [view, setView] = useState("team"); // "team" | "blurbs"
  const [blurbQ, setBlurbQ] = useState("");
  const [missingOnly, setMissingOnly] = useState(true);
  const [openBlurb, setOpenBlurb] = useState(null);
  // { [id]: { id, first, last, pos, school, teams } } — everyone on any
  // team's list (the open team as edited, not as last saved).
  function listed() {
    const out = {};
    const lists = { ...allLists, ...(team && state ? { [team]: [...(state.featured || []), ...(state.list || [])] } : {}) };
    Object.entries(lists).forEach(([t, l]) => (l || []).forEach((r) => {
      if (!r?.id) return;
      if (!out[r.id]) out[r.id] = { id: r.id, first: r.first || "", last: r.last || "", pos: r.pos || "", school: r.school || "", teams: [] };
      out[r.id].teams.push(t);
    }));
    return out;
  }
  const onBlurb = (id, text) => setBlurbs((b) => { const n = { ...b }; if (text) n[id] = text; else delete n[id]; return n; });

  useEffect(() => {
    getDocs(collection(db, NFL_TARGETS_DOC)).then((s) => {
      setStatus(Object.fromEntries(s.docs.map((d) => [d.id, { published: !!d.data().published, n: (d.data().featured || []).length + (d.data().list || []).length }])));
      setAllLists(Object.fromEntries(s.docs.map((d) => [d.id, [...(d.data().featured || []), ...(d.data().list || [])]])));
    }).catch(() => {});
    loadBlurbs(true).then(setBlurbs).catch(() => {});
    getDocs(query(collection(db, "players"), where("Eligible", "in", [TARGETS_YEAR, Number(TARGETS_YEAR)])))
      .then((s) => setPlayers(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => (p.First || p.Last) && p.Slug)))
      .catch(() => setPlayers([]));
  }, []);

  useEffect(() => {
    if (!team) return undefined;
    let live = true;
    setState(null); setTargets(null); setDirty(false); setMsg(""); setOpen(null);
    getDoc(doc(db, NFL_TARGETS_DOC, team)).then((s) => live && setState({ ...EMPTY, ...(s.exists() ? s.data() : {}) })).catch(() => live && setState({ ...EMPTY }));
    fetchTeamTargets(team, []).then((d) => live && setTargets(d)).catch(() => live && setTargets({ rows: [], matches: [], members: [] }));
    setNeeds(null);
    getDoc(doc(db, "nflTeamNeeds", team)).then((s) => live && setNeeds(resolveNeeds(s.exists() ? s.data().needs : {}))).catch(() => live && setNeeds({}));
    return () => { live = false; };
  }, [team]);

  const byId = useMemo(() => new Map((players || []).map((p) => [p.id, p])), [players]);
  const featured = byOrder(state?.featured);
  const featuredKey = featured.map((r) => r.id).join(",");
  useEffect(() => {
    let live = true;
    featured.forEach((r) => playerShots(r.id).then((s) => live && setShotless((m) => ({ ...m, [r.id]: !s.length }))).catch(() => {}));
    return () => { live = false; };
  }, [featuredKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = byOrder(state?.list);
  const picked = new Set([...featured, ...list].map((r) => r.id));
  const change = (fn) => { setState((s) => fn(s)); setDirty(true); setMsg(""); };
  const renumber = (l) => l.map((r, i) => ({ ...r, order: i }));
  const setSection = (key, l) => change((s) => ({ ...s, [key]: renumber(l) }));
  const entryOf = (p) => ({ id: p.id, ...(byId.get(p.id) ? fieldsOf(byId.get(p.id)) : { slug: p.slug || "", first: p.first, last: p.last, pos: p.pos, school: p.school }), note: "" });
  const addTo = (key, p) => {
    if (picked.has(p.id)) return;
    if (key === "featured" && featured.length >= FEATURED_MAX) { setMsg(`Featured is full (${FEATURED_MAX}) — add to the list.`); return; }
    if (key === "list" && list.length >= LIST_MAX) { setMsg(`The list is full (${LIST_MAX}).`); return; }
    setSection(key, [...(key === "featured" ? featured : list), entryOf(p)]);
  };
  const remove = (key, id) => setSection(key, (key === "featured" ? featured : list).filter((r) => r.id !== id));
  const move = (key, id, d) => {
    const l = [...(key === "featured" ? featured : list)];
    const i = l.findIndex((r) => r.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setSection(key, l);
  };
  // Featured ↔ list (the last featured drops to the top of the list).
  const swap = (from, id) => {
    const r = (from === "featured" ? featured : list).find((x) => x.id === id);
    if (!r) return;
    if (from === "list" && featured.length >= FEATURED_MAX) { setMsg(`Featured is full (${FEATURED_MAX}) — move one down first.`); return; }
    change((s) => {
      const f = byOrder(s.featured).filter((x) => x.id !== id);
      const l = byOrder(s.list).filter((x) => x.id !== id);
      return from === "featured" ? { ...s, featured: renumber(f), list: renumber([r, ...l]) } : { ...s, featured: renumber([...f, r]), list: renumber(l) };
    });
  };
  const patch = (key, id, f) => setSection(key, (key === "featured" ? featured : list).map((r) => (r.id === id ? { ...r, ...f } : r)));

  async function write(extra = {}) {
    setBusy(true); setMsg("");
    try {
      const fresh = (l) => renumber(l).map((r) => ({ ...r, ...(byId.get(r.id) ? fieldsOf(byId.get(r.id)) : {}) }));
      const next = { ...state, ...extra };
      const out = {
        year: TARGETS_YEAR, team, intro: next.intro || "", published: !!next.published,
        featured: fresh(featured), list: fresh(list), updatedAt: serverTimestamp(),
        ...(next.published && !state.publishedAt ? { publishedAt: serverTimestamp() } : state.publishedAt ? { publishedAt: state.publishedAt } : {}),
      };
      await setDoc(doc(db, NFL_TARGETS_DOC, team), out);
      // The public page changed (a published list saved, or published /
      // unpublished): have search bots' copy of /nfl/{team} re-rendered now.
      if (out.published || state.published) recachePage(`/nfl/${team.toLowerCase()}`);
      setState({ ...next, featured: out.featured, list: out.list, publishedAt: state.publishedAt || (next.published ? new Date() : null) });
      setStatus((st) => ({ ...st, [team]: { published: out.published, n: out.featured.length + out.list.length } }));
      setDirty(false);
      return true;
    } catch (e) {
      console.error("NFL targets save error:", e);
      setMsg(`Couldn't save: ${e.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = async () => { if (await write()) setMsg("Saved."); };
  const togglePublish = async () => {
    const on = !state.published;
    if (on && !featured.length) { setMsg("Add featured players before publishing."); return; }
    if (!window.confirm(on ? `Publish ${NFL_TEAMS[team]}' list? It becomes their Targets tab (2027) for everyone.` : `Unpublish? ${NFL_TEAMS[team]} go back to the coach-fit view.`)) return;
    if (await write({ published: on })) setMsg(on ? "Published — it's the team's Targets tab." : "Unpublished.");
  };

  async function showCard(r, shotUrl = "") {
    setPreview({ id: r.id, name: `${r.first} ${r.last}`, src: "", shots: [], shot: "" });
    const shots = await playerShots(r.id);
    const want = shotUrl || r.shot || "";
    const shot = shots.find((s) => s.url === want) || shots[0] || null;
    if (shotUrl && shotUrl !== r.shot) patch("featured", r.id, { shot: shotUrl });
    setPreview((pv) => (pv?.id === r.id ? { ...pv, shots, shot: shot?.url || "" } : pv));
    const src = await drawDraftCard({ player: r, year: TARGETS_YEAR, shotUrl: shot?.url || "" }).catch(() => "");
    setPreview((pv) => (pv?.id === r.id ? { ...pv, src, failed: !src } : pv));
  }

  const suggestions = useMemo(() => fitSuggestions(targets), [targets]);
  const t = norm(q);
  const matches = useMemo(() => (t.length < 2 || !players ? [] : players.filter((p) => norm(`${p.First} ${p.Last} ${p.School} ${p.Position}`).includes(t)).slice(0, 10)), [t, players]);
  const memberName = (slot) => (targets?.members || []).find((m) => m.slot === slot)?.person?.Name || slot;

  // ── Team picker ──
  const listedNow = listed();
  const listedCount = Object.keys(listedNow).length;
  const missingCount = Object.keys(listedNow).filter((id) => !blurbs[id]).length;
  const picker = (
    <div style={{ ...card, padding: "10px 12px", display: "flex", flexWrap: "wrap", gap: 6 }}>
      <button type="button" onClick={() => setView(view === "blurbs" ? "team" : "blurbs")} style={{ ...btn(GOLD, view === "blurbs"), marginRight: 6 }}>
        Player write-ups{missingCount ? ` · ${missingCount} missing` : ""}
      </button>
      {TEAMS.map((k) => {
        const st = status[k];
        const color = st?.published ? GREEN : st?.n ? GOLD : "#c9d1dc";
        return (
          <button key={k} type="button" title={`${NFL_TEAMS[k]} — ${st?.published ? "published" : st?.n ? "draft" : "empty"}`}
            onClick={() => { if (!dirty || window.confirm("Discard unsaved changes?")) { setTeam(k); setView("team"); } }}
            style={{ ...btn(team === k ? INK : "#7a8597", team === k), borderColor: team === k ? INK : color, boxShadow: `inset 0 -3px 0 ${color}` }}>{k}</button>
        );
      })}
    </div>
  );
  // Write-ups view: every player on any team's list (this team's unsaved
  // edits included), then any 2027 player found by search.
  if (view === "blurbs") {
    const bq = norm(blurbQ);
    const found = bq.length >= 2 && players ? players.filter((p) => !listedNow[p.id] && norm(`${p.First} ${p.Last} ${p.School} ${p.Position}`).includes(bq)).slice(0, 10) : [];
    const rows = Object.values(listedNow)
      .filter((r) => !missingOnly || !blurbs[r.id])
      .filter((r) => !bq || norm(`${r.first} ${r.last} ${r.school} ${r.pos}`).includes(bq))
      .sort((a, b) => (Number(!!blurbs[a.id]) - Number(!!blurbs[b.id])) || b.teams.length - a.teams.length || a.last.localeCompare(b.last));
    const blurbRow = (r, i) => (
      <div key={r.id} style={{ padding: "10px 14px", borderTop: i ? "1px solid #eef1f5" : "none", display: "grid", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <b style={{ color: INK, fontSize: 14 }}>{r.first} {r.last}</b>
          <span style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}>{r.pos} · {r.school}</span>
          {r.teams.length > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: BLUE }}>On: {r.teams.join(", ")}</span>}
          {!blurbs[r.id] && <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", background: GOLD, borderRadius: 999, padding: "2px 7px" }}>Missing</span>}
        </div>
        <BlurbEditor id={r.id} name={`${r.first} ${r.last}`} value={blurbs[r.id] || ""} onSaved={onBlurb} />
      </div>
    );
    return (
      <div style={{ display: "grid", gap: 12, fontFamily: "Arial, sans-serif" }}>
        {picker}
        <div style={{ ...card, padding: "12px 14px", display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 900, color: INK, fontSize: 15 }}>Player write-ups — {listedCount - missingCount}/{listedCount} listed players done</div>
          <div style={{ fontSize: 12, color: "#5f6b7a", fontWeight: 700, lineHeight: 1.5 }}>
            1–2 sentences about the player — not about any team. Shown under his row on every team list he's on, and as a featured player's write-up until that team has its own. Public — no PFF numbers.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input value={blurbQ} onChange={(e) => setBlurbQ(e.target.value)} placeholder="Filter, or search the 2027 class to write one ahead" style={{ ...input, flex: 1, minWidth: 240 }} />
            <label style={{ fontSize: 12, fontWeight: 800, color: INK, display: "flex", gap: 5, alignItems: "center" }}>
              <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only
            </label>
          </div>
        </div>
        <div style={card}>
          {!rows.length && <div style={{ padding: 14, fontSize: 13, color: "#9aa4b2", fontWeight: 700 }}>{missingOnly ? "Every listed player has a write-up." : "Nobody matches."}</div>}
          {rows.map(blurbRow)}
        </div>
        {found.length > 0 && (
          <div style={card}>
            <div style={{ padding: "8px 14px", background: "#334155", color: "#fff", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>Not on a list yet</div>
            {found.map((p, i) => blurbRow({ id: p.id, ...fieldsOf(p), teams: [] }, i))}
          </div>
        )}
      </div>
    );
  }

  if (!team) {
    return (
      <div style={{ display: "grid", gap: 12, fontFamily: "Arial, sans-serif" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15 }}>NFL Draft Targets ({TARGETS_YEAR}) — pick a team</div>
        {picker}
        <div style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}>Underline: green published · gold draft · gray empty.</div>
      </div>
    );
  }
  if (!state || !players) return <div style={{ display: "grid", gap: 12 }}>{picker}<div style={{ padding: 20, color: "#9aa4b2", fontWeight: 800 }}>Loading…</div></div>;

  // A plain function, not a component — an inner component would remount
  // (and drop the write-up box's focus) on every keystroke.
  const row = (r, keyName, i, count) => {
    const fit = fitFor(targets, r.id);
    return (
      <div key={r.id} style={{ borderTop: i ? "1px solid #eef1f5" : "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", flexWrap: "wrap" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button type="button" disabled={i === 0} onClick={() => move(keyName, r.id, -1)} style={{ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: i === 0 ? 0.3 : 1 }}>▲</button>
            <button type="button" disabled={i === count - 1} onClick={() => move(keyName, r.id, 1)} style={{ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: i === count - 1 ? 0.3 : 1 }}>▼</button>
          </span>
          <span style={{ minWidth: 200, flex: 1 }}>
            <a href={`/player/${r.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, color: INK, textDecoration: "none", fontSize: 14 }}>{r.first} {r.last}</a>
            <span style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}> · {r.pos} · {r.school}</span>
            {fit && <span title="Shows on his snapshot on the page" style={{ marginLeft: 6, fontSize: 10, fontWeight: 900, color: "#fff", background: GREEN, borderRadius: 999, padding: "2px 7px" }}>{fitLabel(fit)}</span>}
            {keyName === "featured" && shotless[r.id] && <div style={{ fontSize: 11, fontWeight: 800, color: RED, marginTop: 3 }}>No action shot — shows in the list on the page until one is placed (Content → Photos)</div>}
            {keyName === "featured" && r.note && open !== r.id && <div style={{ fontSize: 11, fontWeight: 600, color: "#3b4756", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 520 }}>📝 {r.note}</div>}
            {keyName === "featured" && !r.note && <div style={{ fontSize: 11, fontWeight: 800, color: blurbs[r.id] ? "#7a8597" : GOLD, marginTop: 3 }}>{blurbs[r.id] ? "No team write-up — showing his generic one" : "Needs a write-up (no generic one either)"}</div>}
            {openBlurb !== r.id && (blurbs[r.id]
              ? <div style={{ fontSize: 11, fontWeight: 600, color: "#5f6b7a", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 520 }}>Generic: {blurbs[r.id]}</div>
              : keyName === "list" && <div style={{ fontSize: 11, fontWeight: 800, color: GOLD, marginTop: 3 }}>No generic write-up</div>)}
          </span>
          {keyName === "featured" && <button type="button" onClick={() => showCard(r)} style={btn(BLUE)}>Card</button>}
          {keyName === "featured" && <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} style={btn(BLUE, open === r.id)}>{r.note ? "Edit write-up" : "Write-up"}</button>}
          <button type="button" onClick={() => setOpenBlurb(openBlurb === r.id ? null : r.id)} style={btn("#7a8597", openBlurb === r.id)}>{blurbs[r.id] ? "Generic" : "+ Generic"}</button>
          <button type="button" onClick={() => swap(keyName, r.id)} style={btn("#7a8597")}>{keyName === "featured" ? "↓ To list" : "↑ Feature"}</button>
          <button type="button" onClick={() => remove(keyName, r.id)} style={btn(RED)}>Remove</button>
        </div>
        {openBlurb === r.id && (
          <div style={{ padding: "4px 14px 12px 40px", background: "#fafbfd" }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Generic write-up — every team's list (saves on its own)</div>
            <BlurbEditor id={r.id} name={`${r.first} ${r.last}`} value={blurbs[r.id] || ""} onSaved={onBlurb} team={NFL_TEAMS[team]} />
          </div>
        )}
        {open === r.id && keyName === "featured" && (
          <div style={{ padding: "4px 14px 12px 70px", background: "#fafbfd" }}>
            <textarea value={r.note || ""} onChange={(e) => patch("featured", r.id, { note: e.target.value })} rows={5} placeholder={`Why ${r.first} ${r.last} fits the ${NFL_TEAMS[team]}…`}
              style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
            <div style={{ fontSize: 11, color: "#9aa4b2", fontWeight: 700, marginTop: 4 }}>Public — no PFF numbers. Blank line between paragraphs. Blank = his generic write-up shows instead.{fit ? " His staff fit shows under it on the page." : ""}</div>
          </div>
        )}
      </div>
    );
  };

  const shownSuggestions = allFits ? suggestions : suggestions.slice(0, 15);
  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      {picker}
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15 }}>{NFL_TEAMS[team]} · {TARGETS_YEAR} targets</div>
        <span style={{ fontSize: 11, fontWeight: 900, padding: "3px 9px", borderRadius: 999, color: "#fff", background: state.published ? GREEN : "#8a94a6" }}>{state.published ? "Published" : "Not published"}</span>
        <a href={`/nfl/${team.toLowerCase()}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 800, color: BLUE }}>View page ↗</a>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#7a8597" }}>{featured.length}/{FEATURED_MAX} featured · {list.length}/{LIST_MAX} list</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {msg && <span style={{ fontSize: 12, fontWeight: 800, color: msg.startsWith("Couldn't") ? RED : msg.includes("full") || msg.startsWith("Add") ? GOLD : GREEN }}>{msg}</span>}
          <button type="button" onClick={togglePublish} disabled={busy} style={btn(state.published ? RED : GREEN)}>{state.published ? "Unpublish" : "Publish…"}</button>
          <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...btn(GOLD, true), opacity: busy || !dirty ? 0.5 : 1 }}>{busy ? "Working…" : dirty ? "Save" : "Saved"}</button>
        </span>
      </div>

      <div style={{ ...card, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Intro (optional — blank line between paragraphs)</div>
        <textarea value={state.intro || ""} onChange={(e) => change((s) => ({ ...s, intro: e.target.value }))} rows={3} placeholder={`What the ${NFL_TEAMS[team]} need in ${TARGETS_YEAR}…`}
          style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={card}>
            <div style={{ padding: "9px 14px", background: INK, color: "#fff", display: "flex", gap: 8, alignItems: "center" }}>
              <b style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>Featured</b>
              <span style={{ fontSize: 12, color: "#9fb0c8", fontWeight: 700 }}>{featured.length}/{FEATURED_MAX} · draft card + write-up each</span>
            </div>
            {!featured.length && <div style={{ padding: 14, fontSize: 13, color: "#9aa4b2", fontWeight: 700 }}>No featured players yet — add from the suggestions or search.</div>}
            {featured.map((r, i) => row(r, "featured", i, featured.length))}
          </div>
          <div style={card}>
            <div style={{ padding: "9px 14px", background: "#334155", color: "#fff", display: "flex", gap: 8, alignItems: "center" }}>
              <b style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>List</b>
              <span style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 700 }}>{list.length}/{LIST_MAX} · full rows with stats + generic write-up</span>
            </div>
            {!list.length && <div style={{ padding: 14, fontSize: 13, color: "#9aa4b2", fontWeight: 700 }}>Nobody on the list yet.</div>}
            {list.map((r, i) => row(r, "list", i, list.length))}
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <NeedsPanel needs={needs} />
          <div style={{ ...card, padding: "10px 12px" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search the ${TARGETS_YEAR} class — name, school, position`} style={{ ...input, width: "100%" }} />
            {matches.length > 0 && (
              <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                {matches.map((p) => {
                  const fit = fitFor(targets, p.id);
                  const taken = picked.has(p.id);
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, flexWrap: "wrap" }}>
                      <b style={{ color: INK }}>{p.First} {p.Last}</b><span style={{ color: "#7a8597" }}>{p.Position} · {p.School}</span>
                      {fit && <span style={{ fontSize: 10, fontWeight: 900, color: GREEN }}>{fitLabel(fit)}</span>}
                      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        <button type="button" disabled={taken} onClick={() => { addTo("featured", p); setQ(""); }} style={{ ...btn(BLUE), opacity: taken ? 0.4 : 1 }}>+ Featured</button>
                        <button type="button" disabled={taken} onClick={() => { addTo("list", p); setQ(""); }} style={{ ...btn("#7a8597"), opacity: taken ? 0.4 : 1 }}>+ List</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ padding: "9px 12px", background: GREEN, color: "#fff" }}>
              <b style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" }}>Staff fit suggestions</b>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85 }}>{TARGETS_YEAR} prospects who fit this staff's draft history — {suggestions.length} found</div>
            </div>
            {targets === null ? <div style={{ padding: 12, color: "#9aa4b2", fontWeight: 700 }}>Loading fits…</div>
              : !suggestions.length ? <div style={{ padding: 12, fontSize: 12, color: "#9aa4b2", fontWeight: 700 }}>No {TARGETS_YEAR} fits on file for this staff.</div>
                : shownSuggestions.map((s, i) => {
                  const taken = picked.has(s.id);
                  return (
                    <div key={s.id} style={{ padding: "8px 12px", borderTop: i ? "1px solid #eef1f5" : "none", opacity: taken ? 0.55 : 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {s.logo && <img src={s.logo} alt="" style={{ width: 20, height: 20, objectFit: "contain" }} />}
                        <b style={{ color: INK, fontSize: 13 }}>{s.first} {s.last}</b>
                        <span style={{ fontSize: 11, color: "#7a8597", fontWeight: 700 }}>{s.pos} · {s.school}</span>
                        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          {taken ? <span style={{ fontSize: 10, fontWeight: 900, color: GREEN }}>✓ Picked</span> : <>
                            <button type="button" onClick={() => addTo("featured", s)} style={btn(BLUE)}>+ Featured</button>
                            <button type="button" onClick={() => addTo("list", s)} style={btn("#7a8597")}>+ List</button>
                          </>}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#3b4756", marginTop: 3 }}>
                        {[
                          s.fit.score != null ? `Staff ${s.fit.score} (${s.fit.tier.label})` : "",
                          ...s.fit.parts.map((x) => `${memberName(x.slot).split(" ").slice(-1)[0]} ${x.slot} ${x.score}`),
                          ...s.fit.matches.slice(0, 1).map((m) => `≈ ${m.pl} (${m.pn}, ${m.y}) ${m.s}`),
                        ].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  );
                })}
            {suggestions.length > 15 && <div style={{ padding: 8, borderTop: "1px solid #eef1f5" }}><button type="button" onClick={() => setAllFits(!allFits)} style={btn(GREEN)}>{allFits ? "Show fewer" : `Show all ${suggestions.length}`}</button></div>}
          </div>
        </div>
      </div>

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 20000, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 12, maxWidth: 440, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <b style={{ color: INK }}>{preview.name}</b>
              {preview.src && <button type="button" onClick={() => downloadPng(preview.src, `${norm(preview.name).replace(/ /g, "-")}-${TARGETS_YEAR}-draft.png`)} style={{ ...btn(BLUE), marginLeft: "auto" }}>Download PNG</button>}
              <button type="button" onClick={() => setPreview(null)} style={{ ...btn(BLUE), marginLeft: preview.src ? 8 : "auto" }}>Close</button>
            </div>
            {preview.src ? <img src={preview.src} alt="" style={{ width: "100%", display: "block", borderRadius: 8 }} />
              : <div style={{ padding: 40, textAlign: "center", color: preview.failed ? RED : "#9aa4b2", fontWeight: 800 }}>{preview.failed ? "Couldn't draw it." : "Drawing…"}</div>}
            {preview.shots?.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>His shot — pick one</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {preview.shots.map((sh) => {
                    const r = featured.find((x) => x.id === preview.id);
                    return (
                      <button key={sh.url} type="button" onClick={() => r && showCard(r, sh.url)}
                        style={{ width: 56, height: 70, padding: 0, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#f1f4f8", border: `3px solid ${sh.url === preview.shot ? GOLD : "#e3e8ef"}` }}>
                        <img src={sh.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#7a8597", fontWeight: 700, marginTop: 8 }}>
              {preview.shots?.length ? "His action shot placed for First Pick (Content → Photos). Save keeps the one picked." : "No action shot placed for him — place one for First Pick in Content → Photos."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
