// The conversation log's entries (user, 2026-11-25).
import { logEntry, deviceOf, LOG_DAYS } from "./log";

test("an exchange as a log entry: what was asked and answered, how, how long", () => {
  const now = Date.UTC(2026, 10, 25, 12);
  const e = logEntry("how's kromah playing", { say: "Ousmane Kromah has 112 rushing yards.", intent: "live.player", tone: "answer", title: "Ousmane Kromah", player: { id: "k", First: "Ousmane", Last: "Kromah" }, rows: [["a", "b"]] }, { source: "voice", ms: 812.4, session: "s1", device: "iPad · Safari", mode: "admin" }, now);
  expect(e).toEqual({
    said: "how's kromah playing", say: "Ousmane Kromah has 112 rushing yards.", intent: "live.player", tone: "answer", miss: false, asked: false,
    player: "k", playerName: "Ousmane Kromah", title: "Ousmane Kromah", rows: 1, source: "voice", ms: 812, session: "s1", device: "iPad · Safari", mode: "admin",
    expireAt: new Date(now + LOG_DAYS * 86400000),
  });
  expect(logEntry("x".repeat(900), { say: "y".repeat(5000), tone: "miss" }).said).toHaveLength(400);
  expect(logEntry("x", { say: "y", tone: "miss" }).miss).toBe(true);
  expect(logEntry("x", { say: "Set it?", confirm: true }).asked).toBe(true);
});

test("the device: an iPad's Safari says Macintosh, but has a touch screen", () => {
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  expect(deviceOf(ipad, 5)).toBe("iPad · Safari");
  expect(deviceOf(ipad, 0)).toBe("Mac · Safari");
  expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")).toBe("Windows · Chrome");
  expect(deviceOf("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36", 5)).toBe("Android · Chrome");
});
