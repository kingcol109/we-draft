import { tierOf, visitStats } from "./userTiers";

const today = "2026-12-31";
const day = (ago) => new Date(Date.parse(`${today}T12:00:00Z`) - ago * 864e5).toISOString().slice(0, 10);
const old = "2026-10-01"; // tracking long since started

test("no visit in 30 days is a dog", () => {
  expect(tierOf({ visitDays: [day(40)], today, trackedFrom: old }).tier).toBe("dog");
  expect(tierOf({ visitDays: [], today, trackedFrom: old }).tier).toBe("dog");
});

test("visits in 3 of the last 4 weeks is active; with 5 evaluations, a star", () => {
  const visits = [day(1), day(9), day(16)];
  expect(tierOf({ visitDays: visits, today, trackedFrom: old, evals30: 2 }).tier).toBe("active");
  expect(tierOf({ visitDays: visits, today, trackedFrom: old, evals30: 5 }).tier).toBe("star");
});

test("a visit or two this month is inactive", () => {
  expect(tierOf({ visitDays: [day(3), day(4)], today, trackedFrom: old, evals30: 9 }).tier).toBe("inactive");
});

test("lastActiveAt counts as a visit", () => {
  expect(tierOf({ visitDays: [], lastActiveDay: day(2), today, trackedFrom: old }).tier).toBe("inactive");
});

test("with only 10 days of tracking, weekly means both weeks so far", () => {
  const tracked = day(9);
  expect(visitStats([day(1), day(8)], today, tracked).weekly).toBe(true);
  expect(visitStats([day(1), day(2)], today, tracked).weekly).toBe(false);
});
