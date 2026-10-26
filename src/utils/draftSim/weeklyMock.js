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
// made in the latest published 2027 week (nextYearNeeds) — on the real 2028
// order, with no trades, and QBs only for the teams qbEligibleTeams names.
// Its pages are /mocks/{team}/2028.
//
// Pick numbers move week to week (the order follows the standings), so a
// pick is known by its slot — round, the team that originally owned it, and
// which of that team's picks in the round it is (a comp pick is its second):
// "1-NYJ-1" is the Jets' own first-rounder, "1-DAL-1" the one they got from
// Dallas, whoever holds it now.
import { initSim, stepCpu, NEED_LABELS, needKeysFor, specificFits } from "./engine";
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
// qbTeams: the only teams that take a QB, freely (the next class's — qbEligibleTeams).
export function runWeeklyMock(data, { seed = Date.now(), rounds = WEEKLY_ROUNDS, trades = WEEKLY_TRADES, qbTeams = null } = {}) {
  let s = initSim({
    order: data.order, futureOrder: data.futureOrder, futureYear: data.futureYear, board: data.board, chart: data.chart,
    staff: data.staff, needs: data.needs, userTeams: [], rounds, seed, cpuTrades: trades, variance: WEEKLY_VARIANCE, qbTeams,
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
export function weeklyNotes(sim, ctx) {
  const shared = { ...ctx, used: {} };
  return Object.fromEntries((sim.pickEvents || []).map((e) => [e.pick.overall, pickNote(e, shared)]));
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
