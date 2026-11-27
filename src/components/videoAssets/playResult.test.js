import { DEFAULT_RESULT, RESULT_DEFAULT_SECONDS, resultTone, resultWords } from "./playResult";

jest.mock("../AdminSideGraphics", () => ({}));

describe("Play Results", () => {
  test("the word: a preset, or typed text over it", () => {
    expect(resultWords({ result: { preset: "SACK" } })).toEqual({ main: "SACK", tag: "" });
    expect(resultWords({ result: { preset: "SACK", text: "what a catch" } }).main).toBe("WHAT A CATCH");
  });

  test("the tag: the player's name and/or a detail", () => {
    const a = { first: "Brent", last: "Gordon Jr.", result: { preset: "TOUCHDOWN", detail: "+45 yds", name: true } };
    expect(resultWords(a).tag).toBe("BRENT GORDON JR. · +45 YDS");
    expect(resultWords({ ...a, result: { ...a.result, name: false } }).tag).toBe("+45 YDS");
  });

  test("tone: a miss preset is a miss on auto; it can be forced either way", () => {
    expect(resultTone({ preset: "DROP" })).toBe("miss");
    expect(resultTone({ preset: "TOUCHDOWN" })).toBe("good");
    expect(resultTone({ preset: "DROP", tone: "good" })).toBe("good");
    expect(resultTone({ preset: "SACK", tone: "miss" })).toBe("miss");
    // Typed text isn't guessed at — good unless set.
    expect(resultTone({ preset: "DROP", text: "OUCH" })).toBe("good");
  });

  test("short: 1.5 s by default, lower third", () => {
    expect(RESULT_DEFAULT_SECONDS).toBe(1.5);
    expect(DEFAULT_RESULT.y).toBeGreaterThan(720);
  });
});
