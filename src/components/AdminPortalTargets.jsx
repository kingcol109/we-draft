// src/components/AdminPortalTargets.jsx
//
// Admin → Players → Transfer Portal → Targets (user, 2026-11-17): the
// admin's recommended portal targets for every FBS team, shown on the
// public /portal/{team}/targets page above the Portal Sim's suggestions.
//
//   Suggestions (default, user 2026-11-21) — the Portal Sim's matches for
//              every school at once (server/portal/public.js scoreTargets:
//              the sim's wants + who'd realistically pick the school, with
//              extra points for hometown kids), best first: Accept adds him
//              to that school, Skip hides the match. Above them, "Take off":
//              admin targets the build flagged (offseason/portalSimTargets
//              .drops) — he committed / withdrew, or the school filled his
//              position — Remove, or Keep to hide the flag.
//   By Team    pick a school: its recommendations, grouped by stars (always
//              best first); ↑ ↓ order players within the same stars (the
//              public page keeps that order, else last name); add players by
//              search, or from the sim's suggestions for that school
//   By Player  pick a player: every school he's recommended to — add him to
//              as many as you like
//
// Storage: config/portalTargets (public read, admin write)
//   { teams: { [slug]: { [playerId]: rank } }, players: { [playerId]: info },
//     skip: { [slug]: { [playerId]: true } }   skipped suggestions
//     keep: { [slug]: { [playerId]: true } } } "Take off" flags kept anyway
// rank 0 = not hand-ordered. info is copied from the Portal Sim pool when
// he's added (name, position, school, stars, eligibility, size, state,
// We-Draft slug) so the public page needs no pool; stars stay live there
// through the Grades tab's locks. playerId = the pool's id (CFBD athlete id).
// Sorting rule: utils/portalData.js sortRecommendations.
import { useEffect, useMemo, useState } from "react";
import { deleteField, doc, FieldPath, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { lastNameOf, loadPortalPool, sortRecommendations, starsWithLocks } from "../utils/portalData";
import TransferStars from "./TransferStars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0f1b2d";
const btn = (on, color = BLUE) => ({
  padding: "6px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "8px", cursor: "pointer", background: on ? color : "#fff", color: on ? "#fff" : color, whiteSpace: "nowrap", fontFamily: "inherit",
});
const small = { border: "1px solid #d5dce6", background: "#fff", borderRadius: "6px", padding: "3px 8px", fontWeight: 900, fontSize: "12px", cursor: "pointer", fontFamily: "inherit", color: BLUE };
const input = { border: "2px solid #ddd", borderRadius: "8px", padding: "8px 10px", fontWeight: 700, fontSize: "13px", fontFamily: "inherit", minWidth: 0 };
const REF = () => doc(db, "config", "portalTargets");
const RED = "#c0392b";
// Power 4 conferences as the Portal Sim pool names them (Notre Dame, an
// Independent, is added by slug).
const P4_CONFS = new Set(["SEC", "Big 10", "Big 12", "ACC"]);
const checkLabel = { fontSize: "12px", fontWeight: 800, color: "#555", display: "inline-flex", gap: "5px", alignItems: "center" };
// The sim's want behind a suggestion.
const KIND = { hole: ["Hole", RED], upgrade: ["Upgrade", RED], talent: ["Talent", "#e67e22"], depth: ["Depth", "#d4a017"], body: ["Depth", "#d4a017"] };
const chip = (text, color, fill) => (
  <span style={{ fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 7px", borderRadius: "999px", border: `1.5px solid ${color}`, background: fill ? color : "#fff", color: fill ? "#fff" : color, whiteSpace: "nowrap" }}>{text}</span>
);
// Hometown (≤100 mi, filled) or near home (≤400 mi) — the builder only
// stores miles within 400.
const homeChip = (mi) => (mi == null ? null : chip(mi <= 100 ? `Hometown · ${mi} mi` : `Near home · ${mi} mi`, "#2e7d32", mi <= 100));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function AdminPortalTargets({ allPlayers = [] }) {
  const [pool, setPool] = useState(null); // { teams, players }
  const [brand, setBrand] = useState({});
  const [locks, setLocks] = useState({});
  const [targets, setTargets] = useState({ teams: {}, players: {}, skip: {}, keep: {} });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("suggest"); // suggest | team | player
  // Suggestions filters.
  const [sPos, setSPos] = useState("");
  const [sQ, setSQ] = useState("");
  const [sLive, setSLive] = useState(false);
  const [sHome, setSHome] = useState(false);
  const [sShown, setSShown] = useState(100);
  // Destination schools: P4 + Notre Dame by default (user 2026-11-21), or all FBS.
  const [sP4, setSP4] = useState(true);
  const [team, setTeam] = useState("");
  const [teamQ, setTeamQ] = useState("");
  const [q, setQ] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [sim, setSim] = useState(null); // the team's sim suggestions

  // The pool (every FBS player + graded FCS), locks, recommendations, branding.
  useEffect(() => {
    let c = false;
    (async () => {
      try {
        const [{ pool: p, locks: rows, brand: b }, recSnap] = await Promise.all([loadPortalPool(), getDoc(REF())]);
        if (c) return;
        setPool(p);
        setLocks(rows);
        setBrand(b);
        const d = recSnap.data() || {};
        setTargets({ teams: d.teams || {}, players: d.players || {}, skip: d.skip || {}, keep: d.keep || {} });
      } catch (e) {
        if (!c) setError(e.message || String(e));
      }
    })();
    return () => { c = true; };
  }, []);

  const slugOfWd = useMemo(() => new Map(allPlayers.map((p) => [p.id, p.Slug])), [allPlayers]);
  const teamList = useMemo(() => (pool ? pool.teams.filter((t) => !t.fcs).sort((a, b) => a.school.localeCompare(b.school)) : []), [pool]);
  const confOf = useMemo(() => Object.fromEntries((pool?.teams || []).map((t) => [t.slug, t.conference])), [pool]);
  const isP4 = (slug) => slug === "notre-dame" || P4_CONFS.has(confOf[slug]);
  const schoolOf = useMemo(() => Object.fromEntries((pool?.teams || []).map((t) => [t.slug, t.school])), [pool]);
  const byId = useMemo(() => new Map((pool?.players || []).map((p) => [p.id, p])), [pool]);
  const logo = (slug) => brand[slug]?.Logo1 || "";

  // The sim's suggestions for the picked team — projected entrants included,
  // so admin only (offseason/portalSimTargets, server/portal/public.js; the
  // public page shows only those actually in the portal).
  const [simAll, setSimAll] = useState(null);
  const [drops, setDrops] = useState({});
  const [simBuilt, setSimBuilt] = useState(null);
  useEffect(() => {
    getDoc(doc(db, "offseason", "portalSimTargets")).then((d) => {
      setSimAll(d.data()?.teams || {});
      setDrops(d.data()?.drops || {});
      setSimBuilt(d.data()?.builtAt?.toDate?.() || null);
    }).catch(() => setSimAll({}));
  }, []);
  useEffect(() => {
    setSim(!team ? null : simAll ? simAll[team] || [] : null);
  }, [team, simAll]);

  // What the public page needs about a player — copied when he's added.
  const infoOf = (p) => JSON.parse(JSON.stringify({
    n: p.name, pos: p.pos, sub: p.sub || "", from: schoolOf[p.team] || "", s: p.stars || null, e: p.elig ?? null,
    ht: p.ht || null, wt: p.wt || null, st: p.state || "", slug: (p.wdId && slugOfWd.get(p.wdId)) || "", wd: p.wdId || "",
  }));
  const starsOf = (id) => starsWithLocks(locks, { id, wdId: targets.players[id]?.wd, stars: byId.get(id)?.stars ?? targets.players[id]?.s });

  // Every write goes straight to config/portalTargets (field paths, so two
  // admins editing different teams don't clobber each other).
  const write = async (pairs, nextTargets) => {
    setBusy(true); setError("");
    try {
      const snap = await getDoc(REF());
      if (!snap.exists()) await setDoc(REF(), { teams: {}, players: {} });
      const args = pairs.flatMap(([path, value]) => [new FieldPath(...path), value]);
      await updateDoc(REF(), ...args);
      setTargets(nextTargets);
    } catch (e) {
      setError(`Save failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };
  const addTo = (slug, p) => {
    if (targets.teams[slug]?.[p.id] != null) return;
    const info = infoOf(p);
    const next = { ...targets, teams: { ...targets.teams, [slug]: { ...(targets.teams[slug] || {}), [p.id]: 0 } }, players: { ...targets.players, [p.id]: info } };
    write([[["teams", slug, p.id], 0], [["players", p.id], info]], next);
  };
  const removeFrom = (slug, id) => {
    const teamMap = { ...(targets.teams[slug] || {}) };
    delete teamMap[id];
    const stillUsed = Object.entries(targets.teams).some(([s, m]) => s !== slug && m[id] != null);
    const players = { ...targets.players };
    if (!stillUsed) delete players[id];
    write([[["teams", slug, id], deleteField()], ...(stillUsed ? [] : [[["players", id], deleteField()]])], { ...targets, teams: { ...targets.teams, [slug]: teamMap }, players });
  };
  // Skip a suggestion / keep a flagged target (field: "skip" | "keep").
  const mark = (field, slug, id) => write([[[field, slug, id], true]], { ...targets, [field]: { ...targets[field], [slug]: { ...(targets[field][slug] || {}), [id]: true } } });
  const unmark = (field, slug, id) => {
    const m = { ...(targets[field][slug] || {}) };
    delete m[id];
    write([[[field, slug, id], deleteField()]], { ...targets, [field]: { ...targets[field], [slug]: m } });
  };
  // Move one place up or down within his stars: the group is renumbered
  // 1..n in its new order.
  const move = (slug, id, delta) => {
    const list = recsFor(slug);
    const s = list.find((r) => r.id === id)?.s || 0;
    const group = list.filter((r) => (r.s || 0) === s);
    const i = group.findIndex((r) => r.id === id);
    const j = i + delta;
    if (j < 0 || j >= group.length) return;
    [group[i], group[j]] = [group[j], group[i]];
    const teamMap = { ...(targets.teams[slug] || {}) };
    const pairs = group.map((r, k) => { teamMap[r.id] = k + 1; return [["teams", slug, r.id], k + 1]; });
    write(pairs, { ...targets, teams: { ...targets.teams, [slug]: teamMap } });
  };
  const clearOrder = (slug, s) => {
    const group = recsFor(slug).filter((r) => (r.s || 0) === s);
    const teamMap = { ...(targets.teams[slug] || {}) };
    const pairs = group.map((r) => { teamMap[r.id] = 0; return [["teams", slug, r.id], 0]; });
    write(pairs, { ...targets, teams: { ...targets.teams, [slug]: teamMap } });
  };
  const recsFor = (slug) => sortRecommendations(Object.entries(targets.teams[slug] || {}).map(([id, rank]) => ({
    id, rank: Number(rank) || 0, ...(targets.players[id] || { n: byId.get(id)?.name || id }), s: starsOf(id),
  })));

  // Player search (2+ letters): name, then school.
  const results = useMemo(() => {
    const t = norm(q).trim();
    if (!pool || t.length < 2) return [];
    return pool.players.filter((p) => norm(p.name).includes(t) || norm(schoolOf[p.team]).includes(t))
      .sort((a, b) => (b.stars || 0) - (a.stars || 0) || lastNameOf(a.name).localeCompare(lastNameOf(b.name)))
      .slice(0, 30);
  }, [q, pool, schoolOf]);

  // ── Suggestions data ──
  // Flags still standing: the target is still on the school's list and the
  // admin hasn't kept him.
  const dropRows = Object.entries(drops).flatMap(([slug, m]) => Object.entries(m || {})
    .filter(([id]) => targets.teams[slug]?.[id] != null && !targets.keep[slug]?.[id])
    .map(([id, d]) => ({ slug, id, ...d })));
  const suggestRows = !simAll ? [] : Object.entries(simAll).flatMap(([slug, l]) => (l || [])
    .filter((t) => targets.teams[slug]?.[t.id] == null && !targets.skip[slug]?.[t.id])
    .map((t) => ({ ...t, slug })))
    .sort((a, b) => b.score - a.score);

  if (error && !pool) return <div style={{ padding: 20, color: "#c0392b", fontWeight: 800 }}>{error}</div>;
  if (!pool) return <div style={{ padding: 20, color: "#888", fontWeight: 800 }}>Loading the Portal Sim pool…</div>;

  const recCount = (slug) => Object.keys(targets.teams[slug] || {}).length;
  const School = ({ slug, size = 22 }) => (logo(slug) ? <img src={logo(slug)} alt="" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} /> : <span style={{ width: size }} />);
  const PlayerLine = ({ p, right }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 12px", borderTop: "1px solid #eef1f5" }}>
      <TransferStars stars={starsWithLocks(locks, { id: p.id, wdId: p.wdId, stars: p.stars })} size="sm" />
      <span style={{ width: 44, flexShrink: 0, fontSize: "12px", fontWeight: 900, color: BLUE }}>{p.sub || p.pos}</span>
      <School slug={p.team} />
      <span style={{ flex: 1, minWidth: 0, fontWeight: 900, color: INK, fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.name} <span style={{ fontWeight: 700, color: "#8a97ab", fontSize: "12px" }}>{schoolOf[p.team]} · {p.elig ?? "?"} yrs left</span>
      </span>
      {right}
    </div>
  );
  // A plain function, not a component — an inner component would remount
  // (and drop the input's focus) on every keystroke.
  const searchBox = ({ onPick, pickLabel, isPicked }) => (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
      <div style={{ padding: "10px 12px", background: "#f7f9fc", display: "flex", gap: "8px", alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any FBS player or school…" style={{ ...input, flex: 1 }} />
        <span style={{ fontSize: "11px", fontWeight: 800, color: "#8a97ab" }}>{q.trim().length >= 2 ? `${results.length}${results.length === 30 ? "+" : ""} found` : ""}</span>
      </div>
      {results.map((p) => (
        <PlayerLine key={p.id} p={p} right={isPicked(p)
          ? <span style={{ fontSize: "11px", fontWeight: 900, color: "#2e7d32" }}>✓ Added</span>
          : <button type="button" disabled={busy} onClick={() => onPick(p)} style={small}>{pickLabel}</button>} />
      ))}
    </div>
  );

  // ── By Team ──
  const teamView = () => {
    const list = team ? recsFor(team) : [];
    const groups = [6, 5, 4, 3, 2, 0].map((s) => [s, list.filter((r) => (r.s || 0) === s)]).filter(([, l]) => l.length);
    const shownTeams = teamList.filter((t) => !teamQ.trim() || norm(t.school).includes(norm(teamQ).trim()));
    return (
      <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: "16px", alignItems: "start" }}>
        <div style={{ border: "1px solid #e3e8ef", borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
          <div style={{ padding: "8px" }}><input value={teamQ} onChange={(e) => setTeamQ(e.target.value)} placeholder="Find a school…" style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div style={{ maxHeight: "640px", overflowY: "auto" }}>
            {shownTeams.map((t) => (
              <button key={t.slug} type="button" onClick={() => { setTeam(t.slug); setQ(""); }} style={{
                width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", border: "none", borderTop: "1px solid #f0f2f6",
                background: team === t.slug ? "#eaf1ff" : "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              }}>
                <School slug={t.slug} size={20} />
                <span style={{ flex: 1, fontSize: "13px", fontWeight: 800, color: INK }}>{t.school}</span>
                {recCount(t.slug) > 0 && <span style={{ fontSize: "11px", fontWeight: 900, color: "#fff", background: BLUE, borderRadius: "999px", padding: "1px 7px" }}>{recCount(t.slug)}</span>}
              </button>
            ))}
          </div>
        </div>
        {!team ? <div style={{ padding: 30, color: "#8a97ab", fontWeight: 800 }}>Pick a school.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
              <div style={{ background: BLUE, color: "#fff", padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                <School slug={team} size={26} />
                <span style={{ fontWeight: 900, fontSize: "14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{schoolOf[team]} · Recommended Targets</span>
                <a href={`/portal/${team}/targets`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", color: GOLD, fontWeight: 900, fontSize: "12px" }}>View page ↗</a>
              </div>
              <div style={{ padding: "6px 12px", fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>
                Always sorted by stars. Use ↑ ↓ to order players with the same stars; anyone not ordered falls in by last name.
              </div>
              {list.length === 0 ? <div style={{ padding: "18px 14px", color: "#8a97ab", fontStyle: "italic", fontSize: "13px" }}>No recommendations yet — search below or add from the sim&apos;s suggestions.</div>
                : groups.map(([s, l]) => (
                  <div key={s}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", background: "#f7f9fc", borderTop: "1px solid #e3e8ef" }}>
                      <TransferStars stars={s || null} size="sm" />
                      <span style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", textTransform: "uppercase", letterSpacing: "0.08em" }}>{l.length} player{l.length === 1 ? "" : "s"}</span>
                      {l.some((r) => r.rank) && <button type="button" disabled={busy} onClick={() => clearOrder(team, s)} style={{ ...small, marginLeft: "auto", color: "#8a97ab" }}>Reset to last name</button>}
                    </div>
                    {l.map((r, i) => {
                      const p = byId.get(r.id) || { id: r.id, name: r.n, pos: r.pos, sub: r.sub, team: "", elig: r.e, stars: r.s };
                      return (
                        <PlayerLine key={r.id} p={p} right={(
                          <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            {drops[team]?.[r.id] && !targets.keep[team]?.[r.id] && <span title={drops[team][r.id].by?.length ? `Signed ${drops[team][r.id].by.join(", ")}` : ""} style={{ fontSize: "11px", fontWeight: 900, color: "#c0392b", marginRight: "4px" }}>Take off? {drops[team][r.id].why}</span>}
                            {r.rank > 0 && <span style={{ fontSize: "11px", fontWeight: 900, color: GOLD, marginRight: "4px" }}>#{r.rank}</span>}
                            <button type="button" disabled={busy || i === 0} onClick={() => move(team, r.id, -1)} style={{ ...small, opacity: i === 0 ? 0.35 : 1 }} aria-label="Move up">↑</button>
                            <button type="button" disabled={busy || i === l.length - 1} onClick={() => move(team, r.id, 1)} style={{ ...small, opacity: i === l.length - 1 ? 0.35 : 1 }} aria-label="Move down">↓</button>
                            <button type="button" disabled={busy} onClick={() => removeFrom(team, r.id)} style={{ ...small, color: "#c0392b" }} aria-label="Remove">✕</button>
                          </span>
                        )} />
                      );
                    })}
                  </div>
                ))}
            </div>
            {searchBox({ pickLabel: "+ Add", isPicked: (p) => targets.teams[team]?.[p.id] != null, onPick: (p) => addTo(team, p) })}
            <div style={{ border: "1px solid #e3e8ef", borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
              <div style={{ padding: "8px 12px", background: "#334155", color: "#fff", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Portal Sim suggestions for {schoolOf[team]} <span style={{ opacity: 0.7, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>· admin only — includes projected entrants; the public page shows them once they&apos;re in the portal</span></div>
              {sim === null ? <div style={{ padding: 12, color: "#888" }}>Loading…</div> : sim.length === 0 ? <div style={{ padding: 12, color: "#8a97ab", fontStyle: "italic", fontSize: "13px" }}>None — the team pages may need a rebuild (Team Pages tab).</div>
                : sim.map((t) => {
                  const p = byId.get(t.id);
                  if (!p) return null;
                  return <PlayerLine key={t.id} p={p} right={<span style={{ display: "flex", gap: "6px", alignItems: "center" }}>{homeChip(t.mi)}{targets.teams[team]?.[p.id] != null
                    ? <span style={{ fontSize: "11px", fontWeight: 900, color: "#2e7d32" }}>✓ Added</span>
                    : <button type="button" disabled={busy} onClick={() => addTo(team, p)} style={small}>+ Add</button>}</span>} />;
                })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Suggestions ──
  const suggestView = () => {
    const t = norm(sQ).trim();
    const rows = suggestRows.filter((r) => (!sP4 || isP4(r.slug)) && (!sPos || r.pos === sPos) && (!sLive || r.live) && (!sHome || r.mi != null)
      && (!t || norm(r.n).includes(t) || norm(schoolOf[r.slug]).includes(t) || norm(r.from).includes(t)));
    const positions = [...new Set(suggestRows.map((r) => r.pos))].sort();
    const skipped = Object.entries(targets.skip).flatMap(([slug, m]) => Object.keys(m).map((id) => ({ slug, id })));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {dropRows.length > 0 && (
          <div style={{ border: "2px solid " + RED, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
            <div style={{ background: RED, color: "#fff", padding: "8px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Take off ({dropRows.length}) <span style={{ opacity: 0.85, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>· the school filled the spot, or he already moved</span>
            </div>
            {dropRows.map((r) => {
              const info = targets.players[r.id] || {};
              const p = byId.get(r.id) || { id: r.id, name: info.n || r.id, pos: info.pos, team: "", elig: info.e, stars: info.s };
              return (
                <PlayerLine key={`${r.slug}|${r.id}`} p={p} right={(
                  <span style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: "#5b6b84" }}>for</span><School slug={r.slug} size={18} />
                    <span style={{ fontSize: "12px", fontWeight: 900, color: RED }}>{r.why}{r.by?.length ? ` — signed ${r.by.join(", ")}` : ""}</span>
                    <button type="button" disabled={busy} onClick={() => removeFrom(r.slug, r.id)} style={{ ...small, color: "#fff", background: RED, borderColor: RED }}>Remove</button>
                    <button type="button" disabled={busy} onClick={() => mark("keep", r.slug, r.id)} style={{ ...small, color: "#8a97ab" }}>Keep</button>
                  </span>
                )} />
              );
            })}
          </div>
        )}
        <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
          <div style={{ background: BLUE, color: "#fff", padding: "8px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Suggested matches ({rows.length}) <span style={{ opacity: 0.85, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>· Portal Sim logic, extra points for hometown kids{simBuilt ? ` · built ${simBuilt.toLocaleString()}` : ""}</span>
          </div>
          <div style={{ padding: "8px 12px", background: "#f7f9fc", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <span style={{ display: "inline-flex", gap: "4px" }}>
              <button type="button" onClick={() => { setSP4(true); setSShown(100); }} style={btn(sP4)}>P4 + Notre Dame</button>
              <button type="button" onClick={() => { setSP4(false); setSShown(100); }} style={btn(!sP4)}>All FBS</button>
            </span>
            <input value={sQ} onChange={(e) => { setSQ(e.target.value); setSShown(100); }} placeholder="Player or school…" style={{ ...input, flex: "1 1 200px" }} />
            <select value={sPos} onChange={(e) => { setSPos(e.target.value); setSShown(100); }} style={input}>
              <option value="">All positions</option>
              {positions.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <label style={checkLabel}><input type="checkbox" checked={sLive} onChange={(e) => setSLive(e.target.checked)} /> In the portal only</label>
            <label style={checkLabel}><input type="checkbox" checked={sHome} onChange={(e) => setSHome(e.target.checked)} /> Near home only</label>
          </div>
          {simAll === null ? <div style={{ padding: 12, color: "#888" }}>Loading…</div>
            : rows.length === 0 ? <div style={{ padding: 14, color: "#8a97ab", fontStyle: "italic", fontSize: "13px" }}>No suggestions — the team pages may need a rebuild (Team Pages tab).</div>
              : rows.slice(0, sShown).map((r) => {
                const p = byId.get(r.id);
                if (!p) return null;
                return (
                  <PlayerLine key={`${r.slug}|${r.id}`} p={p} right={(
                    <span style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {r.live ? chip("In the portal", GOLD, true) : chip("Projected", "#8a97ab")}
                      {KIND[r.kind] && chip(KIND[r.kind][0], KIND[r.kind][1])}
                      {homeChip(r.mi)}
                      <span style={{ fontSize: "12px", fontWeight: 900, color: "#5b6b84" }}>→</span>
                      <School slug={r.slug} size={20} />
                      <span style={{ fontSize: "12px", fontWeight: 900, color: INK, minWidth: 90 }}>{schoolOf[r.slug]}</span>
                      <button type="button" disabled={busy} onClick={() => addTo(r.slug, p)} style={{ ...small, color: "#fff", background: BLUE, borderColor: BLUE }}>Accept</button>
                      <button type="button" disabled={busy} onClick={() => mark("skip", r.slug, r.id)} style={{ ...small, color: "#8a97ab" }}>Skip</button>
                    </span>
                  )} />
                );
              })}
          {rows.length > sShown && <div style={{ padding: 10 }}><button type="button" onClick={() => setSShown((n) => n + 100)} style={btn(false)}>Show more ({rows.length - sShown} left)</button></div>}
        </div>
        {skipped.length > 0 && (
          <details style={{ fontSize: "12px", fontWeight: 800, color: "#5b6b84" }}>
            <summary style={{ cursor: "pointer" }}>Skipped ({skipped.length})</summary>
            {skipped.map(({ slug, id }) => {
              const p = byId.get(id);
              return p ? <PlayerLine key={`${slug}|${id}`} p={p} right={<span style={{ display: "flex", gap: "6px", alignItems: "center" }}>→ <School slug={slug} size={18} />{schoolOf[slug]}<button type="button" disabled={busy} onClick={() => unmark("skip", slug, id)} style={small}>Restore</button></span>} /> : null;
            })}
          </details>
        )}
      </div>
    );
  };

  // ── By Player ──
  const playerView = () => {
    const p = playerId ? byId.get(playerId) : null;
    const assigned = p ? teamList.filter((t) => targets.teams[t.slug]?.[p.id] != null) : [];
    const shownTeams = teamList.filter((t) => !teamQ.trim() || norm(t.school).includes(norm(teamQ).trim()) || norm(t.conference).includes(norm(teamQ).trim()));
    return (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "16px", alignItems: "start" }}>
        <div>
          {searchBox({ pickLabel: "Select", isPicked: (x) => x.id === playerId, onPick: (x) => setPlayerId(x.id) })}
          {/* Everyone recommended anywhere, for quick picking. */}
          <div style={{ marginTop: "14px", border: "1px solid #e3e8ef", borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
            <div style={{ padding: "8px 12px", background: "#f7f9fc", fontWeight: 900, fontSize: "12px", color: "#5b6b84", textTransform: "uppercase", letterSpacing: "0.08em" }}>Recommended anywhere ({Object.keys(targets.players).length})</div>
            <div style={{ maxHeight: "360px", overflowY: "auto" }}>
              {sortRecommendations(Object.entries(targets.players).map(([id, info]) => ({ id, ...info, s: starsOf(id) }))).map((r) => {
                const x = byId.get(r.id);
                if (!x) return null;
                const n = teamList.filter((t) => targets.teams[t.slug]?.[r.id] != null).length;
                return <PlayerLine key={r.id} p={x} right={<button type="button" onClick={() => setPlayerId(r.id)} style={{ ...small, ...(r.id === playerId ? { background: BLUE, color: "#fff" } : {}) }}>{n} team{n === 1 ? "" : "s"}</button>} />;
              })}
            </div>
          </div>
        </div>
        {!p ? <div style={{ padding: 30, color: "#8a97ab", fontWeight: 800 }}>Search for a player, then pick the schools he&apos;s a target for.</div> : (
          <div style={{ border: "2px solid " + BLUE, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
            <div style={{ background: BLUE, color: "#fff", padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
              <TransferStars stars={starsWithLocks(locks, { id: p.id, wdId: p.wdId, stars: p.stars })} size="sm" />
              <span style={{ fontWeight: 900, fontSize: "15px" }}>{p.name}</span>
              <span style={{ fontWeight: 700, fontSize: "12px", opacity: 0.85 }}>{p.sub || p.pos} · {schoolOf[p.team]} · {p.elig ?? "?"} yrs left</span>
            </div>
            <div style={{ padding: "10px 12px", display: "flex", flexWrap: "wrap", gap: "6px", borderBottom: "1px solid #e3e8ef" }}>
              {assigned.length === 0 ? <span style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>Not recommended to any school yet.</span> : assigned.map((t) => (
                <span key={t.slug} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "3px 6px 3px 8px", borderRadius: "999px", background: "#eaf1ff", fontSize: "12px", fontWeight: 900, color: BLUE }}>
                  <School slug={t.slug} size={16} />{t.school}
                  <button type="button" disabled={busy} onClick={() => removeFrom(t.slug, p.id)} style={{ border: "none", background: "none", color: "#c0392b", fontWeight: 900, cursor: "pointer", padding: "0 2px" }} aria-label={`Remove from ${t.school}`}>✕</button>
                </span>
              ))}
            </div>
            <div style={{ padding: "8px" }}><input value={teamQ} onChange={(e) => setTeamQ(e.target.value)} placeholder="Filter schools or conference…" style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
            <div style={{ maxHeight: "520px", overflowY: "auto" }}>
              {shownTeams.filter((t) => t.slug !== p.team).map((t) => {
                const on = targets.teams[t.slug]?.[p.id] != null;
                return (
                  <label key={t.slug} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", borderTop: "1px solid #f0f2f6", cursor: busy ? "wait" : "pointer", background: on ? "#f3f8ff" : "#fff" }}>
                    <input type="checkbox" checked={on} disabled={busy} onChange={() => (on ? removeFrom(t.slug, p.id) : addTo(t.slug, p))} />
                    <School slug={t.slug} size={18} />
                    <span style={{ flex: 1, fontSize: "13px", fontWeight: 800, color: INK }}>{t.school}</span>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>{t.conference}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setMode("suggest")} style={btn(mode === "suggest")}>Suggestions{dropRows.length ? ` · ${dropRows.length} to take off` : ""}</button>
        <button type="button" onClick={() => setMode("team")} style={btn(mode === "team")}>By Team</button>
        <button type="button" onClick={() => setMode("player")} style={btn(mode === "player")}>By Player</button>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab", marginLeft: "8px" }}>
          {Object.keys(targets.players).length} players recommended across {Object.values(targets.teams).filter((m) => Object.keys(m).length).length} schools
        </span>
        {busy && <span style={{ fontSize: "12px", fontWeight: 800, color: GOLD }}>Saving…</span>}
        {error && <span style={{ fontSize: "12px", fontWeight: 800, color: "#c0392b" }}>{error}</span>}
      </div>
      {mode === "suggest" ? suggestView() : mode === "team" ? teamView() : playerView()}
    </div>
  );
}
