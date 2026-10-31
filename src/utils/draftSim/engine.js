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
//   × how NFL teams value the position at that spot (positionValue — at
//     the same grade, first-round QBs and EDGEs go earlier, LBs and TEs
//     slide; measured from the last 10 real drafts, positionHistory.json)
//   + a nudge when the position almost never goes this early (earlyNudge)
//   − the team's staff fit (compSnapshots/nflFit_{Position}: how closely
//     the prospect matches what this GM/HC/OC/DC have drafted before —
//     the "coach tendencies"), worth more spots the later the pick
//   + a penalty for doubling up at a position already taken this draft
//     (by need key — CB and S, OT, G and C count separately)
//   − the team's needs (needPull: nflTeamNeeds' labels by position — an
//     Upgrade Needed pulls hardest, a Crowded Room pushes away; a need
//     stops pulling once the team's drafted for it). Weighed by how big a
//     deal the position is (NEED_TIERS: QB, then EDGE / OT, then WR, CB,
//     S, IDL, G, C, LB, then RB / TE), starter needs fading by round
//     (nobody drafts a 4th-rounder to start); a QB need only toward a QB
//     the team rates, and a team that badly needs one trades up for him
//   + noise (seeded, so a sim replays exactly from its seed)
// and the lowest effective rank is the pick.
//
// Trades (findTradeUpOffers / maybeCpuTrade) are pick-for-pick on the site's
// trade chart (config/draftTradeChart), driven by how much teams love the
// players on the board (love: value at the pick, needs, staff fit). A team
// that loves its options asks more to move off its pick — past a point, no
// package will do; a team behind it that loves someone the team on the
// clock doesn't is the one that calls. How often a deal happens comes from
// that gap, not a script.

import HISTORY from "./positionHistory.json";

export const SIM_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
// Kickers and punters sit at the bottom of the board (no one else's rank
// moves) and a pick of one is graded and reported as neither value nor
// reach. Community grades barely cover them, so a CPU team values one by
// where real drafts have taken the 1st, 2nd … of them (specialistRank) —
// never before the earliest one went in the last 10 drafts.
export const SPECIALISTS = ["K", "P"];
export const isSpecialist = (p) => SPECIALISTS.includes(p?.Position);

// ── Position value, from real drafts (scripts/buildPositionHistory.mjs) ──
// Factors, not rules: each sits next to the board, staff fit and noise, so
// a WR who's clearly the best player can still go first overall.
// A tier's measured ratio is pulled toward 1 by its sample size — n
// graded picks count against VALUE_SHRINK made-up neutral ones.
const VALUE_SHRINK = 20;
// The "unusually early" nudge, against this many made-up typical picks.
const EARLY_PRIOR = 3;
const HISTORY_YEARS = HISTORY.years[1] - HISTORY.years[0] + 1;
const HISTORY_TOTAL = Object.values(HISTORY.picks).reduce((t, a) => t + a.length, 0);

// × board rank: how much earlier (<1) or later (>1) teams take this
// position than a player graded at that spot. Interpolated between grade
// tiers on a log scale, flat past the last one. It fades to 1 at the top
// of the board — no one can go earlier than first overall, so a QB's
// first-round premium can't make the No. 3 player a No. 1.6.
export function positionValue(pos, rank) {
  const measured = (HISTORY.value[pos] || []).map((t) => ({ x: Math.log(t.at), y: Math.log(t.ratio) * (t.n / (t.n + VALUE_SHRINK)) }));
  if (!measured.length) return 1;
  const tiers = [{ x: 0, y: 0 }, ...measured];
  const x = Math.log(Math.max(1, rank));
  if (x <= tiers[0].x) return Math.exp(tiers[0].y);
  for (let i = 1; i < tiers.length; i++) {
    if (x <= tiers[i].x) {
      const f = (x - tiers[i - 1].x) / (tiers[i].x - tiers[i - 1].x);
      return Math.exp(tiers[i - 1].y + f * (tiers[i].y - tiers[i - 1].y));
    }
  }
  return Math.exp(tiers[tiers.length - 1].y);
}

// Spots added when a position has gone this early less often than its
// share of all picks would say — in units of the pick's own noise, and
// only ever a penalty. WRs at No. 1 barely register; a TE or RB in the
// top 5 a little more; a kicker in round 2 a lot.
export function earlyNudge(pos, overall) {
  const all = HISTORY.picks[pos];
  if (!all) return 0;
  const seen = all.filter((n) => n <= overall).length;
  const expected = (all.length / HISTORY_TOTAL) * overall * HISTORY_YEARS;
  return Math.max(0, -Math.log((seen + EARLY_PRIOR) / (expected + EARLY_PRIOR))) * (2.5 + 0.1 * overall);
}

// A specialist's stand-in board rank: where the next one of its position
// usually goes (the 1st kicker taken, the 2nd …), Infinity once real
// drafts rarely take that many, or before the earliest one ever went.
function specialistRank(state, pos, overall) {
  const h = HISTORY.specialists[pos];
  if (!h || overall < h.earliest) return Infinity;
  const taken = state.picks.filter((p) => p.selection && state.byId[p.selection]?.Position === pos).length;
  return h.slots[taken] ?? Infinity;
}

// ── Team needs ──
// nflTeamNeeds/{team}.needs — the admin's labels per position (Admin →
// Mock Draft → Team Needs, with suggestions from utils/
// teamNeedSuggestions.js) — as { [team]: { [NEED_KEY]: { labels, note } } };
// see resolveNeeds. Labels read the way a fan would say it; most to least
// urgent. MANUAL_LABELS are only ever set by hand, never suggested:
// Expiring Contract (no contract data). Set is neutral, not "not
// interested" — board value and staff fit still drive those picks.
export const NEED_LABELS = ["Upgrade Needed", "Expiring Contract", "Aging Talent", "Upgrade Wanted", "Depth Needed", "Set", "Crowded Room"];
export const MANUAL_LABELS = ["Expiring Contract"];
// OL and DB are split, so a team that needs a corner doesn't get a safety
// (or one that needs a center, a tackle).
export const NEED_KEYS = ["QB", "RB", "WR", "TE", "OT", "G", "C", "IDL", "EDGE", "LB", "CB", "S"];
// Roles: a job within a position (3rd Down RB, Slot Corner…), labeled like
// any position and listed under its parent (`parent`). Each pulls
// ROLE_WEIGHT as hard as the same label at a position — one share for every
// role, so a nose tackle stands to the interior line as a slot corner does
// to the corners. A prospect at one of `pos` (draft positions) fills one
// when the admin's given him the role (his Roles — Admin → Players → Data
// Management → Roles; roleFit); an NFL player in one of `groups` (Admin →
// Research's position groups) can be tagged with it. A role can reach past
// its parent — any DB can be a safety, a slot corner or a sub linebacker,
// an edge rusher an interior pass rusher or run stopper. `word` is how the
// analysts say it; `phrase`, the player it describes in a sentence ("a
// tight end who can help in the run game" — the mock's pick notes, where
// "a blocking tight end" reads like a label).
export const ROLES = [
  { key: "RB3", name: "3rd Down RB", word: "third-down back", phrase: "a back who can handle third downs", parent: "RB", pos: ["RB"], groups: ["RB"] },
  { key: "SLOTWR", name: "Slot WR", word: "slot receiver", phrase: "a receiver who can work out of the slot", parent: "WR", pos: ["WR"], groups: ["WR"] },
  { key: "BIGWR", name: "WR Size", word: "big-bodied receiver", phrase: "a bigger receiver who can win on the outside", parent: "WR", pos: ["WR"], groups: ["WR"] },
  { key: "DEEPWR", name: "Field Stretching WR", word: "deep threat", phrase: "a receiver who can stretch the field", parent: "WR", pos: ["WR"], groups: ["WR"] },
  { key: "BLOCKTE", name: "Blocking TE", word: "blocking tight end", phrase: "a tight end who can help in the run game", parent: "TE", pos: ["TE"], groups: ["TE"] },
  { key: "RUSHEDGE", name: "Pass Rushing EDGE", word: "pass rusher", phrase: "an edge rusher who can get after the quarterback", parent: "EDGE", pos: ["EDGE"], groups: ["EDGE"] },
  { key: "RUSHDL", name: "Pass Rushing DL", word: "interior pass rusher", phrase: "an interior lineman who can push the pocket", parent: "IDL", pos: ["DL", "EDGE"], groups: ["IDL", "EDGE"] },
  { key: "RUNDL", name: "Run Stopping DL", word: "run stopper", phrase: "a defensive lineman who can stop the run", parent: "IDL", pos: ["DL", "EDGE"], groups: ["IDL", "EDGE"] },
  { key: "NOSE", name: "Nose Tackle", word: "nose tackle", phrase: "a nose tackle who can anchor the middle", parent: "IDL", pos: ["DL"], groups: ["IDL"] },
  { key: "SUBLB", name: "Sub LB", word: "coverage linebacker", phrase: "a linebacker who can hold up in coverage", parent: "LB", pos: ["LB", "DB"], groups: ["LB", "CB", "S"] },
  { key: "SS", name: "Strong Safety", word: "strong safety", phrase: "a safety who can play near the line", parent: "S", pos: ["DB"], groups: ["CB", "S"] },
  { key: "FS", name: "Free Safety", word: "free safety", phrase: "a safety who can play center field", parent: "S", pos: ["DB"], groups: ["CB", "S"] },
  { key: "SLOTCB", name: "Slot Corner", word: "slot corner", phrase: "a corner who can cover the slot", parent: "CB", pos: ["DB"], groups: ["CB", "S"] },
];
export const ROLE_BY_KEY = Object.fromEntries(ROLES.map((r) => [r.key, r]));
// A role need as a sentence says it ("a tight end who can help in the run game"), or "" for a position.
export const rolePhrase = (key) => ROLE_BY_KEY[key]?.phrase || "";
export const ROLE_WEIGHT = 0.6;
export const NEED_KEY_NAMES = {
  QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OT: "Offensive Tackle", G: "Guard", C: "Center",
  IDL: "Interior D-Line", EDGE: "Edge Rusher", LB: "Linebacker", CB: "Cornerback", S: "Safety",
  ...Object.fromEntries(ROLES.map((r) => [r.key, r.name])),
};
// In the draft itself guards and centers are one need, the interior line —
// kept apart underneath (a team can need both; one pick fills one), but
// named, said and listed together: needGroup / needName / needWord.
const INTERIOR = ["G", "C"];
export const needGroup = (key) => (INTERIOR.includes(key) ? "IOL" : key);
export const needName = (key) => (needGroup(key) === "IOL" ? "Interior O-Line" : NEED_KEY_NAMES[key] || key);
// How the analysts say a need ("cornerback", "slot corner").
export const needWord = (key) => ROLE_BY_KEY[key]?.word || (needGroup(key) === "IOL" ? "interior lineman" : (NEED_KEY_NAMES[key] || key).toLowerCase());

// The interior line was one need (IOL) before guards and centers split;
// a team's stored IOL label counts for both until it's saved again.
const LEGACY_KEYS = { IOL: ["G", "C"] };

// One team's stored needs → { [key]: { labels, note } }: known positions,
// roles and labels only, Set when a position has none.
export function resolveNeeds(needs = {}) {
  const out = {};
  const put = (key, n) => {
    const labels = (n.labels || []).filter((l) => NEED_LABELS.includes(l));
    out[key] = { labels: labels.length ? labels : ["Set"], note: n.note || "" };
  };
  Object.entries(needs || {}).forEach(([key, n]) => {
    if (!n || typeof n !== "object") return;
    if (LEGACY_KEYS[key]) LEGACY_KEYS[key].forEach((k) => { if (!needs[k]) put(k, n); });
    else if (NEED_KEYS.includes(key) || ROLE_BY_KEY[key]) put(key, n);
  });
  return out;
}

// A prospect's sub-positions (subPosition — OT / G / C, CB / S): one, or
// several for a player who plays more than one ("OT" or ["G", "C"]). An
// old "IOL" is a guard or a center.
const SUB_POSITIONS = { OL: ["OT", "G", "C"], DB: ["CB", "S"] };
export function subsOf(p) {
  const all = SUB_POSITIONS[p?.Position];
  if (!all) return [];
  const sp = (Array.isArray(p.subPosition) ? p.subPosition : [p.subPosition]).flatMap((x) => LEGACY_KEYS[x] || [x]);
  return all.filter((s) => sp.includes(s));
}

// The need(s) a prospect fills: [{ key, share }]. An OL or DB with one
// sub-position fills it; with several (`flex` — he plays any of them) they
// share him; with none, every one of the position's does.
export function needKeysFor(p) {
  if (!p || isSpecialist(p)) return [];
  const all = SUB_POSITIONS[p.Position];
  if (all) {
    const subs = subsOf(p);
    if (subs.length === 1) return [{ key: subs[0], share: 1 }];
    const keys = subs.length ? subs : all;
    return keys.map((key) => ({ key, share: 1 / keys.length, ...(subs.length > 1 ? { flex: true } : {}) }));
  }
  if (p.Position === "DL") return [{ key: "IDL", share: 1 }];
  return [{ key: p.Position, share: 1 }];
}

// How much one label makes a team want a prospect at this pick (1 = the
// most; negative pushes away). Factors like the rest: effectiveRank turns
// it into spots, more of them the later the pick.
function labelPull(label, key, p, overall) {
  switch (label) {
    case "Upgrade Needed": return 1;
    case "Expiring Contract": return 0.6;
    // Drafting the next one — teams do it early at QB.
    case "Aging Talent": return key === "QB" ? 0.8 : 0.45;
    // Only for a clear upgrade: a prospect the board has at or above the pick.
    case "Upgrade Wanted": return p.rank <= overall ? 0.5 : 0.2;
    // Backups are a mid/late-round thing — nothing at the top of round 1.
    case "Depth Needed": return 0.4 * Math.min(1, overall / 100);
    case "Crowded Room": return -0.6;
    default: return 0;
  }
}

// The needs a pick fills: [{ key, share }] (needKeysFor) — but one who could
// fill several (an interior lineman, a corner-safety, an OL or DB with no
// sub-position) fills the need he was taken for (need: makePick's) in
// full, and nothing else.
export function fillsFor(prospect, need) {
  const keys = needKeysFor(prospect);
  return keys.length > 1 && need && keys.some((k) => k.key === need.key) ? [{ key: need.key, share: 1 }] : keys;
}

// A prospect's roles (the admin's — data.js roles): [role key].
export const rolesOf = (p) => (Array.isArray(p?.roles) ? p.roles : []);
// Whether a prospect fills a role: 1 when the admin's given it to him (at
// one of the role's positions), else 0.
export function roleFit(role, p) {
  return role && role.pos.includes(p?.Position) && rolesOf(p).includes(role.key) ? 1 : 0;
}
// The roles open to a prospect's position / an NFL player's group.
export const rolesFor = (pos) => ROLES.filter((r) => r.pos.includes(pos));
export const rolesForGroup = (group) => ROLES.filter((r) => r.groups.includes(group));
const rolesAt = (p) => rolesFor(p?.Position);

// How big a deal a need at each position is, most to least: a hole at
// tackle matters more than one at running back. × the need's pull.
export const NEED_TIERS = [["QB"], ["EDGE", "OT"], ["WR", "CB", "S", "IDL", "G", "C", "LB"], ["RB", "TE"]];
const TIER_WEIGHT = [1.4, 1.2, 1, 0.75];
export const needWeight = (key) => TIER_WEIGHT[NEED_TIERS.findIndex((t) => t.includes(key))] ?? 1;
// Teams draft starters early: how much a starter need (Upgrade Needed /
// Wanted, Expiring Contract, Aging Talent) still drives a pick, by round —
// still there on Day 3, but nobody takes a 4th-rounder expecting a
// starter. Depth Needed goes the other way (labelPull).
const STARTER_NEED_BY_ROUND = [1, 0.9, 0.7, 0.5, 0.4, 0.35, 0.3];
const roundAt = (state, overall) => (currentPick(state)?.overall === overall ? currentPick(state).round : state.picks.find((x) => x.overall === overall)?.round) || Math.min(7, Math.ceil(overall / 32));
// A quarterback need only pulls toward one the team's own board rates near
// the pick: in full within QB_SLACK spots past it, gone at twice that.
// A team that badly needs a QB still won't reach for one it doesn't like.
const QB_SLACK = (overall) => 6 + 0.25 * overall;
function qbGate(state, team, p, overall) {
  const past = teamRank(state, team, p) - overall - QB_SLACK(overall);
  return Math.max(0, Math.min(1, 1 - past / QB_SLACK(overall)));
}

// A team's pull toward a prospect from its needs: the strongest label that
// wants him — at his position, or (at ROLE_WEIGHT) a role of his — fading
// once the team's drafted for it (state.needFilled), weighed by how big a
// deal the position is (needWeight — a role by its parent's) and, for a
// starter need, by the round (STARTER_NEED_BY_ROUND). A quarterback need
// pulls only toward one the team rates (qbGate). A Crowded Room only
// counts when nothing wants him. One who plays several sub-positions
// (flex) pulls in full toward whichever the team wants most.
export function needPull(state, team, p, overall) {
  const needs = state.needs?.[team];
  if (!needs) return 0;
  const filledOf = (key) => state.needFilled?.[team]?.[key] || 0;
  const keys = needKeysFor(p);
  const byRound = STARTER_NEED_BY_ROUND[roundAt(state, overall) - 1] ?? STARTER_NEED_BY_ROUND[6];
  const want = (labels, key) => Math.max(0, ...labels.map((l) => labelPull(l, key, p, overall) * (URGENT.includes(l) ? byRound : 1)))
    * needWeight(key) * (key === "QB" ? qbGate(state, team, p, overall) : 1);
  const pullAt = (key) => {
    const n = needs[key];
    if (!n) return 0;
    const w = want(n.labels, key);
    return w > 0 ? w * Math.max(0, 1 - filledOf(key)) : Math.min(0, ...n.labels.map((l) => labelPull(l, key, p, overall)));
  };
  const halves = keys.reduce((total, { key, share }) => total + share * pullAt(key), 0);
  const best = keys[0]?.flex ? Math.max(...keys.map(({ key }) => pullAt(key))) : 0;
  const position = best > 0 ? best : halves;
  const role = Math.max(0, ...rolesAt(p).map((r) => {
    const n = needs[r.key];
    const fit = n ? roleFit(r, p) : 0;
    if (!fit) return 0;
    return want(n.labels, r.parent) * fit * ROLE_WEIGHT * Math.max(0, 1 - filledOf(r.key));
  }));
  return role > 0 && role > position ? role : position;
}

// Premium capital: picks in rounds 1–PREMIUM_ROUNDS (1–QB_PREMIUM_ROUNDS
// for a quarterback into a full room — qbRoomPenalty). A team never spends
// one (1–PREMIUM_ROUNDS, a backup QB too) on a position it's only looking
// for depth at — Depth Needed and nothing more urgent there (an OL / DB
// with no sub-position only when every one of them is), and no more
// urgent role of his. A backup QB is a Day 2–3 pick, spread through those
// rounds, not one all the depth-needy teams make at once in round 5.
export const PREMIUM_ROUNDS = 2;
export const QB_PREMIUM_ROUNDS = 4;
const depthOnlyAt = (n) => !!n?.labels.includes("Depth Needed") && !n.labels.some((l) => URGENT.includes(l));
export function depthOnly(state, team, p) {
  const needs = state.needs?.[team];
  if (!needs) return false;
  const keys = needKeysFor(p);
  if (!keys.length || !keys.every(({ key }) => depthOnlyAt(needs[key]))) return false;
  return !rolesAt(p).some((r) => needs[r.key]?.labels.some((l) => URGENT.includes(l)) && roleFit(r, p));
}
const isPremium = (round, p) => round != null && round <= (p?.Position === "QB" ? QB_PREMIUM_ROUNDS : PREMIUM_ROUNDS);

// A team with its QB room filled in (Set, Crowded Room — or no QB label
// when it has needs entered at all) takes a quarterback with premium
// capital only when he's too good to pass up: this many spots on top,
// more the later the pick, half again for a crowded room. Past premium
// capital it eases (QB_ROOM_LATE of it) rather than vanishing — a team
// set at QB doesn't spend its 5th-rounder on one just because it can.
const qbRoomFull = (state, team) => {
  const needs = state.needs?.[team];
  if (!needs || !Object.keys(needs).length) return false;
  const labels = needs.QB?.labels || [];
  return !labels.some((l) => URGENT.includes(l) || l === "Depth Needed");
};
const QB_ROOM_LATE = 0.4;
function qbRoomPenalty(state, team, p, overall, round) {
  if (p.Position !== "QB" || round == null || !qbRoomFull(state, team) || state.qbTeams?.includes(team)) return 0;
  const spots = (18 + 0.6 * overall) * (isPremium(round, p) ? 1 : QB_ROOM_LATE);
  return state.needs[team].QB?.labels.includes("Crowded Room") ? spots * 1.5 : spots;
}

// The roles a prospect fills: [{ key, fit }].
export const roleFits = (p) => rolesAt(p).map((r) => ({ key: r.key, fit: roleFit(r, p) })).filter((x) => x.fit > 0);

export function needFor(state, team, p) {
  const open = (key, label) => label && (label === "Crowded Room" || (state.needFilled?.[team]?.[key] || 0) < 1);
  const top = (n) => NEED_LABELS.find((l) => l !== "Set" && n.labels.includes(l));
  let best = null;
  needKeysFor(p).sort((a, c) => c.share - a.share).some(({ key }) => {
    const n = state.needs?.[team]?.[key];
    const label = n && top(n);
    if (open(key, label)) best = { key, label, note: n.note || "" };
    return !!best;
  });
  // A role of his wins when it's at least as urgent.
  roleFits(p).forEach(({ key }) => {
    const n = state.needs?.[team]?.[key];
    const label = n && top(n);
    if (!open(key, label) || label === "Crowded Room") return;
    if (!best || best.label === "Crowded Room" || NEED_LABELS.indexOf(label) <= NEED_LABELS.indexOf(best.label)) best = { key, label, note: n.note || "" };
  });
  return best;
}

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
// Per-pick chance two CPU teams make a deal anyway, by round (index 0 =
// round 1) — on top of the chance the love gap adds (TRADE_GAP_*).
const CPU_TRADE_CHANCE = [0.05, 0.035, 0.025, 0.02, 0.015, 0.015, 0.015];
// A love gap (caller's desire − owner's love) past TRADE_GAP_START adds
// TRADE_GAP_RATE of chance per point, up to TRADE_GAP_MAX in all.
const TRADE_GAP_START = 0.2;
const TRADE_GAP_RATE = 0.45;
const TRADE_GAP_MAX = 0.55;
// What a team asks on top of the chart to move off a pick, per point of
// love for its best option there — enough love and no deal clears it.
const ATTACHMENT_PREMIUM = 0.25;
// …and the other way: a team that likes no one at its pick (its best
// option's love under LOW_LOVE) takes up to DISLIKE_DISCOUNT under the
// chart to move back, and shops the pick — callers who only fairly want
// someone get a hearing (TRADE_BACK_THRESHOLD of the usual bar) and a deal
// is likelier (up to TRADE_BACK_CHANCE more).
// (Teams' best love on the clock runs ~0.6 at the median; under 0.5 is
// the bottom 10–20% of picks.)
const LOW_LOVE = 0.5;
const DISLIKE_DISCOUNT = 0.15;
const TRADE_BACK_THRESHOLD = 0.7;
const TRADE_BACK_CHANCE = 0.3;
// How little the team on the clock likes its options: 0 (it likes someone)
// to 1 (no one at all).
const dislike = (love) => Math.max(0, LOW_LOVE - love) / LOW_LOVE;
// What a team asks, as a multiple of the chart, to move off a pick it
// loves its options at this much (love; null — not the pick on the clock,
// so no read on it — the chart as is): more for a player it loves, less
// when it likes no one.
export const askRatio = (base, love) => (love == null ? base : base + ATTACHMENT_PREMIUM * love - DISLIKE_DISCOUNT * dislike(love));
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
export const FUTURE_DISCOUNT = 0.85;
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
// "No. 7", or "2028 R1" for next year's.
export const pickName = (p) => (p?.future ? `${p.year} R${p.round}` : `No. ${p?.overall}`);
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
// gradeSpread: carry each prospect's grade spread (gradeSd) for his team
// boards (classes in GRADE_SPREAD_CLASSES — see buildTeamBoards).
export function buildBoard(prospects, grades = {}, fits = {}, stats = {}, { gradeSpread = false } = {}) {
  const split = (v) => (v ? String(v).split("|").filter(Boolean) : []);
  const rows = prospects.map((p) => {
    const g = grades[p.id];
    const teamFits = {};
    (fits[p.id] || []).forEach((f) => { teamFits[f.a] = f; });
    const bestFit = Math.max(0, ...(fits[p.id] || []).map((f) => f.s || 0));
    return {
      ...p, cr: p.cr ?? null, avg: g ? g[0] : null, count: g ? g[1] || 0 : 0,
      ...(gradeSpread && g?.[4] != null ? { gradeSd: g[4] } : {}),
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

// The user's own board ("My Board" on the setup screen): their grades
// (myGrades: { [playerId]: 1 … 10 }) replace the community's, and the board
// is re-ranked by grade — a player they haven't graded keeps the community
// grade. Ranked the way the class rank is (the rounded grade, so the same
// buckets), ties in board order, so with no grades of theirs the board
// comes back unchanged. Strengths, weaknesses and the evaluation count stay
// the community's; graded players get mine: true.
export function applyMyGrades(board, myGrades = {}) {
  // (The class rank is weekly and the grades aren't, so a re-rank alone
  // could still shuffle a board none of whose players they've graded.)
  if (!board.some((p) => myGrades[p.id] != null)) return board;
  const rows = board.map((p) => (myGrades[p.id] != null ? { ...p, avg: myGrades[p.id], mine: true } : p));
  const key = (p) => (p.avg == null ? null : Math.round(p.avg));
  rows.sort((a, b) => {
    if (isSpecialist(a) !== isSpecialist(b)) return isSpecialist(a) ? 1 : -1;
    const ak = key(a), bk = key(b);
    if (ak != null && bk != null && ak !== bk) return ak - bk;
    if (ak != null && bk == null) return -1;
    if (ak == null && bk != null) return 1;
    return a.rank - b.rank;
  });
  const seen = {};
  return rows.map((p, i) => {
    seen[p.Position] = (seen[p.Position] || 0) + 1;
    return { ...p, rank: i + 1, positionRank: seen[p.Position] };
  });
}

// ── Team boards ──
// Every team's own read of the community board, drawn once per sim: each
// prospect's community rank plus a seeded random spread (standard
// deviation, in board spots) that widens down the board — teams agree on
// the top 15, disagree more and more after that — most of all past the
// top 60, where real boards split the widest. Re-ranked into the team's
// own 1…N. CPU teams pick off their own board; everything graded (board
// rank, value / reach, the desk, draft grades) stays on the community's.
// Specialists keep their community spot. chaos 0 → no spread.
// For a class in GRADE_SPREAD_CLASSES, a prospect with GRADE_SPREAD_MIN or
// more counted grades (round grades — no Watchlist — that count for his
// class) has his spread scaled by how much they disagree (gradeSd, the
// _grades snapshot): gradeSd / TYPICAL_GRADE_SD, held to ½ … 2× — a
// consensus guy moves less, a polarizing one more.
export const BOARD_SPREAD = [[15, 1], [50, 6], [60, 11], [100, 16], [150, 25], [Infinity, 36]];
export const boardSpread = (rank) => BOARD_SPREAD.find(([upTo]) => rank <= upTo)[1];
// The setup screen's Board Variance, in the order it shows them: how far
// CPU teams' boards (and each pick's own noise) stray from the community's.
// Normal is the spread above; None, every team drafts straight off it.
// Separate from CPU Trades.
export const VARIANCE = {
  none: { label: "None", scale: 0, note: "Every CPU team drafts straight off the board, by its needs and staff — no randomness in its picks." },
  less: { label: "Less", scale: 0.5, note: "Teams mostly agree with the board — fewer surprises." },
  normal: { label: "Normal", scale: 1, note: "Teams agree at the top and disagree more further down, like a real draft." },
  more: { label: "More", scale: 1.6, note: "Every war room has its own board — expect plenty of surprises." },
};
export const DEFAULT_VARIANCE = "normal";
const varianceScale = (key) => VARIANCE[key]?.scale ?? 1;
export const GRADE_SPREAD_CLASSES = ["2027"];
export const GRADE_SPREAD_MIN = 5;
const TYPICAL_GRADE_SD = 0.8;
export const gradeSpreadFactor = (p) => (p.gradeSd != null && (p.count || 0) >= GRADE_SPREAD_MIN
  ? Math.min(2, Math.max(0.5, p.gradeSd / TYPICAL_GRADE_SD)) : 1);
const teamSeed = (seed, team) => [...team].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), seed ^ 0x811c9dc5) | 0;
export function buildTeamBoards(board, teams, seed, chaos = 1) {
  if (!chaos) return {};
  const players = board.filter((p) => !isSpecialist(p));
  return Object.fromEntries(teams.map((team) => {
    const work = { seed: teamSeed(seed, team) };
    const scored = players.map((p) => ({ id: p.id, s: p.rank + gaussian(work) * boardSpread(p.rank) * gradeSpreadFactor(p) * chaos }));
    scored.sort((a, b) => a.s - b.s);
    return [team, Object.fromEntries(scored.map((x, i) => [x.id, i + 1]))];
  }));
}
// Where a team has a prospect on its own board (the community rank without
// one — every user team).
export const teamRank = (state, team, p) => state.teamBoards?.[team]?.[p.id] ?? p.rank;

// ── Draft order ──
// A team map ({ [team]: team }) relabels the order: every team takes over
// another team's whole set of picks — round 1 slot, the rounds after it
// and any picks traded in or out — so the order's shape (comp picks,
// trades) stays real while who sits where changes. Needs and staff stay
// with the team. The setup screen's Randomize (a new map each run) and
// Custom (one the user builds by swapping teams) both come through here.
export const orderTeams = (order) => [...new Set(order.flatMap((p) => [p.Team, p.Traded]).filter(Boolean))].sort();
export function relabelOrder(order, to = {}) {
  return order.map((p) => ({ ...p, Team: to[p.Team] || p.Team, ...(p.Traded ? { Traded: to[p.Traded] || p.Traded } : {}) }));
}
// A random team map (seeded).
export function randomTeamMap(order, seed) {
  const teams = orderTeams(order);
  const work = { seed };
  const shuffled = [...teams];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random(work) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Object.fromEntries(teams.map((t, i) => [t, shuffled[i]]));
}
export const shuffleOrder = (order, seed) => relabelOrder(order, randomTeamMap(order, seed));
// Teams a and b trade places in a map: each takes the other's picks.
export function swapTeams(to, a, b) {
  const next = { ...to };
  const keyOf = (t) => Object.keys(next).find((k) => (next[k] || k) === t) || t;
  const ka = keyOf(a);
  const kb = keyOf(b);
  next[ka] = b;
  next[kb] = a;
  return next;
}

// ── Sim state ──
// order: [{ Pick, Round, Team, Traded }] (fetchDraft's picks).
// futureOrder / futureYear: next year's draft (same shape), traded as
// capital at FUTURE_DISCOUNT.
// cpuTrades: how often CPU teams trade with each other (CPU_TRADES key).
// qbTeams: the only CPU teams that take a quarterback — one each, with no
// "room is full" penalty for it (qbRoomPenalty) — the Weekly Mock's next
// class (weeklyMock.js qbEligibleTeams). null: every team, as usual.
// posRules: the positions each CPU team may take, by round, and never one
// twice — the Weekly Mock's next class too (weeklyMock.js nextYearRules;
// byPosRules). null: no such rules.
// variance: how far their boards and picks stray (VARIANCE key).
export function initSim({ order, board, chart = {}, userTeams = [], rounds = 1, seed = Date.now(), chaos = 1, staff = {}, needs = {}, futureOrder = [], futureYear = null, cpuTrades = "normal", variance = DEFAULT_VARIANCE, qbTeams = null, posRules = null }) {
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
  const teams = [...new Set([...picks, ...capital].flatMap((p) => [p.owner, p.original]))];
  return {
    picks, capital, board, chart, staff, chaos, needs, cpuTrades, variance, qbTeams: qbTeams ? [...qbTeams] : null, posRules,
    // Only CPU teams get a board of their own: the user's teams (their
    // staff's Sim Pick, suggestions, value) go off the community's.
    teamBoards: buildTeamBoards(board, teams.filter((t) => !userTeams.includes(t)), seed | 0, chaos * varianceScale(variance)),
    byId: Object.fromEntries(board.map((p) => [p.id, p])),
    taken: {},
    teamPos: {},
    // { [team]: { [NEED_KEY]: share drafted for it so far } }.
    needFilled: {},
    // Every trade made in this sim: [{ a, b, aGot: [pick], bGot: [pick] }].
    trades: [],
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
// What the CPU drafts from (and trades up for): no specialists — those
// come in on their own in candidatesFor.
const cpuAvailable = (state) => available(state).filter((p) => !isSpecialist(p));
export const fitFor = (prospect, team) => prospect?.fits?.[team]?.s ?? null;

// How many players a team has already drafted at a prospect's spot — by
// need key, so a corner then a safety (or a tackle then a guard) isn't
// doubling up; an OL / DB with no sub-position counts half toward each.
function repeatOf(state, team, p) {
  if (isSpecialist(p)) return state.teamPos[team]?.[p.Position] || 0;
  return needKeysFor(p).reduce((t, { key, share }) => t + share * (state.needFilled?.[team]?.[key] || 0), 0);
}

// A team's effective rank for a prospect at this pick (lower = wanted more).
function effectiveRank(state, team, p, overall, round, noise = 0) {
  const fit = fitFor(p, team);
  const fitPull = fit ? Math.max(0, (fit - 60) / 40) * (4 + 0.22 * overall) : 0;
  const repeatPenalty = repeatOf(state, team, p) * (6 + 0.3 * overall) * (isSpecialist(p) ? 10 : p.Position === "QB" ? 3 : 1);
  const need = needPull(state, team, p, overall);
  const rank = teamRank(state, team, p);
  const base = isSpecialist(p) ? specialistRank(state, p.Position, overall) : rank * positionValue(p.Position, rank);
  return base + earlyNudge(p.Position, overall) - fitPull + repeatPenalty - need * (5 + 0.25 * overall) + qbRoomPenalty(state, team, p, overall, round) + noise;
}

// Value: a CPU team doesn't take a player graded more than VALUE_ROUNDS
// rounds later than the round it's in (his community grade, avg, is about
// the round he's graded for — 1 … 7) while one inside that is among its
// candidates, nor an ungraded one while any graded player is. Needs and
// staff fit still choose among them. Mostly matters on a thin board (the
// 2028 class, where a back graded for round 7 was going in round 2).
// Kickers and punters keep their own timing (specialistRank).
export const VALUE_ROUNDS = 3;
export function withinValue(list, round) {
  if (!round) return list;
  const specialists = list.filter(isSpecialist);
  const players = list.filter((p) => !isSpecialist(p));
  const inRange = players.filter((p) => p.avg != null && Math.round(p.avg) <= round + VALUE_ROUNDS);
  if (inRange.length) return [...inRange, ...specialists];
  const graded = players.filter((p) => p.avg != null);
  return graded.length ? [...graded, ...specialists] : list;
}

// posRules (initSim): { [team]: { early: [need keys], qbLate } }. One
// player a position (by need key — a corner and a safety are two); in
// rounds 1–POS_RULE_EARLY_ROUNDS only a player at one of `early`; after
// that any position, a QB only with qbLate. When that leaves nobody, the
// round's rule goes first (QBs still held to it), then the QB rule.
export const POS_RULE_EARLY_ROUNDS = 2;
function byPosRules(state, team, round, list) {
  const rule = state.posRules[team] || { early: [], qbLate: false };
  const filled = state.needFilled?.[team] || {};
  const keys = (p) => needKeysFor(p).map(({ key }) => key);
  const fresh = list.filter((p) => (isSpecialist(p)
    ? !state.teamPos[team]?.[p.Position]
    : keys(p).every((k) => (filled[k] || 0) < 0.5)));
  const early = round != null && round <= POS_RULE_EARLY_ROUNDS;
  const qbOk = early ? rule.early.includes("QB") : !!rule.qbLate;
  const strict = fresh.filter((p) => (p.Position === "QB" ? qbOk : !early || keys(p).some((k) => rule.early.includes(k))));
  if (strict.length) return strict;
  const noQb = fresh.filter((p) => p.Position !== "QB" || qbOk);
  if (noQb.length) return noQb;
  return fresh.length ? fresh : list;
}

function candidatesFor(state, team) {
  // The top of this team's own board — of the players its posRules allow, when it has them.
  const round = currentPick(state)?.round;
  let avail = state.teamBoards?.[team]
    ? cpuAvailable(state).sort((a, b) => teamRank(state, team, a) - teamRank(state, team, b))
    : cpuAvailable(state);
  if (state.posRules) avail = byPosRules(state, team, round, avail);
  const top = avail.slice(0, CANDIDATES);
  const fits = avail.slice(CANDIDATES).filter((p) => (fitFor(p, team) || 0) >= STRONG_FIT);
  // The best kicker and punter left, once one could realistically go.
  const overall = currentPick(state)?.overall || 0;
  const specialists = SPECIALISTS
    .filter((pos) => specialistRank(state, pos, overall) < Infinity)
    .map((pos) => available(state).find((p) => p.Position === pos))
    .filter(Boolean);
  const all = [...top, ...fits, ...specialists];
  // No premium pick on a depth-only position (unless that's all that's left).
  let allowed = all.filter((p) => round == null || round > PREMIUM_ROUNDS || !depthOnly(state, team, p));
  if (!allowed.length) allowed = all;
  // (Before the value cut, so it falls to the next-best non-QB.)
  if (state.qbTeams && (!state.qbTeams.includes(team) || (state.needFilled?.[team]?.QB || 0) >= 1)) {
    const noQb = allowed.filter((p) => p.Position !== "QB");
    if (noQb.length) allowed = noQb;
  }
  return withinValue(allowed, round);
}

// Prospects a CPU team takes the moment they're on the clock with him on
// the board — unless (skip) the team has a bigger call to make. Jeremiah
// Smith goes No. 1 unless that team has an Upgrade Needed at QB (and
// hasn't drafted one yet); then he's the next team's.
const bigQbNeed = (state, team) => !!state.needs?.[team]?.QB?.labels?.includes("Upgrade Needed") && (state.needFilled?.[team]?.QB || 0) < 1;
export const MUST_PICKS = [
  { id: "row_183", name: "Jeremiah Smith", skip: bigQbNeed },
];

// The CPU's choice for the pick on the clock → prospect or null (board
// empty). For a user team (Sim Pick and the like) no noise either — its
// staff picks straight off the community board, by needs and fit.
export function chooseCpuPick(state) {
  const pick = currentPick(state);
  if (!pick) return null;
  const must = MUST_PICKS.find((m) => state.byId[m.id] && !state.taken[m.id] && !m.skip(state, pick.owner));
  if (must) return { prospect: state.byId[must.id], seed: state.seed };
  const work = { seed: state.seed };
  let best = null;
  let bestScore = Infinity;
  candidatesFor(state, pick.owner).forEach((p) => {
    const noise = state.userTeams.includes(pick.owner) ? 0 : gaussian(work) * (2.5 + 0.1 * pick.overall) * state.chaos * varianceScale(state.variance);
    const score = effectiveRank(state, pick.owner, p, pick.overall, pick.round, noise);
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return { prospect: best, seed: work.seed };
}

// The big need a pick passes on → { key, times } or null: in rounds 1–3, a
// position the team has at Upgrade Needed and hasn't drafted for yet, when
// the pick meets none of its Upgrade Needed needs (taking one big need over
// another isn't passing). The first such position in NEED_KEYS order (QB
// first). times: the team's picks before this one in the sim — every one
// of them passed on it too.
const PASSED_NEED_ROUNDS = 3;
function passedNeedFor(state, pick, prospect, need) {
  const needs = state.needs?.[pick.owner];
  if (!needs || pick.round > PASSED_NEED_ROUNDS || need?.label === "Upgrade Needed") return null;
  const filled = state.needFilled?.[pick.owner] || {};
  const open = NEED_KEYS.filter((k) => needs[k]?.labels.includes("Upgrade Needed") && (filled[k] || 0) < 1);
  const mine = needKeysFor(prospect).map(({ key }) => key);
  if (!open.length || open.some((k) => mine.includes(k))) return null;
  return { key: open[0], times: state.picks.slice(0, state.idx).filter((p) => p.owner === pick.owner && p.selection).length };
}

// Make the pick on the clock → { state, event }.
export function makePick(state, prospectId, seed = state.seed) {
  const pick = currentPick(state);
  const prospect = state.byId[prospectId];
  if (!pick || !prospect || state.taken[prospectId]) return { state, event: null };
  // The need he filled, kept on the pick (My Picks, grades).
  const need = needFor(state, pick.owner, prospect);
  const picks = state.picks.map((p, i) => (i === state.idx ? { ...p, selection: prospectId, need } : p));
  const teamPos = { ...state.teamPos, [pick.owner]: { ...(state.teamPos[pick.owner] || {}) } };
  teamPos[pick.owner][prospect.Position] = (teamPos[pick.owner][prospect.Position] || 0) + 1;
  const needFilled = { ...state.needFilled, [pick.owner]: { ...(state.needFilled?.[pick.owner] || {}) } };
  fillsFor(prospect, need).forEach(({ key, share }) => { needFilled[pick.owner][key] = (needFilled[pick.owner][key] || 0) + share; });
  roleFits(prospect).forEach(({ key, fit }) => { needFilled[pick.owner][key] = (needFilled[pick.owner][key] || 0) + fit; });
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
    need,
    // A big need he passed on (the desk's "still no quarterback" lines).
    passedNeed: passedNeedFor(state, pick, prospect, need),
    positionOrdinal: prior.filter((p) => p.Position === prospect.Position).length + 1,
    positionRun: recent.filter((p) => p.Position === prospect.Position).length,
    bestLeftAtPosition: state.board.find((p) => p.Position === prospect.Position && !state.taken[p.id] && p.id !== prospectId) || null,
    // The quarterback this team took in round 1 of this sim, if any — the
    // desk's "protecting / a weapon for {qb}" lines on its later picks.
    rookieQb: state.byId[state.picks.slice(0, state.idx).find((p) => p.owner === pick.owner && p.round === 1 && state.byId[p.selection]?.Position === "QB")?.selection] || null,
  };
  const idx = state.idx + 1;
  const next = {
    ...state, picks, teamPos, needFilled, seed, offers: [],
    taken: { ...state.taken, [prospectId]: true },
    idx,
  };
  next.done = idx >= picks.length || available(next).length === 0;
  return { state: next, event };
}

// ── War Room ──
// The War Room tab for a team's pick (overall: which pick — the one on the
// clock by default): what its front office would take, each from his own
// angle and leaning on his own draft history (his staff fit for the
// prospect — the nflFit GM / HC / OC / DC score), all aware of what the
// team's already drafted and of a room that's full:
//   gm           the GM: positional and draft value first (board rank,
//                weighed by how the position goes in real drafts —
//                positionValue), the team's needs a distant second. He'll
//                take a player into a crowded room or a quarterback into a
//                full QB room only when he's far and away the best value.
//                tradeDown: nothing here is worth the pick — his best is
//                taken well past his board rank (TRADE_DOWN_GAP) — so move
//                back; the player's still his best if they stay.
//                tradeUp: the pick's still to come and he loves his best —
//                slid well past his board rank even at the pick on the
//                clock, and he fills a real need or fits his history — he
//                won't last to it (TRADE_DOWN_GAP the other way), and the
//                pick on the clock is within TRADE_UP_REACH: go get him.
//   hc           the head coach: the team's needs first, value second —
//                never into a crowded room or a full QB room.
//   coordinator  the OC or DC (slot), like the head coach but only for
//                his side of the ball and all the more about its needs
//                (a player who fills one, if any's in reach of the pick):
//                the side opposite the head coach's
//                pick (the DC when he takes a back), or his own side when
//                the other has no one (null when neither has anyone). When
//                the GM and head coach agree on a value at the pick who
//                fills a real need, his side's coordinator backs them.
// Each is { slot, p, need, score } (need: the need he fills — needFor),
// each his own call — two can land on the same player (agrees: the slots
// before him that did).
//   needs        the team's needs, most urgent first (positions before
//                roles at the same label): [{ key, labels, note, filled }] —
//                filled: the team's drafted for it. Set and Crowded Room
//                aren't needs, so they're left out.
//   topNeed      its most urgent need still open ({ key, label }).
const OFFENSE = ["QB", "RB", "WR", "TE", "OL"];
const DEFENSE = ["DL", "EDGE", "LB", "DB"];
// The coordinator for a position's side of the ball.
export const sideOf = (pos) => (OFFENSE.includes(pos) ? "OC" : DEFENSE.includes(pos) ? "DC" : null);
// A staffer's fit above this counts as his history pulling him to a player.
const HISTORY_FLOOR = 60;
// Board spots a staffer's draft history is worth: up to 3 + 0.12 × the pick.
function historyPull(p, team, slot, overall) {
  const f = p.fits?.[team]?.[slot] ?? p.fits?.[team]?.s;
  return f != null && f > HISTORY_FLOOR ? ((f - HISTORY_FLOOR) / (100 - HISTORY_FLOOR)) * (3 + 0.12 * overall) : 0;
}
// Board rank weighed by position: lower is more value.
const valueRank = (p) => p.rank * positionValue(p.Position, p.rank);
// Every position he'd fill is a Crowded Room for the team.
function crowdedFor(state, team, p) {
  const keys = needKeysFor(p);
  return keys.length > 0 && keys.every(({ key }) => state.needs?.[team]?.[key]?.labels.includes("Crowded Room"));
}
// The GM moves back when his best is taken this many spots past his board rank.
export const TRADE_DOWN_GAP = (overall) => 4 + 0.15 * overall;
// The furthest the GM will move up from his pick to the one on the clock.
export const TRADE_UP_REACH = (overall) => 6 + 0.2 * overall;
// How far past the pick (board spots) a coordinator will reach for a need.
const COORD_REACH = (overall) => 12 + 0.4 * overall;

export function warRoomFor(state, team, overall = currentPick(state)?.overall || 1) {
  const pick = state.picks.find((x) => x.overall === overall) || currentPick(state);
  const round = pick?.round || 1;
  const pool = cpuAvailable(state).slice(0, CANDIDATES * 2);
  const repeat = (p) => repeatOf(state, team, p);
  const doubling = (p) => repeat(p) * (6 + 0.3 * overall) * (p.Position === "QB" ? 3 : 1);
  // A quarterback after one's drafted, or into a full room with premium capital.
  const qbBlocked = (p) => p.Position === "QB" && (repeat(p) > 0 || qbRoomPenalty(state, team, p, overall, round) > 0);
  const best = (list, score) => list.reduce((a, p) => { const v = score(p); return v < a.v ? { p, v } : a; }, { p: null, v: Infinity });

  const gmScore = (p) => valueRank(p) - needPull(state, team, p, overall) * (2 + 0.1 * overall) - historyPull(p, team, "GM", overall)
    + doubling(p) + (crowdedFor(state, team, p) ? 15 + 0.5 * overall : 0) + qbRoomPenalty(state, team, p, overall, round) + (p.Position === "QB" && repeat(p) > 0 ? 1e6 : 0);
  // The head coach and coordinators: needs first.
  const coachScore = (slot) => (p) => valueRank(p) - needPull(state, team, p, overall) * (10 + 0.5 * overall) - historyPull(p, team, slot, overall) + doubling(p);
  const coachPool = pool.filter((p) => !crowdedFor(state, team, p) && !qbBlocked(p));

  const shown = [];
  const card = (slot, found) => {
    if (!found.p) return null;
    const c = { slot, p: found.p, need: needFor(state, team, found.p), score: found.v, agrees: shown.filter((x) => x.p.id === found.p.id).map((x) => x.slot) };
    shown.push(c);
    return c;
  };
  const g = best(pool, gmScore);
  const gm = card("GM", g);
  if (gm) gm.tradeDown = gm.p.rank > overall + TRADE_DOWN_GAP(overall) && state.picks.some((x) => x.overall > overall && !x.selection);
  // Trade up: his pick's still to come and he loves a player — one who's
  // slid well past his board rank (even at the pick on the clock) and fills
  // a real need or fits his history — who won't last to theirs, and it's
  // not too far to go.
  const onClock = currentPick(state)?.overall;
  if (gm && !gm.tradeDown && onClock != null && onClock < overall) {
    const slid = gm.p.rank + TRADE_DOWN_GAP(onClock) <= onClock;
    const wanted = (gm.need && gm.need.label !== "Depth Needed") || historyPull(gm.p, team, "GM", overall) > 0;
    const gone = gm.p.rank + TRADE_DOWN_GAP(overall) < overall;
    gm.tradeUp = slid && wanted && gone && overall - onClock <= TRADE_UP_REACH(overall);
  }
  const hc = card("HC", best(coachPool, coachScore("HC")));
  // The GM and head coach on the same player, a value at the pick who fills
  // a real need: his side's coordinator backs them.
  const consensus = gm && hc && gm.p.id === hc.p.id && hc.p.rank <= overall && hc.need && hc.need.label !== "Depth Needed";
  const hcSide = hc && sideOf(hc.p.Position);
  if (consensus && hcSide) {
    return { gm, hc, coordinator: card(hcSide, { p: hc.p, v: coachScore(hcSide)(hc.p) }), needs: teamNeedList(state, team), topNeed: openNeeds(state, team)[0] || null };
  }
  // Otherwise the other side of the ball from the head coach's pick speaks
  // up first. A coordinator's all about his side's needs: he weighs them
  // twice as hard as the head coach, and sticks to players who fill one
  // when any's within reach of the pick (COORD_REACH board spots).
  const coordScore = (slot) => (p) => valueRank(p) - needPull(state, team, p, overall) * (20 + overall) - historyPull(p, team, slot, overall) + doubling(p);
  const sides = ["OC", "DC"].map((slot) => {
    const side = coachPool.filter((p) => sideOf(p.Position) === slot);
    const needy = side.filter((p) => p.rank <= overall + COORD_REACH(overall) && needPull(state, team, p, overall) > 0);
    const found = best(needy.length ? needy : side, coordScore(slot));
    return found.p ? { slot, found, pull: needPull(state, team, found.p, overall) } : null;
  }).filter(Boolean).sort((a, b) => (a.slot === hcSide) - (b.slot === hcSide) || b.pull - a.pull || a.found.v - b.found.v);
  const coordinator = sides[0] ? card(sides[0].slot, sides[0].found) : null;
  return { gm, hc, coordinator, needs: teamNeedList(state, team), topNeed: openNeeds(state, team)[0] || null };
}

// The players a team would most likely take at a pick, one per position:
// how the CPU ranks them (effectiveRank, without its noise — board, needs,
// staff fit, a spot it's already drafted for), never a quarterback once it
// has one or into a full QB room, nor a player into a Crowded Room. On the
// Clock's Potential Targets. [prospect], most likely first.
export function likelyPicks(state, team, overall, n) {
  const round = roundAt(state, overall);
  const blocked = (p) => crowdedFor(state, team, p)
    || (p.Position === "QB" && (repeatOf(state, team, p) > 0 || qbRoomPenalty(state, team, p, overall, round) > 0));
  const ranked = cpuAvailable(state).slice(0, CANDIDATES * 2)
    .filter((p) => !blocked(p))
    .map((p) => ({ p, v: effectiveRank(state, team, p, overall, round) }))
    .sort((x, y) => x.v - y.v);
  const out = [];
  for (const { p } of ranked) {
    if (out.length >= n) break;
    if (!out.some((q) => q.Position === p.Position)) out.push(p);
  }
  return out;
}

// A team's needs (not Set or Crowded Room), most urgent first, positions before roles:
// [{ key, labels, note, filled, count }]. Guards and centers come as one
// (key IOL — needGroup): their labels together, filled once both are,
// count: { filled, of } when there are two.
export function teamNeedList(state, team) {
  const urgency = (n) => Math.min(...n.labels.map((l) => NEED_LABELS.indexOf(l)));
  const order = (key) => (key === "IOL" ? NEED_KEYS.indexOf("G") : NEED_KEYS.indexOf(key));
  const groups = {};
  Object.entries(state.needs?.[team] || {}).forEach(([key, n]) => {
    const labels = n.labels.filter((l) => l !== "Set" && l !== "Crowded Room");
    if (!labels.length) return;
    const g = (groups[needGroup(key)] = groups[needGroup(key)] || { key: needGroup(key), labels: [], notes: [], filled: 0, of: 0 });
    g.labels = [...new Set([...g.labels, ...labels])].sort((a, c) => NEED_LABELS.indexOf(a) - NEED_LABELS.indexOf(c));
    if (n.note) g.notes.push(n.note);
    g.of += 1;
    if ((state.needFilled?.[team]?.[key] || 0) >= 1) g.filled += 1;
  });
  return Object.values(groups)
    .map((g) => ({ key: g.key, labels: g.labels, note: g.notes.join(" · "), filled: g.filled === g.of, ...(g.of > 1 ? { count: { filled: g.filled, of: g.of } } : {}) }))
    .sort((a, c) => urgency(a) - urgency(c) || (ROLE_BY_KEY[a.key] ? 1 : 0) - (ROLE_BY_KEY[c.key] ? 1 : 0) || order(a.key) - order(c.key));
}

// A team's urgent needs it hasn't drafted for yet, most urgent first
// (positions before specific roles at the same label): [{ key, label }].
export function openNeeds(state, team) {
  return Object.entries(state.needs?.[team] || {})
    .map(([key, n]) => ({ key, label: NEED_LABELS.find((l) => URGENT.includes(l) && n.labels.includes(l)) }))
    .filter((n) => n.label && (state.needFilled?.[team]?.[n.key] || 0) < 1)
    .sort((a, c) => NEED_LABELS.indexOf(a.label) - NEED_LABELS.indexOf(c.label) || (ROLE_BY_KEY[a.key] ? 1 : 0) - (ROLE_BY_KEY[c.key] ? 1 : 0));
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

// How much a team loves a prospect at a pick: value (its own board has
// him better than the pick), its needs and its staff's fit — 0 to about 1.8.
function love(state, team, p, overall) {
  const value = Math.max(0, Math.min(1, (overall - teamRank(state, team, p)) / (6 + overall * 0.25)));
  const fit = Math.max(0, ((fitFor(p, team) || 0) - 70) / 30);
  return 0.6 * value + 0.6 * needPull(state, team, p, overall) + 0.6 * fit;
}
// A team's love for its best option on the board at a pick.
function bestLove(state, team, overall) {
  return Math.max(0, ...cpuAvailable(state).slice(0, 12).map((p) => love(state, team, p, overall)));
}

// How badly `team` wants a prospect that's on the board now (0 = not at all).
function desire(state, team, p, theirPick) {
  const fit = fitFor(p, team) || 0;
  const fitDesire = Math.max(0, (fit - 70) / 30);
  // Someone the board says won't last to their pick.
  const wontLast = p.rank < theirPick ? Math.min(1, (theirPick - p.rank) / 12) : 0;
  // Its needs: an Upgrade Needed is worth moving up for; a position it's
  // set at (or already drafted) isn't.
  const need = needPull(state, team, p, theirPick) * 0.6;
  return fitDesire * 0.8 + wontLast * 0.6 + need + qbChase(state, team, p, theirPick);
}
// A team with an Upgrade Needed at QB goes after one it rates (qbGate)
// who won't last to its pick: this much more desire to move up.
const QB_CHASE = 0.4;
function qbChase(state, team, p, theirPick) {
  if (p.Position !== "QB" || !bigQbNeed(state, team) || p.rank >= theirPick) return 0;
  return QB_CHASE * qbGate(state, team, p, theirPick);
}

// How a CPU team on the clock feels about dealing its pick, for the user
// to read before calling → "back" (it likes no one here — open to moving
// back, at a discount), "locked" (it loves who's there — staying put; it'll
// take a lot), "movedUp" (it traded up already — not moving back down),
// "open" (in between), or null (not a CPU team's pick on the clock).
const LOCKED_LOVE = 1;
export function pickStance(state, team) {
  const pick = currentPick(state);
  if (!pick || pick.owner !== team || state.userTeams.includes(team)) return null;
  if (movedUp(state, team)) return "movedUp";
  const love = bestLove(state, team, pick.overall);
  return dislike(love) > 0 ? "back" : love >= LOCKED_LOVE ? "locked" : "open";
}

// Has `team` moved up in a trade this draft — landed the earliest pick in
// the deal? A CPU team that has never turns around and trades down.
export function movedUp(state, team) {
  return (state.trades || []).some((t) => {
    const all = [...t.aGot, ...t.bGot].filter(Boolean);
    if (!all.length) return false;
    const earliest = Math.min(...all.map((p) => p.overall));
    return (t.aGot.some((p) => p?.overall === earliest) ? t.a : t.b) === team;
  });
}

// Teams that would trade up into the pick on the clock, best offer first:
// [{ team, give: [pick], value, ratio, target: prospect }]. None for a CPU
// team that's moved up this draft — it doesn't trade back down.
export function findTradeUpOffers(state, { max = MAX_OFFERS, threshold = 0.75 } = {}) {
  const pick = currentPick(state);
  if (!pick || (!state.userTeams.includes(pick.owner) && movedUp(state, pick.owner))) return [];
  const target = pickValue(state.chart, pick.overall);
  const top = cpuAvailable(state).slice(0, 8);
  // A CPU team on the clock asks more the more it loves its options; the
  // user's own pick goes for the chart (they say yes or no themselves).
  const attachment = state.userTeams.includes(pick.owner) ? 0 : bestLove(state, pick.owner, pick.overall);
  const minRatio = state.userTeams.includes(pick.owner) ? TRADE_MIN_RATIO : askRatio(TRADE_MIN_RATIO, attachment);
  const teams = [...new Set(state.picks.slice(state.idx + 1, state.idx + 1 + TRADE_WINDOW).map((p) => p.owner))]
    .filter((t) => t !== pick.owner && !state.userTeams.includes(t));
  const offers = [];
  teams.forEach((team) => {
    const w = wantFor(state, team, top);
    if (!w || w.score < threshold) return;
    // A team that really wants him will overpay a little more — its
    // opening offer climbs with how much (OFFER_EAGERNESS), up to its limit.
    const maxRatio = TRADE_MAX_RATIO + 0.2 * Math.max(0, w.score - 1);
    if (minRatio > maxRatio) return;
    const opening = Math.min(maxRatio, minRatio + OFFER_EAGERNESS * Math.max(0, w.score - 1));
    // (No package lands there: its plain offer.)
    const bundle = bundleFor(state, team, target * opening, target * maxRatio) || bundleFor(state, team, target * minRatio, target * maxRatio);
    if (!bundle) return;
    offers.push({ team, give: bundle.picks.map((p) => p.overall), value: bundle.total, ratio: bundle.total / target, target: w.p, desire: w.score, interest: interestOf(w.score), attachment });
  });
  return offers.sort((a, b) => b.desire - a.desire).slice(0, max);
}
const OFFER_EAGERNESS = 0.25;

// The player `team` most wants to move up to the pick on the clock for,
// from its own next pick → { p, score (desire) } or null (no pick this
// draft to build a deal around). Moving up costs premium capital — not for
// a depth-only position, or a quarterback when the room's full.
function wantFor(state, team, top = cpuAvailable(state).slice(0, 8)) {
  const pick = currentPick(state);
  const theirs = futurePicksOf(state, team)[0];
  if (!pick || !theirs || theirs.future) return null;
  let best = null;
  top.forEach((p) => {
    if ((isPremium(pick.round, p) || isPremium(theirs.round, p)) && (depthOnly(state, team, p) || (p.Position === "QB" && qbRoomFull(state, team)))) return;
    const d = desire(state, team, p, theirs.overall);
    if (!best || d > best.score) best = { p, score: d };
  });
  return best;
}

// How badly a team wants to move up into the pick on the clock (its desire)
// → "eager" (it'll pay up — and take less to get it done), "interested",
// or "cool" (it'd need a bargain).
const EAGER = 1.2;
const INTERESTED = 0.75;
export const interestOf = (score) => (score >= EAGER ? "eager" : score >= INTERESTED ? "interested" : "cool");
// A CPU team's interest in the user's pick on the clock → "eager" |
// "interested" | "cool", or null (not the user's pick, or it can't deal).
export function pickInterest(state, team) {
  const pick = currentPick(state);
  if (!pick || !state.userTeams.includes(pick.owner) || state.userTeams.includes(team)) return null;
  const w = wantFor(state, team);
  return w ? interestOf(w.score) : null;
}
// What a CPU team needs, as a multiple of the chart, to move up into the
// user's pick on the clock: less the more it wants in — an eager team gives
// up to EAGER_PAYS more than the pick's worth — more when it's cool.
const EAGER_PAYS = 0.25;
const COOL_ASKS = 0.1;
function tradeUpAsk(score) {
  const keen = Math.max(0, Math.min(1, (score - INTERESTED) / (EAGER - INTERESTED + 0.5)));
  return score < INTERESTED ? CPU_ACCEPT_RATIO + COOL_ASKS * (1 - score / INTERESTED) : CPU_ACCEPT_RATIO / (1 + EAGER_PAYS * keen);
}

// Swap the pick on the clock to offer.team for their offered picks.
export function acceptOffer(state, offer) {
  const pick = currentPick(state);
  if (!pick) return { state, event: null };
  const from = pick.owner;
  const swap = (p) => (offer.give.includes(p.overall) && !p.selection ? { ...p, owner: from, via: offer.team } : p);
  const swapped = [...state.picks.map(swap), ...(state.capital || []).map(swap)];
  const give = offer.give.map((o) => swapped.find((p) => p.overall === o));
  // tradeUp rides on the pick into its pick event: the desk tells the
  // trade and the selection together ("the Jets move up and get their guy").
  const picks = state.picks.map((p, i) => (i === state.idx ? { ...p, owner: offer.team, via: from, tradeUp: { from, give } } : swap(p)));
  const capital = (state.capital || []).map(swap);
  const event = {
    type: "trade",
    from, to: offer.team,
    pick: { ...pick },
    give,
    ratio: offer.ratio,
    target: offer.target,
    userInvolved: state.userTeams.includes(from),
  };
  const trades = [...(state.trades || []), { a: offer.team, b: from, aGot: [{ ...pick }], bGot: event.give }];
  return { state: { ...state, picks, capital, trades, offers: [] }, event };
}

// Before a CPU pick: sometimes a team behind it trades up for its guy.
// The setup screen's CPU Trades: a multiple of the usual chance (Frequent
// also lets a team that only fairly wants its guy call), capped at
// CPU_TRADE_CAP. Off: no CPU–CPU deals — the user's own offers still come.
export const CPU_TRADES = {
  off: { label: "Off", rate: 0, note: "No trades between CPU teams — offers to you still come in." },
  normal: { label: "Normal", rate: 1, threshold: 0.9, note: "Trades about as often as a real draft." },
  frequent: { label: "Frequent", rate: 2.5, threshold: 0.75, note: "Teams are on the phones — expect a lot more movement." },
};
const CPU_TRADE_CAP = 0.85;
function maybeCpuTrade(state) {
  const pick = currentPick(state);
  const level = CPU_TRADES[state.cpuTrades] || CPU_TRADES.normal;
  if (!pick || !level.rate) return null;
  const work = { seed: state.seed };
  const roll = random(work);
  // A team that likes no one here shops the pick (trade back).
  const shopping = dislike(bestLove(state, pick.owner, pick.overall));
  const threshold = level.threshold * (1 - (1 - TRADE_BACK_THRESHOLD) * shopping);
  const offer = findTradeUpOffers({ ...state, seed: work.seed }, { max: 1, threshold })[0];
  if (!offer) return null;
  // The bigger the gap between how much the caller wants his player and how
  // much the team on the clock loves its options, the likelier the deal.
  const gap = offer.desire - offer.attachment;
  const base = (Math.min(TRADE_GAP_MAX, (CPU_TRADE_CHANCE[pick.round - 1] ?? 0.01) + TRADE_GAP_RATE * Math.max(0, gap - TRADE_GAP_START)) + TRADE_BACK_CHANCE * shopping) * state.chaos;
  const chance = Math.min(CPU_TRADE_CAP, base * level.rate);
  if (roll >= chance) return null;
  return acceptOffer({ ...state, seed: work.seed }, offer);
}

// User's pick on the clock: the trade offers waiting for them.
export function withOffers(state) {
  if (!isUserOnClock(state)) return state;
  return { ...state, offers: findTradeUpOffers(state) };
}

// ── Grades ──
// One scale for every team — the user's and the CPU's alike. Each pick
// gets a grade (pickScore: value for the slot, staff fit, the need it
// filled), and the team's draft is its picks' value (the early ones
// counting most) balanced against how well it answered the needs it came
// in with (needReport) — a major need left open, or only answered late,
// costs more than a reach does. A pick nowhere near the board (offBoard)
// is an F- whatever need it fills, and a second quarterback costs.

const LETTERS = [
  [1.0, "A+"], [0.6, "A"], [0.3, "A-"], [0.1, "B+"], [-0.1, "B"], [-0.3, "B-"], [-0.6, "C+"], [-0.9, "C"], [-1.2, "C-"],
  [-1.5, "D+"], [-1.8, "D"], [-2.1, "D-"], [-2.6, "F"], [-Infinity, "F-"],
];
export const letterFor = (score) => LETTERS.find(([min]) => score >= min)[1];

// What filling a need adds to a pick's grade (a Crowded Room costs); a
// role counts ROLE_WEIGHT of it.
const NEED_GRADE = { "Upgrade Needed": 0.5, "Expiring Contract": 0.35, "Aging Talent": 0.3, "Upgrade Wanted": 0.25, "Depth Needed": 0.15, "Crowded Room": -0.4 };
const needGrade = (need) => (need ? (NEED_GRADE[need.label] || 0) * (ROLE_BY_KEY[need.key] ? ROLE_WEIGHT : 1) : 0);

// Why a team's pick (before it's made) makes no sense, or null — the war
// room's reaction (SimBroadcast WarRoomReaction) reads the room on it:
//   "secondQb" a quarterback after one's drafted this draft;
//   "qbRoom"   a quarterback into a full room with premium capital;
//   "offBoard" no one had him near the slot (offBoard), a kicker too early;
//   "repeat"   the same position as the team's last pick, both early;
//   "crowded"  early, at a position its needs call a Crowded Room.
export function pickOddity(state, team, p, overall) {
  const pick = state.picks.find((x) => x.overall === overall);
  const round = pick?.round || 1;
  if (p.Position === "QB" && state.teamPos[team]?.QB) return "secondQb";
  if (qbRoomPenalty(state, team, p, overall, round) > 0) return "qbRoom";
  if (offBoard(overall, p)) return "offBoard";
  const last = state.picks.filter((x) => x.owner === team && x.selection && x.overall < overall).pop();
  if (last && round <= PREMIUM_ROUNDS && last.round <= PREMIUM_ROUNDS && state.byId[last.selection]?.Position === p.Position) return "repeat";
  if (round <= PREMIUM_ROUNDS && needFor(state, team, p)?.label === "Crowded Room") return "crowded";
  return null;
}

// Off the board: taken this far ahead of his board rank — not a reach, a
// player no one had near the slot — or a kicker / punter before any has
// gone in the last 10 real drafts. Graded OFF_BOARD_SCORE, an F-.
const OFF_BOARD_SCORE = -4;
export function offBoard(overall, prospect) {
  if (isSpecialist(prospect)) {
    const h = HISTORY.specialists[prospect.Position];
    return h?.earliest != null && overall < h.earliest;
  }
  return prospect.rank - overall >= Math.max(40, overall * 1.5);
}

// A second quarterback in one draft, by the round it comes in: a late
// flyer costs a little, a second early one a lot.
const SECOND_QB = (round) => (round <= 2 ? -1.2 : round <= 4 ? -0.6 : -0.25);

// A steal counts for less the later it comes: ten spots of value is a coup
// in round 1, less in round 2, and nothing by round 7 (reaches cost in
// every round — the slot's own scale already eases them late).
const STEAL_BY_ROUND = [1, 0.75, 0.5, 0.35, 0.2, 0.1, 0];
// A kicker / punter: never a listed need, so never a steal — taken where
// they usually go it's a little under par (SPECIALIST_PAR), earlier is a reach.
const SPECIALIST_PAR = -0.25;

// One pick's grade score: board value for the slot (steals scaled by
// round; a kicker / punter against where the first one usually goes), a
// little for staff fit, the need it filled (need: the pick's own, from
// makePick — half of it for a big reach), and a second QB's cost
// (opts.secondQb). An off-the-board pick is OFF_BOARD_SCORE, whatever it fills.
export function pickScore(overall, prospect, team, need = null, { round = 1, secondQb = false } = {}) {
  if (offBoard(overall, prospect)) return OFF_BOARD_SCORE;
  const slotValue = (spot) => Math.max(-2.5, Math.min(2, (overall - spot) / (6 + overall * 0.25)));
  let value;
  if (isSpecialist(prospect)) {
    const spot = HISTORY.specialists[prospect.Position]?.slots?.[0];
    value = (spot ? Math.min(0, slotValue(spot)) : 0) + SPECIALIST_PAR;
  } else {
    const v = slotValue(prospect.rank);
    value = v > 0 ? v * STEAL_BY_ROUND[Math.min(round, STEAL_BY_ROUND.length) - 1] : v;
  }
  const fit = fitFor(prospect, team) || 0;
  return value + (fit >= 70 ? ((fit - 70) / 30) * 0.5 : 0) + needGrade(need) * (value < -1 ? 0.5 : 1) + (secondQb ? SECOND_QB(round) : 0);
}

// The needs a team came in with that a draft can be judged on (positions
// only, not specific roles or depth): [{ key, label }].
const URGENT = ["Upgrade Needed", "Expiring Contract", "Aging Talent", "Upgrade Wanted"];
function urgentNeeds(state, team) {
  return Object.entries(state.needs?.[team] || {})
    .filter(([key]) => NEED_KEYS.includes(key))
    .map(([key, n]) => ({ key, label: NEED_LABELS.find((l) => URGENT.includes(l) && n.labels.includes(l)) }))
    .filter((n) => n.label);
}

// How pressing each need is (a QB need counts QB_SEVERITY times), and how
// fully a pick in each round answers one: a premium pick (rounds 1–2)
// does, a third-rounder mostly, a Day 3 pick hardly.
const NEED_SEVERITY = { "Upgrade Needed": 1, "Expiring Contract": 0.7, "Aging Talent": 0.6, "Upgrade Wanted": 0.45 };
const QB_SEVERITY = 1.5;
const ANSWER_BY_ROUND = [1, 0.9, 0.65, 0.45, 0.3, 0.2, 0.2];
// A need with this severity or more is a major one (the analysis names it).
export const MAJOR_NEED = 0.7;
// The needs part of a team's grade: from −1.4 (none answered) to +0.6 (all of them, early).
const NEEDS_FLOOR = 0.7;
const NEEDS_SCALE = 2;

// How a team's draft answered its needs → { items: [{ key, label,
// severity, answer (0–1), round (the pick that best answered it, or
// null), status: met | late | open }], met, late, open (items by status),
// score }. Only its most pressing needs, as many as it made picks, are
// judged — a team with one pick isn't faulted for four holes — and an
// off-the-board pick answers nothing.
function needReport(state, team, rows) {
  const judged = urgentNeeds(state, team)
    .map((n) => ({ ...n, severity: (NEED_SEVERITY[n.label] || 0.45) * (n.key === "QB" ? QB_SEVERITY : 1) }))
    .sort((x, y) => y.severity - x.severity)
    .slice(0, rows.length);
  const items = judged.map((n) => {
    let answer = 0;
    let round = null;
    rows.forEach((r) => {
      if (r.offBoard) return;
      const share = Math.max(0, ...fillsFor(r.prospect, r.need).filter((k) => k.key === n.key).map((k) => k.share), r.need?.key === n.key ? 1 : 0);
      const a = share ? ANSWER_BY_ROUND[Math.min(r.pick.round, ANSWER_BY_ROUND.length) - 1] * (share >= 1 ? 1 : 0.75) : 0;
      if (a > answer) { answer = a; round = r.pick.round; }
    });
    return { ...n, answer, round, status: answer >= 0.85 ? "met" : answer > 0 ? "late" : "open" };
  });
  const total = items.reduce((t, n) => t + n.severity, 0);
  const missed = items.reduce((t, n) => t + n.severity * (1 - n.answer), 0);
  const score = total ? (1 - missed / total - NEEDS_FLOOR) * NEEDS_SCALE : 0;
  const by = (st) => items.filter((n) => n.status === st);
  return { items, met: by("met"), late: by("late"), open: by("open"), score };
}

// needReport's needs as the draft shows them — a guard and a center as one
// interior need (needGroup) → { met, late, open }: [{ key, severity, round,
// count }] in needReport's order. A group with one of its needs met is met
// (count: { filled, of } says how far), else late, else open.
export function groupedNeeds(report) {
  const groups = [];
  (report?.items || []).forEach((n) => {
    const key = needGroup(n.key);
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, items: [] }; groups.push(g); }
    g.items.push(n);
  });
  const out = { met: [], late: [], open: [] };
  groups.forEach((g) => {
    const met = g.items.filter((n) => n.status === "met");
    const late = g.items.filter((n) => n.status === "late");
    const base = { key: g.key, severity: Math.max(...g.items.map((n) => n.severity)), count: g.items.length > 1 ? { filled: met.length + late.length, of: g.items.length } : null };
    if (met.length) out.met.push({ ...base, round: Math.min(...met.map((n) => n.round)) });
    else if (late.length) out.late.push({ ...base, round: Math.min(...late.map((n) => n.round)) });
    else out.open.push({ ...base, round: null });
  });
  return out;
}

// A pick's weight in the value part of the grade, by round.
const ROUND_WEIGHT = [3, 2.2, 1.6, 1.2, 1, 1, 1];
// How much of the team grade the picks' value is (needs are the rest).
const VALUE_SHARE = 0.6;

// A team's draft: [{ pick, prospect, score, letter, need, offBoard,
// secondQb }], its trades ([{ partner, got, gave }] — picks, this draft's
// and next year's), its needs (needReport) and its grade: VALUE_SHARE of
// its picks' round-weighted value plus the needs score. Value alone with
// the needs left open grades out around a C+ / B-; needs met with fair
// value, an A; a draft of off-the-board picks, an F-.
export function teamHaul(state, team) {
  let qbs = 0;
  const rows = state.picks
    .filter((p) => p.owner === team && p.selection)
    .map((p) => {
      const prospect = state.byId[p.selection];
      const secondQb = prospect.Position === "QB" && qbs++ > 0;
      const score = pickScore(p.overall, prospect, team, p.need, { round: p.round, secondQb });
      return { pick: p, prospect, score, letter: letterFor(score), need: p.need || null, offBoard: offBoard(p.overall, prospect), secondQb };
    });
  const needs = needReport(state, team, rows);
  const weight = (r) => ROUND_WEIGHT[Math.min(r.pick.round, ROUND_WEIGHT.length) - 1];
  const totalWeight = rows.reduce((t, r) => t + weight(r), 0);
  const value = totalWeight ? rows.reduce((t, r) => t + r.score * weight(r), 0) / totalWeight : 0;
  const score = rows.length ? value * VALUE_SHARE + needs.score : 0;
  const trades = (state.trades || []).filter((t) => t.a === team || t.b === team)
    .map((t) => (t.a === team ? { partner: t.b, got: t.aGot, gave: t.bGot } : { partner: t.a, got: t.bGot, gave: t.aGot }));
  return { team, rows, value, score, letter: rows.length ? letterFor(score) : "—", needs, trades };
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
// coming back. → { give, get (chart points), ratio (give / get), accept,
// short (the points more it would take — the on-the-clock premium too),
// target (the points it wants in all — the trade meter's full mark),
// movedUp? }. A CPU partner that's moved up this draft won't trade back
// down (give up the earliest pick in the deal) — movedUp: true says why.
export function evaluateProposal(state, { give = [], get = [] }) {
  const giveValue = chartTotal(state, give);
  const getValue = chartTotal(state, get);
  const partner = get.length ? pickByKey(state, get[0])?.owner : null;
  if (partner && !state.userTeams.includes(partner) && movedUp(state, partner) && Math.min(...get) < Math.min(Infinity, ...give)) {
    return { give: giveValue, get: getValue, ratio: getValue ? giveValue / getValue : 0, accept: false, movedUp: true };
  }
  // Asking a CPU team for the pick it's on the clock with: it wants more the
  // more it loves who's there, less when it likes no one (askRatio).
  const onClock = currentPick(state);
  const attachment = onClock && get.includes(onClock.overall) && !state.userTeams.includes(onClock.owner) ? bestLove(state, onClock.owner, onClock.overall) : 0;
  // Offering a CPU team the user's own pick on the clock (a trade back):
  // the more it wants in, the more it'll give for it (tradeUpAsk).
  const wanted = onClock && give.includes(onClock.overall) && state.userTeams.includes(onClock.owner) && partner && !state.userTeams.includes(partner)
    ? wantFor(state, partner) : null;
  const target = wanted
    ? getValue * tradeUpAsk(wanted.score)
    : getValue * askRatio(CPU_ACCEPT_RATIO, onClock && get.includes(onClock.overall) && !state.userTeams.includes(onClock.owner) ? attachment : null);
  const accept = give.length > 0 && get.length > 0 && giveValue >= target;
  return { give: giveValue, get: getValue, ratio: getValue ? giveValue / getValue : 0, accept, short: Math.max(1, Math.ceil(target - giveValue)), target };
}

// The CPU partner's own offer for a deal the user's started ({ team,
// partner, give, get } — either side may be empty) → { give, get } it
// would sign, or null (no deal it can make). The picks already in stay;
// it evens the deal out at its own price (evaluateProposal — its interest
// and how it feels about its pick), adding to either side:
//   short of its price → the user's picks, the smallest that closes the gap;
//   then, with room to spare → its own picks, as much as it'd give back.
// Nothing in yet: the two teams' next picks swap and get evened out the
// same way — a trade up when the partner's pick comes first (the user's
// picks added), else a trade down (its picks added).
export function counterOffer(state, { team, partner, give = [], get = [] }) {
  const mine = tradeablePicks(state, team, { includeCurrent: true });
  const theirs = tradeablePicks(state, partner, { includeCurrent: true });
  const ok = (deal) => evaluateProposal(state, deal).accept;
  if (!give.length && !get.length) {
    if (!mine.length || !theirs.length) return null;
    give = [mine[0].overall];
    get = [theirs[0].overall];
  }
  const inDeal = (p) => give.includes(p.overall) || get.includes(p.overall);
  const byWorth = (a, b) => pickWorth(state, b) - pickWorth(state, a);
  const out = [...give];
  if (get.length && !ok({ give: out, get })) {
    // The user's picks, smallest package that gets a yes.
    const pool = mine.filter((p) => !inDeal(p)).sort(byWorth);
    let done = false;
    while (!done && pool.length && out.length < give.length + MAX_BUNDLE) {
      const fits = [...pool].reverse().find((p) => ok({ give: [...out, p.overall], get }));
      const add = fits || pool[0];
      out.push(add.overall);
      pool.splice(pool.indexOf(add), 1);
      done = !!fits;
    }
    if (!done) return null;
  }
  // Its picks back: its best that still gets a yes.
  const back = [...get];
  theirs.filter((p) => !inDeal(p)).sort(byWorth)
    .forEach((p) => { if (back.length < get.length + MAX_BUNDLE && ok({ give: out, get: [...back, p.overall] })) back.push(p.overall); });
  return back.length && out.length ? { give: out, get: back } : null;
}

// Swap the picks → { state, event } (event null when the CPU says no).
// force (Mock Draft mode): no CPU to ask — any two teams, any picks, even
// one side's picks for nothing.
export function applyProposal(state, { team, partner, give = [], get = [] }, { force = false } = {}) {
  // Every pick still there to trade — a CPU pick on the clock can be made
  // while the user's building the deal (stale: nothing swaps).
  const still = (n, owner) => tradeablePicks(state, owner, { includeCurrent: true }).some((p) => p.overall === n);
  if (!give.every((n) => still(n, team)) || !get.every((n) => still(n, partner))) {
    return { state, event: null, verdict: { ...evaluateProposal(state, { give, get }), accept: false, stale: true } };
  }
  const verdict = force
    ? { ...evaluateProposal(state, { give, get }), accept: give.length + get.length > 0 && team !== partner }
    : evaluateProposal(state, { give, get });
  if (!verdict.accept) return { state, event: null, verdict };
  const swap = (p) => {
    if (p.selection) return p;
    if (give.includes(p.overall) && p.owner === team) return { ...p, owner: partner, via: team };
    if (get.includes(p.overall) && p.owner === partner) return { ...p, owner: team, via: partner };
    return p;
  };
  let picks = state.picks.map(swap);
  const capital = (state.capital || []).map(swap);
  const all = [...picks, ...capital];
  const find = (n) => all.find((p) => p.overall === n);
  // Told the way the feed tells any trade: whoever lands the earliest pick
  // "moves up" to it.
  const earliest = Math.min(...give, ...get);
  const userMovesUp = get.includes(earliest);
  // A pick in this draft carries the trade up into its pick event (see acceptOffer).
  picks = picks.map((p) => (p.overall === earliest ? { ...p, tradeUp: { from: userMovesUp ? partner : team, give: (userMovesUp ? give : get).map(find) } } : p));
  const event = {
    type: "trade", proposed: true, userInvolved: true,
    to: userMovesUp ? team : partner, from: userMovesUp ? partner : team,
    pick: find(earliest),
    give: (userMovesUp ? give : get).map(find),
    ratio: userMovesUp ? verdict.ratio : verdict.ratio ? 1 / verdict.ratio : 0,
    target: null,
  };
  const trades = [...(state.trades || []), { a: team, b: partner, aGot: get.map(find), bGot: give.map(find) }];
  return { state: { ...state, picks, capital, trades, offers: [] }, event, verdict };
}
