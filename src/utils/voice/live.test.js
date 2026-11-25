// Game day, compare, your top players, who's hot, follow-ups (user, 2026-11-25).
import { respond, newState, understand } from "./engine";
import { gameLine, boxLine, etDay } from "./intentsLive";
import { followUps } from "../../components/voice/VoiceStage";

// Games at midday / evening Eastern today, so "today" holds wherever the test runs.
const today = etDay(new Date());
const at = (hourEt) => new Date(`${today}T${String(hourEt + 5).padStart(2, "0")}:00:00Z`).toISOString(); // EST = UTC-5
const team = (school, short, points, rank = null) => ({ school, short, points, rank, logo: "", logoDark: "" });
const SLATE = {
  games: [
    { id: "g1", slug: "clemson-vs-florida-state", status: "in_progress", period: 3, clock: "8:12", startDate: at(12), home: team("Florida State", "FSU", 21), away: team("Clemson", "CLEM", 17, 12), tv: "ABC" },
    { id: "g2", slug: "lsu-vs-alabama", status: "scheduled", startDate: at(17), startTimeTBD: false, home: team("Alabama", "BAMA", null, 5), away: team("LSU", "LSU", null), tv: "ESPN" },
    { id: "g3", slug: "michigan-vs-ohio-state", status: "final", startDate: new Date(Date.now() - 3 * 86400000).toISOString(), home: team("Ohio State", "OSU", 31), away: team("Michigan", "MICH", 17) },
  ],
};
// A live game: the play-by-play's numbers (liveGames/{id}/box/live).
const LIVE = { g1: { players: { home: [
  { key: "999", name: "Ousmane Kromah", slug: "ousmane-kromah-2028-rb", stats: { rushing: { car: 18, yds: 112, td: 1 }, receiving: { rec: 3, yds: 24, td: 0 } } },
  { key: "4871013", name: "Gemari Sands", stats: { rushing: { car: 4, yds: 19, td: 0 } } },
  { key: "home|Jalen Edge", name: "Jalen Edge", stats: { defense: { sacks: 2 } } },
], away: [] } } };
// A final: the official box score (liveGames/{id}/box/players).
const BOX = { g3: { teams: [{ name: "Ohio State", players: [{ id: "77", name: "Old Buck", stats: { rushing: { CAR: "20", YDS: "140", TD: "2" } } }] }] } };
const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028", slug: "ousmane-kromah-2028-rb" },
  { id: "l", first: "Jesse", last: "Legree", pos: "RB", school: "Florida State", cls: "2027" },
  { id: "q", first: "Tommy", last: "Castellanos", pos: "QB", school: "Florida State", cls: "2027" },
  { id: "m", first: "Mike", last: "Matthews", pos: "WR", school: "Clemson", cls: "2027" },
];
const DOCS = {
  k: { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Slug: "ousmane-kromah-2028-rb" },
  l: { id: "l", First: "Jesse", Last: "Legree", Position: "RB", School: "Florida State", Eligible: "2027", Slug: "jesse-legree-2027-rb" },
  q: { id: "q", First: "Tommy", Last: "Castellanos", Position: "QB", School: "Florida State", Eligible: "2027" },
  m: { id: "m", First: "Mike", Last: "Matthews", Position: "WR", School: "Clemson", Eligible: "2027" },
  cfbd_4871013: { id: "cfbd_4871013", cfbdOnly: true, cfbd: "4871013", First: "Gemari", Last: "Sands", Position: "RB", School: "Florida State" },
};
const SEASONS = {
  k: { years: ["2026"], seasons: { 2026: { rushing: { rushingAttempts: 114, rushingYards: 609, rushingTouchdowns: 5 } } }, career: {} },
  l: { years: ["2026"], seasons: { 2026: { rushing: { rushingAttempts: 160, rushingYards: 980, rushingTouchdowns: 9 } } }, career: {} },
};
const ctxOf = (over = {}) => ({
  uid: "me",
  people: async () => people,
  teams: async () => [{ school: "Florida State", short: "FSU" }, { school: "Alabama" }, { school: "LSU" }, { school: "Ohio State" }, { school: "Clemson" }],
  cfbdPeople: async () => [{ id: "cfbd_4871013", first: "Gemari", last: "Sands", pos: "RB", school: "Florida State", cfbd: "4871013", cfbdOnly: true }],
  player: async (id) => DOCS[id] || null,
  seasons: async (d) => SEASONS[d.id] || null,
  games: async () => [],
  ranks: async () => null,
  classList: async () => [],
  liveSlate: async () => SLATE,
  liveBox: async (id) => BOX[id] || null,
  livePlayStats: async (id) => LIVE[id] || null,
  risers: async () => ({ players: [
    { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", type: "onFire", order: 0 },
    { id: "l", first: "Jesse", last: "Legree", pos: "RB", school: "Florida State", type: "breakout", order: 1 },
  ] }),
  myBoard: async () => [{ playerId: "k", grade: "Second Round" }, { playerId: "l", grade: "Early First Round" }, { playerId: "q", grade: "Third Round" }],
  logMiss: () => {},
  ...over,
});
const ask = async (t, ctx = ctxOf(), st = newState()) => (await respond(t, st, ctx)).reply;

describe("game day", () => {
  test("who's playing today: live first, then kickoffs; game cards and a link to /live", async () => {
    const r = await ask("who's playing today");
    expect(r.say).toMatch(/^2 games today, 1 live now\. Florida State leads Clemson 21 to 17 in the 3rd\. LSU at number 5 Alabama, \d+(?::\d\d)? PM on ESPN\. The most prospects: Clemson at Florida State, with 4 on the board\.$/);
    expect(r.games.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(r.links[0]).toEqual(expect.objectContaining({ to: "/live" }));
  });
  test("a team's score; a final; a team with no game", async () => {
    expect((await ask("what's the score of the florida state game")).say).toBe("Florida State leads Clemson 21 to 17 in the 3rd.");
    expect((await ask("did ohio state win")).say).toBe("Final: Ohio State 31, Michigan 17.");
    expect((await ask("how is fsu doing")).say).toBe("Florida State leads Clemson 21 to 17 in the 3rd.");
    expect((await ask("did lsu win")).say).toMatch(/^\w+day: LSU at number 5 Alabama/);
  });
  test("live stats: a board player and a CFBD-only one, by box score", async () => {
    const r = await ask("how is kromah doing today");
    expect(r.say).toBe("Ousmane Kromah has 112 rushing yards and a touchdown on 18 carries, and 3 catches for 24 yards. Florida State leads Clemson 21 to 17 in the 3rd.");
    expect(r.links[0].to).toBe("/live/clemson-vs-florida-state");
    expect((await ask("gemari sands stats today")).say).toMatch(/^Gemari Sands has 19 rushing yards on 4 carries\./);
    expect((await ask("is kromah playing today")).say).toMatch(/^Ousmane Kromah has 112 rushing yards/);
    expect((await ask("how is mike matthews doing today")).say).toMatch(/^I don't have stats for Mike Matthews in this game yet\./);
    expect(r.sub).toMatch(/Live · Clemson at Florida State · from the play-by-play/);
  });
  test("a defender during a game: sacks from the play-by-play, no made-up tackle count", async () => {
    const ctx = ctxOf({
      cfbdPeople: async () => [{ id: "cfbd_je", first: "Jalen", last: "Edge", pos: "EDGE", school: "Florida State", cfbdOnly: true }],
      player: async (id) => (id === "cfbd_je" ? { id, cfbdOnly: true, First: "Jalen", Last: "Edge", Position: "EDGE", School: "Florida State" } : DOCS[id] || null),
    });
    expect((await ask("how is jalen edge doing today", ctx)).say).toMatch(/^Jalen Edge has 2 sacks\./);
  });
  test("a final game: the official box score", async () => {
    const ctx = ctxOf({
      people: async () => [...people, { id: "ob", first: "Old", last: "Buck", pos: "RB", school: "Ohio State", cls: "2027" }],
      player: async (id) => (id === "ob" ? { id, First: "Old", Last: "Buck", Position: "RB", School: "Ohio State", Eligible: "2027" } : DOCS[id] || null),
    });
    expect((await ask("how did old buck do today", ctx)).say).toBe("Old Buck had 140 rushing yards and 2 touchdowns on 20 carries. Final: Ohio State 31, Michigan 17.");
  });
  test("lines and words", () => {
    expect(gameLine({ status: "in_progress", period: 5, home: team("A", "A", 7), away: team("B", "B", 7) })).toBe("B and A are tied at 7 in overtime");
    expect(boxLine({ passing: { "C/ATT": "20/31", YDS: "251", TD: "2", INT: "1" } }).said).toBe("20 of 31 passing for 251 yards, 2 touchdowns, 1 interception");
  });
});

describe("compare, your top players, who's hot", () => {
  test("two players side by side", async () => {
    const r = await ask("compare kromah and legree");
    expect(r.say).toBe("In 2026. Ousmane Kromah, 114 carries, 609 rushing yards, 5.3 yards per carry. Jesse Legree, 160 carries, 980 rushing yards, 6.1 yards per carry.");
    expect(r.compare.players.map((p) => p.id)).toEqual(["k", "l"]);
    expect((await ask("kromah vs legree")).compare).toBeTruthy();
    expect((await ask("who's better, kromah or legree")).compare).toBeTruthy();
  });
  test("your top player at a position; your top 2", async () => {
    expect((await ask("who's my top running back")).say).toBe("Your top running back is Jesse Legree, Florida State, with an early first round grade.");
    const r = await ask("who are my top 2 players");
    expect(r.say).toBe("Your top 2 players: 1, Jesse Legree, early first round and 2, Ousmane Kromah, second round.");
    expect(r.people.map((p) => p.id)).toEqual(["l", "k"]);
  });
  test("who's hot: the Draft Risers by label", async () => {
    const r = await ask("who's hot this week");
    expect(r.say).toBe("The 2027 Draft Risers. On Fire: Ousmane Kromah, Florida State. Breakout: Jesse Legree, Florida State.");
    expect(r.people).toHaveLength(2);
  });
});

describe("follow-up buttons", () => {
  test("each one asks what it says, for the player just shown", () => {
    const want = { "his stats": "stats.line", "his career path": "player.background", "his best game": "stats.max", "how is he doing today": "live.player", "his awards": "player.accolades", "how big is he": "player.measure", "where does he rank": "player.rank", "who does he compare to": "player.comps", "who's playing today": "live.today", "who's hot this week": "risers.hot" };
    Object.entries(want).forEach(([q, id]) => expect([q, understand(q, "general")?.intent?.id]).toEqual([q, id]));
  });
  test("they fit the answer: not the question just asked; no We-Draft-only ones for a CFBD player", () => {
    expect(followUps({ intent: "stats.line", player: { First: "A", Last: "B" } })).toEqual(["his career path", "his best game", "how is he doing today", "his awards"]);
    expect(followUps({ intent: "player.background", player: { First: "A", cfbdOnly: true } })).not.toContain("where does he rank");
    expect(followUps({ confirm: true, player: { First: "A" } })).toEqual([]);
  });
});

describe("top performers", () => {
  const PERF = {
    passing: [{ id: "555", name: "Cade Klubnik", slug: null, side: "away", stats: { att: 30, cmp: 21, yds: 288, td: 2, int: 0 }, v: 288, gameId: "g1" }],
    rushing: [
      { id: "999", name: "Ousmane Kromah", slug: "ousmane-kromah-2028-rb", side: "home", stats: { car: 18, yds: 112, td: 1 }, v: 112, gameId: "g1" },
      { id: "77", name: "Old Buck", slug: null, side: "home", stats: { car: 20, yds: 140, td: 2 }, v: 140, gameId: "g3" },
    ],
    receiving: [], defense: [],
  };
  const ctx = () => ctxOf({ livePerformances: async () => PERF });
  test("today's best line in each category (today's games first)", async () => {
    const r = await ask("who are the top performers today", ctx());
    expect(r.say).toBe("The top performers today. Passing: Cade Klubnik, Clemson, 21 of 30 passing for 288 yards, 2 touchdowns. Rushing: Ousmane Kromah, Florida State, 112 rushing yards and a touchdown on 18 carries.");
    expect(r.people.map((p) => p.id)).toEqual(["cfbd_555", "k"]);
  });
  test("this week: every game; prospects only: players on the board", async () => {
    expect((await ask("best stat lines this week", ctx())).say).toMatch(/Rushing: Ousmane Kromah/);
    expect((await ask("which prospects are playing well today", ctx())).say).toBe("The top performers among prospects today. Rushing: Ousmane Kromah, Florida State, 112 rushing yards and a touchdown on 18 carries.");
  });
  test("one game's leaders, from its play-by-play", async () => {
    const r = await ask("who's playing well in the florida state game", ctx());
    expect(r.say).toBe("The leaders in Clemson at Florida State. Rushing: Ousmane Kromah, Florida State, 112 rushing yards and a touchdown on 18 carries. Receiving: Ousmane Kromah, Florida State, 3 catches for 24 yards. Defense: Jalen Edge, Florida State, 2 sacks. Florida State leads Clemson 21 to 17 in the 3rd.");
    expect((await ask("the top performers", ctx())).say).toMatch(/^The top performers today\./);
  });
});

describe("many ways to ask", () => {
  test("the new questions, worded different ways", () => {
    const want = {
      "how's kromah playing": "live.player", "hows kromah doing": "live.player", "is kromah having a good game": "live.player", "update on kromah": "live.player",
      "kromah stats so far": "live.player", "what has kromah done tonight": "live.player",
      "who's balling today": "live.performers", "top performances this week": "live.performers", "who's going off in the alabama game": "live.performers", "alabama game leaders": "live.performers",
      "what channel is the alabama game on": "live.score", "who's winning the lsu game": "live.score", "how's the fsu game going": "live.score", "what time does lsu play": "live.score",
      "what's on tonight": "live.today", "anything live right now": "live.today", "whats the slate today": "live.today",
      "who's moving up draft boards": "risers.hot", "any breakouts": "risers.hot",
      "how does kromah compare to legree": "stats.compare", "put kromah against legree": "stats.compare",
      "does kromah have any awards": "player.accolades",
      "who do i have as my top running back": "board.mineTop", "who's number one on my board": "board.mineTop",
      "catch me up": "admin.readout", "what did i miss": "admin.readout",
    };
    Object.entries(want).forEach(([q, id]) => expect([q, understand(q, "admin")?.intent?.id]).toEqual([q, id]));
  });
});

describe("varied answers", () => {
  // The page varies wordings (ctx.vary) and never repeats one twice in a row.
  const varied = () => ({ ...ctxOf(), vary: true, memory: {}, random: (() => { let i = 0; return () => [0.1, 0.6, 0.9, 0.35][i++ % 4]; })() });
  const sayings = async (q, times, extra = {}) => {
    const ctx = { ...varied(), ...extra };
    const out = [];
    for (let i = 0; i < times; i += 1) out.push((await respond(q, newState("admin"), ctx)).reply.say); // eslint-disable-line no-await-in-loop
    return out;
  };
  const check = (said) => {
    said.slice(1).forEach((s, i) => expect(s).not.toBe(said[i]));
    expect(new Set(said).size).toBeGreaterThan(1);
  };
  test("a live line, a score, today's games, top performers, risers", async () => {
    check(await sayings("how is kromah doing today", 4));
    check(await sayings("what's the score of the florida state game", 4));
    check(await sayings("who's playing today", 3));
    check(await sayings("who are the top performers today", 3, { livePerformances: async () => ({ rushing: [{ id: "999", name: "Ousmane Kromah", slug: "ousmane-kromah-2028-rb", side: "home", stats: { car: 18, yds: 112, td: 1 }, v: 112, gameId: "g1" }] }) }));
    check(await sayings("who's hot this week", 3));
  });
  test("compare, your top player, a note", async () => {
    check(await sayings("compare kromah and legree", 3));
    check(await sayings("who's my top running back", 3));
    check(await sayings("admin note check the 2027 tight ends", 3, { addNote: async () => {} }));
  });
});
