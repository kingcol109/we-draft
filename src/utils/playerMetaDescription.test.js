import { buildPlayerMetaDescription } from "./playerMetaDescription";

const full = {
  name: "Jeremiah Smith", school: "Ohio State", position: "WR", classYear: "2027",
  height: `6'3"`, weight: "215", communityGrade: "Early First Round", hasTraits: true, publicEvalCount: 3,
};

test("full record reads as a complete, player-specific sentence", () => {
  const d = buildPlayerMetaDescription(full);
  expect(d).toMatch(/^Explore Jeremiah Smith's 2027 NFL Draft scouting report: Ohio State WR/);
  expect(d).toContain("community grade of Early First Round");
  expect(d.endsWith(".")).toBe(true);
  expect(d.length).toBeLessThanOrEqual(160);
});

test("drops lower-priority details before exceeding the target length", () => {
  const d = buildPlayerMetaDescription({ ...full, name: "Christopherson Featherstonehaugh-Montgomery", school: "Southern Mississippi" });
  expect(d.length).toBeLessThanOrEqual(160);
  expect(d).toContain("Christopherson Featherstonehaugh-Montgomery");
  expect(d).toContain("Early First Round");
});

test("never mentions a grade, measurements or evaluations that don't exist", () => {
  const d = buildPlayerMetaDescription({ name: "Aaron Flowers", school: "Oregon", position: "DB", classYear: "2027", communityGrade: "Watchlist" });
  expect(d).toBe("Explore Aaron Flowers' 2027 NFL Draft scouting report: Oregon DB. Add your own grade and see the community consensus.");
  expect(d).not.toMatch(/grade of|lbs|evaluation/);
});

test("singular evaluation, no traits", () => {
  const d = buildPlayerMetaDescription({ ...full, hasTraits: false, publicEvalCount: 1, height: "", weight: "" });
  expect(d).toContain("Read 1 public scouting evaluation.");
});

test("incomplete records produce no awkward punctuation", () => {
  for (const p of [{}, { name: "Sam Lee" }, { school: "Miami" }, { name: "Sam Lee", position: "QB", classYear: "TBD" }]) {
    const d = buildPlayerMetaDescription(p);
    expect(d).not.toMatch(/undefined|null|NaN|\s[,.:]|:\s*[,.]|,\s*,|\s{2}/);
    expect(d).toMatch(/NFL Draft scouting report/);
  }
  expect(buildPlayerMetaDescription({ name: "Sam Lee", position: "QB", classYear: "TBD" }))
    .toBe("Explore Sam Lee's NFL Draft scouting report: QB. Add your own grade and see the community consensus.");
});

test("descriptions differ between players", () => {
  const a = buildPlayerMetaDescription(full);
  const b = buildPlayerMetaDescription({ ...full, name: "Greg Smith", school: "North Carolina", position: "DB" });
  expect(a).not.toBe(b);
});

test("non-numeric weight is shown as-is, numeric gets lbs", () => {
  expect(buildPlayerMetaDescription({ ...full, weight: "215" })).toContain("215 lbs");
  expect(buildPlayerMetaDescription({ ...full, weight: "215 lbs" })).not.toContain("lbs lbs");
});
