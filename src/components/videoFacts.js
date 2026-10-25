// src/components/videoFacts.js
//
// Talking points for the Video Workshop (VideoWorkshop.js): everything about
// one player that's notable enough to say in a video, ranked against every
// FBS player. Sources:
//   CFBD  season stat totals on each cfbRosters/{teamId} row (s), plus
//         height/weight/recruiting on the same row
//   PFF   pffGrades/{teamId} (pffData.js) — grades with national ranks,
//         recent games, specific grades, advanced stats (st)
//
// A stat becomes a talking point when he ranks near the top of one of four
// scopes — all FBS, FBS at his position, his conference, his draft class
// (SCOPES: thresholds) — keeping each stat's most impressive scope. Plus
// PFF grade ranks, grade trends over his last 3 games, under/over-recruited
// contrasts and size extremes at his position.
//
// PFF data is back office only — never displayed on the public site.
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { POS_MAP, eligibleFor } from "./CfbUniverseSearch";
import { loadPffByCfbdId, PFF_TO_WD } from "./pffData";

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const fmtNum = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 10) / 10));
const pctFmt = (v) => `${fmtNum(v <= 1 ? v * 100 : v)}%`;
const heightOf = (ht) => `${Math.floor(ht / 12)}'${ht % 12}"`;

const WD_PLURAL = { QB: "QBs", RB: "RBs", WR: "WRs", TE: "TEs", OL: "OL", DL: "DL", EDGE: "edge rushers", LB: "LBs", DB: "DBs", K: "kickers", P: "punters" };
const PFF_PLURAL = { QB: "QBs", HB: "RBs", FB: "fullbacks", WR: "WRs", TE: "TEs", T: "tackles", G: "guards", C: "centers", DI: "interior DL", ED: "edge rushers", LB: "LBs", CB: "CBs", S: "safeties", K: "kickers" };
const CAT_PLURAL = { passing: "passers", rushing: "ball carriers", receiving: "receivers", blocking: "blockers", defense: "defenders", kicking: "kickers", punting: "punters" };
const SUB_LABEL = { pass: "passing", run: "rushing", route: "route-running", hands: "hands", pblk: "pass-blocking", rblk: "run-blocking", prush: "pass-rush", rdef: "run-defense", cov: "coverage", tkl: "tackling" };

// CFBD season stats: [category, stat, label, qualify?, format?, dir?].
// Counting stats need a value > 0; rates need volume (qualify).
const cs = (r, c, k) => n(r.s?.[c]?.[k]);
const QB_VOLUME = (r) => cs(r, "passing", "ATT") >= 80;
// Which CFBD categories belong to which We-Draft positions — a QB's
// receiving line or a receiver's trick-play pass isn't his story.
const DEF_POS = ["DL", "EDGE", "LB", "DB"];
const CAT_POSITIONS = {
  passing: ["QB"], rushing: ["QB", "RB", "WR", "TE"], receiving: ["RB", "WR", "TE"],
  defensive: DEF_POS, interceptions: DEF_POS, kicking: ["K"], punting: ["P"],
};
const CFBD_DEFS = [
  ["passing", "YDS", "passing yards"], ["passing", "TD", "passing TDs"],
  // Fewest interceptions among QBs with real volume.
  ["passing", "INT", "interceptions thrown", QB_VOLUME, null, -1],
  ["passing", "YPA", "yards per attempt", QB_VOLUME],
  ["passing", "PCT", "completion percentage", QB_VOLUME, pctFmt],
  ["rushing", "YDS", "rushing yards"], ["rushing", "TD", "rushing TDs"],
  ["rushing", "YPC", "yards per carry", (r) => cs(r, "rushing", "CAR") >= 40], ["rushing", "LONG", "longest run"],
  ["receiving", "REC", "receptions"], ["receiving", "YDS", "receiving yards"], ["receiving", "TD", "receiving TDs"],
  ["receiving", "YPR", "yards per catch", (r) => cs(r, "receiving", "REC") >= 15], ["receiving", "LONG", "longest catch"],
  ["defensive", "TOT", "tackles"], ["defensive", "SOLO", "solo tackles"], ["defensive", "TFL", "tackles for loss"],
  ["defensive", "SACKS", "sacks"], ["defensive", "PD", "passes defended"], ["defensive", "QB HUR", "QB hurries"], ["defensive", "TD", "defensive TDs"],
  ["interceptions", "INT", "interceptions"], ["interceptions", "YDS", "interception return yards"],
  ["kicking", "FGM", "field goals made"], ["kicking", "LONG", "longest field goal"], ["kicking", "PTS", "points scored by a kicker"],
  ["punting", "YPP", "yards per punt", (r) => cs(r, "punting", "NO") >= 15],
].map(([c, k, label, qualify, fmt, dir]) => ({
  key: `cfbd:${c}:${k}`, src: "CFBD", label, dir: dir || 1, fmt: fmt || fmtNum, positions: CAT_POSITIONS[c],
  get: (r) => cs(r, c, k), qualify: qualify || ((r) => cs(r, c, k) > 0),
}));

// PFF advanced stats (scripts/syncPffGrades.js STATS): [category, key,
// label, dir (1 more is better, -1 less is better), format, PFF positions
// it applies to]. Only players with a ranked PFF grade (enough snaps) count.
const COVER = ["CB", "S", "LB"];
const RUSH = ["DI", "ED", "LB"];
const PFF_DEFS = [
  ["passing", "big_time_throws", "big-time throws", 1], ["passing", "btt_rate", "big-time throw rate", 1, pctFmt],
  ["passing", "twp_rate", "turnover-worthy play rate", -1, pctFmt], ["passing", "accuracy_percent", "adjusted completion %", 1, pctFmt],
  ["passing", "avg_depth_of_target", "average depth of target", 1], ["passing", "avg_time_to_throw", "time to throw (quickest release)", -1, (v) => `${v}s`],
  ["passing", "pressure_to_sack_rate", "pressure-to-sack rate", -1, pctFmt],
  ["rushing", "yards_after_contact", "yards after contact", 1], ["rushing", "yco_attempt", "yards after contact per carry", 1],
  ["rushing", "elu_rush_mtf", "missed tackles forced", 1], ["rushing", "elusive_rating", "elusive rating", 1],
  ["rushing", "breakaway_percent", "breakaway percentage", 1, pctFmt], ["rushing", "explosive", "explosive runs", 1],
  ["receiving", "yprr", "yards per route run", 1], ["receiving", "contested_receptions", "contested catches", 1],
  ["receiving", "contested_catch_rate", "contested catch rate", 1, pctFmt], ["receiving", "drop_rate", "drop rate", -1, pctFmt],
  ["receiving", "yards_after_catch", "yards after the catch", 1], ["receiving", "avoided_tackles", "missed tackles forced after the catch", 1],
  ["receiving", "targeted_qb_rating", "passer rating when targeted", 1],
  // Raw pressures allowed favors low-snap blockers — efficiency covers it.
  ["blocking", "pbe", "pass-blocking efficiency", 1],
  // Sacks / TFL come from CFBD — PFF's own counts would repeat them. Pass
  // rush first (pressures lead a DL's table), ranked among pass rushers
  // only; coverage among CB / S / LB.
  ["defense", "total_pressures", "QB pressures", 1, null, RUSH], ["defense", "hits", "QB hits", 1, null, RUSH],
  ["defense", "hurries", "QB hurries (PFF)", 1, null, RUSH], ["defense", "batted_passes", "batted passes", 1, null, RUSH],
  ["defense", "stops", "stops", 1],
  ["defense", "missed_tackle_rate", "missed tackle rate", -1, pctFmt], ["defense", "pass_break_ups", "pass breakups", 1, null, COVER],
  ["defense", "forced_fumbles", "forced fumbles", 1],
  ["defense", "qb_rating_against", "passer rating allowed", -1, null, COVER],
  ["kicking", "total_percent", "field goal percentage", 1, pctFmt], ["kicking", "fifty_made", "50+ yard field goals", 1],
].map(([cat, k, label, dir, fmt, positions]) => ({
  key: `pff:${k}`, src: "PFF", label, dir, fmt: fmt || fmtNum, cat, pffPositions: positions,
  get: (r) => n(r.pff?.st?.[k]),
  qualify: (r) => r.pff?.rk != null && r.pff.cat === cat && (!positions || positions.includes(r.pff.pos))
    // A count of 0 isn't "leading" anything; a rate of 0 can be (0 drops)
    // — except passer rating allowed, which is 0 when never targeted.
    && (dir < 0 ? k !== "qb_rating_against" || n(r.pff.st?.[k]) > 0 : n(r.pff.st?.[k]) > 0),
}));

// Scopes, best first — max rank that's worth saying, and its weight when
// a stat qualifies in more than one.
const SCOPES = [
  { key: "fbs", max: 25, weight: 1 },
  { key: "pos", max: 10, weight: 0.92 },
  { key: "cls", max: 10, weight: 0.88 },
  { key: "conf", max: 5, weight: 0.82 },
];
const MIN_POOL = 15;

let universeCache = null;
// Every FBS roster player, joined to his PFF record, conference and draft
// class. ~16k rows; read once per session (rosters + schools + PFF +
// cfbdPlayers links).
export async function loadFactsUniverse(players) {
  if (universeCache) return universeCache;
  const [rosterSnap, schoolSnap, pff, linkSnap] = await Promise.all([
    getDocs(collection(db, "cfbRosters")),
    getDocs(collection(db, "schools")),
    loadPffByCfbdId(),
    getDocs(query(collection(db, "cfbdPlayers"), where("mappingStatus", "in", ["verified", "suggested"]))),
  ]);
  const confByTeam = new Map();
  schoolSnap.docs.forEach((d) => { const s = d.data(); if (s.CFBDTeamId != null) confByTeam.set(String(s.CFBDTeamId), s.Conference || ""); });
  const wdBySlug = new Map(players.filter((p) => p.Slug).map((p) => [p.Slug, p]));
  const wdById = new Map(players.map((p) => [p.id, p]));
  const cfbdByWd = new Map();
  linkSnap.docs.forEach((d) => { if (d.data().wedraftPlayerId) cfbdByWd.set(d.data().wedraftPlayerId, d.id); });

  const rows = [];
  rosterSnap.docs.forEach((d) => {
    const team = d.data();
    const conf = confByTeam.get(d.id) || "";
    if (!conf || conf === "FCS") return;
    (team.players || []).forEach((p) => {
      const rec = pff.get(String(p.id)) || null;
      const wd = (p.slug && wdBySlug.get(p.slug)) || null;
      rows.push({
        id: String(p.id), first: p.first, last: p.last, school: team.school, conf,
        pos: wd?.Position || PFF_TO_WD[rec?.pos] || POS_MAP[(p.pos || "").toUpperCase()] || "",
        cls: String(wd?.Eligible || eligibleFor(p)),
        ht: p.ht, wt: p.wt, stars: p.stars, recruitRank: p.rank, rc: p.rc, s: p.s, pff: rec, slug: p.slug,
      });
    });
  });
  // A We-Draft player linked through cfbdPlayers but not stamped on his roster row.
  const byId = new Map(rows.map((r) => [r.id, r]));
  cfbdByWd.forEach((cfbdId, wdId) => {
    const r = byId.get(cfbdId), wd = wdById.get(wdId);
    if (r && wd) { r.pos = wd.Position || r.pos; r.cls = String(wd.Eligible || r.cls); if (!r.slug) r.slug = wd.Slug; }
  });

  // Each stat's qualified values once, for ranking.
  const pools = new Map();
  [...CFBD_DEFS, ...PFF_DEFS].forEach((def) => {
    pools.set(def.key, rows.filter((r) => def.get(r) != null && def.qualify(r)).map((r) => ({ r, v: def.get(r) })));
  });
  universeCache = { rows, byId, cfbdByWd, pools };
  return universeCache;
}

// His row in the universe, or null (no roster row / FCS school).
export function rowFor(universe, player) {
  const id = universe.cfbdByWd.get(player.id);
  return (id && universe.byId.get(id)) || universe.rows.find((r) => r.slug && r.slug === player.Slug) || null;
}

function scopeText(scope, r, def) {
  if (scope === "fbs") return { noun: def.src === "PFF" ? `FBS ${CAT_PLURAL[def.cat]}` : "FBS", among: def.src === "PFF" ? `among FBS ${CAT_PLURAL[def.cat]}` : "in FBS" };
  if (scope === "pos") {
    const plural = def.src === "PFF" ? PFF_PLURAL[r.pff.pos] : WD_PLURAL[r.pos] || `${r.pos}s`;
    return { noun: `FBS ${plural}`, among: `among FBS ${plural}` };
  }
  if (scope === "cls") return { noun: `the ${r.cls} draft class`, among: `in the ${r.cls} draft class` };
  return { noun: `the ${r.conf}`, among: `in the ${r.conf}` };
}

function inScope(scope, a, r, def) {
  if (scope === "fbs") return true;
  if (scope === "pos") return def.src === "PFF" ? a.pff?.pos === r.pff?.pos : a.pos === r.pos;
  if (scope === "cls") return a.cls === r.cls;
  return a.conf === r.conf;
}

// Whether a stat is part of his story: CFBD categories by We-Draft
// position (CAT_POSITIONS), PFF stats by his PFF category and position.
function relevant(def, r) {
  if (def.src === "CFBD") return !r.pos || !def.positions || def.positions.includes(r.pos);
  return r.pff?.cat === def.cat && (!def.pffPositions || def.pffPositions.includes(r.pff.pos));
}

// His rank in one scope: { rank, of, tied }, or null when the scope's pool
// is too small to mean anything.
function rankIn(universe, def, r, v, scope) {
  const pool = universe.pools.get(def.key).filter((x) => inScope(scope, x.r, r, def));
  if (pool.length < MIN_POOL) return null;
  const better = pool.filter((x) => (def.dir > 0 ? x.v > v : x.v < v)).length;
  return { rank: better + 1, of: pool.length, tied: pool.filter((x) => x.v === v).length > 1 };
}

// The Workshop's Season stats table: every stat he has, CFBD then PFF,
// with his rank in each scope. A stat he hasn't qualified for (a rate
// without the volume) shows its value with no ranks.
// [{ src, group, label, value, qualified, ranks: { fbs, pos, conf, cls } }]
export const STAT_SCOPES = [
  { key: "fbs", label: "FBS" }, { key: "pos", label: "Position" }, { key: "conf", label: "Conference" }, { key: "cls", label: "Class" },
];
const GROUP_LABEL = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defensive: "Defense", interceptions: "Defense", kicking: "Kicking", punting: "Punting", blocking: "Blocking", defense: "Defense" };
export function statsFor(universe, r) {
  const out = [];
  [...CFBD_DEFS, ...PFF_DEFS].forEach((def) => {
    const v = def.get(r);
    // A zero CFBD total (0 rushing TDs) isn't worth a row.
    // (0 interceptions thrown is the point, though.)
    if (v == null || (def.src === "CFBD" && def.dir > 0 && v === 0) || !relevant(def, r)) return;
    const qualified = def.qualify(r);
    const ranks = {};
    if (qualified) STAT_SCOPES.forEach(({ key }) => { ranks[key] = rankIn(universe, def, r, v, key); });
    out.push({
      src: def.src, label: def.label, value: def.fmt(v), qualified, ranks,
      group: GROUP_LABEL[def.src === "PFF" ? def.cat : def.key.split(":")[1]] || "",
    });
  });
  return out;
}

// Talking points for one universe row, most impressive first:
// [{ text, kind, src, score }].
export function factsFor(universe, r) {
  const facts = [];

  // Stat ranks — each stat's best scope.
  [...CFBD_DEFS, ...PFF_DEFS].forEach((def) => {
    const v = def.get(r);
    if (v == null || !relevant(def, r) || !def.qualify(r)) return;
    let best = null;
    SCOPES.forEach((sc) => {
      const pool = universe.pools.get(def.key).filter((x) => inScope(sc.key, x.r, r, def));
      if (pool.length < MIN_POOL) return;
      const better = pool.filter((x) => (def.dir > 0 ? x.v > v : x.v < v)).length;
      const sharing = pool.filter((x) => x.v === v).length;
      const tied = sharing > 1;
      const rank = better + 1;
      // "T-6 with 1 INT" — a rank shared by a crowd isn't a talking point.
      if (rank > sc.max || sharing >= 4) return;
      const score = (1 - (rank - 1) / pool.length) * sc.weight + (rank === 1 ? 0.04 : 0) - rank * 0.004;
      if (!best || score > best.score) best = { sc, rank, tied, score, size: pool.length };
    });
    if (!best) return;
    const { noun, among } = scopeText(best.sc.key, r, def);
    const val = def.fmt(v);
    const text = best.rank === 1 && !best.tied
      ? `${def.dir > 0 ? "Leads" : "Best"} ${noun} in ${def.label} (${val})`
      : `${best.tied ? "T-" : "#"}${best.rank} ${among} in ${def.label} (${val})`;
    facts.push({ text, kind: "stat", src: def.src, score: best.score });
  });

  // PFF grades.
  const p = r.pff;
  if (p?.rk != null) {
    const pct = p.of > 1 ? 1 - (p.rk - 1) / (p.of - 1) : 1;
    if (p.rk <= 25 || pct >= 0.9) {
      facts.push({ text: `PFF grade ${p.g} — #${p.rk} of ${p.of} FBS ${PFF_PLURAL[p.pos] || p.pos} (${p.sn} snaps)`, kind: "pff", src: "PFF", score: 0.6 + pct * 0.4 });
    }
    Object.entries(p.x || {}).forEach(([k, [g, sn, rk, of]]) => {
      const subPct = of > 1 ? 1 - (rk - 1) / (of - 1) : 1;
      if (rk <= 15 || subPct >= 0.95) {
        facts.push({ text: `PFF ${SUB_LABEL[k]} grade ${g} — #${rk} of ${of} in FBS (${sn} snaps)`, kind: "pff", src: "PFF", score: 0.55 + subPct * 0.4 });
      }
    });

    // Recent form (newest first in rg).
    const games = (p.rg || []).filter((x) => p.cat === "kicking" || p.cat === "punting" || x.sn >= 10);
    if (games.length >= 3 && games[0].g > games[1].g && games[1].g > games[2].g) {
      facts.push({ text: `PFF grade has risen in each of his last 3 games (${games[2].g} → ${games[1].g} → ${games[0].g})`, kind: "trend", src: "PFF", score: 0.9 });
    } else if (games.length >= 3 && games[0].g < games[1].g && games[1].g < games[2].g) {
      facts.push({ text: `PFF grade has dropped 3 straight games (${games[2].g} → ${games[1].g} → ${games[0].g}) — something to address`, kind: "trend", src: "PFF", score: 0.5 });
    }
    if (games.length) {
      const last = games[0];
      const recentAvg = games.slice(0, 2).reduce((t, x) => t + x.g, 0) / Math.min(2, games.length);
      if (games.length >= 2 && recentAvg - p.g >= 8) {
        facts.push({ text: `Averaging ${fmtNum(recentAvg)} over his last 2 games, up from ${p.g} for the season`, kind: "trend", src: "PFF", score: 0.85 });
      }
      // His latest game against everyone at his position that week.
      const week = universe.rows.filter((x) => x.pff?.pos === p.pos && x.pff.w?.wk === last.wk && x.pff.w.sn >= 20).map((x) => x.pff.w.g);
      const wkRank = 1 + week.filter((g) => g > last.g).length;
      if (week.length >= MIN_POOL && last.sn >= 20 && wkRank <= 10) {
        facts.push({ text: `Week ${last.wk}: PFF grade ${last.g} — #${wkRank} of ${week.length} FBS ${PFF_PLURAL[p.pos] || p.pos} that week`, kind: "trend", src: "PFF", score: 0.8 + (wkRank === 1 ? 0.1 : 0) });
      }
    }
  }

  // Recruiting contrast.
  const elite = facts.some((f) => f.score >= 0.9) || (p?.rk != null && p.of > 1 && 1 - (p.rk - 1) / (p.of - 1) >= 0.9);
  if (elite && (!r.stars || r.stars <= 3)) {
    facts.push({
      text: r.stars ? `Under-recruited: a ${r.stars}★ prospect${r.recruitRank ? ` (#${r.recruitRank.toLocaleString()} nationally${r.rc ? `, class of ${r.rc}` : ""})` : ""} now playing at an elite level` : "Wasn't a ranked recruit — now one of the best at his position",
      kind: "recruit", src: "CFBD", score: 0.86,
    });
  } else if (r.stars === 5) {
    facts.push({ text: `Former 5★ recruit${r.recruitRank ? ` (#${r.recruitRank} nationally${r.rc ? `, class of ${r.rc}` : ""})` : ""}`, kind: "recruit", src: "CFBD", score: 0.6 });
  }

  // Size extremes at his position.
  if (r.pos) {
    const same = universe.rows.filter((x) => x.pos === r.pos);
    const sizeFact = (field, dir, word, fmt) => {
      const v = r[field];
      const pool = same.filter((x) => x[field] > 0).map((x) => x[field]);
      if (!v || pool.length < 30) return;
      const rank = 1 + pool.filter((x) => (dir > 0 ? x > v : x < v)).length;
      if (rank > 3) return;
      const plural = WD_PLURAL[r.pos] || `${r.pos}s`;
      facts.push({ text: rank === 1 ? `${word} of all FBS ${plural} (${fmt(v)})` : `#${rank} ${word.toLowerCase()} among FBS ${plural} (${fmt(v)})`, kind: "size", src: "CFBD", score: 0.55 });
    };
    sizeFact("ht", 1, "Tallest", heightOf);
    sizeFact("ht", -1, "Shortest", heightOf);
    sizeFact("wt", 1, "Heaviest", (v) => `${v} lbs`);
    sizeFact("wt", -1, "Lightest", (v) => `${v} lbs`);
  }

  return facts.sort((a, b) => b.score - a.score);
}
