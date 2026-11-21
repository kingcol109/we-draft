// src/utils/instagram/prospectIntro.js
//
// The prospect card graphic for the two high school WX pages (user,
// 2026-11-21): "Meet the Class of 2030" (utils/classIntro.js, kind "intro")
// and the Early Look at later classes (utils/earlyLook.js, kind "early").
// 1080×1350, the First Pick photo box (firstPick.js), so a placed action
// shot lands as it does on the other WX graphics.
//   Top     his college's colors (a committed player — the article "connects
//           with the teams they signed with"), else We-Draft navy; a faint,
//           huge outline of his home state behind everything. The art: his
//           placed action shot when he has one (his high school's logo then sits top
//           right); otherwise the mark, big — the college's logo, else his
//           high school's, else his state's outline.
//           Top left: the tag ("CLASS OF 2030") and the kicker ("MEET THE
//           CLASS" / "EARLY LOOK"), a "COMMITTED TO OHIO STATE" chip under.
//   Bottom  his name, big, a logo to its left; a color→gold rule;
//           "QB · IMG ACADEMY · FL"; We-Draft.com's logo and the address.
// Plain data in, SVG out (posts.js kit) — the browser draws it
// (components/ProspectIntroGraphic.jsx). The state outline comes in as a
// path (utils/usStatesGeo.js, straight), so this file stays data-only.
import { kit } from "./posts.js";
import { FIRST_PICK_SPLIT, FIRST_PICK_PHOTO, firstPickAdjust } from "./firstPick.js";

const { PAD, up, r1, hex, fitSize, text, fitLine, image, hasImage, placed, svgDoc } = kit;
const W = 1080;
const H = 1350;
const SPLIT = FIRST_PICK_SPLIT;
const GOLD = "#f6a21d";
const NAVY = "#0b1a2e";
const DEEP = "#060c16";

// A color mixed toward black (k 0..1).
function shade(c, k) {
  const h = hex(c) || NAVY;
  const n = parseInt(h.slice(1), 16);
  const f = (v) => Math.round(v * (1 - k)).toString(16).padStart(2, "0");
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}
// Too light to carry white type (a white or yellow primary)?
function light(c) {
  const h = hex(c);
  if (!h) return false;
  const n = parseInt(h.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
}

// entry: the page's pick ({ first, last, pos, hs, state }); college / hs:
// their docs ({ School|Name, Logo1, LogoDark, Color1, Color2 }) or null;
// stateShape: { abbr, d, bbox } (usStates()[abbr], straight) or null;
// photo: a placed action shot or null.
export function prospectInput({ kind = "intro", entry = {}, tag = "", kicker = "", college = null, hs = null, stateShape = null, photo = null, brandLogo = "", address = "" }) {
  const c1 = hex(college?.Color1);
  const c2 = hex(college?.Color2);
  // A light primary (white, yellow) makes a washed-out field — lead with the second color then.
  const base = c1 && !light(c1) ? c1 : c2 && !light(c2) ? c2 : NAVY;
  const accent = c1 && base !== c1 ? c1 : c2 && c2 !== base ? c2 : GOLD;
  return {
    kind, tag: up(tag), kicker: up(kicker),
    first: entry.first || "", last: entry.last || "", pos: entry.pos || "",
    hsName: entry.hs || hs?.Name || "", stateAbbr: stateShape?.abbr || "",
    college: college?.School || "", collegeLogo: college ? college.LogoDark || college.Logo1 || "" : "",
    hsLogo: hs?.Logo1 || "",
    state: stateShape ? { d: stateShape.ds || stateShape.d, bbox: stateShape.bboxS || stateShape.bbox } : null,
    base, accent: light(accent) && base === NAVY ? GOLD : accent,
    photo: photo?.url || "", adjust: firstPickAdjust(photo?.firstPick),
    brandLogo, address: address || "WE-DRAFT.COM",
  };
}

export function prospectImageUrls(input) {
  return [...new Set([input.photo, input.collegeLogo, input.hsLogo, input.brandLogo].filter(Boolean))];
}

// The state's outline fit into a box (centered), as a group.
function stateIn(st, x, y, w, h, fill, opacity = 1, stroke = "") {
  if (!st?.d) return "";
  const [x0, y0, x1, y1] = st.bbox;
  const s = Math.min(w / (x1 - x0), h / (y1 - y0));
  const tx = x + (w - (x1 - x0) * s) / 2 - x0 * s;
  const ty = y + (h - (y1 - y0) * s) / 2 - y0 * s;
  return `<g transform="translate(${r1(tx)} ${r1(ty)}) scale(${r1(s * 1000) / 1000})" opacity="${opacity}"><path d="${st.d}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${r1(1.5 / s)}"` : ""}/></g>`;
}

export function prospectSvg(input, env) {
  const base = input.base;
  const deep = shade(base, 0.72);
  const accent = input.accent;
  const defs = `<linearGradient id="piBase" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${shade(base, 0.05)}"/><stop offset="0.7" stop-color="${shade(base, 0.45)}"/><stop offset="1" stop-color="${deep}"/></linearGradient>`
    + `<radialGradient id="piGlow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0.06"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="piState" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfe1f7"/></linearGradient>`
    + `<linearGradient id="piFoot" gradientUnits="userSpaceOnUse" x1="0" y1="${SPLIT - 220}" x2="0" y2="${SPLIT}"><stop offset="0" stop-color="${DEEP}" stop-opacity="0"/><stop offset="0.6" stop-color="${DEEP}" stop-opacity="0.6"/><stop offset="1" stop-color="${DEEP}" stop-opacity="1"/></linearGradient>`
    + `<linearGradient id="piPanel" gradientUnits="userSpaceOnUse" x1="0" y1="${SPLIT}" x2="0" y2="${H}"><stop offset="0" stop-color="${DEEP}"/><stop offset="1" stop-color="#000000"/></linearGradient>`
    + `<linearGradient id="piRule" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${GOLD}"/></linearGradient>`
    + '<filter id="piShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.55"/></filter>'
    + `<pattern id="piStripes" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><rect width="22" height="64" fill="${accent}" fill-opacity="0.16"/></pattern>`;

  // ── The top ──
  let body = `<rect width="${W}" height="${H}" fill="${DEEP}"/>`
    + `<g><rect width="${W}" height="${SPLIT}" fill="url(#piBase)"/>`
    + `<rect width="${W}" height="${SPLIT}" fill="url(#piStripes)"/>`
    // His home state, huge and faint, behind everything.
    + stateIn(input.state, -60, 120, W + 120, SPLIT - 60, "#ffffff", 0.09);
  const hasPhoto = hasImage(env, input.photo);
  // The mark: his college's logo, else his high school's, else his state.
  const markLogo = hasImage(env, input.collegeLogo) ? input.collegeLogo : hasImage(env, input.hsLogo) ? input.hsLogo : "";
  if (hasPhoto) {
    const b = FIRST_PICK_PHOTO;
    const rot = input.adjust?.rotate || 0;
    const shot = image(env, input.photo, b.x, b.y, b.w, b.h, "xMidYMax meet");
    const turned = rot ? `<g transform="rotate(${r1(rot)} ${r1(b.x + b.w / 2)} ${r1(b.y + b.h / 2)})">${shot}</g>` : shot;
    body += `<ellipse cx="${W / 2}" cy="${SPLIT - 300}" rx="460" ry="420" fill="url(#piGlow)"/>`
      + `<g filter="url(#piShadow)">${placed(turned, b.x, b.y, b.w, b.h, input.adjust)}</g>`;
    // Top right: his high school's logo, when it has one (his college's
    // sits by his name below — never both in the same place twice).
    if (hasImage(env, input.hsLogo)) body += image(env, input.hsLogo, W - PAD - 190, PAD + 10, 190, 190, "xMaxYMin meet");
  } else {
    const cx = W / 2;
    const cy = 500;
    const M = 470;
    body += `<ellipse cx="${cx}" cy="${cy}" rx="420" ry="400" fill="url(#piGlow)"/>`;
    body += markLogo
      ? `<g filter="url(#piShadow)">${image(env, markLogo, cx - M / 2, cy - M / 2, M, M)}</g>`
      : `<g filter="url(#piShadow)">${stateIn(input.state, cx - M / 2, cy - M / 2, M, M, "url(#piState)", 1, "#ffffff")}</g>`;
  }
  body += `<rect y="${SPLIT - 220}" width="${W}" height="240" fill="url(#piFoot)"/></g>`
    + `<rect y="${SPLIT}" width="${W}" height="${H - SPLIT}" fill="url(#piPanel)"/>`;

  // Top left: the tag, the kicker, the commitment.
  if (input.tag) {
    const tagS = 34;
    const tagW = env.measure(input.tag, tagS) + 2 * (input.tag.length - 1) + 50;
    body += `<rect x="${PAD - 20}" y="${PAD - 22}" width="${r1(tagW)}" height="58" rx="10" fill="#000000" fill-opacity="0.5"/>`
      + `<rect x="${PAD - 20}" y="${PAD - 22}" width="8" height="58" rx="3" fill="${GOLD}"/>`
      + text(PAD + 8, PAD + 20, input.tag, tagS, "#ffffff", { spacing: 2 });
  }
  const maxKick = hasPhoto && markLogo ? W - PAD * 2 - 230 : W - PAD * 2;
  if (input.kicker) body += fitLine(env, PAD - 16, PAD + 98, input.kicker, 58, maxKick, GOLD, { spacing: 3, min: 34 }).svg;
  if (input.college) {
    const ct = `COMMITTED TO ${up(input.college)}`;
    const cs = fitSize(env, ct, 28, maxKick - 40, 18, 2);
    const cw = Math.min(maxKick, env.measure(ct, cs) + 2 * (ct.length - 1) + 36);
    body += `<rect x="${PAD - 16}" y="${PAD + 122}" width="${r1(cw)}" height="46" rx="23" fill="#ffffff" fill-opacity="0.95"/>`
      + text(PAD + 2, PAD + 155, ct, cs, shade(base, 0.25), { spacing: 2 });
  }

  // ── The bottom: his name, a logo left of it ──
  const top = SPLIT + 36;
  const W2 = W - PAD * 2;
  const LOGO = 230;
  // Left of his name, never the top's mark again: with a photo, his
  // college's logo (else his high school's); otherwise the next one down —
  // under the college, his high school (else his state); under the high
  // school, his state.
  const hsOk = hasImage(env, input.hsLogo);
  let sideLogo = "";
  // (With a photo his high school's logo is already top right.)
  if (hasPhoto) sideLogo = hasImage(env, input.collegeLogo) ? input.collegeLogo : "";
  else if (markLogo === input.collegeLogo && hsOk) sideLogo = input.hsLogo;
  const sideState = !sideLogo && !!input.state && (hasPhoto || !!markLogo);
  const hasSide = !!sideLogo || sideState;
  const nameX = hasSide ? PAD + LOGO + 30 : PAD;
  const nameW = W - PAD - nameX;
  body += fitLine(env, nameX, top + 80, up(input.first), 84, nameW, "#ffffff", { spacing: 3, opacity: 0.85, min: 40 }).svg;
  const last = up(input.last);
  body += text(nameX - 4, top + 246, last, fitSize(env, last, 186, nameW, 70, 2), "#ffffff", { spacing: 2 });
  if (sideLogo) body += image(env, sideLogo, PAD, top + 20, LOGO, LOGO);
  else if (sideState) body += stateIn(input.state, PAD + 20, top + 30, LOGO - 40, LOGO - 40, "url(#piState)", 1, "#ffffff");

  // The rule, then "QB · IMG ACADEMY · FL".
  const ruleY = top + 286;
  body += `<rect x="${PAD}" y="${ruleY}" width="${W2}" height="5" rx="2.5" fill="url(#piRule)"/>`;
  const pos = up(input.pos);
  const ps = 58;
  const posW = env.measure(pos, ps) + 2 * Math.max(0, pos.length - 1);
  const gap = 22;
  const dotX = PAD + posW + gap;
  const restX = dotX + 12 + gap;
  const rest = [input.hsName, input.stateAbbr].filter(Boolean).map(up).join("  ·  ");
  body += text(PAD, ruleY + 74, pos, ps, GOLD, { spacing: 2 });
  if (rest) {
    body += `<circle cx="${r1(dotX + 6)}" cy="${r1(ruleY + 74 - ps * 0.36)}" r="6" fill="#ffffff" fill-opacity="0.55"/>`
      + fitLine(env, restX, ruleY + 74, rest, 50, W - PAD - restX, "#ffffff", { spacing: 2, min: 26 }).svg;
  }

  // The foot: We-Draft.com's logo left, the address right.
  const fy = ruleY + 96;
  const fh = H - fy - 12;
  const im = env.images?.[input.brandLogo];
  const lh = Math.min(40, fh);
  const lw = im?.w && im?.h ? (im.w / im.h) * lh : lh * 3;
  body += image(env, input.brandLogo, PAD, fy + (fh - lh) / 2, lw, lh, "xMinYMid meet")
    + fitLine(env, W - PAD, fy + fh / 2 + 11, up(input.address), 32, W2 - lw - 30, "#ffffff", { anchor: "end", spacing: 1, opacity: 0.7, min: 20 }).svg;

  return svgDoc(env, defs, body, DEEP);
}
