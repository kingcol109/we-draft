// /voice: the 2026-11-25 evening log, as whole families of questions.
import { respond, newState, understand } from "./engine";
import { parseRest } from "./intents";

const people = [
  { id: "jl", first: "Jesse", last: "Legree", pos: "WR", school: "Oregon State", cls: "2029" },
  { id: "ah", first: "Ashton", last: "Hampton", pos: "DB", school: "Clemson", cls: "2029" },
  { id: "kt", first: "Kamario", last: "Taylor", pos: "QB", school: "Mississippi State", cls: "2028" },
  { id: "kr", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "fsu1", first: "Ashton", last: "Daniels", pos: "QB", school: "Florida State", cls: "2027" },
];
const cfbd = [{ id: "cfbd_77", first: "Gio", last: "Lopez", pos: "QB", school: "Wake Forest", cfbd: "77", cfbdOnly: true }];
const docs = {
  fsu1: { id: "fsu1", First: "Ashton", Last: "Daniels", Position: "QB", School: "Florida State", Eligible: "2027", CareerStops: [{ School: "Stanford", From: 2022, To: 2024 }, { School: "Auburn", From: 2025, To: 2025 }, { School: "Florida State", From: 2026, To: 2026 }] },
  jl: { id: "jl", First: "Jesse", Last: "Legree", Position: "WR", School: "Oregon State", Eligible: "2029", HighSchool: "St Frances Academy", State: "Maryland" },
};
const roster = (school) => (school === "Oregon State" ? { school, teamId: 1, season: 2026, players: [{ id: "5", first: "Jesse", last: "Legree", pos: "WR", yr: 2026, rc: 2026, hs: "St Frances Academy", hsc: "Baltimore", hss: "MD", s: { receiving: { YDS: 1418 } } }] } : null);
const ctx = {
  people: async () => people,
  cfbdPeople: async () => cfbd,
  player: async (id) => docs[id] || null,
  cfbdRoster: async (s) => roster(s),
  teams: async () => [{ school: "Florida State", conference: "ACC", state: "FL" }, { school: "Virginia", conference: "ACC", state: "VA" }, { school: "Oregon State", conference: "Pac-12", state: "OR" }],
  schedule: async (season) => (season === 2026 ? [{ home: "Florida State", away: "Virginia", hp: 38, ap: 7, date: "2026-10-03T19:30:00Z" }] : []),
  liveSlate: async () => ({ season: 2026, seasonType: "regular", week: 2, games: [] }),
  liveWeek: async () => ({ games: [{ status: "final", home: { school: "Florida State", points: 31 }, away: { school: "Boston College", points: 10 }, venue: "Doak Campbell Stadium", venueCity: "Tallahassee", venueState: "FL" }] }),
  draftHistory: async () => ({ rows: [{ year: 2011, round: 1, pick: 1, name: "Cam Newton", pos: "QB", school: "Auburn", team: "Carolina Panthers" }, { year: 2023, round: 1, pick: 4, name: "Anthony Richardson", pos: "QB", school: "Florida", team: "Indianapolis Colts" }] }),
  combine: async (year) => (year === 2023 ? [{ name: "Anthony Richardson", school: "Florida", results: { height: 75.75, weight: 244, forty: 4.43, vertical: 40.5, broad: 129 } }] : []),
  seasons: async () => ({ years: ["2024", "2025", "2026"], seasons: { 2024: { rushing: { rushingTouchdowns: 3 } }, 2025: { rushing: { rushingTouchdowns: 2 } }, 2026: { rushing: { rushingTouchdowns: 13 } } }, career: {} }),
  isAdmin: true,
  pronMap: () => ({}),
};
const ask = (text, state = newState("general")) => respond(text, state, ctx);
const intentOf = (q, mode = "admin") => understand(q, mode)?.intent?.id;

test("\"the\" / \"you\" heard for \"him\": the last player", async () => {
  const st = { ...newState("general"), last: people[0] };
  for (const q of ["where did you go to high school", "what was the star rating", "what are the NFL comps", "what are some of his strengths"]) {
    const out = await respond(q, st, ctx);
    expect([q, out.reply.say]).not.toEqual([q, expect.stringMatching(/Which one|couldn't (?:match|find)|don't know who|didn't find/)]);
  }
});

test("NFL players by exact name: combine numbers, height, college", async () => {
  expect((await ask("what were Anthony Richardson's combine measurables")).reply.speak).toBe("At the 2023 Combine, Anthony Richardson measured 6 foot 3 and three quarters, 244 pounds, a 4.43 forty, a 40 and a half inch vertical and a 10 foot 9 broad jump.");
  expect((await ask("how tall is Anthony Richardson")).reply.speak).toBe("Anthony Richardson measured 6 foot 3 and three quarters at the 2023 Combine.");
  expect((await ask("what did Anthony Richardson run in the 40")).reply.speak).toBe("Anthony Richardson had a 4.43 forty at the 2023 Combine.");
  expect((await ask("where did Cam Newton go to college")).reply.speak).toBe("Cam Newton played college football at Auburn. The Carolina Panthers took him 1st overall in 2011.");
  ["how fast was Anthony Richardson at the combine", "Anthony Richardson's 40 time", "what was Anthony Richardson's vertical", "how did Anthony Richardson test at the combine"].forEach((q) => expect([q, intentOf(q)]).toEqual([q, "nfl.player"]));
});

test("an exact name off the board beats a loose board match", async () => {
  // Board: Ashton Hampton; the full name said is someone else (exact on CFBD).
  const out = await ask("what is Gio Lopez career path");
  expect(out.reply.say).not.toMatch(/Hampton/);
});

test("stats at a school he played for", async () => {
  expect(parseRest("in auburn")).toEqual({ seasons: "", opps: [], at: "auburn" });
  expect(parseRest("while he was at stanford")).toMatchObject({ at: "stanford" });
  expect(parseRest("in 2025")).toEqual({ seasons: "in 2025", opps: [] });
  const st = { ...newState("general"), last: people[4] };
  const out = await respond("how many rushing touchdowns did he have in Auburn", st, ctx);
  expect(out.reply.say).toMatch(/\b2\b/);
  expect(out.reply.say).toMatch(/Auburn/);
});

test("who won: that game, or any two schools", async () => {
  const st = { ...newState("general"), lastGame: { school: "Florida State", opp: "Virginia", at: "vs", result: "W", score: "38-7", date: "2026-10-03T19:30:00Z" } };
  for (const q of ["who won that game", "did they win", "what was the final score", "how did that game end"]) {
    expect([q, (await respond(q, st, ctx)).reply.speak]).toEqual([q, "Florida State won that one, 38 to 7 over Virginia on October 3rd."]);
  }
  for (const q of ["Florida State versus Virginia 2026 who won", "who won Florida State vs Virginia", "who won the Florida State Virginia game in 2026", "what was the score of Florida State and Virginia in 2026"]) {
    expect([q, (await ask(q)).reply.speak]).toEqual([q, "Florida State beat Virginia 38 to 7 at home on October 3rd."]);
  }
  expect((await ask("did Virginia beat Florida State")).reply.speak).toMatch(/^No\. Florida State beat Virginia/);
  expect((await ask("did Florida State beat Virginia")).reply.speak).toMatch(/^Yes\./);
});

test("where things are", async () => {
  for (const q of ["what city is Florida State in", "where is Florida State located", "where is Florida State's campus"]) {
    expect([q, (await ask(q)).reply.speak]).toEqual([q, "Florida State plays in Tallahassee, Florida, at Doak Campbell Stadium."]);
  }
  const st = { ...newState("general"), last: people[0] };
  for (const q of ["where in Maryland is Saint Francis Academy", "where is his high school", "what city is his high school in"]) {
    expect([q, (await respond(q, st, ctx)).reply.speak]).toEqual([q, "St Frances Academy is in Baltimore, Maryland. That's where Jesse Legree played high school ball."]);
  }
});

test("more ways to ask: my board, comps, scouting reports, what to watch, admin on /voice", () => {
  expect(intentOf("who is my number one rated quarterback")).toBe("board.mineTop");
  expect(intentOf("who is the highest quarterback I have on my 2028 board")).toBe("board.mineTop");
  expect(intentOf("who is the top quarterback in 2028")).not.toBe("board.mineTop");
  expect(intentOf("what is Kamario Taylor's NFL comparison")).toBe("player.comps");
  expect(intentOf("what are KJ Duff's NFL comparisons")).toBe("player.comps");
  expect(intentOf("what are the NFL comps")).toBe("player.comps");
  expect(intentOf("read me a scouting report on Jesse Legree")).toBe("player.bio");
  expect(intentOf("I'm watching Virginia football who should I watch")).toBe("watch.team");
  expect(intentOf("who should I watch in the Virginia game")).toBe("watch.team");
  expect(intentOf("who leads all true freshmen in passing yards in 2026")).toBe("leaders.stat");
  expect(intentOf("who leads sophomores in the SEC in rushing yards")).toBe("leaders.stat");
});

test("an admin's admin command on /voice runs", async () => {
  const out = await respond("mark that", newState("general"), ctx);
  expect(out.reply.say).toBe("There's no answer to mark yet.");
  const notAdmin = await respond("mark that", newState("general"), { ...ctx, isAdmin: false });
  expect(notAdmin.reply.say).toMatch(/admin command/);
});

test("a taught nickname never beats the exact name", async () => {
  const st = { ...newState("general"), aliases: { "ashton daniels": "ah" } };
  const out = await respond("what is Ashton Daniels career path", st, ctx);
  expect(out.reply.say).toMatch(/Ashton Daniels/);
  expect(out.reply.say).not.toMatch(/Hampton/);
});
