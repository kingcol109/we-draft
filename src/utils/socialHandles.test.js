import { cleanXHandle } from "./socialHandles";

test("X handles: @, links and junk come off", () => {
  expect(cleanXHandle("@JSmith_4")).toBe("JSmith_4");
  expect(cleanXHandle("https://x.com/JSmith_4?s=21")).toBe("JSmith_4");
  expect(cleanXHandle("twitter.com/#!/someone")).toBe("someone");
  expect(cleanXHandle(" j.smith ")).toBe("jsmith");
  expect(cleanXHandle("a".repeat(20))).toBe("a".repeat(15));
  expect(cleanXHandle("")).toBe("");
});
