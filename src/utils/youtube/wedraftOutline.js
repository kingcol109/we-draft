// src/utils/youtube/wedraftOutline.js
//
// The We-Draft outline (Admin → Content → X Posts, post type "Player
// highlight" — AdminXHighlight.jsx): the frame round a player's cut-up for X, 1920×1080
// (X's 16:9 landscape), in the site's brand: Bebas Neue (the social
// graphics' font, bundled, so env.fontCss embeds it), blue, navy and gold,
// the We-Draft logo. Plain data in, SVG out, like icecold.js's iceOutline,
// and the same input: the player's panel down the left (logo, name,
// position | size, his career table, his number on his school's faded logo),
// the video window (exactly 16:9, rounded, transparent unless filled, for
// Premiere), and a bar along the bottom (the series, the handle, the call to
// action). env: { measure (Bebas), fontCss, images }.
import { kit } from "../instagram/posts.js";

const { GOLD, BLUE, r1, up, widthOf, fitSize, text, image, hasImage } = kit;

export const WD_W = 1920;
export const WD_H = 1080;
const NAVY = "#062b57";
const DEEP = "#03152d";
const INK = "#0f1b2d";
const WHITE = "#ffffff";

const M = 36;
// The video window: exactly 16:9, so a 1080p clip scaled to 76.7% fills it.
export const WD_WINDOW = [412, M, 1472, 828];
const WIN_R = 22;
const PANEL = [M, M, WD_WINDOW[0] - M * 2, WD_WINDOW[1] + WD_WINDOW[3] - M];
const BAR_Y = WD_WINDOW[1] + WD_WINDOW[3] + 24;

const roundRect = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
const fitIn = (env, value, max, maxW, min = 12, spacing = 0) => fitSize(env, value, max, maxW, min, spacing);

// input: { first, last, sub ("WR | 6'1\" 195"), table ({ title, cols, rows:
// [{ year, logo, vals, partial }], total } | null), games (the partial
// season's), number, logo (his school's, faded behind the number), cta
// ("Evaluate on We-Draft.com" — its "We-Draft.com" goes gold), series
// ("2026 Season Cut-Up"), handle ("@wedraftsite"), brandLogo, fillWindow }.
export function wdOutline(input, env) {
  const [wx, wy, ww, wh] = WD_WINDOW;
  const style = env.fontCss ? `<style>${env.fontCss}</style>` : "";
  const defs = style
    + `<linearGradient id="wdBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${DEEP}"/><stop offset="0.55" stop-color="${NAVY}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient>`
    + `<radialGradient id="wdGlow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${GOLD}" stop-opacity="0.28"/><stop offset="1" stop-color="${GOLD}" stop-opacity="0"/></radialGradient>`
    + `<clipPath id="wdOutside"><path clip-rule="evenodd" d="M0 0H${WD_W}V${WD_H}H0Z ${roundRect(wx, wy, ww, wh, WIN_R)}"/></clipPath>`
    + `<filter id="wdCard" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.35"/></filter>`
    + `<filter id="wdNum" x="-10%" y="-10%" width="130%" height="130%"><feDropShadow dx="6" dy="7" stdDeviation="0" flood-color="${DEEP}" flood-opacity="0.6"/></filter>`;

  // The brand ground everywhere but the window, with faint diagonal bars.
  const ground = `<rect width="${WD_W}" height="${WD_H}" fill="url(#wdBg)"/>`
    + Array.from({ length: 12 }, (_, k) => `<rect x="${k * 200 - 200}" y="-200" width="46" height="1500" fill="${WHITE}" fill-opacity="0.03" transform="skewX(-22)"/>`).join("")
    + `<circle cx="${PANEL[0] + PANEL[2] / 2}" cy="760" r="300" fill="url(#wdGlow)"/>`;
  let body = `<g clip-path="url(#wdOutside)">${ground}</g>`;
  if (input.fillWindow) body = `<rect width="${WD_W}" height="${WD_H}" fill="#0b1220"/>` + body;
  // The window's gold edge.
  body += `<path d="${roundRect(wx - 3, wy - 3, ww + 6, wh + 6, WIN_R + 3)}" fill="none" stroke="${GOLD}" stroke-width="6"/>`;

  // ── The panel ──
  const [px, py, pw] = PANEL;
  const cx = px + pw / 2;
  let y = py + 6;
  const brand = env.images?.[input.brandLogo];
  if (brand?.href) {
    const bw = Math.min(pw - 20, 300);
    const bh = brand.w && brand.h ? (bw * brand.h) / brand.w : bw / 4;
    body += image(env, input.brandLogo, cx - bw / 2, y, bw, bh);
    y += bh + 34;
  } else {
    y += 40;
  }
  const first = up(input.first);
  const last = up(input.last);
  const fs = fitIn(env, first, 70, pw - 10, 30, 2);
  const ls = fitIn(env, last, 118, pw - 10, 44, 2);
  body += text(cx, y + fs * 0.72, first, fs, WHITE, { anchor: "middle", spacing: 2, opacity: 0.92 });
  y += fs * 0.72 + 8;
  body += text(cx, y + ls * 0.74, last, ls, WHITE, { anchor: "middle", spacing: 2 });
  y += ls * 0.74 + 14;
  if (input.sub) {
    const ss = fitIn(env, up(input.sub), 44, pw - 20, 22, 1.5);
    body += text(cx, y + ss * 0.75, up(input.sub), ss, GOLD, { anchor: "middle", spacing: 1.5 });
    y += ss * 0.75 + 22;
  }

  // His career table, a card.
  const t = input.table;
  if (t && t.rows?.length) {
    const x = px;
    const w = pw;
    const headH = 46;
    const colH = 32;
    const rowH = t.rows.length > 4 ? 36 : 40;
    const totH = 44;
    const h = headH + colH + rowH * t.rows.length + totH;
    const sznW = 62;
    const teamW = 44;
    const statW = (w - sznW - teamW) / Math.max(1, t.cols.length);
    const colX = (i) => x + sznW + teamW + statW * i + statW / 2;
    const vs = (vals) => Math.min(30, ...vals.map((v) => fitIn(env, v, 30, statW - 8, 14)));
    let card = `<rect x="${x}" y="${r1(y)}" width="${w}" height="${r1(h)}" rx="14" fill="${WHITE}"/>`
      + `<path d="M${x} ${r1(y + headH)}V${r1(y + 14)}Q${x} ${r1(y)} ${x + 14} ${r1(y)}H${x + w - 14}Q${x + w} ${r1(y)} ${x + w} ${r1(y + 14)}V${r1(y + headH)}Z" fill="${BLUE}"/>`
      + `<rect x="${x}" y="${r1(y + headH - 4)}" width="${w}" height="4" fill="${GOLD}"/>`
      + text(x + w / 2, y + 34, up(t.title), fitIn(env, up(t.title), 34, w - 30, 16, 3), WHITE, { anchor: "middle", spacing: 3 });
    let ry = y + headH;
    card += `<rect x="${x}" y="${r1(ry)}" width="${w}" height="${colH}" fill="#e6eef8"/>`;
    const hs = 22;
    card += text(x + sznW / 2, ry + 24, "SZN", hs, NAVY, { anchor: "middle", spacing: 1 })
      + text(x + sznW + teamW / 2, ry + 24, "TEAM", fitIn(env, "TEAM", hs, teamW - 4, 12, 1), NAVY, { anchor: "middle", spacing: 1 });
    t.cols.forEach((c, i) => { card += text(colX(i), ry + 24, up(c), fitIn(env, up(c), hs, statW - 6, 12, 1), NAVY, { anchor: "middle", spacing: 1 }); });
    ry += colH;
    const rs = vs(t.rows.flatMap((r) => r.vals));
    t.rows.forEach((r, k) => {
      if (k % 2) card += `<rect x="${x}" y="${r1(ry)}" width="${w}" height="${rowH}" fill="#f3f7fc"/>`;
      const by = ry + rowH / 2 + rs * 0.36;
      const yr = r.partial ? `${r.year}*` : r.year;
      card += text(x + sznW / 2 + 2, by, yr, Math.min(rs, 28, fitIn(env, `${r.year}*`, 28, sznW - 10, 14)), INK, { anchor: "middle" });
      const lg = rowH - 10;
      card += image(env, r.logo, x + sznW + (teamW - lg) / 2, ry + 5, lg, lg);
      r.vals.forEach((v, i) => { card += text(colX(i), by, v, rs, INK, { anchor: "middle" }); });
      ry += rowH;
    });
    card += `<path d="M${x} ${r1(ry)}H${x + w}V${r1(ry + totH - 14)}Q${x + w} ${r1(ry + totH)} ${x + w - 14} ${r1(ry + totH)}H${x + 14}Q${x} ${r1(ry + totH)} ${x} ${r1(ry + totH - 14)}Z" fill="${NAVY}"/>`;
    const ts = Math.min(30, vs(t.total));
    card += text(x + (sznW + teamW) / 2, ry + totH / 2 + 10, "CAREER", 26, GOLD, { anchor: "middle", spacing: 1.5 });
    t.total.forEach((v, i) => { card += text(colX(i), ry + totH / 2 + ts * 0.36, v, ts, WHITE, { anchor: "middle" }); });
    body += `<g filter="url(#wdCard)">${card}</g>`;
    y += h;
    const partial = t.rows.find((r) => r.partial);
    if (partial && input.games) {
      const note = `*${partial.year} STATS THROUGH ${input.games} GAME${input.games === 1 ? "" : "S"}`;
      body += text(cx, y + 34, note, fitIn(env, note, 24, w, 12, 1), WHITE, { anchor: "middle", spacing: 1, opacity: 0.8 });
      y += 34;
    }
  }

  // His number on his school's faded logo, in what's left of the panel.
  const bottom = PANEL[1] + PANEL[3];
  const top = y + 24;
  const room = bottom - top;
  const num = String(input.number ?? "").replace(/^#/, "").trim();
  if (room > 60) {
    if (hasImage(env, input.logo)) {
      body += num
        ? image(env, input.logo, px + 10, top - 10, pw - 20, room + 10, "xMidYMid meet", 0.28)
        : image(env, input.logo, px + 30, top, pw - 60, Math.min(240, room), "xMidYMid meet");
    }
    if (num) {
      const hs = (n) => n * 0.42;
      const half = (n) => widthOf(env, num, n) / 2 + 8 + widthOf(env, "#", hs(n));
      const n = Math.min(room * 0.92, 260, Math.floor((260 * (pw / 2 - 12)) / Math.max(1, half(260))));
      const left = cx - widthOf(env, num, n) / 2;
      const base = top + room / 2 + n * 0.36;
      body += `<g filter="url(#wdNum)">`
        + text(left - 8, base - n * 0.36, "#", hs(n), GOLD, { anchor: "end" })
        + text(cx, base, num, n, WHITE, { anchor: "middle" })
        + "</g>";
    }
  }

  // ── The bar along the bottom ──
  const barH = WD_H - BAR_Y - M + 10;
  const series = up(input.series || "");
  const handle = input.handle ? up(input.handle) : "";
  if (series) {
    const ss = fitIn(env, series, 40, pw - 44, 20, 2);
    const sw = Math.min(pw, widthOf(env, series, ss, 2) + 44);
    const sy = BAR_Y + (handle ? 22 : barH / 2 - 30);
    body += `<rect x="${px}" y="${r1(sy)}" width="${r1(sw)}" height="60" rx="30" fill="${GOLD}"/>`
      + text(px + sw / 2, sy + 30 + ss * 0.36, series, ss, NAVY, { anchor: "middle", spacing: 2 });
  }
  if (handle) {
    const hs2 = fitIn(env, handle, 40, pw, 20, 2);
    body += text(px + 4, BAR_Y + (series ? 128 : barH / 2 + 14), handle, hs2, WHITE, { spacing: 2, opacity: 0.85 });
  }
  // The call to action, centered under the window; "We-Draft.com" in gold.
  const cta = up(input.cta || "");
  if (cta) {
    const cs = fitIn(env, cta, 124, ww - 60, 40, 3);
    const cy = BAR_Y + barH / 2 + cs * 0.36;
    const at = cta.indexOf("WE-DRAFT.COM");
    if (at >= 0) {
      const head = cta.slice(0, at);
      const tail = cta.slice(at);
      const total = widthOf(env, cta, cs, 3);
      const x0 = wx + ww / 2 - total / 2;
      body += text(x0, cy, head, cs, WHITE, { spacing: 3 })
        + text(x0 + widthOf(env, head, cs, 3) + (head ? 3 : 0), cy, tail, cs, GOLD, { spacing: 3 });
    } else {
      body += text(wx + ww / 2, cy, cta, cs, WHITE, { anchor: "middle", spacing: 3 });
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WD_W}" height="${WD_H}" viewBox="0 0 ${WD_W} ${WD_H}"><defs>${defs}</defs>${body}</svg>`;
}

export const wdOutlineImageUrls = (input) => [...new Set([input.brandLogo, input.logo, ...(input.table?.rows || []).map((r) => r.logo)].filter(Boolean))];
