import { renderHook, act } from "@testing-library/react";
import { usePlayReveal, HOLD_MS, CALL_MS, KICKOFF_MS } from "./usePlayReveal";
import { playCall } from "../utils/playCall";

const play = (id, type, players = {}) => ({ id, presentation: { type, headline: type.toUpperCase(), players, line: [] } });
const KICK = play("k", "kickoff", { kicker: { name: "A. Kicker" } });
const RUN = play("r", "rush", { rusher: { name: "B. Back" } });
const PASS = play("p", "pass", { passer: { name: "C. Arm" } });
const FLAG = { id: "f", presentation: { type: "penalty", flagStory: true, players: {} } };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
const advance = (ms) => act(() => { jest.advanceTimersByTime(ms); });

test("watching from before kickoff: the first batch plays out one at a time, after the kickoff animation", () => {
  const { result, rerender } = renderHook(({ plays, loaded }) => usePlayReveal(plays, "g1", { loaded }), { initialProps: { plays: [], loaded: false } });
  rerender({ plays: [], loaded: true }); // loaded, empty: here from the start
  rerender({ plays: [KICK, RUN, PASS], loaded: true }); // all three land at once
  expect(result.current.listed).toEqual([]);
  expect(result.current.kickoffAt).not.toBeNull();
  advance(KICKOFF_MS - 500);
  expect(result.current.slot).toBeNull(); // the animation goes first
  advance(1000);
  expect(result.current.slot?.id).toBe("k");
  expect(result.current.stage).toBe("call");
  advance(CALL_MS + 300);
  expect(result.current.stage).toBe("result");
  expect(result.current.listed).toEqual([]);
  advance(HOLD_MS + 300);
  expect(result.current.listed.map((p) => p.id)).toEqual(["k"]);
  expect(result.current.slot).toBeNull(); // the gap before the next snap
  advance(5500);
  expect(result.current.slot?.id).toBe("r");
  expect(result.current.queued).toEqual(["p"]);
});

test("opened mid-game: plays already there are history (no reveal, no kickoff)", () => {
  const { result } = renderHook(() => usePlayReveal([KICK, RUN], "g2", { loaded: true }));
  expect(result.current.listed.map((p) => p.id)).toEqual(["k", "r"]);
  expect(result.current.slot).toBeNull();
  expect(result.current.kickoffAt).toBeNull();
});

test("a play with no call (a flag) goes straight to its result", () => {
  const { result, rerender } = renderHook(({ plays }) => usePlayReveal(plays, "g3", { loaded: true }), { initialProps: { plays: [RUN] } });
  rerender({ plays: [RUN, FLAG] });
  advance(600);
  expect(result.current.slot?.id).toBe("f");
  expect(result.current.stage).toBe("result");
});

test("playCall names the snap, never the outcome", () => {
  expect(playCall(PASS)).toEqual({ label: "PASS", player: { name: "C. Arm" } });
  expect(playCall({ presentation: { type: "interception", players: { passer: { name: "Q" } } } }).label).toBe("PASS");
  expect(playCall({ presentation: { type: "sack", players: { passer: { name: "Q" } } } }).label).toBe("PASS");
  expect(playCall(RUN).label).toBe("RUSH");
  expect(playCall(FLAG)).toBeNull();
  expect(playCall({ presentation: { type: "timeout" } })).toBeNull();
  expect(playCall({ presentation: { type: "pass", nullified: true, players: {} } })).toBeNull();
});
