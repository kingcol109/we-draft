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

test("specific needs are judged on whoever plays the role: the slot corner by his coverage grade", () => {
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
