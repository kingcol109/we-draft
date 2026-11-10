// src/utils/youtube/icecold.js
//
// The Ice-Cold Cut-Ups graphics (Admin → Videos → Graphics,
// AdminYouTubeGraphics.jsx), both 1920×1080, plain data in, SVG out:
//   iceOutline  the frame around a cut-up: the player's panel down the left
//               (name, position | size, his career table, his school's logo,
//               the Ice-Cold Cut-Ups script), the video window (transparent
//               by default, for Premiere) and a line across the bottom.
//   iceThumb    the YouTube thumbnail: his name big down the left, a tag, the
//               player's cutout big on the right, on snow.
// Fonts: Magneto (the script) and Franklin Gothic Demi — this computer's own
// (they ship with Office; never uploaded), so the SVG names them and the
// browser draws them. env.measure(text, size, family) measures in them.
// Browsers know Franklin Gothic Demi as the 600 weight of "Franklin Gothic"
// (its DirectWrite family), not by its Windows name — like Eras Bold ITC.
import { kit } from "../instagram/posts.js";

const { esc, r1 } = kit;

export const ICE_W = 1920;
export const ICE_H = 1080;
export const ICE_BLUE = "#88c2f3";
export const ICE_NAVY = "#004687";
export const SCRIPT = "Magneto";
export const BOLD = "Franklin Gothic Demi";
const SCRIPT_CSS = `'Magneto', 'Brush Script MT', cursive`;
const BOLD_CSS = `'Franklin Gothic', 'Franklin Gothic Demi', 'Franklin Gothic Medium', Arial, sans-serif`;
export const BOLD_WEIGHT = 600;
const WHITE = "#ffffff";

// Text in a family: { anchor, weight, opacity, filter, stroke }.
function txt(x, y, value, size, fill, family, o = {}) {
  const css = family === SCRIPT ? SCRIPT_CSS : BOLD_CSS;
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${css}" font-size="${r1(size)}"${family === SCRIPT ? ' font-weight="bold"' : ` font-weight="${BOLD_WEIGHT}"`} fill="${fill}"`
    + `${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""}${o.opacity != null && o.opacity < 1 ? ` fill-opacity="${o.opacity}"` : ""}`
    + `${o.filter ? ` filter="url(#${o.filter})"` : ""}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.strokeW || 6}" stroke-linejoin="round" paint-order="stroke"` : ""}`
    + `>${esc(value)}</text>`;
}
const widthIn = (env, value, size, family) => env.measure(String(value), size, family);
// The biggest size ≤ max that fits maxW.
const fit = (env, value, max, maxW, family, min = 10) => {
  const w = widthIn(env, value, max, family);
  return w <= maxW ? max : Math.max(min, Math.floor((max * maxW) / Math.max(1, w)));
};
function img(env, url, x, y, w, h, par = "xMidYMid meet", extra = "") {
  const im = url && env.images?.[url];
  if (!im?.href || w <= 0 || h <= 0) return "";
  return `<image x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="${par}" href="${im.href}"${extra}/>`;
}
const has = (env, url) => !!(url && env.images?.[url]?.href);

// Snow: the same flakes for the same seed (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function snow(seed, n, box, { min = 1.5, max = 5, bokeh = 0 } = {}) {
  const rand = rng(seed);
  const [x0, y0, w, h] = box;
  let out = "";
  for (let i = 0; i < n; i += 1) {
    const x = x0 + rand() * w;
    const y = y0 + rand() * h;
    const r = min + rand() ** 2.2 * (max - min);
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${WHITE}" fill-opacity="${r1(0.55 + rand() * 0.45)}"/>`;
  }
  for (let i = 0; i < bokeh; i += 1) {
    const x = x0 + rand() * w;
    const y = y0 + rand() * h;
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(7 + rand() * 9)}" fill="${WHITE}" fill-opacity="${r1(0.18 + rand() * 0.22)}" filter="url(#iceBlur)"/>`;
  }
  // A few four-point sparkles.
  for (let i = 0; i < Math.round(n / 25); i += 1) {
    const x = x0 + rand() * w;
    const y = y0 + rand() * h;
    const s = 6 + rand() * 8;
    out += `<path d="M${r1(x)} ${r1(y - s)} Q${r1(x)} ${r1(y)} ${r1(x + s)} ${r1(y)} Q${r1(x)} ${r1(y)} ${r1(x)} ${r1(y + s)} Q${r1(x)} ${r1(y)} ${r1(x - s)} ${r1(y)} Q${r1(x)} ${r1(y)} ${r1(x)} ${r1(y - s)}Z" fill="${WHITE}" fill-opacity="0.9"/>`;
  }
  return out;
}
const blurDef = '<filter id="iceBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>';
const svgDoc = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${ICE_W}" height="${ICE_H}" viewBox="0 0 ${ICE_W} ${ICE_H}"><defs>${defs}</defs>${body}</svg>`;

// ── The outline ──
export const PANEL_W = 375;
const BORDER = 12;
const WIN_B = 862;
// The video window: [x, y, w, h].
export const ICE_WINDOW = [PANEL_W + BORDER, 0, ICE_W - PANEL_W - BORDER, WIN_B];

// input: { first, last, sub ("WR | 6'1\" 195"), table ({ title, cols, rows:
// [{ year, logo, vals, partial }], total } | null), games (the partial
// season's games), number (his jersey number), logo (faded behind the number), cta, fillWindow, seed }.
export function iceOutline(input, env) {
  const defs = blurDef
    + `<filter id="iceLift" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="${ICE_NAVY}" flood-opacity="0.45"/></filter>`
    + `<filter id="iceCard" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="${ICE_NAVY}" flood-opacity="0.35"/></filter>`
    + `<filter id="iceNum" x="-10%" y="-10%" width="130%" height="130%"><feDropShadow dx="7" dy="8" stdDeviation="0" flood-color="${ICE_NAVY}" flood-opacity="0.55"/></filter>`
    + `<linearGradient id="icePanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WHITE}" stop-opacity="0.22"/><stop offset="1" stop-color="${WHITE}" stop-opacity="0"/></linearGradient>`;
  const [wx, , ww, wh] = ICE_WINDOW;
  // The light blue everywhere but the window (unless it's filled).
  const bg = input.fillWindow
    ? `<rect width="${ICE_W}" height="${ICE_H}" fill="${ICE_BLUE}"/>`
    : `<path fill-rule="evenodd" fill="${ICE_BLUE}" d="M0 0H${ICE_W}V${ICE_H}H0Z M${wx} 0H${wx + ww}V${wh}H${wx}Z"/>`;
  let body = bg
    + `<rect width="${PANEL_W}" height="${WIN_B}" fill="url(#icePanel)"/>`
    + snow(input.seed || 7, 70, [0, 0, PANEL_W, ICE_H], { min: 1.2, max: 3.6, bokeh: 6 })
    + snow((input.seed || 7) + 1, 110, [PANEL_W, WIN_B + BORDER, ICE_W - PANEL_W, ICE_H - WIN_B - BORDER], { min: 1.2, max: 4, bokeh: 10 })
    + `<rect x="${PANEL_W}" y="0" width="${BORDER}" height="${WIN_B + BORDER}" fill="${ICE_NAVY}"/>`
    + `<rect x="${PANEL_W}" y="${WIN_B}" width="${ICE_W - PANEL_W}" height="${BORDER}" fill="${ICE_NAVY}"/>`;

  // The name and his line.
  const cx = PANEL_W / 2;
  const nameW = PANEL_W - 36;
  const first = String(input.first || "").toUpperCase();
  const last = String(input.last || "").toUpperCase();
  const ns = Math.min(fit(env, first, 84, nameW, BOLD, 30), fit(env, last, 84, nameW, BOLD, 30));
  body += txt(cx, 92, first, ns, WHITE, BOLD, { anchor: "middle", filter: "iceLift" })
    + txt(cx, 92 + ns * 0.9, last, ns, WHITE, BOLD, { anchor: "middle", filter: "iceLift" });
  let y = 92 + ns * 0.9 + 56;
  if (input.sub) body += txt(cx, y, input.sub, fit(env, input.sub, 48, nameW, BOLD, 20), ICE_NAVY, BOLD, { anchor: "middle" });
  y += 26;

  // The career table: a card.
  const t = input.table;
  if (t && t.rows?.length) {
    const x = 18;
    const w = PANEL_W - 36;
    const headH = 46;
    const colH = 32;
    const rowH = t.rows.length > 4 ? 38 : 42;
    const totH = 44;
    const h = headH + colH + rowH * t.rows.length + totH;
    const sznW = 70;
    const teamW = 46;
    const statW = (w - sznW - teamW) / Math.max(1, t.cols.length);
    const colX = (i) => x + sznW + teamW + statW * i + statW / 2;
    const vs = (vals) => Math.min(24, ...vals.map((v) => fit(env, v, 24, statW - 8, BOLD, 12)));
    let card = `<rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" rx="16" fill="${WHITE}"/>`;
    card += `<path d="M${x} ${r1(y + headH)}V${r1(y + 16)}Q${x} ${r1(y)} ${x + 16} ${r1(y)}H${x + w - 16}Q${x + w} ${r1(y)} ${x + w} ${r1(y + 16)}V${r1(y + headH)}Z" fill="${ICE_NAVY}"/>`;
    card += txt(x + w / 2, y + 33, t.title, fit(env, t.title, 30, w - 30, BOLD, 16), WHITE, BOLD, { anchor: "middle" });
    let ry = y + headH;
    card += `<rect x="${x}" y="${r1(ry)}" width="${w}" height="${colH}" fill="#d6eafc"/>`;
    const hs = 17;
    card += txt(x + sznW / 2, ry + 22, "SZN", hs, ICE_NAVY, BOLD, { anchor: "middle" }) + txt(x + sznW + teamW / 2, ry + 22, "TEAM", fit(env, "TEAM", hs, teamW - 4, BOLD, 10), ICE_NAVY, BOLD, { anchor: "middle" });
    t.cols.forEach((c, i) => { card += txt(colX(i), ry + 22, c, fit(env, c, hs, statW - 6, BOLD, 10), ICE_NAVY, BOLD, { anchor: "middle" }); });
    ry += colH;
    const rs = vs(t.rows.flatMap((r) => r.vals));
    t.rows.forEach((r, k) => {
      if (k % 2) card += `<rect x="${x}" y="${r1(ry)}" width="${w}" height="${rowH}" fill="#eef6fe"/>`;
      const by = ry + rowH / 2 + rs * 0.36;
      const yr = r.partial ? `${r.year}*` : r.year;
      card += txt(x + sznW / 2 + 2, by, yr, Math.min(rs, 22, fit(env, `${r.year}*`, 22, sznW - 12, BOLD, 12)), "#0d2340", BOLD, { anchor: "middle" });
      const ls = rowH - 10;
      card += img(env, r.logo, x + sznW + (teamW - ls) / 2, ry + 5, ls, ls);
      r.vals.forEach((v, i) => { card += txt(colX(i), by, v, rs, "#0d2340", BOLD, { anchor: "middle" }); });
      card += `<rect x="${x + 10}" y="${r1(ry + rowH - 1)}" width="${w - 20}" height="1" fill="${ICE_NAVY}" fill-opacity="0.08"/>`;
      ry += rowH;
    });
    // The career line, in navy.
    card += `<path d="M${x} ${r1(ry)}H${x + w}V${r1(ry + totH - 16)}Q${x + w} ${r1(ry + totH)} ${x + w - 16} ${r1(ry + totH)}H${x + 16}Q${x} ${r1(ry + totH)} ${x} ${r1(ry + totH - 16)}Z" fill="${ICE_NAVY}"/>`;
    const ts = Math.min(24, vs(t.total));
    card += txt(x + (sznW + teamW) / 2, ry + totH / 2 + 8, "CAREER", 21, WHITE, BOLD, { anchor: "middle" });
    t.total.forEach((v, i) => { card += txt(colX(i), ry + totH / 2 + ts * 0.36, v, ts, WHITE, BOLD, { anchor: "middle" }); });
    body += `<g filter="url(#iceCard)">${card}</g>`;
    y += h;
    const partial = t.rows.find((r) => r.partial);
    if (partial && input.games) {
      const note = `*${partial.year} STATS THROUGH ${input.games} GAME${input.games === 1 ? "" : "S"}`;
      body += txt(cx, y + 30, note, fit(env, note, 19, w, BOLD, 11), ICE_NAVY, BOLD, { anchor: "middle" });
      y += 30;
    }
  }

  // His school's logo, faded, with his jersey number over it; then the script.
  const scriptTop = 762;
  const logoTop = y + 26;
  const logoH = Math.max(0, scriptTop - 22 - logoTop);
  const num = String(input.number ?? "").replace(/^#/, "").trim();
  if (logoH > 40 && input.logo) {
    // The school's logo, faded behind the number (full strength when there's no number).
    if (num) body += img(env, input.logo, 30, logoTop - 14, PANEL_W - 60, logoH + 28, "xMidYMid meet", ' opacity="0.35"');
    else body += img(env, input.logo, 24, logoTop, PANEL_W - 48, Math.min(240, logoH), "xMidYMid meet", ' filter="url(#iceCard)"');
  }
  if (num && logoH > 40) {
    // The digits sit centered on the logo; the "#" hangs off their left edge.
    const hs = (n) => n * 0.45;
    const half = (n) => widthIn(env, num, n, BOLD) / 2 + 6 + widthIn(env, "#", hs(n), BOLD);
    const n = Math.min(logoH * (input.logo ? 0.82 : 0.98), 230, Math.floor((230 * (PANEL_W / 2 - 22)) / Math.max(1, half(230))));
    const left = cx - widthIn(env, num, n, BOLD) / 2;
    const base = logoTop + logoH / 2 + n * 0.36;
    body += `<g filter="url(#iceNum)">`
      + txt(left - 6, base - n * 0.38, "#", hs(n), WHITE, BOLD, { anchor: "end" })
      + txt(cx, base, num, n, WHITE, BOLD, { anchor: "middle" })
      + "</g>";
  }
  const ss = Math.min(fit(env, "Ice-Cold", 68, PANEL_W - 30, SCRIPT, 30), fit(env, "Cut-Ups", 68, PANEL_W - 30, SCRIPT, 30));
  body += txt(cx, scriptTop + ss * 0.62, "Ice-Cold", ss, ICE_NAVY, SCRIPT, { anchor: "middle", stroke: WHITE, strokeW: 5 })
    + txt(cx + 10, scriptTop + ss * 1.38, "Cut-Ups", ss, ICE_NAVY, SCRIPT, { anchor: "middle", stroke: WHITE, strokeW: 5 });

  // The line across the bottom.
  const cta = String(input.cta || "").toUpperCase();
  if (cta) {
    const cs = fit(env, cta, 112, ICE_W - 80, BOLD, 40);
    body += txt(ICE_W / 2, WIN_B + BORDER + (ICE_H - WIN_B - BORDER) / 2 + cs * 0.36, cta, cs, WHITE, BOLD, { anchor: "middle", filter: "iceLift" });
  }
  return svgDoc(defs, body);
}
export const iceOutlineImageUrls = (input) => [...new Set([input.logo, ...(input.table?.rows || []).map((r) => r.logo)].filter(Boolean))];

// ── The thumbnail ──
// input: { name (big, a line a word), tag ("2026 FILM", a pill under it),
// nameSize / tagSize (1 = the default), photo
// (the cutout's url), adjust ({ x, y, scale }), logo (his school's, faint
// behind him — when showLogo), iceEdge (the white edge round him), seed }.
// Big and cropped at the bottom: his top two-thirds or so, as a run shot.
const PHOTO_BOX = [740, 30, 1260, 1520];
export function iceThumb(input, env) {
  const defs = blurDef
    + `<radialGradient id="iceSky" cx="0.68" cy="0.42" r="0.85"><stop offset="0" stop-color="#c9e6fd"/><stop offset="0.45" stop-color="${ICE_BLUE}"/><stop offset="1" stop-color="#4f97d6"/></radialGradient>`
    + `<pattern id="iceDots" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><circle cx="13" cy="13" r="6" fill="${WHITE}"/></pattern>`
    + `<radialGradient id="iceDotFade" cx="0.05" cy="0.5" r="0.9"><stop offset="0" stop-color="${WHITE}" stop-opacity="0.5"/><stop offset="0.6" stop-color="${WHITE}" stop-opacity="0.12"/><stop offset="1" stop-color="${WHITE}" stop-opacity="0"/></radialGradient>`
    + `<mask id="iceDotMask"><rect width="${ICE_W}" height="${ICE_H}" fill="url(#iceDotFade)"/></mask>`
    + `<linearGradient id="iceFrost" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WHITE}" stop-opacity="0.55"/><stop offset="1" stop-color="${WHITE}" stop-opacity="0"/></linearGradient>`
    + `<filter id="iceEdge" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="7" result="d"/><feFlood flood-color="${WHITE}"/><feComposite in2="d" operator="in" result="edge"/>`
    + `<feGaussianBlur in="d" stdDeviation="18" result="g"/><feFlood flood-color="#d8eeff" flood-opacity="0.9"/><feComposite in2="g" operator="in" result="glow"/>`
    + `<feDropShadow in="SourceAlpha" dx="-14" dy="12" stdDeviation="14" flood-color="${ICE_NAVY}" flood-opacity="0.45" result="sh"/>`
    + `<feMerge><feMergeNode in="sh"/><feMergeNode in="glow"/><feMergeNode in="edge"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    + `<filter id="iceShade" x="-10%" y="-10%" width="130%" height="130%"><feDropShadow dx="9" dy="10" stdDeviation="0" flood-color="${ICE_NAVY}" flood-opacity="1"/></filter>`
    + `<filter id="iceSoft" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="${ICE_NAVY}" flood-opacity="0.35"/></filter>`;
  const seed = input.seed || 11;
  let body = `<rect width="${ICE_W}" height="${ICE_H}" fill="url(#iceSky)"/>`
    + `<rect width="${ICE_W}" height="${ICE_H}" fill="url(#iceDots)" mask="url(#iceDotMask)"/>`
    + snow(seed, 150, [0, 0, ICE_W, ICE_H], { min: 1.5, max: 5.5, bokeh: 22 });
  // His school's logo, faint behind him.
  if (input.showLogo && has(env, input.logo)) body += `<g opacity="0.2">${img(env, input.logo, 960, 90, 900, 900)}</g>`;
  // Him.
  if (has(env, input.photo)) {
    const [px, py, pw, ph] = PHOTO_BOX;
    let shot = img(env, input.photo, px, py, pw, ph, "xMidYMax meet");
    shot = kit.placed(shot, px, py, pw, ph, input.adjust);
    body += input.iceEdge ? `<g filter="url(#iceEdge)">${shot}</g>` : shot;
  }
  body += snow(seed + 5, 40, [0, 0, ICE_W, ICE_H], { min: 2, max: 6 });
  body += `<rect width="${ICE_W}" height="70" fill="url(#iceFrost)"/>`;

  // His name, big down the left (a line a word), and the tag under it.
  // nameSize / tagSize: 1 = the default.
  const L = 64;
  const maxW = Number(input.textWidth) || 1020;
  const big = String(input.name || "").toUpperCase().split(/\s+/).filter(Boolean);
  const tag = String(input.tag || "").toUpperCase().trim();
  const nk = Math.min(2, Math.max(0.4, Number(input.nameSize) || 1));
  const tk = Math.min(2, Math.max(0.4, Number(input.tagSize) || 1));
  const lh = 0.96;
  const ts = 70 * tk;
  const tagH = tag ? ts * 1.5 : 0;
  const room = 860 - 80 - (tag ? tagH + 36 : 0);
  const auto = big.length ? Math.max(60, Math.min(300, room / (big.length * lh), ...big.map((w) => fit(env, w, 300, maxW, BOLD, 60)))) : 0;
  const size = auto * nk;
  let y = 80;
  big.forEach((w, i) => {
    body += txt(L, y + size * 0.8 + i * size * lh, w, size, WHITE, BOLD, { filter: "iceShade" });
  });
  y += big.length ? size * 0.8 + (big.length - 1) * size * lh + 44 : 0;
  if (tag) {
    const tw = widthIn(env, tag, ts, BOLD) + ts * 0.9;
    body += `<g filter="url(#iceSoft)"><rect x="${L}" y="${r1(y)}" width="${r1(tw)}" height="${r1(tagH)}" rx="${r1(tagH / 2)}" fill="${ICE_NAVY}" stroke="${WHITE}" stroke-width="${r1(5 * tk)}"/></g>`
      + txt(L + tw / 2, y + tagH / 2 + ts * 0.36, tag, ts, WHITE, BOLD, { anchor: "middle" });
  }
  // The brand, bottom left.
  const bs = fit(env, "Ice-Cold Cut-Ups", 118, 960, SCRIPT, 50);
  body += txt(L - 6, ICE_H - 52, "Ice-Cold Cut-Ups", bs, ICE_NAVY, SCRIPT, { stroke: WHITE, strokeW: 9, filter: "iceSoft" });
  return svgDoc(defs, body);
}
export const iceThumbImageUrls = (input) => [...new Set([input.photo, input.showLogo ? input.logo : ""].filter(Boolean))];
