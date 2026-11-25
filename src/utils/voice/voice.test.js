import { parseNumber, parseHeight } from "./text";
import { findPlayer } from "./names";
import { understand, respond, newState } from "./engine";
import { INTENTS } from "./intents";

const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "j1", first: "Jeremiah", last: "Smith", pos: "WR", school: "Ohio State", cls: "2027" },
  { id: "j2", first: "Jaylen", last: "Smith", pos: "CB", school: "LSU", cls: "2027" },
  { id: "s", first: "Samuel", last: "Singleton Jr", pos: "RB", school: "Florida State", cls: "2028" },
];
const docs = { k: { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Height: "6'0\"", Weight: "212", Slug: "ousmane-kromah" } };
const fakeCtx = () => {
  const writes = [];
  return {
    writes,
    people: async () => people,
    player: async (id) => docs[id] || { id, First: people.find((p) => p.id === id)?.first, Last: people.find((p) => p.id === id)?.last },
    setPlayer: async (id, patch) => { writes.push([id, patch]); },
    filmPlays: async () => [
      { gameId: "a", players: { wd_k: { label: "Great" } } },
      { gameId: "a", players: { wd_k: { label: "" } } },
      { gameId: "b", players: { wd_k: { label: "Bad", wash: { keys: [{}] } } } },
    ],
  };
};

describe("numbers and heights, said every way", () => {
  test("numbers", () => {
    expect(parseNumber("225")).toBe(225);
    expect(parseNumber("two twenty five")).toBe(225);
    expect(parseNumber("two hundred twenty five")).toBe(225);
    expect(parseNumber("two hundred and five")).toBe(205);
    expect(parseNumber("four point four five")).toBe(4.45);
    expect(parseNumber("banana")).toBeNull();
  });
  test("heights", () => {
    expect(parseHeight("six one").text).toBe("6'1\"");
    expect(parseHeight("6 foot 1").text).toBe("6'1\"");
    expect(parseHeight("6'1").text).toBe("6'1\"");
    expect(parseHeight("six foot one and a half").text).toBe("6'1 1/2\"");
    expect(parseHeight("73 inches").text).toBe("6'1\"");
    expect(parseHeight("six feet").text).toBe("6'0\"");
    expect(parseHeight("225")).toBeNull();
  });
});

describe("names", () => {
  test("misheard names land", () => {
    expect(findPlayer("usman chroma", people).player.id).toBe("k");
    expect(findPlayer("kromah", people).player.id).toBe("k");
    expect(findPlayer("singleton", people).player.id).toBe("s");
  });
  test("a tie is a question, not a guess", () => {
    expect(findPlayer("smith", people).choices.map((p) => p.id).sort()).toEqual(["j1", "j2"]);
    expect(findPlayer("jeremiah smith", people).player.id).toBe("j1");
  });
  test("school first is the sure way", () => {
    expect(findPlayer("florida state's ousmane kromah", people)).toMatchObject({ player: { id: "k" }, school: "Florida State" });
    expect(findPlayer("ohio state's smith", people).player.id).toBe("j1");
    expect(findPlayer("lsu's smith", people).player.id).toBe("j2");
    expect(findPlayer("fsu's kromah", people).player.id).toBe("k");
    expect(findPlayer("smith from ohio state", people).player.id).toBe("j1");
    expect(findPlayer("smith at lsu", people).player.id).toBe("j2");
    // A looser name holds up when the school narrows it.
    expect(findPlayer("florida state's q kromah", people).player.id).toBe("k");
    // Nobody by that name there.
    expect(findPlayer("lsu's kromah", people)).toMatchObject({ none: true, school: "LSU" });
  });
  test("nothing close", () => {
    expect(findPlayer("banana", people).none).toBe(true);
  });
});

describe("understanding", () => {
  test("every example matches its own intent", () => {
    INTENTS.forEach((i) => i.examples.forEach((e) => expect(understand(e, "admin")?.intent?.id).toBe(i.id)));
  });
  test("admin commands only on the admin version", () => {
    expect(understand("change Kromah's weight to 225", "general").wrongMode.id).toBe("player.set");
  });
  test("slots", () => {
    expect(understand("hey we draft can you change usman chroma's height to 225 pounds", "admin").slots).toMatchObject({ who: "usman chroma", field: "height", value: "225 pounds" });
    expect(understand("how tall is Kromah", "general").slots).toMatchObject({ who: "kromah", field: "height" });
  });
});

describe("conversations", () => {
  test("a write asks first, says what's changing, and the value fixes the field", async () => {
    const ctx = fakeCtx();
    let out = await respond("change Usman Chroma's height to 225 pounds", newState("admin"), ctx);
    expect(out.reply.confirm).toBe(true);
    expect(out.reply.say).toMatch(/weight from 212 pounds to 225 pounds/);
    expect(ctx.writes).toEqual([]);
    out = await respond("yes", out.state, ctx);
    expect(ctx.writes).toEqual([["k", { Weight: "225" }]]);
    expect(out.reply.tone).toBe("done");
  });
  test("no cancels", async () => {
    const ctx = fakeCtx();
    let out = await respond("set kromah's height to six one", newState("admin"), ctx);
    expect(out.reply.say).toMatch(/height from 6 foot 0 to 6 foot 1/);
    out = await respond("no", out.state, ctx);
    expect(ctx.writes).toEqual([]);
  });
  test("which one → the second one", async () => {
    const ctx = fakeCtx();
    let out = await respond("who is smith", newState(), ctx);
    expect(out.reply.choices).toHaveLength(2);
    out = await respond("the second one", out.state, ctx);
    expect(out.reply.title).toMatch(/Smith/);
  });
  test("his / him is the last player", async () => {
    const ctx = fakeCtx();
    let out = await respond("tell me about kromah", newState(), ctx);
    out = await respond("what's his weight", out.state, ctx);
    expect(out.reply.say).toBe("Ousmane Kromah: 212 pounds.");
  });
  test("film count", async () => {
    const out = await respond("how many plays do I have for Kromah", newState("admin"), fakeCtx());
    expect(out.reply.say).toBe("Ousmane Kromah has 3 plays from 2 games. 2 labeled.");
  });
  test("a near-miss still lands; nothing close is a miss", async () => {
    const ctx = fakeCtx();
    expect((await respond("who is kroma", newState(), ctx)).reply.title).toBe("Ousmane Kromah");
    expect((await respond("who is ozzie", newState(), ctx)).reply.tone).toBe("miss");
  });
});

// ── Stats, ranks, evaluations, misses ──
const game = (id, season, week, opp, abbr, car, yds, td, rec = 0, ryds = 0) => ({
  id, season, week, at: "vs", opp, oppAbbr: abbr, result: "W", score: "31-17", date: `${season}-09-${String(week).padStart(2, "0")}`,
  line: { rushing: { rushingAttempts: car, rushingYards: yds, rushingTouchdowns: td }, receiving: { receptions: rec, receivingYards: ryds, receivingTouchdowns: 0 } },
});
const GAMES = [
  game("g1", "2025", 1, "Alabama Crimson Tide", "ALA", 10, 50, 0),
  game("g2", "2025", 2, "Ohio State Buckeyes", "OSU", 20, 160, 2, 3, 30),
  game("g3", "2025", 3, "Ohio Bobcats", "OHIO", 15, 90, 1),
  game("g4", "2026", 1, "LSU Tigers", "LSU", 10, 30, 0),
];
const richCtx = (over = {}) => {
  const base = fakeCtx();
  const logged = [];
  const saved = [];
  let mine = null;
  return {
    ...base, logged, saved, uid: "me",
    seasons: async () => ({
      years: ["2025", "2026"],
      seasons: { 2025: { rushing: { rushingAttempts: 45, rushingYards: 300, rushingTouchdowns: 3 }, receiving: { receptions: 3, receivingYards: 30 } }, 2026: { rushing: { rushingAttempts: 10, rushingYards: 30, rushingTouchdowns: 0 } } },
      career: { rushing: { rushingAttempts: 55, rushingYards: 330, rushingTouchdowns: 3 } },
    }),
    games: async (_p, years) => GAMES.filter((g) => !years || years.includes(g.season)),
    ranks: async () => ({ classRank: 12, positionRank: 2, classSize: 300, grade: "Second Round" }),
    publicEvals: async () => ({ count: 3, list: [{ author: "Scout1", verified: true, grade: "Second Round", evaluation: "Patient runner." }, { author: "Fan2", evaluation: "Fast." }] }),
    traits: async () => ["Vision", "Burst", "Ball Security", "Patience"],
    gradeLocked: () => false,
    myEval: async () => mine,
    saveMyEval: async (_d, next) => { saved.push(next); mine = next; },
    logMiss: (e) => { logged.push(e); },
    ...over,
  };
};

describe("stats", () => {
  test("a season line (the latest by default)", async () => {
    const out = await respond("what are kromah's stats", newState(), richCtx());
    expect(out.reply.say).toMatch(/^Ousmane Kromah, 2026: 10 carries, 30 rushing yards, 3\.0 yards per carry/);
  });
  test("one stat, a season said", async () => {
    expect((await respond("how many rushing yards did kromah have in 2025", newState(), richCtx())).reply.say).toBe("Ousmane Kromah: 300 rushing yards, 2025.");
    expect((await respond("kromah's career rushing yards", newState(), richCtx())).reply.say).toBe("Ousmane Kromah has 330 rushing yards in his career.");
    expect((await respond("kromah's 2025 rushing yards", newState(), richCtx())).reply.say).toBe("Ousmane Kromah: 300 rushing yards, 2025.");
  });
  test("YPC vs Ohio State and LSU: yards over carries across those games", async () => {
    const out = await respond("what was kromah's yards per carry against ohio state and lsu", newState(), richCtx());
    expect(out.reply.say).toBe("Ousmane Kromah: 6.3 yards per carry, vs Ohio State Buckeyes and LSU Tigers (2 games).");
    // On screen: the stat, the rest of its line (carries, yards, touchdowns), then each game.
    expect(out.reply.rows.map((r) => r[0])).toEqual(["yards per carry · vs Ohio State Buckeyes and LSU Tigers (2 games)", "carries", "rushing yards", "rushing touchdowns", "Sep 1, 2025 vs Ohio State Buckeyes", "Aug 31, 2026 vs LSU Tigers"]);
    // "ohio" is the Bobcats, not Ohio State.
    expect((await respond("kromah's rushing yards vs ohio", newState(), richCtx())).reply.say).toMatch(/90 rushing yards/);
  });
  test("an opponent he never played is a logged gap", async () => {
    const ctx = richCtx();
    const out = await respond("kromah's rushing yards against michigan", newState(), ctx);
    expect(out.reply.tone).toBe("miss");
    expect(ctx.logged[0]).toMatchObject({ reason: "no-opponent" });
  });
  test("best games to watch", async () => {
    const out = await respond("what are some good games to watch for kromah", newState(), richCtx());
    expect(out.reply.rows[0][0]).toMatch(/vs Ohio State Buckeyes/);
  });
  test("how did he do against a team", async () => {
    expect((await respond("how did kromah do against alabama", newState(), richCtx())).reply.say).toMatch(/Alabama.*10 carries, 50 rushing yards/);
  });
});

describe("rank and evaluations", () => {
  test("rank", async () => {
    expect((await respond("where does kromah rank", newState(), richCtx())).reply.say).toBe("Ousmane Kromah is 12th overall in the 2028 class of 300, and 2nd among running backs. Community grade: Second Round.");
  });
  test("public evaluations, then next", async () => {
    const ctx = richCtx();
    let out = await respond("read me evaluations of kromah", newState(), ctx);
    expect(out.reply.say).toMatch(/^2 public evaluations of Ousmane Kromah\. From Scout1, verified\. Grade: Second Round\. Patient runner\./);
    out = await respond("next", out.state, ctx);
    expect(out.reply.say).toMatch(/^From Fan2\. Fast\.$/);
  });
  test("grade a player: asks, then saves", async () => {
    const ctx = richCtx();
    let out = await respond("give kromah a second round grade", newState(), ctx);
    expect(out.reply.say).toMatch(/Set your grade on Ousmane Kromah to Second Round\?/);
    out = await respond("yes", out.state, ctx);
    expect(ctx.saved[0]).toMatchObject({ grade: "Second Round" });
    expect((await respond("i have kromah as a late first", newState(), ctx)).reply.say).toMatch(/Late First Round \(was Second Round\)/);
    expect((await respond("give kromah a first round grade", newState(), ctx)).reply.say).toBe("Early, middle or late first round?");
  });
  test("strengths, weaknesses and the lists' rules", async () => {
    const ctx = richCtx();
    let out = await respond("add vision and burst to kromah's strengths", newState(), ctx);
    out = await respond("yes", out.state, ctx);
    expect(ctx.saved[0].strengths).toEqual(["Vision", "Burst"]);
    out = await respond("add vision as a weakness for kromah", newState(), ctx);
    expect(out.reply.say).toMatch(/takes Vision off your strengths/);
    out = await respond("yes", out.state, ctx);
    expect(ctx.saved[1]).toMatchObject({ strengths: ["Burst"], weaknesses: ["Vision"] });
    expect((await respond("add arm strength to kromah's strengths", newState(), ctx)).reply.tone).toBe("miss");
  });
  test("NFL fit", async () => {
    const ctx = richCtx();
    expect((await respond("set my nfl fit for kromah to the jets", newState(), ctx)).reply.say).toMatch(/New York Jets/);
    expect((await respond("kromah fits with the niners", newState(), ctx)).reply.say).toMatch(/San Francisco 49ers/);
  });
  test("your own evaluation needs a sign-in", async () => {
    expect((await respond("give kromah a second round grade", newState(), richCtx({ uid: null }))).reply.say).toMatch(/Sign in first/);
  });
});

describe("misses are logged", () => {
  test("a sentence it doesn't understand", async () => {
    const ctx = richCtx();
    await respond("what's the weather like", newState(), ctx);
    expect(ctx.logged[0]).toMatchObject({ text: "what's the weather like", reason: "not-understood" });
  });
  test("a name it doesn't know", async () => {
    const ctx = richCtx();
    await respond("tell me about zzyzx", newState(), ctx);
    expect(ctx.logged[0]).toMatchObject({ reason: "unknown-player", said: "zzyzx" });
  });
});

test("a two-word name in a grade command isn't cut short", () => {
  const { understand } = require("./engine");
  expect(understand("give ousmane kromah a second round grade", "general").slots).toEqual(expect.objectContaining({ who: "ousmane kromah", grade: "second round" }));
  expect(understand("give ousmane kromah early first", "general").slots).toEqual(expect.objectContaining({ who: "ousmane kromah", grade: "early first" }));
});
