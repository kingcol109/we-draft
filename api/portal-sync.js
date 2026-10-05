// api/portal-sync.js
//
// The admin panel's Transfer Portal "Run sync" button (Player Data →
// Transfer Portal, components/AdminTransferPortal.js). POST { year }.
// Runs server/portal/sync.js — one CFBD call.
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

    const year = Number(req.body?.year) || new Date().getFullYear() + 1;
    if (year < 2021 || year > new Date().getFullYear() + 2) return res.status(400).json({ error: "bad year" });
    const { runPortalSync } = require("../server/portal/sync");
    return res.status(200).json(await runPortalSync(db, { year }));
  } catch (e) {
    console.error("portal-sync failed:", e.stack || e.message);
    return res.status(500).json({ error: "sync failed", detail: String(e.message || e).slice(0, 300) });
  }
};
