// src/utils/draftSim/engine.js
//
// Draft Sim's engine — plain JS, no React or Firebase, so it's testable and
// the page (pages/DraftSim.jsx) just drives it. One sim is a state object
// that each step returns a new copy of, plus the events (picks, trades) that
// step produced for the analyst feed (utils/draftSim/analysts.js).
//
// How a CPU team picks (chooseCpuPick): every available prospect near the
// top of the board gets an "effective rank" for that team —
//   board rank (community grade consensus, see buildBoard)
//   × the position's draft-market weight (QBs go early, RBs/LBs slide)
//   − the team's staff fit (compSnapshots/nflFit_{Position}: how closely
//     the prospect matches what this GM/HC/OC/DC have drafted before —
//     the "coach tendencies"), worth more spots the later the pick
//   + a penalty for doubling up at a position already taken this draft
//   + team needs (TEAM_NEEDS hook — empty until needs are modeled)
//   + noise (seeded, so a sim replays exactly from its seed)
// and the lowest effective rank is the pick.
//
// Trades (findTradeUpOffers / maybeCpuTrade) are pick-for-pick on the site's
// trade chart (config/draftTradeChart). Players carry no trade value yet —
// tune TRADE_* below once they do.

export const SIM_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
// Kickers and punters: on the board for the user to draft, never the CPU.
// They sit at the bottom of the board (no one else's rank moves) and a pick
// of one is graded and reported as neither value nor reach.
export const SPECIALISTS = ["K", "P"];
export const isSpecialist = (p) => SPECIALISTS.includes(p?.Position);

// Draft-market weight per position: multiplies board rank, so <1 goes
// earlier than the board, >1 later.
export const POSITION_MARKET = { QB: 0.82, EDGE: 0.92, OL: 0.95, DB: 1, WR: 1, DL: 1, TE: 1.12, LB: 1.12, RB: 1.15 };

// Team needs: { [team]: { [position]: -1 (set) … 1 (dire) } }. Empty for now.
export const TEAM_NEEDS = {};

// Only this many of the best available (by board) are weighed per pick,
// plus anyone the team fits Very Strong (80+).
const CANDIDATES = 45;
const STRONG_FIT = 80;

// ── Trade tuning ──
// An offer must give the pick's owner at least this share of its chart value.
const TRADE_MIN_RATIO = 1.02;
// …and the CPU won't overpay past this.
const TRADE_MAX_RATIO = 1.3;
// How far ahead (in picks) a team will look to trade up.
const TRADE_WINDOW = 20;
// Per-pick chance two CPU teams make a deal, by round (index 0 = round 1).
const CPU_TRADE_CHANCE = [0.08, 0.05, 0.04, 0.03, 0.02, 0.02, 0.02];
const MAX_OFFERS = 2;
// Most picks one side will put in a deal.
const MAX_BUNDLE = 3;

// ── Seeded RNG (mulberry32) ──
export function rngNext(seed) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: (seed + 0x6d2b79f5) | 0 };
}
function gaussian(state) {
  const a = rngNext(state.seed);
  const b = rngNext(a.seed);
  state.seed = b.seed;
  return Math.sqrt(-2 * Math.log(a.value || 1e-9)) * Math.cos(2 * Math.PI * b.value);
}
function random(state) {
  const r = rngNext(state.seed);
  state.seed = r.seed;
  return r.value;
}

// ── Next year's picks ──
// The following draft's picks (its projected order) trade too, worth
// FUTURE_DISCOUNT of their slot on the chart. Each is keyed (its `overall`)
// as FUTURE_KEY + its pick number in that draft, so it can never collide
// with a pick in this one; `number` and `year` are what it's shown as.
export const FUTURE_DISCOUNT = 0.9;
export const FUTURE_KEY = 1000;

// ── Pick value ──
// The site's chart when it has the pick, else a curve shaped like it
// (≈ Jimmy Johnson: No. 1 ≈ 3000, No. 32 ≈ 830, No. 64 ≈ 230).
export function pickValue(chart, overall) {
  const v = Number(chart?.[overall]);
  return v > 0 ? v : Math.round(3000 * Math.exp(-0.0425 * (overall - 1)) + 30);
}

// A pick's trade-chart worth (next year's at FUTURE_DISCOUNT).
export function pickWorth(state, p) {
  if (!p) return 0;
  return p.future ? Math.round(pickValue(state.chart, p.number) * FUTURE_DISCOUNT) : pickValue(state.chart, p.overall);
}
// "No. 7", or "2028 R1 · No. 7" for next year's.
export const pickName = (p) => (p?.future ? `${p.year} R${p.round} · No. ${p.number}` : `No. ${p?.overall}`);
// A pick (this draft's, an unsimmed round's or next year's) by its key.
export const pickByKey = (state, key) => [...state.picks, ...(state.capital || [])].find((p) => p.overall === key) || null;

// ── Board ──
// prospects: [{ id, First, Last, Position, School, Slug, logo, cr? }] — cr
// is the official We-Draft.com class rank (compSnapshots/class_{year}_{pos});
// grades: { [id]: [avg, count, "s1|s2|s3", "w1|w2|w3"] } (the _grades
// snapshot's rows); fits: { [id]: [{ a: team, s, GM?, HC?, OC?, DC? }] };
// stats: { [slug]: { leaders, lines } } (data.js loadCfbStats).
// Order: class rank, then community grade (more evaluations breaking ties),
// then ungraded by best team fit. positionRank counts within the position.
export function buildBoard(prospects, grades = {}, fits = {}, stats = {}) {
  const split = (v) => (v ? String(v).split("|").filter(Boolean) : []);
  const rows = prospects.map((p) => {
    const g = grades[p.id];
    const teamFits = {};
    (fits[p.id] || []).forEach((f) => { teamFits[f.a] = f; });
    const bestFit = Math.max(0, ...(fits[p.id] || []).map((f) => f.s || 0));
    return {
      ...p, cr: p.cr ?? null, avg: g ? g[0] : null, count: g ? g[1] || 0 : 0,
      strengths: split(g?.[2]), weaknesses: split(g?.[3]),
      fits: teamFits, bestFit, stats: stats[p.Slug] || null,
    };
  });
  rows.sort((a, b) => {
    if (isSpecialist(a) !== isSpecialist(b)) return isSpecialist(a) ? 1 : -1;
    if (a.cr != null && b.cr != null) return a.cr - b.cr || a.id.localeCompare(b.id);
    if (a.cr != null) return -1;
    if (b.cr != null) return 1;
    if (a.avg != null && b.avg != null) return a.avg - b.avg || b.count - a.count || a.id.localeCompare(b.id);
    if (a.avg != null) return -1;
    if (b.avg != null) return 1;
    return b.bestFit - a.bestFit || a.id.localeCompare(b.id);
  });
  const seen = {};
  return rows.map((p, i) => {
    seen[p.Position] = (seen[p.Position] || 0) + 1;
    return { ...p, rank: i + 1, positionRank: seen[p.Position] };
  });
}

// ── Sim state ──
// order: [{ Pick, Round, Team, Traded }] (fetchDraft's picks).
// futureOrder / futureYear: next year's draft (same shape), traded as
// capital at FUTURE_DISCOUNT.
export function initSim({ order, board, chart = {}, userTeams = [], rounds = 1, seed = Date.now(), chaos = 1, staff = {}, futureOrder = [], futureYear = null }) {
  // Picks in rounds the sim doesn't draft still change hands in trades —
  // a one-round sim's teams can trade up with their 2nd-rounders — and so
  // do next year's.
  const capital = [
    ...order
      .filter((p) => p.Round > rounds)
      .map((p) => ({ overall: p.Pick, round: p.Round, original: p.Team, owner: p.Traded || p.Team, via: p.Traded ? p.Team : null, capital: true })),
    ...[...futureOrder]
      .sort((a, b) => a.Pick - b.Pick)
      .map((p) => ({
        overall: FUTURE_KEY + p.Pick, number: p.Pick, year: futureYear, future: true, round: p.Round,
        original: p.Team, owner: p.Traded || p.Team, via: p.Traded ? p.Team : null, capital: true,
      })),
  ];
  const picks = [...order]
    .filter((p) => p.Round <= rounds)
    .sort((a, b) => a.Pick - b.Pick)
    .map((p, i, all) => ({
      overall: p.Pick,
      round: p.Round,
      inRound: all.filter((q) => q.Round === p.Round && q.Pick <= p.Pick).length,
      original: p.Team,
      owner: p.Traded || p.Team,
      via: p.Traded ? p.Team : null,
      selection: null,
    }));
  return {
    picks, capital, board, chart, staff, chaos,
    byId: Object.fromEntries(board.map((p) => [p.id, p])),
    taken: {},
    teamPos: {},
    userTeams: [...userTeams],
    idx: 0,
    seed: seed | 0,
    offers: [],
    done: picks.length === 0,
  };
}

export const currentPick = (state) => state.picks[state.idx] || null;
export const isUserOnClock = (state) => !state.done && state.userTeams.includes(currentPick(state)?.owner);
export const available = (state) => state.board.filter((p) => !state.taken[p.id]);
// What the CPU drafts from (and trades up for): no specialists.
const cpuAvailable = (state) => available(state).filter((p) => !isSpecialist(p));
export const fitFor = (prospect, team) => prospect?.fits?.[team]?.s ?? null;

// A team's effective rank for a prospect at this pick (lower = wanted more).
function effectiveRank(state, team, p, overall, noise = 0) {
  const fit = fitFor(p, team);
  const fitPull = fit ? Math.max(0, (fit - 60) / 40) * (4 + 0.22 * overall) : 0;
  const repeat = state.teamPos[team]?.[p.Position] || 0;
  const repeatPenalty = repeat * (6 + 0.3 * overall) * (p.Position === "QB" ? 3 : 1);
  const need = TEAM_NEEDS[team]?.[p.Position] || 0;
  return p.rank * (POSITION_MARKET[p.Position] || 1) - fitPull + repeatPenalty - need * (5 + 0.25 * overall) + noise;
}

function candidatesFor(state, team) {
  const avail = cpuAvailable(state);
  const top = avail.slice(0, CANDIDATES);
  const fits = avail.slice(CANDIDATES).filter((p) => (fitFor(p, team) || 0) >= STRONG_FIT);
  return [...top, ...fits];
}

// The CPU's choice for the pick on the clock → prospect or null (board empty).
export function chooseCpuPick(state) {
  const pick = currentPick(state);
  if (!pick) return null;
  const work = { seed: state.seed };
  let best = null;
  let bestScore = Infinity;
  candidatesFor(state, pick.owner).forEach((p) => {
    const noise = gaussian(work) * (2.5 + 0.1 * pick.overall) * state.chaos;
    const score = effectiveRank(state, pick.owner, p, pick.overall, noise);
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return { prospect: best, seed: work.seed };
}

// Make the pick on the clock → { state, event }.
export function makePick(state, prospectId, seed = state.seed) {
  const pick = currentPick(state);
  const prospect = state.byId[prospectId];
  if (!pick || !prospect || state.taken[prospectId]) return { state, event: null };
  const picks = state.picks.map((p, i) => (i === state.idx ? { ...p, selection: prospectId } : p));
  const teamPos = { ...state.teamPos, [pick.owner]: { ...(state.teamPos[pick.owner] || {}) } };
  teamPos[pick.owner][prospect.Position] = (teamPos[pick.owner][prospect.Position] || 0) + 1;
  const prior = picks.slice(0, state.idx).map((p) => state.byId[p.selection]).filter(Boolean);
  const recent = prior.slice(-8);
  const event = {
    type: "pick",
    pick: { ...pick, selection: prospectId },
    team: pick.owner,
    prospect,
    isUser: state.userTeams.includes(pick.owner),
    // + = taken later than the board says (value); − = a reach.
    value: isSpecialist(prospect) ? 0 : pick.overall - prospect.rank,
    fit: prospect.fits?.[pick.owner] || null,
    positionOrdinal: prior.filter((p) => p.Position === prospect.Position).length + 1,
    positionRun: recent.filter((p) => p.Position === prospect.Position).length,
    bestLeftAtPosition: state.board.find((p) => p.Position === prospect.Position && !state.taken[p.id] && p.id !== prospectId) || null,
  };
  const idx = state.idx + 1;
  const next = {
    ...state, picks, teamPos, seed, offers: [],
    taken: { ...state.taken, [prospectId]: true },
    idx,
  };
  next.done = idx >= picks.length || available(next).length === 0;
  return { state: next, event };
}

// The Suggestions tab for the team on the clock → { value, staff }:
//   value  the best player left on the We-Draft.com board (community
//          grades), no specialists.
//   staff  one or two players a GM / head coach / coordinator has a strong
//          preference for — per seat, their best fit left; Very Strong
//          (80+) first, else the best Strong (70+) — [{ p, slot, score }],
//          never the value pick and never the same player twice.
export function suggestionsFor(state, team) {
  const avail = cpuAvailable(state);
  const value = avail[0] || null;
  const best = ["HC", "GM", "OC", "DC"].map((slot) => {
    let top = null;
    avail.forEach((p) => {
      const score = p.fits?.[team]?.[slot];
      if (score != null && p !== value && (!top || score > top.score)) top = { p, slot, score };
    });
    return top;
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  const staff = [];
  best.forEach((x) => { if (x.score >= 80 && staff.length < 2 && !staff.some((y) => y.p === x.p)) staff.push(x); });
  if (!staff.length && best[0]?.score >= 70) staff.push(best[0]);
  return { value, staff };
}

// One CPU pick (with the chance of a CPU–CPU trade first) → { state, events }.
export function stepCpu(state) {
  if (state.done || isUserOnClock(state)) return { state, events: [] };
  const events = [];
  let s = state;
  const traded = maybeCpuTrade(s);
  if (traded) { s = traded.state; events.push(traded.event); }
  const choice = chooseCpuPick(s);
  if (!choice?.prospect) return { state: { ...s, done: true }, events };
  const { state: after, event } = makePick(s, choice.prospect.id, choice.seed);
  if (event) events.push(event);
  return { state: after, events };
}

// ── Trades ──

// A team's tradeable picks after the one on the clock, earliest first: the
// sim's own, then its capital (rounds not being drafted).
const futurePicksOf = (state, team) => [
  ...state.picks.filter((p, i) => i > state.idx && p.owner === team && !p.selection),
  ...(state.capital || []).filter((p) => p.owner === team),
];

// The smallest bundle of a team's picks (their earliest first, then the
// best fillers) worth at least `target` — or null if they can't get there.
function bundleFor(state, team, target, maxValue) {
  const own = futurePicksOf(state, team);
  if (!own.length) return null;
  const [lead, ...rest] = own;
  // A deal is built around a pick in this draft; next year's only sweeten.
  if (lead.future) return null;
  const bundle = [lead];
  let total = pickWorth(state, lead);
  // Fill with the smallest pick that closes the gap, else the biggest left.
  const pool = [...rest].sort((a, b) => pickWorth(state, b) - pickWorth(state, a));
  while (total < target && pool.length && bundle.length < MAX_BUNDLE) {
    const gap = target - total;
    const closer = [...pool].reverse().find((p) => pickWorth(state, p) >= gap);
    const add = closer || pool[0];
    bundle.push(add);
    total += pickWorth(state, add);
    pool.splice(pool.indexOf(add), 1);
  }
  if (total < target || total > maxValue) return null;
  return { picks: bundle, total };
}

// How badly `team` wants a prospect that's on the board now (0 = not at all).
function desire(state, team, p, theirPick) {
  const fit = fitFor(p, team) || 0;
  const fitDesire = Math.max(0, (fit - 70) / 30);
  // Someone the board says won't last to their pick.
  const wontLast = p.rank < theirPick ? Math.min(1, (theirPick - p.rank) / 12) : 0;
  const qb = p.Position === "QB" && !(state.teamPos[team]?.QB) ? 0.35 : 0;
  return fitDesire * 0.8 + wontLast * 0.6 + qb;
}

// Teams that would trade up into the pick on the clock, best offer first:
// [{ team, give: [pick], value, ratio, target: prospect }].
export function findTradeUpOffers(state, { max = MAX_OFFERS, threshold = 0.75 } = {}) {
  const pick = currentPick(state);
  if (!pick) return [];
  const target = pickValue(state.chart, pick.overall);
  const top = cpuAvailable(state).slice(0, 8);
  const teams = [...new Set(state.picks.slice(state.idx + 1, state.idx + 1 + TRADE_WINDOW).map((p) => p.owner))]
    .filter((t) => t !== pick.owner && !state.userTeams.includes(t));
  const offers = [];
  teams.forEach((team) => {
    const theirs = futurePicksOf(state, team)[0];
    if (!theirs || theirs.future) return;
    let want = null;
    let wantScore = 0;
    top.forEach((p) => { const d = desire(state, team, p, theirs.overall); if (d > wantScore) { wantScore = d; want = p; } });
    if (!want || wantScore < threshold) return;
    const bundle = bundleFor(state, team, target * TRADE_MIN_RATIO, target * TRADE_MAX_RATIO);
    if (!bundle) return;
    offers.push({ team, give: bundle.picks.map((p) => p.overall), value: bundle.total, ratio: bundle.total / target, target: want, desire: wantScore });
  });
  return offers.sort((a, b) => b.desire - a.desire).slice(0, max);
}

// Swap the pick on the clock to offer.team for their offered picks.
export function acceptOffer(state, offer) {
  const pick = currentPick(state);
  if (!pick) return { state, event: null };
  const from = pick.owner;
  const swap = (p) => (offer.give.includes(p.overall) && !p.selection ? { ...p, owner: from, via: offer.team } : p);
  const picks = state.picks.map((p, i) => (i === state.idx ? { ...p, owner: offer.team, via: from } : swap(p)));
  const capital = (state.capital || []).map(swap);
  const all = [...picks, ...capital];
  const event = {
    type: "trade",
    from, to: offer.team,
    pick: { ...pick },
    give: offer.give.map((o) => all.find((p) => p.overall === o)),
    ratio: offer.ratio,
    target: offer.target,
    userInvolved: state.userTeams.includes(from),
  };
  return { state: { ...state, picks, capital, offers: [] }, event };
}

// Before a CPU pick: sometimes a team behind it trades up for its guy.
function maybeCpuTrade(state) {
  const pick = currentPick(state);
  if (!pick) return null;
  const work = { seed: state.seed };
  const roll = random(work);
  const chance = (CPU_TRADE_CHANCE[pick.round - 1] ?? 0.02) * state.chaos;
  if (roll >= chance) return null;
  const offer = findTradeUpOffers({ ...state, seed: work.seed }, { max: 1, threshold: 0.9 })[0];
  if (!offer) return null;
  return acceptOffer({ ...state, seed: work.seed }, offer);
}

// User's pick on the clock: the trade offers waiting for them.
export function withOffers(state) {
  if (!isUserOnClock(state)) return state;
  return { ...state, offers: findTradeUpOffers(state) };
}

// ── Grades ──

const LETTERS = [[1.0, "A+"], [0.6, "A"], [0.3, "A-"], [0.1, "B+"], [-0.1, "B"], [-0.3, "B-"], [-0.6, "C+"], [-0.9, "C"], [-1.3, "C-"], [-Infinity, "D"]];
export const letterFor = (score) => LETTERS.find(([min]) => score >= min)[1];

// One pick's grade score: board value for the slot plus a little for fit.
export function pickScore(overall, prospect, team) {
  const value = isSpecialist(prospect) ? 0 : Math.max(-2, Math.min(2, (overall - prospect.rank) / (6 + overall * 0.25)));
  const fit = fitFor(prospect, team) || 0;
  return value + (fit >= 70 ? ((fit - 70) / 30) * 0.5 : 0);
}

// A team's draft: [{ pick, prospect, score, letter }] and the overall grade.
export function teamHaul(state, team) {
  const rows = state.picks
    .filter((p) => p.owner === team && p.selection)
    .map((p) => {
      const prospect = state.byId[p.selection];
      const score = pickScore(p.overall, prospect, team);
      return { pick: p, prospect, score, letter: letterFor(score) };
    });
  const avg = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : 0;
  return { team, rows, score: avg, letter: rows.length ? letterFor(avg) : "—" };
}

// ── User-proposed trades ──
// The CPU takes a deal when what it gets is worth at least this much of
// what it gives on the trade chart. Tune once players carry trade value.
export const CPU_ACCEPT_RATIO = 1.05;

// A team's picks that can still change hands: undrafted picks after the one
// on the clock (that one too when the user is on the clock), plus picks in
// rounds the sim isn't drafting. Earliest first.
export function tradeablePicks(state, team, { includeCurrent = false } = {}) {
  return [
    ...state.picks.filter((p, i) => p.owner === team && !p.selection && (i > state.idx || (includeCurrent && i === state.idx))),
    ...(state.capital || []).filter((p) => p.owner === team),
  ];
}

const chartTotal = (state, keys) => keys.reduce((a, k) => a + pickWorth(state, pickByKey(state, k)), 0);

// give: the user's pick numbers going to the partner; get: the partner's
// coming back. → { give, get (chart points), ratio (give / get), accept }.
export function evaluateProposal(state, { give = [], get = [] }) {
  const giveValue = chartTotal(state, give);
  const getValue = chartTotal(state, get);
  const accept = give.length > 0 && get.length > 0 && giveValue >= getValue * CPU_ACCEPT_RATIO;
  return { give: giveValue, get: getValue, ratio: getValue ? giveValue / getValue : 0, accept };
}

// Swap the picks → { state, event } (event null when the CPU says no).
export function applyProposal(state, { team, partner, give = [], get = [] }) {
  const verdict = evaluateProposal(state, { give, get });
  if (!verdict.accept) return { state, event: null, verdict };
  const swap = (p) => {
    if (p.selection) return p;
    if (give.includes(p.overall) && p.owner === team) return { ...p, owner: partner, via: team };
    if (get.includes(p.overall) && p.owner === partner) return { ...p, owner: team, via: partner };
    return p;
  };
  const picks = state.picks.map(swap);
  const capital = (state.capital || []).map(swap);
  const all = [...picks, ...capital];
  const find = (n) => all.find((p) => p.overall === n);
  // Told the way the feed tells any trade: whoever lands the earliest pick
  // "moves up" to it.
  const earliest = Math.min(...give, ...get);
  const userMovesUp = get.includes(earliest);
  const event = {
    type: "trade", proposed: true, userInvolved: true,
    to: userMovesUp ? team : partner, from: userMovesUp ? partner : team,
    pick: find(earliest),
    give: (userMovesUp ? give : get).map(find),
    ratio: userMovesUp ? verdict.ratio : 1 / verdict.ratio,
    target: null,
  };
  return { state: { ...state, picks, capital, offers: [] }, event, verdict };
}
