import { isWakeResult, questionFrom } from "./localWake";

describe("local wake word (Hey We-Draft)", () => {
  test("a confident wake phrase wakes it", () => {
    expect(isWakeResult({ text: "hey we draft", result: [{ word: "hey", conf: 0.9 }, { word: "we", conf: 0.8 }, { word: "draft", conf: 1 }] })).toBe(true);
    expect(isWakeResult({ text: "okay we draft" })).toBe(true);
    // Vosk wraps the phrase in "[unk]" for the words around it (headless Chrome run, 2026-11-26)
    expect(isWakeResult({ text: "[unk] hey we draft [unk]", result: [{ word: "[unk]", conf: 1 }, { word: "hey", conf: 1 }, { word: "we", conf: 1 }, { word: "draft", conf: 1 }, { word: "[unk]", conf: 1 }] })).toBe(true);
    expect(isWakeResult({ partial: "[unk] hey we draft" })).toBe(true);
  });
  test("unsure, unknown, partial or the film editor's phrase don't", () => {
    expect(isWakeResult({ text: "hey we draft", result: [{ word: "hey", conf: 0.3 }, { word: "we", conf: 0.9 }, { word: "draft", conf: 0.9 }] })).toBe(false);
    expect(isWakeResult({ text: "[unk]" })).toBe(false);
    expect(isWakeResult({ partial: "hey we" })).toBe(false);
    expect(isWakeResult({ text: "hey film manager" })).toBe(false);
    expect(isWakeResult({ text: "" })).toBe(false);
    expect(isWakeResult(null)).toBe(false);
  });
  test("the question is what comes after the wake phrase", () => {
    expect(questionFrom("hey we draft how is kromah playing")).toBe("how is kromah playing");
    expect(questionFrom("we draft who won the game")).toBe("who won the game");
    expect(questionFrom("how is kromah playing")).toBe("how is kromah playing");
    expect(questionFrom("who was the first pick in the draft")).toBe("who was the first pick in the draft");
    expect(questionFrom("hey we draft")).toBe("");
    expect(questionFrom("")).toBe("");
  });
});
