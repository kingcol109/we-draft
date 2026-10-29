// src/utils/draftSim/insights.js
//
// Draft Sim community insights — what everyone running the sim does, for
// the Community tab (components/draftSim/SimCommunity.jsx). Built from the
// usage counters (stats.js: draftSimTeams, draftSimPicks, draftSimDaily —
// admin-only) into one public doc, compSnapshots/simInsights, by
// scripts/buildSimInsights.mjs (every 3 hours) or Admin → Mock Draft →
// Statistics' "Publish community insights". Counts only, no users.
//   { version, builtAt,
//     totals: { all, week: { sims, completed, picks } },
//     years: { [year]: { all, week: {
//       teams: [{ t, n }]          teams users draft as, most first
//       players: [{ id, n }]       the players users draft most (TOP_PLAYERS)
//       favorites: [{ id, n, median }] the community's favorites: the
//                                  players users take furthest ahead of
//                                  their board spot — the median pick of
//                                  theirs, in spots early (n picks,
//                                  FAVORITE_MIN at least), most first. The
//                                  page shows them in the most-picked list's
//                                  place once there are TOP_FAVORITES
//                                  (favoritesReady).
//       firstRound: [{ overall, id, n, of }] — the most common pick at
//                                  each first-round slot, drafted in order
//                                  so no player goes twice (of: every pick
//                                  users made there)
//     } } },
//     players: { [id]: { F, L, pos, s, sl } } — everyone named above }
// week: the last WEEK_DAYS days (Eastern time). Board spots are the sim
// board's (boardRanks — the class snapshots as they stand now).
export const INSIGHTS_DOC = "simInsights";
export const WEEK_DAYS = 7;
const TOP_PLAYERS = 10;
export const TOP_FAVORITES = 10;
// The selections a favorite needs.
export const FAVORITE_MIN = 10;
// Enough volume for the favorites to stand in for the most picked: a full list.
export const favoritesReady = (favorites) => (favorites || []).length >= TOP_FAVORITES;
// The sim board's positions (engine SIM_POSITIONS — kickers and punters
// aren't on it).
export const BOARD_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const FIRST_ROUND = 32;
const WATCH = "WATCH";

// Today minus n−1 days, as the counters' YYYY-MM-DD (Eastern time).
const dayOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
export const sinceDay = (days, now = Date.now()) => dayOf(new Date(now - (days - 1) * 86400000));

const ranked = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1]);

// The median of counted values ({ [value]: count }).
function medianOf(counts) {
  const values = Object.entries(counts).map(([v, n]) => [Number(v), n]).sort((a, b) => a[0] - b[0]);
  const total = values.reduce((t, [, n]) => t + n, 0);
  const at = (k) => { let seen = 0; for (const [v, n] of values) { seen += n; if (seen > k) return v; } return values[values.length - 1][0]; };
  return total % 2 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2;
}

// A class's board spots, as the sim's board ranks it (engine buildBoard:
// by class rank): rowsByPos { [pos]: class snapshot rows } → { [id]: rank }.
export function boardRanks(rowsByPos) {
  const rows = BOARD_POSITIONS.flatMap((pos) => rowsByPos[pos] || []).filter((r) => r.cr != null)
    .sort((a, b) => a.cr - b.cr || String(a.i).localeCompare(String(b.i)));
  return Object.fromEntries(rows.map((r, i) => [r.i, i + 1]));
}

// One class's insights from its counter docs (already cut to the period).
// ranks: its board spots (boardRanks).
function yearInsights(teamDocs, pickDocs, ranks = {}, favoriteMin = FAVORITE_MIN) {
  const teams = {};
  teamDocs.forEach((d) => Object.entries(d.t || {}).forEach(([t, n]) => { if (t !== WATCH) teams[t] = (teams[t] || 0) + n; }));
  const players = {};
  // Each player's picks by spots early ({ [id]: { [spots]: n } }).
  const early = {};
  const slots = {};
  pickDocs.forEach((d) => Object.entries(d.p || {}).forEach(([key, n]) => {
    const [overall, id] = [Number(key.slice(0, key.indexOf("_"))), key.slice(key.indexOf("_") + 1)];
    players[id] = (players[id] || 0) + n;
    if (ranks[id] != null) {
      const e = (early[id] = early[id] || {});
      e[ranks[id] - overall] = (e[ranks[id] - overall] || 0) + n;
    }
    if (overall >= 1 && overall <= FIRST_ROUND) {
      const slot = (slots[overall] = slots[overall] || {});
      slot[id] = (slot[id] || 0) + n;
    }
  }));
  return {
    teams: ranked(teams).map(([t, n]) => ({ t, n })),
    players: ranked(players).slice(0, TOP_PLAYERS).map(([id, n]) => ({ id, n })),
    favorites: Object.entries(early)
      .map(([id, e]) => ({ id, n: Object.values(e).reduce((a, b) => a + b, 0), median: medianOf(e) }))
      .filter((f) => f.n >= favoriteMin && f.median > 0)
      .sort((a, b) => b.median - a.median || b.n - a.n).slice(0, TOP_FAVORITES),
    firstRound: communityRound(slots),
  };
}

// The community's first round, drafted like a real one: slot by slot, each
// takes its most common pick among the players still on the board. A slot
// whose every pick went earlier is left out.
function communityRound(slots) {
  const taken = new Set();
  return Object.keys(slots).map(Number).sort((a, b) => a - b).flatMap((overall) => {
    const counts = slots[overall];
    const best = ranked(counts).find(([id]) => !taken.has(id));
    if (!best) return [];
    taken.add(best[0]);
    return [{ overall, id: best[0], n: best[1], of: Object.values(counts).reduce((a, b) => a + b, 0) }];
  });
}

const sum = (docs) => docs.reduce((t, d) => ({ sims: t.sims + (d.sims || 0), completed: t.completed + (d.completed || 0), picks: t.picks + (d.picks || 0) }), { sims: 0, completed: 0, picks: 0 });

// The counter docs → the insights doc (without names: playerIds lists who
// to look up, withNames fills them in). teams / picks: draftSimTeams /
// draftSimPicks docs ({ year, day, … }); daily: draftSimDaily docs with
// their day ({ day, sims, completed, picks }); boards: { [year]: board
// spots (boardRanks) }; favoriteMin: the selections a favorite needs.
export function buildSimInsights({ teams = [], picks = [], daily = [], years, boards = {}, favoriteMin = FAVORITE_MIN, now = Date.now() }) {
  const week = sinceDay(WEEK_DAYS, now);
  const recent = (d) => d.day >= week;
  const out = {
    totals: { all: sum(daily), week: sum(daily.filter(recent)) },
    years: Object.fromEntries(years.map((y) => {
      const ty = teams.filter((d) => String(d.year) === String(y));
      const py = picks.filter((d) => String(d.year) === String(y));
      const ranks = boards[y] || boards[String(y)] || {};
      return [String(y), { all: yearInsights(ty, py, ranks, favoriteMin), week: yearInsights(ty.filter(recent), py.filter(recent), ranks, favoriteMin) }];
    })),
  };
  return out;
}

// Every player an insights doc names.
export const playerIds = (insights) => [...new Set(Object.values(insights.years).flatMap((y) => ["all", "week"].flatMap((k) => [
  ...y[k].players.map((p) => p.id), ...y[k].favorites.map((p) => p.id), ...y[k].firstRound.map((p) => p.id),
])))];

// players docs ({ id, First, Last, Position, School, Slug }) → the doc's names.
export const withNames = (insights, docs) => ({
  ...insights,
  players: Object.fromEntries(docs.filter(Boolean).map((p) => [p.id, { F: p.First || "", L: p.Last || "", pos: p.Position || "", s: p.School || "", sl: p.Slug || "" }])),
});
