// src/utils/voice/intentsLive.js
//
// /voice, game day (user, 2026-11-25):
//   - "who's playing today?" — today's games from We-Draft Live's slate
//     (liveSlate/current — the doc every /live viewer reads), live scores,
//     TV, and the game with the most prospects on the board.
//   - "what's the score of the Florida State game?" / "did LSU win?"
//   - a player in a live game: "how's Kromah playing?" — his line so far,
//     from the play-by-play (liveGames/{id}/box/live, rewritten after every
//     play update); once it's final, the official box (box/players).
//   - top performers: "who are the top performers today?" — this week's
//     best lines across every game (liveSlate/performances, /live's Top
//     Performances tab), today's games first; "…in the Florida State game"
//     — that game's leaders; "which prospects are playing well?" — players
//     on the board only.
//   - "who's hot this week?" — the Draft Risers board (risers/{year}).
// Every answer is a phrasebook wording (varies, never the same twice in a
// row). Nothing here writes; the live docs are written by server/live.
import { miss, nameOf, list, plural, card } from "./reply";
import { plain } from "./text";
import { findPlayer, schoolSaid } from "./names";
import { schoolRows } from "./requests";
import { phrase } from "./phrase";
import { teamKey } from "../film/schedule";
import { currentDraftClass } from "../eligibility";
import { risersRanked, RISER_TYPES, RISER_YEARS } from "../risers";
import { gameLeaders } from "../liveStats.mjs";

const ET = "America/New_York";
export const etDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" }).replace(":00", "");
const dayName = (iso) => new Date(iso).toLocaleDateString("en-US", { timeZone: ET, weekday: "long" });
const teamName = (t) => t?.school || t?.name || "";
const ranked = (t) => `${t?.rank ? `number ${t.rank} ` : ""}${teamName(t)}`;
const QTR = (p) => (p > 4 ? (p === 5 ? "overtime" : `${p - 4} overtimes`) : `the ${["", "1st", "2nd", "3rd", "4th"][p] || `${p}th`}`);

/** One game, as said (a phrasebook wording): "LSU leads Alabama 21 to 17 in the 3rd" / "Alabama at LSU, 7:30 PM on ESPN" / "Final: LSU 31, Alabama 17". */
export function gameLine(g, ctx = null) {
  const h = g.home || {};
  const a = g.away || {};
  const when = g.period ? `in ${QTR(g.period)}` : "";
  if (g.status === "final") {
    const [w, l] = (h.points ?? 0) >= (a.points ?? 0) ? [h, a] : [a, h];
    return phrase(ctx, "game.final", { w: teamName(w), l: teamName(l), wp: w.points ?? 0, lp: l.points ?? 0 });
  }
  if (g.status === "in_progress") {
    if ((h.points ?? 0) === (a.points ?? 0)) return phrase(ctx, "game.tied", { a: teamName(a), h: teamName(h), pts: h.points ?? 0, when });
    const [w, l] = h.points > a.points ? [h, a] : [a, h];
    return phrase(ctx, "game.live", { w: teamName(w), l: teamName(l), wp: w.points, lp: l.points, when });
  }
  return phrase(ctx, "game.scheduled", { a: ranked(a), h: ranked(h), time: g.startTimeTBD ? "time to be announced" : timeOf(g.startDate), tv: g.tv || "" });
}
const scoreText = (g) => (g.status === "scheduled" ? (g.startTimeTBD ? "TBA" : `${timeOf(g.startDate)}${g.tv ? ` · ${g.tv}` : ""}`) : `${g.away?.short || teamName(g.away)} ${g.away?.points ?? 0} – ${g.home?.short || teamName(g.home)} ${g.home?.points ?? 0}${g.status === "final" ? " · Final" : g.period ? ` · Q${g.period}${g.clock ? ` ${g.clock}` : ""}` : ""}`);
const gameTitle = (g) => `${teamName(g.away)} at ${teamName(g.home)}`;
const sides = (g) => [g.home, g.away].map((t) => teamKey(teamName(t)));
const gameLinks = (g) => (g.slug ? [{ to: `/live/${g.slug}`, label: g.status === "in_progress" ? "Watch it live" : "Open the game", primary: true }] : []);
const isToday = (g) => g.startDate && etDay(new Date(g.startDate)) === etDay(new Date());

// A school → its game this week: live first, then the next one, then the last one.
function teamGame(games, school) {
  const k = teamKey(school);
  const mine = games.filter((g) => sides(g).includes(k));
  if (!mine.length) return null;
  const by = (s) => mine.filter((g) => g.status === s).sort((x, y) => String(x.startDate).localeCompare(String(y.startDate)));
  return by("in_progress")[0] || by("scheduled")[0] || by("final").slice(-1)[0];
}

// A box-score line, as said: "112 rushing yards and a touchdown on 18 carries, and 3 catches for 24 yards".
const n = (v) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const tds = (k) => (k === 1 ? "a touchdown" : `${k} touchdowns`);
export function boxLine(stats = {}) {
  const parts = [];
  const rows = [];
  const p = stats.passing;
  if (p && (p["C/ATT"] || n(p.YDS))) {
    parts.push(`${p["C/ATT"] ? `${p["C/ATT"].replace("/", " of ")} passing for ` : "passing for "}${n(p.YDS)} yards${n(p.TD) ? `, ${tds(n(p.TD))}` : ""}${n(p.INT) ? `, ${n(p.INT)} interception${n(p.INT) === 1 ? "" : "s"}` : ""}`);
    rows.push(["Passing", `${p["C/ATT"] || ""} · ${n(p.YDS)} yds · ${n(p.TD)} TD · ${n(p.INT)} INT`]);
  }
  const r = stats.rushing;
  if (r && n(r.CAR)) {
    parts.push(`${n(r.YDS)} rushing yards${n(r.TD) ? ` and ${tds(n(r.TD))}` : ""} on ${n(r.CAR)} carr${n(r.CAR) === 1 ? "y" : "ies"}`);
    rows.push(["Rushing", `${n(r.CAR)} car · ${n(r.YDS)} yds · ${n(r.TD)} TD`]);
  }
  const c = stats.receiving;
  if (c && n(c.REC)) {
    parts.push(`${n(c.REC)} catch${n(c.REC) === 1 ? "" : "es"} for ${n(c.YDS)} yards${n(c.TD) ? ` and ${tds(n(c.TD))}` : ""}`);
    rows.push(["Receiving", `${n(c.REC)} rec · ${n(c.YDS)} yds · ${n(c.TD)} TD`]);
  }
  const d = stats.defensive;
  if (d && (n(d.TOT) || n(d.SACKS) || n(d.TFL))) {
    const extra = [n(d.TFL) && `${n(d.TFL)} for loss`, n(d.SACKS) && `${n(d.SACKS)} sack${n(d.SACKS) === 1 ? "" : "s"}`, n(d.PD) && `${n(d.PD)} pass${n(d.PD) === 1 ? "" : "es"} defended`].filter(Boolean);
    // No tackle count during a game (the play-by-play doesn't carry one): just the rest.
    parts.push(n(d.TOT) ? `${n(d.TOT)} tackle${n(d.TOT) === 1 ? "" : "s"}${extra.length ? `, ${list(extra)}` : ""}` : list(extra));
    rows.push(["Defense", `${n(d.TOT)} tkl · ${n(d.TFL)} TFL · ${n(d.SACKS)} sacks`]);
  }
  const i = stats.interceptions;
  if (i && n(i.INT)) { parts.push(`${n(i.INT)} interception${n(i.INT) === 1 ? "" : "s"}`); rows.push(["Interceptions", String(n(i.INT))]); }
  return { said: parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0] || "", rows };
}

// The play-by-play's line (utils/liveStats.mjs: passing { att, cmp, yds, td,
// int }, rushing { car, yds, td }, receiving { rec, yds, td }, defense {
// sacks, int, ff, fr } — no tackles from plays) in the box score's shape.
export function playStatsAsBox(s = {}) {
  const out = {};
  if (s.passing?.att) out.passing = { "C/ATT": `${s.passing.cmp || 0}/${s.passing.att}`, YDS: s.passing.yds || 0, TD: s.passing.td || 0, INT: s.passing.int || 0 };
  if (s.rushing?.car) out.rushing = { CAR: s.rushing.car, YDS: s.rushing.yds || 0, TD: s.rushing.td || 0 };
  if (s.receiving?.rec) out.receiving = { REC: s.receiving.rec, YDS: s.receiving.yds || 0, TD: s.receiving.td || 0 };
  if (s.defense?.sacks) out.defensive = { TOT: 0, SACKS: s.defense.sacks };
  if (s.defense?.int) out.interceptions = { INT: s.defense.int };
  return out;
}
const keyName = (s) => plain(s).replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();

/** A player by name — the board first, then anyone on a CFBD roster. */
export async function findAnyPlayer(said, ctx, aliases = {}) {
  const f = findPlayer(said, await ctx.people(), aliases);
  if (f.player) return f.player;
  const cfbd = ctx.cfbdPeople ? await ctx.cfbdPeople().catch(() => []) : [];
  return findPlayer(said, cfbd, aliases).player || null;
}

/** His line in this week's game: live from the play-by-play; final from the official box. */
export async function playerLive(player, ctx) {
  const d = await ctx.player(player.id);
  if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
  const slate = await ctx.liveSlate().catch(() => null);
  const g = teamGame(slate?.games || [], d.School || "");
  if (!g) return { say: `${d.School || "His team"} doesn't have a game this week.`, ...card(d), tone: "answer", gap: "live-no-game" };
  const links = gameLinks(g);
  if (g.status === "scheduled") return { say: `${d.School} hasn't played yet this week. ${gameLine(g, ctx)}.`, ...card(d), games: [g], links, tone: "answer" };
  // Find him among HIS team's lines: CFBD id, We-Draft slug, exact name, then
  // (the live feed often has no We-Draft link) a last name only he has on his
  // team, then last name + first initial — "CJ Smith" / "Calvin Smith", "Jr.".
  const mySide = teamKey(teamName(g.home)) === teamKey(d.School) ? "home" : "away";
  const myLast = keyName(d.Last);
  const findHim = (lines, get) => {
    const exact = lines.find((x) => { const v = get(x); return (d.cfbd && String(v.id) === String(d.cfbd)) || (d.Slug && v.slug === d.Slug) || keyName(v.name) === keyName(`${d.First} ${d.Last}`); });
    if (exact) return exact;
    const lastOf = (name) => keyName(name).split(" ").slice(1).join(" ");
    const sameLast = lines.filter((x) => lastOf(get(x).name) === myLast);
    if (sameLast.length === 1) return sameLast[0];
    const initial = sameLast.filter((x) => keyName(get(x).name)[0] === keyName(d.First)[0]);
    return initial.length === 1 ? initial[0] : null;
  };
  // Final: the official box score (it lands a little after the final whistle).
  let stats = null;
  if (g.status === "final") {
    const box = await ctx.liveBox(g.id).catch(() => null);
    const teams = box?.teams || [];
    const mine = teams.filter((t) => teamKey(t.name) === teamKey(d.School));
    stats = findHim((mine.length ? mine : teams).flatMap((t) => t.players || []), (x) => ({ id: x.id, slug: x.wedraftSlug, name: x.name }))?.stats || null;
  }
  // Live (or final before the official box is in): the play-by-play's numbers.
  let fromPlays = false;
  if (!stats && ctx.livePlayStats) {
    const live = await ctx.livePlayStats(g.id).catch(() => null);
    const line = findHim(live?.players?.[mySide] || [], (x) => ({ id: String(x.key || "").split("|")[0], slug: x.slug, name: x.name }));
    if (line) { stats = playStatsAsBox(line.stats); fromPlays = true; }
  }
  if (!stats) return { say: `I don't have stats for ${nameOf(d)} in this game yet. ${gameLine(g, ctx)}.`, ...card(d), games: [g], links, tone: "answer", gap: "live-no-line" };
  const b = boxLine(stats);
  return {
    say: phrase(ctx, "live.line", { name: nameOf(d), live: g.status !== "final", line: b.said || "nothing in the box score yet", game: gameLine(g, ctx) }),
    ...card(d, { sub: `${g.status === "final" ? "Final" : "Live"} · ${gameTitle(g)}${fromPlays ? " · from the play-by-play" : ""}` }),
    rows: b.rows, games: [g], links, live: g.status === "in_progress", tone: "answer",
  };
}

// ── Top performers ──
const CAT_LABEL = { passing: "Passing", rushing: "Rushing", receiving: "Receiving", defense: "Defense" };
// A leader (utils/liveStats.mjs gameLeaders / liveSlate/performances: { id, name, slug, side, stats, v, gameId? }) → said + a people row.
function leaderOut(e, cat, g, people) {
  const team = g ? teamName(g[e.side]) : "";
  const line = boxLine(playStatsAsBox({ [cat]: e.stats })).said;
  const onBoard = e.slug ? people.find((p) => p.slug === e.slug) : null;
  const [first, ...last] = String(e.name || "").split(" ");
  const cfbdId = /^\d+$/.test(String(e.id || "")) ? String(e.id) : null;
  const row = onBoard ? { ...onBoard, note: line } : { id: cfbdId ? `cfbd_${cfbdId}` : e.id, first, last: last.join(" "), school: team, cfbd: cfbdId, cfbdOnly: !!cfbdId, note: line };
  return { team, line, row };
}
const PERF_SPAN = "(?<span>today|tonight|this week|this weekend|right now|so far|live)";

// ── Other days (log 2026-11-26: "who plays tomorrow", "what are some college football games
// this week", "were any college football games played last week", "what game should I watch
// from last week") ── The week's slate; last week's from liveSlate/week-…; the game to watch =
// the one with the most players on the board.
const GAMES_ = "(?:college )?(?:football )?games?";
const DAY_SPAN = "(?<span>tomorrow(?: night)?|this week|this weekend|on saturday|saturday|this saturday|on friday|friday|last week|last weekend|last saturday|yesterday|last night)";
const WEEKDAY = { friday: 5, saturday: 6 };
async function daysAnswer(span0, ctx, { pick = false } = {}) {
  const span = String(span0 || "").replace(/^(?:on|this) (?=saturday|friday)/, "");
  const slate = await ctx.liveSlate().catch(() => null);
  if (!slate?.games) return miss("I can't reach the schedule right now.", "no-slate");
  const people = await ctx.people().catch(() => []);
  const onBoard = (g) => people.filter((p) => sides(g).includes(teamKey(p.school))).length;
  const back = /^(?:last|yesterday)/.test(span);
  let games = slate.games;
  let when = span;
  if (/^(?:last week|last weekend|last saturday)$/.test(span)) {
    const prev = slate.week > 1 && ctx.liveWeek ? await ctx.liveWeek(slate.season, slate.seasonType, slate.week - 1).catch(() => null) : null;
    games = (prev?.games || []).filter((g) => g.status === "final");
    if (span === "last saturday") games = games.filter((g) => new Date(g.startDate).toLocaleDateString("en-US", { timeZone: ET, weekday: "long" }) === "Saturday");
  } else if (/^(?:yesterday|last night)$/.test(span)) {
    const y = etDay(new Date(Date.now() - 86400000));
    games = games.filter((g) => g.startDate && etDay(new Date(g.startDate)) === y);
    when = "yesterday";
  } else if (/^tomorrow/.test(span)) {
    const t = etDay(new Date(Date.now() + 86400000));
    games = games.filter((g) => g.startDate && etDay(new Date(g.startDate)) === t);
    when = "tomorrow";
  } else if (WEEKDAY[span] != null) {
    games = games.filter((g) => g.startDate && dayName(g.startDate) === span[0].toUpperCase() + span.slice(1));
    when = `on ${span[0].toUpperCase()}${span.slice(1)}`;
  }
  const title = `Games ${when}`;
  if (!games.length) return { say: back ? `I don't have any finished games from ${when}.` : `There are no games ${when}.`, title, links: [{ to: "/live", label: "Open We-Draft Live", primary: true }], tone: "answer", gap: back ? "live-no-week" : undefined };
  const byProspects = [...games].sort((a, b) => onBoard(b) - onBoard(a));
  const best = byProspects[0];
  const bestN = onBoard(best);
  const rows = byProspects.map((g) => [gameTitle(g), `${scoreText(g)}${onBoard(g) ? ` · ${onBoard(g)} prospects` : ""}`]);
  const base = { title, sub: plural(games.length, "game"), rows, games: byProspects.slice(0, 16), links: [{ to: "/live", label: "Open We-Draft Live", primary: true }], tone: "answer" };
  if (pick) {
    // The one to go back and watch: the most prospects; the next one if it was closer.
    const margin = (g) => Math.abs((g.home?.points ?? 0) - (g.away?.points ?? 0));
    const alt = byProspects[1] && onBoard(byProspects[1]) >= bestN * 0.8 && margin(byProspects[1]) < margin(best) ? byProspects[1] : null;
    const g = alt || best;
    return { ...base, say: `I'd go back to ${gameTitle(g)}. ${gameLine(g, ctx)}${onBoard(g) ? `, with ${onBoard(g)} prospects on the field` : ""}.`, games: [g], links: gameLinks(g).length ? gameLinks(g) : base.links };
  }
  const top = byProspects.slice(0, 3).map((g) => (back ? gameLine(g, ctx) : `${gameTitle(g)}${g.status === "scheduled" && !g.startTimeTBD ? `, ${/^(?:this|last)/.test(span) ? `${dayName(g.startDate)} ` : ""}at ${timeOf(g.startDate)}` : ""}`));
  const lead = back ? `${plural(games.length, "game")} ${games.length === 1 ? "was" : "were"} played ${when}.` : `There ${games.length === 1 ? "is" : "are"} ${plural(games.length, "game")} ${when}.`;
  const most = bestN >= 3 ? ` ${gameTitle(best)} has the most prospects, ${bestN}.` : "";
  return { ...base, say: `${lead} ${games.length > 3 ? "The biggest ones: " : ""}${top.join(". ")}.${most}` };
}

export const LIVE_INTENTS = [
  {
    id: "live.days",
    mode: "general",
    title: "Games on another day",
    examples: ["who plays tomorrow", "what college football games are on this week", "were any games played last week", "what game should I watch from last week"],
    patterns: [
      new RegExp(`^(?:who(?:'s|s| is)? (?:playing|plays)(?: football)?|what ${GAMES_} (?:are|is) (?:on|there|being played|happening|played)|(?:what are |name |give me |list |tell me )?(?:some |the |all the )?${GAMES_}(?: (?:on|being played))?|are there (?:any )?${GAMES_}(?: on)?|any ${GAMES_}(?: on)?|what(?:'s|s| is) on|what(?:'s|s| is) the (?:schedule|slate)) ${DAY_SPAN}$`),
      new RegExp(`^(?:were|was) (?:there )?(?:any )?${GAMES_} (?:played |on )?${DAY_SPAN}$`),
      new RegExp(`^(?:who|what teams?) (?:played|won) ${DAY_SPAN}$`),
      // the game to watch
      new RegExp(`^(?:what|which) ${GAMES_} should i (?:watch|rewatch|go back and watch|check out|pull up)(?: from)? ${DAY_SPAN}$`),
      new RegExp(`^(?:what(?:'s|s| is|was)) the (?:best|biggest|top) game ${DAY_SPAN}$`),
    ],
    fixed: [{}, {}, {}, { pick: "1" }, { pick: "1" }],
    accept: (s) => !!s.span,
    run: async ({ span, pick }, ctx) => daysAnswer(span, ctx, { pick: !!pick }),
  },
  {
    id: "live.today",
    mode: "general",
    title: "Who's playing today",
    examples: ["who's playing today", "what games are on tonight", "any games on today", "what's on tv tonight"],
    patterns: [
      /^(?:who(?:'s|s| is) playing|who plays|what games are (?:on|there|being played|happening)|what(?:'s|s| is) on(?: tv)?|any(?: good)? games(?: on)?|are there any games(?: on)?|what games do we have|is there (?:any |college )?football(?: on)?|games|what(?:'s|s| is) the slate)(?: (?:college )?football)?(?: games)?(?: today| tonight| this afternoon| right now)?$/,
      // "who should I watch right now" (log 2026-11-26) — what's on, and the game with the most prospects.
      /^(?:who|what|which game) should i (?:watch|be watching|tune into|turn on)(?: right now| right| now| today| tonight)?$/,
      /^(?:what's|whats|what is|what are) (?:the )?(?:games|schedule|slate)(?: for)? (?:today|tonight)$/,
      // (The engine drops a trailing "now": "anything live right now" arrives as "anything live right".)
      /^(?:who(?:'s|s| is)|what(?:'s|s| is)|anything|any games|anybody) (?:playing |on )?(?:right now|now|live|right)(?: right(?: now)?)?$/,
      /^(?:what's|whats|what is|what are) (?:today's|todays|tonight's|tonights) games$/,
    ],
    run: async (_s, ctx) => {
      const slate = await ctx.liveSlate().catch(() => null);
      const games = slate?.games || [];
      if (!games.length) return miss("I can't reach today's games right now.", "no-slate");
      const live = games.filter((g) => g.status === "in_progress");
      const todays = games.filter((g) => g.status !== "in_progress" && isToday(g));
      const list0 = [...live, ...todays];
      const liveLink = [{ to: "/live", label: "Open We-Draft Live", primary: true }];
      if (!list0.length) {
        const next = games.filter((g) => g.status === "scheduled" && g.startDate).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
        if (!next.length) return { say: "There are no more games this week.", title: "Today's games", links: liveLink, tone: "answer" };
        const nextDay = etDay(new Date(next[0].startDate));
        const onDay = next.filter((g) => etDay(new Date(g.startDate)) === nextDay);
        return { say: `No games today. Next up is ${dayName(next[0].startDate)}, with ${plural(onDay.length, "game")}. ${gameLine(onDay[0], ctx)}.`, title: `Next: ${dayName(next[0].startDate)}`, rows: onDay.map((g) => [gameTitle(g), scoreText(g)]), games: onDay.slice(0, 16), links: liveLink, tone: "answer" };
      }
      // The game with the most players on the board.
      const people = await ctx.people().catch(() => []);
      const onBoard = (g) => people.filter((p) => sides(g).includes(teamKey(p.school))).length;
      const best = [...list0].sort((a, b) => onBoard(b) - onBoard(a))[0];
      const bestN = best ? onBoard(best) : 0;
      const say = [
        phrase(ctx, "live.today", { n: plural(list0.length, "game"), live: live.length, lines: list0.slice(0, 3).map((g) => gameLine(g, ctx)).join(". ") }),
        bestN >= 3 ? phrase(ctx, "live.mostProspects", { game: gameTitle(best), k: bestN }) : "",
      ].filter(Boolean).join(" ");
      return { say, title: "Today's games", sub: `${list0.length} games${live.length ? ` · ${live.length} live` : ""}`, rows: list0.map((g) => [gameTitle(g), scoreText(g)]), games: list0.slice(0, 16), links: liveLink, live: live.length > 0, tone: "answer" };
    },
  },
  {
    // Before live.score / live.player: "who's playing well in the FSU game" is about the game's leaders.
    id: "live.performers",
    mode: "general",
    title: "Top performers",
    examples: ["who are the top performers today", "who's playing well in the Florida State game", "which prospects are playing well today", "best stat lines this week"],
    patterns: [
      // One game: its leaders.
      /^who(?:'s|s| is| are) (?:the )?(?:top|best|leading) (?:performers?|players?|playmakers?) (?:in|for|from) (?:the )?(?<team>.+?)(?: game)?$/,
      /^who(?:'s|s| is| are) (?:playing well|balling|going off|standing out|leading the way|carrying|stepping up) (?:in|for) (?:the )?(?<team>.+?)(?: game)?$/,
      /^(?:what are |who are |give me |show me )?(?:the )?(?<team>.+?) (?:game )?(?:leaders|top performers|stat leaders|standouts)$/,
      // Prospects only (players on the board).
      new RegExp(`^(?:which|what|any|are any) (?:prospects|draft prospects|we draft players|players on the board|board players) (?:are |is )?(?:playing well|balling|going off|having (?:big|good) (?:games|days|nights)|standing out|putting up numbers)(?: ${PERF_SPAN})?$`),
      new RegExp(`^(?:who are |what are )?(?:the )?(?:top|best) (?:prospect|draft prospect) (?:performers|performances|stat lines)(?: ${PERF_SPAN})?$`),
      // Every game.
      new RegExp(`^(?:who(?:'s|s| is| are) )?(?:the )?(?:top|best|biggest|leading) (?:performers?|performances|stat lines?|individual performances)(?: ${PERF_SPAN})?$`),
      new RegExp(`^(?:what are |show me |give me |read me |who had )?(?:the )?(?:top|best|biggest) (?:performances|stat lines|games)(?: ${PERF_SPAN})$`),
      new RegExp(`^who(?:'s|s| is| are) (?:the top players|the best players) ${PERF_SPAN}$`),
      new RegExp(`^who(?:'s|s| is| are) (?:playing well|balling|going off|cooking|standing out|having a big (?:game|day|night)|putting up numbers|filling up the stat sheet)(?: ${PERF_SPAN})?$`),
    ],
    fixed: [{}, {}, {}, { prospects: true }, { prospects: true }],
    // "the top performers" isn't a team called "the"; nor is "my board" / "the 2027 class".
    accept: (s) => !s.team || (s.team !== "the" && !/\b(?:my|board|class|draft|20\d\d|top|best|biggest|leading|today|tonight|week|weekend|prospects?)\b/.test(s.team)),
    run: async ({ team, span, prospects }, ctx) => {
      const people = await ctx.people().catch(() => []);
      const slate = await ctx.liveSlate().catch(() => null);
      const games = slate?.games || [];
      const byId = Object.fromEntries(games.map((g) => [String(g.id), g]));
      if (team) {
        const school = schoolSaid(String(team).replace(/ game$/, ""), await schoolRows(ctx));
        if (!school) return miss(`I don't know the team "${team}".`, "live-no-team");
        const g = teamGame(games, school);
        if (!g) return { say: `I don't see a ${school} game this week.`, title: "This week", tone: "answer", gap: "live-no-game" };
        if (g.status === "scheduled") return { say: `${school} hasn't played yet this week. ${gameLine(g, ctx)}.`, games: [g], links: gameLinks(g), tone: "answer" };
        const stats = await ctx.livePlayStats(g.id).catch(() => null);
        const leaders = stats ? gameLeaders(stats, 3) : {};
        const cats = Object.keys(CAT_LABEL).filter((c) => leaders[c]?.length);
        if (!cats.length) return { say: `I don't have stats for that game yet. ${gameLine(g, ctx)}.`, games: [g], links: gameLinks(g), tone: "answer", gap: "live-no-line" };
        const outs = cats.map((c) => [c, leaderOut(leaders[c][0], c, g, people)]);
        const say = [phrase(ctx, "perf.game", { game: gameTitle(g) }), `${outs.map(([c, o]) => phrase(ctx, "perf.cat", { label: CAT_LABEL[c], name: leaders[c][0].name, team: o.team, line: o.line })).join(". ")}.`, `${gameLine(g, ctx)}.`].join(" ");
        return { say, title: `${gameTitle(g)} leaders`, sub: scoreText(g), people: cats.flatMap((c) => leaders[c].map((e) => leaderOut(e, c, g, people).row)), games: [g], links: gameLinks(g), live: g.status === "in_progress", tone: "answer" };
      }
      // Every game this week (liveSlate/performances); today's (and live) games first unless the week was asked.
      const perf = await ctx.livePerformances().catch(() => null);
      if (!perf) return miss("I can't reach the top performances right now.", "no-performances");
      const week = /week/.test(span || "");
      const todayIds = new Set(games.filter((g) => g.status === "in_progress" || isToday(g)).map((g) => String(g.id)));
      const pick = (cat) => (perf[cat] || [])
        .filter((e) => !prospects || (e.slug && people.some((p) => p.slug === e.slug)))
        .filter((e) => week || !todayIds.size || todayIds.has(String(e.gameId)));
      const cats = Object.keys(CAT_LABEL).filter((c) => pick(c).length);
      const spanSaid = week || !todayIds.size ? "this week" : "today";
      if (!cats.length) return { say: prospects ? `No prospects on the board stand out in the stats ${spanSaid} yet.` : `There aren't any stat lines ${spanSaid} yet.`, title: "Top performers", links: [{ to: "/live", label: "Open We-Draft Live", primary: true }], tone: "answer" };
      const outs = cats.map((c) => { const e = pick(c)[0]; return [c, e, leaderOut(e, c, byId[String(e.gameId)], people)]; });
      const say = [phrase(ctx, "perf.intro", { span: prospects ? `among prospects ${spanSaid}` : spanSaid }), `${outs.map(([c, e, o]) => phrase(ctx, "perf.cat", { label: CAT_LABEL[c], name: e.name, team: o.team || "his team", line: o.line })).join(". ")}.`].join(" ");
      return {
        say, title: prospects ? "Prospects playing well" : "Top performers", sub: spanSaid, live: games.some((x) => x.status === "in_progress"),
        people: cats.flatMap((c) => pick(c).slice(0, 3).map((e) => leaderOut(e, c, byId[String(e.gameId)], people).row)),
        links: [{ to: "/live", label: "Top Performances on We-Draft Live", primary: true }], tone: "answer",
      };
    },
  },
  {
    id: "live.score",
    mode: "general",
    title: "A game's score",
    examples: ["what's the score of the Florida State game", "did LSU win", "who won the Alabama game", "when does Florida State play", "what channel is the Alabama game on"],
    patterns: [
      /^(?:what(?:'s|s| is| was) )?(?:the )?score (?:of|in|for) (?:the )?(?<team>.+?)(?: game)?$/,
      /^did (?<team>.+?) (?:win|lose|pull it out|hold on)(?: today| tonight| yesterday| this week| last week| on saturday| saturday)?$/,
      /^who (?:won|is winning|'s winning|s winning|lost) (?:the )?(?<team>.+?) game(?: last week)?$/,
      /^how did (?<team>.+?) do last week$/,
      /^what was the score of (?:the )?(?<team>.+?) game last week$/,
      /^who(?:'s|s| is) winning (?:the )?(?<team>.+?)(?: game)?$/,
      // (Not "up / down": "are Kromah's rushing yards up" is his season against last.)
      /^(?:is|are) (?<team>.+?) (?:winning|losing|playing)(?: today| tonight| right now| this week)?$/,
      /^when (?:does|do|is) (?<team>.+?) (?:play|playing|kick off|kickoff|game)(?: next| this week| today| tonight)?$/,
      /^what time (?:does|do|is) (?:the )?(?<team>.+?) (?:play|playing|kick off|game|on)(?: today| tonight| this week)?$/,
      /^what channel is (?:the )?(?<team>.+?) (?:game )?on$/,
      /^where can i watch (?:the )?(?<team>.+?)(?: game)?$/,
      /^how(?:'s|s| is) (?:the )?(?<team>.+?) game (?:going|looking)$/,
      /^(?:what's|whats|what is) (?:the )?(?<team>.+?) score$/,
    ],
    run: async ({ team }, ctx, text) => {
      // A school ("FSU", "the Florida State game") — or a player ("is Kromah playing today?").
      const school = schoolSaid(String(team).replace(/ game$/, ""), await schoolRows(ctx));
      if (!school) {
        const p = await findAnyPlayer(team, ctx);
        return p ? playerLive(p, ctx) : miss(`I don't know the team "${team}".`, "live-no-team");
      }
      const slate = await ctx.liveSlate().catch(() => null);
      const lastWeek = /\blast week\b/.test(plain(text || ""));
      const g = lastWeek ? null : teamGame(slate?.games || [], school);
      // Last week (asked, or no game this week): that week's archive (liveSlate/week-…).
      if (!g && slate?.week > 1 && ctx.liveWeek) {
        const prev = await ctx.liveWeek(slate.season, slate.seasonType, slate.week - 1).catch(() => null);
        const pg = teamGame(prev?.games || [], school);
        if (pg) return { say: `${lastWeek ? "Last week" : `${school} doesn't play this week. Last week`}: ${gameLine(pg, ctx)}.`, title: gameTitle(pg), sub: `${scoreText(pg)} · last week`, games: [pg], links: gameLinks(pg), tone: "answer" };
      }
      if (!g) return { say: `I don't see a ${school} game ${lastWeek ? "last week" : "this week"}.`, title: "This week", tone: "answer", gap: "live-no-game" };
      return { say: g.status === "scheduled" ? `${dayName(g.startDate)}: ${gameLine(g, ctx)}.` : `${gameLine(g, ctx)}.`, title: gameTitle(g), sub: scoreText(g), games: [g], links: gameLinks(g), live: g.status === "in_progress", tone: "answer" };
    },
  },
  {
    // A player in his game: live from the play-by-play, then the official box.
    id: "live.player",
    mode: "general",
    title: "How a player is playing",
    examples: ["how's Kromah playing", "how is Kromah doing today", "Kromah's stats today", "what does Kromah have so far", "is Kromah having a good game"],
    patterns: [
      // Present tense: the game going on now.
      /^how(?:'s|s| is| are) (?<who>.+?) (?:doing|playing|looking|holding up|performing|faring|getting on)(?: so far)?(?: (?:today|tonight|right now|this game|in this game|in the game))?$/,
      // Past tense needs a time ("how did Kromah do" is his season).
      /^how (?:did|has) (?<who>.+?) (?:do|done|play|played|look|looked|perform|performed|fare|fared)(?: so far)? (?:today|tonight|this afternoon|this morning|right now|so far|in this game|this game|in the game|this week)$/,
      /^(?:what (?:are|is|are the) |what's |whats |give me |show me |read me )?(?<who>.+?)(?:'s|s')? (?:stats|numbers|line|stat line|box score|box)(?: so far)? (?:today|tonight|right now|so far|in this game|this game|in the game|live)$/,
      /^what (?:does|did|has) (?<who>.+?) (?:have|got|done|put up|got going|totaled)(?: so far)? (?:today|tonight|right now|so far|in this game|this game|in the game)$/,
      /^what (?:does|has) (?<who>.+?) (?:have|got|done) so far$/,
      /^(?:is|has) (?<who>.+?) (?:having a (?:good|big|great|bad|rough|quiet) (?:game|day|night)|been good|been quiet|going off|balling)(?: (?:today|tonight|so far))?$/,
      /^(?:any )?updates? on (?<who>.+?)(?: (?:today|tonight|in the game))?$/,
      /^check on (?<who>.+?)(?: (?:today|tonight|in the game))?$/,
    ],
    run: async ({ player }, ctx) => playerLive(player, ctx),
  },
  {
    id: "risers.hot",
    mode: "general",
    title: "Who's hot (Draft Risers)",
    examples: ["who's hot this week", "who are the draft risers", "who's rising in the 2028 class", "any breakouts"],
    patterns: [
      /^(?:who(?:'s|s| is| are)|which players are) (?:hot|on fire|rising|trending up|breaking out|the (?:draft )?risers|risers|the hottest|heating up|moving up(?: draft boards| boards)?|climbing(?: boards)?)(?: (?:right now|this week|lately))?(?: in the (?<cls>20\d\d) class)?$/,
      /^(?:read me |what are |show me |give me )?(?:the |this week's |this weeks )?(?:draft )?risers(?: list| board)?(?: for (?:the )?(?<cls>20\d\d)(?: class)?)?$/,
      /^(?:who(?:'s|s| is)) (?:rising|hot|on fire) in the (?<cls>20\d\d)(?: class)?$/,
      /^(?:any|are there any) (?:breakouts|breakout players|risers|new risers)(?: this week| lately)?$/,
      // "show me some trending players" (heard as "to her some trending players", log 2026-11-26)
      /^(?:.*\b)?(?:trending|hot|rising|breakout) (?:players|prospects|guys|names)(?: (?:right now|this week|lately))?(?: in the (?<cls>20\d\d) class)?$/,
      /^who(?:'s|s| is| are) trending(?: (?:right now|this week|lately))?$/,
    ],
    run: async ({ cls }, ctx) => {
      const year = String(cls || currentDraftClass());
      if (!RISER_YEARS.includes(year)) return miss(`Draft Risers covers the ${list(RISER_YEARS)} classes.`, "risers-year");
      const board = await ctx.risers(year).catch(() => null);
      const all = risersRanked(board?.players || []);
      if (!all.length) return { say: `There's no Draft Risers list for the ${year} class yet.`, title: `${year} Draft Risers`, tone: "answer" };
      const groups = Object.keys(RISER_TYPES).map((t) => [RISER_TYPES[t], all.filter((r) => r.type === t)]).filter(([, rs]) => rs.length);
      const say = groups.map(([T, rs]) => `${T.label}: ${list(rs.slice(0, 3).map((r) => `${r.first} ${r.last}, ${r.school}`))}`).join(". ");
      return {
        say: `${phrase(ctx, "risers.intro", { year })} ${say}.`, title: `${year} Draft Risers`, sub: `${all.length} players`,
        people: all.slice(0, 12).map((r) => ({ id: r.id, first: r.first, last: r.last, pos: r.pos, school: r.school, slug: r.slug, note: `${RISER_TYPES[r.type]?.emoji || ""} ${RISER_TYPES[r.type]?.label || ""}`.trim() })),
        links: [{ to: `/risers/${year}`, label: `${year} Draft Risers`, primary: true }], tone: "answer",
      };
    },
  },
];
