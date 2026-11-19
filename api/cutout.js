// api/cutout.js
//
// An action shot ready for a graphic, prepared once: the cut-out trimmed to
// the player (server/firstPickImage.mjs featureImage — the same work the
// browser's loadFeatureImage does, SocialMakerKit.js) as a PNG, so a page
// drawing a pick graphic in the browser (the Draft Sim's Desk cards,
// FirstPickGraphic.jsx) just loads it instead of decoding, scanning and
// re-encoding the photo itself.
//
//   GET ?u=https://i.imgur.com/VRVqQYa.png
//
// An imgur image never changes at its address, so its prepared copy is
// cached for good: drawn once ever per shot. Its size comes back in
// X-Image-Width / X-Image-Height. Only imgur photos (where the action shots
// live); anything else is a 400.
const ALLOWED = /^https:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.(png|jpe?g|webp)$/i;

module.exports = async function handler(req, res) {
  const url = String(req.query?.u || "");
  if (!ALLOWED.test(url)) {
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(400).json({ error: "not an action shot" });
  }
  try {
    const { featureImage } = await import("../server/firstPickImage.mjs");
    const im = await featureImage(url);
    const m = /^data:image\/png;base64,(.+)$/.exec(im?.href || "");
    if (!m) {
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(404).json({ error: "couldn't load it" });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Image-Width", String(im.w || ""));
    res.setHeader("X-Image-Height", String(im.h || ""));
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    return res.status(200).send(Buffer.from(m[1], "base64"));
  } catch (e) {
    console.error("cutout:", e);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: "failed" });
  }
};
