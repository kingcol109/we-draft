import { suggestNeeds, injuredLookup, suggestionReason, positionPlayers } from "./teamNeedSuggestions";

// 32 teams, one QB room each, graded 40 (worst) … 87 (best), healthy, 26 years old.
const NOW = Date.parse("2026-10-24");
const team = (abbr, i, extra = []) => ({
  abbr,
  players: [{ id: `${abbr}-qb`, n: `${abbr} Starter`, pos: "QB", g: 40 + i * 1.5, sn: 500, sp: 95, dob: "2000-01-01", d: 1 }, ...extra],
});
const league = (patch = {}) => Array.from({ length: 32 }, (_, i) => `T${String(i).padStart(2, "0")}`)
  .map((abbr, i) => (patch[abbr] ? patch[abbr](i) : team(abbr, i)));

test("suggestions rank a position against the league", () => {
  const s = suggestNeeds(league(), {}, NOW);
  expect(s.T00.QB.label).toBe("Upgrade Needed"); // worst in the league
  expect(s.T31.QB.label).toBe("Set");
  expect(s.T08.QB.label).toBe("Upgrade Wanted"); // 24th
  expect(suggestionReason(s.T08.QB)).toMatch(/starters rank 24th/);
});

test("an aging starter suggests Aging Talent", () => {
  const s = suggestNeeds(league({ T31: (i) => ({ ...team("T31", i), players: [{ ...team("T31", i).players[0], dob: "1990-01-01" }] }) }), {}, NOW);
  expect(s.T31.QB.label).toBe("Aging Talent");
});

test("an injured starter still on the team counts as healthy; without him is noted", () => {
  // The Eagles case: the starter is off PFF's depth chart (hurt), a weak
  // backup has the few snaps left.
  const phi = (i) => ({
    abbr: "T30",
    players: [
      { id: "hurts", n: "Jalen Hurts", pos: "QB", off: true, g: 85, sn: 300, sp: 81.5, dob: "1998-08-07" },
      { id: "mckee", n: "Tanner McKee", pos: "QB", g: 41, sn: 64, sp: 17, dob: "2000-04-27", d: 1 },
    ],
  });
  const espn = { T30: [{ fullName: "Jalen Hurts", rosterStatus: "reserve", injury: "Injured Reserve" }] };
  const s = suggestNeeds(league({ T30: phi }), espn, NOW);
  expect(s.T30.QB.label).toBe("Set");
  expect(s.T30.QB.starters).toEqual(["Jalen Hurts"]);
  expect(s.T30.QB.injured).toEqual([{ name: "Jalen Hurts", status: "Injured Reserve", snapPct: 82 }]);
  expect(s.T30.QB.without.label).toBe("Upgrade Needed");
  // Not on the ESPN roster as injured (released, traded) → he's gone.
  expect(suggestNeeds(league({ T30: phi }), { T30: [] }, NOW).T30.QB.label).toBe("Upgrade Needed");
});

test("injury lookup matches loosely and only for IR / out", () => {
  const look = injuredLookup([
    { fullName: "Kenneth Walker III", rosterStatus: "reserve", injury: null },
    { fullName: "A. Healthy", rosterStatus: "active", injury: "Questionable" },
  ]);
  expect(look.get("kenneth walker")).toBe("Injured Reserve");
  expect(look.get("k walker")).toBe("Injured Reserve");
  expect(look.has("a healthy")).toBe(false);
});

test("a position group's players: current depth chart plus injured players still on the team", () => {
  const t = { abbr: "PHI", players: [
    { id: 1, n: "Jalen Hurts", pos: "QB", off: true, g: 62.6, sn: 300, sp: 81.5, dob: "1998-08-07" },
    { id: 2, n: "Tanner McKee", pos: "QB", g: 70.9, sn: 64, sp: 17.4, dob: "2000-04-27", d: 1, s: "questionable" },
    { id: 3, n: "Andy Dalton", pos: "QB", off: true, g: 20.3, sn: 4, sp: 1.1 },
    { id: 4, n: "Saquon Barkley", pos: "HB", g: 80, sn: 400, sp: 70 },
  ] };
  const espn = [{ fullName: "Jalen Hurts", rosterStatus: "reserve", injury: "Injured Reserve" }];
  const qbs = positionPlayers(t, espn, "QB", Date.parse("2026-10-24"));
  expect(qbs.map((p) => p.name)).toEqual(["Jalen Hurts", "Tanner McKee"]);
  expect(qbs[0]).toMatchObject({ grade: 62.6, age: 28.2, snapPct: 82, injury: "Injured Reserve", starter: true });
  expect(qbs[1]).toMatchObject({ injury: "Questionable", starter: false });
});

test("with nobody tagged, a role goes by PFF's read: the slot corner by his coverage grade", () => {
  const teams = Array.from({ length: 32 }, (_, i) => ({
    abbr: `T${String(i).padStart(2, "0")}`,
    players: [{ id: `n${i}`, n: `Nickel ${i}`, pos: "CB", al: "SCB", g: 70, sn: 400, sp: 60, dob: "2000-01-01", x: { cov: [40 + i * 1.5, 300] } }],
  }));
  const s = suggestNeeds(teams, {}, NOW);
  expect(s.T00.SLOTCB.label).toBe("Upgrade Needed");
  expect(s.T31.SLOTCB.label).toBe("Set");
  expect(s.T31.SLOTCB.starters).toEqual(["Nickel 31"]);
  // Nobody lines up at nose tackle → the role's open.
  expect(s.T31.NOSE.label).toBe("Upgrade Needed");
});

describe("player tags", () => {
  const { tagUpgrade } = jest.requireActual("./teamNeedSuggestions");
  test("tier rules: one starter and several", () => {
    expect(tagUpgrade(1, [7])).toBe(null);
    expect(tagUpgrade(1, [6])).toBe(null);
    expect(tagUpgrade(1, [4])).toBe("Upgrade Wanted");
    expect(tagUpgrade(1, [3])).toBe("Upgrade Needed");
    // Receivers: two good + an average third is set; the third as depth, wanted;
    // one good and two average, needed.
    expect(tagUpgrade(3, [5, 6, 4])).toBe(null);
    expect(tagUpgrade(3, [6, 5, 3])).toBe("Upgrade Wanted");
    expect(tagUpgrade(3, [5, 4, 4])).toBe("Upgrade Needed");
    expect(tagUpgrade(3, [5, 5])).toBe("Upgrade Wanted"); // only two of three starters
    // Two starters: both average, wanted; one below average beside a good one, wanted; both depth, needed.
    expect(tagUpgrade(2, [4, 4])).toBe("Upgrade Wanted");
    expect(tagUpgrade(2, [6, 3])).toBe("Upgrade Wanted");
    expect(tagUpgrade(2, [3, 2])).toBe("Upgrade Needed");
    expect(tagUpgrade(2, [6, 4])).toBe(null);
  });

  test("a franchise QB is never an upgrade, however PFF ranks him", () => {
    // T00's QB grades worst in the league — Upgrade Needed on PFF alone.
    expect(suggestNeeds(league(), {}, NOW).T00.QB.label).toBe("Upgrade Needed");
    const s = suggestNeeds(league(), {}, NOW, { "T00-qb": { talent: "franchise" } }).T00.QB;
    expect(s.label).toBe("Set");
    expect(s.byTags).toBe(true);
    expect(suggestionReason(s)).toMatch(/by tags: T00 Starter \(Franchise\)/);
    // And an average starter at the league's best-graded spot is still a want.
    expect(suggestNeeds(league(), {}, NOW, { "T31-qb": { talent: "average" } }).T31.QB.label).toBe("Upgrade Wanted");
  });

  test("a raw backup with high development isn't a depth concern", () => {
    const rb = (abbr, i, backup) => ({
      abbr,
      players: [
        { id: `${abbr}-qb`, n: "QB", pos: "QB", g: 40 + i * 1.5, sn: 500, sp: 95, dob: "2000-01-01", d: 1 },
        { id: `${abbr}-rb1`, n: `${abbr} RB1`, pos: "HB", g: 40 + i * 1.5, sn: 400, sp: 70, dob: "2000-01-01", d: 1 },
        ...(backup ? [{ id: `${abbr}-rb2`, n: `${abbr} RB2`, pos: "HB", g: 50, sn: 5, sp: 5, dob: "2004-01-01", d: 2 }] : []),
      ],
    });
    const teams = league({ T31: (i) => rb("T31", i, true) }).map((t, i) => (t.abbr === "T31" ? t : rb(t.abbr, i, true)));
    expect(suggestNeeds(teams, {}, NOW).T31.RB.label).toBe("Depth Needed");
    expect(suggestNeeds(teams, {}, NOW, { "T31-rb2": { talent: "lowDepth", dev: "high" } }).T31.RB.label).toBe("Set");
    expect(suggestNeeds(teams, {}, NOW, { "T31-rb2": { talent: "lowDepth", dev: "low" } }).T31.RB.label).toBe("Depth Needed");
  });
});

test("the admin's depth order picks the starters", () => {
  // T31: a great QB with the snaps, and a backup who's been moved up to QB1.
  const withBackup = (abbr, i) => ({ ...team(abbr, i), players: [...team(abbr, i).players, { id: `${abbr}-qb2`, n: `${abbr} Backup`, pos: "QB", g: 41, sn: 10, sp: 2, dob: "2000-01-01", d: 2 }] });
  const teams = league({ T31: (i) => withBackup("T31", i) });
  expect(suggestNeeds(teams, {}, NOW).T31.QB.starters).toEqual(["T31 Starter"]);
  const s = suggestNeeds(teams, {}, NOW, {}, { T31: { QB: ["T31-qb2", "T31-qb"] } }).T31.QB;
  expect(s.starters).toEqual(["T31 Backup"]);
  expect(s.label).toBe("Upgrade Needed");
  // Ids from another team (a player who's left) don't count.
  expect(suggestNeeds(teams, {}, NOW, {}, { T31: { QB: ["T05-qb"] } }).T31.QB.starters).toEqual(["T31 Starter"]);
});


test("a role goes by the players tagged with it", () => {
  // Every team's nickel grades the same on coverage; T00's is tagged Plus Starter, T01's Average.
  const teams = Array.from({ length: 32 }, (_, i) => ({
    abbr: `T${String(i).padStart(2, "0")}`,
    players: [
      { id: `n${i}`, n: `Nickel ${i}`, pos: "CB", al: "SCB", g: 70, sn: 400, sp: 60, dob: "2000-01-01", x: { cov: [40 + i * 1.5, 300] } },
      { id: `s${i}`, n: `Safety ${i}`, pos: "S", g: 60, sn: 300, sp: 50, dob: "2000-01-01" },
    ],
  }));
  const tags = { n0: { talent: "plus", roles: ["SLOTCB"] }, n1: { talent: "average", roles: ["SLOTCB"] }, s2: { roles: ["SLOTCB"] } };
  const s = suggestNeeds(teams, {}, NOW, tags);
  expect(s.T00.SLOTCB).toMatchObject({ label: "Set", byTags: true, starters: ["Nickel 0"] });
  expect(s.T01.SLOTCB.label).toBe("Upgrade Wanted");
  // A safety tagged for the slot plays it, at the tier his grade suggests (60 → High-End Depth).
  expect(s.T02.SLOTCB).toMatchObject({ starters: ["Safety 2"], label: "Upgrade Needed" });
  // Untagged teams still go by PFF.
  expect(s.T31.SLOTCB.byTags).toBeUndefined();
});

test("guards and centers are their own positions", () => {
  const t = { abbr: "T00", players: [
    { id: 1, n: "G1", pos: "G", g: 80, sn: 900, sp: 90 }, { id: 2, n: "G2", pos: "G", g: 75, sn: 800, sp: 85 }, { id: 3, n: "C1", pos: "C", g: 70, sn: 900, sp: 95 },
  ] };
  const s = suggestNeeds([t], {}, NOW).T00;
  expect(s.G.starters).toEqual(["G1", "G2"]);
  expect(s.C.starters).toEqual(["C1"]);
  expect(s.IOL).toBeUndefined();
});

test("every role has PFF's read to fall back on", () => {
  const { ROLE_DETECT } = jest.requireActual("./teamNeedSuggestions");
  const { ROLES } = jest.requireActual("./draftSim/engine");
  ROLES.forEach((r) => expect([r.key, typeof ROLE_DETECT[r.key]?.plays]).toEqual([r.key, "function"]));
});

test("a role's own order picks who plays it, without moving the position's starters", () => {
  const t = { abbr: "T00", players: [
    { id: "a", n: "Big Nickel", pos: "S", g: 85, sn: 900, sp: 95, dob: "2000-01-01" },
    { id: "b", n: "Slot Guy", pos: "CB", g: 60, sn: 500, sp: 60, dob: "2000-01-01" },
  ] };
  const tags = { a: { talent: "difference", roles: ["SLOTCB"] }, b: { talent: "average", roles: ["SLOTCB"] } };
  expect(suggestNeeds([t], {}, NOW, tags).T00.SLOTCB.starters).toEqual(["Big Nickel"]);
  const s = suggestNeeds([t], {}, NOW, tags, {}, { T00: { SLOTCB: ["b", "a"] } }).T00;
  expect(s.SLOTCB).toMatchObject({ starters: ["Slot Guy"], label: "Upgrade Wanted" });
  expect(s.S.starters).toEqual(["Big Nickel"]);
});
