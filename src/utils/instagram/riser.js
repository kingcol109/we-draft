// src/utils/instagram/riser.js
//
// The Draft Riser graphic (/risers/{year} — pages/Risers.jsx): one per
// riser who has an action shot placed for the First Pick graphic. The same
// size (1080×1350) and the same photo box as First Pick (firstPick.js
// FIRST_PICK_PHOTO), so a shot's saved placement (playerPhotos action[i]
// .firstPick) lands the same way here — drawn from loadFeatureImage(url,
// true), as First Pick is. The scene behind him is his label's:
//   On Fire      soft layered flames and embers
//   Trending Up  a climbing chart line over a faint grid
//   Breakout     forked white lightning on purple, storm glow, sparks
// The bottom is his: his name, big, his school's logo to its left, then
// his position and school. No rank, label or stats — the page shows those
// beside it and on the back of his card.
// Plain data in, SVG out (posts.js kit), drawn the same in the browser
// (RiserGraphic.jsx) and on the server (server/riserImage.mjs).
import { kit } from "./posts.js";
import { heightText } from "./spotlight.js";
import { FIRST_PICK_SPLIT, FIRST_PICK_PHOTO, firstPickAdjust } from "./firstPick.js";
import { RISER_TYPES } from "../risers.js";

const { PAD, up, r1, fitSize, text, fitLine, image, hasImage, placed, svgDoc } = kit;
const W = 1080;
const H = 1350;
const SPLIT = FIRST_PICK_SPLIT;
const FADE_ABOVE = 220;
const FADE_SOLID = 12;
const FADE_PAST = 40;
export const RISER_GRAPHIC_STATS = 3;

// A repeatable random for a name: the same player gets the same flames.
function seeded(str) {
  let h = 1779033703;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// The label's icon, drawn in a 100×100 box at (x, y), size s.
export function riserIconSvg(type, x, y, s, fill, accent) {
  const k = s / 100;
  const g = (inner) => `<g transform="translate(${r1(x)} ${r1(y)}) scale(${r1(k * 1000) / 1000})">${inner}</g>`;
  if (type === "onFire") {
    return g(`<path d="M50 4 C60 24 80 36 80 62 C80 82 66 96 50 96 C34 96 20 82 20 63 C20 49 28 40 35 31 C37 43 43 50 49 52 C45 38 43 21 50 4 Z" fill="${fill}"/>`
      + `<path d="M51 46 C57 58 66 64 66 76 C66 87 59 94 50 94 C41 94 34 87 34 77 C34 68 40 63 44 57 C45 64 48 68 52 69 C49 61 48 54 51 46 Z" fill="${accent}"/>`);
  }
  if (type === "breakout") {
    return g(`<path d="M60 3 L18 57 L45 57 L36 97 L82 39 L54 39 L64 3 Z" fill="${fill}" stroke="${accent}" stroke-width="4" stroke-linejoin="round"/>`);
  }
  return g(`<path d="M8 80 L36 50 L54 66 L86 30" fill="none" stroke="${fill}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M62 24 L92 22 L90 52 Z" fill="${fill}"/>`
    + `<path d="M8 94 L92 94" stroke="${accent}" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`);
}

// The input. riser: the risers doc entry ({ type, stats }); player: the
// players doc (First, Last, Position, School, Height, Weight); school: its
// schools doc; rank: his place on the board (1…); year: the class; photo:
// a placed action shot ({ url, firstPick }); brandLogo; address.
export function riserInput({ riser = {}, player = {}, school = {}, rank = 0, year = "", photo = null, brandLogo = "", address = "" }) {
  const type = RISER_TYPES[riser.type] ? riser.type : "up";
  return {
    type,
    first: player.First || riser.first || "", last: player.Last || riser.last || "",
    pos: player.Position || riser.pos || "", school: player.School || riser.school || "",
    height: heightText(player.Height), weight: player.Weight ? String(player.Weight) : "",
    stats: (riser.stats || []).filter((s) => s?.value !== "" && s?.value != null).slice(0, RISER_GRAPHIC_STATS).map((s) => ({ label: up(s.label), value: String(s.value) })),
    collegeLogo: school.LogoDark || school.Logo1 || "",
    rank, year: String(year || player.Eligible || ""),
    photo: photo?.url || "", adjust: firstPickAdjust(photo?.firstPick),
    brandLogo, address: address || `WE-DRAFT.COM/RISERS/${year}`,
  };
}

export function riserImageUrls(input) {
  return [...new Set([input.photo, input.collegeLogo, input.brandLogo].filter(Boolean))];
}

// ── The backdrops, behind him ──
// A flame: wide at its base b, tapering to a curling tip h above it.
function flame(x, b, w, h, lean) {
  return `M ${r1(x - w / 2)} ${r1(b)} C ${r1(x - w / 2)} ${r1(b - h * 0.42)}, ${r1(x - w * 0.18 + lean * 0.3)} ${r1(b - h * 0.62)}, ${r1(x + lean)} ${r1(b - h)} `
    + `C ${r1(x + w * 0.08 + lean * 0.5)} ${r1(b - h * 0.68)}, ${r1(x + w * 0.36)} ${r1(b - h * 0.5)}, ${r1(x + w / 2)} ${r1(b - h * 0.18)} `
    + `L ${r1(x + w / 2)} ${r1(b)} Z`;
}
function fireBackdrop(t, rand) {
  const b = SPLIT + 40;
  const row = (n, wMin, wVar, hMin, hVar, fill, op) => {
    let o = "";
    for (let i = 0; i < n; i++) {
      const x = -60 + (i / (n - 1)) * (W + 120) + (rand() - 0.5) * 50;
      const edge = Math.abs(x - W / 2) / (W / 2); // 0 middle → 1 sides
      const h = hMin + edge * hVar * 0.6 + rand() * hVar * 0.6; // taller at the sides — he covers the middle
      o += `<path d="${flame(x, b, wMin + rand() * wVar, h, (rand() - 0.5) * 120)}" fill="${fill}" opacity="${r1(op * (0.75 + rand() * 0.25))}"/>`;
    }
    return o;
  };
  // Each layer fades out toward its tips and the whole fire is blurred —
  // soft, glowing edges instead of hard cut-out shapes. A wide heat glow
  // sits under it all.
  let out = `<ellipse cx="${W / 2}" cy="${SPLIT}" rx="${W * 0.75}" ry="360" fill="${t.c1}" opacity="0.45" filter="url(#rsFire)"/>`
    + '<g filter="url(#rsFire)">'
    + row(9, 260, 120, 420, 420, "url(#rsF0)", 0.95)
    + row(11, 200, 100, 300, 360, "url(#rsF1)", 0.9)
    + "</g>"
    + '<g filter="url(#rsFeather)">'
    + row(11, 170, 90, 280, 340, "url(#rsF1)", 0.85)
    + row(13, 110, 70, 150, 230, "url(#rsF2)", 0.9)
    + "</g>";
  // Embers drifting up.
  for (let i = 0; i < 40; i++) {
    const x = rand() * W;
    const y = 40 + rand() * (SPLIT - 260);
    const r = 2 + rand() * 5;
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${rand() > 0.4 ? t.c2 : "#ffffff"}" opacity="${r1(0.3 + rand() * 0.6)}"/>`;
  }
  return out;
}
function upBackdrop(t, rand) {
  let out = "";
  // A faint chart grid.
  for (let y = 100; y < SPLIT; y += 100) out += `<rect x="0" y="${y}" width="${W}" height="2" fill="#ffffff" opacity="0.06"/>`;
  for (let x = 90; x < W; x += 100) out += `<rect x="${x}" y="0" width="2" height="${SPLIT}" fill="#ffffff" opacity="0.04"/>`;
  // The line, climbing left to right, and an arrowhead.
  const pts = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const x = -20 + (i / n) * (W - 90);
    const base = SPLIT - 120 - (i / n) * (SPLIT - 300);
    pts.push([x, base + (i && i < n ? (rand() - 0.3) * 90 : 0)]);
  }
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"} ${r1(x)} ${r1(y)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  const [px, py] = pts[pts.length - 2];
  const a = Math.atan2(ly - py, lx - px);
  const tip = (d, off) => [lx + Math.cos(a + off) * d, ly + Math.sin(a + off) * d];
  const [ax, ay] = tip(46, 0);
  const [bx1, by1] = tip(40, 2.4);
  const [bx2, by2] = tip(40, -2.4);
  out += `<path d="${line}" fill="none" stroke="${t.c1}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" filter="url(#rsSoft)"/>`
    + `<path d="${line}" fill="none" stroke="${t.c2}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M ${r1(ax)} ${r1(ay)} L ${r1(bx1)} ${r1(by1)} L ${r1(bx2)} ${r1(by2)} Z" fill="${t.c2}" stroke="${t.c2}" stroke-width="8" stroke-linejoin="round"/>`;
  pts.slice(1, -1).forEach(([x, y]) => { out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="10" fill="${t.deep}" stroke="${t.c2}" stroke-width="5"/>`; });
  return out;
}
function breakoutBackdrop(t, rand) {
  let out = "";
  const cx = W / 2;
  const cy = 430;
  // A jagged bolt from (x, y) heading down at angle a for len, forking as it goes.
  const bolt = (x, y, a, len, depth) => {
    const pts = [[x, y]];
    const steps = Math.max(4, Math.round(len / 55));
    let px = x;
    let py = y;
    const forks = [];
    for (let i = 1; i <= steps; i++) {
      const seg = len / steps;
      const jag = (rand() - 0.5) * 1.3;
      px += Math.cos(a + jag) * seg;
      py += Math.sin(a + jag) * seg;
      pts.push([px, py]);
      if (depth < 2 && i > 1 && i < steps - 1 && rand() < 0.3) forks.push([px, py, a + (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.5), len * (0.3 + rand() * 0.25), depth + 1]);
    }
    const d = pts.map(([bx, by], i) => `${i ? "L" : "M"} ${r1(bx)} ${r1(by)}`).join(" ");
    const w = depth ? 0.55 : 1;
    let s = `<path d="${d}" fill="none" stroke="${t.c1}" stroke-width="${r1(30 * w)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" filter="url(#rsSoft)"/>`
      + `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${r1(14 * w)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" filter="url(#rsSoft)"/>`
      + `<path d="${d}" fill="none" stroke="#f3ecff" stroke-width="${r1(8 * w)}" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${r1(4.5 * w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    forks.forEach((f) => { s += bolt(...f); });
    return s;
  };
  // Storm light: a charged glow behind him, flashes up in the clouds.
  out += `<circle cx="${cx}" cy="${cy}" r="380" fill="url(#rsCore)"/>`
    + `<ellipse cx="180" cy="40" rx="320" ry="170" fill="${t.c1}" opacity="0.28" filter="url(#rsSoft)"/>`
    + `<ellipse cx="${W - 160}" cy="60" rx="300" ry="160" fill="${t.c1}" opacity="0.24" filter="url(#rsSoft)"/>`;
  // Faint far-off bolts, then the two big strikes either side of him.
  out += `<g opacity="0.35">${bolt(330 + rand() * 80, -10, Math.PI / 2 + 0.25, 420, 1)}${bolt(W - 330 - rand() * 80, -10, Math.PI / 2 - 0.25, 380, 1)}</g>`;
  out += bolt(120 + rand() * 50, -20, Math.PI / 2 + 0.12, SPLIT - 60, 0)
    + bolt(W - 120 - rand() * 50, -20, Math.PI / 2 - 0.12, SPLIT - 120, 0);
  // Sparks.
  for (let i = 0; i < 26; i++) {
    const x = rand() * W;
    const y = 40 + rand() * (SPLIT - 200);
    out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(1.5 + rand() * 3.5)}" fill="${rand() > 0.25 ? "#ffffff" : "#e9d5ff"}" opacity="${r1(0.35 + rand() * 0.6)}"/>`;
  }
  return out;
}

export function riserSvg(input, env) {
  const t = RISER_TYPES[input.type] || RISER_TYPES.up;
  const rand = seeded(`${input.first} ${input.last} ${input.type}`);
  const [top0, top1, top2] = t.top;
  const deep = t.deep;
  const defs = `<linearGradient id="rsBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top0}"/><stop offset="0.6" stop-color="${top1}"/><stop offset="1" stop-color="${top2}"/></linearGradient>`
    + `<radialGradient id="rsSpot" cx="0.5" cy="0.42" r="0.55"><stop offset="0" stop-color="${t.c2}" stop-opacity="0.28"/><stop offset="0.6" stop-color="${t.c1}" stop-opacity="0.06"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="rsCore" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#c4b5fd" stop-opacity="0.4"/><stop offset="0.5" stop-color="${t.c1}" stop-opacity="0.2"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></radialGradient>`
    + '<radialGradient id="rsVig" cx="0.5" cy="0.4" r="0.8"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.55"/></radialGradient>'
    + '<filter id="rsSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter>'
    + '<filter id="rsFire" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="20"/></filter>'
    + '<filter id="rsFeather" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>'
    + '<linearGradient id="rsF0" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#991b1b"/><stop offset="0.6" stop-color="#7f1d1d" stop-opacity="0.75"/><stop offset="1" stop-color="#7f1d1d" stop-opacity="0"/></linearGradient>'
    + `<linearGradient id="rsF1" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${t.c1}"/><stop offset="0.55" stop-color="${t.c1}" stop-opacity="0.7"/><stop offset="1" stop-color="#dc2626" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="rsF2" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff3c4"/><stop offset="0.35" stop-color="${t.c2}"/><stop offset="1" stop-color="${t.c1}" stop-opacity="0"/></linearGradient>`
    + '<filter id="rsShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.55"/></filter>'
    + `<linearGradient id="rsFoot" gradientUnits="userSpaceOnUse" x1="0" y1="${SPLIT - FADE_ABOVE}" x2="0" y2="${SPLIT - FADE_SOLID}"><stop offset="0" stop-color="${deep}" stop-opacity="0"/><stop offset="0.45" stop-color="${deep}" stop-opacity="0.35"/><stop offset="0.85" stop-color="${deep}" stop-opacity="0.85"/><stop offset="1" stop-color="${deep}" stop-opacity="1"/></linearGradient>`
    + `<linearGradient id="rsPanel" gradientUnits="userSpaceOnUse" x1="0" y1="${SPLIT}" x2="0" y2="${H}"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="#000000"/></linearGradient>`
    + `<linearGradient id="rsGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.c1}"/><stop offset="1" stop-color="${t.c2}"/></linearGradient>`
;

  // ── The top: his label's scene, him in front ──
  let body = `<rect width="${W}" height="${H}" fill="${deep}"/>`
    + `<g><rect width="${W}" height="${SPLIT}" fill="url(#rsBase)"/>`
    + `<rect width="${W}" height="${SPLIT}" fill="url(#rsSpot)"/>`;
  body += input.type === "onFire" ? fireBackdrop(t, rand) : input.type === "breakout" ? breakoutBackdrop(t, rand) : upBackdrop(t, rand);
  body += `<rect width="${W}" height="${SPLIT}" fill="url(#rsVig)"/>`;
  if (hasImage(env, input.photo)) {
    const b = FIRST_PICK_PHOTO;
    const rot = input.adjust?.rotate || 0;
    const shot = image(env, input.photo, b.x, b.y, b.w, b.h, "xMidYMax meet");
    const turned = rot ? `<g transform="rotate(${r1(rot)} ${r1(b.x + b.w / 2)} ${r1(b.y + b.h / 2)})">${shot}</g>` : shot;
    body += `<g filter="url(#rsShadow)">${placed(turned, b.x, b.y, b.w, b.h, input.adjust)}</g>`;
  }
  body += `<rect y="${SPLIT - FADE_ABOVE}" width="${W}" height="${FADE_ABOVE + FADE_PAST}" fill="url(#rsFoot)"/></g>`
    + `<rect y="${SPLIT}" width="${W}" height="${H - SPLIT}" fill="url(#rsPanel)"/>`;

  // The header, top left: "2027 DRAFT RISERS".
  const tag = `${input.year} DRAFT RISERS`;
  const tagS = 34;
  const tagW = env.measure(tag, tagS) + 2 * (tag.length - 1) + 50;
  body += `<rect x="${PAD - 20}" y="${PAD - 22}" width="${r1(tagW)}" height="58" rx="10" fill="#000000" fill-opacity="0.5"/>`
    + `<rect x="${PAD - 20}" y="${PAD - 22}" width="8" height="58" rx="3" fill="url(#rsGrad)"/>`
    + text(PAD + 8, PAD + 20, tag, tagS, "#ffffff", { spacing: 2 });

  // ── The bottom: his name, big, his school's logo to its left, then his
  // position and school. (His stats are on the back of his card on the
  // page — Risers.jsx — not here.)
  const top = SPLIT + 36;
  const W2 = W - PAD * 2;
  const hasLogo = hasImage(env, input.collegeLogo);
  const LOGO = 230;
  const nameX = hasLogo ? PAD + LOGO + 30 : PAD;
  const nameW = W - PAD - nameX;
  body += fitLine(env, nameX, top + 80, up(input.first), 84, nameW, "#ffffff", { spacing: 3, opacity: 0.85, min: 40 }).svg;
  const last = up(input.last);
  body += text(nameX - 4, top + 246, last, fitSize(env, last, 186, nameW, 70, 2), "#ffffff", { spacing: 2 });
  if (hasLogo) body += image(env, input.collegeLogo, PAD, top + 20, LOGO, LOGO);

  // A rule in his label's colors, then "QB · OREGON".
  const ruleY = top + 286;
  body += `<rect x="${PAD}" y="${ruleY}" width="${W2}" height="5" rx="2.5" fill="url(#rsGrad)"/>`;
  const pos = up(input.pos);
  const ps = 58;
  const posW = env.measure(pos, ps) + 2 * Math.max(0, pos.length - 1);
  // (SVG collapses spaces, so the dot between them is placed, not spaced.)
  const gap = 22;
  const dotX = PAD + posW + gap;
  const schoolX = dotX + 12 + gap;
  body += text(PAD, ruleY + 74, pos, ps, t.c2, { spacing: 2 })
    + `<circle cx="${r1(dotX + 6)}" cy="${r1(ruleY + 74 - ps * 0.36)}" r="6" fill="#ffffff" fill-opacity="0.55"/>`
    + fitLine(env, schoolX, ruleY + 74, up(input.school), ps, W - PAD - schoolX, "#ffffff", { spacing: 2, min: 30 }).svg;

  // The foot: We-Draft's logo left, the address right.
  const fy = ruleY + 96;
  const fh = H - fy - 12;
  const im = env.images?.[input.brandLogo];
  const lh = Math.min(40, fh);
  const lw = im?.w && im?.h ? (im.w / im.h) * lh : lh * 3;
  body += image(env, input.brandLogo, PAD, fy + (fh - lh) / 2, lw, lh, "xMinYMid meet")
    + fitLine(env, W - PAD, fy + fh / 2 + 11, up(input.address), 32, W2 - lw - 30, "#ffffff", { anchor: "end", spacing: 1, opacity: 0.7, min: 20 }).svg;

  return svgDoc(env, defs, body, deep);
}
