// src/utils/instagram/firstPick.js
//
// First Pick: the graphic for a team's first pick in the Weekly Mock (team
// mock pages only, /mocks/{team}). The Player Spotlight cover's size
// (1080×1350), drawn the same way — plain data in, SVG out (posts.js kit) —
// but split in two: the top is the team's, his action shot standing on the
// line where it ends; the whole bottom is the pick — the number on the
// team's color, his name, then school, position, height and weight.
//
// The photo sits in one fixed box (PHOTO_BOX) on every team's graphic, kept
// whole and standing on the box's foot ("xMidYMax meet"), then moved and
// sized by the action shot's own saved placement — playerPhotos action[i]
// .firstPick: { x, y, scale, rotate } (posts.js placed: pixels on the graphic,
// scale about his feet; rotate in degrees about his box's middle) — set in Admin → Content → Photos on the Jets
// template. Nothing about the team moves the photo, so a shot placed once
// slides into all 32. The shot is drawn as loadFeatureImage(url, true)
// makes it (backdrop out, trimmed to him): the placement is saved against
// that, so the graphic has to be drawn from it too.
import { kit } from "./posts.js";
import { heightText } from "./spotlight.js";
import { textOn, readableOn, contrastRatio } from "../teamColors.js";

const { GOLD, NAVY, PAD, hex, up, r1, fitSize, text, fitLine, image, hasImage, placed, svgDoc } = kit;
const W = 1080;
const H = 1350;
// Where the photo ends and the pick begins.
export const FIRST_PICK_SPLIT = 860;
// The photo's box: he stands on the split.
export const FIRST_PICK_PHOTO = { x: 40, y: 40, w: W - 80, h: FIRST_PICK_SPLIT - 40 };
// The team the placement is set on in the admin.
export const FIRST_PICK_BASE_TEAM = "NYJ";
// The fade into the panel: this far above the split, and below it.
const FADE_ABOVE = 220;
const FADE_BELOW = 0;
// The fade's rect runs this far past the split: the top's clip cuts there,
// and a fade that ended on the clip's edge too left that edge's pixel row
// part photo when the graphic's drawn small (a thin line of him on the page).
const FADE_PAST = 40;
// Where the fade turns solid: this far above the split, so nothing of the
// photo shows in the last stretch above the panel (no strip of him, no band).
const FADE_SOLID = 12;
// The team's wordmark behind him across the top, edge to edge (a touch
// past both) whatever its shape — every team's is different — just under the
// top edge. Drawn trimmed to its ink (FirstPickSetup loads it that way), so
// a wordmark's empty margins don't keep it off the edges. maxH: the tallest
// the logo gets, used when a team has no wordmark.
const MARK = { w: W + 40, y: 40, maxH: 460 };
// The team's alternate logo, oversized and faint, behind him, its top
// right on the wordmark's foot (both drawn trimmed to their ink, so they
// meet): the box it's fitted in, the gap, and how strong it is at most.
const BIG_LOGO = { s: 1300, gap: 0, opacity: 0.22 };
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;

// A team color white text can't be read on (the Steelers' gold).
const lightColor = (c) => !!hex(c) && (contrastRatio("#ffffff", hex(c)) ?? 21) < 3;

// A saved placement → { x, y, scale, rotate (degrees, + clockwise) } (missing parts as laid out).
export const FIRST_PICK_ROTATE = 45;
export const firstPickAdjust = (fp) => ({
  x: Number(fp?.x) || 0, y: Number(fp?.y) || 0, scale: Number(fp?.scale) || 1,
  rotate: Math.max(-FIRST_PICK_ROTATE, Math.min(FIRST_PICK_ROTATE, Number(fp?.rotate) || 0)),
});

// The input. player: the players doc (or the pick's player: First, Last,
// Position, School, Height, Weight); school: its schools doc; team: the
// nfl doc (Color1, Color2, Logo1, LogoDark, City, Team); abbr: "NYJ";
// pick: { overall, round }; year: the class; photo: an action shot
// ({ url, firstPick }); brandLogo: We-Draft's logo; address: the line
// bottom right.
export function firstPickInput({ player, school = {}, team = {}, abbr = "", pick = {}, year = "", photo = null, brandLogo = "", address = "" }) {
  return {
    first: player?.First || "", last: player?.Last || "", pos: player?.Position || "", school: player?.School || "",
    height: heightText(player?.Height), weight: player?.Weight ? String(player.Weight) : "",
    collegeLogo: school.LogoDark || school.Logo1 || "",
    color: hex(team.Color1) || NAVY, color2: hex(team.Color2) || GOLD,
    teamLogo: team.LogoDark || team.Logo1 || "",
    // The big logo behind him: the team's alternate logo (nfl LogoAlt), else its own.
    bgLogo: team.LogoAlt || team.LogoDark || team.Logo1 || "",
    // On the team's color, the dark-background wordmark — unless the color is
    // too light for white to read on it (the Steelers' gold): then the
    // light-background one (their black wordmark).
    wordmark: (lightColor(team.Color1) ? team.Wordmark || team.WordmarkDark : team.WordmarkDark || team.Wordmark) || "",
    teamName: up([team.City, team.Team].filter(Boolean).join(" ") || abbr),
    city: up(team.City || ""), nick: up(team.Team || abbr),
    overall: pick.overall ?? "", round: pick.round ?? 1, year: String(year || player?.Eligible || ""),
    photo: photo?.url || "", adjust: firstPickAdjust(photo?.firstPick),
    brandLogo, address: address || (abbr ? `WE-DRAFT.COM/MOCKS/${abbr.toLowerCase()}` : "WE-DRAFT.COM"),
  };
}

export function firstPickImageUrls(input) {
  return [...new Set([input.photo, input.wordmark, input.teamLogo, input.bgLogo, input.collegeLogo, input.brandLogo].filter(Boolean))];
}

export function firstPickSvg(input, env) {
  const c1 = hex(input.color) || NAVY;
  const c2 = hex(input.color2) || GOLD;
  const split = FIRST_PICK_SPLIT;
  // The bottom: the team's color nearly black, so the white reads on every team's.
  const deep = shade(c1, 0.2);
  // The accent where it's a line or a number on the dark: itself if it shows, else white.
  const hi = readableOn(c2, deep, 2.2);
  // The wordmark (else the logo), as wide as the graphic, as tall as its shape makes it.
  const mark = [input.wordmark, input.teamLogo].find((u) => hasImage(env, u)) || "";
  const mi = mark ? env.images[mark] : null;
  const tall = mi?.w && mi?.h ? (MARK.w * mi.h) / mi.w : MARK.maxH;
  const mh = mark === input.wordmark ? tall : Math.min(MARK.maxH, tall);
  const fadeTo = r1(MARK.y + mh + 60);
  // The big logo as drawn (fitted in its box, its own shape), its top just under the wordmark.
  const li = env.images?.[input.bgLogo];
  const bigOn = hasImage(env, input.bgLogo) && mark !== input.teamLogo;
  const bw = li?.w && li?.h ? Math.min(BIG_LOGO.s, (BIG_LOGO.s * li.w) / li.h) : BIG_LOGO.s;
  const bh = li?.w && li?.h ? Math.min(BIG_LOGO.s, (BIG_LOGO.s * li.h) / li.w) : BIG_LOGO.s;
  const bigTop = MARK.y + (mark ? mh : 0) + BIG_LOGO.gap;
  // Full strength through its top part, gone by the panel.
  const bigFade = r1(Math.min(0.85, Math.max(0.3, (bigTop + 180) / split)));
  const defs = `<linearGradient id="fpBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c1, 1.1)}"/><stop offset="0.6" stop-color="${shade(c1, 0.7)}"/><stop offset="1" stop-color="${shade(c1, 0.38)}"/></linearGradient>`
    + '<radialGradient id="fpSpot" cx="0.5" cy="0.45" r="0.55"><stop offset="0" stop-color="#ffffff" stop-opacity="0.3"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0.06"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="fpVig" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/></radialGradient>'
    // The fade from the photo into the panel: no line where one ends.
    + `<linearGradient id="fpFoot" gradientUnits="userSpaceOnUse" x1="0" y1="${split - FADE_ABOVE}" x2="0" y2="${split - FADE_SOLID}"><stop offset="0" stop-color="${deep}" stop-opacity="0"/><stop offset="0.4" stop-color="${deep}" stop-opacity="0.25"/><stop offset="0.8" stop-color="${deep}" stop-opacity="0.8"/><stop offset="1" stop-color="${deep}" stop-opacity="1"/></linearGradient>`
    + `<linearGradient id="fpPanel" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}"><stop offset="0" stop-color="${deep}"/><stop offset="${r1(FIRST_PICK_SPLIT / H + 0.03)}" stop-color="${deep}"/><stop offset="1" stop-color="${shade(c1, 0.1)}"/></linearGradient>`
    + '<filter id="fpShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.5"/></filter>'
    // The wordmark's fade: strongest at the top, gone by his chest.
    + `<linearGradient id="fpMarkGrad" gradientUnits="userSpaceOnUse" x1="0" y1="${MARK.y}" x2="0" y2="${fadeTo}"><stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`
    + `<mask id="fpMarkFade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${fadeTo}"><rect width="${W}" height="${fadeTo}" fill="url(#fpMarkGrad)"/></mask>`
    // The big logo's fade: full down to his waist, gone by the panel.
    + `<linearGradient id="fpBigGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${split}"><stop offset="${bigFade}" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`
    + `<mask id="fpBigFade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${split}"><rect width="${W}" height="${split}" fill="url(#fpBigGrad)"/></mask>`;

  // ── The top: the team's ──
  // Kept clean: the team's color, a soft light behind him, the corners
  // darker, and the team's wordmark big across the top, behind him, fading
  // into the background. He's the picture.
  // The panel's color under everything; the top's drawn over it and fades into it.
  let body = `<rect width="${W}" height="${H}" fill="url(#fpPanel)"/>`
    // (Not clipped at the split: a clip there left its edge row part photo
    // when drawn small. The panel is drawn over it instead, below.)
    + `<g><rect width="${W}" height="${split}" fill="url(#fpBase)"/>`
    + `<rect width="${W}" height="${split}" fill="url(#fpSpot)"/>`
    + `<rect width="${W}" height="${split}" fill="url(#fpVig)"/>`
    + (bigOn ? `<g mask="url(#fpBigFade)">${image(env, input.bgLogo, (W - bw) / 2, bigTop, bw, bh, "xMidYMin meet", BIG_LOGO.opacity)}</g>` : "")
    + (mark ? `<g mask="url(#fpMarkFade)">${image(env, mark, (W - MARK.w) / 2, MARK.y, MARK.w, mh, "xMidYMin meet")}</g>` : "");
  if (hasImage(env, input.photo)) {
    const b = FIRST_PICK_PHOTO;
    // Turned about the middle of his box first (adjust.rotate, degrees), then placed.
    const rot = input.adjust?.rotate || 0;
    const shot = image(env, input.photo, b.x, b.y, b.w, b.h, "xMidYMax meet");
    const turned = rot ? `<g transform="rotate(${r1(rot)} ${r1(b.x + b.w / 2)} ${r1(b.y + b.h / 2)})">${shot}</g>` : shot;
    body += `<g filter="url(#fpShadow)">${placed(turned, b.x, b.y, b.w, b.h, input.adjust)}</g>`;
  }
  // A long fade from above the split to just under it: he sinks into the panel.
  // (Solid from FADE_SOLID above the split on, and on past the clip.)
  body += `<rect y="${split - FADE_ABOVE}" width="${W}" height="${FADE_ABOVE + FADE_BELOW + FADE_PAST}" fill="url(#fpFoot)"/></g>`
    // The panel over the bottom: covers whatever of the top runs past the split.
    + `<rect y="${split}" width="${W}" height="${H - split}" fill="url(#fpPanel)"/>`;

  // ── The bottom: the pick ──
  // The number on the team's color (its second when the first melts into the panel).
  const blockBg = (contrastRatio(c1, deep) ?? 21) < 1.5 && (contrastRatio(c2, deep) ?? 0) > 1.5 ? c2 : c1;
  const blockInk = textOn(blockBg, blockBg === c1 ? c2 : c1);
  const bx = PAD;
  const by = split + 40;
  const bs = 214;
  body += `<rect x="${bx}" y="${by}" width="${bs}" height="${bs}" rx="24" fill="${blockBg}" stroke="${hi}" stroke-width="5"/>`
    + text(bx + bs / 2, by + 52, `ROUND ${input.round || 1}`, 34, blockInk, { anchor: "middle", spacing: 2, opacity: 0.85 });
  const num = input.overall !== "" ? String(input.overall) : "";
  if (num) {
    const ns = fitSize(env, `#${num}`, 150, bs - 30, 60, 1);
    body += text(bx + bs / 2, by + bs - 30, `#${num}`, ns, blockInk, { anchor: "middle", spacing: 1 });
  }
  // His name beside it: first over last.
  const nx = bx + bs + 38;
  const nw = W - PAD - nx;
  body += fitLine(env, nx, by + 66, up(input.first), 72, nw, "#ffffff", { spacing: 3, opacity: 0.9 }).svg;
  const last = up(input.last);
  const lastS = fitSize(env, last, 150, nw, 60, 2);
  body += text(nx - 3, by + bs - 14, last, lastS, "#ffffff", { spacing: 2 });

  // The strip: school (its logo), position, height, weight.
  const stripTop = by + bs + 28;
  const stripH = 112;
  const W2 = W - PAD * 2;
  const cells = [
    { label: "SCHOOL", value: up(input.school), logo: input.collegeLogo, wide: true },
    { label: "POSITION", value: up(input.pos) },
    input.height && { label: "HEIGHT", value: input.height },
    input.weight && { label: "WEIGHT", value: `${input.weight} LBS` },
  ].filter((c) => c && c.value);
  const gap = 12;
  const units = cells.reduce((n, c) => n + (c.wide ? 1.9 : 1), 0);
  const unitW = (W2 - gap * (cells.length - 1)) / Math.max(1, units);
  let cx = PAD;
  cells.forEach((c) => {
    const cw = unitW * (c.wide ? 1.9 : 1);
    const lg = c.logo && hasImage(env, c.logo) ? 64 : 0;
    const tx = cx + 22 + (lg ? lg + 14 : 0);
    const tw = cw - 44 - (lg ? lg + 14 : 0);
    body += `<rect x="${r1(cx)}" y="${stripTop}" width="${r1(cw)}" height="${stripH}" rx="18" fill="#ffffff" fill-opacity="0.07"/>`
      + `<rect x="${r1(cx)}" y="${stripTop}" width="${r1(cw)}" height="6" rx="3" fill="${c2}"/>`
      + (lg ? image(env, c.logo, cx + 20, stripTop + (stripH - lg) / 2 + 3, lg, lg) : "")
      + text(tx, stripTop + 44, c.label, 24, "#ffffff", { spacing: 2, opacity: 0.7 })
      + fitLine(env, tx, stripTop + 94, c.value, 48, tw, "#ffffff", { spacing: 1, min: 22 }).svg;
    cx += cw + gap;
  });

  // The foot: We-Draft's logo left, the address right.
  const fy = stripTop + stripH + 26;
  const fh = H - fy - 24;
  const im = env.images?.[input.brandLogo];
  const lh = Math.min(50, fh);
  const lw = im?.w && im?.h ? (im.w / im.h) * lh : lh * 3;
  body += image(env, input.brandLogo, PAD, fy + (fh - lh) / 2, lw, lh, "xMinYMid meet")
    + fitLine(env, W - PAD, fy + fh / 2 + 12, up(input.address), 34, W2 - lw - 30, "#ffffff", { anchor: "end", spacing: 1, opacity: 0.75, min: 20 }).svg;

  return svgDoc(env, defs, body, deep);
}
