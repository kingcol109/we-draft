// src/utils/instagram/knockout.js
//
// An action shot shot on a plain backdrop (most of ours: a white studio
// background) → the player alone, the backdrop made transparent, so a post
// can set him on its own colors. Pure — RGBA pixels in, changed in place —
// so the admin page (canvas ImageData) and a server (resvg's pixels) share it.
//
// The backdrop is the color around the photo's border. It's taken away from
// the border inward, flooding only through pixels close to it (within tol):
// a white jersey inside the player isn't reached unless it touches the
// backdrop. Pixels a little further off (up to tol + soft) are the edge's
// anti-aliasing: they go part-transparent, with the backdrop's tint taken out
// of their color, so no light halo is left around him.

// The border's backdrop: its median color and the share of border pixels
// within tol of it. A photo whose border isn't mostly one color has none.
export function backdropOf(px, w, h, tol = 24) {
  const border = [];
  const at = (x, y) => (y * w + x) * 4;
  for (let x = 0; x < w; x += 2) { border.push(at(x, 0), at(x, h - 1)); }
  for (let y = 0; y < h; y += 2) { border.push(at(0, y), at(w - 1, y)); }
  const med = [0, 1, 2].map((c) => {
    const v = border.map((i) => px[i + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const near = border.filter((i) => px[i + 3] > 200 && Math.max(...[0, 1, 2].map((c) => Math.abs(px[i + c] - med[c]))) <= tol).length;
  return { color: med, share: near / border.length };
}

// Is there a backdrop worth taking out? (Most of the border one color, and
// the photo not already transparent there.)
export function hasBackdrop(px, w, h) {
  return backdropOf(px, w, h).share >= 0.6;
}

export function knockOut(px, w, h, { tol = 6, soft = 16 } = {}) {
  const { color: bg } = backdropOf(px, w, h, tol);
  const dist = (i) => Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2]));
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (p) => { if (!seen[p]) { seen[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++];
    const i = p * 4;
    const d = dist(i);
    if (d > tol + soft) continue;
    if (d > tol) {
      // The edge: part-transparent, the backdrop's tint taken out.
      const a = (d - tol) / soft;
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, Math.round((px[i + c] - bg[c] * (1 - a)) / a)));
      px[i + 3] = Math.round(px[i + 3] * a);
      continue;
    }
    px[i + 3] = 0;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  return px;
}

// The box around what's left once the backdrop is out (alpha over min),
// a little padding kept — so a cut-out player fills the frame he's drawn
// into rather than the empty photo around him. null when nothing is.
export function opaqueBounds(px, w, h, min = 24, pad = 0.015) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const p = Math.round(Math.max(w, h) * pad);
  x0 = Math.max(0, x0 - p);
  y0 = Math.max(0, y0 - p);
  x1 = Math.min(w - 1, x1 + p);
  y1 = Math.min(h - 1, y1 + p);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
