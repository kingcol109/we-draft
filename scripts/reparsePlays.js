// scripts/reparsePlays.js
//
// Re-runs server/live/playParser.js over plays already in Firestore, from
// their stored raw CFBD text — no play re-fetching (the only CFBD calls are
// team rosters not built yet, 1 per team, for player linking). Use after
// improving the parser (bump PARSER_VERSION) or to backfill plays stored
// before `presentation` existed. Writes only plays whose presentation
// changed, then refreshes the big-play entries in liveSlate/current.
//
//   node --env-file=.env scripts/reparsePlays.js --game 401856707 [--game ...]
//   node --env-file=.env scripts/reparsePlays.js --slate      every game on the current slate
//   add --dry to report without writing

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const { presentPlay, learnSpotAbbrs } = require("../server/live/playParser");
const { rostersForGame } = require("../server/live/rosters");
const { slateBigPlay, feedWorthy, dedupeFeed, MAX_SLATE_BIG_PLAYS: MAX_SLATE_FEED } = require("../server/live/store");
const { comparePlays } = require("../server/live/provider");
const { CONFIG } = require("../server/live/ingest");

const MAX_GAME_FEED = CONFIG.MAX_GAME_FEED;
const { getCallCount } = require("../server/live/cfbdClient");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const gameIds = args.flatMap((a, i) => (a === "--game" ? [args[i + 1]] : []));

async function main() {
  const db = getFirestore();
  const slateRef = db.collection("liveSlate").doc("current");
  const slate = (await slateRef.get()).data() || {};
  const ids = args.includes("--slate") ? (slate.games || []).map((g) => g.id) : gameIds;
  if (!ids.length) throw new Error("Pass --game <id> or --slate.");

  const budget = { left: 200 };
  const byKey = new Map();
  const allFeed = [];
  const totals = { games: 0, plays: 0, changed: 0, fallback: 0, linked: 0, wedraft: 0 };
  for (const id of ids) {
    const gameRef = db.collection("liveGames").doc(String(id));
    const game = (await gameRef.get()).data();
    if (!game) continue;
    const snap = await gameRef.collection("plays").get();
    if (snap.empty) continue;
    totals.games++;
    const rosters = await rostersForGame(db, game, budget);
    const ops = [];
    const abbrs = learnSpotAbbrs(snap.docs.map((d) => d.data()));
    for (const d of snap.docs) {
      const p = d.data();
      const pres = presentPlay(p, { athletes: p.athletes, rosters, abbrs });
      totals.plays++;
      if (pres.confidence === "fallback") totals.fallback++;
      const people = Object.values(pres.players).flat();
      totals.linked += people.filter((x) => x?.cfbdId).length;
      totals.wedraft += people.filter((x) => x?.wedraftSlug).length;
      byKey.set(`${id}:${d.id}`, { pres, p, game });
      if (JSON.stringify(p.presentation) === JSON.stringify(pres)) continue;
      totals.changed++;
      ops.push((b) => b.update(d.ref, { presentation: pres, updatedAt: FieldValue.serverTimestamp() }));
    }
    // This game's Feed list (liveGames/{id}.feedPlays), rebuilt from the
    // re-parsed plays — same rule and builder as the ingester.
    const gid = String(game.providerGameId);
    const reparsed = snap.docs.map((d) => ({ ...d.data(), presentation: byKey.get(`${id}:${d.id}`).pres })).sort(comparePlays);
    const feed = dedupeFeed(reparsed.filter(feedWorthy).map((p) => slateBigPlay(gid, game, p)));
    allFeed.push(...feed, ...(game.finalFeed ? [game.finalFeed] : []));
    ops.push((b) => b.update(gameRef, { feedPlays: [...feed].reverse().slice(0, MAX_GAME_FEED) }));
    if (!DRY) {
      for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch();
        ops.slice(i, i + 400).forEach((op) => op(batch));
        await batch.commit();
      }
    }
  }

  // The slate's cross-game Feed (liveSlate/current.bigPlays): the newest
  // entries across every re-parsed game.
  if (!DRY && args.includes("--slate")) {
    const bigPlays = dedupeFeed(allFeed.sort((a, b) => b.at - a.at)).slice(0, MAX_SLATE_FEED);
    await slateRef.update({ bigPlays });
    console.log(`Slate feed rebuilt: ${bigPlays.length} entries`);
  }
  console.log(`${DRY ? "[dry] " : ""}${totals.games} games, ${totals.plays} plays, ${totals.changed} presentations ${DRY ? "would change" : "written"}, ${totals.fallback} fallback, ${totals.linked} player links (${totals.wedraft} with We-Draft profiles). CFBD calls: ${getCallCount()}.`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
