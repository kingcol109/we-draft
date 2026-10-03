// api/live-ingest.js
//
// Vercel Cron target for We-Draft Live (schedule in vercel.json). Runs two
// ingestion ticks ~30s apart — see server/live/ingest.js. This is the only production
// path that calls CFBD; pages never trigger it.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the
// CRON_SECRET env var is set on the project. Anything else gets a 401, so
// the public can't make us spend CFBD calls. The response is a small run
// summary — never the API key or raw provider data.

const { getFirestore } = require("../scripts/firebaseAdmin");
const { runTick, CONFIG } = require("../server/live/ingest");

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    // Vercel Cron fires at most once a minute; live data wants ~30s, so each
    // call runs a second tick half a minute after the first one started.
    const db = getFirestore();
    const started = Date.now();
    const first = await runTick(db);
    await new Promise((r) => setTimeout(r, Math.max(0, CONFIG.TICK_INTERVAL_MS - (Date.now() - started))));
    const second = await runTick(db);
    return res.status(200).json({ ticks: [first, second] });
  } catch (e) {
    console.error("live-ingest failed:", e.message);
    return res.status(500).json({ error: "ingest failed" });
  }
};
