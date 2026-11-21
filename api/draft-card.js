// api/draft-card.js
//
// A featured NFL Targets player's draft card (server/draftCardImage.mjs) as
// an image, at one permanent URL per player and team — what the team page's
// Targets tab shows (components/TeamTargetsWX.jsx), Google Images indexes,
// and the team page's link preview uses:
//
//   GET ?player={slug}&year=2027&team=nyj
//   &w=600     a smaller copy (the page's srcset)
//   &fmt=webp  WebP instead of PNG (the page's images; PNG for link previews)
//   &v=…       the list's last save (ms) — the page always sends it, and a
//              versioned image is cached for good (a new save is a new v)
// The page asks for it by a descriptive filename
// (api/draft-cards/[year]/[file].js:
// /api/draft-cards/2027/drew-mestemaker-2027-qb-nfl-draft-prospect.webp?team=nyj),
// which lands here. utils/nflTargets.js draftCardImageUrl builds it.
//
// Not featured on that team's published list: a 404 marked noindex, so an
// old card can't linger in search.

const YEARS = ["2027", "2028", "2029"];

function notFound(res, cache) {
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Cache-Control", cache);
  return res.status(404).json({ error: "no card" });
}

module.exports = async function handler(req, res) {
  const slug = String(req.query?.player || "").trim().toLowerCase();
  const year = String(req.query?.year || YEARS[0]);
  const team = String(req.query?.team || "").trim().toUpperCase();
  if (!/^[a-z0-9-]{3,120}$/.test(slug) || !YEARS.includes(year) || !/^[A-Z]{2,3}$/.test(team)) return notFound(res, "public, max-age=86400");
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { draftCardPng } = await import("../server/draftCardImage.mjs");
    const width = String(req.query?.w || "") === "600" ? 600 : 1080;
    const format = String(req.query?.fmt || "") === "webp" ? "webp" : "png";
    const out = await draftCardPng(getFirestore(), slug, year, team, { width, format });
    if (!out) return notFound(res, "public, max-age=300, s-maxage=600");
    res.setHeader("Content-Type", format === "webp" ? "image/webp" : "image/png");
    res.setHeader("Cache-Control", req.query?.v ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=600, s-maxage=1800, stale-while-revalidate=600");
    return res.status(200).send(format === "webp" ? out.webp : out.png);
  } catch (e) {
    console.error("draft-card:", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "render failed" });
  }
};
