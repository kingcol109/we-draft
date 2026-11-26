// src/utils/voice/intentsGames.js
//
// /voice, from the 2026-11-25 iPad log — whole families, not one wording:
//   - "who won that game?" right after an answer about one game (stats.max /
//     stats.vs keep it: state.lastGame).
//   - any season's result between two schools: "Florida State versus Virginia
//     2026, who won", "did Florida State beat Virginia", "what was the score of
//     FSU and Virginia in 2025" (compSnapshots/_filmSchedule_{season}).
//   - where a school is: "what city is Florida State in" (its home games'
//     venue, We-Draft Live's weekly slates; the state from _cfbTeams).
//   - where his high school is: "where in Maryland is St. Frances Academy",
//     "what city is his high school in" (his CFBD roster row's hs city / state).
import { miss } from "./reply";
import { plain } from "./text";
import { schoolSaid } from "./names";
import { schoolRows } from "./requests";
import { teamKey } from "../film/schedule";
import { currentSeason } from "./reply";
import { stateName } from "../highSchoolMatch";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const k = d.getDate();
  return `${MONTHS[d.getMonth()]} ${k}${k % 100 > 10 && k % 100 < 14 ? "th" : ["th", "st", "nd", "rd"][k % 10] || "th"}`;
};
const to = (s) => String(s || "").replace(/(\d+)\s*[-–]\s*(\d+)/, "$1 to $2");
const SEASON = "(?: (?:in |during |back in )?(?<season>20\\d\\d)| this (?:year|season)| last (?:year|season))?";
const SEP = "(?: vs| versus| against| v| and| or|,)";

// "florida state virginia" / "fsu vs virginia" → ["Florida State", "Virginia"]
function pair(a, b, schools) {
  if (b) { const x = schoolSaid(a, schools); const y = schoolSaid(b, schools); return x && y ? [x, y] : null; }
  const words = plain(a).replace(/^the /, "").split(" ").filter((w) => w && !["vs", "versus", "and", "against", "v", "or"].includes(w));
  for (let i = 1; i < words.length; i += 1) {
    const x = schoolSaid(words.slice(0, i).join(" "), schools);
    const y = x && schoolSaid(words.slice(i).join(" "), schools);
    if (x && y) return [x, y];
  }
  return null;
}
const seasonOf = (season, text) => (season ? Number(season) : /\blast (?:year|season)\b/.test(plain(text || "")) ? currentSeason() - 1 : currentSeason());

/** A season's games between two schools, newest first: [{ home, away, hp, ap, date }] */
async function meetings(x, y, season, ctx) {
  if (!ctx.schedule) return [];
  const games = await ctx.schedule(season).catch(() => []);
  const kx = teamKey(x);
  const ky = teamKey(y);
  return games.filter((g) => { const s = [teamKey(g.home), teamKey(g.away)]; return s.includes(kx) && s.includes(ky); })
    .filter((g) => g.hp != null && g.ap != null)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const told = (g) => {
  const [w, l, wp, lp, wHome] = g.hp >= g.ap ? [g.home, g.away, g.hp, g.ap, true] : [g.away, g.home, g.ap, g.hp, false];
  const where = g.neutral ? "" : wHome ? " at home" : " on the road";
  return { w, l, line: `${w} beat ${l} ${wp} to ${lp}${where}${dayOf(g.date) ? ` on ${dayOf(g.date)}` : ""}`, wp, lp };
};

// Where a school plays: a home game's venue (this week's slate, then the weeks before).
async function homeVenue(school, ctx) {
  const k = teamKey(school);
  const slate = ctx.liveSlate ? await ctx.liveSlate().catch(() => null) : null;
  const find = (games) => (games || []).find((g) => teamKey(g.home?.school || g.home?.name || "") === k && !g.neutralSite && g.venueCity);
  let g = find(slate?.games);
  for (let w = (slate?.week || 1) - 1; !g && w >= 1 && ctx.liveWeek; w -= 1) g = find((await ctx.liveWeek(slate.season, slate.seasonType, w).catch(() => null))?.games);
  return g ? { city: g.venueCity, state: g.venueState, venue: g.venue } : null;
}

export const GAME_INTENTS = [
  {
    id: "game.that",
    mode: "general",
    title: "Who won the game just talked about",
    examples: ["who won that game", "did they win that one", "what was the final score"],
    patterns: [
      /^(?:so )?(?:who won|who lost|who took) (?:that|the|this|that one|it)(?: game)?$/,
      /^(?:did|do) (?:he|they|his team|we|florida state|the team) (?:win|lose)(?: that game| that one| it| the game)?$/,
      /^(?:what was|whats|what's) (?:the )?(?:final )?score(?: of| in)? (?:that|the) game$/,
      /^(?:what was|whats|what's) the final(?: score)?$/,
      /^how did (?:that|the) game (?:end|turn out|finish)$/,
      /^what was the (?:result|outcome)(?: of that game)?$/,
    ],
    run: async (_s, ctx, text, state) => {
      const g = state?.lastGame;
      if (!g) return miss("Which game? Say the two teams, like \"who won Florida State and Virginia\".", "game-that-none");
      if (!g.result || !g.score) return miss(`I don't have the final for ${g.school} ${g.at} ${g.opp}.`, "game-that-noscore");
      const [a, b] = String(g.score).split(/\s*[-–]\s*/).map(Number);
      const hi = Math.max(a, b); const lo = Math.min(a, b);
      const when = dayOf(g.date) ? ` on ${dayOf(g.date)}` : "";
      const speak = g.result === "W" ? `${g.school} won that one, ${hi} to ${lo} ${g.at === "at" ? "at" : "over"} ${g.opp}${when}.`
        : g.result === "L" ? `${g.opp} won it, ${hi} to ${lo}. ${g.school} lost ${g.at === "at" ? "on the road" : "at home"}${when}.`
          : `It ended in a ${to(g.score)} tie${when}.`;
      return { say: speak, speak, title: `${g.school} ${g.at} ${g.opp}`, sub: `${g.result} ${g.score}`, tone: "answer" };
    },
  },
  {
    id: "game.result",
    mode: "general",
    title: "Who won a game between two schools (any season)",
    examples: ["Florida State versus Virginia 2026 who won", "did Florida State beat Virginia", "who won Florida State Virginia in 2025", "what was the score of the Florida State Virginia game in 2026"],
    patterns: [
      new RegExp(`^(?:the )?(?<a>.+?)${SEP} (?:the )?(?<b>.+?)${SEASON}(?: game)?,? (?:who won|who lost|what was the score|what was the final|final score|score)$`),
      new RegExp(`^who won (?:the )?(?<a>.+?)${SEP} (?:the )?(?<b>.+?)(?: game)?${SEASON}$`),
      new RegExp(`^who won (?:the )?(?<a>.+?)(?: game)? (?:in |back in )(?<season>20\\d\\d)$`),
      new RegExp(`^(?:did|do|does) (?:the )?(?<a>.+?) (?<verb>beat|lose to|win against|defeat|win over|lose against|top) (?:the )?(?<b>.+?)${SEASON}$`),
      new RegExp(`^what was the (?:final )?score (?:of|in|for) (?:the )?(?<a>.+?)${SEP} (?:the )?(?<b>.+?)(?: game)?${SEASON}$`),
      new RegExp(`^what was the (?:final )?score (?:of|in|for) (?:the )?(?<a>.+?) game (?:in |back in )(?<season>20\\d\\d)$`),
    ],
    run: async ({ a, b, season, verb }, ctx, text) => {
      const schools = await schoolRows(ctx);
      const two = pair(a, b, schools);
      if (!two) return miss(`I don't know both teams in "${[a, b].filter(Boolean).join(" and ")}".`, "result-no-teams");
      const yr = seasonOf(season, text);
      let games = await meetings(two[0], two[1], yr, ctx);
      // Not this season (or not played yet): the season before.
      let year = yr;
      if (!games.length && !season) { games = await meetings(two[0], two[1], yr - 1, ctx); year = yr - 1; }
      if (!games.length) return { say: `I don't see a ${two[0]}–${two[1]} game in ${yr}.`, tone: "answer", gap: "result-none" };
      const t = told(games[0]);
      let speak = `${t.line}${year !== currentSeason() ? `, in ${year}` : ""}.`;
      if (verb) {
        const asked = schoolSaid(a, schools);
        const askedWon = asked === t.w;
        const winWords = /beat|win|defeat|top/.test(verb);
        speak = `${askedWon === winWords ? "Yes." : "No."} ${speak}`;
      }
      if (games.length > 1) speak += ` They played twice that season; that's the latest.`;
      return {
        say: speak, speak,
        title: `${games[0].away} at ${games[0].home}`, sub: `${games[0].away} ${games[0].ap} – ${games[0].home} ${games[0].hp} · ${year}`,
        rows: games.map((g) => [`${g.away} at ${g.home}`, `${g.ap}–${g.hp}${g.date ? ` · ${dayOf(g.date)}` : ""}`]),
        lastGame: { school: t.w, opp: t.l, at: "vs", result: "W", score: `${t.wp}-${t.lp}`, date: games[0].date },
        tone: "answer",
      };
    },
  },
  {
    id: "hs.where",
    mode: "general",
    title: "Where his high school is",
    examples: ["where is his high school", "where in Maryland is St. Frances Academy", "what city is his high school in"],
    patterns: [
      /^where(?: in (?<st>[a-z ]+?))? (?:is|was|did) (?:his |that |the )?(?:high school|school he went to|school he played at)(?: located| at)?$/,
      /^where(?: in (?<st>[a-z ]+?))? (?:is|was) (?:saint |st |the )?(?<hs>[a-z' ]+? (?:academy|high school|high|prep|preparatory|catholic|christian|institute|hs))(?: located)?$/,
      // (As heard on the iPad: "where in Maryland did Saint Francis Academy".)
      /^where in (?<st>[a-z ]+?) (?:did|does|do) (?:saint |st |the )?(?<hs>[a-z' ]+? (?:academy|high school|high|prep|preparatory|catholic|christian|institute))$/,
      /^what (?:city|town|part of [a-z ]+) is (?:his high school|(?:saint |st |the )?(?<hs>[a-z' ]+? (?:academy|high school|high|prep|preparatory|catholic|christian|school|institute|hs))) (?:in|located in)$/,
    ],
    run: async (_s, ctx, text, state) => {
      const p = state?.last;
      if (!p) return miss("Whose high school? Ask about the player first.", "hs-where-nobody");
      const d = ctx.player ? await ctx.player(p.id).catch(() => null) : null;
      const school = d?.School || p.school;
      const name = `${d?.First || p.first} ${d?.Last || p.last}`.trim();
      const roster = school && ctx.cfbdRoster ? await ctx.cfbdRoster(school).catch(() => null) : null;
      const row = roster?.players?.find((r) => (d?.cfbd || p.cfbd) && String(r.id) === String(d?.cfbd || p.cfbd)) || roster?.players?.find((r) => plain(`${r.first} ${r.last}`) === plain(name));
      const hs = d?.HighSchool || row?.hs;
      const city = row?.hsc;
      const st = row?.hss ? stateName(row.hss) : d?.State;
      if (!hs) return miss(`I don't have ${name}'s high school.`, "hs-where-none", d || undefined);
      const speak = city ? `${hs} is in ${city}${st ? `, ${st}` : ""}. That's where ${name} played high school ball.` : `${hs} is in ${st || "a state I don't have"}. I don't have the city.`;
      return { say: speak, speak, title: hs, sub: [city, st].filter(Boolean).join(", "), tone: "answer" };
    },
  },
  {
    id: "team.city",
    mode: "general",
    title: "Where a school is",
    examples: ["what city is Florida State in", "where is Florida State located", "what state is Oregon State in"],
    patterns: [
      /^what (?<what>city|town|state) (?:is|are) (?:the )?(?<team>.+?) (?:in|located in|based in|out of)$/,
      /^where (?:is|are) (?:the )?(?<team>.+?) (?:located|based|at|out of)$/,
      /^where (?:is|are) (?:the )?(?<team>.+?)(?:'s|s)? (?:campus|stadium|home field|school)$/,
      /^where (?:do|does) (?:the )?(?<team>.+?) play (?:home games|their home games|at home)$/,
    ],
    run: async ({ team, what }, ctx) => {
      const school = schoolSaid(team, await schoolRows(ctx));
      if (!school) return miss(`I don't know the school "${team}".`, "city-no-school");
      const teams = ctx.teams ? await ctx.teams().catch(() => []) : [];
      const t = teams.find((x) => x.school === school);
      const v = what === "state" ? null : await homeVenue(school, ctx);
      const st = v?.state ? stateName(v.state) || v.state : t?.state ? stateName(t.state) || t.state : "";
      if (!v && !st) return miss(`I don't know where ${school} is.`, "city-none");
      const speak = v ? `${school} plays in ${v.city}${st ? `, ${st}` : ""}${v.venue ? `, at ${v.venue}` : ""}.` : `${school} is in ${st}.`;
      return { say: speak, speak, title: school, sub: [v?.city, st].filter(Boolean).join(", "), tone: "answer" };
    },
  },
];

