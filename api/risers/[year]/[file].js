// api/risers/[year]/[file].js
//
// A Draft Riser's graphic at a descriptive filename — what /risers/{year}
// (pages/Risers.jsx, utils/risers.js riserImageUrl) and Google Images see:
//
//   /api/risers/2027/dante-moore-2027-qb-nfl-draft-riser.webp
//   /api/risers/2027/dante-moore-2027-qb-nfl-draft-riser-600.webp   (smaller)
//   /api/risers/2027/dante-moore-2027-qb-nfl-draft-riser.png        (PNG)
//   …?v={board's last save}                                         (cached for good)
//
// The file is {player slug}-nfl-draft-riser[-600].{webp|png}; it's handed to
// api/riser-graphic.js (the drawing, the 404s, the caching) as
// ?player=&year=&w=&fmt=, so the older ?player= URLs keep working too.
const handler = require("../../riser-graphic.js");

const FILE = /^([a-z0-9-]{3,120})-nfl-draft-riser(-600)?\.(webp|png)$/;

module.exports = function riserFile(req, res) {
  const m = FILE.exec(String(req.query?.file || "").toLowerCase());
  if (!m) {
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(404).json({ error: "no graphic" });
  }
  const [, player, small, ext] = m;
  req.query = { ...req.query, player, year: String(req.query?.year || ""), w: small ? "600" : "", fmt: ext === "webp" ? "webp" : "" };
  return handler(req, res);
};
