import { buildBoard } from "./engine";
import { buildShowScript, showTimeline, momentAt, postsAt, showTimes, startForFirstPick, spotlightOf, spotlights, pregamePosts, firstOnClock, easternClock, SPOTLIGHT, SPOTLIGHT_DEPTH, INTRO_MS, ROUND_BREAK_MS, PACE, PRESHOW_MS } from "./onTheClock";
import { minutesBefore, easternTime } from "./onTheClockData";

const POS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];
const TEAMS = ["AAA", "BBB", "CCC", "DDD"];
const data = () => {
  const board = buildBoard(Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, First: "F", Last: `L${i}`, Position: POS[i % POS.length], School: "State", Slug: `s${i}`, cr: i + 1 })));
  const order = [1, 2].flatMap((round) => TEAMS.map((Team, k) => ({ Pick: (round - 1) * 4 + k + 1, Round: round, Team })));
  return { year: "2027", season: 2026, order, futureOrder: [], futureYear: null, board, chart: {}, staff: {}, needs: {}, history: null, stars: {}, branding: { AAA: { City: "Aville", Team: "Aces", Color1: "#111111", LogoDark: "a.png" } } };
};

test("on the clock: one script per seed — every pick, the desk, grades", async () => {
  const a = await buildShowScript({ data: data(), formatKey: "full2027", rounds: 2, seed: 7, startAt: 1000, id: "x" });
  const b = await buildShowScript({ data: data(), formatKey: "full2027", rounds: 2, seed: 7, startAt: 1000, id: "x" });
  expect(a.beats).toHaveLength(8);
  expect(a.beats.map((x) => x.pid)).toEqual(b.beats.map((x) => x.pid));
  expect(new Set(a.beats.map((x) => x.pid)).size).toBe(8);
  a.beats.forEach((x) => {
    expect(a.players[x.pid]).toBeTruthy();
    expect(x.top.length).toBeGreaterThan(0);
    expect(x.posts[0].a).toBe("wedraft");
    // Potential Targets: three different players, none drafted yet.
    expect(new Set(x.targets).size).toBe(x.targets.length);
    expect(x.targets.length).toBeGreaterThan(0);
    x.targets.forEach((pid) => expect(a.players[pid]).toBeTruthy());
  });
  expect(a.teams.AAA).toMatchObject({ name: "Aville Aces", c1: "#111111", logo: "a.png" });
  expect(a.grades.length).toBe(4);
  // Best Available's board: every position's best, each one in players.
  expect(a.board.QB[0]).toBe("p0");
  Object.values(a.board).flat().forEach((pid) => expect(a.players[pid]).toBeTruthy());
  expect(a.analysts.wedraft.name).toBe("We-Draft.com");
  expect(JSON.stringify(a).length).toBeLessThan(200000);
});

test("on the clock: the timeline places every beat and the round break", async () => {
  const s = await buildShowScript({ data: data(), rounds: 2, seed: 3, startAt: 0, id: "x" });
  const tl = showTimeline(s);
  expect(momentAt(s, tl, -5).kind).toBe("preshow");
  expect(momentAt(s, tl, 10).kind).toBe("intro");
  const first = momentAt(s, tl, INTRO_MS + 1);
  expect(first.kind).toBe("clock");
  expect(first.beatIdx).toBe(0);
  expect(first.made).toBe(0);
  const breakSeg = tl.segs.find((g) => g.kind === "roundBreak");
  expect(breakSeg.round).toBe(1);
  expect(breakSeg.end - breakSeg.start).toBe(ROUND_BREAK_MS);
  expect(momentAt(s, tl, breakSeg.start + 1).made).toBe(4);
  expect(momentAt(s, tl, tl.finalAt + 1)).toMatchObject({ kind: "final", made: 8 });
  // The first pick's posts are up once its reveal's started (plus each delay).
  const reveal = tl.segs.find((g) => g.kind === "reveal" && g.beat === 0);
  expect(postsAt(s, tl, reveal.start - 1).some((p) => p.overall === 1)).toBe(false);
  expect(postsAt(s, tl, reveal.start + PACE[1].reveal - 1).some((p) => p.overall === 1)).toBe(true);
});

test("on the clock: the stream and the first pick set apart", async () => {
  // Stream at 5:45, Round 1 Pick 1 on the clock at 6:00 (minutes as ms here).
  const firstPick = 60 * 60000;
  const streamAt = 45 * 60000;
  const s = await buildShowScript({ data: data(), rounds: 1, seed: 3, startAt: startForFirstPick(firstPick), streamAt, id: "x" });
  expect(showTimes(s)).toEqual({ stream: streamAt, start: firstPick - INTRO_MS, firstPick });
  const tl = showTimeline(s);
  expect(momentAt(s, tl, streamAt).kind).toBe("preshow");
  expect(momentAt(s, tl, firstPick - 1).kind).toBe("intro");
  expect(momentAt(s, tl, firstPick)).toMatchObject({ kind: "clock", beatIdx: 0 });
  // A script without a stream time: the countdown's old 15 minutes.
  const { streamAt: _, ...old } = s;
  expect(showTimes(old).stream).toBe(s.startAt - PRESHOW_MS);
  expect(minutesBefore("21:00", 15)).toBe("20:45");
  expect(minutesBefore("00:10", 15)).toBe("23:55");
});

test("on the clock: the countdown's spotlights and the desk's pre-draft lines", async () => {
  const wr = { Position: "WR", stats: { lines: { receiving: { REC: 52, YDS: 984, TD: 12, YPR: 18.92 } }, leaders: [{ key: "rec", v: 52, rank: 1, tied: true }] } };
  expect(spotlightOf(wr)).toEqual({
    stats: [{ label: "Catches", v: "52" }, { label: "Rec Yds", v: "984" }, { label: "Rec TD", v: "12" }, { label: "Yds / Catch", v: "18.9" }],
    leader: { rank: 1, tied: true, stat: "receptions", v: "52" },
  });
  // Off the national tables: his school roster's season totals fill in.
  const edge = spotlightOf({ Position: "EDGE", stats: null }, { defensive: { TOT: 19, TFL: 6, SACKS: 3.5, "QB HUR": 1 } });
  expect(edge.stats).toEqual([{ label: "Tackles", v: "19" }, { label: "TFL", v: "6" }, { label: "Sacks", v: "3.5" }, { label: "QB Hurries", v: "1" }]);
  // Any line counts (no minimum); a back with no carries falls to his catches.
  expect(spotlightOf({ Position: "TE" }, { receiving: { REC: 11, YDS: 95, TD: 0, YPR: 8.6 } }).stats[0]).toEqual({ label: "Catches", v: "11" });
  expect(spotlightOf({ Position: "RB" }, { receiving: { REC: 9, YDS: 80 } }).stats[0]).toEqual({ label: "Catches", v: "9" });
  // Didn't play, or a lineman: none.
  expect(spotlightOf({ Position: "WR" }, { receiving: { REC: 0 } }).stats).toEqual([]);
  expect(spotlightOf({ Position: "OL" })).toEqual({ stats: [], leader: null });

  const s = await buildShowScript({ data: data(), rounds: 2, seed: 3, startAt: 0, id: "x" });
  expect(spotlights(s)).toBe(s.preshow.spotlight);
  // SPOTLIGHT of them, drawn from each position's top SPOTLIGHT_DEPTH — not
  // just the board's top — the same draw for the same seed.
  const topAtPos = new Set(Object.values(s.board).flatMap((l) => l.slice(0, SPOTLIGHT_DEPTH)));
  expect(s.preshow.spotlight.length).toBe(Math.min(SPOTLIGHT, topAtPos.size));
  expect(s.preshow.spotlight.every((x) => topAtPos.has(x.pid))).toBe(true);
  const ranks = s.preshow.spotlight.map((x) => s.players[x.pid].rank);
  expect(ranks).not.toEqual([...ranks].sort((a, b) => a - b));
  const again = await buildShowScript({ data: data(), rounds: 2, seed: 3, startAt: 0, id: "x" });
  expect(again.preshow.spotlight.map((x) => x.pid)).toEqual(s.preshow.spotlight.map((x) => x.pid));
  // A script from before spotlights: the same kind of draw from its board, no stats.
  const { preshow, ...old } = s;
  const fallback = spotlights(old);
  expect(fallback.length).toBe(s.preshow.spotlight.length);
  expect(fallback.every((x) => topAtPos.has(x.pid) && !x.stats.length)).toBe(true);

  const lines = pregamePosts(s);
  expect(lines.length).toBeGreaterThan(3);
  expect(lines.every((l) => s.analysts[l.a] && l.text)).toBe(true);
  expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
  // Nothing tells a pick: only the board's No. 1 is named, never who went where.
  const picked = s.beats.map((b) => s.players[b.pid]).filter((p) => p.rank !== 1).map((p) => `${p.f} ${p.l}`);
  expect(lines.some((l) => picked.some((n) => l.text.includes(n)))).toBe(false);
  expect(firstOnClock(s)).toBe(s.beats[0].trade ? s.beats[0].trade.from : s.beats[0].team);
});

test("on the clock: the countdown shows the admin's first-pick time, in Eastern", async () => {
  // As Admin → On the Clock generates a night: stream 5:45, first pick 6:00 PM ET —
  // on a daylight-time night and a standard-time one.
  for (const day of ["2026-10-30", "2026-12-04"]) {
    const noon = Date.parse(`${day}T12:00:00-05:00`);
    const s = await buildShowScript({ data: data(), rounds: 1, seed: 3, startAt: startForFirstPick(easternTime(noon, "18:00")), streamAt: easternTime(noon, "17:45"), id: day });
    const t = showTimes(s);
    expect(easternClock(t.firstPick)).toBe("6:00 PM ET");
    expect(easternClock(t.stream)).toBe("5:45 PM ET");
    expect(t.firstPick - t.stream).toBe(15 * 60000);
    // The desk's line says the same time.
    expect(pregamePosts(s).some((p) => p.text.includes("at 6:00 PM ET"))).toBe(true);
  }
});
