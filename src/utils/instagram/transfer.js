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
//   (portal, projected: true) Portal Watch — a player expected to enter, not
//             in yet: a violet radar, PORTAL WATCH under the line (projectedCover).
//   transfer  He's picked a school: the page is the new school's. The old
//             school's logo fills a corner wedge, chevrons drive from it to the
//             new logo; under him, TRANSFER on a slanted banner and his name.
//             Carousel: + what the new school is getting.
// On both covers he stands in First Pick's photo box (firstPick.js
// FIRST_PICK_PHOTO) — so an action shot placed for First Pick (playerPhotos
// action[i].firstPick) lands where the admin set it — and the panel under
// him starts on a hard, straight line at the split (FIRST_PICK_SPLIT): no
// fade. The placement hides his lower body under that line.
//
// The transfer cover has two designs (input.design):
//   classic  (Mock 1) the look above: the old school's wedge, chevrons to
//            the new logo, TRANSFER on a slanted banner, his name.
//   welcome  (Mock 2, the default) for the new school's fans to share: their
//            colors lit from behind him, light rays and confetti, the
//            mascot's name in giant type across the back, COMMITTED up top;
//            under the line, his name beside their logo, then the move: the
//            old school, an arrow, the new school.
// The second slides (his file, what they get) lead with his season stats
// (input.stats) when there are any.
//
// transferInput assembles the input from what the page reads. The report is
// spotlight.js's scoutingReport: what his public player page shows. The
// graphics never show his draft class (only the caption does). The same
// covers are the cards on the portal news page (pages/PortalNews.jsx).
import { kit, IG_FONT } from "./posts.js";
import { textOn, readableOn } from "../teamColors.js";
import { measurementsOf, badgeMark } from "./spotlight.js";
import { FIRST_PICK_SPLIT, FIRST_PICK_PHOTO, firstPickAdjust } from "./firstPick.js";

const { GOLD, BLUE, NAVY, PAD, FOOTER_H, DOT, FOCUS_X, esc, hex, up, r1, widthOf, fitSize, text, fitLine, image, hasImage, placed, svgDoc, footer, themeOf } = kit;
const W = 1080;
const H = 1350;
const BOTTOM = H - FOOTER_H;
const SPLIT = FIRST_PICK_SPLIT;
const VOID = "#05070c";
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;

export const TRANSFER_KINDS = ["portal", "transfer"];
// The transfer cover's designs: [key, the admin's name for it].
export const TRANSFER_DESIGNS = [["classic", "Mock 1 · Classic"], ["welcome", "Mock 2 · Commitment"]];
export const TRANSFER_STATS = 4;

const schoolOf = (s = {}, fallbackName = "") => ({
  name: s.School || fallbackName || "",
  color: hex(s.Color1) || "",
  color2: hex(s.Color2) || "",
  // On a school's color or on black: its dark logo.
  logoDark: s.LogoDark || s.Logo1 || "",
  logo: s.Logo1 || s.LogoDark || "",
  mascot: s.Mascot || "",
});

// The input. kind: "portal" | "transfer"; player: the players doc; from / to:
// the schools docs (fromName: the old school when it isn't one of ours); photo:
// { url, orientation, firstPick } — a shot placed for First Pick is drawn
// where it was placed; report: spotlight.js scoutingReport; carousel: more
// slides than the cover; kicker / headline / note: the admin's words;
// design: the transfer cover's ("classic" | "welcome"); stats: his season
// [{ label, value }] and statsTitle ("2026 SEASON AT PITTSBURGH") for the
// second slide; badgeLogo: the WD badge (the welcome cover's top right).
export function transferInput({ kind = "portal", player = {}, from = {}, fromName = "", to = {}, toName = "", photo = null, report = null, carousel = false, kicker = "", headline = "", note = "", brandLogo = "", badgeLogo = "", address = "", design = "welcome", stats = [], statsTitle = "", projected = false }) {
  const fp = photo?.firstPick || null;
  return {
    kind: kind === "transfer" ? "transfer" : "portal",
    design: design === "classic" ? "classic" : "welcome",
    // A portal cover for a player not in the portal yet: the Portal Watch look (projectedCover).
    projected: kind !== "transfer" && !!projected,
    first: player.First || "", last: player.Last || "", pos: player.Position || "", year: String(player.Eligible || ""),
    measurements: measurementsOf(player),
    from: schoolOf(from, fromName), to: schoolOf(to, toName),
    photo: photo?.url || "",
    // A placed shot keeps its placement (and stands centered, as placed).
    focus: fp ? "center" : photo?.orientation === "left" ? "right" : photo?.orientation === "right" ? "left" : "center",
    ...(fp ? { adjust: firstPickAdjust(fp) } : {}),
    report: report || null, carousel: !!carousel, kicker, headline, note, brandLogo, badgeLogo,
    stats: (stats || []).filter((s) => s && s.value !== "" && s.value != null).slice(0, TRANSFER_STATS).map((s) => ({ label: up(s.label), value: String(s.value) })),
    statsTitle: up(statsTitle),
    address: address || (player.Slug ? `WE-DRAFT.COM/PLAYER/${player.Slug}` : "WE-DRAFT.COM"),
  };
}

// He stands in First Pick's photo box, turned and placed as saved (or as
// the admin drags him).
function playerShot(env, input) {
  if (!hasImage(env, input.photo)) return "";
  const b = FIRST_PICK_PHOTO;
  const rot = input.adjust?.rotate || 0;
  const shot = image(env, input.photo, b.x, b.y, b.w, b.h, `${FOCUS_X[input.focus] || "xMid"}YMax meet`);
  const turned = rot ? `<g transform="rotate(${r1(rot)} ${r1(b.x + b.w / 2)} ${r1(b.y + b.h / 2)})">${shot}</g>` : shot;
  return `<g filter="url(#dropShadow)">${placed(turned, b.x, b.y, b.w, b.h, input.adjust)}</g>`;
}
// The panel under him, from the split down, and the hard line it starts on.
// (Drawn over the top, so whatever of him runs past the split is hidden.)
function splitPanel(fill, line, extra = "") {
  return `<rect y="${SPLIT}" width="${W}" height="${H - SPLIT}" fill="${fill}"/>${extra}`
    + `<rect y="${SPLIT - 5}" width="${W}" height="11" fill="${line}"/>`;
}
const shadow = '<filter id="dropShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.6"/></filter>';
// A repeatable random for a name: the same player gets the same confetti.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

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

// The empty slot's words: TO BE DETERMINED, as big as fills the box.
function tbd(env, x, y, w, h) {
  const words = "TO BE DETERMINED";
  const size = fitSize(env, words, h * 0.62, w - 40, 24, 2);
  return text(x + w / 2, y + h / 2 + size * 0.35, words, size, "#ffffff", { anchor: "middle", spacing: 2 });
}

// The portal behind him: lifted to sit around his head and shoulders.
const PORTAL_LIFT = -140;
function portalCover(env, input, total) {
  const accent = input.from.color && input.from.color !== "#000000" ? input.from.color : BLUE;
  // Dark school colors disappear on black: lifted for the rings.
  const lit = readableOn(accent, VOID, 1.8) === accent ? accent : shade(accent, 2.2);
  const W2 = W - PAD * 2;
  const hasShot = hasImage(env, input.photo);
  // Behind him: the portal, and the tape he breaks through.
  let body = `<g transform="translate(0 ${PORTAL_LIFT})"><ellipse cx="${CX}" cy="${CY}" rx="620" ry="760" fill="url(#halo)"/>`
    + rings(lit)
    + `<ellipse cx="${CX}" cy="${CY}" rx="360" ry="500" fill="url(#core)"/></g>`
    + tape(54, input.kicker || "TRANSFER PORTAL");
  // Him (no photo: his school's logo, in the portal).
  body += hasShot ? playerShot(env, input) : image(env, input.from.logoDark, CX - 230, 220, 460, 460);
  // The line, then under it: IN THE PORTAL, his name, his school driving at an empty slot.
  body += splitPanel("#070a12", GOLD, `<ellipse cx="${CX}" cy="${SPLIT}" rx="700" ry="220" fill="url(#halo)" opacity="0.35"/>`);
  const words = up((input.headline || "IN THE PORTAL").trim()).split(/\s+/);
  const big = words.pop();
  const small = words.join(" ");
  const hs = fitSize(env, small ? `${small} ${big}` : big, 86, W2 * 0.62, 40, 3);
  const hy = SPLIT + 92;
  body += `<text x="${PAD}" y="${hy}" font-family="${IG_FONT}" font-size="${hs}" letter-spacing="3" fill="${GOLD}">${small ? `<tspan fill="#ffffff">${esc(small)} </tspan>` : ""}${esc(big)}</text>`;
  const info = up([input.pos, input.note].filter(Boolean).join(DOT));
  if (info) {
    const is = fitSize(env, info, 40, W2 * 0.34, 22, 2);
    const iw = widthOf(env, info, is, 2) + 32;
    body += `<rect x="${r1(W - PAD - iw)}" y="${hy - 52}" width="${r1(iw)}" height="54" rx="10" fill="${GOLD}"/>`
      + text(W - PAD - iw / 2, hy - 25 + is * 0.36, info, is, NAVY, { anchor: "middle", spacing: 2 });
  }
  body += fitLine(env, PAD - 3, hy + 120, up(`${input.first} ${input.last}`), 128, W2, "#ffffff", { spacing: 2, min: 54 }).svg;
  const ty = hy + 146;
  const th = 98;
  const gap = 106;
  const tw = (W2 - gap) / 2;
  body += tile(env, PAD, ty, tw, th, input.from.name, input.from.logoDark, "rgba(255,255,255,0.08)")
    + chevrons(PAD + tw + 18, ty + th / 2, GOLD, 3, 0.9, 26);
  const dx = PAD + tw + gap;
  body += `<rect x="${dx}" y="${ty}" width="${tw}" height="${th}" rx="16" fill="none" stroke="${GOLD}" stroke-width="4" stroke-dasharray="16 11"/>`
    + tbd(env, dx, ty, tw, th);
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? "SWIPE FOR HIS FILE" : input.address, more: total > 1 });
  return svgDoc(env, portalDefs(lit), body, VOID);
}

// ── Projected: Portal Watch ──
// A player expected to enter the portal but not in it yet (Portal News
// "projected" entries — utils/portalNews.js). Made to look nothing like the
// portal cover above (user, 2026-11-25): no rings, no tape, no black — a
// violet radar with his school's color glowing at its center, his school's
// logo up top, and a light panel under the line: PORTAL WATCH, his name,
// his school's card, then a dashed "THE PORTAL?" slot.
const WATCH = { bg: "#150c33", deep: "#0a0620", violet: "#7c5cd6", lilac: "#c4b5fd", panel: "#f5f2ff", ink: "#1a1036", soft: "#6d5fa3" };
const RADAR = { x: CX, y: 440 };
function radar(accent) {
  const { x, y } = RADAR;
  let svg = `<circle cx="${x}" cy="${y}" r="560" fill="url(#watchGlow)"/>`;
  // The sweep: a wedge fading back from its leading edge.
  const a0 = (-112 * Math.PI) / 180;
  const a1 = (-58 * Math.PI) / 180;
  const R = 700;
  svg += `<path d="M ${x} ${y} L ${r1(x + R * Math.cos(a0))} ${r1(y + R * Math.sin(a0))} A ${R} ${R} 0 0 1 ${r1(x + R * Math.cos(a1))} ${r1(y + R * Math.sin(a1))} Z" fill="url(#sweep)"/>`
    + `<line x1="${x}" y1="${y}" x2="${r1(x + R * Math.cos(a1))}" y2="${r1(y + R * Math.sin(a1))}" stroke="${WATCH.lilac}" stroke-width="4" stroke-opacity="0.85"/>`;
  [120, 230, 340, 450, 560].forEach((r, i) => {
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${WATCH.lilac}" stroke-width="${i === 4 ? 3 : 2}" stroke-opacity="${r1(0.55 - i * 0.07)}"/>`;
  });
  // Crosshairs, and the degree ticks round the outer ring.
  svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${WATCH.lilac}" stroke-opacity="0.22" stroke-width="2" stroke-dasharray="8 12"/>`
    + `<line x1="${x}" y1="0" x2="${x}" y2="${SPLIT}" stroke="${WATCH.lilac}" stroke-opacity="0.22" stroke-width="2" stroke-dasharray="8 12"/>`;
  for (let d = 0; d < 360; d += 10) {
    const t = (d * Math.PI) / 180;
    const long = d % 30 === 0;
    const r0 = 560 - (long ? 26 : 14);
    svg += `<line x1="${r1(x + r0 * Math.cos(t))}" y1="${r1(y + r0 * Math.sin(t))}" x2="${r1(x + 560 * Math.cos(t))}" y2="${r1(y + 560 * Math.sin(t))}" stroke="${WATCH.lilac}" stroke-opacity="${long ? 0.6 : 0.35}" stroke-width="${long ? 3 : 2}"/>`;
  }
  // Blips: the other names on the watch list, in his school's color.
  [[-0.42, -0.62, 11], [0.58, -0.3, 8], [-0.7, 0.18, 7], [0.36, 0.52, 9]].forEach(([dx, dy, s]) => {
    const bx = r1(x + dx * 560);
    const by = r1(y + dy * 560);
    svg += `<circle cx="${bx}" cy="${by}" r="${s * 2.6}" fill="${accent}" fill-opacity="0.25"/><circle cx="${bx}" cy="${by}" r="${s}" fill="${accent}"/>`;
  });
  return svg;
}
const watchDefs = (accent) => `<radialGradient id="watchGlow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${accent}" stop-opacity="0.75"/><stop offset="0.45" stop-color="${accent}" stop-opacity="0.28"/><stop offset="1" stop-color="${WATCH.bg}" stop-opacity="0"/></radialGradient>`
  + `<linearGradient id="sweep" x1="1" y1="0" x2="0" y2="0.4"><stop offset="0" stop-color="${WATCH.lilac}" stop-opacity="0.5"/><stop offset="1" stop-color="${WATCH.lilac}" stop-opacity="0"/></linearGradient>`
  + `<linearGradient id="watchBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WATCH.deep}"/><stop offset="1" stop-color="${WATCH.bg}"/></linearGradient>`
  + shadow;
// A light card: his school's logo and its name.
function lightTile(env, x, y, w, h, name, logo) {
  const lg = hasImage(env, logo) ? h - 24 : 0;
  const tx = x + 18 + (lg ? lg + 14 : 0);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#ffffff" stroke="${WATCH.violet}" stroke-opacity="0.35" stroke-width="3"/>`
    + image(env, logo, x + 12, y + 12, lg, lg)
    + fitLine(env, tx, y + h / 2 + 21, up(name), 60, x + w - 16 - tx, WATCH.ink, { spacing: 1, min: 22 }).svg;
}
function projectedCover(env, input, total) {
  const school = input.from.color && input.from.color !== "#000000" ? input.from.color : BLUE;
  const accent = readableOn(school, WATCH.bg, 1.8) === school ? school : shade(school, 2.2);
  const W2 = W - PAD * 2;
  const hasShot = hasImage(env, input.photo);
  let body = `<rect width="${W}" height="${SPLIT}" fill="url(#watchBg)"/>` + radar(accent);
  // Up top: just his school's logo (user, 2026-11-25: no PORTAL WATCH tag).
  if (hasImage(env, input.from.logoDark)) body += image(env, input.from.logoDark, W - PAD - 110, 40, 110, 94);
  // Him (no photo: his school's logo at the radar's center).
  body += hasShot ? playerShot(env, input) : image(env, input.from.logoDark, RADAR.x - 200, RADAR.y - 200, 400, 400);
  // The line, then the light panel: PORTAL WATCH, his name, his school → the portal?
  body += splitPanel(WATCH.panel, WATCH.violet);
  const words = up((input.headline || "PORTAL WATCH").trim()).split(/\s+/);
  const big = words.pop();
  const small = words.join(" ");
  const hs = fitSize(env, small ? `${small} ${big}` : big, 82, W2 * 0.66, 40, 3);
  const hy = SPLIT + 92;
  body += `<text x="${PAD}" y="${hy}" font-family="${IG_FONT}" font-size="${hs}" letter-spacing="3" fill="${WATCH.violet}">${small ? `<tspan fill="${WATCH.ink}">${esc(small)} </tspan>` : ""}${esc(big)}</text>`;
  const info = up([input.pos, input.note].filter(Boolean).join(DOT));
  if (info) {
    const is = fitSize(env, info, 40, W2 * 0.3, 22, 2);
    const iw = widthOf(env, info, is, 2) + 32;
    body += `<rect x="${r1(W - PAD - iw)}" y="${hy - 52}" width="${r1(iw)}" height="54" rx="27" fill="${WATCH.ink}"/>`
      + text(W - PAD - iw / 2, hy - 25 + is * 0.36, info, is, "#ffffff", { anchor: "middle", spacing: 2 });
  }
  body += fitLine(env, PAD - 3, hy + 120, up(`${input.first} ${input.last}`), 128, W2, WATCH.ink, { spacing: 2, min: 54 }).svg;
  const ty = hy + 146;
  const th = 98;
  const gap = 106;
  const tw = (W2 - gap) / 2;
  body += lightTile(env, PAD, ty, tw, th, input.from.name, input.from.logo || input.from.logoDark)
    + chevrons(PAD + tw + 18, ty + th / 2, WATCH.violet, 3, 0.9, 26);
  const dx = PAD + tw + gap;
  const slot = "THE PORTAL?";
  const ss = fitSize(env, slot, th * 0.5, tw - 40, 24, 2);
  body += `<rect x="${dx}" y="${ty}" width="${tw}" height="${th}" rx="16" fill="${WATCH.violet}" fill-opacity="0.08" stroke="${WATCH.violet}" stroke-width="4" stroke-dasharray="16 11"/>`
    + text(dx + tw / 2, ty + th / 2 + ss * 0.35, slot, ss, WATCH.violet, { anchor: "middle", spacing: 2 });
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? "SWIPE FOR HIS FILE" : input.address, more: total > 1 });
  return svgDoc(env, watchDefs(accent), body, WATCH.bg);
}

// ── His season (both posts' second slides, first thing under the header) ──
const STATS_H = 200;
function statsBand(env, input, y, c) {
  const list = input.stats || [];
  if (!list.length) return { svg: "", h: 0 };
  const x0 = 46;
  const cw = W - x0 * 2;
  const head = 54;
  const cell = cw / list.length;
  let svg = `<rect x="${x0}" y="${y}" width="${cw}" height="${STATS_H}" rx="16" fill="${c.panel}" stroke="${c.edge}" stroke-opacity="0.25" stroke-width="2"/>`
    + `<path d="M ${x0} ${y + head} V ${y + 16} a 16 16 0 0 1 16 -16 H ${x0 + cw - 16} a 16 16 0 0 1 16 16 V ${y + head} Z" fill="${c.accent}" fill-opacity="0.16"/>`
    + fitLine(env, x0 + 24, y + 38, input.statsTitle || "THIS SEASON", 32, cw - 48, c.accent, { spacing: 3 }).svg;
  list.forEach((s, i) => {
    const cx = x0 + cell * i + cell / 2;
    if (i) svg += `<rect x="${r1(x0 + cell * i)}" y="${y + head + 22}" width="2" height="${STATS_H - head - 44}" fill="${c.edge}" fill-opacity="0.18"/>`;
    svg += fitLine(env, cx, y + head + 88, s.value, 90, cell - 26, c.ink, { anchor: "middle", spacing: 1 }).svg
      + fitLine(env, cx, y + head + 128, s.label, 28, cell - 20, c.soft, { anchor: "middle", spacing: 2 }).svg;
  });
  return { svg, h: STATS_H };
}

// ── A report's panels (both posts' second slides) ──
const TILE_H = 176;
const MEAS_H = 94;
const MEAS_PER = 4;
const MEAS_MAX = 8;
// Only what his public page shows: the community grade, class ranks, traits, measurements.
// His season leads (statsBand) when there is one: then fewer traits and one
// row of measurements, so it all fits — and it's all centered together.
function reportPanels(env, input, top, c) {
  const lead = statsBand(env, input, top, c);
  const tight = !!lead.h;
  const traitsMax = tight ? 3 : 5;
  const measMax = tight ? MEAS_PER : MEAS_MAX;
  const r = input.report;
  const x0 = 46;
  const cw = W - x0 * 2;
  const gap = 16;
  let y = top + (lead.h ? lead.h + 16 : 0);
  let out = lead.svg;
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
  const strengths = (r?.strengths || []).slice(0, traitsMax);
  const weaknesses = (r?.weaknesses || []).slice(0, traitsMax);
  const rows = Math.max(strengths.length, weaknesses.length);
  if (rows) {
    // The traits take the room the other panels leave.
    const measRows = Math.ceil(Math.min(measMax, (input.measurements || []).length) / MEAS_PER);
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
  const maxRows = Math.max(0, Math.min(measMax / MEAS_PER, Math.floor((room + gap) / (th + gap))));
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
  const c = { panel: "rgba(255,255,255,0.07)", edge: "#ffffff", ink: "#ffffff", soft: "#a9b6ca", accent: GOLD };
  body += reportPanels(env, input, 402, c);
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

// Mock 1: the classic. The old school's wedge, chevrons driving to the new
// logo, him in front; under the line, TRANSFER on a slanted banner, his name.
function classicCover(env, input, total) {
  const c = newColors(input);
  const W2 = W - PAD * 2;
  const hasShot = hasImage(env, input.photo);
  let body = `<rect width="${W}" height="${H}" fill="url(#wash)"/>`
    // Diagonal pinstripes: the page moving the way he is.
    + Array.from({ length: 10 }, (_, k) => `<rect x="${k * 170 - 60}" y="-120" width="34" height="1800" fill="${c.ink}" fill-opacity="0.04" transform="skewX(-28)"/>`).join("")
    + oldWedge(env, input, c)
    // The drive: chevrons from the wedge to the new logo.
    + chevrons(WEDGE.top - 50, 165, c.pop, 3, 1.5, 36)
    + image(env, input.to.logoDark, W - PAD - 300 + 20, 16, 300, 300);
  const word = up(input.kicker || "TRANSFER");
  // Him. No photo: the logos are already up top, so the word takes his place.
  body += hasShot ? playerShot(env, input) : fitLine(env, CX, 640, word, 300, W - 80, c.ink, { anchor: "middle", spacing: 6 }).svg;
  // The hard line, then the news on a slanted banner, then who.
  body += splitPanel(c.deep, c.pop);
  const ws = fitSize(env, word, 56, W2 - 60, 28, 5);
  const ww = widthOf(env, word, ws, 5) + 60;
  const by = SPLIT + 36;
  const bh = 66;
  if (hasShot) {
    body += `<g transform="skewX(-12)"><rect x="${r1(PAD + (by + bh) * 0.2126)}" y="${by}" width="${r1(ww)}" height="${bh}" fill="${c.pop}"/></g>`
      + text(PAD + 30, by + bh / 2 + ws * 0.35, word, ws, textOn(c.pop, c.deep), { spacing: 5 });
  }
  const info = up([input.pos, input.note].filter(Boolean).join(DOT));
  body += fitLine(env, PAD - 3, 1116, up(`${input.first} ${input.last}`), 170, W2, "#ffffff", { spacing: 2, min: 70 }).svg
    + fitLine(env, PAD, 1182, info, 44, W2, "#ffffff", { spacing: 2, opacity: 0.92 }).svg;
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? `SWIPE: WHAT ${up(input.to.name)} GETS` : input.address, more: total > 1 });
  return svgDoc(env, transferDefs(c), body, c.bg);
}

// Mock 2: welcome. Made for the new school's fans to share.
const RAY_C = { x: CX, y: 470 };
const welcomeDefs = (c) => transferDefs(c)
  + `<radialGradient id="wLight" gradientUnits="userSpaceOnUse" cx="${CX}" cy="430" r="760"><stop offset="0" stop-color="${shade(c.bg, 1.55)}"/><stop offset="0.42" stop-color="${c.bg}"/><stop offset="1" stop-color="${shade(c.bg, 0.38)}"/></radialGradient>`
  + `<radialGradient id="wGlow" gradientUnits="userSpaceOnUse" cx="${CX}" cy="430" r="420"><stop offset="0" stop-color="${c.second}" stop-opacity="0.5"/><stop offset="1" stop-color="${c.second}" stop-opacity="0"/></radialGradient>`
  + `<linearGradient id="wPanel" gradientUnits="userSpaceOnUse" x1="0" y1="${SPLIT}" x2="0" y2="${H}"><stop offset="0" stop-color="${shade(c.bg, 0.42)}"/><stop offset="1" stop-color="${shade(c.bg, 0.14)}"/></linearGradient>`
  + `<linearGradient id="wRule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c.pop}"/><stop offset="1" stop-color="${c.pop}" stop-opacity="0"/></linearGradient>`;

// Light rays out from behind him.
function rays(n = 18) {
  const R = 1400;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + Math.PI / n;
    d += `M ${RAY_C.x} ${RAY_C.y} L ${r1(RAY_C.x + Math.cos(a0) * R)} ${r1(RAY_C.y + Math.sin(a0) * R)} L ${r1(RAY_C.x + Math.cos(a1) * R)} ${r1(RAY_C.y + Math.sin(a1) * R)} Z `;
  }
  return `<path d="${d}" fill="#ffffff" fill-opacity="0.06"/>`;
}
// The mascot's name, giant, in rows across the back: outlined, solid, outlined.
function wordRows(env, word, c) {
  const size = 236;
  const sp = 6;
  if (!word) return "";
  const w = widthOf(env, word, size, sp) + 70;
  const rows = [
    { y: 250, off: 0.62, style: `fill="none" stroke="${c.second}" stroke-width="3" stroke-opacity="0.55"` },
    { y: 500, off: 0.18, style: `fill="${c.second}" fill-opacity="0.9"` },
    { y: 750, off: 0.45, style: `fill="none" stroke="#ffffff" stroke-width="3" stroke-opacity="0.32"` },
  ];
  let out = "";
  rows.forEach((r) => {
    for (let x = -260 - r.off * w; x < W + 260; x += w) {
      out += `<text x="${r1(x)}" y="${r.y}" font-family="${IG_FONT}" font-size="${size}" letter-spacing="${sp}" ${r.style}>${esc(word)}</text>`;
    }
  });
  return `<g transform="rotate(-7 ${CX} 480)">${out}</g>`;
}
function confetti(input, c) {
  const rand = seeded(`${input.first} ${input.last} ${input.to.name}`);
  const fills = [c.second, "#ffffff", shade(c.bg, 1.9), c.second];
  let out = "";
  for (let i = 0; i < 44; i++) {
    const x = rand() * W;
    const y = 30 + rand() * (SPLIT - 220);
    const w = 10 + rand() * 16;
    const h = 5 + rand() * 6;
    out += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="1.5" fill="${fills[i % fills.length]}" opacity="${r1(0.5 + rand() * 0.45)}" transform="rotate(${Math.round(rand() * 180)} ${r1(x + w / 2)} ${r1(y + h / 2)})"/>`;
  }
  return out;
}

function welcomeCover(env, input, total) {
  const c = newColors(input);
  const W2 = W - PAD * 2;
  const hasShot = hasImage(env, input.photo);
  const word = up(input.to.mascot || input.to.name);
  // ── The top: their colors lit from behind him ──
  let body = `<rect width="${W}" height="${SPLIT}" fill="url(#wLight)"/>`
    + rays()
    + `<circle cx="${CX}" cy="430" r="420" fill="url(#wGlow)"/>`
    + wordRows(env, word, c)
    + confetti(input, c);
  // Top left: COMMITTED on a slanted tag. Top right: the WD badge. (Behind
  // him, like everything up here: nothing is drawn over him.)
  const tag = up(input.kicker || "COMMITTED");
  const ts = 54;
  const tw = widthOf(env, tag, ts, 4) + 56;
  const ty = 52;
  const th = 76;
  body += `<g transform="skewX(-12)"><rect x="${r1(PAD - 22 + (ty + th) * 0.2126)}" y="${ty}" width="${r1(tw)}" height="${th}" fill="${c.pop}"/>`
    + `<rect x="${r1(PAD - 40 + (ty + th) * 0.2126)}" y="${ty}" width="10" height="${th}" fill="#ffffff"/></g>`
    + text(PAD + 6, ty + th / 2 + ts * 0.35, tag, ts, textOn(c.pop, c.deep), { spacing: 4 });
  body += badgeMark(env, input.badgeLogo, W - PAD + 10, ty + th / 2 - 4, 104).svg;
  // Him (no photo: their logo, big, in his place).
  body += hasShot ? playerShot(env, input) : image(env, input.to.logoDark, CX - 260, 160, 520, 520);

  // ── The line, then: him beside their logo, and the move — old school → new ──
  const stripes = Array.from({ length: 14 }, (_, k) => `<rect x="${k * 130 - 200}" y="${SPLIT}" width="54" height="${H - SPLIT}" fill="${c.bg}" fill-opacity="0.16" transform="skewX(-24)"/>`).join("");
  body += splitPanel("url(#wPanel)", c.pop, `<g clip-path="url(#wClip)">${stripes}</g>`);
  const LOGO = 214;
  const hasLogo = hasImage(env, input.to.logoDark);
  const nameX = hasLogo ? PAD + LOGO + 26 : PAD;
  const nameW = W - PAD - nameX;
  if (hasLogo) body += image(env, input.to.logoDark, PAD - 4, SPLIT + 34, LOGO, LOGO);
  body += fitLine(env, nameX, SPLIT + 104, up(input.first), 72, nameW, "#ffffff", { spacing: 3, opacity: 0.86, min: 30 }).svg;
  const last = up(input.last);
  body += text(nameX - 3, SPLIT + 246, last, fitSize(env, last, 160, nameW, 60, 2), "#ffffff", { spacing: 2 });
  // The move: his position, then the old school, an arrow, the new school.
  const ry = SPLIT + 356;
  body += `<rect x="${PAD}" y="${ry - 58}" width="${W2}" height="3" fill="url(#wRule)" fill-opacity="0.7"/>`;
  let x = PAD;
  const pos = up(input.pos);
  if (pos) {
    const pw = widthOf(env, pos, 40, 2) + 30;
    body += `<rect x="${x}" y="${ry - 39}" width="${r1(pw)}" height="50" rx="8" fill="${c.pop}"/>`
      + text(x + 15, ry, pos, 40, textOn(c.pop, c.deep), { spacing: 2 });
    x += pw + 24;
  }
  const ARROW = 128;
  const school = (sc, op) => {
    const lg = hasImage(env, sc.logoDark) ? 64 : 0;
    return { sc, op, lg, name: up(sc.name) };
  };
  const sides = [school(input.from, 0.72), school(input.to, 1)].filter((t) => t.name);
  const room = (W - PAD - x - (sides.length > 1 ? ARROW : 0) - sides.reduce((n, t) => n + t.lg, 0)) / Math.max(1, sides.length);
  sides.forEach((t, i) => {
    if (i) {
      // A bold arrow, driving toward the new school, speed lines behind it.
      const cy = ry - 14;
      const ax = x + 8;
      body += [0, 1, 2].map((k) => `<rect x="${r1(ax + k * 10)}" y="${r1(cy - 13 + k * 13)}" width="${22 - k * 4}" height="4" rx="2" fill="${c.pop}" fill-opacity="${0.35 + k * 0.15}"/>`).join("")
        + `<path d="M ${ax + 34} ${cy - 8} H ${ax + 78} V ${cy - 22} L ${ax + 112} ${cy} L ${ax + 78} ${cy + 22} V ${cy + 8} H ${ax + 34} Z" fill="${c.pop}"/>`;
      x += ARROW;
    }
    if (t.lg) {
      body += image(env, t.sc.logoDark, x, ry - 44, 54, 54, "xMidYMid meet", t.op < 1 ? 0.85 : 1);
      x += t.lg;
    }
    const f = fitLine(env, x, ry, t.name, 42, room, "#ffffff", { spacing: 2, min: 20, opacity: t.op });
    body += f.svg;
    x += Math.min(room, widthOf(env, t.name, f.size, 2)) + 10;
  });
  body += footer(env, themeOf("dark"), { logo: input.brandLogo, cta: total > 1 ? `SWIPE: WHAT ${up(input.to.name)} GETS` : input.address, more: total > 1 });
  const defs = welcomeDefs(c) + `<clipPath id="wClip"><rect y="${SPLIT}" width="${W}" height="${BOTTOM - SPLIT}"/></clipPath>`;
  return svgDoc(env, defs, body, c.deep);
}

const transferCover = (env, input, total) => (input.design === "classic" ? classicCover : welcomeCover)(env, input, total);

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
  const pc = { panel: "rgba(255,255,255,0.08)", edge: "#ffffff", ink: "#ffffff", soft: "#c9d2e0", accent: readableOn(c.pop, c.deep, 2.2) === c.pop ? c.pop : GOLD };
  body += reportPanels(env, input, header + 32, pc);
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
//             TO BE DETERMINED slot.
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
    + tbd(env, dx, ty, tw, th);
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
  const out = [{ name: "portal", svg: (input.projected ? projectedCover : portalCover)(env, input, total) }];
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
  return [...new Set([input.brandLogo, input.photo, input.from.logoDark, input.projected ? input.from.logo : "", input.kind === "transfer" ? input.to.logoDark : "", input.badgeLogo].filter(Boolean))];
}
