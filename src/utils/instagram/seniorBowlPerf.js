// src/utils/instagram/seniorBowlPerf.js
//
// The Senior Bowl Top Performer graphic (/events/senior-bowl/{year}/
// performances — utils/seniorBowlPerf.js): one per performer with an action
// shot placed for First Pick. Same size (1080×1350) and photo box as First
// Pick and the Draft Risers (firstPick.js FIRST_PICK_PHOTO), so a shot's
// saved placement lands the same way.
//   Top     night in Mobile: black into Senior Bowl red, stadium light
//           beams from both corners, field lines in perspective, a gold
//           glow behind him. "2027 SENIOR BOWL" / "TOP PERFORMER" top left,
//           his team ("AMERICAN TEAM") under it, the Senior Bowl logo top
//           right.
//   Bottom  his name, big, his school's logo to its left; a red→gold rule;
//           position · school; We-Draft.com's logo and the address.
// No days or rank on it — those change through the week; the page shows
// them beside it.
// Plain data in, SVG out (posts.js kit), drawn the same in the browser
// (SeniorBowlPerfGraphic.jsx) and on the server (server/seniorBowlPerfImage.mjs).
import { kit } from "./posts.js";
import { FIRST_PICK_SPLIT, FIRST_PICK_PHOTO, firstPickAdjust } from "./firstPick.js";
import { SBP_THEME } from "../seniorBowlPerf.js";

const { PAD, up, r1, fitSize, text, fitLine, image, hasImage, placed, svgDoc } = kit;
const W = 1080;
const H = 1350;
const SPLIT = FIRST_PICK_SPLIT;
const FADE_ABOVE = 220;
const FADE_SOLID = 12;
const FADE_PAST = 40;
const T = SBP_THEME;

// player: the players doc; perf: his entry ({ team }); school: its schools
// doc; photo: a placed action shot; eventLogo / brandLogo: image keys.
export function perfInput({ perf = {}, player = {}, school = {}, year = "", photo = null, eventLogo = "", brandLogo = "", address = "" }) {
  return {
    first: player.First || perf.first || "", last: player.Last || perf.last || "",
    pos: player.Position || perf.pos || "", school: player.School || perf.school || "",
    team: perf.team || "",
    collegeLogo: school.LogoDark || school.Logo1 || "",
    year: String(year || ""),
    photo: photo?.url || "", adjust: firstPickAdjust(photo?.firstPick),
    eventLogo, brandLogo, address: address || "WE-DRAFT.COM/EVENTS/SENIOR-BOWL",
  };
}

export function perfImageUrls(input) {
  return [...new Set([input.photo, input.collegeLogo, input.eventLogo, input.brandLogo].filter(Boolean))];
}

// Night in Mobile: light beams, field lines, a glow behind him.
function stadium() {
  let out = "";
  // Field lines, converging toward a point behind him.
  const vx = W / 2;
  const vy = 300;
  for (let i = -7; i <= 7; i++) {
    const x = vx + i * 260;
    out += `<path d="M ${r1(vx + i * 22)} ${vy} L ${r1(x)} ${SPLIT + 40}" stroke="#ffffff" stroke-width="${i ? 3 : 4}" opacity="${i ? 0.07 : 0.1}"/>`;
  }
  for (let k = 1; k <= 6; k++) {
    const y = vy + (SPLIT + 40 - vy) * Math.pow(k / 6, 1.6);
    out += `<rect x="0" y="${r1(y)}" width="${W}" height="${r1(2 + k * 0.6)}" fill="#ffffff" opacity="${r1(0.03 + k * 0.012)}"/>`;
  }
  // Stadium light beams from the top corners.
  const beam = (x0, dir) => {
    let b = "";
    [[0.18, 260], [0.12, 420], [0.08, 600]].forEach(([op, spread], i) => {
      const x1 = x0 + dir * (520 + i * 120);
      b += `<path d="M ${x0} -20 L ${r1(x1 - spread / 2)} ${SPLIT} L ${r1(x1 + spread / 2)} ${SPLIT} Z" fill="url(#sbBeam)" opacity="${op}" filter="url(#sbSoft)"/>`;
    });
    // The light itself.
    b += `<circle cx="${x0}" cy="0" r="120" fill="#ffffff" opacity="0.35" filter="url(#sbSoft)"/>`
      + `<circle cx="${x0}" cy="0" r="48" fill="#ffffff" opacity="0.7" filter="url(#sbGlow)"/>`;
    return b;
  };
  out += beam(40, 1) + beam(W - 40, -1);
  // Gold glow behind him.
  out += `<ellipse cx="${W / 2}" cy="${SPLIT - 260}" rx="460" ry="420" fill="url(#sbHalo)"/>`;
  return out;
}

export function perfSvg(input, env) {
  const deep = T.deep;
  const teamColor = T[input.team] || T.red;
  const defs = `<linearGradient id="sbBase" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050505"/><stop offset="0.55" stop-color="#3b0907"/><stop offset="1" stop-color="${T.red}"/></linearGradient>`
    + '<linearGradient id="sbBeam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>'
    + `<radialGradient id="sbHalo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${T.gold}" stop-opacity="0.32"/><stop offset="0.55" stop-color="${T.red}" stop-opacity="0.12"/><stop offset="1" stop-color="${T.red}" stop-opacity="0"/></radialGradient>`
    + '<radialGradient id="sbVig" cx="0.5" cy="0.42" r="0.8"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.6"/></radialGradient>'
    + '<filter id="sbSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="18"/></filter>'
    + '<filter id="sbGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>'
    + '<filter id="sbShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.6"/></filter>'
    + `<linearGradient id="sbFoot" gradientUnits="userSpaceOnUse" x1="0" y1="${SPLIT - FADE_ABOVE}" x2="0" y2="${SPLIT - FADE_SOLID}"><stop offset="0" stop-color="${deep}" stop-opacity="0"/><stop offset="0.45" stop-color="${deep}" stop-opacity="0.35"/><stop offset="0.85" stop-color="${deep}" stop-opacity="0.85"/><stop offset="1" stop-color="${deep}" stop-opacity="1"/></linearGradient>`
    + `<linearGradient id="sbPanel" gradientUnits="userSpaceOnUse" x1="0" y1="${SPLIT}" x2="0" y2="${H}"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="#000000"/></linearGradient>`
    + `<linearGradient id="sbRule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${T.red}"/><stop offset="1" stop-color="${T.gold}"/></linearGradient>`;

  // ── The top: the stadium at night, him in front ──
  let body = `<rect width="${W}" height="${H}" fill="${deep}"/>`
    + `<g><rect width="${W}" height="${SPLIT}" fill="url(#sbBase)"/>`
    + stadium()
    + `<rect width="${W}" height="${SPLIT}" fill="url(#sbVig)"/>`;
  if (hasImage(env, input.photo)) {
    const b = FIRST_PICK_PHOTO;
    const rot = input.adjust?.rotate || 0;
    const shot = image(env, input.photo, b.x, b.y, b.w, b.h, "xMidYMax meet");
    const turned = rot ? `<g transform="rotate(${r1(rot)} ${r1(b.x + b.w / 2)} ${r1(b.y + b.h / 2)})">${shot}</g>` : shot;
    body += `<g filter="url(#sbShadow)">${placed(turned, b.x, b.y, b.w, b.h, input.adjust)}</g>`;
  }
  body += `<rect y="${SPLIT - FADE_ABOVE}" width="${W}" height="${FADE_ABOVE + FADE_PAST}" fill="url(#sbFoot)"/></g>`
    + `<rect y="${SPLIT}" width="${W}" height="${H - SPLIT}" fill="url(#sbPanel)"/>`;

  // Top left: "2027 SENIOR BOWL" over "TOP PERFORMER", his team under it.
  const tag = `${input.year} SENIOR BOWL`;
  const tagS = 34;
  const tagW = env.measure(tag, tagS) + 2 * (tag.length - 1) + 50;
  body += `<rect x="${PAD - 20}" y="${PAD - 22}" width="${r1(tagW)}" height="58" rx="10" fill="#000000" fill-opacity="0.55"/>`
    + `<rect x="${PAD - 20}" y="${PAD - 22}" width="8" height="58" rx="3" fill="${T.red}"/>`
    + text(PAD + 8, PAD + 20, tag, tagS, "#ffffff", { spacing: 2 });
  const big = "TOP PERFORMER";
  const bigS = 54;
  body += text(PAD - 16, PAD + 98, big, bigS, T.gold, { spacing: 3 });
  if (input.team) {
    const tt = `${up(input.team)} TEAM`;
    const ts = 28;
    const tw = env.measure(tt, ts) + 2 * (tt.length - 1) + 36;
    body += `<rect x="${PAD - 16}" y="${PAD + 120}" width="${r1(tw)}" height="46" rx="23" fill="${teamColor}"/>`
      + text(PAD + 2, PAD + 153, tt, ts, "#ffffff", { spacing: 2 });
  }
  // Top right: the Senior Bowl logo.
  // (Low enough to clear the page card's "Flip" hint in the corner.)
  if (hasImage(env, input.eventLogo)) body += image(env, input.eventLogo, W - PAD - 180, PAD + 40, 190, 190, "xMaxYMin meet");

  // ── The bottom: his name, his school's logo left of it ──
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

  // The red→gold rule, then "QB · OREGON".
  const ruleY = top + 286;
  body += `<rect x="${PAD}" y="${ruleY}" width="${W2}" height="5" rx="2.5" fill="url(#sbRule)"/>`;
  const pos = up(input.pos);
  const ps = 58;
  const posW = env.measure(pos, ps) + 2 * Math.max(0, pos.length - 1);
  const gap = 22;
  const dotX = PAD + posW + gap;
  const schoolX = dotX + 12 + gap;
  body += text(PAD, ruleY + 74, pos, ps, T.gold, { spacing: 2 })
    + `<circle cx="${r1(dotX + 6)}" cy="${r1(ruleY + 74 - ps * 0.36)}" r="6" fill="#ffffff" fill-opacity="0.55"/>`
    + fitLine(env, schoolX, ruleY + 74, up(input.school), ps, W - PAD - schoolX, "#ffffff", { spacing: 2, min: 30 }).svg;

  // The foot: We-Draft.com's logo left, the address right.
  const fy = ruleY + 96;
  const fh = H - fy - 12;
  const im = env.images?.[input.brandLogo];
  const lh = Math.min(40, fh);
  const lw = im?.w && im?.h ? (im.w / im.h) * lh : lh * 3;
  body += image(env, input.brandLogo, PAD, fy + (fh - lh) / 2, lw, lh, "xMinYMid meet")
    + fitLine(env, W - PAD, fy + fh / 2 + 11, up(input.address), 32, W2 - lw - 30, "#ffffff", { anchor: "end", spacing: 1, opacity: 0.7, min: 20 }).svg;

  return svgDoc(env, defs, body, deep);
}
