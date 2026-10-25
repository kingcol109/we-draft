// scripts/syncPffGrades.js
//
// PFF college grades for back-office tools (the Admin Panel's Suggest Video,
// components/VideoSuggester.js). PFF data is licensed for internal use only:
// it must NEVER be displayed on the public site, so it lives in its own
// collection, pffGrades/{CFBDTeamId}, which only admin code reads — never
// mix it into public docs like cfbRosters or players.
//
// PFF's Developer API (https://api.pff.com, OpenAPI spec at /openapi.json)
// takes the account's API key (ak_…) as a bearer token. The /v1/facet/*
// leaderboards return every college player in one category per call, so a
// run is (1 + 3 weeks) × 6 categories + 2 = ~26 calls:
//   season totals   each player's season grade + snaps
//   last 3 weeks    his recent games' grades — the suggesters' latest game
//                   and trend direction (a team on a bye still has
//                   last week's)
// Each player is graded in the category that matches his PFF position (QB →
// passing, HB → rushing, WR/TE → receiving, OL → blocking, defense →
// defense, K → field goals, P → punting), ranked among FBS players at that position with
// enough snaps (MIN_SNAPS). He also carries his specific grades (SUBS —
// pass rush, coverage, pass block…), each ranked among every FBS player with
// enough snaps in that phase, for the suggester's PFF focus.
//
// PFF teams are matched to We-Draft schools by name (+ ALIAS); PFF players
// to cfbRosters/{teamId} rows by name, then last name + jersey. Players who
// don't match are counted, not written.
//
// Run with:
//   node --env-file=.env scripts/syncPffGrades.js
//   add --dry to report without writing

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const API = "https://api.pff.com";
const DRY = process.argv.includes("--dry");
let calls = 0;

// PFF team name → We-Draft school name, where they differ.
const ALIAS = { connecticut: "UConn", miamifl: "Miami", mississippi: "Ole Miss", northcarolinastate: "NC State", usf: "South Florida" };

// cat: facet path, the grade that sums him up, and the snap count that says
// how much he's played.
const CATS = {
  passing: { path: "passing/summary", grade: "grades_offense", snaps: (r) => r.passing_snaps },
  rushing: { path: "rushing/summary", grade: "grades_offense", snaps: (r) => (r.attempts || 0) + (r.routes || 0) },
  receiving: { path: "receiving/summary", grade: "grades_offense", snaps: (r) => r.routes },
  blocking: { path: "offense/blocking", grade: "grades_offense", snaps: (r) => r.snap_counts_offense },
  defense: { path: "defense/summary", grade: "grades_defense", snaps: (r) => r.snap_counts_defense },
  kicking: { path: "field_goal/summary", grade: "grades_fgep_kicker", snaps: (r) => r.total_attempts },
  punting: { path: "punting/summary", grade: "grades_punter", snaps: (r) => r.attempts },
};
const CAT_OF_POS = {
  QB: "passing", HB: "rushing", FB: "rushing", WR: "receiving", TE: "receiving",
  T: "blocking", G: "blocking", C: "blocking", DI: "defense", ED: "defense", LB: "defense", CB: "defense", S: "defense", K: "kicking", P: "punting",
};
// Season snaps before a grade is ranked — an early-season grade on 30 snaps
// isn't a signal. VideoSuggester.js only scores grades with a rank (rk).
const MIN_SNAPS = { passing: 50, rushing: 30, receiving: 60, blocking: 100, defense: 100, kicking: 3, punting: 10 };
// Specific grades — key (VideoSuggester.js PFF_FOCUS uses the same keys),
// the category row it comes from, its grade, the snaps in that phase, and
// how many before it's ranked.
const SUBS = {
  pass: { cat: "passing", grade: "grades_pass", snaps: (r) => r.passing_snaps, min: 50 },
  run: { cat: "rushing", grade: "grades_run", snaps: (r) => r.attempts, min: 20 },
  route: { cat: "receiving", grade: "grades_pass_route", snaps: (r) => r.routes, min: 60 },
  hands: { cat: "receiving", grade: "grades_hands_drop", snaps: (r) => r.routes, min: 60 },
  pblk: { cat: "blocking", grade: "grades_pass_block", snaps: (r) => r.snap_counts_pass_block, min: 60 },
  rblk: { cat: "blocking", grade: "grades_run_block", snaps: (r) => r.snap_counts_run_block, min: 60 },
  prush: { cat: "defense", grade: "grades_pass_rush_defense", snaps: (r) => r.snap_counts_pass_rush, min: 50 },
  rdef: { cat: "defense", grade: "grades_run_defense", snaps: (r) => r.snap_counts_run_defense, min: 50 },
  cov: { cat: "defense", grade: "grades_coverage_defense", snaps: (r) => r.snap_counts_coverage, min: 60 },
  tkl: { cat: "defense", grade: "grades_tackle", snaps: (r) => r.snap_counts_defense, min: 100 },
};
const subsOf = (cat) => Object.entries(SUBS).filter(([, d]) => d.cat === cat);
// Advanced stats kept per category (st: { key: value }) for the Video
// Workshop's talking points (src/components/videoFacts.js ranks them —
// same keys). Everything else PFF sends is dropped.
const STATS = {
  passing: ["big_time_throws", "btt_rate", "turnover_worthy_plays", "twp_rate", "accuracy_percent", "avg_depth_of_target", "avg_time_to_throw", "pressure_to_sack_rate", "epa", "scrambles"],
  rushing: ["yards_after_contact", "yco_attempt", "elu_rush_mtf", "elusive_rating", "breakaway_percent", "explosive", "breakaway_yards"],
  receiving: ["yprr", "contested_receptions", "contested_catch_rate", "drop_rate", "yards_after_catch", "avoided_tackles", "avg_depth_of_target", "targeted_qb_rating"],
  blocking: ["pressures_allowed", "sacks_allowed", "pbe"],
  defense: ["total_pressures", "sacks", "hits", "hurries", "stops", "tackles_for_loss", "missed_tackle_rate", "pass_break_ups", "interceptions", "forced_fumbles", "qb_rating_against", "batted_passes"],
  kicking: ["total_percent", "fifty_made", "forty_made"],
  punting: ["average_net_yards", "average_hangtime", "inside_twenties", "touchbacks"],
};

// PFF's upstream sometimes 502s on the big leaderboards — retry 5xx a few
// times before giving up.
async function pff(path, params) {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    calls++;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.PFF_API_KEY}` } });
    if (res.ok) return res.json();
    const body = (await res.text()).slice(0, 300);
    if (res.status < 500 || attempt >= 4) throw new Error(`PFF ${res.status} ${path}: ${body}`);
    console.warn(`PFF ${res.status} ${path} — retrying (${attempt})`);
    await new Promise((r) => setTimeout(r, attempt * 10000));
  }
}
const rowsOf = (j) => j[Object.keys(j).find((k) => Array.isArray(j[k]))] || [];

const norm = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/\bst\.?$/, "state").replace(/[^a-z0-9]/g, "");
// "Kenneth Walker III" / "Kenneth Walker" → "kennethwalker".
const nameKey = (s) => String(s || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
const lastKey = (s) => nameKey(String(s || "").trim().split(/\s+/).slice(1).join(" "));
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

async function run() {
  if (!process.env.PFF_API_KEY) throw new Error("PFF_API_KEY is not set.");
  const db = getFirestore();

  const ncaa = (await pff("/v1/leagues", {})).leagues.find((l) => l.slug === "ncaa");
  const season = ncaa.default_season;
  const week = ncaa.default_week;
  const weeks = [week - 2, week - 1, week].filter((w) => w >= 1);
  const teams = (await pff("/v2/ncaa/teams", { season })).rows;
  const fbsTeams = new Set(teams.filter((t) => String(t.groupIds).split(";").includes("11")).map((t) => t.franchiseId));

  // PFF franchise → We-Draft school (by School and CFBDName).
  const schoolsSnap = await db.collection("schools").select("School", "CFBDName", "CFBDTeamId").get();
  const schoolByName = new Map();
  schoolsSnap.docs.forEach((d) => {
    const s = d.data();
    if (s.CFBDTeamId == null) return;
    [d.id, s.School, s.CFBDName].forEach((n) => { if (n) schoolByName.set(norm(n), { name: s.School || d.id, teamId: String(s.CFBDTeamId) }); });
  });
  const schoolOf = new Map();
  teams.forEach((t) => {
    const s = schoolByName.get(norm(ALIAS[norm(t.city)] || t.city));
    if (s) schoolOf.set(t.franchiseId, s);
  });

  // Season rows (each in his own position's category) + the last 3 weeks.
  const seasonRows = [];
  const weekRows = new Map(); // pff id → [{ wk, g, sn }] (weeks played)
  for (const [cat, def] of Object.entries(CATS)) {
    rowsOf(await pff(`/v1/facet/${def.path}`, { league: "ncaa", season })).forEach((r) => {
      if (CAT_OF_POS[r.position] === cat) seasonRows.push({ cat, r });
    });
    for (const wk of weeks) {
      rowsOf(await pff(`/v1/facet/${def.path}`, { league: "ncaa", season, week: wk })).forEach((r) => {
        const sn = def.snaps(r) || 0;
        if (CAT_OF_POS[r.position] !== cat || !sn || r[def.grade] == null) return;
        if (!weekRows.has(r.player_id)) weekRows.set(r.player_id, []);
        weekRows.get(r.player_id).push({ wk, g: round1(r[def.grade]), sn });
      });
    }
  }

  // National rank among FBS players at his position with enough snaps.
  const rankKey = (x) => `${x.cat}:${x.r.position}`;
  const ranked = new Map();
  seasonRows
    .filter((x) => fbsTeams.has(x.r.franchise_id) && (CATS[x.cat].snaps(x.r) || 0) >= MIN_SNAPS[x.cat] && x.r[CATS[x.cat].grade] != null)
    .forEach((x) => { if (!ranked.has(rankKey(x))) ranked.set(rankKey(x), []); ranked.get(rankKey(x)).push(x.r[CATS[x.cat].grade]); });
  ranked.forEach((list) => list.sort((a, b) => b - a));
  // Each specific grade, ranked across every FBS position.
  const subQualifies = (d, r) => fbsTeams.has(r.franchise_id) && r[d.grade] != null && (d.snaps(r) || 0) >= d.min;
  const subRanked = new Map(Object.keys(SUBS).map((k) => [k, []]));
  seasonRows.forEach(({ cat, r }) => subsOf(cat).forEach(([k, d]) => { if (subQualifies(d, r)) subRanked.get(k).push(r[d.grade]); }));
  subRanked.forEach((list) => list.sort((a, b) => b - a));

  // Group by team, then match each PFF player to a roster row.
  const byTeam = new Map();
  seasonRows.forEach((x) => {
    const s = schoolOf.get(x.r.franchise_id);
    if (!s) return;
    if (!byTeam.has(s.teamId)) byTeam.set(s.teamId, { school: s.name, pffTeamId: x.r.franchise_id, rows: [] });
    byTeam.get(s.teamId).rows.push(x);
  });

  const ops = [];
  let matched = 0, unmatched = 0, noRoster = 0;
  // Ranked (matched) players per category, for the summary.
  const rankedByCat = {};
  const unmatchedSample = [];
  for (const [teamId, team] of byTeam) {
    const roster = (await db.collection("cfbRosters").doc(teamId).get()).data();
    if (!roster) { noRoster++; continue; }
    const byName = new Map(), byLast = new Map();
    (roster.players || []).forEach((p) => {
      byName.set(nameKey(`${p.first} ${p.last}`), p);
      const lk = nameKey(p.last);
      if (!byLast.has(lk)) byLast.set(lk, []);
      byLast.get(lk).push(p);
    });
    const players = {};
    team.rows.forEach(({ cat, r }) => {
      let p = byName.get(nameKey(r.player));
      if (!p) {
        // Nickname / spelling differences: same last name and jersey, or
        // the only player on the roster with that last name.
        const same = byLast.get(lastKey(r.player)) || [];
        const jersey = Number(String(r.jersey_number || "").replace(/\D/g, ""));
        p = same.find((x) => Number(x.no) === jersey) || (same.length === 1 ? same[0] : null);
      }
      if (!p) {
        unmatched++;
        if (unmatchedSample.length < 15) unmatchedSample.push(`${r.player} (${r.position}, ${team.school})`);
        return;
      }
      const def = CATS[cat];
      const g = round1(r[def.grade]);
      const sn = def.snaps(r) || 0;
      if (g == null || !sn) return;
      const list = ranked.get(rankKey({ cat, r }));
      const qualifies = sn >= MIN_SNAPS[cat] && fbsTeams.has(r.franchise_id);
      // Compact keys, like cfbRosters: pid PFF id, pos PFF position, cat,
      // g grade, sn snaps, gp games, rk/of national rank among qualified
      // players at his position, w his latest game, x his specific grades
      // ({ key: [grade, snaps, rank, of] }, ranked ones only), st his STATS.
      const recent = [...(weekRows.get(r.player_id) || [])].sort((a, b) => b.wk - a.wk);
      const x = {};
      // st: STATS for his category, numbers only.
      const st = {};
      (STATS[cat] || []).forEach((k) => { if (typeof r[k] === "number") st[k] = round1(r[k]); });
      subsOf(cat).forEach(([k, d]) => {
        if (!subQualifies(d, r)) return;
        const sg = round1(r[d.grade]), list = subRanked.get(k);
        x[k] = [sg, d.snaps(r), 1 + list.filter((v) => v > sg).length, list.length];
      });
      players[p.id] = JSON.parse(JSON.stringify({
        pid: r.player_id, pos: r.position, cat, g, sn, gp: r.player_game_count || undefined,
        rk: qualifies && list ? 1 + list.filter((v) => v > g).length : undefined,
        of: qualifies && list ? list.length : undefined,
        // w his latest game; rg his recent games [{ wk, g, sn }], newest
        // first (Firestore can't nest arrays, hence objects).
        w: recent[0] || undefined,
        rg: recent.length ? recent : undefined,
        x: Object.keys(x).length ? x : undefined,
        st: Object.keys(st).length ? st : undefined,
      }));
      matched++;
      if (qualifies && list) rankedByCat[cat] = (rankedByCat[cat] || 0) + 1;
    });
    ops.push((b) => b.set(db.collection("pffGrades").doc(teamId), {
      teamId, school: team.school, pffTeamId: team.pffTeamId, season, weeks, players, updatedAt: FieldValue.serverTimestamp(),
    }));
  }

  if (!DRY) {
    for (let i = 0; i < ops.length; i += 50) {
      const batch = db.batch();
      ops.slice(i, i + 50).forEach((op) => op(batch));
      await batch.commit();
    }
  }
  console.log(`${DRY ? "[dry] " : ""}PFF ${season} through week ${week}: ${ops.length} teams written, ${matched} players matched, ${unmatched} unmatched${noRoster ? `, ${noRoster} teams with no roster doc` : ""}.`);
  console.log(`  ranked: ${Object.keys(CATS).map((c) => `${c} ${rankedByCat[c] || 0}`).join(", ")}`);
  if (unmatchedSample.length) console.log(`  unmatched e.g.: ${unmatchedSample.join("; ")}`);
  console.log(`PFF calls: ${calls}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
