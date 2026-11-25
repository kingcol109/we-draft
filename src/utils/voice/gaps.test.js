// The gaps found before play-testing (user, 2026-11-25): a near-miss name,
// live lines by nickname, last week's score, today's visitors, "his" after a
// compare, the wake word, and the live answer's auto-refresh flag.
import { respond, newState } from "./engine";
import { afterWake, WAKE } from "./speech";
import { etDay } from "./intentsLive";

const people = [
  { id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028", slug: "ousmane-kromah-2028-rb" },
  { id: "l", first: "Jesse", last: "Legree", pos: "RB", school: "Florida State", cls: "2027" },
  { id: "c", first: "Calvin", last: "Moss", pos: "WR", school: "Florida State", cls: "2027" },
];
const DOCS = {
  k: { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Slug: "ousmane-kromah-2028-rb" },
  l: { id: "l", First: "Jesse", Last: "Legree", Position: "RB", School: "Florida State", Eligible: "2027" },
  c: { id: "c", First: "Calvin", Last: "Moss", Position: "WR", School: "Florida State", Eligible: "2027" },
  cfbd_1: { id: "cfbd_1", cfbdOnly: true, cfbd: "1", First: "Osman", Last: "Kroma", Position: "LB", School: "Akron" },
};
const team = (school, points) => ({ school, points });
const SLATE = {
  season: 2026, seasonType: "regular", week: 13,
  games: [{ id: "g1", slug: "clemson-vs-florida-state", status: "in_progress", period: 2, startDate: new Date().toISOString(), home: team("Florida State", 14), away: team("Clemson", 10) }],
};
const LIVE = { g1: { players: { home: [
  // The live feed: no We-Draft link, a nickname, a suffix.
  { key: "home|CJ Moss", name: "CJ Moss", stats: { receiving: { rec: 4, yds: 61, td: 1 } } },
  { key: "home|Ousmane Kromah Jr.", name: "Ousmane Kromah Jr.", stats: { rushing: { car: 9, yds: 48, td: 0 } } },
], away: [] } } };
const SEASON = { years: ["2026"], seasons: { 2026: { rushing: { rushingAttempts: 100, rushingYards: 500, rushingTouchdowns: 4 } } }, career: {} };
const ctxOf = (over = {}) => ({
  uid: "me",
  people: async () => people,
  teams: async () => [{ school: "Florida State" }, { school: "Clemson" }, { school: "Georgia" }],
  cfbdPeople: async () => [{ id: "cfbd_1", first: "Osman", last: "Kroma", pos: "LB", school: "Akron", cfbd: "1", cfbdOnly: true }],
  player: async (id) => DOCS[id] || null,
  seasons: async () => SEASON,
  games: async () => [],
  ranks: async () => null,
  liveSlate: async () => SLATE,
  liveBox: async () => null,
  livePlayStats: async (id) => LIVE[id] || null,
  liveWeek: async (_s, _t, w) => (w === 12 ? { games: [{ id: "p1", status: "final", startDate: "2026-11-15T19:00:00Z", home: team("Georgia", 24), away: team("Florida State", 27) }] } : null),
  logMiss: () => {},
  ...over,
});
const ask = async (t, ctx = ctxOf(), st = newState()) => respond(t, st, ctx);

test("a misspelled board name doesn't jump to a CFBD stranger: it asks which one", async () => {
  // "osman kromer": a near miss for Kromah on the board (0.76), a loose CFBD match (0.80).
  const out = await ask("who is osman kromer");
  expect(out.reply.say).toMatch(/Did you mean one of these\?$/);
  expect(out.reply.choices.map((c) => c.id)).toEqual(["k", "cfbd_1"]);
  expect(out.state.pending.teach).toBe(true);
  // Close enough to the board's name: just him.
  expect((await ask("who is ousman kroma")).reply.say).toMatch(/^Ousmane Kromah/);
});

test("live lines without a We-Draft link: a nickname, a suffix", async () => {
  expect((await ask("how is calvin moss doing today")).reply.say).toMatch(/^Calvin Moss has 4 catches for 61 yards and a touchdown\./);
  expect((await ask("how's kromah playing")).reply.say).toMatch(/^Ousmane Kromah has 48 rushing yards on 9 carries\./);
});

test("last week's score, asked or when there's no game this week", async () => {
  expect((await ask("did fsu win last week")).reply.say).toBe("Last week: Final: Florida State 27, Georgia 24.");
  expect((await ask("did georgia win")).reply.say).toBe("Georgia doesn't play this week. Last week: Final: Florida State 27, Georgia 24.");
});

test("visitors today: what's live now, since Google's count lands tomorrow", async () => {
  const today = etDay(new Date());
  const ctx = ctxOf({
    dayDocs: async (coll, days) => days.map((d) => ({ day: d, v: d !== today ? null : { siteDailyAccounts: { u: { a: 1, b: 1 } }, draftSimDaily: { sims: 12 }, portalSimDaily: { started: 3 } }[coll] || null })),
  });
  expect((await ask("how many visitors today", ctx, newState("admin"))).reply.say).toBe("Google's visitor count for today comes with tomorrow morning's sync. So far today: 2 signed-in accounts, 12 Draft Sims and 3 Portal Sims started.");
});

test("after a compare, \"his\" is the first player named", async () => {
  const st = (await ask("compare kromah and legree")).state;
  expect(st.last.id).toBe("k");
  expect(st.group.map((p) => p.id)).toEqual(["k", "l"]);
});

test("a live game's answer is flagged to refresh itself; a final one isn't", async () => {
  expect((await ask("what's the score of the fsu game")).reply.live).toBe(true);
  expect((await ask("did fsu win last week")).reply.live).toBeFalsy();
});

describe("the wake word", () => {
  test("heard the ways a browser writes it; not \"a draft\"", () => {
    expect(afterWake("hey we draft how's kromah playing")).toBe("how's kromah playing");
    expect(afterWake("Hey WeDraft, who's playing today?")).toBe("who's playing today?");
    expect(afterWake("hey we-draft")).toBe("");
    expect(afterWake("okay we draft what's on tonight")).toBe("what's on tonight");
    expect(afterWake("hey wee draft")).toBe("");
    expect(afterWake("that was a draft pick")).toBeNull();
    expect(afterWake("the draft is in april")).toBeNull();
    expect(WAKE.test("hey we draft dot com")).toBe(true);
  });
  test("a question with the wake word still in it is understood", async () => {
    expect((await ask("hey we draft how's kromah playing")).reply.say).toMatch(/^Ousmane Kromah has 48 rushing yards/);
  });
});
