// scripts/backfillPastGames.js
//
// Brings finished games from earlier weeks into We-Draft Live's data
// (liveGames/{id} + plays + box score) so their game pages show Game
// Stats, the same as games the live ingester covered. Only games linked to
// a schedule26 game (CFBDGameId) — the ones with a We-Draft game page.
//
// Uses CFBD's week-level endpoints, so it's cheap: per week 1 call for the
// schedule, 1 for every play of the week, 1 for every box score; plus one
// roster call per team (cached for a day) for player names. Plays go
// through the ingester's own pipeline (server/live/ingest.js storePlays:
// parser, rosters, dedupe, feed lists), so they're stored exactly like
// live ones. Safe to rerun — unchanged plays aren't rewritten.
//
//   node --env-file=.env scripts/backfillPastGames.js --weeks 1-4 [--dry]

const { getFirestore } = require("./firebaseAdmin");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");
const P = require("../server/live/provider");
const S = require("../server/live/store");
const { enrich, storePlays } = require("../server/live/ingest");

const SEASON = 2026;
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const wArg = args[args.indexOf("--weeks") + 1] || "";
const [w1, w2] = wArg.split("-").map(Number);
if (!w1) { console.error("Pass --weeks 1-4"); process.exit(1); }
const WEEKS = Array.from({ length: (w2 || w1) - w1 + 1 }, (_, i) => w1 + i);

async function run() {
  const db = getFirestore();
  const sched = await db.collection("schedule26").where("CFBDGameId", "!=", null).select("CFBDGameId").get();
  const mapped = new Set(sched.docs.map((d) => d.data().CFBDGameId));
  const rosterBudget = { left: 400 };
  let totalGames = 0, totalPlays = 0;

  for (const week of WEEKS) {
    const games = (await cfbd.games({ year: SEASON, week, seasonType: "regular" }))
      .filter((g) => g.completed && mapped.has(g.id));
    if (!games.length) { console.log(`week ${week}: no finished mapped games`); continue; }
    const [allPlays, boxes] = await Promise.all([
      cfbd.plays({ year: SEASON, week, seasonType: "regular" }),
      cfbd.gamePlayers({ year: SEASON, week, seasonType: "regular", classification: "fbs" }),
    ]);
    const playsByGame = new Map();
    for (const p of allPlays) {
      if (!playsByGame.has(p.gameId)) playsByGame.set(p.gameId, []);
      playsByGame.get(p.gameId).push(p);
    }
    const boxById = new Map(boxes.map((b) => [b.id, b]));
    console.log(`week ${week}: ${games.length} finished mapped games, ${allPlays.length} plays, ${boxes.length} box scores`);
    if (DRY) continue;

    // liveGames docs (normalized + We-Draft enrichment), then plays + box.
    const normalized = (await enrich(db, games.map((g) => P.gameFromCfbdGame(g)))).map((g) => JSON.parse(JSON.stringify(g)));
    const { current } = await S.upsertGames(db, normalized);
    for (const g of games) {
      const game = current.get(String(g.id));
      const raw = playsByGame.get(g.id) || [];
      if (!game || !raw.length) continue;
      try {
        const res = await storePlays(db, game, raw.map(P.playFromHistorical), null, { complete: true, rosterBudget });
        const box = P.boxFromCfbd(boxById.get(g.id) ? [boxById.get(g.id)] : []);
        if (box) await S.saveBox(db, game, box);
        await S.setGameFields(db, g.id, { postgame: { done: true, backfilled: true, plays: raw.length, lastAttemptAt: Date.now() } });
        totalGames++;
        totalPlays += res.total;
      } catch (e) {
        console.log(`  game ${g.id} failed: ${e.message}`);
      }
    }
    console.log(`  stored ${totalGames} games so far (CFBD calls ${getCallCount()})`);
  }
  console.log(`${DRY ? "[dry] " : ""}done: ${totalGames} games, ${totalPlays} plays. CFBD calls: ${getCallCount()}.`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
