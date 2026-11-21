// api/draft-cards/[year]/[file].js
//
// A featured NFL Targets player's draft card at a descriptive filename —
// what the team page (components/TeamTargetsWX.jsx, utils/nflTargets.js
// draftCardImageUrl) and Google Images see:
//
//   /api/draft-cards/2027/drew-mestemaker-2027-qb-nfl-draft-prospect.webp?team=nyj
//   /api/draft-cards/2027/drew-mestemaker-2027-qb-nfl-draft-prospect-600.webp?team=nyj  (smaller)
//   /api/draft-cards/2027/drew-mestemaker-2027-qb-nfl-draft-prospect.png?team=nyj       (PNG)
//   …&v={the list's last save}                                                           (cached for good)
//
// The file is {player slug}-nfl-draft-prospect[-600].{webp|png}; it's handed
// to api/draft-card.js (the drawing, the 404s, the caching) as
// ?player=&year=&team=&w=&fmt=.
const handler = require("../../draft-card.js");

const FILE = /^([a-z0-9-]{3,120})-nfl-draft-prospect(-600)?\.(webp|png)$/;

module.exports = function draftCardFile(req, res) {
  const m = FILE.exec(String(req.query?.file || "").toLowerCase());
  if (!m) {
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(404).json({ error: "no card" });
  }
  const [, player, small, ext] = m;
  req.query = { ...req.query, player, year: String(req.query?.year || ""), w: small ? "600" : "", fmt: ext === "webp" ? "webp" : "" };
  return handler(req, res);
};
