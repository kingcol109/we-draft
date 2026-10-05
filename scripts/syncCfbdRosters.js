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
// The same season totals also build the CFB page's Stats tab (CFBPage.js):
// one doc, cfbLeaders/current, with the top LEADER_ROWS FBS players in each
// LEADER_CATS stat — and cfbLeaders/tables, each group's sortable table
// (full stat lines for the TABLE_POOL leaders in each TABLE_DEFS stat,
// overall and within each draft class) — no extra CFBD calls.
//
// Draft class (dc, the tables' class filter): a We-Draft player's own
// Eligible; otherwise inferred from the recruiting class — 2026 signees are
// the 2029 class, 2025's are 2028, everyone else 2027 (also the floor: a
// stale pre-2027 Eligible counts as 2027).
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

// National leaders: FBS only — the same conferences as the CFB page's Teams
// tab (the season stats include FCS players).
const FBS_CONFS = new Set(["ACC", "Big 10", "Big 12", "SEC", "Pac 12", "Independent", "AAC", "CUSA", "MAC", "Mountain West", "Sun Belt"]);
const LEADER_ROWS = 50;
const z = (v) => Number(v) || 0;
// key, title, group, the stat ranked, and a short context line per row.
const LEADER_CATS = [
  { key: "passYds", title: "Passing Yards", group: "Passing", cat: "passing", stat: "YDS", x: (s) => `${z(s.COMPLETIONS)}/${z(s.ATT)} · ${z(s.TD)} TD · ${z(s.INT)} INT` },
  { key: "passTd", title: "Passing TDs", group: "Passing", cat: "passing", stat: "TD", x: (s) => `${z(s.YDS)} yds · ${z(s.INT)} INT` },
  { key: "rushYds", title: "Rushing Yards", group: "Rushing", cat: "rushing", stat: "YDS", x: (s) => `${z(s.CAR)} car · ${z(s.CAR) ? (z(s.YDS) / z(s.CAR)).toFixed(1) : "0.0"} avg · ${z(s.TD)} TD` },
  { key: "rushTd", title: "Rushing TDs", group: "Rushing", cat: "rushing", stat: "TD", x: (s) => `${z(s.YDS)} yds · ${z(s.CAR)} car` },
  { key: "recYds", title: "Receiving Yards", group: "Receiving", cat: "receiving", stat: "YDS", x: (s) => `${z(s.REC)} rec · ${z(s.TD)} TD` },
  { key: "rec", title: "Receptions", group: "Receiving", cat: "receiving", stat: "REC", x: (s) => `${z(s.YDS)} yds · ${z(s.TD)} TD` },
  { key: "recTd", title: "Receiving TDs", group: "Receiving", cat: "receiving", stat: "TD", x: (s) => `${z(s.REC)} rec · ${z(s.YDS)} yds` },
  { key: "tackles", title: "Tackles", group: "Defense", cat: "defensive", stat: "TOT", x: (s) => `${z(s.SOLO)} solo · ${z(s.TFL)} TFL` },
  { key: "sacks", title: "Sacks", group: "Defense", cat: "defensive", stat: "SACKS", x: (s) => `${z(s.TFL)} TFL · ${z(s.TOT)} tkl` },
  { key: "tfl", title: "Tackles for Loss", group: "Defense", cat: "defensive", stat: "TFL", x: (s) => `${z(s.SACKS)} sacks · ${z(s.TOT)} tkl` },
  { key: "ints", title: "Interceptions", group: "Defense", cat: "interceptions", stat: "INT", x: (s) => `${z(s.YDS)} yds · ${z(s.TD)} TD` },
  { key: "pbu", title: "Passes Defended", group: "Defense", cat: "defensive", stat: "PD", x: (s) => `${z(s.TOT)} tkl` },
  { key: "fgm", title: "Field Goals", group: "Specials", cat: "kicking", stat: "FGM", x: (s) => `${z(s.FGM)}/${z(s.FGA)} · long ${z(s.LONG)}` },
  { key: "kPts", title: "Kicking Points", group: "Specials", cat: "kicking", stat: "PTS", x: (s) => `${z(s.FGM)}/${z(s.FGA)} FG · ${z(s.XPM)}/${z(s.XPA)} XP` },
];
// Sortable national tables (the CFB page's Stats tab group headers) — key
// matches components/TeamStats.js's section keys; cats: the stat
// categories a row carries; by: [category, statType] pairs whose top
// TABLE_POOL players make the table.
const TABLE_POOL = 50;
const TABLE_DEFS = {
  passing: { cats: ["passing"], by: [["passing", "YDS"], ["passing", "TD"], ["passing", "ATT"], ["passing", "COMPLETIONS"]] },
  // qbPool: also each stat's top TABLE_POOL QBs, for the QB filter.
  rushing: { cats: ["rushing"], by: [["rushing", "YDS"], ["rushing", "TD"], ["rushing", "CAR"]], qbPool: true },
  receiving: { cats: ["receiving"], by: [["receiving", "YDS"], ["receiving", "REC"], ["receiving", "TD"]] },
  defense: { cats: ["defensive", "interceptions"], by: [["defensive", "TOT"], ["defensive", "SOLO"], ["defensive", "SACKS"], ["defensive", "TFL"], ["defensive", "PD"], ["interceptions", "INT"]] },
  kicking: { cats: ["kicking"], by: [["kicking", "FGM"], ["kicking", "PTS"], ["kicking", "FGA"], ["kicking", "XPM"], ["kicking", "LONG"]] },
  punting: { cats: ["punting"], by: [["punting", "NO"], ["punting", "In 20"], ["punting", "LONG"]] },
};

async function run() {
  const db = getFirestore();

  const schools = await db.collection("schools").select("School", "CFBDName", "CFBDTeamId", "Conference").get();
  const schoolByCfbdName = new Map();
  schools.docs.forEach((d) => { const s = d.data(); if (s.CFBDName && s.CFBDTeamId != null) schoolByCfbdName.set(s.CFBDName, s); });

  const linked = await db.collection("cfbdPlayers").where("mappingStatus", "in", ["suggested", "verified"]).select("wedraftSlug", "wedraftPlayerId").get();
  const slugOf = new Map(linked.docs.map((d) => [d.id, d.data().wedraftSlug || null]));
  const wdPlayers = await db.collection("players").select("Eligible").get();
  const eligibleOf = new Map(wdPlayers.docs.map((d) => [d.id, Number(d.data().Eligible) || null]));
  const wdEligible = new Map(linked.docs.map((d) => [d.id, eligibleOf.get(d.data().wedraftPlayerId) || null]));

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
  const playerOf = new Map(); // id → { name, pos, team } for the leaders doc
  for (const r of await cfbd.seasonPlayerStats({ year: SEASON, seasonType: "regular" })) {
    if (!r.playerId || !STAT_CATS.has(r.category)) continue;
    const id = String(r.playerId);
    if (!statsOf.has(id)) statsOf.set(id, {});
    if (!playerOf.has(id)) playerOf.set(id, { name: r.player, pos: r.position, team: r.team });
    (statsOf.get(id)[r.category] ||= {})[r.statType] = num(r.stat);
  }

  // National leaders (FBS) for the CFB page's Stats tab.
  const rosterName = new Map(rows.map((r) => [String(r.id), r]));
  const leaders = LEADER_CATS.map((c) => {
    const list = [];
    for (const [id, stats] of statsOf) {
      const s = stats[c.cat];
      const v = z(s?.[c.stat]);
      const p = playerOf.get(id);
      const school = schoolByCfbdName.get(p.team);
      if (!v || !school || !FBS_CONFS.has(school.Conference)) continue;
      const ro = rosterName.get(id);
      list.push({
        id, v, x: c.x(s),
        first: ro?.firstName || p.name.split(" ")[0] || "",
        last: ro?.lastName || p.name.split(" ").slice(1).join(" ") || "",
        pos: ro?.position || p.pos || null,
        school: school.School || null,
        slug: slugOf.get(id) || null,
      });
    }
    list.sort((a, b) => b.v - a.v || a.last.localeCompare(b.last));
    return { key: c.key, title: c.title, group: c.group, rows: list.slice(0, LEADER_ROWS) };
  });

  // Draft class: We-Draft's, else from the recruiting class (see top).
  const BY_SIGNING = { [SEASON]: SEASON + 3, [SEASON - 1]: SEASON + 2 };
  const draftClassOf = (id) => {
    const wd = wdEligible.get(id);
    if (wd) return Math.max(wd, SEASON + 1);
    const ro = rosterName.get(id);
    const rec = ro && recruitOf(ro);
    return BY_SIGNING[rec?.year] || BY_SIGNING[ro?.year] || SEASON + 1;
  };

  // FBS player rows (name, team, link) shared by the leaders and tables.
  const fbsRow = (id) => {
    const p = playerOf.get(id);
    const school = p && schoolByCfbdName.get(p.team);
    if (!school || !FBS_CONFS.has(school.Conference)) return null;
    const ro = rosterName.get(id);
    return {
      id,
      first: ro?.firstName || p.name.split(" ")[0] || "",
      last: ro?.lastName || p.name.split(" ").slice(1).join(" ") || "",
      pos: ro?.position || p.pos || null,
      school: school.School || null,
      slug: slugOf.get(id) || null,
      dc: draftClassOf(id),
    };
  };
  const tables = {};
  for (const [key, def] of Object.entries(TABLE_DEFS)) {
    const pool = new Set();
    for (const [cat, stat] of def.by) {
      const ranked = [...statsOf].filter(([id, st]) => z(st[cat]?.[stat]) > 0 && fbsRow(id))
        .sort((a, b) => z(b[1][cat][stat]) - z(a[1][cat][stat]));
      // Top TABLE_POOL overall, and within each draft class, so a class
      // filter still shows a full list.
      ranked.slice(0, TABLE_POOL).forEach(([id]) => pool.add(id));
      const perClass = new Map();
      for (const [id] of ranked) {
        const dc = draftClassOf(id);
        const n = perClass.get(dc) || 0;
        if (n < TABLE_POOL) { pool.add(id); perClass.set(dc, n + 1); }
      }
      if (def.qbPool) ranked.filter(([id]) => fbsRow(id).pos === "QB").slice(0, TABLE_POOL).forEach(([id]) => pool.add(id));
    }
    tables[key] = [...pool].map((id) => {
      const st = statsOf.get(id);
      const s = {};
      def.cats.forEach((c) => { if (st[c]) s[c] = st[c]; });
      return { ...fbsRow(id), s };
    });
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
      // rank / rc (class year): recruiting profile. s: season stats by category.
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
          rc: rec?.year ?? undefined, // recruiting class — the CFB Universe draft-class rule
          s: statsOf.get(String(r.id)) || undefined,
        }));
      }),
      updatedAt: FieldValue.serverTimestamp(),
    }));
  }

  ops.push((b) => b.set(db.collection("cfbLeaders").doc("current"), {
    season: SEASON, categories: leaders, updatedAt: FieldValue.serverTimestamp(),
  }));
  // Tables in their own doc — read only when a group header is opened.
  ops.push((b) => b.set(db.collection("cfbLeaders").doc("tables"), {
    season: SEASON, tables, updatedAt: FieldValue.serverTimestamp(),
  }));

  if (!DRY) {
    for (let i = 0; i < ops.length; i += 50) {
      const batch = db.batch();
      ops.slice(i, i + 50).forEach((op) => op(batch));
      await batch.commit();
    }
  }
  console.log(`${DRY ? "[dry] " : ""}${ops.length} team rosters (${players} players) written; ${unmapped.length} CFBD teams have no We-Draft school.`);
  console.log(`  tables: ${Object.entries(tables).map(([k, v]) => `${k} ${v.length}`).join(", ")} (~${Math.round(JSON.stringify(tables).length / 1024)} KB)`);
  const dcCount = {};
  Object.values(tables).flat().forEach((r) => { dcCount[r.dc] = (dcCount[r.dc] || 0) + 1; });
  console.log(`  table rows by draft class: ${JSON.stringify(dcCount)}`);
  leaders.forEach((c) => console.log(`  ${c.title}: ${c.rows[0] ? `${c.rows[0].first} ${c.rows[0].last} (${c.rows[0].school}) ${c.rows[0].v}` : "—"}`));
  console.log(`CFBD calls: ${getCallCount()}`);
}

run().catch((e) => { console.error(e.message || e); process.exit(1); });
