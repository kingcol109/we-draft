import { knockOut, hasBackdrop } from "./knockout";

// A 20×20 white photo with a "player": a red block, and inside it a white
// jersey patch the backdrop doesn't touch.
function photo() {
  const w = 20;
  const h = 20;
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) {
    const i = (y * w + x) * 4;
    px[i] = 200; px[i + 1] = 20; px[i + 2] = 30;
  }
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) {
    const i = (y * w + x) * 4;
    px[i] = 250; px[i + 1] = 250; px[i + 2] = 250;
  }
  return { px, w, h };
}
const alpha = ({ px, w }, x, y) => px[(y * w + x) * 4 + 3];

test("the backdrop goes, the player and his white jersey stay", () => {
  const p = photo();
  expect(hasBackdrop(p.px, p.w, p.h)).toBe(true);
  knockOut(p.px, p.w, p.h);
  expect(alpha(p, 0, 0)).toBe(0);
  expect(alpha(p, 19, 10)).toBe(0);
  expect(alpha(p, 6, 6)).toBe(255);
  expect(alpha(p, 10, 10)).toBe(255);
});

test("a photo without a plain border has no backdrop", () => {
  const w = 10;
  const h = 10;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = (i * 37) % 256; px[i * 4 + 1] = (i * 91) % 256; px[i * 4 + 2] = (i * 53) % 256; px[i * 4 + 3] = 255; }
  expect(hasBackdrop(px, w, h)).toBe(false);
});
