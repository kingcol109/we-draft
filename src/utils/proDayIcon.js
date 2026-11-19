// src/utils/proDayIcon.js
//
// A school's pro day badge, shaped after the NFL Scouting Combine logo: a
// low dome, a full-width band carrying "PRO DAY" (white rules above and
// below), and a deep, nearly triangular point holding the year — in the
// school's colors, with its logo standing on top in a sticker outline (white,
// or the team color for a dark logo). Pure: it returns an SVG string. Made in
// Admin → Branding → Pro Day (components/AdminProDayIcons.jsx), shown on
// /calendar.
//
// proDayIconSvg({ logo: { href, w?, h? } | null, color1, color2, year,
//                 fontCss, id, swap, logoX, logoY, logoScale, darkLogo })
//   fontCss:   the @font-face rule for Bebas Neue (SocialMakerKit loadFont) —
//              "" when the page already has the font (an inline preview).
//   id:        makes the filter id unique when several sit on one page.
//   swap:      trade the shield and band colors.
//   logoX:     moves the logo left (−) or right (+), in the badge's 1000 units.
//   logoY:     moves the logo up (−) or down (+).
//   logoScale: the logo's size, 1 = its standard box.
//   darkLogo:  a dark logo — its outline is the team color, not white.
import { textOn } from "./teamColors.js";

export const PRO_DAY_SIZE = 1000;
const FONT = "Bebas Neue";

// The school logos a badge can use (schools fields), in menu order. Dark
// ones get the team-color outline.
export const PRO_DAY_LOGO_FIELDS = [
  ["Logo1", "Primary logo"], ["Logo2", "Alternate logo"], ["LogoDark", "Dark logo"], ["LogoBlack", "Black logo"],
  ["Wordmark", "Wordmark"], ["WordmarkDark", "Dark wordmark"], ["Logo8Bit", "8-bit logo"],
];
export const isDarkLogoField = (f) => f === "LogoDark" || f === "WordmarkDark";
export const PRO_DAY_LOGO_X = [-250, 250];
export const PRO_DAY_LOGO_Y = [-150, 150];
export const PRO_DAY_LOGO_SCALE = [0.5, 1.6];

// A school with no saved choice: its dark logo when it has one, a little
// smaller and higher than the standard box. (Saved choices keep their own
// values — one saved before these sliders existed is 0 / 0 / 100%.)
export const PRO_DAY_DEFAULTS = { logoX: 0, logoY: -15, logoScale: 0.85 };
export const defaultLogoField = (team = {}) => (team.LogoDark ? "LogoDark" : PRO_DAY_LOGO_FIELDS.find(([f]) => team[f])?.[0] || "");

// The badge settings for a school: its saved choice, else the defaults.
export function proDayLook(team = {}, saved = null) {
  if (saved) {
    const logoField = saved.logoField && team[saved.logoField] ? saved.logoField : saved.logoField || defaultLogoField(team);
    return {
      logoField, logo: saved.logo || team[logoField] || "", swap: !!saved.swap,
      logoX: Number(saved.logoX) || 0, logoY: Number(saved.logoY) || 0, logoScale: Number(saved.logoScale) || 1,
    };
  }
  const logoField = defaultLogoField(team);
  return { logoField, logo: team[logoField] || "", swap: false, ...PRO_DAY_DEFAULTS };
}

// Saved choices: config/proDayIcons { schools: { [portal slug]: { logoField,
// logo (its URL when saved), swap, logoX, logoY, logoScale } } } — set in Admin,
// read by /calendar.
export const PRO_DAY_CONFIG = ["config", "proDayIcons"];

// The generic badge — NFL shield, Draft-logo navy and blue — for a day with
// more than one school's pro day.
export const GENERIC_PRO_DAY = { logo: "/logos/nfl-shield.png", color1: "#013369", color2: "#3b73b9", logoScale: 1.05 };

// The Combine logo's outline, scaled into the 1000 box: the dome (narrower
// than the band), the band at full width, then the point — straight-ish
// sides bowing out a little, like the Combine's.
const SILHOUETTE = "M87 385 L128 385 L128 325 Q500 145 872 325 L872 385 L913 385 L913 633 L742 652 Q669 791 500 862 Q331 791 258 652 L87 633 Z";
const BAND = { ruleTop: 402, top: 420, bottom: 603, ruleBottom: 620 };

const hex = (c) => {
  const s = String(c || "").trim();
  return /^#?[0-9a-f]{6}$/i.test(s) ? (s[0] === "#" ? s : `#${s}`).toLowerCase() : "";
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (n, [lo, hi], dflt) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : dflt);

// Shield + band colors: Color1 / Color2, a near-copy of the shield (or no
// second color) falls back to white for the band.
export function proDayColors(color1, color2, swap = false) {
  let shield = hex(color1) || "#0055a5";
  let band = hex(color2);
  if (!band || band === shield) band = "#ffffff";
  if (swap) [shield, band] = [band, shield];
  return { shield, band, bandInk: textOn(band, shield), shieldInk: textOn(shield, band) };
}

export function proDayIconSvg({ logo = null, color1, color2, year = "", fontCss = "", id = "pd", swap = false, logoX = 0, logoY = 0, logoScale = 1, darkLogo = false } = {}) {
  const S = PRO_DAY_SIZE;
  const { shield, band, bandInk, shieldInk } = proDayColors(color1, color2, swap);
  const outline = darkLogo ? hex(color1) || shield : "#ffffff";

  // The logo: fit to its box over the dome (down to the band, like the NFL
  // shield on the Combine logo), then the admin's size and nudge.
  let logoEl = "";
  if (logo?.href) {
    const scale = clamp(logoScale, PRO_DAY_LOGO_SCALE, 1);
    const boxW = 560 * scale, boxH = 360 * scale, cx = 500 + clamp(logoX, PRO_DAY_LOGO_X, 0), cy = 215 + clamp(logoY, PRO_DAY_LOGO_Y, 0);
    // Without its size (a plain URL on the calendar) it fills the box, fit by preserveAspectRatio.
    const sized = logo.w && logo.h;
    const k = sized ? Math.min(boxW / logo.w, boxH / logo.h) : 1;
    const w = sized ? logo.w * k : boxW, h = sized ? logo.h * k : boxH;
    logoEl = `<image href="${logo.href}" x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="xMidYMid meet" filter="url(#${id}-sticker)"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`
    + (fontCss ? `<style>${fontCss}</style>` : "")
    + `<defs>`
    // Outline + soft shadow around the logo.
    + `<filter id="${id}-sticker" x="-20%" y="-20%" width="140%" height="140%">`
    + `<feMorphology in="SourceAlpha" operator="dilate" radius="12" result="grow"/>`
    + `<feFlood flood-color="${outline}"/><feComposite in2="grow" operator="in" result="outline"/>`
    + `<feGaussianBlur in="grow" stdDeviation="9" result="blur"/><feOffset in="blur" dy="7" result="drop"/>`
    + `<feFlood flood-color="#000000" flood-opacity="0.35"/><feComposite in2="drop" operator="in" result="shadow"/>`
    + `<feMerge><feMergeNode in="shadow"/><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>`
    + `</filter>`
    + `<clipPath id="${id}-clip"><path d="${SILHOUETTE}"/></clipPath>`
    + `</defs>`
    // White sticker edge, then the shield.
    + `<path d="${SILHOUETTE}" fill="#ffffff" stroke="#ffffff" stroke-width="36" stroke-linejoin="round"/>`
    + `<path d="${SILHOUETTE}" fill="${shield}"/>`
    // Band with white rules above and below, kept inside the shield.
    + `<g clip-path="url(#${id}-clip)">`
    + `<rect x="0" y="${BAND.ruleTop}" width="${S}" height="${BAND.top - BAND.ruleTop}" fill="#ffffff"/>`
    + `<rect x="0" y="${BAND.top}" width="${S}" height="${BAND.bottom - BAND.top}" fill="${band}"/>`
    + `<rect x="0" y="${BAND.bottom}" width="${S}" height="${BAND.ruleBottom - BAND.bottom}" fill="#ffffff"/>`
    + `</g>`
    // PRO DAY
    + `<text x="500" y="583" text-anchor="middle" font-family="${FONT}" font-size="212" letter-spacing="10" fill="${bandInk}">PRO DAY</text>`
    // Year in the point
    + (year ? `<text x="500" y="776" text-anchor="middle" font-family="${FONT}" font-size="134" letter-spacing="8" fill="${shieldInk}">${esc(year)}</text>` : "")
    + logoEl
    + `</svg>`;
}
