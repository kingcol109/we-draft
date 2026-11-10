import { thumbRuns, runTotals, thumbMeta, dayOf } from "./thumbStore";

jest.mock("../../firebase", () => ({ db: {} }));

const at = (d) => new Date(`${d}T20:00:00Z`).getTime();

test("a thumbnail's run ends where the next one on the same video starts", () => {
  const runs = thumbRuns([
    { id: "a", videoId: "v1", liveFrom: at("2026-10-01") },
    { id: "b", videoId: "v1", liveFrom: at("2026-10-10") },
    { id: "c", videoId: "v2", liveFrom: at("2026-10-05") },
    { id: "d" },
  ]);
  expect(runs.a).toEqual({ from: at("2026-10-01"), to: at("2026-10-10") });
  expect(runs.b).toEqual({ from: at("2026-10-10"), to: null });
  expect(runs.c.to).toBeNull();
  expect(runs.d).toBeUndefined();
});

test("a run's impressions, CTR (weighted) and views come from its own days", () => {
  const rows = [
    { date: "2026-09-30", impressions: 999, impressionsCtr: 0.5, views: 999 },
    { date: "2026-10-01", impressions: 100, impressionsCtr: 0.1, views: 12, minutesWatched: 24, avgViewPct: 40 },
    { date: "2026-10-02", impressions: 300, impressionsCtr: 0.05, views: 20, minutesWatched: 30, avgViewPct: 30 },
    { date: "2026-10-03", views: 4, minutesWatched: 6 },
    { date: "2026-10-10", impressions: 50, impressionsCtr: 0.2, views: 9 },
  ];
  const t = runTotals(rows, { from: at("2026-10-01"), to: at("2026-10-10") });
  expect(t.days).toBe(3);
  expect(t.reachDays).toBe(2);
  expect(t.impressions).toBe(400);
  expect(t.ctr).toBeCloseTo((10 + 15) / 400);
  expect(t.views).toBe(36);
  expect(t.avgViewSec).toBeCloseTo((60 * 60) / 36);
  expect(t.avgViewPct).toBeCloseTo((40 * 12 + 30 * 20) / 32);
  expect(dayOf(at("2026-10-01"))).toBe("2026-10-01");
});

test("the metadata a thumbnail's grouped by", () => {
  const m = thumbMeta({ template: "gamereview", headline: "HE’S\nHOW\nOLD?!", name: "Mark Bowman", photoKind: "action", colors: { color: "#990000" } });
  expect(m).toMatchObject({ template: "gamereview", headline: "HE’S HOW OLD?!", headlineWords: 3, headlineLines: 3, question: true, nameOnThumb: true, photoKind: "action", color: "#990000" });
});
