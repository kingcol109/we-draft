// src/utils/draftSim/pickNotes.js
//
// The Weekly Mock's pick notes (utils/draftSim/weeklyMock.js): a short
// write-up generated for every pick when the mock is run, saved as the
// pick's note — the admin edits them in the mock editor before publishing.
//
// A note is two parts (user, 2026-11-24):
//   1. The pick, announced: the lead sentence (value, reach, need, or where
//      the board has him). A pick the sim traded is announced with the trade
//      — the trade up into it, or the trade down that brought it.
//   2. What to know about him — the first of these that exists:
//      a. the team's own write-up on him from its NFL Targets list
//         (nflTargets/{TEAM} featured / list entry note — ctx.writeUps.team)
//      b. his generic write-up (config/prospectBlurbs — ctx.writeUps.generic)
//      c. Kenneth Cold's take on him (analysts.js takeLinesOf), any line the
//         admin marked mock eligible
//      d. the We-Draft.com community's read: strengths, concerns and grade
//         in one sentence
// No stats (the mock pages show his season line on the card instead), no
// draft-history (Thad) facts, staff fit or PFF.
// Lines are data; a template is used again only once the rest of its kind
// have been, so a mock reads varied. A mock is speculation, not a team's
// decision: the lines explain why a pick could make sense — never what a
// team thinks, wants or values.
// Light notes (ctx.light — the next class's mock, drafted a year out) leave
// out needs, value and where he was picked: the lead names him and where the
// community board has him (lightRank, lightTopPos — intro when he has no
// rank), with no pick number. The second part is the same.
import { pickVars, lineText, playerTakesFor, takeLinesOf, singular } from "./analysts";
import { needWord, subsOf, rolePhrase } from "./engine";

// {variables}: pickVars' (player, last, nick, n, rank, posRankOrd, grade,
// strength, weakness …), alias / aAlias (another way to say his position —
// "signal caller", "a pass catcher"; POS_ALIASES), gradeAdj / aGrade (his
// community grade as words — "second-round", "a second-round") plus each
// kind's own.
export const NOTE_LINES = {
  // ── Trade leads (in place of the lead) ──
  // Traded up into the pick: {fromNick} (who moved back), {got} (what they sent).
  tradeUp: [
    "The {nick} trade up to No. {n} with the {fromNick}, sending {got}, and take {player}.",
    "The {nick} move up to {n} in a deal with the {fromNick} — {got} goes the other way — to land {player}.",
    "{Got} to the {fromNick} gets the {nick} up to No. {n}, and they use it on {player}.",
    "The {nick} get aggressive, jumping to No. {n} with the {fromNick} for {got} to grab {player}.",
  ],
  // A pick acquired by trading down: {upNick} (who moved up), {at} (the pick they moved down from).
  tradeDown: [
    "With the pick from the {upNick} — acquired by moving down from No. {at} — the {nick} take {player}.",
    "The {nick} turn the pick they got from the {upNick} for sliding back from No. {at} into {player}.",
    "No. {n} came from the {upNick} in the {nick}' trade down from {at}, and they spend it on {player}.",
  ],
  // ── Lead sentences ──
  steal: [
    "{player} was No. {rank} on the We-Draft.com community board, so the {nick} get him {spots} spots later than the community expected.",
    "Value pick. The community board had {last} at No. {rank}, and the {nick} land him at {n}.",
    "{player}, the community's No. {rank} prospect, is still on the board at {n} — a value that's hard to pass up for the {nick}.",
    "{last} slides {spots} spots past his community ranking here, which makes him a sensible pick for the {nick} at {n}.",
    "At No. {rank} on the We-Draft.com board, {last} is a clear value for the {nick} at {n}.",
    "The community had {player} going well before {n}, so he'd be a strong value for the {nick} here.",
  ],
  reach: [
    "{player} goes {spots} spots ahead of his community ranking (No. {rank}), so the case for him at {n} rests on what he could become for the {nick}.",
    "{player} comes off the board earlier than the community expected — he's No. {rank} on the We-Draft.com board.",
    "This one goes against the ranking: {last} was No. {rank} on the community board, and the case for him at {n} is what he could bring the {nick}.",
    "{last} sits at No. {rank} on the We-Draft.com board, so No. {n} is early by the community's measure — the case for him is what he'd add to the {nick}.",
    "{last} at {n} is earlier than the board suggests (No. {rank}), but a team that likes him might not want to risk him being gone by its next pick.",
  ],
  need: [
    "{needPos} was a big need for the {nick}, and {player} could be the answer at {n}.",
    "The {nick} address {needPos} with {player}, one of the clearest needs on the roster.",
    "{player} fills a hole: the {nick} came into the draft needing help at {needPos}.",
    "No position needed help more for the {nick} than {needPos}. Enter {player}.",
    "The {nick} were in the market for help at {needPos}, and {player} fits the bill.",
    "{needPos} was near the top of the {nick}' shopping list. {player} checks the box.",
    "The {nick} go need-first with {player}, a {posName} for a roster that's been short at {needPos}.",
  ],
  // A role need ({rolePhrase}: "a tight end who can help in the run game") —
  // said as the player it describes, never as a label.
  needRole: [
    "The {nick} came into the draft looking for {rolePhrase}, and {player} could be that guy at {n}.",
    "{player} gives the {nick} {rolePhrase}, one of the clearest needs on the roster.",
    "One of the {nick}' biggest needs was {rolePhrase}. {player} fits that description.",
    "{player} could fill a real need for the {nick}: {rolePhrase}.",
    "The {nick} have been short on {rolePhrase}, which makes {player} a sensible pick at {n}.",
  ],
  board: [
    "{player} goes at {n}, right around the No. {rank} spot the We-Draft.com community has him.",
    "The {nick} take {player}, the community's {posRankOrd}-ranked {posName}.",
    "{player} is the pick for the {nick} — the {posRankOrd} {posName} on the We-Draft.com board.",
    "A board-driven pick: {last} was No. {rank} in the community rankings and goes {n}.",
    "The {nick} stay on the board with {player} ({school}).",
    "{player} out of {school} is the selection, the {posRankOrd} {posName} in the community rankings.",
    "The {nick} opt for {aAlias}: {player}, the community's {posRankOrd}-ranked {posName}.",
    "{aAlias} for the {nick} — {player} out of {school}.",
    "The {nick} turn to {player}, {aAlias} the We-Draft.com board has at No. {rank}.",
    "The {nick} come away with {player} of {school}, the {posRankOrd} {posName} on the community board.",
  ],
  // The light leads: who he is and where the board has him — never the pick, value or need.
  lightRank: [
    "The {nick} take {player}, the community's {posRankOrd}-ranked {posName}.",
    "{player} ({school}) is the pick for the {nick} — No. {rank} on the We-Draft.com community board.",
    "The {nick} add {player}, the {posRankOrd} {posName} on the We-Draft.com board.",
    "{school} {posName} {player}, No. {rank} in the community rankings, heads to the {nick}.",
    "The {nick} go with {player}, the {posName} from {school} and the community's No. {rank} prospect.",
    "The {nick} opt for {aAlias}: {player}, No. {rank} on the We-Draft.com community board.",
    "The {nick} turn to {player}, {aAlias} the We-Draft.com board ranks No. {rank}.",
    "It's {aAlias} for the {nick} — {player} of {school}, the {posRankOrd} {posName} in the community rankings.",
    "The {nick} come away with {player}, the community's No. {rank} prospect and its {posRankOrd} {posName}.",
    "Next up for the {nick}: {player}, {aAlias} out of {school} the community ranks No. {rank}.",
    "{school} {alias} {player} lands with the {nick}; the community has him No. {rank} overall.",
  ],
  lightTopPos: [
    "{player} is the top {posName} on the We-Draft.com board, and the {nick} make him the first one off it.",
    "The {nick} land the community's No. 1 {posName}, {player}.",
    "{last} is the community's highest-rated {posName}, and he's headed to the {nick}.",
    "The {nick} grab the best {alias} on the board in {player}.",
    "No {posName} rates higher with the We-Draft.com community than {player}, and the {nick} make him theirs.",
  ],
  intro: [
    "The {nick} take {player}, the {posName} out of {school}.",
    "{player} ({school}) is the pick for the {nick}.",
    "The {nick} add {posName} {player} from {school}.",
    "{school} {posName} {player} heads to the {nick}.",
    "The {nick} go with {player}, the {posName} from {school}.",
    "The {nick} opt for {aAlias}, taking {player} out of {school}.",
    "{player}, {aAlias} from {school}, is the {nick}' pick.",
    "The {nick} add {aAlias} in {player} ({school}).",
  ],
  topPos: [
    "{player} is the top {posName} on the We-Draft.com board, and the {nick} make him the first one off it.",
    "The community's No. 1 {posName}, {player}, goes to the {nick} at {n}.",
    "{last} was the community's highest-rated {posName}, and the {nick} grab him at No. {n}.",
    "The {nick} grab the best {alias} on the board in {player}.",
  ],
  // ── The community's read (when there's no write-up or take) ──
  // A strength and a concern, with his grade.
  readFull: [
    "The community has {aGrade} grade on him, built on his {strength} and held back a bit by {weakness}.",
    "It's {aGrade} grade from the community — the {strength} sells it, while {weakness} keeps him from climbing higher.",
    "His {strength} is why community evaluators see {aGrade} talent; {weakness} is the hurdle between him and more.",
    "Community evaluators land on {aGrade} grade, with his {strength} the draw and {weakness} the worry.",
    "Bet on the {strength} and be patient with {weakness} — that's the {gradeAdj} profile the community sees.",
  ],
  // A strength and a concern, no grade.
  readBoth: [
    "His {strength} jumps off the tape, though {weakness} is still a work in progress.",
    "There's a lot to like in his {strength}, and if {weakness} comes along, the ceiling climbs.",
    "The {strength} is real; {weakness} is what stands between him and a long career.",
    "Community evaluators rave about his {strength} but want to see {weakness} tightened up.",
    "{Strength} is his calling card — {weakness} is the part of his game still catching up.",
    "He wins with {strength}, and the next step is sorting out {weakness}.",
  ],
  // Two strengths, with his grade.
  readStrengthsGrade: [
    "Evaluators like his {strength} and {strength2} enough to give him {aGrade} grade.",
    "The community's {gradeAdj} grade leans on his {strength} and {strength2}.",
    "{Strength} and {strength2} are the backbone of his {gradeAdj} grade from the community.",
  ],
  // Two strengths, no grade.
  readStrengths: [
    "His {strength} and {strength2} are what pop on tape.",
    "Two things stand out when you turn on his tape: {strength} and {strength2}.",
    "He brings {strength} and {strength2}, the traits community evaluators keep circling.",
    "It starts with his {strength}, and his {strength2} isn't far behind.",
  ],
  // One strength (with or without a grade).
  readStrength: [
    "His {strength} is what stands out on tape.",
    "Everything about his game starts with {strength}.",
    "The community keeps coming back to one thing: his {strength}.",
  ],
  readStrengthGrade: [
    "His {strength} is the reason the community gives him {aGrade} grade.",
    "The community sees {aGrade} talent, and his {strength} is a big part of why.",
  ],
  // Just his grade.
  readGrade: [
    "The community sees him as {aGrade} talent.",
    "Community evaluators have him graded as {aGrade} prospect.",
    "He carries {aGrade} grade from the We-Draft.com community.",
  ],
};

// Other ways to say a position, by need key (an OL / DB by his
// sub-position) or position: one is picked for each note.
const POS_ALIASES = {
  QB: ["signal caller", "passer", "quarterback"],
  RB: ["ball carrier", "running back", "back"],
  WR: ["pass catcher", "wideout", "receiver"],
  TE: ["tight end", "target at tight end"],
  OT: ["tackle", "bookend", "edge protector"],
  G: ["guard", "interior lineman", "blocker"],
  C: ["center", "interior lineman", "pivot"],
  OL: ["offensive lineman", "blocker", "trench player"],
  DL: ["interior defender", "defensive tackle", "run stuffer"],
  EDGE: ["pass rusher", "edge defender", "edge rusher"],
  LB: ["linebacker", "second-level defender", "tackler"],
  CB: ["cornerback", "cover corner"],
  S: ["safety", "back-end defender"],
  DB: ["defensive back", "cover man"],
  K: ["kicker"],
  P: ["punter"],
};
function aliasVars(p, rand) {
  const subs = subsOf(p);
  const list = POS_ALIASES[subs.length === 1 ? subs[0] : p.Position] || [];
  if (!list.length) return {};
  const alias = list[Math.floor(rand() * list.length)];
  return { alias, aAlias: `${/^[aeiou]/i.test(alias) ? "an" : "a"} ${alias}` };
}

// His community grade as words ("Second Round" → "second-round", "a
// second-round"; "Early First Round" → "early first-round", "an early
// first-round") — none for UDFA or fewer than 3 evaluations.
function gradeVars(grade, count) {
  if (!grade || grade === "UDFA" || !(count >= 3)) return { gradeAdj: "", aGrade: "" };
  const adj = grade.toLowerCase().replace(/ round$/, "-round");
  return { gradeAdj: adj, aGrade: `${/^[aeiou]/.test(adj) ? "an" : "a"} ${adj}` };
}

const fill = (text, vars) => text.replace(/\{([\w ]+)\}/g, (_, k) => (vars[k] ?? ""));
const blank = (text, vars) => (text.match(/\{([\w ]+)\}/g) || []).some((v) => {
  const x = vars[v.slice(1, -1)];
  return x == null || x === "";
});
const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Picks in prose: "No. 20", "No. 20 and No. 52", "No. 20, No. 52 and a 2028
// second-rounder".
const ROUND_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const pickWord = (p) => (p.future ? `a ${p.year} ${ROUND_WORDS[p.round - 1] || ordinal(p.round)}-rounder` : `No. ${p.overall}`);
function pickList(picks) {
  const words = picks.filter(Boolean).map(pickWord);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0] || "";
}

// The sim trade behind a pick, announced with him: the trade up into it, or
// the trade down that brought it (ctx.tradeDowns: { [overall]: { down, up, at } }).
function tradeLead(e, base, ctx) {
  const t = e.pick.tradeUp;
  if (t) {
    const got = pickList(t.give || []);
    return got && lineOf("tradeUp", { ...base, fromNick: ctx.nickname(t.from), got, Got: capitalize(got) }, ctx);
  }
  const d = ctx.tradeDowns?.[e.pick.overall];
  if (d && d.down === e.team && d.at) return lineOf("tradeDown", { ...base, upNick: ctx.nickname(d.up), at: d.at }, ctx);
  return null;
}

// The lead's kind for a pick.
function leadOf(e) {
  const p = e.prospect;
  if (e.value >= Math.max(5, e.pick.overall * 0.2)) return "steal";
  if (-e.value >= Math.max(8, e.pick.overall * 0.3)) return "reach";
  if (e.need && ["Upgrade Needed", "Expiring Contract", "Aging Talent"].includes(e.need.label)) return rolePhrase(e.need.key) ? "needRole" : "need";
  if (p.positionRank === 1) return "topPos";
  return "board";
}

// Kenneth's mock-eligible take lines for a pick.
const mockTakes = (e) => takeLinesOf(playerTakesFor(e.prospect.id)).filter((l) => l.mock).map(lineText);

// The community's read, as one sentence: the richest kind his evaluations fill.
function readOf(base, ctx) {
  const kinds = base.strength && base.weakness ? ["readFull", "readBoth"]
    : base.strength && base.strength2 ? ["readStrengthsGrade", "readStrengths"]
      : base.strength ? ["readStrengthGrade", "readStrength"]
        : ["readGrade"];
  // With a grade, the graded kind about two times in three — the rest read as plain traits.
  const order = base.aGrade && kinds.length > 1 && ctx.rand() < 0.35 ? [kinds[1], kinds[0]] : kinds;
  for (const k of order) {
    const line = lineOf(k, base, ctx);
    if (line) return line;
  }
  return null;
}

// What to know about him: the team's write-up, his generic one, Kenneth's
// mock take, then the community's read — the first that exists.
// ctx.writeUps: { team: { [TEAM]: { [playerId]: text } }, generic: { [playerId]: text } }.
function aboutHim(e, base, ctx) {
  const id = e.prospect.id;
  const own = String(ctx.writeUps?.team?.[e.team]?.[id] || "").trim();
  if (own) return own;
  const generic = String(ctx.writeUps?.generic?.[id] || "").trim();
  if (generic) return generic;
  const takes = mockTakes(e).filter((t) => !blank(t, base));
  if (takes.length) return capitalize(fill(takes[Math.floor(ctx.rand() * takes.length)], base));
  return readOf(base, ctx);
}

// One template of a kind: the next one the mock hasn't used (ctx.used:
// { [kind]: [index] }), whose every {variable} has a value.
function lineOf(cat, vars, ctx) {
  const pool = (NOTE_LINES[cat] || []).map((t, i) => [t, i]).filter(([t]) => !blank(t, vars));
  if (!pool.length) return null;
  const used = ctx.used || (ctx.used = {});
  const seen = used[cat] || (used[cat] = []);
  let fresh = pool.filter(([, i]) => !seen.includes(i));
  if (!fresh.length) { used[cat] = []; fresh = pool; }
  const [text, i] = fresh[Math.floor(ctx.rand() * fresh.length)];
  used[cat].push(i);
  return capitalize(singular(fill(text, vars)));
}

// A note for one pick event (engine makePick's). ctx: teamNamer's names,
// staff, season, year, rand, writeUps (above, optional), used (shared across
// the mock), tradeDowns. ctx.light: a light note (see the top).
export function pickNote(e, ctx) {
  const vars = pickVars(e, ctx);
  const base = {
    ...vars, needPos: e.need ? needWord(e.need.key) : "", rolePhrase: e.need ? rolePhrase(e.need.key) : "",
    ...aliasVars(e.prospect, ctx.rand), ...gradeVars(vars.grade, e.prospect.count),
  };
  const lead = tradeLead(e, base, ctx)
    || (ctx.light
      ? (e.prospect.positionRank === 1 && lineOf("lightTopPos", base, ctx)) || lineOf("lightRank", base, ctx) || lineOf("intro", base, ctx)
      : lineOf(leadOf(e), base, ctx) || lineOf("board", base, ctx));
  return [lead, aboutHim(e, base, ctx)].filter(Boolean).join(" ");
}
