// api/riser-graphic.js
//
// A Draft Riser's graphic (server/riserImage.mjs) as a PNG, at one permanent
// URL per riser and class — the image /risers/{year} shows (Risers.jsx) and
// Google indexes:
//
//   GET ?player={slug}&year=2027
//   &w=600     a smaller copy (the page's srcset)
//   &fmt=webp  WebP instead of PNG (the page's images; PNG for social previews)
//   &ed=2026-11-17  a past edition's graphic (riserEditions — as published then)
// The page asks for it by a descriptive filename (api/risers/[year]/[file].js:
// /api/risers/2027/dante-moore-2027-qb-nfl-draft-riser.webp), which lands here.
//   &v=…       the board's last save (ms) — the page always sends it, and a
//              versioned image is cached for good (a new save is a new v)
//
// Not a riser, or no placed action shot: a 404 marked noindex, so an old
// graphic can't linger in search. The shot is the one saved on him on the
// admin's Save (riser.shot).

const YEARS = ["2027", "2028", "2029"];

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
    const { riserPng } = await import("../server/riserImage.mjs");
    const width = String(req.query?.w || "") === "600" ? 600 : 1080;
    const format = String(req.query?.fmt || "") === "webp" ? "webp" : "png";
    const edition = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query?.ed || "")) ? String(req.query.ed) : "";
    const out = await riserPng(getFirestore(), slug, year, { width, format, edition });
    if (!out) return notFound(res, "public, max-age=300, s-maxage=600");
    res.setHeader("Content-Type", format === "webp" ? "image/webp" : "image/png");
    // A versioned URL (&v= the board's last save) never changes — cache it for good.
    res.setHeader("Cache-Control", req.query?.v ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=600, s-maxage=1800, stale-while-revalidate=600");
    return res.status(200).send(format === "webp" ? out.webp : out.png);
  } catch (e) {
    console.error("riser-graphic:", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "render failed" });
  }
};
