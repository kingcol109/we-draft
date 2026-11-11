// src/utils/instagram/short.js
//
// Shorts (Admin → Content → Instagram → Short): a vertical 1080×1920 frame
// to cut a highlight clip under, and an end screen to close it on. Drawn like
// posts.js — plain data in, SVG out — so a server can draw them too
// (scripts/renderInstagram.mjs short <playerId>).
//
//   frame  His school's colors top and bottom, the middle left clear (a PNG
//          keeps it transparent) for the clip. Top: his name big. Bottom: his
//          position and school, then the stat lines the admin types ("9 TKL",
//          "1 SACK"), over his school's name stacked faint, the WD badge on the
//          seam. It dresses the clip and stays out of its way: nothing over
//          the window, the words inside Instagram's safe area.
//   end    The whole screen: FOLLOW FOR MORE, @wedraftsite, and the website on
//          a gold button. We-Draft's own blue, whoever the clip was.
import { kit, IG_FONT } from "./posts.js";
import { textOn } from "../teamColors.js";

const { GOLD, BLUE, NAVY, DOT, esc, hex, up, r1, widthOf, fitSize, text, fitLine, image, hasImage } = kit;
export const SHORT_W = 1080;
export const SHORT_H = 1920;
const W = SHORT_W;
const H = SHORT_H;
// The clear window: full width, between the bands.
export const SHORT_WINDOW = { y: 500, h: 900 };
export const SHORT_HANDLE = "@WEDRAFTSITE";
export const SHORT_SITE = "WE-DRAFT.COM";
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;

// lines: the stat lines, one a line ("9 TKL\n1 SACK" or an array); kicker:
// a small line over them (VS LSU · WEEK 11).
export function shortInput({ player = {}, school = {}, lines = "", kicker = "", badgeLogo = "" }) {
  const list = (Array.isArray(lines) ? lines : String(lines || "").split(/\n/)).map((l) => l.trim()).filter(Boolean).slice(0, 3);
  return {
    first: player.First || "", last: player.Last || "", pos: player.Position || "", school: player.School || school.School || "",
    color: hex(school.Color1) || BLUE, color2: hex(school.Color2) || GOLD,
    logoDark: school.LogoDark || school.Logo1 || "",
    lines: list, kicker: String(kicker || "").trim(), badgeLogo,
  };
}

const svgOpen = (env, defs) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${env.fontCss ? `<style>${env.fontCss}</style>` : ""}${defs}</defs>`;

// A line of text with an outline behind it (stroke first, so the fill stays whole).
function outlined(x, y, value, size, fill, stroke, sw, spacing = 2) {
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${IG_FONT}" font-size="${r1(size)}" text-anchor="middle" letter-spacing="${spacing}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke">${esc(value)}</text>`;
}

export function shortFrame(input, env) {
  const c1 = input.color;
  const c2 = input.color2 && input.color2.toLowerCase() !== c1.toLowerCase() ? input.color2 : GOLD;
  const deep = shade(c1, 0.55);
  const ink = textOn(c1, c2);
  const { y: wy, h: wh } = SHORT_WINDOW;
  const by = wy + wh;
  const defs = `<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`
    + `<linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`
    + `<clipPath id="topc"><rect width="${W}" height="${wy}"/></clipPath><clipPath id="botc"><rect y="${by}" width="${W}" height="${H - by}"/></clipPath>`
    + '<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.45"/></filter>';
  const stripes = (y0, h0) => [0, 1, 2, 3].map((j) => `<rect x="${700 + j * 70}" y="${y0 - 40}" width="${28 - j * 5}" height="${h0 + 80}" fill="${c2}" fill-opacity="${r1(0.16 - j * 0.03)}" transform="skewX(-24)"/>`).join("");

  // The top band: the school's color, its logo faint right, speed stripes.
  let body = `<g clip-path="url(#topc)"><rect width="${W}" height="${wy}" fill="url(#top)"/>${stripes(0, wy)}`
    + image(env, input.logoDark, W - 420, -30, 480, 480, "xMidYMid meet", 0.12) + "</g>";
  // His name alone up top, centered in the band: first over last, last big and outlined.
  const last = up(input.last);
  const ls = fitSize(env, last, 210, W - 120, 90, 4);
  const firstY = (wy - (92 * 0.78 + 28 + ls * 0.78)) / 2 + 92 * 0.78 + 10;
  body += fitLine(env, W / 2, firstY, up(input.first), 92, W - 140, ink, { anchor: "middle", spacing: 6, opacity: 0.9 }).svg;
  body += `<g filter="url(#sh)">${outlined(W / 2, firstY + 28 + ls * 0.78, last, ls, "#ffffff", c2, 10, 4)}</g>`;

  // The window's edges: a bar of the accent and a fine white line.
  body += `<rect y="${wy - 10}" width="${W}" height="10" fill="${c2}"/><rect y="${wy}" width="${W}" height="3" fill="#ffffff" fill-opacity="0.6"/>`
    + `<rect y="${by}" width="${W}" height="10" fill="${c2}"/><rect y="${by - 3}" width="${W}" height="3" fill="#ffffff" fill-opacity="0.6"/>`;

  // The bottom band: his school's name stacked faint, slanted, then the stats.
  const school = up(input.school || "WE-DRAFT");
  const ws = fitSize(env, school, 230, W + 200, 120, 4);
  const rows = [0, 1, 2, 3].map((j) => {
    const y = by + 150 + j * ws * 0.86;
    const x = -60 + (j % 2) * 140;
    return text(x, y, `${school}  ${school}`, ws, "#ffffff", { spacing: 4, opacity: 0.09 });
  }).join("");
  body += `<g clip-path="url(#botc)"><rect y="${by}" width="${W}" height="${H - by}" fill="url(#bot)"/>${stripes(by, H - by)}<g transform="skewX(-8)">${rows}</g></g>`;
  // The stats: as big as fits, centered in the band's upper part (Instagram's
  // caption covers its foot).
  const lines = input.lines.map(up);
  // Position · school on a pill at the band's top, then the kicker, then the stats.
  let sy = by + 56;
  const tag = up([input.pos, input.school].filter(Boolean).join(DOT));
  if (tag) {
    const ts = fitSize(env, tag, 38, W - 400, 22, 3);
    const tw = widthOf(env, tag, ts, 3) + 56;
    body += `<rect x="${r1(W / 2 - tw / 2)}" y="${sy}" width="${r1(tw)}" height="58" rx="29" fill="${c2}"/>`
      + text(W / 2, sy + 29 + ts * 0.36, tag, ts, textOn(c2, NAVY), { anchor: "middle", spacing: 3 });
    sy += 86;
  }
  const room = 310;
  if (input.kicker) {
    body += fitLine(env, W / 2, sy + 30, up(input.kicker), 44, W - 160, "#ffffff", { anchor: "middle", spacing: 5, opacity: 0.85 }).svg;
    sy += 58;
  }
  if (lines.length) {
    const each = Math.min(190, (room - (input.kicker ? 58 : 0)) / lines.length);
    lines.forEach((l, j) => {
      const s = fitSize(env, l, each, W - 120, 60, 3);
      body += `<g filter="url(#sh)">${outlined(W / 2, sy + j * each + each * 0.86, l, s, "#ffffff", deep, 8, 3)}</g>`;
    });
  }
  // The WD badge on the seam, top right of the bottom band.
  if (hasImage(env, input.badgeLogo)) {
    const bs = 120;
    body += `<g filter="url(#sh)">${image(env, input.badgeLogo, W - 60 - bs, by - bs / 2 + 5, bs, bs)}</g>`;
  }
  return `${svgOpen(env, defs)}${body}</svg>`;
}

// The end screen: the whole screen, We-Draft's own.
export function shortEnd(input, env) {
  const defs = `<linearGradient id="eb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BLUE}"/><stop offset="0.55" stop-color="${shade(BLUE, 0.55)}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>`
    + `<radialGradient id="eg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.35"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>`
    + '<filter id="esh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.5"/></filter>';
  const stripes = [0, 1, 2, 3, 4].map((j) => `<rect x="${640 + j * 80}" y="-80" width="${34 - j * 5}" height="${H + 160}" fill="${GOLD}" fill-opacity="${r1(0.1 - j * 0.017)}" transform="skewX(-22)"/>`).join("");
  let body = `<rect width="${W}" height="${H}" fill="url(#eb)"/>${stripes}`;
  // The badge, glowing.
  const bs = 340;
  const bcy = 560;
  body += `<circle cx="${W / 2}" cy="${bcy}" r="${bs * 0.95}" fill="url(#eg)"/>`;
  if (hasImage(env, input.badgeLogo)) body += `<g filter="url(#esh)">${image(env, input.badgeLogo, W / 2 - bs / 2, bcy - bs / 2, bs, bs)}</g>`;
  // FOLLOW / FOR MORE, the handle.
  body += `<g filter="url(#esh)">${fitLine(env, W / 2, 1000, "FOLLOW", 250, W - 120, "#ffffff", { anchor: "middle", spacing: 8 }).svg}</g>`
    + fitLine(env, W / 2, 1120, "FOR MORE", 120, W - 160, GOLD, { anchor: "middle", spacing: 10 }).svg
    + fitLine(env, W / 2, 1230, SHORT_HANDLE, 70, W - 200, "#ffffff", { anchor: "middle", spacing: 4, opacity: 0.9 }).svg;
  // A rule, then the site on a gold button.
  body += `<rect x="${W / 2 - 60}" y="1300" width="120" height="6" rx="3" fill="${GOLD}"/>`;
  const sw = widthOf(env, SHORT_SITE, 84, 4) + 110;
  body += `<g filter="url(#esh)"><rect x="${r1(W / 2 - sw / 2)}" y="1380" width="${r1(sw)}" height="132" rx="66" fill="${GOLD}"/></g>`
    + text(W / 2, 1446 + 84 * 0.36, SHORT_SITE, 84, NAVY, { anchor: "middle", spacing: 4 })
    + fitLine(env, W / 2, 1600, "MOCK DRAFTS · BIG BOARDS · DRAFT SIM", 40, W - 200, "#ffffff", { anchor: "middle", spacing: 4, opacity: 0.7 }).svg;
  return `${svgOpen(env, defs)}${body}</svg>`;
}

export const shortImageUrls = (input) => [...new Set([input.logoDark, input.badgeLogo].filter(Boolean))];
