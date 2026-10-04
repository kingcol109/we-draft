// scripts/syncCfbdRosters.js
//
// Full college rosters for the CFB team page's Roster tab (TeamPage.js):
// one public doc per team at cfbRosters/{CFBDTeamId}, players stored
// compactly in a single array so the tab is one read.
//
// CFBD's /roster with only a year returns every team's roster in one call
// (~31k players, ~310 teams); only teams mapped to a We-Draft school
// (schools.CFBDName + CFBDTeamId, see mapCfbdTeams.js) are written. Players
// already linked to a We-Draft profile (cfbdPlayers mappingStatus
// suggested/verified) carry that profile's slug so the row links to it.
//
// Each player also carries his recruiting stars/rating/national rank
// (CFBD's recruiting classes RECRUIT_CLASSES, matched through the roster's
// recruitIds — one call per class) and his season stat totals (one call for
// every player in college football), for the team page's Stats tab.
// About 9 CFBD calls a run.
//
// Run with:
//   node --env-file=.env scripts/syncCfbdRosters.js
//   add --dry to report without writing

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("../server/live/cfbdClient");

const SEASON = 2026;
const DRY = process.argv.includes("--dry");
// Recruiting classes that can still be on a roster (a 6th-year senior's
// class through this season's freshmen).
const RECRUIT_CLASSES = Array.from({ length: 7 }, (_, i) => SEASON - 6 + i);
// Season stat categories kept for the Stats tab (returns/fumbles dropped).
const STAT_CATS = new Set(["passing", "rushing", "receiving", "defensive", "interceptions", "kicking", "punting"]);
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : v; };

async function run() {
  const db = getFirestore();

  const schools = await db.collection("schools").select("School", "CFBDName", "CFBDTeamId").get();
  const schoolByCfbdName = new Map();
  schools.docs.forEach((d) => { const s = d.data(); if (s.CFBDName && s.CFBDTeamId != null) schoolByCfbdName.set(s.CFBDName, s); });

  const linked = await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftSlug").get();
  const slugOf = new Map(linked.docs.map((d) => [d.id, d.data().wedraftSlug || null]));

  const rows = await cfbd.roster({ year: SEASON });

  // Recruit id → { stars, rating, ranking }. A player with more than one
  // recruit record (high school + JUCO) keeps his best one.
  const recruitById = new Map();
  for (const year of RECRUIT_CLASSES) {
    for (const r of await cfbd.recruits({ year })) recruitById.set(String(r.id), r);
  }
  const recruitOf = (r) => (r.recruitIds || []).map((id) => recruitById.get(String(id))).filter(Boolean)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0) || (b.rating || 0) - (a.rating || 0))[0] || null;

  // CFBD player id → { category: { statType: value } }.
  const statsOf = new Map();
  for (const r of await cfbd.seasonPlayerStats({ year: SEASON, seasonType: "regular" })) {
    if (!r.playerId || !STAT_CATS.has(r.category)) continue;
    const id = String(r.playerId);
    if (!statsOf.has(id)) statsOf.set(id, {});
    (statsOf.get(id)[r.category] ||= {})[r.statType] = num(r.stat);
  }
  const byTeam = new Map();
  for (const r of rows) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team).push(r);
  }

  const ops = [];
  let players = 0;
  const unmapped = [];
  for (const [team, list] of byTeam) {
    const school = schoolByCfbdName.get(team);
    if (!school) { unmapped.push(team); continue; }
    players += list.length;
    ops.push((b) => b.set(db.collection("cfbRosters").doc(String(school.CFBDTeamId)), {
      teamId: school.CFBDTeamId,
      team,
      school: school.School || null,
      season: SEASON,
      // Compact keys — a roster is ~100-130 of these in one doc.
      // yr: CFBD's class year (1-4; a recruiting-class year like 2026 for
      // newly added freshmen). ht in inches, wt in lbs. stars / rating /
      // rank: recruiting profile. s: season stats by category.
      players: list.map((r) => {
        const rec = recruitOf(r);
        const home = [r.homeCity, r.homeState || (r.homeCountry && r.homeCountry !== "USA" ? r.homeCountry : "")].filter(Boolean).join(", ");
        return JSON.parse(JSON.stringify({
          id: String(r.id),
          no: r.jersey ?? undefined,
          first: r.firstName || "",
          last: r.lastName || "",
          pos: r.position || undefined,
          yr: r.year ?? undefined,
          ht: r.height ?? undefined,
          wt: r.weight ?? undefined,
          home: home || undefined,
          slug: slugOf.get(String(r.id)) || undefined,
          stars: rec?.stars || undefined,
          rating: rec?.rating ?? undefined,
          rank: rec?.ranking ?? undefined,
          s: statsOf.get(String(r.id)) || undefined,
        }));
      }),
      updatedAt: FieldValue.serverTimestamp(),
    }));
  }

  if (!DRY) {
    for (let i = 0; i < ops.length; i += 50) {
      const batch = db.batch();
      ops.slice(i, i + 50).forEach((op) => op(batch));
      await batch.commit();
    }
  }
  console.log(`${DRY ? "[dry] " : ""}${ops.length} team rosters (${players} players) written; ${unmapped.length} CFBD teams have no We-Draft school.`);
  console.log(`CFBD calls: ${getCallCount()}`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
