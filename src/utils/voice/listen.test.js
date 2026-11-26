// speech.js listen() (user, 2026-11-26: "the time it waits after the last word needs to be
// longer. it cuts the user off too often") — a browser's own end-of-speech no longer ends the
// question; the words have to stop for quietFor() first. A fake recognizer, fake timers.
import { listen, QUIET_MS } from "./speech";

let rec;
class FakeSR {
  constructor() { rec = this; this.started = false; }
  start() { this.started = true; this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.aborted = true; this.onend?.(); }
}
// e.results: [[{ transcript }], …] with isFinal on each.
const say = (parts) => rec.onresult({ resultIndex: 0, results: parts.map(([t, fin]) => Object.assign([{ transcript: t }], { isFinal: !!fin })) });

beforeEach(() => { jest.useFakeTimers(); window.SpeechRecognition = FakeSR; });
afterEach(() => { jest.useRealTimers(); delete window.SpeechRecognition; });

test("a pause the browser calls final doesn't end the question", () => {
  const final = jest.fn();
  listen({ final });
  expect(rec.continuous).toBe(true);
  say([["voice note it has to do a better job", true]]);
  jest.advanceTimersByTime(QUIET_MS - 100);
  expect(final).not.toHaveBeenCalled();
  say([["voice note it has to do a better job", true], [" of following the conversation", false]]);
  jest.advanceTimersByTime(QUIET_MS - 100);
  expect(final).not.toHaveBeenCalled();
  jest.advanceTimersByTime(200);
  expect(final).toHaveBeenCalledWith("voice note it has to do a better job of following the conversation");
});

test("ending on a word like \"of\" waits longer", () => {
  const final = jest.fn();
  listen({ final });
  say([["it has to do a better job of", false]]);
  jest.advanceTimersByTime(QUIET_MS + 200);
  expect(final).not.toHaveBeenCalled();
  jest.advanceTimersByTime(2000);
  expect(final).toHaveBeenCalledWith("it has to do a better job of");
});

test("a tap to stop takes what was heard; the browser ending it does too", () => {
  const final = jest.fn();
  const stop = listen({ final });
  say([["how many rushing yards does kromah have", false]]);
  stop();
  expect(final).toHaveBeenCalledWith("how many rushing yards does kromah have");
  const final2 = jest.fn();
  listen({ final: final2 });
  say([["who is jesse legree", true]]);
  rec.onend();
  expect(final2).toHaveBeenCalledWith("who is jesse legree");
});

test("stop({ discard: true }) drops it (the wake word's window closing)", () => {
  const final = jest.fn();
  const stop = listen({ final });
  say([["who is", false]]);
  stop({ discard: true });
  jest.advanceTimersByTime(10000);
  expect(final).not.toHaveBeenCalled();
});
