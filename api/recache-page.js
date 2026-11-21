// api/recache-page.js
//
// An admin's "this page just changed — re-render it for search": asks
// Prerender.io to re-render one site page now, rather than waiting on its
// global recache timer, and marks our own stored copy (api/bot-render.js,
// prerenderCache) stale so the next bot visit takes the fresh render.
// Called by Admin → Content → WX → NFL Targets (AdminNflTargets.jsx) after
// a published list is saved, published or unpublished.
//
//   POST { path: "/nfl/nyj" }   Authorization: Bearer <Firebase ID token>
//
// Only the paths in ALLOWED (a page an admin edits from the site). Auth as
// api/portal-sync.js: the ID token checked with Firebase Auth's REST lookup,
// and the caller's users/{uid} must have role "admin". Needs PRERENDER_TOKEN.

const crypto = require("crypto");

const SITE = "https://we-draft.com";
// The site's public web API key (src/firebase.js) — identifies the project, grants nothing by itself.
const WEB_API_KEY = "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4";
const ALLOWED = [/^\/nfl\/[a-z]{2,3}$/];

async function uidFromToken(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  return (await r.json()).users?.[0]?.localId || null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const pagePath = String(req.body?.path || "").trim().toLowerCase();
  if (!ALLOWED.some((re) => re.test(pagePath))) return res.status(400).json({ error: "path not allowed" });
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.PRERENDER_TOKEN) return res.status(500).json({ error: "PRERENDER_TOKEN not set" });
  try {
    const uid = await uidFromToken(token);
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const db = getFirestore();
    const user = (await db.collection("users").doc(uid).get()).data();
    if (user?.role !== "admin") return res.status(403).json({ error: "admins only" });

    const url = `${SITE}${pagePath}`;
    // Our stored copy (keyed as api/bot-render.js keys it), if there is one, goes stale.
    const ref = db.collection("prerenderCache").doc(crypto.createHash("sha1").update(url).digest("hex"));
    if ((await ref.get()).exists) await ref.update({ stale: true });
    const r = await fetch("https://api.prerender.io/recache", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prerenderToken: process.env.PRERENDER_TOKEN, url }),
    });
    const detail = (await r.text()).slice(0, 300);
    if (!r.ok) {
      console.error("recache-page: Prerender.io said", r.status, detail);
      return res.status(502).json({ error: "recache failed", status: r.status, detail });
    }
    return res.status(200).json({ recached: url });
  } catch (e) {
    console.error("recache-page failed:", e.message);
    return res.status(500).json({ error: "recache failed", detail: String(e.message || e).slice(0, 300) });
  }
};
