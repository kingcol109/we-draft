// src/utils/instagram/posts.js
//
// Instagram posts (Admin → Content → Instagram, AdminInstagram.jsx), drawn
// as SVG at 1080×1350 (Instagram's 4:5 portrait):
//
//   mockSlides  the Weekly Mock as a carousel: round 1 over two slides
//               (picks 1–16, 17–32 — ROUND1_SPLITS), each featuring one of
//               its picks — his action shot at the left, the sixteen picks
//               down the right, his row highlighted (featureSlideSvg); a
//               slide without a photo lists its picks as wide rows (number
//               on the team's color, logo, headshot, name, position ·
//               school, college logo). Then a slide a round, its picks in
//               two columns (down the left, then the right). A pick a Draft
//               Sim trade moved says SIM TRADE (simTradeSlots). After round
//               1, an ad for the Draft Sim: "Don't like the picks? Make your
//               own!" (simAdSvg — input.simAd false leaves it out).
//   playerPost  one player over an action shot (playerPhotos action[]):
//               a kicker, his name, position · school and up to three chips
//               on his school's color.
//
// Pure: plain data in (mockInput / playerInput build it from Firestore's
// docs), SVG strings out — no Firebase, no DOM — so a server can draw the
// same posts (scripts/renderInstagram.mjs renders them with resvg, the way
// api/mock-og.js draws the mock's link preview). Everything it needs comes in
// on env:
//   measure(text, size)  text's width in Bebas Neue at size (the browser's
//                        canvas, or thumbnail.js measure on the server)
//   images               { [url]: { href, w, h } } — every image as a data
//                        URI (imageUrls lists the ones a post uses); one
//                        missing is left out
//   fontCss              optional: an @font-face for Bebas Neue (the browser
//                        draws the SVG as an image, which can't reach the
//                        page's fonts; resvg is handed the font file)
import { textOn, contrastRatio } from "../teamColors.js";
import { ORDER_YEAR, UPCOMING_DRAFT_YEARS } from "../draftOrder.js";

export const IG_W = 1080;
export const IG_H = 1350;
export const IG_FONT = "Bebas Neue";
// Round 1's picks a slide; the last takes the rest of the round.
export const ROUND1_SPLITS = [16, 16];
// Instagram's most slides in one carousel.
export const IG_MAX_SLIDES = 20;

const GOLD = "#f6a21d";
const BLUE = "#0055a5";
const NAVY = "#070d18";
const PAD = 60;
const FOOTER_H = 96;
const ROWS_TOP = 262;
const ROWS_BOTTOM = IG_H - FOOTER_H - 28;
// Separators keep their spaces (SVG collapses ordinary ones).
const DOT = "  ·  ";

export const IG_THEMES = {
  dark: { bg: NAVY, panel: "#111b2e", ink: "#ffffff", soft: "#93a4bd", accent: GOLD, foot: "#03060c", dark: true },
  light: { bg: "#eef2f7", panel: "#ffffff", ink: "#0b1426", soft: "#5b6b84", accent: BLUE, foot: NAVY, dark: false },
};
const themeOf = (name) => IG_THEMES[name] || IG_THEMES.dark;

// ── SVG helpers ──
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : null);
const r1 = (n) => Math.round(n * 10) / 10;
const up = (s) => String(s ?? "").toUpperCase();

// Text's width at size with its letter spacing.
const widthOf = (env, text, size, spacing = 0) => env.measure(String(text), size) + spacing * Math.max(0, String(text).length - 1);
// The biggest size ≤ max (≥ min) at which text fits maxW.
function fitSize(env, text, max, maxW, min = 10, spacing = 0) {
  const w = widthOf(env, text, max, spacing);
  return w <= maxW ? max : Math.max(min, Math.floor((max * maxW) / Math.max(1, w)));
}
// Text cut with an ellipsis until it fits maxW at size.
function clipText(env, text, size, maxW) {
  let t = String(text);
  if (env.measure(t, size) <= maxW) return t;
  while (t.length > 1 && env.measure(`${t}…`, size) > maxW) t = t.slice(0, -1).trimEnd();
  return `${t}…`;
}
function text(x, y, value, size, fill, { anchor = "start", spacing = 0, opacity = 1 } = {}) {
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${IG_FONT}" font-size="${r1(size)}" fill="${fill}"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${spacing ? ` letter-spacing="${spacing}"` : ""}${opacity < 1 ? ` fill-opacity="${opacity}"` : ""}>${esc(value)}</text>`;
}
// A fitted line: the biggest size ≤ max that fits, cut if it still doesn't at min.
function fitLine(env, x, y, value, max, maxW, fill, opts = {}) {
  const s = fitSize(env, value, max, maxW, opts.min || 10, opts.spacing || 0);
  return { svg: text(x, y, clipText(env, value, s, maxW), s, fill, opts), size: s };
}
// An image (env.images — a data URI) in a box: meet keeps it whole, slice fills.
function image(env, url, x, y, w, h, par = "xMidYMid meet", opacity = 1) {
  const im = url && env.images?.[url];
  if (!im?.href || w <= 0 || h <= 0) return "";
  return `<image x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="${par}"${opacity < 1 ? ` opacity="${opacity}"` : ""} href="${im.href}"/>`;
}
const hasImage = (env, url) => !!(url && env.images?.[url]?.href);
// A player photo as the admin placed it — adjust: { x, y (pixels on the
// post), scale (1 = as laid out) } — grown or shrunk about the foot of its
// box (where he stands), then moved.
export const PHOTO_SCALE = [0.5, 2.5];
function placed(svg, x, y, w, h, adjust) {
  const s = Math.min(PHOTO_SCALE[1], Math.max(PHOTO_SCALE[0], Number(adjust?.scale) || 1));
  const dx = Number(adjust?.x) || 0;
  const dy = Number(adjust?.y) || 0;
  if (!svg || (s === 1 && !dx && !dy)) return svg;
  const ax = x + w / 2;
  const ay = y + h;
  return `<g transform="translate(${r1(ax + dx)} ${r1(ay + dy)}) scale(${s}) translate(${r1(-ax)} ${r1(-ay)})">${svg}</g>`;
}
function svgDoc(env, defs, body, bg) {
  const style = env.fontCss ? `<style>${env.fontCss}</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${IG_W}" height="${IG_H}" viewBox="0 0 ${IG_W} ${IG_H}"><defs>${style}${defs}</defs><rect width="${IG_W}" height="${IG_H}" fill="${bg}"/>${body}</svg>`;
}

// The bottom bar: the We-Draft logo, a call to action, and (more slides
// to come) a chevron.
function footer(env, t, { logo, cta, more }) {
  const y = IG_H - FOOTER_H;
  const im = env.images?.[logo];
  const lh = FOOTER_H - 42;
  const lw = im?.w && im?.h ? (im.w / im.h) * lh : lh * 3;
  const chevron = more ? 30 : 0;
  const ctaX = IG_W - PAD - (chevron ? chevron + 14 : 0);
  const cta1 = cta ? fitLine(env, ctaX, y + FOOTER_H / 2 + 14, up(cta), 40, IG_W - PAD * 2 - lw - 40 - chevron, "#ffffff", { anchor: "end", spacing: 1 }).svg : "";
  const cy = y + FOOTER_H / 2 + 2;
  const arrow = more
    ? `<path d="M ${IG_W - PAD - chevron + 6} ${cy - 15} L ${IG_W - PAD - 4} ${cy} L ${IG_W - PAD - chevron + 6} ${cy + 15}" fill="none" stroke="${GOLD}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  return `<rect x="0" y="${y}" width="${IG_W}" height="${FOOTER_H}" fill="${t.foot}"/><rect x="0" y="${y}" width="${IG_W}" height="5" fill="${GOLD}"/>`
    + image(env, logo, PAD, y + 23, lw, lh, "xMinYMid meet") + cta1 + arrow;
}

// ── Weekly Mock carousel ──

// The slides' picks: round 1 split ROUND1_SPLITS, then a slide a round.
// → [{ round, picks, part (1–3 in round 1, else 0) }].
export function mockSlidePlan(picks) {
  const rounds = {};
  [...(picks || [])].sort((a, b) => a.overall - b.overall).forEach((p) => { (rounds[p.round] = rounds[p.round] || []).push(p); });
  const plan = [];
  const first = rounds[1] || [];
  let at = 0;
  ROUND1_SPLITS.forEach((n, i) => {
    const last = i === ROUND1_SPLITS.length - 1;
    const chunk = first.slice(at, last ? first.length : at + n);
    at += chunk.length;
    if (chunk.length) plan.push({ round: 1, picks: chunk, part: i + 1 });
  });
  Object.keys(rounds).map(Number).filter((r) => r > 1).sort((a, b) => a - b)
    .forEach((r) => plan.push({ round: r, picks: rounds[r], part: 0 }));
  return plan;
}

const pickRange = (picks) => (picks.length > 1 ? `PICKS ${picks[0].overall}–${picks[picks.length - 1].overall}` : `PICK ${picks[0]?.overall ?? ""}`);

function mockHeader(env, t, input, slide) {
  const kicker = up(input.kicker || "WE-DRAFT.COM WEEKLY MOCK DRAFT");
  const title = up(input.title || `${input.year} NFL MOCK DRAFT`);
  const sub = `ROUND ${slide.round}${DOT}${pickRange(slide.picks)}`;
  const date = up(input.dated || "");
  const dateW = date ? widthOf(env, date, 40, 1) + 30 : 0;
  return text(PAD, 88, kicker, 32, t.accent, { spacing: 3 })
    + fitLine(env, PAD, 188, title, 112, IG_W - PAD * 2, t.ink, { spacing: 1, min: 60 }).svg
    + fitLine(env, PAD, 236, sub, 40, IG_W - PAD * 2 - dateW, t.soft, { spacing: 1 }).svg
    + (date ? text(IG_W - PAD, 236, date, 38, t.soft, { anchor: "end", spacing: 1 }) : "");
}

// A traded pick's tag: who it came from (VIA DAL), and SIM TRADE when the
// Draft Sim's trade moved it, not a real one. → [plain part, accent part].
const tradeTag = (p) => [p.via ? `VIA ${up(p.via)}` : "", p.simTrade ? "SIM TRADE" : ""];
const tagText = (p) => tradeTag(p).filter(Boolean).join(DOT);
// The tag as SVG text, its SIM TRADE in the accent color.
function tagSvg(x, y, size, p, soft, accent, anchor = "start") {
  const [via, sim] = tradeTag(p);
  if (!via && !sim) return "";
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${IG_FONT}" font-size="${r1(size)}" fill="${soft}" letter-spacing="0.5"${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}>`
    + `${esc(via)}${via && sim ? esc(DOT) : ""}${sim ? `<tspan fill="${accent}">${esc(sim)}</tspan>` : ""}</text>`;
}

// A pick's number block: the team's color, or its second when the first
// would melt into the row (the Bears' navy on the dark panel).
function blockColor(t, team) {
  const c1 = hex(team?.color) || BLUE;
  const c2 = hex(team?.color2);
  return (contrastRatio(c1, t.panel) ?? 21) < 1.4 && c2 && (contrastRatio(c2, t.panel) ?? 0) > 1.4 ? c2 : c1;
}

// A round-1 pick: number on the team's color, team logo, headshot (sitting
// on the row's floor), name over position · school (· VIA a team, traded),
// the college logo at the right.
function bigRow(env, t, p, x, y, w, h, id) {
  const color = blockColor(t, p.team);
  const rad = Math.min(16, h / 4);
  const numW = Math.round(h * 1.08);
  const logoBox = h * 0.7;
  const logoX = x + numW + 18;
  const shotW = h * 1.22;
  const shotX = logoX + logoBox + 12;
  const clW = h * 0.6;
  const textX = shotX + shotW + 14;
  const textW = x + w - 22 - clW - 16 - textX;
  const name = up(`${p.player.First || ""} ${p.player.Last || ""}`.trim());
  const nameS = fitSize(env, name, h * 0.46, textW, 18, 0.5);
  const subS = h * 0.29;
  const pos = up([p.player.Position, p.player.School].filter(Boolean).join(DOT));
  const tag = tagText(p);
  const viaW = tag ? env.measure(`${DOT}${tag}`, subS) : 0;
  const posTxt = clipText(env, pos, subS, textW - viaW);
  return `<clipPath id="${id}"><rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" rx="${rad}"/></clipPath>`
    + `<g clip-path="url(#${id})"><rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" fill="${t.panel}"/>`
    + `<rect x="${x}" y="${r1(y)}" width="${numW}" height="${r1(h)}" fill="${color}"/>`
    + image(env, p.headshot, shotX, y + h * 0.06, shotW, h * 0.94, "xMidYMax meet")
    + "</g>"
    + text(x + numW / 2, y + h / 2 + h * 0.19, String(p.overall), h * 0.54, textOn(color), { anchor: "middle" })
    + image(env, p.team?.logo, logoX, y + (h - logoBox) / 2, logoBox, logoBox)
    + text(textX, y + h * 0.53, clipText(env, name, nameS, textW), nameS, t.ink, { spacing: 0.5 })
    + `<text x="${r1(textX)}" y="${r1(y + h * 0.84)}" font-family="${IG_FONT}" font-size="${r1(subS)}" fill="${t.soft}" letter-spacing="0.5">${esc(posTxt)}${tag ? `<tspan fill="${t.accent}">${esc(`${DOT}${tag}`)}</tspan>` : ""}</text>`
    + image(env, p.collegeLogo, x + w - 22 - clW, y + (h - clW) / 2, clW, clW);
}

// A pick on one line: number on the team's color, team logo, name, then the
// position (and its trade tag) at the right before the college logo. The
// featured pick's (featureSlideSvg): number on gold, name in gold, outlined.
function smallRow(env, t, p, x, y, w, h, id, featured = false) {
  const color = featured ? GOLD : blockColor(t, p.team);
  const rad = Math.min(12, h / 4);
  const numW = Math.round(h * 1.2);
  const logoBox = h * 0.7;
  const logoX = x + numW + 10;
  const clW = h * 0.64;
  const clX = x + w - 12 - clW;
  const posS = h * 0.42;
  const pos = up(p.player.Position || "");
  const tag = tagText(p);
  const posW = env.measure(pos, posS);
  const viaS = h * 0.33;
  const viaW = tag ? env.measure(tag, viaS) + 10 : 0;
  const textX = logoX + logoBox + 12;
  const posX = clX - 12;
  const textW = posX - posW - viaW - 14 - textX;
  const name = up(`${p.player.First || ""} ${p.player.Last || ""}`.trim());
  const nameS = fitSize(env, name, h * 0.5, textW, 14);
  const base = y + h / 2 + h * 0.17;
  return `<clipPath id="${id}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(rad)}"/></clipPath>`
    + `<g clip-path="url(#${id})"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${featured ? "#1d2c47" : t.panel}"/>`
    + `<rect x="${r1(x)}" y="${r1(y)}" width="${numW}" height="${r1(h)}" fill="${color}"/></g>`
    + (featured ? `<rect x="${r1(x + 2)}" y="${r1(y + 2)}" width="${r1(w - 4)}" height="${r1(h - 4)}" rx="${r1(rad - 1)}" fill="none" stroke="${GOLD}" stroke-width="3"/>` : "")
    + text(x + numW / 2, base, String(p.overall), h * 0.46, featured ? NAVY : textOn(color), { anchor: "middle" })
    + image(env, p.team?.logo, logoX, y + (h - logoBox) / 2, logoBox, logoBox)
    + text(textX, base, clipText(env, name, nameS, textW), nameS, featured ? GOLD : t.ink, { spacing: 0.3 })
    + tagSvg(posX - posW - 10, base - 1, viaS, p, t.soft, t.accent, "end")
    + text(posX, base, pos, posS, t.accent, { anchor: "end", spacing: 0.5 })
    + image(env, p.collegeLogo, clX, y + (h - clW) / 2, clW, clW);
}

// ── A round-1 slide with a featured pick ──
// input.features[part]: { overall, photo, focus, fit, adjust } — one of the
// slide's picks over his action shot at the left (his NFL team's color
// glowing behind him, its logo faded in), under the slide's header; the
// slide's picks down the right on one line each, his row highlighted.
const PHOTO_COL = 470;
const LIST_X = 452;
// The faded team logo's spot: a 380 box in the photo column's top-left
// corner, the same on every featured slide — the player's photo is framed
// under it (most of the logo above his head) with PhotoAdjust.
const STAR_LOGO_AT = (top) => [0, top, 380, 380];

function featureSlideSvg(env, input, slide, i, total) {
  // Always the dark look: the photo needs it.
  const t = themeOf("dark");
  const f = input.features[slide.part];
  const star = slide.picks.find((p) => p.overall === f.overall) || slide.picks[0];
  const glow = hex(star.team?.color) || BLUE;
  const top = ROWS_TOP - 12;
  const photoBottom = IG_H - FOOTER_H;
  const ph = photoBottom - top;
  const defs = `<radialGradient id="glow${i}" cx="0.5" cy="0.55" r="0.6"><stop offset="0" stop-color="${glow}" stop-opacity="0.75"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="fadeR${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${NAVY}" stop-opacity="0"/><stop offset="0.7" stop-color="${NAVY}" stop-opacity="0"/><stop offset="1" stop-color="${NAVY}" stop-opacity="1"/></linearGradient>`
    + `<linearGradient id="fadeB${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0"/><stop offset="0.66" stop-color="${NAVY}" stop-opacity="0"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.97"/></linearGradient>`
    + `<clipPath id="feat${i}"><rect x="0" y="${top}" width="${PHOTO_COL}" height="${ph}"/></clipPath>`;
  const par = `${FOCUS_X[f.focus] || "xMid"}YMax ${f.fit === "slice" ? "slice" : "meet"}`;
  const box = [-10, top + 16, PHOTO_COL + 20, ph - 16];
  let body = mockHeader(env, t, input, slide)
    + `<g clip-path="url(#feat${i})">`
    + `<rect x="-240" y="${top}" width="${PHOTO_COL + 480}" height="${ph}" fill="url(#glow${i})"/>`
    + image(env, star.team?.logo, ...STAR_LOGO_AT(top), "xMidYMid meet", 0.13)
    + placed(image(env, f.photo, ...box, par), ...box, f.adjust)
    + `<rect x="0" y="${top}" width="${PHOTO_COL}" height="${ph}" fill="url(#fadeR${i})"/>`
    + `<rect x="0" y="${top}" width="${PHOTO_COL}" height="${ph}" fill="url(#fadeB${i})"/></g>`;
  // His tag, at the photo's foot: the pick and team, then his name.
  const tagW = LIST_X - PAD - 20;
  body += fitLine(env, PAD - 20, photoBottom - 104, `NO. ${star.overall}${star.team?.name ? `${DOT}${up(star.team.name)}` : ""}`, 28, tagW, GOLD, { spacing: 2 }).svg
    + fitLine(env, PAD - 20, photoBottom - 40, up(`${star.player.First} ${star.player.Last}`), 70, tagW, "#ffffff", { spacing: 1, min: 34 }).svg;

  // The picks, down the right.
  const w = IG_W - PAD + 20 - LIST_X;
  const gap = 6;
  const n = slide.picks.length;
  const h = Math.min(64, (ROWS_BOTTOM - ROWS_TOP - gap * (n - 1)) / n);
  slide.picks.forEach((p, k) => { body += smallRow(env, t, p, LIST_X, ROWS_TOP + k * (h + gap), w, h, `s${i}r${k}`, p.overall === star.overall); });

  const more = i < total - 1;
  body += footer(env, t, { logo: input.brandLogo, cta: more ? (input.swipeText || "SWIPE FOR MORE") : (input.address || "WE-DRAFT.COM"), more });
  return svgDoc(env, defs, body, NAVY);
}

function mockSlideSvg(env, input, slide, i, total) {
  const f = slide.part ? input.features?.[slide.part] : null;
  if (f?.photo && hasImage(env, f.photo)) return featureSlideSvg(env, input, slide, i, total);
  const t = themeOf(input.theme);
  const n = slide.picks.length;
  let rows = "";
  if (slide.round === 1 && n <= 12) {
    const gap = 10;
    const h = Math.min(100, (ROWS_BOTTOM - ROWS_TOP - gap * (n - 1)) / n);
    slide.picks.forEach((p, k) => { rows += bigRow(env, t, p, PAD, ROWS_TOP + k * (h + gap), IG_W - PAD * 2, h, `s${i}r${k}`); });
  } else if (slide.round === 1) {
    // Too many for wide rows (a round-1 slide with no photo): one line each, full width.
    const gap = 8;
    const h = Math.min(64, (ROWS_BOTTOM - ROWS_TOP - gap * (n - 1)) / n);
    slide.picks.forEach((p, k) => { rows += smallRow(env, t, p, PAD, ROWS_TOP + k * (h + gap), IG_W - PAD * 2, h, `s${i}r${k}`); });
  } else {
    // Two columns, down the left first (then the right).
    const per = Math.ceil(n / 2);
    const gap = 8;
    const colGap = 20;
    const colW = (IG_W - PAD * 2 - colGap) / 2;
    const h = Math.min(64, (ROWS_BOTTOM - ROWS_TOP - gap * (per - 1)) / per);
    slide.picks.forEach((p, k) => {
      const col = Math.floor(k / per);
      const row = k % per;
      rows += smallRow(env, t, p, PAD + col * (colW + colGap), ROWS_TOP + row * (h + gap), colW, h, `s${i}r${k}`);
    });
  }
  const more = i < total - 1;
  const cta = more ? (input.swipeText || "SWIPE FOR MORE") : (input.address || "WE-DRAFT.COM");
  return svgDoc(env, "", mockHeader(env, t, input, slide) + rows + footer(env, t, { logo: input.brandLogo, cta, more }), t.bg);
}

// ── The Draft Sim ad ──
// "DON'T LIKE THE PICKS? MAKE YOUR OWN!" over three of the mock's teams —
// each a card in its color with its logo and "YOUR PICK" — and
// the sim's address on a gold button.
const SIM_ADDRESS = "WE-DRAFT.COM/DRAFTSIM";

function simAdSvg(env, input, i, total, next = null) {
  const t = themeOf("dark");
  const W2 = IG_W - PAD * 2;
  const defs = '<radialGradient id="simGlow" cx="0.5" cy="0.62" r="0.62"><stop offset="0" stop-color="#0055a5" stop-opacity="0.7"/><stop offset="1" stop-color="#0055a5" stop-opacity="0"/></radialGradient>'
    + '<filter id="cardShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#000000" flood-opacity="0.55"/></filter>';
  const stripes = Array.from({ length: 9 }, (_, k) => `<rect x="${-200 + k * 170}" y="-100" width="26" height="1700" fill="${GOLD}" fill-opacity="0.05" transform="skewX(-24)"/>`).join("");
  let body = `<rect width="${IG_W}" height="${IG_H}" fill="url(#simGlow)"/>${stripes}`
    + text(PAD, 96, "WE-DRAFT.COM DRAFT SIM", 32, GOLD, { spacing: 3 })
    + fitLine(env, PAD, 250, "DON'T LIKE", 160, W2, "#ffffff", { spacing: 2 }).svg
    + fitLine(env, PAD, 400, "THE PICKS?", 160, W2, "#ffffff", { spacing: 2 }).svg
    + fitLine(env, PAD, 540, "MAKE YOUR OWN!", 150, W2, GOLD, { spacing: 2 }).svg;

  // Three of the mock's teams on the clock, fanned like cards.
  const teams = [];
  [...input.picks].sort((a, b) => a.overall - b.overall).forEach((p) => {
    if (teams.length < 3 && !teams.some((x) => x.abbr === p.team.abbr)) teams.push({ ...p.team, overall: p.overall });
  });
  const cw = 250;
  const ch = 300;
  const cy = 800;
  [[-1, -9], [1, 9], [0, 0]].forEach(([pos, deg], k) => {
    const tm = teams[pos === 0 ? 0 : pos < 0 ? 1 : 2];
    if (!tm) return;
    const cx = IG_W / 2 + pos * 245;
    const color = hex(tm.color) || BLUE;
    const x = -cw / 2;
    const y = -ch / 2;
    body += `<g transform="translate(${cx} ${cy + (pos ? 26 : 0)}) rotate(${deg})" filter="url(#cardShadow)">`
      + `<clipPath id="simCard${k}"><rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="22"/></clipPath>`
      + `<g clip-path="url(#simCard${k})"><rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${color}"/>`
      + `<rect x="${x}" y="${y + ch - 78}" width="${cw}" height="78" fill="#ffffff"/></g>`
      + `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="22" fill="none" stroke="#ffffff" stroke-width="5"/>`
      + image(env, tm.logo, x + 36, y + 34, cw - 72, ch - 78 - 68)
      + text(0, y + ch - 24, "YOUR PICK", 42, NAVY, { anchor: "middle", spacing: 2 })
      + "</g>";
  });

  // The button.
  const cta = SIM_ADDRESS;
  const bs = 46;
  const bw = widthOf(env, cta, bs, 2) + 96;
  const by = 1100;
  body += `<rect x="${(IG_W - bw) / 2}" y="${by}" width="${r1(bw)}" height="86" rx="43" fill="${GOLD}"/>`
    + text(IG_W / 2, by + 43 + bs * 0.36, cta, bs, NAVY, { anchor: "middle", spacing: 2 });

  const more = i < total - 1;
  const swipe = next?.part === 2 ? "SWIPE FOR THE REST OF ROUND 1" : next?.round ? `SWIPE FOR ROUND ${next.round}` : "SWIPE FOR MORE";
  body += footer(env, t, { logo: input.brandLogo, cta: more ? (input.swipeText || swipe) : (input.address || "WE-DRAFT.COM"), more });
  return svgDoc(env, defs, body, NAVY);
}

// The carousel → [{ name, round, part, svg }], at most IG_MAX_SLIDES: round
// 1's slides, the Draft Sim ad (unless simAd is false), then the rest.
export function mockSlides(input, env) {
  const ad = input.simAd !== false;
  const plan = mockSlidePlan(input.picks).slice(0, IG_MAX_SLIDES - (ad ? 1 : 0));
  const after = plan.filter((s) => s.round === 1).length || 1;
  const order = ad && plan.length ? [...plan.slice(0, after), { ad: true }, ...plan.slice(after)] : plan;
  return order.map((s, i) => (s.ad
    ? { name: "draft-sim-ad", ad: true, round: 0, part: 0, picks: 0, svg: simAdSvg(env, input, i, order.length, order[i + 1]) }
    : {
      name: s.part ? `round-1-${s.part}` : `round-${s.round}`, round: s.round, part: s.part, picks: s.picks.length,
      svg: mockSlideSvg(env, input, s, i, order.length),
    }));
}

// The picks a Draft Sim trade moved, by overall: the week's own trades
// (weeklyMock.js tradesFromSim — the picks each side got, this class's) and,
// for the next class, the main class's trades carried over
// (carriedTrades: [{ round, original, to }] — while the team they went to
// still has the pick).
export function simTradeSlots(week) {
  const year = String(week?.year || "");
  const out = new Set();
  (week?.trades || []).forEach((t) => [...(t.upGot || []), ...(t.downGot || [])].forEach((pk) => {
    if (String(pk.year) === year && pk.overall != null) out.add(pk.overall);
  }));
  (week?.picks || []).forEach((p) => {
    if ((week?.carriedTrades || []).some((c) => c.round === p.round && c.original === p.original && c.to === p.owner)) out.add(p.overall);
  });
  return out;
}

// A weeklyMocks doc's picks → mockSlides' input. branding: the nfl docs by
// abbr; headshots: { [playerId]: url }; collegeLogos: { [playerId]: { lg,
// ld } } (the class snapshots'). A logo on the dark theme's panels is the
// dark version (team or college), the light theme's the regular one.
export function mockInput({ week, branding = {}, headshots = {}, collegeLogos = {}, theme = "dark", dated = "", brandLogo = "", address = "", kicker = "", title = "", features = {}, feature = null, simAd = true }) {
  const dark = themeOf(theme).dark;
  const sim = simTradeSlots(week);
  const pickLogo = (light, darkOne) => (dark ? darkOne || light : light || darkOne) || "";
  const picks = (week?.picks || []).filter((p) => p.player).map((p) => {
    const b = branding[p.owner] || {};
    const cl = collegeLogos[p.player.id] || {};
    return {
      overall: p.overall, round: p.round, owner: p.owner, via: p.original && p.original !== p.owner ? p.original : "", simTrade: sim.has(p.overall),
      player: { id: p.player.id, First: p.player.First, Last: p.player.Last, Position: p.player.Position, School: p.player.School },
      headshot: headshots[p.player.id] || "",
      collegeLogo: pickLogo(cl.lg || p.player.logo, cl.ld),
      team: { abbr: p.owner, name: [b.City, b.Team].filter(Boolean).join(" "), nickname: b.Team || "", color: b.Color1 || "", color2: b.Color2 || "", logo: pickLogo(b.Logo1, b.LogoDark) },
    };
  });
  return {
    year: String(week?.year || ""), rounds: week?.rounds || 0, theme, dated, brandLogo, kicker, title, simAd,
    // Each round-1 slide's featured pick, by part (1, 2): { overall, photo,
    // focus (left | center | right), fit (meet | slice), adjust ({ x, y,
    // scale } — see placed) }. (feature: part 1's, the older way to say it.)
    features: Object.fromEntries(Object.entries({ ...(feature ? { 1: feature } : {}), ...features }).filter(([, f]) => f?.photo)),
    address: address || `WE-DRAFT.COM/MOCKS/${week?.year || ""}`, picks,
  };
}

// The carousel's caption: the first round, the link and tags.
// The caption's opening: the class, the week, and how its pick order was
// set — the upcoming draft's is projected from the standings (draftOrder.js
// ORDER_YEAR); a later projected draft's is that order shuffled in tiers
// (weeklyMock.js tieredOrder / TIERED_ORDER_NOTE, as its mock page says); a
// class past those is drawn at random (weeklyMock.js RANDOM_ORDER_YEARS).
function mockIntro(input) {
  const y = String(input.year);
  const order = y === ORDER_YEAR ? ""
    : UPCOMING_DRAFT_YEARS.includes(y) ? `The ${y} draft order is a year away, so we shuffled the projected order in tiers: picks 1–10, 11–20 and 21–32 are each drawn at random within their group. `
      : `It's too early to project the ${y} order, so this ${input.rounds === 1 ? "one-round " : ""}mock uses a random pick order. `;
  return [
    `We-Draft.com's Weekly ${y} Mock Draft${input.dated ? ` (${input.dated})` : ""}`,
    `${order}We used our We-Draft sim to drive team logic and Community Grades to set player values. Check out the results here:`,
  ];
}

// Round 1's picks, a line each — the team by its nickname ("Chargers"), so
// 32 of them and the opening fit Instagram's 2,200 characters
// (server/instagram/publish.js refuses a longer caption).
export function mockCaption(input) {
  const first = input.picks.filter((p) => p.round === 1).sort((a, b) => a.overall - b.overall);
  const trade = (p) => [p.via && `via ${p.via}`, p.simTrade && "sim trade"].filter(Boolean).join(", ");
  const lines = first.map((p) => `${p.overall}. ${p.team.nickname || p.team.name || p.owner}${trade(p) ? ` (${trade(p)})` : ""}: ${p.player.First} ${p.player.Last}, ${p.player.Position}, ${p.player.School}`);
  return [
    ...mockIntro(input),
    "",
    ...(input.rounds > 1 ? ["Round 1:"] : []),
    ...lines,
    ...(input.picks.some((p) => p.simTrade) ? ["", "Sim trade: a trade the We-Draft.com Draft Sim made in this mock, not a real one."] : []),
    "",
    `Every pick at ${input.address.toLowerCase()}`,
    ...(input.simAd !== false ? ["Don't like the picks? Make your own: we-draft.com/draftsim"] : []),
    "",
    `#NFLDraft #MockDraft #${input.year}NFLDraft #NFL #DraftTwitter`,
  ].join("\n");
}

// ── Player post (action shot) ──

// playerPost's input. photo: { url, orientation } (an action shot —
// playerPhotos action[]); school: { Color1, Color2, LogoDark, Logo1 }.
export function playerInput({ player, school = {}, photo = null, kicker = "", chips = [], brandLogo = "", address = "WE-DRAFT.COM" }) {
  return {
    first: player?.First || "", last: player?.Last || "", pos: player?.Position || "", school: player?.School || "",
    color: school.Color1 || NAVY, color2: school.Color2 || GOLD,
    // On his school's color: its dark logo.
    collegeLogo: school.LogoDark || school.Logo1 || "",
    photo: photo?.url || "", focus: photo?.orientation === "left" ? "right" : photo?.orientation === "right" ? "left" : "center",
    kicker, chips, brandLogo, address,
  };
}

const PHOTO_H = 1040;
// Which part of the shot stays when it's cropped: a player facing left is
// kept to the right, so he looks into the frame (and the other way round).
const FOCUS_X = { left: "xMin", center: "xMid", right: "xMax" };
const FOCUS_Y = { top: "YMin", middle: "YMid" };

export function playerPost(input, env) {
  const t = themeOf("dark");
  const bg = hex(input.color) || NAVY;
  const ink = textOn(bg, hex(input.color2));
  const onDark = ink === "#ffffff";
  const W2 = IG_W - PAD * 2;
  let defs = `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}" stop-opacity="0"/><stop offset="0.42" stop-color="${bg}" stop-opacity="0"/><stop offset="0.86" stop-color="${bg}" stop-opacity="0.94"/><stop offset="1" stop-color="${bg}" stop-opacity="1"/></linearGradient>`
    + '<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0.45"/><stop offset="1" stop-color="#000000" stop-opacity="0"/></linearGradient>'
    + `<clipPath id="photo"><rect width="${IG_W}" height="${PHOTO_H}"/></clipPath>`;
  let body = "";
  if (hasImage(env, input.photo)) {
    const par = `${FOCUS_X[input.focus] || "xMid"}${FOCUS_Y[input.focusY] || "YMin"} slice`;
    body += `<g clip-path="url(#photo)">${placed(image(env, input.photo, 0, 0, IG_W, PHOTO_H, par), 0, 0, IG_W, PHOTO_H, input.adjust)}</g>`
      + `<rect width="${IG_W}" height="${PHOTO_H + 2}" fill="url(#fade)"/><rect width="${IG_W}" height="240" fill="url(#top)"/>`;
  } else if (hasImage(env, input.collegeLogo)) {
    // No action shot: his school's logo, big and faded.
    body += image(env, input.collegeLogo, 140, 120, IG_W - 280, 680, "xMidYMid meet", 0.16);
  }

  // From the footer up: chips, position · school, last name, first name.
  let y = IG_H - FOOTER_H - 46;
  const chips = (input.chips || []).filter((c) => c && (c.value || c.label)).slice(0, 3);
  if (chips.length) {
    const ch = 118;
    const gap = 16;
    const cw = (W2 - gap * (chips.length - 1)) / chips.length;
    const top = y - ch;
    const fill = onDark ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.42)";
    chips.forEach((c, i) => {
      const cx = PAD + i * (cw + gap);
      body += `<rect x="${r1(cx)}" y="${top}" width="${r1(cw)}" height="${ch}" rx="18" fill="${fill}"/>`
        + `<rect x="${r1(cx)}" y="${top}" width="8" height="${ch}" rx="4" fill="${GOLD}"/>`
        + fitLine(env, cx + cw / 2 + 4, top + 66, up(c.value), 62, cw - 40, ink, { anchor: "middle", spacing: 1 }).svg
        + fitLine(env, cx + cw / 2 + 4, top + 100, up(c.label), 26, cw - 40, ink, { anchor: "middle", spacing: 1.5, opacity: 0.82 }).svg;
    });
    y = top - 40;
  }
  const info = up([input.pos, input.school].filter(Boolean).join(DOT));
  if (info) {
    const lg = hasImage(env, input.collegeLogo) ? 64 : 0;
    body += image(env, input.collegeLogo, PAD, y - 50, lg, lg)
      + fitLine(env, PAD + (lg ? lg + 18 : 0), y, info, 54, W2 - (lg ? lg + 18 : 0), ink, { spacing: 1.5, opacity: 0.92 }).svg;
    y -= 54 + 20;
  }
  const last = up(input.last);
  const lastS = fitSize(env, last, 210, W2, 80, 2);
  body += text(PAD - 4, y, last, lastS, ink, { spacing: 2 });
  y -= lastS * 0.78 + 12;
  if (input.first) body += fitLine(env, PAD, y, up(input.first), 84, W2, ink, { spacing: 3 }).svg;

  if (input.kicker) {
    const k = up(input.kicker);
    const ks = fitSize(env, k, 38, W2 - 48, 20, 2);
    const kw = widthOf(env, k, ks, 2) + 48;
    body += `<rect x="${PAD}" y="56" width="${r1(kw)}" height="64" rx="32" fill="${GOLD}"/>` + text(PAD + 24, 56 + 32 + ks * 0.36, k, ks, NAVY, { spacing: 2 });
  }
  body += footer(env, t, { logo: input.brandLogo, cta: input.address, more: false });
  return svgDoc(env, defs, body, bg);
}

export function playerCaption(input, extra = "") {
  const name = `${input.first} ${input.last}`.trim();
  const tag = (s) => String(s || "").replace(/[^A-Za-z0-9]/g, "");
  return [
    extra || `${name}, ${[input.pos, input.school].filter(Boolean).join(", ")}.`,
    "",
    `More on ${input.first || name} at ${String(input.address || "we-draft.com").toLowerCase()}`,
    "",
    ["#NFLDraft", "#CollegeFootball", input.school && `#${tag(input.school)}`, input.last && `#${tag(input.first)}${tag(input.last)}`].filter(Boolean).join(" "),
  ].join("\n");
}

// Every image a post draws (for the caller to load as data URIs).
export function imageUrls(input) {
  const urls = [input.brandLogo, input.photo, input.collegeLogo, ...Object.values(input.features || {}).map((f) => f.photo)];
  (input.picks || []).forEach((p) => urls.push(p.headshot, p.collegeLogo, p.team?.logo));
  return [...new Set(urls.filter(Boolean))];
}

// The drawing helpers, for the other post types (spotlight.js).
export const kit = {
  GOLD, BLUE, NAVY, PAD, FOOTER_H, DOT, FOCUS_X, esc, hex, up, r1, widthOf, fitSize, clipText, text, fitLine, image, hasImage, placed, svgDoc, footer, themeOf,
};
