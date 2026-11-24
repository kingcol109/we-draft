// src/utils/dynastySim/engine.js
//
// The Dynasty Draft Sim (/draftsim/dynasty/{year}): a fantasy rookie draft
// of one class's quarterbacks, running backs, receivers and tight ends.
// Pure — no React, no Firestore. The board is the Draft Sim's community
// board with every other position taken out and the rest renumbered
// (dynastyBoard). Teams are "Team 1" … "Team N" (an even 6–20), snake order
// by default (linear as an option), 1–7 rounds.
//
// A CPU team drafts off its own read of the board — the community rank
// plus seeded noise that widens down the board, like the NFL sim's team
// boards — values quarterbacks a little more (QB_BONUS), and steers away
// from piling up one position (ROOM). No team needs.
import { rngNext } from "../draftSim/engine";

export const DYNASTY_POSITIONS = ["QB", "RB", "WR", "TE"];
export const DYNASTY_YEARS = ["2027", "2028", "2029"];
export const DYNASTY_YEAR = "2027";
export const TEAM_COUNTS = [6, 8, 10, 12, 14, 16, 18, 20];
export const DEFAULT_TEAMS = 12;
export const ROUND_COUNTS = [1, 2, 3, 4, 5, 6, 7];
export const DEFAULT_ROUNDS = 4;

// The class board, skill positions only, renumbered 1…n in the same order.
export function dynastyBoard(board) {
  const seen = {};
  return board
    .filter((p) => DYNASTY_POSITIONS.includes(p.Position))
    .sort((a, b) => a.rank - b.rank)
    .map((p, i) => {
      seen[p.Position] = (seen[p.Position] || 0) + 1;
      return { ...p, rank: i + 1, positionRank: seen[p.Position] };
    });
}

// The most rounds a board this size fills for this many teams.
export const maxRoundsFor = (board, teams) => Math.max(1, Math.min(7, Math.floor(board.length / teams)));

// Every pick, in order: [{ overall, round, slot }] — slot 1…teams.
// Snake reverses every other round; linear doesn't.
export function draftOrder(teams, rounds, snake = true) {
  const picks = [];
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < teams; i++) {
      const slot = snake && r % 2 === 0 ? teams - i : i + 1;
      picks.push({ overall: picks.length + 1, round: r, slot, pickInRound: i + 1 });
    }
  }
  return picks;
}

// "1.04" — the round and the pick in it, the way fantasy drafts say it.
export const pickLabel = (p) => `${p.round}.${String(p.pickInRound).padStart(2, "0")}`;

function gaussian(work) {
  const a = rngNext(work.seed); const b = rngNext(a.seed);
  work.seed = b.seed;
  return Math.sqrt(-2 * Math.log(a.value || 1e-9)) * Math.cos(2 * Math.PI * b.value);
}

// Each CPU team's own board: the community rank plus noise — teams agree
// at the top and less and less further down. { [slot]: { [id]: rank } }.
const SPREAD = (rank) => 1 + 0.12 * rank;
function teamBoards(board, slots, seed) {
  const work = { seed: seed | 0 };
  const out = {};
  slots.forEach((slot) => {
    out[slot] = Object.fromEntries(board.map((p) => [p.id, p.rank + gaussian(work) * SPREAD(p.rank)]));
  });
  return out;
}

export function initDynasty({ board, teams = DEFAULT_TEAMS, rounds = DEFAULT_ROUNDS, snake = true, userSlots = [], seed = Date.now() }) {
  const slots = Array.from({ length: teams }, (_, i) => i + 1);
  return {
    board, teams, rounds, snake, seed: seed | 0,
    picks: draftOrder(teams, rounds, snake).map((p) => ({ ...p, selection: null })),
    userSlots: [...userSlots],
    teamBoards: teamBoards(board, slots.filter((s) => !userSlots.includes(s)), seed),
    byId: Object.fromEntries(board.map((p) => [p.id, p])),
    taken: {},
    idx: 0,
    done: false,
  };
}

export const currentPick = (s) => (s.done ? null : s.picks[s.idx] || null);
export const isUserOnClock = (s) => !!currentPick(s) && s.userSlots.includes(currentPick(s).slot);
export const available = (s) => s.board.filter((p) => !s.taken[p.id]);
// A team's players so far, in the order taken.
export const rosterOf = (s, slot) => s.picks.filter((p) => p.slot === slot && p.selection).map((p) => ({ ...s.byId[p.selection], pick: p }));

// Quarterbacks go a little earlier than the board alone says (spots).
export const QB_BONUS = (rank) => 0.5 + 0.02 * rank;
// Spots added for a player at a position the team already has this many
// of (index = how many it has): a second QB or TE is a luxury, a fourth
// back or receiver too.
const ROOM = { QB: [0, 12, 24, 36], TE: [0, 8, 20, 30], RB: [0, 0, 2, 6, 10], WR: [0, 0, 1, 4, 8] };
const roomCost = (pos, have) => { const r = ROOM[pos] || []; return r[Math.min(have, r.length - 1)] || 0; };

// The CPU's player for the team on the clock (or a suggestion for the
// user's: off the community board, no noise).
export function chooseDynastyPick(s) {
  const pick = currentPick(s);
  if (!pick) return null;
  const own = s.teamBoards[pick.slot];
  const have = {};
  rosterOf(s, pick.slot).forEach((p) => { have[p.Position] = (have[p.Position] || 0) + 1; });
  const work = { seed: (s.seed ^ (pick.overall * 2654435761)) | 0 };
  const pool = available(s).sort((a, b) => (own?.[a.id] ?? a.rank) - (own?.[b.id] ?? b.rank)).slice(0, 14);
  let best = null, bestScore = Infinity;
  pool.forEach((p) => {
    const base = own?.[p.id] ?? p.rank;
    const score = base - (p.Position === "QB" ? QB_BONUS(p.rank) : 0) + roomCost(p.Position, have[p.Position] || 0) + (own ? gaussian(work) * 0.8 : 0);
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return best;
}

export function makeDynastyPick(s, id) {
  const pick = currentPick(s);
  if (!pick || !s.byId[id] || s.taken[id]) return s;
  const picks = s.picks.map((p, i) => (i === s.idx ? { ...p, selection: id } : p));
  const idx = s.idx + 1;
  return { ...s, picks, taken: { ...s.taken, [id]: true }, idx, done: idx >= picks.length || available({ ...s, taken: { ...s.taken, [id]: true } }).length === 0 };
}

// CPU picks until a user team is on the clock (or the draft's over).
export function simToUser(s) {
  let st = s;
  while (!st.done && !isUserOnClock(st)) {
    const p = chooseDynastyPick(st);
    if (!p) return { ...st, done: true };
    st = makeDynastyPick(st, p.id);
  }
  return st;
}

// ── On the Draft Sim's broadcast ──
// The dynasty draft runs through the Draft Sim's own engine and broadcast
// (utils/draftSim/engine.js initSim + components/draftSim/SimBroadcast):
// teams "Team 1"…"Team N", no trades, no needs, grades on value alone, and this CPU pick
// rule (initSim chooser). The engine's MUST_PICKS still come first — a CPU
// team on the clock with Jeremiah Smith there takes him (2027: No. 1).

// Each team's own read of the board (the engine's team boards), quarterbacks
// a little earlier, a crowded position a little later, a touch of noise —
// none for the user's own Sim Pick.
const hashSeed = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
};
export function dynastyChooser(state, pick) {
  const team = pick.owner;
  const have = {};
  state.picks.forEach((p) => { if (p.owner === team && p.selection) { const pos = state.byId[p.selection]?.Position; have[pos] = (have[pos] || 0) + 1; } });
  const cpu = !state.userTeams.includes(team);
  // The team's own read: the board rank plus noise that's the same for this
  // team and player all draft long (not the NFL sim's team boards, which
  // spread ungraded Expanded Board players far too wide for this).
  const own = (p) => (cpu ? p.rank + gaussian({ seed: hashSeed(`${state.seed}|${team}|${p.id}`) }) * SPREAD(p.rank) : p.rank);
  const work = { seed: (state.seed ^ Math.imul(pick.overall, 2654435761)) | 0 };
  let best = null, bestScore = Infinity;
  state.board.filter((p) => !state.taken[p.id]).sort((a, b) => own(a) - own(b)).slice(0, 14).forEach((p) => {
    const score = own(p) - (p.Position === "QB" ? QB_BONUS(p.rank) : 0) + roomCost(p.Position, have[p.Position] || 0) + (cpu ? gaussian(work) * 0.8 : 0);
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return best;
}

// Twenty team looks: [primary, secondary].
const TEAM_COLORS = [
  ["#c8102e", "#ffb612"], ["#0b3d91", "#a5acaf"], ["#203731", "#ffb612"], ["#4f2683", "#ffc62f"], ["#fb4f14", "#101820"],
  ["#00338d", "#c60c30"], ["#006778", "#d7a22a"], ["#a71930", "#000000"], ["#002244", "#69be28"], ["#241773", "#9e7c0c"],
  ["#0085ca", "#101820"], ["#e31837", "#ffb81c"], ["#125740", "#ffffff"], ["#97233f", "#ffb612"], ["#002c5f", "#a2aaad"],
  ["#311d00", "#ff3c00"], ["#aa0000", "#b3995d"], ["#0076b6", "#b0b7bc"], ["#008e97", "#fc4c02"], ["#5a1414", "#d3bc8d"],
];
// A team's badge: its number on its colors (an SVG data URI, so it works as any logo does).
function badge(n, c1, c2) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="${c1}" stroke="${c2}" stroke-width="9"/><text x="60" y="60" dy="0.35em" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${n >= 10 ? 50 : 62}" fill="#ffffff">${n}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
// A team's code is its name ("Team 4"), so every label the sim prints —
// "PICK 4 · Team 4", "via Team 1", the ticker — reads as one.
export const dynastyTeam = (slot) => `Team ${slot}`;
export function dynastyBranding(teams) {
  return Object.fromEntries(Array.from({ length: teams }, (_, i) => {
    const [c1, c2] = TEAM_COLORS[i % TEAM_COLORS.length];
    const logo = badge(i + 1, c1, c2);
    return [dynastyTeam(i + 1), { City: "", Team: `Team ${i + 1}`, Color1: c1, Color2: c2, Logo1: logo, LogoDark: logo }];
  }));
}

// The sim's data (what useDraftSim / SimBroadcast read) for one dynasty
// draft. base: the class's loadSimData (season, for the cards); board: the
// dynasty board (dynastyBoard of the Expanded Board).
// owners: the setup grid's changes — { [overall]: slot } for a pick moved
// to another team (it's drafted "via" its original team, as a traded pick is).
export function dynastySimData(base, board, { year, teams, rounds, snake, owners = {} }) {
  const order = draftOrder(teams, rounds, snake).map((p) => {
    const to = owners[p.overall];
    return { Pick: p.overall, Round: p.round, Team: dynastyTeam(p.slot), Traded: to && to !== p.slot ? dynastyTeam(to) : null };
  });
  return {
    year, season: base?.season ?? null, board, order, futureOrder: [], futureYear: null,
    branding: dynastyBranding(teams), staff: {}, needs: {}, chart: {}, history: null, stars: {},
    qbTeams: null, posRules: null, noTrades: true, chooser: dynastyChooser, gradeByValue: true,
    dynasty: { teams, rounds, snake },
    // The desk: We-Draft.com, plus the voices that work for fantasy (no NFL history or staffs).
    deskOnly: ["isaac", "makali", "davin", "pp"],
  };
}
