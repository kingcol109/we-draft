// src/utils/voice/phraseTemplates.js
//
// /voice: wordings written as plain text templates (user, 2026-11-25 — the
// bulk ones come from ChatGPT, pasted into phrasesImported.json).
//
//   "{name} had {value} {when}."
//   - {x} is filled from the answer's values; {X} (capital first letter) is
//     the same value with its first letter capitalized ("{When}, …").
//   - A template with an empty value is skipped for that answer.
//   - "a {pos}" picks a/an from the value ("an edge rusher").
//   - The finished sentence starts with a capital letter.
//
// checkPhrases() decides which imported lines are used — every line has to
// pass these rules, checked when the app loads (cheap) and in the tests:
//   - the key exists in the phrasebook; only that key's values are used;
//     the values the key needs are all there; no value twice;
//   - no banned words (style guide: no hype, no filler, no "!");
//   - at most 25 words; not a repeat of another wording;
//   - not in REVIEWED_OUT (lines read and left out, each with the reason).
// phrasesImported.json stays exactly as pasted; to add more, paste them in
// and run the tests — phraseTemplates.test.js lists what was left out.

/** Per key: the values a template may use, the ones it must use, and sample values for checking. */
const NAME = "Ousmane Kromah";
export const SPEC = {
  "name.ref": { known: "name pos school short mascot", required: "name", sample: { name: NAME, pos: "running back", school: "Florida State", short: "FSU", mascot: "Seminoles" } },
  "profile.intro": { known: "name pos school cls short mascot", required: "name pos", sample: { name: NAME, pos: "running back", school: "Florida State", cls: "2028", short: "FSU", mascot: "Seminoles" } },
  "profile.rank": { known: "cr pr posPl pos cls", required: "cr", sample: { cr: "24th", pr: "3rd", posPl: "running backs", pos: "running back", cls: "2028" } },
  "rank.top.class": { known: "cr pr posPl pos cls n", required: "cr", sample: { cr: "4th", pr: "2nd", posPl: "running backs", pos: "running back", cls: "2028", n: 5 } },
  "rank.top.position": { known: "cr pr posPl pos cls n", required: "cr pos", sample: { cr: "14th", pr: "1st", posPl: "running backs", pos: "running back", cls: "2028", n: 1 } },
  "rank.top.first": { known: "cr pos posPl cls", required: "cls", sample: { cr: "1st", pos: "running back", posPl: "running backs", cls: "2028" } },
  "profile.big": { known: "", required: "", sample: {} },
  "pedigree.fiveStar": { known: "", required: "", sample: {} },
  "pedigree.top100": { known: "", required: "", sample: {} },
  "season.RB": { known: "year rushYds rushTd carries", required: "year rushYds rushTd", sample: { year: "2026", rushYds: "1,100", rushTd: "12 touchdowns", carries: "190" } },
  "season.QB": { known: "year passYds passTd ints", required: "year passYds passTd", sample: { year: "2026", passYds: "3,200", passTd: "28 touchdowns", ints: "6 interceptions" } },
  "season.REC": { known: "year rec recYds recTd", required: "year rec recYds", sample: { year: "2026", rec: "70", recYds: "1,050", recTd: "9 touchdowns" } },
  "season.DEF": { known: "year line", required: "year line", sample: { year: "2026", line: "62 tackles, 8 for loss and 3 sacks" } },
  "stat.one": { known: "name value when label", required: "name value when", sample: { name: NAME, value: "1,034 rushing yards", when: "in 2025", label: "2025", verb: "had" } },
  "stat.one.again": { known: "value when label", required: "value when", sample: { value: "1,034 rushing yards", when: "in 2025", label: "2025", verb: "had" } },
  "stat.change": { known: "dir prev prevYear", required: "prev prevYear", sample: { dir: "up", prev: "812 rushing yards", prevYear: "2024" } },
  "stat.bestYet": { known: "", required: "", sample: {} },
  "stat.line": { known: "name when list label", required: "name when list", sample: { name: NAME, when: "in 2025", label: "2025", list: "1,034 rushing yards, 9 rushing touchdowns, 5.2 yards per carry" } },
  "stat.line.again": { known: "when list label", required: "when list", sample: { when: "in 2025", label: "2025", list: "1,034 rushing yards, 9 rushing touchdowns, 5.2 yards per carry" } },
  "stats.max": { known: "name what spanP said titleS whenP resultP", required: "name what spanP said titleS whenP", sample: { name: NAME, what: "most rushing yards", span: "2025", spanP: "in 2025", said: "160 rushing yards", title: "vs ALA", titleS: "vs Alabama", when: "9/12", whenP: "September 12th", result: "W 31-17", resultP: "a 31-17 win" } },
  "stats.max.again": { known: "what spanP said titleS whenP resultP", required: "what spanP said titleS whenP", sample: { what: "most rushing yards", span: "2025", spanP: "in 2025", said: "160 rushing yards", title: "vs ALA", titleS: "vs Alabama", when: "9/12", whenP: "September 12th", result: "W 31-17", resultP: "a 31-17 win" } },
  "games.best": { known: "name list", required: "name list", sample: { name: NAME, list: "September 12th against Alabama: 160 rushing yards, a 31-17 win" } },
  "rank": { known: "name parts", required: "name parts", sample: { name: NAME, parts: "12th overall in the 2028 class of 300, and 2nd among running backs" } },
  "rank.grade": { known: "grade", required: "grade", sample: { grade: "a second round", g: "Second Round" } },
  "my.grade": { known: "name g", required: "name g", sample: { name: NAME, g: "a second round grade" } },
  "my.grade.watch": { known: "name", required: "name", sample: { name: NAME } },
  "team.record.current": { known: "team w l year left", required: "team w l", sample: { team: "Florida State", w: 5, l: 6, year: "2026", left: "1 game" } },
  "team.record.final": { known: "team w l year", required: "team w l year", sample: { team: "Florida State", w: 5, l: 7, year: "2025" } },
  "team.last.win": { known: "score at opp", required: "score at opp", sample: { score: "31-17", at: "against", opp: "Miami" } },
  "team.last.loss": { known: "score at opp", required: "score at opp", sample: { score: "31-17", at: "at", opp: "Miami" } },
  "draft.history": { known: "name pos school pickP year team", required: "name pickP year", sample: { name: "JaMarcus Russell", pos: "quarterback", school: "LSU", pickP: "first overall", year: 2007, team: "Oakland Raiders" } },
  "suggest": { known: "name", required: "name", sample: { name: NAME } },
  // Game day, board top, accolades, compare, notes, readout (wordings in phrasebook.js; ready for templates too).
  "game.final": { known: "w l wp lp", required: "w l wp lp", sample: { w: "Ohio State", l: "Michigan", wp: 31, lp: 17 } },
  "game.live": { known: "w l wp lp when", required: "w l wp lp", sample: { w: "Florida State", l: "Clemson", wp: 21, lp: 17, when: "in the 3rd" } },
  "game.tied": { known: "a h pts when", required: "a h pts", sample: { a: "Clemson", h: "Florida State", pts: 14, when: "in the 2nd" } },
  "game.scheduled": { known: "a h time tv", required: "a h time", sample: { a: "LSU", h: "number 5 Alabama", time: "7:30 PM", tv: "ESPN" } },
  "live.today": { known: "n live lines", required: "n lines", sample: { n: "2 games", live: 1, lines: "Florida State leads Clemson 21 to 17 in the 3rd" } },
  "live.mostProspects": { known: "game k", required: "game k", sample: { game: "Clemson at Florida State", k: 9 } },
  "live.line": { known: "name line game live", required: "name line game", sample: { name: NAME, line: "112 rushing yards and a touchdown on 18 carries", game: "Florida State leads Clemson 21 to 17 in the 3rd", live: true } },
  "live.line.again": { known: "line game live", required: "line game", sample: { line: "112 rushing yards and a touchdown on 18 carries", game: "Florida State leads Clemson 21 to 17 in the 3rd", live: true } },
  "perf.intro": { known: "span", required: "span", sample: { span: "today" } },
  "perf.game": { known: "game", required: "game", sample: { game: "Clemson at Florida State" } },
  "perf.cat": { known: "label name team line", required: "label name team line", sample: { label: "Rushing", name: NAME, team: "Florida State", line: "112 yards on 18 carries" } },
  "risers.intro": { known: "year", required: "year", sample: { year: "2027" } },
  "bg.career": { known: "name path", required: "name path", sample: { name: NAME, path: "IMG Academy, class of 2023, then Florida, 2023, then Ohio State, 2024 to 2026" } },
  "bg.hs": { known: "name hs rest", required: "name hs", sample: { name: NAME, hs: "St. Thomas Aquinas in Florida", rest: ", class of 2023" } },
  "bg.home": { known: "name home", required: "name home", sample: { name: NAME, home: "Fort Lauderdale, FL" } },
  "bg.years": { known: "name yr season ry", required: "name yr ry", sample: { name: NAME, yr: "third", season: 2026, ry: 2024 } },
  "board.top": { known: "one cls name school grade", required: "one name grade", sample: { one: "running back", cls: " in the 2027 class", name: NAME, school: "Florida State", grade: "an early first round" } },
  "accolades": { known: "name list more", required: "name list", sample: { name: NAME, list: "2025, First-Team All-ACC; 2024, Freshman All-American", more: "" } },
  "compare": { known: "when a b", required: "when a b", sample: { when: "In 2026", a: "Ousmane Kromah, 609 rushing yards", b: "Jesse Legree, 980 rushing yards" } },
  "note.saved": { known: "kind", required: "kind", sample: { kind: "Admin" } },
  "request.sent": { known: "", required: "", sample: {} },
  "suggestion.sent": { known: "", required: "", sample: {} },
  "readout.intro": { known: "date", required: "date", sample: { date: "November 24th" } },
  "readout.visitors": { known: "total nw ret acc", required: "total nw ret", sample: { total: "826", nw: "709", ret: "117", acc: ", with 7 signed-in accounts" } },
  "profile.measurement": { known: "name height weight pos", required: "name height weight", sample: { name: NAME, height: "6 foot 1", weight: "215 pounds", pos: "running back" } },
  "profile.measurement.again": { known: "height weight pos", required: "height weight", sample: { height: "6 foot 1", weight: "215 pounds", pos: "running back" } },
  "draft.projection": { known: "name projection cls", required: "name projection cls", sample: { name: NAME, projection: "in the second round", cls: "2028" } },
  "draft.projection.again": { known: "projection cls", required: "projection cls", sample: { projection: "in the second round", cls: "2028" } },
  "team.roster": { known: "team pos list", required: "team pos list", sample: { team: "Florida State", pos: "running back", list: "Ousmane Kromah, Sam Singleton and Jesse Legree", count: 3 } },
  "stat.career": { known: "name value stat", required: "name value", sample: { name: NAME, value: "2,140 rushing yards", stat: "rushing yards", verb: "has" } },
  "stat.career.again": { known: "value stat", required: "value", sample: { value: "2,140 rushing yards", stat: "rushing yards", verb: "has" } },
  "stat.seasonCompare": { known: "name value prev year prevYear dir", required: "name value prev year prevYear", sample: { name: NAME, value: "609 rushing yards", prev: "412 rushing yards", year: "2026", prevYear: "2025", dir: "up" } },
  "stat.seasonCompare.again": { known: "value prev year prevYear dir", required: "value prev year prevYear", sample: { value: "609 rushing yards", prev: "412 rushing yards", year: "2026", prevYear: "2025", dir: "up" } },
  "stat.bestSeason": { known: "name year value stat", required: "name year value", sample: { name: NAME, year: "2026", value: "1,100 rushing yards", stat: "rushing yards" } },
  "stat.bestSeason.again": { known: "year value stat", required: "year value", sample: { year: "2026", value: "1,100 rushing yards", stat: "rushing yards" } },
  "ack.saved": { known: "", required: "", sample: {} },
  "ack.done": { known: "", required: "", sample: {} },
  "ack.cancel": { known: "", required: "", sample: {} },
  "miss.player": { known: "said", required: "said", sample: { said: "joe smith" } },
  "miss.player.school": { known: "said school", required: "said school", sample: { said: "joe smith", school: "LSU" } },
  "miss.question": { known: "text", required: "text", sample: { text: "who won the heisman" } },
};

// The prompt's names for a few values → the names the code uses.
// Keys renamed since a paste: the old name's lines go to the new one.
const KEY_ALIAS = { "draft.one": "draft.history" };

const RENAME = {
  "stats.max": { span: "spanP", title: "titleS", date: "whenP" },
  "stats.max.again": { span: "spanP", title: "titleS", date: "whenP" },
  "draft.history": { pick: "pickP" },
};

// Style guide: words and marks that don't belong in a plain broadcaster's answer.
const BANNED = /\b(impressive|electric|elite|dominant|dominan\w*|stellar|explosive|breakout|standout|great question|sure thing|absolutely|amazing|incredible|awesome|wow|um|uh|literally|basically|honestly)\b|!/i;

// Read and left out, with the reason (keyed by the line as pasted).
export const REVIEWED_OUT = {
  "profile.intro": {
    "{name} plays {pos} at {school}, with the {cls} draft class ahead.": "\"draft class ahead\" is unclear",
  },
  "rank.top.position": {},
  "profile.big": {
    "He finished the season with substantial production.": "stiff",
    "His season included a high volume of production.": "stiff",
    "He recorded a large statistical total this year.": "stiff",
    "His numbers added up over the season.": "says nothing",
    "He finished with a high statistical output.": "stiff",
    "He recorded a sizable amount of production this season.": "stiff",
    "His season was marked by high statistical totals.": "stiff",
  },
  "season.QB": {
    "He completed the {year} season with {passYds} passing yards, {passTd} and {ints}.": "\"completed\" sounds like completions",
  },
  "season.DEF": {
    "In {year}, his defensive line was {line}.": "\"defensive line\" is a position",
  },
  "stat.one": {
    "{When}, {value} belonged to {name}.": "odd",
    "{value} came from {name} {when}.": "odd",
    "{name}'s numbers show {value} {when}.": "stiff",
    "{value} was the figure for {name} {when}.": "stiff",
  },
  "stat.change": {
    "That's a {dir} compared with {prev} in {prevYear}.": "\"a up\" — {dir} is up/down",
  },
  "stat.bestYet": {
    "It's his strongest statistical season so far.": "it's about one stat, not his whole season",
  },
  "stat.line": {
    "{name}'s season line {when} was {list}.": "{when} isn't always a season (\"against Ohio State\")",
    "For {name} {when}, the totals were {list}.": "the list has averages too, not only totals",
    "The totals for {name} {when} were {list}.": "the list has averages too, not only totals",
  },
  "stat.line.again": {
    "His season numbers {when}: {list}.": "{when} isn't always a season",
    "The totals {when}: {list}.": "the list has averages too, not only totals",
  },
  "stats.max": {
    "At {title} on {date}, {name} recorded {said}, his {what} {span}.": "\"At vs Alabama\"",
    "{name} reached {said} {title} on {date}, his {what} {span}.": "\"reached\" is wrong for a low (\"fewest\")",
  },
  "stats.max.again": {
    "At {title} on {date}, he recorded {said}, his {what} {span}.": "\"At vs Alabama\"",
  },
  "games.best": {
    "Start with {name}'s games from these dates. {list}.": "awkward",
    "These games show {name}'s season production. {list}.": "the games can span seasons",
  },
  "rank": {
    "His ranking is {parts}, according to We-Draft.com.": "no name on a first mention",
    "{name} holds a ranking of {parts}.": "\"a ranking of 12th overall\"",
  },
  "rank.grade": {
    "The community gives him {grade} pick.": "\"gives him a pick\"",
    "Community members place him at {grade} pick.": "\"at a … pick\"",
    "The community's grade puts him as {grade} pick.": "awkward",
  },
  "my.grade": {
    "Your grade for {name} is {g}.": "{g} already says \"grade\" (\"a second round grade\")",
    "You've graded {name} as {g}.": "{g} already says \"grade\"",
    "You currently have {name} at {g}.": "\"at a … grade\"",
    "You've placed {name} at {g}.": "\"at a … grade\"",
    "Your draft grade for {name} is {g}.": "{g} already says \"grade\"",
    "{name} holds a {g} on your board.": "\"a a second round grade\"",
  },
  "draft.history": {
    "The {year} draft selection was {name}, a {pos} from {school}, at {pick}.": "\"at first overall\"",
  },
  "suggest": {
    "Put {name} on your scouting list.": "sounds like the watchlist, which is a different command",
  },
  "ack.done": {
    "Task complete.": "robotic",
    "Completed successfully.": "robotic",
  },
  "ack.cancel": {
    "Your settings are unchanged.": "it's a player change, not settings",
    "I kept the original setting.": "it's a player change, not settings",
  },
  "miss.question": {
    "That answer isn't available yet for \"{text}\". I've saved the question so it can be added.": "awkward",
  },
};

// Lines that only fit some answers: a rate ("4.6 yards per carry") isn't a total.
const NOT_FOR_RATES = /\btotal|\btallied|\breached|\bcame away/i;
const FITS = {
  "stat.one": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.one.again": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.change": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.bestYet": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.career": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.career.again": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.seasonCompare": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.seasonCompare.again": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.bestSeason": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  "stat.bestSeason.again": (t, v) => !(v.rate && NOT_FOR_RATES.test(t)),
  // "Ousmane Kromah are among …": the plural wordings need two or more names.
  "team.roster": (t, v) => !(v.count === 1 && /\bare\b/.test(t)),
};

const lower1 = (s) => `${s[0].toLowerCase()}${s.slice(1)}`;
const upper1 = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);
const placeholders = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** A template filled from vars, or null when it needs a value that isn't there (or doesn't fit). */
export function fill(template, vars = {}, key = "") {
  if (FITS[key] && !FITS[key](template, vars)) return null;
  let missing = false;
  const value = (ph) => {
    const v = vars[lower1(ph)];
    if (v == null || v === "") { missing = true; return ""; }
    return /^[A-Z]/.test(ph) ? upper1(String(v)) : String(v);
  };
  // "a {pos}" → "an edge rusher" when the value starts with a vowel sound.
  const out = template
    .replace(/\b([Aa]) \{(\w+)\}/g, (m, a, ph) => {
      const v = value(ph);
      return `${/^[aeiou]/i.test(v) ? `${a}n` : a} ${v}`;
    })
    .replace(/\{(\w+)\}/g, (m, ph) => value(ph));
  return missing ? null : upper1(out.replace(/\s+/g, " ").trim());
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Which imported lines are used. Returns { kept: { key: [template] }, rejected: [{ key, text, reason }] }.
 * `book` is the phrasebook (its function wordings count as "already there").
 */
export function checkPhrases(raw, book = {}) {
  const kept = {};
  const rejected = [];
  const seenBy = {};
  for (const [rawKey, lines] of Object.entries(raw || {})) {
    const key = KEY_ALIAS[rawKey] || rawKey;
    const spec = SPEC[key];
    const no = (text, reason) => rejected.push({ key, text, reason });
    if (!spec || !book[key]) { (lines || []).forEach((t) => no(t, "unknown key")); continue; }
    const known = new Set(spec.known.split(" ").filter(Boolean));
    const required = spec.required.split(" ").filter(Boolean);
    const seen = seenBy[key] || (seenBy[key] = new Set((book[key] || []).filter((f) => typeof f === "function").map((f) => { try { return norm(f(spec.sample)); } catch { return ""; } }).filter(Boolean)));
    for (const text of lines || []) {
      if (typeof text !== "string" || !text.trim()) { no(text, "empty"); continue; }
      const out = REVIEWED_OUT[key]?.[text];
      if (out) { no(text, `reviewed: ${out}`); continue; }
      let t = text.trim();
      for (const [from, to] of Object.entries(RENAME[key] || {})) {
        t = t.replace(new RegExp(`\\{${from}\\}`, "g"), `{${to}}`).replace(new RegExp(`\\{${upper1(from)}\\}`, "g"), `{${upper1(to)}}`);
      }
      const phs = placeholders(t).map(lower1);
      const unknown = phs.filter((p) => !known.has(p));
      if (unknown.length) { no(text, `unknown value {${unknown.join("}, {")}}`); continue; }
      const absent = required.filter((r) => !phs.includes(r));
      if (absent.length) { no(text, `leaves out {${absent.join("}, {")}}`); continue; }
      const twice = phs.filter((p, i) => phs.indexOf(p) !== i);
      if (twice.length) { no(text, `says {${twice[0]}} twice`); continue; }
      const ban = t.replace(/\{\w+\}/g, "").match(BANNED);
      if (ban) { no(text, `style: "${ban[0]}"`); continue; }
      if (t.split(/\s+/).length > 25) { no(text, "over 25 words"); continue; }
      if (key === "name.ref") {
        // It's dropped in wherever the name goes ("…'s best game", "for …"): it has to end in his name and start with the school.
        if (!/\{name\}$/.test(t)) { no(text, "has to end with his name"); continue; }
        if (!/^\{(school|mascot|short)\}/.test(t)) { no(text, "has to start with the school (a lowercase position can't start a sentence)"); continue; }
        if (/\{mascot\}'s/.test(t)) { no(text, "\"Seminoles's\""); continue; }
      }
      if (/among \{pos\}/.test(t)) { no(text, "\"among running back\" — needs the plural"); continue; }
      const filled = fill(t, spec.sample, key);
      if (!filled) { no(text, "doesn't fill"); continue; }
      if (seen.has(norm(filled))) { no(text, "repeat"); continue; }
      seen.add(norm(filled));
      (kept[key] ||= []).push(t);
    }
  }
  return { kept, rejected };
}
