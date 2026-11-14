// src/components/AdminPortalSim.jsx
//
// Admin → Players → Transfer Portal → Portal Sim: every FBS team's tier
// (1 blue blood … 5) and each tier's portal NIL budget, for the Portal Sim
// (pages/PortalSim.jsx, utils/portalSim/). Saved to config/portalSim
// { tiers: { slug: tier }, config: { budgets } } — the sim lays these over
// its defaults (utils/portalSim/config.js mergeConfig). A team with no tier
// set uses the default (conference level + blue bloods, defaultTier).
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { FBS_CONFERENCES } from "../utils/portalTeams";
import { DEFAULT_CONFIG, defaultTier } from "../utils/portalSim/config";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const TIERS = [1, 2, 3, 4, 5];
const TIER_COLOR = { 1: "#7b2ff7", 2: "#0055a5", 3: "#2e7d32", 4: "#b45309", 5: "#5b6b84" };

export default function AdminPortalSim() {
  const [teams, setTeams] = useState(null);
  const [tiers, setTiers] = useState({});
  const [budgets, setBudgets] = useState(DEFAULT_CONFIG.budgets);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([getSiteSnapshot("_cfbTeams"), getDoc(doc(db, "config", "portalSim")).catch(() => null)]).then(([snap, cfg]) => {
      setTeams(snap?.teams || {});
      const d = cfg?.data() || {};
      setTiers(d.tiers || {});
      setBudgets({ ...DEFAULT_CONFIG.budgets, ...(d.config?.budgets || {}) });
    });
  }, []);

  const byConf = useMemo(() => {
    const groups = {};
    Object.entries(teams || {}).forEach(([slug, t]) => { (groups[t.Conference] = groups[t.Conference] || []).push({ slug, ...t }); });
    Object.values(groups).forEach((l) => l.sort((a, b) => a.School.localeCompare(b.School)));
    return FBS_CONFERENCES.filter((c) => groups[c]).map((c) => [c, groups[c]]);
  }, [teams]);
  const tierOf = (t) => Number(tiers[t.slug]) || defaultTier(t.School, t.Conference);
  const counts = useMemo(() => {
    const c = {};
    byConf.forEach(([, list]) => list.forEach((t) => { const k = tierOf(t); c[k] = (c[k] || 0) + 1; }));
    return c;
  }, [byConf, tiers]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTier = (slug, tier) => { setTiers((t) => ({ ...t, [slug]: tier })); setDirty(true); };
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      // Every team's tier is written, defaults included, so the sim and this
      // list always agree.
      const all = {};
      byConf.forEach(([, list]) => list.forEach((t) => { all[t.slug] = tierOf(t); }));
      await setDoc(doc(db, "config", "portalSim"), { tiers: all, config: { budgets }, updatedAt: serverTimestamp() }, { merge: true });
      setTiers(all); setDirty(false); setMessage("Saved — new sims use these tiers and budgets.");
    } catch (e) {
      console.error("Portal Sim config save error:", e);
      setMessage("Save failed — check console.");
    } finally {
      setSaving(false);
    }
  };

  if (!teams) return <div style={{ padding: 40, textAlign: "center", color: "#999", fontWeight: 700 }}>Loading FBS teams…</div>;
  return (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ background: BLUE, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ color: GOLD, fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em" }}>Portal Sim — Tiers &amp; Budgets</div>
          <a href="/portalsim" target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>Open Portal Sim ↗</a>
          <button type="button" onClick={save} disabled={saving || !dirty} style={{ marginLeft: "auto", background: dirty ? GOLD : "rgba(255,255,255,0.2)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontWeight: 900, fontSize: 12, textTransform: "uppercase", cursor: dirty ? "pointer" : "default" }}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
        <div style={{ padding: "12px 16px", background: "#fff", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {TIERS.map((t) => (
            <label key={t} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 900, color: TIER_COLOR[t], textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Tier {t} · {DEFAULT_CONFIG.tierLabels[t]} ({counts[t] || 0})
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#555" }}>
                $<input type="number" min={0} step={500000} value={budgets[t]} onChange={(e) => { setBudgets((b) => ({ ...b, [t]: Number(e.target.value) || 0 })); setDirty(true); }}
                  style={{ flex: 1, minWidth: 0, border: "2px solid #ddd", borderRadius: 6, padding: "6px 8px", fontWeight: 800, fontSize: 13 }} />
              </span>
            </label>
          ))}
        </div>
        <div style={{ padding: "8px 16px", background: "#f7f9fc", borderTop: "1px solid #eef1f5", fontSize: 11, fontWeight: 700, color: "#7a8594" }}>
          A team's tier sets its portal NIL budget, how many players it chases each window and how much players want to go there. Every other knob lives in utils/portalSim/config.js for now.
          {message && <span style={{ marginLeft: 8, color: message.includes("failed") ? "#c0392b" : "#2e7d32" }}>{message}</span>}
        </div>
      </div>

      {byConf.map(([conf, list]) => (
        <div key={conf} style={{ border: "2px solid #e3e8ef", borderRadius: 10, overflow: "hidden", marginBottom: 10, background: "#fff" }}>
          <div style={{ padding: "8px 14px", background: "#f7f9fc", borderBottom: "1px solid #e3e8ef", fontSize: 12, fontWeight: 900, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>{conf}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {list.map((t) => {
              const tier = tierOf(t);
              const set = tiers[t.slug] != null;
              return (
                <div key={t.slug} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid #f0f0f0" }}>
                  {t.Logo1 ? <img src={t.Logo1} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} /> : <span style={{ width: 24 }} />}
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 900, color: "#1d2733", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.School}{!set && <span style={{ marginLeft: 6, fontSize: 10, color: "#aaa", fontWeight: 800 }}>DEFAULT</span>}
                  </span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {TIERS.map((n) => (
                      <button key={n} type="button" onClick={() => setTier(t.slug, n)} title={DEFAULT_CONFIG.tierLabels[n]} style={{
                        width: 26, height: 24, borderRadius: 5, border: `2px solid ${tier === n ? TIER_COLOR[n] : "#e3e8ef"}`, background: tier === n ? TIER_COLOR[n] : "#fff",
                        color: tier === n ? "#fff" : "#8a94a3", fontWeight: 900, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                      }}>{n}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
