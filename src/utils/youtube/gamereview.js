// src/utils/youtube/gamereview.js
//
// The Game Review YouTube thumbnail (Admin → Videos → Graphics → Thumbnail,
// template "Game Review"), 1920×1080, plain data in, SVG out: his school's
// color with a halftone of dots, his name across the top (Black Lives, in the
// school's second color), a big headline down the left (Milker, white —
// "HE'S / HOW / OLD?!"), the We-Draft logo bottom left, and his cutout big
// on the right, in front of the words.
//
// Every element can be moved, sized and spaced: input.layout = { name,
// headline, logo: { dx, dy (pixels), scale (1 = as laid out), spacing
// (letter spacing, px), lh (headline line height, 1 = as laid out) } }; the
// photo has its own adjust ({ x, y, scale }). gameReviewBoxes gives each
// element's box, for picking and dragging it on the preview.
//
// Fonts: Black Lives and Milker are this computer's own (licensed, never put
// in the repo or uploaded). env.fontCss embeds them (the editor reads them
// from this computer — AdminYouTubeGraphics.jsx); env.measure(text, size,
// which) measures in them, which = "name" | "headline".
import { kit } from "../instagram/posts.js";

const { esc, r1 } = kit;

export const GR_W = 1920;
export const GR_H = 1080;
export const GR_NAME_FONT = "WD Black Lives";
export const GR_HEAD_FONT = "WD Milker";
const NAME_CSS = `'${GR_NAME_FONT}', 'Black Lives', 'a Black Lives', 'Arial Black', sans-serif`;
const HEAD_CSS = `'${GR_HEAD_FONT}', 'Milker', 'Arial Black', sans-serif`;
export const GR_ELEMENTS = ["name", "headline", "logo", "photo"];
export const GR_LABELS = { name: "Name", headline: "Headline", logo: "We-Draft logo", photo: "Player" };

const hex = (v, fb) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : fb);
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;
const clamp = (v, lo, hi, fb) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; };
const lay = (input, k) => {
  const l = input.layout?.[k] || {};
  return { dx: Number(l.dx) || 0, dy: Number(l.dy) || 0, scale: clamp(l.scale, 0.2, 4, 1), spacing: clamp(l.spacing, -40, 120, 0), lh: clamp(l.lh, 0.5, 2, 1) };
};
const lines = (s) => String(s || "").toUpperCase().split(/\n/).map((x) => x.trim()).filter(Boolean);
// Width with letter spacing.
const widthOf = (env, t, size, which, spacing) => env.measure(String(t), size, which) + spacing * Math.max(0, String(t).length - 1);

// As laid out (before the admin's moves): the reference thumbnail.
const BASE = {
  name: { x: 48, top: 52, size: 112 },
  headline: { x: 40, top: 200, size: 238, lh: 0.94 },
  logo: { x: 58, bottom: GR_H - 30, w: 900 },
  // Wide and tall past the bottom, pinned to the top: a full-body shot fills it by its width and is cropped
  // at the waist or so, big, as the reference thumbnail.
  photo: [860, -10, 1160, 1900],
};

// Where everything goes: { name, headline, logo: { ...its numbers, box: [x, y, w, h] }, photo: { box } }.
export function gameReviewLayout(input, env) {
  const out = {};
  const n = lay(input, "name");
  const name = String(input.name || "").toUpperCase().trim();
  const ns = BASE.name.size * n.scale;
  const nx = BASE.name.x + n.dx;
  const ntop = BASE.name.top + n.dy;
  const nw = name ? widthOf(env, name, ns, "name", n.spacing) : 0;
  out.name = { text: name, x: nx, base: ntop + ns * 0.8, size: ns, spacing: n.spacing, box: [nx, ntop, nw, ns * 0.9] };

  const h = lay(input, "headline");
  const hl = lines(input.headline);
  const hs = BASE.headline.size * h.scale;
  const step = hs * BASE.headline.lh * h.lh;
  const hx = BASE.headline.x + h.dx;
  const htop = BASE.headline.top + h.dy;
  const hw = hl.length ? Math.max(...hl.map((t) => widthOf(env, t, hs, "headline", h.spacing))) : 0;
  out.headline = { lines: hl, x: hx, base: htop + hs * 0.8, size: hs, step, spacing: h.spacing, box: [hx, htop, hw, hl.length ? hs * 0.86 + step * (hl.length - 1) : 0] };

  const g = lay(input, "logo");
  const im = env.images?.[input.brandLogo];
  const lw = BASE.logo.w * g.scale;
  const lh = im?.w && im?.h ? (lw * im.h) / im.w : lw / 5;
  const lx = BASE.logo.x + g.dx;
  const ly = BASE.logo.bottom - lh + g.dy;
  out.logo = { x: lx, y: ly, w: lw, h: lh, box: [lx, ly, lw, lh] };

  // The photo's box as placed (kit.placed scales about the foot of the box).
  const [px, py, pw, ph] = BASE.photo;
  const s = clamp(input.adjust?.scale, 0.5, 2.5, 1);
  const ax = px + pw / 2 + (Number(input.adjust?.x) || 0);
  const ay = py + ph + (Number(input.adjust?.y) || 0);
  out.photo = { box: [ax - (pw / 2) * s, ay - ph * s, pw * s, ph * s] };
  return out;
}
export const gameReviewBoxes = (input, env) => Object.fromEntries(Object.entries(gameReviewLayout(input, env)).map(([k, v]) => [k, v.box]));

// The halftone: a grid of dots, biggest up and right of center, fading out to the bottom left.
function halftone(color, strength) {
  if (strength <= 0) return "";
  const gap = 34;
  let out = "";
  for (let row = 0; row * gap * 0.866 < GR_H + gap; row += 1) {
    const y = row * gap * 0.866;
    for (let col = 0; col * gap < GR_W + gap; col += 1) {
      const x = col * gap + (row % 2 ? gap / 2 : 0);
      const dx = (x - GR_W * 0.6) / GR_W;
      const dy = (y - GR_H * 0.3) / GR_H;
      const f = Math.max(0, 1 - Math.sqrt(dx * dx * 1.1 + dy * dy * 1.6) * 1.15);
      const r = gap * 0.42 * strength * (0.25 + 0.75 * f);
      if (r < 1.2) continue;
      out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}"/>`;
    }
  }
  return `<g fill="${color}" fill-opacity="0.55">${out}</g>`;
}

function txt(x, y, value, size, fill, css, spacing, extra = "") {
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${css}" font-size="${r1(size)}" fill="${fill}"${spacing ? ` letter-spacing="${r1(spacing)}"` : ""}${extra}>${esc(value)}</text>`;
}

// input: { name, headline (a line a line), color (the ground — his school's
// Color1), accent (the name — Color2), headColor, dotColor ("" = the accent, Color2; drawn at 55%,
// two), dots (0–1.5, 0 = none), photo, adjust, brandLogo, logoWhite,
// photoBehind (the player behind the words), layout, selected (an element's
// box drawn dashed — the editor's preview only) }.
export function gameReview(input, env) {
  const ground = hex(input.color, "#990000");
  const accent = hex(input.accent, "#ffc72c");
  const head = hex(input.headColor, "#ffffff");
  // The dots: his school's second color (or the picked one), part see-through over the ground.
  const dot = hex(input.dotColor, accent);
  const L = gameReviewLayout(input, env);
  const defs = (env.fontCss ? `<style>${env.fontCss}</style>` : "")
    + `<radialGradient id="grVig" cx="0.55" cy="0.42" r="0.85"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>`
    + `<filter id="grPhoto" x="-10%" y="-10%" width="125%" height="125%"><feDropShadow dx="-16" dy="14" stdDeviation="16" flood-color="${shade(ground, 0.25)}" flood-opacity="0.6"/></filter>`
    + `<filter id="grText" x="-5%" y="-10%" width="115%" height="130%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.25"/></filter>`
    + `<filter id="grWhite"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>`;
  let body = `<rect width="${GR_W}" height="${GR_H}" fill="${ground}"/>`
    + halftone(dot, clamp(input.dots, 0, 1.5, 1))
    + `<rect width="${GR_W}" height="${GR_H}" fill="url(#grVig)"/>`;

  let words = "";
  if (L.name.text) words += txt(L.name.x, L.name.base, L.name.text, L.name.size, accent, NAME_CSS, L.name.spacing, ' filter="url(#grText)"');
  L.headline.lines.forEach((t, i) => { words += txt(L.headline.x, L.headline.base + i * L.headline.step, t, L.headline.size, head, HEAD_CSS, L.headline.spacing, ' filter="url(#grText)"'); });
  const im = env.images?.[input.brandLogo];
  const logo = im?.href ? `<image x="${r1(L.logo.x)}" y="${r1(L.logo.y)}" width="${r1(L.logo.w)}" height="${r1(L.logo.h)}" preserveAspectRatio="xMinYMid meet" href="${im.href}"${input.logoWhite !== false ? ' filter="url(#grWhite)"' : ""}/>` : "";
  let photo = "";
  const shot = env.images?.[input.photo];
  if (shot?.href) {
    const [px, py, pw, ph] = BASE.photo;
    const one = `<image x="${px}" y="${py}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMin meet" href="${shot.href}"/>`;
    photo = `<g filter="url(#grPhoto)">${kit.placed(one, px, py, pw, ph, input.adjust)}</g>`;
  }
  body += input.photoBehind ? photo + words + logo : words + logo + photo;

  const sel = input.selected && L[input.selected]?.box;
  if (sel && sel[2] > 0 && sel[3] > 0) {
    body += `<rect x="${r1(sel[0] - 8)}" y="${r1(sel[1] - 8)}" width="${r1(sel[2] + 16)}" height="${r1(sel[3] + 16)}" fill="none" stroke="#00e5ff" stroke-width="4" stroke-dasharray="16 10"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GR_W}" height="${GR_H}" viewBox="0 0 ${GR_W} ${GR_H}"><defs>${defs}</defs>${body}</svg>`;
}
export const gameReviewImageUrls = (input) => [...new Set([input.photo, input.brandLogo].filter(Boolean))];

// The settings a saved thumbnail keeps (and the metadata the analytics
// group by): everything but the images' data.
export const GR_DEFAULTS = { headline: "HE’S\nHOW\nOLD?!", dots: 1, logoWhite: true, photoBehind: false, layout: {} };
