// scripts/liveIngest.js
//
// Runs the We-Draft Live ingester locally — same code the production cron
// endpoint (api/live-ingest.js) runs, sharing the same Firestore lock, so
// running this while production is also ticking is safe (one just skips).
//
//   node --env-file=.env scripts/liveIngest.js                one tick
//   node --env-file=.env scripts/liveIngest.js --force-slate  one tick, re-pull this week's /games
//   node --env-file=.env scripts/liveIngest.js --loop         tick every ~30s until stopped
//   node --env-file=.env scripts/liveIngest.js --game 401856699
//        full play-by-play + box score for one game (3 CFBD calls), ignoring
//        the plan's featured-only scope and timing rules

const { getFirestore } = require("./firebaseAdmin");
const { runTick, ingestOneGame, CONFIG } = require("../server/live/ingest");
const { getCallCount } = require("../server/live/cfbdClient");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

async function main() {
  const db = getFirestore();
  const gameId = value("--game");
  if (gameId) {
    const res = await ingestOneGame(db, Number(gameId));
    console.log(JSON.stringify({ ...res, big: res.big.map((b) => `Q${b.period} ${b.clock} ${b.label}: ${b.text.slice(0, 80)}`) }, null, 2));
    console.log(`CFBD calls: ${getCallCount()}`);
    return;
  }
  const tick = async () => {
    const res = await runTick(db, { log: console.log, forceSlate: flag("--force-slate") });
    console.log(new Date().toISOString(), JSON.stringify(res));
  };
  if (!flag("--loop")) { await tick(); return; }
  // Back-to-back, CONFIG.TICK_INTERVAL_MS (~30s) apart start to start — never overlapping itself
  // (a slow tick just delays the next one instead of colliding with it).
  for (;;) {
    const started = Date.now();
    await tick().catch((e) => console.error(new Date().toISOString(), "tick failed:", e.message));
    await new Promise((r) => setTimeout(r, Math.max(5000, CONFIG.TICK_INTERVAL_MS - (Date.now() - started))));
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
