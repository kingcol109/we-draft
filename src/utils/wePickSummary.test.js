import { summarizePicks, addPick, pickView } from "./wePickSummary";

const p = (uid, o) => ({ uid, displayName: uid.toUpperCase(), visibility: "public", updatedAt: new Date(1000), ...o });
const picks = [
  p("a", { awayScore: 31, homeScore: 17, ranked: true, updatedAt: new Date(3000) }),
  p("b", { awayScore: 14, homeScore: 21, visibility: "private" }),
  p("c", { pickedTeam: "home", updatedAt: new Date(2000) }),
];

test("summarizePicks: split, average, exact scores, public list", () => {
  const s = summarizePicks(picks);
  expect(s).toMatchObject({ count: 3, split: { away: 1, home: 2 }, scored: 2, sum: { away: 45, home: 38 }, scores: { "31-17": 1, "14-21": 1 }, publicCount: 2 });
  expect(s.recent.map((r) => [r.uid, r.name, r.ranked])).toEqual([["a", "A", true], ["c", "C", false]]);
});

test("addPick takes a pick out and puts one in", () => {
  const s = addPick(addPick(summarizePicks(picks), picks[0], -1), { ...picks[0], awayScore: 10, homeScore: 40 }, 1);
  expect(s).toMatchObject({ count: 3, split: { away: 0, home: 3 }, sum: { away: 24, home: 61 }, scores: { "31-17": 0, "10-40": 1 } });
});

test("pickView folds in the viewer's pick the summary doesn't have yet — once", () => {
  const summary = summarizePicks(picks.slice(1)); // built before "a" picked
  const mine = picks[0];
  const late = pickView({ sched: {}, summary, mine, mineCounted: false }, "a");
  expect(late.summary).toMatchObject({ count: 3, scored: 2, publicCount: 2 });
  expect(late.summary.recent[0].uid).toBe("a");
  // already counted: unchanged
  const counted = pickView({ sched: {}, summary: summarizePicks(picks), mine, mineCounted: true }, "a");
  expect(counted.summary.count).toBe(3);
  // just re-saved on this page: the old one swapped for the new
  const saved = pickView({ sched: {}, summary: summarizePicks(picks), mine, mineCounted: true }, "a", { awayScore: 0, homeScore: 7, pickedTeam: "home", visibility: "private" });
  expect(saved.summary).toMatchObject({ count: 3, split: { away: 0, home: 3 }, publicCount: 1 });
  expect(saved.summary.recent.map((r) => r.uid)).toEqual(["c"]);
  expect(saved.mine).toMatchObject({ uid: "a", awayScore: 0, homeScore: 7 });
});

test("pickView: a pick you deleted drops off the public list", () => {
  const v = pickView({ sched: {}, summary: summarizePicks(picks), mine: null, mineCounted: false }, "a");
  expect(v.summary.recent.map((r) => r.uid)).toEqual(["c"]);
});
