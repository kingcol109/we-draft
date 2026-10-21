// scripts/syncPffNflRosters.js
//
// PFF NFL depth charts for the Admin Panel's Research section
// (src/components/AdminResearch.js) — every team's roster by position with
// its PFF grade, league rank at the position, snaps, age and experience.
// Same licensing rule as scripts/syncPffGrades.js: PFF data is back office
// only and must NEVER be displayed on the public site, so it lives in its
// own admin-only collection, pffNflRosters/{abbr}, which nothing public reads.
//
// One call for the team list, one /v2/nfl/teams/{slug}/roster call per team,
// one league-wide /v2/nfl/positions/reports/{report} call per REPORTS entry,
// /v1/teams/overview, and one /v2/nfl/teams/stats call per TEAM_STATS
// category (~49 total). Each roster row is a depth-chart slot: position,
// alignment (LT, SCB, …), unit, depth order, season-to-date grade and its
// rank among every NFL player at the position, snaps + snap share, birth
// date, entry year and injury status — plus his specific grades (SUBS: pass
// block, run block, pass rush, coverage…) and his standard stats (STATS)
// from the reports, joined on PFF's player id. Each team doc also carries
// the team's unit grades, record and points (overview) and its team stats,
// each with PFF's league rank (team stats).
//
// The depth chart only lists who's on the team now, so anyone who took
// snaps for it earlier (injured, released, traded) would vanish along with
// his snaps — the Falcons' QB shares added up to 73% because Cooper Rush
// had the rest. The league-wide /v1/facet/{offense,defense}/summary (two
// more calls) list every player's season snaps by team; those not on the
// depth chart are added as `off: true` rows.
//
// PFF's team codes don't all match ours (ARZ, BLT, CLV, HST, LA…), so teams
// are matched to We-Draft's abbreviations (the nfl collection's doc ids) by
// full name.
//
// Run with:
//   node --env-file=.env scripts/syncPffNflRosters.js
//   add --dry to report without writing, --season=2025 for a past season
//
// Then scripts/nflTeamNeeds.js derives the public depth order
// (nflDepthOrder/{abbr}, by snaps) and team needs (nflTeamNeeds/{abbr})
// from what was just written.

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");
const { writeNeeds } = require("./nflTeamNeeds");

const API = "https://api.pff.com";
const DRY = process.argv.includes("--dry");
const SEASON_ARG = (process.argv.find((a) => a.startsWith("--season=")) || "").split("=")[1];
let calls = 0;

// We-Draft abbreviation → full name (same list as components/MarginAds.js).
const TEAMS = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers",
  SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Specific grades — key (src/components/AdminResearch.js SUBS uses the same
// keys), the league-wide report it comes from, its grade column, the snaps
// in that phase, and how many before it's ranked. Ranks are among every
// NFL player at the same PFF position (T, G, C… separately, like the
// roster's own overall rank) with at least `min` of those snaps.
const SUBS = {
  pass: { report: "passing", grade: "gradesPass", snaps: "passingSnaps", min: 100 },
  run: { report: "rushing", grade: "gradesRun", snaps: "attempts", min: 20 },
  route: { report: "receiving", grade: "gradesPassRoute", snaps: "routes", min: 60 },
  hands: { report: "receiving", grade: "gradesHandsDrop", snaps: "routes", min: 60 },
  pblk: { report: "pass-blocking", grade: "gradesPassBlock", snaps: "snapCountsPassBlock", min: 60 },
  rblk: { report: "run-blocking", grade: "gradesRunBlock", snaps: "snapCountsRunBlock", min: 50 },
  prush: { report: "pass-rush", grade: "gradesPassRushDefense", snaps: "snapCountsPassRush", min: 50 },
  rdef: { report: "run-defense", grade: "gradesRunDefense", snaps: "snapCountsRun", min: 40 },
  cov: { report: "coverage", grade: "gradesCoverageDefense", snaps: "snapCountsCoverage", min: 60 },
  // Tackling has no snap count of its own — coverage + run-defense snaps.
  tkl: { report: "coverage", grade: "gradesTackle", snaps: null, min: 100 },
};
// Standard stats kept per player: key → [report, column]. Which ones show
// for which position group is src/components/AdminResearch.js GROUP_STATS
// (same keys); everything else PFF sends is dropped. Rates are as PFF sends
// them (0–100).
const STATS = {
  p_att: ["passing", "attempts"], p_cmp: ["passing", "completionPercent"], p_yds: ["passing", "yards"],
  p_ypa: ["passing", "ypa"], p_td: ["passing", "touchdowns"], p_int: ["passing", "interceptions"],
  p_btt: ["passing", "bttRate"], p_twp: ["passing", "twpRate"], p_acc: ["passing", "accuracyPercent"],
  p_adot: ["passing", "avgDepthOfTarget"], p_ttt: ["passing", "avgTimeToThrow"], p_p2s: ["passing", "pressureToSackRate"],
  p_rtg: ["passing", "qbRating"],
  r_att: ["rushing", "attempts"], r_yds: ["rushing", "yards"], r_ypa: ["rushing", "ypa"], r_td: ["rushing", "touchdowns"],
  r_yco: ["rushing", "ycoAttempt"], r_mtf: ["rushing", "avoidedTackles"], r_elu: ["rushing", "elusiveRating"],
  r_brk: ["rushing", "breakawayPercent"], r_fum: ["rushing", "fumbles"], r_rec: ["rushing", "receptions"],
  r_ryds: ["rushing", "recYards"], r_yprr: ["rushing", "yprr"],
  c_tgt: ["receiving", "targets"], c_rec: ["receiving", "receptions"], c_yds: ["receiving", "yards"],
  c_td: ["receiving", "touchdowns"], c_yprr: ["receiving", "yprr"], c_yac: ["receiving", "yardsAfterCatchPerReception"],
  c_adot: ["receiving", "avgDepthOfTarget"], c_drop: ["receiving", "dropRate"], c_cc: ["receiving", "contestedCatchRate"],
  c_slot: ["receiving", "slotRate"], c_inl: ["receiving", "inlineRate"], c_tshare: ["receiving", "teamTargetsPercent"],
  c_rtg: ["receiving", "targetedQbRating"],
  b_pr: ["pass-blocking", "pressuresAllowed"], b_sk: ["pass-blocking", "sacksAllowed"], b_prr: ["pass-blocking", "pressureRateAllowed"],
  b_pbwr: ["pass-blocking", "pbwr"], b_pbe: ["pass-blocking", "pbe"], b_pen: ["pass-blocking", "penalties"],
  rb_zone: ["run-blocking", "zoneGradesRunBlock"], rb_gap: ["run-blocking", "gapGradesRunBlock"],
  d_pr: ["pass-rush", "totalPressures"], d_sk: ["pass-rush", "sacks"], d_hit: ["pass-rush", "hits"], d_hur: ["pass-rush", "hurries"],
  d_prwr: ["pass-rush", "passRushWinRate"], d_prr: ["pass-rush", "pressureRate"], d_dbl: ["pass-rush", "doubleTeamRate"],
  d_tkl: ["run-defense", "tackles"], d_stop: ["run-defense", "stops"], d_stp: ["run-defense", "stopPercent"],
  d_mtr: ["run-defense", "missedTackleRate"],
  v_tgt: ["coverage", "targets"], v_rec: ["coverage", "receptions"], v_cr: ["coverage", "catchRate"], v_yds: ["coverage", "yards"],
  v_ycs: ["coverage", "yardsPerCoverageSnap"], v_td: ["coverage", "touchdowns"], v_int: ["coverage", "interceptions"],
  v_pbu: ["coverage", "passBreakUps"], v_fir: ["coverage", "forcedIncompletionRate"], v_rtg: ["coverage", "qbRatingAgainst"],
};
const REPORTS = [...new Set([...Object.values(SUBS).map((d) => d.report), ...Object.values(STATS).map(([r]) => r)])];
const round2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : undefined);

// Team stats categories (/v2/nfl/teams/stats) — every column kept, each as
// [value, PFF's league rank].
const TEAM_STATS = [
  "offense-overall-success", "offense-passing", "offense-rushing",
  "defense-overall-success", "defense-passing", "defense-rushing", "defense-opponent-tendencies",
];
// Unit grades from /v1/teams/overview: our key → PFF column.
const TEAM_GRADES = {
  overall: "grades_overall", off: "grades_offense", pass: "grades_pass", run: "grades_run",
  pblk: "grades_pass_block", rblk: "grades_run_block", route: "grades_pass_route",
  def: "grades_defense", prush: "grades_pass_rush_defense", cov: "grades_coverage_defense",
  rdef: "grades_run_defense", tkl: "grades_tackle", st: "grades_misc_st",
};
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const ABBR_BY_NAME = new Map(Object.entries(TEAMS).map(([abbr, name]) => [norm(name), abbr]));

// PFF's upstream sometimes 502s — retry 5xx a few times before giving up
// (same as syncPffGrades.js).
async function pff(path, params = {}) {
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

async function run() {
  if (!process.env.PFF_API_KEY) throw new Error("PFF_API_KEY is not set.");
  const db = getFirestore();

  const seasonParams = SEASON_ARG ? { season: SEASON_ARG } : {};
  const list = await pff("/v2/nfl/teams", seasonParams);
  const season = list.season;

  // League-wide reports → per player: { [sub]: { g, sn, pos } }.
  const reportRows = {};
  for (const report of REPORTS) reportRows[report] = (await pff(`/v2/nfl/positions/reports/${report}`, seasonParams)).rows || [];
  const runSnaps = new Map(reportRows["run-defense"].map((r) => [r.playerId, r.snapCountsRun || 0]));
  const subsByPlayer = new Map();
  Object.entries(SUBS).forEach(([key, d]) => {
    reportRows[d.report].forEach((r) => {
      if (r[d.grade] == null) return;
      const sn = d.snaps ? r[d.snaps] || 0 : (r.snapCountsCoverage || 0) + (runSnaps.get(r.playerId) || 0);
      if (!sn) return;
      if (!subsByPlayer.has(r.playerId)) subsByPlayer.set(r.playerId, {});
      subsByPlayer.get(r.playerId)[key] = { g: round1(r[d.grade]), sn, pos: r.position };
    });
  });
  // Qualified grades per (sub, position), best first, for ranks.
  const ranked = new Map();
  subsByPlayer.forEach((subs) => Object.entries(subs).forEach(([key, v]) => {
    if (v.sn < SUBS[key].min) return;
    const k = `${key}:${v.pos}`;
    if (!ranked.has(k)) ranked.set(k, []);
    ranked.get(k).push(v.g);
  }));
  ranked.forEach((l) => l.sort((a, b) => b - a));
  // st: { [stat]: value } — his STATS, from whichever reports he's in.
  const reportRowById = Object.fromEntries(REPORTS.map((rep) => [rep, new Map(reportRows[rep].map((r) => [r.playerId, r]))]));
  const statsOf = (id) => {
    const st = {};
    Object.entries(STATS).forEach(([key, [rep, col]]) => {
      const v = round2(reportRowById[rep].get(id)?.[col]);
      if (v !== undefined) st[key] = v;
    });
    return Object.keys(st).length ? st : undefined;
  };

  // Team level: unit grades + record (overview, PFF codes → matched by
  // name) and team stats (each value with its league rank).
  const overview = (await pff("/v1/teams/overview", { league: "nfl", season })).team_overview || [];
  const teamStats = {};
  for (const category of TEAM_STATS) {
    const j = await pff("/v2/nfl/teams/stats", { category, ...seasonParams });
    (j.rows || []).forEach((r) => {
      const abbr = ABBR_BY_NAME.get(norm(r.name));
      if (!abbr) return;
      const out = {};
      Object.entries(r).forEach(([k, v]) => {
        if (/Rank$/.test(k) || typeof v !== "number" || k === "teamId") return;
        out[k] = [Math.round(v * 10000) / 10000, r[`${k}Rank`] ?? null];
      });
      ((teamStats[abbr] ||= {})[category] = out);
    });
  }
  const unitOf = (abbr) => {
    const o = overview.find((r) => ABBR_BY_NAME.get(norm(r.name)) === abbr);
    if (!o) return undefined;
    return {
      grades: Object.fromEntries(Object.entries(TEAM_GRADES).map(([k, col]) => [k, o[col] ?? null])),
      w: o.wins, l: o.losses, t: o.ties, pf: o.points_scored, pa: o.points_allowed,
      stats: teamStats[abbr] || {},
    };
  };

  // Season snaps by team for everyone who's played (facet leaderboards are
  // snake_case and keyed by franchise_id): offense and defense. Regular
  // season weeks only — left alone they count the preseason too, which the
  // roster's own snaps don't.
  const rowsOf = (j) => j[Object.keys(j).find((k) => Array.isArray(j[k]))] || [];
  const regWeeks = { league: "nfl", season, week: Array.from({ length: 18 }, (_, i) => i + 1).join(",") };
  const unitSnaps = [
    { u: "o", rows: rowsOf(await pff("/v1/facet/offense/summary", regWeeks)), sn: (r) => r.snap_counts_total, g: (r) => r.grades_offense },
    { u: "d", rows: rowsOf(await pff("/v1/facet/defense/summary", regWeeks)), sn: (r) => r.snap_counts_defense, g: (r) => r.grades_defense },
  ];

  // x: { [sub]: [grade, snaps, rank, of] } — rank/of only once he qualifies.
  const subsOf = (id) => {
    const subs = subsByPlayer.get(id);
    if (!subs) return undefined;
    const x = {};
    Object.entries(subs).forEach(([key, v]) => {
      const l = v.sn >= SUBS[key].min ? ranked.get(`${key}:${v.pos}`) : null;
      x[key] = l ? [v.g, v.sn, 1 + l.filter((g) => g > v.g).length, l.length] : [v.g, v.sn];
    });
    return x;
  };

  const docs = [];
  const unmatched = [];
  let players = 0;
  for (const t of list.rows) {
    const abbr = ABBR_BY_NAME.get(norm(t.name));
    if (!abbr) { unmatched.push(t.name); continue; }
    const roster = await pff(`/v2/nfl/teams/${t.slug}/roster`, seasonParams);
    // Compact keys: id PFF player id, n name, no jersey, pos PFF position,
    // al alignment, u unit (o/d), d depth order, g grade, rk/of his rank
    // among all NFL players at the position, ht height (604 = 6'4"), wt,
    // dob birth date, ey entry year, s status, sn snaps, sp snap %, x his
    // specific grades (see subsOf), st his stats (statsOf); off: true for
    // an off-depth-chart contributor (see below — no rank, age or depth).
    const rows = (roster.rows || []).map((r) => JSON.parse(JSON.stringify({
      id: r.playerId, n: r.name, no: r.jersey || undefined, pos: r.position, al: r.alignment,
      u: r.unit === "defense" ? "d" : "o", d: r.depthOrder,
      g: r.grade ?? undefined, rk: r.gradeRank ?? undefined, of: r.gradeRankOf ?? undefined,
      ht: r.height ?? undefined, wt: r.weight ?? undefined, dob: r.birthDate || undefined,
      ey: r.eligibilityYear ?? undefined, s: r.status && r.status !== "active" ? r.status : undefined,
      sn: r.snapCounts ?? undefined, sp: r.snapPct ?? undefined,
      x: subsOf(r.playerId),
      st: statsOf(r.playerId),
    })));
    // Off-depth-chart contributors: played for this team, not on its depth
    // chart now. sp is against the unit's most-used player (always ~every
    // snap — an OL or a safety), the same base the roster's own sp uses.
    const onChart = new Set(rows.map((r) => r.id));
    unitSnaps.forEach(({ u, rows: facet, sn, g }) => {
      const mine = facet.filter((r) => r.franchise_id === t.franchiseId && (sn(r) || 0) > 0);
      const unitTotal = Math.max(0, ...mine.map(sn));
      mine.filter((r) => !onChart.has(r.player_id)).forEach((r) => {
        onChart.add(r.player_id);
        rows.push(JSON.parse(JSON.stringify({
          id: r.player_id, n: r.player, pos: r.position, u, off: true,
          g: g(r) ?? undefined, sn: sn(r), sp: unitTotal ? Math.round((sn(r) / unitTotal) * 1000) / 10 : undefined,
          x: subsOf(r.player_id), st: statsOf(r.player_id),
        })));
      });
    });
    players += rows.length;
    docs.push({
      abbr, name: t.name, pffSlug: t.slug, pffId: t.franchiseId, season, players: rows,
      unit: unitOf(abbr) || null,
    });
  }

  if (!DRY) {
    const batch = db.batch();
    docs.forEach((d) => batch.set(db.collection("pffNflRosters").doc(d.abbr), { ...d, updatedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }
  const needs = await writeNeeds(db, FieldValue, docs, { dry: DRY });
  console.log(`${DRY ? "[dry] " : ""}PFF NFL ${season}: ${docs.length} teams written, ${players} depth-chart players, needs for ${Object.keys(needs).length}.`);
  if (unmatched.length) console.log(`  unmatched teams: ${unmatched.join(", ")}`);
  console.log(`PFF calls: ${calls}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
