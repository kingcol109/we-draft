// src/components/CfbUniverseSearch.js
//
// Admin → Player Data → "CFB Universe": search every college player on a
// CFBD roster (cfbRosters/*, written weekly by scripts/syncCfbdRosters.js —
// ~27k players across ~240 We-Draft schools) and add one to We-Draft's own
// players collection in one click, or link him to a profile that already
// exists.
//
// Loading: every roster doc once, the first time the tab opens (~240 reads,
// admin only). Search is then in memory.
//
// Adding a player:
//   - players doc from the roster row: name, school, position (CFBD →
//     We-Draft, editable per row), draft class (recruiting-class rule,
//     editable), height/weight, home state. Live per row (checked by
//     default, same as a new player made by hand). Slug via the panel's own generateSlug, de-duped
//     (-1, -2, ...) like a manual create.
//   - cfbdPlayers/{id} linked to it (mappingStatus "verified", source
//     "admin") — his stats card, game log and Live follows pick it up.
//   - the roster row gets the slug, so the team page's Roster tab links him
//     right away instead of after the next weekly sync.
// A same-name We-Draft player shows as a possible match with "Link" (no new
// profile) and "Add anyway".
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDoc, collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const SEASON = 2026;
const MAX_RESULTS = 60;

const WD_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P", "LS"];
// CFBD roster position → We-Draft position. CFBD lumps ends and tackles
// into DL, so those come in as DL (switch to EDGE per row when needed).
const POS_MAP = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
  OL: "OL", OT: "OL", OG: "OL", C: "OL", IOL: "OL",
  DL: "DL", DT: "DL", NT: "DL", DE: "EDGE", EDGE: "EDGE",
  LB: "LB", OLB: "LB", ILB: "LB", MLB: "LB",
  DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB",
  K: "K", PK: "K", P: "P", LS: "LS",
};
// Draft class from the recruiting class — the same rule as the CFB stat
// tables (scripts/syncCfbdRosters.js draftClassOf): 2026 signees are the
// 2029 class, 2025's the 2028 class, everyone else 2027 (also when in
// doubt — no recruiting record). rc is the roster row's recruiting class;
// a newly added freshman's CFBD "year" is their class too. Adjust per row.
const BY_SIGNING = { [SEASON]: SEASON + 3, [SEASON - 1]: SEASON + 2 };
const eligibleFor = (p) => String(BY_SIGNING[p.rc] || BY_SIGNING[p.yr] || SEASON + 1);
const ELIGIBLE_CHOICES = [SEASON + 1, SEASON + 2, SEASON + 3, SEASON + 4].map(String);
const CLASS = (yr) => (yr == null ? "" : yr > 1000 ? "FR" : ["", "FR", "SO", "JR", "SR"][yr] || "GR");
const heightOf = (ht) => (ht ? `${Math.floor(ht / 12)}'${ht % 12}"` : "");
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export default function CfbUniverseSearch({ allPlayers, generateSlug, stateNames, onAdded }) {
  const [rosters, setRosters] = useState(null); // [{ id, school, players }]
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [schoolFilter, setSchoolFilter] = useState("");
  const [edits, setEdits] = useState({}); // cfbd id → { pos, eligible }
  const [busy, setBusy] = useState(null); // cfbd id being written
  const [done, setDone] = useState({}); // cfbd id → slug (added/linked this session)
  const [forceAdd, setForceAdd] = useState({}); // cfbd id → true after "Add anyway"

  useEffect(() => {
    getDocs(collection(db, "cfbRosters"))
      .then((snap) => setRosters(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.school || "").localeCompare(b.school || ""))))
      .catch((e) => { console.error(e); setError("Couldn't load rosters — check console."); setRosters([]); });
  }, []);

  // Every roster player, flattened once.
  const universe = useMemo(() => (rosters || []).flatMap((r) => r.players.map((p) => ({
    ...p, rosterId: r.id, school: r.school, team: r.team, teamId: r.teamId, key: norm(`${p.first} ${p.last}`),
  }))), [rosters]);

  const byName = useMemo(() => {
    const m = new Map();
    allPlayers.forEach((p) => {
      const k = norm(`${p.First} ${p.Last}`);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    });
    return m;
  }, [allPlayers]);

  const results = useMemo(() => {
    const t = norm(q);
    if (t.length < 2 && !schoolFilter) return [];
    return universe
      .filter((p) => (!schoolFilter || p.school === schoolFilter) && (!t || p.key.includes(t)))
      .sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.last.localeCompare(b.last))
      .slice(0, MAX_RESULTS);
  }, [universe, q, schoolFilter]);

  const editOf = (p) => ({ pos: POS_MAP[p.pos] || "", eligible: eligibleFor(p), live: true, ...edits[p.id] });
  const setEdit = (p, field, value) => setEdits((prev) => ({ ...prev, [p.id]: { ...editOf(p), ...prev[p.id], [field]: value } }));

  // Link cfbdPlayers/{id} to a We-Draft profile and stamp the roster row.
  const link = async (p, wdId, slug) => {
    await setDoc(doc(db, "cfbdPlayers", String(p.id)), {
      name: `${p.first} ${p.last}`.trim(), firstName: p.first || null, lastName: p.last || null,
      team: p.team, teamId: p.teamId, position: p.pos || null, jersey: p.no ?? null, provider: "cfbd",
      wedraftPlayerId: wdId, wedraftSlug: slug, mappingStatus: "verified", mappingSource: "admin",
      updatedAt: serverTimestamp(),
    }, { merge: true });
    const roster = rosters.find((r) => r.id === p.rosterId);
    if (roster) {
      const players = roster.players.map((x) => (String(x.id) === String(p.id) ? { ...x, slug } : x));
      await setDoc(doc(db, "cfbRosters", roster.id), { players }, { merge: true });
      setRosters((prev) => prev.map((r) => (r.id === roster.id ? { ...r, players } : r)));
    }
    setDone((prev) => ({ ...prev, [p.id]: slug }));
  };

  const add = async (p) => {
    const { pos, eligible, live } = editOf(p);
    if (!pos || !eligible) { alert("Pick a position and draft class first."); return; }
    const base = generateSlug(p.first, p.last, pos, eligible);
    const taken = new Set(allPlayers.map((x) => x.Slug).filter(Boolean));
    let slug = base;
    for (let n = 1; taken.has(slug); n += 1) slug = `${base}-${n}`;
    const stateAbbr = (p.home || "").split(",").pop().trim();
    setBusy(p.id);
    try {
      const payload = {
        First: p.first, Last: p.last, HighSchool: "", State: stateNames[stateAbbr] || "",
        School: p.school || "", Position: pos, Eligible: eligible,
        Height: heightOf(p.ht), Weight: p.wt ? String(p.wt) : "",
        Bio: "", Flair: "", Live: live, AdminNotes: "", Flag: "",
        Slug: slug, updatedAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(db, "players"), payload);
      await link(p, ref.id, slug);
      onAdded({ id: ref.id, ...payload });
    } catch (e) {
      console.error("CFB universe add error:", e);
      alert("Failed to add — check console.");
    } finally {
      setBusy(null);
    }
  };

  const linkExisting = async (p, wd) => {
    setBusy(p.id);
    try { await link(p, wd.id, wd.Slug); } catch (e) { console.error(e); alert("Failed to link — check console."); } finally { setBusy(null); }
  };

  const th = { padding: "8px 10px", fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: "#fff", textAlign: "left", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: "13px", borderBottom: "1px solid #eef1f5", verticalAlign: "middle" };
  const sel = { padding: "4px 6px", fontSize: "12px", fontWeight: 700, border: "1px solid #c9d3e0", borderRadius: "5px" };
  const btn = (bg, fg = "#fff") => ({ padding: "5px 12px", fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", border: "none", borderRadius: "6px", background: bg, color: fg, cursor: "pointer", whiteSpace: "nowrap" });

  return (
    <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "10px 16px", color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        CFB Universe {rosters ? `· ${universe.length.toLocaleString()} players on ${rosters.length} rosters` : ""}
      </div>
      <div style={{ display: "flex", gap: "10px", padding: "12px 16px", background: "#f6f8fb", borderBottom: "1px solid #e3e8ef", flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any college player by name…" autoFocus
          style={{ flex: 1, minWidth: "240px", padding: "9px 12px", fontSize: "14px", fontWeight: 700, border: `2px solid ${BLUE}`, borderRadius: "8px" }} />
        <select value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)} style={{ ...sel, fontSize: "13px", padding: "8px 10px" }}>
          <option value="">All schools</option>
          {(rosters || []).map((r) => <option key={r.id} value={r.school}>{r.school}</option>)}
        </select>
      </div>

      {!rosters ? (
        <div style={{ padding: "28px", textAlign: "center", color: "#7a8597", fontWeight: 700 }}>Loading rosters…</div>
      ) : error ? (
        <div style={{ padding: "28px", textAlign: "center", color: "#b23b3b", fontWeight: 700 }}>{error}</div>
      ) : !results.length ? (
        <div style={{ padding: "28px", textAlign: "center", color: "#7a8597", fontWeight: 700 }}>
          {norm(q).length < 2 && !schoolFilter ? "Type at least 2 letters of a name, or pick a school." : "No players found."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
            <thead style={{ background: BLUE }}>
              <tr>
                <th style={th}>Player</th><th style={th}>School</th><th style={th}>CFBD</th><th style={th}>Class</th>
                <th style={th}>Ht / Wt</th><th style={th}>Position</th><th style={th}>Draft class</th><th style={th}>Live</th><th style={th} />
              </tr>
            </thead>
            <tbody>
              {results.map((p) => {
                const slug = done[p.id] || p.slug;
                const matches = byName.get(p.key) || [];
                const e = editOf(p);
                return (
                  <tr key={`${p.rosterId}-${p.id}`}>
                    <td style={{ ...td, fontWeight: 900, color: "#1d2733" }}>
                      {p.first} {p.last}
                      {p.no != null && <span style={{ color: "#9aa5b4", fontWeight: 700, marginLeft: "6px" }}>#{p.no}</span>}
                      {p.home && <div style={{ fontSize: "11px", fontWeight: 600, color: "#7a8597" }}>{p.home}</div>}
                    </td>
                    <td style={td}>{p.school}</td>
                    <td style={td}>{p.pos || "—"}</td>
                    <td style={td}>{CLASS(p.yr)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{[heightOf(p.ht), p.wt].filter(Boolean).join(" / ") || "—"}</td>
                    {slug ? (
                      <td colSpan={4} style={{ ...td, textAlign: "right" }}>
                        <Link to={`/player/${slug}`} target="_blank" style={{ color: "#1f8a4c", fontWeight: 900, fontSize: "12px" }}>✓ On We-Draft ↗</Link>
                      </td>
                    ) : (
                      <>
                        <td style={td}>
                          <select value={e.pos} onChange={(ev) => setEdit(p, "pos", ev.target.value)} style={sel}>
                            <option value="">—</option>
                            {WD_POSITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                        </td>
                        <td style={td}>
                          <select value={e.eligible} onChange={(ev) => setEdit(p, "eligible", ev.target.value)} style={sel}>
                            {ELIGIBLE_CHOICES.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                        </td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <input type="checkbox" checked={e.live} onChange={(ev) => setEdit(p, "live", ev.target.checked)} title="Live — shown on the site" />
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {matches.length > 0 && !forceAdd[p.id] ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
                              {matches.map((m) => (
                                <div key={m.id} style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", fontWeight: 700, color: "#5b6b7f" }}>
                                  <span>Match: {m.School} · {m.Position} · {m.Eligible}</span>
                                  <button disabled={busy === p.id} onClick={() => linkExisting(p, m)} style={btn("#1f8a4c")}>Link</button>
                                </div>
                              ))}
                              <button disabled={busy === p.id} onClick={() => setForceAdd((prev) => ({ ...prev, [p.id]: true }))} style={btn("#eef1f5", BLUE)}>Add anyway</button>
                            </div>
                          ) : (
                            <button disabled={busy === p.id} onClick={() => add(p)} style={btn(BLUE)}>{busy === p.id ? "Adding…" : "+ Add to We-Draft"}</button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {results.length === MAX_RESULTS && (
            <div style={{ padding: "8px 16px", fontSize: "12px", fontWeight: 700, color: "#7a8597" }}>Showing the first {MAX_RESULTS} — narrow the search to see more.</div>
          )}
        </div>
      )}
    </div>
  );
}
