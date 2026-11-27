// src/components/AdminPortalNews.jsx
//
// Admin → Transfer Portal → WX Pages: the configurator for Portal News
// (/portal/news — pages/PortalNews.jsx, utils/portalNews.js). Pick the
// players the page features, write the editorial on each, and save:
//   - Add players: suggested from the players in the portal (newest
//     entries first) and the ones who've recently committed, or any player
//     by search — or straight from the CFB Universe (every CFBD roster,
//     cfbRosters/*): a roster player already on We-Draft adds as himself; one
//     who isn't is first added to We-Draft (CfbUniverseSearch.js
//     addRosterPlayer, its defaults: mapped position, draft class, recruit
//     year) and then to the page.
//   - Each player: Entered (still in the portal) or Committed; the school
//     he's leaving and the one he picked; the day; the write-up; his photo
//     (an action shot placed for First Pick — his graphic's); his season
//     stats (his CFBD line — the card's back, and a committed player's row).
//   - Entered: up to three potential destinations, shown on his row in place
//     of his stats, and one of them as the We-Draft.com prediction.
//   - Committed: his graphic's design (Mock 1 classic / Mock 2 commitment).
//   - Projected: a player who ISN'T in the portal yet but is expected to go
//     (anyone added who isn't in it starts here). He sits in the IN list, in
//     its one order, labeled PROJECTED on the page; "Mark entered" flips the
//     ones who've since gone in, "Remove projected" clears the rest at once
//     when the real portal has filled up.
// Save writes portalNews/current { entries, updatedAt } — the page reads it
// live (and stops showing the simulation once it has entries).
import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { usePortalCover, placedShots } from "./PortalNewsGraphic";
import { TRANSFER_DESIGNS } from "../utils/instagram/transfer";
import { STATS_SEASON, DEFAULT_STATS, statLabel, statValue, seasonKeys } from "../utils/risers";
import { PORTAL_NEWS_DOC, PORTAL_NEWS_PATH, MAX_DESTINATIONS, NEWS_STATUS, NEWS_POSITIONS, isProjected, newsStatusOf, newsSection, newsPosGroup, projectedGraphicIds, inPortalCount, eligibilityText } from "../utils/portalNews";
import { seasonsLeft } from "../utils/eligibility";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const GREEN = "#15803d";
const VIOLET = NEWS_STATUS.projected.c1;
const INK = "#0f1b2d";
const SCHOOLS_LIST = "portal-news-schools";
const STATS_MAX = 4;
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const toMs = (ts) => (ts?.toMillis ? ts.toMillis() : ts?.toDate ? ts.toDate().getTime() : ts instanceof Date ? ts.getTime() : Number(ts) || 0);
const isoOf = (ts) => { const ms = toMs(ts); return ms ? new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : today(); };
const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const btn = (color = BLUE, solid = false) => ({
  padding: "5px 10px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em",
  border: `2px solid ${color}`, borderRadius: "7px", cursor: "pointer", background: solid ? color : "#fff", color: solid ? "#fff" : color, fontFamily: "inherit", whiteSpace: "nowrap",
});
const input = { border: "2px solid #dde3ec", borderRadius: "8px", padding: "7px 9px", fontWeight: 700, fontSize: "13px", fontFamily: "inherit", minWidth: 0, width: "100%", boxSizing: "border-box" };
const label = { fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b7a90", marginBottom: "4px" };
// Firestore takes no undefined.
const clean = (x) => JSON.parse(JSON.stringify(x));

// A season's stat line ({ passing: { YDS … } … } — a cfbdPlayers season, or
// a cfbRosters row's s) → his position's stats, then whatever else he has
// (as Admin → Instagram picks them).
function statsOfSeason(pos, season) {
  if (!season) return [];
  const has = (k) => statValue(season, k) !== "";
  const extra = seasonKeys(season).flatMap(([c, ks]) => ks.map((k) => `${c}.${k}`));
  const keys = [...new Set([...(DEFAULT_STATS[pos] || []).filter(has), ...extra.filter(has)])].slice(0, STATS_MAX);
  return keys.map((key) => ({ key, label: statLabel(key), value: statValue(season, key), season: STATS_SEASON }));
}
// His CFBD line (cfbdPlayers linked to him) → { stats, cfbdId } — the id is
// ESPN's too: the page's headshot and career path fall back on it.
async function cfbdFor(player) {
  const snap = await getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", player.id))).catch(() => null);
  const lines = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() })).filter((d) => d.mappingStatus !== "rejected");
  const best = lines.find((d) => d.seasons?.[STATS_SEASON] && d.mappingStatus === "verified") || lines.find((d) => d.seasons?.[STATS_SEASON])
    || lines.find((d) => d.mappingStatus === "verified") || lines[0] || null;
  return { stats: statsOfSeason(player.Position, best?.seasons?.[STATS_SEASON]), cfbdId: best?.id ? String(best.id) : "" };
}

// A players doc → a new entry, from what his portal fields say.
function entryFor(p, photos, stats, cfbdId = "") {
  const committed = !p.InPortal && !!p.PriorSchool && !!p.PortalCommittedAt;
  const shot = placedShots(photos)[0];
  return {
    id: p.id, slug: p.Slug || "", first: p.First || "", last: p.Last || "", pos: p.Position || "",
    status: committed ? "committed" : "entered",
    // Not in the portal (yet): projected to enter.
    projected: !committed && !p.InPortal,
    from: committed ? p.PriorSchool : p.PortalOriginalSchool || p.School || "",
    to: committed ? p.School || "" : "",
    date: isoOf(committed ? p.PortalCommittedAt : p.PortalEnteredAt),
    note: "", stats, destinations: [], prediction: "", design: "welcome", shot: shot?.url || "",
    cfbdId: cfbdId || "",
    order: 9999, addedAt: Date.now(),
  };
}

export default function AdminPortalNews({ allPlayers = [], generateSlug = null, stateNames = {}, onPlayerAdded = null }) {
  const [entries, setEntries] = useState(null); // null: loading
  const [savedJson, setSavedJson] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [schools, setSchools] = useState(undefined); // { [name]: schools doc }
  const [photos, setPhotos] = useState({}); // { [id]: playerPhotos doc | null }
  const [players, setPlayers] = useState({}); // { [id]: players doc } — added by search before allPlayers has them
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const [suggest, setSuggest] = useState("entered");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(""); // the player whose editor is open

  useEffect(() => {
    getDoc(doc(db, ...PORTAL_NEWS_DOC)).then((s) => {
      const d = s.exists() ? s.data() : null;
      const list = d?.entries || [];
      setEntries(list);
      setSavedJson(JSON.stringify(list));
      setUpdatedAt(d?.updatedAt?.toDate ? d.updatedAt.toDate() : null);
      // Entries saved before they carried a CFBD id: find it (his headshot and
      // career path fall back on it), to be kept on the next save.
      const missing = list.filter((e) => !e.cfbdId);
      if (missing.length) {
        Promise.all(missing.map((e) => cfbdFor({ id: e.id, Position: e.pos }).then((cf) => [e.id, cf.cfbdId]).catch(() => [e.id, ""])))
          .then((pairs) => {
            const found = new Map(pairs.filter(([, v]) => v));
            if (!found.size) return;
            setEntries((cur) => (cur || []).map((e) => (!e.cfbdId && found.has(e.id) ? { ...e, cfbdId: found.get(e.id) } : e)));
            setMsg(`Found CFBD ids for ${found.size} player${found.size === 1 ? "" : "s"} (for headshots and career paths) — Save & publish to keep them.`);
          });
      }
    }).catch((e) => { setEntries([]); setMsg(`Couldn't load the page's board: ${e.message}`); });
    getDocs(collection(db, "schools")).then((snap) => {
      const m = {};
      snap.docs.forEach((d) => { const x = d.data(); if (x.School) m[x.School] = x; });
      setSchools(m);
    }).catch(() => setSchools({}));
  }, []);

  // Each player's playerPhotos doc (his placed shots, for the graphic).
  const ids = useMemo(() => (entries || []).map((e) => e.id).join(","), [entries]);
  useEffect(() => {
    const want = (entries || []).map((e) => e.id).filter((id) => !(id in photos));
    if (!want.length) return;
    Promise.all(want.map((id) => getDoc(doc(db, "playerPhotos", id)).then((s) => [id, s.exists() ? s.data() : null]).catch(() => [id, null])))
      .then((pairs) => setPhotos((m) => ({ ...m, ...Object.fromEntries(pairs) })));
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => {
    const m = new Map(allPlayers.map((p) => [p.id, p]));
    Object.entries(players).forEach(([id, p]) => { if (!m.has(id)) m.set(id, p); });
    return m;
  }, [allPlayers, players]);
  const onBoard = useMemo(() => new Set((entries || []).map((e) => e.id)), [entries]);
  const dirty = entries !== null && JSON.stringify(entries) !== savedJson;

  // ── Suggestions: in the portal (newest first), recently committed, or a search ──
  const inPortal = useMemo(() => allPlayers.filter((p) => p.InPortal && !onBoard.has(p.id))
    .sort((a, b) => toMs(b.PortalEnteredAt) - toMs(a.PortalEnteredAt)), [allPlayers, onBoard]);
  const committedRecent = useMemo(() => allPlayers.filter((p) => !p.InPortal && p.PriorSchool && p.PortalCommittedAt && !onBoard.has(p.id))
    .sort((a, b) => toMs(b.PortalCommittedAt) - toMs(a.PortalCommittedAt)), [allPlayers, onBoard]);
  const searched = useMemo(() => {
    const t = norm(q).trim();
    if (t.length < 2) return [];
    return allPlayers.filter((p) => !onBoard.has(p.id) && norm(`${p.First} ${p.Last}`).includes(t)).slice(0, 25);
  }, [allPlayers, q, onBoard]);
  const shown = q.trim().length >= 2 ? searched : (suggest === "entered" ? inPortal : committedRecent).slice(0, 40);

  // ── CFB Universe: every CFBD roster (loaded the first time the tab opens) ──
  const [rosters, setRosters] = useState(null); // null: not loaded; [] : none / failed
  useEffect(() => {
    if (suggest !== "universe" || rosters) return;
    getDocs(collection(db, "cfbRosters"))
      .then((snap) => setRosters(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((err) => { setRosters([]); setMsg(`Couldn't load the CFB Universe: ${err.message}`); });
  }, [suggest, rosters]);
  const universe = useMemo(() => (rosters || []).flatMap((r) => (r.players || []).map((p) => ({
    ...p, rosterId: r.id, school: r.school, team: r.team, teamId: r.teamId, key: norm(`${p.first} ${p.last}`),
  }))), [rosters]);
  const bySlug = useMemo(() => new Map(allPlayers.filter((p) => p.Slug).map((p) => [p.Slug, p])), [allPlayers]);
  // His We-Draft profile: the one his roster row links (slug), else the same name at the same school.
  const wdOf = (u) => (u.slug && bySlug.get(u.slug)) || allPlayers.find((p) => norm(`${p.First} ${p.Last}`) === u.key && norm(p.School) === norm(u.school)) || null;
  const universeHits = useMemo(() => {
    const t = norm(q).trim();
    if (suggest !== "universe" || t.length < 2) return [];
    return universe.filter((u) => u.key.includes(t) || norm(u.school).includes(t)).slice(0, 40);
  }, [universe, q, suggest]);
  const addFromUniverse = async (u) => {
    const have = wdOf(u);
    if (have) { if (!onBoard.has(have.id)) await add(have, { cfbdId: String(u.id), season: u.s }); return; }
    if (!generateSlug) { setMsg("Adding new players needs the Admin panel (generateSlug)."); return; }
    setAdding(`u${u.id}`);
    setMsg("");
    try {
      const cu = await import("./CfbUniverseSearch");
      const pos = cu.POS_MAP[String(u.pos || "").toUpperCase()];
      if (!pos) throw new Error(`no We-Draft position for "${u.pos || "?"}" — add him from Player Data → CFB Universe`);
      let recruitYear = cu.recruitYearFor(u);
      if (!recruitYear) {
        recruitYear = (window.prompt(`CFBD has no recruit year for ${u.first} ${u.last}. His first college season (YYYY)?`) || "").trim();
        if (!/^\d{4}$/.test(recruitYear)) throw new Error("a recruit year is needed to add him");
      }
      const roster = (rosters || []).find((r) => r.id === u.rosterId) || null;
      const { player, rosterPlayers } = await cu.addRosterPlayer(u, roster, { pos, eligible: cu.eligibleFor(u), live: true, recruitYear }, { allPlayers, generateSlug, stateNames });
      if (rosterPlayers) setRosters((rs) => rs.map((r) => (r.id === u.rosterId ? { ...r, players: rosterPlayers } : r)));
      onPlayerAdded?.(player);
      setAdding("");
      await add(player, { cfbdId: String(u.id), season: u.s });
      setMsg((m) => m || `${u.first} ${u.last} is new on We-Draft (${pos}, ${u.school}) — check his profile in Players.`);
    } catch (err) {
      setMsg(`Couldn't add him from the CFB Universe: ${err.message}`);
      setAdding("");
    }
  };

  // from (CFB Universe): { cfbdId, season } — his roster row's id and season
  // line, for when his CFBD line isn't linked (or has no season) yet.
  const add = async (p, from = {}) => {
    setAdding(p.id);
    setMsg("");
    try {
      const [ph, cf] = await Promise.all([
        getDoc(doc(db, "playerPhotos", p.id)).then((s) => (s.exists() ? s.data() : null)).catch(() => null),
        cfbdFor(p),
      ]);
      setPhotos((m) => ({ ...m, [p.id]: ph }));
      setPlayers((m) => ({ ...m, [p.id]: p }));
      const stats = cf.stats.length ? cf.stats : statsOfSeason(p.Position, from.season);
      const e = entryFor(p, ph, stats, cf.cfbdId || from.cfbdId);
      setEntries((list) => {
        const n = list.filter((x) => x.status === e.status).length;
        return [...list, { ...e, order: n }];
      });
      setSelId(p.id);
      if (!placedShots(ph).length) setMsg(`${p.First} ${p.Last} has no action shot placed for First Pick yet (Content → Photos), so the page shows his headshot and stats instead of a graphic.`);
    } catch (err) {
      setMsg(`Couldn't add him: ${err.message}`);
    }
    setAdding("");
  };
  const patch = (id, fields) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...fields } : e)));
  const remove = (id) => { setEntries((list) => list.filter((e) => e.id !== id)); setSelId((s) => (s === id ? "" : s)); };
  // Projected players: the ones who've since entered the portal (his players
  // doc says InPortal) -> Entered, dated the day he went in; the rest -> off
  // the page at once (once enough real entries fill it).
  const projected = (entries || []).filter(isProjected);
  const nowIn = projected.filter((e) => byId.get(e.id)?.InPortal);
  const markEntered = (list) => {
    const ids = new Set(list.map((e) => e.id));
    setEntries((all) => all.map((e) => (ids.has(e.id) ? { ...e, projected: false, date: byId.get(e.id)?.PortalEnteredAt ? isoOf(byId.get(e.id).PortalEnteredAt) : e.date } : e)));
  };
  const removeProjected = () => {
    const ids = new Set(projected.map((e) => e.id));
    setEntries((all) => all.filter((e) => !ids.has(e.id)));
    setSelId((s) => (ids.has(s) ? "" : s));
  };
  // The order: one list for IN (in the portal), one for OUT (committed).
  // Every page — Top, each position, IN / OUT — shows its players in this
  // order (a position page is just this list, filtered). No numbers: order only.
  // Moves a player to index `to` within his list (clamped).
  // Position by position (orderPos, "" = everyone): the lists show just that
  // position's players, and moving one reorders them among themselves — they
  // keep the slots they hold in the full list, so nobody else moves. (That
  // order is the position page's order, and decides which projected players
  // are his position's top 3, the ones with a graphic.)
  const [orderPos, setOrderPos] = useState("");
  const inView = (x) => !orderPos || newsPosGroup(x.pos) === orderPos;
  const viewOf = (list, st) => newsSection(list, st).filter(inView);
  const moveTo = (id, to) => setEntries((list) => {
    const e = list.find((x) => x.id === id);
    if (!e) return list;
    const sec = newsSection(list, e.status);
    const slots = sec.map((x, k) => (inView(x) ? k : -1)).filter((k) => k >= 0);
    const group = slots.map((k) => sec[k]).filter((x) => x.id !== id);
    group.splice(Math.max(0, Math.min(group.length, to)), 0, e);
    slots.forEach((k, j) => { sec[k] = group[j]; });
    const order = new Map(sec.map((x, k) => [x.id, k]));
    return list.map((x) => (order.has(x.id) ? { ...x, order: order.get(x.id) } : x));
  });
  const indexOf = (id) => { const e = entries.find((x) => x.id === id); return viewOf(entries, e?.status).findIndex((x) => x.id === id); };
  const posCounts = useMemo(() => {
    const c = {};
    (entries || []).forEach((x) => { const g = newsPosGroup(x.pos); c[g] = (c[g] || 0) + 1; });
    return c;
  }, [entries]);
  // The projected players who get a graphic (top 3 at each position).
  const graphicIds = useMemo(() => projectedGraphicIds(entries || []), [entries]);
  const move = (id, d) => moveTo(id, d === "top" ? 0 : d === "bottom" ? Infinity : indexOf(id) + d);
  // Drag to reorder (within a list).
  const [dragId, setDragId] = useState("");
  const [overId, setOverId] = useState("");
  const dropOn = (targetId) => {
    const from = entries.find((x) => x.id === dragId);
    const target = entries.find((x) => x.id === targetId);
    if (from && target && from.status === target.status && inView(from) && inView(target) && dragId !== targetId) moveTo(dragId, indexOf(targetId));
    setDragId("");
    setOverId("");
  };
  const refreshStats = async (e) => {
    const p = byId.get(e.id);
    if (!p) return;
    const cf = await cfbdFor(p);
    patch(e.id, { stats: cf.stats.length ? cf.stats : e.stats, ...(cf.cfbdId ? { cfbdId: cf.cfbdId } : {}) });
  };

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      // Each section numbered 0… in its shown order.
      const numbered = ["entered", "committed"].flatMap((st) => newsSection(entries, st).map((e, k) => ({ ...e, order: k })));
      const out = clean(numbered.map((e) => ({
        ...e,
        to: e.status === "committed" ? e.to : "",
        projected: isProjected(e),
        destinations: (e.destinations || []).filter(Boolean).slice(0, MAX_DESTINATIONS),
        prediction: (e.destinations || []).includes(e.prediction) ? e.prediction : "",
      })));
      await setDoc(doc(db, ...PORTAL_NEWS_DOC), { entries: out, updatedAt: serverTimestamp() });
      setEntries(out);
      setSavedJson(JSON.stringify(out));
      setUpdatedAt(new Date());
      setMsg("Saved — the page shows it now.");
    } catch (err) {
      setMsg(`Couldn't save: ${err.message}${/permission/i.test(err.message) ? " (the portalNews rule may not be deployed yet)" : ""}`);
    }
    setBusy(false);
  };

  const problems = (entries || []).flatMap((e) => [
    !e.from && `${e.first} ${e.last}: the school he's leaving`,
    e.status === "committed" && !e.to && `${e.first} ${e.last}: the school he committed to`,
    !String(e.note || "").trim() && `${e.first} ${e.last}: the write-up`,
  ].filter(Boolean));

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <datalist id={SCHOOLS_LIST}>{Object.keys(schools || {}).sort().map((n) => <option key={n} value={n} />)}</datalist>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: 900, color: INK }}>Portal News <span style={{ fontSize: "12px", color: "#6b7a90" }}>· WX Page</span></div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b7a90" }}>
            Pick who's featured, write about them, save. {updatedAt ? `Last saved ${updatedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : "Not published yet — the page shows the simulation on localhost until you save."}
          </div>
        </div>
        <a href={PORTAL_NEWS_PATH} target="_blank" rel="noreferrer" style={{ ...btn(BLUE), textDecoration: "none", marginLeft: "auto" }}>View page ↗</a>
        <button type="button" onClick={save} disabled={!dirty || busy} style={{ ...btn(GREEN, true), padding: "8px 16px", fontSize: "12px", opacity: !dirty || busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : dirty ? "Save & publish" : "Saved"}
        </button>
      </div>
      {msg && <div style={{ padding: "9px 12px", borderRadius: "8px", background: "#fff8e6", border: `1px solid ${GOLD}`, fontSize: "13px", fontWeight: 700, color: "#5a3a00" }}>{msg}</div>}
      {dirty && problems.length > 0 && (
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#9a5b00" }}>Still to fill in: {problems.join(" · ")}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) 1fr", gap: "16px", alignItems: "start" }}>
        {/* ── Add players ── */}
        <div style={{ border: "1px solid #e2e7ef", borderRadius: "12px", background: "#fff", padding: "12px", position: "sticky", top: "12px" }}>
          <div style={{ fontWeight: 900, fontSize: "14px", color: INK, marginBottom: "8px" }}>Add players</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any player…" style={input} />
          {q.trim().length < 2 && (
            <div style={{ display: "flex", gap: "4px", margin: "8px 0" }}>
              <button type="button" onClick={() => setSuggest("entered")} style={btn(GOLD, suggest === "entered")}>In the portal ({inPortal.length})</button>
              <button type="button" onClick={() => setSuggest("committed")} style={btn(GREEN, suggest === "committed")}>Committed ({committedRecent.length})</button>
            </div>
          )}
          <div style={{ display: "flex", gap: "4px", margin: q.trim().length < 2 ? "0 0 8px" : "8px 0" }}>
            <button type="button" onClick={() => setSuggest((s) => (s === "universe" ? "entered" : "universe"))} style={btn(VIOLET, suggest === "universe")}>
              CFB Universe{rosters?.length ? ` · ${universe.length.toLocaleString()}` : ""}
            </button>
          </div>
          {suggest === "universe" && (
            <div style={{ display: "grid", gap: "4px", maxHeight: "560px", overflowY: "auto" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#6b7a90", padding: "0 2px 4px" }}>
                {!rosters ? "Loading every CFBD roster…" : q.trim().length < 2 ? "Search any college player (or a school) on a CFBD roster. Not on We-Draft yet? He's added to We-Draft, then here." : !universeHits.length ? "No roster player by that name." : ""}
              </div>
              {universeHits.map((u) => {
                const have = wdOf(u);
                const on = have && onBoard.has(have.id);
                return (
                  <button key={`${u.rosterId}-${u.id}`} type="button" onClick={() => addFromUniverse(u)} disabled={!!adding || on} style={{ display: "flex", alignItems: "center", gap: "8px", textAlign: "left", border: "1px solid #eef1f5", borderRadius: "8px", background: adding === `u${u.id}` ? "#f3effe" : "#fff", padding: "7px 9px", cursor: on ? "default" : "pointer", fontFamily: "inherit", opacity: on ? 0.5 : 1 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 900, fontSize: "13px", color: INK }}>{u.first} {u.last} <span style={{ color: "#8a97ab" }}>{u.pos}</span></span>
                      <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6b7a90", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {u.school}{have ? (have.InPortal ? " · in portal" : " · on We-Draft") : " · not on We-Draft yet"}
                      </span>
                    </span>
                    <span style={{ ...btn(have ? BLUE : VIOLET), padding: "3px 8px" }}>{on ? "On page" : adding === `u${u.id}` ? "…" : have ? "+ Add" : "+ New"}</span>
                  </button>
                );
              })}
            </div>
          )}
          {suggest !== "universe" && <div style={{ display: "grid", gap: "4px", maxHeight: "560px", overflowY: "auto", marginTop: q.trim().length >= 2 ? "8px" : 0 }}>
            {shown.length === 0 && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab", padding: "8px 2px" }}>{q.trim().length >= 2 ? "No one by that name (or he's already on the page)." : "No one to suggest right now."}</div>}
            {q.trim().length < 2 && <div style={{ fontSize: "11px", fontWeight: 700, color: NEWS_STATUS.projected.ink, padding: "2px 2px 6px" }}>Search a player who isn't in the portal yet to add him as <b>Projected</b>.</div>}
            {shown.map((p) => {
              const committed = !p.InPortal && p.PriorSchool && p.PortalCommittedAt;
              const when = committed ? toMs(p.PortalCommittedAt) : toMs(p.PortalEnteredAt);
              return (
                <button key={p.id} type="button" onClick={() => add(p)} disabled={!!adding} style={{ display: "flex", alignItems: "center", gap: "8px", textAlign: "left", border: "1px solid #eef1f5", borderRadius: "8px", background: adding === p.id ? "#eef5ff" : "#fff", padding: "7px 9px", cursor: "pointer", fontFamily: "inherit" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 900, fontSize: "13px", color: INK }}>{p.First} {p.Last} <span style={{ color: "#8a97ab" }}>{p.Position}</span></span>
                    <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#6b7a90", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {committed ? `${p.PriorSchool} → ${p.School}` : p.InPortal ? `${p.PortalOriginalSchool || p.School} · in portal` : `${p.School || ""} · adds as projected`}{when ? ` · ${fmt(when)}` : ""}
                    </span>
                  </span>
                  <span style={{ ...btn(BLUE), padding: "3px 8px" }}>{adding === p.id ? "…" : "+ Add"}</span>
                </button>
              );
            })}
          </div>}
        </div>

        {/* ── The page's players: the two ordered lists, then the one being edited ── */}
        <div style={{ display: "grid", gap: "14px", minWidth: 0 }}>
          {entries === null ? <div style={{ color: "#8a97ab", fontWeight: 800 }}>Loading…</div>
            : !entries.length ? (
              <div style={{ border: "2px dashed #d5dbe4", borderRadius: "12px", padding: "26px", textAlign: "center", fontWeight: 700, color: "#6b7a90" }}>
                No players yet. Add some from the left — players in the portal go in the IN list, committed ones in OUT. Search anyone who isn't in the portal yet to add him as Projected.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                  <span style={{ ...label, marginBottom: 0, marginRight: "4px" }}>Order</span>
                  {["", ...NEWS_POSITIONS].map((p) => (
                    <button key={p || "all"} type="button" onClick={() => setOrderPos(p)} disabled={!!p && !posCounts[p]}
                      style={{ ...btn(BLUE, orderPos === p), padding: "4px 8px", opacity: p && !posCounts[p] ? 0.35 : 1 }}>
                      {p || "All"}{p && posCounts[p] ? ` ${posCounts[p]}` : ""}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#6b7a90" }}>
                  {orderPos
                    ? `${orderPos} only: drag (or ↑ ↓) to set the /portal/news/${orderPos.toLowerCase()} order. ${orderPos}s swap places among themselves; everyone else stays where they are in the full list. The top 3 projected ${orderPos}s get a graphic.`
                    : "Drag a player (or use ↑ ↓) to set the order. The same order is used on every page: Top, each position, IN and OUT. Pick a position above to order just that position."}
                  {" "}Click a player to edit him.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "12px", alignItems: "start" }}>
                  {["entered", "committed"].map((st) => {
                    const all = newsSection(entries, st);
                    const sec = all.filter(inView);
                    const S = NEWS_STATUS[st];
                    return (
                      <div key={st} style={{ border: "1px solid #e2e7ef", borderTop: `4px solid ${S.c1}`, borderRadius: "12px", background: "#fff", overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", background: S.tint, fontWeight: 900, fontSize: "13px", color: S.ink, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          <span style={{ background: S.c1, color: "#fff", borderRadius: "5px", padding: "1px 6px", fontSize: "10px", letterSpacing: "0.08em" }}>{st === "entered" ? "IN" : "OUT"}</span>
                          {S.section} ({st === "entered" ? inPortalCount(sec) : sec.length}){orderPos && <span style={{ color: "#8a97ab" }}>· {orderPos}</span>}
                          {st === "entered" && projected.length > 0 && (
                            <span style={{ marginLeft: "auto", display: "flex", gap: "4px", alignItems: "center", textTransform: "none", letterSpacing: 0 }}>
                              {nowIn.length > 0 && (
                                <button type="button" title={`In the portal now: ${nowIn.map((e) => `${e.first} ${e.last}`).join(", ")}`} onClick={() => markEntered(nowIn)} style={{ ...btn(GOLD, true), padding: "3px 7px", fontSize: "10px" }}>
                                  Mark {nowIn.length} entered
                                </button>
                              )}
                              <button type="button" onClick={() => { if (window.confirm(`Take all ${projected.length} projected player${projected.length === 1 ? "" : "s"} off Portal News?${nowIn.length ? ` (${nowIn.length} of them ${nowIn.length === 1 ? "is" : "are"} in the portal now: "Mark entered" first to keep ${nowIn.length === 1 ? "him" : "them"}.)` : ""}`)) removeProjected(); }}
                                style={{ ...btn(VIOLET), padding: "3px 7px", fontSize: "10px" }}>
                                Remove {projected.length} projected
                              </button>
                            </span>
                          )}
                        </div>
                        {st === "entered" && projected.length > 0 && (
                          <div style={{ padding: "5px 12px", fontSize: "11px", fontWeight: 700, color: NEWS_STATUS.projected.ink, background: NEWS_STATUS.projected.tint, borderTop: "1px solid #eee8fb" }}>
                            {projected.length} projected (not in the portal yet) · {all.length - projected.length} actually in · not counted in IN
                          </div>
                        )}
                        {!sec.length && <div style={{ padding: "14px 12px", fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>{orderPos ? `No ${orderPos}s here.` : "No one yet — this section is hidden on the page."}</div>}
                        {sec.map((e, i) => (
                          <OrderRow key={e.id} e={e} graphic={!isProjected(e) || graphicIds.has(e.id)} nowIn={isProjected(e) && !!byId.get(e.id)?.InPortal} first={i === 0} last={i === sec.length - 1} photos={photos[e.id]} schools={schools}
                            selected={selId === e.id} dragging={dragId === e.id} over={overId === e.id && dragId && dragId !== e.id}
                            onSelect={() => setSelId(e.id)} move={(d) => move(e.id, d)}
                            onDragStart={() => setDragId(e.id)} onDragEnd={() => { setDragId(""); setOverId(""); }}
                            onDragOver={(ev) => { if (dragId && entries.find((x) => x.id === dragId)?.status === st) { ev.preventDefault(); if (overId !== e.id) setOverId(e.id); } }}
                            onDrop={(ev) => { ev.preventDefault(); dropOn(e.id); }} />
                        ))}
                      </div>
                    );
                  })}
                </div>
                {(() => {
                  const e = entries.find((x) => x.id === selId);
                  if (!e) return <div style={{ border: "2px dashed #e2e7ef", borderRadius: "12px", padding: "18px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Click a player above to edit him.</div>;
                  return (
                    <EntryEditor key={e.id} e={e} noGraphic={isProjected(e) && !graphicIds.has(e.id)} player={byId.get(e.id)} photos={photos[e.id]} schools={schools}
                      patch={(f) => patch(e.id, f)} remove={() => remove(e.id)} close={() => setSelId("")} refreshStats={() => refreshStats(e)} />
                  );
                })()}
              </>
            )}
        </div>
      </div>
    </div>
  );
}

// One player in his list: drag him (anywhere on the row) or nudge him ↑ ↓;
// click to edit. What's still missing shows at a glance.
function OrderRow({ e, graphic = true, nowIn = false, first, last, photos, schools, selected, dragging, over, onSelect, move, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const committed = e.status === "committed";
  // Ours, else ESPN's by his CFBD id (a player new from the CFB Universe).
  const head = photos?.headshot?.url || (e.cfbdId ? `https://a.espncdn.com/i/headshots/college-football/players/full/${e.cfbdId}.png` : "");
  const logo = (n) => schools?.[n]?.Logo1 || schools?.[n]?.LogoDark || "";
  const needs = [!String(e.note || "").trim() && "write-up", photos !== undefined && !placedShots(photos).length && "placed shot", committed && !e.to && "new school"].filter(Boolean);
  const arrow = (d, label, off) => (
    <button type="button" title={d < 0 ? "Up one" : "Down one"} disabled={off} onClick={(ev) => { ev.stopPropagation(); move(d); }}
      style={{ width: "24px", height: "22px", padding: 0, border: "1px solid #dde3ec", borderRadius: "6px", background: "#fff", color: "#5b6b84", fontWeight: 900, fontSize: "12px", cursor: off ? "default" : "pointer", opacity: off ? 0.3 : 1 }}>{label}</button>
  );
  return (
    <div role="button" tabIndex={0} draggable onClick={onSelect} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(); } }}
      onDragStart={(ev) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", e.id); onDragStart(); }} onDragEnd={onDragEnd}
      onDragOver={onDragOver} onDrop={onDrop}
      title={`${e.first} ${e.last} — click to edit, drag to reorder`}
      style={{
        display: "flex", alignItems: "center", gap: "9px", padding: "8px 10px", cursor: "grab", userSelect: "none",
        borderTop: over ? `3px solid ${BLUE}` : "1px solid #eef1f5", background: selected ? "#eef5ff" : isProjected(e) ? "#fbf9ff" : "#fff",
        boxShadow: selected ? `inset 4px 0 0 ${BLUE}` : "none", opacity: dragging ? 0.4 : 1,
      }}>
      <span aria-hidden="true" style={{ color: "#a3acba", fontSize: "15px", lineHeight: 1 }}>⠿</span>
      <span style={{ width: "32px", height: "32px", flexShrink: 0, borderRadius: "50%", overflow: "hidden", background: "#eef1f5", display: "grid", placeItems: "center", fontSize: "11px", fontWeight: 900, color: "#6b7a90" }}>
        {head ? <img src={head} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} /> : `${e.first[0] || ""}${e.last[0] || ""}`}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 900, fontSize: "13px", color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {e.first} {e.last} <span style={{ color: "#8a97ab" }}>{e.pos}</span>
          {isProjected(e) && <span style={{ marginLeft: "6px", border: `1.5px dashed ${VIOLET}`, color: NEWS_STATUS.projected.ink, background: NEWS_STATUS.projected.tint, borderRadius: "5px", padding: "0 5px", fontSize: "9px", letterSpacing: "0.08em", verticalAlign: "1px" }}>PROJECTED</span>}
          {isProjected(e) && <span title={graphic ? "Top 3 projected at his position: gets a graphic" : "Past his position's top 3 projected: headshot + stats, no graphic"} style={{ marginLeft: "4px", color: graphic ? GREEN : "#8a97ab", fontSize: "9px", letterSpacing: "0.06em", verticalAlign: "1px" }}>{graphic ? "GRAPHIC" : "HEADSHOT"}</span>}
        </span>
        {nowIn && <span style={{ display: "block", fontSize: "10px", fontWeight: 900, color: "#b7791f" }}>In the portal now — mark him Entered</span>}
        <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: "#6b7a90", whiteSpace: "nowrap", overflow: "hidden" }}>
          {logo(e.from) && <img src={logo(e.from)} alt="" draggable={false} style={{ width: "14px", height: "14px", objectFit: "contain" }} />}{e.from}
          {committed ? <> → {logo(e.to) && <img src={logo(e.to)} alt="" draggable={false} style={{ width: "14px", height: "14px", objectFit: "contain" }} />}<b style={{ color: INK }}>{e.to || "?"}</b></>
            : e.prediction ? <span style={{ color: "#9a5b00" }}> · ★ {e.prediction}</span> : null}
        </span>
        {needs.length > 0 && <span style={{ display: "block", fontSize: "10px", fontWeight: 900, color: "#b7791f", letterSpacing: "0.02em" }}>Needs: {needs.join(", ")}</span>}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {arrow(-1, "↑", first)}
        {arrow(1, "↓", last)}
      </span>
    </div>
  );
}

// One player: his graphic (live), then everything about him on the page.
function EntryEditor({ e, noGraphic = false, player, photos, schools, patch, remove, close, refreshStats }) {
  const committed = e.status === "committed";
  const fromDoc = schools === undefined ? undefined : schools[e.from] || null;
  const toDoc = schools === undefined ? undefined : committed ? schools[e.to] || null : null;
  const g = usePortalCover({ entry: e, photos, player: player === undefined ? null : player, from: fromDoc, to: toDoc });
  const shots = placedShots(photos);
  const known = (n) => !n || !schools || !!schools[n];
  const dest = [...(e.destinations || []), "", "", ""].slice(0, MAX_DESTINATIONS);
  const setDest = (i, v) => {
    const next = dest.map((x, k) => (k === i ? v : x));
    patch({ destinations: next, prediction: next.includes(e.prediction) ? e.prediction : "" });
  };
  const proj = isProjected(e);
  // Entered <-> Projected keeps his place in the IN list; Committed moves him to OUT.
  const setStatus = (st) => {
    if (st === "projected" || st === "entered") {
      if (e.status === "entered") { if (proj !== (st === "projected")) patch({ projected: st === "projected" }); return; }
      patch({ status: "entered", projected: st === "projected", order: 9999 });
      return;
    }
    if (st === e.status) return;
    patch({ status: st, projected: false, to: e.to || e.prediction || "", order: 9999 });
  };
  const s = newsStatusOf(e);
  const warn = (t) => <div style={{ fontSize: "11px", fontWeight: 700, color: "#b7791f", marginTop: "2px" }}>{t}</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: "14px", border: "1px solid #e2e7ef", borderLeft: `5px solid ${s.c1}`, borderRadius: "12px", background: "#fff", padding: "12px" }}>
      {/* His graphic, as the page draws it. */}
      <div>
        <div style={{ width: "170px", aspectRatio: "1080 / 1350", borderRadius: "8px", overflow: "hidden", background: "#0b1a33", display: "grid", placeItems: "center" }}>
          {g.src ? <img src={g.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ fontSize: "10px", fontWeight: 900, color: "#8aa0bf", textAlign: "center", padding: "8px" }}>{g.failed ? "No placed shot" : "Drawing…"}</span>}
        </div>
        {shots.length > 1 && (
          <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
            {shots.map((a, i) => (
              <button key={a.url} type="button" onClick={() => patch({ shot: a.url })} title={`Placed shot ${i + 1}`} style={{ width: "38px", height: "48px", padding: "1px", borderRadius: "5px", cursor: "pointer", background: "#fff", border: `2px solid ${(e.shot || shots[0].url) === a.url ? BLUE : "#e3e8ef"}` }}>
                <img src={a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "3px" }} />
              </button>
            ))}
          </div>
        )}
        {photos !== undefined && !shots.length && warn("Place an action shot for First Pick (Content → Photos) for his graphic.")}
        {noGraphic && <div style={{ fontSize: "11px", fontWeight: 700, color: NEWS_STATUS.projected.ink, marginTop: "4px" }}>Not in the top 3 projected at his position: the page shows his headshot and stats, not this graphic.</div>}
      </div>

      <div style={{ display: "grid", gap: "10px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, fontSize: "17px", color: INK }}>{e.first} {e.last} <span style={{ color: "#8a97ab", fontSize: "13px" }}>{e.pos}</span></div>
          <span style={{ fontSize: "11px", fontWeight: 800, color: "#6b7a90" }}>{eligibilityText(player, seasonsLeft)}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
            <button type="button" onClick={() => { if (window.confirm(`Take ${e.first} ${e.last} off Portal News?`)) remove(); }} style={btn("#c0392b")}>Remove</button>
            <button type="button" onClick={close} title="Close" style={btn("#6b7a90")}>Done</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 150px", gap: "8px", alignItems: "end" }}>
          <div>
            <div style={label}>Status</div>
            <div style={{ display: "flex", gap: "4px" }}>
              <button type="button" onClick={() => setStatus("entered")} style={btn(GOLD, !committed && !proj)}>Entered</button>
              <button type="button" onClick={() => setStatus("projected")} title="Not in the portal yet: expected to enter" style={btn(VIOLET, proj)}>Projected</button>
              <button type="button" onClick={() => setStatus("committed")} style={btn(GREEN, committed)}>Committed</button>
            </div>
          </div>
          <div>
            <div style={label}>Leaving</div>
            <input list={SCHOOLS_LIST} value={e.from} onChange={(x) => patch({ from: x.target.value })} style={input} />
            {!known(e.from) && warn("Not a We-Draft school: no logo or colors.")}
          </div>
          <div>
            <div style={label}>{committed ? "Committed to" : "Committed to (once he does)"}</div>
            <input list={SCHOOLS_LIST} value={committed ? e.to : ""} disabled={!committed} onChange={(x) => patch({ to: x.target.value })} placeholder={committed ? "Pick a school…" : "—"} style={{ ...input, opacity: committed ? 1 : 0.5 }} />
            {committed && !known(e.to) && warn("Not a We-Draft school: no logo or colors.")}
          </div>
          <div>
            <div style={label}>{committed ? "Committed on" : proj ? "Added on" : "Entered on"}</div>
            <input type="date" value={e.date || ""} onChange={(x) => patch({ date: x.target.value })} style={input} />
          </div>
        </div>

        <div>
          <div style={label}>Editorial · a blank line starts a new paragraph</div>
          <textarea value={e.note || ""} onChange={(x) => patch({ note: x.target.value })} rows={5}
            placeholder={committed ? `What ${e.to || "his new school"} is getting, and what it means…` : "Why he matters, and where he could land…"}
            style={{ ...input, fontWeight: 600, lineHeight: 1.5, resize: "vertical" }} />
        </div>

        {committed ? (
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <div style={label}>Graphic</div>
              <div style={{ display: "flex", gap: "4px" }}>
                {TRANSFER_DESIGNS.map(([v, t]) => <button key={v} type="button" onClick={() => patch({ design: v })} style={btn(BLUE, (e.design || "welcome") === v)}>{t}</button>)}
              </div>
            </div>
            <StatsLine e={e} refreshStats={refreshStats} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: "8px" }}>
            <div>
              <div style={label}>Potential destinations · shown in place of his stats · ★ = We-Draft.com prediction</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${MAX_DESTINATIONS}, minmax(0, 1fr))`, gap: "8px" }}>
                {dest.map((d, i) => {
                  const pick = !!d && e.prediction === d;
                  return (
                    <div key={i} style={{ border: `2px solid ${pick ? GOLD : "#eef1f5"}`, background: pick ? "#fff8e6" : "#fff", borderRadius: "10px", padding: "6px" }}>
                      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                        {schools?.[d]?.Logo1 && <img src={schools[d].Logo1} alt="" style={{ width: "24px", height: "24px", objectFit: "contain", flexShrink: 0 }} />}
                        <input list={SCHOOLS_LIST} value={d} onChange={(x) => setDest(i, x.target.value)} placeholder={`Destination ${i + 1}`} style={{ ...input, padding: "6px 7px" }} />
                      </div>
                      <button type="button" disabled={!d} onClick={() => patch({ prediction: pick ? "" : d })}
                        style={{ ...btn(GOLD, pick), width: "100%", marginTop: "5px", padding: "4px 6px", fontSize: "10px", opacity: d ? 1 : 0.4 }}>
                        {pick ? "★ Our prediction" : "☆ Make prediction"}
                      </button>
                      {d && !known(d) && warn("Not a We-Draft school.")}
                    </div>
                  );
                })}
              </div>
            </div>
            <StatsLine e={e} refreshStats={refreshStats} note="on his card's back" />
          </div>
        )}
      </div>
    </div>
  );
}

function StatsLine({ e, refreshStats, note = "" }) {
  const list = (e.stats || []).filter((s) => s.value !== "" && s.value != null);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={label}>{STATS_SEASON} stats{note ? ` · ${note}` : ""}</div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "12px", fontWeight: 800, color: "#3a4352" }}>
        {list.length ? list.map((s) => <span key={s.key} style={{ background: "#f3f6fa", borderRadius: "6px", padding: "3px 7px" }}>{s.value} <span style={{ color: "#8a97ab" }}>{s.label}</span></span>)
          : <span style={{ color: "#8a97ab" }}>None on file (no linked CFBD line)</span>}
        <button type="button" onClick={refreshStats} style={{ ...btn("#6b7a90"), padding: "3px 8px" }}>Refresh</button>
      </div>
    </div>
  );
}
