// api/shop-admin.js — Admin → Shop (components/AdminShop.jsx).
// POST { action, ... } with the admin's Firebase ID token. The admin check
// (users/{uid}.role == "admin") happens here, server-side, on every call —
// hiding the tab in React is not the protection. Actions: server/shop/admin.js.

const { getFirestore } = require("../scripts/firebaseAdmin");
const { requireAdmin } = require("../server/shop/auth");
const { sendError } = require("../server/shop/http");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only." });
  try {
    const db = getFirestore();
    await requireAdmin(req, db);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const { handle } = require("../server/shop/admin");
    return res.status(200).json(await handle(db, String(body.action || ""), body));
  } catch (e) {
    return sendError(res, e, "shop-admin");
  }
};
