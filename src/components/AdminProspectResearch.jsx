// src/components/AdminProspectResearch.jsx
//
// Admin → Content → Research: prospect research, one sub-tab each.
//   HS Research  how many current prospects (the next three draft classes —
//                2027–2029 now, utils/eligibility.js currentDraftClass) came
//                out of each high school. A player belongs to a school by
//                HighSchool + State, the same pair that links them to the
//                highSchools doc (branding, /hs/ page). Every school, or by
//                state (each state's totals; pick one for its schools).
//                Sortable columns, all classes descending by default; a row
//                opens its players. Also per school: In CFB — every current
//                college player from it on CFBD's rosters (offseason/hsCfb,
//                server/highSchools/alumniIndex.js buildHsCfbCounts, rebuilt by
//                scripts/syncCfbdRosters.js), and Drafted — NFL draft picks
//                (historical, plus this year's class through draftOrder).
// (The NFL research tab is components/AdminResearch.js.)
import { Fragment, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { currentDraftClass } from "../utils/eligibility";
import { stateName } from "../utils/highSchoolMatch";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const TABS = [{ key: "hs", label: "HS Research" }];

const pill = (on, color = BLUE) => ({
  padding: "6px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "20px", cursor: "pointer", background: on ? color : "#fff", color: on ? "#fff" : color,
});

export default function AdminProspectResearch() {
  const [tab, setTab] = useState("hs");
  return (
    <div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", paddingLeft: "12px", borderLeft: `3px solid ${GOLD}` }}>
        {TABS.map((t) => <button key={t.key} type="button" onClick={() => setTab(t.key)} style={pill(tab === t.key, GOLD)}>{t.label}</button>)}
      </div>
      {tab === "hs" && <HsResearch />}
    </div>
  );
}

function HsResearch() {
  const first = Number(currentDraftClass());
  const classes = [first, first + 1, first + 2].map(String);
  const [players, setPlayers] = useState(null);
  const [drafted, setDrafted] = useState([]); // [{ name, state, label }]
  const [cfb, setCfb] = useState({ rows: {}, players: 0 });
  const [hsDocs, setHsDocs] = useState([]);
  const [silhouettes, setSilhouettes] = useState({});
  const [error, setError] = useState("");
  const [view, setView] = useState("schools"); // schools | states
  const [stateFilter, setStateFilter] = useState("");
  const [sort, setSort] = useState({ key: "all", dir: -1 });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(100);

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, "players")), getDocs(collection(db, "highSchools")), getDocs(collection(db, "stateSilhouettes")),
      getDocs(collection(db, "historical")), getDocs(collection(db, "draftOrder")), getDoc(doc(db, "offseason", "hsCfb")).catch(() => null),
    ])
      .then(([p, h, s, hist, order, cfbSnap]) => {
        const all = p.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPlayers(all.filter((x) => classes.includes(String(x.Eligible))));
        // NFL draft picks: historical, plus this year's class (still players docs) via draftOrder.
        const pickBySlug = Object.fromEntries(order.docs.map((d) => d.data()).filter((d) => d.Selection).map((d) => [d.Selection, d]));
        setDrafted([
          ...hist.docs.map((d) => d.data()).filter((x) => x.HighSchool).map((x) => ({ name: x.HighSchool.trim(), state: stateName(x.State), label: `${x.Player} · ${x.Year} Rd ${x.Round} #${x.Pick} · ${x["NFL Team"] || ""}` })),
          ...all.filter((x) => x.HighSchool && pickBySlug[x.Slug]).map((x) => ({ name: x.HighSchool.trim(), state: stateName(x.State), label: `${x.First} ${x.Last} · ${x.Eligible} Rd ${pickBySlug[x.Slug].Round} #${pickBySlug[x.Slug].Pick} · ${pickBySlug[x.Slug].Team}` })),
        ]);
        const c = cfbSnap?.data();
        if (c) setCfb({ rows: c.rows || {}, players: c.players || 0, season: c.season });
        setHsDocs(h.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSilhouettes(Object.fromEntries(s.docs.map((d) => [d.id, d.data().Silhouette])));
      })
      .catch((e) => { console.error("HS research load error:", e); setError("Couldn't load players / high schools — check console."); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hsByKey = useMemo(() => new Map(hsDocs.map((h) => [`${h.Name}|${h.State}`, h])), [hsDocs]);

  // One row per HighSchool + State: prospects per class (and the players),
  // current college players (CFBD), and NFL draft picks.
  const schools = useMemo(() => {
    const m = new Map();
    const row = (name, st) => {
      const k = `${name}|${st}`;
      if (!m.has(k)) m.set(k, { key: k, name, state: st, doc: hsByKey.get(k) || null, all: 0, cfb: 0, drafted: 0, players: [], picks: [], ...Object.fromEntries(classes.map((c) => [c, 0])) });
      return m.get(k);
    };
    (players || []).forEach((p) => {
      const name = (p.HighSchool || "").trim();
      if (!name) return;
      const r = row(name, stateName(p.State));
      r.all += 1; r[String(p.Eligible)] += 1; r.players.push(p);
    });
    Object.entries(cfb.rows).forEach(([k, n]) => { const [name, st] = k.split("|"); row(name, st).cfb += n; });
    drafted.forEach((d) => { const r = row(d.name, d.state); r.drafted += 1; r.picks.push(d); });
    return [...m.values()];
  }, [players, hsByKey, cfb, drafted]); // eslint-disable-line react-hooks/exhaustive-deps

  const states = useMemo(() => {
    const m = new Map();
    schools.forEach((s) => {
      const k = s.state || "—";
      if (!m.has(k)) m.set(k, { key: k, name: k, schools: 0, all: 0, cfb: 0, drafted: 0, ...Object.fromEntries(classes.map((c) => [c, 0])) });
      const r = m.get(k);
      r.schools += 1; r.all += s.all; r.cfb += s.cfb; r.drafted += s.drafted; classes.forEach((c) => { r[c] += s[c]; });
    });
    return [...m.values()];
  }, [schools]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorter = (a, b) => {
    const v = (x) => (sort.key === "name" ? x.name : x[sort.key] ?? 0);
    const d = sort.key === "name" ? String(v(a)).localeCompare(String(v(b))) : v(a) - v(b);
    return d * sort.dir || b.all - a.all || a.name.localeCompare(b.name);
  };
  const needle = q.trim().toLowerCase();
  const schoolRows = schools
    .filter((s) => !stateFilter || s.state === stateFilter)
    .filter((s) => !needle || `${s.name} ${s.state} ${s.doc?.City || ""}`.toLowerCase().includes(needle))
    .sort(sorter);
  const stateRows = states.filter((s) => !needle || s.name.toLowerCase().includes(needle)).sort(sorter);
  const missing = (players || []).filter((p) => !(p.HighSchool || "").trim()).length;

  const setSortKey = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" ? 1 : -1 }));
  const th = (key, label, align = "right") => (
    <button type="button" onClick={() => setSortKey(key)}
      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: sort.key === key ? BLUE : "#888", textAlign: align, width: "100%" }}>
      {label}{sort.key === key ? (sort.dir < 0 ? " ▼" : " ▲") : ""}
    </button>
  );
  const isStates = view === "states" && !stateFilter;
  const COLS = isStates ? "44px minmax(200px, 1fr) 80px 90px repeat(3, 70px) 80px 80px" : "44px 40px minmax(220px, 1fr) 90px repeat(3, 70px) 80px 80px";
  const head = { display: "grid", gridTemplateColumns: COLS, gap: "10px", padding: "8px 12px", fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "2px solid #e3e7ee", position: "sticky", top: 0, background: "#fff", zIndex: 1 };
  const cell = { display: "grid", gridTemplateColumns: COLS, gap: "10px", alignItems: "center", padding: "7px 12px", fontSize: "13px", borderBottom: "1px solid #f0f0f0" };
  const num = (n, strong) => <span style={{ textAlign: "right", fontWeight: strong ? 900 : 700, color: n ? (strong ? "#1d2733" : "#555") : "#ccc", fontVariantNumeric: "tabular-nums", fontSize: strong ? "15px" : "13px" }}>{n}</span>;
  const logoOf = (s) => s.doc?.Logo1 || silhouettes[s.state] || null;

  if (error) return <div style={{ color: "#c0392b", fontWeight: 800 }}>{error}</div>;
  if (!players) return <div style={{ color: "#999", fontWeight: 700 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
        <button type="button" onClick={() => { setView("schools"); setStateFilter(""); setShown(100); }} style={pill(view === "schools" && !stateFilter)}>All Schools</button>
        <button type="button" onClick={() => { setView("states"); setStateFilter(""); setShown(100); }} style={pill(view === "states" || !!stateFilter)}>By State</button>
        {stateFilter && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 900, color: "#1d2733" }}>
            → {stateFilter}
            <button type="button" onClick={() => setStateFilter("")} style={{ ...pill(false, "#888"), padding: "2px 8px" }}>✕</button>
          </span>
        )}
        <input value={q} onChange={(e) => { setQ(e.target.value); setShown(100); }} placeholder={isStates ? "Search states…" : "Search schools, cities…"}
          style={{ flex: "1 1 200px", maxWidth: "300px", border: "2px solid #d6dce5", borderRadius: "8px", padding: "6px 10px", fontWeight: 700 }} />
        <span style={{ fontSize: "12px", fontWeight: 800, color: "#888" }}>
          {players.length} prospects ({classes[0]}–{classes[2]}) · {cfb.players.toLocaleString()} college players{cfb.season ? ` (${cfb.season} CFBD rosters)` : ""} · {drafted.length.toLocaleString()} draft picks · {schools.length.toLocaleString()} schools{missing ? ` · ${missing} prospects with no high school` : ""}
        </span>
      </div>

      <div style={{ border: "1px solid #e3e7ee", borderRadius: "8px", background: "#fff", overflowX: "auto", maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ minWidth: "820px" }}>
          {isStates ? (
            <>
              <div style={head}><span>#</span>{th("name", "State", "left")}{th("schools", "Schools")}{th("all", `${classes[0]}–${classes[2]}`)}{classes.map((c) => <Fragment key={c}>{th(c, c)}</Fragment>)}{th("cfb", "In CFB")}{th("drafted", "Drafted")}</div>
              {stateRows.map((s, i) => (
                <div key={s.key} onClick={() => { setStateFilter(s.name); setShown(100); }} style={{ ...cell, cursor: "pointer", background: i % 2 ? "#fafbfc" : "#fff" }} title={`Show ${s.name}'s schools`}>
                  <span style={{ color: "#999", fontWeight: 800 }}>{i + 1}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 900, color: BLUE }}>
                    {silhouettes[s.name] && <img src={silhouettes[s.name]} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />}
                    {s.name}
                  </span>
                  {num(s.schools)}{num(s.all, true)}{classes.map((c) => <Fragment key={c}>{num(s[c])}</Fragment>)}{num(s.cfb)}{num(s.drafted)}
                </div>
              ))}
            </>
          ) : (
            <>
              <div style={head}><span>#</span><span />{th("name", "School", "left")}{th("all", `${classes[0]}–${classes[2]}`)}{classes.map((c) => <Fragment key={c}>{th(c, c)}</Fragment>)}{th("cfb", "In CFB")}{th("drafted", "Drafted")}</div>
              {schoolRows.slice(0, shown).map((s, i) => (
                <Fragment key={s.key}>
                  <div onClick={() => setOpen(open === s.key ? null : s.key)} style={{ ...cell, cursor: "pointer", background: open === s.key ? "#fff8ec" : i % 2 ? "#fafbfc" : "#fff" }}>
                    <span style={{ color: "#999", fontWeight: 800 }}>{i + 1}</span>
                    <span style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid #e6ebf2", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fff" }}>
                      {logoOf(s) ? <img src={logoOf(s)} alt="" style={{ width: "76%", height: "76%", objectFit: "contain" }} /> : <span style={{ fontSize: 9, fontWeight: 900, color: "#bbb" }}>HS</span>}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontWeight: 900, color: "#1d2733" }}>{s.name}</span>
                      {s.doc?.Logo1 && <span title="Branded" style={{ marginLeft: 6, fontSize: 9, fontWeight: 900, color: "#fff", background: GOLD, borderRadius: 4, padding: "1px 5px" }}>BRANDED</span>}
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#888" }}>{[s.doc?.City, s.state].filter(Boolean).join(", ") || "—"}</div>
                    </span>
                    {num(s.all, true)}{classes.map((c) => <Fragment key={c}>{num(s[c])}</Fragment>)}{num(s.cfb)}{num(s.drafted)}
                  </div>
                  {open === s.key && (
                    <div style={{ padding: "8px 12px 10px 104px", background: "#fffdf7", borderBottom: "1px solid #f0e6d0", display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                      {[...s.players].sort((a, b) => String(a.Eligible).localeCompare(String(b.Eligible)) || (a.Last || "").localeCompare(b.Last || "")).map((p) => (
                        <a key={p.id} href={`/player/${p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>
                          {p.First} {p.Last}<span style={{ color: "#888", fontWeight: 700 }}> · {p.Position} · {p.School} · {p.Eligible}</span>
                        </a>
                      ))}
                      {s.picks.length > 0 && (
                        <div style={{ flexBasis: "100%", fontSize: "11px", fontWeight: 900, color: "#8a5a00", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: s.players.length ? 4 : 0 }}>NFL Draft</div>
                      )}
                      {s.picks.map((d, j) => (
                        <span key={j} style={{ fontSize: "12px", fontWeight: 800, color: "#1d2733" }}>{d.label}</span>
                      ))}
                      {!s.players.length && !s.picks.length && (
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "#888" }}>{s.cfb} current college player{s.cfb === 1 ? "" : "s"} (CFBD), none on We-Draft yet.</span>
                      )}
                    </div>
                  )}
                </Fragment>
              ))}
              {schoolRows.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "#999", fontWeight: 700 }}>No schools match.</div>}
            </>
          )}
        </div>
      </div>
      {!isStates && schoolRows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + 100)} style={{ ...pill(false), marginTop: "10px" }}>Show more ({schoolRows.length - shown} left)</button>
      )}
    </div>
  );
}
