import {
  railCards, railAt, closeGames, isFinalEntry, topPerformers, resultLine, playerOfGame, topPerformanceList, idleStories, nationalPhase, orderLive, scoreChanges, scoreSnapshot, NATIONAL_PROMOS,
  storylines, quietStory, eventForBigPlay, eventForNationalInsight, nationalInsights,
  queueBigPlays, playerLinesFor, leadersFromBox, performanceStories, spotlightCandidates, activeProspect,
  isGameday, gamedayGames, previewMatchups, gamedayStories, prospectsToWatch, untilText, teamLeaders, lastGameStories, lastFinal,
} from "./broadcastNational";

// utils/broadcast.js and utils/liveStats.mjs aren't loadable in this Jest
// setup (.mjs) — stand in the few things used here.
jest.mock("./liveStats", () => ({
  statLine: (cat, s) => {
    if (!s) return "";
    if (cat === "passing") return [`${s.cmp || 0}/${s.att}`, `${s.yds || 0} YDS`, s.td && `${s.td} TD`].filter(Boolean).join(" · ");
    if (cat === "rushing") return [`${s.car} CAR`, `${s.yds || 0} YDS`, s.td && `${s.td} TD`, s.long && `LONG ${s.long}`].filter(Boolean).join(" · ");
    if (cat === "receiving") return [`${s.rec} REC`, `${s.yds || 0} YDS`, s.td && `${s.td} TD`, s.long && `LONG ${s.long}`].filter(Boolean).join(" · ");
    return [s.sacks && `${s.sacks} SACKS`, s.int && `${s.int} INT`].filter(Boolean).join(" · ");
  },
}), { virtual: true });
jest.mock("./broadcast", () => ({
  featuredPlayer: (p) => {
    const pl = (p?.presentation?.line || []).find((t) => t.player)?.player;
    return pl ? { name: pl.name, slug: pl.wedraftSlug || null, cfbdId: pl.cfbdId || null } : null;
  },
  EVENT_MS: { TOUCHDOWN: 7500, FIELD_GOAL: 4800, SAFETY: 4800, INTERCEPTION: 5200, FUMBLE: 5200, TURNOVER_ON_DOWNS: 4600, BIG_PLAY: 5200, PLAYER_MILESTONE: 10000 },
}));

const NOW = Date.parse("2026-10-10T20:00:00Z");
const at = (h) => new Date(NOW + h * 3600e3).toISOString();
const team = (short, points = 0, rank = null) => ({ short, points, rank });
const game = (id, status, o = {}) => ({ id: String(id), status, startDate: at(0), home: team(`H${id}`), away: team(`A${id}`), ...o });

describe("orderLive", () => {
  it("puts the game of the week, then featured, then ranked games first", () => {
    const g = [
      game(1, "in_progress", { startDate: at(-2) }),
      game(2, "in_progress", { home: team("H2", 0, 12) }),
      game(3, "in_progress", { featured: true }),
      game(4, "in_progress", { gameOfWeek: true }),
      game(5, "in_progress", { away: team("A5", 0, 3) }),
      game(6, "final"),
    ];
    expect(orderLive(g).map((x) => x.id)).toEqual(["4", "3", "5", "2", "1"]);
  });
});

describe("the rail", () => {
  const live = (id, period, clock, h, a, o = {}) => game(id, "in_progress", { period, clock, home: team(`H${id}`, h), away: team(`A${id}`, a), ...o });
  it("close games are one score in the 4th or overtime, the nearest to its end first", () => {
    const g = [
      live(1, 4, "9:00", 21, 17),
      live(2, 4, "1:30", 10, 14),
      live(3, 5, "0:00", 24, 24), // overtime
      live(4, 4, "0:40", 35, 10), // blowout
      live(5, 3, "0:30", 7, 7), // 3rd quarter
      live(6, 4, "4:00", 30, 21), // 9 points: two scores
    ];
    expect(closeGames(g).map((x) => x.id)).toEqual(["3", "2", "1"]);
  });
  it("close games hold their slots; one slot turns over through the rest, then games just ended", () => {
    const g = [live(1, 4, "2:00", 21, 17), live(2, 4, "1:00", 10, 14), live(3, 4, "5:00", 3, 0),
      live(4, 2, "5:00", 7, 0), live(5, 1, "9:00", 0, 0), game(6, "final"), game(7, "final")];
    const finalAt = new Map([["6", NOW - 5 * 60e3], ["7", NOW - 20 * 60e3]]); // 7 ended too long ago
    const rail = railCards(g, NOW, finalAt);
    expect(rail.pinned.map((c) => c.game.id)).toEqual(["2", "1", "3"]);
    expect(rail.pool.map((c) => `${c.kind}:${c.game.id}`)).toEqual(["live:4", "live:5", "final:6"]);
    const turns = [0, 1, 2, 3].map((i) => railAt(rail, i).cards.map((c) => c.game.id).join(","));
    expect(turns).toEqual(["2,1,3,4", "2,1,3,5", "2,1,3,6", "2,1,3,4"]);
    expect(railAt(rail, 0).pages).toBe(3);
  });
  it("with only close games on: four fit and all hold; more, and the rest take turns in the last slot", () => {
    const four = [1, 2, 3, 4].map((i) => live(i, 4, `${i}:00`, 14, 10));
    expect(railAt(railCards(four, NOW), 0)).toMatchObject({ pages: 1 });
    expect(railCards(four, NOW).pinned).toHaveLength(4);
    const five = [...four, live(5, 4, "5:00", 14, 10)];
    const rail = railCards(five, NOW);
    expect(rail.pinned.map((c) => c.game.id)).toEqual(["1", "2", "3"]);
    expect([0, 1].map((i) => railAt(rail, i).cards.map((c) => c.game.id).join(","))).toEqual(["1,2,3,4", "1,2,3,5"]);
  });
  it("a short rail is topped up with the next kickoffs, then finals; nothing on → just those", () => {
    const g = [live(1, 2, "5:00", 7, 0), game(20, "scheduled", { startDate: at(2) }), game(21, "scheduled", { startDate: at(1) }),
      game(22, "scheduled", { startDate: at(-8) }), game(30, "final", { startDate: at(-3) })];
    const turn = railAt(railCards(g, NOW), 0);
    expect(turn.cards.map((c) => `${c.kind}:${c.game.id}`)).toEqual(["live:1", "upcoming:21", "upcoming:20", "final:30"]);
    expect(turn.pages).toBe(1);
    expect(railAt(railCards([], NOW), 0).cards).toEqual([]);
  });
});

describe("a game that just ended", () => {
  const g = game(9, "final", { home: team("LIB", 35), away: team("SHSU", 3), period: 4 });
  g.home.school = "Liberty";
  const leaders = {
    passing: [{ name: "Kaidon Salter", side: "home", stats: { cmp: 18, att: 24, yds: 260, td: 3 } }],
    rushing: [{ name: "Kam Davis", side: "home", stats: { car: 15, yds: 98, td: 2, long: 22 } }],
    receiving: [{ name: "Kaidon Salter", side: "home", stats: { rec: 1, yds: 5 } }],
  };
  it("takes a turn like a score: the FINAL graphic, then the result with its top performers", () => {
    // the ingester's feed entry (server/live/store.js finalFeedEntry)
    const f = { key: "9:final", gameId: 9, kinds: ["final"], homeScore: 35, awayScore: 3, presentation: { type: "final" } };
    expect(isFinalEntry(f)).toBe(true);
    expect(eventForBigPlay(f)).toMatchObject({ type: "END_OF_GAME", side: "home", gameId: "9" });
    expect(resultLine(g)).toBe("Liberty wins");
    expect(topPerformers(leaders).map((x) => `${x.name}: ${x.line}`)).toEqual(["Kaidon Salter: 18/24 · 260 YDS · 3 TD", "Kam Davis: 15 CAR · 98 YDS · 2 TD"]);
    expect(queueBigPlays([{ key: "a", kinds: ["big"] }, { key: "b", kinds: ["big"] }, { key: "c", kinds: ["big"] }], [f]).queue.map((x) => x.key)).toContain("9:final");
  });
});

describe("nationalPhase", () => {
  it("reports loading / empty / idle / live", () => {
    expect(nationalPhase({ ready: false, games: [] })).toBe("loading");
    expect(nationalPhase({ ready: true, games: [] })).toBe("empty");
    expect(nationalPhase({ ready: true, games: [game(1, "final")] })).toBe("idle");
    expect(nationalPhase({ ready: true, games: [game(1, "final"), game(2, "in_progress")] })).toBe("live");
  });
});

describe("scoreChanges", () => {
  it("flags only scores that went up in a live game, never on first snapshot", () => {
    const before = [game(1, "in_progress"), game(2, "in_progress", { home: team("H2", 7) }), game(3, "final")];
    expect(scoreChanges(null, before).size).toBe(0);
    const after = [
      game(1, "in_progress", { away: team("A1", 7) }),
      game(2, "in_progress", { home: team("H2", 0) }), // correction: down, not a score
      game(3, "final", { home: team("H3", 3) }),
    ];
    const c = scoreChanges(scoreSnapshot(before), after);
    expect([...c]).toEqual([["1", { side: "away", pts: 7 }]]);
  });
});

describe("storylines", () => {
  const live = (id, o) => game(id, "in_progress", o);
  it("flags upsets, crunch time, overtime and shootouts, most important first", () => {
    const s = storylines([
      live(1, { period: 3, clock: "8:00", home: team("IOWA", 14, 20), away: team("WASH", 21) }), // unranked leads #20
      live(2, { period: 4, clock: "2:00", home: team("A", 24), away: team("B", 20) }), // one score, 4th
      live(3, { period: 5, home: team("C", 31), away: team("D", 31) }), // OT
      live(4, { period: 3, clock: "1:00", home: team("E", 42), away: team("F", 35) }), // 77 points
      live(5, { period: 4, clock: "5:00", home: team("G", 42), away: team("H", 3) }), // nothing
      live(6, { period: 1, clock: "9:00", home: team("I", 0, 5), away: team("J", 7) }), // too early for an upset call
    ], NOW);
    expect(s.map((x) => x.chip)).toEqual(["Upset alert", "Overtime", "Crunch time", "Shootout"]);
    expect(s[0].text).toBe("WASH leads #20 IOWA 21–14 · Q3 8:00");
    expect(s[0].game.id).toBe("1");
  });
  it("a ranked team beaten by a much lower-ranked one is an upset; close ranks aren't", () => {
    expect(storylines([live(1, { period: 2, home: team("X", 0, 3), away: team("Y", 7, 13) })], NOW)).toHaveLength(1);
    expect(storylines([live(1, { period: 2, home: team("X", 0, 3), away: team("Y", 7, 9) })], NOW)).toHaveLength(0);
  });
  it("falls back to what's on or what's next", () => {
    expect(quietStory([live(1, {}), game(2, "scheduled", { startDate: at(2) })], NOW).text).toBe("1 game in progress · next kickoff A2 at H2");
    expect(quietStory([game(2, "scheduled", { startDate: at(2), tv: "ABC" })], NOW)).toMatchObject({ chip: "Up next", text: "A2 at H2 · ABC" });
    expect(quietStory([game(3, "final")], NOW).chip).toBe("Final");
  });
});

describe("eventForBigPlay", () => {
  const big = (o) => ({ key: "401:9", gameId: 401, creditSide: "home", offense: "home", period: 2, clock: "1:30",
    awayShort: "ARST", awayScore: 28, homeShort: "USA", homeScore: 34, kinds: [], tags: [], label: "", ...o });
  it("maps the slate's big plays to the game broadcast's graphics, with the game's score", () => {
    const td = eventForBigPlay(big({ kinds: ["score"], label: "Touchdown", presentation: { touchdown: true, line: [{ player: { name: "Jared Hollins" } }] } }));
    expect(td).toMatchObject({ type: "TOUCHDOWN", side: "home", gameId: "401", national: true, context: "ARST 28 – USA 34 · Q2 1:30", player: { name: "Jared Hollins" } });
    expect(eventForBigPlay(big({ kinds: ["score"], label: "Field goal", presentation: { type: "field_goal" } })).type).toBe("FIELD_GOAL");
    expect(eventForBigPlay(big({ kinds: ["turnover"], label: "Interception", presentation: { type: "interception" } })).type).toBe("INTERCEPTION");
    expect(eventForBigPlay(big({ kinds: ["turnover"], label: "Fumble", presentation: { type: "fumble" } })).type).toBe("FUMBLE");
    expect(eventForBigPlay(big({ kinds: ["big"], label: "Big reception", presentation: { type: "pass", yards: 35 } }))).toMatchObject({ type: "BIG_PLAY", yards: 35 });
  });
  it("skips a play wiped out by a flag", () => {
    expect(eventForBigPlay(big({ kinds: ["score"], presentation: { touchdown: true, nullified: true } }))).toBeNull();
  });
});

describe("insights across games", () => {
  it("fires only We-Draft prospects' moments and milestones; lists the newest across games", () => {
    expect(eventForNationalInsight({ id: "a", kind: "player", wd: { grade: "1st" } }, 7)).toMatchObject({ id: "ins-7-a", gameId: "7", type: "PLAYER_MILESTONE" });
    expect(eventForNationalInsight({ id: "b", kind: "player", milestone: true }, 7)).not.toBeNull();
    expect(eventForNationalInsight({ id: "c", kind: "player" }, 7)).toBeNull();
    expect(eventForNationalInsight({ id: "d", kind: "team" }, 7)).toBeNull();
    const docs = new Map([["1", { insights: [{ id: "x", at: 5 }, { id: "y", at: 9 }] }], ["2", { insights: [{ id: "z", at: 7 }] }]]);
    expect(nationalInsights(docs, 2).map((i) => `${i.game.id}:${i.insight.id}`)).toEqual(["1:y", "2:z"]);
  });
});

describe("big plays take turns", () => {
  const p = (key, score) => ({ key, kinds: score ? ["score"] : ["big"] });
  it("keeps every score; lets other plays go once more than three are waiting", () => {
    const { queue, dropped } = queueBigPlays([p("a", true), p("b")], [p("c", true), p("d"), p("e", true)]);
    expect(queue.map((x) => x.key)).toEqual(["a", "c", "e"]);
    expect(dropped.map((x) => x.key)).toEqual(["b", "d"]);
    expect(queueBigPlays([], [p("1", true), p("2", true), p("3", true), p("4", true), p("5", true)]).queue).toHaveLength(5);
  });
});

describe("players' numbers on a play", () => {
  const doc = {
    statLeaders: {
      passing: [{ id: 1, name: "Jared Hollins", side: "home", stats: { cmp: 6, att: 10, yds: 76, td: 1 } }],
      receiving: [{ id: 2, name: "Rod Gibbs", side: "home", stats: { rec: 2, yds: 16, td: 1, long: 9 } }, { id: 3, name: "Landan Brown", side: "away", stats: { rec: 2, yds: 20 } }],
      rushing: [{ id: 4, name: "Ajay Allen", slug: "ajay-allen-2027-rb", side: "away", stats: { car: 13, yds: 105, td: 2, long: 39 } }],
    },
  };
  const play = (type, detail, names) => ({ presentation: { type, detail, line: names.map((name, i) => ({ player: { name, cfbdId: null } })) } });
  it("a pass shows the passer's passing and the receiver's receiving, without LONG", () => {
    expect(playerLinesFor(play("pass", "7-yard TD pass", ["Jared Hollins", "Rod Gibbs"]), doc)).toEqual([
      { name: "Jared Hollins", slug: null, side: "home", cat: "passing", line: "6/10 · 76 YDS · 1 TD" },
      { name: "Rod Gibbs", slug: null, side: "home", cat: "receiving", line: "2 REC · 16 YDS · 1 TD" },
    ]);
  });
  it("a run shows rushing only — never another line of his", () => {
    expect(playerLinesFor(play("rush", "39-yard TD run", ["Ajay Allen"]), doc)[0].line).toBe("13 CAR · 105 YDS · 2 TD");
    expect(playerLinesFor(play("rush", "34-yard run", ["Landan Brown"]), doc)).toEqual([]);
  });
  it("the box doc stands in for a player outside the leaders", () => {
    const box = { players: { away: [{ key: "9", name: "Landan Brown", stats: { rushing: { car: 5, yds: 48 }, receiving: { rec: 2, yds: 20 } } }] } };
    expect(playerLinesFor(play("rush", "34-yard run", ["Landan Brown"]), leadersFromBox(box))[0]).toMatchObject({ cat: "rushing", line: "5 CAR · 48 YDS" });
  });
});

describe("prospects and big days", () => {
  const NOW_OCT = new Date(2026, 9, 8).getTime();
  it("a prospect is a linked player in a class still to be drafted", () => {
    expect(activeProspect("dj-crowther-2027-rb", NOW_OCT)).toBe(true);
    expect(activeProspect("amarion-peterson-2026-rb", NOW_OCT)).toBe(false);
    expect(activeProspect("someone-2026-qb", new Date(2026, 2, 1).getTime())).toBe(true); // before the 2026 draft
    expect(activeProspect(null, NOW_OCT)).toBe(false);
  });
  const docs = new Map([["7", {
    statLeaders: {
      rushing: [
        { id: 1, name: "D.J. Crowther", slug: "dj-crowther-2027-rb", side: "home", stats: { car: 13, yds: 105, td: 1 } },
        { id: 2, name: "A'Marion Peterson", slug: "amarion-peterson-2026-rb", side: "away", stats: { car: 4, yds: 61, td: 3 } },
        { id: 3, name: "Walk On", side: "away", stats: { car: 20, yds: 160 } },
        { id: 4, name: "Quiet Day", slug: "quiet-day-2028-rb", side: "away", stats: { car: 3, yds: 9 } },
      ],
    },
  }]]);
  const games = new Map([["7", { id: "7", status: "in_progress", period: 3, clock: "4:00", home: team("USF", 17), away: team("UTSA", 20) }]]);
  it("big days for the strip: prospects on a lower bar, everyone else on the full one", () => {
    const s = performanceStories(docs, games, NOW_OCT);
    expect(s.map((x) => `${x.chip}:${x.text.split(" (")[0]}`)).toEqual(["Prospect watch:D.J. Crowther", "Big day:A'Marion Peterson", "Big day:Walk On"]);
    expect(s[0].text).toBe("D.J. Crowther (USF) · 13 CAR · 105 YDS · 1 TD · Q3 4:00");
  });
  it("they join the strip between the game situations", () => {
    const g = [{ ...games.get("7"), period: 4, home: team("USF", 17), away: team("UTSA", 20) }];
    expect(storylines(g, NOW_OCT, performanceStories(docs, games, NOW_OCT)).map((x) => x.chip)).toEqual(["Crunch time", "Prospect watch", "Big day", "Big day"]);
  });
  it("spotlight candidates: active prospects with a real day, best first", () => {
    expect(spotlightCandidates(docs, games, NOW_OCT).map((c) => c.slug)).toEqual(["dj-crowther-2027-rb"]);
  });
});

describe("nothing on", () => {
  const NOW_OCT = new Date(2026, 9, 9, 8, 0).getTime();
  const finals = [game(1, "final", { startDate: at(-10), home: team("UTSA", 31), away: team("USF", 24) }),
    game(2, "final", { startDate: at(-12), home: team("IOWA", 10, 12), away: team("WASH", 20) })];
  const upcoming = [game(3, "scheduled", { startDate: new Date(NOW_OCT + 11 * 3600e3).toISOString() })];
  it("the rail turns through the week's finals only", () => {
    const rail = railCards([...finals, ...upcoming], NOW_OCT);
    expect(rail.pinned).toEqual([]);
    expect(rail.pool.map((c) => `${c.kind}:${c.game.id}`)).toEqual(["final:1", "final:2"]);
  });
  it("the rail shows the next kickoffs when nothing has finished yet", () => {
    expect(railCards(upcoming, NOW_OCT).pool.map((c) => `${c.kind}:${c.game.id}`)).toEqual(["upcoming:3"]);
  });
  it("player of the game: the winners' best line", () => {
    const leaders = {
      rushing: [{ name: "A'Marion Peterson", side: "home", stats: { car: 12, yds: 92, td: 3, long: 30 } }],
      passing: [{ name: "Loser QB", side: "away", stats: { cmp: 30, att: 40, yds: 400, td: 3 } }],
    };
    expect(playerOfGame(leaders, "home")).toEqual({ name: "A'Marion Peterson", slug: null, side: "home", lines: ["12 CAR · 92 YDS · 3 TD"] });
  });
  it("the week's top performances, best first, with their games", () => {
    const perf = {
      rushing: [{ id: 1, name: "A'Marion Peterson", side: "home", gameId: "1", stats: { car: 12, yds: 92, td: 3 } }],
      passing: [{ id: 2, name: "D. Prospect", slug: "d-prospect-2027-qb", side: "away", gameId: "1", stats: { cmp: 20, att: 30, yds: 250, td: 2 } }],
    };
    const games = new Map(finals.map((g) => [g.id, g]));
    const list = topPerformanceList(perf, games, NOW_OCT);
    expect(list.map((x) => `${x.name}:${x.catLabel}:${x.prospect}`)).toEqual(["A'Marion Peterson:Rushing:false", "D. Prospect:Passing:true"]);
    expect(list[0].game.id).toBe("1");
    const stories = idleStories([...finals, ...upcoming], list, NOW_OCT);
    expect(stories.map((x) => x.chip)).toEqual(["Next kickoff", "Upset", "Prospect watch", "This week"]);
    expect(stories[0].text).toBe("A3 at H3 · in 11h 0m");
    expect(stories[1].text).toBe("WASH took down #12 IOWA 20–10");
    expect(stories[3].text).toBe("2 games final · 1 still to play");
  });
});

describe("We-Draft Gameday", () => {
  // Saturday Oct 10, 2026 (EDT, UTC-4)
  const SAT_7AM = Date.parse("2026-10-10T11:00:00Z");
  const SAT_5AM = Date.parse("2026-10-10T09:00:00Z");
  const iso = (s) => new Date(Date.parse(s)).toISOString();
  const day = [
    game(1, "scheduled", { startDate: iso("2026-10-10T16:00:00Z") }), // noon ET
    game(2, "scheduled", { startDate: iso("2026-10-10T19:30:00Z"), home: team("H2", 0, 5), away: team("A2", 0, 9) }),
    game(3, "scheduled", { startDate: iso("2026-10-10T23:00:00Z"), gameOfWeek: true }),
    game(4, "scheduled", { startDate: iso("2026-10-17T16:00:00Z") }), // next week
    game(5, "final", { startDate: iso("2026-10-10T00:00:00Z") }), // Friday night ET
  ];

  it("is on Saturday from 6 AM ET until a game today starts", () => {
    expect(isGameday(day, SAT_7AM)).toBe(true);
    expect(isGameday(day, SAT_5AM)).toBe(false);
    // Friday night's final doesn't count against today
    const started = day.map((g) => (g.id === "1" ? { ...g, status: "in_progress" } : g));
    expect(isGameday(started, SAT_7AM)).toBe(false);
    // a lull after today's first game ended is the ordinary idle set-up
    const ended = day.map((g) => (g.id === "1" ? { ...g, status: "final" } : g));
    expect(isGameday(ended, Date.parse("2026-10-10T19:00:00Z"))).toBe(false);
    // not on a Friday — unless forced
    const fri = Date.parse("2026-10-09T15:00:00Z");
    expect(isGameday(day, fri)).toBe(false);
    expect(isGameday(day, fri, true)).toBe(true);
    expect(isGameday([], SAT_7AM, true)).toBe(false);
  });

  it("previews the next game day's games, marquee ones in kickoff order", () => {
    expect(gamedayGames(day, SAT_7AM).map((g) => g.id)).toEqual(["1", "2", "3"]);
    expect(previewMatchups(day, SAT_7AM, 2).map((g) => g.id)).toEqual(["2", "3"]);
    // a short day: everything
    expect(previewMatchups(day, SAT_7AM).map((g) => g.id)).toEqual(["1", "2", "3"]);
  });

  it("strip: the countdown, the game of the week, top 25 clashes, the day", () => {
    const s = gamedayStories(day, SAT_7AM);
    expect(s.map((x) => x.chip)).toEqual(["Kickoff in", "Game of the week", "Top 25 clash", "Today"]);
    expect(s[0].text).toMatch(/^5h · A1 at H1 · 12:00 PM ET/);
    expect(s[2].text).toMatch(/#9 A2 at #5 H2/);
    expect(s[3].text).toBe("3 games · 2 ranked teams in action · first kickoff 12:00 PM ET");
  });

  it("untilText and prospectsToWatch", () => {
    expect(untilText(45 * 60e3)).toBe("45 min");
    expect(untilText(200 * 60e3)).toBe("3h 20m");
    const list = [
      { name: "Old", cls: "2026", gradeAvg: 1 },
      { name: "B", cls: "2028", gradeAvg: null },
      { name: "A", cls: "2027", gradeAvg: 3.2 },
      { name: "C", cls: "2027", gradeAvg: 2.1 },
    ];
    expect(prospectsToWatch(list, SAT_7AM, 3).map((p) => p.name)).toEqual(["C", "A", "B"]);
  });
});

describe("teamLeaders", () => {
  it("each category's season leader from the roster doc", () => {
    const roster = { players: [
      { first: "Tommy", last: "Castellanos", pos: "QB", s: { passing: { YDS: "1834", TD: "14" }, rushing: { YDS: "310", TD: "4" } } },
      { first: "Gavin", last: "Sawchuk", pos: "RB", s: { rushing: { YDS: "512", TD: "6" }, receiving: { REC: "9", YDS: "80" } } },
      { first: "Duce", last: "Robinson", pos: "WR", slug: "duce-robinson-2027-wr", s: { receiving: { REC: "31", YDS: "602" } } },
      { first: "Stefon", last: "Thompson", pos: "LB", s: { defensive: { TOT: "44", TFL: "5.5", SACKS: "2.5" } } },
      { first: "Edwin", last: "Joseph", pos: "S", s: { defensive: { TOT: "30", SACKS: "1" }, interceptions: { INT: "1" } } },
    ] };
    const l = teamLeaders(roster);
    expect(l.passing).toMatchObject({ name: "Tommy Castellanos", line: "1,834 YDS · 14 TD" });
    expect(l.rushing).toMatchObject({ name: "Gavin Sawchuk", line: "512 YDS · 6 TD" });
    expect(l.receiving).toMatchObject({ name: "Duce Robinson", slug: "duce-robinson-2027-wr", line: "31 REC · 602 YDS" });
    expect(l.tackles.line).toBe("44 TKL · 5.5 TFL");
    expect(l.sacks).toMatchObject({ name: "Stefon Thompson", line: "2.5 SACKS" });
    expect(l.interceptions.line).toBe("1 INT");
    expect(teamLeaders({ players: [] }).passing).toBeNull();
  });
});

describe("lastGameStories", () => {
  const doc = {
    id: "401858248", status: "final", startDate: "2026-10-03T19:30:00Z",
    home: { providerTeamId: 103, short: "BC", points: 24 }, away: { providerTeamId: 97, short: "LOU", points: 38 },
    statLeaders: {
      passing: [{ id: "1", name: "Ashton Daniels", slug: "ashton-daniels-2026-qb", side: "away", stats: { cmp: 24, att: 31, yds: 287, td: 5 } },
        { id: "9", name: "Other QB", side: "home", stats: { cmp: 30, att: 40, yds: 350, td: 2 } }],
      rushing: [{ id: "2", name: "Isaac Brown", side: "away", stats: { car: 18, yds: 142, td: 1, long: 40 } }],
      receiving: [{ id: "3", name: "Chris Bell", side: "away", stats: { rec: 4, yds: 61, td: 2 } }],
      defense: [{ id: "4", name: "Clev Lubin", slug: "clev-lubin-2027-edge", side: "away", stats: { sacks: 2.5 } }],
    },
  };
  it("a team's big lines from its last game, best first, with the result", () => {
    const s = lastGameStories(doc, 97, NOW, 3);
    expect(s.map((x) => [x.name, x.headline])).toEqual([["Ashton Daniels", "5 passing TDs"], ["Isaac Brown", "142 rushing yards"], ["Chris Bell", "2 receiving TDs"]]);
    expect(s[0].line).toBe("24/31 · 287 YDS · 5 TD");
    expect(s[0].ctx).toBe("Last game · W 38–24 at BC");
    expect(s[1].line).toBe("18 CAR · 142 YDS · 1 TD");
    expect(lastGameStories(doc, 97, NOW, 5).find((x) => x.name === "Clev Lubin")).toMatchObject({ headline: "2.5 sacks", prospect: true });
    // the other side's lines aren't this team's
    expect(lastGameStories(doc, 103, NOW).map((x) => x.headline)).toEqual(["350 passing yards"]);
    expect(lastGameStories(null, 97)).toEqual([]);
  });
  it("lastFinal: the latest final with stat lines", () => {
    const old = { ...doc, startDate: "2026-09-26T19:30:00Z" };
    const noStats = { ...doc, startDate: "2026-10-04T19:30:00Z", statLeaders: null };
    const later = { ...doc, status: "scheduled", startDate: "2026-10-09T23:00:00Z" };
    expect(lastFinal([old, doc, noStats, later], NOW)).toBe(doc);
  });
});

describe("NATIONAL_PROMOS", () => {
  it("the national ticker is site promos only — never a score or kickoff", () => {
    expect(NATIONAL_PROMOS.length).toBeGreaterThan(3);
    for (const p of NATIONAL_PROMOS) {
      expect(p.tag).toBeNull();
      expect(p.url).toMatch(/^we-draft\.com/);
    }
  });
});
