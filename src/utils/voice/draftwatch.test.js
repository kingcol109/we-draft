// The third batch (user, 2026-11-25): the 411, draft history, who to watch
// on a team, suggestions, "add him / them to my watchlist", a most dominant game.
import { respond, newState } from "./engine";
import { draftRows, decodeDraft } from "./draftRows";
import { parseDraftQuery, runDraftQuery } from "./draft";
import { teamSides, parseSuggest } from "./intentsWatch";

const HIST = decodeDraft(draftRows([
  { Year: "2007", Round: "1", Pick: "1", Player: "JaMarcus Russell", Position: "QB", School: "LSU", "NFL Team": "Las Vegas Raiders" },
  { Year: "2020", Round: "1", Pick: "1", Player: "Joe Burrow", Position: "QB", School: "LSU", "NFL Team": "Cincinnati Bengals" },
  { Year: "2009", Round: "1", Pick: "1", Player: "Matthew Stafford", Position: "QB", School: "Georgia", "NFL Team": "Detroit Lions" },
  { Year: "2019", Round: "1", Pick: "2", Player: "Nick Bosa", Position: "EDGE", School: "Ohio State", "NFL Team": "San Francisco 49ers" },
  { Year: "2025", Round: "1", Pick: "28", Player: "Tyleik Williams", Position: "DL", School: "Ohio State", "NFL Team": "Detroit Lions" },
  { Year: "2012", Round: "2", Pick: "40", Player: "Some Qb", Position: "QB", School: "LSU", "NFL Team": "Seattle Seahawks" },
  { Year: "2026", Round: "1", Pick: "1", Player: "Fernando Mendoza", Position: "QB", School: "Indiana", "NFL Team": "LV" },
  { Year: "2026", Round: "UDFA", Player: "Not Drafted", Position: "QB", School: "LSU" },
]));
const SCHOOLS = [...new Set(HIST.map((r) => r.school))];
const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "f", first: "Eli", last: "Finley", pos: "TE", school: "Louisiana Tech", cls: "2027" },
  { id: "q", first: "Keelon", last: "Russell", pos: "QB", school: "Alabama", cls: "2028" },
  { id: "l", first: "Jesse", last: "Legree", pos: "WR", school: "Oregon State", cls: "2029" },
];
const docOf = (p) => ({ id: p.id, First: p.first, Last: p.last, Position: p.pos, School: p.school, Eligible: p.cls, ...(p.id === "k" ? { Bio: "\"Kromah flipped to Florida State on signing day.\"" } : {}) });
function makeCtx(over = {}) {
  const saved = [];
  const evals = {};
  return {
    saved, uid: "me", random: () => 0,
    people: async () => people,
    player: async (id) => (people.find((p) => p.id === id) ? docOf(people.find((p) => p.id === id)) : null),
    draftHistory: async () => ({ rows: HIST, to: 2026 }),
    topProspects: async () => [{ id: "j", first: "Jeremiah", last: "Smith", pos: "WR", school: "Ohio State", cls: "2027" }],
    teams: async () => [{ school: "Louisiana Tech" }, { school: "Charlotte" }, { school: "Florida State" }],
    teamLeaders: async (school) => (school === "Louisiana Tech" ? [
      { cat: "passingYards", value: 2031, id: "1", name: "Blake Baker", pos: "QB", year: "Senior" },
      { cat: "receivingYards", value: 805, id: "2", name: "Jalen Mickens", pos: "WR", year: "Junior" },
    ] : school === "Charlotte" ? [{ cat: "totalTackles", value: 77, id: "3", name: "Kadin Schmitz", pos: "LB", year: "Junior" }] : []),
    classList: async (cls, pos) => people.filter((p) => p.cls === cls && p.pos === pos).map((p, i) => ({ id: p.id, first: p.first, last: p.last, school: p.school, classRank: 10 + i, grade: "Second Round" })),
    ranks: async (d) => (d.id === "k" ? { classRank: 24, positionRank: 3 } : null),
    myBoard: async () => Object.keys(evals).map((id) => ({ playerId: id, ...evals[id] })),
    myEval: async (id) => evals[id] || null,
    saveMyEval: async (d, next, extra) => { saved.push({ id: d.id, ...next, ...extra }); evals[d.id] = { ...next, ...extra }; },
    seasons: async (d) => (d.id === "k" ? { years: ["2026"], seasons: { 2026: { rushing: { rushingAttempts: 114, rushingYards: 609, rushingTouchdowns: 5 }, receiving: { receptions: 11, receivingYards: 97 } } }, career: {} }
      : d.id === "l" ? { years: ["2025", "2026"], seasons: {}, career: {} } : null),
    games: async (d, years) => (d.id === "l" ? [
      { id: "a", season: "2026", date: "2026-09-12T19:00:00Z", at: "vs", opp: "Texas Tech Red Raiders", oppRank: 13, result: "L", score: "35-24", line: { receiving: { receptions: 8, receivingYards: 240, receivingTouchdowns: 2 } } },
      { id: "b", season: "2025", date: "2025-10-04T19:00:00Z", at: "vs", opp: "Idaho Vandals", result: "W", score: "41-7", line: { receiving: { receptions: 5, receivingYards: 90, receivingTouchdowns: 1 } } },
    ].filter((g) => years.includes(g.season)) : []),
    logMiss: () => {},
    ...over,
  };
}
const ask = async (text, ctx = makeCtx(), st = newState()) => (await respond(text, st, ctx)).reply;

describe("the 411", () => {
  test.each(["who is Usman Chroma", "give me the 411 on kromah", "what do you know about Florida State's Ousmane Kromah"])("%s", async (q) => {
    expect((await ask(q)).say).toBe("Ousmane Kromah is a running back at Florida State in the 2028 draft class. He ran for 609 yards and 5 touchdowns on 114 carries in 2026, plus 11 catches for 97 yards. He's ranked 24th in the class, 3rd among running backs. Say \"read his bio\" for more.");
  });
  test("then his bio", async () => {
    const ctx = makeCtx();
    const st = (await respond("who is kromah", newState(), ctx)).state;
    expect((await ask("read his bio", ctx, st)).say).toBe("Kromah flipped to Florida State on signing day.");
  });
});

describe("the draft's history", () => {
  test("rows: the latest class's team abbreviation becomes its name; undrafted left out", () => {
    expect(HIST.find((r) => r.name === "Fernando Mendoza").team).toBe("Las Vegas Raiders");
    expect(HIST.some((r) => r.name === "Not Drafted")).toBe(false);
  });
  test("reading a question", () => {
    expect(parseDraftQuery("who went first overall in 2007", SCHOOLS)).toMatchObject({ pick: 1, years: [2007] });
    expect(parseDraftQuery("list all lsu second round quarterbacks", SCHOOLS)).toMatchObject({ school: "LSU", round: 2, pos: "QB" });
    expect(parseDraftQuery("ohio state first round defensive linemen", SCHOOLS)).toMatchObject({ school: "Ohio State", round: 1, pos: "DL", withEdge: true });
    expect(parseDraftQuery("earliest quarterback ever drafted from lsu", SCHOOLS)).toMatchObject({ pos: "QB", school: "LSU", sort: "best", one: true });
    expect(runDraftQuery(HIST, parseDraftQuery("earliest quarterback ever drafted from lsu", SCHOOLS))[0].name).toBe("JaMarcus Russell");
  });
  test.each([
    ["who went first overall in 2007", "JaMarcus Russell, quarterback out of LSU, went first overall in 2007 to the Las Vegas Raiders."],
    ["who was the number one pick in 2009", "Matthew Stafford, quarterback out of Georgia, went first overall in 2009 to the Detroit Lions."],
    ["who was the earliest quarterback ever drafted from LSU", "JaMarcus Russell, quarterback out of LSU, went first overall in 2007 to the Las Vegas Raiders."],
    ["can you list all LSU second round quarterbacks", "Some Qb, quarterback out of LSU, went 40th overall in 2012 to the Seattle Seahawks."],
    ["can you list all Ohio State first round defensive linemen", "2 defensive linemen from Ohio State in the first round: 2019, Nick Bosa, pick 2; 2025, Tyleik Williams, pick 28."],
    ["when was Joe Burrow drafted", "Joe Burrow, quarterback out of LSU, went first overall in 2020 to the Cincinnati Bengals."],
    ["who went first overall in 2027", "The 2027 draft hasn't happened yet. The top of We-Draft.com's 2027 board is Jeremiah Smith, wide receiver at Ohio State."],
  ])("%s", async (q, want) => expect((await ask(q)).say).toBe(want));
  test("every quarterback taken first overall", async () => {
    expect((await ask("can you list off all quarterbacks that have went first overall")).say).toBe("4 quarterbacks taken first overall: 2007, JaMarcus Russell, LSU; 2009, Matthew Stafford, Georgia; 2020, Joe Burrow, LSU; 2026, Fernando Mendoza, Indiana.");
  });
  test("a prospect isn't drafted yet; 'where did he go to high school' isn't the draft", async () => {
    expect((await ask("when was kromah drafted")).say).toBe("Ousmane Kromah hasn't been drafted yet. He's in the 2028 draft class.");
    expect((await ask("where did kromah go to high school")).say).not.toMatch(/draft/);
  });
});

describe("who to watch on a team, then add him", () => {
  test("the sides named", () => {
    expect(teamSides("i'm watching louisiana tech's offense is there anybody else on their offense or charlotte's defense that i should also watch", ["Louisiana Tech", "Charlotte"]))
      .toEqual([{ school: "Louisiana Tech", side: "offense" }, { school: "Charlotte", side: "defense" }]);
  });
  test("the answer, and 'add him to my watchlist'", async () => {
    const ctx = makeCtx();
    let out = await respond("I'm watching Louisiana Tech's offense. Is there anybody else on their offense or Charlotte's defense that I should also watch?", newState(), ctx);
    expect(out.reply.say).toBe("Louisiana Tech offense: on our board, Eli Finley, tight end, ranked 10th in the 2027 class. And producing this season: QB Blake Baker with 2,031 passing yards and WR Jalen Mickens with 805 receiving yards. Charlotte defense: producing this season: LB Kadin Schmitz with 77 tackles. Say \"add him to my watchlist\" to save Eli Finley.");
    out = await respond("can you add him to my watch list", out.state, ctx);
    expect(out.reply.say).toBe("Add Eli Finley to your watchlist?");
    out = await respond("yes", out.state, ctx);
    expect(ctx.saved[0]).toMatchObject({ id: "f", grade: "Watchlist", visibility: "private" });
  });
});

describe("suggestions", () => {
  test("what's asked", () => {
    expect(parseSuggest("2028 quarterback")).toMatchObject({ cls: "2028", pos: "QB" });
    expect(parseSuggest("true freshman")).toMatchObject({ year: "true freshman" });
    expect(parseSuggest("player")).toEqual({});
    expect(parseSuggest("pizza")).toBeNull();
  });
  test("a 2028 quarterback, then add him; 'another' when there's no one else", async () => {
    const ctx = makeCtx();
    let out = await respond("can you suggest the 2028 quarterback for me to watch", newState(), ctx);
    expect(out.reply.say).toMatch(/^Try Keelon Russell\. Keelon Russell is a quarterback at Alabama in the 2028 draft class\./);
    const st = out.state;
    out = await respond("add him to my watchlist", st, ctx);
    out = await respond("yes", out.state, ctx);
    expect(ctx.saved[0]).toMatchObject({ id: "q", grade: "Watchlist" });
    expect((await respond("another", st, ctx)).reply.say).toMatch(/couldn't find anyone new/);
  });
  test("a player for me to watch (anyone)", async () => {
    expect((await ask("suggest a player for me to watch")).say).toMatch(/^Try /);
  });
});

describe("a most dominant game", () => {
  test.each(["what was Jesse Legree's most dominant game", "what was the most dominant game for jesse legree", "what was legree's best game"])("%s", async (q) => {
    expect((await ask(q)).say).toMatch(/^Jesse Legree's (most dominant|biggest) game in 2025 to 2026: 8 catches, 240 receiving yards, 2 receiving touchdowns, vs #13 Texas Tech Red Raiders on Sep 12, 2026, L 35-24\.$/);
  });
});
