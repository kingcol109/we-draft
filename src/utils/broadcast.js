// src/utils/broadcast.js
//
// Pure helpers for the We-Draft Live broadcast renderer (/broadcast/:slug —
// pages/BroadcastPage.js, hooks/useBroadcastState.js, src/broadcast/*).
// Nothing here reads Firestore: everything works on the same liveGames /
// plays / box/live docs and the same derived feed state (hooks/useGameFeed.js)
// the /live game view uses, so the broadcast and the site never disagree.

import { periodLabel, downLabel, spotLabel, teamShort, statusLabel } from "./live";
import { briefPlay, briefSide } from "./briefPlay";
import { statLine } from "./liveStats";
import { TAKEOVER_POINTS } from "../components/HeaderTakeover";
import { playCall } from "./playCall";

// The broadcast canvas — every layout measurement is in these pixels.
export const BROADCAST_W = 1920;
export const BROADCAST_H = 1080;

// ── Calls to action ──
// The ticker along the bottom rotates through these (CTA_ROTATE_MS each).
// Edit freely: label is the line, url(game) the address shown — written
// out in full on purpose, so a viewer can type it. The player card and
// event graphics add a player's own profile link on top of these.
export const CTA_ROTATE_MS = 14 * 1000;
export const BROADCAST_CTAS = [
  { key: "live", label: "Live Stats and All Games", url: () => "we-draft.com/live" },
  { key: "prospects", label: "Scouting reports on every prospect in this game", url: () => "we-draft.com" },
  { key: "wepick", label: "Pick the games · climb the We-Pick standings", url: () => "we-draft.com/live/we-pick" },
  { key: "board", label: "Build your own big board", url: () => "we-draft.com/boards" },
];
export const playerUrl = (slug) => (slug ? `we-draft.com/player/${slug}` : null);

// ── Phase ──
// Which screen the broadcast shows:
//   loading   waiting on the first game snapshot
//   missing   no such game
//   pregame   scheduled, kickoff still ahead
//   kickoff   kickoff time has come but no snap is on screen yet (still
//             scheduled, or live before its first play) — the live layout
//             at 1st 15:00, 0–0, "Kickoff shortly" (useGameFeed preKick)
//   live      in progress (quarter breaks and timeouts are part of live)
//   halftime  in progress, at the half
//   final     game over
// Data health (stale live data) is separate — any phase keeps showing its
// last known state with a notice; see useBroadcastState.
export function broadcastPhase({ ready, game, next, preKick = false }) {
  if (!game) return ready ? "missing" : "loading";
  if (game.status === "final") return "final";
  if (preKick) return "kickoff";
  if (game.status === "in_progress") {
    return next?.brk?.label === "HALFTIME" || statusLabel(game) === "HALFTIME" ? "halftime" : "live";
  }
  return "pregame";
}

// ── Events ──
// A broadcast event is a temporary graphic over the normal screen:
//   { id, type, side, durationMs, playId?, subtitle?, player?, hold?, ... }
// The renderer looks `type` up in its graphics registry
// (src/broadcast/BroadcastEvents.js) — a new event type is one entry there
// plus a rule here. Events are queued and play one at a time.
export const EVENT_MS = {
  TOUCHDOWN: 7500,
  FIELD_GOAL: 4800,
  SAFETY: 4800,
  INTERCEPTION: 5200,
  FUMBLE: 5200,
  TURNOVER_ON_DOWNS: 4600,
  SACK: 4000,
  FOURTH_DOWN_CONVERSION: 4200,
  BIG_PLAY: 5200,
  HALFTIME: 6000,
  END_OF_GAME: 9000,
  // the cards over the team stats — their own lane (useBroadcastState), so a
  // long read never holds back a play graphic
  PLAYER_MILESTONE: 22000,
  TEAM_TREND: 18000,
};

const other = (s) => (s === "home" ? "away" : s === "away" ? "home" : null);

// The player a play's graphic features: the play's lead (the defender on
// a sack / pick, the returner on a return), else the scorer / ball carrier.
export function featuredPlayer(play) {
  const pr = play?.presentation || {};
  const P = pr.players || {};
  const lead = (pr.line || []).find((t) => t.player && t.lead)?.player;
  const pick = lead || (pr.touchdown && (P.receiver || P.rusher || P.returner)) || P.receiver || P.rusher || P.returner || P.kicker
    || (pr.line || []).find((t) => t.player)?.player;
  return pick ? { name: pick.name, slug: pick.wedraftSlug || null, cfbdId: pick.cfbdId || null } : null;
}

const TAKEOVER_EVENT = {
  td: ["TOUCHDOWN", null],
  pick6: ["TOUCHDOWN", "Pick-six"],
  fumble6: ["TOUCHDOWN", "Fumble return"],
  kr6: ["TOUCHDOWN", "Kick return"],
  pr6: ["TOUCHDOWN", "Punt return"],
  fg: ["FIELD_GOAL", null],
  safety: ["SAFETY", null],
  int: ["INTERCEPTION", null],
  fumble: ["FUMBLE", "Recovered"],
};

// The event a newly revealed play calls for, or null. tk: the play's
// checked takeover (useGameFeed slotTk — same detector /live's scoreboard
// uses), so a touchdown is a touchdown on both. hold: the score before the
// play, kept on the scorebug until a scoring graphic ends.
export function eventForPlay(play, tk, hold) {
  if (!play) return null;
  const pr = play.presentation || {};
  const tags = play.bigPlay?.tags || [];
  const base = {
    id: `play-${play.id}`,
    playId: play.id,
    player: featuredPlayer(play),
    detail: briefPlay(play, null),
    leadChange: tags.includes("lead-change"),
  };
  if (tk && TAKEOVER_EVENT[tk.kind]) {
    const [type, subtitle] = TAKEOVER_EVENT[tk.kind];
    return { ...base, type, side: tk.side, subtitle, durationMs: EVENT_MS[type], hold: TAKEOVER_POINTS[tk.kind] ? hold : null };
  }
  if (pr.nullified || play.hidden) return null;
  if (pr.downsTurnover || tags.includes("fourth-down-stop")) return { ...base, type: "TURNOVER_ON_DOWNS", side: other(play.offense), durationMs: EVENT_MS.TURNOVER_ON_DOWNS };
  if (tags.includes("fourth-down-conversion")) return { ...base, type: "FOURTH_DOWN_CONVERSION", side: play.offense, durationMs: EVENT_MS.FOURTH_DOWN_CONVERSION };
  if (pr.type === "sack") return { ...base, type: "SACK", side: pr.creditSide || other(play.offense), durationMs: EVENT_MS.SACK };
  if (tags.some((t) => t === "big-pass" || t === "big-rush" || t === "big-reception")) {
    const y = play.yards ?? pr.yards;
    return { ...base, type: "BIG_PLAY", side: play.offense, yards: y || null, subtitle: y ? `${y}-yard ${pr.type === "rush" ? "run" : "gain"}` : null, durationMs: EVENT_MS.BIG_PLAY };
  }
  return null;
}

// An insight card (server/live/insights.js) as an event: a player's
// milestone / We-Draft prospect moment, or a team / game trend.
export function eventForInsight(ins) {
  if (!ins?.id) return null;
  const player = ins.kind === "player";
  return {
    id: `ins-${ins.id}`,
    type: player ? "PLAYER_MILESTONE" : "TEAM_TREND",
    side: ins.side || null,
    durationMs: player ? EVENT_MS.PLAYER_MILESTONE : EVENT_MS.TEAM_TREND,
    insight: ins,
    player: player && ins.player ? { name: ins.player.name, slug: ins.player.slug || null, cfbdId: ins.player.cfbdId || null } : null,
  };
}

// ── Player stats on the plays ──
// The broadcast has no stats tab, so each play carries its players'
// numbers so far. Those come from the live stats doc (box/live), which the
// ingester rewrites as soon as plays land — ahead of the reveal. So the
// numbers shown are that doc minus the plays still waiting to be revealed
// (subtractStats), the same rule that holds the score: nothing on screen
// gets ahead of the plays on screen.

// stats minus less (both { teams, players: { home: [...], away: [...] } },
// liveStats.mjs computeGameStats shape). Counts subtract; a play's `long`
// can't be taken back out, so it stays.
const KEEP = new Set(["long"]);
export function subtractStats(stats, less) {
  if (!stats?.players || !less?.players) return stats;
  // Team totals too (counts and [made, att] pairs); yards per play redone.
  const teams = stats.teams && less.teams ? Object.fromEntries(Object.entries(stats.teams).map(([side, T]) => {
    const L = less.teams[side];
    if (!T || !L) return [side, T];
    const out = { ...T };
    for (const [k, v] of Object.entries(T)) {
      if (typeof v === "number" && typeof L[k] === "number") out[k] = Math.max(0, v - L[k]);
      else if (Array.isArray(v) && Array.isArray(L[k])) out[k] = v.map((x, i) => Math.max(0, x - (L[k][i] || 0)));
    }
    out.totalYds = (T.totalYds ?? 0) - (L.totalYds ?? 0);
    out.ypp = out.plays ? out.totalYds / out.plays : 0;
    return [side, out];
  })) : stats.teams;
  const minus = new Map();
  for (const side of ["home", "away"]) for (const l of less.players[side] || []) minus.set(`${side}|${l.key}`, l.stats);
  if (!minus.size) return { ...stats, teams };
  const players = {};
  for (const side of ["home", "away"]) {
    players[side] = (stats.players[side] || []).map((l) => {
      const m = minus.get(`${side}|${l.key}`);
      if (!m) return l;
      const out = {};
      for (const [cat, vals] of Object.entries(l.stats || {})) {
        const mv = m[cat] || {};
        out[cat] = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, KEEP.has(k) || typeof v !== "number" ? v : Math.max(0, v - (mv[k] || 0))]));
      }
      return { ...l, stats: out };
    });
  }
  return { ...stats, teams, players };
}

// Which stat line goes with each role on a play (playParser presentation.players).
const ROLE_CAT = {
  passer: "passing", receiver: "receiving", rusher: "rushing", fumbler: "rushing",
  interceptor: "defense", sacker: "defense", sackers: "defense", recoverer: "defense", forcedBy: "defense",
};
const DEF_ROLES = new Set(["interceptor", "sacker", "sackers", "recoverer", "forcedBy"]);

// The players on a play with their game line so far, in the order the play
// reads ("Passer → Receiver", the sacker first on a sack). Up to `max`.
//   [{ key, name, short, slug, side, cat, line }]
export function playStatLines(play, stats, max = 2) {
  const pr = play?.presentation;
  if (!pr?.players || !stats?.players || pr.nullified) return [];
  const off = play.offense;
  const def = other(off);
  const lines = new Map();
  for (const side of ["home", "away"]) for (const l of stats.players[side] || []) lines.set(String(l.key), l);
  const order = (pr.line || []).filter((t) => t.player).map((t) => t.player.cfbdId || t.player.name);
  const found = [];
  for (const [role, cat] of Object.entries(ROLE_CAT)) {
    const v = pr.players[role];
    for (const pl of Array.isArray(v) ? v : v ? [v] : []) {
      const side = pl.side || (DEF_ROLES.has(role) ? def : off);
      const l = lines.get(String(pl.cfbdId)) || lines.get(`${side}|${pl.name}`);
      // (no "LONG n" — on a chip the counting stats matter more than the room it takes)
      const text = l ? statLine(cat, l.stats?.[cat]).replace(/ · LONG -?\d+/, "") : "";
      if (!text || found.some((f) => f.key === l.key)) continue;
      const at = order.indexOf(pl.cfbdId || pl.name);
      found.push({ key: l.key, name: pl.name, short: pl.short || pl.name, slug: pl.wedraftSlug || l.slug || null, side: l.side || side, cat, line: text, at: at < 0 ? 99 : at });
    }
  }
  return found.sort((a, b) => a.at - b.at).slice(0, max);
}

// ── Plays ──
// The play on the main panel: the play just revealed (usePlayReveal's slot).
export function playView(play, game, stats) {
  if (!play) return null;
  const pr = play.presentation || {};
  const side = pr.type === "timeout" ? null : pr.creditSide || play.offense;
  return {
    stats: playStatLines(play, stats).map((x) => ({ ...x, team: game?.[x.side] || null })),
    id: play.id,
    headline: pr.headline || play.type || "",
    line: pr.line?.length ? pr.line.map((t) => ({ text: t.player ? t.player.name : t.text, player: !!t.player, lead: !!t.lead, sub: !!t.sub, slug: t.player?.wedraftSlug || null })) : null,
    text: pr.line?.length ? null : (pr.fallbackText || play.text || "").replace(/^\(\d{1,2}:\d{2}\)\s*/, ""),
    detail: [pr.detail, pr.penaltyText ? `Flag · ${pr.penaltyText}` : null].filter(Boolean).join(" · "),
    firstDown: !!pr.firstDown,
    tone: pr.touchdown ? "td" : pr.turnover ? "turnover" : pr.nullified || pr.type === "penalty" ? "flag" : pr.type === "incomplete" ? "miss" : (play.yards ?? pr.yards ?? 0) >= 20 ? "big" : "normal",
    miss: pr.type === "incomplete",
    team: side ? game?.[side] || null : null,
    clock: [periodLabel(play.period), play.period > 4 ? null : play.clock].filter(Boolean).join(" "),
    situation: play.down ? downLabel(play.down, play.distance != null && play.yardsToGoal != null && play.distance >= play.yardsToGoal ? "Goal" : play.distance) : null,
  };
}

// A new play's first beat (utils/playCall.js): the call and the player,
// before the result replaces it on the main panel.
export function callView(play, game) {
  const c = playCall(play);
  if (!c) return null;
  return {
    id: play.id,
    label: c.label,
    player: c.player?.name || null,
    team: play.offense ? game?.[play.offense] || null : null,
    clock: [periodLabel(play.period), play.period > 4 ? null : play.clock].filter(Boolean).join(" "),
    // a kick isn't a down
    situation: play.down && !NO_DOWN.has(play.presentation?.type) ? downLabel(play.down, play.distance != null && play.yardsToGoal != null && play.distance >= play.yardsToGoal ? "Goal" : play.distance) : null,
  };
}
const NO_DOWN = new Set(["kickoff", "conversion"]);

// The recent-plays list: one short line each (utils/briefPlay.js — the
// pop-out scoreboard's wording), newest first.
// stat: the play's first player's line so far (his numbers now, not as of
// that play — the list is a running view of the game).
export function recentPlayRows(newestListed, game, stats, n = 4) {
  return newestListed
    .filter((p) => p.presentation && !p.presentation.nullified && p.presentation.type !== "timeout")
    .slice(0, n)
    .map((p) => {
      const pr = p.presentation;
      // the logo of the team whose player the line names (briefSide)
      const side = briefSide(p);
      return {
        id: p.id,
        clock: [periodLabel(p.period), p.period > 4 ? null : p.clock].filter(Boolean).join(" "),
        text: briefPlay(p, null),
        team: side ? game?.[side] || null : null,
        tone: pr.touchdown ? "td" : pr.turnover ? "turnover" : "normal",
        stat: playStatLines(p, stats, 1)[0] || null,
      };
    });
}

// "2nd & 7" / "1st & Goal" and "Ball on USM 35" for the situation bar.
export function situationView(snapNext, game) {
  if (!snapNext?.down) return null;
  const off = game?.[snapNext.offense];
  const def = game?.[other(snapNext.offense)];
  return {
    offense: snapNext.offense,
    down: downLabel(snapNext.down, snapNext.distance),
    spot: snapNext.ytg != null ? spotLabel(snapNext.ytg, off, def) : null,
    ytg: snapNext.ytg,
    distance: snapNext.distance,
    brk: snapNext.brk?.label || null,
    changeOfPossession: !!(snapNext.changeOfPossession || snapNext.downsTurnover),
  };
}

// ── Player Watch ──
// We-Draft players in this game — never a list of our own: the ingester
// resolves them from the live player ids (cfbdPlayers → players, see
// server/live/breaks.js gamePlayers → liveGames/{id}.prospects), and their
// live numbers come from the play-by-play stats doc (box/live) by profile
// slug. Ordered by how big a game they're having, then by grade.
const perfScore = (st = {}) => {
  const ps = st.passing || {}, ru = st.rushing || {}, re = st.receiving || {}, de = st.defense || {};
  return (ps.yds || 0) * 0.04 + (ps.td || 0) * 4 - (ps.int || 0) * 2
    + (ru.yds || 0) * 0.1 + (ru.td || 0) * 6
    + (re.yds || 0) * 0.1 + (re.td || 0) * 6 + (re.rec || 0) * 0.5
    + (de.sacks || 0) * 3 + (de.int || 0) * 4 + (de.ff || 0) * 2 + (de.fr || 0) * 2;
};

const n1 = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
// Up to three big numbers for a player's card, from his best category.
export function statTiles(stats = {}) {
  const cats = [
    ["passing", (s) => (s.att ? [[`${s.cmp || 0}/${s.att}`, "CMP/ATT"], [s.yds || 0, "PASS YDS"], [s.td || 0, "TD"], s.int ? [s.int, "INT"] : null] : null)],
    ["rushing", (s) => (s.car ? [[s.car, "CARRIES"], [s.yds || 0, "RUSH YDS"], [s.td || 0, "TD"]] : null)],
    ["receiving", (s) => (s.rec ? [[s.rec, "REC"], [s.yds || 0, "REC YDS"], [s.td || 0, "TD"]] : null)],
    ["defense", (s) => {
      const out = [s.sacks && [n1(s.sacks), s.sacks === 1 ? "SACK" : "SACKS"], s.int && [s.int, "INT"], s.ff && [s.ff, "FORCED FUM"], s.fr && [s.fr, "FUM REC"]].filter(Boolean);
      return out.length ? out : null;
    }],
  ];
  const weight = { passing: (s) => (s.yds || 0) * 0.04 + (s.td || 0) * 4, rushing: (s) => (s.yds || 0) * 0.1 + (s.td || 0) * 6, receiving: (s) => (s.yds || 0) * 0.1 + (s.td || 0) * 6 + (s.rec || 0) * 0.5, defense: (s) => perfScore({ defense: s }) };
  const best = cats.filter(([c]) => stats[c]).map(([c, f]) => ({ c, tiles: f(stats[c]), w: weight[c](stats[c]) }))
    .filter((x) => x.tiles).sort((a, b) => b.w - a.w)[0];
  return best ? best.tiles.filter(Boolean).slice(0, 3).map(([value, label]) => ({ value: String(value), label })) : [];
}

const WATCH_MAX = 6;
const POS_ORDER = ["QB", "WR", "RB", "EDGE", "TE", "DL", "CB", "LB", "S", "OT", "IOL", "OL", "ATH", "K", "P", "LS"];
// game: liveGames doc (prospects: server-resolved We-Draft players);
// stats: box/live doc; extra: pregame prospects ({ name, slug, side, pos, cls }).
export function playerWatchList(game, stats, extra = []) {
  const bySlug = new Map();
  for (const side of ["home", "away"]) for (const l of stats?.players?.[side] || []) if (l.slug) bySlug.set(l.slug, { ...l, side });
  const base = (game?.prospects?.length ? game.prospects : extra).filter((p) => p.slug);
  const seen = new Set();
  const out = [];
  for (const p of base) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    const line = bySlug.get(p.slug);
    out.push({ slug: p.slug, name: p.name, side: p.side, pos: p.pos || null, cls: p.cls || null, grade: p.grade || null, gradeAvg: p.gradeAvg ?? null, stats: line?.stats || null, score: line ? perfScore(line.stats) : 0 });
  }
  // A linked player who's playing but isn't in the prospects list (no
  // active class, or an older game doc): still a We-Draft player.
  for (const [slug, l] of bySlug) {
    if (seen.has(slug)) continue;
    const s = perfScore(l.stats);
    if (s >= 6) out.push({ slug, name: l.name, side: l.side, pos: null, cls: null, grade: null, gradeAvg: null, stats: l.stats, score: s });
  }
  // Ties (before kickoff nobody has numbers, and ungraded players all tie)
  // alternate teams and lead with the skill positions, so neither roster
  // fills the card alone.
  const pri = (pos) => { const i = POS_ORDER.indexOf(String(pos || "").toUpperCase()); return i < 0 ? POS_ORDER.length : i; };
  const nth = { home: 0, away: 0 };
  const ordered = [...out].sort((a, b) => pri(a.pos) - pri(b.pos)).map((p) => ({ ...p, turn: nth[p.side] !== undefined ? nth[p.side]++ : 99 }));
  return ordered
    .sort((a, b) => b.score - a.score || (a.gradeAvg ?? 99) - (b.gradeAvg ?? 99) || a.turn - b.turn)
    .slice(0, WATCH_MAX)
    .map((p) => ({ ...p, team: game?.[p.side] || null, tiles: statTiles(p.stats || {}) }));
}

// ── Team colors ──
// A team's panel color, readable under white text: its primary, else its
// second color when the primary is too light (white / yellow / silver
// schools), else a darkened primary.
const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function panelColor(team, fallback = "#16305a") {
  const c = team?.color;
  if (c && (lum(c) ?? 1) < 0.45) return c;
  if (team?.color2 && (lum(team.color2) ?? 1) < 0.45) return team.color2;
  return c ? `color-mix(in srgb, ${c} 45%, #0a1222)` : fallback;
}

// A team color for a thin bar on the dark panels: very dark colors (navy,
// deep maroon) are lifted toward white so they still read.
export function barColor(c) {
  const l = lum(c);
  if (l == null) return c;
  return l < 0.05 ? `color-mix(in srgb, ${c} 50%, #ffffff)` : l < 0.12 ? `color-mix(in srgb, ${c} 70%, #ffffff)` : c;
}

// A team's accent for its big-play graphics (stripes, border, "+6"): its
// second color, else a lighter shade of its main one — always the team's
// own colors, never We-Draft's.
export function accentColor(team, fallback = "#dfe6f0") {
  if (team?.color2) return team.color2;
  if (team?.color) return `color-mix(in srgb, ${team.color} 50%, #ffffff)`;
  return fallback;
}

// The accent for text and numbers on a team's dark panel (panelColor): the
// team's accent when it reads there, white when it's too dark to (a navy or
// black second color — the "+6" would vanish into the panel).
export function readableAccent(team, fallback = "#dfe6f0") {
  const c = accentColor(team, fallback);
  const l = lum(c);
  return l != null && l < 0.3 ? "#ffffff" : c;
}

export const shortName = teamShort;
