import { buildComparisonMeta, describeComps } from "./comparisonMeta";

describe("buildComparisonMeta", () => {
  test("prospect page: specific title, heading and description", () => {
    const m = buildComparisonMeta({ name: "Jeremiah Smith", school: "Ohio State", position: "WR" });
    expect(m.title).toBe("Jeremiah Smith NFL Player Comparisons and Measurements | We-Draft");
    expect(m.heading).toBe("Jeremiah Smith NFL Player Comparisons and Measurements");
    expect(m.description).toBe("Compare Jeremiah Smith, Ohio State WR, to historical NFL Draft picks using physical measurements, athletic testing, and playing traits.");
  });

  test("adds as many real comp names as fit in ~160 characters", () => {
    const m = buildComparisonMeta({ name: "Jeremiah Smith", school: "Ohio State", position: "WR", compNames: ["Calvin Johnson", "A.J. Green", "Julio Jones"] });
    expect(m.description.length).toBeLessThanOrEqual(160);
    expect(m.description).toBe("Jeremiah Smith (Ohio State WR) NFL player comparisons based on measurements, athletic testing and traits. Closest historical match: Calvin Johnson.");
    const short = buildComparisonMeta({ name: "Bo Nix", position: "QB", compNames: ["Joe Burrow", "Jared Goff", "Drew Lock"] });
    expect(short.description).toMatch(/Closest historical matches: Joe Burrow(, Jared Goff)? and (Jared Goff|Drew Lock)\.$/);
    expect(short.description.length).toBeLessThanOrEqual(160);
  });

  test("falls back to the base sentence when no comp name fits", () => {
    const m = buildComparisonMeta({ name: "Christopherson Featherstonehaugh", school: "Southern Mississippi", position: "EDGE", compNames: ["A Very Long Historical Player Name Indeed"] });
    expect(m.description).not.toMatch(/Closest/);
    expect(m.description).toMatch(/^Compare Christopherson Featherstonehaugh, Southern Mississippi EDGE, to historical/);
  });

  test("single comp uses singular wording; blanks are ignored", () => {
    const m = buildComparisonMeta({ name: "Sam Lee", compNames: ["", "Bo Nix"] });
    expect(m.description).toBe("Sam Lee NFL player comparisons based on measurements, athletic testing and traits. Closest historical match: Bo Nix.");
  });

  test("missing school/position leave no stray punctuation", () => {
    const m = buildComparisonMeta({ name: "Sam Lee" });
    expect(m.description).toBe("Compare Sam Lee to historical NFL Draft picks using physical measurements, athletic testing, and playing traits.");
  });

  test("no prospect (blank calculator / unresolved slug) gets the generic, non-player text", () => {
    const m = buildComparisonMeta({});
    expect(m.title).toBe("NFL Player Comparisons and Measurements | We-Draft");
    expect(m.description).not.toMatch(/undefined|null/);
  });

  test("different prospects get different descriptions", () => {
    expect(buildComparisonMeta({ name: "A B", school: "X" }).description).not.toBe(buildComparisonMeta({ name: "C D", school: "Y" }).description);
  });
});

describe("describeComps", () => {
  const metrics = [{ key: "height", label: "Height" }, { key: "forty", label: "40 Yard" }, { key: "weight", label: "Weight" }, { key: "vert", label: "Vertical" }];
  const fmt = (m, v) => `${v}`;
  const prospect = { height: 75, forty: 4.4, weight: 215, vert: 40 };

  test("lists the metrics with the smallest standardized gap, in order, plus shared traits", () => {
    const [d] = describeComps([{
      record: { First: "A" }, similarity: 87.6,
      values: { height: 75, forty: 4.5, weight: 220, vert: 36 },
      breakdown: { height: 0, forty: -0.9, weight: -0.3, vert: 1.5 },
      traits: { sharedStrengths: ["Hands"], sharedWeaknesses: ["Blocking"] },
    }], prospect, metrics, fmt);
    expect(d.similarity).toBe(88);
    expect(d.closest.map((c) => c.label)).toEqual(["Height", "Weight", "40 Yard"]);
    expect(d.closest[1]).toEqual({ label: "Weight", comp: "220", prospect: "215" });
    expect(d.sharedStrengths).toEqual(["Hands"]);
    expect(d.sharedWeaknesses).toEqual(["Blocking"]);
  });

  test("skips metrics the comp has no value for and never invents a score for a Select", () => {
    const [d] = describeComps([{
      record: {}, select: true, similarity: 50,
      values: { height: null, forty: 4.5 }, breakdown: { forty: 0.2 }, traits: null,
    }], prospect, metrics, fmt);
    expect(d.similarity).toBeNull();
    expect(d.closest.map((c) => c.label)).toEqual(["40 Yard"]);
    expect(d.sharedStrengths).toEqual([]);
  });
});
