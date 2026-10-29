// src/utils/draftSim/pickNotes.js
//
// The Weekly Mock's pick notes (utils/draftSim/weeklyMock.js): a short
// write-up generated for every pick when the mock is run, saved as the
// pick's note — the admin edits them in the mock editor before publishing.
// Each note is a lead sentence on the pick itself (value, reach, need, or
// where the board has him), then one or two facts, weighted and never two
// of a kind — the team's draft history always last, when it has some:
//   - the We-Draft.com community: his grade, strengths and concerns
//   - CFBD: a national stat rank, or his season line
//   - staff fit: the GM's / coach's draft history, when it's Strong or better
//     (a GM or head coach named as a link to his staff page)
//   - the team's draft history since 2000 (draftHistory.json): its Nth
//     pick at the position from his school, its first first-rounder at the
//     position in years, its first pick from the school
//   - Kenneth Cold's own take on him (analysts.js takeLinesOf), any line
//     the admin marked mock eligible
//   - PFF: his positional rank, credited — only near the top of the list
//     (PFF_TOP) with PFF_MIN_SNAPS snaps; the one place PFF reaches the
//     public site (the caller loads it, admin-only)
// A pick the sim traded opens with the trade: the trade up into it, or the
// trade down that brought it (tradeOpener).
// Lines are data, like the desk's; a template is used again only once the
// rest of its kind have been, so a mock reads varied. A mock is speculation,
// not a team's decision: the lines explain why a pick could make sense —
// never what a team thinks, wants or values.
// Light notes (ctx.light — the next class's mock, drafted a year out) leave
// out needs, value and where he was picked: the lead names him and where the
// community board has him (lightRank, lightTopPos — intro when he has no
// rank), with no pick number; the facts are the same minus the team's
// draft history.
import { pickVars, statFacts, ordinal, lineText, playerTakesFor, takeLinesOf, singular } from "./analysts";
import { needWord, subsOf, rolePhrase } from "./engine";

export const PFF_TOP = 10;
export const PFF_MIN_SNAPS = 150;

// {variables}: pickVars' (player, last, nick, n, rank, posRankOrd, grade,
// strength, weakness, staffer, title, fitWord, needPos …), alias / aAlias
// (another way to say his position — "signal caller", "a pass catcher";
// POS_ALIASES) plus each fact's own.
export const NOTE_LINES = {
  // ── Trade openers (before the lead) ──
  // Traded up into the pick: {fromNick} (who moved back), {got} (what they sent).
  tradeUp: [
    "The {nick} trade up to No. {n} with the {fromNick}, sending {got}.",
    "Trade: the {nick} move up to {n}, giving the {fromNick} {got}.",
    "The {nick} jump up to No. {n} in a deal with the {fromNick}, who get {got}.",
    "{Got} to the {fromNick} moves the {nick} up to No. {n}.",
  ],
  // A pick acquired by trading down: {upNick} (who moved up), {at} (the pick they moved down from).
  tradeDown: [
    "The {nick} pick here with a selection from the {upNick}, acquired when they moved down from No. {at}.",
    "This pick came from the {upNick} in the {nick}' trade down from No. {at}.",
    "The {nick} picked up No. {n} from the {upNick} for moving back from No. {at}.",
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
    "The {nick} turn to {player}, {aAlias} the We-Draft.com board has at No. {rank}.",
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
  // ── Facts ──
  traitsBoth: [
    "The community's evaluations point to his {strength} as the strength; {weakness} is the main concern.",
    "Community scouts like his {strength} and {strength2}, while {weakness} is the knock.",
    "His evaluations lean on {strength}, with {weakness} the area to clean up.",
    "What stands out to the community: {strength}. What gives it pause: {weakness}.",
    "{Strength} is the calling card in his community evaluations; {weakness} is the question.",
  ],
  traitsStrength: [
    "The community's evaluations highlight his {strength} and {strength2}.",
    "Community scouts point to {strength} and {strength2} as his best traits.",
    "{Strength} and {strength2} top the list in his community evaluations.",
  ],
  grade: [
    "We-Draft.com's community grade for him is {grade}, across {count} evaluations.",
    "{count} community evaluations average out to a grade of {grade}.",
    "The community grade: {grade}, from {count} evaluations.",
  ],
  leaderFirst: [
    "His {value} {stat} lead all of college football this season.",
    "Nobody in college football has more {stat} than {last} this season ({value}).",
    "He leads the nation with {value} {stat} in {season}.",
  ],
  leaderRanked: [
    "His {value} {stat} rank {rankOrd} in college football this season.",
    "He's {rankOrd} nationally in {statTitle} ({value}) in {season}.",
    "{value} {stat} so far in {season} puts him {rankOrd} in the country.",
  ],
  passing: [
    "He's thrown for {YDS} yards, {TD} touchdowns and {INT} interceptions on {PCT}% passing this season.",
    "This season: {YDS} passing yards, {TD} TDs, {INT} INTs.",
    "{YPA} yards an attempt with {TD} touchdowns to {INT} interceptions in {season}.",
  ],
  rushing: [
    "He has {YDS} rushing yards and {TD} touchdowns at {YPC} yards a carry this season.",
    "This season: {CAR} carries, {YDS} yards, {TD} scores.",
  ],
  receiving: [
    "He has {REC} catches for {YDS} yards and {TD} touchdowns this season.",
    "This season: {REC} receptions, {YDS} yards, {TD} TDs.",
    "{YPR} yards a catch on {REC} receptions in {season}.",
  ],
  defensive: [
    "He has {TOT} tackles, {TFL} for loss and {SACKS} sacks this season.",
    "This season: {TOT} tackles, {TFL} TFL, {SACKS} sacks.",
  ],
  coverage: [
    "He has {TOT} tackles, {PD} passes defended and {INT} interceptions this season.",
    "This season: {PD} pass breakups and {INT} interceptions.",
  ],
  staffFit: [
    "He fits the profile {staffer} has drafted before; We-Draft.com rates the fit with the {nick}' {title} {fitWord}.",
    "{stafferPoss} draft history says this is his kind of player — a fit We-Draft.com rates {fitWord}.",
    "The pick lines up with {stafferPoss} track record; We-Draft.com rates the fit {fitWord}.",
    "Based on the players he's drafted, the {nick}' {title}, {staffer}, is a {fitWord} fit for him on We-Draft.com's staff-fit scale.",
  ],
  pff: [
    "Pro Football Focus ranks him {pffRankOrd} among college {pffPos} this season.",
    "He's PFF's {pffRankOrd}-ranked {pffOne} this season (via Pro Football Focus).",
    "According to Pro Football Focus, he ranks {pffRankOrd} among college {pffPos}.",
  ],
  teamSchoolPos: [
    "He's the {nth} {posName} the {nick} have drafted from {school} since {firstYear}, after {prev} in {prevYear}.",
    "The {nick} go back to {school} for a {posName}: {last} is the {nth} since {firstYear} (most recently {prev}, {prevYear}).",
    "{school} {posPlural} keep finding their way to the {nick} — {last} is the {nth} since {firstYear}.",
  ],
  teamSchool: [
    "He's the {nth} {school} player the {nick} have drafted since {firstYear}; the last was {prev} in {prevYear}.",
    "The {school} pipeline continues: {last} is the {nick}' {nth} pick from the school since {firstYear}.",
  ],
  teamSchoolFirst: [
    "He's the first {school} player the {nick} have drafted since at least {firstYear}.",
    "The {nick} haven't drafted a {school} player since at least {firstYear} — until {last}.",
  ],
  teamSchoolGap: [
    "It's the {nick}' first pick from {school} since {prev} in {prevYear}.",
    "The {nick} hadn't drafted out of {school} since {prevYear} ({prev}).",
  ],
  teamRound1Drought: [
    "He's the {nick}' first first-round {posName} since {prev} in {prevYear}.",
    "The {nick} hadn't spent a first on a {posName} since {prevYear}, when they took {prev}.",
  ],
  teamRound1First: [
    "He's the first {posName} the {nick} have taken in the first round since at least {firstYear}.",
    "The {nick} hadn't used a first-round pick on a {posName} since at least {firstYear}.",
  ],
};

// Which group each kind is in — a note never has two of a group.
const GROUP = {
  traitsBoth: "traits", traitsStrength: "traits", grade: "grade",
  leaderFirst: "stat", leaderRanked: "stat", passing: "stat", rushing: "stat", receiving: "stat", defensive: "stat", coverage: "stat",
  staffFit: "fit", pff: "pff", take: "take",
  teamSchoolPos: "history", teamSchool: "history", teamSchoolFirst: "history", teamSchoolGap: "history", teamRound1Drought: "history", teamRound1First: "history",
};

// PFF's position codes → words (plural, one).
const PFF_POS = {
  QB: ["quarterbacks", "quarterback"], HB: ["running backs", "running back"], WR: ["wide receivers", "wide receiver"], TE: ["tight ends", "tight end"],
  T: ["offensive tackles", "offensive tackle"], G: ["guards", "guard"], C: ["centers", "center"], ED: ["edge defenders", "edge defender"],
  DI: ["interior defensive linemen", "interior defensive lineman"], LB: ["linebackers", "linebacker"], CB: ["cornerbacks", "cornerback"], S: ["safeties", "safety"],
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

const fill = (text, vars) => text.replace(/\{([\w ]+)\}/g, (_, k) => (vars[k] ?? ""));
const blank = (text, vars) => (text.match(/\{([\w ]+)\}/g) || []).some((v) => {
  const x = vars[v.slice(1, -1)];
  return x == null || x === "";
});
const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// The draft history, indexed once: picks by team.
const indexes = new WeakMap();
function historyOf(h) {
  if (!h?.picks) return null;
  if (!indexes.has(h)) {
    const byTeam = {};
    h.picks.forEach(([year, round, overall, t, pos, s, name]) => {
      const row = { year, round, overall, team: h.teams[t], pos, school: h.schools[s], name };
      (byTeam[row.team] || (byTeam[row.team] = [])).push(row);
    });
    const schoolPicks = {};
    h.picks.forEach((r) => { const s = h.schools[r[5]]; schoolPicks[s] = (schoolPicks[s] || 0) + 1; });
    indexes.set(h, { byTeam, schoolPicks, firstYear: h.years?.[0] || 2000 });
  }
  return indexes.get(h);
}
const latestOf = (rows) => rows.reduce((a, r) => (!a || r.year > a.year || (r.year === a.year && r.overall > a.overall) ? r : a), null);

// The team's draft history facts for a pick (most interesting first).
function historyFacts(e, ctx, base) {
  const ix = historyOf(ctx.history);
  const p = e.prospect;
  if (!ix || !p.School) return [];
  const rows = ix.byTeam[e.team] || [];
  const out = [];
  const add = (cat, weight, extra) => out.push({ cat, weight, vars: { ...base, firstYear: ix.firstYear, ...extra } });
  const fromSchool = rows.filter((r) => r.school === p.School);
  const samePos = fromSchool.filter((r) => r.pos === p.Position);
  if (samePos.length >= 1) {
    const prev = latestOf(samePos);
    add("teamSchoolPos", samePos.length >= 2 ? 3 : 2, { nth: ordinal(samePos.length + 1), prev: prev.name, prevYear: prev.year });
  } else if (fromSchool.length >= 3) {
    const prev = latestOf(fromSchool);
    add("teamSchool", 1.6, { nth: ordinal(fromSchool.length + 1), prev: prev.name, prevYear: prev.year });
  } else if (!fromSchool.length && (ix.schoolPicks[p.School] || 0) >= 25) {
    // A big program the team has never taken from.
    add("teamSchoolFirst", 2.4, {});
  } else if (fromSchool.length) {
    const prev = latestOf(fromSchool);
    if (Number(ctx.year) - prev.year >= 10) add("teamSchoolGap", 2, { prev: prev.name, prevYear: prev.year });
  }
  if (e.pick.round === 1) {
    const r1 = rows.filter((r) => r.round === 1 && r.pos === p.Position);
    const prev = latestOf(r1);
    if (!prev) add("teamRound1First", 2.6, {});
    else if (Number(ctx.year) - prev.year >= 6) add("teamRound1Drought", 2.4, { prev: prev.name, prevYear: prev.year });
  }
  return out;
}

// Picks in prose: "No. 20", "No. 20 and No. 52", "No. 20, No. 52 and a 2028
// second-rounder".
const ROUND_WORDS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const pickWord = (p) => (p.future ? `a ${p.year} ${ROUND_WORDS[p.round - 1] || ordinal(p.round)}-rounder` : `No. ${p.overall}`);
function pickList(picks) {
  const words = picks.filter(Boolean).map(pickWord);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0] || "";
}

// The sim trade behind a pick, told first: the trade up into it, or the
// trade down that brought it (ctx.tradeDowns: { [overall]: { down, up, at } }).
function tradeOpener(e, base, ctx) {
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

// Every fact for a pick: [{ cat, vars, weight }] — a take carries its own
// lines (texts) in place of NOTE_LINES'.
function factsFor(e, ctx, base) {
  const p = e.prospect;
  const out = [];
  const add = (cat, weight, vars = base) => out.push({ cat, weight, vars });
  if (base.strength && base.weakness) add("traitsBoth", 2.6);
  else if (base.strength && base.strength2) add("traitsStrength", 1.8);
  if (base.grade && p.count >= 3) add("grade", 0.6);
  statFacts(e, ctx).forEach((f) => add(f.cat, f.weight + 0.4, f.vars));
  if (base.fitWord && base.staffer) add("staffFit", (e.fit?.s || 0) >= 80 ? 2.6 : 1.6);
  const pff = ctx.pff?.[p.id];
  if (pff && pff.rk <= PFF_TOP && (pff.sn || 0) >= PFF_MIN_SNAPS) {
    const words = PFF_POS[pff.pos] || [base.posPlural, base.posName];
    add("pff", pff.rk <= 3 ? 3 : 2.2, { ...base, pffRankOrd: ordinal(pff.rk), pffPos: words[0], pffOne: words[1] });
  }
  const texts = mockTakes(e).filter((t) => !blank(t, base));
  if (texts.length) out.push({ cat: "take", weight: 5, vars: base, texts });
  historyFacts(e, ctx, base).forEach((f) => out.push(f));
  return out;
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

// The GM or head coach a staff-fit line names, as a link to his staff page
// — "[Darren Mougey](/staff/abc)", which the mock pages render (ViewMock.js
// NoteText) and the editor shows as written. OCs and DCs stay plain.
function staffLink(e, ctx) {
  const fit = e.fit || {};
  const slot = ["GM", "HC", "OC", "DC"].filter((k) => fit[k] != null).sort((a, b) => fit[b] - fit[a])[0];
  const person = slot && ctx.staff?.[e.team]?.[slot];
  if (!person?.n || !person.id || !["GM", "HC"].includes(slot)) return null;
  const link = `[${person.n}](/staff/${person.id})`;
  return { staffer: link, stafferPoss: `${link}${/s$/i.test(person.n) ? "'" : "'s"}` };
}

// A note for one pick event (engine makePick's). ctx: teamNamer's names,
// staff, season, year, history, rand, pff ({ [playerId]: { rk, sn, pos } },
// optional), used (shared across the mock). Rounds 1–2 get two facts, later
// rounds one — then the team's draft history last, whenever there's some.
// ctx.light: a light note (see the top).
const NOT_LIGHT_GROUPS = ["history"];
export function pickNote(e, ctx) {
  const base = { ...pickVars(e, ctx), needPos: e.need ? needWord(e.need.key) : "", rolePhrase: e.need ? rolePhrase(e.need.key) : "", ...aliasVars(e.prospect, ctx.rand) };
  const lead = ctx.light
    ? (e.prospect.positionRank === 1 && lineOf("lightTopPos", base, ctx)) || lineOf("lightRank", base, ctx) || lineOf("intro", base, ctx)
    : lineOf(leadOf(e), base, ctx) || lineOf("board", base, ctx);
  const opener = tradeOpener(e, base, ctx);
  const sentences = [lead];
  const all = factsFor(e, ctx, { ...base, ...staffLink(e, ctx) }).filter((f) => !ctx.light || !NOT_LIGHT_GROUPS.includes(GROUP[f.cat]));
  const history = all.filter((f) => GROUP[f.cat] === "history").sort((a, b) => b.weight - a.weight)[0] || null;
  const facts = all.filter((f) => GROUP[f.cat] !== "history");
  const groups = new Set();
  const want = e.pick.round <= 2 ? 2 : 1;
  while (sentences.length < want + 1 && facts.length) {
    const total = facts.reduce((a, f) => a + f.weight, 0);
    let r = ctx.rand() * total;
    const i = Math.max(0, facts.findIndex((f) => { r -= f.weight; return r <= 0; }));
    const [f] = facts.splice(i, 1);
    const group = GROUP[f.cat] || f.cat;
    if (groups.has(group)) continue;
    groups.add(group);
    const line = f.texts ? capitalize(fill(f.texts[Math.floor(ctx.rand() * f.texts.length)], f.vars)) : lineOf(f.cat, f.vars, ctx);
    if (line) sentences.push(line);
  }
  if (history) sentences.push(lineOf(history.cat, history.vars, ctx));
  return [opener, ...sentences].filter(Boolean).join(" ");
}

