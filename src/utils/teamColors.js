// src/utils/teamColors.js
//
// Legible team branding. Team colors are admin-entered, and a team's
// secondary color isn't always readable on its primary — the Jets' black on
// green, the Giants' red on blue. So text on a team's primary color is
// white (textOn), except on a primary too light for it (the Steelers' gold),
// where it's the team's secondary if that reads, else near-black.
// readableOn is for a brand color as text on anything else: kept when it has
// enough contrast, otherwise swapped for white / near-black. Contrast is WCAG 2's
// ratio; MIN_CONTRAST is its large/bold-text bar, which is what team-color
// text on this site always is (heavy uppercase labels).
export const MIN_CONTRAST = 3;

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio of two #rrggbb colors (1–21), or null if either isn't one.
export function contrastRatio(a, b) {
  const ra = hexRgb(a);
  const rb = hexRgb(b);
  if (!ra || !rb) return null;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// True when `fg` is legible on `bg` (unknown colors count as legible, so
// nothing changes for a value we can't measure).
export function isReadable(fg, bg, min = MIN_CONTRAST) {
  const ratio = contrastRatio(fg, bg);
  return ratio == null || ratio >= min;
}

// `fg` if it's legible on `bg`, else white — or near-black only when even
// white can't be read there (a light background). White first: it's how
// team-colored bars read everywhere else on the site.
export function readableOn(fg, bg, min = MIN_CONTRAST) {
  if (isReadable(fg, bg, min)) return fg;
  return isReadable("#ffffff", bg, min) ? "#ffffff" : "#111111";
}

// Text color on a team's primary `bg`: white, unless `bg` is too light for
// white — then `alt` (the team's secondary) if it reads there, else
// near-black.
export function textOn(bg, alt) {
  if (isReadable("#ffffff", bg)) return "#ffffff";
  return alt && isReadable(alt, bg) ? alt : "#111111";
}
