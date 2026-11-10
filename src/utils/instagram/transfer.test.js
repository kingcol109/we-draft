import { transferInput, transferSlides, transferCaption, transferImageUrls } from "./transfer";
import { IG_W, IG_H } from "./posts";

// A fixed-width font stands in for Bebas Neue.
const env = { measure: (t, size) => String(t).length * size * 0.45, images: {} };
const player = { id: "p1", First: "Xavier", Last: "Atkins", Position: "LB", Eligible: "2027", Slug: "xavier-atkins", Height: "6'2\"", Weight: 220 };
const auburn = { School: "Auburn", Color1: "#0c2340", Color2: "#e87722", Logo1: "auburn-light", LogoDark: "auburn-dark" };
const lsu = { School: "LSU", Color1: "#461d7c", Color2: "#fdd023", Logo1: "lsu-light", LogoDark: "lsu-dark" };
const report = {
  grade: { label: "Second Round", short: "2nd", bg: "#0F6E56", border: "#085041", qualifier: null, avg: 5 }, evals: 7, bars: true,
  strengths: [{ term: "Run Defense", pct: 60 }], weaknesses: [{ term: "Coverage", pct: 40 }], posRank: 4, posOf: 60, classRank: 40, classOf: 600, fits: [],
};
const valid = (svg) => {
  expect(svg).toContain(`width="${IG_W}"`);
  expect(svg).toContain(`height="${IG_H}"`);
  expect(svg).not.toContain("undefined");
  expect(svg).not.toContain("NaN");
};

test("entered the portal: one image or a three-slide carousel", () => {
  const one = transferSlides(transferInput({ kind: "portal", player, from: auburn, report }), env);
  expect(one.map((s) => s.name)).toEqual(["portal"]);
  one.forEach((s) => valid(s.svg));
  expect(one[0].svg).toContain("DESTINATION");
  expect(one[0].svg).not.toContain("LEAVING");
  expect(one[0].svg).toContain("AUBURN");
  expect(one[0].svg).toContain("ATKINS");
  // The class is just its year.
  expect(one[0].svg).toContain("2027");
  expect(one[0].svg).not.toContain("CLASS");
  // No swipe line on a single image.
  expect(one[0].svg).not.toContain("SWIPE");

  const many = transferSlides(transferInput({ kind: "portal", player, from: auburn, report, carousel: true }), env);
  expect(many.map((s) => s.name)).toEqual(["portal", "his-file", "where-next"]);
  many.forEach((s) => valid(s.svg));
  expect(many[0].svg).toContain("SWIPE");
  expect(many[1].svg).toContain("THE FILE ON");
  expect(many[1].svg).toContain("RUN DEFENSE");
  expect(many[2].svg).toContain("ATKINS GO?");
});

test("transferred: the new school's colors, the old one struck, one image or two slides", () => {
  const one = transferSlides(transferInput({ kind: "transfer", player, from: auburn, to: lsu, report }), env);
  expect(one.map((s) => s.name)).toEqual(["transfer"]);
  valid(one[0].svg);
  // The logos say where from and where to; the words say who and what.
  expect(one[0].svg).toContain("TRANSFER");
  expect(one[0].svg).toContain("XAVIER ATKINS");
  ["FROM", "NOW AT", "AUBURN", ">LSU<", "CLASS"].forEach((w) => expect(one[0].svg).not.toContain(w));
  // The page is the new school's color.
  expect(one[0].svg).toContain(lsu.Color1);

  const many = transferSlides(transferInput({ kind: "transfer", player, from: auburn, to: lsu, report, carousel: true }), env);
  expect(many.map((s) => s.name)).toEqual(["transfer", "what-they-get"]);
  many.forEach((s) => valid(s.svg));
  expect(many[1].svg).toContain("WHAT LSU IS GETTING");
});

test("on both covers, nothing is drawn over the player and no logo is faded behind him", () => {
  const photoEnv = { ...env, images: { shot: { href: "data:image/png;base64,AA", w: 100, h: 200 }, "lsu-dark": { href: "data:image/png;base64,BB", w: 10, h: 10 }, "auburn-dark": { href: "data:image/png;base64,CC", w: 10, h: 10 } } };
  const textAfterPhoto = (svg) => svg.slice(svg.indexOf('href="data:image/png;base64,AA"')).match(/<text [^>]*y="([\d.]+)"/g).map((m) => Number(m.match(/y="([\d.]+)"/)[1]));
  const portal = transferSlides(transferInput({ kind: "portal", player, from: auburn, photo: { url: "shot" } }), photoEnv)[0].svg;
  const transfer = transferSlides(transferInput({ kind: "transfer", player, from: auburn, to: lsu, photo: { url: "shot" } }), photoEnv)[0].svg;
  // Whatever's drawn after him sits below where the photo ends.
  textAfterPhoto(portal).forEach((y) => expect(y).toBeGreaterThan(936));
  textAfterPhoto(transfer).forEach((y) => expect(y).toBeGreaterThan(936));
  expect(portal).not.toContain('stroke-opacity="0.7"');
  // No logo drawn see-through.
  expect(transfer).not.toMatch(/<image[^>]*opacity=/);
});

test("the two posts don't share a design", () => {
  const a = transferSlides(transferInput({ kind: "portal", player, from: auburn, to: lsu }), env)[0].svg;
  const b = transferSlides(transferInput({ kind: "transfer", player, from: auburn, to: lsu }), env)[0].svg;
  expect(a).toContain("<ellipse");
  expect(b).not.toContain("<ellipse");
});

test("a player with no report and no colors still draws", () => {
  const bare = { First: "A", Last: "Long-Hyphenated Name The Third" };
  transferSlides(transferInput({ kind: "portal", player: bare, carousel: true }), env).forEach((s) => valid(s.svg));
  transferSlides(transferInput({ kind: "transfer", player: bare, carousel: true }), env).forEach((s) => valid(s.svg));
  const none = transferSlides(transferInput({ kind: "portal", player, from: auburn, carousel: true }), env)[1].svg;
  expect(none).toContain("NO COMMUNITY REPORT YET");
});

test("captions say what happened and fit Instagram's limits", () => {
  const p = transferCaption(transferInput({ kind: "portal", player, from: auburn }));
  expect(p).toContain("Xavier Atkins (LB, 2027 NFL Draft class) has entered the transfer portal from Auburn.");
  expect(p).toContain("we-draft.com/player/xavier-atkins");
  expect(p).toContain("#TransferPortal");
  const t = transferCaption(transferInput({ kind: "transfer", player, from: auburn, to: lsu }));
  expect(t).toContain("is transferring from Auburn to LSU.");
  expect(t.length).toBeLessThan(2200);
});

test("it asks for the logos it draws, and only those", () => {
  expect(transferImageUrls(transferInput({ kind: "portal", player, from: auburn, to: lsu, photo: { url: "shot" }, brandLogo: "wd" }))).toEqual(["wd", "shot", "auburn-dark"]);
  expect(transferImageUrls(transferInput({ kind: "transfer", player, from: auburn, to: lsu, brandLogo: "wd" }))).toEqual(["wd", "auburn-dark", "lsu-dark"]);
});
