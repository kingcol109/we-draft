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
import { doc, getDoc } from "firebase/firestore";
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
      const [teamsSnap, cfgSnap, locksSnap, branding, grades, records, draft] = await Promise.all([
        getDoc(doc(db, "portalSimPool", "teams")),
        getDoc(doc(db, "config", "portalSim")).catch(() => null),
        getDoc(doc(db, "config", "portalGrades")).catch(() => null),
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
      // FCS schools' branding rides in the pool.
      const brands = { ...(branding?.teams || {}) };
      pool.teams.forEach((t) => { if (t.fcs && t.brand) brands[t.slug] = t.brand; });
      const factors = buildFactors(records, draft, pool.teams.map((t) => t.school), mergeConfig(admin.config));
      return {
        pool,
        factors,
        tiers: admin.tiers || {},
        config: admin.config || {},
        branding: brands,
        records, // team records (the desk's historian)
      };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// "$1.2M", "$450K".
export const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);
