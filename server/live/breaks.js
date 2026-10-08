// server/live/breaks.js
//
// The natural breaks of a live game — end of the 1st and 3rd quarters, and
// halftime — as small precomputed summaries on the game doc
// (liveGames/{id}.breaks), which /live's break card rotates through while
// play is stopped and leaves behind in the play log as a recap
// (src/components/LiveBreakCard.js). Built by the ingester after the plays
// are written (ingest.js storePlays) from data it already has — the plays,
// cached rosters, the We-Draft grade snapshots, the insight cards — so it
// costs no CFBD calls and viewers read nothing extra.
//
//   { key: "q1" | "half" | "q3", period, label, markerPlayId,
//     score: { home, away }, quarters: { home: [..], away: [..] },
//     teams: { home: {...}, away: {...} }      that quarter's / the half's numbers
//     top: { name, slug, side, lines }          best performer of the quarter / half
//     leaders: { passing, rushing, receiving } (halftime) each { name, slug, side, line }
//     moments: [{ title, context, side }]       the period's strongest insight cards
//     prospects: [...]                          (halftime) We-Draft players in the game,
//                                               best grade first, with first-half lines }

const { wedraftPlayersBySlug } = require("./store");
const { gradeSnapshots } = require("./insights");

const BREAKS = [
  { period: 1, key: "q1", label: "End of 1st Quarter" },
  { period: 2, key: "half", label: "Halftime" },
  { period: 3, key: "q3", label: "End of 3rd Quarter" },
];
const GRADE_LABELS = { 1: "Early First Round", 2: "Middle First Round", 3: "Late First Round", 4: "Second Round", 5: "Third Round", 6: "Fourth Round", 7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA" };
const HIDDEN_LIVE = [false, null, 0, "false", "no"];
const MAX_PROSPECTS = 6;

const live = (p) => p.presentation && !p.hidden && !p.removed;

// Same weights as /live's recap top performer (LivePage.js perfScore).
const perfScore = (st = {}) => {
  const ps = st.passing || {}, ru = st.rushing || {}, re = st.receiving || {}, de = st.defense || {};
  return (ps.yds || 0) * 0.04 + (ps.td || 0) * 4 - (ps.int || 0) * 2
    + (ru.yds || 0) * 0.1 + (ru.td || 0) * 6
    + (re.yds || 0) * 0.1 + (re.td || 0) * 6 + (re.rec || 0) * 0.5
    + (de.sacks || 0) * 3 + (de.int || 0) * 4 + (de.ff || 0) * 2 + (de.fr || 0) * 2;
};

function scoreThrough(plays, period) {
  let h = 0, a = 0;
  for (const p of plays) {
    if ((p.period || 0) > period) break;
    if (p.homeScore != null) h = p.homeScore;
    if (p.awayScore != null) a = p.awayScore;
  }
  return { home: h, away: a };
}

const teamLine = (T) => ({
  pts: null, totalYds: T.totalYds, passYds: T.passYds, rushYds: T.rushYds, firstDowns: T.firstDowns,
  third: T.third, turnovers: T.turnovers, sacked: T.sacked, penalties: T.penalties, plays: T.plays,
});

// The player lines with their best category's text.
function lineOf(lib, l, cats = lib.LEADER_CATS) {
  return cats.map((cat) => [cat, lib.statLine(cat, l.stats?.[cat])]).filter(([, t]) => t);
}

function topPerformer(lib, stats) {
  const all = ["home", "away"].flatMap((side) => (stats.players?.[side] || []).map((l) => ({ l, side })));
  const best = all.map((x) => ({ ...x, v: perfScore(x.l.stats) })).sort((a, b) => b.v - a.v)[0];
  if (!best || best.v <= 0) return null;
  return { name: best.l.name, slug: best.l.slug || null, side: best.side, lines: lineOf(lib, best.l) };
}

function leaders(lib, stats) {
  const g = lib.gameLeaders(stats, 1);
  const out = {};
  for (const cat of ["passing", "rushing", "receiving"]) {
    const e = g[cat]?.[0];
    if (e) out[cat] = { name: e.name, slug: e.slug || null, side: e.side, line: lib.statLine(cat, e.stats) };
  }
  return out;
}

// Each side's best player so far — only when he's genuinely having a good
// game (scaled to how much of it has been played: `share` = periods / 4).
// Feeds the break card's "who's been better" chat prompt, which needs two.
function standouts(lib, stats, share) {
  const good = (st = {}) => {
    const ps = st.passing || {}, ru = st.rushing || {}, re = st.receiving || {}, de = st.defense || {};
    return (ps.yds || 0) >= 300 * share || (ps.td || 0) >= Math.max(2, Math.round(4 * share))
      || (ru.yds || 0) >= 120 * share || (ru.td || 0) >= 2
      || (re.yds || 0) >= 120 * share || (re.td || 0) >= 2
      || (de.sacks || 0) >= 2 || (de.int || 0) >= 2;
  };
  const out = {};
  for (const side of ["home", "away"]) {
    const best = (stats.players?.[side] || []).map((l) => ({ l, v: perfScore(l.stats) })).sort((a, b) => b.v - a.v)[0];
    out[side] = best && good(best.l.stats) ? { name: best.l.name, slug: best.l.slug || null, line: lineOf(lib, best.l)[0]?.[1] || null } : null;
  }
  return out;
}

// We-Draft players on both rosters, best community grade first, each with
// what he's done so far (null when he hasn't shown up in the box yet) —
// halftime's prospects panel, and live timeouts' "prospect to watch".
async function gamePlayers(db, lib, rosters, stats, max = MAX_PROSPECTS) {
  const [bySlug, grades] = await Promise.all([wedraftPlayersBySlug(db), gradeSnapshots(db)]);
  const active = new Set(Object.keys(grades.years || {}));
  const lineBy = new Map();
  for (const side of ["home", "away"]) for (const l of stats.players?.[side] || []) lineBy.set(l.key, l);
  const out = [];
  for (const side of ["home", "away"]) {
    for (const r of rosters?.[side] || []) {
      if (!r.slug || !(r.status === "verified" || r.status === "suggested")) continue;
      const wd = bySlug.get(r.slug);
      if (!wd || HIDDEN_LIVE.includes(wd.live) || (active.size && !active.has(wd.cls))) continue;
      const row = grades.rows[wd.id];
      const rankIdx = wd.cls ? (grades.years[wd.cls] || []).findIndex((e) => e.i === wd.id) : -1;
      const l = lineBy.get(r.id);
      const lines = l ? lineOf(lib, l) : [];
      out.push({
        name: `${r.first} ${r.last}`.trim(), slug: r.slug, side, pos: wd.pos || r.pos || null, cls: wd.cls,
        grade: row ? GRADE_LABELS[Math.round(row[0])] || null : null, gradeAvg: row ? row[0] : null,
        classRank: rankIdx >= 0 ? rankIdx + 1 : null,
        strengths: row?.[2] ? row[2].split("|").filter(Boolean).slice(0, 3) : [],
        line: lines[0]?.[1] || null,
      });
    }
  }
  // Graded before ungraded, then best grade; a player who's shown up ahead of one who hasn't.
  return out.sort((a, b) => (a.gradeAvg ?? 99) - (b.gradeAvg ?? 99) || Number(!!b.line) - Number(!!a.line)).slice(0, max);
}

/**
 * game: the liveGames doc; ordered: its plays in game order (with
 * presentation); rosters: { home, away } cached CFBD rosters; insights: the
 * game's insight cards. Returns the breaks reached so far.
 */
async function buildBreaks(db, game, ordered, { rosters, insights = [] } = {}) {
  const lib = await import("../../src/utils/liveStats.mjs");
  const plays = ordered.filter(live);
  const out = [];
  for (const b of BREAKS) {
    // Reached: its end-of-period marker is in, or play has moved past it.
    const marker = plays.find((p) => p.presentation.type === "period" && p.period === b.period);
    const lastOf = [...plays].reverse().find((p) => p.period === b.period);
    if (!marker && !plays.some((p) => (p.period || 0) > b.period)) continue;
    if (!lastOf) continue;
    const half = b.key === "half";
    const inPeriod = plays.filter((p) => (half ? (p.period || 0) <= 2 : p.period === b.period));
    const through = plays.filter((p) => (p.period || 0) <= b.period);
    const stats = lib.computeGameStats(inPeriod);
    const score = scoreThrough(plays, b.period);
    const quarters = { home: [], away: [] };
    let prev = { home: 0, away: 0 };
    for (let q = 1; q <= b.period; q++) {
      const s = scoreThrough(plays, q);
      quarters.home.push(s.home - prev.home);
      quarters.away.push(s.away - prev.away);
      prev = s;
    }
    const teams = { home: teamLine(stats.teams.home), away: teamLine(stats.teams.away) };
    teams.home.pts = half ? score.home : quarters.home[b.period - 1];
    teams.away.pts = half ? score.away : quarters.away[b.period - 1];
    const ids = new Set(inPeriod.map((p) => p.id));
    const moments = insights.filter((x) => ids.has(x.sourcePlayId))
      .sort((x, y) => (y.score || 0) - (x.score || 0)).slice(0, half ? 3 : 2)
      .map((x) => ({ title: x.headline || x.title || "", context: x.context || "", side: x.side || null }))
      .filter((m) => m.context);
    const entry = {
      key: b.key, period: b.period, label: b.label,
      markerPlayId: (marker || lastOf).id,
      score, quarters, teams,
      top: topPerformer(lib, stats),
      moments,
      standouts: standouts(lib, lib.computeGameStats(through), b.period / 4),
    };
    if (half) {
      entry.leaders = leaders(lib, stats);
      entry.prospects = await gamePlayers(db, lib, rosters, lib.computeGameStats(through)).catch(() => []);
    }
    out.push(JSON.parse(JSON.stringify(entry)));
  }
  return out;
}

// Both teams' trivia (admin Branding > Trivia → teamTrivia), read once per
// game per warm process: [{ id, side, text }].
const TRIVIA_TTL_MS = 10 * 60 * 1000;
const triviaCache = new Map();
async function gameTrivia(db, game) {
  const key = String(game.providerGameId);
  const hit = triviaCache.get(key);
  if (hit && Date.now() - hit.at < TRIVIA_TTL_MS) return hit.list;
  const ids = ["home", "away"].map((s) => Number(game[s]?.providerTeamId)).filter(Number.isFinite);
  const snap = ids.length ? await db.collection("teamTrivia").where("teamId", "in", ids).get() : { docs: [] };
  const list = snap.docs.map((d) => {
    const x = d.data();
    return { id: d.id, side: Number(x.teamId) === Number(game.home?.providerTeamId) ? "home" : "away", text: String(x.text || "").slice(0, 400) };
  }).filter((x) => x.text).sort((a, b) => (a.id < b.id ? -1 : 1));
  triviaCache.set(key, { at: Date.now(), list });
  return list;
}

// What a live game's timeouts and break cards draw on (LiveBreakCard.js):
// each team's third / fourth down so far, the game's We-Draft prospects with
// their lines so far, and both teams' trivia. stats: computeGameStats of the
// plays so far.
async function timeoutExtras(db, rosters, stats, game) {
  const lib = await import("../../src/utils/liveStats.mjs");
  const T = (side) => ({ third: stats.teams[side].third, fourth: stats.teams[side].fourth });
  return {
    teamNow: { home: T("home"), away: T("away") },
    prospects: await gamePlayers(db, lib, rosters, stats, 10).catch(() => []),
    trivia: game ? await gameTrivia(db, game).catch(() => []) : [],
  };
}

module.exports = { buildBreaks, timeoutExtras, gameTrivia, BREAKS };
