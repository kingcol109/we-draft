import { customInput, customSlides, customImageUrls, customCutoutUrls, customPlayerIds, customCaption, layerBox, newLayer, blankSlide, CUSTOM_W, CUSTOM_H } from "./custom";

const env = { measure: (t, size) => String(t).length * size * 0.45, images: { shot: { href: "data:image/png;base64,AA", w: 100, h: 200 }, logo: { href: "data:image/png;base64,BB", w: 200, h: 100 }, wd: { href: "data:image/png;base64,CC", w: 300, h: 100 } } };

test("a blank post draws, at Instagram's size", () => {
  const [s] = customSlides(customInput({ slides: [blankSlide()], brandLogo: "wd" }), env);
  expect(s.svg).toContain(`width="${CUSTOM_W}"`);
  expect(s.svg).toContain(`height="${CUSTOM_H}"`);
  expect(s.svg).not.toContain("undefined");
});

test("layers draw in order, last on top", () => {
  const slide = { ...blankSlide(), layers: [newLayer("shape", { color: "#112233" }), newLayer("logo", { url: "logo" }), newLayer("text", { value: "On top" })] };
  const { svg } = customSlides(customInput({ slides: [slide], footerOn: false }), env)[0];
  expect(svg.indexOf("#112233")).toBeLessThan(svg.indexOf("base64,BB"));
  expect(svg.indexOf("base64,BB")).toBeLessThan(svg.indexOf("ON TOP"));
  expect(svg).not.toContain("NaN");
});

test("a picture's box keeps the image's shape; text measures itself", () => {
  expect(layerBox(newLayer("player", { url: "shot", x: 10, y: 20, w: 300 }), env)).toEqual({ x: 10, y: 20, w: 300, h: 600 });
  expect(layerBox(newLayer("logo", { url: "logo", x: 0, y: 0, w: 300 }), env).h).toBe(150);
  const t = layerBox(newLayer("text", { value: "AB\nABCD", size: 100, spacing: 0, x: 0, y: 0 }), env);
  expect(t.w).toBe(180);
  expect(t.h).toBeCloseTo(196);
});

test("text lines and alignment", () => {
  const slide = { ...blankSlide(), layers: [newLayer("text", { value: "one\ntwo", align: "center", size: 100, x: 100, y: 100 })] };
  const { svg } = customSlides(customInput({ slides: [slide], footerOn: false }), env)[0];
  expect(svg).toContain("ONE");
  expect(svg).toContain("TWO");
  expect(svg).toContain('text-anchor="middle"');
});

test("the footer is optional; a carousel's says to swipe until the last slide", () => {
  const input = customInput({ slides: [blankSlide(), blankSlide()], footerOn: true, cta: "my link", brandLogo: "wd" });
  const [a, b] = customSlides(input, env);
  expect(a.svg).toContain("SWIPE FOR MORE");
  expect(b.svg).toContain("MY LINK");
  expect(customSlides({ ...input, footerOn: false }, env)[0].svg).not.toContain("SWIPE");
});

test("the We-Draft logo is the build's file, never a saved link", () => {
  const input = customInput({ slides: [{ ...blankSlide(), layers: [newLayer("brand")] }], brandLogo: "wd" });
  expect(input.slides[0].layers[0].url).toBeUndefined();
  expect(customImageUrls(input)).toEqual(["wd"]);
  expect(customSlides({ ...input, footerOn: false }, env)[0].svg).toContain("base64,CC");
});

test("it lists what it needs: images, cut-outs, players, a caption", () => {
  const slide = { bg: { color: "#000000", image: "back" }, layers: [newLayer("player", { url: "shot", playerId: "p1", name: "Mark Bowman" }), newLayer("image", { url: "other" }), newLayer("text", { value: "Big\nnews" })] };
  const input = customInput({ slides: [slide], brandLogo: "wd" });
  expect(customImageUrls(input).sort()).toEqual(["back", "other", "shot", "wd"]);
  expect(customCutoutUrls(input)).toEqual(["shot"]);
  expect(customPlayerIds(input)).toEqual(["p1"]);
  expect(customCaption(input)).toContain("Big news");
  expect(customCaption(input)).toContain("#MarkBowman");
});
