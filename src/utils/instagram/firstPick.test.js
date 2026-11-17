import { firstPickInput, firstPickSvg, firstPickImageUrls, firstPickAdjust, FIRST_PICK_PHOTO } from "./firstPick";

const img = { href: "data:image/png;base64,x", w: 400, h: 800 };
const env = { measure: (t, size) => String(t).length * size * 0.45, images: { "shot.png": img, "nyj.png": img, "usc.png": img, "wd.png": img } };
const player = { First: "Mark", Last: "Bowman", Position: "TE", School: "USC", Eligible: "2027", Height: "6'5\"", Weight: "245" };
const team = { City: "New York", Team: "Jets", Color1: "#125740", Color2: "#ffffff", LogoDark: "nyj.png" };

test("the input: team colors, the pick, the shot's saved placement", () => {
  const input = firstPickInput({ player, school: { LogoDark: "usc.png" }, team, abbr: "NYJ", pick: { overall: 12, round: 1 }, photo: { url: "shot.png", firstPick: { x: 30, y: -40, scale: 1.2 } }, brandLogo: "wd.png" });
  expect(input).toMatchObject({ first: "Mark", last: "Bowman", color: "#125740", teamName: "NEW YORK JETS", overall: 12, year: "2027", height: "6'5\"", adjust: { x: 30, y: -40, scale: 1.2 } });
  expect(firstPickImageUrls(input).sort()).toEqual(["nyj.png", "shot.png", "usc.png", "wd.png"]);
});

test("no placement is as laid out", () => {
  expect(firstPickAdjust(undefined)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0 });
  expect(firstPickAdjust(null)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0 });
});

test("the photo moves by its placement alone — the same on every team", () => {
  const draw = (t) => firstPickSvg(firstPickInput({ player, team: t, abbr: "X", pick: { overall: 3 }, photo: { url: "shot.png", firstPick: { x: 30, y: -40, scale: 1.2 } } }), env);
  const photoOf = (svg) => svg.match(/<g transform="[^"]+"><image x="40" y="40"[^>]+>/)?.[0];
  const a = photoOf(draw(team));
  const b = photoOf(draw({ Color1: "#fb4f14", Color2: "#002244", LogoDark: "nyj.png" }));
  expect(a).toBeTruthy();
  expect(a).toBe(b);
  // Scaled about his feet: the box's foot, center.
  const fx = FIRST_PICK_PHOTO.x + FIRST_PICK_PHOTO.w / 2;
  const fy = FIRST_PICK_PHOTO.y + FIRST_PICK_PHOTO.h;
  expect(a).toContain(`translate(${fx + 30} ${fy - 40}) scale(1.2) translate(${-fx} ${-fy})`);
});

test("draws without a photo or logos", () => {
  const svg = firstPickSvg(firstPickInput({ player: { First: "A", Last: "B" }, pick: { overall: 1 } }), { measure: env.measure, images: {} });
  expect(svg).not.toContain("FIRST PICK");
  expect(svg).not.toContain("SELECT");
  expect(svg).toContain("#1");
  expect(svg).not.toContain("<image");
});

test("a rotation turns the shot about the middle of its box, inside the placement", () => {
  const svg = firstPickSvg(firstPickInput({ player, team, photo: { url: "shot.png", firstPick: { x: 10, y: 0, scale: 1, rotate: -8 } } }), env);
  const cx = FIRST_PICK_PHOTO.x + FIRST_PICK_PHOTO.w / 2;
  const cy = FIRST_PICK_PHOTO.y + FIRST_PICK_PHOTO.h / 2;
  expect(svg).toContain(`<g transform="rotate(-8 ${cx} ${cy})"><image x="40" y="40"`);
  expect(firstPickAdjust({ rotate: 90 }).rotate).toBe(45);
});

test("the alternate logo sits right under the wordmark, behind him", () => {
  const images = { ...env.images, "wm.png": { href: "data:wm", w: 1000, h: 250 }, "alt.png": { href: "data:alt", w: 600, h: 600 } };
  const t = { ...team, WordmarkDark: "wm.png", LogoAlt: "alt.png" };
  const input = firstPickInput({ player, team: t, photo: { url: "shot.png" } });
  expect(input.bgLogo).toBe("alt.png");
  const svg = firstPickSvg(input, { ...env, images });
  // The wordmark: 1120 wide → 280 tall, from y 40; the logo's top at 320.
  expect(svg).toMatch(/<image x="-20" y="40" width="1120" height="280"[^>]+href="data:wm"/);
  expect(svg).toMatch(/<image x="[^"]+" y="320" [^>]+href="data:alt"/);
  expect(svg.indexOf("data:alt")).toBeLessThan(svg.indexOf("data:image/png;base64,x\"/></g>"));
  expect(firstPickInput({ player, team }).bgLogo).toBe("nyj.png");
});

test("a light team color takes the light-background wordmark (the Steelers' black one)", () => {
  const marks = { Wordmark: "black.png", WordmarkDark: "white.png" };
  expect(firstPickInput({ player, team: { ...marks, Color1: "#FFB612" } }).wordmark).toBe("black.png");
  expect(firstPickInput({ player, team: { ...marks, Color1: "#125740" } }).wordmark).toBe("white.png");
  expect(firstPickInput({ player, team: { WordmarkDark: "white.png", Color1: "#FFB612" } }).wordmark).toBe("white.png");
});

test("a wordmark's trim ignores stray specks at its edge (the Browns')", () => {
  // eslint-disable-next-line global-require
  const { inkBounds, opaqueBounds } = require("./knockout");
  const w = 200;
  const h = 100;
  const px = new Uint8Array(w * h * 4);
  const on = (x, y) => { px[(y * w + x) * 4 + 3] = 255; };
  // Two specks along the top; the lettering from row 40 to 79, columns 20–179.
  on(5, 0); on(150, 1);
  for (let y = 40; y < 80; y++) for (let x = 20; x < 180; x++) on(x, y);
  expect(opaqueBounds(px, w, h, 24, 0)).toEqual({ x: 5, y: 0, w: 175, h: 80 });
  expect(inkBounds(px, w, h)).toEqual({ x: 20, y: 40, w: 160, h: 40 });
});
