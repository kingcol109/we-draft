// Template expansion (user, 2026-11-25): measurements, projection, a school's
// players at a position, career / season-vs-season / best season, follow-ups,
// the full line on screen, and nothing made up when data is missing.
import { respond, newState } from "./engine";
import { projectionOf } from "./intentsFacts";

const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "s", first: "Sam", last: "Singleton", pos: "RB", school: "Florida State", cls: "2027" },
  { id: "q", first: "Tommy", last: "Castellanos", pos: "QB", school: "Florida State", cls: "2027" },
  { id: "b", first: "Blake", last: "Lone", pos: "RB", school: "Boise State", cls: "2028" },
];
const PLAYERS = {
  k: { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Height: "6'1\"", Weight: "215" },
  s: { id: "s", First: "Sam", Last: "Singleton", Position: "RB", School: "Florida State", Eligible: "2027", Height: "5'11\"" },
  q: { id: "q", First: "Tommy", Last: "Castellanos", Position: "QB", School: "Florida State", Eligible: "2027" },
  b: { id: "b", First: "Blake", Last: "Lone", Position: "RB", School: "Boise State", Eligible: "2028" },
};
const SEASONS = {
  k: {
    years: ["2024", "2025", "2026"],
    seasons: {
      2024: { rushing: { rushingAttempts: 4, rushingYards: 40, rushingTouchdowns: 1 } },
      2025: { rushing: { rushingAttempts: 80, rushingYards: 412, rushingTouchdowns: 3 } },
      2026: { rushing: { rushingAttempts: 114, rushingYards: 609, rushingTouchdowns: 5 }, receiving: { receptions: 11, receivingYards: 97 } },
    },
    career: { rushing: { rushingAttempts: 198, rushingYards: 1061, rushingTouchdowns: 9 } },
  },
  s: { years: ["2026"], seasons: { 2026: { rushing: { rushingAttempts: 50, rushingYards: 250 } } }, career: {} },
};
const ctxOf = (over = {}) => {
  const logged = [];
  return {
    logged,
    uid: null,
    people: async () => people,
    player: async (id) => PLAYERS[id] || null,
    seasons: async (d) => SEASONS[d.id] || null,
    games: async () => [],
    ranks: async (d) => (d.id === "k" ? { classRank: 12, positionRank: 2, grade: "Second Round" } : d.id === "s" ? { classRank: 40, positionRank: 5, grade: "UDFA" } : null),
    classList: async (cls) => (cls === "2027" ? [{ id: "s", classRank: 40 }] : [{ id: "k", classRank: 12 }]),
    logMiss: (e) => logged.push(e),
    ...over,
  };
};
const say = async (text, ctx = ctxOf(), state = newState()) => (await respond(text, state, ctx)).reply.say;

describe("measurements", () => {
  test("height and weight", async () => {
    expect(await say("how big is kromah")).toBe("Ousmane Kromah is listed at 6 foot 1 and 215 pounds.");
    expect(await say("what are kromah's measurements")).toBe("Ousmane Kromah is listed at 6 foot 1 and 215 pounds.");
  });
  test("one missing: says what's there, never a made-up number", async () => {
    const ctx = ctxOf();
    expect(await say("sam singleton's height and weight", ctx)).toBe("Sam Singleton is listed at 5 foot 11. I don't have his weight.");
    expect(ctx.logged.map((l) => l.reason)).toEqual(["no-weight"]);
    expect(await say("how big is tommy castellanos")).toBe("I don't have a height or weight for Tommy Castellanos.");
  });
});

describe("draft projection", () => {
  test("the community grade, said as a round", async () => {
    expect(await say("where is kromah projected")).toBe("The community projects Ousmane Kromah to go in the second round in the 2028 draft.");
    expect(await say("what's kromah's draft projection")).toBe("The community projects Ousmane Kromah to go in the second round in the 2028 draft.");
    expect(projectionOf("Early First Round")).toBe("early in the first round");
    expect(projectionOf("Middle First Round")).toBe("in the middle of the first round");
    expect(projectionOf("UDFA")).toBe("");
  });
  test("UDFA and no grade", async () => {
    expect(await say("where will sam singleton get drafted")).toBe("The community has Sam Singleton as an undrafted free agent in the 2027 class.");
    const ctx = ctxOf();
    expect(await say("where is tommy castellanos projected", ctx)).toBe("There's no community projection for Tommy Castellanos yet.");
    expect(ctx.logged[0].reason).toBe("no-projection");
  });
});

describe("a school's players at a position", () => {
  test("from the board, earliest class first", async () => {
    const out = await respond("who plays running back for florida state", newState(), ctxOf());
    expect(out.reply.say).toBe("Florida State has Sam Singleton and Ousmane Kromah at running back.");
    expect(out.reply.rows).toEqual([["Sam Singleton", "2027 class · #40 in class"], ["Ousmane Kromah", "2028 class · #12 in class"]]);
    expect(await say("fsu's quarterbacks")).toBe("Florida State has Tommy Castellanos at quarterback.");
    expect(await say("what running backs does boise state have")).toBe("Boise State has Blake Lone at running back.");
  });
  test("nobody there; draft-history lists still go to the draft", async () => {
    expect(await say("florida state's tight ends")).toBe("I don't have any Florida State tight ends on the board.");
    const out = await respond("all lsu second round quarterbacks", newState(), ctxOf({ draftHistory: async () => [] }));
    expect(out.reply.intent).not.toBe("team.roster");
  });
});

describe("career, season against season, best season", () => {
  test("career", async () => {
    expect(await say("how many career rushing yards does kromah have")).toBe("Ousmane Kromah has 1,061 rushing yards in his career.");
  });
  test("season against season: the latest against the one before, or the two said", async () => {
    expect(await say("compare kromah's rushing yards")).toBe("Ousmane Kromah had 609 rushing yards in 2026, up from 412 rushing yards in 2025.");
    expect(await say("compare kromah's rushing yards in 2025 to 2024")).toBe("Ousmane Kromah had 412 rushing yards in 2025, up from 40 rushing yards in 2024.");
    const out = await respond("are kromah's rushing yards up from 2025", newState(), ctxOf());
    expect(out.reply.say).toBe("Ousmane Kromah had 609 rushing yards in 2026, up from 412 rushing yards in 2025.");
    expect(out.reply.rows[0]).toEqual(["carries", "2026: 114 · 2025: 80"]);
  });
  test("a season with no number for it is said to be missing, not zero", async () => {
    const ctx = ctxOf();
    expect(await say("compare kromah's catches in 2026 to 2025", ctx)).toBe("I don't have catches for Ousmane Kromah in 2025.");
    expect(ctx.logged[0].reason).toBe("no-stat");
  });
  test("best season: checked against every season; a rate needs real volume", async () => {
    expect(await say("what was kromah's best rushing season")).toBe("Ousmane Kromah's best season for rushing yards came in 2026, with 609 rushing yards.");
    expect(await say("kromah's best season")).toBe("Ousmane Kromah's best season for rushing yards came in 2026, with 609 rushing yards.");
    // 2024's 10.0 yards per carry on 4 carries doesn't count.
    expect(await say("kromah's best season for yards per carry")).toBe("Ousmane Kromah's best season for yards per carry came in 2026, with 5.3 yards per carry.");
    expect(await say("what was sam singleton's best season")).toBe("I only have one season for Sam Singleton: 250 rushing yards in 2026.");
  });
});

describe("follow-ups", () => {
  test("a stat with no name, a new season, an opponent-free 'what about', another player", async () => {
    const ctx = ctxOf();
    let st = (await respond("how many rushing yards did kromah have in 2025", newState(), ctx)).state;
    // The same season as the question before.
    let out = await respond("how many touchdowns", st, ctx);
    expect(out.reply.say).toMatch(/^Ousmane Kromah: 3 touchdowns, 2025./);
    st = out.state;
    out = await respond("what about this year", st, ctx);
    expect(out.reply.say).toMatch(/5 touchdowns/);
    st = out.state;
    out = await respond("what about 2025", st, ctx);
    expect([out.reply.intent, out.reply.say]).toEqual(["stats.one", expect.any(String)]);
    expect(out.reply.say).toMatch(/3 touchdowns/);
    st = out.state;
    out = await respond("what about 2024", st, ctx);
    expect(out.reply.say).toMatch(/1 touchdown\b.*2024|2024.*1 touchdown\b/);
    st = out.state;
    // Another player, same question and season — he has no 2024: said, not zero.
    out = await respond("what about sam singleton", st, ctx);
    expect(out.reply.say).toBe("I don't have Sam Singleton's numbers for that season.");
    // …and with a season he has, a stat he has no number for.
    out = await respond("what about this year", out.state, ctx);
    expect(out.reply.say).toBe("I don't have touchdowns for Sam Singleton.");
  });
  test("one name on a roster never gets a plural wording", async () => {
    const ctx = { ...ctxOf(), vary: true, memory: {}, random: () => 0.6 };
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect(await say("fsu's quarterbacks", ctx)).not.toMatch(/\bare among\b/);
    }
  });
  test("'what school does he play for' and 'how does that rank'", async () => {
    const ctx = ctxOf();
    let out = await respond("kromah's rushing yards", newState(), ctx);
    out = await respond("what school does he play for", out.state, ctx);
    expect(out.reply.say).toBe("Ousmane Kromah: Florida State.");
    out = await respond("kromah's rushing yards", out.state, ctx);
    out = await respond("how does that rank", out.state, ctx);
    expect(out.reply.say).toBe("I can't rank that stat against other players yet. Ousmane Kromah is 12th overall in the 2028 class, and 2nd among running backs. Community grade: Second Round.");
    expect(ctx.logged.map((l) => l.reason)).toContain("stat-rank");
    out = await respond("how does he rank", out.state, ctx);
    expect(out.reply.intent).toBe("player.rank");
  });
  test("no player yet: asks who", async () => {
    expect(await say("how many touchdowns")).toBe("Who do you mean?");
  });
});

describe("on screen: the whole line; out loud: the one stat", () => {
  test("rushing yards → carries, yards per carry, touchdowns shown", async () => {
    const out = await respond("how many rushing yards did kromah have in 2026", newState(), ctxOf());
    expect(out.reply.say).toBe("Ousmane Kromah: 609 rushing yards, 2026. That's up from 412 in 2025.");
    expect(out.reply.rows).toEqual([["rushing yards · 2026", "609"], ["carries", "114"], ["yards per carry", "5.3"], ["rushing touchdowns", "5"]]);
  });
});
