// src/utils/broadcastNational.js
//
// Pure helpers for the national broadcast (/broadcast/national —
// pages/BroadcastNationalPage.js, hooks/useNationalState.js,
// src/broadcast/NationalScreen.js): no one game, but the big plays and
// storylines from every game on, read from liveSlate/current (the compact
// doc /live's scoreboard listens to — server/live/store.js slateGame /
// slateBigPlay) plus the live games' own docs (insight cards, statLeaders —
// each game's current top lines — and its We-Draft prospects). Nothing here
// reads Firestore.

import { teamShort, teamName, periodLabel, statusLabel, clockSecs } from "./live";
import { featuredPlayer, EVENT_MS } from "./broadcast";
import { statLine } from "./liveStats";

// The scoreboard rail along the top: four scorebugs, and how long the
// rotating ones stay up before the next games take their place.
export const NATIONAL_PER_PAGE = 4;
export const NATIONAL_PAGE_MS = 10 * 1000;
// With nothing on, the rail turns slower — there's no action to keep up with.
export const IDLE_PAGE_MS = 20 * 1000;
// A game that just ended stays in the rail's rotation this long.
export const RECENT_FINAL_MS = 15 * 60 * 1000;
// With nothing on, the rail turns through this many of the latest finals
// (the next kickoffs have the Up next panel; the rail only falls back to
// them when nothing has finished yet).
export const IDLE_RAIL_EACH = 12;
// With nothing on, the Up next panel pages through the schedule: this many
// kickoffs at a time (under their day's row), this long each.
export const UP_NEXT_PER_PAGE = 7;
export const UP_NEXT_PAGE_MS = 15 * 1000;
// With nothing on, each featured top performance stays up this long.
export const PERF_ROTATE_MS = 25 * 1000;
// After a big play's graphic, the play stays on the main panel at least
// this long before the next one takes over.
export const BEAT_DWELL_MS = 7 * 1000;
// Plays waiting their turn: past this many, plays that aren't scores are
// let go (they still show in the list); scores always wait their turn.
export const MAX_WAITING_PLAYS = 3;
// The prospect spotlight: how often (at most), for how long, and how soon
// the same player may come back.
export const SPOTLIGHT_EVERY_MS = 75 * 1000;
export const SPOTLIGHT_MS = 16 * 1000;
export const SPOTLIGHT_REPEAT_MS = 12 * 60 * 1000;
// A game's score lights up this long after it changes.
export const NATIONAL_HOT_MS = 45 * 1000;
// The storyline strip turns over this often (each story gets a good look).
export const STORY_ROTATE_MS = 30 * 1000;
// ...and slower still with nothing on.
export const IDLE_STORY_ROTATE_MS = 45 * 1000;

// A scheduled game this far past kickoff that never started is postponed
// or canceled — not "up next" (same rule as utils/live.js slatePhase).
const STALE_KICK_MS = 6 * 3600e3;
const kick = (g) => Date.parse(g?.startDate || "") || 0;
const bestRank = (g) => Math.min(g.home?.rank || 99, g.away?.rank || 99);
const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

// Live games in a fixed order, so the rail doesn't reshuffle between
// updates: the game of the week / featured games first, then games with a
// ranked team (best rank first), then by kickoff.
export function orderLive(games) {
  const tier = (g) => (g.gameOfWeek ? 0 : g.featured ? 1 : 2);
  return (games || []).filter((g) => g.status === "in_progress")
    .sort((a, b) => tier(a) - tier(b) || bestRank(a) - bestRank(b) || kick(a) - kick(b) || byId(a, b));
}

export function upcomingGames(games, now = Date.now()) {
  return (games || []).filter((g) => g.status === "scheduled" && kick(g) > now - STALE_KICK_MS)
    .sort((a, b) => kick(a) - kick(b) || bestRank(a) - bestRank(b) || byId(a, b));
}

export function finalGames(games) {
  return (games || []).filter((g) => g.status === "final").sort((a, b) => kick(b) - kick(a) || byId(a, b));
}

// ── The rail ──
// Close games stay up; everything else takes turns.
//   close    one score or less (8 points) in the 4th quarter or overtime,
//            the one nearest its end first (overtime, then the least time
//            left on the clock)
// railCards → { pinned, pool, fill }: pinned close games hold their slots
// (at most per - 1 while anything else is on, so one slot always turns
// over — even when every game on is close, if there are more than fit);
// pool is what rotates through the rest — close games that didn't
// fit, the other live games (orderLive), then games that went final in the
// last RECENT_FINAL_MS (finalAt: Map id → when the page saw them end);
// fill tops up a rail that's short (next kickoffs, then finals).
// Each card: { game, kind: "live" | "final" | "upcoming", close? }.
export const isClose = (g) => g?.status === "in_progress" && (g.period || 0) >= 4
  && Math.abs((g.home?.points ?? 0) - (g.away?.points ?? 0)) <= 8;
const timeLeft = (g) => ((g.period || 0) > 4 ? -1 : clockSecs(g.clock) ?? 900);
export function closeGames(games) {
  return (games || []).filter(isClose)
    .sort((a, b) => (b.period || 0) - (a.period || 0) || timeLeft(a) - timeLeft(b) || byId(a, b));
}
export function railCards(games, now = Date.now(), finalAt = new Map(), per = NATIONAL_PER_PAGE) {
  const close = closeGames(games);
  const closeIds = new Set(close.map((g) => String(g.id)));
  const others = orderLive(games).filter((g) => !closeIds.has(String(g.id)));
  const recent = finalGames(games).filter((g) => now - (finalAt.get(String(g.id)) ?? -Infinity) < RECENT_FINAL_MS);
  // one slot keeps turning over whenever there's more to show than fits
  // Nothing on: the week's results take turns instead (what's next is in
  // the Up next panel) — the next kickoffs only if nothing's finished yet.
  if (!close.length && !others.length) {
    const finals = finalGames(games).slice(0, IDLE_RAIL_EACH).map((game) => ({ game, kind: "final" }));
    return {
      pinned: [],
      pool: finals.length ? finals : upcomingGames(games, now).slice(0, IDLE_RAIL_EACH).map((game) => ({ game, kind: "upcoming" })),
      fill: [],
    };
  }
  const nPinned = Math.min(close.length, others.length || recent.length || close.length > per ? per - 1 : per);
  const pinned = close.slice(0, nPinned).map((game) => ({ game, kind: "live", close: true }));
  const pool = [
    ...close.slice(nPinned).map((game) => ({ game, kind: "live", close: true })),
    ...others.map((game) => ({ game, kind: "live" })),
    ...recent.map((game) => ({ game, kind: "final" })),
  ];
  const used = new Set([...pinned, ...pool].map((c) => String(c.game.id)));
  const fill = [
    ...upcomingGames(games, now).map((game) => ({ game, kind: "upcoming" })),
    ...finalGames(games).filter((g) => !used.has(String(g.id))).map((game) => ({ game, kind: "final" })),
  ];
  return { pinned, pool, fill };
}
// The rail at turn i: the pinned games, then the next of the pool (wrapping
// round so the rail stays full), topped up from fill. pages: how many turns
// before the pool comes round again (1 = nothing rotates).
export function railAt({ pinned, pool, fill }, i, per = NATIONAL_PER_PAGE) {
  const n = Math.max(0, per - pinned.length);
  const pages = n > 0 && pool.length > n ? Math.ceil(pool.length / n) : 1;
  const k = ((i % pages) + pages) % pages;
  const turn = n === 0 ? [] : pool.length > n ? Array.from({ length: n }, (_, j) => pool[(k * n + j) % pool.length]) : pool;
  const seen = new Set();
  const cards = [...pinned, ...turn].filter((c) => !seen.has(String(c.game.id)) && seen.add(String(c.game.id)));
  for (const c of fill) { if (cards.length >= per) break; if (!seen.has(String(c.game.id))) { seen.add(String(c.game.id)); cards.push(c); } }
  return { cards, pages, index: k };
}

// A game that just ended: the ingester posts it to the big-plays feed
// (server/live/store.js finalFeedEntry — kinds ["final"]), so it takes its
// turn in the left lane like a score: the FINAL graphic, then the result.
export const isFinalEntry = (b) => (b?.kinds || []).includes("final");
// The game's top performers for the final card: the best passer, rusher
// and receiver — [{ name, side, cat, line }].
export function topPerformers(statLeaders, n = 3) {
  const out = [];
  for (const cat of ["passing", "rushing", "receiving"]) {
    const e = statLeaders?.[cat]?.[0];
    const line = e ? statLine(cat, e.stats).replace(/ · LONG -?\d+/, "") : "";
    if (line && !out.some((o) => o.name === e.name)) out.push({ name: e.name, slug: e.slug || null, side: e.side, cat, line });
  }
  return out.slice(0, n);
}
export const winnerOf = (g) => {
  const h = g?.home?.points ?? 0;
  const a = g?.away?.points ?? 0;
  return h === a ? null : h > a ? "home" : "away";
};
export const resultLine = (g) => {
  const w = winnerOf(g);
  return w ? `${teamName(g[w])} wins` : "Final";
};

// What the page reports to the capture worker (window.__BROADCAST__.phase):
//   loading   waiting on the first slate snapshot
//   live      at least one game in progress
//   idle      games on the slate, none in progress right now
//   empty     no games on the slate at all
export function nationalPhase({ ready, games }) {
  if (!ready) return "loading";
  if (!games?.length) return "empty";
  return games.some((g) => g.status === "in_progress") ? "live" : "idle";
}

// Points scored since the last snapshot, per game: Map id → { side, pts }
// for a team whose score went up (a score that drops is a correction).
export function scoreChanges(prev, games) {
  const out = new Map();
  if (!prev) return out;
  for (const g of games || []) {
    const was = prev.get(String(g.id));
    if (!was || g.status !== "in_progress") continue;
    for (const side of ["home", "away"]) {
      const d = (g[side]?.points ?? 0) - (was[side] ?? 0);
      if (d > 0) out.set(String(g.id), { side, pts: d });
    }
  }
  return out;
}
export const scoreSnapshot = (games) => new Map((games || []).map((g) => [String(g.id), { home: g.home?.points ?? 0, away: g.away?.points ?? 0 }]));

const named = (t) => `${t?.rank ? `#${t.rank} ` : ""}${teamShort(t)}`;
// "USA 34 – ARST 28" (away first, as on every scoreboard)
export const scoreLine = (g) => (g ? `${named(g.away)} ${g.away?.points ?? 0} – ${named(g.home)} ${g.home?.points ?? 0}` : "");
// "Q3 8:42" for a play (no clock in overtime)
export const playClock = (p) => [periodLabel(p?.period), p?.period > 4 ? null : p?.clock].filter(Boolean).join(" ");

// ── Storylines ──
// What's worth knowing across the country right now, from the scores
// alone — the strip under the rail turns through these, most important
// first: { key, chip, tone, text, game }.
//   upset      a ranked team trailing an unranked (or 10+ spots worse) one
//   crunch     4th quarter, one score either way
//   overtime   still going after four
//   shootout   70+ points between them
//   upsetFinal a ranked team beaten in the last few hours
const lead = (g) => {
  const h = g.home?.points ?? 0;
  const a = g.away?.points ?? 0;
  return h === a ? null : h > a ? { win: "home", lose: "away", by: h - a } : { win: "away", lose: "home", by: a - h };
};
const upsetOf = (g, l) => {
  if (!l) return false;
  const lr = g[l.lose]?.rank;
  const wr = g[l.win]?.rank;
  return !!lr && (!wr || wr - lr >= 10);
};
// An upset stays a storyline until this long after its kickoff.
const UPSET_FINAL_MS = 7 * 3600e3;
export function storylines(games, now = Date.now(), perf = []) {
  const out = [];
  for (const g of games || []) {
    const l = lead(g);
    const total = (g.home?.points ?? 0) + (g.away?.points ?? 0);
    const when = statusLabel(g);
    if (g.status === "in_progress") {
      if ((g.period || 0) >= 2 && upsetOf(g, l)) {
        out.push({ key: `upset-${g.id}`, pri: 0 + bestRank(g) / 100, chip: "Upset alert", tone: "red", game: g,
          text: `${named(g[l.win])} leads ${named(g[l.lose])} ${g[l.win].points}–${g[l.lose].points} · ${when}` });
      }
      if ((g.period || 0) > 4) {
        out.push({ key: `ot-${g.id}`, pri: 1, chip: "Overtime", tone: "gold", game: g, text: `${named(g.away)} ${g.away?.points ?? 0}, ${named(g.home)} ${g.home?.points ?? 0} · ${when}` });
      } else if ((g.period || 0) === 4 && (!l || l.by <= 8)) {
        out.push({ key: `crunch-${g.id}`, pri: 2, chip: "Crunch time", tone: "gold", game: g,
          text: l ? `${named(g[l.win])} ${g[l.win].points}, ${named(g[l.lose])} ${g[l.lose].points} · ${when}` : `${named(g.away)} and ${named(g.home)} tied at ${g.home?.points ?? 0} · ${when}` });
      }
      if (total >= 70) {
        out.push({ key: `shoot-${g.id}`, pri: 4, chip: "Shootout", tone: "blue", game: g, text: `${total} points so far · ${scoreLine(g)} · ${when}` });
      }
    } else if (g.status === "final" && upsetOf(g, l) && now - kick(g) < UPSET_FINAL_MS) {
      out.push({ key: `upsetf-${g.id}`, pri: 3, chip: "Upset", tone: "red", game: g,
        text: `${named(g[l.win])} takes down ${named(g[l.lose])} ${g[l.win].points}–${g[l.lose].points}${g.period > 4 ? " in overtime" : ""}` });
    }
  }
  // + big performances (performanceStories), between the game situations
  return [...out, ...perf].sort((a, b) => a.pri - b.pri || (b.score || 0) - (a.score || 0) || a.key.localeCompare(b.key)).map(({ pri, score, ...s }) => s);
}

// When nothing's dramatic: the next kickoff, or where the day stands.
export function quietStory(games, now = Date.now()) {
  const live = (games || []).filter((g) => g.status === "in_progress").length;
  const next = upcomingGames(games, now)[0];
  const finals = finalGames(games).length;
  if (live) return { key: "count", chip: "On now", tone: "blue", game: null, text: `${live} ${live === 1 ? "game" : "games"} in progress${next ? ` · next kickoff ${named(next.away)} at ${named(next.home)}` : ""}` };
  if (next) return { key: `next-${next.id}`, chip: "Up next", tone: "blue", game: next, text: `${named(next.away)} at ${named(next.home)}${next.tv ? ` · ${next.tv}` : ""}` };
  return { key: "done", chip: "Final", tone: "blue", game: null, text: finals ? `All ${finals} games are final — full recaps at we-draft.com/live` : "Every game, every score · we-draft.com/live" };
}

// ── Events ──
// A slate big play (store.js slateBigPlay) as a broadcast event — the same
// graphics the game broadcast uses (src/broadcast/BroadcastEvents.js), with
// the game it came from riding along (gameId), since there's no one game
// on screen. null for a play that doesn't call for one.
export function eventForBigPlay(b) {
  if (!b?.key) return null;
  if (isFinalEntry(b)) {
    const side = (b.homeScore ?? 0) === (b.awayScore ?? 0) ? null : (b.homeScore ?? 0) > (b.awayScore ?? 0) ? "home" : "away";
    return { id: `big-${b.key}`, gameId: String(b.gameId), type: "END_OF_GAME", side, durationMs: EVENT_MS.END_OF_GAME || 9000 };
  }
  const pr = b.presentation || {};
  if (pr.nullified) return null;
  const kinds = b.kinds || [];
  const tags = b.tags || [];
  const base = {
    id: `big-${b.key}`, gameId: String(b.gameId), side: b.creditSide || b.offense || null,
    player: featuredPlayer(b), detail: b.label || null,
  };
  const ctx = `${b.awayShort || ""} ${b.awayScore ?? 0} – ${b.homeShort || ""} ${b.homeScore ?? 0} · ${playClock(b)}`;
  let type = null;
  if (pr.touchdown || (kinds.includes("score") && /touchdown/i.test(`${pr.headline || ""} ${b.label || ""}`))) type = "TOUCHDOWN";
  else if (kinds.includes("score") && (pr.type === "field_goal" || /field goal/i.test(b.label || ""))) type = "FIELD_GOAL";
  else if (kinds.includes("score") && /safety/i.test(`${pr.headline || ""} ${b.label || ""}`)) type = "SAFETY";
  else if (pr.type === "interception" || /intercept/i.test(b.label || "")) type = "INTERCEPTION";
  else if (pr.type === "fumble" || (kinds.includes("turnover") && /fumble/i.test(b.label || ""))) type = "FUMBLE";
  else if (pr.downsTurnover || tags.includes("fourth-down-stop")) type = "TURNOVER_ON_DOWNS";
  else if (kinds.includes("big") || tags.some((t) => /^big-/.test(t))) type = "BIG_PLAY";
  if (!type) return null;
  const y = pr.yards ?? null;
  // national: the graphic puts the player on a line of his own, his
  // numbers under it, and the game (score · clock) last.
  return { ...base, type, national: true, context: ctx, yards: type === "BIG_PLAY" ? y : null, durationMs: EVENT_MS[type] };
}

// Scores and finals always wait their turn (queueBigPlays never lets them go).
export const isScore = (b) => (b?.kinds || []).some((k) => k === "score" || k === "final");

// The waiting line of big plays: new plays join at the back (oldest
// first). Past `max` waiting, plays that aren't scores are let go — the
// returned `dropped` — so a busy slate never backs up; scores always stay.
export function queueBigPlays(queue, incoming, max = MAX_WAITING_PLAYS) {
  const q = [...queue, ...incoming];
  const dropped = [];
  while (q.length > max) {
    const i = q.findIndex((b) => !isScore(b));
    if (i < 0) break;
    dropped.push(q.splice(i, 1)[0]);
  }
  return { queue: q, dropped };
}

// ── Player numbers ──
// A game doc's statLeaders (server/live/ingest.js — gameLeaders: each
// category's top lines, { id, name, slug, side, stats }) as one list.
const CATS = ["passing", "rushing", "receiving", "defense"];
function leaderLines(doc) {
  const out = [];
  for (const cat of CATS) for (const e of doc?.statLeaders?.[cat] || []) out.push({ ...e, cat });
  return out;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

// The box doc (liveGames/{id}/box/live: { players: { home, away } } —
// every player's full line) in statLeaders' shape, for a player who isn't
// among his game's leaders.
export function leadersFromBox(box) {
  const statLeaders = {};
  for (const side of ["home", "away"]) {
    for (const l of box?.players?.[side] || []) {
      for (const cat of CATS) if (l.stats?.[cat]) (statLeaders[cat] ||= []).push({ id: l.key, name: l.name, slug: l.slug || null, side, stats: l.stats[cat] });
    }
  }
  return { statLeaders };
}

// The players on a big play with their game line now, in the order the
// play reads ("Passer → Receiver"): [{ name, slug, side, cat, line }], up
// to max. Only the line the play is about (a run → rushing; a pass → the
// passer's passing and the receiver's receiving; a pick, fumble or sack →
// defense) — never some other line of his.
// The category a play's i-th player is credited in, or null.
export function playCategory(play, i, count) {
  const pr = play?.presentation || {};
  const type = pr.type || "";
  if (type === "interception" || type === "fumble" || type === "sack") return i === 0 ? "defense" : null;
  if (type === "rush" || /\b(run|rush)\b/i.test(pr.detail || "")) return i === 0 ? "rushing" : null;
  if (type === "pass" || /\bpass\b|reception|catch/i.test(`${pr.detail || ""} ${play?.label || ""}`)) return count > 1 ? (i === 0 ? "passing" : i === 1 ? "receiving" : null) : "receiving";
  return null;
}
export function playerLinesFor(play, doc, max = 2) {
  const pr = play?.presentation || {};
  const players = (pr.line || []).filter((t) => t.player).map((t) => t.player);
  const lines = leaderLines(doc);
  if (!players.length || !lines.length) return [];
  const pref = (i) => [playCategory(play, i, players.length)].filter(Boolean);
  const out = [];
  players.forEach((pl, i) => {
    if (out.length >= max) return;
    const mine = lines.filter((l) => (pl.cfbdId != null && String(l.id) === String(pl.cfbdId)) || norm(l.name) === norm(pl.name));
    for (const cat of pref(i)) {
      const l = mine.find((x) => x.cat === cat);
      // (no "LONG n" — on a chip the counting stats matter more than the room it takes)
      const text = l ? statLine(cat, l.stats).replace(/ · LONG -?\d+/, "") : "";
      if (text && !out.some((o) => o.name === l.name)) { out.push({ name: l.name, slug: l.slug || null, side: l.side, cat, line: text }); break; }
    }
  });
  return out;
}

// A We-Draft player still to be drafted: profile slugs end in the class
// ("d-j-crowther-2027-rb"); the next draft is next spring's (this spring's
// before May). A slug without a class counts.
export const draftYear = (now = Date.now()) => { const d = new Date(now); return d.getMonth() >= 4 ? d.getFullYear() + 1 : d.getFullYear(); };
export function activeProspect(slug, now = Date.now()) {
  if (!slug) return false;
  const m = /-(20\d\d)(?:-[a-z0-9]+)?$/.exec(slug);
  return !m || Number(m[1]) >= draftYear(now);
}

// How big a day a line is (the game broadcast's Player Watch weights —
// utils/broadcast.js perfScore).
const catScore = {
  passing: (s) => (s.yds || 0) * 0.04 + (s.td || 0) * 4 - (s.int || 0) * 2,
  rushing: (s) => (s.yds || 0) * 0.1 + (s.td || 0) * 6,
  receiving: (s) => (s.yds || 0) * 0.1 + (s.td || 0) * 6 + (s.rec || 0) * 0.5,
  defense: (s) => (s.sacks || 0) * 3 + (s.int || 0) * 4 + (s.ff || 0) * 2 + (s.fr || 0) * 2,
};
// A big day: everyone's bar, and a lower one for a We-Draft prospect.
const BIG = {
  passing: (s, p) => (s.yds || 0) >= (p ? 225 : 300) || (s.td || 0) >= (p ? 3 : 4),
  rushing: (s, p) => (s.yds || 0) >= (p ? 100 : 150) || (s.td || 0) >= (p ? 2 : 3),
  receiving: (s, p) => (s.yds || 0) >= (p ? 100 : 150) || (s.td || 0) >= (p ? 2 : 3),
  defense: (s, p) => (s.sacks || 0) >= (p ? 2 : 3) || (s.int || 0) >= (p ? 1 : 2),
};

// Every player's lines across a game, grouped, best line first:
// [{ key, name, slug, side, lines: [{ cat, stats, line }], score }].
function playersIn(doc) {
  const by = new Map();
  for (const l of leaderLines(doc)) {
    const k = l.slug || String(l.id || l.name);
    const p = by.get(k) || { key: k, name: l.name, slug: l.slug || null, side: l.side, lines: [], score: 0 };
    p.lines.push({ cat: l.cat, stats: l.stats, line: statLine(l.cat, l.stats) });
    p.score += catScore[l.cat](l.stats || {});
    by.set(k, p);
  }
  return [...by.values()].map((p) => ({ ...p, lines: p.lines.sort((a, b) => catScore[b.cat](b.stats || {}) - catScore[a.cat](a.stats || {})) }));
}

// Big performances for the storyline strip, from the live games' docs
// (Map id → liveGames doc): { key, chip, tone, text, game, slug, pri, score }.
export function performanceStories(docs, gamesById, now = Date.now()) {
  const out = [];
  for (const [id, doc] of docs || []) {
    const g = gamesById?.get(String(id)) || { ...doc, id };
    if (g.status && g.status !== "in_progress") continue;
    for (const p of playersIn(doc)) {
      const prospect = activeProspect(p.slug, now);
      const big = p.lines.filter((l) => BIG[l.cat]?.(l.stats || {}, prospect));
      if (!big.length) continue;
      out.push({
        key: `perf-${id}-${p.key}`, pri: prospect ? 2.5 : 3.5, score: p.score,
        chip: prospect ? "Prospect watch" : "Big day", tone: prospect ? "gold" : "blue", game: g, slug: p.slug,
        text: `${p.name} (${named(g[p.side])}) · ${big.map((l) => l.line).join(" · ")} · ${statusLabel(g)}`,
      });
    }
  }
  return out.sort((a, b) => a.pri - b.pri || b.score - a.score);
}

// The player of a game: its best line on the winning side (else anyone's),
// from the game's statLeaders — { name, slug, side, lines: [line, …] }.
export function playerOfGame(statLeaders, side) {
  const ps = playersIn({ statLeaders });
  const best = [...ps.filter((p) => p.side === side), ...ps].sort((a, b) => Number(b.side === side) - Number(a.side === side) || b.score - a.score)[0];
  if (!best) return null;
  return { name: best.name, slug: best.slug, side: best.side, lines: best.lines.slice(0, 2).map((l) => l.line.replace(/ · LONG -?\d+/, "")).filter(Boolean) };
}

// The week's top performances across the country (liveSlate/performances:
// each category's best lines, each with its gameId), best first, one per
// player: [{ key, name, slug, side, cat, line, game, prospect, score }].
const PERF_LABEL = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defense: "Defense" };
export function topPerformanceList(perf, gamesById, now = Date.now()) {
  const out = [];
  for (const cat of CATS) {
    for (const e of perf?.[cat] || []) {
      const line = statLine(cat, e.stats).replace(/ · LONG -?\d+/, "");
      if (!line) continue;
      out.push({
        key: `${e.gameId}-${e.id || e.name}`, name: e.name, slug: e.slug || null, side: e.side, cat, catLabel: PERF_LABEL[cat],
        line, game: gamesById?.get(String(e.gameId)) || null, prospect: activeProspect(e.slug, now), score: catScore[cat](e.stats || {}),
      });
    }
  }
  const seen = new Set();
  return out.sort((a, b) => b.score - a.score).filter((p) => !seen.has(p.key) && seen.add(p.key));
}

// The storyline strip with nothing on: the next kickoff, this week's
// upsets, prospects' best lines, and where the week stands.
// We-Draft prospects' best lines this week in the strip with nothing on.
export const IDLE_PROSPECT_STORIES = 6;
export function idleStories(games, perfList, now = Date.now()) {
  const out = [];
  const next = upcomingGames(games, now)[0];
  if (next) {
    const ms = kick(next) - now;
    const when = next.startTimeTBD ? "time TBA" : ms < 3600e3 ? `in ${Math.max(1, Math.round(ms / 60e3))} min` : ms < 86400e3 ? `in ${Math.floor(ms / 3600e3)}h ${Math.round((ms % 3600e3) / 60e3)}m` : kickText(next, now);
    out.push({ key: `next-${next.id}`, chip: "Next kickoff", tone: "gold", game: next, text: `${named(next.away)} at ${named(next.home)} · ${when}` });
  }
  for (const g of finalGames(games)) {
    const l = lead(g);
    if (upsetOf(g, l)) out.push({ key: `upset-${g.id}`, chip: "Upset", tone: "red", game: g, text: `${named(g[l.win])} took down ${named(g[l.lose])} ${g[l.win].points}–${g[l.lose].points}${g.period > 4 ? " in overtime" : ""}` });
  }
  // (the strip is the only place they show with nothing on)
  for (const p of (perfList || []).filter((x) => x.prospect).slice(0, IDLE_PROSPECT_STORIES)) {
    out.push({ key: `pp-${p.key}`, chip: "Prospect watch", tone: "gold", game: p.game, text: `${p.name}${p.game ? ` (${named(p.game[p.side])})` : ""} · ${p.line}` });
  }
  const finals = finalGames(games).length;
  const left = upcomingGames(games, now).length;
  if (finals || left) out.push({ key: "week", chip: "This week", tone: "blue", game: null, text: [finals && `${finals} ${finals === 1 ? "game" : "games"} final`, left && `${left} still to play`].filter(Boolean).join(" · ") });
  return out;
}

// We-Draft prospects (linked players in a class still to be drafted —
// each game's statLeaders carry their profile slugs) having big days in
// the live games, best first, for the spotlight: [{ key, slug, name, side,
// game, gameId, prospect, lines, score }]. prospect: the game doc's
// prospects entry when it has one (grade, classRank — server/live/breaks.js
// gamePlayers), else {}.
export function spotlightCandidates(docs, gamesById, now = Date.now(), minScore = 8) {
  const out = [];
  for (const [id, doc] of docs || []) {
    const g = gamesById?.get(String(id)) || { ...doc, id };
    if (g.status && g.status !== "in_progress") continue;
    const pros = new Map((doc.prospects || []).filter((p) => p.slug).map((p) => [p.slug, p]));
    for (const p of playersIn(doc)) {
      if (!activeProspect(p.slug, now) || p.score < minScore) continue;
      out.push({ key: `${id}-${p.slug}`, slug: p.slug, name: p.name, side: p.side, game: g, gameId: String(id), prospect: pros.get(p.slug) || {}, lines: p.lines, score: p.score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// An insight card (server/live/insights.js) from one of the games, as an
// event for the right column — only a We-Draft prospect's moment or a
// milestone: the rest of the insights are the column's own list.
export function eventForNationalInsight(ins, gameId) {
  if (!ins?.id || ins.kind !== "player" || !(ins.wd || ins.milestone)) return null;
  return {
    id: `ins-${gameId}-${ins.id}`, gameId: String(gameId), type: "PLAYER_MILESTONE", side: ins.side || null,
    durationMs: EVENT_MS.PLAYER_MILESTONE, insight: ins,
    player: ins.player ? { name: ins.player.name, slug: ins.player.slug || null, cfbdId: ins.player.cfbdId || null } : null,
  };
}

// The newest insight cards across the given games (Map id → liveGames
// doc), each with its game: [{ insight, game }], newest first.
export function nationalInsights(docs, n = 3) {
  const out = [];
  for (const [id, g] of docs || []) for (const ins of g?.insights || []) out.push({ insight: ins, game: { ...g, id } });
  return out.sort((a, b) => (b.insight.at || 0) - (a.insight.at || 0)).slice(0, n);
}

// The ticker along the bottom: recent finals and the next kickoffs, with a
// call to action every few items.   [{ key, tag, text, url? }]
const ET = "America/New_York";
const kickText = (g, now) => {
  const d = new Date(g.startDate || "");
  if (isNaN(d)) return "TBA";
  const day = (x) => x.toLocaleDateString("en-US", { weekday: "short", timeZone: ET });
  const pre = day(d) === day(new Date(now)) ? "" : `${day(d)} `;
  return g.startTimeTBD ? `${pre}TBA` : `${pre}${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET })} ET`;
};
export function tickerItems(games, ctas, now = Date.now(), { finals = 8, upcoming = 8, ctaEvery = 4 } = {}) {
  const items = [
    ...finalGames(games).slice(0, finals).map((g) => {
      const [w, l] = (g.home?.points ?? 0) >= (g.away?.points ?? 0) ? ["home", "away"] : ["away", "home"];
      return { key: `f-${g.id}`, tag: g.period > 4 ? "Final/OT" : "Final", text: `${named(g[w])} ${g[w]?.points ?? 0}, ${named(g[l])} ${g[l]?.points ?? 0}` };
    }),
    ...upcomingGames(games, now).slice(0, upcoming).map((g) => ({
      key: `u-${g.id}`, tag: kickText(g, now), text: `${named(g.away)} at ${named(g.home)}${g.tv ? ` · ${g.tv}` : ""}`,
    })),
  ];
  const out = [];
  let c = 0;
  items.forEach((it, i) => {
    if (i % ctaEvery === 0 && ctas.length) { const x = ctas[c++ % ctas.length]; out.push({ key: `cta-${x.key}-${i}`, tag: null, text: x.label, url: x.url() }); }
    out.push(it);
  });
  if (!out.length) for (const x of ctas) out.push({ key: `cta-${x.key}`, tag: null, text: x.label, url: x.url() });
  return out;
}
