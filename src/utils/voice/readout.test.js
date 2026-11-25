// Morning readout + analytics by voice (admin), accolades, CFBD career paths (user, 2026-11-25).
import { respond, newState } from "./engine";
import { easternDay, spanSaid, typeSaid, trendOf, pageName } from "./intentsReadout";

const NOW = new Date();
const day = (n) => easternDay(new Date(NOW.getTime() - n * 86400000));
const people = [{ id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028", slug: "ousmane-kromah-2028-rb" }];
const PAGES = [
  { id: "mock_2028", type: "mock", slug: "2028", path: "/mocks/2028", pageViews: { last24Hours: 38, last7Days: 751, last30Days: 900, last90Days: 900, lastYear: 900, total: 900 } },
  { id: "ousmane-kromah-2028-rb", type: "player", slug: "ousmane-kromah-2028-rb", path: "/player/ousmane-kromah-2028-rb", pageViews: { last24Hours: 3, last7Days: 175, last30Days: 896, last90Days: 901, lastYear: 901, total: 901 } },
  { id: "draftsim_nyj", type: "draftsim", slug: "nyj", path: "/draftsim/nyj", pageViews: { last24Hours: 1, last7Days: 60, last30Days: 60, last90Days: 60, lastYear: 60, total: 60 } },
];
const DAYS = {
  analyticsDaily: { [day(1)]: { new: 709, returning: 117, other: 0 }, [day(2)]: { new: 500, returning: 100, other: 0 } },
  siteDailyAccounts: { [day(1)]: { u: { a: 1, b: 1, c: 1 } } },
  draftSimDaily: { [day(1)]: { sims: 73, completed: 35 }, [day(2)]: { sims: 10, completed: 5 } },
  portalSimDaily: { [day(1)]: { started: 24, finished: 8 } },
};
const ctxOf = (over = {}) => ({
  uid: "me",
  people: async () => people,
  player: async (id) => (id === "k" ? { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028", Slug: "ousmane-kromah-2028-rb" } : null),
  dayDocs: async (coll, days) => days.map((d) => ({ day: d, v: DAYS[coll]?.[d] || null })),
  openRequests: async () => [{ playerName: "John Doe", school: "Florida State", position: "RB", source: "voice" }],
  openReports: async () => [{ kind: "suggestion", message: "Add a depth chart." }],
  listNotes: async () => [{ text: "x", done: false }, { text: "y", done: true }],
  topPages: async (window, n) => [...PAGES].sort((a, b) => b.pageViews[window] - a.pageViews[window]).slice(0, n),
  pageViews: async (id) => PAGES.find((p) => p.id === id) || null,
  logMiss: () => {},
  ...over,
});
const admin = () => newState("admin");

describe("morning readout", () => {
  test("requests, suggestions, yesterday's visitors and sims, notes, top page", async () => {
    for (const said of ["hey we draft read me the morning readout", "we draft morning readout", "morning readout"]) {
      // eslint-disable-next-line no-await-in-loop
      const out = await respond(said, admin(), ctxOf());
      expect(out.reply.intent).toBe("admin.readout");
      expect(out.reply.say).toMatch(/^Morning readout for \w+ \d+\w\w\. 1 open player request: John Doe, Florida State\. 1 open suggestion: "Add a depth chart\."\. Yesterday, 826 people visited the site: 709 new and 117 returning, with 3 signed-in accounts\. 73 Draft Sims were started and 35 finished\. 24 Portal Sims were started and 8 finished\. The most visited page this week is Mocks 2028, with 751 views\. You have 1 open admin note\.$/);
    }
  });
  test("nothing synced yet: says so, never zero visitors", async () => {
    const out = await respond("morning readout", admin(), ctxOf({ dayDocs: async (_c, days) => days.map((d) => ({ day: d, v: null })), openRequests: async () => [], openReports: async () => [] }));
    expect(out.reply.say).toMatch(/No open player requests\. No open suggestions\. Yesterday's visitor numbers haven't synced yet\./);
  });
  test("admin only", async () => {
    expect((await respond("morning readout", newState(), ctxOf())).reply.say).toMatch(/admin command/);
  });
});

describe("analytics by voice", () => {
  test("most visited page, by window and type", async () => {
    expect((await respond("what is the most visited page in the last 7 days", admin(), ctxOf())).reply.say).toBe("The most visited page in the last 7 days is Mocks 2028, with 751 views. Then Ousmane Kromah's player page with 175 and Draft Sim NYJ with 60.");
    expect((await respond("most visited player page this month", admin(), ctxOf())).reply.say).toBe("The most visited player page in the last 30 days is Ousmane Kromah's player page, with 896 views.");
    expect((await respond("top 2 pages today", admin(), ctxOf())).reply.rows).toEqual([["1. /mocks/2028", "38"], ["2. /player/ousmane-kromah-2028-rb", "3"]]);
  });
  test("trending: this week's pace against the weeks before; new pages flagged", async () => {
    const out = await respond("are any pages trending", admin(), ctxOf());
    expect(out.reply.say).toBe("Trending this week. Draft Sim NYJ, 60 views, new this week. Mocks 2028, 751 views, 16.6 times its usual pace.");
    expect(trendOf(PAGES[1])).toEqual(expect.objectContaining({ week: 175 }));
    expect(trendOf(PAGES[1]).pace).toBeLessThan(1.75);
  });
  test("visitors and sims for a span", async () => {
    expect((await respond("how many people visited the site yesterday", admin(), ctxOf())).reply.say).toBe("826 visitors yesterday: 709 new and 117 returning. 3 signed-in account visits.");
    expect((await respond("how many draft sims were run yesterday", admin(), ctxOf())).reply.say).toBe("73 Draft Sims were started yesterday, and 35 finished.");
    expect((await respond("how many draft sims this week", admin(), ctxOf())).reply.say).toBe("83 Draft Sims were started in the last 7 days, and 40 finished.");
    expect((await respond("how many portal sims yesterday", admin(), ctxOf())).reply.say).toBe("24 Portal Sims were started yesterday, and 8 finished.");
  });
  test("one player page's views; requests and suggestions", async () => {
    expect((await respond("how many people looked at kromah this month", admin(), ctxOf())).reply.say).toBe("Ousmane Kromah's page had 896 views in the last 30 days.");
    expect((await respond("any player requests", admin(), ctxOf())).reply.say).toBe("1 open player request: John Doe, Florida State.");
    expect((await respond("read me the suggestions", admin(), ctxOf())).reply.say).toBe("1 open suggestion: \"Add a depth chart.\".");
  });
  test("words", () => {
    expect(spanSaid("yesterday").window).toBe("last24Hours");
    expect(spanSaid("in the last 30 days").window).toBe("last30Days");
    expect(typeSaid("player").type).toBe("player");
    expect(typeSaid("portal sim").type).toBe("portalsim");
    expect(pageName({ type: "draftsim", slug: "hub" })).toBe("Draft Sim hub");
  });
});

describe("accolades and career paths (anyone, CFBD-only players too)", () => {
  const JOHN = { id: "cfbd_99", cfbdOnly: true, cfbd: "99", First: "John", Last: "Doe", Position: "RB", School: "Ohio State", HighSchool: "IMG Academy", State: "Florida", RecruitYear: "2023", CareerStops: [{ School: "Florida", From: 2023, To: 2023 }, { School: "Ohio State", From: 2024, To: 2026 }] };
  const ctx = ctxOf({
    cfbdPeople: async () => [{ id: "cfbd_99", first: "John", last: "Doe", pos: "RB", school: "Ohio State", cfbd: "99", cfbdOnly: true }],
    player: async (id) => (id === "cfbd_99" ? JOHN : null),
    accolades: async () => [{ season: 2025, text: "All-Big Ten Second Team", kind: "honor" }, { season: 2024, text: "National Champion", kind: "title" }, { season: 2024, text: "Freshman All-American", kind: "honor" }],
  });
  test("career path from the portal card's stops", async () => {
    expect((await respond("what's john doe's career path", newState(), ctx)).reply.say).toBe("John Doe's path: IMG Academy in Florida, class of 2023, then Florida, 2023, then Ohio State, 2024 to 2026.");
    expect((await respond("did john doe transfer", newState(), ctx)).reply.say).toBe("Yes. John Doe transferred to Ohio State in 2024 from Florida (2023).");
  });
  test("accolades, and yes / no on a kind", async () => {
    expect((await respond("what awards has john doe won", newState(), ctx)).reply.say).toBe("John Doe's honors: 2025, All-Big Ten Second Team; 2024, National Champion; 2024, Freshman All-American.");
    expect((await respond("is john doe an all american", newState(), ctx)).reply.say).toBe("Yes. John Doe: 2024, Freshman All-American.");
    expect((await respond("was john doe a national champion", newState(), ctx)).reply.say).toBe("Yes. John Doe: 2024, National Champion.");
    // Stored labels put the team first: "First-Team All-ACC".
    const fsu = ctxOf({ accolades: async () => [{ season: 2025, text: "First-Team All-ACC", kind: "honor" }] });
    expect((await respond("is kromah all conference", newState(), fsu)).reply.say).toBe("Yes. Ousmane Kromah: 2025, First-Team All-ACC.");
    expect((await respond("is kromah an all american", newState(), fsu)).reply.say).toBe("I don't have an All-American honor on file for Ousmane Kromah.");
    const none = ctxOf({ accolades: async () => [] });
    expect((await respond("is kromah all conference", newState(), none)).reply.say).toBe("I don't have an all-conference honor on file for Ousmane Kromah.");
  });
});
