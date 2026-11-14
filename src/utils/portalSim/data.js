// src/utils/portalSim/data.js
//
// Everything a Portal Sim needs, loaded once a session: the player pool
// (portalSimPool — server/portalSim/pool.js, ~6 reads), the admin's tiers
// and knob overrides (config/portalSim — components/AdminPortalSim.jsx) and
// team branding (compSnapshots/_cfbTeams — utils/portalTeams.js).
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { getSiteSnapshot } from "../siteSnapshots";
import { expandPool } from "./pool.js";

let loading = null;
export function loadPortalSim() {
  if (!loading) {
    loading = (async () => {
      const [teamsSnap, cfgSnap, branding] = await Promise.all([
        getDoc(doc(db, "portalSimPool", "teams")),
        getDoc(doc(db, "config", "portalSim")).catch(() => null),
        getSiteSnapshot("_cfbTeams"),
      ]);
      const teamsDoc = teamsSnap.data();
      if (!teamsDoc) throw new Error("The Portal Sim pool hasn't been built.");
      const chunks = await Promise.all(Array.from({ length: teamsDoc.chunks || 0 }, (_, i) => getDoc(doc(db, "portalSimPool", `p${i}`)).then((s) => s.data())));
      const admin = cfgSnap?.data() || {};
      return {
        pool: expandPool(teamsDoc, chunks),
        tiers: admin.tiers || {},
        config: admin.config || {},
        branding: branding?.teams || {},
      };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// "$1.2M", "$450K".
export const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n || 0)}`);
