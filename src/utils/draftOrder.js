// src/utils/draftOrder.js
//
// Upcoming NFL draft orders. One doc per draft, `draftOrders/{year}`:
//   order    [abbr × 32] — the selection order; every round runs in this
//            order (no compensatory picks modeled yet)
//   trades   { "{round}-{originalTeam}": holder } — a pick that changed
//            hands, keyed by its round and original owner, so it stays
//            attached to that pick whenever the order is re-sorted
//   conditions  [{ round, teams: [a, b], earlier, later, note }] — a
//            conditional pick, e.g. "the Jets get the earlier of Dallas's
//            own 1st and the one Dallas got from Green Bay": of those teams'
//            original picks in that round, the earlier goes to `earlier`, the
//            later to `later`. Resolved against the current order every time
//            (so it follows the weekly re-sort) and wins over `trades`.
//   auto     true = the Tuesday refresh (scripts/refreshDraftOrder.mjs)
//            re-sorts `order` from the standings; false = admin-only
//   source   "standings" | "admin", asOf (standings date), updatedAt
// Read by the team pages' Projected Picks tab (components/UpcomingPicks.jsx)
// and Create Mock; edited in Admin → Draft Order (DraftOrderEditor.js).
// Pure — no Firebase — so the scheduled script and the browser share it.
export const DRAFT_ROUNDS = 7;
export const TEAMS_PER_ROUND = 32;

export const tradeKey = (round, team) => `${round}-${team}`;

// The drafts the site projects, soonest first. Only the first has an order
// of its own (re-sorted from the standings every Tuesday); later drafts
// follow it — for now there's nothing to base them on — and keep only their
// own trades.
export const UPCOMING_DRAFT_YEARS = ["2027", "2028"];
export const ORDER_YEAR = UPCOMING_DRAFT_YEARS[0];
export const followsOrder = (year) => String(year) !== ORDER_YEAR;

// A draft's doc with the order it actually uses: its own for the upcoming
// draft, the upcoming draft's for any later one.
export function withEffectiveOrder(year, data, upcomingData) {
  if (!followsOrder(year)) return data;
  return { ...(data || {}), order: upcomingData?.order || [] };
}

// Holder of each conditional pick under the current order:
// { [tradeKey(round, team)]: { holder, condition } }.
export function conditionalHolders(order, conditions) {
  const out = {};
  (conditions || []).forEach((c) => {
    const [first, second] = [...(c.teams || [])].filter((t) => order.includes(t)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (first) out[tradeKey(c.round, first)] = { holder: c.earlier, condition: c };
    if (second) out[tradeKey(c.round, second)] = { holder: c.later, condition: c };
  });
  return out;
}

// Every pick in the draft: [{ Round, Pick (overall), Slot (in its round),
// Team (original owner), Traded (holder, when it changed hands),
// Conditional (its condition's note, when one decides it) }].
export function picksFromOrder(data, rounds = DRAFT_ROUNDS) {
  const order = data?.order || [];
  const trades = data?.trades || {};
  const conditional = conditionalHolders(order, data?.conditions);
  const out = [];
  for (let round = 1; round <= rounds; round += 1) {
    order.forEach((team, i) => {
      const cond = conditional[tradeKey(round, team)];
      const holder = cond ? cond.holder : trades[tradeKey(round, team)];
      out.push({
        Round: round, Pick: (round - 1) * order.length + i + 1, Slot: i + 1, Team: team,
        ...(holder && holder !== team ? { Traded: holder } : {}),
        ...(cond?.condition.note ? { Conditional: cond.condition.note } : {}),
      });
    });
  }
  return out;
}

// The old per-pick collections (draftOrder2027/{r1p1…}: Round, Pick, Team,
// Traded) → { order, trades } — seeds a year that has no draftOrders doc yet.
export function orderFromLegacyPicks(picks) {
  const round1 = picks.filter((p) => Number(p.Round) === 1).sort((a, b) => Number(a.Pick) - Number(b.Pick));
  const trades = {};
  picks.forEach((p) => { if (p.Traded && p.Traded !== p.Team) trades[tradeKey(Number(p.Round), p.Team)] = p.Traded; });
  return { order: round1.map((p) => p.Team), trades };
}

// ── Order from results ──
//
// The league's rule (reverse order of finish), from game results:
//   - During the regular season: a projection — every team by record,
//     worst first.
//   - Once it's complete: non-playoff teams take slots 1–20 by record;
//     playoff teams follow by the round they went out in — wild card
//     (21–24), divisional (25–28), conference championship (29–30), Super
//     Bowl loser (31), champion (32) — and within each group, worst
//     regular-season record first. Teams still alive sit after everyone
//     already eliminated, by record.
//   - Ties: lower strength of schedule (all scheduled opponents' combined
//     record) picks first; then lower strength of victory, then lower net
//     points, then alphabetical as a stand-in for the coin toss. (The
//     league's division/conference tiebreakers — head-to-head, common
//     games — aren't modeled.)
//
// games: [{ type: 2 (regular) | 3 (post), week, home, away, homeScore,
//   awayScore, completed }] with team abbreviations. Postseason weeks:
//   1 wild card, 2 divisional, 3 conference, 5 Super Bowl (4 = Pro Bowl,
//   ignored).
// → { order, phase: "none" (no games played yet — order is meaningless) |
//   "regular" | "postseason" | "final", records }
const STAGE_OF_WEEK = { 1: 1, 2: 2, 3: 3, 5: 4 }; // elimination stage
export function computeDraftOrder(games, teams) {
  const blank = () => ({ w: 0, l: 0, t: 0, pf: 0, pa: 0, opps: [], beat: [] });
  const rec = Object.fromEntries(teams.map((t) => [t, blank()]));
  const regular = games.filter((g) => g.type === 2 && rec[g.home] && rec[g.away]);
  regular.forEach((g) => {
    rec[g.home].opps.push(g.away);
    rec[g.away].opps.push(g.home);
    if (!g.completed) return;
    const h = rec[g.home];
    const a = rec[g.away];
    h.pf += g.homeScore; h.pa += g.awayScore; a.pf += g.awayScore; a.pa += g.homeScore;
    if (g.homeScore > g.awayScore) { h.w += 1; a.l += 1; h.beat.push(g.away); }
    else if (g.homeScore < g.awayScore) { a.w += 1; h.l += 1; a.beat.push(g.home); }
    else { h.t += 1; a.t += 1; }
  });
  const games_ = (r) => r.w + r.l + r.t;
  const pct = (r) => (games_(r) ? (r.w + 0.5 * r.t) / games_(r) : 0.5);
  // Combined record of a list of opponents (each game counts once).
  const combined = (list) => {
    let w = 0, n = 0;
    list.forEach((o) => { const r = rec[o]; w += r.w + 0.5 * r.t; n += games_(r); });
    return n ? w / n : 0;
  };
  const key = Object.fromEntries(teams.map((t) => {
    const r = rec[t];
    return [t, { pct: pct(r), sos: combined(r.opps), sov: combined(r.beat), net: r.pf - r.pa }];
  }));
  // Worse team first — the earlier pick.
  const byRecord = (a, b) => key[a].pct - key[b].pct || key[a].sos - key[b].sos || key[a].sov - key[b].sov || key[a].net - key[b].net || a.localeCompare(b);

  if (!regular.some((g) => g.completed)) return { order: [...teams].sort(), phase: "none", records: key };
  const regularDone = regular.length > 0 && regular.every((g) => g.completed);
  const post = games.filter((g) => g.type === 3 && STAGE_OF_WEEK[g.week] && rec[g.home] && rec[g.away]);
  if (!regularDone || !post.length) {
    return { order: [...teams].sort(byRecord), phase: "regular", records: key };
  }
  // Postseason: who's in, and the stage each team went out at (5 = champion).
  const stage = {};
  post.forEach((g) => { [g.home, g.away].forEach((t) => { if (!(t in stage)) stage[t] = null; }); });
  post.filter((g) => g.completed).forEach((g) => {
    const s = STAGE_OF_WEEK[g.week];
    const [winner, loser] = g.homeScore > g.awayScore ? [g.home, g.away] : [g.away, g.home];
    stage[loser] = s;
    if (s === 4) stage[winner] = 5;
  });
  // Teams on a wild-card bye appear first in the divisional round — same
  // treatment, they're simply in until they lose.
  const out = teams.filter((t) => !(t in stage)).sort(byRecord);
  const STILL_ALIVE = 4.5; // after every eliminated group, before the champion
  const groupOf = (t) => (stage[t] == null ? STILL_ALIVE : stage[t]);
  const playoff = teams.filter((t) => t in stage).sort((a, b) => groupOf(a) - groupOf(b) || byRecord(a, b));
  const done = Object.values(stage).includes(5);
  return { order: [...out, ...playoff], phase: done ? "final" : "postseason", records: key };
}

// ESPN abbreviations that differ from the site's.
const ESPN_ABBR = { WSH: "WAS", JAC: "JAX", LA: "LAR" };
export const fromEspnAbbr = (a) => ESPN_ABBR[a] || a;

// One ESPN scoreboard response → games in computeDraftOrder's shape.
export function gamesFromScoreboard(json, type, week) {
  return (json?.events || []).map((ev) => {
    const c = ev.competitions?.[0];
    const home = c?.competitors?.find((x) => x.homeAway === "home");
    const away = c?.competitors?.find((x) => x.homeAway === "away");
    if (!home || !away) return null;
    return {
      type, week,
      home: fromEspnAbbr(home.team?.abbreviation), away: fromEspnAbbr(away.team?.abbreviation),
      homeScore: Number(home.score) || 0, awayScore: Number(away.score) || 0,
      completed: !!c.status?.type?.completed,
    };
  }).filter(Boolean);
}

// The season whose results set a draft's order: the 2027 draft ← 2026 season.
export const seasonForDraft = (draftYear) => Number(draftYear) - 1;
// Scoreboard URLs for one season — 18 regular-season weeks + the playoffs.
export function scoreboardUrls(season) {
  const base = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
  return [
    ...Array.from({ length: 18 }, (_, i) => ({ type: 2, week: i + 1, url: `${base}?seasontype=2&week=${i + 1}&dates=${season}` })),
    ...[1, 2, 3, 5].map((w) => ({ type: 3, week: w, url: `${base}?seasontype=3&week=${w}&dates=${season}` })),
  ];
}

// Fetch + compute in one go (browser or Node 18+, both have fetch).
export async function fetchStandingsOrder(draftYear, teams) {
  const season = seasonForDraft(draftYear);
  const pages = await Promise.all(scoreboardUrls(season).map(async ({ type, week, url }) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
    return gamesFromScoreboard(await res.json(), type, week);
  }));
  return computeDraftOrder(pages.flat(), teams);
}
