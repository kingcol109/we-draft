// api/live-ingest.js
//
// Vercel Cron target for We-Draft Live (schedule in vercel.json). Runs two
// ingestion ticks ~30s apart — see server/live/ingest.js. This is the only
// production path that calls CFBD; pages never trigger it.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the
// CRON_SECRET env var is set on the project. Anything else gets a 401, so
// the public can't make us spend CFBD calls. The response is a small run
// summary — never the API key or raw provider data.
//
// The ingester modules (firebase-admin etc.) are loaded only after the auth
// check, inside the try: a load failure then shows up as a logged error on
// an authorized call instead of crashing every request at startup.

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const { runTick, CONFIG } = require("../server/live/ingest");
    // Vercel Cron fires at most once a minute; live data wants ~30s, so each
    // call runs a second tick half a minute after the first one started.
    const db = getFirestore();
    const started = Date.now();
    const first = await runTick(db);
    await new Promise((r) => setTimeout(r, Math.max(0, CONFIG.TICK_INTERVAL_MS - (Date.now() - started))));
    const second = await runTick(db);
    return res.status(200).json({ ticks: [first, second] });
  } catch (e) {
    console.error("live-ingest failed:", e.stack || e.message);
    // Only an authorized caller gets here — the message helps diagnose a
    // misconfigured deploy (missing env var, module load failure).
    return res.status(500).json({ error: "ingest failed", detail: String(e.message || e).slice(0, 300) });
  }
};
