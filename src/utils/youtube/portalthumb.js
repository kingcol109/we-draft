// src/utils/youtube/portalthumb.js
//
// The Transfer Portal YouTube thumbnail (Admin → Videos → Graphics →
// Thumbnail, template "Transfer Portal"), 1920×1080, plain data in, SVG out
// — the Instagram portal posts' two looks (utils/instagram/transfer.js) laid
// out for YouTube:
//   portal    he's entered: black, rings of gold and his school's color
//             swirling round him on the right, hazard tape across the top,
//             ENTERED THE / TRANSFER PORTAL down the left, his name, and his
//             school's logo driving at an empty "?" slot.
//   transfer  he's picked: the new school's color, the old school's logo
//             faded in the corner, TRANSFERRING TO / the new school, his
//             name, old logo → chevrons → new logo.
// The words stay on the left, clear of him. Bebas Neue (bundled — env.fontCss
// embeds it; env.measure(text, size) measures in it).
//
// Every element can be moved, sized and spaced, as Game Review's
// (gamereview.js): input.layout = { kicker, headline, name, schools, logo:
// { dx, dy, scale, spacing, lh } }; the photo has its own adjust.
// portalThumbBoxes gives each element's box, for clicking it on the preview.
import { kit, IG_FONT } from "../instagram/posts.js";

const { GOLD, esc, r1 } = kit;

export const PT_W = 1920;
export const PT_H = 1080;
export const PT_ELEMENTS = ["kicker", "headline", "name", "schools", "logo", "photo"];
export const PT_LABELS = { kicker: "Kicker", headline: "Headline", name: "Name", schools: "Schools", logo: "We-Draft logo", photo: "Player" };
export const PT_KINDS = { portal: "Entered the portal", transfer: "Transferred" };
const VOID = "#05070c";
const WHITE = "#ffffff";

const hex = (v, fb) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : fb);
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;
const sat = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(...v); const mn = Math.min(...v); return mx ? (mx - mn) / mx : 0; };
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const clamp = (v, lo, hi, fb) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; };
const lay = (input, k) => {
  const l = input.layout?.[k] || {};
  return { dx: Number(l.dx) || 0, dy: Number(l.dy) || 0, scale: clamp(l.scale, 0.2, 4, 1), spacing: clamp(l.spacing, -40, 120, 0), lh: clamp(l.lh, 0.5, 2, 1) };
};
const lines = (s) => String(s || "").toUpperCase().split(/\n/).map((x) => x.trim()).filter(Boolean);
const widthOf = (env, t, size, spacing) => env.measure(String(t), size) + spacing * Math.max(0, String(t).length - 1);
const fitTo = (env, t, max, maxW, spacing) => { const w = widthOf(env, t, max, spacing); return w <= maxW ? max : Math.max(40, (max * maxW) / Math.max(1, w)); };
const txt = (x, y, value, size, fill, spacing, extra = "") => `<text x="${r1(x)}" y="${r1(y)}" font-family="${IG_FONT}" font-size="${r1(size)}" fill="${fill}"${spacing ? ` letter-spacing="${r1(spacing)}"` : ""}${extra}>${esc(value)}</text>`;

// The text column: left, clear of him.
const L = 72;
const COL = 1000;

// The defaults for a kind: { kicker, headline }.
export function portalDefaults(kind, toName = "") {
  return kind === "transfer"
    ? { kicker: "Transferring to", headline: toName || "His new school" }
    : { kicker: "Entered the", headline: "Transfer\nPortal" };
}

// Where everything goes: { kicker, headline, name, schools, logo, photo: { ..., box } }.
export function portalThumbLayout(input, env) {
  const out = {};
  let y = 120;
  const k = lay(input, "kicker");
  const kick = String(input.kicker || "").toUpperCase().trim();
  const ks = fitTo(env, kick, 96, COL, 4 + k.spacing) * k.scale;
  const kx = L + k.dx;
  out.kicker = { text: kick, x: kx, base: y + ks * 0.82 + k.dy, size: ks, spacing: 4 + k.spacing, box: kick ? [kx, y + k.dy, widthOf(env, kick, ks, 4 + k.spacing), ks * 0.86] : [kx, y, 0, 0] };
  if (kick) y += ks * 0.9 + 6;

  const h = lay(input, "headline");
  const hl = lines(input.headline);
  // As big as fits its width and the room left above the name, the schools and the logo.
  const name0 = `${input.first || ""} ${input.last || ""}`.trim();
  const below = (name0 ? 112 * 0.9 + 34 : 0) + 168 + 30 + 150;
  const room = PT_H - 44 - below - y - 28;
  const tall = hl.length ? room / (0.86 + 0.88 * (hl.length - 1)) : 0;
  const base = hl.length ? Math.max(60, Math.min(268, tall, ...hl.map((t) => fitTo(env, t, 268, COL, 2 + h.spacing)))) : 0;
  const hs = base * h.scale;
  const step = hs * 0.88 * h.lh;
  const hx = L + h.dx;
  const htop = y + h.dy;
  out.headline = { lines: hl, x: hx, base: htop + hs * 0.82, size: hs, step, spacing: 2 + h.spacing, box: [hx, htop, hl.length ? Math.max(...hl.map((t) => widthOf(env, t, hs, 2 + h.spacing))) : 0, hl.length ? hs * 0.86 + step * (hl.length - 1) : 0] };
  y += hl.length ? hs * 0.86 + step * (hl.length - 1) + 28 : 0;

  const n = lay(input, "name");
  const name = `${input.first || ""} ${input.last || ""}`.trim().toUpperCase();
  const ns = fitTo(env, name, 112, COL, 3 + n.spacing) * n.scale;
  const nx = L + n.dx;
  out.name = { text: name, x: nx, base: y + ns * 0.82 + n.dy, size: ns, spacing: 3 + n.spacing, box: name ? [nx, y + n.dy, widthOf(env, name, ns, 3 + n.spacing), ns * 0.86] : [nx, y, 0, 0] };
  if (name) y += ns * 0.9 + 34;

  const s = lay(input, "schools");
  const lg = 168 * s.scale;
  const gap = 34 * s.scale;
  const chev = 150 * s.scale;
  const sx = L + s.dx;
  const sy = y + s.dy;
  out.schools = { x: sx, y: sy, logo: lg, gap, chev, box: [sx, sy, lg * 2 + gap * 2 + chev, lg] };

  const g = lay(input, "logo");
  const im = env.images?.[input.brandLogo];
  const lw = 520 * g.scale;
  const lh = im?.w && im?.h ? (lw * im.h) / im.w : lw / 5;
  const lx = L + g.dx;
  const ly = PT_H - 44 - lh + g.dy;
  out.logo = { x: lx, y: ly, w: lw, h: lh, box: [lx, ly, lw, lh] };

  // His cutout, big on the right, pinned to the top and cropped at the waist or so.
  const P = [940, 0, 1100, 1800];
  const sc = clamp(input.adjust?.scale, 0.5, 2.5, 1);
  const ax = P[0] + P[2] / 2 + (Number(input.adjust?.x) || 0);
  const ay = P[1] + P[3] + (Number(input.adjust?.y) || 0);
  out.photo = { P, box: [ax - (P[2] / 2) * sc, ay - P[3] * sc, P[2] * sc, P[3] * sc] };
  return out;
}
export const portalThumbBoxes = (input, env) => Object.fromEntries(Object.entries(portalThumbLayout(input, env)).map(([k, v]) => [k, v.box]));

// The portal's rings, round him.
function rings(cx, cy, accent) {
  const R = [
    { rx: 640, ry: 520, w: 5, gold: false, dash: "520 80 200 60", spin: 8, o: 0.5 },
    { rx: 590, ry: 478, w: 16, gold: true, dash: "700 90 300 70", spin: -6, o: 0.95 },
    { rx: 540, ry: 436, w: 7, gold: false, dash: "380 54 140 44", spin: 12, o: 0.9 },
    { rx: 492, ry: 396, w: 22, gold: false, dash: "820 70 220 50", spin: -14, o: 0.85 },
    { rx: 440, ry: 354, w: 6, gold: true, dash: "280 50 90 36", spin: 18, o: 0.9 },
    { rx: 394, ry: 316, w: 12, gold: true, dash: "600 70 150 50", spin: -20, o: 0.6 },
  ];
  return R.map((r) => `<ellipse cx="${cx}" cy="${cy}" rx="${r.rx}" ry="${r.ry}" fill="none" stroke="${r.gold ? GOLD : accent}" stroke-width="${r.w}" stroke-opacity="${r.o}" stroke-dasharray="${r.dash}" stroke-linecap="round" transform="rotate(${r.spin} ${cx} ${cy})"/>`).join("");
}
// A school's logo in a disc, or an empty "?" slot.
function badge(env, url, x, y, d, ring, empty = false) {
  const c = `<circle cx="${r1(x + d / 2)}" cy="${r1(y + d / 2)}" r="${r1(d / 2)}" fill="#000" fill-opacity="${empty ? 0.25 : 0.35}" stroke="${ring}" stroke-width="${r1(d * 0.035)}"${empty ? ` stroke-dasharray="${r1(d * 0.12)} ${r1(d * 0.08)}"` : ""}/>`;
  if (empty) return c + txt(x + d / 2, y + d * 0.7, "?", d * 0.62, ring, 0, ' text-anchor="middle"');
  const im = url && env.images?.[url];
  return c + (im?.href ? `<image x="${r1(x + d * 0.14)}" y="${r1(y + d * 0.14)}" width="${r1(d * 0.72)}" height="${r1(d * 0.72)}" preserveAspectRatio="xMidYMid meet" href="${im.href}"/>` : "");
}
function chevrons(x, y, w, h, color) {
  const n = 3;
  const cw = w / n;
  let out = "";
  for (let i = 0; i < n; i += 1) {
    const cx = x + i * cw;
    out += `<path d="M${r1(cx + cw * 0.12)} ${r1(y + h * 0.22)} L${r1(cx + cw * 0.72)} ${r1(y + h / 2)} L${r1(cx + cw * 0.12)} ${r1(y + h * 0.78)}" fill="none" stroke="${color}" stroke-width="${r1(h * 0.11)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${r1(0.45 + i * 0.27)}"/>`;
  }
  return out;
}

// input: { kind, first, last, kicker, headline (a line a line), from / to:
// { name, color, color2, logo }, photo, adjust, brandLogo, layout, selected }.
export function portalThumb(input, env) {
  const kind = input.kind === "transfer" ? "transfer" : "portal";
  const from = input.from || {};
  const to = input.to || {};
  const L2 = portalThumbLayout(input, env);
  const fromColor = hex(from.color, "#0055a5");
  const toColor = hex(to.color, "#0055a5");
  // The words' accent: gold, or the school's second color on the transfer.
  // (Gold unless the new school's second color is bright and a real color — not a gray, not its first color.)
  const c2 = hex(to.color2, GOLD);
  const accent = kind === "transfer" && c2 !== toColor && lum(c2) > 0.45 && sat(c2) > 0.35 ? c2 : GOLD;
  const defs = (env.fontCss ? `<style>${env.fontCss}</style>` : "")
    + `<radialGradient id="ptCore" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${fromColor}" stop-opacity="0.95"/><stop offset="0.45" stop-color="${fromColor}" stop-opacity="0.35"/><stop offset="1" stop-color="${fromColor}" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="ptGround" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(toColor, 0.35)}"/><stop offset="0.6" stop-color="${shade(toColor, 0.75)}"/><stop offset="1" stop-color="${toColor}"/></linearGradient>`
    + `<pattern id="ptTape" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="45" height="90" fill="${GOLD}"/><rect x="45" width="45" height="90" fill="#111"/></pattern>`
    + `<linearGradient id="ptFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.55" stop-color="#000" stop-opacity="0.15"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
    + `<filter id="ptPhoto" x="-10%" y="-10%" width="125%" height="125%"><feDropShadow dx="-16" dy="16" stdDeviation="18" flood-color="#000" flood-opacity="0.6"/></filter>`
    + `<filter id="ptText" x="-5%" y="-10%" width="115%" height="130%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.45"/></filter>`
    + `<filter id="ptWhite"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>`;

  let body = "";
  const cx = 1420;
  const cy = 560;
  if (kind === "portal") {
    body += `<rect width="${PT_W}" height="${PT_H}" fill="${VOID}"/>`
      + `<ellipse cx="${cx}" cy="${cy}" rx="720" ry="600" fill="url(#ptCore)"/>`
      + rings(cx, cy, fromColor)
      + `<rect width="${PT_W}" height="${PT_H}" fill="url(#ptFade)"/>`
      + `<g transform="rotate(-2 960 40)"><rect x="-40" y="10" width="${PT_W + 80}" height="58" fill="url(#ptTape)"/></g>`;
  } else {
    const oldLogo = from.logo && env.images?.[from.logo];
    body += `<rect width="${PT_W}" height="${PT_H}" fill="url(#ptGround)"/>`
      + Array.from({ length: 10 }, (_, i) => `<rect x="${i * 240 - 200}" y="-200" width="60" height="1500" fill="${WHITE}" fill-opacity="0.035" transform="skewX(-22)"/>`).join("")
      + (oldLogo?.href ? `<image x="-160" y="-120" width="760" height="760" preserveAspectRatio="xMidYMid meet" opacity="0.13" href="${oldLogo.href}"/>` : "")
      + `<rect width="${PT_W}" height="${PT_H}" fill="url(#ptFade)"/>`;
  }

  // The words.
  let words = "";
  if (L2.kicker.text) {
    if (kind === "transfer") {
      // On a slanted gold banner.
      const [bx, by, bw, bh] = L2.kicker.box;
      words += `<path d="M${r1(bx - 22)} ${r1(by - 8)} H${r1(bx + bw + 40)} L${r1(bx + bw + 18)} ${r1(by + bh + 14)} H${r1(bx - 44)} Z" fill="${accent}"/>`
        + txt(L2.kicker.x, L2.kicker.base, L2.kicker.text, L2.kicker.size, lum(accent) > 0.5 ? "#0b1426" : WHITE, L2.kicker.spacing);
    } else {
      words += txt(L2.kicker.x, L2.kicker.base, L2.kicker.text, L2.kicker.size, GOLD, L2.kicker.spacing, ' filter="url(#ptText)"');
    }
  }
  L2.headline.lines.forEach((t, i) => { words += txt(L2.headline.x, L2.headline.base + i * L2.headline.step, t, L2.headline.size, WHITE, L2.headline.spacing, ' filter="url(#ptText)"'); });
  if (L2.name.text) words += txt(L2.name.x, L2.name.base, L2.name.text, L2.name.size, accent, L2.name.spacing, ' filter="url(#ptText)"');
  // Old school → chevrons → new school (or the "?" slot).
  const S = L2.schools;
  words += `<g filter="url(#ptText)">${badge(env, from.logo, S.x, S.y, S.logo, WHITE)}`
    + chevrons(S.x + S.logo + S.gap, S.y + S.logo * 0.1, S.chev, S.logo * 0.8, GOLD)
    + badge(env, to.logo, S.x + S.logo + S.gap * 2 + S.chev, S.y, S.logo, kind === "transfer" ? accent : GOLD, kind !== "transfer" || !to.logo) + "</g>";
  const im = env.images?.[input.brandLogo];
  const brand = im?.href ? `<image x="${r1(L2.logo.x)}" y="${r1(L2.logo.y)}" width="${r1(L2.logo.w)}" height="${r1(L2.logo.h)}" preserveAspectRatio="xMinYMid meet" href="${im.href}" filter="url(#ptWhite)"/>` : "";

  let photo = "";
  const shot = env.images?.[input.photo];
  if (shot?.href) {
    const [px, py, pw, ph] = L2.photo.P;
    const one = `<image x="${px}" y="${py}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMin meet" href="${shot.href}"/>`;
    photo = `<g filter="url(#ptPhoto)">${kit.placed(one, px, py, pw, ph, input.adjust)}</g>`;
  }
  body += photo + words + brand;

  const sel = input.selected && L2[input.selected]?.box;
  if (sel && sel[2] > 0 && sel[3] > 0) body += `<rect x="${r1(sel[0] - 8)}" y="${r1(sel[1] - 8)}" width="${r1(sel[2] + 16)}" height="${r1(sel[3] + 16)}" fill="none" stroke="#00e5ff" stroke-width="4" stroke-dasharray="16 10"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PT_W}" height="${PT_H}" viewBox="0 0 ${PT_W} ${PT_H}"><defs>${defs}</defs>${body}</svg>`;
}
export const portalThumbImageUrls = (input) => [...new Set([input.photo, input.brandLogo, input.from?.logo, input.to?.logo].filter(Boolean))];
