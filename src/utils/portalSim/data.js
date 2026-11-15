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
import { decodeGrade } from "../portalStars.mjs";

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
      const factors = buildFactors(records, draft, pool.teams.map((t) => t.school), mergeConfig(admin.config));
      return {
        pool,
        factors,
        tiers: admin.tiers || {},
        config: admin.config || {},
        branding: branding?.teams || {},
      };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// Each player's community draft grade (dg: 1 = Early First … 10 = UDFA) and
// top strengths / weaknesses (str, weak) from the _grades snapshot rows
// ({ [wdId]: [avg, count, "s1|s2|s3", "w1|w2|w3"] }). Pure — headless runs use it.
export function attachDraftGrades(pool, rows) {
  const split = (v) => (v ? String(v).split("|").filter(Boolean) : []);
  pool.players.forEach((p) => {
    const row = p.wdId ? rows?.[p.wdId] : null;
    const avg = row?.[0];
    p.dg = Number.isFinite(Number(avg)) && avg != null ? Number(avg) : null;
    // The community's top strengths / weaknesses (player card).
    if (row?.[2]) p.str = split(row[2]);
    if (row?.[3]) p.weak = split(row[3]);
  });
  return pool;
}

// The admin's locks: a locked grade replaces the pool's stars, likeliness
// (0–3) rides along for the entry model. Pure — headless runs use it.
export function attachLocks(pool, rows) {
  if (!rows) return pool;
  pool.players.forEach((p) => {
    const code = rows[p.id] || (p.wdId && rows[`wd:${p.wdId}`]);
    if (!code) { p.likely = null; return; } // live doc wins over the pool's copy
    const g = decodeGrade(code);
    if (g.s) p.stars = g.s;
    p.likely = g.l;
  });
  return pool;
}

// "$1.2M", "$450K".
export const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);
