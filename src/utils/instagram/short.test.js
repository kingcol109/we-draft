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

test("edits: a typed text replaces its default, an empty one hides it, images can be turned off", () => {
  const edits = { last: "Metz Jr", first: "", tag: "", stack: "Roll Tide", follow: "Subscribe", handle: "", color: "#112233", showLogo: false, showEndBadge: false };
  const input = shortInput({ player, school, lines: "9 tkl", badgeLogo: "wd", edits });
  expect(input.color).toBe("#112233");
  expect(input.logoDark).toBe("");
  expect(input.badgeLogo).toBe("wd");
  expect(input.endBadgeLogo).toBe("");
  const frame = shortFrame(input, env);
  valid(frame);
  expect(frame).toContain(">METZ JR<");
  expect(frame).toContain("ROLL TIDE");
  expect(frame).not.toContain(">LUKE<");
  expect(frame).not.toContain(`LB${kit.DOT}ALABAMA`);
  const end = shortEnd(input, env);
  valid(end);
  expect(end).toContain(">SUBSCRIBE<");
  expect(end).not.toContain("@WEDRAFTSITE");
  expect(end).toContain(">WE-DRAFT.COM<");
});

test("no edits: the same Short as before", () => {
  const a = shortInput({ player, school, lines: "9 tkl", kicker: "vs LSU" });
  const b = shortInput({ player, school, lines: "9 tkl", kicker: "vs LSU", edits: {} });
  expect(shortFrame(b, env)).toBe(shortFrame(a, env));
  expect(shortEnd(b, env)).toBe(shortEnd(a, env));
});
