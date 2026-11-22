// server/shop/auth.js
//
// Who's calling. Same check as api/portal-sync.js: the Firebase ID token
// (Authorization: Bearer <token>) is validated by Firebase Auth's own REST
// lookup (the Admin SDK's verifyIdToken can't load in a Vercel function —
// see scripts/firebaseAdmin.js getAuth), and admins are users/{uid} docs
// with role "admin", the same as firestore.rules isAdmin().

const { userError } = require("./config");

// The site's public web API key (src/firebase.js) — identifies the
// project, grants nothing by itself.
const WEB_API_KEY = "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4";

function bearer(req) {
  const h = req.headers?.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

// { uid, email } for a valid token, null otherwise.
async function userFromToken(idToken) {
  if (!idToken || idToken.length > 4096) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  const u = (await r.json()).users?.[0];
  return u?.localId ? { uid: u.localId, email: u.email || null } : null;
}

// Signed in or not — a bad token counts as a guest rather than failing the
// purchase (the token may simply have expired mid-session).
async function optionalUser(req) {
  try { return await userFromToken(bearer(req)); } catch { return null; }
}

async function requireUser(req) {
  const u = await optionalUser(req);
  if (!u) throw userError(401, "Please sign in.");
  return u;
}

async function requireAdmin(req, db) {
  const u = await requireUser(req);
  const doc = await db.collection("users").doc(u.uid).get();
  if (doc.data()?.role !== "admin") throw userError(403, "Admins only.");
  return u;
}

module.exports = { optionalUser, requireUser, requireAdmin };
