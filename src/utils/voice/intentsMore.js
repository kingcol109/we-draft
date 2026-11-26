// src/utils/voice/intentsMore.js
//
// /voice: more of what it understands (user, 2026-11-25) — your board, your
// game notes, the community's board and traits, NFL comparisons, a player's
// background (career path, high school, age, eligibility, recruiting), a
// game high / low, and team records. Same shape as intents.js (see there);
// intents.js puts them in order with the rest.
import { plain } from "./text";
import { STATS, statKey, statValue, statText, statSay, seasonsSaid, gameWhen, gameTitle, gameResult, gameSummary, bestGames, WORD_RE } from "./stats";
import { WHO, nameOf, facts, card, miss, loaded, ordinal, plural, list, currentSeason } from "./reply";
import { POS_RE, positionSaid, gradeGroupSaid } from "./board";
import { parseRest } from "./intents";
import { eligibilityInfo, currentDraftClass } from "../eligibility";
import { teamKey } from "../film/schedule";
import { phrase, extra, join, resultPhrase, datePhrase, shortTeam } from "./phrase";
import { nameFor, POS_NAMES } from "./refs";
import { gameOf } from "./spoken";
import { GRADE_SCALE } from "../gradeScale";

const CLS = "(?: (?:in|for|from) (?:the )?(?<cls>20\\d\\d)(?: class| draft| draft class)?)?";
const COMMUNITY = "(?:according to|on|by|from|per|for) (?:the )?(?:we draft(?: com)?|wedraft(?: com)?|community|consensus|everyone|users|the site|fans|public|people)(?: board| rankings?)?";
const word = (n) => ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, "twenty five": 25 }[n] || parseInt(n, 10) || null);

// ════════ Your board ════════
// Your evaluations at a position with a grade group: [{ playerId, name, grade, cls, school }]
async function boardHits(ctx, posSaid, gradeSaid, cls) {
  const pos = positionSaid(posSaid);
  const group = gradeSaid ? gradeGroupSaid(gradeSaid) : null;
  const [board, people] = await Promise.all([ctx.myBoard(), ctx.people()]);
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const hits = board
    .map((e) => ({ e, p: byId[e.playerId] }))
    .filter(({ e, p }) => p && (!pos?.pos || p.pos === pos.pos) && (!group || group.grades.includes(e.grade)) && (!cls || String(p.cls) === String(cls)))
    .map(({ e, p }) => ({ playerId: e.playerId, name: `${p.first} ${p.last}`, grade: e.grade, cls: p.cls, school: p.school, pos: p.pos }))
    .sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.name.localeCompare(b.name));
  return { pos, group, hits };
}
const byClass = (hits) => {
  const c = {};
  hits.forEach((h) => { c[h.cls] = (c[h.cls] || 0) + 1; });
  return Object.entries(c).sort().map(([y, n]) => `${n} in ${y}`);
};

// Grades best first (utils/gradeScale.js: Early First Round = 1 … UDFA = 10); Watchlist last.
const gradeOrder = (g) => GRADE_SCALE[g] ?? 99;
const TOP_N = { one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10 };

export const BOARD_INTENTS = [
  {
    id: "board.mineTop",
    mode: "general",
    signIn: true,
    title: "Your top players",
    examples: ["who's my top running back", "who are my top 5 quarterbacks in 2027", "who's my number one player"],
    patterns: [
      new RegExp(`^(?:who(?:'s| is| are)|what(?:'s| is| are)) my (?:top|best|highest|number one|#1|no 1|first)(?: (?:graded|rated|ranked))?(?: (?<n>\\d+|one|two|three|four|five|ten))? (?<pos>${POS_RE}|players?|prospects?|guys?)(?: on my board)?${CLS}$`),
      // "who is the highest quarterback I have on my 2028 board"
      new RegExp(`^who(?:'s|s| is| are) (?:the )?(?:top|best|highest|number one|first)(?: (?:graded|rated|ranked))? (?<pos>${POS_RE}|players?|prospects?|guys?)(?:(?: (?:that )?i (?:have|got|graded|ranked)(?: (?:the )?(?:highest|best|top))?)(?: on my (?:(?<cls>20\\d\\d) )?board)?| on my (?:(?<cls2>20\\d\\d) )?board)$`),
      new RegExp(`^(?:who(?:'s|s| is)) (?:the )?(?:top|best) (?<pos>${POS_RE}|player|prospect) on my board${CLS}$`),
      new RegExp(`^who(?:'s|s| is) (?:#1|number one|no 1|first|at the top) on my board(?: at (?<pos>${POS_RE}))?${CLS}$`),
      new RegExp(`^who do i have (?:as )?(?:my )?(?:top|number one|#1|first|highest)(?: (?<pos>${POS_RE}|player|prospect))?${CLS}$`),
      new RegExp(`^(?:who|which) (?<pos>${POS_RE}|player|prospect) do i (?:have|grade|like) (?:the )?(?:highest|most|best|first)${CLS}$`),
    ],
    accept: (s) => !s.pos || /^(?:players?|prospects?|guys?)$/.test(s.pos) || !!positionSaid(s.pos),
    run: async ({ pos, n, cls: cls1, cls2 }, ctx) => {
      const cls = cls1 || cls2;
      const wanted = !pos || /^(?:players?|prospects?|guys?)$/.test(pos) ? "players" : pos;
      const { pos: P, hits } = await boardHits(ctx, wanted, null, cls);
      if (P?.sub) return miss(`I can only sort your board by defensive backs for now, not ${P.label}.`, "board-subposition");
      const graded = hits.filter((h) => h.grade).sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade) || a.name.localeCompare(b.name));
      const label = P?.label || "players";
      if (!graded.length) return { say: `You haven't graded any ${label}${cls ? ` in the ${cls} class` : ""} yet.`, title: "Your board", tone: "answer" };
      const k = TOP_N[n] || Number(n) || 1;
      const people = await ctx.people();
      const asPeople = (xs) => xs.map((h) => ({ ...(people.find((p) => p.id === h.playerId) || {}), note: h.grade }));
      if (k === 1) {
        // A tie at the top: say all of them.
        const tied = graded.filter((h) => h.grade === graded[0].grade);
        const one = label.replace(/s$/, "");
        const say = tied.length === 1
          ? phrase(ctx, "board.top", { one, cls: cls ? ` in the ${cls} class` : "", name: tied[0].name, school: tied[0].school, grade: `${/^[aeiou]/i.test(tied[0].grade) ? "an" : "a"} ${tied[0].grade.toLowerCase()}` })
          : `You have ${tied.length} ${label} tied at the top with ${/^[aeiou]/i.test(tied[0].grade) ? "an" : "a"} ${tied[0].grade.toLowerCase()} grade: ${list(tied.slice(0, 6).map((h) => h.name))}.`;
        return { say, title: "Your board", sub: `Top ${one}`, people: asPeople(tied.slice(0, 8)), ...(tied.length === 1 ? { focus: people.find((p) => p.id === tied[0].playerId) } : {}), tone: "answer" };
      }
      const top = graded.slice(0, k);
      return { say: `Your top ${top.length} ${label}${cls ? ` in the ${cls} class` : ""}: ${list(top.map((h, i) => `${i + 1}, ${h.name}, ${h.grade.toLowerCase()}`))}.`, title: "Your board", sub: `Top ${top.length} ${label}`, people: asPeople(top), tone: "answer" };
    },
  },
  {
    id: "board.mine",
    mode: "general",
    signIn: true,
    title: "Your board — counts and lists",
    examples: ["how many running backs do I have with a first round grade", "read off the running backs I have as an early first", "who are my second round receivers in 2027", "how many players have I evaluated"],
    patterns: [
      new RegExp(`^how many (?<pos>${POS_RE}|players|prospects|guys) (?:do i have|have i got|are on my board|did i give|have i given|have i graded|did i grade|do i have graded|do i have listed)(?: (?:with|at|as|graded as|graded at|listed as|listed at|that have|that are))? (?:a |an )?(?<grade>.+?)${CLS}$`),
      new RegExp(`^how many (?<grade>.+?) (?<pos>${POS_RE}|players|prospects|guys) (?:do i have|have i got|are on my board|have i graded|did i grade)${CLS}$`),
      new RegExp(`^(?:can you )?(?<read>read|read off|read me|list|name|who are|what are|show me|tell me)(?: off)?(?: the| all the| all| my)? (?<pos>${POS_RE}|players|prospects|guys)(?: that| who)? (?:i have|i've|i got|i gave|i've got|on my board)(?: listed| graded| down)?(?: (?:as|with|at|graded as|graded at))? (?:a |an )?(?<grade>.+?)${CLS}$`),
      new RegExp(`^(?:can you )?(?<read>read|read off|read me|list|name|who are|what are|show me)(?: off)?(?: the| all)? my (?<grade>.+?) (?<pos>${POS_RE}|players|prospects|guys)${CLS}$`),
      /^how many (?<pos>players|prospects|guys) (?:have i|did i) (?:evaluated|evaluate|graded|grade|got on my board)(?: (?:in|for) (?:the )?(?<cls>20\d\d)(?: class)?)?$/,
      /^(?<read>what's on|whats on|what is on|read|read off|read me) my board(?: (?:for|in) (?:the )?(?<cls>20\d\d)(?: class)?)?$/,
    ],
    accept: (s) => (!s.pos || positionSaid(s.pos)) && (!s.grade || gradeGroupSaid(s.grade)),
    run: async ({ pos = "players", grade, cls, read }, ctx) => {
      const { pos: P, group, hits } = await boardHits(ctx, pos, grade, cls);
      const what = `${P?.label || "players"}${group ? ` with ${group.label}` : ""}${cls ? ` in the ${cls} class` : ""}`;
      if (P?.sub) {
        // Corners / safeties: the board's people list only knows DB.
        return miss(`I can only sort your board by defensive backs for now, not ${P.label}.`, "board-subposition");
      }
      const rows = hits.map((h) => [`${h.name} · ${h.pos}, ${h.school}`, `${h.grade || "—"} · ${h.cls}`]);
      if (!hits.length) return { say: `You don't have any ${what}.`, title: "Your board", sub: what, tone: "answer" };
      const counts = byClass(hits);
      if (read) {
        const names = hits.slice(0, 15).map((h) => (group && group.grades.length === 1 ? h.name : `${h.name}, ${h.grade.toLowerCase()}`));
        const people = await ctx.people();
        const cards = hits.slice(0, 24).map((h) => ({ ...(people.find((p) => p.id === h.playerId) || {}), note: h.grade }));
        return { say: `You have ${plural(hits.length, P?.label?.replace(/s$/, "") || "player", P?.label || "players")}${group ? ` with ${group.label}` : ""}: ${list(names)}${hits.length > 15 ? `, and ${hits.length - 15} more` : ""}.`, title: "Your board", sub: what, rows, people: cards, tone: "answer" };
      }
      const one = hits.length === 1 ? (P?.label || "players").replace(/s$/, "") : P?.label || "players";
      return { say: `You have ${hits.length} ${one}${what.slice((P?.label || "players").length)}${counts.length > 1 && !cls ? `: ${list(counts)}` : ""}.`, title: "Your board", sub: what, rows, tone: "answer" };
    },
  },
];

// ════════ The community's board ════════
const TOP_WORD = { one: 1, two: 2, three: 3, five: 5, ten: 10 };
export const COMMUNITY_INTENTS = [
  {
    // "Who's the number one player on We-Draft.com?" — the class's overall board (compSnapshots/_top).
    id: "board.topOverall",
    mode: "general",
    title: "Who's #1 on We-Draft.com",
    examples: ["who is the number one rated player on We-Draft", "who's number one on We-Draft in 2028", "top 5 players on We-Draft"],
    patterns: [
      /^(?:who(?:'s|s| is| are)|what(?:'s|s| is)) (?:the )?(?:number one|no 1|#1|top|best|highest|first)(?: (?:rated|ranked|graded))? (?:person|player|prospect|guy|overall player)(?: (?:on|at|according to) we draft(?: com)?| overall| right now)?(?: (?:in|for) (?:the )?(?<cls>20\d\d)(?: class| draft)?)?$/,
      /^who(?:'s|s| is) (?:number one|no 1|#1|first|on top|at the top) (?:on|at|of) (?:we draft(?: com)?|the board|the community board)(?: (?:in|for) (?:the )?(?<cls>20\d\d)(?: class| draft)?)?$/,
      /^(?:who are |what are |give me |show me |read me )?(?:the )?top (?<n>\d+|two|three|five|ten) (?:players|prospects|guys)(?: (?:on|at|according to) we draft(?: com)?| overall)?(?: (?:in|for) (?:the )?(?<cls>20\d\d)(?: class| draft)?)?$/,
    ],
    run: async ({ cls, n }, ctx) => {
      const year = String(cls || currentDraftClass());
      const top = ctx.topProspects ? await ctx.topProspects(year).catch(() => []) : [];
      if (!top.length) return miss(`I don't have the ${year} board yet.`, "no-top-board");
      const k = Math.min(TOP_WORD[n] || Number(n) || 1, 25);
      if (k === 1) {
        const p = top[0];
        const d = await ctx.player(p.id).catch(() => null);
        const who = `${p.first} ${p.last}, ${POS_NAMES[p.pos] ? `${/^[aeiou]/i.test(POS_NAMES[p.pos]) ? "an" : "a"} ${POS_NAMES[p.pos]}` : p.pos} from ${p.school}`;
        return { say: `The top-ranked player in the ${year} class on We-Draft.com is ${who}.`, ...(d ? card(d) : { title: `${p.first} ${p.last}` }), focus: p, people: top.slice(1, 5).map((x, i) => ({ ...x, note: `#${i + 2}` })), tone: "answer" };
      }
      const list0 = top.slice(0, k);
      return {
        say: `The top ${list0.length} in the ${year} class on We-Draft.com: ${list(list0.map((x, i) => `${i + 1}, ${x.first} ${x.last}, ${x.school}`))}.`,
        title: `${year} top ${list0.length}`, sub: "We-Draft.com community board",
        people: list0.map((x, i) => ({ ...x, note: `#${i + 1}` })), group: list0, tone: "answer",
      };
    },
  },
  {
    id: "board.community",
    mode: "general",
    title: "The community's board",
    examples: ["read off first round running backs according to We-Draft.com", "how many receivers does the community have as first rounders", "who are the top 5 running backs in 2027"],
    patterns: [
      new RegExp(`^(?:can you )?(?<read>read|read off|read me|list|name|who are|what are|show me|tell me)?(?: off)?(?: the| all the| all)? ?(?<grade>.+?) (?:grade |graded )?(?<pos>${POS_RE}) ${COMMUNITY}${CLS}$`),
      new RegExp(`^how many (?<grade>.+?) (?:grade |graded )?(?<pos>${POS_RE}) (?:are there |does the community have |do people have )?(?:${COMMUNITY})?${CLS}$`),
      new RegExp(`^(?:which|what|how many) (?<pos>${POS_RE}) (?:does|do) (?:the community|we draft(?: com)?|wedraft(?: com)?|everyone|people|users|fans) (?:have|grade|see|list) (?:as|at|with) (?:a |an )?(?<grade>.+?)${CLS}$`),
      new RegExp(`^(?:who (?:are|is) )?(?:the )?(?:top|best) (?<n>\\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)? ?(?<pos>${POS_RE})${CLS}(?: ${COMMUNITY})?$`),
    ],
    accept: (s) => !!positionSaid(s.pos) && (!s.grade || !!gradeGroupSaid(s.grade)),
    run: async ({ pos, grade, cls, n, read }, ctx, text) => {
      const P = positionSaid(pos);
      const group = grade ? gradeGroupSaid(grade) : null;
      const year = cls || currentDraftClass();
      const rows0 = await ctx.classList(year, P.pos);
      if (!rows0.length) return miss(`I don't have the ${year} ${P.label} list.`, "no-class-list");
      const all = rows0.filter((r) => !P.sub || r.sub === P.sub || (P.sub === "G" && r.sub === "G"));
      if (!group) {
        // "top 5 running backs" → 5; "the top running back" → 1; "the top running backs" → 10.
        const k = word(n) || (/s$/.test(plain(pos)) ? 10 : 1);
        const top = all.slice(0, k);
        const one = k === 1 && top[0] ? { id: top[0].id, first: top[0].first, last: top[0].last, school: top[0].school, pos: P.pos, cls: year } : null;
        return {
          ...(one ? { focus: one, speak: `${top[0].first} ${top[0].last} from ${top[0].school} is the top ${P.label.replace(/s$/, "")} in the ${year} class on We-Draft.com.` } : {}),
          say: `The top ${k === 1 ? "" : `${top.length} `}${k === 1 ? P.label.replace(/s$/, "") : P.label} in the ${year} class on We-Draft.com: ${list(top.map((r, i) => `${k === 1 ? "" : `${i + 1}, `}${r.first} ${r.last}, ${r.school}`))}.`,
          title: `${year} ${P.label}`, sub: "We-Draft.com community board", rows: top.map((r, i) => [`${i + 1}. ${r.first} ${r.last} · ${r.school}`, r.grade || "—"]),
          people: top.map((r, i) => ({ id: r.id, first: r.first, last: r.last, school: r.school, pos: P.pos, cls: year, note: `#${i + 1}${r.grade ? ` · ${r.grade}` : ""}` })), tone: "answer",
        };
      }
      const hits = all.filter((r) => group.grades.includes(r.grade));
      const rows = hits.map((r) => [`${r.first} ${r.last} · ${r.school}`, `${r.grade} · #${r.classRank}`]);
      if (!hits.length) return { say: `The community doesn't have any ${year} ${P.label} with ${group.label}.`, title: `${year} ${P.label}`, sub: "We-Draft.com community board", tone: "answer" };
      const intro = `The community has ${plural(hits.length, P.label.replace(/s$/, ""), P.label)} in the ${year} class with ${group.label}`;
      return { say: read !== undefined || !/^how many/.test(plain(text || "")) ? `${intro}: ${list(hits.slice(0, 15).map((r) => `${r.first} ${r.last}`))}.` : `${intro}.`, title: `${year} ${P.label}`, sub: `We-Draft.com community · ${group.label}`, rows, people: hits.slice(0, 24).map((r) => ({ id: r.id, first: r.first, last: r.last, school: r.school, pos: P.pos, cls: year, note: `${r.grade} · #${r.classRank}` })), tone: "answer" };
    },
  },
  {
    id: "community.traits",
    mode: "general",
    title: "The community's strengths, weaknesses and fits",
    examples: ["what are the strengths and weaknesses for Kromah", "what are Kromah's strengths", "what do people like about Kromah", "what NFL teams do people think Kromah fits"],
    patterns: [
      /^what are (?:the )?(?:public |community |consensus |people's |users' |his )?(?<which>strengths? and weakness(?:es)?|weakness(?:es)? and strengths?|strengths?|weakness(?:es)?|pros and cons)(?: listed| people have| on file)? (?:for|of|on|about) (?<who>.+)$/,
      // "David Sanders at Tennessee, what are his strengths and weaknesses"
      /^(?<who>.+?),? (?:what are|what're|whats|what's|what is|tell me|give me) (?:his|their|the) (?<which>strengths? and weakness(?:es)?|weakness(?:es)? and strengths?|strengths?|weakness(?:es)?|pros and cons)$/,
      new RegExp(`^(?:what are )?${WHO} (?:public |community )?(?<which>strengths? and weakness(?:es)?|weakness(?:es)? and strengths?|strengths?|weakness(?:es)?|pros and cons)$`),
      /^what (?:do people|does the community|do users|do fans|does everyone) (?<which>like|love|dislike|not like|worry about|knock) (?:about )?(?<who>.+)$/,
      /^what (?:nfl )?(?:teams?|fits?) (?:do people|does the community|do users|does everyone) (?:think |see |have )?(?<who>.+?) (?<which>fits?|fitting)(?: with| on| in)?$/,
      /^(?:what are |what's |whats )?(?:the )?(?:community |public )?(?<which>nfl fits?|team fits?) (?:for|of) (?<who>.+)$/,
    ],
    run: async ({ player, which }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const { all } = await ctx.publicEvals(d);
      if (!all.length) return miss(`Nobody has evaluated ${nameOf(d)} yet.`, "no-evals", d);
      const sC = {}; const wC = {}; const fC = {};
      all.forEach((e) => {
        (e.strengths || []).forEach((t) => { sC[t] = (sC[t] || 0) + 1; });
        (e.weaknesses || []).forEach((t) => { wC[t] = (wC[t] || 0) + 1; });
        if (e.nflFit) fC[e.nflFit] = (fC[e.nflFit] || 0) + 1;
      });
      // The player page's numbers: a Watchlist bookmark with no traits doesn't count.
      const reports = all.filter((e) => e.grade !== "Watchlist" || (e.strengths?.length || 0) + (e.weaknesses?.length || 0) > 0).length || 1;
      const pct = (c) => `${Math.round((c / reports) * 100)}%`;
      const top = (o, other, strict) => Object.entries(o).filter(([t, c]) => (strict ? c > (other[t] ?? -1) : c >= (other[t] ?? -1))).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const S = top(sC, wC, false); const W = top(wC, sC, true);
      const F = Object.entries(fC).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const w = String(which || "");
      const showS = /strength|like|love|pros/.test(w) && !/dislike|not like/.test(w);
      const showW = /weakness|dislike|not like|worry|knock|cons/.test(w);
      const showF = /fit/.test(w);
      const say = [];
      const rows = [];
      const name = nameOf(d);
      if (showS || (!showW && !showF)) { say.push(S.length ? `The community's strengths for ${name}: ${list(S.map(([t, c]) => `${t}, ${pct(c)}`))}` : `No strengths picked for ${name} yet`); S.forEach(([t, c]) => rows.push([`Strength · ${t}`, pct(c)])); }
      if (showW || (!showS && !showF)) { say.push(W.length ? `Weaknesses: ${list(W.map(([t, c]) => `${t}, ${pct(c)}`))}` : `No weaknesses picked yet`); W.forEach(([t, c]) => rows.push([`Weakness · ${t}`, pct(c)])); }
      if (showF) { say.push(F.length ? `Top NFL fits for ${name}: ${list(F.map(([t]) => `the ${t}`))}` : `Nobody has picked an NFL fit for ${name} yet`); F.forEach(([t, c]) => rows.push([`Fit · ${t}`, String(c)])); }
      // Out loud (user, 2026-11-25): the top traits like a scout would say them — no percentages.
      const low = (t) => String(t).toLowerCase();
      const spoken = [];
      if (showS || (!showW && !showF)) spoken.push(S.length ? phrase(ctx, "traits.strengths", { name, list: list(S.slice(0, 3).map(([t]) => low(t))) }) : `Nobody has picked strengths for ${name} yet.`);
      if (showW || (!showS && !showF)) spoken.push(W.length ? phrase(ctx, "traits.weaknesses", { list: list(W.slice(0, 3).map(([t]) => low(t))), only: !(showS || (!showW && !showF)), name }) : "Nobody has flagged a weakness yet.");
      if (showF) spoken.push(F.length ? `People see him fitting best with the ${list(F.map(([t]) => t))}.` : `Nobody has picked an NFL fit for ${name} yet.`);
      return { say: `${say.join(". ")}. From ${plural(reports, "evaluation")}.`, speak: spoken.join(" "), ...card(d), rows, tone: "answer" };
    },
  },
  {
    id: "player.comps",
    mode: "general",
    title: "NFL comparisons",
    examples: ["does Kromah have any NFL comparisons", "what are some NFL comparisons for Kromah", "who does Kromah compare to"],
    patterns: [
      /^(?:does|do) (?<who>.+?) (?:have )?(?:any )?(?:nfl )?(?:comparisons|comps|comp|comparison|player comps|pro comps)$/,
      /^(?:what are |who are |give me |what's |whats |what is |read off |read )?(?:some |the |his |any )?(?:good )?(?:nfl )?(?:comparisons|comps|comp|comparison|player comps|pro comps) (?:for|of|to|on) (?<who>.+)$/,
      /^who (?:does|is) (?<who>.+?) (?:compare to|comparable to|remind you of|play like|similar to|look like|compare with)$/,
      // "what are the NFL comps" / "who's his comp": him.
      /^(?:what (?:is|are|was|were)|what's|whats|who (?:is|are)|who's|whos|give me|read me|tell me) (?:the |his |some |any )?(?:nfl |pro |player )?(?:comps|comparisons|comp|comparison)$/,
      new RegExp(`^(?:what (?:is|are|was|were) |what's |whats |who (?:is|are) |who's |give me |read me |tell me )?(?:the )?${WHO} (?:nfl |pro |player )?(?:comps|comparisons|comp|comparison|pro comp|pro comps)$`),
      /^who (?:does|do) (?<who>he|you|they|that guy|this guy) (?:compare to|remind you of|play like|look like)$/,
    ],
    fixed: [{}, {}, {}, { who: "him" }, {}, {}],
    run: async ({ player }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const comps = await ctx.comps(d);
      if (!comps.length) return miss(`I can't find NFL comparisons for ${nameOf(d)} yet. He needs measurements or community traits first.`, "no-comps", d);
      const rd = (c) => (c.round && c.round !== "UDFA" ? `round ${c.round}` : "undrafted");
      const rows = comps.map((c) => [`${c.select ? "★ " : ""}${c.name} · ${c.year} ${rd(c)}${c.team ? `, ${c.team}` : ""}`, c.select ? "We-Draft.com Select" : c.match != null ? `${c.match}% match` : ""]);
      const sel = comps.find((c) => c.select);
      const model = comps.filter((c) => !c.select).slice(0, 3);
      const say = `${sel ? `We-Draft.com's pick for ${nameOf(d)} is ${sel.name}. ` : ""}${model.length ? `The closest NFL comparisons${sel ? " after that" : ` for ${nameOf(d)}`}: ${list(model.map((c) => `${c.name}, ${c.year} ${rd(c)}${c.school ? ` out of ${c.school}` : ""}`))}.` : ""}`;
      return { say, ...card(d, { sub: `${facts(d)} · NFL comparisons` }), rows, tone: "answer" };
    },
  },
];

// ════════ Game notes (your evaluation's 50-word notes, one per game) ════════
const NOTE_TAGS = [["Great", /\b(great|excellent|dominant|dominated|elite|outstanding|monster|huge)\b/], ["Good", /\b(good|solid|nice|strong|productive)\b/], ["Average", /\b(average|okay|ok|fine|quiet|meh)\b/], ["Bad", /\b(bad|rough|poor|struggled|sloppy|tough)\b/], ["Awful", /\b(awful|terrible|horrible|brutal|disaster)\b/]];
const tagOf = (t) => (NOTE_TAGS.find(([, re]) => re.test(t)) || [""])[0];
const VERBS = "had|has|was|is|looked|played|showed|did|made|struggled|dominated|ran|caught|threw|got|put|went|could|needs|flashed|broke|missed|dropped|fumbled|scored|won|lost|impressed|disappointed|really|just|kept|found|took|carried|seemed|came|sat|left|returned|showed";
const BANNED = ["faggot", "nigger", "monkey", "nigga", "fuck"];
export const NOTE_INTENTS = [
  {
    id: "my.note",
    mode: "general",
    signIn: true,
    title: "Add a game note",
    examples: ["write that Kromah had a great game against Alabama in my notes", "add a note for Kromah that he ran hard against Alabama", "note Kromah struggled in pass protection"],
    patterns: [
      new RegExp(`^(?:write|add|put|note|jot down|log|make a note|leave a note|write down|put down)(?: down)?(?: (?:in|to|on) my (?:game )?notes)?(?: (?:that|saying))? (?<who>.+?) (?<note>(?:${VERBS})\\b.+?)(?: (?:in|to|on|into) my (?:game )?notes)?$`),
      /^(?:add|write|make|leave|put) (?:a )?(?:game )?note (?:for|on|about|to) (?<who>.+?) (?:that|saying) (?<note>.+?)(?: (?:in|to|on) my (?:game )?notes)?$/,
    ],
    run: async ({ player, note }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      let text = String(note).trim().replace(/\s+/g, " ");
      if (BANNED.some((w) => text.toLowerCase().includes(w))) return miss("That note has language I can't save.", null, d);
      text = `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
      if (text.split(" ").length > 50) return miss(`Game notes are 50 words at most. That was ${text.split(" ").length}.`, null, d);
      const games = await ctx.schoolGames(d.School);
      if (!games.length) return miss(`I don't have any finished ${d.School} games to put a note on.`, "no-note-games", d);
      // The game: the team named in the note, else his latest.
      const vs = plain(text).match(/\b(?:against|vs|versus|over|to|at|facing)\s+(?:the )?(.+?)(?:\s+(?:in|on|this|last|today|yesterday|and|but|with)\b|$)/);
      let game = null;
      if (vs) {
        const want = teamKey(vs[1]);
        game = games.find((g) => teamKey(g.opponent) === want) || games.find((g) => teamKey(g.opponent).startsWith(want) && want.length >= 4);
      }
      const named = !!game;
      game = game || games[0];
      const tag = tagOf(plain(text));
      const prev = await ctx.myEval(d.id);
      const notes = prev?.gameNotes || [];
      const old = notes.find((n) => n.gameId === game.id);
      const next = [...notes.filter((n) => n.gameId !== game.id), { gameId: game.id, opponent: game.opponent, dateMs: game.dateMs, tag, note: text }];
      const when = new Date(game.dateMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return {
        confirm: {
          say: `${old ? "Replace your" : "Add a"} note on ${nameOf(d)} for ${named ? "the" : "his last game,"} ${game.opponent} game${named ? "" : ` on ${when}`}${tag ? `, tagged ${tag}` : ""}: "${text}"?`,
          ...card(d, { sub: `${facts(d)} · game note` }),
          rows: [["Game", `vs ${game.opponent} · ${when}`], ["Tag", tag || "—"], ...(old ? [["Replaces", old.note || "(watched)"]] : [])],
          body: text,
          change: { scope: "Your game notes", items: [{ label: `vs ${game.opponent}`, from: old?.note || "", to: text }], isNew: !old },
          apply: async () => {
            await ctx.saveGameNotes(d, next);
            return { say: `Saved your note on ${nameOf(d)} for the ${game.opponent} game.`, ...card(d), rows: [["Game", `vs ${game.opponent} · ${when}`], ["Tag", tag || "—"]], body: text, change: { scope: "Your game notes", items: [{ label: `vs ${game.opponent}`, from: old?.note || "", to: text }], isNew: !old, saved: true }, tone: "done" };
          },
        },
      };
    },
  },
  {
    id: "my.notes.read",
    mode: "general",
    signIn: true,
    title: "Read your game notes",
    examples: ["read my notes on Kromah", "what did I write about Kromah"],
    patterns: [
      /^(?:can you )?(?:read|read me|read off|what are|show me|tell me)?(?: off)? ?my (?:game )?notes (?:on|for|about) (?<who>.+?)(?: (?:against|vs|from) (?<opp>.+))?$/,
      /^what did i (?:write|note|say|put) (?:about|on|for) (?<who>.+?)(?: (?:against|vs) (?<opp>.+))?$/,
    ],
    run: async ({ player, opp }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const e = await ctx.myEval(d.id);
      let notes = [...(e?.gameNotes || [])].sort((a, b) => b.dateMs - a.dateMs);
      if (opp) notes = notes.filter((n) => teamKey(n.opponent).startsWith(teamKey(opp)));
      if (!notes.length) return { say: `You don't have any game notes on ${nameOf(d)}${opp ? ` against ${opp}` : ""}.`, ...card(d), tone: "answer" };
      const rows = notes.map((n) => [`vs ${n.opponent}${n.tag ? ` · ${n.tag}` : ""}`, n.note || "watched"]);
      const say = notes.slice(0, 5).map((n) => `${n.opponent}${n.tag ? `, ${n.tag}` : ""}: ${n.note || "watched, no note"}`).join(". ");
      return { say: `${plural(notes.length, "game note")} on ${nameOf(d)}. ${say}`, ...card(d), rows, tone: "answer" };
    },
  },
];

// ════════ A player's background ════════
const yearOf = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 1900 ? n : null; };
// Age: the birthday when known, else ~ from the recruit year (turned 18 on Jan 1 of it) — the Info tab's rule.
function ageOf(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d.Birthday || ""));
  const est = !m && yearOf(d.RecruitYear);
  const born = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : est ? Date.UTC(est - 18, 0, 1) : null;
  if (born == null) return null;
  const yrs = (ms) => (ms - born) / (365.25 * 86400000);
  const now = Date.now();
  const cls = yearOf(d.Eligible);
  const fmt = (y) => (m ? (Math.floor(y * 10) / 10).toFixed(1) : String(Math.floor(y)));
  return { age: fmt(yrs(now)), rookie: cls ? fmt(yrs(Date.UTC(cls, 8, 1))) : null, estimated: !m, born: m ? new Date(born).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null };
}
const stopText = (s) => `${s.School}${s.Level === "JUCO" ? " (junior college)" : ""}, ${s.From === s.To ? s.From : `${s.From} to ${s.To}`}`;
function hsText(d) {
  if (!d.HighSchool) return null;
  return `${d.HighSchool}${d.State ? ` in ${d.State}` : ""}`;
}
const TOPICS = {
  career: (d, ctx) => {
    const stops = d.CareerStops || [];
    const hs = hsText(d);
    const rows = [...(hs ? [["High school", `${hs}${d.RecruitYear ? ` · class of ${d.RecruitYear}` : ""}`]] : []), ...stops.map((s) => [s.Level === "JUCO" ? "JUCO" : "College", stopText(s)])];
    if (!stops.length && !hs) return { gap: "no-career", say: `I don't have a career path for ${nameOf(d)} yet.` };
    // No college stops on file: just where he is now (no made-up years).
    const now = !stops.length && d.School ? [d.School] : [];
    const path = [hs && `${hs}${d.RecruitYear ? `, class of ${d.RecruitYear}` : ""}`, ...stops.map(stopText), ...now].filter(Boolean);
    return { say: phrase(ctx, "bg.career", { name: nameOf(d), path: path.join(", then ") }), rows };
  },
  transfer: (d) => {
    const stops = (d.CareerStops || []).filter((s) => s.School);
    if (!stops.length) return { gap: "no-career", say: `I don't have ${nameOf(d)}'s college stops yet.` };
    if (stops.length === 1) return { say: `No. ${stops[0].School} is ${nameOf(d)}'s only college stop, since ${stops[0].From}.`, rows: [["College", stopText(stops[0])]] };
    const last = stops[stops.length - 1];
    const before = stops.slice(0, -1);
    return { say: `Yes. ${nameOf(d)} transferred to ${last.School} in ${last.From}${before.length ? ` from ${list(before.map((s) => `${s.School} (${s.From === s.To ? s.From : `${s.From} to ${s.To}`})`))}` : ""}.`, rows: stops.map((s) => ["College", stopText(s)]) };
  },
  hs: (d, ctx) => {
    const hs = hsText(d);
    if (!hs) return { gap: "no-highschool", say: `I don't have a high school for ${nameOf(d)}.` };
    const past = (d.PastHighSchools || []).map((h) => (typeof h === "string" ? h : h?.name || h?.School || "")).filter(Boolean);
    return { say: phrase(ctx, "bg.hs", { name: nameOf(d), hs, rest: `${past.length ? `, after ${list(past)}` : ""}${d.RecruitYear ? `, class of ${d.RecruitYear}` : ""}` }), rows: [["High school", hs], ...(d.RecruitYear ? [["Class", String(d.RecruitYear)]] : [])] };
  },
  grad: (d) => (d.RecruitYear ? { say: `${nameOf(d)} graduated high school in ${d.RecruitYear}. He's in the ${d.RecruitYear} recruiting class.`, rows: [["High school class", String(d.RecruitYear)]] } : { gap: "no-recruit-year", say: `I don't know when ${nameOf(d)} graduated high school.` }),
  years: (d, ctx) => {
    const ry = yearOf(d.RecruitYear);
    if (!ry) return { gap: "no-recruit-year", say: `I don't know when ${nameOf(d)} started college.` };
    const n = currentSeason() - ry + 1;
    if (n < 1) return { say: `${nameOf(d)} is still in high school, class of ${ry}.`, rows: [["High school class", String(ry)]] };
    const yr = ["", "first", "second", "third", "fourth", "fifth", "sixth"][n] || `${ordinal(n)}`;
    return { say: phrase(ctx, "bg.years", { name: nameOf(d), yr, season: currentSeason(), ry }), rows: [["College seasons", String(n)], ["High school class", String(ry)]] };
  },
  elig: (d) => {
    const s = eligibilityInfo(d);
    return s ? { say: s, rows: [["Draft class", String(d.Eligible || "—")], ["Recruit year", String(d.RecruitYear || "—")]] } : { gap: "no-eligibility", say: `I can't work out ${nameOf(d)}'s eligibility.` };
  },
  age: (d) => {
    const a = ageOf(d);
    if (!a) return { gap: "no-age", say: `I don't know how old ${nameOf(d)} is.` };
    const say = a.estimated ? `${nameOf(d)} is about ${a.age}. I don't have his birthday, so that's from his recruiting class.` : `${nameOf(d)} is ${a.age}. He was born ${a.born}.`;
    return { say: `${say}${a.rookie ? ` He'll be ${a.estimated ? "about " : ""}${a.rookie} as a rookie.` : ""}`, rows: [["Age", `${a.estimated ? "~" : ""}${a.age}`], ...(a.born ? [["Born", a.born]] : []), ...(a.rookie ? [["Rookie age", `${a.estimated ? "~" : ""}${a.rookie}`]] : [])] };
  },
  home: (d, ctx) => (d.Hometown ? { say: phrase(ctx, "bg.home", { name: nameOf(d), home: d.Hometown }), rows: [["Hometown", d.Hometown]] } : hsText(d) ? { say: `I don't have a hometown for ${nameOf(d)}, but he went to high school at ${hsText(d)}.`, rows: [["High school", hsText(d)]] } : { gap: "no-hometown", say: `I don't know where ${nameOf(d)} is from.` }),
  // "Tell me more" / "give me some background" (user, 2026-11-26): where he's from, how he was
  // recruited, where he's played — told like a person would, not a list.
  more: (d) => {
    const he = nameOf(d);
    const hs = d.HighSchool || null;
    const stars = Number(d.RecruitStars) || null;
    const rank = /^\d+$/.test(String(d.RecruitRank || "").replace(/^#/, "")) ? String(d.RecruitRank).replace(/^#/, "") : null;
    const stops = (d.CareerStops || []).filter((s) => s.School);
    const bits = [];
    if (d.Hometown) bits.push(`${he} is from ${d.Hometown}${hs ? `, and played his high school ball at ${hs}` : ""}.`);
    else if (hs) bits.push(`${he} played his high school ball at ${hs}${d.State ? ` in ${d.State}` : ""}.`);
    if (stars) bits.push(`${bits.length ? "He" : he} came out as a ${stars}-star recruit${rank && rank !== "0" ? `, number ${rank} in the country` : ""}${d.RecruitYear ? `, in the class of ${d.RecruitYear}` : ""}.`);
    const subj = bits.length ? "He" : he;
    if (stops.length > 1) {
      const last = stops[stops.length - 1];
      const before = stops.slice(0, -1).map((s) => s.School);
      bits.push(`${subj} started at ${list(before)} and transferred to ${last.School} in ${last.From}.`);
    } else if (stops.length === 1) bits.push(`${subj}'s been at ${stops[0].School} since ${stops[0].From}.`);
    const a = ageOf(d);
    if (a) bits.push(`He's ${a.estimated ? "about " : ""}${Math.floor(Number(a.age))}.`);
    if (!bits.length) return { gap: "no-background", say: `I don't have much background on ${he} yet.` };
    const rows = [["Hometown", d.Hometown], ["High school", hsText(d)], ["Recruiting", stars ? `${stars}★${rank ? ` · #${rank}` : ""}${d.RecruitYear ? ` · ${d.RecruitYear}` : ""}` : null], ...stops.map((s) => ["College", stopText(s)]), ["Age", a ? `${a.estimated ? "~" : ""}${a.age}` : null]].filter(([, v]) => v);
    return { say: `${bits.join(" ")}${d.Bio ? ` Say "read his bio" for more.` : ""}`, rows };
  },
  recruit: (d) => {
    const stars = Number(d.RecruitStars) || null;
    const rank = String(d.RecruitRank || "").replace(/^#/, "");
    if (!stars && !/^\d+$/.test(rank)) return { gap: "no-recruiting", say: `I don't have recruiting info for ${nameOf(d)}.` };
    return { say: `${nameOf(d)} was a ${stars ? `${stars}-star` : ""} recruit${/^\d+$/.test(rank) && rank !== "0" ? `, number ${rank} nationally` : ""}${d.RecruitYear ? `, in the class of ${d.RecruitYear}` : ""}${d.HighSchool ? ` out of ${d.HighSchool}` : ""}.`, rows: [["Stars", stars ? `${stars}★` : "—"], ["National rank", rank ? `#${rank}` : "—"], ["Class", String(d.RecruitYear || "—")]] };
  },
};
export const PLAYER_INTENTS = [
  {
    id: "player.background",
    mode: "general",
    title: "A player's background",
    examples: ["what's Kromah's career path", "did Kromah transfer to Florida State from anywhere", "what high school did Kromah go to", "what year did Kromah graduate high school", "how many years has Kromah been in college", "how old is Kromah", "how many years of eligibility does Kromah have left", "how many stars was Kromah"],
    patterns: [
      // career path
      new RegExp(`^(?:(?:read off|read me|read|tell me|give me|show me) )?(?:what is |what's |whats )?(?:the )?${WHO} (?:career path|career|college career|path|journey|history|background)$`),
      /^where (?:has|did) (?<who>.+?) (?:play|played|go to school|been|go to college|play college football)(?: in college| before| previously| at)?$/,
      /^what (?:schools|colleges|teams) (?:has|did) (?<who>.+?) (?:play for|played for|been at|been to|attend|attended|go to)$/,
      // transfer
      /^(?:did|has|is) (?<who>.+?) (?:ever )?(?:transfer|transferred|a transfer)(?: (?:in|into|to) .+?)?(?: from (?:anywhere|another school|somewhere|.+))?$/,
      /^where did (?<who>.+?) transfer from$/,
      // high school
      /^(?:what|which) high school did (?<who>.+?) (?:go to|attend|play (?:at|for)|come from|come out of|graduate from)$/,
      /^where did (?<who>.+?) (?:go to|play) high school(?: football)?$/,
      new RegExp(`^(?:what is |what's |whats )?${WHO} high school$`),
      /^what high school is (?<who>.+?) from$/,
      // graduated / recruiting class
      /^(?:what year|when) did (?<who>.+?) (?:graduate|finish)(?: from)?(?: high school| hs)?(?: in)?$/,
      /^what (?:recruiting |high school )?class (?:was|is) (?<who>.+?)(?: in| recruited in| from| a part of)?$/,
      new RegExp(`^(?:what is |what's |whats )?${WHO} (?:recruiting class|recruit year|high school class|graduation year|class year)$`),
      // years in college
      /^how many (?:years|seasons) (?:of (?:college|high school|school|football) )?(?:has|does|did) (?<who>.+?) (?:have|played|been in college|been playing|played in college|have in college|have of college|been at school|been in school)(?: .*)?$/,
      /^how many (?:years|seasons) (?:has|have) (?<who>.+?) (?:been in college|been at .+|played|been playing)(?: .*)?$/,
      /^what year (?:is|of college is|in school is|in college is) (?<who>.+?)(?: in)?$/,
      /^is (?<who>.+?) a (?:freshman|sophomore|junior|senior|true freshman|redshirt .+)$/,
      // eligibility
      /^how many (?:years|seasons) of (?:college )?eligibility (?:does|has) (?<who>.+?) (?:have |got )?(?:left|remaining)$/,
      /^how much eligibility (?:does|has) (?<who>.+?) (?:have |got )?(?:left|remaining)$/,
      /^when (?:is|can|will) (?<who>.+?) (?:be )?(?:eligible|draft eligible|declare|eligible for the draft|enter the draft|go pro)(?: .*)?$/,
      new RegExp(`^(?:what is |what's |whats )?${WHO} eligibility$`),
      // age
      /^how old is (?<who>.+)$/,
      new RegExp(`^(?:what is |what's |whats )?${WHO} (?:age|birthday|date of birth|birth date|rookie age)$`),
      /^when (?:was|is) (?<who>.+?) (?:born|birthday)$/,
      // hometown
      /^where is (?<who>.+?) from$/,
      new RegExp(`^(?:what is |what's |whats )?${WHO} (?:hometown|home town)$`),
      // recruiting
      /^how many stars (?:was|is|did) (?<who>.+?)(?: have)?(?: coming out of high school| out of high school| as a recruit| in high school)?$/,
      new RegExp(`^(?:what was |what's |whats |what is )?${WHO} (?:recruiting (?:ranking|rank|rating|profile|stars)|star rating|stars|recruiting)$`),
      /^(?:where|how high) was (?<who>.+?) ranked (?:as a recruit|coming out of high school|out of high school|in high school)$/,
      // more / background
      /^(?:tell me|give me|i want to know|i'd like to know|let me know) (?:a (?:little|bit|little bit) )?more (?:about|on) (?<who>.+)$/,
      /^(?:give me|tell me|what's|whats|what is|what do you have for|i want|read me|share) (?:some |a little |a bit of |a little bit of |more |the |any )?(?:background|backstory|back story|history) (?:on|about|for|of) (?<who>.+)$/,
      /^(?:what's|whats|what is) (?<who>.+?)(?:'s|s')? (?:background|backstory|back story|story)$/,
      // hometown, more ways
      /^what (?:state|city|town|part of (?:the country|[a-z ]+)) is (?<who>.+?) from$/,
      /^where (?:did|does) (?<who>.+?) grow up$/,
    ],
    fixed: [
      { topic: "career" }, { topic: "career" }, { topic: "career" },
      { topic: "transfer" }, { topic: "transfer" },
      { topic: "hs" }, { topic: "hs" }, { topic: "hs" }, { topic: "hs" },
      { topic: "grad" }, { topic: "grad" }, { topic: "grad" },
      { topic: "years" }, { topic: "years" }, { topic: "years" }, { topic: "years" },
      { topic: "elig" }, { topic: "elig" }, { topic: "elig" }, { topic: "elig" },
      { topic: "age" }, { topic: "age" }, { topic: "age" },
      { topic: "home" }, { topic: "home" },
      { topic: "recruit" }, { topic: "recruit" }, { topic: "recruit" },
      { topic: "more", fresh: "1" }, { topic: "more" }, { topic: "more" },
      { topic: "home" }, { topic: "home" },
    ],
    run: async ({ player, topic, fresh }, ctx) => {
      // "Tell me more about Isaiah Johnson" about someone new (one just listed): who he is first.
      if (topic === "more" && fresh && !ctx.same) {
        const profile = ctx.intents?.find((i) => i.id === "player.profile");
        if (profile) return profile.run({ player }, ctx);
      }
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const out = TOPICS[topic](d, ctx);
      return out.gap ? miss(out.say, out.gap, d) : { say: out.say, ...card(d), rows: out.rows, tone: "answer" };
    },
  },
];

// ════════ A game high / low ════════
export const STATS_MAX_INTENTS = [
  {
    id: "stats.max",
    mode: "general",
    title: "His best or worst game for a stat",
    examples: ["what game did Kromah have the most rushing yards in 2026", "which game did Kromah have the least rushing yards", "what was Kromah's best rushing game"],
    patterns: [
      new RegExp(`^(?:in )?(?:what|which) game (?:did|was) (?<who>.+?) (?:have|get|put up|record|rack up|post|had) (?:the |his )?(?<dir>most|least|fewest|highest|lowest|best|worst|biggest|lowest number of|highest number of)(?: amount of| number of)? (?<stat>${WORD_RE})(?: (?<rest>.+))?$`),
      new RegExp(`^when did (?<who>.+?) (?:have|get|put up|record) (?:the |his )?(?<dir>most|least|fewest|highest|lowest)(?: amount of| number of)? (?<stat>${WORD_RE})(?: (?<rest>.+))?$`),
      new RegExp(`^(?:what (?:was|is) |what's |whats )?${WHO} (?<dir>most dominant|dominant|signature|breakout|best|biggest|worst|lowest|highest|top|quietest) (?:(?<stat>${WORD_RE}) )?(?:game|performance|outing)(?: (?<rest>.+))?$`),
      new RegExp(`^(?:what|which) (?:was|is) (?:the )?(?<dir>most dominant|best|biggest) (?:game|performance) (?:for|by|of) (?<who>.+?)(?: (?<rest>(?:in|this|last|20\\d\\d)\\b.*))?$`),
      new RegExp(`^(?:what (?:was|is) |what's |whats )?(?:the )?(?<dir>most|fewest|least) (?<stat>${WORD_RE}) (?:for|by) (?<who>.+?) in (?:a|one) game(?: (?<rest>.+))?$`),
    ],
    accept: (s) => (!s.stat || statKey(s.stat, "") != null) && parseRest(s.rest) != null,
    run: async ({ player, dir, stat, rest }, ctx) => {
      const d = await loaded(player, ctx);
      if (!d) return miss(`I couldn't load ${nameOf(player)}.`);
      const data = await ctx.seasons(d);
      if (!data || !data.years.length) return miss(`I don't have game logs for ${nameOf(d)} yet.`, "no-stats", d);
      const sel = seasonsSaid(parseRest(rest)?.seasons, data.years);
      // A stat's high / low: this season unless one's said. "His best / most dominant game": his whole career.
      const years = sel === "career" ? data.years : Array.isArray(sel) && sel.length ? sel : stat ? [data.years[data.years.length - 1]] : data.years;
      const games = await ctx.games(d, years);
      const low = /least|fewest|lowest|worst/.test(dir);
      const key = stat ? statKey(stat, d.Position) : null;
      // No stat said ("his best game"): the biggest all-round game for his position.
      const val = (g) => (key ? statValue(g.line, key) : null);
      const scored = key ? games.map((g) => ({ g, v: val(g) })).filter((x) => x.v != null) : bestGames(games, d.Position, games.length).map(({ game, score }) => ({ g: game, v: score }));
      if (!scored.length) return miss(`I don't have ${key ? STATS[key].label : "games"} for ${nameOf(d)} there.`, "no-stat", d);
      scored.sort((a, b) => (low ? a.v - b.v : b.v - a.v));
      const top = scored[0];
      const g = top.g;
      const span = years.length > 1 ? `${years[0]} to ${years[years.length - 1]}` : years[0];
      const what = key ? `${low ? "fewest" : "most"} ${STATS[key].label}` : low ? "quietest game" : /dominant/.test(dir) ? "most dominant game" : "biggest game";
      const said = key ? `${statSay(key, top.v)}` : gameSummary(g.line, d.Position);
      const rows = scored.slice(0, 5).map((x) => [`${gameWhen(x.g)} ${gameTitle(x.g)} · ${gameResult(x.g)}`, key ? statText(key, x.v) : gameSummary(x.g.line, d.Position)]);
      const spanP = years.length === data.years.length && years.length > 1 ? "in college" : years.length > 1 ? `from ${years[0]} to ${years[years.length - 1]}` : `in ${years[0]}`;
      const say = phrase(ctx, "stats.max", {
        name: await nameFor(d, ctx), what, span, spanP, said, title: gameTitle(g), titleS: `${g.at === "@" ? "at" : "vs"} ${g.oppRank ? `#${g.oppRank} ` : ""}${shortTeam(g.opp || g.oppAbbr)}`, when: gameWhen(g), whenP: datePhrase(g.date) || gameWhen(g), result: gameResult(g), resultP: resultPhrase(g),
      });
      return { say, ...card(d, { sub: `${facts(d)} · ${what}, ${span}` }), rows, lastGame: gameOf(d, g), tone: "answer" };
    },
  },
];

// ════════ Team records ════════
// A season's games for a team (CFBD schedule snapshots: 2024–2026), as theirs.
const teamGames = (games, key) => games.filter((g) => teamKey(g.home) === key || teamKey(g.away) === key).map((g) => {
  const home = teamKey(g.home) === key;
  const us = home ? g.hp : g.ap;
  const them = home ? g.ap : g.hp;
  return { ...g, team: home ? g.home : g.away, opp: home ? g.away : g.home, at: g.neutral ? "vs" : home ? "vs" : "at", us, them, played: us != null && them != null };
}).sort((a, b) => String(a.date).localeCompare(String(b.date)));
export const TEAM_INTENTS = [
  {
    id: "team.record",
    mode: "general",
    title: "A team's record",
    examples: ["what was Florida State's record in 2026", "what's FSU's record", "how many games did Ohio State win in 2025"],
    patterns: [
      /^(?:what (?:was|is|were)|what's|whats|tell me) (?<team>.+?)(?:'s|s') record(?: (?:in|for|during|this|last) (?:the )?(?<season>20\d\d|season|year)(?: season)?)?$/,
      /^(?:what (?:was|is)|what's|whats) (?:the )?record (?:for|of) (?<team>.+?)(?: (?:in|for|this|last) (?<season>20\d\d|season|year)(?: season)?)?$/,
      /^how many games (?:did|has|have|does) (?<team>.+?) (?:win|won|lose|lost)(?: (?:in|this|last) (?<season>20\d\d|season|year)(?: season)?)?$/,
      /^(?:what was|what's|whats|what is) (?<team>.+?)(?:'s|s') (?:schedule|results)(?: (?:in|for|this|last) (?<season>20\d\d|season|year)(?: season)?)?$/,
    ],
    run: async ({ team, season }, ctx, text) => {
      const t = plain(text || "");
      const y = /\b20\d\d\b/.test(String(season || "")) ? Number(season) : /\blast (?:season|year)\b/.test(t) ? currentSeason() - 1 : currentSeason();
      const key = teamKey(String(team).replace(/^the /, ""));
      const games = teamGames(await ctx.schedule(y), key);
      if (!games.length) return miss(`I don't have a ${y} schedule for ${team}.`, "no-team-schedule");
      const played = games.filter((g) => g.played);
      const w = played.filter((g) => g.us > g.them).length;
      const l = played.filter((g) => g.us < g.them).length;
      const name = games[0].team;
      const done = played.length === games.length;
      const rows = games.map((g) => [`${String(g.date).slice(5, 10).replace("-", "/")} ${g.at} ${g.opp}`, g.played ? `${g.us > g.them ? "W" : "L"} ${g.us}-${g.them}` : "—"]);
      const left = games.length - played.length;
      const lastG = played[played.length - 1];
      const lastS = lastG && !done ? extra(ctx, phrase(ctx, lastG.us > lastG.them ? "team.last.win" : "team.last.loss", { score: `${Math.max(lastG.us, lastG.them)}-${Math.min(lastG.us, lastG.them)}`, at: lastG.at === "at" ? "at" : "against", opp: lastG.opp })) : "";
      const say = join(phrase(ctx, done || y < currentSeason() ? "team.record.final" : "team.record.current", { team: name, w, l, year: y, left: !done && left ? plural(left, "game") : "" }), lastS);
      return { say, title: name, sub: `${y} · ${w}-${l}`, rows, tone: "answer" };
    },
  },
];

