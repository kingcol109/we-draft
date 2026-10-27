// src/utils/draftSim/weeklyMock.js
//
// The Weekly Mock: the site's official mock draft, made by the Draft Sim
// once a week (Admin → Mock Draft → Weekly Mock, AdminWeeklyMock.jsx) — every
// team on the CPU, Less board variance, normal CPU trades. It's saved as an
// official mockDrafts post (private until published) for the admin to touch
// up in the mock editor, plus a weeklyMocks/{id} doc: its trades, and — once
// published — the edited mock's picks. Each team's picks get their own page
// (/mocks/{team}, pages/WeeklyTeamMock.jsx) with what the same pick was the
// week before.
//
// A second Weekly Mock, the next class's (2028, three rounds), is drafted
// after it, on top of it: every team's needs a year on from the picks it
// made in the latest published 2027 week (nextYearNeeds) — on the 2028
// order shuffled in tiers (tieredOrder), with that week's trades of 2028
// picks carried over (carryTrades),
// no trades of its own, and each team held to the positions nextYearRules
// allows it. Its pages are /mocks/{team}/2028.
//
// Pick numbers move week to week (the order follows the standings), so a
// pick is known by its slot — round, the team that originally owned it, and
// which of that team's picks in the round it is (a comp pick is its second):
// "1-NYJ-1" is the Jets' own first-rounder, "1-DAL-1" the one they got from
// Dallas, whoever holds it now.
import { initSim, stepCpu, makePick, NEED_LABELS, NEED_KEYS, needKeysFor, specificFits } from "./engine";
import { pickNote } from "./pickNotes";

export const WEEKLY_ROUNDS = 7;
// Rounds by class: the next class's mock is the first three.
export const WEEKLY_ROUNDS_BY_YEAR = { 2027: 7, 2028: 3 };
export const WEEKLY_VARIANCE = "less";
export const WEEKLY_TRADES = "normal";
// CPU trades by class: the next class's mock has none (engine CPU_TRADES "off").
export const WEEKLY_TRADES_BY_YEAR = { 2027: "normal", 2028: "off" };

// Slot keys for a draft's picks: { [overall]: "round-original-n" }.
export function slotKeys(picks) {
  const seen = {};
  const out = {};
  [...picks].sort((a, b) => a.overall - b.overall).forEach((p) => {
    const base = `${p.round}-${p.original}`;
    seen[base] = (seen[base] || 0) + 1;
    out[p.overall] = `${base}-${seen[base]}`;
  });
  return out;
}

// One weekly draft, start to finish (data: loadSimData's) → the finished
// sim, with its pick events in order (pickEvents — for the notes).
// qbTeams: the only teams that take a QB, freely; posRules: the positions
// each team may take (the next class's — nextYearRules).
export function runWeeklyMock(data, { seed = Date.now(), rounds = WEEKLY_ROUNDS, trades = WEEKLY_TRADES, qbTeams = null, posRules = null } = {}) {
  let s = initSim({
    order: data.order, futureOrder: data.futureOrder, futureYear: data.futureYear, board: data.board, chart: data.chart,
    staff: data.staff, needs: data.needs, userTeams: [], rounds, seed, cpuTrades: trades, variance: WEEKLY_VARIANCE, qbTeams, posRules,
  });
  const pickEvents = [];
  // A pick a step, and a step never takes more than one pick — the cap is just a guard.
  for (let i = 0; i < s.picks.length + 5 && !s.done; i++) {
    const r = stepCpu(s);
    s = r.state;
    pickEvents.push(...r.events.filter((e) => e.type === "pick"));
  }
  return { ...s, pickEvents };
}

// Every pick's note (pickNotes.js) → { [overall]: text }. ctx: pickNote's
// (names, staff, season, year, history, rand, pff).
// Picks a team came away with by trading down are told as such (tradeDowns).
export function weeklyNotes(sim, ctx) {
  const shared = { ...ctx, tradeDowns: tradeDownsOf(tradesFromSim(sim, ctx.year)), used: {} };
  return Object.fromEntries((sim.pickEvents || []).map((e) => [e.pick.overall, pickNote(e, shared)]));
}

// Saved trades (tradesFromSim's) → the picks each team got for moving
// down: { [overall]: { down, up, at } } (pickNote's ctx.tradeDowns).
function tradeDownsOf(trades) {
  const out = {};
  (trades || []).forEach((t) => (t.downGot || []).forEach((p) => {
    if (p.overall != null) out[p.overall] = { down: t.down, up: t.up, at: t.at };
  }));
  return out;
}

// Regenerated notes for some picks of a weekly mock as it stands in the
// mock editor (picks moved, players swapped): the draft is replayed in
// order with each pick's team and player (editor picks: [{ pickNumber,
// currentTeam, selection }]) so needs, value and position runs are the
// edited mock's. A trade up (saved trades, tradesFromSim's) is still told
// while the team that made it holds the pick. data: loadSimData's (the
// next class's needs stand as loaded — its notes are light). overalls:
// which picks → { [overall]: note }; a pick whose player isn't on the sim
// board gets none.
export function replayNotes(data, picks, overalls, { trades = [], ctx }) {
  const byOverall = Object.fromEntries((picks || []).map((p) => [p.pickNumber, p]));
  const rounds = Math.max(1, ...(picks || []).filter((p) => p.selection).map((p) => p.round || 1));
  let s = initSim({ order: data.order, board: data.board, chart: data.chart, staff: data.staff, needs: data.needs, rounds, seed: 1 });
  s = {
    ...s,
    picks: s.picks.map((p) => {
      const owner = byOverall[p.overall]?.currentTeam || p.owner;
      const up = (trades || []).find((t) => t.at === p.overall && t.up === owner);
      const give = up && up.downGot.map((g) => (g.overall != null ? { overall: g.overall, round: g.round } : { future: true, year: g.year, round: g.round }));
      return { ...p, owner, ...(up ? { tradeUp: { from: up.down, give } } : {}) };
    }),
  };
  const want = new Set(overalls);
  const events = [];
  s.picks.forEach((p, i) => {
    const id = byOverall[p.overall]?.selection?.id;
    const r = id && s.byId[id] && !s.taken[id] ? makePick({ ...s, idx: i }, id) : null;
    if (!r?.event) return;
    s = r.state;
    if (want.has(p.overall)) events.push(r.event);
  });
  const shared = { ...ctx, tradeDowns: tradeDownsOf(trades), used: {} };
  return Object.fromEntries(events.map((e) => [e.pick.overall, pickNote(e, shared)]));
}

// A drafted player as saved: who he is, plus his college logo (the class
// snapshot's — a player the editor swapped in may not have one).
const playerOf = (p) => (p ? {
  id: p.id, First: p.First, Last: p.Last, Position: p.Position, School: p.School || "", Slug: p.Slug || "", ...(p.logo ? { logo: p.logo } : {}),
} : null);

// One pick in a trade, as stored: { year, round, original (the team it
// started with), overall (this draft's number; null for next year's) }.
const tradedPick = (p, year) => ({
  year: p.future ? String(p.year ?? "") : String(year), round: p.round, original: p.original, overall: p.future ? null : p.overall,
});

// The sim's trades, in the order they were made → [{ up, down, at, upGot,
// downGot }]: up is the team that moved up — it landed the deal's earliest
// pick in this draft, `at` — and down the team that moved back; upGot /
// downGot are the picks each side came away with (tradedPick).
export function tradesFromSim(sim, year) {
  return (sim.trades || []).map((t) => {
    const aGot = t.aGot.filter(Boolean);
    const bGot = t.bGot.filter(Boolean);
    const now = [...aGot, ...bGot].filter((p) => !p.future);
    const at = now.length ? Math.min(...now.map((p) => p.overall)) : null;
    const aUp = aGot.some((p) => p.overall === at);
    return {
      up: aUp ? t.a : t.b, down: aUp ? t.b : t.a, at,
      upGot: (aUp ? aGot : bGot).map((p) => tradedPick(p, year)),
      downGot: (aUp ? bGot : aGot).map((p) => tradedPick(p, year)),
    };
  });
}

// The finished sim → { rounds, picks: [{ slot, overall, round, original,
// owner, player, note }], trades (tradesFromSim) }. notes: weeklyNotes'.
export function weeklyFromSim(sim, year, notes = {}) {
  const slots = slotKeys(sim.picks);
  return {
    rounds: Math.max(1, ...sim.picks.map((p) => p.round)),
    picks: sim.picks.map((p) => ({
      slot: slots[p.overall], overall: p.overall, round: p.round, original: p.original, owner: p.owner,
      player: playerOf(sim.byId[p.selection]), note: notes[p.overall] || "",
    })),
    trades: tradesFromSim(sim, year),
  };
}

// Weekly picks → the mock editor's picks ({ [pickNumber]: pick }, the shape
// pages/CreateMock.jsx and ViewMock.js use), each keeping its slot.
export function mockPicksFrom(picks) {
  return Object.fromEntries(picks.map((p) => [p.overall, {
    pickNumber: p.overall, round: p.round, originalTeam: p.original, currentTeam: p.owner,
    tradedFrom: p.owner !== p.original ? p.original : null, note: p.note || "", selection: p.player, slot: p.slot,
  }]));
}

// A mock's picks (after the admin's edits) → weekly picks, slots worked out
// again from each pick's round and original team — a pick the editor added
// has none of its own.
export function weeklyPicksFromMock(mockPicks, rounds = Infinity) {
  const picks = Object.values(mockPicks || {}).filter((p) => p.round <= rounds)
    .map((p) => ({ overall: p.pickNumber, round: p.round, original: p.originalTeam, owner: p.currentTeam, player: playerOf(p.selection), note: (p.note || "").trim() }));
  const slots = slotKeys(picks);
  return picks.sort((a, b) => a.overall - b.overall).map((p) => ({ slot: slots[p.overall], ...p }));
}

// One team's page: its picks this week, each with that slot last week
// (prev: { overall, owner, player } or null), and the trades it made —
// [{ up (it moved up?), with (the other team), at, got, gave }].
export function teamWeek(latest, previous, team) {
  const before = Object.fromEntries((previous?.picks || []).map((p) => [p.slot, p]));
  const mine = (latest?.picks || []).filter((p) => p.owner === team).sort((a, b) => a.overall - b.overall);
  return {
    picks: mine.map((p) => {
      const was = before[p.slot];
      return { ...p, prev: was ? { overall: was.overall, owner: was.owner, player: was.player } : null };
    }),
    trades: (latest?.trades || []).filter((t) => t.up === team || t.down === team).map((t) => (t.up === team
      ? { up: true, with: t.down, at: t.at, got: t.upGot, gave: t.downGot }
      : { up: false, with: t.up, at: t.at, got: t.downGot, gave: t.upGot })),
  };
}

// One team's "What changed this week?", from the players it took this week
// and last (by player id) — only facts the two weeks' picks show:
// { added: [{ player, round, overall }] (new to its picks), dropped:
// [{ player, round }] (gone from them), moved: [{ player, from, to }]
// (still its pick, another round), positions: [{ pos, was, now }] (how many
// it took at each, where that changed) }. null with no last week to compare.
export function teamChanges(latest, previous, team) {
  if (!previous?.picks?.length) return null;
  const takes = (week) => (week?.picks || []).filter((p) => p.owner === team && p.player?.id);
  const now = takes(latest);
  const was = takes(previous);
  const wasById = Object.fromEntries(was.map((p) => [p.player.id, p]));
  const nowById = Object.fromEntries(now.map((p) => [p.player.id, p]));
  const count = (list) => list.reduce((m, p) => ({ ...m, [p.player.Position]: (m[p.player.Position] || 0) + 1 }), {});
  const before = count(was);
  const after = count(now);
  return {
    added: now.filter((p) => !wasById[p.player.id]).map((p) => ({ player: p.player, round: p.round, overall: p.overall })),
    dropped: was.filter((p) => !nowById[p.player.id]).map((p) => ({ player: p.player, round: p.round })),
    moved: now.filter((p) => wasById[p.player.id] && wasById[p.player.id].round !== p.round)
      .map((p) => ({ player: p.player, from: wasById[p.player.id].round, to: p.round })),
    positions: [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .filter((pos) => (before[pos] || 0) !== (after[pos] || 0))
      .map((pos) => ({ pos, was: before[pos] || 0, now: after[pos] || 0 })),
  };
}

// ── The next class's mock ──

// The teams that can take a QB in the next class's mock: a need, a want or
// Set at QB this year (needs — the labels before nextYearNeeds) and no QB
// of their own in round 1 of this year's mock (picks: the week's). A
// crowded room, a backup-only need, no QB label, or a first-round QB this
// year rules a team out.
const QB_ELIGIBLE_LABELS = ["Upgrade Needed", "Expiring Contract", "Aging Talent", "Upgrade Wanted", "Set"];
export function qbEligibleTeams(needs, picks) {
  const firstRoundQb = new Set((picks || []).filter((p) => p.round === 1 && p.player?.Position === "QB").map((p) => p.owner));
  return Object.entries(needs || {})
    .filter(([team, n]) => !firstRoundQb.has(team) && (n?.QB?.labels || []).some((l) => QB_ELIGIBLE_LABELS.includes(l)))
    .map(([team]) => team)
    .sort();
}

// The positions each team may take in the next class's mock (engine
// posRules): in rounds 1–2, one it lists this year (needs — the labels
// before nextYearNeeds) at a need, a want or Set, and didn't take in round
// 1 of this year's mock (picks: the week's; the player as `board` has him,
// for his sub-position); from round 3, any — a QB only for a team still
// looking for one a year on (an upgrade or a backup, nextYearNeeds — not
// Set or a crowded room, as a QB drafted this year leaves it). The engine
// adds the rest: never one position twice, this year's picks before it
// included. → { [team]: { early: [need keys], qbLate } }.
const EARLY_LABELS = ["Upgrade Needed", "Expiring Contract", "Aging Talent", "Upgrade Wanted", "Set"];
const QB_LATE_LABELS = ["Upgrade Needed", "Expiring Contract", "Aging Talent", "Upgrade Wanted", "Depth Needed"];
export function nextYearRules(needs, picks, board = []) {
  const byId = Object.fromEntries(board.map((p) => [p.id, p]));
  const firstRound = {};
  (picks || []).filter((pk) => pk.round === 1 && pk.player).forEach((pk) => {
    const p = byId[pk.player.id] || pk.player;
    needKeysFor(p).forEach(({ key }) => { (firstRound[pk.owner] = firstRound[pk.owner] || new Set()).add(key); });
  });
  const later = nextYearNeeds(needs, picks, board).needs;
  return Object.fromEntries(Object.entries(needs || {}).map(([team, n]) => [team, {
    early: NEED_KEYS.filter((k) => (n?.[k]?.labels || []).some((l) => EARLY_LABELS.includes(l)) && !firstRound[team]?.has(k)),
    qbLate: (later[team]?.QB?.labels || []).some((l) => QB_LATE_LABELS.includes(l)),
  }]));
}

// The teams posRules let take a QB at all — no "room is full" penalty for them (engine qbTeams).
export const qbTeamsOf = (rules) => Object.entries(rules).filter(([, r]) => r.early.includes("QB") || r.qbLate).map(([t]) => t).sort();

// The next class's order, a year out, shuffled in tiers of its first round
// (ORDER_TIERS: picks 1–10, 11–20, the last 12), each team keeping the tier
// it was in; every round then follows that first-round order. order:
// fetchDraft's [{ Pick, Round, Team, Traded }]; a team's extra (comp) picks
// in a round go with its own. → a copy, renumbered.
export const ORDER_TIERS = [10, 10, 12];
export const TIERED_ORDER_NOTE = "The {year} draft order is a year away, so this mock shuffles it in tiers: the teams projected to pick 1–10, 11–20 and 21–32 are each drawn at random within their group, and that first-round order carries through every round.";
export function tieredOrder(order, rand) {
  const byRound = {};
  (order || []).forEach((p) => (byRound[p.Round] || (byRound[p.Round] = [])).push(p));
  const first = [...(byRound[1] || [])].sort((a, b) => a.Pick - b.Pick);
  const teams = [...new Set(first.map((p) => p.Team))];
  const ranked = [];
  let at = 0;
  ORDER_TIERS.forEach((size, i) => {
    const tier = teams.slice(at, i === ORDER_TIERS.length - 1 ? teams.length : at + size);
    at += tier.length;
    for (let k = tier.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [tier[k], tier[j]] = [tier[j], tier[k]];
    }
    ranked.push(...tier);
  });
  const rank = (t) => (ranked.includes(t) ? ranked.indexOf(t) : ranked.length);
  return Object.values(byRound).flatMap((picks) => {
    const numbers = picks.map((p) => p.Pick).sort((a, b) => a - b);
    return [...picks].sort((a, b) => rank(a.Team) - rank(b.Team) || a.Pick - b.Pick).map((p, i) => ({ ...p, Pick: numbers[i] }));
  }).sort((a, b) => a.Pick - b.Pick);
}

// This year's trades (tradesFromSim's) of the next class's picks, carried
// onto its order (fetchDraft's [{ Pick, Round, Team, Traded }]), in the order
// they were made. → { order (a copy), carried: [{ round, original, from,
// to }] } — the picks that end up with a new team: `to` holds it now, got it
// from `from` (in its last trade).
export function carryTrades(order, trades, year) {
  const y = String(year);
  const holder = (p) => p.Traded || p.Team;
  const out = (order || []).map((p) => ({ ...p }));
  const moved = {};
  (trades || []).forEach((t) => {
    [[t.upGot, t.up, t.down], [t.downGot, t.down, t.up]].forEach(([got, to, from]) => {
      (got || []).filter((p) => String(p.year) === y).forEach((p) => {
        const same = out.filter((o) => o.Round === p.round && o.Team === p.original);
        const pick = same.find((o) => holder(o) === from) || same[0];
        if (!pick) return;
        if (!moved[pick.Pick]) moved[pick.Pick] = { was: holder(pick) };
        moved[pick.Pick].from = from;
        pick.Traded = to === pick.Team ? null : to;
      });
    });
  });
  const carried = out.filter((p) => moved[p.Pick] && holder(p) !== moved[p.Pick].was)
    .map((p) => ({ round: p.Round, original: p.Team, from: moved[p.Pick].from, to: holder(p) }));
  return { order: out, carried };
}

// What a pick does for a need next year, by round: a starter fills it, a
// contributor holds it where it is, depth only answers a depth need. A
// quarterback only counts toward an upgrade in round 1 — a QB from round 2
// on is depth, answering only a backup need. Two contributors at one need
// count as a starter.
const STARTER_ROUNDS = 2;
const CONTRIBUTOR_ROUNDS = 4;
const QB_ROUNDS = 1;
function coverOf(rounds, key) {
  if (key === "QB") return rounds.some((r) => r <= QB_ROUNDS) ? "starter" : rounds.length ? "depth" : null;
  const starter = rounds.filter((r) => r <= STARTER_ROUNDS).length;
  const contributor = rounds.filter((r) => r > STARTER_ROUNDS && r <= CONTRIBUTOR_ROUNDS).length;
  if (starter || contributor >= 2) return "starter";
  if (contributor) return "contributor";
  return rounds.length ? "depth" : null;
}

// A year on, with nothing drafted for it, a need moves up a tier: depth
// becomes an upgrade wanted, an upgrade wanted becomes needed, and an
// expiring contract or aging starter is a hole. Set and Crowded Room aren't
// needs, so they stay — a crowded QB room is usually a franchise QB.
const A_YEAR_ON = {
  "Upgrade Needed": "Upgrade Needed", "Expiring Contract": "Upgrade Needed", "Aging Talent": "Upgrade Needed",
  "Upgrade Wanted": "Upgrade Needed", "Depth Needed": "Upgrade Wanted", Set: "Set", "Crowded Room": "Crowded Room",
};
// key: the need's position — a backup QB need (Depth Needed) stays one:
// the team has its starter, and a year on it still wants a backup, not a
// new starter.
export function nextYearLabel(label, cover, key = "") {
  if (label === "Set" || label === "Crowded Room") return label;
  if (key === "QB" && label === "Depth Needed") return cover ? "Set" : "Depth Needed";
  if (cover === "starter") return "Set";
  if (cover === "contributor") {
    if (label === "Depth Needed") return "Set";
    if (label === "Expiring Contract" || label === "Aging Talent") return "Upgrade Wanted";
    return label;
  }
  if (cover === "depth" && label === "Depth Needed") return "Set";
  return A_YEAR_ON[label] || label;
}

// Every team's needs (loadSimData's: { [team]: { [key]: { labels, note } } })
// a year on from the picks it made (a week's picks: [{ owner, round,
// player }]). A pick answers the needs its player fills — his position
// (needKeysFor; half a share, as an OL or DB with no sub-position, counts)
// and any specific need he fits (specificFits) — the player as `board` has
// him when he's on it (sub-position, strengths), else as saved.
// → { needs, changes: [{ team, key, from, to, cover }] }.
export function nextYearNeeds(needs, picks, board = []) {
  const byId = Object.fromEntries(board.map((p) => [p.id, p]));
  const rounds = {};
  (picks || []).forEach((pk) => {
    if (!pk.player) return;
    const p = byId[pk.player.id] || pk.player;
    const keys = [
      ...needKeysFor(p).filter((k) => k.share >= 0.5).map((k) => k.key),
      ...specificFits(p, board).filter((f) => f.fit >= 0.5).map((f) => f.key),
    ];
    const team = (rounds[pk.owner] = rounds[pk.owner] || {});
    keys.forEach((key) => { (team[key] = team[key] || []).push(pk.round); });
  });
  const out = {};
  const changes = [];
  Object.entries(needs || {}).forEach(([team, teamNeeds]) => {
    out[team] = {};
    Object.entries(teamNeeds || {}).forEach(([key, n]) => {
      const cover = coverOf(rounds[team]?.[key] || [], key);
      let labels = [...new Set((n.labels || []).map((l) => nextYearLabel(l, cover, key)))];
      if (labels.length > 1) labels = labels.filter((l) => l !== "Set");
      labels.sort((a, b) => NEED_LABELS.indexOf(a) - NEED_LABELS.indexOf(b));
      out[team][key] = { ...n, labels };
      if (labels.join() !== (n.labels || []).join()) changes.push({ team, key, from: n.labels || [], to: labels, cover });
    });
  });
  return { needs: out, changes };
}
