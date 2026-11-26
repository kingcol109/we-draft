// /voice: the questions from the 2026-11-25 iPad log, and spoken answers that talk.
import { respond, newState, understand, looksLikeFeedback } from "./engine";
import { gameDid, gameStory, forSpeech } from "./spoken";

const people = [
  { id: "p1", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028", slug: "ousmane-kromah-2028-rb" },
  { id: "p2", first: "David", last: "Sanders Jr", pos: "OL", school: "Tennessee", cls: "2029" },
  { id: "p3", first: "Keisean", last: "Henderson", pos: "QB", school: "Houston", cls: "2029" },
  { id: "p4", first: "Chris", last: "Brazzell", pos: "WR", school: "Tennessee", cls: "2027" },
  { id: "p5", first: "Makhi", last: "Hughes", pos: "RB", school: "Houston", cls: "2027" },
  { id: "p6", first: "Michael", last: "Hawkins Jr.", pos: "QB", school: "West Virginia", cls: "2027" },
  { id: "p7", first: "Gunner", last: "Stockton", pos: "QB", school: "Georgia", cls: "2027" },
];
const roster = {
  teamId: 2633, school: "Tennessee", season: 2026,
  players: [
    { id: "11", no: 1, first: "Chris", last: "Brazzell", pos: "WR", yr: 3, s: { receiving: { REC: 60, YDS: 1017, TD: 9 } } },
    { id: "12", no: 4, first: "Braylon", last: "Staley", pos: "WR", yr: 2, s: { receiving: { REC: 50, YDS: 800, TD: 5 } } },
    { id: "13", no: 32, first: "Pat", last: "Lee", pos: "LB", yr: 2, s: { defensive: { TOT: 70, SACKS: 2 } } },
  ],
};
const leaders = { season: 2026, categories: [{ key: "rushYds", rows: [
  { id: "9", v: 1506, first: "Aiden", last: "Flora", pos: "RB", school: "Iowa State" },
  { id: "8", v: 1400, first: "Ann", last: "Two", pos: "RB", school: "Utah" },
  { id: "7", v: 1300, first: "Bo", last: "Three", pos: "RB", school: "Ohio" },
  { id: "6", v: 1058, first: "Michael", last: "Hawkins Jr.", pos: "QB", school: "West Virginia", slug: "michael-hawkins-jr" },
] }] };
const game = {
  id: "g1", slug: "houston-vs-west-virginia", status: "final", startDate: "2026-11-21T18:00:00Z",
  home: { school: "West Virginia", points: 31 }, away: { school: "Houston", points: 34 },
};
const pbp = { players: {
  away: [
    { key: "5159035", name: "Keisean Henderson", stats: { passing: { att: 28, cmp: 18, yds: 268, td: 1 }, rushing: { car: 14, yds: 39 } } },
    { key: "4816098", name: "Makhi Hughes", stats: { rushing: { car: 19, yds: 158, td: 3 } } },
  ],
  home: [{ key: "5079465", name: "Michael Hawkins Jr.", stats: { passing: { att: 24, cmp: 13, yds: 130, td: 1 }, rushing: { car: 18, yds: 98, td: 1 } } }],
} };
const saved = [];
const notes = [];
const ctx = {
  people: async () => people,
  cfbdRoster: async (school) => (school === "Tennessee" ? roster : null),
  cfbLeaders: async () => leaders,
  teams: async () => [["Iowa State","Big 12"],["Utah","Big 12"],["West Virginia","Big 12"],["Ohio","MAC"],["Tennessee","SEC"],["Florida State","ACC"],["Houston","Big 12"]].map(([school, conference]) => ({ school, conference })),
  player: async (id) => { const p = people.find((x) => x.id === id); return p ? { id, First: p.first, Last: p.last, Position: p.pos, School: p.school, Slug: p.slug } : null; },
  liveSlate: async () => ({ season: 2026, seasonType: "regular", week: 13, games: [] }),
  liveWeek: async (s, t, w) => (w === 12 ? { games: [game] } : null),
  livePlayStats: async () => pbp,
  savePronunciation: async (x) => { saved.push(x); },
  addNote: async (kind, x) => { notes.push({ kind, ...x }); },
  pronMap: () => ({}),
};
const ask = (text, state = newState("admin")) => respond(text, state, ctx);

test("team stat leaders", async () => {
  for (const q of ["who leads Tennessee in receiving yards", "who has the most receiving yards for Tennessee", "who's Tennessee's leading receiver"]) {
    const out = await ask(q);
    expect(out.reply.intent).toBe("leaders.stat");
    expect(out.reply.speak).toMatch(/Chris Brazzell/);
    expect(out.reply.speak).toMatch(/1,017 receiving yards/);
    expect(out.reply.speak).toMatch(/Braylon Staley is second with 800/);
    expect(out.state.last.id).toBe("p4");
  }
});

test("national stat leaders", async () => {
  for (const q of ["who leads college football in rushing yards", "who leads the country in rushing yards", "who leads the nation in rushing", "who has the most rushing yards in college football", "who is the leading rusher in the country"]) {
    const out = await ask(q);
    expect(out.reply.intent).toBe("leaders.stat");
    expect(out.reply.speak).toMatch(/Aiden Flora of Iowa State leads the country with 1,506 rushing yards/);
  }
});

test("jersey numbers", async () => {
  for (const q of ["who is number 32 on Tennessee", "who wears number 32 at Tennessee", "number 32 on Tennessee who is he"]) {
    const out = await ask(q);
    expect(out.reply.intent).toBe("team.jersey");
    expect(out.reply.speak).toBe("Number 32 for Tennessee is Pat Lee, a sophomore linebacker.");
  }
});

test("a game broken down, said like a recap", async () => {
  const out = await ask("give me a breakdown of the Houston West Virginia game");
  expect(out.reply.intent).toBe("game.breakdown");
  expect(out.reply.speak).toMatch(/^Houston edged West Virginia 34 to 31 on the road\./);
  expect(out.reply.speak).toMatch(/Keisean Henderson threw for 268 yards and a touchdown, and ran for 39 more\./);
  expect(out.reply.speak).toMatch(/Makhi Hughes ran for 158 yards and 3 touchdowns on 19 carries/);
  expect(out.reply.speak).toMatch(/On the West Virginia side, Michael Hawkins Jr\./);
});

test("strengths and weaknesses wordings", () => {
  for (const q of ["what are gunner stockton strength and weaknesses", "what are David Sanders Junior's strength and weaknesses", "David Sanders at Tennessee what are his strengths and weaknesses"]) {
    expect(understand(q, "admin")?.intent.id).toBe("community.traits");
  }
});

test("his name is pronounced …", async () => {
  saved.length = 0;
  const first = await ask("who wears number 32 at Tennessee");
  await respond("his name is pronounced Pat Lee-ay", first.state, ctx);
  expect(saved).toEqual([{ word: "Pat", say: "Pat", playerId: "cfbd_13" }, { word: "Lee", say: "Lee-ay", playerId: "cfbd_13" }]);
  saved.length = 0;
  const out = await respond("his name is pronounced Keyshawn", { ...newState("admin"), last: people[2] }, ctx);
  expect(out.reply.intent).toBe("voice.pronounced");
  expect(saved).toEqual([{ word: "Keisean", say: "Keyshawn", playerId: "p3" }]);
  saved.length = 0;
  await respond("pronounced Uzman chroma", { ...newState("admin"), last: people[0] }, ctx);
  expect(saved.map((x) => x.word)).toEqual(["Ousmane", "Kromah"]);
});

test("guidance said to the voice is saved as a voice note", async () => {
  notes.length = 0;
  const out = await ask("I don't like the last answer because it just sounds like you're reading off a box score");
  expect(out.reply.say).toMatch(/voice note/);
  expect(notes[0].kind).toBe("voice");
  expect(looksLikeFeedback("when the system doesn't understand what the person saying it shouldn't read back what it was saying")).toBe(true);
  expect(looksLikeFeedback("the audio stops listening way too fast the time that it takes right after should be at least double")).toBe(true);
  expect(looksLikeFeedback("who leads tennessee in receiving yards")).toBe(false);
});

test("a miss is short out loud", async () => {
  const out = await ask("this is us english");
  expect(out.reply.say).toMatch(/this is us english/i);
  expect(out.reply.speak).not.toMatch(/this is us/i);
});

test("a player's game, told not read", () => {
  expect(gameDid({ passing: { "C/ATT": "18/28", YDS: "268", TD: "1", INT: "0" }, rushing: { CAR: "14", YDS: "39", TD: "0" } })).toBe("threw for 268 yards and a touchdown, and ran for 39 more");
  const g = { opp: "West Virginia", at: "@", result: "W", score: "34-31", date: "2026-11-21T18:00:00Z", line: { passing: { passingYards: 268, passingTouchdowns: 1, interceptions: 0, passingAttempts: 28, completions: 18 }, rushing: { rushingYards: 39, rushingAttempts: 14, rushingTouchdowns: 0 } } };
  expect(gameStory("Keisean Henderson", "Houston", g)).toBe("Keisean Henderson threw for 268 yards and a touchdown, and ran for 39 more in Houston's 34 to 31 win at West Virginia on November 21st.");
  expect(forSpeech("Kromah · #12 · W 34-31")).toBe("Kromah, number 12, W 34 to 31");
});

// ── Whole families, not one wording (user, 2026-11-25) ──
const intentOf = (q) => understand(q, "admin")?.intent?.id;
test("stat-leader questions, many shapes", () => {
  [
    "who leads Tennessee in receiving yards", "who led Tennessee in receiving yards", "who's leading Tennessee in receiving yards this season",
    "who has the most receiving yards at Tennessee", "who has the most catches on Tennessee", "who's Tennessee's top receiver", "who is the leading rusher for Tennessee",
    "who leads the SEC in sacks", "who has the most sacks in the Big Ten", "who leads the country in tackles", "who has the most interceptions in college football",
    "top 5 in passing yards", "top 10 in rushing yards in the SEC", "who are the top 3 in sacks in the country", "rushing yards leaders",
    "which quarterback leads the country in rushing yards", "who leads the nation in rushing yards among quarterbacks", "which running back has the most receiving yards",
    "who's second in the country in passing yards", "who's third in rushing yards", "who is second on Tennessee in receiving yards",
    "who's the nation's leading tackler", "who is the top pass rusher in the country", "top 5 running backs in rushing yards",
  ].forEach((q) => expect([q, intentOf(q)]).toEqual([q, "leaders.stat"]));
});
test("where a player ranks, many shapes", () => {
  ["where does Kromah rank in rushing yards", "where does Kromah rank nationally", "where does Kromah rank nationally in rushing yards", "what's Kromah's rank in rushing yards",
    "is Kromah top 10 in rushing yards", "is Kromah in the top 25 in rushing yards in the country", "how does Kromah stack up in rushing yards", "where does Kromah rank on his team in rushing yards",
    "is Kromah the leader in rushing yards"].forEach((q) => expect([q, intentOf(q)]).toEqual([q, "leaders.rank"]));
  // His We-Draft.com class rank stays its own question.
  expect(intentOf("where does Kromah rank")).not.toBe("leaders.rank");
});
test("leaders answers: conference, position, second place, a player's rank", async () => {
  expect((await ask("who leads the big 12 in rushing yards")).reply.speak).toMatch(/^Aiden Flora of Iowa State leads the Big 12 with 1,506 rushing yards/);
  expect((await ask("which quarterback leads the country in rushing yards")).reply.speak).toMatch(/Michael Hawkins Jr\. of West Virginia leads the country among quarterbacks with 1,058 rushing yards/);
  expect((await ask("who's second in the country in rushing yards")).reply.speak).toMatch(/^Second in the country is Ann Two of Utah, with 1,400 rushing yards\./);
  expect((await ask("top 3 in rushing yards")).reply.speak).toMatch(/^The top 3 in the country in rushing yards: Aiden Flora of Iowa State with 1,506, Ann Two of Utah with 1,400 and Bo Three of Ohio with 1,300\.$/);
  expect((await ask("where does Michael Hawkins rank in rushing yards")).reply.speak).toMatch(/^Michael Hawkins Jr\. is 4th in the country in rushing yards, with 1,058\./);
  expect((await ask("is Michael Hawkins top 3 in rushing yards")).reply.speak).toMatch(/^No\. Michael Hawkins Jr\. is 4th/);
  expect((await ask("where does Chris Brazzell rank on his team in receiving yards")).reply.speak).toMatch(/Chris Brazzell is first on Tennessee in receiving yards, with 1,017/);
});
test("jersey questions both ways", async () => {
  expect(intentOf("who wears 32 for Tennessee")).toBe("team.jersey");
  expect(intentOf("who is Tennessee's number 32")).toBe("team.jersey");
  expect(intentOf("what number does Chris Brazzell wear")).toBe("player.jersey");
  expect(intentOf("what's Chris Brazzell's jersey number")).toBe("player.jersey");
  expect((await ask("what number does Chris Brazzell wear")).reply.speak).toBe("Chris Brazzell wears number 1 for Tennessee.");
});
test("game questions, many shapes", async () => {
  ["recap the Houston West Virginia game", "how did the Houston West Virginia game go", "what happened in the Houston game", "break down Houston's last game",
    "how did Houston do last week", "who won the Houston West Virginia game", "give me a recap of the Houston West Virginia game", "tell me about the Houston game"]
    .forEach((q) => expect([q, intentOf(q)]).toEqual([q, "game.breakdown"]));
  // A team where a player usually goes: "how did Houston do against West Virginia" → that game.
  const vs = await ask("how did Houston do against West Virginia");
  expect(vs.reply.intent).toBe("game.breakdown");
  expect(vs.reply.speak).toMatch(/^Houston edged West Virginia 34 to 31 on the road\./);
  // A player's last game, told.
  const p = await ask("how did Keisean Henderson play last week");
  expect(p.reply.speak).toBe("Keisean Henderson threw for 268 yards and a touchdown, and ran for 39 more in Houston's 34 to 31 win at West Virginia.");
});
test("the player first, then the question about him — any question", async () => {
  const out = await ask("Chris Brazzell what number does he wear");
  expect(out.reply.speak).toBe("Chris Brazzell wears number 1 for Tennessee.");
  const r = await ask("Michael Hawkins where does he rank in rushing yards");
  expect(r.reply.intent).toBe("leaders.rank");
});
