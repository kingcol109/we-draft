import { renderHook } from "@testing-library/react";
import { useStuckSpinnerWatchdog, trackPageSpinner, STUCK_MS } from "./useStuckSpinnerWatchdog";

const reload = jest.fn();
beforeAll(() => {
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
  Object.defineProperty(window, "location", { value: { pathname: "/nfl/nyj", reload }, configurable: true });
});
beforeEach(() => { jest.useFakeTimers(); reload.mockClear(); sessionStorage.clear(); });
afterEach(() => jest.useRealTimers());

test("a page spinner still up after 5s reloads once per URL", () => {
  const { unmount } = renderHook(() => useStuckSpinnerWatchdog());
  const done = trackPageSpinner();
  jest.advanceTimersByTime(STUCK_MS - 1);
  expect(reload).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(reload).toHaveBeenCalledTimes(1);
  // Still stuck (the guard is set): no second one, even coming back to the tab.
  jest.advanceTimersByTime(STUCK_MS * 2);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(reload).toHaveBeenCalledTimes(1);
  // Loaded: the guard clears for a later hang.
  done();
  expect(sessionStorage.getItem("wd_stuck_/nfl/nyj")).toBeNull();
  unmount();
});

test("a page that loads in time isn't reloaded", () => {
  const { unmount } = renderHook(() => useStuckSpinnerWatchdog());
  const done = trackPageSpinner();
  jest.advanceTimersByTime(STUCK_MS - 500);
  done();
  jest.advanceTimersByTime(STUCK_MS);
  expect(reload).not.toHaveBeenCalled();
  unmount();
});
