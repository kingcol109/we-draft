// Following the conversation (user, 2026-11-26, after a night of play-testing):
//   - "he will introduce the player fine, user asks for his stats, and he doesn't know how to respond"
//   - "if something sounds like the name after it is talking about that player already, it should
//     be easier to pick that up"
//   - "it will go 'did you mean one of these' without saying who … the voice should exist on its
//     own, the screen exists only as a supplement"
//   - "the time it waits after the last word needs to be longer. it cuts the user off too often"
// Plus the families still missed in that night's voiceLog.
import { respond, newState, topicAsk, didYouMean } from "./engine";
import { looseScore, recentPlayer } from "./names";
import { forSpeech } from "./spoken";
import { quietFor, QUIET_MS } from "./speech";
import { jerseyWord } from "./intentsLeaders";
import { parseRest } from "./intents";
import { etDay } from "./intentsLive";

const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" },
  { id: "e", first: "Evan", last: "Tengesdahl", pos: "OL", school: "Cincinnati", cls: "2027" },
  { id: "g", first: "Gunner", last: "Stockton", pos: "QB", school: "Georgia", cls: "2027" },
  { id: "ij", first: "Isaiah", last: "Johnson", pos: "CB", school: "Ohio State", cls: "2027" },
  { id: "m", first: "Malachi", last: "Henry", pos: "WR", school: "Cincinnati", cls: "2027" },
];
const KROMAH = {
  id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Height: "6'1\"", Weight: "215",
  RecruitYear: "2025", HighSchool: "Lee County", State: "Georgia", Hometown: "Leesburg, GA", CareerStops: [{ School: "Florida State", From: 2025, To: 2026 }], RecruitStars: 4, RecruitRank: 76, Birthday: "U",
};
const HENRY = {
  id: "m", First: "Malachi", Last: "Henry", Position: "WR", School: "Cincinnati", Eligible: "2027", RecruitYear: "2023", HighSchool: "Van Buren", State: "Arkansas", Hometown: "Van Buren, AR",
  CareerStops: [{ School: "Central Arkansas", From: 2023, To: 2025 }, { School: "Cincinnati", From: 2026, To: 2026 }], RecruitStars: 3,
};
const docOf = (id) => {
  if (id === "k") return KROMAH;
  if (id === "m") return HENRY;
  const p = people.find((x) => x.id === id) || (id === "cfbd_9" ? { id, first: "Isaiah", last: "Johnson", pos: "WR", school: "Cincinnati" } : null);
  return p && { id, First: p.first, Last: p.last, Position: p.pos, School: p.school, Eligible: p.cls, ...(id.startsWith("cfbd_") ? { cfbdOnly: true } : {}) };
};
const g = (id, season, date, opp, yds) => ({ id, season, date, at: "vs", opp, oppAbbr: opp.slice(0, 3).toUpperCase(), result: "W", score: "31-17", line: { rushing: { rushingAttempts: 15, rushingYards: yds, rushingTouchdowns: 1 } } });
const GAMES = [g("a", "2026", "2026-09-05T19:30:00Z", "LSU Tigers", 40), g("b", "2026", "2026-11-21T19:30:00Z", "Florida Gators", 133)];
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString();
const SLATE = {
  season: 2026, seasonType: "regular", week: 14,
  games: [
    { id: "t1", status: "scheduled", startDate: day(1), home: { school: "Florida State" }, away: { school: "Florida" } },
    { id: "t2", status: "scheduled", startDate: day(1), home: { school: "Georgia" }, away: { school: "Georgia Tech" } },
  ],
};
const LAST_WEEK = { games: [
  { id: "p1", status: "final", startDate: "2026-11-21T19:00:00Z", home: { school: "Florida State", points: 31 }, away: { school: "Georgia", points: 28 } },
  { id: "p2", status: "final", startDate: "2026-11-21T23:00:00Z", home: { school: "Cincinnati", points: 45 }, away: { school: "Ohio State", points: 10 } },
] };

const ctxOf = (over = {}) => ({
  uid: "me",
  people: async () => people,
  teams: async () => [{ school: "Florida State" }, { school: "Cincinnati" }, { school: "Georgia" }, { school: "West Virginia" }, { school: "Florida" }, { school: "Georgia Tech" }],
  cfbdPeople: async () => [],
  player: async (id) => docOf(id),
  seasons: async () => ({ years: ["2025", "2026"], seasons: { 2025: { rushing: { rushingAttempts: 40, rushingYards: 300, rushingTouchdowns: 3 } }, 2026: { rushing: { rushingAttempts: 30, rushingYards: 173, rushingTouchdowns: 2 } } }, career: { rushing: { rushingAttempts: 70, rushingYards: 473, rushingTouchdowns: 5 } } }),
  comps: async () => [{ name: "Bijan Robinson", year: "2023", round: "1", school: "Texas", match: 88 }],
  games: async (_d, years) => GAMES.filter((x) => !years || years.includes(x.season)),
  ranks: async () => ({ classRank: 12, positionRank: 2, classSize: 300 }),
  publicEvals: async () => ({ count: 1, list: [{ author: "Scout1", verified: true, grade: "Second Round", evaluation: "Patient runner." }], all: [{ strengths: ["Vision"], weaknesses: ["Pass Protection"] }] }),
  myEval: async () => ({ grade: "Early First Round", evaluation: "Runs hard." }),
  cfbdRoster: async (school) => (school === "Cincinnati" ? { teamId: 1, players: [
    { id: 9, first: "Isaiah", last: "Johnson", pos: "WR", no: 0, yr: 3 },
    { id: 8, first: "Jacob", last: "Finley", pos: "CB", no: 0, yr: 5 },
    { id: 7, first: "Damaine", last: "Wilson", pos: "LB", no: 9, yr: 3 },
  ] } : { teamId: 2, players: [{ id: 5, first: "Zeke", last: "Durham-Campbell", pos: "EDGE", no: 1, yr: 4 }, { id: 6, first: "Rodney", last: "Gallagher", pos: "WR", no: 1, yr: 3 }] }),
  liveSlate: async () => SLATE,
  liveWeek: async (_s, _t, w) => (w === 13 ? LAST_WEEK : null),
  addNote: async () => {},
  logMiss: () => {},
  ...over,
});
const talk = async (lines, ctx = ctxOf(), st0 = newState("admin")) => {
  let st = st0;
  let out = null;
  for (const l of lines) { out = await respond(l, st, ctx); st = out.state; }
  return out;
};

describe("follow-ups by topic, after the player's been introduced", () => {
  const after = (q) => talk(["who is ousmane kromah", q]);
  test.each([
    ["stats", "stats.line"], ["his stats", "stats.line"], ["what kind of numbers does he have", "stats.line"], ["how's he been playing", "stats.line"],
    ["how has he been playing this season", "stats.vs"], ["what did he do this year", "stats.line"], ["career stats", "stats.line"],
    ["strengths", "community.traits"], ["and weaknesses", "community.traits"], ["what is he good at", "community.traits"], ["do you have any strengths or weaknesses", "community.traits"],
    ["comps", "player.comps"], ["who does he remind you of", "player.comps"], ["rank", "player.rank"], ["where's he ranked", "player.rank"],
    ["where's he from", "player.background"], ["what state is he from", "player.background"], ["where did he grow up", "player.background"],
    ["what high school", "player.background"], ["what were his high school ratings", "player.background"], ["was he a top recruit", "player.background"],
    ["did he go anywhere before florida state", "player.background"], ["tell me more", "player.background"], ["give me some background", "player.background"], ["more", "player.background"], ["anything else", "player.background"],
    ["best game", "stats.max"], ["what has been his best game this year", "stats.max"], ["what game should i watch of his", "games.best"],
    ["scouting report", "player.bio"], ["what's my scouting report", "my.read"], ["do i have a scouting report on him", "my.read"],
  ])("%s → %s", async (q, intent) => {
    const out = await after(q);
    expect(out.reply.intent).toBe(intent);
    expect(out.reply.tone).not.toBe("miss");
    expect(out.reply.speak || out.reply.say).toMatch(/Kromah|\bhe\b|\bhis\b/i);
  });
  test("\"tell me more\" is told like a person, not a list", async () => {
    const out = await after("tell me more");
    expect(out.reply.say).toBe("Ousmane Kromah is from Leesburg, GA, and played his high school ball at Lee County. He came out as a 4-star recruit, number 76 in the country, in the class of 2025. He's been at Florida State since 2025. He's about 19.");
  });
  test("a transfer's background says where he started", async () => {
    const out = await talk(["give me some background on malachi henry"]);
    expect(out.reply.say).toMatch(/Malachi Henry is from Van Buren, AR.*started at Central Arkansas and transferred to Cincinnati in 2026\./);
  });
  test("no bio: a scouting report reads the community's instead", async () => {
    expect((await after("read me a scouting report")).reply.say).toMatch(/^There's no bio for Ousmane Kromah yet, so here's the community's\. .*Patient runner\./);
  });
  test("with nobody in the conversation, a topic alone isn't guessed at", () => {
    expect(topicAsk("stats", newState())).toBeNull();
    expect(topicAsk("give me some background on zeke durham campbell", { last: { id: "k" } })).toBeNull();
  });
});

describe("names: the players already in the conversation come first", () => {
  test("\"evangelist\" right after Evan Tengesdahl", async () => {
    const out = await talk(["who is evan tengesdahl", "what's my evaluation of evangelist"]);
    expect(out.reply.intent).toBe("my.read");
    expect(out.state.last.id).toBe("e");
  });
  test("a mangled first name with the right-sounding last name", () => {
    expect(looseScore("main chroma", people[0])).toBeGreaterThanOrEqual(0.6);
    expect(recentPlayer("main chroma", [people[0], people[2]]).player.id).toBe("k");
    // Someone else entirely isn't pulled to a recent name.
    expect(recentPlayer("jesse smith", [people[0], people[2]])).toBeNull();
  });
  test("\"tell me more about Isaiah Johnson\" after \"who wears 0 for Cincinnati\" — that one, not Ohio State's", async () => {
    const out = await talk(["who is number 0 on cincinnati", "tell me more about isaiah johnson"]);
    expect(out.reply.say).toMatch(/^Isaiah Johnson/);
    expect(out.state.last.id).toBe("cfbd_9");
  });
});

describe("\"did you mean\" says who, and \"yes\" takes him", () => {
  test("a clear near miss: one name, out loud", async () => {
    const out = await talk(["who's going to stockton"]);
    expect(out.reply.speak).toBe("Did you mean Gunner Stockton at Georgia?");
    const yes = await respond("yes", out.state, ctxOf());
    expect(yes.reply.intent).toBe("player.profile");
    expect(yes.state.last.id).toBe("g");
  });
  test("several: up to three names", () => {
    expect(didYouMean(people.slice(0, 4))).toBe("Did you mean Ousmane Kromah at Florida State, Evan Tengesdahl at Cincinnati, or Gunner Stockton at Georgia?");
  });
});

describe("jersey numbers, the ways they're said", () => {
  test.each([
    ["who is number one on west virginia", /2 players wear 1 for West Virginia/],
    ["who is number one on west virginia's defense", /^Number 1 for West Virginia is Zeke Durham-Campbell/],
    ["who is the wide receiver number zero in cincinnati", /^Number 0 for Cincinnati is Isaiah Johnson/],
    ["who's number non on cincinnati", /^Number 9 for Cincinnati is Damaine Wilson/],
  ])("%s", async (q, want) => expect((await talk([q])).reply.say).toMatch(want));
  test("number words; not a ranking", async () => {
    expect(jerseyWord("twenty one")).toBe(21);
    expect(jerseyWord("zero")).toBe(0);
    expect((await talk(["who is number one at quarterback"])).reply.intent).not.toBe("team.jersey");
  });
  test("a stutter is said once: \"what number what number is\"", async () => {
    expect((await talk(["what number what number is malachi henry"])).reply.intent).toBe("player.jersey");
  });
});

describe("games on other days", () => {
  test.each([
    ["who plays tomorrow", /^There are 2 games tomorrow\./],
    ["what are some college football games this week", /^There are 2 games this week\./],
    ["were any college football games played last week", /^2 games were played last week\./],
    ["what game should i watch from last week", /^I'd go back to /],
  ])("%s", async (q, want) => {
    const out = await talk([q]);
    expect(out.reply.intent).toBe("live.days");
    expect(out.reply.say).toMatch(want);
  });
  test("who plays football today / who should I watch right now → today's games", async () => {
    expect((await talk(["who plays football today"])).reply.intent).toBe("live.today");
    expect((await talk(["who should i watch right now"])).reply.intent).toBe("live.today");
  });
  test("a stat \"last week\" is his latest game", async () => {
    expect(parseRest("last week")).toEqual({ seasons: null, opps: [], lastGame: true });
    const out = await talk(["how many rushing yards did ousmane kromah have last week"]);
    expect(out.reply.intent).toBe("stats.one");
    expect(out.reply.say).toMatch(/133/);
  });
  test("trending players → the risers", async () => {
    expect((await talk(["show me some trending players"], ctxOf({ risers: async () => null }))).reply.intent).toBe("risers.hot");
  });
  test("etDay is a date", () => expect(etDay(new Date())).toMatch(/^\d{4}-\d\d-\d\d$/));
});

describe("said, not read", () => {
  test("suffixes in full", () => {
    expect(forSpeech("Samuel Singleton Jr. played at Fleming Island.")).toBe("Samuel Singleton Junior played at Fleming Island.");
    expect(forSpeech("David Sanders Jr: Vision")).toBe("David Sanders Junior: Vision");
    expect(forSpeech("Marvin Harrison Jr")).toBe("Marvin Harrison Junior");
    expect(forSpeech("Kenneth Walker III ran")).toBe("Kenneth Walker the Third ran");
  });
  test("a long remark about the voice is a note, even when it mentions watching", async () => {
    const notes = [];
    const out = await talk(["Again instead of list a laundry list like that it should just have a list of two or three names on either team to just suggest who I should watch"], ctxOf({ addNote: async (k, n) => notes.push(n) }));
    expect(out.reply.say).toBe("Got it. I saved that as a voice note.");
    expect(notes).toHaveLength(1);
  });
  test("\"whose\" is \"who's\"", async () => {
    expect((await talk(["whose ousmane kromah"])).reply.intent).toBe("player.profile");
  });
});

describe("listening waits for the whole question", () => {
  test("a finished sentence: the normal pause", () => {
    expect(quietFor("how many rushing yards does kromah have")).toBe(QUIET_MS);
    expect(QUIET_MS).toBeGreaterThanOrEqual(2500);
  });
  test("a sentence that can't end there, or a word or two: longer", () => {
    expect(quietFor("voice note it has to do a better job of")).toBeGreaterThan(QUIET_MS);
    expect(quietFor("what are")).toBeGreaterThan(QUIET_MS);
    expect(quietFor("how many receiving yards did his")).toBeGreaterThan(QUIET_MS);
  });
});
