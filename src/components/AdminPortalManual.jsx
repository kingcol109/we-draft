// src/components/AdminPortalManual.jsx
//
// Admin → Players → Transfer Portal → Manual Entries (user, 2026-11-17):
// "we will rely on cfbd for portal data but it can lag behind and i want to
// be able to enter big movements as they happen."
//
//   Add      search any player in the Portal Sim pool (every FBS player,
//            graded FCS) — or type one in by hand — and put him in the
//            portal: entered (date), committed to a school, or withdrew
//   Update   each entry: Commit to…, Withdrew, Back to uncommitted, Remove
//
// Saved to config/portalManual (public read, admin write): the public portal
// reads it live — the board, the updates feed, team Movement, and the
// team's projected roster / targets (utils/portalData.js) — so a move shows
// the moment it's saved. The next team-page rebuild (Team Pages tab, or any
// portal sync) folds it into the sim's needs and suggestions as well.
//
// When CFBD catches up the row says so ("CFBD has him"): CFBD's entry then
// takes over once it shows him committed and the manual entry doesn't, and
// the manual entry can be removed. A We-Draft player's own portal record
// (the player editor's Move to Portal / Committed / Withdrew) always wins.
import { useEffect, useMemo, useState } from "react";
import { deleteField, doc, FieldPath, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { activePortalSeason } from "../utils/eligibility";
import { fetchPortalBoard, lastNameOf, loadPortalPool, manualKey, starsWithLocks } from "../utils/portalData";
import TransferStars from "./TransferStars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0f1b2d";
const GREEN = "#2e7d32";
const REF = () => doc(db, "config", "portalManual");
const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P"];
const STATUS = { u: ["Uncommitted", BLUE, "#eaf1ff"], c: ["Committed", GREEN, "#e8f5e9"], w: ["Withdrew", "#8a5a00", "#fff4dd"] };
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);
const dayMs = (iso) => (iso ? new Date(`${iso}T12:00:00`).getTime() : Date.now());
const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
const btn = (color = BLUE, solid = false) => ({
  padding: "5px 10px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em",
  border: `2px solid ${color}`, borderRadius: "7px", cursor: "pointer", background: solid ? color : "#fff", color: solid ? "#fff" : color, fontFamily: "inherit", whiteSpace: "nowrap",
});
const input = { border: "2px solid #ddd", borderRadius: "8px", padding: "7px 9px", fontWeight: 700, fontSize: "13px", fontFamily: "inherit", minWidth: 0, boxSizing: "border-box" };

export default function AdminPortalManual({ allPlayers = [] }) {
  const [data, setData] = useState(null); // { pool, locks, brand }
  const [entries, setEntries] = useState({});
  const [cfbd, setCfbd] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null); // a pool player, or { hand: true }
  const [hand, setHand] = useState({ n: "", pos: "QB", from: "" });
  const [form, setForm] = useState({ st: "u", d: today(), to: "", cd: today() });
  const [commitFor, setCommitFor] = useState(null); // key being committed from the list
  const [commitTo, setCommitTo] = useState("");

  useEffect(() => {
    let c = false;
    Promise.all([loadPortalPool(), getDoc(REF()), fetchPortalBoard().catch(() => ({ entries: [] }))])
      .then(([d, snap, b]) => { if (c) return; setData(d); setEntries(snap.data()?.entries || {}); setCfbd(b.entries || []); })
      .catch((e) => { if (!c) setError(e.message || String(e)); });
    return () => { c = true; };
  }, []);

  const pool = data?.pool;
  const schoolOf = useMemo(() => Object.fromEntries((pool?.teams || []).map((t) => [t.slug, t.school])), [pool]);
  const schools = useMemo(() => [...new Set((pool?.teams || []).map((t) => t.school))].sort(), [pool]);
  const slugOfWd = useMemo(() => new Map(allPlayers.map((p) => [p.id, p.Slug])), [allPlayers]);
  const logoOf = useMemo(() => {
    const m = {};
    (pool?.teams || []).forEach((t) => { const l = data.brand[t.slug]?.Logo1 || t.brand?.Logo1; if (l) m[t.school] = l; });
    return m;
  }, [pool, data]);
  // CFBD's entries by pool id and by name|school — "CFBD has him".
  const cfbdOf = useMemo(() => {
    const m = new Map();
    cfbd.forEach((e) => { if (e.id) m.set(String(e.id), e); m.set(`${norm(e.n)}|${norm(e.from)}`, e); });
    return m;
  }, [cfbd]);

  const results = useMemo(() => {
    const t = norm(q).trim();
    if (!pool || t.length < 2) return [];
    return pool.players.filter((p) => norm(p.name).includes(t))
      .sort((a, b) => (b.stars || 0) - (a.stars || 0) || lastNameOf(a.name).localeCompare(lastNameOf(b.name)))
      .slice(0, 25);
  }, [q, pool]);

  const save = async (key, entry) => {
    setBusy(true); setError("");
    try {
      if (!(await getDoc(REF())).exists()) await setDoc(REF(), { entries: {} });
      await updateDoc(REF(), new FieldPath("entries", key), entry === null ? deleteField() : entry);
      setEntries((prev) => { const n = { ...prev }; if (entry === null) delete n[key]; else n[key] = entry; return n; });
      return true;
    } catch (e) {
      setError(`Save failed: ${e.message || e}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    let base;
    if (picked?.hand) {
      if (!hand.n.trim() || !hand.from) { setError("Enter a name and the school he's leaving."); return; }
      base = { n: hand.n.trim(), pos: hand.pos, sub: "", from: hand.from };
    } else {
      const p = picked;
      base = JSON.parse(JSON.stringify({
        pid: p.id, wd: p.wdId || undefined, n: p.name, pos: p.pos, sub: p.sub || "", from: schoolOf[p.team] || "",
        s: starsWithLocks(data.locks, { id: p.id, wdId: p.wdId, stars: p.stars }), e: p.elig ?? null, ht: p.ht || null, wt: p.wt || null,
        state: p.state || "", slug: (p.wdId && slugOfWd.get(p.wdId)) || "",
      }));
    }
    if (form.st === "c" && !form.to) { setError("Pick the school he committed to."); return; }
    const entry = {
      ...base, st: form.st, d: dayMs(form.d), at: Date.now(),
      ...(form.st === "c" ? { to: form.to, cd: dayMs(form.cd) } : form.st === "w" ? { to: base.from, cd: dayMs(form.cd) } : {}),
    };
    const key = manualKey(entry);
    if (entries[key] && !window.confirm(`${entry.n} already has a manual entry. Replace it?`)) return;
    if (await save(key, entry)) { setPicked(null); setQ(""); setHand({ n: "", pos: "QB", from: "" }); setForm({ st: "u", d: today(), to: "", cd: today() }); }
  };
  const update = (key, patch) => {
    const e = { ...entries[key], ...patch, at: Date.now() };
    if (patch.st === "u") { delete e.to; delete e.cd; }
    return save(key, e);
  };

  if (error && !data) return <div style={{ padding: 20, color: "#c0392b", fontWeight: 800 }}>{error}</div>;
  if (!data) return <div style={{ padding: 20, color: "#888", fontWeight: 800 }}>Loading the Portal Sim pool…</div>;

  const Logo = ({ school, size = 22 }) => (logoOf[school]
    ? <img src={logoOf[school]} alt={school} title={school} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
    : <span title={school} style={{ width: size, flexShrink: 0, fontSize: "9px", fontWeight: 900, color: BLUE }}>{String(school || "").slice(0, 3).toUpperCase()}</span>);
  const schoolPicker = (value, onChange, placeholder = "School…") => (
    <>
      <input list="wd-portal-schools" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...input, width: "200px" }} />
      <datalist id="wd-portal-schools">{schools.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
  const list = Object.entries(entries).sort((a, b) => (b[1].cd || b[1].d || 0) - (a[1].cd || a[1].d || 0));

  return (
    <div style={{ maxWidth: "1100px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#5b6b84", lineHeight: 1.6, marginBottom: "14px" }}>
        CFBD drives the {activePortalSeason()} portal, but it lags. Enter big moves here as they happen: they show on the public portal, team Movement pages and projected rosters as soon as they&apos;re saved.
        Sim needs and suggestions pick them up at the next team-page rebuild. For a We-Draft player you can also use the player editor&apos;s portal buttons, which update his own page.
      </div>
      {error && <div style={{ marginBottom: "10px", color: "#c0392b", fontWeight: 800, fontSize: "13px" }}>{error}</div>}

      {/* ── Add ── */}
      <div style={{ border: "2px solid " + BLUE, borderRadius: "12px", overflow: "hidden", background: "#fff", marginBottom: "18px" }}>
        <div style={{ background: BLUE, color: "#fff", padding: "10px 14px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Add a portal move</div>
        {!picked ? (
          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a player (any FBS roster)…" style={{ ...input, flex: 1 }} />
              <button type="button" onClick={() => setPicked({ hand: true })} style={btn("#5b6b84")}>Not listed? Enter by hand</button>
            </div>
            {results.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 4px", borderTop: "1px solid #eef1f5" }}>
                <TransferStars stars={starsWithLocks(data.locks, { id: p.id, wdId: p.wdId, stars: p.stars })} size="sm" />
                <span style={{ width: 44, fontSize: "12px", fontWeight: 900, color: BLUE }}>{p.sub || p.pos}</span>
                <Logo school={schoolOf[p.team]} />
                <span style={{ flex: 1, minWidth: 0, fontWeight: 900, color: INK, fontSize: "14px" }}>
                  {p.name} <span style={{ fontWeight: 700, color: "#8a97ab", fontSize: "12px" }}>{schoolOf[p.team]} · {p.elig ?? "?"} yrs left</span>
                </span>
                {entries[String(p.id)] && <span style={{ fontSize: "11px", fontWeight: 900, color: GOLD }}>Already entered</span>}
                <button type="button" onClick={() => setPicked(p)} style={btn()}>Select</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {picked.hand ? (
                <>
                  <input value={hand.n} onChange={(e) => setHand({ ...hand, n: e.target.value })} placeholder="Full name" style={{ ...input, width: "220px" }} />
                  <select value={hand.pos} onChange={(e) => setHand({ ...hand, pos: e.target.value })} style={input}>{POSITIONS.map((x) => <option key={x}>{x}</option>)}</select>
                  {schoolPicker(hand.from, (v) => setHand({ ...hand, from: v }), "Leaving school…")}
                </>
              ) : (
                <>
                  <TransferStars stars={starsWithLocks(data.locks, { id: picked.id, wdId: picked.wdId, stars: picked.stars })} size="sm" />
                  <span style={{ fontWeight: 900, color: INK, fontSize: "16px" }}>{picked.name}</span>
                  <span style={{ fontWeight: 800, color: "#5b6b84", fontSize: "13px" }}>{picked.sub || picked.pos} · {schoolOf[picked.team]}</span>
                </>
              )}
              <button type="button" onClick={() => setPicked(null)} style={{ ...btn("#8a97ab"), marginLeft: "auto" }}>Change player</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <label style={{ fontSize: "12px", fontWeight: 900, color: "#5b6b84" }}>Entered <input type="date" value={form.d} onChange={(e) => setForm({ ...form, d: e.target.value })} style={input} /></label>
              {["u", "c", "w"].map((k) => (
                <button key={k} type="button" onClick={() => setForm({ ...form, st: k })} style={btn(STATUS[k][1], form.st === k)}>{STATUS[k][0]}</button>
              ))}
              {form.st === "c" && schoolPicker(form.to, (v) => setForm({ ...form, to: v }), "Committed to…")}
              {form.st !== "u" && <label style={{ fontSize: "12px", fontWeight: 900, color: "#5b6b84" }}>{form.st === "c" ? "Committed" : "Withdrew"} <input type="date" value={form.cd} onChange={(e) => setForm({ ...form, cd: e.target.value })} style={input} /></label>}
              <button type="button" disabled={busy} onClick={add} style={{ ...btn(GREEN, true), marginLeft: "auto", padding: "8px 16px", fontSize: "12px" }}>{busy ? "Saving…" : "Save move"}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Entries ── */}
      <div style={{ border: "1px solid #e3e8ef", borderRadius: "12px", overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: "10px 14px", background: "#f7f9fc", fontWeight: 900, fontSize: "12px", color: "#5b6b84", textTransform: "uppercase", letterSpacing: "0.08em" }}>Manual entries ({list.length})</div>
        {list.length === 0 && <div style={{ padding: "18px 14px", color: "#8a97ab", fontStyle: "italic", fontSize: "13px" }}>None yet.</div>}
        {list.map(([key, e]) => {
          const [label, color, bg] = STATUS[e.st] || STATUS.u;
          const c = (e.pid && cfbdOf.get(String(e.pid))) || cfbdOf.get(`${norm(e.n)}|${norm(e.from)}`);
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 14px", borderTop: "1px solid #eef1f5", flexWrap: "wrap" }}>
              <TransferStars stars={e.pid ? starsWithLocks(data.locks, { id: e.pid, wdId: e.wd, stars: e.s }) : e.s} size="sm" />
              <span style={{ width: 40, fontSize: "12px", fontWeight: 900, color: BLUE }}>{e.sub || e.pos}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Logo school={e.from} /><span style={{ color: "#b8c2d1", fontWeight: 900 }}>→</span>
                {e.st === "u" ? <span style={{ width: 22, textAlign: "center", color: "#8a97ab", fontWeight: 900 }}>?</span> : <Logo school={e.to} />}
              </span>
              <span style={{ flex: 1, minWidth: "160px", fontWeight: 900, color: INK, fontSize: "14px" }}>
                {e.n}
                <span style={{ marginLeft: "8px", fontSize: "11px", fontWeight: 900, color, background: bg, borderRadius: "999px", padding: "2px 8px" }}>{label}{e.st !== "u" && e.to ? ` · ${e.to}` : ""}</span>
                {c && <span title={`CFBD: ${c.st === "u" ? "in the portal" : c.st === "c" ? `committed to ${c.to}` : "withdrew"}`} style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 900, color: "#5b6b84", background: "#eef1f5", borderRadius: "999px", padding: "2px 8px" }}>CFBD has him{c.st === "c" ? ` · ${c.to}` : ""}</span>}
              </span>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#8a97ab", width: "110px" }}>In {fmt(e.d)}{e.cd ? ` · ${e.st === "w" ? "out" : "c"} ${fmt(e.cd)}` : ""}</span>
              {commitFor === key ? (
                <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  {schoolPicker(commitTo, setCommitTo, "Committed to…")}
                  <button type="button" disabled={busy || !commitTo} onClick={async () => { if (await update(key, { st: "c", to: commitTo, cd: Date.now() })) { setCommitFor(null); setCommitTo(""); } }} style={btn(GREEN, true)}>Save</button>
                  <button type="button" onClick={() => setCommitFor(null)} style={btn("#8a97ab")}>Cancel</button>
                </span>
              ) : (
                <span style={{ display: "flex", gap: "6px" }}>
                  <button type="button" disabled={busy} onClick={() => { setCommitFor(key); setCommitTo(e.st === "c" ? e.to : ""); }} style={btn(GREEN)}>{e.st === "c" ? "Change school" : "Commit to…"}</button>
                  {e.st !== "w" && <button type="button" disabled={busy} onClick={() => update(key, { st: "w", to: e.from, cd: Date.now() })} style={btn("#8a5a00")}>Withdrew</button>}
                  {e.st !== "u" && <button type="button" disabled={busy} onClick={() => update(key, { st: "u" })} style={btn()}>Uncommitted</button>}
                  <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove the manual entry for ${e.n}?`)) save(key, null); }} style={btn("#c0392b")}>Remove</button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
