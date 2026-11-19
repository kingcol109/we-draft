// api/portal-graphic.js
//
// A Portal News player's graphic (server/portalNewsImage.mjs) at one
// permanent URL per player — the image /portal/news shows (PortalNews.jsx)
// and Google indexes, like the Draft Risers' (api/riser-graphic.js):
//
//   GET ?player={slug}
//   &w=600     a smaller copy (the page's srcset)
//   &fmt=webp  WebP instead of PNG (the page's images; PNG for social previews)
//   &v=…       the board's last save (ms) — the page always sends it, and a
//              versioned image is cached for good (a new save is a new v)
// The page asks for it by a descriptive filename (api/portal-news/[file].js:
// /api/portal-news/colin-simmons-2027-edge-transfer-portal.webp), which lands here.
//
// Not on the board, or no placed action shot: a 404 marked noindex, so an
// old graphic can't linger in search.

function notFound(res, cache) {
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", cache);
  return res.status(404).json({ error: "no graphic" });
}

module.exports = async function handler(req, res) {
  const slug = String(req.query?.player || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return notFound(res, "public, max-age=86400");
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { portalNewsPng } = await import("../server/portalNewsImage.mjs");
    const width = String(req.query?.w || "") === "600" ? 600 : 1080;
    const format = String(req.query?.fmt || "") === "webp" ? "webp" : "png";
    const out = await portalNewsPng(getFirestore(), slug, { width, format });
    if (!out) return notFound(res, "public, max-age=300, s-maxage=600");
    res.setHeader("Content-Type", format === "webp" ? "image/webp" : "image/png");
    // A versioned URL (&v= the board's last save) never changes — cache it for good.
    res.setHeader("Cache-Control", req.query?.v ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=600, s-maxage=1800, stale-while-revalidate=600");
    return res.status(200).send(format === "webp" ? out.webp : out.png);
  } catch (e) {
    console.error("portal-graphic:", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "render failed" });
  }
};
