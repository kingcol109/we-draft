// scripts/syncCfbdPlayerStats.js
//
// Season stats (and optionally past game logs) for CFBD players linked to
// a We-Draft profile — what the player page's "2026 Stats" card reads
// (cfbdPlayers/{id}.seasons.{year}, cfbdPlayers/{id}/games/{gameId}).
//
// CFBD's season endpoint returns every player in college football in one
// call (~15k players, ~20 MB); only players with a We-Draft link are
// written (~1,300), so a run costs 1 CFBD call and about that many writes.
// A player not yet linked gets a *suggested* link when their name + team
// match exactly one We-Draft player (same rule as the live ingester);
// a "rejected" link is never touched.
//
// Game logs for games ingested live are written by the ingester
// (store.js saveBox) as each game ends; --weeks backfills earlier weeks
// from CFBD's weekly box scores (1 call per week + 1 for the schedule).
//
// Run with:
//   node --env-file=.env scripts/syncCfbdPlayerStats.js              season totals
//   node --env-file=.env scripts/syncCfbdPlayerStats.js --weeks 1-4  + game logs for weeks 1-4
//   add --dry to report without writing

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");
const { wedraftPlayerIndex, normName } = require("../server/live/store");

const SEASON = 2026;
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const weeksArg = args[args.indexOf("--weeks") + 1];
const WEEKS = args.includes("--weeks") && weeksArg
  ? (() => { const [a, b] = weeksArg.split("-").map(Number); return Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i); })()
  : [];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : v; };

async function commit(db, ops) {
  if (DRY) return;
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((op) => op(batch));
    await batch.commit();
  }
}

async function run() {
  const db = getFirestore();

  // CFBD team name → CFBD team id, from the mapped schools.
  const schools = await db.collection("schools").select("CFBDName", "CFBDTeamId").get();
  const teamIdByName = new Map();
  schools.docs.forEach((d) => { const s = d.data(); if (s.CFBDName && s.CFBDTeamId != null) teamIdByName.set(s.CFBDName, s.CFBDTeamId); });

  // Already-linked CFBD players (and any explicitly rejected).
  const linkedSnap = await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified", "rejected"]).select("mappingStatus").get();
  const status = new Map(linkedSnap.docs.map((d) => [d.id, d.data().mappingStatus]));
  const index = await wedraftPlayerIndex(db);

  // ── Season totals ──
  const rows = await cfbd.seasonPlayerStats({ year: SEASON, seasonType: "regular" });
  const byPlayer = new Map();
  for (const r of rows) {
    if (!r.playerId) continue;
    if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, { name: r.player, team: r.team, position: r.position, stats: {} });
    (byPlayer.get(r.playerId).stats[r.category] ||= {})[r.statType] = num(r.stat);
  }

  const ops = [];
  const linkedIds = new Set();
  let suggested = 0;
  for (const [id, p] of byPlayer) {
    const st = status.get(id);
    if (st === "rejected") continue;
    const teamId = teamIdByName.get(p.team) ?? null;
    const doc = {
      name: p.name, team: p.team, teamId, position: p.position || null, provider: "cfbd",
      seasons: { [SEASON]: p.stats }, seasonStatsAt: FieldValue.serverTimestamp(),
    };
    if (!st) {
      const hits = teamId != null ? index.get(`${normName(p.name)}|${teamId}`) || [] : [];
      if (hits.length !== 1) continue; // no We-Draft profile → not written
      Object.assign(doc, { wedraftPlayerId: hits[0].id, wedraftSlug: hits[0].slug, mappingStatus: "suggested", mappingSource: "name+team" });
      suggested++;
    }
    linkedIds.add(id);
    ops.push((b) => b.set(db.collection("cfbdPlayers").doc(id), doc, { merge: true }));
  }
  await commit(db, ops);
  console.log(`${DRY ? "[dry] " : ""}season ${SEASON}: ${byPlayer.size} CFBD players, ${linkedIds.size} linked to We-Draft written (${suggested} newly suggested).`);

  // ── Game logs for earlier weeks ──
  if (WEEKS.length) {
    const sched = await db.collection("schedule26").where("CFBDGameId", "!=", null).select("CFBDGameId", "Slug").get();
    const slugByGame = new Map(sched.docs.map((d) => [d.data().CFBDGameId, d.data().Slug]));
    const games = await cfbd.games({ year: SEASON, seasonType: "regular" });
    const gameById = new Map(games.map((g) => [g.id, g]));
    let lines = 0;
    for (const week of WEEKS) {
      const boxes = await cfbd.gamePlayers({ year: SEASON, week, seasonType: "regular", classification: "fbs" });
      const wops = [];
      for (const box of boxes) {
        const meta = gameById.get(box.id) || {};
        for (const t of box.teams || []) {
          const home = t.homeAway === "home";
          const players = new Map();
          for (const cat of t.categories || []) {
            for (const type of cat.types || []) {
              for (const a of type.athletes || []) {
                if (!linkedIds.has(String(a.id))) continue;
                if (!players.has(a.id)) players.set(a.id, {});
                (players.get(a.id)[cat.name] ||= {})[type.name] = a.stat;
              }
            }
          }
          for (const [pid, stats] of players) {
            lines++;
            wops.push((b) => b.set(db.collection("cfbdPlayers").doc(String(pid)).collection("games").doc(String(box.id)), {
              providerGameId: box.id, season: SEASON, week, seasonType: "regular",
              startDate: meta.startDate || null, team: t.team,
              opponent: home ? meta.awayTeam || null : meta.homeTeam || null,
              opponentLogo: (home ? meta.awayId : meta.homeId) != null ? `https://cdn.collegefootballdata.com/logos/500/${home ? meta.awayId : meta.homeId}.png` : null,
              homeAway: home ? "home" : "away",
              teamPoints: t.points ?? null,
              opponentPoints: home ? meta.awayPoints ?? null : meta.homePoints ?? null,
              wedraftGameSlug: slugByGame.get(box.id) || null,
              stats, updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true }));
          }
        }
      }
      await commit(db, wops);
      console.log(`${DRY ? "[dry] " : ""}week ${week}: ${boxes.length} box scores, ${wops.length} game-log lines for linked players.`);
    }
    console.log(`game-log lines total: ${lines}`);
  }
  console.log(`CFBD calls: ${getCallCount()}`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
