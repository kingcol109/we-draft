// api/preview-og.js
//
// The link preview for a private preview link (src/utils/previewLinks.js):
//
//   GET ?token=<t>         a tiny HTML page with the og: tags — the player's
//                          name as the title, their pitch graphic as the
//                          image. middleware.js sends link-preview bots
//                          (Instagram's is facebookexternalhit) here for
//                          /player/<slug>?preview=<t>.
//   GET ?token=<t>&img=1   the graphic itself (previewImages/{t}, a JPEG)
//
// A missing or revoked link is a 404, so the bot falls back to a bare link.
// noindex everywhere: these pages are for whoever has the link.

const SITE = "https://we-draft.com";
const TOKEN_RE = /^[a-z0-9]{12,40}$/;
const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = async function handler(req, res) {
  const token = String(req.query?.token || "").toLowerCase();
  if (!TOKEN_RE.test(token)) return res.status(404).send("Not found");
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const db = getFirestore();
    const link = (await db.doc(`previewLinks/${token}`).get()).data();
    if (!link || link.active === false) return res.status(404).send("Not found");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    if (req.query?.img) {
      const img = (await db.doc(`previewImages/${token}`).get()).data();
      if (!img?.jpeg) return res.status(404).send("Not found");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
      return res.status(200).send(Buffer.from(img.jpeg, "base64"));
    }

    const url = `${SITE}/player/${encodeURIComponent(link.slug)}?preview=${token}`;
    const image = `${SITE}/api/preview-og?token=${token}&img=1`;
    const title = `${link.name} · We-Draft.com`;
    const description = "Your player profile preview on We-Draft.com, the NFL Draft and college football website.";
    const size = link.imageWidth && link.imageHeight
      ? `<meta property="og:image:width" content="${Number(link.imageWidth)}" /><meta property="og:image:height" content="${Number(link.imageHeight)}" />`
      : "";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
    return res.status(200).send(`<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="robots" content="noindex, nofollow" />
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="We-Draft.com" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:type" content="image/jpeg" />
${size}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="${esc(image)}" />
</head><body><a href="${esc(url)}">${esc(title)}</a></body></html>`);
  } catch (e) {
    console.error("preview-og:", e);
    return res.status(500).send("Error");
  }
};
