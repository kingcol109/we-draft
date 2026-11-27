import { answerAsk, learnPhrase, nameScore, parseVoice, soundKey } from "./voice";
import { forSide, sideOf } from "./data";

const P = (key, name, team, jersey, focus = false) => ({ key, name, team, jersey, focus });
const people = [
  P("k", "Ousmane Kromah", "Florida State", 22, true),
  P("c", "Tommy Castellanos", "Florida State", 2, true),
  P("r", "Duce Robinson", "Florida State", 0, true),
  P("p", "T.J. Parker", "Clemson", 11),
  P("w", "Peter Woods", "Clemson", 11),
  P("s", "Samuel Singleton Jr", "Florida State", 24),
  P("b", "Sammy Brown", "Clemson", 1),
];

describe("voice tagging", () => {
  test("names, said plainly", () => {
    expect(parseVoice("Kromah Castellanos and Robinson", people).add).toEqual(["k", "c", "r"]);
    expect(parseVoice("Ousmane Kromah", people).add).toEqual(["k"]);
  });
  test("mishearings still land on the right player", () => {
    expect(parseVoice("chroma", people).add).toEqual(["k"]);
    expect(parseVoice("castle llanos", people).add).toEqual(["c"]);
    expect(parseVoice("Single ton", people).add).toEqual(["s"]);
    expect(soundKey("Kromah")).toBe(soundKey("Croma"));
  });
  test("jersey numbers, the team breaking a tie", () => {
    expect(parseVoice("number twenty two", people).add).toEqual(["k"]);
    const two = parseVoice("number 11 Clemson", people).heard[0]; // two Clemson 11s
    expect(two.key).toBeNull();
    expect(two.options.sort()).toEqual(["p", "w"]);
    expect(parseVoice("number one", people).add).toEqual(["b"]);
  });
  test("remove", () => {
    const r = parseVoice("remove Kromah add Robinson", people);
    expect(r.remove).toEqual(["k"]);
    expect(r.add).toEqual(["r"]);
  });
  test("a taught correction wins", () => {
    expect(parseVoice("dukes", people, { dukes: "r" }).add).toEqual(["r"]);
  });
  const RB = ["Contact Balance", "Vision", "Patience", "Receiving Ability", "Elusiveness", "Pass Protection", "Burst", "Ball Security", "Acceleration", "Change of Direction", "Explosiveness", "Play Strength"];
  const QB = ["Accuracy", "Anticipation", "Arm Strength", "Ball Placement", "Pocket Presence", "Change of Direction", "Explosiveness"];
  const traitsOf = (k) => (k === "k" ? RB : k === "c" ? QB : []);
  test("a label after a name", () => {
    const r = parseVoice("Kromah great Castellanos very bad", people, {}, { traitsOf });
    expect(r.add).toEqual(["k", "c"]);
    expect(r.labels).toEqual({ k: "Great", c: "Very bad" });
  });
  test("traits after a name — his list only, multi-word, misheard", () => {
    const r = parseVoice("Kromah good vision patience ball security", people, {}, { traitsOf });
    expect(r.labels).toEqual({ k: "Good" });
    expect(r.traits.k).toEqual(["Vision", "Patience", "Ball Security"]);
    expect(parseVoice("Kromah elusive ness", people, {}, { traitsOf }).traits.k).toEqual(["Elusiveness"]);
    expect(parseVoice("Castellanos arm strength", people, {}, { traitsOf }).traits.c).toEqual(["Arm Strength"]);
    // A QB trait isn't a running back's.
    expect(parseVoice("Kromah arm strength", people, {}, { traitsOf }).traits.k).toBeUndefined();
  });
  test("each player's own label and traits", () => {
    const r = parseVoice("Kromah great burst Castellanos okay anticipation", people, {}, { traitsOf });
    expect(r.labels).toEqual({ k: "Great", c: "Okay" });
    expect(r.traits).toEqual({ k: ["Burst"], c: ["Anticipation"] });
  });
  test("no name: the play's only player", () => {
    const r = parseVoice("great vision", people, {}, { traitsOf, sole: "k" });
    expect(r.labels).toEqual({ k: "Great" });
    expect(r.traits).toEqual({ k: ["Vision"] });
    expect(parseVoice("great", people, {}, { traitsOf }).labels).toEqual({});
  });
  test("name → label → trait, each part optional", () => {
    const go = (t) => parseVoice(t, people, {}, { traitsOf });
    expect(go("Kromah")).toMatchObject({ add: ["k"], labels: {}, traits: {} });
    expect(go("Kromah great")).toMatchObject({ add: ["k"], labels: { k: "Great" }, traits: {} });
    expect(go("Kromah vision")).toMatchObject({ add: ["k"], labels: {}, traits: { k: ["Vision"] } });
    expect(go("Kromah great vision")).toMatchObject({ add: ["k"], labels: { k: "Great" }, traits: { k: ["Vision"] } });
    // Two players, only one with a label.
    expect(go("Kromah vision Castellanos")).toMatchObject({ add: ["k", "c"], labels: {}, traits: { k: ["Vision"] } });
  });
  test("a pause splits it into two phrases: the label still goes to the last player named", () => {
    const first = parseVoice("Castellanos", people, {}, { traitsOf });
    const second = parseVoice("good arm strength", people, {}, { traitsOf, current: first.last });
    expect(second.labels).toEqual({ c: "Good" });
    expect(second.traits).toEqual({ c: ["Arm Strength"] });
  });
  test("a last name: the player being watched comes before the rosters", () => {
    const crowd = [
      P("s", "Samuel Singleton Jr", "Florida State", 24, true),
      P("ks", "Keshaun Singleton", "Clemson", 4),
      P("ds", "Dante Singleton", "Florida State", 30),
      P("k", "Ousmane Kromah", "Florida State", 22, true),
      P("kr", "Kalen Kromer", "Clemson", 9),
    ];
    expect(parseVoice("Singleton", crowd).add).toEqual(["s"]);
    expect(parseVoice("Singleton great", crowd).labels).toEqual({ s: "Great" });
    // A sound-alike goes to the watched player too.
    expect(parseVoice("chroma", crowd).add).toEqual(["k"]);
    // A full name still reaches a roster player.
    expect(parseVoice("Keshaun Singleton", crowd).add).toEqual(["ks"]);
    // Nobody watched fits: the rosters.
    expect(parseVoice("Kromer", crowd).add).toEqual(["kr"]);
    // Not watching anyone: same-name players are a tie, not a guess.
    const tie = parseVoice("Singleton", crowd.map((p) => ({ ...p, focus: false })));
    expect(tie.add).toEqual([]);
    expect(tie.heard[0]).toMatchObject({ phrase: "singleton", how: "which one?" });
    expect(tie.heard[0].options.sort()).toEqual(["ds", "ks", "s"]);
  });
  test("nothing close: reported, not guessed", () => {
    const r = parseVoice("banana", people);
    expect(r.add).toEqual([]);
    expect(r.heard[0]).toMatchObject({ phrase: "banana", key: null, how: "no match" });
    // …and no question: a stray word that names no one isn't asked about (2026-11-25).
    expect(r.heard[0].options).toEqual([]);
  });
});

test("a trait answers to its last word when it's the only one ending that way", () => {
  const me = { key: "wd_1", name: "Ousmane Kromah", pos: "RB", team: "Florida State", focus: true };
  const o = { traitsOf: () => ["Lateral Agility", "Vision", "Ball Security", "Contact Balance", "Play Speed", "Long Speed", "Play Strength"], sole: me.key, current: me.key };
  expect(parseVoice("good agility", [me], {}, o).traits[me.key]).toEqual(["Lateral Agility"]);
  expect(parseVoice("agility", [me], {}, o).traits[me.key]).toEqual(["Lateral Agility"]);
  expect(parseVoice("balance", [me], {}, o).traits[me.key]).toEqual(["Contact Balance"]);
  expect(parseVoice("speed", [me], {}, o).traits[me.key]).toBeUndefined(); // two traits end in speed
  expect(parseVoice("arm strength", [me], {}, o).traits[me.key]).toBeUndefined(); // not Play Strength
});

describe("voice: names stop at a label; spoken answers (2026-11-25)", () => {
  const people = [
    { key: "po", name: "Patrick Overmyer", team: "Alabama", jersey: 12, focus: true },
    { key: "ps", name: "Peter Smith", team: "Alabama", jersey: 4 },
    { key: "kh", name: "Keisean Henderson", team: "Houston", jersey: 2, focus: true },
  ];
  test("“patrick overmyer bad” — the label isn't swallowed by the name", () => {
    const out = parseVoice("patrick overmyer bad", people);
    expect(out.add).toEqual(["po"]);
    expect(out.labels).toEqual({ po: "Bad" });
  });
  test("“badge” is bad", () => {
    expect(parseVoice("henderson badge", people).labels).toEqual({ kh: "Bad" });
  });
  test("a label alone goes to the sole featured player", () => {
    expect(parseVoice("good", people, {}, { sole: "kh" }).labels).toEqual({ kh: "Good" });
  });
  test("answering out loud", () => {
    const opts = ["po", "ps"];
    expect(answerAsk("patrick", opts, people)).toBe("po");
    expect(answerAsk("the second one", opts, people)).toBe("ps");
    expect(answerAsk("number four", opts, people)).toBe("ps");
    expect(answerAsk("skip it", opts, people)).toBe("skip");
    expect(answerAsk("yes", ["po"], people)).toBe("po");
    expect(answerAsk("great vision", opts, people)).toBe(null);
  });
});

// "Say his name" after a click-tag (user, 2026-11-26).
describe("learning a name", () => {
  test("lead-ins and filler drop out; too long is no name", () => {
    expect(learnPhrase("Chroma")).toBe("chroma");
    expect(learnPhrase("his name is Ooze Mon Chroma")).toBe("ooze mon chroma");
    expect(learnPhrase("that's Crow Ma")).toBe("crow ma");
    expect(learnPhrase("um")).toBe(null);
    expect(learnPhrase("he made a really nice cut on that one")).toBe(null);
  });
  test("a taught word works next time, and sound-alikes of it too", () => {
    const aliases = { "crow ma": "k" };
    expect(parseVoice("crow ma", people, aliases).add).toEqual(["k"]);
    expect(parseVoice("crowma", people, aliases).add).toEqual(["k"]);
  });
  test("nameScore says when it already knows the name", () => {
    expect(nameScore("kromah", people[0])).toBeGreaterThanOrEqual(0.97);
    expect(nameScore("zzz", people[0])).toBeLessThan(0.5);
  });
});

// One side of the ball per team (user, 2026-11-26): no two #50s.
describe("rosters by side", () => {
  test("offense keeps offense + specialists, defense keeps defense, ATH/unknown stay", () => {
    expect(sideOf("OT")).toBe("offense");
    expect(sideOf("EDGE")).toBe("defense");
    expect(sideOf("ATH")).toBe(null);
    const r = [{ key: 1, pos: "C" }, { key: 2, pos: "DT" }, { key: 3, pos: "ATH" }, { key: 4, pos: "P" }, { key: 5, pos: "" }];
    expect(forSide(r, "offense").map((p) => p.key)).toEqual([1, 3, 4, 5]);
    expect(forSide(r, "defense").map((p) => p.key)).toEqual([2, 3, 5]);
  });
});

// "pin 50 cincinnati" resolves through parseVoice as "number 50 cincinnati" (user, 2026-11-26).
describe("number + team", () => {
  test("the team word picks the one wearing it", () => {
    const ppl = [P("a", "Jake Ohio", "Cincinnati", 50), P("b", "Sam Other", "Houston", 50)];
    const out = parseVoice("number 50 cincinnati", ppl, {});
    expect(out.add).toEqual(["a"]);
    expect(out.heard[0].how).toBe("number");
    expect(parseVoice("fifty cincinnati", ppl, {}).add).toEqual(["a"]);
  });
});

// One name said → one player (user, 2026-11-26: "Evan Tengesdahl neutral" also added Makhi Boone).
describe("one name, one player", () => {
  const ppl = [P("evan", "Evan Tengesdahl", "Cincinnati", 50, true), P("boone", "Makhi Boone", "West Virginia", 26), P("cas", "Carsten Casady", "West Virginia", 79)];
  test("a misheard tail is the rest of his name, not a second player — and asks nothing", () => {
    for (const said of ["evan ten guess doll neutral", "evan tangles dollar neutral", "evan ten boon neutral", "Evan Tang is all neutral"]) {
      const out = parseVoice(said, ppl, {});
      expect(out.add).toEqual(["evan"]);
      expect(out.labels).toEqual({ evan: "Neutral" });
      expect(out.heard.filter((h) => !h.key && h.options?.length)).toEqual([]);
    }
  });
  test("two real names still tag two", () => {
    expect(parseVoice("Tengesdahl and Boone", ppl, {}).add).toEqual(["evan", "boone"]);
  });
  test("a question isn't answered by a sentence that names someone else, or by 'to' / 'one'", () => {
    expect(answerAsk("evan tengesdahl neutral", ["boone", "cas"], ppl)).toBe(null);
    expect(answerAsk("go back to him one more time", ["boone", "cas"], ppl)).toBe(null);
    expect(answerAsk("the second one", ["boone", "cas"], ppl)).toBe("cas");
    expect(answerAsk("boone", ["boone", "cas"], ppl, true)).toEqual({ key: "boone", by: "name" });
    expect(answerAsk("first", ["boone", "cas"], ppl, true)).toEqual({ key: "boone", by: "order" });
  });
});
