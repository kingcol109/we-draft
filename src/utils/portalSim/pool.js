// src/utils/portalSim/pool.js
//
// portalSimPool docs (server/portalSim/pool.js) → the engine's pool
// (./engine.js initPortalSim). Pure — the page's loader (./data.js) and
// headless test runs both use it.
import { unpackStats } from "./stats.mjs";

const ROLE = { s: "starter", r: "rotation", v: "reserve", n: "none" };

// teamsDoc: portalSimPool/teams data; chunks: [portalSimPool/p{n} data].
export function expandPool(teamsDoc, chunks) {
  const teams = (teamsDoc?.teams || []).map((s) => {
    const [slug, school, conference, lat, lng, fcs, brand] = JSON.parse(s);
    // fcs: an FCS school (only its admin-graded players are in the pool) —
    // it never recruits; brand: its logos / colors (FBS come from _cfbTeams).
    return { slug, school, conference, loc: lat != null && lng != null ? [lat, lng] : null, fcs: !!fcs, brand: brand || null };
  });
  const players = [];
  (chunks || []).forEach((c) => (c?.rows || []).forEach((s) => {
    const [id, name, pos, ti, stars, elig, role, hlat, hlng, wdId, flags, likely, ht, wt, rStars, state, stats, sub] = JSON.parse(s);
    const team = teams[ti];
    if (!team) return;
    players.push({
      id, name, pos, team: team.slug, stars, elig, role: ROLE[role] || "none",
      home: hlat != null && hlng != null ? [hlat, hlng] : null, wdId: wdId || "",
      declared: String(flags || "").includes("d"), live: String(flags || "").includes("l"),
      likely: likely ?? null,
      // Info / Stats views: height (in), weight, recruiting stars, home state, last season.
      ht: ht || null, wt: wt || null, rStars: rStars || null, state: state || "", stats: unpackStats(stats),
      sub: sub || "", // a DB's CB / S, an OL's OT / IOL
    });
  }));
  return { season: teamsDoc?.season || null, teams, players };
}
