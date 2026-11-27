import { cardFields, cardHeight, teaserItems, DEFAULT_CARD, CARD_DEFAULT_SECONDS, CARD_W } from "./scoutCard";

jest.mock("../AdminSideGraphics", () => ({}));

describe("Scouting Card", () => {
  test("first over last name, position · school, then height / weight / class (blanks show a dash)", () => {
    expect(cardFields({ first: "Brent", last: "Gordon Jr.", pos: "DB", school: "Louisiana", height: `6'1"`, weight: "195", cls: "2027" })).toEqual({
      first: "BRENT", last: "GORDON JR.", info: "DB · LOUISIANA",
      facts: [["HEIGHT", `6'1"`], ["WEIGHT", "195 LBS"], ["CLASS", "2027"]],
    });
    expect(cardFields({ first: "A", last: "B", pos: "WR", school: "USC" }).facts).toEqual([["HEIGHT", "—"], ["WEIGHT", "—"], ["CLASS", "—"]]);
  });

  test("the verdict stays locked: grade, strengths, weaknesses by default", () => {
    expect(teaserItems(DEFAULT_CARD.teaser).map((i) => i.key)).toEqual(["grade", "strengths", "weaknesses"]);
    expect(teaserItems({ comp: true }).map((i) => i.key)).toEqual(["comp"]);
  });

  test("sized for the middle third and centered there; 4 s by default", () => {
    expect(CARD_W).toBe(640);
    expect(DEFAULT_CARD.x).toBe(960);
    expect(cardHeight("FULL REPORT INSIDE")).toBeLessThan(1080 * 0.6);
    expect(cardHeight("")).toBeLessThan(cardHeight("FULL REPORT INSIDE"));
    expect(CARD_DEFAULT_SECONDS).toBe(4);
  });

  test("it identifies the player: the focus is on by default", () => {
    expect(DEFAULT_CARD.focus).toBe(true);
  });
});
