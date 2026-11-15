// src/components/AdminPortalGrades.jsx
//
// Admin → Players → Transfer Portal → Grades: the transfer grader. Every
// college player with eligibility left after this season, with what goes
// into a grade side by side — We-Draft community draft grade, CFBD season
// stats, PFF grade + snaps (admin only), high school ranking, seasons left,
// school — and the auto grade the rules give (utils/portalStars.mjs,
// built by server/portal/stars.js).
//
// The admin grades each player once: lock in the auto grade (✓) or pick
// one (6–2). A graded player leaves the "To Grade" list and lives under
// "Locked In", where he can be changed or unlocked. Separately, a transfer
// likeliness (0–3) feeds the Portal Sim's entry model (portalSim/config.js
// likeliness): 3 almost always enters, 2 less, 1 even less, 0 never; none =
// the model alone. Setting likeliness doesn't lock a grade.
//
// Storage: config/portalGrades { rows: { [cfbdId | "wd:"+wdId]: code } }
// (portalStars.mjs encodeGrade — one short string each, so every player fits
// one doc; the Portal Sim reads it live). The old portalStars/_overrides
// carry over once as hand-set locks.
//
// Reads: portalStars (one doc per team), config/portalGrades, pffGrades
// (admin-only — components/pffData.js), compSnapshots/_grades (community
// grades). allPlayers (the Admin Panel's players) supplies slugs, We-Draft
// players with no roster row and who's in the portal.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, FieldPath, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { currentDraftClass } from "../utils/eligibility";
import { gradeLabel, gradeLook } from "../utils/gradeScale";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { BASIS, LIKELY_LABELS, PFF_MIN_SNAPS, PFF_REVIEW, PFF_SOLID, decodeGrade, encodeGrade } from "../utils/portalStars.mjs";
import { loadPffByCfbdId } from "./pffData";
import TransferStars from "./TransferStars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0f1b2d";
const GREEN = "#2e7d32";
const PAGE = 100;
const STARS = [6, 5, 4, 3, 2];
const LIKELY = [0, 1, 2, 3];
const LIKELY_COLOR = { 0: "#5b6b84", 1: "#2e7d32", 2: "#b45309", 3: "#c62828" };
const COLS = "minmax(170px, 1.5fr) 44px minmax(110px, 1fr) 38px 74px 78px minmax(170px, 1.4fr) 92px 112px 236px 132px";
const POS_GROUPS = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K/P"];
const POS_OF = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", OL: "OL", OT: "OL", OG: "OL", G: "OL", C: "OL", T: "OL", IOL: "OL", DE: "DL", EDGE: "DL", DT: "DL", NT: "DL", DL: "DL", LB: "LB", OLB: "LB", ILB: "LB", MLB: "LB", DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB", K: "K/P", PK: "K/P", P: "K/P", LS: "K/P" };
const SORTS = { auto: "Auto grade", comm: "Community grade", pff: "PFF grade", hs: "HS rank", name: "Name", team: "School" };

const btn = (on, color = BLUE) => ({
  padding: "6px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "8px", cursor: "pointer", background: on ? color : "#fff", color: on ? "#fff" : color, whiteSpace: "nowrap", fontFamily: "inherit",
});
const sel = { border: "2px solid #ddd", borderRadius: "8px", padding: "8px", fontWeight: 800, fontSize: "12px", fontFamily: "inherit" };
const chip = (on, color) => ({
  width: 28, height: 26, borderRadius: "6px", border: `2px solid ${on ? color : "#d5dce6"}`, background: on ? color : "#fff",
  color: on ? "#fff" : "#5b6b84", fontWeight: 900, fontSize: "12px", cursor: "pointer", fontFamily: "inherit", padding: 0,
});

export default function AdminPortalGrades({ allPlayers = [] }) {
  const [teams, setTeams] = useState(null); // [{ id, school, rows }]
  const [wedraft, setWedraft] = useState({});
  const [locks, setLocks] = useState({}); // key → code
  const [meta, setMeta] = useState(null);
  const [pff, setPff] = useState(null);
  const [comm, setComm] = useState({}); // wdId → community grade avg
  const [message, setMessage] = useState(null); // { text, bad, undo }
  const [rebuilding, setRebuilding] = useState(false);
  const [saving, setSaving] = useState(() => new Set());

  const [view, setView] = useState("todo"); // todo | locked
  const [q, setQ] = useState("");
  const [starF, setStarF] = useState(0);
  const [basisF, setBasisF] = useState("");
  const [teamF, setTeamF] = useState("");
  const [posF, setPosF] = useState("");
  const [eligF, setEligF] = useState(0);
  const [likelyF, setLikelyF] = useState(""); // "" | none | 0..3
  const [only, setOnly] = useState(""); // "" | review | portal | wedraft
  const [sort, setSort] = useState("auto");
  const [shown, setShown] = useState(PAGE);

  const load = async () => {
    setTeams(null);
    const [snap, lockSnap] = await Promise.all([getDocs(collection(db, "portalStars")), getDoc(doc(db, "config", "portalGrades"))]);
    const list = [];
    let legacy = {};
    snap.docs.forEach((d) => {
      const x = d.data();
      if (d.id === "_overrides") legacy = x.rows || {};
      else if (d.id === "_wedraft") setWedraft(x.rows || {});
      else if (d.id === "_meta") setMeta(x);
      else list.push({ id: d.id, school: x.school || x.team || d.id, rows: x.rows || {} });
    });
    let rows = lockSnap.data()?.rows || {};
    // One time: the old overrides become hand-set locks.
    if (!lockSnap.data()?.migrated) {
      const carried = {};
      Object.entries(legacy).forEach(([k, v]) => { if (v?.s && !rows[k]) carried[k] = encodeGrade({ s: v.s, auto: false }); });
      await setDoc(doc(db, "config", "portalGrades"), { rows: carried, migrated: true }, { merge: true });
      rows = { ...rows, ...carried };
    }
    setLocks(rows);
    setTeams(list.sort((a, b) => a.school.localeCompare(b.school)));
  };
  useEffect(() => { load().catch((e) => { console.error("Portal grades load error:", e); setMessage({ text: `Load failed: ${e.message}`, bad: true }); setTeams([]); }); }, []);
  useEffect(() => { loadPffByCfbdId().then(setPff); }, []);
  useEffect(() => {
    getSiteSnapshot("_grades").then((s) => {
      const out = {};
      Object.entries(s?.rows || {}).forEach(([id, r]) => { if (r?.[0] != null) out[id] = Number(r[0]); });
      setComm(out);
    }).catch(() => {});
  }, []);

  const wdById = useMemo(() => new Map(allPlayers.map((p) => [p.id, p])), [allPlayers]);
  const pastClass = (wdId) => {
    const e = parseInt(wdById.get(wdId)?.Eligible, 10);
    return !!e && e < Number(currentDraftClass());
  };

  // Every player with eligibility left: roster rows, plus We-Draft players
  // no roster carries (seasons left unknown).
  const rows = useMemo(() => {
    if (!teams) return [];
    const out = [];
    teams.forEach((t) => Object.entries(t.rows).forEach(([cfbdId, r]) => {
      const [auto, basis, review, name, pos, wdId, elig, rStars, rRank, stats] = r;
      if (wdId && pastClass(wdId)) return;
      if (elig === 0) return; // out of eligibility
      out.push({ key: cfbdId, cfbdId, wdId: wdId || "", name, pos, group: POS_OF[String(pos || "").toUpperCase()] || "", team: t.school, auto, basis, review: !!review,
        elig: elig ?? null, rStars: rStars || 0, rRank: rRank || 0, stats: stats || "" });
    }));
    Object.entries(wedraft).forEach(([wdId, [auto, basis, cfbdId]]) => {
      if (cfbdId) return;
      const p = wdById.get(wdId);
      if (!p || pastClass(wdId)) return;
      out.push({ key: `wd:${wdId}`, cfbdId: "", wdId, name: `${p.First || ""} ${p.Last || ""}`.trim(), pos: p.Position || "", group: POS_OF[String(p.Position || "").toUpperCase()] || "",
        team: p.School || "", auto, basis, review: false, elig: null, rStars: 0, rRank: 0, stats: "" });
    });
    return out;
  }, [teams, wedraft, wdById]); // eslint-disable-line react-hooks/exhaustive-deps

  const gradeOf = (r) => decodeGrade(locks[r.key]);
  const counts = useMemo(() => {
    const c = { todo: 0, locked: 0, stars: { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0 }, likely: 0, review: 0 };
    rows.forEach((r) => {
      const g = decodeGrade(locks[r.key]);
      if (g.s) c.locked += 1; else c.todo += 1;
      if (g.l != null) c.likely += 1;
      if ((view === "locked") === !!g.s) c.stars[g.s || r.auto] = (c.stars[g.s || r.auto] || 0) + 1;
      if (!g.s && r.review) c.review += 1;
    });
    return c;
  }, [rows, locks, view]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pffG = (r) => pff?.get(r.cfbdId)?.g ?? -1;
    const commG = (r) => (r.wdId && comm[r.wdId] != null ? comm[r.wdId] : 99);
    const cmp = {
      auto: (a, b) => (gradeOf(b).s || b.auto) - (gradeOf(a).s || a.auto) || commG(a) - commG(b) || pffG(b) - pffG(a),
      comm: (a, b) => commG(a) - commG(b) || pffG(b) - pffG(a),
      pff: (a, b) => pffG(b) - pffG(a),
      hs: (a, b) => (a.rRank || 1e9) - (b.rRank || 1e9) || b.rStars - a.rStars,
      name: () => 0,
      team: (a, b) => a.team.localeCompare(b.team),
    }[sort];
    return rows.filter((r) => {
      const g = gradeOf(r);
      if ((view === "locked") !== !!g.s) return false;
      if (starF && (g.s || r.auto) !== starF) return false;
      if (basisF && r.basis !== basisF) return false;
      if (teamF && r.team !== teamF) return false;
      if (posF && r.group !== posF) return false;
      if (eligF && r.elig !== eligF) return false;
      if (likelyF === "none" ? g.l != null : likelyF !== "" && g.l !== Number(likelyF)) return false;
      if (only === "review" && !r.review) return false;
      if (only === "wedraft" && !r.wdId) return false;
      if (only === "portal" && !(r.wdId && wdById.get(r.wdId)?.InPortal)) return false;
      if (needle && !`${r.name} ${r.team} ${r.pos}`.toLowerCase().includes(needle)) return false;
      return true;
    }).sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name));
  }, [rows, locks, view, q, starF, basisF, teamF, posF, eligF, likelyF, only, sort, pff, comm, wdById]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShown(PAGE); }, [view, q, starF, basisF, teamF, posF, eligF, likelyF, only, sort]);

  // Write codes for some players at once: { key: code | null }.
  const save = async (changes, note) => {
    const keys = Object.keys(changes);
    const before = Object.fromEntries(keys.map((k) => [k, locks[k] ?? null]));
    setSaving((s) => new Set([...s, ...keys]));
    setLocks((l) => { const n = { ...l }; keys.forEach((k) => { if (changes[k]) n[k] = changes[k]; else delete n[k]; }); return n; });
    try {
      const ref = doc(db, "config", "portalGrades");
      const sets = Object.fromEntries(keys.filter((k) => changes[k]).map((k) => [k, changes[k]]));
      if (Object.keys(sets).length) await setDoc(ref, { rows: sets }, { merge: true });
      const dels = keys.filter((k) => !changes[k]);
      if (dels.length) await updateDoc(ref, ...dels.flatMap((k) => [new FieldPath("rows", k), deleteField()]));
      if (note) setMessage({ text: note, undo: before });
    } catch (e) {
      console.error("Grade save error:", e);
      setLocks((l) => { const n = { ...l }; keys.forEach((k) => { if (before[k]) n[k] = before[k]; else delete n[k]; }); return n; });
      setMessage({ text: "Save failed — check console.", bad: true });
    } finally {
      setSaving((s) => { const n = new Set(s); keys.forEach((k) => n.delete(k)); return n; });
    }
  };
  const lockGrade = (r, s, auto) => {
    const g = gradeOf(r);
    const code = encodeGrade({ s, auto, l: g.l });
    save({ [r.key]: code }, s
      ? `${r.name} locked in at ${s}★${auto ? " (auto)" : ""}.`
      : `${r.name} unlocked — back in To Grade.`);
  };
  const setLikely = (r, l) => {
    const g = gradeOf(r);
    save({ [r.key]: encodeGrade({ s: g.s, auto: g.auto, l }) });
  };
  const lockPage = () => {
    const page = filtered.slice(0, shown);
    if (!page.length || !window.confirm(`Lock in the auto grade for all ${page.length} players shown?`)) return;
    save(Object.fromEntries(page.map((r) => [r.key, encodeGrade({ s: r.auto, auto: true, l: gradeOf(r).l })])), `Locked in the auto grade for ${page.length} players.`);
  };
  const undo = () => { if (message?.undo) { const u = message.undo; setMessage(null); save(u); } };

  const rebuild = async () => {
    setRebuilding(true); setMessage(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/portal-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "stars" }) });
      if (r.status === 404) throw new Error("the endpoint runs on the live site. Locally: node --env-file=.env scripts/buildPortalStars.js");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setMessage({ text: `Rebuilt auto grades for ${j.players} players · 6★ ${j.byStars?.[6]} · 5★ ${j.byStars?.[5]} · 4★ ${j.byStars?.[4]} · ${j.review} to review. Locks kept.` });
      await load();
    } catch (e) {
      setMessage({ text: `Rebuild failed: ${e.message}`, bad: true });
    } finally {
      setRebuilding(false);
    }
  };

  const teamNames = useMemo(() => [...new Set(rows.map((r) => r.team).filter(Boolean))].sort(), [rows]);
  const builtAt = meta?.builtAt?.toDate?.();
  const needsRebuild = teams && rows.length && rows.every((r) => r.elig == null);
  const anyFilter = q || starF || basisF || teamF || posF || eligF || likelyF !== "" || only;

  return (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      {/* How grades are made. */}
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", marginBottom: "14px" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Transfer Grader</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700 }}>
            {builtAt ? `Auto grades built ${builtAt.toLocaleString()}` : ""}{meta?.season ? ` · ${meta.season} rosters · players with eligibility left after ${meta.season}` : ""}
          </div>
          <button type="button" onClick={rebuild} disabled={rebuilding} style={{ ...btn(true, GOLD), marginLeft: "auto", opacity: rebuilding ? 0.6 : 1 }}>{rebuilding ? "Rebuilding…" : "Rebuild auto"}</button>
        </div>
        <div style={{ padding: "12px 16px", background: "#fff", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px 18px", fontSize: "12px", fontWeight: 700, color: "#444" }}>
          {[
            [6, "Draft grade Early First"],
            [5, "Draft grade Middle or Late First"],
            [4, "Draft grade Rounds 2–7 · 5★ / top-100 recruit floor"],
            [3, `Solid — UDFA draft grade, PFF ≥ ${PFF_SOLID} on real snaps, solid stats · 4★ recruit floor`],
            [2, "Everyone else"],
          ].map(([s, text]) => (
            <div key={s} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <TransferStars stars={s} size="sm" />
              <span>{text}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 16px", background: "#f7f9fc", borderTop: "1px solid #eef1f5", fontSize: "11px", fontWeight: 700, color: "#7a8594", lineHeight: 1.6 }}>
          ✓ locks in the auto grade; 6–2 sets it by hand. Either way the player moves to Locked In. PFF counts on {Object.entries(PFF_MIN_SNAPS).map(([k, v]) => `${v} ${k}`).join(", ")} snaps; no draft grade but PFF ≥ {PFF_REVIEW} on double → Needs Review.
          <br />Likeliness (Portal Sim): <b style={{ color: LIKELY_COLOR[3] }}>3</b> almost always enters · <b style={{ color: LIKELY_COLOR[2] }}>2</b> less · <b style={{ color: LIKELY_COLOR[1] }}>1</b> even less · <b style={{ color: LIKELY_COLOR[0] }}>0</b> never · blank = the sim's model alone. It doesn't lock the grade.
        </div>
      </div>

      {needsRebuild && (
        <div style={{ marginBottom: "12px", padding: "10px 14px", borderRadius: "8px", background: "#fff7e6", border: "2px solid #f6a21d", color: "#8a5a00", fontSize: "12px", fontWeight: 800 }}>
          Seasons left, HS rank and stats come with the next auto rebuild (Rebuild auto, or node --env-file=.env scripts/buildPortalStars.js). Until then every player shows, including ones out of eligibility.
        </div>
      )}

      {/* To Grade / Locked In. */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        {[["todo", "To Grade", counts.todo], ["locked", "Locked In", counts.locked]].map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => { setView(k); setStarF(0); }} style={{ ...btn(view === k), padding: "10px 18px", fontSize: "13px" }}>
            {label} <span style={{ opacity: 0.8 }}>· {teams ? n.toLocaleString() : "…"}</span>
          </button>
        ))}
        <span style={{ alignSelf: "center", marginLeft: "auto", fontSize: "11px", fontWeight: 800, color: "#7a8594" }}>
          {teams ? `${counts.likely.toLocaleString()} with likeliness set` : ""}
        </span>
      </div>

      {/* Star counts (auto grade in To Grade, locked grade in Locked In) — click to filter. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))", gap: "8px", marginBottom: "12px" }}>
        {STARS.map((s) => (
          <button key={s} type="button" onClick={() => setStarF(starF === s ? 0 : s)} style={{ textAlign: "left", background: "#fff", border: `2px solid ${starF === s ? GOLD : "#e3e8ef"}`, borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <TransferStars stars={s} size="sm" />
              <span style={{ fontSize: "9px", fontWeight: 900, color: "#8a97ab", textTransform: "uppercase", letterSpacing: "0.06em" }}>{view === "locked" ? "Locked" : "Auto"}</span>
            </span>
            <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 900, color: INK }}>{teams ? (counts.stars[s] || 0).toLocaleString() : "…"}</div>
          </button>
        ))}
        {view === "todo" && (
          <button type="button" onClick={() => setOnly(only === "review" ? "" : "review")} style={{ textAlign: "left", background: "#fff", border: `2px solid ${only === "review" ? GOLD : "#e3e8ef"}`, borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ fontSize: "11px", fontWeight: 900, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.06em" }}>Needs Review</span>
            <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 900, color: INK }}>{teams ? counts.review : "…"}</div>
          </button>
        )}
      </div>

      {/* Filters. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, school, position…"
          style={{ flex: "1 1 220px", border: "2px solid #ddd", borderRadius: "8px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none" }} />
        <select value={teamF} onChange={(e) => setTeamF(e.target.value)} style={sel}>
          <option value="">All schools</option>
          {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={posF} onChange={(e) => setPosF(e.target.value)} style={sel}>
          <option value="">All positions</option>
          {POS_GROUPS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={eligF} onChange={(e) => setEligF(Number(e.target.value))} style={sel}>
          <option value={0}>Any years left</option>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} year{n > 1 ? "s" : ""} left</option>)}
        </select>
        <select value={likelyF} onChange={(e) => setLikelyF(e.target.value)} style={sel}>
          <option value="">Any likeliness</option>
          <option value="none">No likeliness</option>
          {LIKELY.map((l) => <option key={l} value={l}>{l} — {LIKELY_LABELS[l]}</option>)}
        </select>
        <select value={basisF} onChange={(e) => setBasisF(e.target.value)} style={sel}>
          <option value="">Any auto basis</option>
          {Object.entries(BASIS).filter(([k]) => k !== "o").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={sel}>
          {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
        </select>
        {[["wedraft", "We-Draft players"], ["portal", "In portal"]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setOnly(only === k ? "" : k)} style={btn(only === k)}>{label}</button>
        ))}
        {anyFilter && <button type="button" onClick={() => { setQ(""); setStarF(0); setBasisF(""); setTeamF(""); setPosF(""); setEligF(0); setLikelyF(""); setOnly(""); }} style={{ background: "none", border: "none", color: "#888", fontWeight: 800, fontSize: "12px", textDecoration: "underline", cursor: "pointer" }}>Reset</button>}
      </div>
      {message && (
        <div style={{ marginBottom: "10px", padding: "8px 12px", borderRadius: "8px", background: message.bad ? "#fdecea" : "#e8f5e9", color: message.bad ? "#a12a1d" : "#1b5e20", fontSize: "12px", fontWeight: 800, display: "flex", alignItems: "center", gap: "10px" }}>
          <span>{message.text}</span>
          {message.undo && <button type="button" onClick={undo} style={{ background: "none", border: "none", color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "underline", cursor: "pointer", padding: 0 }}>Undo</button>}
          <button type="button" onClick={() => setMessage(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#888", fontWeight: 900, cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* The list. */}
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 1380 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: "10px", padding: "8px 14px", background: BLUE, color: "#fff", fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", alignItems: "center" }}>
              <span>Player · {teams ? filtered.length.toLocaleString() : "…"}</span><span>Pos</span><span>School</span><span title="Seasons of eligibility left">Yrs</span><span>HS</span><span>Comm</span><span>Stats</span><span>PFF (admin)</span><span>Auto</span>
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {view === "locked" ? "Locked grade" : "Grade"}
                {view === "todo" && filtered.length > 0 && <button type="button" onClick={lockPage} style={{ marginLeft: "auto", background: "none", border: "1px solid rgba(255,255,255,0.6)", borderRadius: "6px", color: "#fff", fontWeight: 900, fontSize: "9px", padding: "2px 6px", cursor: "pointer", letterSpacing: "0.06em", fontFamily: "inherit" }}>✓ All shown</button>}
              </span>
              <span>Likeliness</span>
            </div>
            {!teams ? <div style={{ padding: "40px", textAlign: "center", color: "#999", fontWeight: 700 }}>Loading every player…</div>
              : filtered.length === 0 ? <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic" }}>{view === "todo" && !anyFilter ? "Everyone's graded." : "No players match."}</div>
                : filtered.slice(0, shown).map((r) => (
                  <Row key={r.key} r={r} g={gradeOf(r)} wd={r.wdId ? wdById.get(r.wdId) : null} rec={pff?.get(r.cfbdId)} comm={r.wdId ? comm[r.wdId] : null}
                    busy={saving.has(r.key)} view={view} onLock={lockGrade} onLikely={setLikely} />
                ))}
          </div>
        </div>
        {teams && filtered.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} style={{ display: "block", width: "100%", padding: "12px", background: "#f7f9fc", border: "none", borderTop: "1px solid #e3e8ef", color: BLUE, fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer" }}>
            Show more ({(filtered.length - shown).toLocaleString()} left)
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ r, g, wd, rec, comm, busy, view, onLock, onLikely }) {
  const label = gradeLabel(comm);
  const look = label ? gradeLook(label) : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: COLS, gap: "10px", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #f0f0f0", background: r.review && view === "todo" ? "#fffaf0" : "#fff", opacity: busy ? 0.55 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: 900, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {wd?.Slug ? <a href={`/player/${wd.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, textDecoration: "none" }}>{r.name}</a> : r.name}
        </div>
        <div style={{ display: "flex", gap: "6px", marginTop: "2px", fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {wd && <span style={{ color: BLUE }}>We-Draft{wd.Eligible ? ` ${wd.Eligible}` : ""}</span>}
          {wd?.InPortal && <span style={{ color: "#b45309" }}>In portal</span>}
          {r.review && <span style={{ color: "#b45309" }}>Needs review</span>}
        </div>
      </div>
      <span style={{ fontSize: "12px", fontWeight: 900, color: "#555" }}>{r.pos || "—"}</span>
      <span style={{ fontSize: "12px", fontWeight: 800, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.team}>{r.team || "—"}</span>
      <span style={{ fontSize: "13px", fontWeight: 900, color: INK }}>{r.elig ?? "—"}</span>
      <span style={{ fontSize: "11px", fontWeight: 900, color: r.rStars ? INK : "#c3cad4", whiteSpace: "nowrap" }} title={r.rRank ? `National recruit #${r.rRank}` : ""}>
        {r.rStars ? <>{r.rStars}<span style={{ color: GOLD }}>★</span>{r.rRank ? <span style={{ color: "#8a97ab" }}> #{r.rRank}</span> : null}</> : "—"}
      </span>
      <span>
        {look ? (
          <span title={label} style={{ display: "inline-flex", alignItems: "center", gap: "3px", padding: "2px 6px", borderRadius: "6px", background: look.bg, border: `1.5px solid ${look.border}`, color: "#fff", fontSize: "10px", fontWeight: 900, whiteSpace: "nowrap" }}>
            {look.qualifier ? <span style={{ fontSize: "8px", opacity: 0.85 }}>{look.qualifier}</span> : null}{look.short}
          </span>
        ) : <span style={{ color: "#c3cad4", fontWeight: 900 }}>—</span>}
      </span>
      <span style={{ fontSize: "11px", fontWeight: 700, color: r.stats ? "#444" : "#c3cad4", lineHeight: 1.35 }}>{r.stats || "—"}</span>
      <span style={{ fontSize: "12px", fontWeight: 800, color: rec ? INK : "#c3cad4", whiteSpace: "nowrap" }} title={rec ? `${rec.pos} · ${rec.cat}` : "No PFF grade"}>
        {rec ? <>{rec.g}<span style={{ color: "#8a97ab" }}> · {rec.sn} sn</span></> : "—"}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <TransferStars stars={r.auto} size="sm" />
        <span style={{ fontSize: "9px", fontWeight: 900, color: "#7a8594", textTransform: "uppercase" }}>{BASIS[r.basis] || r.basis}</span>
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <button type="button" disabled={busy} onClick={() => onLock(r, r.auto, true)} title={g.s && g.auto ? "Locked at the auto grade" : `Lock in the auto grade (${r.auto}★)`}
          style={{ ...chip(g.s && g.auto, GREEN), width: 32, color: g.s && g.auto ? "#fff" : GREEN, borderColor: g.s && g.auto ? GREEN : "#b7dcb9" }}>✓</button>
        {STARS.map((s) => {
          const on = g.s === s && !g.auto;
          return <button key={s} type="button" disabled={busy} onClick={() => onLock(r, s, false)} title={`Lock in at ${s}★`} style={chip(on, BLUE)}>{s}</button>;
        })}
        {view === "locked" && (
          <button type="button" disabled={busy} onClick={() => onLock(r, null)} title="Unlock — back to To Grade"
            style={{ height: 26, padding: "0 6px", borderRadius: "6px", border: `2px solid ${GOLD}`, background: "#fff", color: "#8a5a00", fontWeight: 900, fontSize: "9px", cursor: "pointer", fontFamily: "inherit", textTransform: "uppercase" }}>
            Unlock
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {LIKELY.map((l) => {
          const on = g.l === l;
          return <button key={l} type="button" disabled={busy} onClick={() => onLikely(r, on ? null : l)} title={on ? "Clear likeliness" : `${l} — ${LIKELY_LABELS[l]}`} style={chip(on, LIKELY_COLOR[l])}>{l}</button>;
        })}
      </div>
    </div>
  );
}
