// api/stream-orchestrator.js
//
// Vercel Cron target (every minute, vercel.json): one tick of the automated
// broadcast reconciler, server/stream-manager/orchestrator.js. Each tick
// reads Firestore, the VM and YouTube and moves each enabled broadcast one
// step; nothing waits between ticks, so no function has to stay alive.
//
// Auth: same as api/live-ingest.js — Vercel Cron sends
// `Authorization: Bearer $CRON_SECRET`; anything else gets a 401. The
// response is the tick summary (record ids, phases, errors) — never tokens.

const crypto = require("crypto");

// Constant-time compare of the whole header (hashed to equal lengths).
function authorized(header, secret) {
  if (!secret) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(header || ""), h(`Bearer ${secret}`));
}

module.exports = async function handler(req, res) {
  if (!authorized(req.headers.authorization, process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.setHeader("Cache-Control", "no-store");
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { runTick } = require("../server/stream-manager/orchestrator");
    return res.status(200).json(await runTick(getFirestore()));
  } catch (e) {
    console.error("stream-orchestrator failed:", e.message);
    return res.status(500).json({ error: "tick failed", detail: String(e.message || e).slice(0, 300) });
  }
};
