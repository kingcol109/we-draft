import { xCard, xCardInput, xCardImageUrls, X_W, X_H } from "./graphics";

// A fixed-width font stands in for Bebas Neue.
const env = { measure: (t, size) => String(t).length * size * 0.45, images: {} };
const player = { First: "Mark", Last: "Bowman", Position: "TE", School: "USC", Eligible: "2029" };
const school = { Color1: "#990000", Color2: "#ffcc00", LogoDark: "usc-dark", Logo1: "usc-light" };

test("the card is 16:9 and says who he is", () => {
  const svg = xCard(xCardInput({ player, school, kicker: "2029 NFL Draft Prospect", chips: [{ value: "#1 TE", label: "2029 CLASS" }] }), env);
  expect(svg).toContain(`width="${X_W}"`);
  expect(svg).toContain(`height="${X_H}"`);
  expect(X_W / X_H).toBeCloseTo(16 / 9, 1);
  ["BOWMAN", "MARK", "2029 NFL DRAFT PROSPECT", "#1 TE"].forEach((t) => expect(svg).toContain(t));
  expect(svg).not.toContain("undefined");
  expect(svg).not.toContain("NaN");
});

test("it draws with nothing but a name", () => {
  const svg = xCard(xCardInput({ player: { First: "A", Last: "B" } }), env);
  expect(svg).not.toContain("undefined");
  expect(svg).not.toContain("NaN");
});

test("on the school's color it asks for the dark logo", () => {
  expect(xCardImageUrls(xCardInput({ player, school, photo: { url: "shot" }, brandLogo: "wd" }))).toEqual(["wd", "shot", "usc-dark"]);
});
