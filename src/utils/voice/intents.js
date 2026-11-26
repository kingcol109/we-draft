// src/utils/voice/intents.js
//
// /voice: everything it understands — one entry per kind of question or
// command. No AI: each intent is a set of sentence patterns (regexes on the
// cleaned words, utils/voice/text.js) with named slots, and a run() that
// answers from the data. Adding a question = adding an entry here.
//
//   id        unique
//   mode      "general" (stats, facts, your own evaluations — anyone could
//             ask) | "admin" (back-office data entry: only on /voice/admin).
//             The admin page also understands every general intent.
//   title     what the help list calls it
//   examples  shown on the help card; also the test sentences. The sure way
//             to name a player is school first: "Florida State's Ousmane
//             Kromah" (user, 2026-11-25) — names.js searches only that school.
//   patterns  [RegExp] on clean(text); named groups are the slots.
//             (?<who>…) is a player — the engine resolves it before run().
//   fixed     slots a pattern implies: [{ field: "height" }, …] by index
//   accept(slots) → false skips the match (a "grade" that isn't a grade…)
//   signIn    needs a signed-in user (your own evaluation)
//   run(slots, ctx) → Reply (or a Promise of one). A write never writes in
//             run(): it returns { confirm: { say, apply } } and the engine
//             asks first.
//
// Reply: { say (spoken), title?, sub?, rows?: [[label, value]], player?,
//          tone?: "answer" | "done" | "ask" | "miss",
//          more?: () => Reply   ("next" reads on)
//          gap?: why it had no answer — logged as a miss to fill later }
import { parseNumber, parseHeight, sayHeight, plain } from "./text";
import { STATS, statKey, statValue, statText, statSay, relatedKeys, lineRows, lineKeys, sumLines, seasonsSaid, opponentPhrases, gamesVs, bestGames, gameSummary, gameWhen, gameTitle, gameResult, WORD_RE } from "./stats";
import { parseGrade, parseTeam, matchTraits, editEval } from "./evals";
import { WHO, nameOf, weightText, facts, card, miss, loaded, ordinal } from "./reply";
import { BOARD_INTENTS, NOTE_INTENTS, PLAYER_INTENTS, COMMUNITY_INTENTS, STATS_MAX_INTENTS, TEAM_INTENTS } from "./intentsMore";
import { DRAFT_INTENTS, WATCH_INTENTS, profileLine } from "./intentsWatch";
import { ADMIN_VOICE_INTENTS } from "./intentsAdmin";
import { FACT_INTENTS } from "./intentsFacts";
import { REQUEST_INTENTS } from "./intentsRequests";
import { READOUT_INTENTS } from "./intentsReadout";
import { LIVE_INTENTS } from "./intentsLive";
import { phrase, extra, hint, join, whenPhrase } from "./phrase";
import { seasonChange, bestSeasonYet } from "./insights";
import { nameFor, POS_PLURAL } from "./refs";
import { gameStory, bestGamesSpoken, gameOf } from "./spoken";
import { LEADER_INTENTS } from "./intentsLeaders";
import { GAME_INTENTS } from "./intentsGames";
import { NFL_INTENTS } from "./intentsNfl";

const LIST = "(?<list>strengths?|weakness(?:es)?)";
const listOf = (l) => (/^s/.test(l) ? "strengths" : "weaknesses");

// "in 2025 against ohio state and lsu" → { seasons, opps } | null (words it can't place).
const SEASON_RE = /\b(?:in |during |for |from |over |of )?(?:the )?(?:20\d\d(?: (?:and|or|to) 20\d\d)*|this (?:season|year)|last (?:season|year)|current season|(?:his )?career|all time|in college)(?: season)?\b/g;
export function parseRest(rest) {
  const t = plain(rest || "");
  if (!t) return { seasons: null, opps: [] };
  let opps = [];
  const om = t.match(/\b(?:against|vs|versus|verse|v|facing|playing)\s+(.+?)(?=\s+(?:in|during|this|last|for|over)\b|$)/);
  let left = t;
  if (om) { opps = opponentPhrases(om[1]); left = t.replace(om[0], " "); }
  // A school he played for: "at Auburn", "in Auburn", "while he was at Stanford" (user, 2026-11-25).
  let at = null;
  const am = left.match(/\b(?:while (?:he was )?at|when he was at|during his time at|at|in) (?!20\d\d\b|this\b|last\b|his\b|the (?:season|year)\b|career\b|college\b|games?\b|total\b|a game\b|one game\b|so far\b)([a-z][a-z ]*?)(?=\s+(?:in|during|this|last|against|vs|versus)\b|$)/);
  if (am && !/^(?:the )?(?:season|year|nfl|draft|class)$/.test(am[1])) { at = am[1].replace(/^the /, ""); left = left.replace(am[0], " "); }
  const seasonWords = (left.match(SEASON_RE) || []).join(" ");
  left = left.replace(SEASON_RE, " ").replace(/\b(?:so far|this|games?|the|in|total|overall|on the season|season|with|up with|the year with|the season with|year|finish|finished|end|ended)\b/g, " ").trim();
  if (left) return null;
  return { seasons: seasonWords, opps, ...(at ? { at } : {}) };
}
// The seasons he spent at a school (his career stops) → ["2025"] | null
function yearsAt(d, at, years) {
  const key = plain(at).replace(/\s+/g, "");
  const stops = (d.CareerStops || []).filter((s) => { const k = plain(s.School || "").replace(/\s+/g, ""); return k && (k === key || k.startsWith(key) || key.startsWith(k)); });
  if (!stops.length) return null;
  const out = years.filter((y) => stops.some((s) => Number(y) >= Number(s.From) && Number(y) <= Number(s.To || s.From)));
  return { years: out, school: stops[0].School };
}
const restOk = (s) => parseRest([s.rest1, s.rest].filter(Boolean).join(" ")) != null;

// His line for the seasons / opponents asked: { line, label, games? } | { gap }
export async function lineFor(d, ctx, restText) {
  const rest = parseRest(restText) || { seasons: null, opps: [] };
  const data = await ctx.seasons(d);
  if (!data || !data.years.length) return { gap: "no-stats" };
  const sel = seasonsSaid(rest.seasons, data.years);
  if (rest.opps.length) {
    const years = Array.isArray(sel) ? sel : null; // default / career: every season
    const games = await ctx.games(d, years || data.years);
    const hit = [];
    const missed = [];
    rest.opps.forEach((o) => { const g = gamesVs(o, games); if (g.length) hit.push(...g); else missed.push(o); });
    if (!hit.length) return { gap: "no-opponent", missed };
    const uniq = [...new Map(hit.map((g) => [g.id, g])).values()];
    const opps = [...new Set(uniq.map((g) => g.opp))];
    return { line: sumLines(uniq.map((g) => g.line)), label: `vs ${opps.join(" and ")}${uniq.length > 1 ? ` (${uniq.length} games)` : ""}`, games: uniq, missed, kind: "vs", opps, data };
  }
  if (rest.at) {
    const a = yearsAt(d, rest.at, data.years);
    if (!a) return { gap: "no-school-stop", at: rest.at };
    if (!a.years.length) return { gap: "no-season" };
    return { line: sumLines(a.years.map((y) => data.seasons[y])), label: `at ${a.school}`, kind: "at", school: a.school, years: a.years, data };
  }
  if (sel === "career") return { line: data.career, label: "career", kind: "career", data };
  const years = Array.isArray(sel) && sel.length ? sel : [data.years[data.years.length - 1]];
  if (Array.isArray(sel) && !sel.length) return { gap: "no-season" };
  return { line: sumLines(years.map((y) => data.seasons[y])), label: years.join(" + "), kind: "season", years, data };
}

export const FIELDS = {
  height: { label: "Height", key: "Height", say: (v) => (v ? sayHeight(v) : "") },
  weight: { label: "Weight", key: "Weight", say: weightText },
  school: { label: "School", key: "School", say: (v) => v || "" },
  position: { label: "Position", key: "Position", say: (v) => v || "" },
  class: { label: "Draft class", key: "Eligible", say: (v) => (v ? `the ${v} class` : "") },
};

const BASE = [
  // ════════ General ════════
  {
    id: "help",
    mode: "general",
    title: "What can I ask?",
    examples: ["what can I ask", "help"],
    patterns: [/^(?:help|what can (?:you|i) (?:do|say|ask)|what do you know|commands)$/],
    run: (_s, ctx) => ({
      say: "Here's what I understand so far.",
      title: "What you can ask",
      help: ctx.intents.filter((i) => i.id !== "help").map((i) => ({ title: i.title, mode: i.mode, examples: i.examples })),
      tone: "answer",
    }),
  },

  // ── Stats ──
  {
    id: "stats.line",
    mode: "general",
    title: "A player's stats",
    examples: ["what are Florida State's Ousmane Kromah's stats", "Kromah's 2025 stats", "Kromah's career stats", "Kromah's stats against Alabama"],
    patterns: [
      new RegExp(`^(?:(?:what (?:are|were)|what's|whats|show me|give me|pull up|read me|tell me) )?(?:the )?${WHO} (?:(?<rest1>20\\d\\d|this season|this year|last season|last year|career|college) )?(?:stats|statistics|numbers|stat line|production)(?: (?<rest>.+))?$`),
    ],
    accept: restOk,
    run: async ({ player, rest1, rest }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const r = await lineFor(d, ctx, [rest1, rest].filter(Boolean).join(" "));
      if (r.gap === "no-stats") return miss(`I don't have stats for ${nameOf(d)} yet.`, "no-stats", d);
      if (r.gap === "no-opponent") return miss(`I don't see a game for ${nameOf(d)} against ${r.missed.join(" or ")}.`, "no-opponent", d);
      if (r.gap) return miss(r.gap === "no-school-stop" ? `I don't have ${nameOf(d)} playing at ${r.at}.` : `I don't have ${nameOf(d)}'s numbers for that season.`, r.gap, d);
      const rows = lineKeys(d.Position).map((k) => [STATS[k].label, statValue(r.line, k)]).filter(([, v]) => v != null);
      if (!rows.length) return miss(`${nameOf(d)} has no stats there.`, "no-stats", d);
      const keys = lineKeys(d.Position).filter((k) => statValue(r.line, k) != null);
      const say = phrase(ctx, "stat.line", { name: await nameFor(d, ctx), label: r.label, when: whenPhrase(r), list: keys.slice(0, 4).map((k) => statSay(k, statValue(r.line, k))).join(", ") });
      return { say, ...card(d, { sub: `${facts(d)} · ${r.label}` }), rows: keys.map((k) => [STATS[k].label, statText(k, statValue(r.line, k))]), tone: "answer" };
    },
  },
  {
    id: "stats.one",
    mode: "general",
    title: "One stat — a season, career, or against opponents",
    examples: ["how many rushing yards does Kromah have", "what was Kromah's yards per carry against Alabama and Clemson", "Kromah's touchdowns in 2025", "how many sacks did Kromah have last season", "how many career rushing yards does Kromah have", "how many touchdowns"],
    patterns: [
      // Follow-ups with no name (user, 2026-11-25): "how many touchdowns?", "what about rushing yards" — the last player.
      new RegExp(`^(?:(?:and|what about|how about) )?how (?:many|much) (?<stat>${WORD_RE})(?: (?:does|did|has) (?:he|him) (?:have|had|get|got|record|finish with|put up|average))?(?: (?<rest>.+))?$`),
      new RegExp(`^(?:(?:and|what about|how about) )?(?:his )?(?<stat>${WORD_RE})(?: (?<rest>.+))?$`),
      new RegExp(`^how (?:many|much) career (?<stat>${WORD_RE}) (?:does|did|has|had) ${WHO} (?:have|had|got|record|recorded|total|totaled)$`),
      new RegExp(`^how (?:many|much) (?<stat>${WORD_RE}) (?:does|did|has|had|is|was) ${WHO} (?:have|had|got|get|put up|record|recorded|rack up|racked up|average|averaged|score|scored|throw|threw|catch|caught|make|made|rush for|run for|throw for|go for|went for|gain|gained|total|totaled|finish with|finished with|finish|finished|end with|ended with|end up with|ended up with|end the season with|ended the season with)(?: (?<rest>.+))?$`),
      new RegExp(`^(?:(?:what (?:is|was|are|were)|what's|whats|tell me|give me|show me) )?(?:the )?${WHO} (?:(?<rest1>20\\d\\d|this season|this year|last season|last year|career|college) )?(?<stat>${WORD_RE})(?: (?<rest>.+))?$`),
      new RegExp(`^(?:what (?:is|was|are|were)|what's|whats) (?:the )?(?<stat>${WORD_RE}) (?:for|of|from) (?<who>.+?)(?: (?<rest>(?:in|against|vs|versus|this|last|career|20\\d\\d)\\b.*))?$`),
    ],
    fixed: [{ who: "his" }, { who: "his" }, { rest: "career" }],
    accept: (s) => statKey(s.stat, "") != null && restOk(s),
    run: async ({ player, stat, rest1, rest }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const key = statKey(stat, d.Position);
      const r = await lineFor(d, ctx, [rest1, rest].filter(Boolean).join(" "));
      if (r.gap === "no-stats") return miss(`I don't have stats for ${nameOf(d)} yet.`, "no-stats", d);
      if (r.gap === "no-opponent") return miss(`I don't see a game for ${nameOf(d)} against ${r.missed.join(" or ")}.`, "no-opponent", d);
      if (r.gap) return miss(r.gap === "no-school-stop" ? `I don't have ${nameOf(d)} playing at ${r.at}.` : `I don't have ${nameOf(d)}'s numbers for that season.`, r.gap, d);
      const v = statValue(r.line, key);
      if (v == null) return miss(`I don't have ${STATS[key].label} for ${nameOf(d)}.`, "no-stat", d);
      // Say the one stat; show its whole line (user, 2026-11-25: rushing yards → carries, yards per carry, touchdowns too).
      const rows = [[`${STATS[key].label} · ${r.label}`, statText(key, v)], ...lineRows(r.line, relatedKeys(key).filter((k) => k !== key))];
      // The games behind an opponent split, each on its own row.
      (r.games || []).forEach((g) => rows.push([`${gameWhen(g)} ${gameTitle(g)}`, statText(key, statValue(g.line, key))]));
      const also = r.missed?.length ? ` I didn't find a game against ${r.missed.join(" or ")}.` : "";
      const y = r.kind === "season" && r.years.length === 1 ? r.years[0] : null;
      const ch = y ? seasonChange(r.data, y, key, STATS[key].num ? 30 : 0) : null;
      const note = ch ? phrase(ctx, "stat.change", { dir: ch.dir, prev: statText(key, ch.prev), prevYear: ch.prevYear, rate: !!STATS[key].num })
        : y && bestSeasonYet(r.data, y, key) ? phrase(ctx, "stat.bestYet", { rate: !!STATS[key].num }) : "";
      const said = r.kind === "career"
        ? phrase(ctx, "stat.career", { name: await nameFor(d, ctx), value: statSay(key, v), stat: STATS[key].label, verb: STATS[key].num ? "averaged" : "has", rate: !!STATS[key].num })
        : phrase(ctx, "stat.one", { name: await nameFor(d, ctx), value: statSay(key, v), label: r.label, when: whenPhrase(r), verb: STATS[key].num ? "averaged" : "had", rate: !!STATS[key].num });
      return { say: join(said, extra(ctx, note), also.trim()), ...card(d), rows, tone: "answer" };
    },
  },
  {
    id: "stats.vs",
    mode: "general",
    title: "How a player did against a team",
    examples: ["how did Kromah do against Alabama", "how did Kromah play this season"],
    patterns: [/^how (?:did|does|has|was) (?<who>.+?) (?:do|play|look|perform|fare|done|played|looked|been)(?: (?<rest>.+))?$/],
    accept: restOk,
    run: async ({ player, rest }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const r = await lineFor(d, ctx, rest);
      if (r.gap === "no-stats") return miss(`I don't have stats for ${nameOf(d)} yet.`, "no-stats", d);
      if (r.gap === "no-opponent") return miss(`I don't see a game for ${nameOf(d)} against ${r.missed.join(" or ")}.`, "no-opponent", d);
      if (r.gap) return miss(r.gap === "no-school-stop" ? `I don't have ${nameOf(d)} playing at ${r.at}.` : `I don't have ${nameOf(d)}'s numbers for that season.`, r.gap, d);
      const games = r.games || [];
      if (games.length) {
        const rows = games.map((g) => [`${gameWhen(g)} ${gameTitle(g)} · ${gameResult(g)}`, gameSummary(g.line, d.Position) || "no stats"]);
        const say = games.map((g) => `${gameWhen(g)} ${gameTitle(g)}, ${gameResult(g)}: ${gameSummary(g.line, d.Position) || "no stats"}`).join(". ");
        // Out loud: told like a breakdown, not read off the box (user, 2026-11-25).
        const speak = games.slice(0, 3).map((g) => gameStory(nameOf(d), d.School, g)).join(" ");
        return { say: `${nameOf(d)}. ${say}.`, speak, ...card(d), rows, ...(games.length === 1 ? { lastGame: gameOf(d, games[0]) } : {}), tone: "answer" };
      }
      const keys = lineKeys(d.Position).filter((k) => statValue(r.line, k) != null);
      return { say: phrase(ctx, "stat.line", { name: await nameFor(d, ctx), label: r.label, when: whenPhrase(r), list: keys.slice(0, 4).map((k) => statSay(k, statValue(r.line, k))).join(", ") }), ...card(d), rows: keys.map((k) => [STATS[k].label, statText(k, statValue(r.line, k))]), tone: "answer" };
    },
  },
  {
    id: "games.best",
    mode: "general",
    title: "Good games to watch",
    examples: ["what are some good games to watch for Kromah", "Kromah's best games", "Kromah's best games in 2025"],
    patterns: [
      /^(?:what (?:are|were) )?(?:some )?(?:(?:good|best|top|big|great|biggest) )+games (?:to watch )?(?:for|of|from|by|with) (?<who>.+?)(?: (?<rest>(?:in|this|last|20\d\d)\b.*))?$/,
      new RegExp(`^(?:what (?:are|were) )?${WHO} (?:best|top|biggest|good|great) games(?: (?<rest>.+))?$`),
      /^(?:what|which) games should i (?:watch|look at|pull up|turn on) (?:for|of|on) (?<who>.+?)(?: (?<rest>(?:in|this|last|20\d\d)\b.*))?$/,
    ],
    accept: restOk,
    run: async ({ player, rest }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const data = await ctx.seasons(d);
      if (!data || !data.years.length) return miss(`I don't have game logs for ${nameOf(d)} yet.`, "no-stats", d);
      const sel = seasonsSaid(parseRest(rest)?.seasons, data.years);
      const years = Array.isArray(sel) && sel.length ? sel : data.years.slice(-2);
      const known = new Set((await ctx.people()).map((p) => p.school).filter(Boolean));
      const top = bestGames(await ctx.games(d, years), d.Position, 5, known);
      if (!top.length) return miss(`I don't see any big games for ${nameOf(d)} there.`, "no-games", d);
      const film = ctx.filmGames ? await ctx.filmGames(d.id).catch(() => ({})) : {};
      const rows = top.map(({ game: g }) => [`${gameWhen(g)} ${gameTitle(g)} · ${gameResult(g)}${film[g.id] ? ` · 🎞 ${film[g.id]} plays` : ""}`, gameSummary(g.line, d.Position)]);
      const say = top.slice(0, 3).map(({ game: g }) => `${gameTitle(g)}, ${gameWhen(g)}: ${gameSummary(g.line, d.Position)}`).join(". ");
      return { say: phrase(ctx, "games.best", { name: await nameFor(d, ctx), list: say }), speak: bestGamesSpoken(nameOf(d), top.map((x) => x.game)), ...card(d, { sub: `${facts(d)} · best games, ${years.join(" + ")}` }), rows, tone: "answer" };
    },
  },

  // ── Facts and ranks ──
  {
    id: "player.profile",
    mode: "general",
    title: "The 411 on a player",
    examples: ["who is Usman Chroma", "tell me about Florida State's Ousmane Kromah", "give me the 411 on Kromah", "pull up Kromah"],
    patterns: [
      /^(?:tell me about|who is|who's|whos|pull up|show me|look up|bring up|what do you know about|tell me everything about|give me the 411 on|give me the four eleven on|give me a rundown on|run me through|fill me in on) (?<who>.+?)(?:'s profile| profile)?$/,
      new RegExp(`^${WHO} profile$`),
    ],
    // "Ousmane Kromah is a running back at Florida State in the 2028 draft
    // class. He ran for … in 2026. He's ranked …" (user: the bio comes later).
    run: async ({ player }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const rk = ctx.ranks ? await ctx.ranks(d).catch(() => null) : null;
      const rows = [["School", d.School], ["Position", d.Position], ["Draft class", d.Eligible], ["Height", d.Height], ["Weight", weightText(d.Weight)],
        ["Class rank", rk?.classRank && `#${rk.classRank}`], ["Position rank", rk?.positionRank && `#${rk.positionRank} ${d.Position}`]].filter(([, v]) => v);
      const line = await profileLine(d, ctx);
      return { say: join(line, d.Bio ? hint(ctx, "bio", `Say "read his bio" for more.`) : ""), ...card(d), rows, tone: "answer" };
    },
  },
  {
    id: "player.bio",
    mode: "general",
    title: "A player's bio",
    examples: ["read his bio", "read Kromah's bio", "what's Kromah's bio", "read me a scouting report on Kromah"],
    patterns: [
      new RegExp(`^(?:read|read me|read off|what is|what's|whats|give me|tell me)? ?(?:the )?${WHO} (?:bio|biography|write up|story)$`),
      /^(?:read|read me|read off|give me|tell me) (?:the )?(?:bio|biography) (?:for|of|on) (?<who>.+)$/,
      // A scouting report: his We-Draft.com write-up (user, 2026-11-25: "read me a scouting report on Jesse Legree").
      /^(?:read|read me|read off|give me|tell me|pull up|what's|whats|what is|do you have|do we have)(?: a| the| his| an)? (?:scouting report|report|write up|writeup|evaluation|eval|profile|summary|rundown|breakdown) (?:for|of|on|about) (?<who>.+)$/,
      new RegExp(`^(?:read|read me|read off|give me|tell me|pull up|what is|what's|whats)? ?(?:the )?${WHO} (?:scouting report|report|writeup|profile summary)$`),
      /^(?:read|read me|give me|tell me) (?:his|the) (?:scouting report|report|write up|writeup)$/,
    ],
    run: async ({ player }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const bio = String(d.Bio || "").replace(/^["“]+|["”]+$/g, "").trim();
      if (!bio) return miss(`${nameOf(d)} doesn't have a bio yet.`, "no-bio", d);
      return { say: bio, ...card(d), body: bio, tone: "answer" };
    },
  },
  {
    id: "player.field",
    mode: "general",
    title: "One thing about a player",
    examples: ["how tall is Kromah", "what does Kromah weigh", "what's Kromah's school"],
    patterns: [
      /^how (?:tall|big) is (?<who>.+)$/,
      /^(?:what|how much) (?:does|do) (?<who>.+?) weigh$/,
      new RegExp(`^(?:what is |what's |whats )?${WHO} (?<field>height|weight|school|position|class|draft class)$`),
      /^(?:what is |what's |whats )(?:the )?(?<field>height|weight|school|position|class|draft class) (?:of|for) (?<who>.+)$/,
      /^(?:where does|what school does) (?<who>.+?) (?:go|play)(?: to| for)?(?: school)?$/,
      /^what position (?:does|is) (?<who>.+?)(?: play)?$/,
    ],
    fixed: [{ field: "height" }, { field: "weight" }, {}, {}, { field: "school" }, { field: "position" }],
    run: async ({ player, field }, ctx) => {
      const f = FIELDS[String(field).replace("draft ", "")];
      const d = await loaded(player, ctx);
      if (!d || !f) return miss(`I couldn't load ${nameOf(player)}.`);
      const v = d[f.key];
      if (!v) return miss(`I don't have a ${f.label.toLowerCase()} for ${nameOf(d)}.`, `no-${f.key.toLowerCase()}`, d);
      // Out loud, a sentence: "George MacIntyre is 6 foot 6." (the screen keeps the row).
      const name = nameOf(d);
      const POS_WORDS = { QB: "quarterback", RB: "running back", WR: "wide receiver", TE: "tight end", OL: "offensive lineman", DL: "defensive lineman", EDGE: "edge rusher", LB: "linebacker", DB: "defensive back", K: "kicker", P: "punter" };
      const speak = {
        Height: `${name} is ${f.say(v)}.`,
        Weight: `${name} weighs ${f.say(v)}.`,
        School: `${name} plays at ${v}.`,
        Position: `${name} plays ${POS_WORDS[v] || v}.`,
        Eligible: `${name} is in the ${v} draft class.`,
      }[f.key] || `${name}: ${f.say(v)}.`;
      return { say: `${name}: ${f.say(v)}.`, speak, ...card(d), rows: [[f.label, f.key === "Weight" ? weightText(v) : v]], tone: "answer" };
    },
  },
  {
    id: "player.rank",
    mode: "general",
    title: "A player's rank",
    examples: ["what is Kromah's rank", "where does Kromah rank", "Kromah's community grade"],
    patterns: [
      /^where (?:is|does) (?<who>.+?) (?:rank|ranked|ranking|stack up)(?: .*)?$/,
      /^how does (?<who>.+?) (?:rank|stack up)$/,
      /^how (?:is|high is|highly is) (?<who>.+?) ranked$/,
      /^(?:what is |what's )?(?:the )?(?:rank|ranking) (?:of|for) (?<who>.+)$/,
      new RegExp(`^(?:what is |what's |whats )?(?:the )?${WHO} (?:rank|ranking|class rank|we draft rank|wedraft rank|position rank|overall rank|community grade|consensus grade)$`),
    ],
    run: async ({ player }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const rk = await ctx.ranks(d).catch(() => null);
      if (!rk || (!rk.classRank && !rk.positionRank)) return miss(`${nameOf(d)} isn't ranked yet.`, "no-rank", d);
      const parts = [rk.classRank && `${ordinal(rk.classRank)} overall in the ${d.Eligible} class${rk.classSize ? ` of ${rk.classSize}` : ""}`, rk.positionRank && `${ordinal(rk.positionRank)} among ${POS_PLURAL[d.Position] || `${d.Position}s`}`].filter(Boolean);
      const rows = [["Class rank", rk.classRank && `#${rk.classRank}${rk.classSize ? ` of ${rk.classSize}` : ""}`], ["Position rank", rk.positionRank && `#${rk.positionRank} ${d.Position}`], ["Community grade", rk.grade]].filter(([, v]) => v);
      const said = phrase(ctx, "rank", { name: await nameFor(d, ctx), parts: parts.join(", and ") });
      const gradeS = rk.grade ? phrase(ctx, "rank.grade", { g: rk.grade, grade: /round/i.test(rk.grade) ? `${/^[aeiou]/i.test(rk.grade) ? "an" : "a"} ${rk.grade.toLowerCase()}` : "" }) : "";
      return { say: join(said, gradeS), ...card(d), rows, tone: "answer" };
    },
  },

  // ── Evaluations ──
  {
    id: "evals.public",
    mode: "general",
    title: "Read a player's public evaluations",
    examples: ["read me evaluations of Kromah", "what are people saying about Kromah", "Kromah's evaluations"],
    patterns: [
      /^(?:read off|read out|read me|read|show me|tell me|what are|give me|pull up)? ?(?:the |some |his |all the |all )?(?:public |community |people's |other )?(?:evaluations|evals|scouting reports|reports|takes|write ups|writeups) (?:on|of|for|about) (?<who>.+)$/,
      /^what (?:do|are) (?:people|users|the community|others|fans|scouts) (?:saying|think|say|thinking) (?:about|of|on) (?<who>.+)$/,
      new RegExp(`^(?:read |read me |show me )?${WHO} (?:public |community )?(?:evaluations|evals|scouting reports|reports)$`),
    ],
    run: async ({ player }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const { list } = await ctx.publicEvals(d);
      if (!list.length) return miss(`Nobody has written a public evaluation of ${nameOf(d)} yet.`, "no-evals", d);
      const read = (i) => {
        const e = list[i];
        const bits = [e.grade && e.grade !== "Watchlist" && `Grade: ${e.grade}`, e.strengths?.length && `Strengths: ${e.strengths.join(", ")}`, e.weaknesses?.length && `Weaknesses: ${e.weaknesses.join(", ")}`, e.nflFit && `NFL fit: ${e.nflFit}`].filter(Boolean);
        const text = String(e.evaluation || "").trim();
        const lead = i === 0 ? `${list.length} public evaluation${list.length === 1 ? "" : "s"} of ${nameOf(d)}. ` : "";
        const tip = i + 1 < list.length ? hint(ctx, "next", `Say "next" for another.`) : "";
        const tail = tip ? ` ${tip}` : "";
        return {
          say: `${lead}From ${e.author}${e.verified ? ", verified" : ""}. ${bits.join(". ")}${bits.length ? ". " : ""}${text.length > 700 ? `${text.slice(0, 700)}…` : text}${tail}`,
          ...card(d, { sub: `Evaluation ${i + 1} of ${list.length} · ${e.author}${e.verified ? " ✓" : ""}` }),
          rows: bits.map((b) => b.split(": ")),
          body: text,
          tone: "answer",
          ...(i + 1 < list.length ? { more: () => read(i + 1) } : {}),
        };
      };
      return read(0);
    },
  },
  {
    id: "my.read",
    mode: "general",
    signIn: true,
    title: "Your evaluation of a player",
    examples: ["what's my round grade on Kromah", "how do I have Kromah listed", "read off my evaluation for Kromah", "what are my strengths for Kromah"],
    patterns: [
      /^(?:can you )?(?:read|read off|read me|read out) (?:off )?my (?<part>evaluation|eval|write up|writeup|report|scouting report) (?:on|for|of|about) (?<who>.+)$/,
      /^(?:what is |what's |whats |what are |what're |show me |tell me )?my (?<part>round grade|grade|board grade|evaluation|eval|take|report|nfl fit|fit|strengths and weaknesses|strengths|weaknesses) (?:on|for|of|about) (?<who>.+)$/,
      /^what (?<part>grade|round) (?:did i give|do i have on|do i have for|did i put on) (?<who>.+)$/,
      /^how (?:did i grade|do i have|have i got|did i rank|do i see|did i list) (?<who>.+?)(?: (?:listed|graded|ranked|on my board|rated))?$/,
      /^where do i have (?<who>.+?)(?: (?:listed|graded|ranked|on my board))?$/,
      /^what do i (?:have|think) (?:on |of |about )?(?<who>.+)$/,
    ],
    run: async ({ player, part = "" }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const e = await ctx.myEval(d.id);
      if (!e) return { say: `You haven't evaluated ${nameOf(d)} yet. You can say "give ${d.Last} a second round grade".`, ...card(d), tone: "answer" };
      const rows = [["Grade", e.grade], ["Strengths", (e.strengths || []).join(", ")], ["Weaknesses", (e.weaknesses || []).join(", ")], ["NFL fit", e.nflFit], ["Visibility", e.visibility], ["Game notes", e.gameNotes?.length ? String(e.gameNotes.length) : ""]].filter(([, v]) => v);
      const name = nameOf(d);
      const strengths = e.strengths?.length ? `strengths: ${e.strengths.join(", ")}` : "no strengths picked";
      const weaknesses = e.weaknesses?.length ? `weaknesses: ${e.weaknesses.join(", ")}` : "no weaknesses picked";
      const text = String(e.evaluation || "").trim();
      let say;
      if (/grade|round/.test(part) || !part) say = e.grade ? phrase(ctx, e.grade === "Watchlist" ? "my.grade.watch" : "my.grade", { name, g: e.grade === "UDFA" ? "a UDFA" : `${/^early/i.test(e.grade) ? "an" : "a"} ${e.grade.toLowerCase()} grade` }) : `You haven't given ${name} a grade yet.`;
      else if (part === "strengths") say = `Your ${name} ${strengths}.`;
      else if (part === "weaknesses") say = `Your ${name} ${weaknesses}.`;
      else if (/strengths and/.test(part)) say = `Your ${name} ${strengths}. ${weaknesses[0].toUpperCase()}${weaknesses.slice(1)}.`;
      else if (/fit/.test(part)) say = e.nflFit ? `You have ${name} fitting with the ${e.nflFit}.` : `You haven't picked an NFL fit for ${name}.`;
      else {
        // The whole evaluation, read out — the written part too.
        const bits = [e.grade && `Grade: ${e.grade}`, e.strengths?.length && `Strengths: ${e.strengths.join(", ")}`, e.weaknesses?.length && `Weaknesses: ${e.weaknesses.join(", ")}`, e.nflFit && `NFL fit: ${e.nflFit}`].filter(Boolean);
        say = `Your evaluation of ${name}. ${bits.join(". ")}${bits.length ? ". " : ""}${text ? text.replace(/^[•-]\s*/gm, "") : "You haven't written anything yet."}`;
      }
      return { say, ...card(d), rows, body: text, tone: "answer" };
    },
  },
  {
    id: "my.grade",
    mode: "general",
    signIn: true,
    title: "Grade a player",
    examples: ["give Kromah a second round grade", "set my grade for Kromah to late first", "I have Kromah as a third rounder"],
    patterns: [
      /^(?:set|change|update|make|put|move) my grade (?:for|on|of) (?<who>.+?) (?:to|at|as) (?<grade>.+)$/,
      // The grade starts after "a / an / as" — or, with none, at a grade word — so a
      // two-word name isn't cut short ("give Ousmane Kromah a second round grade").
      /^(?:give|grade) (?<who>.+?) (?:a|an|as a|as an|as) (?<grade>.+?)(?: grade)?$/,
      /^(?:give|grade) (?<who>.+?) (?<grade>(?:early|mid|middle|late|top|first|second|third|fourth|fifth|sixth|seventh|1st|2nd|3rd|4th|5th|6th|7th|day|udfa|undrafted|watch ?list)\b.*?)(?: grade)?$/,
      /^i (?:have|got|see|grade|think of) (?<who>.+?) (?:as |at )(?:a |an )?(?<grade>.+)$/,
      /^(?:grade|mark) (?<who>.+?) (?:as )?(?<grade>watch ?list|udfa|undrafted)$/,
    ],
    accept: (s) => parseGrade(s.grade) != null,
    run: ({ player, grade }, ctx) => evalWrite(player, ctx, () => {
      const g = parseGrade(grade);
      return g.ask ? { ask: g.ask } : { grade: g };
    }),
  },
  {
    id: "my.traits",
    mode: "general",
    signIn: true,
    title: "Add or remove strengths and weaknesses",
    examples: ["add vision to Kromah's strengths", "add ball security as a weakness for Kromah", "remove burst from Kromah's strengths"],
    patterns: [
      new RegExp(`^(?:add|put|mark|list) (?<traits>.+?) (?:as |to |on |in |under )(?:a |one of |my |his )*${LIST} (?:for|on|of|to) (?<who>.+)$`),
      new RegExp(`^(?:add|put|list) (?<traits>.+?) (?:to|on|in|under) (?:my )?${WHO} ${LIST}$`),
      new RegExp(`^(?<remove>remove|take|delete|drop|take off) (?<traits>.+?) (?:off |from |out of )(?:of )?(?:my )?${WHO} ${LIST}$`),
      new RegExp(`^(?<remove>remove|take|delete|drop) (?<traits>.+?) (?:off|from|out of) (?:my |his )?${LIST} (?:for|on|of) (?<who>.+)$`),
    ],
    run: async ({ player, traits, list, remove }, ctx) => {
      const which = listOf(list);
      return evalWrite(player, ctx, async (d) => {
        const all = await ctx.traits(d.Position);
        const m = matchTraits(traits, all);
        if (!m.found.length) return { error: `"${traits}" isn't one of the ${d.Position} traits.`, gap: "unknown-trait" };
        const note = m.missed.length ? `I didn't recognize ${m.missed.map((x) => `"${x}"`).join(", ")}. ` : "";
        return { [remove ? "remove" : "add"]: which, traits: m.found, note };
      });
    },
  },
  {
    id: "my.fit",
    mode: "general",
    signIn: true,
    title: "Set a player's NFL fit",
    examples: ["set my NFL fit for Kromah to the Jets", "Kromah fits with the Eagles"],
    patterns: [
      /^(?:set|change|make|put|update) my (?:nfl )?(?:fit|team fit|nfl team|team) (?:for|on|of) (?<who>.+?) (?:to|as|at|with) (?:the )?(?<team>.+)$/,
      /^(?<who>.+?) (?:fits|fits best|is a fit|would fit|is a good fit|best fits) (?:with|on|in|for) (?:the )?(?<team>.+)$/,
      /^(?:my )?(?:nfl )?fit for (?<who>.+?) is (?:the )?(?<team>.+)$/,
    ],
    accept: (s) => parseTeam(s.team) != null,
    run: ({ player, team }, ctx) => evalWrite(player, ctx, () => ({ nflFit: parseTeam(team) })),
  },

  // ════════ Admin (data entry) ════════
  {
    id: "player.set",
    mode: "admin",
    title: "Change a player's height or weight",
    examples: ["change Florida State's Ousmane Kromah's weight to 225", "set Kromah's height to six one", "update Kromah's weight to two twenty five"],
    patterns: [
      new RegExp(`^(?:change|set|update|make|put|switch) ${WHO} (?<field>height|weight) (?:to|at|as|is) (?<value>.+)$`),
      /^(?:change|set|update) (?:the )?(?<field>height|weight) (?:of|for) (?<who>.+?) (?:to|at|as) (?<value>.+)$/,
    ],
    run: async ({ player, field, value }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      // The value decides the field when they disagree: "height to 225 pounds" is a weight.
      const said = String(value);
      const h = parseHeight(said);
      const lbs = /\b(pounds?|lbs?)\b/.test(said) ? parseNumber(said.replace(/\b(pounds?|lbs?)\b/g, "").trim()) : null;
      const n = lbs ?? (h ? null : parseNumber(said));
      let f = field;
      let note = "";
      if (field === "height" && !h && n != null && n >= 120) { f = "weight"; note = `${n} is a weight, so I'll change his weight. `; }
      if (field === "weight" && h && n == null) { f = "height"; note = `That's a height, so I'll change his height. `; }
      let next;
      if (f === "weight") {
        if (n == null || n < 120 || n > 420) return miss(`I didn't catch a weight in "${said}".`);
        next = String(Math.round(n));
      } else {
        if (!h) return miss(`I didn't catch a height in "${said}". Try "six one" or "6 foot 1".`);
        next = h.text;
      }
      const F = FIELDS[f];
      const was = d[F.key];
      const show = (v) => (f === "weight" ? weightText(v) : v);
      if (String(was || "") === next) return { say: `${nameOf(d)} is already ${F.say(next)}.`, ...card(d), rows: [[F.label, show(next)]], tone: "answer" };
      return {
        confirm: {
          say: `${note}Change ${nameOf(d)}'s ${f} ${was ? `from ${F.say(was)} ` : ""}to ${F.say(next)}?`,
          ...card(d),
          rows: [[F.label, `${was ? show(was) : "—"}  →  ${show(next)}`]],
          change: { scope: "Player data", items: [{ label: F.label, from: was ? show(was) : "", to: show(next) }] },
          apply: async () => {
            await ctx.setPlayer(d.id, { [F.key]: next });
            return { say: `${phrase(ctx, "ack.done")} ${nameOf(d)}'s ${f} is ${F.say(next)}.`, ...card({ ...d, [F.key]: next }), rows: [[F.label, show(next)]], change: { scope: "Player data", items: [{ label: F.label, from: was ? show(was) : "", to: show(next) }], saved: true }, tone: "done" };
          },
        },
      };
    },
  },
  {
    id: "film.count",
    mode: "admin",
    title: "How much film a player has",
    examples: ["how many plays do I have for Florida State's Ousmane Kromah", "Kromah's film count"],
    patterns: [
      /^how many (?:film )?(?:plays|clips|cuts) (?:do i have |do we have |have i got |are there |does )?(?:for|of|on|with)? ?(?<who>.+?)(?: have)?$/,
      new RegExp(`^${WHO} (?:film|play|plays|clip) count$`),
      /^how much film (?:do i have |do we have )?(?:for|of|on) (?<who>.+)$/,
    ],
    run: async ({ player }, ctx) => {
      const plays = await ctx.filmPlays(player.id);
      const name = nameOf(player);
      if (!plays.length) return { say: `I don't have any film plays for ${name}.`, title: name, rows: [["Plays", "0"]], player, tone: "answer" };
      const key = `wd_${player.id}`;
      const tags = plays.map((p) => p.players?.[key] || {});
      const games = new Set(plays.map((p) => p.gameId)).size;
      const labeled = tags.filter((t) => t.label).length;
      const washed = tags.filter((t) => t.wash?.keys?.length).length;
      const byLabel = {};
      tags.forEach((t) => { if (t.label) byLabel[t.label] = (byLabel[t.label] || 0) + 1; });
      const rows = [["Plays", String(plays.length)], ["Games", String(games)], ["Labeled", `${labeled} of ${plays.length}`], ["Washed", `${washed} of ${plays.length}`],
        ...Object.entries(byLabel).map(([l, c]) => [l, String(c)])];
      return { say: `${name} has ${plays.length} play${plays.length === 1 ? "" : "s"} from ${games} game${games === 1 ? "" : "s"}. ${labeled} labeled.`, title: name, sub: "Film Manager", rows, player, tone: "answer" };
    },
  },
];

// Your evaluation, changed: work out the edit, then confirm before saving.
// make(d) → { grade } | { nflFit } | { add|remove, traits, note? } | { ask } | { error, gap? }
async function evalWrite(player, ctx, make) {
  const d = await loaded(player, ctx);
  if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
  const want = await make(d);
  if (want.ask) return { say: want.ask, ...card(d), tone: "ask" };
  if (want.error) return miss(want.error, want.gap, d);
  const prev = await ctx.myEval(d.id);
  const out = editEval(prev, want, { gradeLocked: ctx.gradeLocked(d) });
  if (out.error) return miss(out.error, null, d);
  const name = nameOf(d);
  const what = want.grade ? `your grade on ${name} to ${want.grade}${prev?.grade && prev.grade !== want.grade ? ` (was ${prev.grade})` : ""}`
    : want.nflFit ? `your NFL fit for ${name} to the ${want.nflFit}${prev?.nflFit && prev.nflFit !== want.nflFit ? ` (was the ${prev.nflFit})` : ""}`
      : want.add ? `${want.traits.join(" and ")} to your ${want.add} for ${name}`
        : `${want.traits.join(" and ")} from your ${want.remove} for ${name}`;
  if (!out.changed) return { say: `That's already on your evaluation of ${name}.`, ...card(d), tone: "answer" };
  const verb = want.add ? "Add" : want.remove ? "Remove" : "Set";
  const rows = [["Grade", out.next.grade], ["Strengths", out.next.strengths.join(", ")], ["Weaknesses", out.next.weaknesses.join(", ")], ["NFL fit", out.next.nflFit]].filter(([, v]) => v);
  // What changes, before → after (the page draws it; user, 2026-11-25).
  const listOf = (x) => (Array.isArray(x) ? x.join(", ") : x || "");
  const items = [["Grade", "grade"], ["Strengths", "strengths"], ["Weaknesses", "weaknesses"], ["NFL fit", "nflFit"]]
    .map(([label, k]) => ({ label, from: listOf(prev?.[k]), to: listOf(out.next[k]) }))
    .filter((x) => x.from !== x.to);
  const change = { scope: "Your evaluation", items, isNew: !prev };
  return {
    confirm: {
      say: `${want.note || ""}${verb} ${what}?${out.notes.length ? ` ${out.notes.join(" ")}` : ""}${prev ? "" : " This starts your evaluation of him."}`,
      ...card(d),
      rows,
      change,
      apply: async () => {
        await ctx.saveMyEval(d, out.next);
        const said = want.grade ? `Your grade on ${name}: ${want.grade}`
          : want.nflFit ? `Your NFL fit for ${name}: the ${want.nflFit}`
            : `${want.add ? "Added" : "Removed"} ${what}`;
        return { say: `${phrase(ctx, "ack.saved")} ${said}.`, ...card(d), rows, change: { ...change, saved: true }, tone: "done" };
      },
    },
  };
}

// The order they're tried in: the first pattern that fits wins, so the
// specific ones go before the catch-alls ("Kromah's high school" before
// "Kromah's school", your board before a stat, a record before "how did …").
const byId = Object.fromEntries(BASE.map((i) => [i.id, i]));
export const INTENTS = [
  byId.help,
  ...ADMIN_VOICE_INTENTS,
  ...READOUT_INTENTS,
  // Notes and suggestions first (their words can be anything); "request / add <player>" last.
  ...REQUEST_INTENTS.filter((i) => i.id !== "request.player"),
  ...LEADER_INTENTS, ...GAME_INTENTS, ...NFL_INTENTS,
  ...WATCH_INTENTS, ...BOARD_INTENTS, ...NOTE_INTENTS,
  byId["my.read"], byId["my.grade"], byId["my.traits"], byId["my.fit"],
  ...COMMUNITY_INTENTS, ...LIVE_INTENTS, ...FACT_INTENTS.filter((i) => i.id !== "team.roster"), ...STATS_MAX_INTENTS,
  byId["stats.line"], byId["stats.one"],
  ...DRAFT_INTENTS,
  ...TEAM_INTENTS,
  ...FACT_INTENTS.filter((i) => i.id === "team.roster"),
  byId["stats.vs"], byId["games.best"],
  ...PLAYER_INTENTS,
  byId["player.bio"], byId["player.profile"], byId["player.field"], byId["player.rank"], byId["evals.public"],
  byId["player.set"], byId["film.count"],
  ...REQUEST_INTENTS.filter((i) => i.id === "request.player"),
];

// The ones that need a We-Draft.com profile (user, 2026-11-25). For a player
// who's only on a CFBD roster these get the offer to request / add him;
// everything else (stats, games, the 411, measurements…) just answers.
//   save:   writes something about him (your grade, traits, fit, notes, watchlist; admin edits)
//   status: We-Draft.com's own data on him (rank, evaluations, community, comps, projection, bio)
const WE_DRAFT_ONLY = {
  "my.grade": "save", "my.traits": "save", "my.fit": "save", "my.note": "save", "watchlist.add": "save", "player.set": "save",
  "my.read": "status", "my.notes.read": "status", "player.rank": "status", "evals.public": "status", "community.traits": "status",
  "player.comps": "status", "draft.projection": "status", "followup.rank": "status", "player.bio": "status", "film.count": "status",
  "player.onWeDraft": "status", "analytics.player": "status",
};
INTENTS.forEach((i) => { if (WE_DRAFT_ONLY[i.id]) i.weDraft = WE_DRAFT_ONLY[i.id]; });
