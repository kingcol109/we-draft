// src/utils/instagram/draftCard.js
//
// The generic draft prospect card (user, 2026-11-21): a We-Draft.com
// branded card built on a prospect's action shot, for the WX lists — first
// the NFL teams' draft targets (utils/nflTargets.js), and any list that
// needs a prospect card. 1080×1350 with the First Pick photo box
// (firstPick.js), so a shot's saved First Pick placement lands the same way.
//
// Draft night themed (redesigned 2026-11-21 — like the Combine graphics put
// him in the testing hall, this puts him on the draft stage):
//   Top     the theater: a lighting truss with its lamps, spotlight beams
//           coming down on him; the stage's screens — the center one with
//           the draft logo, two angled side screens carrying the Round 1
//           board (picks 1–16 left, 17–32 right, #1 on the clock) — LED
//           pixels on all of them; the lit lip of the stage. His action shot
//           (cut out) in front. Top right: the year's draft logo
//           (We-Draft.com's badge when there's none). No shot: his school's
//           logo, big, in the spotlight.
//   Bottom  the draft card — the one turned in at the podium: cream stock,
//           a navy header ("2027 NFL DRAFT", the We-Draft.com wordmark),
//           his name on the PLAYER line, POSITION and SCHOOL (with its
//           logo), ROUND and PICK left blank. Tilted a touch, as if just
//           handed in. No address line (user, 2026-11-21).
// The page shows it as the front of a flip card — the back (his stats, his
// draft snapshot) is HTML (components/TeamTargetsWX.jsx, ScoutCard CardBack).
// Plain data in, SVG out (posts.js kit) — drawn in the browser
// (components/DraftCardGraphic.jsx); a server copy can draw the same SVG.
import { kit } from "./posts.js";
import { FIRST_PICK_PHOTO, firstPickAdjust } from "./firstPick.js";

const { up, r1, text, fitLine, image, hasImage, placed, svgDoc } = kit;
const W = 1080;
const H = 1350;
// Draft night: the hall's black-navy, We-Draft.com blue, the board's LED
// blue, the stage gold, the card's cream and ink.
const C = { deep: "#02060f", hall: "#061a36", blue: "#0055a5", led: "#3b8eff", gold: "#f6a21d", cream: "#f3eee2", ink: "#0b1b33", rule: "#c9c0ab" };
const STAGE = 770; // the stage's lit lip

// player: { first, last, pos, school }; college: its schools doc; photo: a
// placed action shot (or null); draftLogo: the year's draft logo; brandLogo:
// We-Draft.com's circle badge; wordmark: its "We-Draft.com" wordmark.
export function draftCardInput({ player = {}, college = null, year = "", photo = null, draftLogo = "", brandLogo = "", wordmark = "", address = "" }) {
  return {
    first: player.first || player.First || "", last: player.last || player.Last || "",
    pos: player.pos || player.Position || "", school: player.school || player.School || "",
    collegeLogo: college ? college.LogoDark || college.Logo1 || "" : "",
    collegeLogoLight: college ? college.Logo1 || college.LogoDark || "" : "",
    year: String(year || ""),
    photo: photo?.url || "", adjust: firstPickAdjust(photo?.firstPick),
    draftLogo, brandLogo, wordmark, address: address || "WE-DRAFT.COM",
  };
}

export const draftCardImageUrls = (input) => [...new Set([input.photo, input.collegeLogo, input.collegeLogoLight, input.draftLogo, input.brandLogo, input.wordmark].filter(Boolean))];

const DEFS = `<linearGradient id="dnHall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.deep}"/><stop offset="0.45" stop-color="${C.hall}"/><stop offset="0.75" stop-color="#030c1c"/><stop offset="1" stop-color="${C.deep}"/></linearGradient>`
  + `<radialGradient id="dnWall" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="${C.blue}" stop-opacity="0.55"/><stop offset="0.6" stop-color="${C.blue}" stop-opacity="0.1"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></radialGradient>`
  + `<linearGradient id="dnBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.6"/><stop offset="0.7" stop-color="#ffe9c2" stop-opacity="0.12"/><stop offset="1" stop-color="#ffe9c2" stop-opacity="0"/></linearGradient>`
  + `<linearGradient id="dnBoardFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.deep}" stop-opacity="0"/><stop offset="0.75" stop-color="${C.deep}" stop-opacity="0"/><stop offset="1" stop-color="${C.deep}" stop-opacity="0.85"/></linearGradient>`
  + `<linearGradient id="dnFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a2448"/><stop offset="0.3" stop-color="#05142a"/><stop offset="1" stop-color="${C.deep}"/></linearGradient>`
  + `<radialGradient id="dnPool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff3d6" stop-opacity="0.45"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0"/></radialGradient>`
  + `<linearGradient id="dnFoot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.deep}" stop-opacity="0"/><stop offset="0.3" stop-color="${C.deep}" stop-opacity="0.9"/><stop offset="1" stop-color="${C.deep}"/></linearGradient>`
  + `<linearGradient id="dnLip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset="0.2" stop-color="${C.gold}"/><stop offset="0.8" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>`
  + `<linearGradient id="dnCard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf8f0"/><stop offset="1" stop-color="${C.cream}"/></linearGradient>`
  + `<linearGradient id="dnScreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d3470"/><stop offset="1" stop-color="#061733"/></linearGradient>`
  + `<radialGradient id="dnLamp" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff"/><stop offset="0.3" stop-color="#ffe7b8" stop-opacity="0.95"/><stop offset="1" stop-color="#ffe7b8" stop-opacity="0"/></radialGradient>`
  // LED pixels: a fine dark grid over the screens.
  + '<pattern id="dnPix" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="1.5" fill="#000000" fill-opacity="0.35"/><rect width="1.5" height="6" fill="#000000" fill-opacity="0.35"/></pattern>'
  // The truss's lattice.
  + '<pattern id="dnTruss" width="36" height="28" patternUnits="userSpaceOnUse"><path d="M0 0 L18 28 L36 0" fill="none" stroke="#8a96a8" stroke-width="2.5" stroke-opacity="0.6"/></pattern>'
  + '<clipPath id="dnAbove"><rect x="-200" y="-200" width="1480" height="1160"/></clipPath>'
  + '<filter id="dnBlur" x="-50%" y="-20%" width="200%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>'
  + '<filter id="dnGlow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
  + '<filter id="dnShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000000" flood-opacity="0.6"/></filter>'
  + '<filter id="dnCardShadow" x="-10%" y="-20%" width="120%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.7"/></filter>';

// A side screen, angled toward the center: a trapezoid from its outer edge
// (xo, tall) to its inner edge (xi, shorter), the Round 1 board on it —
// picks from..from+15, two columns filled down (1–8, then 9–16). Every point
// goes through the screen's perspective: u across (0 outer → 1 inner), v down.
const SCREEN = { oT: 190, oB: 770, iT: 240, iB: 700 };
function sideScreen(xo, xi, from, year) {
  const { oT, oB, iT, iB } = SCREEN;
  const at = (u, v) => {
    const top = oT + (iT - oT) * u;
    const bot = oB + (iB - oB) * u;
    return [xo + (xi - xo) * u, top + (bot - top) * v];
  };
  const quad = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => at(u, v).map(r1).join(",")).join(" ");
  // Text on the screen at (u, v): squashed to the screen's height there,
  // sheared with its slope (v is the baseline).
  const dir = Math.sign(xi - xo);
  const label = (u, v, value, size, fill, opts = {}) => {
    const [x, y] = at(u, v);
    const k = ((iB - iT) * u + (oB - oT) * (1 - u)) / (oB - oT);
    const slopeTop = (iT - oT) / Math.abs(xi - xo);
    const slopeBot = (iB - oB) / Math.abs(xi - xo);
    const sh = (slopeTop + (slopeBot - slopeTop) * v) * dir;
    return `<g transform="matrix(1 ${r1(sh * 1000) / 1000} 0 ${r1(k * 1000) / 1000} ${r1(x)} ${r1(y)})">${text(0, 0, value, size, fill, opts)}</g>`;
  };
  let s = `<polygon points="${quad(0, 0, 1, 1)}" fill="url(#dnScreen)"/>`;
  const head = from === 1 ? "ROUND 1" : `${year ? `${year} ` : ""}NFL DRAFT`;
  // (The heading starts at the outer edge on the left screen, ends at it on the right.)
  s += label(0.08, 0.075, head, 30, from === 1 ? "#ffffff" : C.gold, { spacing: 5, anchor: dir > 0 ? "start" : "end" });
  const rows = 8;
  for (let c = 0; c < 2; c++) {
    for (let r = 0; r < rows; r++) {
      const n = from + c * rows + r;
      const now = n === 1;
      // Columns run from the outer edge in (left screen) or the inner edge out
      // (right screen), so the numbers read left to right on both.
      const col = dir > 0 ? c : 1 - c;
      const u0 = 0.06 + col * 0.46;
      const u1 = u0 + 0.42;
      const v0 = 0.12 + r * 0.105;
      const v1 = v0 + 0.085;
      const numU = dir > 0 ? u0 + 0.04 : u1 - 0.04;
      s += `<polygon points="${quad(u0, v0, u1, v1)}" fill="${now ? C.gold : C.led}" fill-opacity="${now ? 0.45 : 0.16}" stroke="${now ? C.gold : C.led}" stroke-opacity="${now ? 1 : 0.5}" stroke-width="2"/>`
        + label(numU, v1 - 0.02, String(n), 34, now ? "#ffe2a8" : "#ffffff", { opacity: now ? 1 : 0.75 })
        + `<polygon points="${dir > 0 ? quad(u0 + 0.16, v0 + 0.036, u1 - 0.04, v0 + 0.05) : quad(u0 + 0.04, v0 + 0.036, u1 - 0.16, v0 + 0.05)}" fill="#ffffff" fill-opacity="${now ? 0.5 : 0.16}"/>`;
    }
  }
  s += `<polygon points="${quad(0, 0, 1, 1)}" fill="url(#dnPix)"/>`
    + `<polygon points="${quad(0, 0, 1, 1)}" fill="none" stroke="#9fb4d4" stroke-opacity="0.4" stroke-width="3"/>`;
  return s;
}

// The stage set behind him: the center screen with the draft logo, the side
// screens with the board, the truss and its lamps above.
function stageSet(env, input, withLogo) {
  let s = "";
  const x0 = 318;
  const x1 = W - 318;
  const y0 = 150;
  s += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${STAGE - y0}" fill="url(#dnScreen)"/>`;
  const logo = hasImage(env, input.draftLogo) ? input.draftLogo : input.brandLogo;
  const L = 400;
  // (No shot: his school's logo is in front of it — the screen stays plain.)
  s += (withLogo ? image(env, logo, W / 2 - L / 2, y0 + 40, L, L, "xMidYMid meet", 0.55) : "")
    + `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${STAGE - y0}" fill="url(#dnPix)"/>`
    + `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${STAGE - y0}" fill="none" stroke="#9fb4d4" stroke-opacity="0.35" stroke-width="3"/>`;
  s += sideScreen(20, 296, 1, input.year) + sideScreen(W - 20, W - 296, 17, input.year);
  // The truss across the top, its lamps hanging under it.
  s += `<rect x="0" y="34" width="${W}" height="28" fill="#0c1424"/><rect x="0" y="34" width="${W}" height="28" fill="url(#dnTruss)"/>`
    + `<rect x="0" y="32" width="${W}" height="4" fill="#8a96a8" opacity="0.65"/><rect x="0" y="60" width="${W}" height="4" fill="#8a96a8" opacity="0.65"/>`;
  LAMPS.forEach((x) => {
    s += `<rect x="${x - 15}" y="62" width="30" height="22" rx="4" fill="#1a2436" stroke="#8a96a8" stroke-opacity="0.5" stroke-width="1.5"/>`
      + `<circle cx="${x}" cy="90" r="36" fill="url(#dnLamp)"/>`;
  });
  return s;
}
const LAMPS = [110, 290, 450, 630, 790, 970];

// A spotlight beam from a lamp (lx) widening down to the floor around fx.
const beam = (lx, fx, spread, opacity) => `<polygon points="${lx - 20},90 ${lx + 20},90 ${fx + spread},${STAGE + 60} ${fx - spread},${STAGE + 60}" fill="url(#dnBeam)" opacity="${opacity}" filter="url(#dnBlur)"/>`;

// We-Draft.com in the card's header, right-aligned to x, centered on y: the
// wordmark (the circle badge when there's no wordmark).
function brand(env, input, x, y) {
  const wm = env.images?.[input.wordmark];
  const wh = 44;
  const ww = wm?.w && wm?.h ? (wm.w / wm.h) * wh : 0;
  if (ww) return image(env, input.wordmark, x - ww, y - wh / 2, ww, wh);
  return image(env, input.brandLogo, x - 60, y - 30, 60, 60);
}

export function draftCardSvg(input, env) {
  const hasLogo = hasImage(env, input.collegeLogo);
  const hasPhoto = hasImage(env, input.photo);

  // ── The hall ──
  let body = `<rect width="${W}" height="${H}" fill="url(#dnHall)"/>`
    + `<rect width="${W}" height="${STAGE}" fill="url(#dnWall)"/>`
    + stageSet(env, input, hasPhoto)
    + `<rect width="${W}" height="${STAGE}" fill="url(#dnBoardFade)"/>`;
  // The stage floor, its lit lip, the pool of light he stands in.
  body += `<rect y="${STAGE}" width="${W}" height="${H - STAGE}" fill="url(#dnFloor)"/>`
    + `<ellipse cx="${W / 2}" cy="${STAGE + 40}" rx="440" ry="70" fill="url(#dnPool)"/>`
    + `<rect y="${STAGE - 2}" width="${W}" height="5" fill="url(#dnLip)" filter="url(#dnGlow)"/>`;
  for (let i = 0; i < 18; i++) body += `<circle cx="${r1(40 + i * 60)}" cy="${STAGE + 22}" r="3" fill="${C.gold}" opacity="0.55"/>`;
  // The spotlights, from the lamps, onto him.
  body += beam(LAMPS[1], 470, 170, 0.5) + beam(LAMPS[4], 610, 170, 0.5) + beam(LAMPS[2], 520, 120, 0.3) + beam(LAMPS[3], 560, 120, 0.3);

  // ── Him, in the light ──
  if (hasPhoto) {
    const b = FIRST_PICK_PHOTO;
    const rot = input.adjust?.rotate || 0;
    const shot = image(env, input.photo, b.x, b.y, b.w, b.h, "xMidYMax meet");
    const turned = rot ? `<g transform="rotate(${r1(rot)} ${r1(b.x + b.w / 2)} ${r1(b.y + b.h / 2)})">${shot}</g>` : shot;
    // (Clipped where the card covers him — nothing pokes out below it.)
    body += `<g clip-path="url(#dnAbove)"><g filter="url(#dnShadow)">${placed(turned, b.x, b.y, b.w, b.h, input.adjust)}</g></g>`;
  } else if (hasLogo) {
    const M = 380;
    body += `<g filter="url(#dnShadow)">${image(env, input.collegeLogo, W / 2 - M / 2, 590 - M / 2, M, M)}</g>`;
  }
  body += `<rect y="${STAGE + 20}" width="${W}" height="${H - STAGE - 20}" fill="url(#dnFoot)"/>`;

  // ── Top right: the year's draft logo (We-Draft.com's badge when there's none) ──
  const topLogo = hasImage(env, input.draftLogo) ? input.draftLogo : input.brandLogo;
  const TL = 190;
  body += `<g filter="url(#dnShadow)">${image(env, topLogo, W - TL - 24, 20, TL, TL)}</g>`;

  // ── Bottom: the draft card, just handed in ──
  const cx = 64;
  const cy = 860;
  const cw = W - cx * 2;
  const ch = 400;
  const ink = C.ink;
  let card = `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="8" fill="url(#dnCard)"/>`
    + `<rect x="${cx}" y="${cy}" width="${cw}" height="78" rx="8" fill="${ink}"/><rect x="${cx}" y="${cy + 60}" width="${cw}" height="18" fill="${ink}"/>`
    + `<rect x="${cx}" y="${cy + 78}" width="${cw}" height="6" fill="${C.gold}"/>`
    + text(cx + 30, cy + 56, input.year ? `${input.year} NFL DRAFT` : "NFL DRAFT", 46, "#ffffff", { spacing: 5 })
    + brand(env, input, cx + cw - 24, cy + 39);
  // A form field: its label small, the line it's written on.
  const ix = cx + 34;
  const iw = cw - 68;
  const label = (x, y, t) => text(x, y, t, 24, "#7a7263", { spacing: 4 });
  const line = (x, y, w) => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="2.5" fill="${C.rule}"/>`;
  // PLAYER — his name, the biggest thing on the card.
  const name = up(`${input.first} ${input.last}`.trim());
  const ny = cy + 214;
  card += label(ix, cy + 122, "PLAYER")
    + fitLine(env, ix - 2, ny, name, 116, iw, ink, { spacing: 2, min: 48 }).svg
    + line(ix, ny + 14, iw);
  // POSITION · SCHOOL (logo + name) · ROUND · PICK (blank — not yet).
  const ry = ny + 60;
  const vy = ry + 72;
  const posW = 150;
  const boxW = 120;
  const pickX = ix + iw - boxW;
  const roundX = pickX - 18 - boxW;
  const schX = ix + posW + 24;
  const schW = roundX - 30 - schX;
  card += label(ix, ry, "POSITION") + text(ix, vy, up(input.pos), 64, C.blue, { spacing: 2 }) + line(ix, vy + 12, posW);
  card += label(schX, ry, "SCHOOL");
  const lightLogo = hasImage(env, input.collegeLogoLight) ? input.collegeLogoLight : input.collegeLogo;
  const LG = 62;
  const hasSchLogo = hasImage(env, lightLogo);
  if (hasSchLogo) card += image(env, lightLogo, schX, vy - LG + 6, LG, LG);
  const stx = schX + (hasSchLogo ? LG + 14 : 0);
  card += fitLine(env, stx, vy, up(input.school), 56, schX + schW - stx, ink, { spacing: 1, min: 26 }).svg + line(schX, vy + 12, schW);
  const blank = (x, t) => label(x, ry, t) + `<rect x="${r1(x)}" y="${r1(ry + 14)}" width="${boxW}" height="72" rx="6" fill="none" stroke="${C.rule}" stroke-width="2.5" stroke-dasharray="8 6"/>`;
  card += blank(roundX, "ROUND") + blank(pickX, "PICK");

  body += `<g transform="rotate(-2.2 ${W / 2} ${cy + ch / 2})" filter="url(#dnCardShadow)">${card}</g>`;

  return svgDoc(env, DEFS, body, C.deep);
}
