// src/components/AdminTransferPortal.js
//
// Admin → Player Data → Transfer Portal. "Run sync" pulls CFBD's portal for
// the chosen season (api/portal-sync.js → server/portal/sync.js, one CFBD
// call — on demand only, never scheduled) into transferPortal/{year}.
//
// We-Draft Players: portal entries matched to a We-Draft player, each with
// the recommended update, applied with one click — the same writes as the
// player editor's own portal buttons (AdminPanel.js handleEnterPortal /
// handleResolvePortal): entered → Move to Transfer Portal; committed →
// Resolve to the new school, which bumps a 2027 to the 2028 class (slug
// follows Feb 1, see scripts/applyPendingSlugChanges.js); every other class
// stays. Dismiss hides a recommendation (transferPortal/{year}.dismissed).
// All Activity: every entry in the season, searchable.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, documentId, FieldPath, getDoc, getDocs, query, serverTimestamp, deleteField, updateDoc, where } from "firebase/firestore";
import { auth, db } from "../firebase";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const NEXT_SEASON = new Date().getFullYear() + 1;
const YEARS = [NEXT_SEASON, NEXT_SEASON - 1];
const PAGE = 100;

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const btn = (on, color = BLUE) => ({
  padding: "6px 14px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em",
  border: `2px solid ${color}`, borderRadius: "8px", cursor: "pointer", background: on ? color : "#fff", color: on ? "#fff" : color,
});

// What a matched We-Draft player needs, given the portal entry. A past
// season's uncommitted entry is left alone — CFBD keeps players who
// withdrew and stayed listed as uncommitted forever.
function recommend(entry, p, year) {
  if (!entry.dest) {
    if (year < NEXT_SEASON) return { done: true, text: "Uncommitted in a past portal — likely withdrew; no change" };
    return p.InPortal
      ? { done: true, text: "In the portal — up to date" }
      : { action: "enter", text: `Move to Transfer Portal (from ${p.School || entry.origin})` };
  }
  const newSchool = entry.destSchool || entry.dest;
  if (p.School === newSchool && !p.InPortal) return { done: true, text: `At ${newSchool} — up to date` };
  const bump = p.Eligible === "2027";
  return {
    action: "resolve", newSchool,
    text: `Resolve → ${newSchool}${entry.destSchool ? "" : " (not a We-Draft school)"} · ${bump ? "class 2027 → 2028 (slug updates Feb 1)" : `class stays ${p.Eligible || "—"}`}`,
  };
}

export default function AdminTransferPortal({ allPlayers, setAllPlayers, nextFebFirstUTC }) {
  const [year, setYear] = useState(NEXT_SEASON);
  const [tab, setTab] = useState("wd");
  const [meta, setMeta] = useState(null);
  const [entries, setEntries] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [busyKey, setBusyKey] = useState(null);
  const [showDone, setShowDone] = useState(false);
  // All Activity filters.
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [wdOnly, setWdOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const load = async (y) => {
    setMeta(null); setEntries(null);
    try {
      const m = (await getDoc(doc(db, "transferPortal", String(y)))).data() || null;
      setMeta(m || { total: 0, matches: [] });
      if (!m?.chunks) { setEntries([]); return; }
      const ids = Array.from({ length: m.chunks }, (_, n) => `${y}_${n}`);
      const snap = await getDocs(query(collection(db, "transferPortal"), where(documentId(), "in", ids)));
      setEntries(snap.docs.sort((a, b) => a.data().n - b.data().n).flatMap((d) => d.data().entries || []));
    } catch (e) {
      console.error("Transfer portal load error:", e);
      setMeta({ total: 0, matches: [], error: true }); setEntries([]);
    }
  };
  useEffect(() => { load(year); setShown(PAGE); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSync = async () => {
    setSyncing(true); setMessage("");
    try {
      const token = await auth.currentUser?.getIdToken();
      const r = await fetch("/api/portal-sync", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ year }),
      });
      const j = await r.json().catch(() => ({}));
      // 404: no /api here — the local dev server, or a deploy without api/portal-sync.js.
      if (r.status === 404) throw new Error("the sync endpoint isn't deployed here (it runs on the live site). Locally: node --env-file=.env scripts/syncTransferPortal.js --year " + year);
      if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setMessage(`Synced ${j.total} entries (${j.committed} committed) · ${j.matched} matched to We-Draft players.`);
      await load(year);
    } catch (e) {
      setMessage(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const byKey = useMemo(() => new Map((entries || []).map((e) => [e.key, e])), [entries]);
  const playersById = useMemo(() => new Map(allPlayers.map((p) => [p.id, p])), [allPlayers]);
  const dismissed = meta?.dismissed || {};

  // One row per (entry, matched player), recommendations first.
  const wdRows = useMemo(() => (meta?.matches || []).flatMap((m) => {
    const entry = byKey.get(m.key);
    if (!entry) return [];
    return m.playerIds.map((id) => playersById.get(id)).filter(Boolean)
      .map((p) => ({ entry, p, rec: recommend(entry, p, year), ambiguous: m.playerIds.length > 1 }));
  }).sort((a, b) => (!!a.rec.done - !!b.rec.done) || (b.entry.date || "").localeCompare(a.entry.date || "")), [meta, byKey, playersById, year]);
  const rowKey = (r) => `${r.entry.key}#${r.p.id}`;
  const pending = wdRows.filter((r) => !r.rec.done && !dismissed[rowKey(r)]);
  const visibleWd = showDone ? wdRows : pending;

  const patchPlayer = (id, fields, removed = []) => setAllPlayers((prev) => prev.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p, ...fields };
    removed.forEach((k) => delete next[k]);
    return next;
  }));

  const apply = async (r) => {
    const { p, rec } = r;
    setBusyKey(rowKey(r)); setMessage("");
    try {
      if (rec.action === "enter") {
        const fields = { InPortal: true, PortalEnteredAt: serverTimestamp(), PortalOriginalSchool: p.School || r.entry.originSchool || "", PortalSeasonYear: String(year - 1) };
        await updateDoc(doc(db, "players", p.id), fields);
        patchPlayer(p.id, { ...fields, PortalEnteredAt: new Date() });
        setMessage(`${p.First} ${p.Last} moved into the Transfer Portal.`);
      } else if (rec.action === "resolve") {
        const bump = p.Eligible === "2027";
        const fields = {
          School: rec.newSchool,
          PriorSchool: p.PortalOriginalSchool || p.School || r.entry.originSchool || "",
          // The last season played at the old school.
          PriorSchoolYear: p.PortalSeasonYear || String(year - 1),
          InPortal: false,
          PortalEnteredAt: deleteField(), PortalOriginalSchool: deleteField(), PortalSeasonYear: deleteField(),
          updatedAt: serverTimestamp(),
          ...(bump ? { Eligible: "2028", PendingSlugChangeAt: nextFebFirstUTC() } : {}),
        };
        await updateDoc(doc(db, "players", p.id), fields);
        patchPlayer(p.id, {
          School: fields.School, PriorSchool: fields.PriorSchool, PriorSchoolYear: fields.PriorSchoolYear, InPortal: false,
          ...(bump ? { Eligible: "2028", PendingSlugChangeAt: fields.PendingSlugChangeAt } : {}),
        }, ["PortalEnteredAt", "PortalOriginalSchool", "PortalSeasonYear"]);
        setMessage(`${p.First} ${p.Last} → ${rec.newSchool}${bump ? " · bumped to the 2028 class (slug updates Feb 1)" : ""}.`);
      }
    } catch (e) {
      console.error("Transfer portal apply error:", e);
      setMessage("Update failed — check console.");
    } finally {
      setBusyKey(null);
    }
  };

  const setDismissed = async (r, on) => {
    const k = rowKey(r);
    try {
      await updateDoc(doc(db, "transferPortal", String(year)), new FieldPath("dismissed", k), on ? true : deleteField());
      setMeta((m) => {
        const d = { ...(m.dismissed || {}) };
        if (on) d[k] = true; else delete d[k];
        return { ...m, dismissed: d };
      });
    } catch (e) {
      console.error("Transfer portal dismiss error:", e);
      setMessage("Dismiss failed — check console.");
    }
  };

  const activity = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (entries || []).filter((e) =>
      (status === "all" || (status === "committed") === !!e.dest)
      && (!wdOnly || e.originSchool || e.destSchool)
      && (!needle || `${e.first} ${e.last} ${e.origin} ${e.dest || ""} ${e.pos || ""}`.toLowerCase().includes(needle)));
  }, [entries, q, status, wdOnly]);

  const synced = meta?.syncedAt?.toDate?.();
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          style={{ border: `2px solid ${BLUE}`, borderRadius: "8px", padding: "7px 10px", fontWeight: 900, color: BLUE, background: "#fff" }}>
          {YEARS.map((y) => <option key={y} value={y}>{y} portal</option>)}
        </select>
        <button type="button" onClick={runSync} disabled={syncing} style={{ ...btn(true, GOLD), color: "#121212", opacity: syncing ? 0.6 : 1 }}>
          {syncing ? "Syncing…" : "🔄 Run sync"}
        </button>
        <span style={{ fontSize: "12px", fontWeight: 700, color: "#777" }}>
          {synced ? `Last synced ${synced.toLocaleString()} · ${meta.total} entries, ${meta.committed ?? 0} committed` : meta ? "Not synced yet" : "Loading…"}
        </span>
      </div>
      {message && <div style={{ marginBottom: "12px", fontSize: "13px", fontWeight: 800, color: message.startsWith("Sync failed") || message.includes("failed") ? "#c0392b" : "#2e7d32" }}>{message}</div>}

      <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
        <button type="button" onClick={() => setTab("wd")} style={btn(tab === "wd")}>We-Draft Players{pending.length ? ` (${pending.length})` : ""}</button>
        <button type="button" onClick={() => setTab("all")} style={btn(tab === "all")}>All Activity{entries?.length ? ` (${entries.length})` : ""}</button>
      </div>

      {!entries ? <div style={{ color: "#999", fontWeight: 700 }}>Loading…</div> : tab === "wd" ? (
        <div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#555", marginBottom: "10px" }}>
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show up-to-date and dismissed
          </label>
          {visibleWd.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#999", fontWeight: 700, border: "1px dashed #ccc", borderRadius: "8px" }}>
              {wdRows.length ? "Nothing to update — every matched We-Draft player is up to date." : "No We-Draft players in this portal yet."}
            </div>
          ) : visibleWd.map((r) => {
            const k = rowKey(r);
            const isDismissed = !!dismissed[k];
            return (
              <div key={k} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 14px", padding: "10px 12px", border: "1px solid #e3e7ee", borderLeft: `4px solid ${r.rec.done ? "#2e7d32" : isDismissed ? "#bbb" : GOLD}`, borderRadius: "8px", marginBottom: "8px", background: "#fff", opacity: isDismissed ? 0.6 : 1 }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: "15px", color: "#1d2733" }}>
                    <a href={`/player/${r.p.Slug}`} target="_blank" rel="noopener noreferrer" style={{ color: BLUE }}>{r.p.First} {r.p.Last}</a>
                    <span style={{ marginLeft: "8px", fontSize: "11px", fontWeight: 800, color: "#888" }}>{r.p.Position} · {r.p.Eligible} · {r.p.School}</span>
                    {r.ambiguous && <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: 900, color: "#c0392b" }}>MULTIPLE MATCHES — check it's this player</span>}
                  </div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#666", marginTop: "2px" }}>
                    CFBD: {r.entry.origin} → {r.entry.dest || "uncommitted"} · {fmtDate(r.entry.date)}{r.entry.stars ? ` · ${r.entry.stars}★` : ""}{r.entry.elig ? ` · ${r.entry.elig}` : ""}
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 900, color: r.rec.done ? "#2e7d32" : "#1d2733", marginTop: "4px" }}>{r.rec.done ? "✓ " : "→ "}{r.rec.text}</div>
                </div>
                {!r.rec.done && (
                  <div style={{ display: "flex", gap: "6px" }}>
                    {!isDismissed && <button type="button" disabled={busyKey === k} onClick={() => apply(r)} style={btn(true)}>{busyKey === k ? "Saving…" : "Apply"}</button>}
                    <button type="button" onClick={() => setDismissed(r, !isDismissed)} style={btn(false, "#888")}>{isDismissed ? "Restore" : "Dismiss"}</button>
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#999", marginTop: "8px" }}>
            Matched by name + school (CFBD's portal has no player id). Players outside We-Draft just follow CFBD's rosters.
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
            <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search name, school, position…"
              style={{ flex: "1 1 220px", border: "2px solid #d6dce5", borderRadius: "8px", padding: "7px 10px", fontWeight: 700 }} />
            {[["all", "All"], ["committed", "Committed"], ["open", "Uncommitted"]].map(([v, label]) => (
              <button key={v} type="button" onClick={() => { setStatus(v); setShown(PAGE); }} style={btn(status === v)}>{label}</button>
            ))}
            <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#555" }}>
              <input type="checkbox" checked={wdOnly} onChange={(e) => { setWdOnly(e.target.checked); setShown(PAGE); }} /> We-Draft schools only
            </label>
          </div>
          <div style={{ border: "1px solid #e3e7ee", borderRadius: "8px", overflow: "hidden", background: "#fff" }}>
            {activity.slice(0, shown).map((e, i) => (
              <div key={e.key} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1.4fr) 44px 40px minmax(0, 2fr) 80px", gap: "10px", alignItems: "center", padding: "7px 12px", fontSize: "13px", background: i % 2 ? "#fafbfc" : "#fff", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ color: "#888", fontWeight: 700, fontSize: "12px" }}>{fmtDate(e.date)}</span>
                <span style={{ fontWeight: 900, color: "#1d2733", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.first} {e.last}</span>
                <span style={{ fontWeight: 800, color: "#888", fontSize: "12px" }}>{e.pos}</span>
                <span style={{ fontWeight: 800, color: GOLD, fontSize: "12px" }}>{e.stars ? `${e.stars}★` : ""}</span>
                <span style={{ fontWeight: 700, color: "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.origin} → {e.dest ? <b>{e.dest}</b> : <i style={{ color: "#c0392b" }}>uncommitted</i>}
                </span>
                <span style={{ fontWeight: 700, color: "#888", fontSize: "11px" }}>{e.elig || ""}</span>
              </div>
            ))}
            {activity.length === 0 && <div style={{ padding: "20px", textAlign: "center", color: "#999", fontWeight: 700 }}>{entries.length ? "No entries match." : "No portal activity for this season yet."}</div>}
          </div>
          {activity.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} style={{ ...btn(false), marginTop: "10px" }}>Show more ({activity.length - shown} left)</button>
          )}
        </div>
      )}
    </div>
  );
}
