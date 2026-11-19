// src/utils/recruitSim/data.js
//
// Everything a new Recruit Sim save needs, loaded once a session — reused
// We-Draft data, no new collections:
//   portalSimPool/teams      FBS schools + campus coordinates (1 read)
//   config/portalSim         the admin's school tiers (same tiers the
//                            Portal Sim uses — one place to edit them)
//   config/recruitSim        optional knob overrides ({ config: {...} })
//   compSnapshots/_cfbTeams  logos and colors
//   teamRecords.json         recent success   } utils/portalSim/factors.js
//   draftHistory.json        NFL development  }
//   source.json              names, high schools, frames (bundled;
//                            scripts/buildRecruitSimSource.js)
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { getSiteSnapshot } from "../siteSnapshots";
import { buildFactors } from "../portalSim/factors";
import { mergeConfig as mergePortalConfig, defaultTier } from "../portalSim/config";

let loading = null;
export function loadRecruitSim() {
  if (!loading) {
    loading = (async () => {
      const [teamsSnap, portalCfg, recruitCfg, branding, records, draft, source] = await Promise.all([
        getDoc(doc(db, "portalSimPool", "teams")),
        getDoc(doc(db, "config", "portalSim")).catch(() => null),
        getDoc(doc(db, "config", "recruitSim")).catch(() => null),
        getSiteSnapshot("_cfbTeams"),
        import("../portalSim/teamRecords.json").then((m) => m.default || m),
        import("../draftSim/draftHistory.json").then((m) => m.default || m),
        import("./source.json").then((m) => m.default || m),
      ]);
      const teamsDoc = teamsSnap.data();
      if (!teamsDoc) throw new Error("School data isn't available.");
      const teams = (teamsDoc.teams || []).map((s) => JSON.parse(s)).filter((t) => !t[5])
        .map(([slug, school, conference, lat, lng]) => ({ slug, school, conference, loc: lat != null && lng != null ? [lat, lng] : null }));
      const admin = portalCfg?.data() || {};
      const factors = buildFactors(records, draft, teams.map((t) => t.school), mergePortalConfig(admin.config));
      return {
        teams,
        tiers: admin.tiers || {},
        config: recruitCfg?.data()?.config || {},
        branding: branding?.teams || {},
        factors,
        source,
      };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export { defaultTier };

// "$1.2M", "$450K".
export const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);
