// Admin / voice notes, player requests, admin adds from CFBD, suggestions (user, 2026-11-25).
import { respond, newState } from "./engine";
import { playerSlug } from "./data";

const people = [{ id: "k", first: "Ousmane", last: "Kromah", pos: "RB", school: "Florida State", cls: "2028" }];
const ROSTER = {
  id: "52", school: "Florida State", team: "Florida State", teamId: 52,
  players: [
    { id: "99", first: "John", last: "Doe", pos: "RB", rc: 2024, ht: 71, wt: 205 },
    { id: "98", first: "Max", last: "Lane", pos: "DE" },
    { id: "k1", first: "Ousmane", last: "Kromah", pos: "RB", slug: "ousmane-kromah" },
  ],
};
const ctxOf = (over = {}) => {
  const sent = { notes: [], requests: [], suggestions: [], adds: [] };
  return {
    sent,
    uid: "me",
    people: async () => people,
    teams: async () => [{ school: "Florida State", short: "FSU" }, { school: "Charlotte" }],
    player: async (id) => (id === "k" ? { id: "k", First: "Ousmane", Last: "Kromah", Position: "RB", School: "Florida State", Eligible: "2028" }
      : id === "cfbd_99" ? { id: "cfbd_99", cfbdOnly: true, cfbd: "99", First: "John", Last: "Doe", Position: "RB", School: "Florida State", Height: "5'11\"", Weight: "205" } : null),
    // Everyone on a CFBD roster (the _cfbdPeople snapshot), as people rows.
    cfbdPeople: async () => [
      { id: "cfbd_99", first: "John", last: "Doe", pos: "RB", school: "Florida State", cfbd: "99", teamId: 52, cfbdOnly: true, onWeDraft: false },
      { id: "cfbd_98", first: "Max", last: "Lane", pos: "EDGE", school: "Florida State", cfbd: "98", teamId: 52, cfbdOnly: true, onWeDraft: false },
      { id: "cfbd_77", first: "Old", last: "Timer", pos: "QB", school: "Florida State", cfbd: "77", teamId: 52, cfbdOnly: true, onWeDraft: true },
    ],
    cfbdRosterRow: async (p) => { const row = ROSTER.players.find((x) => x.id === p.cfbd); return row ? { row: { ...row, school: "Florida State", team: "Florida State", teamId: 52 }, roster: ROSTER } : null; },
    seasons: async (d) => (d.id === "cfbd_99" ? { years: ["2026"], seasons: { 2026: { rushing: { rushingAttempts: 40, rushingYards: 212, rushingTouchdowns: 2 } } }, career: {} } : null),
    games: async () => [],
    ranks: async () => null,
    cfbdRoster: async (school) => (school === "Florida State" ? ROSTER : null),
    cfbdAllRosters: async () => [ROSTER],
    planCfbdAdd: async (row, { recruitYear } = {}) => ({ pos: { RB: "RB", DE: "EDGE" }[row.pos], eligible: "2027", recruitYear: recruitYear || (row.rc ? String(row.rc) : null) }),
    addFromCfbd: async (row, roster, plan) => { sent.adds.push({ id: row.id, roster: roster.id, ...plan }); return { id: "new1", First: row.first, Last: row.last, Position: plan.pos, School: row.school, Eligible: plan.eligible }; },
    requestPlayer: async (r) => { sent.requests.push(r); },
    sendSuggestion: async (t) => { sent.suggestions.push(t); },
    addNote: async (kind, e) => { sent.notes.push({ kind, ...e }); },
    logMiss: () => {},
    ...over,
  };
};
const admin = () => newState("admin");

describe("notes (admin)", () => {
  test("admin note: the words as typed go to the admin bucket", async () => {
    const ctx = ctxOf();
    const out = await respond("Admin note: Check the 2027 TE rankings, Bowers looks off.", admin(), ctx);
    expect(out.reply.say).toBe("Admin note saved.");
    expect(ctx.sent.notes).toEqual([expect.objectContaining({ kind: "admin", text: "Check the 2027 TE rankings, Bowers looks off." })]);
  });
  test("voice note goes to its own bucket; 'add a voice note' works too", async () => {
    const ctx = ctxOf();
    expect((await respond("add a voice note the answer for records is too long", admin(), ctx)).reply.say).toBe("Voice note saved.");
    expect(ctx.sent.notes[0]).toEqual(expect.objectContaining({ kind: "voice", text: "the answer for records is too long" }));
  });
  test("not on the general version", async () => {
    expect((await respond("admin note fix this", newState(), ctxOf())).reply.say).toMatch(/admin command/);
  });
});

describe("a player who's only on a CFBD roster (user, 2026-11-25)", () => {
  test("stats and facts just play — no offer, no school needed", async () => {
    const ctx = ctxOf();
    const out = await respond("how many rushing yards does john doe have", newState(), ctx);
    expect(out.reply.say).toBe("John Doe: 212 rushing yards, 2026.");
    expect(out.reply.confirm).toBeUndefined();
    expect(out.reply.sub).toBe("RB · Florida State · not on We-Draft.com");
    expect((await respond("how big is florida state's john doe", newState(), ctx)).reply.say).toBe("John Doe is listed at 5 foot 11 and 205 pounds.");
    expect(ctx.sent.requests).toEqual([]);
  });
  test("saving something for him: the offer to request him; yes sends it", async () => {
    const ctx = ctxOf();
    let st = (await respond("john doe's rushing yards", newState(), ctx)).state;
    const ask = await respond("add him to my watchlist", st, ctx);
    expect(ask.reply.say).toBe("John Doe isn't on We-Draft.com yet, so I can't save that for him. Want me to ask We-Draft.com to add him?");
    expect(ask.reply.confirm).toBe(true);
    const yes = await respond("yes", ask.state, ctx);
    expect(yes.reply.say).toBe("Sent. We-Draft.com will reply in your Messages.");
    expect(ctx.sent.requests).toEqual([{ playerName: "John Doe", school: "Florida State", position: "RB", cfbdId: "99" }]);
    const g = await respond("give john doe a second round grade", newState(), ctx);
    expect([g.reply.confirm, g.reply.say]).toEqual([true, "John Doe isn't on We-Draft.com yet, so I can't save that for him. Want me to ask We-Draft.com to add him?"]);
  });
  test("asking about his We-Draft.com status: the offer; no sends nothing", async () => {
    const ctx = ctxOf();
    const ask = await respond("is john doe on we draft", newState(), ctx);
    expect(ask.reply.say).toBe("John Doe isn't on We-Draft.com yet. Want me to ask We-Draft.com to add him?");
    await respond("no", ask.state, ctx);
    expect(ctx.sent.requests).toEqual([]);
    expect((await respond("where does john doe rank", newState(), ctx)).reply.say).toBe("John Doe isn't on We-Draft.com yet. Want me to ask We-Draft.com to add him?");
    expect((await respond("is kromah on we draft", newState(), ctx)).reply.say).toBe("Yes. Ousmane Kromah is on We-Draft.com: Florida State, RB, 2028 class.");
  });
  test("signed out: says to sign in instead of offering", async () => {
    const out = await respond("is john doe on we draft", newState(), ctxOf({ uid: null }));
    expect(out.reply.say).toBe("John Doe isn't on We-Draft.com yet. Sign in and I can ask We-Draft.com to add him.");
    expect(out.reply.confirm).toBeUndefined();
  });
  test("linked to a We-Draft.com page outside the active classes", async () => {
    expect((await respond("where does old timer rank", newState(), ctxOf())).reply.say).toBe("Old Timer has a We-Draft.com page, but he isn't in the draft classes I work with yet.");
  });
  test("on no roster at all: the usual miss, with how to request", async () => {
    const out = await respond("who is zed nobody", newState(), ctxOf());
    expect(out.reply.say).toMatch(/say "request" with his name and school\.$/);
  });
});

describe("request by name", () => {
  test("on the roster", async () => {
    const ctx = ctxOf();
    const ask = await respond("request john doe from florida state", newState(), ctx);
    expect(ask.reply.say).toMatch(/Want me to ask We-Draft\.com to add him\?$/);
    await respond("yes", ask.state, ctx);
    expect(ctx.sent.requests[0]).toEqual(expect.objectContaining({ playerName: "John Doe", cfbdId: "99" }));
  });
  test("not on the roster: still offered, without a CFBD id", async () => {
    const ctx = ctxOf();
    const ask = await respond("ask we draft to add jane roe from fsu", newState(), ctx);
    expect(ask.reply.say).toBe("Jane Roe isn't on We-Draft.com, and I don't see him on Florida State's roster. Want me to ask We-Draft.com to add him?");
    await respond("yes", ask.state, ctx);
    expect(ctx.sent.requests).toEqual([{ playerName: "Jane Roe", school: "Florida State", position: "", cfbdId: null }]);
  });
  test("already on We-Draft.com; no school → asks for it", async () => {
    expect((await respond("request ousmane kromah", newState(), ctxOf())).reply.say).toBe("Ousmane Kromah is already on We-Draft.com.");
    expect((await respond("request john doe", newState(), ctxOf())).reply.say).toBe("John Doe isn't on We-Draft.com. Which school is he at? Say \"request John Doe from\" and the school.");
  });
  test("other 'add' commands aren't requests", async () => {
    const st = (await respond("who is kromah", newState(), ctxOf())).state;
    expect((await respond("add him to my watchlist", st, ctxOf())).reply.intent).not.toBe("request.player");
  });
});

describe("admin: add a player from CFBD", () => {
  test("add by name and school → confirm → added with the CFB Universe defaults", async () => {
    const ctx = ctxOf();
    const ask = await respond("add john doe from florida state to we draft", admin(), ctx);
    expect(ask.reply.say).toBe("John Doe isn't on We-Draft.com. Florida State has John Doe on its roster as a running back. Add him as a running back in the 2027 class, recruit year 2024?");
    const yes = await respond("yes", ask.state, ctx);
    expect(yes.reply.say).toBe("Added John Doe to We-Draft.com: Florida State, running back, 2027 class.");
    expect(ctx.sent.adds).toEqual([{ id: "99", roster: "52", pos: "RB", eligible: "2027", recruitYear: "2024" }]);
    expect(ctx.sent.requests).toEqual([]);
  });
  test("no school said: looks through every roster", async () => {
    const ask = await respond("add john doe", admin(), ctxOf());
    expect(ask.reply.confirm).toBe(true);
  });
  test("CFBD has no recruiting class: asks for it; said with the year → confirm", async () => {
    const ctx = ctxOf();
    expect((await respond("add max lane from florida state", admin(), ctx)).reply.say).toBe("Florida State has Max Lane on its roster as an edge rusher. CFBD doesn't have his recruiting class. Say it with the year, like \"add Max Lane from Florida State, recruit year 2024\".");
    const ask = await respond("add max lane from florida state, recruit year 2025", admin(), ctx);
    expect(ask.reply.say).toMatch(/Add him as an edge rusher in the 2027 class, recruit year 2025\?$/);
  });
  test("admin page: stats play; saving for him offers the add", async () => {
    const ctx = ctxOf();
    const st = (await respond("john doe's rushing yards", admin(), ctx)).state;
    const ask = await respond("add him to my watchlist", st, ctx);
    expect(ask.reply.say).toBe("John Doe isn't on We-Draft.com yet, so I can't save that for him. Add him as a running back in the 2027 class, recruit year 2024?");
  });
});

describe("suggestions", () => {
  test("confirm, then sent as typed", async () => {
    const ctx = ctxOf();
    const ask = await respond("Suggestion: Add a depth chart to the team pages.", newState(), ctx);
    expect(ask.reply.say).toBe("Send this suggestion to We-Draft.com? \"Add a depth chart to the team pages.\"");
    const yes = await respond("yes", ask.state, ctx);
    expect(yes.reply.say).toBe("Sent. Thanks. We-Draft.com will reply in your Messages.");
    expect(ctx.sent.suggestions).toEqual(["Add a depth chart to the team pages."]);
  });
  test("needs sign-in; 'suggest a player' is still the player suggestion", async () => {
    expect((await respond("i have a suggestion more stats", newState(), ctxOf({ uid: null }))).reply.say).toMatch(/^Sign in first/);
    expect((await respond("suggest a player", newState(), ctxOf({ classList: async () => [] }))).reply.intent).not.toBe("feedback.suggest");
  });
});

test("slugs match the admin panel's", () => {
  expect(playerSlug("Ja'Marr", "Chase Jr.", "WR", "2021")).toBe("jamarr-chase-jr-2021-wr");
});
