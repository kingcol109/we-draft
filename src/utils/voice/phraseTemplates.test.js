// The imported wordings (phrasesImported.json, ChatGPT, 2026-11-25): which
// lines are used, and that every one used still says the answer's facts.
import RAW from "./phrasesImported.json";
import { BOOK } from "./phrasebook";
import { phrase } from "./phrase";
import { checkPhrases, fill, SPEC } from "./phraseTemplates";

const { kept, rejected } = checkPhrases(RAW, BOOK);

test("report: what was kept and left out (printed with --verbose)", () => {
  const total = Object.values(RAW).reduce((n, l) => n + l.length, 0);
  const keptN = Object.values(kept).reduce((n, l) => n + l.length, 0);
  if (process.env.PHRASE_REPORT) {
    // eslint-disable-next-line no-console
    console.log(`${keptN} of ${total} kept\n${Object.entries(kept).map(([k, l]) => `  ${k}: ${l.length}`).join("\n")}\n\nLeft out:\n${rejected.map((r) => `  [${r.key}] ${r.text}\n      → ${r.reason}`).join("\n")}`);
  }
  expect(keptN + rejected.length).toBe(total);
  expect(keptN).toBeGreaterThan(200);
});

test("every key used is in the phrasebook, and the first wording is still the plain one", () => {
  Object.keys(kept).forEach((k) => {
    expect(BOOK[k]).toBeDefined();
    expect(typeof BOOK[k][0]).toBe("function");
  });
});

test("required facts: every kept line, filled with sample values, says each one", () => {
  Object.entries(kept).forEach(([key, lines]) => {
    const spec = SPEC[key];
    const must = spec.required.split(" ").filter(Boolean);
    lines.forEach((t) => {
      const out = fill(t, spec.sample, key);
      expect([key, t, out]).toEqual([key, t, expect.any(String)]);
      must.forEach((m) => expect([key, t, out.toLowerCase().includes(String(spec.sample[m]).toLowerCase())]).toEqual([key, t, true]));
      expect([key, t, out]).toEqual([key, t, expect.not.stringMatching(/\{|\}|undefined| {2}|\.\.|!/)]);
    });
  });
});

describe("filling a template", () => {
  test("values, {Capitalized}, a/an, and a capital first letter", () => {
    expect(fill("{When}, {name} had {value}.", { when: "in 2025", name: "X", value: "9 sacks" })).toBe("In 2025, X had 9 sacks.");
    expect(fill("{name}, a {pos} at {school}", { name: "X", pos: "edge rusher", school: "LSU" })).toBe("X, an edge rusher at LSU");
    expect(fill("{value} was his total {when}.", { value: "9 sacks", when: "in 2025" })).toBe("9 sacks was his total in 2025.");
    expect(fill("{date}, he had it.", { date: "september 12th" })).toBe("September 12th, he had it.");
  });
  test("an empty value skips the line; zero is a value", () => {
    expect(fill("{team} is {w} and {l}.", { team: "FSU", w: 0, l: 3 })).toBe("FSU is 0 and 3.");
    expect(fill("{team} is {w} and {l}, with {left} left.", { team: "FSU", w: 0, l: 3, left: "" })).toBeNull();
  });
  test("a rate (yards per carry) never gets a 'total' wording", () => {
    const lines = BOOK["stat.one"].filter((t) => typeof t === "string" && /total|tallied|reached/.test(t));
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((t) => expect(fill(t, { name: "X", value: "4.6 yards per carry", when: "in 2025", rate: true }, "stat.one")).toBeNull());
  });
});

test("the prompt's {span}/{title}/{date}/{pick} are the code's spanP/titleS/whenP/pickP", () => {
  expect(kept["stats.max"].every((t) => !/\{(span|title|date|Date)\}/.test(t))).toBe(true);
  expect(kept["draft.history"].every((t) => !/\{pick\}/.test(t))).toBe(true);
});

test("checks catch the bad ones", () => {
  const { kept: k, rejected: r } = checkPhrases({
    "name.ref": ["{name}, the {school} {pos}", "{pos} {name} at {school}", "{mascot}'s {pos} {name}", "{school}'s {pos} {name}"],
    "team.last.win": ["They beat {opp} {score} {at} {opp}."],
    "stat.one": ["{name} had an elite {value} {when}!", "{name} had {value} {when} for {team}."],
    "my.grade": ["{name} holds a {g} on your board."],
    "nope": ["x"],
  }, BOOK);
  expect(k["name.ref"]).toEqual(["{school}'s {pos} {name}"]);
  expect(r.map((x) => x.reason)).toEqual([
    "has to end with his name",
    "has to end with his name",
    "\"Seminoles's\"",
    "says {opp} twice",
    "style: \"elite\"",
    "unknown value {team}",
    "reviewed: \"a a second round grade\"",
    "unknown key",
  ]);
});

test("a varied answer can come from an imported line", () => {
  const ctx = { vary: true, memory: {}, random: () => 0.999 };
  const out = phrase(ctx, "suggest", { name: "Ousmane Kromah" });
  expect(out).toBe(fill(BOOK.suggest[BOOK.suggest.length - 1], { name: "Ousmane Kromah" }));
});
