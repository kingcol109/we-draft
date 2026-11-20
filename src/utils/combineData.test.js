import { mergeCombineInvites, combineProfiles, normName, buildCombineSnapshotDocs, schoolResolver } from "./combineData";

const ours = (name, extra = {}) => ({ id: name, name, position: "WR", school: "Boston College", slug: "", round: 2, pick: 40, team: "", results: { forty: 4.5, height: 72, weight: 200, ...extra } });

describe("mergeCombineInvites", () => {
  it("fills a matched player's missing drills and keeps his own numbers", () => {
    const out = mergeCombineInvites({ 2018: [ours("DJ Moore Jr.")] }, { 2018: [{ name: "D.J. Moore", pos: "WR", school: "Boston Col.", pfr: "x", forty: 4.42, vertical: 39.5 }] });
    expect(out[2018]).toHaveLength(1);
    expect(out[2018][0].results).toMatchObject({ forty: 4.5, vertical: 39.5 });
  });

  it("replaces a known-bad number with the invite's", () => {
    const row = { ...ours("Lonnie Johnson Jr."), position: "DB", results: { forty: 5.12, weight: 281 } };
    const out = mergeCombineInvites({ 2019: [row] }, { 2019: [{ name: "Lonnie Johnson", pos: "CB", pfr: "y", forty: 4.52, weight: 213 }] });
    expect(out[2019][0].results).toMatchObject({ forty: 4.52, weight: 213 });
  });

  it("adds unmatched invites as undrafted, with our school name and position group", () => {
    const out = mergeCombineInvites({ 2018: [ours("A Player")] }, { 2018: [
      { name: "A Player", school: "Boston Col.", pfr: "a", forty: 4.5 },
      { name: "Big End", pos: "DE", school: "Boston Col.", weight: 300, forty: 5.0 },
      { name: "Rusher", pos: "OLB", school: "Iowa", weight: 250, forty: 4.7 },
    ] });
    const added = out[2018].filter((r) => r.undrafted);
    expect(added.map((r) => [r.name, r.position, r.school])).toEqual([["Big End", "DL", "Boston College"], ["Rusher", "EDGE", "Iowa"]]);
  });

  it("builds a year from invites alone", () => {
    const out = mergeCombineInvites({}, { 2005: [{ name: "Old Timer", pos: "RB", pfr: "o", round: 3, pick: 80, team: "Jets", forty: 4.4 }] });
    expect(out[2005][0]).toMatchObject({ round: 3, pick: 80, team: "Jets" });
    expect(out[2005][0].undrafted).toBeUndefined();
  });
});

test("2021's invites with no PFR id only fill in players we have", () => {
  const out = mergeCombineInvites({ 2021: [{ id: "a", name: "Known Guy", position: "OL", school: "", results: { forty: 5.1 } }] }, { 2021: [
    { name: "Known Guy", pos: "OL", vertical: 30 }, { name: "No Id", pos: "OL", forty: 4.52 }, { name: "Has Id", pos: "OL", pfr: "z", forty: 5.2 },
  ] });
  expect(out[2021].map((r) => r.name)).toEqual(["Known Guy", "Has Id"]);
  expect(out[2021][0].results.vertical).toBe(30);
});

test("the latest class gets its draft slot from the picks, and everyone else is undrafted", () => {
  const players = [
    { id: "a", Slug: "drafted-guy", Eligible: "2026", First: "Drafted", Last: "Guy", Position: "QB", "40 Yard ": 4.6 },
    { id: "b", Slug: "haynes-king", Eligible: "2026", First: "Haynes", Last: "King", Position: "QB", "40 Yard ": 4.5 },
  ];
  const docs = buildCombineSnapshotDocs({ players, latestPicks: { "drafted-guy": { round: 1, pick: 1, team: "Las Vegas Raiders" } }, latestDraftYear: 2026, version: 1 });
  const rows = docs.find((d) => d.id === "_combine_2026").data.rows;
  expect(rows.find((r) => r.name === "Drafted Guy")).toMatchObject({ round: 1, pick: 1, team: "Las Vegas Raiders" });
  expect(rows.find((r) => r.name === "Haynes King")).toMatchObject({ undrafted: true, round: null });
});

test("bench doesn't count toward the three-drill minimum, but counts in the score", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, position: "DL", school: "", results: { forty: 5 + i / 50, vertical: 30 - i, bench: 30 - i, broad: 110 - i } }));
  rows[0].results = { forty: 4.9, vertical: 35, bench: 40 }; // two drills + bench: out
  rows[1].results = { forty: 4.95, vertical: 34, broad: 120, bench: 39 }; // three drills + bench: in
  const { performers } = combineProfiles({ 2020: rows });
  expect(performers.DL.map((p) => p.name)).not.toContain("P0");
  expect(Object.keys(performers.DL.find((p) => p.name === "P1").drills)).toContain("bench");
});

describe("combineProfiles", () => {
  it("marks undrafted record holders", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ ...ours(`P${i}`), results: { forty: 4.6 + i / 100 } }));
    rows[0] = { ...rows[0], undrafted: true, results: { forty: 4.3 } };
    const { profiles } = combineProfiles({ 2020: rows });
    expect(profiles.WR.forty.top[0]).toMatchObject({ name: "P0", undrafted: true, value: 4.3 });
  });
});

test("normName ignores punctuation, accents and suffixes", () => {
  expect(normName("D.J. Moore Jr.")).toBe(normName("DJ Moore"));
  expect(normName("Amaré Barno")).toBe("amare barno");
});

test("school names resolve to ours, without false matches", () => {
  const ours = schoolResolver([
    { School: "Florida International", Short: "FIU", CFBDName: "Florida International" },
    { School: "Louisiana-Monroe", Short: "ULM", CFBDName: "UL Monroe" },
    { School: "Arkansas State", Short: "Ark St" }, { School: "Western Illinois" }, { School: "Indiana", Short: "IU" },
    { School: "Northwestern State", Short: "NSU" }, { School: "Miami (OH)" }, { School: "Miami" },
  ]);
  expect(ours("FIU")).toBe("Florida International");
  expect(ours("Florida International")).toBe("Florida International");
  expect(ours("La-Monroe")).toBe("Louisiana-Monroe");
  expect(ours("UL Monroe")).toBe("Louisiana-Monroe");
  expect(ours("Arkansas St.")).toBe("Arkansas State");
  expect(ours("West. Illinois")).toBe("Western Illinois");
  expect(ours("Northwestern St. (LA)")).toBe("Northwestern State");
  expect(ours("Indiana (PA)")).toBe("Indiana (PA)");
  expect(ours("Miami (OH)")).toBe("Miami (OH)");
  expect(ours("Harvard")).toBe("Harvard");
});

test("measurements count toward the Combine score, bigger is better", () => {
  // P0 tests best in every drill but is the smallest; P1 is next in every drill and the biggest.
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, position: "WR", school: "",
    results: { forty: 4.4 + i / 50, vertical: 40 - i, broad: 130 - i, shuttle: 4 + i / 50, height: 70 + (i === 0 ? 0 : i === 1 ? 20 : i), weight: 180 + (i === 0 ? 0 : i === 1 ? 60 : i) } }));
  const { performers } = combineProfiles({ 2020: rows });
  const p0 = performers.WR.find((p) => p.name === "P0");
  expect(p0.build.height).toEqual({ value: 70, pct: 0 });
  expect(p0.score).toBe(Math.round(((100 * 4 + 0 + 0) / 6) * 10) / 10);
  expect(performers.WR[0].name).toBe("P1");
});

test("a searched player's card matches how the best performers are scored", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, position: "WR", school: "", results: { forty: 4.4 + i / 50, vertical: 40 - i, broad: 130 - i, height: 70 + i } }));
  const byYear = { 2020: rows };
  const { performers } = combineProfiles(byYear);
  const { combinePools, combineCardFor } = require("./combineData");
  const card = combineCardFor(combinePools(byYear), rows[3], "2020");
  const p3 = performers.WR.find((p) => p.name === "P3");
  expect(card.score).toBe(p3.score);
  expect(card.drills.forty.pct).toBe(p3.drills.forty.pct);
  expect(combineCardFor(combinePools(byYear), { ...rows[0], results: { forty: 4.3, bench: 20 } }, "2020").score).toBeNull();
});
