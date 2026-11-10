import { cutupText, statLineOf, schoolTag, xCutupText, xLength, X_MAX } from "./videoText";

test("cut-up text: the title, the description's plug and hashtags, the pinned comment", () => {
  const t = cutupText({ first: "Ousmane", last: "Kromah", position: "RB", school: "Florida State", mascot: "Seminoles", eligible: "2027", slug: "ousmane-kromah-2027-rb", season: "2026", statLine: "612 YDS, 7 TD", games: 9 });
  expect(t.title).toBe("Ousmane Kromah 2026 Season Cut-Up | Florida State RB");
  expect(t.comment).toBe("Evaluate Ousmane Kromah and create your own draft board at We-Draft.com");
  expect(t.description).toContain("through 9 games (612 YDS, 7 TD)");
  expect(t.description).toContain("https://we-draft.com/player/ousmane-kromah-2027-rb");
  expect(t.description).toContain("2027 NFL Draft prospect at running back for Florida State");
  for (const k of ["Ousmane Kromah highlights", "film", "Ousmane Kromah 2026", "Florida State Seminoles football", "Florida State RB", "2027 NFL Draft running backs", "NFL Draft prospects", "college football highlights", "NFL Draft scouting", "film breakdown", "cut-up"]) expect(t.description).toContain(k);
  expect(t.description).not.toMatch(/highlights, .*film, /);
  expect(t.description.trim().split("\n").pop()).toBe("#FloridaStateFootball #NFLDraft #CollegeFootball");
});

test("school hashtags and stat lines", () => {
  expect(schoolTag("Texas A&M")).toBe("#TexasAMFootball");
  expect(statLineOf({ cols: ["REC", "YDS", "TD"], rows: [{ year: "2026", vals: ["37", "447", "6"] }] }, "2026")).toBe("37 REC, 447 YDS, 6 TD");
  expect(statLineOf({ cols: ["REC"], rows: [] }, "2026")).toBe("");
});

test("the X post: the cut-up, the stat line, the player's page, under 280", () => {
  const x = xCutupText({ first: "Ousmane", last: "Kromah", position: "RB", school: "Florida State", slug: "ousmane-kromah-2027-rb", season: "2026", statLine: "612 YDS, 7 TD", games: 9 });
  expect(x.split("\n")[0]).toBe("🎥 Ousmane Kromah's 2026 season cut-up | Florida State RB");
  expect(x).toContain("612 YDS, 7 TD through 9 games");
  expect(x).toContain("https://we-draft.com/player/ousmane-kromah-2027-rb");
  expect(x.trim().split("\n").pop()).toBe("#FloridaStateFootball #NFLDraft");
  expect(xLength(x)).toBeLessThanOrEqual(X_MAX);
  expect(xLength("see https://we-draft.com/player/a-very-long-slug-indeed")).toBe(4 + 23);
});
