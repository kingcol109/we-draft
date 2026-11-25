// src/utils/voice/intentsFacts.js
//
// /voice: measurements, draft projection, a school's players at a position,
// career / season-vs-season / best-season stats, and "how does that rank"
// after a stat (user, 2026-11-25 — template expansion).
//
// Every answer is a phrasebook wording (utils/voice/phrasebook.js) filled
// from the data; nothing is made up. A value that isn't there is never said
// as zero: the answer says it isn't on file and the miss is logged.
import { STATS, statKey, statValue, statText, statSay, seasonsSaid, relatedKeys, lineRows, mainStat, rateBase, lineKeys, WORD_RE } from "./stats";
import { findAnyPlayer } from "./intentsLive";
import { WHO, nameOf, weightText, card, miss, loaded, list } from "./reply";
import { sayHeight } from "./text";
import { phrase, join } from "./phrase";
import { nameFor, POS_NAMES } from "./refs";
import { POS_RE, positionSaid } from "./board";
import { schoolSaid } from "./names";

const W = WORD_RE;
const YEAR = "(?:20\\d\\d|this season|this year|last season|last year)";
const rateOf = (key) => !!STATS[key]?.num;

// ════════ Measurements ════════
// ════════ Draft projection ════════
// The site's projection is the community grade (the Comparison page's
// projectedRound reads the same average): "Second Round" → "in the second round".
const FIRST = { "Early First Round": "early in the first round", "Middle First Round": "in the middle of the first round", "Late First Round": "late in the first round" };
export const projectionOf = (grade) => FIRST[grade] || (/^\w+ Round$/.test(grade || "") ? `in the ${grade.replace(/ Round$/, "").toLowerCase()} round` : "");

export const FACT_INTENTS = [
  {
    id: "player.measure",
    mode: "general",
    title: "A player's height and weight",
    examples: ["how big is Kromah", "what are Kromah's measurements", "Kromah's height and weight"],
    patterns: [
      /^how (?:big|tall and heavy) is (?<who>.+)$/,
      new RegExp(`^(?:what (?:is|are) |what's |whats )?(?:the )?${WHO} (?:measurements|size|height and weight|measurables|listed size|height weight)$`),
      /^what (?:is|are) (?:the )?(?:measurements|size|height and weight) (?:of|for) (?<who>.+)$/,
    ],
    run: async ({ player }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const height = d.Height ? sayHeight(d.Height) : "";
      const weight = d.Weight ? weightText(d.Weight) : "";
      const rows = [["Height", d.Height], ["Weight", weight]].filter(([, v]) => v);
      if (!height && !weight) return miss(`I don't have a height or weight for ${nameOf(d)}.`, "no-measurements", d);
      // One of the two: say what's there, and that the other isn't.
      if (!height || !weight) return { say: `${nameOf(d)} is listed at ${height || weight}. I don't have his ${height ? "weight" : "height"}.`, ...card(d), rows, focus: d, gap: height ? "no-weight" : "no-height", tone: "answer" };
      return { say: phrase(ctx, "profile.measurement", { name: await nameFor(d, ctx), height, weight, pos: POS_NAMES[d.Position] || "" }), ...card(d), rows, tone: "answer" };
    },
  },
  {
    id: "draft.projection",
    mode: "general",
    title: "Where a player is projected to go",
    examples: ["where is Kromah projected", "what's Kromah's draft projection", "what round will Kromah go in"],
    patterns: [
      /^where (?:is|was) (?<who>.+?) (?:projected|projected to go|projected to be drafted|projected to be picked|expected to go|expected to be drafted|mocked|going)(?: in the draft)?$/,
      new RegExp(`^(?:what is |what's |whats )?(?:the )?${WHO} (?:draft )?(?:projection|projected round|draft range)$`),
      /^where will (?<who>.+?) (?:go|get drafted|be drafted|be picked|be taken)(?: in the draft)?$/,
      /^what round (?:is|will) (?<who>.+?) (?:projected|projected to go|projected in|go|go in|get drafted|get drafted in|be drafted|be drafted in|be taken|be taken in)$/,
      /^when will (?<who>.+?) (?:get drafted|be drafted|be picked|go)$/,
    ],
    run: async ({ player }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const rk = ctx.ranks ? await ctx.ranks(d).catch(() => null) : null;
      const grade = rk?.grade || "";
      if (!grade) return miss(`There's no community projection for ${nameOf(d)} yet.`, "no-projection", d);
      const rows = [["Community grade", grade], ["Class rank", rk.classRank && `#${rk.classRank}`], ["Draft class", d.Eligible]].filter(([, v]) => v);
      if (grade === "UDFA") return { say: `The community has ${nameOf(d)} as an undrafted free agent in the ${d.Eligible} class.`, ...card(d), rows, tone: "answer" };
      const projection = projectionOf(grade);
      if (!projection || !d.Eligible) return miss(`There's no community projection for ${nameOf(d)} yet.`, "no-projection", d);
      return { say: phrase(ctx, "draft.projection", { name: await nameFor(d, ctx), projection, cls: d.Eligible }), ...card(d), rows, tone: "answer" };
    },
  },
  {
    id: "team.roster",
    mode: "general",
    title: "A school's players at a position",
    examples: ["who plays running back for Florida State", "Florida State's running backs", "what quarterbacks does LSU have"],
    patterns: [
      new RegExp(`^who (?:plays|are the|is the|are|is) (?<pos>${POS_RE}) (?:for|at|on|with) (?:the )?(?<team>.+)$`),
      new RegExp(`^what (?<pos>${POS_RE}) (?:does|do) (?:the )?(?<team>.+?) have$`),
      new RegExp(`^(?:who are |list |name |show me |give me )?(?:the )?(?<team>.+?)(?:'s|s')? (?<pos>${POS_RE})(?: roster| room| group| depth chart)?$`),
    ],
    // Not a board or draft-history list ("my running backs", "all LSU second round quarterbacks").
    accept: (s) => !!positionSaid(s.pos) && !/^(?:my|his|the community|community|top|best|your|all)\b/.test(s.team || "") && !/\b(?:round|first|draft|drafted|picks?|20\d\d|top|best|early|late|day)\b/.test(s.team || ""),
    run: async ({ team: said, pos: posSaid }, ctx) => {
      const people = await ctx.people();
      const school = schoolSaid(said, people);
      const ps = positionSaid(posSaid);
      if (!school || !ps?.pos) return miss(`I don't know the school "${said}".`, "roster-no-school");
      const posName = POS_NAMES[ps.pos] || ps.label;
      // The board's players there (draft prospects, active classes) — best class rank first.
      const here = people.filter((p) => p.school === school && p.pos === ps.pos);
      if (!here.length) return miss(`I don't have any ${school} ${ps.label} on the board.`, "no-roster");
      const ranked = await Promise.all(here.map(async (p) => {
        const lst = ctx.classList ? await ctx.classList(p.cls, p.pos).catch(() => []) : [];
        return { p, rank: lst.find((x) => x.id === p.id)?.classRank || null };
      }));
      ranked.sort((a, b) => String(a.p.cls).localeCompare(String(b.p.cls)) || (a.rank || 9999) - (b.rank || 9999));
      const names = ranked.map(({ p }) => `${p.first} ${p.last}`);
      // Five said out loud at most; the rest are on screen.
      const said5 = names.slice(0, 5);
      const more = names.length - said5.length;
      const say = join(phrase(ctx, "team.roster", { team: school, pos: posName, list: list(said5), count: said5.length }), more ? `${more} more ${more === 1 ? "is" : "are"} on screen.` : "");
      // Corners / safeties: the board only knows "DB".
      const note = ps.sub ? `The board lists them as defensive backs.` : "";
      return {
        say: join(say, note),
        title: `${school} · ${posName}s`,
        sub: `${names.length} on the board`,
        rows: ranked.map(({ p, rank }) => [`${p.first} ${p.last}`, [`${p.cls} class`, rank && `#${rank} in class`].filter(Boolean).join(" · ")]),
        people: ranked.map(({ p, rank }) => ({ ...p, note: [`${p.cls} class`, rank && `#${rank} in class`].filter(Boolean).join(" · ") })),
        group: ranked.slice(0, 5).map(({ p }) => p),
        tone: "answer",
      };
    },
  },
  {
    id: "stat.seasonCompare",
    mode: "general",
    title: "A stat this season against last season",
    examples: ["compare Kromah's rushing yards in 2026 to 2025", "are Kromah's rushing yards up from last year", "how do Kromah's touchdowns this season compare to last season"],
    patterns: [
      new RegExp(`^compare ${WHO} (?<stat>${W})(?: (?:from|in|between|for))? (?<y1>${YEAR}) (?:to|and|with|vs|versus) (?<y2>${YEAR})$`),
      new RegExp(`^compare ${WHO} (?<stat>${W})(?: (?:to|with|vs|versus) (?<y2>${YEAR}))?$`),
      new RegExp(`^how (?:do|does|did) ${WHO} (?<stat>${W})(?: (?:in |from )?(?<y1>${YEAR}))? compare (?:to|with) (?<y2>${YEAR})$`),
      new RegExp(`^(?:are|is|were|was) ${WHO} (?<stat>${W})(?: (?:in |from )?(?<y1>${YEAR}))? (?:up|down)(?: or (?:up|down))?(?: (?:from|on|compared to|over|vs|versus) (?<y2>${YEAR}))?$`),
    ],
    accept: (s) => statKey(s.stat, "") != null,
    run: async ({ player, stat, y1, y2 }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const key = statKey(stat, d.Position);
      const data = await ctx.seasons(d);
      if (!data || !data.years.length) return miss(`I don't have stats for ${nameOf(d)} yet.`, "no-stats", d);
      const yearOf = (w) => { const s = w ? seasonsSaid(w, data.years) : null; return Array.isArray(s) && s.length ? s[0] : w ? "missing" : null; };
      let a = yearOf(y1) || data.years[data.years.length - 1];
      let b = yearOf(y2) || data.years[data.years.indexOf(a) - 1] || null;
      if (a === "missing" || b === "missing" || !b) return miss(`I don't have two seasons to compare for ${nameOf(d)}${b === "missing" || a === "missing" ? " there" : ""}.`, "no-season", d);
      if (Number(b) > Number(a)) [a, b] = [b, a];
      const va = statValue(data.seasons[a], key);
      const vb = statValue(data.seasons[b], key);
      if (va == null || vb == null) return miss(`I don't have ${STATS[key].label} for ${nameOf(d)} in ${va == null ? a : b}.`, "no-stat", d);
      const ta = statText(key, va);
      const tb = statText(key, vb);
      // Up / down only when the numbers (as said) differ.
      const dir = ta === tb ? "" : va > vb ? "up" : "down";
      const say = phrase(ctx, "stat.seasonCompare", { name: await nameFor(d, ctx), value: statSay(key, va), prev: statSay(key, vb), year: a, prevYear: b, dir, rate: rateOf(key) });
      // On screen: the whole line, both seasons ("—" where he has no number).
      const has = (k) => statValue(data.seasons[a], k) != null || statValue(data.seasons[b], k) != null;
      const rows = relatedKeys(key).filter(has).map((k) => [STATS[k].label, `${a}: ${statText(k, statValue(data.seasons[a], k))} · ${b}: ${statText(k, statValue(data.seasons[b], k))}`]);
      return { say, ...card(d, { sub: `${STATS[key].label} · ${a} vs ${b}` }), rows, tone: "answer" };
    },
  },
  {
    id: "stat.bestSeason",
    mode: "general",
    title: "A player's best season for a stat",
    examples: ["what was Kromah's best rushing season", "Kromah's best season", "which season did Kromah have the most rushing yards"],
    patterns: [
      new RegExp(`^(?:what (?:was|is) |what's |whats )?${WHO} (?:best|top|biggest) (?:(?<stat>${W}) )?(?:season|year)(?: (?:for|in terms of) (?<stat2>${W}))?$`),
      new RegExp(`^(?:what|which|in what|in which) (?:season|year) did ${WHO} (?:have|get|record|put up|rack up) (?:the |his )?(?:most|highest|best|highest number of|career high in) (?<stat>${W})$`),
      new RegExp(`^when did (?<who>.+?) (?:have|get|record|put up) (?:his |the )?(?:best|biggest) (?:(?<stat>${W}) )?(?:season|year)$`),
      new RegExp(`^when did (?<who>.+?) (?:have|get|record|put up) (?:the |his )?(?:most|highest) (?<stat>${W}) (?:in a|in one|for a) season$`),
    ],
    accept: (s) => (!s.stat || statKey(s.stat, "") != null) && (!s.stat2 || statKey(s.stat2, "") != null),
    run: async ({ player, stat, stat2 }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const said = stat || stat2;
      const key = said ? statKey(said, d.Position) : mainStat(d.Position);
      const data = await ctx.seasons(d);
      if (!data || !data.years.length) return miss(`I don't have stats for ${nameOf(d)} yet.`, "no-stats", d);
      let seasons = data.years.map((y) => ({ y, v: statValue(data.seasons[y], key), base: rateBase(data.seasons[y], key) })).filter((s) => s.v != null);
      if (!seasons.length) return miss(`I don't have ${STATS[key].label} for ${nameOf(d)}.`, "no-stat", d);
      // An average needs real volume: seasons with at least half his biggest workload.
      if (rateOf(key)) { const most = Math.max(...seasons.map((s) => s.base || 0)); seasons = seasons.filter((s) => (s.base || 0) >= most / 2); }
      const label = STATS[key].label;
      const rowsAll = data.years.map((y) => [`${label} · ${y}`, statText(key, statValue(data.seasons[y], key))]).filter(([, v]) => v !== "—");
      if (seasons.length === 1 && data.years.length === 1) {
        return { say: `I only have one season for ${nameOf(d)}: ${statSay(key, seasons[0].v)} in ${seasons[0].y}.`, ...card(d), rows: rowsAll, tone: "answer" };
      }
      const sorted = [...seasons].sort((x, y) => y.v - x.v);
      const best = sorted[0];
      // A tie isn't a best season: say both.
      const tied = sorted.filter((s) => statText(key, s.v) === statText(key, best.v));
      if (tied.length > 1) return { say: `${nameOf(d)} had ${statSay(key, best.v)} in ${list(tied.map((s) => s.y).sort())}.`, ...card(d), rows: rowsAll, tone: "answer" };
      const say = phrase(ctx, "stat.bestSeason", { name: await nameFor(d, ctx), year: best.y, value: statSay(key, best.v), stat: label, rate: rateOf(key) });
      const rows = [...rowsAll, ...lineRows(data.seasons[best.y], relatedKeys(key).filter((k) => k !== key)).map(([l, v]) => [`${l} · ${best.y}`, v])];
      return { say, ...card(d, { sub: `best ${label} season` }), rows, tone: "answer" };
    },
  },
  {
    // Two players side by side: the same season's line (user, 2026-11-25).
    id: "stats.compare",
    mode: "general",
    title: "Compare two players",
    examples: ["compare Kromah and Legree", "Kromah vs Legree", "who's better, Kromah or Legree"],
    patterns: [
      /^compare (?<who>.+?) (?:and|to|with|vs|versus) (?<other>.+?)(?: (?<rest>(?:in|this|last|career|20\d\d)\b.*))?$/,
      /^(?:who(?:'s| is| was) better|who has (?:better|more) (?:stats|numbers)|who(?:'s| is) more productive),? (?<who>.+?) or (?<other>.+?)$/,
      /^(?<who>.+?) (?:vs|versus) (?<other>.+?)(?: stats| numbers)?$/,
      /^how (?:does|do|did) (?<who>.+?) (?:compare|stack up|measure up) (?:to|with|against) (?<other>.+?)(?: (?<rest>(?:in|this|last|career|20\d\d)\b.*))?$/,
      /^(?:put|line up|stack|match up) (?<who>.+?) (?:against|next to|up against|with|and) (?<other>.+?)$/,
      /^(?:who(?:'s|s| is| was) )?(?:better|more productive)(?: statistically)?,? (?<who>.+?) or (?<other>.+?)$/,
    ],
    // Not a stat against an opponent ("Kromah's rushing yards vs Alabama").
    accept: (s) => !new RegExp(`\\b(?:${W})\\b`).test(s.who || "") && !/\b(?:stats|numbers|yards)\b/.test(s.who || ""),
    run: async ({ player, other, rest }, ctx, text, state) => {
      const a = await loaded(player, ctx);
      if (!a) return miss(`I couldn't load ${nameOf(player)}.`);
      const pb = /^(?:him|he|his)$/.test(other) && state?.last ? state.last : await findAnyPlayer(other, ctx, state?.aliases || {});
      if (!pb) return miss(`I don't know who "${other}" is.`, "unknown-player");
      const b = await ctx.player(pb.id);
      if (!b || b.id === a.id) return miss("Name two different players.");
      const [da, db2] = await Promise.all([ctx.seasons(a), ctx.seasons(b)]);
      if (!da?.years?.length || !db2?.years?.length) return miss(`I don't have stats for ${!da?.years?.length ? nameOf(a) : nameOf(b)} yet.`, "no-stats");
      // The season said, else each one's latest; "career" for careers.
      const sel = rest && /career/.test(rest) ? "career" : (String(rest || "").match(/20\d\d/) || [])[0] || null;
      const lineOf = (d) => (sel === "career" ? d.career : d.seasons[sel || d.years[d.years.length - 1]]);
      const yearOf = (d) => (sel === "career" ? "career" : sel || d.years[d.years.length - 1]);
      const la = lineOf(da);
      const lb = lineOf(db2);
      if (!la || !lb) return miss(`I don't have ${sel} numbers for ${!la ? nameOf(a) : nameOf(b)}.`, "no-season");
      const keys = [...new Set([...lineKeys(a.Position), ...lineKeys(b.Position)])].filter((k) => statValue(la, k) != null || statValue(lb, k) != null);
      if (!keys.length) return miss("Their stats don't overlap.", "no-stats");
      const said = (d, l) => `${nameOf(d)}, ${keys.slice(0, 3).filter((k) => statValue(l, k) != null).map((k) => statSay(k, statValue(l, k))).join(", ")}`;
      const sameYear = yearOf(da) === yearOf(db2);
      return {
        say: phrase(ctx, "compare", { when: sameYear ? (yearOf(da) === "career" ? "Careers" : `In ${yearOf(da)}`) : `${nameOf(a)} in ${yearOf(da)}, ${nameOf(b)} in ${yearOf(db2)}`, a: said(a, la), b: said(b, lb) }),
        title: `${nameOf(a)} vs ${nameOf(b)}`, sub: sameYear ? String(yearOf(da)) : `${yearOf(da)} · ${yearOf(db2)}`,
        compare: { players: [a, b], rows: keys.map((k) => [STATS[k].label, statValue(la, k) == null ? null : statValue(la, k), statValue(lb, k) == null ? null : statValue(lb, k), statText(k, statValue(la, k)), statText(k, statValue(lb, k))]) },
        rows: keys.map((k) => [STATS[k].label, `${statText(k, statValue(la, k))} · ${statText(k, statValue(lb, k))}`]),
        links: [a, b].filter((d) => d.Slug && !d.cfbdOnly).map((d) => ({ to: `/player/${d.Slug}`, label: `${d.First} ${d.Last}'s page` })),
        // "his" = the first one named; "them" = both ("add them to my watchlist").
        focus: player, group: [player, pb], tone: "answer",
      };
    },
  },
  {
    // Awards, all-conference / All-America honors, national titles (the player
    // page's Career Path accolades — anyone, a CFBD-only player too).
    id: "player.accolades",
    mode: "general",
    title: "A player's awards and honors",
    examples: ["what awards has Kromah won", "Kromah's honors", "is Kromah an All-American", "was Kromah all conference"],
    patterns: [
      /^what (?:awards|honors|accolades|trophies|achievements) (?:has|did|does) (?<who>.+?) (?:won|win|gotten|get|got|received|receive|earned|earn|have)(?: .*)?$/,
      /^(?:has|did) (?<who>.+?) (?:ever )?(?:won|win|get|gotten|earned|earn) (?:any )?(?:awards|honors|accolades|anything|any hardware)$/,
      /^(?:does|did) (?<who>.+?) have (?:any )?(?:awards|honors|accolades|hardware|all american honors|all conference honors)$/,
      /^(?:what has|what did) (?<who>.+?) (?:won|been honored for)$/,
      new RegExp(`^(?:(?:what are|what were|what's|whats|read|read me|list|tell me) )?(?:the )?${WHO} (?:awards|honors|accolades|achievements|trophies|hardware|all american honors|all conference honors)$`),
      /^(?:is|was|has) (?<who>.+?) (?:been )?(?:an? )?(?:first team |second team |third team |freshman )?(?<kind>all american|allamerican|all america|all conference|allconference|national champion|a national champion)(?: .*)?$/,
    ],
    run: async ({ player, kind }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const all = ctx.accolades ? await ctx.accolades(d).catch(() => []) : [];
      const rows = all.map((a) => [String(a.season), a.text]);
      const said = (a) => `${a.season}, ${a.text}`;
      if (kind) {
        // "is he an All-American / all-conference / a national champion?"
        const k = kind.replace(/\s+/g, "");
        // Labels as stored: "First-Team All-ACC", "Freshman All-American", "National Champion".
        const test = /america/.test(k) ? /All-America/i : /conference/.test(k) ? /All-(?!America)/i : /National Champion/i;
        const hits = all.filter((a) => test.test(a.text));
        const what = /america/.test(k) ? "an All-American honor" : /conference/.test(k) ? "an all-conference honor" : "a national title";
        if (!hits.length) return { say: `I don't have ${what} on file for ${nameOf(d)}.`, ...card(d), rows, tone: "answer" };
        return { say: `Yes. ${nameOf(d)}: ${list(hits.slice(0, 3).map(said))}.`, ...card(d), rows, tone: "answer" };
      }
      if (!all.length) return miss(`I don't have any awards or honors on file for ${nameOf(d)}.`, "no-accolades", d);
      const more = all.length > 4 ? ` ${all.length - 4} more on screen.` : "";
      return { say: phrase(ctx, "accolades", { name: nameOf(d), list: all.slice(0, 4).map(said).join("; "), more }), ...card(d, { sub: `${all.length} award${all.length === 1 ? "" : "s"} and honors` }), rows, tone: "answer" };
    },
  },
  {
    // After a stat: we don't have other players' numbers to rank it against —
    // say so, then his rank (user, 2026-11-25: "how does that rank?").
    id: "followup.rank",
    mode: "general",
    title: "How that ranks",
    examples: ["how does that rank"],
    patterns: [/^(?:and )?how does (?:that|it|this) (?:rank|compare|stack up)$/],
    fixed: [{ who: "his" }],
    run: async (slots, ctx, text, state) => {
      const rankIntent = ctx.intents.find((i) => i.id === "player.rank");
      const out = await rankIntent.run(slots, ctx);
      const afterStat = /^(?:stats\.|stat\.)/.test(state?.lastAsk?.intent || "");
      return afterStat ? { ...out, say: join("I can't rank that stat against other players yet.", out.say), gap: "stat-rank" } : out;
    },
  },
];

