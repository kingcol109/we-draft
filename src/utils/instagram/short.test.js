import { shortInput, shortFrame, shortEnd, SHORT_W, SHORT_H, SHORT_WINDOW } from "./short";
import { kit } from "./posts";

// A fixed-width font stands in for Bebas Neue.
const env = { measure: (t, size) => String(t).length * size * 0.45, images: {} };
const player = { First: "Luke", Last: "Metz", Position: "LB", School: "Alabama" };
const school = { School: "Alabama", Color1: "#9e1b32", Color2: "#828a8f", LogoDark: "bama" };
const valid = (svg) => {
  expect(svg).toContain(`width="${SHORT_W}" height="${SHORT_H}"`);
  expect(svg).not.toContain("undefined");
  expect(svg).not.toContain("NaN");
};

test("the frame: name up top, stat lines below, the window left clear", () => {
  const input = shortInput({ player, school, lines: "9 tkl\n\n1 sack\nx\ny", kicker: "vs LSU" });
  expect(input.lines).toEqual(["9 tkl", "1 sack", "x"]);
  const svg = shortFrame(input, env);
  valid(svg);
  ["METZ", "LUKE", `LB${kit.DOT}ALABAMA`, "9 TKL", "1 SACK", "VS LSU"].forEach((t) => expect(svg).toContain(`>${t}<`));
  // Nothing is painted over the window: every fill sits in a band (clipped) or on its edges.
  const { y, h } = SHORT_WINDOW;
  expect(svg).toContain(`<clipPath id="topc"><rect width="${SHORT_W}" height="${y}"/></clipPath>`);
  expect(svg).toContain(`<clipPath id="botc"><rect y="${y + h}"`);
});

test("the end screen: follow, the handle, the site", () => {
  const svg = shortEnd(shortInput({ player, school }), env);
  valid(svg);
  ["FOLLOW", "FOR MORE", "@WEDRAFTSITE", "WE-DRAFT.COM"].forEach((t) => expect(svg).toContain(`>${t}<`));
});
