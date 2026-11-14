// src/utils/portalSim/pool.js
//
// portalSimPool docs (server/portalSim/pool.js) → the engine's pool
// (./engine.js initPortalSim). Pure — the page's loader (./data.js) and
// headless test runs both use it.
const ROLE = { s: "starter", r: "rotation", v: "reserve", n: "none" };

// teamsDoc: portalSimPool/teams data; chunks: [portalSimPool/p{n} data].
export function expandPool(teamsDoc, chunks) {
  const teams = (teamsDoc?.teams || []).map((s) => {
    const [slug, school, conference, lat, lng] = JSON.parse(s);
    return { slug, school, conference, loc: lat != null && lng != null ? [lat, lng] : null };
  });
  const players = [];
  (chunks || []).forEach((c) => (c?.rows || []).forEach((s) => {
    const [id, name, pos, ti, stars, elig, role, hlat, hlng, wdId, flags] = JSON.parse(s);
    const team = teams[ti];
    if (!team) return;
    players.push({
      id, name, pos, team: team.slug, stars, elig, role: ROLE[role] || "none",
      home: hlat != null && hlng != null ? [hlat, hlng] : null, wdId: wdId || "",
      declared: String(flags || "").includes("d"), live: String(flags || "").includes("l"),
    });
  }));
  return { season: teamsDoc?.season || null, teams, players };
}
