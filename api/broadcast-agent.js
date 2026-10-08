// api/broadcast-agent.js
//
// The worker VM's agent (server/broadcast-agent/agent.js) polls here every
// ~10s: it reports the worker containers it's running and gets back the
// ones it should be running (record id, game slug, stream slot, hard
// deadline). It never receives a credential — stream keys stay on the VM.
//
// Auth: `Authorization: Bearer <STREAM_AGENT_TOKEN>` (32+ random chars, set
// in Vercel and in the agent's token file on the VM). Compared in constant
// time. Logs never include the token.

const crypto = require("crypto");

function authorized(header) {
  const want = process.env.STREAM_AGENT_TOKEN || "";
  if (want.length < 32 || !/^Bearer \S+$/.test(String(header || ""))) return false;
  const got = String(header).slice(7);
  const a = crypto.createHash("sha256").update(got).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!authorized(req.headers.authorization)) return res.status(401).json({ error: "unauthorized" });
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { agentReport } = require("../server/stream-manager/orchestrator");
    return res.status(200).json(await agentReport(getFirestore(), req.body || {}));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("broadcast-agent failed:", e.message);
    return res.status(status).json({ error: String(e.message || e).slice(0, 300) });
  }
};
