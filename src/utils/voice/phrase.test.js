// Varying and improving the answers (user, 2026-11-25): the phrasebook,
// no repeats, follow-ups, Brief, tips, and leading with what's notable.
import { respond, newState } from "./engine";
import { phrase, hint, choose, resultPhrase, datePhrase, shortTeam, whenPhrase } from "./phrase";
import { BOOK } from "./phrasebook";
import { fill, SPEC } from "./phraseTemplates";
import { topRank, bigSeason, seasonChange, bestSeasonYet, pedigree } from "./insights";

const people = [{ id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" }];
const KROMAH = { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", RecruitStars: 5, Bio: "A bio." };
const SEASONS = {
  years: ["2025", "2026"],
  seasons: {
    2025: { rushing: { rushingAttempts: 80, rushingYards: 400, rushingTouchdowns: 3 } },
    2026: { rushing: { rushingAttempts: 190, rushingYards: 1100, rushingTouchdowns: 12 }, receiving: { receptions: 12, receivingYards: 90 } },
  },
  career: {},
};
// A random that walks 0, 0.34, 0.67, … so picks change but are repeatable.
const walker = () => { let i = 0; return () => { const v = [0, 0.34, 0.67, 0.99][i % 4]; i += 1; return v; }; };
const makeCtx = (over = {}) => ({
  uid: null, vary: true, memory: {}, random: walker(),
  people: async () => people,
  player: async () => KROMAH,
  seasons: async () => SEASONS,
  games: async () => [],
  ranks: async () => ({ classRank: 4, positionRank: 1 }),
  logMiss: () => {},
  ...over,
});

describe("the phrasebook", () => {
  const vars = { name: "Ousmane Kromah", pos: "running back", school: "Florida State", cls: "2028", cr: "4th", pr: "1st", posPl: "running backs", top: "position", n: 5, kind: "five-star",
    value: "300 rushing yards", label: "2025", when: "in 2025", verb: "had", dir: "up", prev: "200", prevYear: "2024", list: "a, b", what: "most rushing yards", span: "2025", spanP: "in 2025",
    said: "160 rushing yards", title: "vs Ohio State", titleS: "vs Ohio State", whenP: "September 6th", result: "W 31-17", resultP: "a 31-17 win", parts: "4th overall", grade: "Second Round", watch: false, g: "a second round grade",
    w: 5, l: 6, y: 2026, left: "", won: true, score: "31-17", at: "against", opp: "Miami", pickP: "first overall", year: 2007, team: "Las Vegas Raiders", said2: "x", text: "x" };
  test("every wording renders cleanly (no undefined / null / doubled spaces)", () => {
    Object.entries(BOOK).forEach(([key, list]) => list.forEach((fn, i) => {
      const v = { ...vars, plus: "", ...(SPEC[key]?.sample || {}) };
      const out = typeof fn === "string" ? fill(fn, v, key) : fn(v);
      if (out == null) return; // a wording that doesn't fit these values
      expect([key, i, out]).toEqual([key, i, expect.not.stringMatching(/undefined|null|NaN| {2}|\.\./)]);
    }));
  });
  test("the first wording when not varying; never the same one twice in a row when varying", () => {
    expect(phrase(null, "suggest", { name: "X" })).toBe("Try X.");
    const ctx = { vary: true, memory: {}, random: () => 0 };
    const said = [1, 2, 3, 4, 5, 6].map(() => phrase(ctx, "suggest", { name: "X" }));
    said.slice(1).forEach((s, i) => expect(s).not.toBe(said[i]));
  });
  test("choose / hints", () => {
    expect(choose(null, "k", ["a", "b"])).toBe("a");
    const ctx = { vary: true, memory: {} };
    expect([1, 2, 3].map(() => hint(ctx, "bio", "Say bio."))).toEqual(["Say bio.", "Say bio.", ""]);
    expect(hint({ brief: true }, "bio", "Say bio.")).toBe("");
  });
  test("said the way it's said", () => {
    expect(resultPhrase({ result: "W", score: "31-17" })).toBe("a 31-17 win");
    expect(resultPhrase({ result: "L", score: "35-24" })).toBe("a 35-24 loss");
    expect(datePhrase("2026-09-12T19:00:00Z", new Date("2026-11-25"))).toBe("September 12th");
    expect(datePhrase("2025-09-03T19:00:00Z", new Date("2026-11-25"))).toBe("September 3rd, 2025");
    expect(shortTeam("Ohio State Buckeyes")).toBe("Ohio State");
    expect(shortTeam("Texas Tech Red Raiders")).toBe("Texas Tech");
    expect(whenPhrase({ kind: "vs", opps: ["Ohio State Buckeyes", "LSU Tigers"], games: [1, 2] })).toBe("against Ohio State and LSU (2 games)");
    expect(whenPhrase({ kind: "career" })).toBe("in his career");
  });
});

describe("what's notable", () => {
  test("rules", () => {
    expect(topRank({ classRank: 30, positionRank: 1 })).toEqual({ top: "position", n: 1 });
    expect(topRank({ classRank: 4, positionRank: 2 })).toEqual({ top: "class", n: 5 });
    expect(topRank({ classRank: 24, positionRank: 3 })).toBeNull();
    expect(bigSeason("RB", SEASONS.seasons[2026])).toBe("rushYds");
    expect(bigSeason("RB", SEASONS.seasons[2025])).toBeNull();
    expect(seasonChange(SEASONS, "2026", "rushYds")).toEqual({ dir: "up", prev: 400, prevYear: "2025" });
    expect(bestSeasonYet(SEASONS, "2026", "rushYds")).toBe(true);
    expect(pedigree({ RecruitStars: 5 })).toBe("five-star");
    expect(pedigree({ RecruitStars: 4, RecruitRank: 76 })).toBe("top-100");
    expect(pedigree({ RecruitStars: 3, RecruitRank: 400 })).toBeNull();
  });
  test("the 411 leads with a top rank, flags a big year and the pedigree", async () => {
    const out = await respond("who is kromah", newState(), makeCtx({ vary: false }));
    expect(out.reply.say).toBe("Ousmane Kromah is a running back at Florida State in the 2028 draft class. He's the top running back in the 2028 class, 4th overall. He's put up big numbers. He ran for 1,100 yards and 12 touchdowns on 190 carries in 2026, plus 12 catches for 90 yards. He was a five-star recruit. Say \"read his bio\" for more.");
  });
  test("Brief: just the answer", async () => {
    const out = await respond("who is kromah", newState(), makeCtx({ vary: false, brief: true }));
    expect(out.reply.say).toBe("Ousmane Kromah is a running back at Florida State in the 2028 draft class. He's the top running back in the 2028 class, 4th overall. He ran for 1,100 yards and 12 touchdowns on 190 carries in 2026, plus 12 catches for 90 yards.");
  });
  test("a stat with how it compares to last season", async () => {
    const out = await respond("how many rushing yards does kromah have in 2026", newState(), makeCtx({ vary: false }));
    expect(out.reply.say).toBe("Ousmane Kromah: 1,100 rushing yards, 2026. That's up from 400 in 2025.");
  });
});

describe("in conversation", () => {
  test("the same question twice is worded differently", async () => {
    const ctx = makeCtx();
    const a = (await respond("how many rushing yards does kromah have in 2026", newState(), ctx)).reply.say;
    const b = (await respond("how many rushing yards does kromah have in 2026", newState(), ctx)).reply.say;
    expect(a).not.toBe(b);
    [a, b].forEach((s) => expect(s).toMatch(/1,100 rushing yards/));
  });
  test("a follow-up about him is shorter and says 'he'", async () => {
    const ctx = makeCtx();
    const st = (await respond("who is kromah", newState(), ctx)).state;
    const out = await respond("how many rushing yards did he have in 2025", st, ctx);
    expect(out.reply.say).not.toMatch(/Ousmane Kromah/);
    expect(out.reply.say).toMatch(/400 rushing yards in 2025/);
  });
  test("tips stop after a couple of times", async () => {
    const ctx = makeCtx();
    const said = [];
    for (let i = 0; i < 3; i += 1) said.push((await respond("who is kromah", newState(), ctx)).reply.say); // eslint-disable-line no-await-in-loop
    expect(said.filter((s) => /read his bio/.test(s))).toHaveLength(2);
  });
});
