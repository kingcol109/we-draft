// api/senior-bowl/[year]/[file].js
//
// A Senior Bowl Top Performer's graphic at a descriptive filename — what the
// performances page (utils/seniorBowlPerf.js perfImageUrl) and Google see:
//   /api/senior-bowl/2027/dante-moore-senior-bowl-top-performer.webp
//   /api/senior-bowl/2027/dante-moore-senior-bowl-top-performer-600.webp
//   …png, …?v={list's last save}
// Handed to api/senior-bowl-graphic.js as ?player=&year=&w=&fmt=.
const handler = require("../../senior-bowl-graphic.js");

const FILE = /^([a-z0-9-]{3,120})-senior-bowl-top-performer(-600)?\.(webp|png)$/;

module.exports = function perfFile(req, res) {
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
