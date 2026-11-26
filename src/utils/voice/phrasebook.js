// src/utils/voice/phrasebook.js
//
// /voice: every way it can word an answer — edit freely (user, 2026-11-25).
//
// Each key lists wordings as small functions of the answer's values; one is
// picked per answer (utils/voice/phrase.js), never the same one twice in a
// row. A wording returns null when it doesn't fit (no school on file…).
// "<key>.again" wordings are for a follow-up about the same player: shorter,
// and "he" instead of his full name.
//
// THE FIRST WORDING OF EVERY KEY is the plain, complete one: it's what you
// get with variation off, and what the tests check. Add new ones below it.
//
// Style (keep every wording to it):
//   - Plain broadcaster. Facts first, no filler: no "Great question!", no
//     "Sure thing!", no "um", no jokes, no fake excitement.
//   - Say it the way it's said out loud: "a 31-17 win", "September 12th",
//     "running back" (not "RB"), "ranked 24th".
//   - Short sentences; one idea each.
//   - Never a judgment the data doesn't make ("he was great" — no; "his best
//     game" — yes, that's the numbers).
import RAW_IMPORTED from "./phrasesImported.json";
import { checkPhrases } from "./phraseTemplates";

const an = (w) => (/^[aeiou]/i.test(w || "") ? "an" : "a");
const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

export const BOOK = {
  // ── How a player is introduced (refs.js nameFor): every form ends in his name ──
  "name.ref": [
    (v) => `${v.school} ${v.pos} ${v.name}`,
    (v) => (v.short ? `${v.short} ${v.pos} ${v.name}` : null),
    (v) => (v.mascot ? `${v.mascot} ${v.pos} ${v.name}` : null),
  ],

  // ── The 411 ──
  "profile.intro": [
    (v) => `${v.name} is ${an(v.pos)} ${v.pos}${v.school ? ` at ${v.school}` : ""}${v.cls ? ` in the ${v.cls} draft class` : ""}.`,
    (v) => (v.school && v.cls ? `${v.name} plays ${v.pos} at ${v.school}, in the ${v.cls} draft class.` : null),
    (v) => (v.school && v.cls ? `${v.school} ${v.pos} ${v.name} is in the ${v.cls} draft class.` : null),
    (v) => (v.school && v.cls ? `${v.name}: ${v.pos}, ${v.school}, ${v.cls} draft class.` : null),
    (v) => (v.school && v.mascot ? `${v.name} is ${an(v.pos)} ${v.pos} for the ${v.school} ${v.mascot}${v.cls ? `, in the ${v.cls} draft class` : ""}.` : null),
    (v) => (v.short && v.cls ? `${v.short} ${v.pos} ${v.name} is in the ${v.cls} draft class.` : null),
  ],
  "profile.intro.he": [
    (v) => `He's ${an(v.pos)} ${v.pos}${v.school ? ` at ${v.school}` : ""}${v.cls ? `, ${v.cls} draft class` : ""}.`,
    (v) => (v.school && v.cls ? `He plays ${v.pos} at ${v.school}, in the ${v.cls} class.` : null),
  ],
  "profile.rank": [
    (v) => `He's ranked ${v.cr} in the class${v.pr ? `, ${v.pr} among ${v.posPl}` : ""}.`,
    (v) => `We-Draft.com has him ${v.cr} in the ${v.cls} class${v.pr ? ` and ${v.pr} among ${v.posPl}` : ""}.`,
    (v) => `On the community board, he's ${v.cr} overall${v.pr ? ` and ${v.pr} at ${v.pos}` : ""}.`,
  ],
  // A top rank (insights.js topRank): #1 overall, #1 at his position, or a top 5 / top 10 player.
  "rank.top.first": [
    (v) => `He's the top-ranked player in the ${v.cls} class.`,
    (v) => `He's number one on the ${v.cls} board.`,
  ],
  "rank.top.position": [
    (v) => `He's the top ${v.pos} in the ${v.cls} class, ${v.cr} overall.`,
    (v) => `No ${v.pos} in the ${v.cls} class ranks higher. He's ${v.cr} overall.`,
    (v) => `He's the number one ${v.pos} on the ${v.cls} board.`,
  ],
  "rank.top.class": [
    (v) => `He's one of the top ${v.n} players in the ${v.cls} class, ranked ${v.cr}.`,
    (v) => `He's a top-${v.n} player in the ${v.cls} class, at ${v.cr}.`,
    (v) => `He's ${v.cr} on the ${v.cls} board.`,
  ],
  "profile.big": [
    () => "He's put up big numbers.",
    () => "Big numbers this year.",
    () => "It's been a productive year.",
  ],
  "pedigree.fiveStar": [
    () => "He was a five-star recruit.",
    () => "He came in as a five-star recruit.",
  ],
  "pedigree.top100": [
    () => "He was a top-100 recruit coming out of high school.",
    () => "He was ranked in the top 100 of his recruiting class.",
  ],

  // ── A season in a sentence (stats.js seasonVars) — v.plus: ", plus 11 catches for 97 yards" ──
  "season.RB": [
    (v) => `He ran for ${v.rushYds} yards and ${v.rushTd} on ${v.carries} carries in ${v.year}${v.plus}.`,
    (v) => `In ${v.year}, he ran for ${v.rushYds} yards and ${v.rushTd}${v.plus}.`,
    (v) => `He carried it ${v.carries} times for ${v.rushYds} yards and ${v.rushTd} in ${v.year}${v.plus}.`,
  ],
  "season.QB": [
    (v) => `He threw for ${v.passYds} yards, ${v.passTd} and ${v.ints} in ${v.year}${v.plus}.`,
    (v) => `In ${v.year}, he threw for ${v.passYds} yards with ${v.passTd} and ${v.ints}${v.plus}.`,
    (v) => `${v.year}: ${v.passYds} passing yards, ${v.passTd}, ${v.ints}.`,
  ],
  "season.REC": [
    (v) => `He caught ${v.rec} passes for ${v.recYds} yards and ${v.recTd} in ${v.year}.`,
    (v) => `In ${v.year}, he caught ${v.rec} passes for ${v.recYds} yards and ${v.recTd}.`,
    (v) => `He had ${v.rec} catches for ${v.recYds} yards and ${v.recTd} in ${v.year}.`,
  ],
  "season.DEF": [
    (v) => `He had ${v.line} in ${v.year}.`,
    (v) => `In ${v.year}, he had ${v.line}.`,
    (v) => `${v.year}: ${v.line}.`,
  ],

  // ── One stat ──
  "stat.one": [
    (v) => `${v.name}: ${v.value}, ${v.label}.`,
    (v) => `${v.name} ${v.verb} ${v.value} ${v.when}.`,
    (v) => `${cap(v.value)} ${v.when} for ${v.name}.`,
    (v) => `${cap(v.when)}, ${v.name} ${v.verb} ${v.value}.`,
  ],
  "stat.one.again": [
    (v) => `He ${v.verb} ${v.value} ${v.when}.`,
    (v) => `${cap(v.value)} ${v.when}.`,
    (v) => `${cap(v.when)}: ${v.value}.`,
  ],
  "stat.change": [
    (v) => `That's ${v.dir} from ${v.prev} in ${v.prevYear}.`,
    (v) => `${v.dir === "up" ? "Up" : "Down"} from ${v.prev} the year before.`,
    (v) => `He had ${v.prev} in ${v.prevYear}.`,
  ],
  "stat.bestYet": [
    () => "That's his best season yet.",
    () => "His best season so far.",
    () => "A high for any of his seasons.",
  ],

  // ── A stat line ──
  "stat.line": [
    (v) => `${v.name}, ${v.label}: ${v.list}.`,
    (v) => `${v.name} ${v.when}: ${v.list}.`,
    (v) => `Here's ${v.name} ${v.when}: ${v.list}.`,
  ],
  "stat.line.again": [
    (v) => `${cap(v.when)}: ${v.list}.`,
    (v) => `Here he is ${v.when}: ${v.list}.`,
  ],

  // ── A game high / low ──
  "stats.max": [
    (v) => `${v.name}'s ${v.what} in ${v.span}: ${v.said}, ${v.title} on ${v.when}, ${v.result}.`,
    (v) => `${v.name}'s ${v.what} ${v.spanP} came ${v.titleS} on ${v.whenP}: ${v.said}${v.resultP ? `, in ${v.resultP}` : ""}.`,
    (v) => `${cap(v.whenP)}, ${v.titleS}: ${v.said}${v.resultP ? `, in ${v.resultP}` : ""}. That was ${v.name}'s ${v.what} ${v.spanP}.`,
  ],
  "stats.max.again": [
    (v) => `His ${v.what} ${v.spanP} came ${v.titleS} on ${v.whenP}: ${v.said}.`,
    (v) => `${cap(v.whenP)}, ${v.titleS}: ${v.said}${v.resultP ? `, in ${v.resultP}` : ""}.`,
  ],

  // ── Games to watch ──
  "games.best": [
    (v) => `Start with these for ${v.name}. ${v.list}.`,
    (v) => `If you're watching ${v.name}, start here. ${v.list}.`,
    (v) => `For ${v.name}, put these on first. ${v.list}.`,
    (v) => `${v.name}'s best tape: ${v.list}.`,
  ],

  // ── Rank ──
  "rank": [
    (v) => `${v.name} is ${v.parts}.`,
    (v) => `We-Draft.com has ${v.name} ${v.parts}.`,
    (v) => `On the community board, ${v.name} is ${v.parts}.`,
  ],
  "rank.again": [
    (v) => `He's ${v.parts}.`,
    (v) => `He sits ${v.parts}.`,
  ],
  // After the rank. v.g: "Second Round"; v.grade: "a second round" (round grades only).
  "rank.grade": [
    (v) => `Community grade: ${v.g}.`,
    (v) => (v.grade ? `The community has him as ${v.grade} pick.` : null),
    (v) => `His community grade is ${String(v.g).toLowerCase()}.`,
  ],

  // ── Your grade ──
  "my.grade": [
    (v) => `You have ${v.name} as ${v.g}.`,
    (v) => `You've got ${v.name} as ${v.g}.`,
    (v) => `${v.name} is ${v.g} on your board.`,
  ],
  "my.grade.again": [
    (v) => `You have him as ${v.g}.`,
    (v) => `He's ${v.g} on your board.`,
  ],
  "my.grade.watch": [
    (v) => `You have ${v.name} on your watchlist.`,
    (v) => `${v.name} is on your watchlist.`,
  ],

  // ── Teams ── (v.left: "3 games")
  "team.record.current": [
    (v) => `${v.team} is ${v.w} and ${v.l} in ${v.year}${v.left ? `, with ${v.left} left on the schedule` : ""}.`,
    (v) => `${v.team}'s ${v.year} record: ${v.w} and ${v.l}${v.left ? `, with ${v.left} left on the schedule` : ""}.`,
    (v) => `${v.team} sits at ${v.w} and ${v.l} in ${v.year}${v.left ? `, with ${v.left} left on the schedule` : ""}.`,
  ],
  "team.record.final": [
    (v) => `${v.team} went ${v.w} and ${v.l} in ${v.year}.`,
    (v) => `${v.team}'s ${v.year} record: ${v.w} and ${v.l}.`,
    (v) => `${v.team} finished ${v.w} and ${v.l} in ${v.year}.`,
  ],
  "team.last.win": [
    (v) => `They won their last game, ${v.score} ${v.at} ${v.opp}.`,
    (v) => `Last time out: a ${v.score} win ${v.at} ${v.opp}.`,
  ],
  "team.last.loss": [
    (v) => `They lost their last game, ${v.score} ${v.at} ${v.opp}.`,
    (v) => `Last time out: a ${v.score} loss ${v.at} ${v.opp}.`,
  ],

  // ── The draft ── (a wording without v.team gets "The Raiders took him." after it — intentsWatch.js)
  "draft.history": [
    (v) => `${v.name}, ${v.pos} out of ${v.school}, went ${v.pickP} in ${v.year}${v.team ? ` to the ${v.team}` : ""}.`,
    (v) => (v.team ? `The ${v.team} took ${v.name}, the ${v.pos} out of ${v.school}, ${v.pickP} in ${v.year}.` : null),
    (v) => `In ${v.year}, ${v.name} went ${v.pickP}${v.team ? ` to the ${v.team}` : ""}, out of ${v.school}.`,
  ],

  // ── Measurements, projection, a school's players (intentsFacts.js) ──
  "profile.measurement": [
    (v) => `${v.name} is listed at ${v.height} and ${v.weight}.`,
  ],
  "profile.measurement.again": [
    (v) => `He's listed at ${v.height} and ${v.weight}.`,
  ],
  // v.projection: "in the second round" / "early in the first round" (from the community grade).
  "draft.projection": [
    (v) => `The community projects ${v.name} to go ${v.projection} in the ${v.cls} draft.`,
  ],
  "draft.projection.again": [
    (v) => `The community projects him to go ${v.projection} in the ${v.cls} draft.`,
  ],
  // v.list: up to five names; v.count: how many.
  "team.roster": [
    (v) => `${v.team} has ${v.list} at ${v.pos}.`,
  ],

  // ── Career, season against season, best season (v.verb: "has" / "averaged") ──
  "stat.career": [
    (v) => `${v.name} ${v.verb} ${v.value} in his career.`,
  ],
  "stat.career.again": [
    (v) => `He ${v.verb} ${v.value} in his career.`,
  ],
  // v.dir: "up" / "down", or "" when the two are the same.
  "stat.seasonCompare": [
    (v) => (v.dir ? `${v.name} had ${v.value} in ${v.year}, ${v.dir} from ${v.prev} in ${v.prevYear}.` : `${v.name} had ${v.value} in ${v.year}, the same as in ${v.prevYear}.`),
  ],
  "stat.seasonCompare.again": [
    (v) => (v.dir ? `He had ${v.value} in ${v.year}, ${v.dir} from ${v.prev} in ${v.prevYear}.` : `He had ${v.value} in ${v.year}, the same as in ${v.prevYear}.`),
  ],
  // Only after the season is checked to be his best for the stat (no ties).
  "stat.bestSeason": [
    (v) => `${v.name}'s best season for ${v.stat} came in ${v.year}, with ${v.value}.`,
  ],
  "stat.bestSeason.again": [
    (v) => `His best season for ${v.stat} was ${v.year}, with ${v.value}.`,
  ],

  // ── Game day (intentsLive.js) ──
  // A game, as said. v.w / v.l winner / loser, v.wp / v.lp their points, v.when "in the 3rd" ("" when unknown).
  "game.final": [
    (v) => `Final: ${v.w} ${v.wp}, ${v.l} ${v.lp}`,
    (v) => `${v.w} beat ${v.l}, ${v.wp} to ${v.lp}`,
    (v) => `It's over: ${v.w} ${v.wp}, ${v.l} ${v.lp}`,
    (v) => `${v.w} won it, ${v.wp} to ${v.lp}, over ${v.l}`,
  ],
  "game.live": [
    (v) => `${v.w} leads ${v.l} ${v.wp} to ${v.lp}${v.when ? ` ${v.when}` : ""}`,
    (v) => `${v.w} is up on ${v.l}, ${v.wp} to ${v.lp}${v.when ? `, ${v.when}` : ""}`,
    (v) => (v.when ? `${cap(v.when)}, it's ${v.w} ${v.wp}, ${v.l} ${v.lp}` : null),
    (v) => `${v.w} has a ${v.wp} to ${v.lp} lead over ${v.l}${v.when ? ` ${v.when}` : ""}`,
  ],
  "game.tied": [
    (v) => `${v.a} and ${v.h} are tied at ${v.pts}${v.when ? ` ${v.when}` : ""}`,
    (v) => `It's tied, ${v.pts} all, between ${v.a} and ${v.h}${v.when ? `, ${v.when}` : ""}`,
    (v) => `${v.a} and ${v.h} are even at ${v.pts}${v.when ? ` ${v.when}` : ""}`,
  ],
  // v.time "7:30 PM" or "time to be announced"; v.tv "" or "ESPN".
  "game.scheduled": [
    (v) => `${v.a} at ${v.h}, ${v.time}${v.tv ? ` on ${v.tv}` : ""}`,
    (v) => `${v.h} hosts ${v.a}, ${v.time}${v.tv ? ` on ${v.tv}` : ""}`,
    (v) => `${v.a} plays at ${v.h}, ${v.time}${v.tv ? `, on ${v.tv}` : ""}`,
  ],
  // v.n "2 games", v.live live count, v.lines the first few games.
  "live.today": [
    (v) => `${v.n} today${v.live ? `, ${v.live} live now` : ""}. ${v.lines}.`,
    (v) => `There are ${v.n} on today's slate${v.live ? `, and ${v.live} ${v.live === 1 ? "is" : "are"} live` : ""}. ${v.lines}.`,
    (v) => `Today's slate has ${v.n}${v.live ? `, ${v.live} in progress` : ""}. ${v.lines}.`,
  ],
  "live.mostProspects": [
    (v) => `The most prospects: ${v.game}, with ${v.k} on the board.`,
    (v) => `${v.game} has the most prospects, ${v.k} on the board.`,
    (v) => `For draft prospects, it's ${v.game}, with ${v.k} on the board.`,
  ],
  // His line in this week's game. v.live: still going; v.line "112 rushing yards…"; v.game the score.
  "live.line": [
    (v) => `${v.name} ${v.live ? "has" : "had"} ${v.line}. ${v.game}.`,
    (v) => (v.live ? `So far, ${v.name} has ${v.line}. ${v.game}.` : `${v.name} finished with ${v.line}. ${v.game}.`),
    (v) => `${v.game}. ${v.name} ${v.live ? "has" : "had"} ${v.line}.`,
    (v) => (v.live ? `${v.name}'s line so far: ${v.line}. ${v.game}.` : `${v.name}'s final line: ${v.line}. ${v.game}.`),
  ],
  "live.line.again": [
    (v) => `He ${v.live ? "has" : "had"} ${v.line}. ${v.game}.`,
    (v) => (v.live ? `So far he has ${v.line}. ${v.game}.` : `He finished with ${v.line}. ${v.game}.`),
    (v) => `${v.game}. He ${v.live ? "has" : "had"} ${v.line}.`,
  ],
  // Top performers. v.span "today" / "this week"; each category: v.label "Passing", v.name, v.team, v.line.
  "perf.intro": [
    (v) => `The top performers ${v.span}.`,
    (v) => `Here are the best stat lines ${v.span}.`,
    (v) => `The leaders ${v.span}.`,
  ],
  "perf.game": [
    (v) => `The leaders in ${v.game}.`,
    (v) => `Top performers in ${v.game}.`,
    (v) => `In ${v.game}, here's who's leading.`,
  ],
  "perf.cat": [
    (v) => `${v.label}: ${v.name}, ${v.team}, ${v.line}`,
    (v) => `${v.label}, ${v.name} of ${v.team} with ${v.line}`,
    (v) => `In ${String(v.label).toLowerCase()}, ${v.name} of ${v.team}: ${v.line}`,
  ],
  "risers.intro": [
    (v) => `The ${v.year} Draft Risers.`,
    (v) => `Here are the ${v.year} Draft Risers.`,
    (v) => `From the ${v.year} Draft Risers list.`,
  ],

  // ── A player's background (intentsMore.js TOPICS) ──
  "bg.career": [
    (v) => `${v.name}'s path: ${v.path}.`,
    (v) => `${v.name}'s career so far: ${v.path}.`,
    (v) => `Here's ${v.name}'s path: ${v.path}.`,
  ],
  // v.rest: ", after X, class of 2023" or "".
  "bg.hs": [
    (v) => `${v.name} went to ${v.hs}${v.rest}.`,
    (v) => `${v.name} played high school football at ${v.hs}${v.rest}.`,
    (v) => `${v.name}'s high school: ${v.hs}${v.rest}.`,
  ],
  "bg.home": [
    (v) => `${v.name} is from ${v.home}.`,
    (v) => `${v.name}'s hometown is ${v.home}.`,
    (v) => `${v.name} calls ${v.home} home.`,
  ],
  // v.yr "third", v.season 2026, v.ry 2024.
  "bg.years": [
    (v) => `${v.name} is in his ${v.yr} college season, ${v.season}. He finished high school in ${v.ry}.`,
    (v) => `This is ${v.name}'s ${v.yr} season of college football. He finished high school in ${v.ry}.`,
    (v) => `${v.name} is playing his ${v.yr} college season in ${v.season}, after finishing high school in ${v.ry}.`,
  ],

  // ── Your board's top (intentsMore.js board.mineTop). v.one "running back", v.cls " in the 2027 class", v.grade "an early first round" ──
  "board.top": [
    (v) => `Your top ${v.one}${v.cls} is ${v.name}, ${v.school}, with ${v.grade} grade.`,
    (v) => `${v.name} of ${v.school} is your top ${v.one}${v.cls}, with ${v.grade} grade.`,
    (v) => `At the top of your board${v.cls} at ${v.one}: ${v.name}, ${v.school}, ${v.grade} grade.`,
  ],

  // ── Accolades (intentsFacts.js). v.list "2025, First-Team All-ACC; …", v.more " 2 more on screen." ──
  "accolades": [
    (v) => `${v.name}'s honors: ${v.list}.${v.more}`,
    (v) => `Honors for ${v.name}: ${v.list}.${v.more}`,
    (v) => `${v.name} has these honors: ${v.list}.${v.more}`,
  ],

  // ── Comparing two players (intentsFacts.js). v.when "In 2026" / "Careers"; v.a / v.b each "Name, 609 rushing yards, …" ──
  "compare": [
    (v) => `${v.when}. ${v.a}. ${v.b}.`,
    (v) => `Side by side, ${String(v.when).replace(/^In /, "in ")}. ${v.a}. ${v.b}.`,
    (v) => `${v.when}: ${v.a}. And ${v.b}.`,
  ],

  // ── Notes, requests (intentsRequests.js / requests.js). v.kind "Admin" / "Voice" ──
  "note.saved": [
    (v) => `${v.kind} note saved.`,
    (v) => `Saved to your ${String(v.kind).toLowerCase()} notes.`,
    (v) => `Got it. ${v.kind} note saved.`,
    (v) => `${v.kind} note added.`,
  ],
  "request.sent": [
    () => "Sent. We-Draft.com will reply in your Messages.",
    () => "Request sent. The reply will show up in your Messages.",
    () => "Done. We-Draft.com will answer in your Messages.",
  ],
  "suggestion.sent": [
    () => "Sent. Thanks. We-Draft.com will reply in your Messages.",
    () => "Thanks, that's sent. Watch your Messages for the reply.",
    () => "Suggestion sent. The reply will come to your Messages.",
  ],

  // ── The morning readout (intentsReadout.js) ──
  "readout.intro": [
    (v) => `Morning readout for ${v.date}.`,
    (v) => `Here's the morning readout for ${v.date}.`,
    (v) => `Your readout for ${v.date}.`,
  ],
  // v.total / v.nw / v.ret numbers as said; v.acc ", with 3 signed-in accounts" or "".
  "readout.visitors": [
    (v) => `Yesterday, ${v.total} people visited the site: ${v.nw} new and ${v.ret} returning${v.acc}.`,
    (v) => `${v.total} people came to the site yesterday, ${v.nw} of them new and ${v.ret} returning${v.acc}.`,
    (v) => `The site had ${v.total} visitors yesterday: ${v.nw} new, ${v.ret} returning${v.acc}.`,
  ],

  // ── Suggestions ──
  "suggest": [
    (v) => `Try ${v.name}.`,
    (v) => `How about ${v.name}?`,
    (v) => `Check out ${v.name}.`,
    (v) => `${v.name} is worth a look.`,
  ],

  // ── The community's traits, out loud (no percentages) ──
  "traits.strengths": [
    (v) => `People like ${v.name}'s ${v.list} the most.`,
    (v) => `The community's biggest strengths for ${v.name} are ${v.list}.`,
    (v) => `What stands out on ${v.name} is ${v.list}.`,
    (v) => `Evaluators keep pointing to ${v.name}'s ${v.list}.`,
  ],
  "traits.weaknesses": [
    (v) => (v.only ? `The knocks on ${v.name} are ${v.list}.` : `The knocks on him are ${v.list}.`),
    (v) => (v.only ? `People worry most about ${v.name}'s ${v.list}.` : `Where people have concerns is ${v.list}.`),
    (v) => (v.only ? `The weaknesses people flag for ${v.name} are ${v.list}.` : `On the other side, people flag ${v.list}.`),
  ],

  // ── Stat leaders ──
  "leader.team": [
    (v) => `${v.name} leads ${v.team} with ${v.value}${v.when}.`,
    (v) => `That's ${v.name}, with ${v.value} for ${v.team}${v.when}.`,
    (v) => `${v.team}'s leader is ${v.name}, at ${v.value}${v.when}.`,
  ],
  "leader.nation": [
    (v) => `${v.name} of ${v.school} leads the country with ${v.value}.`,
    (v) => `Nobody has more than ${v.name} at ${v.school}, with ${v.value}.`,
    (v) => `The national leader is ${v.name} of ${v.school}, with ${v.value}.`,
  ],

  // ── Misses, out loud: short — the screen shows what was heard (user, 2026-11-25) ──
  "miss.short": [() => "Sorry, I didn't get that.", () => "I can't answer that one yet.", () => "Not sure on that one. Try asking it another way.", () => "That one's not in my playbook yet."],
  "miss.player.short": [() => "I couldn't find that player.", () => "I'm not sure who that is.", () => "I didn't catch that name."],

  // ── Acknowledgments ──
  "ack.pronounced": [(v) => `Got it. ${v.name}.`, (v) => `Okay, ${v.name}. I'll say it that way from now on.`, (v) => `Thanks. ${v.name}, got it.`],
  "ack.note": [() => "Got it. I saved that.", () => "Noted.", () => "Got it, I'll pass that along.", () => "Saved as a voice note."],
  "ack.saved": [() => "Saved.", () => "Done.", () => "Got it."],
  "ack.done": [() => "Done.", () => "Updated.", () => "Saved."],
  "ack.cancel": [() => "Okay, I didn't change anything.", () => "Okay, I left it alone.", () => "Got it. Nothing changed."],

  // ── Misses ──
  "miss.player": [
    (v) => `I don't know who "${v.said}" is.`,
    (v) => `I couldn't find anyone named "${v.said}".`,
  ],
  "miss.player.school": [
    (v) => `I don't have "${v.said}" at ${v.school}.`,
    (v) => `I can't find "${v.said}" at ${v.school}.`,
  ],
  "miss.question": [
    (v) => `Sorry, I don't know how to answer "${v.text}" yet. I saved it so it can be added.`,
    (v) => `I can't answer "${v.text}" yet. I saved it so it can be added.`,
  ],
};

// ── The imported wordings (phrasesImported.json, from ChatGPT) ──
// Added after the ones above, so the first wording of every key stays the
// plain one. Only lines that pass phraseTemplates.js checkPhrases are used.
const { kept: IMPORTED } = checkPhrases(RAW_IMPORTED, BOOK);
Object.entries(IMPORTED).forEach(([key, lines]) => { BOOK[key] = [...BOOK[key], ...lines]; });
