// api/first-pick.js
//
// A team's First Pick graphic (server/firstPickImage.mjs) as a PNG, at one
// permanent URL per team page — the image its Weekly Mock page shows
// (WeeklyTeamMock.jsx) and Google indexes:
//
//   GET ?team=nyj&year=2027   /mocks/nyj's
//   GET ?team=nyj&year=2028   /mocks/nyj/2028's
//   &w=600                    a smaller copy (the page's srcset) — the
//                             full 1080 × 1350 is the one to index
//
// The URL never changes: a new week (or a new action shot) is a new image
// at the same address, so Google only ever has the current one — never a
// pile of past weeks. When the team's first pick has no placed action
// shot, a 404 marked noindex, so a graphic from an earlier week can't
// linger in search. A player with more than one placed shot gets one at
// random; the cache below is how long it stays before another is drawn.
// recache-mocks.js refreshes the pages on publish; the edge copy here
// turns over within the hour on its own.

const TEAMS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS",
]);
// The classes with team pages (weeklyMockNews.js TEAM_PAGE_YEARS).
const TEAM_PAGE_YEARS = ["2027", "2028"];

function notFound(res, cache) {
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", cache);
  return res.status(404).json({ error: "no graphic" });
}

module.exports = async function handler(req, res) {
  const team = String(req.query?.team || "").toUpperCase();
  const year = String(req.query?.year || TEAM_PAGE_YEARS[0]);
  if (!TEAMS.has(team) || !TEAM_PAGE_YEARS.includes(year)) return notFound(res, "public, max-age=86400");
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { firstPickPng } = await import("../server/firstPickImage.mjs");
    const width = String(req.query?.w || "") === "600" ? 600 : 1080;
    const out = await firstPickPng(getFirestore(), team, year, { width });
    // None this week: checked again soon (a shot may be placed any time).
    if (!out) return notFound(res, "public, max-age=300, s-maxage=600");
    res.setHeader("Content-Type", "image/png");
    // Half an hour at the edge (then another of his shots may be drawn),
    // ten minutes in a browser; a stale copy served while it redraws.
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=1800, stale-while-revalidate=600");
    return res.status(200).send(out.png);
  } catch (e) {
    console.error("first-pick:", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "render failed" });
  }
};
