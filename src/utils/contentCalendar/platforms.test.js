import { dateKeyET, moveToDay, instagramEntry, xEntry, sortDay, linksOf, matchesFilter, platformOfType, msOf, timeET } from "./platforms";

const at = (iso) => new Date(iso).getTime();

test("an instant's day is Eastern's, not the browser's or UTC's", () => {
  // 03:30 UTC on the 6th is still 10:30pm on the 5th in Eastern.
  expect(dateKeyET(at("2026-11-06T03:30:00Z"))).toBe("2026-11-05");
  expect(timeET(at("2026-11-06T03:30:00Z"))).toBe("10:30 PM");
});

test("moving a post to a new day keeps its Eastern clock time, across daylight saving", () => {
  // Oct 31 2026 is EDT (UTC-4); Nov 2 is EST (UTC-5). 9am stays 9am.
  const moved = moveToDay(at("2026-10-31T13:00:00Z"), "2026-11-02");
  expect(new Date(moved).toISOString()).toBe("2026-11-02T14:00:00.000Z");
  const back = moveToDay(moved, "2026-10-31");
  expect(new Date(back).toISOString()).toBe("2026-10-31T13:00:00.000Z");
  // Same offset.
  expect(new Date(moveToDay(at("2026-11-05T16:00:00Z"), "2026-11-09")).toISOString()).toBe("2026-11-09T16:00:00.000Z");
});

test("a draft Instagram post isn't on the schedule; a scheduled one is, at its time", () => {
  expect(instagramEntry({ id: "a", status: "draft" })).toBeNull();
  expect(instagramEntry({ id: "a", status: "ready" })).toBeNull();
  const when = at("2026-11-05T16:00:00Z");
  expect(instagramEntry({ id: "a", name: "2028 Mock", type: "mock", status: "scheduled", ig: { scheduledAt: when } }))
    .toMatchObject({ id: "instagram:a", refId: "a", platform: "instagram", whenMs: when, dateKey: "2026-11-05", movable: true, statusLabel: "Scheduled", subjectLabel: "2028 Mock" });
});

test("a published Instagram post sits at its real time and can't be moved", () => {
  const e = instagramEntry({ id: "a", status: "published", type: "mock", ig: { scheduledAt: at("2026-11-01T12:00:00Z"), publishedAt: at("2026-11-01T12:01:00Z"), permalink: "https://instagram.com/p/x" } });
  expect(e).toMatchObject({ whenMs: at("2026-11-01T12:01:00Z"), movable: false, permalink: "https://instagram.com/p/x" });
  // Meta gives its time as a string.
  expect(instagramEntry({ id: "s", status: "published", ig: { publishedAt: "2026-11-03T21:32:00+0000" } }).dateKey).toBe("2026-11-03");
  expect(instagramEntry({ id: "b", status: "posted", postedAt: { toMillis: () => 5e12 } }).whenMs).toBe(5e12);
  expect(instagramEntry({ id: "c", status: "failed", ig: { scheduledAt: 5e12, error: { message: "nope" } } })).toMatchObject({ problem: "nope", movable: false });
});

test("a scheduled X post whose time has passed says it's due, not posted", () => {
  const when = at("2026-11-05T16:00:00Z");
  const before = xEntry({ id: "x1", status: "scheduled", scheduledAt: when, text: "hi" }, when - 1000);
  expect(before).toMatchObject({ statusLabel: "Scheduled", due: false, movable: true, body: "hi", platform: "x" });
  expect(xEntry({ id: "x1", status: "scheduled", scheduledAt: when }, when + 1000)).toMatchObject({ statusLabel: "Due: post by hand", due: true });
  expect(xEntry({ id: "x1", status: "draft" })).toBeNull();
  expect(xEntry({ id: "x1", status: "posted", postedAt: when })).toMatchObject({ statusLabel: "Posted", movable: false });
});

test("the filter sorts entries by platform", () => {
  expect(platformOfType("video")).toBe("youtube");
  expect(platformOfType("short")).toBe("youtube");
  expect(platformOfType("article")).toBe("other");
  expect(platformOfType("post")).toBe("other");
  expect(matchesFilter({ platform: "x" }, "all")).toBe(true);
  expect(matchesFilter({ platform: "x" }, "instagram")).toBe(false);
  expect(matchesFilter({ platform: "x" }, "x")).toBe(true);
});

test("timed chips come first and in order; date-only ones keep their order", () => {
  const list = [{ id: "a" }, { id: "b", whenMs: 20 }, { id: "c" }, { id: "d", whenMs: 10 }];
  expect(sortDay(list).map((e) => e.id)).toEqual(["d", "b", "a", "c"]);
});

test("linked content reads both ways, each record keeping its own time", () => {
  const ig = { platform: "instagram", refId: "i1", subjectLabel: "Bowman IG", raw: {}, whenMs: 1 };
  const yt = { platform: "youtube", refId: "v1", subjectLabel: "Bowman film", raw: {} };
  const x = { platform: "x", refId: "x1", subjectLabel: "Bowman X", whenMs: 2, raw: { linkedTo: [{ platform: "instagram", id: "i1", label: "old name" }, { platform: "youtube", id: "v1" }] } };
  const all = [ig, yt, x];
  expect(linksOf(x, all).map((l) => `${l.platform}:${l.label}`)).toEqual(["instagram:Bowman IG", "youtube:Bowman film"]);
  expect(linksOf(ig, all).map((l) => `${l.platform}:${l.id}`)).toEqual(["x:x1", "youtube:v1"]);
  // A linked record that isn't on the calendar (a draft) still shows, by its saved label.
  expect(linksOf(x, [x])[0]).toMatchObject({ label: "old name", entry: null });
});

test("msOf reads every stored shape", () => {
  expect(msOf(5)).toBe(5);
  expect(msOf(new Date(5))).toBe(5);
  expect(msOf({ toDate: () => new Date(5) })).toBe(5);
  expect(msOf("2026-11-03T21:32:00+0000")).toBe(at("2026-11-03T21:32:00Z"));
  expect(msOf(null)).toBeNull();
  expect(msOf("nope")).toBeNull();
});
