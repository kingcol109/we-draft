// src/components/AdminRisers.jsx
//
// Admin → Content → Rising Page: the Draft Risers on /risers/{year}
// (pages/Risers.jsx, utils/risers.js). Per class: who's on it, as what
// one ranked board — each player labeled On Fire, Trending Up or Breakout
// as the admin sees fit, every label ranked together — and
// which of his season stats show (his CFBD season line — public numbers;
// up to MAX_STATS — on the back of his card on the page). Saved as one doc,
// risers/{year}; the player's name, position and school are copied in from
// his players doc on every save. Note: the admin's write-up on him
// (riser.note — blank lines split paragraphs), shown in his row on the page.
//
// Suggest: the Trends suggester's scan (TrendSuggester.js scanHeat — PFF
// grades + page-view momentum) over the class, with its label as the
// suggested type. PFF numbers show here only — never on the page, never in
// a riser's stats or note.
//
// Graphic: a riser gets one when he has an action shot placed for the
// First Pick graphic (Admin → Content → Photos); Preview draws it here.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { db } from "../firebase";
import { scanHeat, percentiles } from "./TrendSuggester";
import { rankPct, pffLine } from "./pffData";
import { drawRiser, placedShots } from "./RiserGraphic";
import {
  RISER_YEARS, RISER_TYPES, RISER_TYPE_KEYS, TREND_TO_RISER, STATS_SEASON, MAX_STATS, DEFAULT_STATS,
  STAT_LABELS, STAT_CATEGORY_NAMES, statLabel, statValue, seasonKeys, risersRanked, labelCounts, risersPath,
  riserShot, RISER_EDITIONS, editionId, editionDate, editionLabel,
} from "../utils/risers";
import { fetchRecentSummary } from "../utils/riserRecent";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const RED = "#c0392b";
const INK = "#0b1a2e";
const card = { background: "#fff", border: "1px solid #e3e8ef", borderRadius: 12, overflow: "hidden" };
const input = { border: "1px solid #d5dbe4", borderRadius: 6, padding: "7px 9px", fontSize: 13, fontFamily: "Arial, sans-serif", boxSizing: "border-box" };
const btn = (color, filled = false) => ({
  border: `2px solid ${color}`, background: filled ? color : "#fff", color: filled ? "#fff" : color,
  borderRadius: 6, padding: "5px 10px", fontSize: 11, fontWeight: 900, cursor: "pointer", textTransform: "uppercase", whiteSpace: "nowrap",
});
const SUGGEST_COUNT = 20;

// His CFBD season line (the linked cfbdPlayers doc with this season), or null.
const seasonCache = new Map();
function loadSeason(playerId) {
  if (!seasonCache.has(playerId)) {
    seasonCache.set(playerId, getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", playerId)))
      .then((snap) => {
        const docs = snap.docs.map((d) => d.data()).filter((d) => d.mappingStatus !== "rejected");
        const best = docs.find((d) => d.seasons?.[STATS_SEASON] && d.mappingStatus === "verified") || docs.find((d) => d.seasons?.[STATS_SEASON]);
        return best?.seasons?.[STATS_SEASON] || null;
      })
      .catch(() => null));
  }
  return seasonCache.get(playerId);
}
const statsFor = (keys, season) => keys.map((key) => ({ key, label: statLabel(key), value: statValue(season, key), season: STATS_SEASON }));

export default function AdminRisers() {
  const [year, setYear] = useState(RISER_YEARS[0]);
  const [players, setPlayers] = useState(null); // every players doc
  const [list, setList] = useState(null); // this class's risers
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState({}); // { [id]: playerPhotos doc | null }
  const [search, setSearch] = useState("");
  const [addType, setAddType] = useState("onFire");
  const [openStats, setOpenStats] = useState("");
  const [preview, setPreview] = useState(null); // { name, src }
  const [suggest, setSuggest] = useState(null); // { rows, cooling, scanned } | "running"

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last)))
      .catch((e) => { console.error("Risers players load error:", e); setPlayers([]); });
  }, []);
  useEffect(() => {
    let live = true;
    setList(null); setDirty(false); setMsg(""); setSuggest(null); setOpenStats("");
    getDoc(doc(db, "risers", year)).then((s) => live && setList(s.exists() ? s.data().players || [] : []))
      .catch((e) => { console.error("Risers load error:", e); if (live) setList([]); });
    return () => { live = false; };
  }, [year]);
  // Each riser's photos (headshot, placed shots).
  const idsKey = (list || []).map((r) => r.id).sort().join(",");
  useEffect(() => {
    const missing = (list || []).map((r) => r.id).filter((id) => !(id in photos));
    if (!missing.length) return;
    Promise.all(missing.map((id) => getDoc(doc(db, "playerPhotos", id)).then((s) => [id, s.exists() ? s.data() : null]).catch(() => [id, null])))
      .then((pairs) => setPhotos((p) => ({ ...p, ...Object.fromEntries(pairs) })));
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map((players || []).map((p) => [p.id, p])), [players]);
  const classPlayers = useMemo(() => (players || []).filter((p) => String(p.Eligible) === year && p.Slug), [players, year]);
  const ranked = risersRanked(list || []);
  const has = (id) => (list || []).some((r) => r.id === id);

  const change = (fn) => { setList((l) => fn(l || [])); setDirty(true); setMsg(""); };
  // Renumbers the board 0… in the order given.
  const renumber = (l) => l.map((r, i) => ({ ...r, order: i }));
  const ordered = (l) => risersRanked(l);

  async function add(p, type) {
    if (has(p.id)) return;
    const season = await loadSeason(p.id);
    const keys = (DEFAULT_STATS[p.Position] || []).filter((k) => statValue(season, k) !== "");
    change((l) => {
      const next = [...ordered(l), {
        id: p.id, slug: p.Slug, first: p.First || "", last: p.Last || "", pos: p.Position || "", school: p.School || "",
        type, order: 1e9, stats: statsFor(keys, season), note: "", addedAt: Date.now(),
      }];
      return renumber(ordered(next));
    });
  }
  const remove = (id) => change((l) => renumber(ordered(l.filter((r) => r.id !== id))));
  // Moves him to rank `to` (1…) on the board.
  const moveTo = (id, to) => change((l) => {
    const all = ordered(l);
    const i = all.findIndex((x) => x.id === id);
    const j = Math.max(0, Math.min(all.length - 1, to - 1));
    if (i < 0 || i === j) return l;
    const [r] = all.splice(i, 1);
    all.splice(j, 0, r);
    return renumber(all);
  });
  const relabel = (id, type) => change((l) => l.map((r) => (r.id === id ? { ...r, type } : r)));
  const setStats = (id, stats) => change((l) => l.map((r) => (r.id === id ? { ...r, stats } : r)));
  const setNote = (id, note) => change((l) => l.map((r) => (r.id === id ? { ...r, note, noteUpdatedAt: Date.now() } : r)));

  async function save() {
    setBusy(true); setMsg("");
    try {
      // Each one's photos (for his graphic's shot), if not in yet.
      const missing = (list || []).map((r) => r.id).filter((id) => photos[id] === undefined);
      const fetched = Object.fromEntries(await Promise.all(missing.map((id) => getDoc(doc(db, "playerPhotos", id)).then((d) => [id, d.exists() ? d.data() : null]).catch(() => [id, null]))));
      const allPhotos = { ...photos, ...fetched };
      // Fresh name / position / school from each players doc, and his
      // graphic's shot locked in (the one picked in Preview, else his first
      // placed shot) — the graphic uses that one until it's changed.
      const out = renumber(ordered(list || [])).map((r) => {
        const p = byId.get(r.id);
        const shot = riserShot(r, placedShots(allPhotos[r.id]))?.url || "";
        const base = p ? { ...r, slug: p.Slug || r.slug, first: p.First || "", last: p.Last || "", pos: p.Position || "", school: p.School || "" } : r;
        return { ...base, shot };
      });
      await setDoc(doc(db, "risers", year), { players: out, updatedAt: serverTimestamp() });
      // …and publish it as today's edition (riserEditions/{year}_{date} — a
      // second Save today replaces it), each riser with his recent line as it
      // reads right now, so the edition keeps that day's numbers.
      const date = editionDate();
      const recents = await Promise.all(out.map((r) => fetchRecentSummary(r.pos, allPhotos[r.id]?.headshot?.espnId).catch(() => null)));
      await setDoc(doc(db, RISER_EDITIONS, editionId(year, date)), {
        year, date, publishedAt: serverTimestamp(),
        players: out.map((r, i) => ({ ...r, recent: recents[i] || null })),
      });
      setList(out); setDirty(false);
      if (missing.length) setPhotos((ph) => ({ ...ph, ...fetched }));
      setMsg(`Saved — ${out.length} riser${out.length === 1 ? "" : "s"} live on ${risersPath(year)}, published as the ${editionLabel(date, { month: "short", day: "numeric" })} edition.`);
    } catch (e) {
      console.error("Risers save error:", e);
      setMsg(`Couldn't save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshStats() {
    setBusy(true); setMsg("");
    seasonCache.clear();
    const seasons = await Promise.all((list || []).map((r) => loadSeason(r.id)));
    change((l) => l.map((r) => {
      const season = seasons[(list || []).findIndex((x) => x.id === r.id)];
      return season ? { ...r, stats: statsFor((r.stats || []).map((s) => s.key), season) } : r;
    }));
    setBusy(false);
    setMsg("Stat values refreshed from the latest season sync — Save to publish them.");
  }

  async function runSuggest() {
    setSuggest("running");
    try {
      const all = await scanHeat(classPlayers);
      const hot = all.filter((c) => c.label && !has(c.p.id));
      const pct = { recent: percentiles(hot.map((c) => c.recentAvg)), delta: percentiles(hot.map((c) => c.delta)), momentum: percentiles(hot.filter((c) => c.momentum != null).map((c) => c.momentum)) };
      hot.forEach((c) => {
        const heat = pct.recent(c.recentAvg) * 0.5 + pct.delta(c.delta) * 0.3 + rankPct(c.rec) * 0.2;
        c.score = Math.round((heat * 0.65 + (c.momentum != null ? pct.momentum(c.momentum) : 0.5) * 0.35) * 100);
      });
      hot.sort((a, b) => b.score - a.score);
      // Risers whose grades have dropped off.
      const cooling = all.filter((c) => has(c.p.id) && (c.delta <= -8 || c.recentAvg < 60));
      setSuggest({ rows: hot.slice(0, SUGGEST_COUNT), total: hot.length, cooling, scanned: all.length });
    } catch (e) {
      console.error("Risers suggest error:", e);
      setSuggest({ error: "Couldn't build suggestions — check console." });
    }
  }

  // Preview his graphic; shotUrl: draw it with that placed shot (and make
  // it his — saved on him with the board).
  async function showPreview(r, shotUrl) {
    const shots = placedShots(photos[r.id]);
    const rank = ranked.findIndex((x) => x.id === r.id) + 1;
    const riser = shotUrl ? { ...r, shot: shotUrl } : r;
    if (shotUrl && shotUrl !== r.shot) change((l) => l.map((x) => (x.id === r.id ? { ...x, shot: shotUrl } : x)));
    const shot = riserShot(riser, shots);
    setPreview({ id: r.id, name: `${r.first} ${r.last}`, src: "", shots, shot: shot?.url || "" });
    const src = await drawRiser({ riser, rank, year, shots, shot }).catch(() => "");
    setPreview((pv) => (pv?.id === r.id ? { ...pv, src, failed: !src } : pv));
  }

  const q = search.trim().toLowerCase();
  const matches = q.length < 2 ? [] : classPlayers.filter((p) => `${p.First} ${p.Last} ${p.School}`.toLowerCase().includes(q)).slice(0, 8);

  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      {/* Class + save */}
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15, marginRight: 6 }}>Draft Risers</div>
        {RISER_YEARS.map((y) => <button key={y} type="button" onClick={() => { if (!dirty || window.confirm("Discard unsaved changes?")) setYear(y); }} style={btn(BLUE, y === year)}>{y}</button>)}
        <a href={risersPath(year)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 800, color: BLUE, marginLeft: 6 }}>View page ↗</a>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {msg && <span style={{ fontSize: 12, fontWeight: 800, color: msg.startsWith("Couldn't") ? RED : "#15803d" }}>{msg}</span>}
          <button type="button" onClick={refreshStats} disabled={busy || !list?.length} style={btn(BLUE)}>Refresh stat values</button>
          <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...btn(GOLD, true), opacity: busy || !dirty ? 0.5 : 1 }}>{busy ? "Working…" : dirty ? "Save" : "Saved"}</button>
        </span>
      </div>

      {/* Add a player */}
      <div style={{ ...card, padding: "12px 14px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Add a ${year} prospect — search by name or school`} style={{ ...input, flex: 1, minWidth: 220 }} />
          <span style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase" }}>Label</span>
          <select value={addType} onChange={(e) => setAddType(e.target.value)} style={input}>
            {RISER_TYPE_KEYS.map((t) => <option key={t} value={t}>{RISER_TYPES[t].emoji} {RISER_TYPES[t].label}</option>)}
          </select>
          <button type="button" onClick={runSuggest} disabled={!players || suggest === "running"} style={btn(BLUE, true)}>{suggest === "running" ? "Crunching…" : "Suggest risers"}</button>
        </div>
        {matches.length > 0 && (
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {matches.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <b style={{ color: INK }}>{p.First} {p.Last}</b><span style={{ color: "#7a8597" }}>{p.Position} · {p.School}</span>
                <button type="button" disabled={has(p.id)} onClick={() => { add(p, addType); setSearch(""); }} style={{ ...btn(RISER_TYPES[addType].ink), marginLeft: "auto", opacity: has(p.id) ? 0.4 : 1 }}>
                  {has(p.id) ? "On the board" : `+ Add (${RISER_TYPES[addType].label})`}
                </button>
              </div>
            ))}
          </div>
        )}
        {q.length >= 2 && !matches.length && <div style={{ marginTop: 8, fontSize: 12, color: "#9aa4b2", fontWeight: 700 }}>No {year} prospects match.</div>}
      </div>

      {suggest && suggest !== "running" && <Suggestions s={suggest} year={year} onAdd={add} onClose={() => setSuggest(null)} has={has} />}

      {/* The board: one ranked list, each player labeled */}
      {list === null ? <div style={{ padding: 20, color: "#9aa4b2", fontWeight: 800 }}>Loading…</div> : (
        <div style={card}>
          <div style={{ padding: "10px 14px", background: INK, color: "#fff", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>The {year} board</b>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#9fb0c8" }}>{ranked.length} player{ranked.length === 1 ? "" : "s"} · every label ranked together · type a rank or use the arrows to move</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {labelCounts(ranked).map(([k, n]) => (
                <span key={k} style={{ fontSize: 11, fontWeight: 900, padding: "3px 8px", borderRadius: 999, background: `linear-gradient(135deg, ${RISER_TYPES[k].c1}, ${RISER_TYPES[k].c2})`, color: "#fff" }}>
                  {RISER_TYPES[k].emoji} {n}
                </span>
              ))}
            </span>
          </div>
          {!ranked.length && <div style={{ padding: 14, fontSize: 13, color: "#9aa4b2", fontWeight: 700 }}>Nobody yet — add a prospect above.</div>}
          {ranked.map((r, i) => (
            <RiserRow key={r.id} r={r} rank={i + 1} count={ranked.length} photos={photos[r.id]} player={byId.get(r.id)}
              open={openStats === r.id} onOpen={() => setOpenStats(openStats === r.id ? "" : r.id)}
              onMoveTo={(to) => moveTo(r.id, to)} onLabel={(tp) => relabel(r.id, tp)} onRemove={() => { if (window.confirm(`Take ${r.first} ${r.last} off the board?`)) remove(r.id); }}
              onStats={(st) => setStats(r.id, st)} onNote={(n) => setNote(r.id, n)} onPreview={() => showPreview(r)} />
          ))}
        </div>
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 20000, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 12, maxWidth: 440, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <b style={{ color: INK }}>{preview.name}</b>
              <button type="button" onClick={() => setPreview(null)} style={{ ...btn(BLUE), marginLeft: "auto" }}>Close</button>
            </div>
            {preview.src ? <img src={preview.src} alt="" style={{ width: "100%", display: "block", borderRadius: 8 }} />
              : <div style={{ padding: 40, textAlign: "center", color: preview.failed ? RED : "#9aa4b2", fontWeight: 800 }}>{preview.failed ? "His photo wouldn't load." : "Drawing…"}</div>}
            {preview.shots?.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>His shot — pick one</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {preview.shots.map((sh) => {
                    const on = sh.url === preview.shot;
                    const r = (list || []).find((x) => x.id === preview.id);
                    return (
                      <button key={sh.url} type="button" onClick={() => r && showPreview(r, sh.url)} title={on ? "In use" : "Use this shot"}
                        style={{ width: 56, height: 70, padding: 0, borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#f1f4f8", border: `3px solid ${on ? GOLD : "#e3e8ef"}` }}>
                        <img src={sh.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#7a8597", fontWeight: 700, marginTop: 8 }}>Unsaved changes show here; the page's image updates once you Save. Save locks in his shot — the graphic keeps using it until you pick another.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function RiserRow({ r, rank, count, photos, player, open, onOpen, onMoveTo, onLabel, onRemove, onStats, onNote, onPreview }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const t = RISER_TYPES[r.type] || RISER_TYPES.up;
  const shots = placedShots(photos);
  const head = photos?.headshot?.url;
  const moved = player && (player.School !== r.school || player.Position !== r.pos || player.First !== r.first || player.Last !== r.last);
  const [rankText, setRankText] = useState(String(rank));
  useEffect(() => setRankText(String(rank)), [rank]);
  const commitRank = () => { const n = parseInt(rankText, 10); if (Number.isFinite(n) && n !== rank) onMoveTo(n); else setRankText(String(rank)); };
  const arrow = (dis) => ({ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: dis ? 0.3 : 1 });
  return (
    <div style={{ borderTop: "1px solid #eef1f5", borderLeft: `5px solid ${t.c1}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px 9px 9px", flexWrap: "wrap" }}>
        <input value={rankText} onChange={(e) => setRankText(e.target.value.replace(/\D/g, ""))} onBlur={commitRank} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          title="Type a rank to move him there" aria-label="Rank" style={{ ...input, width: 44, textAlign: "center", fontWeight: 900, fontSize: 17, color: INK, padding: "4px 2px" }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button type="button" disabled={rank === 1} onClick={() => onMoveTo(rank - 1)} style={arrow(rank === 1)}>▲</button>
          <button type="button" disabled={rank === count} onClick={() => onMoveTo(rank + 1)} style={arrow(rank === count)}>▼</button>
        </span>
        <span style={{ width: 38, height: 38, borderRadius: "50%", overflow: "hidden", background: "#f1f4f8", flexShrink: 0, boxShadow: `0 0 0 2px ${t.c1}` }}>
          {head && <img src={head} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />}
        </span>
        <span style={{ minWidth: 160, flex: 1 }}>
          <a href={`/player/${r.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, color: INK, textDecoration: "none", fontSize: 14 }}>{r.first} {r.last}</a>
          <span style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}> · {r.pos} · {r.school}</span>
          {moved && <span style={{ fontSize: 10, color: GOLD, fontWeight: 900 }}> · profile changed, Save to update</span>}
          <div style={{ fontSize: 11, fontWeight: 700, color: "#5a6475", marginTop: 2 }}>
            {(r.stats || []).length ? r.stats.map((s) => `${s.label} ${s.value || "—"}`).join(" · ") : <span style={{ color: "#9aa4b2" }}>No stats shown</span>}
          </div>
          {r.note && !noteOpen && (
            <div style={{ fontSize: 11, fontWeight: 600, color: "#3b4756", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 520 }}>📝 {r.note}</div>
          )}
        </span>
        {/* His label */}
        <span style={{ display: "inline-flex", border: "1px solid #d5dbe4", borderRadius: 8, overflow: "hidden" }}>
          {RISER_TYPE_KEYS.map((k) => {
            const on = r.type === k;
            const lt = RISER_TYPES[k];
            return (
              <button key={k} type="button" onClick={() => onLabel(k)} title={lt.label} style={{
                border: "none", padding: "5px 8px", fontSize: 11, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap",
                background: on ? `linear-gradient(135deg, ${lt.c1}, ${lt.c2})` : "#fff", color: on ? "#fff" : "#7a8597",
              }}>{lt.emoji} {lt.label}</button>
            );
          })}
        </span>
        <span title={shots.length ? `${shots.length} placed action shot${shots.length === 1 ? "" : "s"}` : "Place an action shot for First Pick in Content → Photos to give him a graphic"}
          style={{ fontSize: 11, fontWeight: 900, color: shots.length ? "#15803d" : "#9aa4b2" }}>
          {photos === undefined ? "…" : shots.length ? "✓ Graphic" : "No graphic"}
        </span>
        {shots.length > 0 && <button type="button" onClick={onPreview} style={btn(BLUE)}>Preview</button>}
        <button type="button" onClick={() => setNoteOpen(!noteOpen)} style={btn(BLUE, noteOpen)}>{r.note ? "Edit note" : "Add note"}</button>
        <button type="button" onClick={onOpen} style={btn(BLUE, open)}>Stats</button>
        <button type="button" onClick={onRemove} style={btn(RED)}>Remove</button>
      </div>
      {noteOpen && (
        <div style={{ padding: "8px 14px 14px 60px", background: "#fafbfd" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#7a8597", marginBottom: 6 }}>
            Why he's rising — shows in his row on the Risers page. Leave a blank line between paragraphs. Public — no PFF numbers.
          </div>
          <textarea value={r.note || ""} onChange={(e) => onNote(e.target.value)} rows={5} placeholder={`What ${r.first} ${r.last} has been doing…`}
            style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 11, color: "#9aa4b2", fontWeight: 700 }}>{(r.note || "").trim().split(/\s+/).filter(Boolean).length} words · Save at the top to publish</span>
            <button type="button" onClick={() => setNoteOpen(false)} style={{ ...btn(BLUE), marginLeft: "auto" }}>Done</button>
          </div>
        </div>
      )}
      {open && <StatPicker r={r} onStats={onStats} />}
    </div>
  );
}

// His season line's stats as checkboxes (MAX_STATS at most, in the order checked).
function StatPicker({ r, onStats }) {
  const [season, setSeason] = useState(undefined);
  useEffect(() => { let live = true; loadSeason(r.id).then((s) => live && setSeason(s)); return () => { live = false; }; }, [r.id]);
  const chosen = (r.stats || []).map((s) => s.key);
  const toggle = (key) => {
    const keys = chosen.includes(key) ? chosen.filter((k) => k !== key) : chosen.length >= MAX_STATS ? chosen : [...chosen, key];
    onStats(statsFor(keys, season));
  };
  const shift = (key, d) => {
    const i = chosen.indexOf(key), j = i + d;
    if (j < 0 || j >= chosen.length) return;
    const keys = [...chosen];
    [keys[i], keys[j]] = [keys[j], keys[i]];
    onStats(keys.map((k) => r.stats.find((s) => s.key === k)));
  };
  return (
    <div style={{ padding: "8px 14px 14px 60px", background: "#fafbfd" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#7a8597", marginBottom: 8 }}>
        Pick up to {MAX_STATS} from his {STATS_SEASON} season (CFBD) — they show on the back of his card on the page (the table under his bio).
      </div>
      {chosen.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {r.stats.map((s, i) => (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#e8f0fa", color: BLUE, borderRadius: 6, padding: "3px 6px", fontSize: 12, fontWeight: 800 }}>
              {i + 1}. {s.label} <b>{s.value || "—"}</b>
              <button type="button" onClick={() => shift(s.key, -1)} style={{ border: "none", background: "none", cursor: "pointer", color: BLUE, padding: 0 }}>◀</button>
              <button type="button" onClick={() => shift(s.key, 1)} style={{ border: "none", background: "none", cursor: "pointer", color: BLUE, padding: 0 }}>▶</button>
            </span>
          ))}
        </div>
      )}
      {season === undefined ? <div style={{ fontSize: 12, color: "#9aa4b2" }}>Loading his season…</div>
        : !season ? <div style={{ fontSize: 12, color: "#9aa4b2", fontWeight: 700 }}>No {STATS_SEASON} season stats linked for him (CFB Universe → link his CFBD player).</div>
          : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
              {seasonKeys(season).map(([cat, ks]) => (
                <div key={cat}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{STAT_CATEGORY_NAMES[cat]}</div>
                  {ks.map((s) => {
                    const key = `${cat}.${s}`;
                    const on = chosen.includes(key);
                    return (
                      <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: INK, cursor: "pointer", opacity: !on && chosen.length >= MAX_STATS ? 0.4 : 1 }}>
                        <input type="checkbox" checked={on} onChange={() => toggle(key)} disabled={!on && chosen.length >= MAX_STATS} />
                        {STAT_LABELS[cat][s]} <span style={{ color: "#7a8597", marginLeft: "auto" }}>{statValue(season, key)}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
    </div>
  );
}

function Suggestions({ s, year, onAdd, onClose, has }) {
  return (
    <div style={{ ...card, border: `2px solid ${BLUE}` }}>
      <div style={{ background: BLUE, padding: "9px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <b style={{ color: GOLD, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>Suggested {year} risers</b>
        <span style={{ color: "#cfe0f5", fontSize: 11, fontWeight: 700 }}>PFF grades · page-view momentum (same scan as Trends)</span>
        <button type="button" onClick={onClose} style={{ ...btn("#fff"), background: "transparent", color: "#fff", marginLeft: "auto" }}>Close</button>
      </div>
      <div style={{ padding: "6px 14px", fontSize: 11, fontWeight: 700, color: RED, background: "#fff6f4" }}>
        PFF numbers are for us only — never put them in a riser's stats or note.
      </div>
      {s.error ? <div style={{ padding: 14, color: RED, fontWeight: 700 }}>{s.error}</div> : (
        <>
          <div style={{ padding: "6px 14px", fontSize: 11, fontWeight: 700, color: "#9aa4b2" }}>{s.total} heating up of {s.scanned} {year} prospects with PFF grades · top {s.rows.length}</div>
          {!s.rows.length && <div style={{ padding: 14, color: "#9aa4b2", fontWeight: 700, fontSize: 13 }}>Nobody new is heating up in this class right now.</div>}
          {s.rows.map((c) => {
            const sug = TREND_TO_RISER[c.label];
            return (
              <div key={c.p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderTop: "1px solid #f0f0f0", flexWrap: "wrap" }}>
                <span style={{ width: 30, textAlign: "center", fontWeight: 900, fontSize: 17, color: BLUE }}>{c.score}</span>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <a href={`/player/${c.p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, color: INK, textDecoration: "none" }}>{c.p.First} {c.p.Last}</a>
                  <span style={{ fontSize: 11, color: "#666", fontWeight: 700 }}> · {c.p.Position} · {c.p.School}</span>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#3b4756", marginTop: 2 }}>
                    Recent {c.recentAvg.toFixed(1)} vs season {c.rec.g} ({c.delta >= 0 ? "+" : ""}{c.delta.toFixed(1)}) · {pffLine(c.rec)}{c.v7 > 0 ? ` · ${c.v7.toLocaleString()} views in 7d` : ""}
                  </div>
                </span>
                {RISER_TYPE_KEYS.map((k) => (
                  <button key={k} type="button" disabled={has(c.p.id)} onClick={() => onAdd(c.p, k)} style={{ ...btn(RISER_TYPES[k].ink, k === sug), opacity: has(c.p.id) ? 0.35 : 1 }}>
                    {RISER_TYPES[k].emoji} {RISER_TYPES[k].label}
                  </button>
                ))}
              </div>
            );
          })}
          {s.cooling.length > 0 && (
            <>
              <div style={{ padding: "7px 14px", fontSize: 11, fontWeight: 900, color: "#7a8597", textTransform: "uppercase", letterSpacing: "0.06em", borderTop: "2px solid #eee", background: "#f5f7fa" }}>
                Cooling off — on the board now
              </div>
              {s.cooling.map((c) => (
                <div key={c.p.id} style={{ padding: "7px 14px", borderTop: "1px solid #f0f0f0", fontSize: 12, fontWeight: 700, color: "#3b4756" }}>
                  <b style={{ color: INK }}>{c.p.First} {c.p.Last}</b> · recent {c.recentAvg.toFixed(1)} vs season {c.rec.g} ({c.delta.toFixed(1)}) — consider moving him down or off.
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
