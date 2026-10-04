// src/utils/live.js
//
// Shared helpers for We-Draft Live (LivePage.js, GamePage.js,
// useLiveGame.js). Everything here works on the normalized liveGames /
// liveSlate / plays docs the server-side ingester writes
// (server/live/store.js) — nothing in the frontend knows about CFBD.

// Game order: quarter, then game clock counting down, then sequence —
// same comparator as server/live/provider.js's comparePlays.
export const comparePlays = (a, b) =>
  (a.period || 0) - (b.period || 0)
  || (a.clockSeconds != null && b.clockSeconds != null ? b.clockSeconds - a.clockSeconds : 0)
  || (a.seq || 0) - (b.seq || 0);

export const periodLabel = (p) => {
  if (!p) return "";
  if (p <= 4) return `Q${p}`;
  return p === 5 ? "OT" : `${p - 4}OT`;
};

export const kickoffLabel = (startDate) => {
  if (!startDate) return "";
  const d = new Date(startDate);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

// "Q3 8:42" | "FINAL" | "FINAL/OT" | "7:30 PM"
export function statusLabel(g) {
  if (!g) return "";
  if (g.status === "final") return g.period > 4 ? "FINAL/OT" : "FINAL";
  if (g.status === "in_progress") {
    if (!g.period) return "LIVE";
    // Overtime has no game clock (CFBD reports 0:00) — just "OT" / "2OT".
    // Line scores longer than 4 also mean overtime even if the period lags.
    const otPeriods = Math.max(g.period > 4 ? g.period : 0, g.home?.lineScores?.length > 4 ? g.home.lineScores.length : 0);
    if (otPeriods > 4) return periodLabel(otPeriods);
    // Clock at 0:00 between quarters — say what it is.
    if (/^0?0:00$/.test(g.clock || "")) {
      if (g.period === 2) return "HALFTIME";
      if (g.period === 4) {
        const tied = g.home?.points != null && g.home.points === g.away?.points;
        return tied ? "OT" : "END OF REG"; // tied after four → overtime next
      }
      return `END OF ${periodLabel(g.period)}`;
    }
    return `${periodLabel(g.period)}${g.clock ? ` ${g.clock}` : ""}`;
  }
  return kickoffLabel(g.startDate);
}

// downLabel(2) → "2nd Down"; downLabel(1, 10) → "1st & 10"
const ORD = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };
export function downLabel(down, distance) {
  if (!ORD[down]) return "";
  if (distance === undefined) return `${ORD[down]} Down`;
  return distance != null ? `${ORD[down]} & ${distance}` : ORD[down];
}

const clockSecs = (c) => { const m = /^(\d+):(\d+)/.exec(c || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// "UCF 39" / "BAMA 12" / "50" — where the ball is, from the offense's
// yards-to-goal (CFBD convention: distance to the opponent's end zone).
export function spotLabel(ytg, offense, defense) {
  if (ytg == null) return "";
  if (ytg === 50) return "50";
  return ytg > 50 ? `${teamShort(offense)} ${100 - ytg}` : `${teamShort(defense)} ${ytg}`;
}

const other = (side) => (side === "home" ? "away" : side === "away" ? "home" : null);
const SCRIMMAGE = new Set(["rush", "pass", "incomplete", "sack", "fumble"]);

// The upcoming snap, inferred from the last plays — the single source for
// everything the "next play" card shows, so its parts never disagree.
//   plays: the game's plays, newest first. game: liveGames doc.
// Returns null when there's no next snap to show (game not live, a score
// or PAT just happened → kickoff next, halftime handled as a break), else
//   { offense, down, distance, ytg, clock, period, brk?, flag?, approx? }
// where distance is a number or "Goal", ytg may be null (spot unknown),
// brk = { label, detail } for a timeout / end of quarter / halftime, flag =
// penalty text, approx = true when part of it came from CFBD's live state.
export function nextSituation(plays, game) {
  if (!game || game.status !== "in_progress" || !plays?.length) return null;
  const top = plays[0];
  const topType = top.presentation?.type;

  // A break: timeout or end of a quarter. The coming snap is whatever the
  // last real play left; halftime (end of Q2) means a kickoff is next.
  let brk = null;
  if (topType === "timeout") brk = { label: "TIMEOUT", detail: top.presentation?.detail || "" };
  if (topType === "period") {
    if (top.period === 2 || /HALF/.test(top.presentation?.headline || "")) return { brk: { label: "HALFTIME", detail: "" } };
    // Still live after the 4th (or an OT period) → overtime, fresh possessions.
    if (top.period >= 4) return { brk: { label: top.period === 4 ? "END OF REGULATION" : `END OF ${top.period - 4 > 1 ? `${top.period - 4}OT` : "OT"}`, detail: "Overtime next" } };
    brk = { label: top.presentation?.headline || "END OF QUARTER", detail: "Teams switch ends" };
  }
  const last = plays.find((p) => !["timeout", "period"].includes(p.presentation?.type));
  if (!last) return brk ? { brk } : null;
  const pr = last.presentation || {};
  const t = pr.type;

  // Scores / PATs / safeties → a kickoff (or free kick) is next.
  if (pr.touchdown || t === "conversion" || t === "safety" || (t === "field_goal" && /^FIELD GOAL$/.test(pr.headline || ""))) return brk?.label === "TIMEOUT" ? { brk } : null;

  const clock = (() => {
    // Prefer the live game clock only when it's consistent with the last play.
    const gs = clockSecs(game.clock);
    const ls = clockSecs(last.clock);
    if (game.period === last.period && gs != null && ls != null && gs <= ls) return game.clock;
    return last.clock;
  })();
  const base = { clock, period: last.period, brk };

  // CFBD's live state for a given offense (used when the play alone can't
  // say where the ball is — possession changes, penalties).
  const fromLive = (side) => (game.possession === side && game.down
    ? { offense: side, down: game.down, distance: game.distance != null && game.yardsToGoal != null && game.distance >= game.yardsToGoal ? "Goal" : game.distance, ytg: game.yardsToGoal ?? null, approx: true }
    : { offense: side, down: 1, distance: 10, ytg: null, approx: true });

  // Penalty (a flag on the play or an accepted penalty nullifying it).
  if (t === "penalty" || pr.nullified || pr.penaltyText) {
    const flag = t === "penalty" ? pr.detail : pr.penaltyText;
    return { ...base, ...fromLive(game.possession || last.offense), flag: flag || "Penalty" };
  }

  // Possession changes: the other team, 1st & 10 where the return/recovery
  // ended (presentation.endSpot, parsed from the play text) — else CFBD's
  // live state.
  const receiving = other(last.offense);
  const newSeries = () => {
    const end = pr.endSpot;
    if (end && (end.side || end.yardLine === 50)) {
      const ytg = end.yardLine === 50 ? 50 : end.side === receiving ? 100 - end.yardLine : end.yardLine;
      if (ytg > 0 && ytg < 100) return { offense: receiving, down: 1, distance: ytg <= 10 ? "Goal" : 10, ytg };
    }
    return fromLive(receiving);
  };
  if (pr.turnover) return { ...base, ...newSeries(), changeOfPossession: true };
  if (t === "kickoff" || t === "punt") {
    if (/Touchback/i.test(pr.detail || "")) return { ...base, offense: receiving, down: 1, distance: 10, ytg: t === "kickoff" ? 75 : 80 };
    return { ...base, ...newSeries() };
  }
  if (t === "field_goal") return { ...base, ...newSeries(), changeOfPossession: true }; // missed/blocked FG

  // A play from scrimmage: next down from the gain.
  if (SCRIMMAGE.has(t) && last.down && last.distance != null && last.yardsToGoal != null) {
    const yards = t === "incomplete" ? 0 : last.yards || 0;
    const ytg = Math.max(1, Math.min(99, last.yardsToGoal - yards));
    const goal = (d) => (d >= ytg ? "Goal" : d);
    if (pr.firstDown || yards >= last.distance) return { ...base, offense: last.offense, down: 1, distance: goal(10), ytg };
    if (last.down < 4) return { ...base, offense: last.offense, down: last.down + 1, distance: goal(last.distance - yards), ytg };
    // Stopped on 4th down — turnover on downs.
    const flipped = 100 - ytg;
    return { ...base, offense: receiving, down: 1, distance: 10 >= flipped ? "Goal" : 10, ytg: flipped, downsTurnover: true };
  }
  return { ...base, ...fromLive(game.possession || last.offense) };
}

// How "hot" a game is right now, 0..1: close (within 8) in the 4th quarter
// or overtime, rising as the clock runs down and as the margin narrows.
// Drives the clutch glow on /live tiles, the scores strip and the board.
export function clutchHeat(g) {
  if (!g || g.status !== "in_progress" || !g.period || g.period < 4) return 0;
  const hp = g.home?.points;
  const ap = g.away?.points;
  if (hp == null || ap == null) return 0;
  const margin = Math.abs(hp - ap);
  if (margin > 8) return 0;
  const closeness = margin <= 3 ? 1 : margin <= 7 ? 0.85 : 0.7;
  if (g.period > 4) return closeness; // overtime
  const secs = clockSecs(g.clock);
  const elapsed = 1 - Math.min(900, secs ?? 900) / 900;
  return Math.max(0.15, elapsed) * closeness;
}

// Feed entries that are really the same play (CFBD re-issued it under a new
// id): same game, quarter, clock and kind. Keeps the first — pass newest
// first. Mirrors server/live/store.js dedupeFeed.
export function dedupeFeed(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    if (e.clock == null) return true;
    const sig = `${e.gameId}|${e.period}|${e.clock}|${e.presentation?.type || e.label}|${(e.kinds || []).join(",")}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

export const teamName = (t) => t?.school || t?.name || "";
export const teamShort = (t) => t?.short || t?.school || t?.name || "";

// ── Follows (My Teams / My Players) ──
// Per-browser for now (a "second screen" usually isn't signed in); keyed
// by provider team / athlete ids so they keep working for teams and
// players without a We-Draft profile.
const read = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
};
const write = (key, v) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked — follows just won't persist */ }
};
export const FOLLOW_TEAMS_KEY = "wdLive.teams";
export const FOLLOW_PLAYERS_KEY = "wdLive.players";
export const loadFollows = (key) => read(key);
export const saveFollows = (key, list) => write(key, list);

// ── My Feed preferences (per browser) ──
// games.all overrides the individual game sources; otherwise the feed is
// the union of the checked sources. types filter by a feed entry's `kinds`
// (server/live/store.js feedKinds: "score" | "turnover" | "big").
export const FEED_PREFS_KEY = "wdLive.feedPrefs";
export const DEFAULT_FEED_PREFS = {
  games: { all: true, wepick: false, myTeams: false, featured: false },
  players: true,
  types: { score: true, big: true, turnover: true, final: true },
};
export function loadFeedPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(FEED_PREFS_KEY) || "null");
    if (!saved) return DEFAULT_FEED_PREFS;
    return {
      games: { ...DEFAULT_FEED_PREFS.games, ...saved.games },
      players: saved.players ?? DEFAULT_FEED_PREFS.players,
      types: { ...DEFAULT_FEED_PREFS.types, ...saved.types },
    };
  } catch {
    return DEFAULT_FEED_PREFS;
  }
}
export const saveFeedPrefs = (prefs) => write(FEED_PREFS_KEY, prefs);
