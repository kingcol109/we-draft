// src/components/AdminSeniorBowlPerf.jsx
//
// Admin → Content → Senior Bowl: the Senior Bowl Top Performers list
// (/events/senior-bowl/{year}/performances — utils/seniorBowlPerf.js), WX
// content like Admin → Content → Rising Page (AdminRisers.jsx, the model).
// One ranked list per year: add players (the Senior Bowl roster from Admin →
// Events first — their team comes with them — then anyone in the class),
// rank them, tag the days each stood out (Day 1–3, Game), write why, pick
// the shot his graphic uses (Preview). Save writes seniorBowlPerf/{year}
// and publishes it as today's edition (seniorBowlPerfEditions/{year}_{date};
// a second Save the same day replaces it) — each edition is a news item.
//
// Graphic: a performer gets one when he has an action shot placed for the
// First Pick graphic (Admin → Content → Photos).
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, setDoc, serverTimestamp, where } from "firebase/firestore";
import { db } from "../firebase";
import { drawPerf } from "./SeniorBowlPerfGraphic";
import { placedShots } from "./RiserGraphic";
import {
  SBP_YEARS, SBP_DOC, SBP_EDITIONS, SBP_TEAMS, SBP_DAYS, SBP_THEME, perfRanked, perfShot, performancesPath,
  perfEditionId, perfEditionDate, perfEditionLabel,
} from "../utils/seniorBowlPerf";

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
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default function AdminSeniorBowlPerf() {
  const [year, setYear] = useState(SBP_YEARS[0]);
  const [players, setPlayers] = useState(null); // the class's players docs
  const [roster, setRoster] = useState({}); // events/{year}.seniorBowl.p — { [id]: { name, team, … } }
  const [list, setList] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState({});
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    setPlayers(null); setRoster({}); setList(null); setDirty(false); setMsg("");
    getDocs(query(collection(db, "players"), where("Eligible", "in", [year, Number(year)])))
      .then((snap) => live && setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => (p.First || p.Last) && p.Slug)))
      .catch((e) => { console.error("Senior Bowl players load error:", e); if (live) setPlayers([]); });
    getDoc(doc(db, "events", year)).then((s) => live && setRoster((s.exists() && s.data().seniorBowl?.p) || {})).catch(() => {});
    getDoc(doc(db, SBP_DOC, year)).then((s) => live && setList(s.exists() ? s.data().players || [] : []))
      .catch((e) => { console.error("Senior Bowl list load error:", e); if (live) setList([]); });
    return () => { live = false; };
  }, [year]);

  const idsKey = (list || []).map((r) => r.id).sort().join(",");
  useEffect(() => {
    const missing = (list || []).map((r) => r.id).filter((id) => !(id in photos));
    if (!missing.length) return;
    Promise.all(missing.map((id) => getDoc(doc(db, "playerPhotos", id)).then((s) => [id, s.exists() ? s.data() : null]).catch(() => [id, null])))
      .then((pairs) => setPhotos((p) => ({ ...p, ...Object.fromEntries(pairs) })));
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map((players || []).map((p) => [p.id, p])), [players]);
  const ranked = perfRanked(list || []);
  const has = (id) => (list || []).some((r) => r.id === id);
  const change = (fn) => { setList((l) => fn(l || [])); setDirty(true); setMsg(""); };
  const renumber = (l) => l.map((r, i) => ({ ...r, order: i }));

  function add(p) {
    if (has(p.id)) return;
    const team = roster[p.id]?.team || "";
    change((l) => renumber([...perfRanked(l), {
      id: p.id, slug: p.Slug, first: p.First || "", last: p.Last || "", pos: p.Position || "", school: p.School || "",
      team: SBP_TEAMS.includes(team) ? team : "", days: [], note: "", order: 1e9, addedAt: Date.now(),
    }]));
  }
  const remove = (id) => change((l) => renumber(perfRanked(l.filter((r) => r.id !== id))));
  const moveTo = (id, to) => change((l) => {
    const all = perfRanked(l);
    const i = all.findIndex((x) => x.id === id);
    const j = Math.max(0, Math.min(all.length - 1, to - 1));
    if (i < 0 || i === j) return l;
    const [r] = all.splice(i, 1);
    all.splice(j, 0, r);
    return renumber(all);
  });
  const patch = (id, fields) => change((l) => l.map((r) => (r.id === id ? { ...r, ...fields } : r)));
  const toggleDay = (r, key) => {
    const days = (r.days || []).includes(key) ? r.days.filter((d) => d !== key) : [...(r.days || []), key];
    patch(r.id, { days: SBP_DAYS.map((d) => d.key).filter((k) => days.includes(k)) });
  };

  async function save() {
    setBusy(true); setMsg("");
    try {
      const missing = (list || []).map((r) => r.id).filter((id) => photos[id] === undefined);
      const fetched = Object.fromEntries(await Promise.all(missing.map((id) => getDoc(doc(db, "playerPhotos", id)).then((d) => [id, d.exists() ? d.data() : null]).catch(() => [id, null]))));
      const allPhotos = { ...photos, ...fetched };
      // Fresh name / position / school from each players doc; his graphic's
      // shot locked in (the one picked in Preview, else his first placed one).
      const out = renumber(perfRanked(list || [])).map((r) => {
        const p = byId.get(r.id);
        const shot = perfShot(r, placedShots(allPhotos[r.id]))?.url || "";
        const base = p ? { ...r, slug: p.Slug || r.slug, first: p.First || "", last: p.Last || "", pos: p.Position || "", school: p.School || "" } : r;
        return { ...base, shot };
      });
      await setDoc(doc(db, SBP_DOC, year), { players: out, updatedAt: serverTimestamp() });
      const date = perfEditionDate();
      await setDoc(doc(db, SBP_EDITIONS, perfEditionId(year, date)), { year, date, publishedAt: serverTimestamp(), players: out });
      setList(out); setDirty(false);
      if (missing.length) setPhotos((ph) => ({ ...ph, ...fetched }));
      setMsg(`Saved — ${out.length} performer${out.length === 1 ? "" : "s"} live, published as the ${perfEditionLabel(date, { month: "short", day: "numeric" })} edition.`);
    } catch (e) {
      console.error("Senior Bowl save error:", e);
      setMsg(`Couldn't save: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function showPreview(r, shotUrl) {
    const shots = placedShots(photos[r.id]);
    const perf = shotUrl ? { ...r, shot: shotUrl } : r;
    if (shotUrl && shotUrl !== r.shot) patch(r.id, { shot: shotUrl });
    const shot = perfShot(perf, shots);
    setPreview({ id: r.id, name: `${r.first} ${r.last}`, src: "", shots, shot: shot?.url || "" });
    const src = await drawPerf({ perf, year, shots, shot }).catch(() => "");
    setPreview((pv) => (pv?.id === r.id ? { ...pv, src, failed: !src } : pv));
  }

  // Search: the Senior Bowl roster first, then the rest of the class.
  const q = norm(search);
  const matches = useMemo(() => {
    if (q.length < 2 || !players) return [];
    const hit = players.filter((p) => norm(`${p.First} ${p.Last} ${p.School}`).includes(q));
    return [...hit.filter((p) => roster[p.id]), ...hit.filter((p) => !roster[p.id])].slice(0, 10);
  }, [q, players, roster]);
  const rosterCount = Object.keys(roster).length;

  return (
    <div style={{ display: "grid", gap: 14, fontFamily: "Arial, sans-serif" }}>
      <div style={{ ...card, padding: "12px 14px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900, color: INK, fontSize: 15, marginRight: 6 }}>Senior Bowl Top Performers</div>
        {SBP_YEARS.map((y) => <button key={y} type="button" onClick={() => { if (!dirty || window.confirm("Discard unsaved changes?")) setYear(y); }} style={btn(BLUE, y === year)}>{y}</button>)}
        <a href={performancesPath(year)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 800, color: BLUE, marginLeft: 6 }}>View page ↗</a>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {msg && <span style={{ fontSize: 12, fontWeight: 800, color: msg.startsWith("Couldn't") ? RED : "#15803d" }}>{msg}</span>}
          <button type="button" onClick={save} disabled={busy || !dirty} style={{ ...btn(GOLD, true), opacity: busy || !dirty ? 0.5 : 1 }}>{busy ? "Working…" : dirty ? "Save & publish" : "Saved"}</button>
        </span>
      </div>

      <div style={{ ...card, padding: "12px 14px" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Add a performer — search the ${year} Senior Bowl roster${rosterCount ? ` (${rosterCount})` : ""} and class`} style={{ ...input, width: "100%" }} />
        {!rosterCount && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: "#9aa4b2" }}>No {year} Senior Bowl roster yet (Admin → Events) — search covers the whole class; set each player's team here.</div>}
        {matches.length > 0 && (
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {matches.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <b style={{ color: INK }}>{p.First} {p.Last}</b><span style={{ color: "#7a8597" }}>{p.Position} · {p.School}</span>
                {roster[p.id] && <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", background: SBP_THEME[roster[p.id].team] || SBP_THEME.red, borderRadius: 999, padding: "2px 7px" }}>{roster[p.id].team || "Roster"}</span>}
                <button type="button" disabled={has(p.id)} onClick={() => { add(p); setSearch(""); }} style={{ ...btn(SBP_THEME.ink), marginLeft: "auto", opacity: has(p.id) ? 0.4 : 1 }}>
                  {has(p.id) ? "On the list" : "+ Add"}
                </button>
              </div>
            ))}
          </div>
        )}
        {q.length >= 2 && players && !matches.length && <div style={{ marginTop: 8, fontSize: 12, color: "#9aa4b2", fontWeight: 700 }}>No {year} prospects match.</div>}
      </div>

      {list === null ? <div style={{ padding: 20, color: "#9aa4b2", fontWeight: 800 }}>Loading…</div> : (
        <div style={card}>
          <div style={{ padding: "10px 14px", background: SBP_THEME.deep, color: "#fff", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: `3px solid ${SBP_THEME.red}` }}>
            <b style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>The {year} list</b>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#b9b9b9" }}>{ranked.length} player{ranked.length === 1 ? "" : "s"} · type a rank or use the arrows · tag the days he stood out</span>
          </div>
          {!ranked.length && <div style={{ padding: 14, fontSize: 13, color: "#9aa4b2", fontWeight: 700 }}>Nobody yet — add a performer above.</div>}
          {ranked.map((r, i) => (
            <PerfRow key={r.id} r={r} rank={i + 1} count={ranked.length} photos={photos[r.id]} player={byId.get(r.id)}
              onMoveTo={(to) => moveTo(r.id, to)} onTeam={(team) => patch(r.id, { team })} onDay={(k) => toggleDay(r, k)}
              onNote={(note) => patch(r.id, { note, noteUpdatedAt: Date.now() })} onPreview={() => showPreview(r)}
              onRemove={() => { if (window.confirm(`Take ${r.first} ${r.last} off the list?`)) remove(r.id); }} />
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
            <div style={{ fontSize: 11, color: "#7a8597", fontWeight: 700, marginTop: 8 }}>Save locks in his shot — the page's image updates once you Save.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PerfRow({ r, rank, count, photos, player, onMoveTo, onTeam, onDay, onNote, onPreview, onRemove }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const shots = placedShots(photos);
  const head = photos?.headshot?.url;
  const moved = player && (player.School !== r.school || player.Position !== r.pos || player.First !== r.first || player.Last !== r.last);
  const [rankText, setRankText] = useState(String(rank));
  useEffect(() => setRankText(String(rank)), [rank]);
  const commitRank = () => { const n = parseInt(rankText, 10); if (Number.isFinite(n) && n !== rank) onMoveTo(n); else setRankText(String(rank)); };
  const arrow = (dis) => ({ ...btn("#7a8597"), padding: "0 6px", fontSize: 10, opacity: dis ? 0.3 : 1 });
  const teamColor = SBP_THEME[r.team] || "#9aa4b2";
  return (
    <div style={{ borderTop: "1px solid #eef1f5", borderLeft: `5px solid ${teamColor}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px 9px 9px", flexWrap: "wrap" }}>
        <input value={rankText} onChange={(e) => setRankText(e.target.value.replace(/\D/g, ""))} onBlur={commitRank} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label="Rank" style={{ ...input, width: 44, textAlign: "center", fontWeight: 900, fontSize: 17, color: INK, padding: "4px 2px" }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button type="button" disabled={rank === 1} onClick={() => onMoveTo(rank - 1)} style={arrow(rank === 1)}>▲</button>
          <button type="button" disabled={rank === count} onClick={() => onMoveTo(rank + 1)} style={arrow(rank === count)}>▼</button>
        </span>
        <span style={{ width: 38, height: 38, borderRadius: "50%", overflow: "hidden", background: "#f1f4f8", flexShrink: 0, boxShadow: `0 0 0 2px ${teamColor}` }}>
          {head && <img src={head} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />}
        </span>
        <span style={{ minWidth: 160, flex: 1 }}>
          <a href={`/player/${r.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 900, color: INK, textDecoration: "none", fontSize: 14 }}>{r.first} {r.last}</a>
          <span style={{ fontSize: 12, color: "#7a8597", fontWeight: 700 }}> · {r.pos} · {r.school}</span>
          {moved && <span style={{ fontSize: 10, color: GOLD, fontWeight: 900 }}> · profile changed, Save to update</span>}
          {r.note && !noteOpen && <div style={{ fontSize: 11, fontWeight: 600, color: "#3b4756", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 520 }}>📝 {r.note}</div>}
        </span>
        {/* Team */}
        <select value={r.team || ""} onChange={(e) => onTeam(e.target.value)} style={{ ...input, padding: "5px 6px", fontWeight: 800, color: r.team ? teamColor : "#9aa4b2" }}>
          <option value="">Team?</option>
          {SBP_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {/* Days he stood out */}
        <span style={{ display: "inline-flex", border: "1px solid #d5dbe4", borderRadius: 8, overflow: "hidden" }}>
          {SBP_DAYS.map((d) => {
            const on = (r.days || []).includes(d.key);
            return (
              <button key={d.key} type="button" onClick={() => onDay(d.key)} title={d.long} style={{
                border: "none", padding: "5px 8px", fontSize: 11, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap",
                background: on ? SBP_THEME.red : "#fff", color: on ? "#fff" : "#7a8597",
              }}>{d.label}</button>
            );
          })}
        </span>
        <span title={shots.length ? `${shots.length} placed action shot${shots.length === 1 ? "" : "s"}` : "Place an action shot for First Pick in Content → Photos to give him a graphic"}
          style={{ fontSize: 11, fontWeight: 900, color: shots.length ? "#15803d" : "#9aa4b2" }}>
          {photos === undefined ? "…" : shots.length ? "✓ Graphic" : "No graphic"}
        </span>
        {shots.length > 0 && <button type="button" onClick={onPreview} style={btn(BLUE)}>Preview</button>}
        <button type="button" onClick={() => setNoteOpen(!noteOpen)} style={btn(BLUE, noteOpen)}>{r.note ? "Edit note" : "Add note"}</button>
        <button type="button" onClick={onRemove} style={btn(RED)}>Remove</button>
      </div>
      {noteOpen && (
        <div style={{ padding: "8px 14px 14px 60px", background: "#fafbfd" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#7a8597", marginBottom: 6 }}>
            What he showed in Mobile — shows in his row on the page. Leave a blank line between paragraphs. Public — no PFF numbers.
          </div>
          <textarea value={r.note || ""} onChange={(e) => onNote(e.target.value)} rows={5} placeholder={`What ${r.first} ${r.last} did this week…`}
            style={{ ...input, width: "100%", resize: "vertical", lineHeight: 1.5, fontSize: 14 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 11, color: "#9aa4b2", fontWeight: 700 }}>{(r.note || "").trim().split(/\s+/).filter(Boolean).length} words · Save at the top to publish</span>
            <button type="button" onClick={() => setNoteOpen(false)} style={{ ...btn(BLUE), marginLeft: "auto" }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
