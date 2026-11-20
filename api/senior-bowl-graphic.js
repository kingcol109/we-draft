// api/senior-bowl-graphic.js
//
// A Senior Bowl Top Performer's graphic (server/seniorBowlPerfImage.mjs) at
// one permanent URL per performer and year — what the performances page
// shows and Google indexes. Same contract as api/riser-graphic.js:
//   GET ?player={slug}&year=2027  &w=600  &fmt=webp  &ed=2027-01-27  &v=…
// The page asks for it by a descriptive filename
// (api/senior-bowl/[year]/[file].js), which lands here. Not on the list, or
// no placed shot: a 404 marked noindex.
const YEARS = ["2027"];

function notFound(res, cache) {
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", cache);
  return res.status(404).json({ error: "no graphic" });
}

module.exports = async function handler(req, res) {
  const slug = String(req.query?.player || "").trim().toLowerCase();
  const year = String(req.query?.year || YEARS[0]);
  if (!/^[a-z0-9-]{3,120}$/.test(slug) || !YEARS.includes(year)) return notFound(res, "public, max-age=86400");
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { perfPng } = await import("../server/seniorBowlPerfImage.mjs");
    const width = String(req.query?.w || "") === "600" ? 600 : 1080;
    const format = String(req.query?.fmt || "") === "webp" ? "webp" : "png";
    const edition = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.ed || "")) ? String(req.query.ed) : "";
    const out = await perfPng(getFirestore(), slug, year, { width, format, edition });
    if (!out) return notFound(res, "public, max-age=300, s-maxage=600");
    res.setHeader("Content-Type", format === "webp" ? "image/webp" : "image/png");
    // A versioned URL (&v= the list's last save) never changes — cache it for good.
    res.setHeader("Cache-Control", req.query?.v ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=600, s-maxage=1800, stale-while-revalidate=600");
    return res.status(200).send(format === "webp" ? out.webp : out.png);
  } catch (e) {
    console.error("senior-bowl-graphic:", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "render failed" });
  }
};
