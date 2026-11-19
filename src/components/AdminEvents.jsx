// src/components/AdminEvents.jsx
//
// Admin → Events: who takes part in each draft-season event, Combine
// results, all-star teams and the pro day schedule — events/{year}
// (utils/events.js), shown on /events/{event}/{year} and on each player's
// Career Path.
//   Add players from the class (players with Eligible = year): search, or
//   paste a list (one name per line, "Name, School" to be sure). Anyone
//   who isn't a We-Draft player can be added by hand.
//   Combine: each result saves as you leave its box.
//   Senior Bowl / East-West: each player's team.
//   Pro Days: schools + dates, then each player's pro day.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, FieldPath, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { portalTeamSlug } from "../utils/portalTeams";
import { STAT_METRICS } from "../utils/historicalStats";
import { EVENT_PAGES, EVENT_YEARS, EVENT_POSITIONS, CURRENT_EVENT_YEAR, eventPath, proDaySchedule, participantsOf, forgetEventYear } from "../utils/events";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const field = { padding: "6px 9px", border: "1px solid #d5dce6", borderRadius: "6px", fontSize: "13px", fontWeight: 700, boxSizing: "border-box" };
const small = { ...field, padding: "4px 6px", fontSize: "12px" };
const btn = (primary, color = BLUE) => ({ border: primary ? "none" : "1px solid #d5dce6", borderRadius: 999, padding: "6px 14px", fontWeight: 900, fontSize: 12, background: primary ? color : "#fff", color: primary ? "#fff" : "#33415a", cursor: "pointer" });
const RESULT_KEYS = ["height", "weight", "arm", "hand", "forty", "vertical", "broad", "bench", "threeCone", "shuttle"];
const RESULT_LABEL = Object.fromEntries(STAT_METRICS.map((m) => [m.key, m.label]));
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const fullName = (p) => `${p.First || ""} ${p.Last || ""}`.trim();

export default function AdminEvents() {
  const [year, setYear] = useState(CURRENT_EVENT_YEAR);
  const [slug, setSlug] = useState("combine");
  const [data, setData] = useState(null);
  const [players, setPlayers] = useState(null);
  const [schools, setSchools] = useState([]);
  const ev = EVENT_PAGES[slug];
  const ref = doc(db, "events", String(year));

  useEffect(() => {
    setData(null);
    setPlayers(null);
    getDoc(doc(db, "events", String(year))).then((s) => setData(s.exists() ? s.data() : {})).catch((e) => { console.error(e); setData({}); });
    getDocs(query(collection(db, "players"), where("Eligible", "==", String(year))))
      .then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First || p.Last)))
      .catch((e) => { console.error(e); setPlayers([]); });
  }, [year]);
  useEffect(() => {
    getSiteSnapshot("_cfbTeams").then((s) => setSchools(Object.values(s?.teams || {}).map((t) => t.School).filter(Boolean).sort())).catch(() => {});
  }, []);

  // Writes: merged into the doc, then the same change made locally.
  const merge = async (patch, local) => {
    await setDoc(ref, patch, { merge: true });
    forgetEventYear(year);
    setData(local);
  };
  const deepMerge = (a, b) => {
    const out = { ...(a || {}) };
    Object.entries(b).forEach(([k, v]) => { out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(out[k], v) : v; });
    return out;
  };
  const save = (patch) => merge(patch, deepMerge(data, patch)).catch((e) => alert(`Couldn't save: ${e.message || e}`));
  const removeAt = async (path) => {
    try {
      await updateDoc(ref, new FieldPath(...path), deleteField());
      forgetEventYear(year);
      setData((d) => {
        const copy = JSON.parse(JSON.stringify(d));
        let o = copy;
        path.slice(0, -1).forEach((k) => { o = o?.[k]; });
        if (o) delete o[path[path.length - 1]];
        return copy;
      });
    } catch (e) { alert(`Couldn't remove: ${e.message || e}`); }
  };

  const people = useMemo(() => participantsOf(data, slug), [data, slug]);
  const schedule = useMemo(() => proDaySchedule(data), [data]);
  const addPlayer = (p, extra = {}) => {
    const entry = { name: fullName(p), position: p.Position || "", school: p.School || "", slug: p.Slug || "", playerId: p.id, ...extra };
    if (slug === "pro-days" && !entry.day) {
      const k = portalTeamSlug(p.School);
      if (data?.proDays?.s?.[k]) entry.day = k;
    }
    return save({ [ev.key]: { p: { [p.id]: entry } } });
  };

  if (!data || !players) return <div style={{ padding: 20, fontWeight: 800, color: "#7a8597" }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select style={field} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {EVENT_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {Object.values(EVENT_PAGES).map((e) => (
          <button key={e.slug} type="button" onClick={() => setSlug(e.slug)} style={{
            padding: "8px 16px", fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", borderRadius: 8, cursor: "pointer",
            border: `2px solid ${e.color}`, background: slug === e.slug ? e.color : "#fff", color: slug === e.slug ? "#fff" : e.color,
          }}>{e.short}</button>
        ))}
        <a href={eventPath(slug, year)} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 900, color: BLUE }}>View page ↗</a>
      </div>

      {slug === "pro-days" && <ProDaySchools schedule={schedule} schools={schools} people={people} onSave={save} onRemove={(k) => removeAt(["proDays", "s", k])} />}

      <AddPlayers ev={ev} players={players} people={people} onAdd={addPlayer} onManual={(entry) => save({ [ev.key]: { p: { [`m-${slugify(entry.name)}-${slugify(entry.school)}`]: entry } } })} />

      <ParticipantTable ev={ev} people={people} schedule={schedule}
        onPatch={(id, patch) => save({ [ev.key]: { p: { [id]: patch } } })}
        onRemove={(id) => removeAt([ev.key, "p", id])} />
    </div>
  );
}

const card = { background: "#fff", border: "1px solid #e2e7ef", borderRadius: 10, padding: "14px 16px" };
const h = (t, sub) => (
  <div style={{ marginBottom: 10 }}>
    <div style={{ fontSize: 14, fontWeight: 900, color: BLUE, textTransform: "uppercase" }}>{t}</div>
    {sub && <div style={{ fontSize: 12, fontWeight: 600, color: "#5a6475", marginTop: 2 }}>{sub}</div>}
  </div>
);

// ── Pro day schools + dates ──
function ProDaySchools({ schedule, schools, people, onSave, onRemove }) {
  const [school, setSchool] = useState("");
  const [date, setDate] = useState("");
  const add = () => {
    if (!school.trim() || !date) return;
    onSave({ proDays: { s: { [portalTeamSlug(school.trim())]: { school: school.trim(), date } } } });
    setSchool("");
  };
  return (
    <div style={card}>
      {h("Pro Day Schedule", "Each school's pro day. Its badge comes from Branding → Pro Day.")}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input style={{ ...field, flex: "1 1 200px" }} list="pd-schools" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="School" />
        <datalist id="pd-schools">{schools.map((s) => <option key={s} value={s} />)}</datalist>
        <input style={field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" style={btn(true, "#1e8449")} onClick={add}>Add pro day</button>
      </div>
      {schedule.length === 0 ? <div style={{ fontSize: 12, fontWeight: 700, color: "#8a94a6" }}>None yet.</div> : (
        <div style={{ display: "grid", gap: 4 }}>
          {schedule.map((d) => (
            <div key={d.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800 }}>
              <span style={{ flex: 1 }}>{d.school}</span>
              <span style={{ fontSize: 11, color: "#8a94a6" }}>{people.filter((p) => p.day === d.key).length} players</span>
              <input style={small} type="date" value={d.date} onChange={(e) => e.target.value && onSave({ proDays: { s: { [d.key]: { school: d.school, date: e.target.value } } } })} />
              <button type="button" style={{ ...btn(false), padding: "3px 10px" }} onClick={() => window.confirm(`Remove ${d.school}'s pro day?`) && onRemove(d.key)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Adding participants ──
function AddPlayers({ ev, players, people, onAdd, onManual }) {
  const [q, setQ] = useState("");
  const [bulk, setBulk] = useState("");
  const [report, setReport] = useState(null);
  const [manual, setManual] = useState({ name: "", position: "", school: "" });
  const added = new Set(people.map((p) => p.id));
  const matches = useMemo(() => {
    const t = norm(q);
    if (t.length < 2) return [];
    return players.filter((p) => norm(fullName(p)).includes(t) || norm(`${fullName(p)}${p.School}`).includes(t)).slice(0, 12);
  }, [q, players]);

  // One per line: "Name" or "Name, School". A name that matches more than
  // one player (and no school to settle it) is reported, not guessed.
  const addBulk = async () => {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    const unmatched = [], ambiguous = [];
    let n = 0;
    for (const line of lines) {
      const [name, school] = line.split(",").map((x) => x.trim());
      let hits = players.filter((p) => norm(fullName(p)) === norm(name));
      if (school) hits = hits.filter((p) => norm(p.School) === norm(school));
      if (hits.length === 1) {
        if (!added.has(hits[0].id)) { await onAdd(hits[0]); n++; }
      } else if (hits.length > 1) ambiguous.push(line);
      else unmatched.push(line);
    }
    setReport({ n, unmatched, ambiguous });
    setBulk([...unmatched, ...ambiguous].join("\n"));
  };

  return (
    <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
      <div>
        {h(`Add to the ${ev.short}`, `Search the ${players.length} players in the class.`)}
        <input style={{ ...field, width: "100%" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or school" />
        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
          {matches.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800 }}>
              <span style={{ flex: 1 }}>{fullName(p)} <span style={{ color: "#8a94a6", fontWeight: 700 }}>· {p.Position} · {p.School}</span></span>
              {added.has(p.id) ? <span style={{ fontSize: 11, color: "#15803d" }}>✓ Added</span>
                : <button type="button" style={{ ...btn(true), padding: "3px 10px" }} onClick={() => onAdd(p)}>Add</button>}
            </div>
          ))}
        </div>
      </div>
      <div>
        {h("Paste a list", "One per line — \"Name\" or \"Name, School\".")}
        <textarea style={{ ...field, width: "100%", minHeight: 90, fontFamily: "inherit" }} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Jeremiah Smith, Ohio State\nLeonard Moore"} />
        <button type="button" style={{ ...btn(true), marginTop: 6 }} onClick={addBulk} disabled={!bulk.trim()}>Add list</button>
        {report && (
          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#5a6475" }}>
            Added {report.n}.{report.unmatched.length ? ` Not found: ${report.unmatched.length}.` : ""}{report.ambiguous.length ? ` More than one match (add the school): ${report.ambiguous.length}.` : ""}
            {report.unmatched.length + report.ambiguous.length > 0 && " They're left in the box."}
          </div>
        )}
      </div>
      <div>
        {h("Add by hand", "Someone who isn't a We-Draft player.")}
        <div style={{ display: "grid", gap: 6 }}>
          <input style={field} value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Full name" />
          <div style={{ display: "flex", gap: 6 }}>
            <select style={{ ...field, flex: "0 0 90px" }} value={manual.position} onChange={(e) => setManual({ ...manual, position: e.target.value })}>
              <option value="">Pos</option>
              {EVENT_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input style={{ ...field, flex: 1 }} value={manual.school} onChange={(e) => setManual({ ...manual, school: e.target.value })} placeholder="School" />
          </div>
          <button type="button" style={btn(true)} disabled={!manual.name.trim()} onClick={() => { onManual({ name: manual.name.trim(), position: manual.position, school: manual.school.trim(), slug: "", playerId: "" }); setManual({ name: "", position: "", school: "" }); }}>Add</button>
        </div>
      </div>
    </div>
  );
}

// ── The list: team / pro day / results per player ──
function ParticipantTable({ ev, people, schedule, onPatch, onRemove }) {
  const [pos, setPos] = useState("");
  const shown = pos ? people.filter((p) => p.position === pos) : people;
  return (
    <div style={card}>
      {h(`${ev.short} — ${people.length} ${people.length === 1 ? "player" : "players"}`, ev.slug === "combine" ? "Results save as you leave each box (40: 4.42 · Vert: 38.5 · Broad: 10'4\" or 124 · Height: 6'2 3/8\" · Arm/Hand: 32 1/2)." : null)}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
        {["", ...EVENT_POSITIONS].map((p) => (
          <button key={p || "all"} type="button" onClick={() => setPos(p)} style={{ ...btn(pos === p), padding: "4px 10px" }}>
            {p || "All"} {p ? people.filter((x) => x.position === p).length || "" : ""}
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f1f4f8", textAlign: "left" }}>
              <th style={{ padding: 6 }}>Player</th>
              <th style={{ padding: 6 }}>Pos</th>
              {ev.teams && <th style={{ padding: 6 }}>Team</th>}
              {ev.slug === "pro-days" && <th style={{ padding: 6 }}>Pro day</th>}
              {ev.results && RESULT_KEYS.map((k) => <th key={k} style={{ padding: 6, whiteSpace: "nowrap" }}>{RESULT_LABEL[k] || k}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #eef1f5" }}>
                <td style={{ padding: 6, fontWeight: 900, whiteSpace: "nowrap" }}>
                  {p.name}<div style={{ fontSize: 11, fontWeight: 700, color: "#8a94a6" }}>{p.school}{!p.playerId ? " · by hand" : ""}</div>
                </td>
                <td style={{ padding: 6 }}>{p.position}</td>
                {ev.teams && (
                  <td style={{ padding: 6 }}>
                    <select style={small} value={p.team || ""} onChange={(e) => onPatch(p.id, { team: e.target.value })}>
                      <option value="">—</option>
                      {ev.teams.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                )}
                {ev.slug === "pro-days" && (
                  <td style={{ padding: 6 }}>
                    <select style={small} value={p.day || ""} onChange={(e) => onPatch(p.id, { day: e.target.value })}>
                      <option value="">TBA</option>
                      {schedule.map((d) => <option key={d.key} value={d.key}>{d.school} · {d.date.slice(5)}</option>)}
                    </select>
                  </td>
                )}
                {ev.results && RESULT_KEYS.map((k) => (
                  <td key={k} style={{ padding: 4 }}>
                    <ResultBox value={p.results?.[k] ?? ""} onSave={(v) => onPatch(p.id, { results: { [k]: v } })} />
                  </td>
                ))}
                <td style={{ padding: 6 }}>
                  <button type="button" style={{ ...btn(false), padding: "2px 8px", fontSize: 11 }} onClick={() => window.confirm(`Remove ${p.name}?`) && onRemove(p.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <div style={{ padding: 10, fontSize: 12, fontWeight: 700, color: "#8a94a6" }}>No one yet.</div>}
      </div>
    </div>
  );
}

function ResultBox({ value, onSave }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  return (
    <input style={{ ...small, width: 64, borderColor: v !== String(value) ? GOLD : "#d5dce6" }} value={v}
      onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== String(value)) onSave(v.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}
