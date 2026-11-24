// scripts/buildRedraft.mjs
//
// A past draft for the Draft Sim's re-draft mode, as it stood the night
// before: src/utils/draftSim/redraft/{year}.json with
//   order   — the real draft order with compensatory picks dropped: each
//             round's first 32 picks (comp picks come at the end of rounds
//             3–7), numbered straight through.
//   actual  — what really happened: { [slug]: { pick, round, team } } for
//             the desk ("In April: No. 13 to the Rams").
//   needs   — every team's needs going in, in the sim's labels
//             (engine.js NEED_LABELS), built from nflverse — never typed:
//             the team's roster that season, its first week, minus that
//             year's rookies (≈ the roster after free agency, before the
//             draft), how much each player played the season before (snap
//             counts), his age on draft day and the contract he was on
//             (Over The Cap).
//             2000–2016 (user, 2026-11-24): none — most of those players
//             are long gone, so those re-drafts use today's needs
//             (data.js — compSnapshots/_teamNeeds); needs/qbTeams null.
//   qbTeams — teams that go into the draft wanting a quarterback.
//   headshots — { [player id]: ESPN id } for the players' current ESPN NFL
//             headshots (a.espncdn.com/i/headshots/nfl/players/full/{id}.png);
//             only ids whose NFL photo exists.
//   mix     — the Fun board: [player id], best first — each
//             player's place in the real draft and his place on hindsight,
//             averaged. Hindsight for 2026 (one season in): current PFF NFL
//             grades from pffNflRosters (admin-only), shrunk toward average
//             on few snaps, plus a playing-time bonus; for older classes:
//             nflverse draft_picks career value (weighted AV, Pro Bowls,
//             All-Pros). Only the order ships — never a grade.
//   hindsight — older classes only (user, 2026-11-24 — not 2026): the
//             Hindsight board, [player id] by career value alone.
//   players — older classes only (no class snapshots exist for them): the
//             board, from `historical` (every drafted player) — ids "h_"
//             + the historical doc id, so they never meet a players doc.
//   locks   — { [team]: [player id] }: players a CPU team always takes
//             when it's on the clock with him there (LOCKS — the user's
//             calls, e.g. 2026's Raiders take Fernando Mendoza).
//   report  — per team / need, who the label was read from (for review).
//
// 2026 reads its order and class from `draftOrder` / `players`; 2017–2025
// from nflverse draft_picks + `historical` (joined on the overall pick).
// Read-only on Firestore. Writes only the JSON files.
//
//   node scripts/buildRedraft.mjs                  # every year, 2017–2026
//   node scripts/buildRedraft.mjs --year 2019      # one year
//   node scripts/buildRedraft.mjs --cache DIR      # read/keep nflverse files in DIR
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { parseCsv } from "./importCombineInvites.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY && fs.existsSync(path.join(root, ".env"))) {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const FIRST_YEAR = 2000, LATEST = 2026;
// Re-drafts before this year use today's team needs, not their own.
const OWN_NEEDS_FROM = 2017;
const YEARS = arg("--year") ? [Number(arg("--year"))] : Array.from({ length: LATEST - FIRST_YEAR + 1 }, (_, i) => LATEST - i);
// Picks a re-draft always keeps (user, 2026-11-24): team → player slugs.
const LOCKS = { 2026: { LV: ["fernando-mendoza-2026-qb"] } };
const CACHE = arg("--cache");
const NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download";

const files = {};
function nflverse(file) {
  if (files[file]) return files[file];
  return (files[file] = (async () => {
    const local = CACHE && path.join(CACHE, path.basename(file));
    let buf;
    if (local && fs.existsSync(local)) buf = fs.readFileSync(local);
    else {
      const res = await fetch(`${NFLVERSE}/${file}`);
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      if (local) fs.writeFileSync(local, buf);
    }
    return parseCsv((file.endsWith(".gz") ? zlib.gunzipSync(buf) : buf).toString("utf8"));
  })());
}

// nflverse's team codes (rosters and PFR's in draft_picks) → the site's.
const TEAM = { LA: "LAR", OAK: "LV", LVR: "LV", SD: "LAC", SDG: "LAC", STL: "LAR", GNB: "GB", KAN: "KC", NOR: "NO", NWE: "NE", SFO: "SF", TAM: "TB" };
const team = (code) => TEAM[code] || code;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");
const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ── Roster → need keys ──
// How many starters a team plays at each need key.
const SLOTS = { QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, G: 2, C: 1, IDL: 2, EDGE: 2, LB: 2, CB: 3, S: 2 };
// Starter age at which a position's "aging" starts.
const AGING = { QB: 36, RB: 28, WR: 31, TE: 31, OT: 33, G: 32, C: 32, IDL: 31, EDGE: 31, LB: 30, CB: 30, S: 31 };
// A roster player's need key, from his depth-chart spot and size: 3-4
// outside linebackers and lighter ends rush the edge, heavy ends play inside.
function keyOf(r) {
  const d = r.depth_chart_position || r.position;
  const wt = Number(r.weight) || 0;
  switch (d) {
    case "QB": return "QB";
    case "RB": return "RB";
    case "WR": return "WR";
    case "TE": return "TE";
    case "T": case "OT": return "OT";
    case "G": case "OG": return "G";
    case "C": return "C";
    case "DT": case "NT": return "IDL";
    case "DE": return wt >= 295 ? "IDL" : "EDGE";
    case "OLB": return wt >= 245 ? "EDGE" : "LB";
    case "ILB": case "MLB": case "LB": return "LB";
    case "CB": case "DB": return "CB";
    case "FS": case "SS": case "S": return "S";
    default: return null;
  }
}
const STARTER = 0.55; // share of the season's snaps that makes a starter
const ON_ROSTER = ["ACT", "RES", "INA", "EXE", "PUP", "SUS"];

// Every team's needs going into `year`'s draft → { needs, qbTeams, report }.
async function teamNeeds(year) {
  const draftDay = new Date(`${year}-04-25`);
  const ageOn = (birth) => (birth ? (draftDay - new Date(birth)) / (365.25 * 864e5) : null);
  const [weekly, snaps, contracts, nflPlayers] = await Promise.all([
    nflverse(`weekly_rosters/roster_weekly_${year}.csv`),
    nflverse(`snap_counts/snap_counts_${year - 1}.csv`),
    nflverse("contracts/historical_contracts.csv.gz"),
    nflverse("players/players.csv"),
  ]);
  // Roster rows carry a GSIS id; contracts an Over The Cap id. nflverse's
  // players file links them (names collide — there are several Chris Joneses).
  const otcOf = {};
  nflPlayers.forEach((p) => { if (p.gsis_id && p.otc_id) otcOf[p.gsis_id] = String(p.otc_id); });

  // Last season's share of his team's snaps (regular season, out of 17
  // games — 16 through 2020). By PFR id, and by name for roster rows that
  // carry none (most linemen; most of everyone in older seasons).
  const games = year - 1 >= 2021 ? 17 : 16;
  const share = {}, shareByName = {};
  snaps.filter((s) => s.game_type === "REG").forEach((s) => {
    const pct = Math.max(Number(s.offense_pct) || 0, Number(s.defense_pct) || 0) / games;
    share[s.pfr_player_id] = (share[s.pfr_player_id] || 0) + pct;
    shareByName[norm(s.player)] = (shareByName[norm(s.player)] || 0) + pct;
  });

  // The contract each player was on that season: the latest one signed by
  // then — and the season it ran through.
  const deal = {};
  contracts.forEach((c) => {
    const signed = Number(c.year_signed), years = Number(c.years);
    if (!signed || !years || signed > year) return;
    [c.otc_id && `o:${c.otc_id}`, `n:${norm(c.player)}`].filter(Boolean).forEach((k) => {
      if (!deal[k] || signed > deal[k].signed) deal[k] = { signed, through: signed + years - 1 };
    });
  });
  const dealOf = (r) => (otcOf[r.gsis_id] ? deal[`o:${otcOf[r.gsis_id]}`] : deal[`n:${norm(r.full_name)}`]);

  // The team going into the draft: its first week's roster (Miami and Tampa
  // had no Week 1 in 2017), without this year's rookies.
  const firstWeek = {};
  weekly.forEach((r) => { const w = Number(r.week); if (w && (!firstWeek[r.team] || w < firstWeek[r.team])) firstWeek[r.team] = w; });
  const roster = weekly.filter((r) => Number(r.week) === firstWeek[r.team] && ON_ROSTER.includes(r.status) && Number(r.rookie_year || r.entry_year) !== year);
  const teams = {};
  roster.forEach((r) => {
    const key = keyOf(r);
    if (!key) return;
    let s = Math.min(1, (r.pfr_id && share[r.pfr_id] != null ? share[r.pfr_id] : shareByName[norm(r.full_name)]) || 0);
    // A recent high pick is counted on even before he's played much.
    const pick = Number(r.draft_number) || 999, entry = Number(r.rookie_year || r.entry_year) || 0;
    const young = entry >= year - 2 && pick <= 50;
    if (young) s = Math.max(s, 0.65);
    else if (entry === year - 1 && pick <= 100) s = Math.max(s, 0.5);
    const t = team(r.team);
    (teams[t] ||= {})[key] ||= [];
    teams[t][key].push({
      name: r.full_name, share: Math.round(s * 100) / 100, age: ageOn(r.birth_date), pick, entry, young,
      expiring: dealOf(r)?.through === year,
    });
  });

  const needs = {}, report = {}, qbTeams = [];
  Object.entries(teams).forEach(([t, byKey]) => {
    needs[t] = {}; report[t] = {};
    Object.entries(SLOTS).forEach(([key, n]) => {
      const room = (byKey[key] || []).sort((a, b) => b.share - a.share);
      const starters = room.slice(0, n).filter((p) => p.share >= STARTER);
      const quality = room.slice(0, n).reduce((a, p) => a + p.share, 0) / n;
      const holes = n - starters.length;
      const labels = [];
      const notes = [];
      if (key === "QB") {
        const qb = room[0];
        if (!qb || qb.share < 0.45) { labels.push("Upgrade Needed"); notes.push(qb ? `${qb.name} played ${Math.round(qb.share * 100)}% of snaps` : "no starter"); }
        else if (qb.share < STARTER) labels.push("Upgrade Wanted");
      } else if (holes > 0) {
        labels.push(quality < 0.5 || (n === 1 && (room[0]?.share || 0) < 0.45) ? "Upgrade Needed" : "Upgrade Wanted");
        notes.push(`${starters.length} of ${n} starters`);
      }
      const old = starters.filter((p) => p.age >= AGING[key]);
      if (old.length) { labels.push("Aging Talent"); notes.push(old.map((p) => `${p.name} turns ${Math.floor(p.age) + 1}`).join(", ")); }
      const expiring = starters.filter((p) => p.expiring && !p.young);
      if (expiring.length && !labels.includes("Upgrade Needed")) { labels.push("Expiring Contract"); notes.push(`${expiring.map((p) => p.name).join(", ")} up after ${year}`); }
      if (!labels.length) {
        const solid = room.filter((p) => p.share >= STARTER).length;
        if (solid > n || (key === "QB" && room.some((p) => p.young && p.pick <= 40) && room[0].share >= STARTER)) labels.push("Crowded Room");
        else if (room.length <= n) labels.push("Depth Needed");
      }
      if (labels.length) needs[t][key] = { labels, note: notes.join("; ") };
      report[t][key] = room.slice(0, n + 1).map((p) => `${p.name} ${Math.round(p.share * 100)}%${p.age ? ` ${Math.floor(p.age)}` : ""}${p.expiring ? " exp" : ""}`).join(", ");
    });
    const qbl = needs[t].QB?.labels || [];
    if (qbl.includes("Upgrade Needed") || qbl.includes("Aging Talent")) qbTeams.push(t);
  });
  return { needs, qbTeams: qbTeams.sort(), report };
}

// Each round's first picks, one per team (no comp picks), renumbered —
// 32, or 31 before the Texans (2000–2001). rows: [{ round, pick, team }].
function orderOf(rows, year) {
  const order = [];
  const perRound = year < 2002 ? 31 : 32;
  for (let round = 1; round <= 7; round++) {
    const picks = rows.filter((p) => p.round === round).sort((a, b) => a.pick - b.pick);
    if (picks.length < perRound) console.warn(`${year} round ${round}: only ${picks.length} picks`);
    picks.slice(0, perRound).forEach((p) => order.push({ Pick: order.length + 1, Round: round, Team: p.team, Traded: null }));
  }
  return order;
}

// Only ESPN ids whose NFL headshot exists (a few at a time). pairs: [[player id, ESPN id]].
async function checkedHeadshots(pairs) {
  const out = {};
  for (let i = 0; i < pairs.length; i += 20) {
    await Promise.all(pairs.slice(i, i + 20).map(async ([id, espn]) => {
      const res = await fetch(`https://a.espncdn.com/i/headshots/nfl/players/full/${espn}.png`, { method: "HEAD" }).catch(() => null);
      if (res?.ok) out[id] = String(espn);
    }));
  }
  return out;
}

// The Fun board: each player's place in the real draft (undrafted after,
// by `fallback`) and on hindsight (scored players best first, the rest
// after in real order), averaged → { mix, hindsight } ([player id]s).
// players: [{ id, pick, score, fallback }].
function boardOrders(players) {
  const byReal = [...players].sort((a, b) => (a.pick ?? 9999) - (b.pick ?? 9999) || a.fallback - b.fallback);
  const realAt = Object.fromEntries(byReal.map((p, i) => [p.id, i]));
  const byPlay = [...players].sort((a, b) => (b.score != null) - (a.score != null) || (b.score ?? 0) - (a.score ?? 0) || realAt[a.id] - realAt[b.id]);
  const playAt = Object.fromEntries(byPlay.map((p, i) => [p.id, i]));
  return {
    mix: [...players].sort((a, b) => (realAt[a.id] + playAt[a.id]) - (realAt[b.id] + playAt[b.id]) || realAt[a.id] - realAt[b.id]).map((p) => p.id),
    hindsight: byPlay.map((p) => p.id),
  };
}

// ── Hindsight scores ──
// A PFF NFL season grade with few snaps behind it means little: shrink it
// toward an average grade (PFF_PRIOR) by PFF_PRIOR_SNAPS snaps' worth, then
// reward playing time (a team trusting him on the field says something).
const PFF_PRIOR = 55, PFF_PRIOR_SNAPS = 150, PFF_SNAP_BONUS = 8, PFF_FULL_SNAPS = 700;
const pffScore = (g, sn) => (g * sn + PFF_PRIOR * PFF_PRIOR_SNAPS) / (sn + PFF_PRIOR_SNAPS) + PFF_SNAP_BONUS * Math.min(sn, PFF_FULL_SNAPS) / PFF_FULL_SNAPS;
// nflverse career value: weighted AV plus All-Pro and Pro Bowl nods.
const careerScore = (r) => (Number(r.w_av) || 0) + 8 * (Number(r.allpro) || 0) + 3 * (Number(r.probowls) || 0);

// ── 2026: the class we graded (players / draftOrder), PFF for hindsight ──
async function build2026(db, year) {
  const [orderSnap, playerSnap, weekly, season, pffTeams] = await Promise.all([
    db.collection("draftOrder").get(),
    db.collection("players").where("Eligible", "==", String(year)).get(),
    nflverse(`weekly_rosters/roster_weekly_${year}.csv`),
    nflverse(`rosters/roster_${year}.csv`),
    db.collection("pffNflRosters").get(),
  ]);
  const real = orderSnap.docs.map((d) => d.data()).filter((d) => d.Round && d.Pick);
  const order = orderOf(real.map((p) => ({ round: Number(p.Round), pick: Number(p.Pick), team: p.Team })), year);
  const actual = {};
  real.filter((p) => p.Selection).forEach((p) => { actual[p.Selection] = { pick: Number(p.Pick), round: Number(p.Round), team: p.Team }; });

  // ESPN ids: nflverse's rookies (any week, and the season roster), then
  // ESPN's own NFL rosters (nflverse has none for most linemen) — by name
  // (college when two share one), else last name + college + one first
  // name the start of the other (Ola / Olaivavega, Matt / Matthew).
  const rookies = [];
  const addRookie = (name, first, last, id, college) => { if (id && !rookies.some((x) => x.id === String(id))) rookies.push({ key: norm(name), first: norm(first), last: norm(last), id: String(id), college: String(college || "").toLowerCase() }); };
  [...weekly, ...season].filter((r) => Number(r.rookie_year || r.entry_year) === year).forEach((r) => addRookie(r.full_name, r.first_name, r.last_name, r.espn_id, r.college));
  for (let t = 1; t <= 34; t++) {
    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${t}/roster`).catch(() => null);
    if (!res?.ok) continue;
    const j = await res.json();
    (j.athletes || []).flatMap((g) => g.items || []).filter((a) => a.experience?.years === 0)
      .forEach((a) => addRookie(a.fullName, a.firstName, a.lastName, a.id, a.college?.name));
  }
  const atSchool = (school) => (x) => x.college.includes(String(school || "").toLowerCase());
  const pairs = playerSnap.docs.map((d) => {
    const p = d.data();
    let list = rookies.filter((x) => x.key === norm(`${p.First} ${p.Last}`));
    if (new Set(list.map((x) => x.id)).size > 1) list = list.filter(atSchool(p.School));
    const first = norm(p.First);
    if (!list.length) list = rookies.filter((x) => x.last === norm(p.Last) && atSchool(p.School)(x) && first && x.first && (x.first.startsWith(first) || first.startsWith(x.first)));
    const ids = [...new Set(list.map((x) => x.id))];
    return ids.length === 1 ? [d.id, ids[0]] : null;
  }).filter(Boolean);
  const headshots = await checkedHeadshots(pairs);

  // Hindsight: PFF, by name — or last name + birthday ("Ola" / "Vega" Ioane).
  const pff = {};
  pffTeams.docs.forEach((d) => (d.data().players || []).filter((p) => p.ey === year && p.g != null).forEach((p) => {
    const rec = { sn: p.sn || 0, score: pffScore(p.g, p.sn || 0) };
    [norm(p.n), p.dob && `${norm(String(p.n).split(" ").slice(1).join(" "))}|${p.dob}`].filter(Boolean).forEach((k) => {
      if (!pff[k] || rec.sn > pff[k].sn) pff[k] = rec;
    });
  }));
  const pool = playerSnap.docs.map((d) => {
    const p = d.data();
    const s = pff[norm(`${p.First} ${p.Last}`)] || (/^\d{4}-\d\d-\d\d$/.test(p.Birthday || "") ? pff[`${norm(p.Last)}|${p.Birthday}`] : null);
    return { id: d.id, name: `${p.First} ${p.Last}`, pick: actual[p.Slug]?.pick ?? null, score: s?.score ?? null, fallback: p.ClassRank ?? 9999 };
  });

  const idOf = Object.fromEntries(playerSnap.docs.map((d) => [d.data().Slug, d.id]));
  const locks = Object.fromEntries(Object.entries(LOCKS[year] || {}).map(([t, slugs]) => [t, slugs.map((s) => {
    if (!idOf[s]) throw new Error(`Lock: no ${year} player ${s}`);
    return idOf[s];
  })]));
  const posOf = Object.fromEntries(playerSnap.docs.map((d) => [d.data().Slug, d.data().Position]));
  return { order, actual, headshots, pool, locks, players: null, posOfPick: (p) => posOf[p.slug], picks: real.filter((p) => p.Selection).map((p) => ({ slug: p.Selection, round: Number(p.Round), team: p.Team })) };
}

// ── 2017–2025: `historical` (every drafted player) + nflverse draft_picks ──
const SUB = { T: "OT", OT: "OT", G: "G", C: "C", CB: "CB", S: "S", SAF: "S", FS: "S", SS: "S" };
async function buildPast(db, year) {
  const [histSnap, draftPicks, nflPlayers] = await Promise.all([
    db.collection("historical").where("Year", "==", String(year)).get(),
    nflverse("draft_picks/draft_picks.csv"),
    nflverse("players/players.csv"),
  ]);
  const dp = draftPicks.filter((r) => Number(r.season) === year);
  const dpAt = Object.fromEntries(dp.map((r) => [Number(r.pick), r]));
  const order = orderOf(dp.map((r) => ({ round: Number(r.round), pick: Number(r.pick), team: team(r.team) })), year);
  const espnOf = {};
  nflPlayers.forEach((p) => { if (p.espn_id) { if (p.gsis_id) espnOf[`g:${p.gsis_id}`] = p.espn_id; if (p.pfr_id) espnOf[`p:${p.pfr_id}`] = p.espn_id; } });

  const actual = {}, players = [], pool = [], pairs = [], picks = [];
  const used = new Set();
  histSnap.docs.forEach((d) => {
    const h = d.data();
    const pick = Number(h.Pick), r = dpAt[pick];
    if (!(pick > 0) || !h.Position) return;
    const id = `h_${d.id}`;
    let slug = `${slugify(`${h.First} ${h.Last}`)}-${year}-${slugify(h.Position)}`;
    while (used.has(slug)) slug += "-x";
    used.add(slug);
    const t = r ? team(r.team) : null;
    actual[slug] = { pick, round: Number(h.Round) || Number(r?.round) || null, team: t };
    players.push({
      id, First: h.First || "", Last: h.Last || "", Position: h.Position, School: h.School || "", Slug: slug, cr: pick,
      subPosition: ["OL", "DB"].includes(h.Position) ? SUB[r?.position] || null : null,
      height: Number(h.Height) || null, weight: Number(h.Weight) || null,
    });
    pool.push({ id, name: `${h.First} ${h.Last}`, pick, score: r ? careerScore(r) : null, fallback: pick });
    const espn = r && (espnOf[`g:${r.gsis_id}`] || espnOf[`p:${r.pfr_player_id}`]);
    if (espn) pairs.push([id, espn]);
    if (t) picks.push({ slug, round: actual[slug].round, team: t, pos: h.Position });
  });
  const headshots = await checkedHeadshots(pairs);
  const posOf = Object.fromEntries(players.map((p) => [p.Slug, p.Position]));
  return { order, actual, headshots, pool, locks: {}, players, posOfPick: (p) => posOf[p.slug], picks };
}

async function buildYear(db, year) {
  const [{ needs, qbTeams, report }, cls] = await Promise.all([
    year >= OWN_NEEDS_FROM ? teamNeeds(year) : { needs: null, qbTeams: null, report: null },
    year >= LATEST ? build2026(db, year) : buildPast(db, year),
  ]);
  const { mix, hindsight } = boardOrders(cls.pool);

  // How well the needs read the real rounds 1–2: did the team's pick fill one?
  const posKeys = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], OL: ["OT", "G", "C"], DL: ["IDL"], EDGE: ["EDGE"], LB: ["LB"], DB: ["CB", "S"] };
  const urgent = ["Upgrade Needed", "Upgrade Wanted", "Aging Talent", "Expiring Contract"];
  const early = cls.picks.filter((p) => p.round <= 2);
  const hit = early.filter((p) => (posKeys[cls.posOfPick(p)] || []).some((k) => urgent.some((l) => needs?.[p.team]?.[k]?.labels.includes(l))));
  const byId = Object.fromEntries(cls.pool.map((p) => [p.id, p]));
  const drafted = cls.pool.filter((p) => p.pick != null);
  console.log(`${year}: ${cls.order.length} picks · ${needs ? `needs hit ${hit.length}/${early.length} of rounds 1–2 · QB teams ${qbTeams.join(" ")}` : "today's needs"} · headshots ${drafted.filter((p) => cls.headshots[p.id]).length}/${drafted.length} drafted`);
  console.log(`   Fun top 10: ${mix.slice(0, 10).map((id) => `${byId[id].name} (${byId[id].pick ? `No. ${byId[id].pick}` : "UDFA"})`).join(", ")}`);

  const out = { year, built: new Date().toISOString().slice(0, 10), order: cls.order, actual: cls.actual, needs, qbTeams, headshots: cls.headshots, mix, ...(year < LATEST ? { hindsight } : {}), locks: cls.locks, ...(cls.players ? { players: cls.players } : {}), report };
  const file = path.join(root, "src/utils/draftSim/redraft", `${year}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
}

async function main() {
  const { getFirestore } = require("./firebaseAdmin.js");
  const db = getFirestore();
  for (const year of YEARS) await buildYear(db, year);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
