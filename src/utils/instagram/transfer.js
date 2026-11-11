// src/utils/instagram/transfer.js
//
// Transfer Portal posts (Admin → Content → Instagram), drawn like posts.js:
// plain data in, SVG out at 1080×1350, so a server can draw them too
// (scripts/renderInstagram.mjs). Two posts with two different looks, one image
// or a carousel:
//
//   portal    He's entered the portal: a literal one. Rings of gold and his
//             school's color swirl around a lit core on black behind him,
//             hazard tape runs across the top, IN THE PORTAL sits above his
//             head, and at the foot his name, then his school's logo driving
//             at an empty destination slot. Carousel: + his file, + "where next?".
//   transfer  He's picked a school: the page is the new school's. The old
//             school's logo fills a corner wedge, chevrons drive from it to the
//             new logo; under him, TRANSFER on a slanted banner and his name.
//             Carousel: + what the new school is getting.
// On both covers the words stay clear of him: above his head, below his feet.
//
// transferInput assembles the input from what the page reads. The report is
// spotlight.js's scoutingReport: what his public player page shows. The
// graphics never show his draft class (only the caption does).
import { kit, IG_FONT } from "./posts.js";
import { textOn, readableOn } from "../teamColors.js";
import { measurementsOf, badgeMark } from "./spotlight.js";

const { GOLD, BLUE, NAVY, PAD, FOOTER_H, DOT, FOCUS_X, esc, hex, up, r1, widthOf, fitSize, text, fitLine, image, hasImage, placed, svgDoc, footer, themeOf } = kit;
const W = 1080;
const H = 1350;
const BOTTOM = H - FOOTER_H;
const VOID = "#05070c";
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;

export const TRANSFER_KINDS = ["portal", "transfer"];

const schoolOf = (s = {}, fallbackName = "") => ({
  name: s.School || fallbackName || "",
  color: hex(s.Color1) || "",
  color2: hex(s.Color2) || "",
  // On a school's color or on black: its dark logo.
  logoDark: s.LogoDark || s.Logo1 || "",
  logo: s.Logo1 || s.LogoDark || "",
});

// The input. kind: "portal" | "transfer"; player: the players doc; from / to:
// the schools docs (fromName: the old school when it isn't one of ours); photo:
// { url, orientation }; report: spotlight.js scoutingReport; carousel: more
// slides than the cover; kicker / headline / note: the admin's words.
export function transferInput({ kind = "portal", player = {}, from = {}, fromName = "", to = {}, toName = "", photo = null, report = null, carousel = false, kicker = "", headline = "", note = "", brandLogo = "", badgeLogo = "", address = "" }) {
  return {
    kind: kind === "transfer" ? "transfer" : "portal",
    first: player.First || "", last: player.Last || "", pos: player.Position || "", year: String(player.Eligible || ""),
    measurements: measurementsOf(player),
    from: schoolOf(from, fromName), to: schoolOf(to, toName),
    photo: photo?.url || "", focus: photo?.orientation === "left" ? "right" : photo?.orientation === "right" ? "left" : "center",
    report: report || null, carousel: !!carousel, kicker, headline, note, brandLogo, badgeLogo,
    address: address || (player.Slug ? `WE-DRAFT.COM/PLAYER/${player.Slug}` : "WE-DRAFT.COM"),
  };
}

// The cutout at his place on the slide (the admin moves and sizes it from here).
function playerPhoto(env, input, x, y, w, h) {
  const box = [x, y, w, h];
  return placed(image(env, input.photo, ...box, `${FOCUS_X[input.focus] || "xMid"}YMax meet`), ...box, input.adjust);
}
const shadow = '<filter id="dropShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.6"/></filter>';

// ── The portal ──
const RINGS = [
  { rx: 500, ry: 640, w: 4, gold: false, dash: "420 70 160 50", spin: 8, o: 0.55 },
  { rx: 462, ry: 596, w: 13, gold: true, dash: "560 80 240 60", spin: -6, o: 0.95 },
  { rx: 424, ry: 552, w: 6, gold: false, dash: "300 44 110 36", spin: 12, o: 0.9 },
  { rx: 388, ry: 508, w: 18, gold: false, dash: "680 60 180 40", spin: -14, o: 0.85 },
  { rx: 348, ry: 460, w: 5, gold: true, dash: "220 40 70 30", spin: 18, o: 0.9 },
  { rx: 312, ry: 416, w: 10, gold: true, dash: "480 60 120 40", spin: -20, o: 0.6 },
];
const CX = 540;
const CY = 590;

// The rings, behind him.
function rings(accent) {
  return RINGS.map((r) => `<ellipse cx="${CX}" cy="${CY}" rx="${r.rx}" ry="${r.ry}" fill="none" stroke="${r.gold ? GOLD : accent}" stroke-width="${r.w}" stroke-opacity="${r.o}" stroke-dasharray="${r.dash}" stroke-linecap="round" transform="rotate(${r.spin} ${CX} ${CY})"/>`).join("");
}

// Tape across the top: TRANSFER PORTAL, again and again.
function tape(y, label, deg = -3) {
  const band = 70;
  const line = Array(8).fill(up(label)).join("   ///   ");
  return `<g transform="rotate(${deg} ${W / 2} ${y + band / 2})"><rect x="-60" y="${y}" width="${W + 120}" height="${band}" fill="${GOLD}"/>`
    + `<rect x="-60" y="${y + 6}" width="${W + 120}" height="3" fill="${NAVY}"/><rect x="-60" y="${y + band - 9}" width="${W + 120}" height="3" fill="${NAVY}"/>`
    + text(-20, y + band / 2 + 16, line, 44, NAVY, { spacing: 3 })
    + "</g>";
}

const portalDefs = (accent) => `<radialGradient id="core" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="0.22" stop-color="${GOLD}" stop-opacity="0.75"/><stop offset="0.55" stop-color="${accent}" stop-opacity="0.75"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`
  + `<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0.5" stop-color="${accent}" stop-opacity="0.5"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>`
  + `<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${VOID}" stop-opacity="0"/><stop offset="0.6" stop-color="${VOID}" stop-opacity="0.92"/><stop offset="1" stop-color="${VOID}" stop-opacity="1"/></linearGradient>`
  + shadow;

// A school in the departures row: its logo and its name.
function tile(env, x, y, w, h, name, logo, fill) {
  const lg = hasImage(env, logo) ? h - 24 : 0;
  const tx = x + 18 + (lg ? lg + 14 : 0);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}" stroke="#ffffff" stroke-opacity="0.2" stroke-width="2"/>`
    + image(env, logo, x + 14, y + 12, lg, lg)
    + fitLine(env, tx, y + h / 2 + 21, up(name), 60, x + w - 16 - tx, "#ffffff", { spacing: 1, min: 22 }).svg;
}
const chevrons = (x, y, color, n = 3, s = 1, step = 30) => Array.from({ length: n }, (_, i) => `<path d="M ${x + i * step * s} ${y - 26 * s} L ${x + i * step * s + 26 * s} ${y} L ${x + i * step * s} ${y + 26 * s}" fill="none" stroke="${color}" stroke-opacity="${0.45 + (0.55 * (i + 1)) / n}" stroke-width="${11 * s}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");

function portalCover(env, input, total) {
  const accent = input.from.color && input.from.color !== "#000000" ? input.from.color : BLUE;
  // Dark school colors disappear on black: lifted for the rings.
  const lit = readableOn(accent, VOID, 1.8) === accent ? accent : shade(accent, 2.2);
  const W2 = W - PAD * 2;
  const words = up((input.headline || "IN THE PORTAL").trim()).split(/\s+/);
  const big = words.pop();
  const small = words.join(" ");
  const line = small ? `${small} ${big}` : big;
  const size = fitSize(env, line, 214, W - 70, 80, 3);
  const hasShot = hasImage(env, input.photo);
  // Behind him: the portal. The name's ground fades in under his feet.
  let body = `<ellipse cx="${CX}" cy="${CY}" rx="620" ry="760" fill="url(#halo)"/>`
    + rings(lit)
    + `<ellipse cx="${CX}" cy="${CY}" rx="360" ry="500" fill="url(#core)"/>`
    + `<rect x="0" y="800" width="${W}" height="${BOTTOM - 800 + 2}" fill="url(#foot)"/>`
    + tape(30, input.kicker || "TRANSFER PORTAL");
  // Above his head.
  body += `<text x="${CX}" y="${r1(138 + size * 0.72)}" font-family="${IG_FONT}" font-size="${size}" text-anchor="middle" letter-spacing="3" fill="${GOLD}">${small ? `<tspan fill="#ffffff">${esc(small)} </tspan>` : ""}${esc(big)}</text>`;
  // Him (no photo: his school's logo, in the same place).
  body += hasShot
    ? `<g filter="url(#dropShadow)">${playerPhoto(env, input, -10, 296, W + 20, 640)}</g>`
    : image(env, input.from.logoDark, CX - 220, 400, 440, 440);
  // Below his feet: his name, then the logo driving at an empty slot.
  const info = up([input.pos, input.note].filter(Boolean).join(DOT));
  body += fitLine(env, PAD - 3, 1044, up(`${input.first} ${input.last}`), 126, W2, "#ffffff", { spacing: 2, min: 54 }).svg
    + fitLine(env, PAD, 1094, info, 38, W2, GOLD, { spacing: 2 }).svg;
  const ty = 1118;
  const th = 106;
  const gap = 106;
  const tw = (W2 - gap) / 2;
  body += tile(env, PAD, ty, tw, th, input.from.name, input.from.logoDark, "rgba(255,255,255,0.08)")
    + chevrons(PAD + tw + 18, ty + th / 2, GOLD, 3, 0.9, 26);
  const dx = PAD + tw + gap;
  body += `<rect x="${dx}" y="${ty}" width="${tw}" height="${th}" rx="16" fill="none" stroke="${GOLD}" stroke-width="4" stroke-dasharray="16 11"/>`
    + text(dx + 50, ty + th / 2 + 34, "?", 96, GOLD, { anchor: "middle" })
    + text(dx + 96, ty + 44, "DESTINATION", 28, GOLD, { spacing: 2 })
    + fitLine(env, dx + 96, ty + th - 22, "TO BE DETERMINED", 44, tw - 110, "#ffffff", { spacing: 1 }).svg;
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? "SWIPE FOR HIS FILE" : input.address, more: total > 1 });
  return svgDoc(env, portalDefs(lit), body, VOID);
}

// ── A report's panels (both posts' second slides) ──
const TILE_H = 176;
const MEAS_H = 94;
const MEAS_PER = 4;
const MEAS_MAX = 8;
// Only what his public page shows: the community grade, class ranks, traits, measurements.
function reportPanels(env, input, top, c) {
  const r = input.report;
  const x0 = 46;
  const cw = W - x0 * 2;
  const gap = 16;
  let y = top;
  let out = "";
  const panel = (px, py, pw, ph) => `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="16" fill="${c.panel}" stroke="${c.edge}" stroke-opacity="0.25" stroke-width="2"/>`;

  // The grade and his ranks.
  const ranks = r ? [
    r.posRank && { n: r.posRank, of: r.posOf, label: `${up(input.pos)} RANK` },
    r.classRank && { n: r.classRank, of: r.classOf, label: "OVERALL" },
  ].filter(Boolean) : [];
  const graded = r?.grade?.avg != null;
  const tiles = (graded ? 1 : 0) + ranks.length;
  if (tiles) {
    const h = TILE_H;
    const tw = (cw - gap * (tiles - 1)) / tiles;
    let tx = x0;
    if (graded) {
      out += `<rect x="${r1(tx)}" y="${y}" width="${r1(tw)}" height="${h}" rx="16" fill="${r.grade.bg}"/>`
        + text(tx + tw / 2, y + 44, "COMMUNITY GRADE", 30, "#ffffff", { anchor: "middle", spacing: 2, opacity: 0.85 })
        + fitLine(env, tx + tw / 2, y + 112, up(r.grade.qualifier || r.grade.short), 72, tw - 30, "#ffffff", { anchor: "middle", spacing: 1 }).svg
        + fitLine(env, tx + tw / 2, y + 156, up(r.grade.qualifier ? "FIRST ROUND" : r.grade.label), 34, tw - 30, "#ffffff", { anchor: "middle", spacing: 1, opacity: 0.9 }).svg;
      tx += tw + gap;
    }
    ranks.forEach((k) => {
      out += panel(r1(tx), y, r1(tw), h)
        + text(tx + tw / 2, y + 44, k.label, 30, c.soft, { anchor: "middle", spacing: 2 })
        + fitLine(env, tx + tw / 2, y + 122, `#${k.n}`, 92, tw - 30, c.accent, { anchor: "middle", spacing: 1 }).svg
        + (k.of > 4 ? text(tx + tw / 2, y + 158, `OF ${k.of}`, 30, c.soft, { anchor: "middle", spacing: 1 }) : "");
      tx += tw + gap;
    });
    y += h + gap;
  }

  // Strengths and weaknesses.
  const strengths = (r?.strengths || []).slice(0, 5);
  const weaknesses = (r?.weaknesses || []).slice(0, 5);
  const rows = Math.max(strengths.length, weaknesses.length);
  if (rows) {
    // The traits take the room the other panels leave.
    const measRows = Math.ceil(Math.min(MEAS_MAX, (input.measurements || []).length) / MEAS_PER);
    const left = BOTTOM - 30 - y - (measRows ? measRows * (MEAS_H + gap) : 0);
    const rowH = Math.max(46, Math.min(86, (left - 70 - gap) / rows));
    const h = 70 + rows * rowH;
    const sides = [["STRENGTHS", strengths, "#3fbf7f"], ["WEAKNESSES", weaknesses, "#ef6a5e"]].filter(([, list]) => list.length);
    const hw = (cw - gap * (sides.length - 1)) / sides.length;
    sides.forEach(([title, list, tone], n) => {
      const px = x0 + n * (hw + gap);
      out += panel(r1(px), y, r1(hw), h) + text(px + 22, y + 46, title, 36, tone, { spacing: 2 });
      list.forEach((t, k) => {
        const ly = y + 70 + k * rowH;
        if (r.bars) out += `<rect x="${r1(px + 22)}" y="${r1(ly + 42)}" width="${r1((hw - 44) * Math.min(1, t.pct / 100))}" height="6" rx="3" fill="${tone}"/>`;
        out += fitLine(env, px + 22, ly + 36, up(t.term), 40, hw - 44, c.ink, { spacing: 0.5, min: 20 }).svg;
      });
    });
    y += h + gap;
  } else if (!tiles) {
    // Nothing on him yet: say so, and ask.
    const h = 300;
    out += panel(x0, y, cw, h)
      + fitLine(env, W / 2, y + 130, "NO COMMUNITY REPORT YET", 74, cw - 60, c.ink, { anchor: "middle", spacing: 2 }).svg
      + fitLine(env, W / 2, y + 208, "BE THE FIRST TO GRADE HIM AT WE-DRAFT.COM", 42, cw - 60, c.accent, { anchor: "middle", spacing: 2 }).svg;
    y += h + gap;
  }

  // Measurements, as much as there's room for.
  const room = BOTTOM - 30 - y;
  const th = MEAS_H;
  const maxRows = Math.max(0, Math.min(MEAS_MAX / MEAS_PER, Math.floor((room + gap) / (th + gap))));
  const meas = (input.measurements || []).slice(0, maxRows * MEAS_PER);
  const measRows = Math.ceil(meas.length / MEAS_PER);
  const end = measRows ? y + measRows * (th + gap) - gap : y - gap;
  meas.forEach((m, k) => {
    // A row short of four stretches across, so it isn't left hanging.
    const row = Math.floor(k / MEAS_PER);
    const inRow = Math.min(MEAS_PER, meas.length - row * MEAS_PER);
    const tw = (cw - gap * (inRow - 1)) / inRow;
    const tx = x0 + (k % MEAS_PER) * (tw + gap);
    const ty = y + row * (th + gap);
    out += panel(r1(tx), ty, r1(tw), th)
      + text(tx + tw / 2, ty + 36, m.label, 26, c.soft, { anchor: "middle", spacing: 2 })
      + fitLine(env, tx + tw / 2, ty + 78, up(m.val), 42, tw - 20, c.ink, { anchor: "middle", spacing: 0.5 }).svg;
  });
  // A short report sits in the middle of its room, not at the top of it.
  const spare = Math.max(0, BOTTOM - 30 - end);
  return spare > 8 ? `<g transform="translate(0 ${r1(spare / 2)})">${out}</g>` : out;
}

// His file, on the portal's black.
function portalFile(env, input, i, total) {
  const accent = input.from.color && input.from.color !== "#000000" ? input.from.color : BLUE;
  const lit = readableOn(accent, VOID, 1.8) === accent ? accent : shade(accent, 2.2);
  const W2 = W - PAD * 2;
  let body = `<g opacity="0.3">${rings(lit)}</g>`
    + `<rect width="${W}" height="${H}" fill="${VOID}" fill-opacity="0.45"/>`
    + tape(30, input.kicker || "TRANSFER PORTAL")
    + text(PAD, 192, "THE FILE ON", 48, GOLD, { spacing: 6 })
    + fitLine(env, PAD - 3, 322, up(`${input.first} ${input.last}`), 136, W2 - (hasImage(env, input.from.logoDark) ? 150 : 0), "#ffffff", { spacing: 2, min: 60 }).svg
    + fitLine(env, PAD, 372, up([input.pos, input.from.name].filter(Boolean).join(DOT)), 42, W2, "#b9c5d8", { spacing: 1.5 }).svg
    + image(env, input.from.logoDark, W - PAD - 130, 150, 130, 130);
  body += reportPanels(env, input, 402, { panel: "rgba(255,255,255,0.07)", edge: "#ffffff", ink: "#ffffff", soft: "#a9b6ca", accent: GOLD });
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: i < total - 1 ? "SWIPE: WHERE NEXT?" : input.address, more: i < total - 1 });
  return svgDoc(env, portalDefs(lit), body, VOID);
}

// Where next? A question for the comments.
function portalNext(env, input) {
  const accent = input.from.color && input.from.color !== "#000000" ? input.from.color : BLUE;
  const lit = readableOn(accent, VOID, 1.8) === accent ? accent : shade(accent, 2.2);
  const W2 = W - PAD * 2;
  let body = `<ellipse cx="${CX}" cy="${CY}" rx="620" ry="760" fill="url(#halo)"/><g opacity="0.55">${rings(lit)}</g>`
    + `<ellipse cx="${CX}" cy="${CY}" rx="360" ry="500" fill="url(#core)" opacity="0.55"/>`
    + tape(30, input.kicker || "TRANSFER PORTAL")
    + fitLine(env, CX, 330, "WHERE SHOULD", 170, W2, "#ffffff", { anchor: "middle", spacing: 3 }).svg
    + fitLine(env, CX, 500, up(`${input.last} GO?`), 190, W2, GOLD, { anchor: "middle", spacing: 3 }).svg;
  // Three empty slots.
  const s = 250;
  const g = 40;
  const x0 = (W - (s * 3 + g * 2)) / 2;
  [0, 1, 2].forEach((k) => {
    const x = x0 + k * (s + g);
    body += `<rect x="${x}" y="600" width="${s}" height="${s}" rx="26" fill="${VOID}" fill-opacity="0.72" stroke="${GOLD}" stroke-width="5" stroke-dasharray="20 14"/>`
      + text(x + s / 2, 600 + s / 2 + 62, "?", 180, GOLD, { anchor: "middle" });
  });
  body += fitLine(env, CX, 970, "TELL US IN THE COMMENTS", 88, W2, "#ffffff", { anchor: "middle", spacing: 3 }).svg
    + fitLine(env, CX, 1050, up(`THEN GRADE HIM AT ${input.address}`), 42, W2, GOLD, { anchor: "middle", spacing: 2 }).svg;
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: "WE-DRAFT.COM", more: false });
  return svgDoc(env, portalDefs(lit), body, VOID);
}

// ── The transfer ──
// The new school's colors, and what reads on them.
function newColors(input) {
  const bg = input.to.color || BLUE;
  const second = input.to.color2 || GOLD;
  const vals = [1, 3, 5].map((i) => parseInt(second.slice(i, i + 2), 16));
  const gray = Math.max(...vals) - Math.min(...vals) < 40;
  const pop = gray ? "#ffffff" : readableOn(second, bg, 2) === second ? second : GOLD;
  return { bg, second, ink: textOn(bg, second), deep: shade(bg, 0.2), pop: readableOn(pop, bg, 1.6) === pop ? pop : textOn(bg, second) };
}

const transferDefs = (c) => `<linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c.bg, 1.12)}"/><stop offset="0.55" stop-color="${c.bg}"/><stop offset="1" stop-color="${shade(c.bg, 0.55)}"/></linearGradient>`
  + `<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.deep}" stop-opacity="0"/><stop offset="0.55" stop-color="${c.deep}" stop-opacity="0.94"/><stop offset="1" stop-color="${c.deep}" stop-opacity="1"/></linearGradient>${shadow}`;

// The corner wedge: the school he left, its logo filling it.
const WEDGE = { top: 610, foot: 330, h: 330 };
function oldWedge(env, input, c) {
  const old = input.from.color ? shade(input.from.color, 0.62) : "#2b2f38";
  const { top, foot, h } = WEDGE;
  return `<path d="M 0 0 L ${top} 0 L ${foot} ${h} L 0 ${h} Z" fill="${old}"/>`
    + `<path d="M ${top} 0 L ${foot} ${h}" stroke="${c.pop}" stroke-width="16"/>`
    + `<path d="M ${top + 22} 0 L ${foot + 22} ${h}" stroke="#ffffff" stroke-opacity="0.8" stroke-width="5"/>`
    + image(env, input.from.logoDark, 34, 24, 310, 282);
}

function transferCover(env, input, total) {
  const c = newColors(input);
  const W2 = W - PAD * 2;
  const hasShot = hasImage(env, input.photo);
  // The ground his name stands on, cut on the same slant as the wedge.
  const groundL = 940;
  const groundR = 880;
  let body = `<rect width="${W}" height="${H}" fill="url(#wash)"/>`
    // Diagonal pinstripes: the page moving the way he is.
    + Array.from({ length: 10 }, (_, k) => `<rect x="${k * 170 - 60}" y="-120" width="34" height="1800" fill="${c.ink}" fill-opacity="0.04" transform="skewX(-28)"/>`).join("")
    + oldWedge(env, input, c)
    // The drive: chevrons from the wedge to the new logo.
    + chevrons(WEDGE.top - 50, 165, c.pop, 3, 1.5, 36)
    + image(env, input.to.logoDark, W - PAD - 300 + 20, 16, 300, 300)
    + `<path d="M 0 ${groundL} L ${W} ${groundR} L ${W} ${BOTTOM} L 0 ${BOTTOM} Z" fill="${c.deep}"/>`
    + `<path d="M 0 ${groundL} L ${W} ${groundR}" stroke="${c.pop}" stroke-width="8"/>`;
  const word = up(input.kicker || "TRANSFER");
  // Him. No photo: the logos are already up top, so the word takes his place.
  body += hasShot
    ? `<g filter="url(#dropShadow)">${playerPhoto(env, input, -10, 326, W + 20, 610)}</g>`
    : fitLine(env, CX, 720, word, 300, W - 80, c.ink, { anchor: "middle", spacing: 6 }).svg;
  // Below his feet: the news on a slanted banner, then who.
  const ws = fitSize(env, word, 56, W2 - 60, 28, 5);
  const ww = widthOf(env, word, ws, 5) + 60;
  const by = 954;
  const bh = 66;
  const banner = c.pop;
  if (hasShot) {
    body += `<g transform="skewX(-12)"><rect x="${r1(PAD + (by + bh) * 0.2126)}" y="${by}" width="${r1(ww)}" height="${bh}" fill="${banner}"/></g>`
      + text(PAD + 30, by + bh / 2 + ws * 0.35, word, ws, textOn(banner, c.deep), { spacing: 5 });
  }
  const info = up([input.pos, input.note].filter(Boolean).join(DOT));
  body += fitLine(env, PAD - 3, 1158, up(`${input.first} ${input.last}`), 170, W2, "#ffffff", { spacing: 2, min: 70 }).svg
    + fitLine(env, PAD, 1218, info, 44, W2, "#ffffff", { spacing: 2, opacity: 0.92 }).svg;
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? `SWIPE: WHAT ${up(input.to.name)} GETS` : input.address, more: total > 1 });
  return svgDoc(env, transferDefs(c), body, c.bg);
}

// What the new school is getting.
function transferReport(env, input) {
  const c = newColors(input);
  const W2 = W - PAD * 2;
  const header = 380;
  const lg = 140;
  const a = PAD;
  const b = W - PAD - lg;
  let body = `<rect width="${W}" height="${H}" fill="${c.deep}"/><rect width="${W}" height="${header}" fill="url(#wash)"/><rect y="${header}" width="${W}" height="8" fill="${c.pop}"/>`
    + fitLine(env, CX, 86, up(`WHAT ${input.to.name} IS GETTING`), 66, W2, c.ink, { anchor: "middle", spacing: 3 }).svg
    + image(env, input.from.logoDark, a, 112, lg, lg, "xMidYMid meet", 0.8)
    + chevrons(CX - 60, 182, c.pop, 4, 1.15, 34)
    + image(env, input.to.logoDark, b, 112, lg, lg)
    + fitLine(env, CX, 300, up(`${input.first} ${input.last}`), 74, W2, c.ink, { anchor: "middle", spacing: 2 }).svg
    + fitLine(env, CX, 352, up([input.pos, input.note].filter(Boolean).join(DOT)), 38, W2, c.ink, { anchor: "middle", spacing: 2, opacity: 0.85 }).svg;
  body += reportPanels(env, input, header + 32, { panel: "rgba(255,255,255,0.08)", edge: "#ffffff", ink: "#ffffff", soft: "#c9d2e0", accent: readableOn(c.pop, c.deep, 2.2) === c.pop ? c.pop : GOLD });
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: input.address, more: false });
  return svgDoc(env, transferDefs(c), body, c.deep);
}

// ── The highlight video's frame ──
// Not a slide: a 1080×1350 overlay to cut his highlight clip under in a video
// editor, like spotlight.js's spotlightFrame, in the post's own look. The
// window is left clear (a PNG keeps it transparent); everything else is drawn.
//   portal    black, his old school's rings swirling out from behind the
//             window; IN THE PORTAL, his school and the WD badge up top;
//             under it his name and his school's logo driving at the empty
//             DESTINATION slot.
//   transfer  the new school's wash and pinstripes; up top the old school's
//             wedge, chevrons to the new logo, the WD badge; under it the
//             slanted TRANSFER banner, "AUBURN TO LSU", his name.
export const TRANSFER_FRAME_WINDOWS = {
  portal: { x: 36, y: 170, w: 1008, h: 740, r: 28 },
  transfer: { x: 36, y: 170, w: 1008, h: 800, r: 28 },
};

function frameWindow(win, edge, corners) {
  const { x, y, w, h, r } = win;
  const cl = 74;
  const ci = 26;
  const corner = (cx, cy, dx, dy) => `<path d="M ${cx} ${cy + dy * cl} L ${cx} ${cy} L ${cx + dx * cl} ${cy}" fill="none" stroke="${corners}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${edge}" stroke-width="8"/>`
    + `<rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" rx="${r - 8}" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2"/>`
    + `<g filter="url(#fshadow)">${corner(x + ci, y + ci, 1, 1)}${corner(x + w - ci, y + ci, -1, 1)}${corner(x + ci, y + h - ci, 1, -1)}${corner(x + w - ci, y + h - ci, -1, -1)}</g>`;
}
const frameDefs = (win) => `<mask id="window"><rect width="${W}" height="${H}" fill="#ffffff"/><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="${win.r}" fill="#000000"/></mask>`
  + '<filter id="fshadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#000000" flood-opacity="0.6"/></filter>';
const frameSvg = (env, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${env.fontCss ? `<style>${env.fontCss}</style>` : ""}${defs}</defs>${body}</svg>`;
const FRAME_CTA = "GRADE HIM ON WE-DRAFT.COM";

function portalFrame(env, input) {
  const win = TRANSFER_FRAME_WINDOWS.portal;
  const accent = input.from.color && input.from.color !== "#000000" ? input.from.color : BLUE;
  const lit = readableOn(accent, VOID, 1.8) === accent ? accent : shade(accent, 2.2);
  const W2 = W - PAD * 2;
  // Outside the window: the void, the halo and the rings around it.
  let body = `<g mask="url(#window)"><rect width="${W}" height="${H}" fill="${VOID}"/>`
    + `<ellipse cx="${CX}" cy="${win.y + win.h / 2}" rx="640" ry="720" fill="url(#halo)"/>`
    + `<g transform="translate(0 ${win.y + win.h / 2 - CY})">${rings(lit)}</g>`
    // The rings fade out under the window so his name and the slots read clean.
    + `<rect x="0" y="${win.y + win.h - 60}" width="${W}" height="${BOTTOM - (win.y + win.h) + 62}" fill="url(#foot)"/></g>`;

  // The top: IN THE PORTAL (a little portal for its mark), his school, the WD badge.
  const k = up(input.headline || "IN THE PORTAL");
  const kw = 64 + widthOf(env, k, 40, 3) + 26;
  const my = 87;
  body += `<rect x="${PAD}" y="54" width="${r1(kw)}" height="66" rx="33" fill="${GOLD}"/>`
    + `<ellipse cx="${PAD + 36}" cy="${my}" rx="16" ry="20" fill="none" stroke="${NAVY}" stroke-width="5"/>`
    + `<ellipse cx="${PAD + 36}" cy="${my}" rx="7" ry="10" fill="${NAVY}"/>`
    + text(PAD + 64, my + 14, k, 40, NAVY, { spacing: 3 });
  const brand = badgeMark(env, input.badgeLogo, W - PAD, my);
  body += fitLine(env, PAD + kw + 22, 102, up(input.from.name), 40, W - PAD - brand.w - (brand.w ? 26 : 0) - (PAD + kw + 22), "#ffffff", { spacing: 2, opacity: 0.9 }).svg
    + brand.svg;

  body += frameWindow(win, lit, GOLD);

  // Under it: his name, then his school's logo driving at the empty slot.
  const info = up([input.pos, input.note].filter(Boolean).join(DOT));
  body += fitLine(env, PAD - 3, 1004, up(`${input.first} ${input.last}`), 100, W2, "#ffffff", { spacing: 2, min: 50 }).svg
    + fitLine(env, PAD, 1050, info, 34, W2, GOLD, { spacing: 2 }).svg;
  const ty = 1074;
  const th = 100;
  const gap = 106;
  const tw = (W2 - gap) / 2;
  body += tile(env, PAD, ty, tw, th, input.from.name, input.from.logoDark, "rgba(255,255,255,0.08)")
    + chevrons(PAD + tw + 18, ty + th / 2, GOLD, 3, 0.9, 26);
  const dx = PAD + tw + gap;
  body += `<rect x="${dx}" y="${ty}" width="${tw}" height="${th}" rx="16" fill="none" stroke="${GOLD}" stroke-width="4" stroke-dasharray="16 11"/>`
    + text(dx + 50, ty + th / 2 + 32, "?", 90, GOLD, { anchor: "middle" })
    + text(dx + 96, ty + 42, "DESTINATION", 28, GOLD, { spacing: 2 })
    + fitLine(env, dx + 96, ty + th - 20, "TO BE DETERMINED", 42, tw - 110, "#ffffff", { spacing: 1 }).svg;
  body += `<rect x="${PAD}" y="${BOTTOM - 22}" width="${W2}" height="4" rx="2" fill="${GOLD}" fill-opacity="0.8"/>`;
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: FRAME_CTA, more: false });
  return frameSvg(env, portalDefs(lit) + frameDefs(win), body);
}

function transferFrameSvg(env, input) {
  const win = TRANSFER_FRAME_WINDOWS.transfer;
  const c = newColors(input);
  const W2 = W - PAD * 2;
  const old = input.from.color ? shade(input.from.color, 0.62) : "#2b2f38";
  // Outside the window: the new school's wash, the pinstripes, the ground.
  const groundL = 1000;
  const groundR = 986;
  let body = `<g mask="url(#window)"><rect width="${W}" height="${H}" fill="url(#wash)"/>`
    + Array.from({ length: 10 }, (_, k) => `<rect x="${k * 170 - 60}" y="-120" width="34" height="1800" fill="${c.ink}" fill-opacity="0.05" transform="skewX(-28)"/>`).join("")
    + `<path d="M 0 ${groundL} L ${W} ${groundR} L ${W} ${H} L 0 ${H} Z" fill="${c.deep}"/></g>`
    + `<path d="M 0 ${groundL} L ${W} ${groundR}" stroke="${c.pop}" stroke-width="8"/>`;

  // The top: the old school's wedge, chevrons to the new logo, the WD badge.
  const wt = 250;
  const wf = 196;
  body += `<path d="M 0 0 L ${wt} 0 L ${wf} ${win.y - 22} L 0 ${win.y - 22} Z" fill="${old}"/>`
    + `<path d="M ${wt} 0 L ${wf} ${win.y - 22}" stroke="${c.pop}" stroke-width="10"/>`
    + `<path d="M ${wt + 16} 0 L ${wf + 16} ${win.y - 22}" stroke="#ffffff" stroke-opacity="0.8" stroke-width="4"/>`
    + image(env, input.from.logoDark, 24, 18, 160, 112);
  const my = 80;
  body += chevrons(wt + 34, my, c.pop, 3, 1, 30)
    + image(env, input.to.logoDark, wt + 150, my - 60, 120, 120);
  body += badgeMark(env, input.badgeLogo, W - PAD, my).svg;

  body += frameWindow(win, c.pop, "#ffffff");

  // Under it: TRANSFER on the slanted banner, FROM → TO beside it, his name.
  const word = up(input.kicker || "TRANSFER");
  const ws = fitSize(env, word, 46, 360, 26, 5);
  const ww = widthOf(env, word, ws, 5) + 50;
  const by = 1016;
  const bh = 56;
  body += `<g transform="skewX(-12)"><rect x="${r1(PAD + (by + bh) * 0.2126)}" y="${by}" width="${r1(ww)}" height="${bh}" fill="${c.pop}"/></g>`
    + text(PAD + 25, by + bh / 2 + ws * 0.35, word, ws, textOn(c.pop, c.deep), { spacing: 5 });
  // (Bebas Neue has no arrow glyph.)
  const route = input.from.name && input.to.name ? up(`${input.from.name} TO ${input.to.name}`) : up(input.from.name || input.to.name);
  const rx = PAD + ww + 30;
  body += fitLine(env, rx, by + bh / 2 + 12, route, 34, W - PAD - rx, "#ffffff", { spacing: 2, opacity: 0.9 }).svg;
  const info = up([input.pos, input.note].filter(Boolean).join(DOT));
  body += fitLine(env, PAD - 3, 1166, up(`${input.first} ${input.last}`), 112, W2, "#ffffff", { spacing: 2, min: 56 }).svg
    + fitLine(env, PAD, 1214, info, 36, W2, "#ffffff", { spacing: 2, opacity: 0.9 }).svg;
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: FRAME_CTA, more: false });
  return frameSvg(env, transferDefs(c) + frameDefs(win), body);
}

// The frame for the post's kind.
export function transferFrame(input, env) {
  return input.kind === "transfer" ? transferFrameSvg(env, input) : portalFrame(env, input);
}

// → [{ name, svg }]: the cover alone, or the carousel.
export function transferSlides(input, env) {
  if (input.kind === "transfer") {
    const total = input.carousel ? 2 : 1;
    const out = [{ name: "transfer", svg: transferCover(env, input, total) }];
    if (input.carousel) out.push({ name: "what-they-get", svg: transferReport(env, input) });
    return out;
  }
  const total = input.carousel ? 3 : 1;
  const out = [{ name: "portal", svg: portalCover(env, input, total) }];
  if (input.carousel) {
    out.push({ name: "his-file", svg: portalFile(env, input, 1, total) });
    out.push({ name: "where-next", svg: portalNext(env, input) });
  }
  return out;
}

const tag = (s) => String(s || "").replace(/[^A-Za-z0-9]/g, "");

export function transferCaption(input) {
  const name = `${input.first} ${input.last}`.trim();
  const who = [input.pos, input.year && `${input.year} NFL Draft class`].filter(Boolean).join(", ");
  const site = String(input.address).toLowerCase();
  if (input.kind === "transfer") {
    return [
      `${name}${who ? ` (${who})` : ""} is transferring from ${input.from.name || "his old school"} to ${input.to.name || "his new school"}.`,
      "",
      `His full scouting report at ${site}`,
      "",
      ["#TransferPortal", "#CollegeFootball", "#NFLDraft", input.to.name && `#${tag(input.to.name)}`, input.from.name && `#${tag(input.from.name)}`].filter(Boolean).join(" "),
    ].join("\n");
  }
  return [
    `${name}${who ? ` (${who})` : ""} has entered the transfer portal${input.from.name ? ` from ${input.from.name}` : ""}.`,
    "",
    "Where should he go? Tell us in the comments.",
    "",
    `His full scouting report at ${site}`,
    "",
    ["#TransferPortal", "#CollegeFootball", "#NFLDraft", input.from.name && `#${tag(input.from.name)}`].filter(Boolean).join(" "),
  ].join("\n");
}

// Every image a post draws (for the caller to load as data URIs).
export function transferImageUrls(input) {
  return [...new Set([input.brandLogo, input.photo, input.from.logoDark, input.kind === "transfer" ? input.to.logoDark : ""].filter(Boolean))];
}
