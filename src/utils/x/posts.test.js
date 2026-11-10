import { xLength, fitToX, textFromCaption, scheduleProblems, toXPayload, X_LIMIT } from "./posts";

test("X's count: a link is 23, an emoji is 2, CJK is 2", () => {
  expect(xLength("hello")).toBe(5);
  expect(xLength("")).toBe(0);
  expect(xLength("https://www.we-draft.com/a/very/long/path/that/goes/on/and/on")).toBe(23);
  expect(xLength("see we-draft.com/mocks/2027 now")).toBe("see ".length + 23 + " now".length);
  expect(xLength("🔥")).toBe(2);
  expect(xLength("👨‍👩‍👧‍👦")).toBe(2);
  expect(xLength("日本")).toBe(4);
  // A period between words isn't a link.
  expect(xLength("J.Smith")).toBe(7);
});

test("fitToX stays inside the limit, at a word", () => {
  const long = "word ".repeat(100);
  const fit = fitToX(long);
  expect(xLength(fit)).toBeLessThanOrEqual(X_LIMIT);
  expect(fit.endsWith("word…")).toBe(true);
  expect(fitToX("short one")).toBe("short one");
  expect(xLength(fitToX("🔥".repeat(200)))).toBeLessThanOrEqual(X_LIMIT);
});

test("an Instagram caption becomes a short draft: opening plus its link", () => {
  const caption = "Mark Bowman has entered the transfer portal.\n\nMore on Mark at we-draft.com/player/mark-bowman\n\n#CollegeFootball #TransferPortal";
  expect(textFromCaption(caption)).toBe("Mark Bowman has entered the transfer portal.\n\nMore on Mark at we-draft.com/player/mark-bowman");
  expect(xLength(textFromCaption(`${"A very long opening. ".repeat(40)}\n\nwe-draft.com`))).toBeLessThanOrEqual(X_LIMIT);
  expect(textFromCaption("")).toBe("");
});

test("what stops a post being scheduled", () => {
  const now = 1e12;
  expect(scheduleProblems({ text: "ok", scheduledAt: now + 3600e3 }, now)).toEqual([]);
  expect(scheduleProblems({ text: "", media: [] }, now)[0]).toMatch(/text or an image/);
  expect(scheduleProblems({ text: "", media: [{ id: "a" }] }, now)).toEqual([]);
  expect(scheduleProblems({ text: "x".repeat(281) }, now)[0]).toMatch(/281/);
  expect(scheduleProblems({ text: "ok", media: Array(5).fill({}) }, now)[0]).toMatch(/4 images/);
  expect(scheduleProblems({ text: "ok", scheduledAt: now + 60e3 }, now)[0]).toMatch(/5 minutes/);
  expect(scheduleProblems({ text: "ok", scheduledAt: NaN }, now)[0]).toMatch(/5 minutes/);
});

test("the publisher's payload is the text and images, nothing else", () => {
  const p = toXPayload({ text: " hi ", status: "scheduled", thumb: "data:...", media: [{ id: "a", kind: "link", url: "https://x/y.jpg", alt: "A" }, { id: "b", kind: "card" }] });
  expect(p).toEqual({ text: "hi", media: [{ id: "a", kind: "link", url: "https://x/y.jpg", alt: "A" }, { id: "b", kind: "card", url: null, alt: "" }] });
});
