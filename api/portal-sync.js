// api/portal-sync.js
//
// The admin panel's Offseason Manager (Players → Offseason Manager):
//   POST { year }                 Transfer Portal "Run sync"
//                                 (components/AdminTransferPortal.js) —
//                                 server/portal/sync.js, one CFBD call;
//                                 then the public team pages rebuild
//                                 (server/portal/public.js).
//   POST { action: "cfbdIndex" }  Eligibility Manager "Refresh CFBD data"
//                                 (components/AdminEligibility.jsx) —
//                                 server/offseason/cfbdIndex.js, no CFBD calls.
//   POST { action: "pool" }       Transfer Portal → Grades "Update Sim pool"
//                                 (server/portalSim/pool.js — graded FCS
//                                 players join the Portal Sim)
//   POST { action: "stars" }      Transfer Portal → Grades "Rebuild"
//                                 (components/AdminPortalGrades.jsx) —
//                                 server/portal/stars.js, no outside calls.
//   POST { action: "pages" }      Transfer Portal → Team Pages "Rebuild" —
//                                 server/portal/public.js (the public team
//                                 pages' rosters, needs and sim targets)
//   POST { action: "signees", year, dry }  Team Pages "Import signees" —
//                                 server/portal/signees.js, one CFBD call
// Neither writes to players; the admin applies every change.
//
// Auth: the caller's Firebase ID token (Authorization: Bearer <token>),
// checked with Firebase Auth's own REST lookup (Google validates it — the
// Admin SDK's verifyIdToken can't load in a Vercel function, see
// scripts/firebaseAdmin.js getAuth), and their users/{uid} doc must have
// role "admin" — the same check as firestore.rules isAdmin(). Anyone else
// gets a 401/403, so the public can't spend CFBD calls.

// The site's public web API key (src/firebase.js) — identifies the project,
// grants nothing by itself.
const WEB_API_KEY = "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4";

async function uidFromToken(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  return (await r.json()).users?.[0]?.localId || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const uid = await uidFromToken(token);
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const db = getFirestore();
    const user = (await db.collection("users").doc(uid).get()).data();
    if (user?.role !== "admin") return res.status(403).json({ error: "admins only" });

    if (req.body?.action === "stars") {
      const { buildPortalStars } = require("../server/portal/stars");
      return res.status(200).json(await buildPortalStars(db));
    }
    if (req.body?.action === "pool") {
      const { buildPortalSimPool } = require("../server/portalSim/pool");
      return res.status(200).json(await buildPortalSimPool(db));
    }
    if (req.body?.action === "pages") {
      const { buildPortalPages } = require("../server/portal/public");
      return res.status(200).json(await buildPortalPages(db, { dry: !!req.body?.dry }));
    }
    if (req.body?.action === "signees") {
      const y = Number(req.body?.year) || new Date().getFullYear() + 1;
      const { importSignees } = require("../server/portal/signees");
      const r = await importSignees(db, { year: y, dry: !!req.body?.dry });
      return res.status(200).json({ ...r, sampleCreates: undefined, sampleUpdates: undefined });
    }
    if (req.body?.action === "cfbdIndex") {
      const { buildCfbdIndex } = require("../server/offseason/cfbdIndex");
      return res.status(200).json(await buildCfbdIndex(db));
    }
    const year = Number(req.body?.year) || new Date().getFullYear() + 1;
    if (year < 2021 || year > new Date().getFullYear() + 2) return res.status(400).json({ error: "bad year" });
    const { runPortalSync } = require("../server/portal/sync");
    const synced = await runPortalSync(db, { year });
    // The public portal pages follow the sync (their own failure doesn't
    // fail it — Team Pages → Rebuild retries).
    let pages = null;
    try {
      const { buildPortalPages } = require("../server/portal/public");
      pages = await buildPortalPages(db);
    } catch (e) {
      pages = { error: String(e.message || e).slice(0, 200) };
    }
    return res.status(200).json({ ...synced, pages });
  } catch (e) {
    console.error("portal-sync failed:", e.stack || e.message);
    return res.status(500).json({ error: "sync failed", detail: String(e.message || e).slice(0, 300) });
  }
};
