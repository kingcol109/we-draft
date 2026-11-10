// src/utils/x/graphics.js
//
// The X post's player card (Admin → Content → X Posts, AdminX.jsx): 1600×900,
// the 16:9 X shows whole in a timeline. Drawn like the Instagram posts — plain
// data in, SVG out — with the same kit, on X's own canvas.
import { kit, IG_FONT } from "../instagram/posts.js";
import { textOn } from "../teamColors.js";

const { GOLD, NAVY, DOT, FOCUS_X, hex, up, r1, widthOf, fitSize, text, fitLine, image, hasImage, placed } = kit;

export const X_W = 1600;
export const X_H = 900;
const PAD = 70;
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;

// The card's input. school: the schools doc; photo: { url, orientation };
// chips: up to three { value, label }.
export function xCardInput({ player = {}, school = {}, photo = null, kicker = "", chips = [], brandLogo = "", focus = "", adjust = null }) {
  return {
    first: player.First || "", last: player.Last || "", pos: player.Position || "", school: player.School || "", year: String(player.Eligible || ""),
    color: hex(school.Color1) || NAVY, color2: hex(school.Color2) || GOLD, logoDark: school.LogoDark || school.Logo1 || "",
    photo: photo?.url || "", focus: focus || (photo?.orientation === "left" ? "right" : photo?.orientation === "right" ? "left" : "center"),
    kicker, chips, brandLogo, adjust,
  };
}

export function xCard(input, env) {
  const bg = input.color;
  const deep = shade(bg, 0.28);
  const ink = textOn(deep, input.color2);
  const left = 900;
  const fontStyle = env.fontCss ? `<style>${env.fontCss}</style>` : "";
  const defs = `${fontStyle}<linearGradient id="xWash" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${deep}"/><stop offset="0.55" stop-color="${shade(bg, 0.7)}"/><stop offset="1" stop-color="${bg}"/></linearGradient>`
    + '<filter id="xShadow" x="-20%" y="-10%" width="140%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.55"/></filter>';
  let body = `<rect width="${X_W}" height="${X_H}" fill="url(#xWash)"/>`
    + Array.from({ length: 9 }, (_, k) => `<rect x="${k * 220 + 120}" y="-120" width="44" height="1200" fill="#ffffff" fill-opacity="0.035" transform="skewX(-22)"/>`).join("")
    + image(env, input.logoDark, left - 40, 40, 780, 780, "xMidYMid meet", hasImage(env, input.photo) ? 0.14 : 0.3);
  if (hasImage(env, input.photo)) {
    const box = [left - 90, 30, X_W - left + 90, X_H - 30];
    body += `<g filter="url(#xShadow)">${placed(image(env, input.photo, ...box, `${FOCUS_X[input.focus] || "xMid"}YMax meet`), ...box, input.adjust)}</g>`;
  }
  // Its text, down the left.
  const w = left - PAD - 20;
  let y = 96;
  if (input.kicker) {
    const k = up(input.kicker);
    const ks = fitSize(env, k, 40, w - 44, 20, 2);
    const kw = widthOf(env, k, ks, 2) + 44;
    body += `<rect x="${PAD}" y="${y - 44}" width="${r1(kw)}" height="64" rx="32" fill="${GOLD}"/>` + text(PAD + 22, y - 12 + ks * 0.18, k, ks, NAVY, { spacing: 2 });
    y += 40;
  }
  const lastS = fitSize(env, up(input.last), 230, w, 90, 2);
  const chips = (input.chips || []).filter((c) => c && (c.value || c.label)).slice(0, 3);
  // Anchored to the middle of what's left above the chips and footer line.
  const block = 90 + lastS * 0.85 + 70;
  const room = (chips.length ? 640 : 800) - y;
  const top = y + Math.max(10, (room - block) / 2);
  body += fitLine(env, PAD, top + 76, up(input.first), 92, w, ink, { spacing: 3 }).svg
    + text(PAD - 3, top + 86 + lastS * 0.85, up(input.last), lastS, ink, { spacing: 2 });
  const info = up([input.pos, input.school, input.year && `${input.year} CLASS`].filter(Boolean).join(DOT));
  const lg = hasImage(env, input.logoDark) ? 60 : 0;
  const iy = top + 86 + lastS * 0.85 + 66;
  body += image(env, input.logoDark, PAD, iy - 47, lg, lg)
    + fitLine(env, PAD + (lg ? lg + 14 : 0), iy, info, 50, w - (lg ? lg + 14 : 0), ink, { spacing: 1.5, opacity: 0.92 }).svg;
  if (chips.length) {
    const ch = 118;
    const gap = 14;
    const cw = (w - gap * (chips.length - 1)) / chips.length;
    const cy = 680;
    chips.forEach((c, i) => {
      const cx = PAD + i * (cw + gap);
      body += `<rect x="${r1(cx)}" y="${cy}" width="${r1(cw)}" height="${ch}" rx="16" fill="#000000" fill-opacity="0.3"/><rect x="${r1(cx)}" y="${cy}" width="7" height="${ch}" rx="3" fill="${GOLD}"/>`
        + fitLine(env, cx + cw / 2 + 4, cy + 66, up(c.value), 60, cw - 30, ink, { anchor: "middle", spacing: 1 }).svg
        + fitLine(env, cx + cw / 2 + 4, cy + 100, up(c.label), 26, cw - 30, ink, { anchor: "middle", spacing: 1.5, opacity: 0.82 }).svg;
    });
  }
  // The foot: a gold rule and the logo.
  const im = env.images?.[input.brandLogo];
  const bh = 44;
  const bw = im?.w && im?.h ? (im.w / im.h) * bh : bh * 3;
  body += `<rect x="0" y="${X_H - 6}" width="${X_W}" height="6" fill="${GOLD}"/>`
    + image(env, input.brandLogo, PAD, X_H - bh - 26, bw, bh, "xMinYMid meet");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${X_W}" height="${X_H}" viewBox="0 0 ${X_W} ${X_H}" font-family="${IG_FONT}"><defs>${defs}</defs>${body}</svg>`;
}

export const xCardImageUrls = (input) => [...new Set([input.brandLogo, input.photo, input.logoDark].filter(Boolean))];
