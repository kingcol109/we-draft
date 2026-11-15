// src/components/AdminPortalGrades.jsx
//
// Admin → Players → Transfer Portal → Grades: transfer stars (2–6) for every
// college player, built ahead of time (server/portal/stars.js) from the
// rules in utils/portalStars.mjs — draft grades first, then PFF, then
// CFBD stats. An admin override always wins: one click sets a player's
// stars (portalStars/_overrides, keyed by CFBD id, or "wd:" + We-Draft id
// for a player with no CFBD link), "Auto" clears it.
//
// PFF grades and snaps show here only (admin) — never on the public site.
//
// Reads: portalStars (one doc per team, ~245), pffGrades (admin-only, for
// the PFF column, components/pffData.js). allPlayers (the Admin Panel's
// already-loaded players) supplies slugs, We-Draft-only players and who's
// in the portal.
import { useEffect, useMemo, useState } from "react";
import { collection, deleteField, doc, FieldPath, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { currentDraftClass } from "../utils/eligibility";
import { BASIS, PFF_MIN_SNAPS, PFF_REVIEW, PFF_SOLID } from "../utils/portalStars.mjs";
import { loadPffByCfbdId } from "./pffData";
import TransferStars from "./TransferStars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const INK = "#0f1b2d";
const PAGE = 100;
const STARS = [6, 5, 4, 3, 2];

const btn = (on, color = BLUE) => ({
  padding: "6px 12px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "8px", cursor: "pointer", background: on ? color : "#fff", color: on ? "#fff" : color, whiteSpace: "nowrap",
});

export default function AdminPortalGrades({ allPlayers = [] }) {
  const [teams, setTeams] = useState(null); // [{ id, school, rows }]
  const [wedraft, setWedraft] = useState({});
  const [overrides, setOverrides] = useState({});
  const [meta, setMeta] = useState(null);
  const [pff, setPff] = useState(null);
  const [message, setMessage] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [savingKey, setSavingKey] = useState("");

  const [q, setQ] = useState("");
  const [starF, setStarF] = useState(0);
  const [basisF, setBasisF] = useState("");
  const [teamF, setTeamF] = useState("");
  const [only, setOnly] = useState(""); // "" | review | override | wedraft | portal
  const [shown, setShown] = useState(PAGE);

  const load = async () => {
    setTeams(null);
    const snap = await getDocs(collection(db, "portalStars"));
    const list = [];
    snap.docs.forEach((d) => {
      const x = d.data();
      if (d.id === "_overrides") setOverrides(x.rows || {});
      else if (d.id === "_wedraft") setWedraft(x.rows || {});
      else if (d.id === "_meta") setMeta(x);
      else list.push({ id: d.id, school: x.school || x.team || d.id, rows: x.rows || {} });
    });
    if (!snap.docs.some((d) => d.id === "_overrides")) setOverrides({});
    setTeams(list.sort((a, b) => a.school.localeCompare(b.school)));
  };
  useEffect(() => { load().catch((e) => { console.error("Portal grades load error:", e); setTeams([]); }); }, []);
  useEffect(() => { loadPffByCfbdId().then(setPff); }, []);

  const wdById = useMemo(() => new Map(allPlayers.map((p) => [p.id, p])), [allPlayers]);

  // Past draft classes (2026 once the 2026 draft is done) are out of
  // college — left out here even before a Rebuild drops them.
  const pastClass = (wdId) => {
    const e = parseInt(wdById.get(wdId)?.Eligible, 10);
    return !!e && e < Number(currentDraftClass());
  };

  // Every player: roster rows, plus We-Draft players no roster carries.
  const rows = useMemo(() => {
    if (!teams) return [];
    const out = [];
    teams.forEach((t) => Object.entries(t.rows).forEach(([cfbdId, r]) => {
      const [auto, basis, review, name, pos, wdId] = r;
      if (wdId && pastClass(wdId)) return;
      out.push({ key: cfbdId, cfbdId, wdId: wdId || "", name, pos, team: t.school, auto, basis, review: !!review });
    }));
    Object.entries(wedraft).forEach(([wdId, [auto, basis, cfbdId]]) => {
      if (cfbdId) return;
      const p = wdById.get(wdId);
      if (!p || pastClass(wdId)) return;
      out.push({ key: `wd:${wdId}`, cfbdId: "", wdId, name: `${p.First || ""} ${p.Last || ""}`.trim(), pos: p.Position || "", team: p.School || "", auto, basis, review: false });
    });
    return out;
  }, [teams, wedraft, wdById]); // eslint-disable-line react-hooks/exhaustive-deps

  const eff = (r) => overrides[r.key]?.s || r.auto;
  const counts = useMemo(() => {
    const c = { 6: 0, 5: 0, 4: 0, 3: 0, 2: 0 };
    rows.forEach((r) => { c[eff(r)] = (c[eff(r)] || 0) + 1; });
    return c;
  }, [rows, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (starF && eff(r) !== starF) return false;
      if (basisF && (basisF === "o" ? !overrides[r.key] : r.basis !== basisF)) return false;
      if (teamF && r.team !== teamF) return false;
      if (only === "review" && !(r.review && !overrides[r.key])) return false;
      if (only === "override" && !overrides[r.key]) return false;
      if (only === "wedraft" && !r.wdId) return false;
      if (only === "portal" && !(r.wdId && wdById.get(r.wdId)?.InPortal)) return false;
      if (needle && !`${r.name} ${r.team} ${r.pos}`.toLowerCase().includes(needle)) return false;
      return true;
    }).sort((a, b) => eff(b) - eff(a) || (b.review - a.review) || (pff?.get(b.cfbdId)?.g || 0) - (pff?.get(a.cfbdId)?.g || 0) || a.name.localeCompare(b.name));
  }, [rows, overrides, q, starF, basisF, teamF, only, pff, wdById]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShown(PAGE); }, [q, starF, basisF, teamF, only]);

  const setOverride = async (r, s, note) => {
    setSavingKey(r.key); setMessage("");
    try {
      const ref = doc(db, "portalStars", "_overrides");
      if (s) {
        const val = { s, note: note ?? overrides[r.key]?.note ?? "", name: r.name, team: r.team, at: serverTimestamp(), by: auth.currentUser?.email || "" };
        await setDoc(ref, { rows: { [r.key]: val } }, { merge: true });
        setOverrides((o) => ({ ...o, [r.key]: { ...val, at: new Date() } }));
      } else {
        await updateDoc(ref, new FieldPath("rows", r.key), deleteField());
        setOverrides((o) => { const n = { ...o }; delete n[r.key]; return n; });
      }
    } catch (e) {
      console.error("Override save error:", e);
      setMessage("Save failed — check console.");
    } finally {
      setSavingKey("");
    }
  };

  const rebuild = async () => {
    setRebuilding(true); setMessage("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/portal-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "stars" }) });
      if (r.status === 404) throw new Error("the endpoint runs on the live site. Locally: node --env-file=.env scripts/buildPortalStars.js");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setMessage(`Rebuilt ${j.players} players · 6★ ${j.byStars?.[6]} · 5★ ${j.byStars?.[5]} · 4★ ${j.byStars?.[4]} · ${j.review} to review. Overrides kept.`);
      await load();
    } catch (e) {
      setMessage(`Rebuild failed: ${e.message}`);
    } finally {
      setRebuilding(false);
    }
  };

  const teamNames = useMemo(() => (teams || []).map((t) => t.school), [teams]);
  const overrideCount = Object.keys(overrides).length;
  const reviewCount = rows.filter((r) => r.review && !overrides[r.key]).length;
  const builtAt = meta?.builtAt?.toDate?.();

  return (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      {/* How grades are made — the current rules. */}
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", marginBottom: "14px" }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Transfer Grades</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 700 }}>
            {builtAt ? `Built ${builtAt.toLocaleString()}` : ""}{meta?.season ? ` · ${meta.season} rosters` : ""}
          </div>
          <button type="button" onClick={rebuild} disabled={rebuilding} style={{ ...btn(true, GOLD), marginLeft: "auto", opacity: rebuilding ? 0.6 : 1 }}>{rebuilding ? "Rebuilding…" : "Rebuild"}</button>
        </div>
        <div style={{ padding: "12px 16px", background: "#fff", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px 18px", fontSize: "12px", fontWeight: 700, color: "#444" }}>
          {[
            [6, "Draft grade Early First"],
            [5, "Draft grade Middle or Late First"],
            [4, "Draft grade Rounds 2–7"],
            [3, `Solid — UDFA draft grade, PFF ≥ ${PFF_SOLID} on real snaps, or solid season stats`],
            [2, "Everyone else"],
          ].map(([s, text]) => (
            <div key={s} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <TransferStars stars={s} size="sm" />
              <span>{text}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 16px", background: "#f7f9fc", borderTop: "1px solid #eef1f5", fontSize: "11px", fontWeight: 700, color: "#7a8594" }}>
          Draft grade first, then PFF (needs {Object.entries(PFF_MIN_SNAPS).map(([k, v]) => `${v} ${k}`).join(", ")} snaps), then CFBD stats. No draft grade but PFF ≥ {PFF_REVIEW} on double the snaps → Needs Review. An override always wins and survives rebuilds.
        </div>
      </div>

      {/* Counts — click to filter. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "8px", marginBottom: "12px" }}>
        {STARS.map((s) => (
          <button key={s} type="button" onClick={() => setStarF(starF === s ? 0 : s)} style={{ textAlign: "left", background: "#fff", border: `2px solid ${starF === s ? GOLD : "#e3e8ef"}`, borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontFamily: "inherit" }}>
            <TransferStars stars={s} size="sm" />
            <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 900, color: INK }}>{teams ? (counts[s] || 0).toLocaleString() : "…"}</div>
          </button>
        ))}
        <button type="button" onClick={() => setOnly(only === "review" ? "" : "review")} style={{ textAlign: "left", background: "#fff", border: `2px solid ${only === "review" ? GOLD : "#e3e8ef"}`, borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontSize: "11px", fontWeight: 900, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.06em" }}>Needs Review</span>
          <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 900, color: INK }}>{teams ? reviewCount : "…"}</div>
        </button>
        <button type="button" onClick={() => setOnly(only === "override" ? "" : "override")} style={{ textAlign: "left", background: "#fff", border: `2px solid ${only === "override" ? GOLD : "#e3e8ef"}`, borderRadius: "10px", padding: "10px 12px", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontSize: "11px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em" }}>Overrides</span>
          <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 900, color: INK }}>{overrideCount}</div>
        </button>
      </div>

      {/* Filters. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player, school, position…"
          style={{ flex: "1 1 240px", border: "2px solid #ddd", borderRadius: "8px", padding: "8px 12px", fontWeight: 700, fontSize: "13px", outline: "none" }} />
        <select value={teamF} onChange={(e) => setTeamF(e.target.value)} style={{ border: "2px solid #ddd", borderRadius: "8px", padding: "8px", fontWeight: 800, fontSize: "12px" }}>
          <option value="">All teams</option>
          {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={basisF} onChange={(e) => setBasisF(e.target.value)} style={{ border: "2px solid #ddd", borderRadius: "8px", padding: "8px", fontWeight: 800, fontSize: "12px" }}>
          <option value="">Any basis</option>
          {Object.entries(BASIS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {[["wedraft", "We-Draft players"], ["portal", "In portal"]].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setOnly(only === k ? "" : k)} style={btn(only === k)}>{label}</button>
        ))}
        {(q || starF || basisF || teamF || only) && <button type="button" onClick={() => { setQ(""); setStarF(0); setBasisF(""); setTeamF(""); setOnly(""); }} style={{ background: "none", border: "none", color: "#888", fontWeight: 800, fontSize: "12px", textDecoration: "underline", cursor: "pointer" }}>Reset</button>}
      </div>
      {message && <div style={{ marginBottom: "10px", padding: "8px 12px", borderRadius: "8px", background: message.includes("failed") ? "#fdecea" : "#e8f5e9", color: message.includes("failed") ? "#a12a1d" : "#1b5e20", fontSize: "12px", fontWeight: 800 }}>{message}</div>}

      {/* The list. */}
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.6fr) 50px minmax(120px, 1fr) 150px 110px minmax(260px, 1.4fr)", gap: "10px", padding: "8px 14px", background: BLUE, color: "#fff", fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          <span>Player · {teams ? filtered.length.toLocaleString() : "…"}</span><span>Pos</span><span>Team</span><span>Auto</span><span>PFF (admin)</span><span>Grade</span>
        </div>
        {!teams ? <div style={{ padding: "40px", textAlign: "center", color: "#999", fontWeight: 700 }}>Loading every player…</div>
          : filtered.length === 0 ? <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic" }}>No players match.</div>
            : filtered.slice(0, shown).map((r) => {
              const ov = overrides[r.key];
              const rec = pff?.get(r.cfbdId);
              const wd = r.wdId ? wdById.get(r.wdId) : null;
              const busy = savingKey === r.key;
              return (
                <div key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.6fr) 50px minmax(120px, 1fr) 150px 110px minmax(260px, 1.4fr)", gap: "10px", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid #f0f0f0", background: r.review && !ov ? "#fffaf0" : "#fff" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "14px", fontWeight: 900, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {wd?.Slug ? <a href={`/player/${wd.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, textDecoration: "none" }}>{r.name}</a> : r.name}
                    </div>
                    <div style={{ display: "flex", gap: "6px", marginTop: "2px", fontSize: "10px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {wd && <span style={{ color: BLUE }}>We-Draft{wd.Eligible ? ` ${wd.Eligible}` : ""}</span>}
                      {wd?.InPortal && <span style={{ color: "#b45309" }}>In portal</span>}
                      {r.review && !ov && <span style={{ color: "#b45309" }}>Needs review</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 900, color: "#555" }}>{r.pos || "—"}</span>
                  <span style={{ fontSize: "12px", fontWeight: 800, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.team || "—"}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <TransferStars stars={r.auto} size="sm" />
                    <span style={{ fontSize: "10px", fontWeight: 900, color: "#7a8594", textTransform: "uppercase" }}>{BASIS[r.basis] || r.basis}</span>
                  </span>
                  <span style={{ fontSize: "12px", fontWeight: 800, color: rec ? INK : "#c3cad4" }} title={rec ? `${rec.pos} · ${rec.cat}` : "No PFF grade"}>
                    {rec ? <>{rec.g}<span style={{ color: "#8a97ab" }}> · {rec.sn} sn</span></> : "—"}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", opacity: busy ? 0.5 : 1 }}>
                    {STARS.map((s) => {
                      const on = (ov?.s || 0) === s;
                      return (
                        <button key={s} type="button" disabled={busy} onClick={() => setOverride(r, on ? 0 : s)} title={on ? "Clear override" : `Override to ${s}★`}
                          style={{ width: 30, height: 26, borderRadius: "6px", border: `2px solid ${on ? BLUE : "#d5dce6"}`, background: on ? BLUE : "#fff", color: on ? "#fff" : "#5b6b84", fontWeight: 900, fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>
                          {s}
                        </button>
                      );
                    })}
                    <button type="button" disabled={busy || !ov} onClick={() => setOverride(r, 0)} title="Back to the auto grade"
                      style={{ height: 26, padding: "0 8px", borderRadius: "6px", border: `2px solid ${ov ? GOLD : "#eef1f5"}`, background: "#fff", color: ov ? "#8a5a00" : "#c3cad4", fontWeight: 900, fontSize: "11px", cursor: ov ? "pointer" : "default", fontFamily: "inherit", textTransform: "uppercase" }}>
                      Auto
                    </button>
                    {ov && (
                      <input defaultValue={ov.note || ""} placeholder="Note" onBlur={(e) => { if (e.target.value !== (ov.note || "")) setOverride(r, ov.s, e.target.value); }}
                        style={{ flex: "1 1 80px", minWidth: 70, height: 26, border: "1px solid #ddd", borderRadius: "6px", padding: "0 8px", fontSize: "11px", fontWeight: 700 }} />
                    )}
                  </div>
                </div>
              );
            })}
        {teams && filtered.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} style={{ display: "block", width: "100%", padding: "12px", background: "#f7f9fc", border: "none", borderTop: "1px solid #e3e8ef", color: BLUE, fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer" }}>
            Show more ({(filtered.length - shown).toLocaleString()} left)
          </button>
        )}
      </div>
    </div>
  );
}
