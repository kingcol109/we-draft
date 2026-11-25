// The user's list of questions (2026-11-25), each with a few other ways of
// asking it, against fake data shaped like the real records.
import { respond, newState } from "./engine";

const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "j1", first: "Jeremiah", last: "Smith", pos: "WR", school: "Ohio State", cls: "2027" },
  { id: "j2", first: "Jaylen", last: "Smith", pos: "CB", school: "LSU", cls: "2027" },
  { id: "s", first: "Samuel", last: "Singleton Jr", pos: "RB", school: "Florida State", cls: "2028" },
];
const KROMAH = { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Height: "6'1\"", Weight: "215", RecruitYear: "2025", HighSchool: "Lee County", State: "Georgia", CareerStops: [{ School: "Florida State", From: 2025, To: 2026 }], RecruitStars: 4, RecruitRank: 76, Birthday: "U", Slug: "ousmane-kromah-2028-rb" };
const game = (id, season, week, opp, abbr, car, yds, td, date) => ({
  id, season, week, at: "vs", opp, oppAbbr: abbr, result: "W", score: "31-17", date,
  line: { rushing: { rushingAttempts: car, rushingYards: yds, rushingTouchdowns: td }, receiving: { receptions: 1, receivingYards: 5, receivingTouchdowns: 0 } },
});
const GAMES = [
  game("g1", "2025", 1, "Alabama Crimson Tide", "ALA", 10, 50, 0, "2025-08-30T19:30:00Z"),
  game("g2", "2025", 2, "Ohio State Buckeyes", "OSU", 20, 160, 2, "2025-09-06T19:30:00Z"),
  game("g3", "2025", 3, "Ohio Bobcats", "OHIO", 15, 90, 1, "2025-09-13T19:30:00Z"),
  game("g4", "2026", 1, "LSU Tigers", "LSU", 10, 30, 0, "2026-09-05T19:30:00Z"),
];

function makeCtx() {
  const saved = [];
  const logged = [];
  let mine = { grade: "Early First Round", strengths: ["Vision", "Burst"], weaknesses: ["Pass Protection"], nflFit: "New York Jets", evaluation: "• Patient runner with real burst.", visibility: "public", gameNotes: [{ gameId: "fsu-ala", opponent: "Alabama", dateMs: 2, tag: "Great", note: "Ran hard." }] };
  const row = (id) => people.find((p) => p.id === id);
  return {
    saved, logged, uid: "me",
    people: async () => people,
    player: async (id) => (id === "k" ? KROMAH : row(id) && { id, First: row(id).first, Last: row(id).last, Position: row(id).pos, School: row(id).school, Eligible: row(id).cls }),
    setPlayer: async () => {},
    filmPlays: async () => [],
    seasons: async () => ({
      years: ["2025", "2026"],
      seasons: { 2025: { rushing: { rushingAttempts: 45, rushingYards: 300, rushingTouchdowns: 3 } }, 2026: { rushing: { rushingAttempts: 10, rushingYards: 30, rushingTouchdowns: 0 } } },
      career: { rushing: { rushingAttempts: 55, rushingYards: 330, rushingTouchdowns: 3 } },
    }),
    games: async (_p, years) => GAMES.filter((g) => !years || years.includes(g.season)),
    ranks: async () => ({ classRank: 12, positionRank: 2, classSize: 300, grade: "Second Round" }),
    publicEvals: async () => ({ count: 3, list: [{ author: "Scout1", verified: true, grade: "Second Round", evaluation: "Patient runner." }], all: [
      { strengths: ["Vision", "Burst"], weaknesses: ["Pass Protection"], nflFit: "New York Jets" },
      { strengths: ["Vision"], weaknesses: ["Ball Security"], nflFit: "New York Jets" },
      { grade: "Watchlist" },
    ] }),
    traits: async () => ["Vision", "Burst", "Ball Security", "Patience", "Pass Protection"],
    gradeLocked: () => false,
    myEval: async () => mine,
    saveMyEval: async (_d, next, extra = {}) => { saved.push({ ...next, ...extra }); mine = { ...mine, ...next, ...extra }; },
    saveGameNotes: async (_d, notes) => { saved.push({ gameNotes: notes }); mine = { ...mine, gameNotes: notes }; },
    myBoard: async () => [
      { playerId: "k", grade: "Early First Round" }, { playerId: "s", grade: "Late First Round" }, { playerId: "j1", grade: "Early First Round" }, { playerId: "j2", grade: "Second Round" },
    ],
    classList: async (_cls, pos) => (pos === "RB" ? [
      { id: "k", first: "Ousmane", last: "Kromah", school: "Florida State", grade: "Early First Round", classRank: 3 },
      { id: "s", first: "Samuel", last: "Singleton Jr", school: "Florida State", grade: "Second Round", classRank: 40 },
    ] : []),
    comps: async () => [{ name: "Bijan Robinson", year: "2023", round: "1", school: "Texas", match: 88 }, { name: "Breece Hall", year: "2022", round: "2", school: "Iowa State", match: 84 }],
    schoolGames: async () => [{ id: "fsu-mia", opponent: "Miami", dateMs: Date.UTC(2026, 9, 17) }, { id: "fsu-ala", opponent: "Alabama", dateMs: Date.UTC(2026, 8, 19) }],
    schedule: async (y) => (y === 2026 ? [
      { home: "Florida State", away: "Alabama", hp: 36, ap: 50, date: "2026-09-19" },
      { home: "Florida State", away: "SMU", hp: 24, ap: 27, date: "2026-09-07" },
      { home: "Louisville", away: "Florida State", hp: 44, ap: 20, date: "2026-10-09" },
      { home: "Florida State", away: "Central Arkansas", hp: 34, ap: 7, date: "2026-09-26" },
      { home: "Florida", away: "Florida State", hp: null, ap: null, date: "2026-11-28" },
    ] : []),
    logMiss: (e) => { logged.push(e); },
  };
}
const ask = async (text, ctx = makeCtx(), st = newState()) => (await respond(text, st, ctx)).reply;

describe("your evaluation, read back", () => {
  test.each([
    "what's my round grade on Usman Chroma",
    "how do I have Usman Chroma listed",
    "what grade did I give Kromah",
    "where do I have Florida State's Ousmane Kromah",
  ])("%s", async (q) => expect((await ask(q)).say).toBe("You have Ousmane Kromah as an early first round grade."));
  test("read off my evaluation — the written part too", async () => {
    expect((await ask("can you read off my evaluation for Usman Chroma")).say).toMatch(/^Your evaluation of Ousmane Kromah\. Grade: Early First Round\. Strengths: Vision, Burst\..*Patient runner with real burst\./);
  });
  test("my strengths / my fit", async () => {
    expect((await ask("what are my strengths for kromah")).say).toBe("Your Ousmane Kromah strengths: Vision, Burst.");
    expect((await ask("what's my nfl fit for kromah")).say).toBe("You have Ousmane Kromah fitting with the New York Jets.");
  });
});

describe("the community's evaluations", () => {
  test.each([
    "what are public strengths and weaknesses listed for Usman Chroma",
    "what are the strengths and weaknesses for kromah",
    "kromah's strengths and weaknesses",
  ])("%s", async (q) => expect((await ask(q)).say).toBe("The community's strengths for Ousmane Kromah: Vision, 100% and Burst, 50%. Weaknesses: Pass Protection, 50% and Ball Security, 50%. From 2 evaluations."));
  test("only weaknesses / fits", async () => {
    expect((await ask("what do people not like about kromah")).say).toMatch(/^Weaknesses: Pass Protection/);
    expect((await ask("what nfl teams do people think kromah fits")).say).toMatch(/^Top NFL fits for Ousmane Kromah: the New York Jets/);
  });
  test("read off public evaluations", async () => {
    expect((await ask("can you read off public evaluations for Usman Chroma")).say).toMatch(/^1 public evaluation of Ousmane Kromah\. From Scout1/);
  });
  test.each(["does Usman Chroma have any NFL comparisons", "what are some NFL comparisons for Usman Chroma", "who does kromah compare to", "kromah's comps"])("%s", async (q) => {
    expect((await ask(q)).say).toBe("The closest NFL comparisons for Ousmane Kromah: Bijan Robinson, 2023 round 1 out of Texas and Breece Hall, 2022 round 2 out of Iowa State.");
  });
});

describe("stats, games, records", () => {
  test("against a team in a season", async () => {
    expect((await ask("how many rushing yards did Usman Chroma have against Ohio State in 2025")).say).toBe("Ousmane Kromah: 160 rushing yards, vs Ohio State Buckeyes.");
  });
  test.each(["how many rushing yards did Usman Chroma finish with in 2025", "how many rushing yards did kromah finish 2025 with", "how many rushing yards did kromah end the season with in 2025"])("%s", async (q) => {
    expect((await ask(q)).say).toBe("Ousmane Kromah: 300 rushing yards, 2025.");
  });
  test("most / least in a game", async () => {
    expect((await ask("what game did Usman Chroma have the most rushing yards in 2025")).say).toMatch(/^Ousmane Kromah's most rushing yards in 2025: 160 rushing yards, vs Ohio State Buckeyes/);
    const ctx = makeCtx();
    const st = (await respond("tell me about kromah", newState(), ctx)).state;
    expect((await ask("which game did he have the least amount of rushing yards in 2025", ctx, st)).say).toMatch(/fewest rushing yards in 2025: 50 rushing yards, vs Alabama/);
    expect((await ask("what was kromah's best rushing game in 2025")).say).toMatch(/most rushing yards in 2025: 160/);
  });
  test("how did he play — just the numbers", async () => {
    expect((await ask("how did kromah play against alabama")).say).toMatch(/vs Alabama Crimson Tide, W 31-17: 10 carries, 50 rushing yards/);
  });
  test.each(["what was Florida State's record in 2026", "what's FSU's record", "how many games did florida state win in 2026", "how did florida state do in 2026"])("%s", async (q) => {
    expect((await ask(q)).say).toBe("Florida State is 1 and 3 in 2026, with 1 game left on the schedule. They lost their last game, 44-20 at Louisville.");
  });
});

describe("a player's background", () => {
  test.each([
    ["can you read off what is Usman Chroma's career path", "Ousmane Kromah's path: Lee County in Georgia, class of 2025, then Florida State, 2025 to 2026."],
    ["where has kromah played", "Ousmane Kromah's path: Lee County in Georgia, class of 2025, then Florida State, 2025 to 2026."],
    ["did Usman Chroma transfer to Florida State from anywhere", "No. Florida State is Ousmane Kromah's only college stop, since 2025."],
    ["is kromah a transfer", "No. Florida State is Ousmane Kromah's only college stop, since 2025."],
    ["what high school did Usman Chroma go to", "Ousmane Kromah went to Lee County in Georgia, class of 2025."],
    ["where did kromah go to high school", "Ousmane Kromah went to Lee County in Georgia, class of 2025."],
    ["what year did Usman Chroma graduate high school in", "Ousmane Kromah graduated high school in 2025. He's in the 2025 recruiting class."],
    ["how many stars was kromah", "Ousmane Kromah was a 4-star recruit, number 76 nationally, in the class of 2025 out of Lee County."],
  ])("%s", async (q, want) => expect((await ask(q)).say).toBe(want));
  test("years in college (asked as 'of high school' too)", async () => {
    expect((await ask("how many years of high school does Usman Chroma have")).say).toMatch(/^Ousmane Kromah is in his (first|second) college season/);
    expect((await ask("how many years has kromah been in college")).say).toMatch(/college season/);
  });
  test("age, estimated without a birthday", async () => {
    expect((await ask("how old is Usman Chroma")).say).toMatch(/^Ousmane Kromah is about \d+\. I don't have his birthday/);
  });
  test("eligibility left", async () => {
    expect((await ask("how many years of eligibility does Usman Chroma have left")).say).toMatch(/Ousmane Kromah (has \d seasons? of college eligibility left|will have no college eligibility)/);
  });
});

describe("your board, and the community's", () => {
  test.each([
    ["how many running backs do I have with a first-round grade on them", "You have 2 running backs with a first round grade."],
    ["how many running backs do I have with an early first-round grade", "You have 1 running back with an early first round grade."],
    ["how many first round running backs do I have", "You have 2 running backs with a first round grade."],
  ])("%s", async (q, want) => expect((await ask(q)).say).toBe(want));
  test("read them off", async () => {
    expect((await ask("can you read off the running backs that I have listed as an early first-round grade")).say).toBe("You have 1 running back with an early first round grade: Ousmane Kromah.");
    expect((await ask("who are my first round running backs")).say).toBe("You have 2 running backs with a first round grade: Ousmane Kromah, early first round and Samuel Singleton Jr, late first round.");
  });
  test("the community's", async () => {
    expect((await ask("can you read off first-round grade running backs according to We-Draft.com in 2028")).say).toBe("The community has 1 running back in the 2028 class with a first round grade: Ousmane Kromah.");
    expect((await ask("who is the top running back in 2028")).say).toBe("The top running back in the 2028 class on We-Draft.com: Ousmane Kromah, Florida State.");
  });
});

describe("game notes", () => {
  test("write that he had a great game against Alabama", async () => {
    const ctx = makeCtx();
    let out = await respond("write that Usman Chroma had a great game against Alabama in my notes", newState(), ctx);
    expect(out.reply.say).toBe("Replace your note on Ousmane Kromah for the Alabama game, tagged Great: \"Had a great game against alabama.\"?");
    out = await respond("yes", out.state, ctx);
    expect(ctx.saved[ctx.saved.length - 1].gameNotes.find((n) => n.gameId === "fsu-ala")).toMatchObject({ tag: "Great", note: "Had a great game against alabama." });
  });
  test("no team named: his latest game", async () => {
    expect((await ask("note kromah struggled in pass protection")).say).toMatch(/^Add a note on Ousmane Kromah for his last game, Miami game on Oct 1\d, tagged Bad/);
  });
  test("read them back", async () => {
    expect((await ask("read my notes on kromah")).say).toBe("1 game note on Ousmane Kromah. Alabama, Great: Ran hard.");
  });
});
