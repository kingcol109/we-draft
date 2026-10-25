import { renderHook, act } from "@testing-library/react";
import useDraftSim from "./useDraftSim";
import { buildBoard } from "../../utils/draftSim/engine";

jest.mock("../../utils/draftSim/data", () => ({ teamNamer: () => ({ teamName: (t) => t, nickname: (t) => t, city: (t) => t }), loadBestGame: () => Promise.resolve(null) }));

const board = buildBoard(Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, First: "F", Last: `L${i}`, Position: ["QB", "WR", "EDGE"][i % 3], School: "S", Slug: `s${i}`, cr: i + 1 })));
const data = {
  year: 2027, season: 2026, board, chart: {}, staff: {}, needs: {}, branding: {},
  order: [{ Pick: 1, Round: 1, Team: "AAA" }, { Pick: 2, Round: 1, Team: "BBB" }, { Pick: 3, Round: 1, Team: "AAA" }],
  futureOrder: [],
};
const run = (quick) => {
  const view = renderHook(() => useDraftSim(data, { userTeams: ["AAA", "BBB"], rounds: 1, seed: 1, quick }));
  act(() => { view.result.current.start(); });
  act(() => { jest.runOnlyPendingTimers(); });
  return view;
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("mock draft mode: the user's pick goes straight to the next one — no reveal hold", () => {
  const { result } = run(true);
  expect(result.current.phase).toBe("user");
  act(() => { result.current.draft("p0"); });
  act(() => { jest.advanceTimersByTime(0); });
  expect(result.current.sim.picks[0].selection).toBe("p0");
  expect(result.current.phase).toBe("user");
  expect(result.current.sim.idx).toBe(1);
});

test("the sim still holds its reveal card after the user's pick", () => {
  const { result } = run(false);
  act(() => { result.current.draft("p0"); });
  expect(result.current.phase).toBe("reveal");
});

test("mock draft mode: Sim Pick makes the user's pick, Sim Round the rest of the round", () => {
  const { result } = run(true);
  act(() => { result.current.simPick(); });
  act(() => { jest.advanceTimersByTime(0); });
  expect(result.current.sim.picks[0].selection).toBeTruthy();
  expect(result.current.phase).toBe("user");
  act(() => { result.current.simRound(); });
  act(() => { jest.runOnlyPendingTimers(); });
  expect(result.current.sim.picks.every((p) => p.selection)).toBe(true);
  expect(result.current.phase).toBe("done");
});

test("mock draft mode: Undo steps back one pick at a time, all the way to the first", () => {
  const { result } = run(true);
  expect(result.current.canUndo).toBe(false);
  act(() => { result.current.draft("p0"); });
  act(() => { jest.advanceTimersByTime(0); });
  act(() => { result.current.simRound(); });
  act(() => { jest.runOnlyPendingTimers(); });
  expect(result.current.phase).toBe("done");
  act(() => { result.current.undo(); });
  expect(result.current.phase).toBe("user");
  expect(result.current.sim.picks.map((p) => !!p.selection)).toEqual([true, true, false]);
  act(() => { result.current.undo(); });
  act(() => { result.current.undo(); });
  expect(result.current.sim.picks.every((p) => !p.selection)).toBe(true);
  expect(result.current.canUndo).toBe(false);
  expect(result.current.feed.every((p) => p.overall == null)).toBe(true);
});

test("mock draft mode: any two teams trade on the user's say-so, no offers, and it undoes", () => {
  const { result } = run(true);
  expect(result.current.sim.offers || []).toEqual([]);
  // BBB sends No. 2 to AAA for nothing — no CPU to turn it down.
  let verdict;
  act(() => { verdict = result.current.proposeTrade({ team: "AAA", partner: "BBB", give: [], get: [2] }); });
  expect(verdict.accept).toBe(true);
  expect(result.current.sim.picks[1].owner).toBe("AAA");
  act(() => { result.current.undo(); });
  expect(result.current.sim.picks[1].owner).toBe("BBB");
});

test("the sim still has CPU teams say no to a lopsided deal", () => {
  const { result } = run(false);
  let verdict;
  act(() => { verdict = result.current.proposeTrade({ team: "AAA", partner: "BBB", give: [], get: [2] }); });
  expect(verdict.accept).toBe(false);
});
