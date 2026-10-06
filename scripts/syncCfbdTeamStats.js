// scripts/syncCfbdTeamStats.js
//
// FBS team stats with national ranks — one public doc, cfbLeaders/teams,
// read by the CFB page's Stats tab (CfbLeaders.js, /cfb/stats/teams) and by
// We-Draft Live's game previews (LivePage.js, Tale of the tape).
//
// Per game, gained and allowed: total / passing / rushing yards (CFBD's
// team season stats — they carry the opponents' numbers too) and points
// (the season's completed games); turnover margin per game (takeaways −
// giveaways) and 3rd down conversion %, the offense's and what its defense
// allows. Every FBS team is ranked against the
// rest of FBS in each, "12" or "T-12" on a tie (the same format as
// cfbdPlayers seasonRanks). Fewer is better for the allowed stats.
//
// 3 CFBD calls a run (FBS teams, team season stats, the season's games).
//
// Run with:
//   node --env-file=.env scripts/syncCfbdTeamStats.js
//   add --dry to report without writing

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");

const SEASON = 2026;
const DRY = process.argv.includes("--dry");

// key, title, CFBD stat (or "points" / "pointsAllowed"), low = fewer is better.
// calc: computed from the team's totals (s) and games (g) instead of stat / g.
const CATS = [
  { key: "ypg", title: "Total Yards / Game", stat: "totalYards" },
  { key: "yapg", title: "Total Yards Allowed / Game", stat: "totalYardsOpponent", low: true },
  { key: "passYpg", title: "Passing Yards / Game", stat: "netPassingYards" },
  { key: "passYapg", title: "Passing Yards Allowed / Game", stat: "netPassingYardsOpponent", low: true },
  { key: "rushYpg", title: "Rushing Yards / Game", stat: "rushingYards" },
  { key: "rushYapg", title: "Rushing Yards Allowed / Game", stat: "rushingYardsOpponent", low: true },
  { key: "ppg", title: "Points / Game", stat: "points" },
  { key: "papg", title: "Points Allowed / Game", stat: "pointsAllowed", low: true },
  { key: "toMargin", title: "Turnover Margin / Game", calc: (s, g) => ((s.turnoversOpponent || 0) - (s.turnovers || 0)) / g, dp: 2 },
  { key: "thirdPct", title: "3rd Down %", calc: (s) => (s.thirdDowns ? (100 * (s.thirdDownConversions || 0)) / s.thirdDowns : null) },
  { key: "thirdPctA", title: "3rd Down % Allowed", calc: (s) => (s.thirdDownsOpponent ? (100 * (s.thirdDownConversionsOpponent || 0)) / s.thirdDownsOpponent : null), low: true },
];

const round = (x, dp = 1) => Math.round(x * 10 ** dp) / 10 ** dp;

// Competition ranks over the teams that have the stat: "12", "T-12" on a tie.
function rankAll(teams, key, low) {
  const has = teams.filter((t) => t.v[key] != null).sort((a, b) => (low ? a.v[key] - b.v[key] : b.v[key] - a.v[key]));
  has.forEach((t, i) => {
    const first = has.findIndex((x) => x.v[key] === t.v[key]);
    const tied = (has[first + 1] && has[first + 1].v[key] === t.v[key]) || first !== i;
    t.r[key] = `${tied ? "T-" : ""}${first + 1}`;
  });
}

async function run() {
  const db = getFirestore();

  // We-Draft's own school names (what the CFB page's rows key logos on).
  const schools = await db.collection("schools").select("School", "CFBDTeamId").get();
  const schoolById = new Map();
  schools.docs.forEach((d) => { const s = d.data(); if (s.CFBDTeamId != null) schoolById.set(Number(s.CFBDTeamId), s.School); });

  const fbs = await cfbd.fbsTeams(SEASON);
  const byName = new Map(fbs.map((t) => [t.school, t]));

  // Team season stats: one row per team per stat.
  const totals = new Map();
  for (const row of await cfbd.seasonTeamStats({ year: SEASON, seasonType: "regular" })) {
    if (!byName.has(row.team)) continue;
    const m = totals.get(row.team) || {};
    m[row.statName] = Number(row.statValue) || 0;
    totals.set(row.team, m);
  }

  // Points for / against from the season's completed games.
  const pts = new Map();
  for (const g of await cfbd.games({ year: SEASON, seasonType: "regular" })) {
    if (!g.completed || g.homePoints == null || g.awayPoints == null) continue;
    for (const [id, us, them] of [[g.homeId, g.homePoints, g.awayPoints], [g.awayId, g.awayPoints, g.homePoints]]) {
      const p = pts.get(id) || { pf: 0, pa: 0, n: 0 };
      p.pf += us; p.pa += them; p.n += 1;
      pts.set(id, p);
    }
  }

  const teams = fbs.map((t) => {
    const s = totals.get(t.school) || {};
    const p = pts.get(t.id);
    const g = s.games || 0;
    const v = {};
    for (const c of CATS) {
      if (c.calc) { const x = g ? c.calc(s, g) : null; v[c.key] = x == null ? null : round(x, c.dp); }
      else if (c.stat === "points") v[c.key] = p?.n ? round(p.pf / p.n) : null;
      else if (c.stat === "pointsAllowed") v[c.key] = p?.n ? round(p.pa / p.n) : null;
      else v[c.key] = g && s[c.stat] != null ? round(s[c.stat] / g) : null;
    }
    return { id: t.id, school: schoolById.get(t.id) || t.school, conf: t.conference || null, g: g || p?.n || 0, v, r: {} };
  }).filter((t) => t.g > 0);

  for (const c of CATS) rankAll(teams, c.key, c.low);
  teams.sort((a, b) => (b.v.ypg ?? -1) - (a.v.ypg ?? -1));

  if (!DRY) {
    await db.collection("cfbLeaders").doc("teams").set({
      season: SEASON,
      cats: CATS.map(({ key, title, low }) => ({ key, title, low: !!low })),
      teams,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  console.log(`${DRY ? "[dry] " : ""}${teams.length} FBS teams written to cfbLeaders/teams (~${Math.round(JSON.stringify(teams).length / 1024)} KB).`);
  for (const c of CATS) {
    const top = teams.find((t) => t.r[c.key] === "1" || t.r[c.key] === "T-1");
    console.log(`  ${c.title}: ${top ? `${top.school} ${top.v[c.key]}` : "—"}`);
  }
  console.log(`CFBD calls: ${getCallCount()}`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
