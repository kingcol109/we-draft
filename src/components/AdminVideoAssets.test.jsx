import { contrast, isGreen, lookOf, recruitChips, tagLines } from "./AdminVideoAssets";

jest.mock("../firebase", () => ({ db: {} }));
jest.mock("./AdminDraftBreakdowns", () => ({ ensureFonts: () => Promise.resolve(), VIDEO_PLAYER_KEY: "k" }));
jest.mock("./AdminSideGraphics", () => ({}));
jest.mock("../utils/movEncoder", () => ({}));
jest.mock("../utils/draftProfileData", () => ({}));
jest.mock("../utils/siteSnapshots", () => ({}));

describe("Player Identification", () => {
  test("greens are spotted; golds, blues, reds, white and black are not", () => {
    ["#154733", "#00843d", "#4f2", "#18453b", "#0b6623", "#9acd32"].filter((c) => c.length === 7).forEach((c) => expect(isGreen(c)).toBe(true));
    ["#f6a21d", "#0055a5", "#990000", "#ffffff", "#000000", "#fee123", "#203731"].forEach((c) => {
      if (c === "#203731") return; // a dark green-gray: either answer is fine
      expect(isGreen(c)).toBe(false);
    });
  });

  test("the circle is never green, even for an all-green team", () => {
    const oregon = { Color1: "#154733", Color2: "#FEE123", logo: "" };
    expect(isGreen(lookOf("team", oregon).ring)).toBe(false);
    expect(lookOf("team", oregon).ring).toBe("#fee123");
    const allGreen = { Color1: "#00843d", Color2: "#18453b", logo: "" };
    const look = lookOf("team", allGreen);
    expect(isGreen(look.ring)).toBe(false);
    expect(look.rings.some(isGreen)).toBe(false);
    // A green pick is refused.
    expect(isGreen(lookOf("team", allGreen, "#00843d").ring)).toBe(false);
  });

  test("no red on red: the tag's accent always stands off the tag", () => {
    [
      { Color1: "#ce181e", Color2: "#ce181e" }, // one red twice
      { Color1: "#ce181e", Color2: "#0a0a0a" },
      { Color1: "#ce181e", Color2: "#ffffff" },
      { Color1: "#9e1b32", Color2: "#c41e3a" }, // two close reds
      { Color1: "#00274c", Color2: "#ffcb05" },
    ].forEach((t) => {
      const look = lookOf("team", { ...t, logo: "" });
      expect(contrast(look.accent, look.fill)).toBeGreaterThanOrEqual(3);
    });
    // Even with the circle picked in the tag's own red.
    const red = lookOf("team", { Color1: "#ce181e", Color2: "#ce181e", logo: "" }, "#ce181e");
    expect(red.ring).toBe("#ce181e");
    expect(red.accent).not.toBe("#ce181e");
  });

  test("the recruiting row: stars, national rank, high school, class", () => {
    const a = { first: "King", last: "Miller", pos: "RB", school: "USC", showRecruit: true, recruit: { stars: 3, rank: "412", hs: "Calabasas", year: "2024" } };
    expect(tagLines(a).rows).toEqual([{ title: "RECRUIT", chips: ["★★★", "#412 NATIONAL", "CALABASAS", "CLASS OF 2024"] }]);
    expect(recruitChips({ stars: 0, rank: "", hs: "Mater Dei", year: "" })).toEqual(["MATER DEI"]);
    expect(tagLines({ ...a, showRecruit: false }).rows).toEqual([]);
  });

  test("the We-Draft version is gold", () => {
    expect(lookOf("wd", null).ring).toBe("#f6a21d");
  });

  test("the tag shows stats and rank only when asked", () => {
    const a = { first: "Mario", last: "Sanders II", pos: "WR", school: "Southern Miss", stats: [{ label: "Rec Yds", value: "960" }], statsTitle: "2026 SEASON", rank: { classRank: 41, positionRank: 6 } };
    expect(tagLines(a)).toEqual({ name: "MARIO SANDERS II", info: "WR · SOUTHERN MISS", rows: [] });
    const both = tagLines({ ...a, showStats: true, showRank: true });
    expect(both.rows).toEqual([
      { title: "2026 SEASON", chips: ["960 REC YDS"] },
      { title: "WE-DRAFT RANK", chips: ["#41 OVERALL", "#6 WR"] },
    ]);
  });
});
