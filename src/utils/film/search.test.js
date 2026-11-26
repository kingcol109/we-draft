import { gameMatches } from "./schedule";
const g = (away, home) => ({ away, home });
test("game search", () => {
  expect(gameMatches("oklahoma texas", g("Texas", "Oklahoma"))).toBe(true);
  expect(gameMatches("fsu at clemson", g("Florida State", "Clemson"))).toBe(true);
  expect(gameMatches("ohio st mich", g("Michigan", "Ohio State"))).toBe(true);
  expect(gameMatches("texas a&m lsu", g("Texas A&M", "LSU"))).toBe(true);
  expect(gameMatches("ole miss vs bama", g("Ole Miss", "Alabama"))).toBe(false);
  expect(gameMatches("auburn oklahoma", g("Auburn", "Oklahoma"))).toBe(true);
  expect(gameMatches("auburn texas", g("Auburn", "Oklahoma"))).toBe(false);
  expect(gameMatches("usc ucla", g("USC", "UCLA"))).toBe(true);
});
