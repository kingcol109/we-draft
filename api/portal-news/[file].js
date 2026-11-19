// api/portal-news/[file].js
//
// A Portal News player's graphic at a descriptive filename — what
// /portal/news (pages/PortalNews.jsx, utils/portalNews.js portalImageUrl)
// and Google Images see:
//
//   /api/portal-news/colin-simmons-2027-edge-transfer-portal.webp
//   /api/portal-news/colin-simmons-2027-edge-transfer-portal-600.webp   (smaller)
//   /api/portal-news/colin-simmons-2027-edge-transfer-portal.png        (PNG)
//   …?v={board's last save}                                             (cached for good)
//
// The file is {player slug}-transfer-portal[-600].{webp|png}; it's handed to
// api/portal-graphic.js (the drawing, the 404s, the caching) as
// ?player=&w=&fmt=.
const handler = require("../portal-graphic.js");

const FILE = /^([a-z0-9-]{3,120})-transfer-portal(-600)?\.(webp|png)$/;

module.exports = function portalNewsFile(req, res) {
  const m = FILE.exec(String(req.query?.file || "").toLowerCase());
  if (!m) {
    res.setHeader("X-Robots-Tag", "noindex");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(404).json({ error: "no graphic" });
  }
  const [, player, small, ext] = m;
  req.query = { ...req.query, player, w: small ? "600" : "", fmt: ext === "webp" ? "webp" : "" };
  return handler(req, res);
};
