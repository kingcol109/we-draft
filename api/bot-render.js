// api/bot-render.js
//
// A bot's page, from our own prerender cache (policy: api/_botCachePolicy.js).
// middleware.js calls it for every search / link-preview bot request:
//
//   GET ?url=<the page's full URL>, header x-bot-cache-key: $PRERENDER_TOKEN
//
// A type that isn't live yet → 204 (x-bot-cache: bypass); the middleware
// asks Prerender.io directly, as before. Otherwise:
//   - a stored copy still inside its type's schedule → served (hit)
//   - else Prerender.io renders it (miss); a 200 is stored (gzipped) and
//     served; any other status (404, 301 …) is passed through as is, and a
//     404 / 410 drops our stored copy
//   - Prerender.io failing (5xx, a timeout) with a stored copy → the old
//     copy (stale) rather than an error page
// Every response we mean carries x-bot-cache; anything without it (a crash)
// sends the middleware back to Prerender.io directly. So the worst a
// failure here does is what the site did before.

const crypto = require("crypto");
const zlib = require("zlib");
const { typeOf, ENABLED } = require("./_botCachePolicy");

const COLLECTION = "prerenderCache";
// Firestore's document cap is 1 MiB — leave room for the other fields.
const MAX_STORED_BYTES = 950 * 1024;
const RENDER_TIMEOUT_MS = 25000;

function keyOk(header, secret) {
  if (!secret) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(header || ""), h(secret));
}

const docId = (url) => crypto.createHash("sha1").update(url).digest("hex");

function send(res, kind, status, html, location) {
  res.setHeader("x-bot-cache", kind);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (location) res.setHeader("Location", location);
  return res.status(status).send(html);
}

async function render(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RENDER_TIMEOUT_MS);
  try {
    const r = await fetch(`https://service.prerender.io/${url}`, {
      headers: { "X-Prerender-Token": process.env.PRERENDER_TOKEN }, redirect: "manual", signal: ctrl.signal,
    });
    return { status: r.status, html: await r.text(), location: r.headers.get("location") };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (!keyOk(req.headers["x-bot-cache-key"], process.env.PRERENDER_TOKEN)) return res.status(401).json({ error: "unauthorized" });
  let url;
  try { url = new URL(String(req.query?.url || "")); } catch { return res.status(400).json({ error: "bad url" }); }
  const page = url.toString();
  const type = typeOf(url.pathname);
  if (!type || !ENABLED.has(type.type)) {
    res.setHeader("x-bot-cache", "bypass");
    return res.status(204).end();
  }

  const { getFirestore } = require("../scripts/firebaseAdmin");
  const ref = getFirestore().collection(COLLECTION).doc(docId(page));
  let stored = null;
  try {
    const snap = await ref.get();
    stored = snap.exists ? snap.data() : null;
  } catch (e) {
    console.error("bot-render: cache read failed", e.message);
  }
  const fresh = stored?.html && !stored.stale && Date.now() - (stored.renderedAt || 0) < type.days * 86400000;
  if (fresh) return send(res, "hit", 200, zlib.gunzipSync(Buffer.from(stored.html)).toString("utf8"));

  let out;
  try {
    out = await render(page);
  } catch (e) {
    console.error("bot-render: render failed", page, e.message);
  }
  if (out && out.status === 200 && out.html) {
    const gz = zlib.gzipSync(out.html);
    if (gz.length <= MAX_STORED_BYTES) {
      await ref.set({ url: page, path: url.pathname, type: type.type, renderedAt: Date.now(), stale: false, html: gz })
        .catch((e) => console.error("bot-render: cache write failed", e.message));
    }
    return send(res, "miss", 200, out.html);
  }
  // Prerender.io down or slow: the copy we have beats an error page.
  if ((!out || out.status >= 500) && stored?.html) return send(res, "stale", 200, zlib.gunzipSync(Buffer.from(stored.html)).toString("utf8"));
  if (out) {
    // The page itself is gone (or moved): drop our copy, pass the answer on.
    if ([404, 410].includes(out.status) && stored) await ref.delete().catch(() => {});
    return send(res, "pass", out.status, out.html, out.location);
  }
  return res.status(502).json({ error: "render failed" });
};
