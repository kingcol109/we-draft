import { buildBoard } from "./engine";
import { buildShowScript, showTimeline, momentAt, postsAt, INTRO_MS, ROUND_BREAK_MS, PACE } from "./onTheClock";

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
