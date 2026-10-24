import { gradeCounts, communityAverage, countedGrades, FRESH_GRADE_SINCE, NEVER_EXPIRE_UIDS } from "./gradeWindow";

const SCALE = { "Early First Round": 1, "Second Round": 4, "Fifth Round": 7 };
const at = (iso, grade) => ({ grade, updatedAt: { seconds: Date.parse(iso) / 1000 } });
const evals = [at("2026-05-10", "Fifth Round"), at("2026-08-02", "Early First Round"), at("2026-10-01", "Second Round")];

test("2027 and 2028 count only grades saved since Aug 1, 2026", () => {
  expect(countedGrades(evals, "2027", SCALE)).toEqual([1, 4]);
  expect(communityAverage(evals, "2028", SCALE)).toBe(2.5);
  expect(communityAverage([evals[0]], "2027", SCALE)).toBeNull();
});

test("every other class counts every grade", () => {
  expect(communityAverage(evals, "2026", SCALE)).toBe(4);
  expect(communityAverage(evals, "2029", SCALE)).toBe(4);
  expect(communityAverage(evals, 2026, SCALE)).toBe(4);
});

test("the cutoff reads every timestamp shape the site has", () => {
  const ms = FRESH_GRADE_SINCE + 1000;
  expect(gradeCounts({ updatedAt: { toMillis: () => ms } }, "2027")).toBe(true);
  expect(gradeCounts({ updatedAt: { _seconds: ms / 1000 } }, "2027")).toBe(true);
  expect(gradeCounts({ updatedAtMs: ms }, "2027")).toBe(true);
  expect(gradeCounts({ updatedAt: "2026-07-31T12:00:00Z" }, "2027")).toBe(false);
  expect(gradeCounts({}, "2027")).toBe(false);
});

test("an exempt grader's old grades always count", () => {
  const uid = NEVER_EXPIRE_UIDS[0];
  const old = { ...at("2026-05-10", "Fifth Round"), uid };
  expect(gradeCounts(old, "2027")).toBe(true);
  expect(gradeCounts({ ...old, uid: "someoneElse" }, "2027")).toBe(false);
  expect(communityAverage([old, evals[1]], "2028", SCALE)).toBe(4);
});
