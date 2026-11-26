// src/utils/voice/intentsWatch.js
//
// /voice (user, 2026-11-25):
//   - the NFL draft's history ("who went first overall in 2007", "every
//     quarterback taken first overall", "Ohio State first round defensive
//     linemen", "the earliest quarterback ever drafted from LSU", "when was
//     Joe Burrow drafted")
//   - who's worth watching on a team's offense / defense ("I'm watching
//     Louisiana Tech's offense — anybody else on their offense or
//     Charlotte's defense?"): our board's prospects there + ESPN's season
//     leaders
//   - suggest someone to watch ("a 2028 quarterback", "a true freshman")
//   - add him / them to my watchlist (a Watchlist evaluation, like the
//     board's + button)
// Same shape as intents.js. A reply's `focus` (one player) / `group` (a few)
// is who "him" / "them" means next.
import { plain } from "./text";
import { nameOf, miss, ordinal, list, currentSeason } from "./reply";
import { positionSaid } from "./board";
import { parseDraftQuery, runDraftQuery, findDrafted } from "./draft";
import { teamKey } from "../film/schedule";
import { findPlayer } from "./names";
import { seasonSentences, seasonVars } from "./stats";
import { phrase, choose, extra, hint, join } from "./phrase";
import { topRank, bigSeason, pedigree } from "./insights";
import { POS_NAMES, POS_PLURAL, teamOf } from "./refs";

const OFFENSE = ["QB", "RB", "WR", "TE", "OL"];
const DEFENSE = ["DL", "EDGE", "LB", "DB"];
const POSITIONS = [...OFFENSE, ...DEFENSE];
const roundWord = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"][n] || `round ${n}`;
const pickPhrase = (r) => (r.pick === 1 ? "first overall" : r.pick ? `${ordinal(r.pick)} overall` : `in the ${roundWord(r.round)} round`);
// A pick in a sentence; a wording that leaves out the team gets it after ("The Oakland Raiders took him.").
const draftSay = (ctx, v) => {
  const s = phrase(ctx, "draft.history", v);
  return v.team && !s.includes(v.team) ? join(s, `The ${v.team} took him.`) : s;
};
const rowPeople = (r) => ({ id: r.id, first: r.first, last: r.last, pos: r.pos, school: r.school, cls: r.cls });

// ════════ The draft's history ════════
const describe = (q) => {
  const what = q.pos ? POS_PLURAL[q.pos] || "players" : "players";
  const bits = [
    q.school && `from ${q.school}`,
    q.pick === 1 ? "taken first overall" : q.pick ? `taken ${ordinal(q.pick)} overall` : q.maxPick ? `taken in the top ${q.maxPick}` : "",
    q.round ? `in the ${roundWord(q.round)} round` : q.rounds ? (q.rounds[0] === 2 ? "on day two" : "on day three") : "",
    q.team && `by the ${q.team}`,
    q.years ? `in ${list(q.years.map(String))}` : q.from && q.to ? `from ${q.from} to ${q.to}` : q.from ? `since ${q.from}` : "",
  ].filter(Boolean);
  return `${what} ${bits.join(" ")}`.trim();
};

export const DRAFT_INTENTS = [
  {
    id: "draft.player",
    mode: "general",
    title: "When a player was drafted",
    examples: ["when was Joe Burrow drafted", "what pick was Fernando Mendoza", "who drafted Ja'Marr Chase"],
    patterns: [
      /^(?:when|where|what round|what pick|how high|what year|what number) (?:was|did|is|were) (?<name>.+?) (?:drafted|picked|taken|selected|get drafted|go in the draft|go)(?: in| at)?$/,
      /^(?:what (?:round|pick|team|year) (?:was|did)) (?<name>.+?) (?:drafted|go|go in|get drafted|taken)(?: in)?$/,
      /^(?:was|did) (?<name>.+?) (?:drafted|get drafted|go in the draft)$/,
      /^who drafted (?<name>.+)$/,
      /^what pick was (?<name>.+)$/,
    ],
    run: async ({ name }, ctx) => {
      const { rows } = await ctx.draftHistory();
      const hits = findDrafted(name, rows);
      if (!hits.length) {
        // A prospect still in college?
        const f = findPlayer(name, await ctx.people());
        if (f.player) return { say: `${f.player.first} ${f.player.last} hasn't been drafted yet. He's in the ${f.player.cls} draft class.`, title: `${f.player.first} ${f.player.last}`, sub: `${f.player.pos} · ${f.player.school}`, focus: f.player, tone: "answer" };
        return miss(`I don't have a draft pick named "${name}". The history goes back to 2000.`, "unknown-draftee");
      }
      if (hits.length > 1) return { say: `There's more than one: ${list(hits.slice(0, 4).map((r) => `${r.name}, ${r.school}, ${r.year}`))}.`, title: "Drafted players", rows: hits.map((r) => [`${r.name} · ${r.pos}, ${r.school}`, `${r.year} · R${r.round} #${r.pick || "—"} · ${r.team}`]), tone: "answer" };
      const r = hits[0];
      return { say: draftSay(ctx, { name: r.name, pos: POS_NAMES[r.pos] || r.pos, school: r.school, pickP: r.pick && r.pick !== 1 ? `${pickPhrase(r)} in the ${roundWord(r.round)} round` : pickPhrase(r), year: r.year, team: r.team }), title: r.name, sub: `${r.pos} · ${r.school}`, rows: [["Draft", String(r.year)], ["Round", String(r.round)], ["Pick", r.pick ? String(r.pick) : "—"], ["Team", r.team || "—"]], tone: "answer" };
    },
  },
  {
    id: "draft.query",
    mode: "general",
    title: "The NFL draft's history",
    examples: ["who went first overall in 2007", "list all quarterbacks that went first overall", "list all Ohio State first round defensive linemen", "who was the earliest quarterback ever drafted from LSU", "how many first round picks has Alabama had since 2015"],
    patterns: [/^(?<q>.*\b(?:drafted|draft|went|go|picked|pick|picks|overall|selected|taken|first rounders?|second rounders?|round)\b.*)$/],
    // Draft words only: "drafted", "overall", "picks", "first round" — "went" / "go"
    // count only with "overall / round / number / first / top" ("where did he go
    // to high school" isn't the draft).
    // "ask We-Draft to add …": the site's name isn't the draft.
    accept: (s) => !/\b(?:my|i have|i gave|i got|grade|grades|graded|mock|mocks)\b/.test(s.q) && !/\b(?:threw|throw|thrown|intercepted)\b/.test(s.q) && !/\bwe ?draft\b/.test(s.q)
      && (/\b(?:drafted|draft|overall|picked|selected|taken|first rounders?|second rounders?|picks?|round)\b/.test(s.q) || (/\b(?:went|go)\b/.test(s.q) && /\b(?:overall|round|number|first|top)\b/.test(s.q))),
    run: async ({ q: said }, ctx) => {
      const { rows, to } = await ctx.draftHistory();
      if (!rows.length) return miss("I can't reach the draft history right now.", "no-draft-history");
      const schools = [...new Set(rows.map((r) => r.school))];
      const q = parseDraftQuery(said, schools);
      if (!q) return miss(`Sorry, I couldn't tell what part of the draft you meant.`, "draft-not-understood");
      // A draft that hasn't happened: the top of that class on our board.
      if (q.years && to && q.years.every((y) => y > to)) {
        const y = q.years[0];
        const top = await ctx.topProspects(String(y));
        const p = top[0];
        return {
          say: `The ${y} draft hasn't happened yet.${p ? ` The top of We-Draft.com's ${y} board is ${p.first} ${p.last}, ${POS_NAMES[p.pos] || p.pos} at ${p.school}.` : ""}`,
          title: `${y} NFL Draft`, sub: "not drafted yet", rows: top.slice(0, 10).map((x, i) => [`${i + 1}. ${x.first} ${x.last}`, `${x.pos} · ${x.school}`]), ...(p ? { focus: p } : {}), tone: "answer",
        };
      }
      const hits = runDraftQuery(rows, q);
      const what = describe(q);
      const rowsOut = hits.slice(0, 100).map((r) => [`${r.year} · ${r.name}`, `${r.pos}, ${r.school} · R${r.round}${r.pick ? ` #${r.pick}` : ""}${r.team ? ` · ${r.team}` : ""}`]);
      if (!hits.length) return { say: `I don't have any ${what}.`, title: "NFL Draft history", sub: what, tone: "answer" };
      if (q.count) return { say: `${hits.length} ${hits.length === 1 ? what.replace(/s\b/, "") : what}.`, title: "NFL Draft history", sub: what, rows: rowsOut, tone: "answer" };
      if (hits.length === 1) {
        const r = hits[0];
        return { say: draftSay(ctx, { name: r.name, pos: POS_NAMES[r.pos] || r.pos, school: r.school, pickP: pickPhrase(r), year: r.year, team: r.team }), title: r.name, sub: `${r.year} · round ${r.round}${r.pick ? `, pick ${r.pick}` : ""}`, rows: rowsOut, tone: "answer" };
      }
      const showSchool = !q.school;
      const showYear = !(q.years && q.years.length === 1);
      const names = hits.slice(0, 15).map((r) => [showYear && r.year, r.name, showSchool && r.school, !q.pick && r.pick && `pick ${r.pick}`].filter(Boolean).join(", "));
      return { say: `${hits.length} ${what}: ${names.join("; ")}${hits.length > 15 ? `; and ${hits.length - 15} more` : ""}.`, title: "NFL Draft history", sub: what, rows: rowsOut, tone: "answer" };
    },
  },
];

// ════════ Who to watch on a team ════════
const LEADER = {
  passingYards: ["passing yards", (v) => `${v.toLocaleString()} passing yards`],
  rushingYards: ["rushing yards", (v) => `${v.toLocaleString()} rushing yards`],
  receivingYards: ["receiving yards", (v) => `${v.toLocaleString()} receiving yards`],
  totalTackles: ["tackles", (v) => `${v} tackles`],
  sacks: ["sacks", (v) => `${v} sacks`],
  interceptions: ["interceptions", (v) => `${v} interceptions`],
};
const SIDE_CATS = { offense: ["passingYards", "rushingYards", "receivingYards"], defense: ["totalTackles", "sacks", "interceptions"] };
const SIDE_WORDS = { offense: "offense", offensive: "offense", defense: "defense", defensive: "defense" };

// "louisiana tech's offense … their offense or charlotte's defense" → [{ school, side }]
export function teamSides(text, schools) {
  const words = plain(text).split(" ");
  const keys = new Map(schools.map((s) => [teamKey(s), s]));
  const out = [];
  let last = null;
  const findTeam = (end) => {
    for (let n = Math.min(4, end); n >= 1; n -= 1) {
      const s = keys.get(teamKey(words.slice(end - n, end).join(" ")));
      if (s) return s;
    }
    return null;
  };
  words.forEach((w, i) => {
    const before = findTeam(i);
    if (before && !SIDE_WORDS[w]) last = before;
    if (!SIDE_WORDS[w]) return;
    const prev = words[i - 1];
    const team = before || (/^(their|them|that|the same|same|his)$/.test(prev) ? last : null) || last;
    if (team) { out.push({ school: team, side: SIDE_WORDS[w] }); last = team; }
  });
  // A team with no side said: both.
  if (!out.length) {
    for (let i = words.length; i >= 1; i -= 1) { const s = findTeam(i); if (s) { out.push({ school: s, side: "offense" }, { school: s, side: "defense" }); break; } }
  }
  return out.filter((x, i, a) => a.findIndex((y) => y.school === x.school && y.side === x.side) === i);
}

export const WATCH_INTENTS = [
  {
    id: "watch.team",
    mode: "general",
    title: "Who's worth watching on a team",
    examples: ["I'm watching Louisiana Tech's offense, is there anybody else on their offense or Charlotte's defense I should watch", "who should I watch on Ohio State's defense", "anybody worth watching on Charlotte"],
    patterns: [/^(?<q>.*\b(?:watch|watching|worth|anybody|anyone|somebody|someone|players?|guys|prospects|names)\b.*\b(?:offense|defense|offensive|defensive|on [a-z].*)$)/],
    // Not the site's own board ("top 5 players on We-Draft", "number one on We-Draft").
    accept: (s) => !/\bmy (?:board|watch ?list|notes)\b/.test(s.q) && !/^(?:add|put|suggest|recommend)\b/.test(s.q) && !/\bwe ?draft\b|\btop (?:\d+|two|three|five|ten) (?:players|prospects)\b|\bnumber one\b/.test(s.q),
    run: async ({ q: said }, ctx) => {
      const teams = await ctx.teams();
      const people = await ctx.people();
      const schools = [...new Set([...teams.map((t) => t.school), ...people.map((p) => p.school)])].filter(Boolean);
      const asks = teamSides(said, schools);
      if (!asks.length) return miss("Which team did you mean?", "watch-no-team");
      const board = ctx.uid ? new Set((await ctx.myBoard().catch(() => [])).map((e) => e.playerId)) : new Set();
      const season = currentSeason();
      const say = [];
      const rows = [];
      const named = [];
      const offBoard = [];
      const cards = []; // the players named, drawn on the page
      for (const { school, side } of asks) {
        const posSet = side === "offense" ? OFFENSE : DEFENSE;
        // Our board's prospects there (not already on yours), best class rank first.
        const ours = people.filter((p) => p.school === school && posSet.includes(p.pos) && !board.has(p.id));
        const ranked = await Promise.all(ours.map(async (p) => {
          const lst = await ctx.classList(p.cls, p.pos).catch(() => []);
          const r = lst.find((x) => x.id === p.id);
          return { p, rank: r?.classRank || 9999 };
        }));
        ranked.sort((a, b) => a.rank - b.rank);
        // ESPN's season leaders on that side, not already named.
        const leaders = await ctx.teamLeaders(school, season).catch(() => []);
        const ourNames = new Set(people.filter((p) => p.school === school).map((p) => plain(`${p.first} ${p.last}`)));
        const prod = [];
        SIDE_CATS[side].forEach((cat) => {
          const top = leaders.filter((l) => l.cat === cat).sort((a, b) => b.value - a.value)[0];
          if (top && top.value > 0 && !prod.some((x) => x.id === top.id)) prod.push(top);
        });
        const label = `${school} ${side}`;
        const boardBit = ranked.length ? `on our board, ${list(ranked.slice(0, 4).map(({ p, rank }) => `${p.first} ${p.last}, ${POS_NAMES[p.pos] || p.pos}${rank < 9999 ? `, ranked ${ordinal(rank)} in the ${p.cls} class` : `, ${p.cls} class`}`))}` : "";
        const prodBit = prod.length ? `producing this season: ${list(prod.map((l) => `${l.pos ? `${l.pos} ` : ""}${l.name} with ${LEADER[l.cat][1](l.value)}`))}` : "";
        say.push(`${label}: ${[boardBit, prodBit].filter(Boolean).join(". And ") || "nobody stands out on our board or in ESPN's leaders"}`);
        ranked.forEach(({ p, rank }) => { rows.push([`${label} · ${p.first} ${p.last}`, `${p.pos} · ${p.cls}${rank < 9999 ? ` · #${rank}` : ""} · on our board`]); named.push(p); cards.push({ ...p, note: `On our board${rank < 9999 ? ` · #${rank} in ${p.cls}` : ""}` }); });
        prod.forEach((l) => {
          rows.push([`${label} · ${l.name}`, `${l.pos} · ${l.year} · ${LEADER[l.cat][1](l.value)}`]);
          if (!ourNames.has(plain(l.name))) offBoard.push(l.name);
          const [first, ...last] = String(l.name || "").split(" ");
          if (!cards.some((c) => `${c.first} ${c.last}` === l.name)) cards.push({ first, last: last.join(" "), pos: l.pos, school, note: LEADER[l.cat][1](l.value) });
        });
      }
      const one = named.length === 1 ? named[0] : null;
      return {
        say: join(`${say.join(". ")}.`, one ? hint(ctx, "watchlist", `Say "add him to my watchlist" to save ${one.first} ${one.last}.`) : named.length > 1 ? hint(ctx, "watchlist", `Say "add them to my watchlist" to save the ones on our board.`) : ""),
        title: "Worth watching", sub: asks.map((a) => `${a.school} ${a.side}`).join(" · "), rows, people: cards, tone: "answer",
        ...(one ? { focus: one } : {}), ...(named.length ? { group: named } : {}), ...(!named.length && offBoard.length === 1 ? { offBoard: offBoard[0] } : {}),
      };
    },
  },
  {
    id: "suggest.player",
    mode: "general",
    title: "Suggest someone to watch",
    examples: ["suggest a player for me to watch", "can you suggest a 2028 quarterback for me to watch", "suggest a true freshman for me to watch", "who should I watch"],
    patterns: [
      /^(?:suggest|recommend|give me|find me|pick|name)(?: me)? (?:a |an |one |some |another |a random |someone|somebody)?(?<what>.*?)(?: (?:for me )?to (?:watch|scout|look at|study|evaluate|check out))?(?: for me)?(?: to watch)?$/,
      /^who should i (?:watch|scout|look at|check out|study)(?: next| today| tonight| this week)?(?<what>.*)$/,
    ],
    accept: (s) => parseSuggest(s.what) != null,
    run: async ({ what }, ctx) => suggestOne(parseSuggest(what), ctx, new Set()),
  },
  {
    id: "watchlist.add",
    mode: "general",
    signIn: true,
    title: "Add a player to your watchlist",
    examples: ["add him to my watchlist", "add Kromah to my watchlist", "add them all to my watchlist"],
    patterns: [
      /^(?:add|put|throw|stick|save) (?<group>them all|all of them|them|those guys|those players|all those guys|all three|both of them|both|the whole group) (?:to|on|onto|in) my (?:watch ?list|board|list)$/,
      /^(?:add|put|throw|stick|save) (?<who>.+?) (?:to|on|onto|in) my (?:watch ?list|board|list)$/,
      /^(?:watch ?list) (?<who>.+)$/,
    ],
    run: async ({ player, group }, ctx, text, state) => {
      const list0 = group ? (state?.group || []) : [player];
      if (!list0.length || !list0[0]) return miss(state?.offBoard ? `${state.offBoard} isn't on We-Draft.com's board yet, so I can't add him.` : "Who should I add?", state?.offBoard ? "off-board" : null);
      const fresh = [];
      const already = [];
      for (const p of list0) {
        const e = await ctx.myEval(p.id); // eslint-disable-line no-await-in-loop
        if (e) already.push(`${p.first || p.First} ${p.last || p.Last} (${e.grade || "on your board"})`); else fresh.push(p);
      }
      if (!fresh.length) return { say: `${list(already)} ${already.length === 1 ? "is" : "are"} already on your board.`, title: "Your watchlist", tone: "answer" };
      const names = fresh.map((p) => `${p.first || p.First} ${p.last || p.Last}`);
      return {
        confirm: {
          say: `Add ${list(names)} to your watchlist?${already.length ? ` ${list(already)} ${already.length === 1 ? "is" : "are"} already on your board.` : ""}`,
          title: "Your watchlist", sub: names.join(" · "), rows: fresh.map((p) => [`${p.first || p.First} ${p.last || p.Last}`, `${p.pos || p.Position} · ${p.school || p.School}`]),
          change: { scope: "Your watchlist", items: names.map((n) => ({ label: n, from: "", to: "Watchlist" })), isNew: true },
          apply: async () => {
            for (const p of fresh) {
              const d = await ctx.player(p.id); // eslint-disable-line no-await-in-loop
              if (d) await ctx.saveMyEval(d, { grade: "Watchlist", strengths: [], weaknesses: [], nflFit: "" }, { visibility: "private" }); // eslint-disable-line no-await-in-loop
            }
            return { say: `Added ${list(names)} to your watchlist.`, title: "Your watchlist", rows: fresh.map((p) => [`${p.first || p.First} ${p.last || p.Last}`, "Watchlist"]), change: { scope: "Your watchlist", items: names.map((n) => ({ label: n, from: "", to: "Watchlist" })), isNew: true, saved: true }, tone: "done" };
          },
        },
      };
    },
  },
];

// ════════ Suggestions ════════
const PROSPECT_CLASSES = ["2027", "2028", "2029"];
// "a 2028 quarterback" / "a true freshman" / "a running back from ohio state" → { cls, pos, school } | null (words it can't place)
export function parseSuggest(said) {
  let t = plain(said || "").replace(/\b(?:a|an|the|one|some|random|good|new|sleeper|player|players|prospect|prospects|guy|guys|someone|somebody|for me|to watch|to scout|me|please|another|other|draft|class|of|in)\b/g, " ").replace(/\s+/g, " ").trim();
  const q = {};
  const y = t.match(/\b(20\d\d)\b/);
  if (y) { q.cls = y[1]; t = t.replace(y[0], " ").trim(); }
  const season = currentSeason();
  const yearWord = t.match(/\b(true freshman|freshman|freshmen|sophomore|sophomores|junior|juniors)\b/);
  if (yearWord) {
    const add = /fresh/.test(yearWord[1]) ? 3 : /soph/.test(yearWord[1]) ? 2 : 1;
    q.cls = String(season + add);
    q.year = yearWord[1].replace(/s$/, "").replace("freshmen", "freshman");
    t = t.replace(yearWord[0], " ").trim();
  }
  const from = t.match(/\b(?:from|at|on|out of) (.+)$/);
  if (from) { q.school = from[1]; t = t.replace(from[0], " ").trim(); }
  if (t) {
    const p = positionSaid(t);
    if (!p || !p.pos) return null;
    q.pos = p.pos;
    q.sub = p.sub;
  }
  return q;
}
async function suggestOne(q, ctx, skip, random = ctx.random || Math.random) {
  const board = ctx.uid ? new Set((await ctx.myBoard().catch(() => [])).map((e) => e.playerId)) : new Set();
  const classes = q.cls ? [q.cls] : PROSPECT_CLASSES;
  const positions = q.pos ? [q.pos] : POSITIONS;
  // A class and position picked at random first, one list read at a time,
  // stopping at the first with someone new — one read, not all 27 lists.
  const combos = classes.flatMap((cls) => positions.map((pos) => [cls, pos]));
  for (let i = combos.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [combos[i], combos[j]] = [combos[j], combos[i]]; }
  let pool = [];
  for (const [cls, pos] of combos) {
    const rows = await ctx.classList(cls, pos).catch(() => []); // eslint-disable-line no-await-in-loop
    pool = rows.map((r) => ({ ...r, pos, cls })).filter((r) => !board.has(r.id) && !skip.has(r.id) && (!q.sub || r.sub === q.sub) && (!q.school || teamKey(r.school) === teamKey(q.school)));
    if (pool.length) break;
  }
  if (!pool.length) return miss("I couldn't find anyone new that fits. They might all be on your board already.", "suggest-empty");
  // Someone worth it: the better half of each list, by class rank.
  pool.sort((a, b) => (a.classRank || 9999) - (b.classRank || 9999));
  const top = pool.slice(0, Math.max(10, Math.ceil(pool.length / 2)));
  const r = top[Math.floor(random() * top.length)];
  const p = rowPeople(r);
  const d = await ctx.player(r.id).catch(() => null);
  const line = await profileLine(d || { First: r.first, Last: r.last, Position: r.pos, School: r.school, Eligible: r.cls }, ctx, { pronoun: true }).catch(() => "");
  const next = new Set([...skip, r.id]);
  return {
    say: join(phrase(ctx, "suggest", { name: `${r.first} ${r.last}` }), line, hint(ctx, "suggest", `Say "add him to my watchlist" to save him, or "another" for someone else.`)),
    title: `${r.first} ${r.last}`, sub: `${r.pos} · ${r.school} · ${r.cls}${r.classRank ? ` · #${r.classRank} in class` : ""}`, player: d || undefined,
    rows: [["Position", POS_NAMES[r.pos] || r.pos], ["School", r.school], ["Class", r.cls], ...(r.classRank ? [["Class rank", `#${r.classRank}`]] : []), ...(r.grade ? [["Community grade", r.grade]] : [])],
    focus: p, tone: "answer",
    more: () => suggestOne(q, ctx, next, random),
  };
}

// ════════ The 411 on a player ════════
// "Ousmane Kromah is a running back at Florida State in the 2028 class. He
// ran for 1,034 yards and 9 touchdowns in 2026. He's ranked 12th in the
// class, 2nd among running backs." — the facts, a season line, the rank.
export async function profileLine(d, ctx, { pronoun = false } = {}) {
  const pos = POS_NAMES[d.Position] || d.Position || "player";
  const facts = { name: nameOf(d), pos, school: d.School, cls: d.Eligible, ...(ctx?.vary ? await teamOf(ctx, d.School) : {}) };
  // Right after his name was just said (a suggestion), "He's a …" when varying.
  const intro = pronoun && ctx?.vary ? phrase(ctx, "profile.intro.he", facts) : phrase(ctx, "profile.intro", facts);
  let season = "";
  let big = "";
  const data = ctx.seasons ? await ctx.seasons(d).catch(() => null) : null;
  if (data?.years?.length) {
    const y = data.years[data.years.length - 1];
    const sv = seasonVars(d.Position, data.seasons[y], y);
    if (sv) {
      // A wording without the ", plus 11 catches…" part gets it as its own sentence.
      const s = phrase(ctx, `season.${sv.group}`, sv);
      season = !sv.also || (sv.plus && s.includes(sv.plus)) ? s : join(s, sv.also);
    } else season = choose(ctx, "profile.season", seasonSentences(d.Position, data.seasons[y], y));
    if (season && bigSeason(d.Position, data.seasons[y])) big = extra(ctx, phrase(ctx, "profile.big"));
  }
  const rk = ctx.ranks && d.id ? await ctx.ranks(d).catch(() => null) : null;
  const top = topRank(rk);
  const rankKey = !top ? "profile.rank" : rk.classRank === 1 ? "rank.top.first" : top.top === "position" ? "rank.top.position" : "rank.top.class";
  const rank = rk?.classRank ? phrase(ctx, rankKey, {
    cr: ordinal(rk.classRank), pr: rk.positionRank ? ordinal(rk.positionRank) : "", posPl: POS_PLURAL[d.Position] || `${d.Position}s`, pos, cls: d.Eligible, n: top?.n,
  }) : "";
  const ped = pedigree(d);
  const pedS = ped ? extra(ctx, phrase(ctx, ped === "five-star" ? "pedigree.fiveStar" : "pedigree.top100")) : "";
  // Lead with what's notable: a top rank right after who he is.
  return top ? join(intro, rank, big, season, pedS) : join(intro, big, season, rank, pedS);
}
