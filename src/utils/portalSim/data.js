// src/utils/portalSim/data.js
//
// Everything a Portal Sim needs, loaded once a session: the player pool
// (portalSimPool — server/portalSim/pool.js, ~6 reads), the admin's tiers
// and knob overrides (config/portalSim — components/AdminPortalSim.jsx) and
// team branding (compSnapshots/_cfbTeams — utils/portalTeams.js) and
// community draft grades (compSnapshots/_grades — each We-Draft player's
// average, which drives opening window 1's NFL decisions), plus each
// school's recent success and player development (./factors.js — team
// records and draft history, bundled JSON loaded with the sim), and the
// admin's locked transfer grades + likeliness (config/portalGrades — the
// Grades tab), read live so a lock counts without rebuilding the pool.
// The real portal, always (user, 2026-11-18): every run puts the players
// really in it into the sim's portal — We-Draft's own portal records
// (players InPortal / PortalCycle), the admin's manual entries
// (config/portalManual) and CFBD's (compSnapshots/_portal_board), in that
// order of precedence (utils/portalData.js). Committed ones carry their
// real school (p.realTo) — the engine signs them there as the portal opens.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { fetchPortalBoard, fetchPortalManual, manualStands } from "../portalData";
import { portalTeamSlug } from "../portalTeams";
import { db } from "../../firebase";
import { getSiteSnapshot } from "../siteSnapshots";
import { expandPool } from "./pool.js";
import { buildFactors } from "./factors.js";
import { mergeConfig } from "./config.js";
import { attachDraftGrades, attachLocks } from "./attach.js";

export { attachDraftGrades, attachLocks };

let loading = null;
export function loadPortalSim() {
  if (!loading) {
    loading = (async () => {
      const [teamsSnap, cfgSnap, locksSnap, targetsSnap, branding, grades, records, draft] = await Promise.all([
        getDoc(doc(db, "portalSimPool", "teams")),
        getDoc(doc(db, "config", "portalSim")).catch(() => null),
        getDoc(doc(db, "config", "portalGrades")).catch(() => null),
        getDoc(doc(db, "config", "portalTargets")).catch(() => null),
        getSiteSnapshot("_cfbTeams"),
        getSiteSnapshot("_grades"),
        import("./teamRecords.json").then((m) => m.default || m),
        import("../draftSim/draftHistory.json").then((m) => m.default || m),
      ]);
      const teamsDoc = teamsSnap.data();
      if (!teamsDoc) throw new Error("The Portal Sim pool hasn't been built.");
      const chunks = await Promise.all(Array.from({ length: teamsDoc.chunks || 0 }, (_, i) => getDoc(doc(db, "portalSimPool", `p${i}`)).then((s) => s.data())));
      const admin = cfgSnap?.data() || {};
      const pool = expandPool(teamsDoc, chunks);
      attachDraftGrades(pool, grades?.rows);
      attachLocks(pool, locksSnap?.data()?.rows);
      await markRealPortal(pool).catch((e) => console.error("Portal Sim: real portal load", e));
      // FCS schools' branding rides in the pool.
      const brands = { ...(branding?.teams || {}) };
      pool.teams.forEach((t) => { if (t.fcs && t.brand) brands[t.slug] = t.brand; });
      const factors = buildFactors(records, draft, pool.teams.map((t) => t.school), mergeConfig(admin.config));
      return {
        pool,
        factors,
        tiers: admin.tiers || {},
        // The admin's recommended targets (Transfer Portal → Targets):
        // CPU schools chase theirs, yours show up as staff recommendations.
        targets: targetsSnap?.data()?.teams || {},
        config: admin.config || {},
        branding: brands,
        records, // team records (the desk's historian)
      };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// Mark the pool's players who are really in the portal: p.live, and
// p.realTo (a school slug) once they've committed. Withdrawn: left alone.
async function markRealPortal(pool) {
  const cycle = String((Number(pool.season) || new Date().getFullYear()) + 1);
  const byId = new Map(pool.players.map((p) => [String(p.id), p]));
  const byWd = new Map(pool.players.filter((p) => p.wdId).map((p) => [p.wdId, p]));
  const [inSnap, cycleSnap, board, manual] = await Promise.all([
    getDocs(query(collection(db, "players"), where("InPortal", "==", true))),
    getDocs(query(collection(db, "players"), where("PortalCycle", "==", cycle))),
    fetchPortalBoard().catch(() => ({ entries: [] })),
    fetchPortalManual().catch(() => ({})),
  ]);
  const real = new Map(); // pool id → { st: "u" | "c", to }
  const covered = new Set(); // We-Draft players with their own record
  [...inSnap.docs, ...cycleSnap.docs].forEach((d) => {
    const w = d.data();
    const pp = byWd.get(d.id);
    covered.add(d.id);
    if (!pp || real.has(String(pp.id))) return;
    if (!w.InPortal && w.PortalWithdrawnAt) return;
    real.set(String(pp.id), w.InPortal ? { st: "u" } : { st: "c", to: w.School || "" });
  });
  const cfbd = new Map((board.entries || []).filter((e) => e.id).map((e) => [String(e.id), e]));
  Object.values(manual || {}).forEach((m) => {
    if (!m.pid || (m.wd && covered.has(m.wd)) || real.has(String(m.pid)) || !manualStands(m, cfbd.get(String(m.pid)))) return;
    if (m.st === "u") real.set(String(m.pid), { st: "u" });
    else if (m.st === "c") real.set(String(m.pid), { st: "c", to: m.to || "" });
  });
  cfbd.forEach((e, id) => {
    if (real.has(id) || e.st === "w") return;
    real.set(id, e.st === "u" ? { st: "u" } : { st: "c", to: e.to || "" });
  });
  real.forEach((r, id) => {
    const p = byId.get(id);
    if (!p) return;
    p.live = true;
    p.realTo = r.st === "c" && r.to ? portalTeamSlug(r.to) : null;
  });
}

// "$1.2M", "$450K".
export const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);
