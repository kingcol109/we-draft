// src/utils/youtube/filmlive.js
//
// The Film Breakdown Live outline (Admin → Videos → Graphics → Outline,
// template "Film Breakdown Live" — AdminYouTubeGraphics.jsx): the frame round
// the live stream's film, 1920×1080, plain data in, SVG out. The King Cold
// Sports stream frame: a flat ground (the site's blue, or his school's
// color), the King Cold Sports logo across the top, the video window down
// the left (16:9, a border in the accent — the site's gold or his school's
// second color — transparent unless filled), the We-Draft logo under it in
// white, and a white card down the right with the player: a red LIVE tag,
// FILM BREAKDOWN, his name, position | size, his career table, his number
// on his school's faded logo.
//
// env: { measure(text, size, which) — which = "name" (Black Lives) |
// "headline" (Milker) | "plain" (Arial bold, the table), fontCss, images }.
import { kit } from "../instagram/posts.js";
import { GR_NAME_FONT, GR_HEAD_FONT } from "./gamereview.js";

const { esc, r1 } = kit;

export const FL_W = 1920;
export const FL_H = 1080;
const NAME_CSS = `'${GR_NAME_FONT}', 'Black Lives', 'Arial Black', sans-serif`;
const HEAD_CSS = `'${GR_HEAD_FONT}', 'Milker', 'Arial Black', sans-serif`;
const PLAIN_CSS = "Arial, 'Helvetica Neue', sans-serif";
const CSS = { name: NAME_CSS, headline: HEAD_CSS, plain: PLAIN_CSS };
const WHITE = "#ffffff";
const INK = "#0f1b2d";
const LIVE_RED = "#e3192b";

const hex = (v, fb) => (/^#?[0-9a-f]{6}$/i.test(String(v || "").trim()) ? `#${String(v).trim().replace("#", "").toLowerCase()}` : fb);
const shade = (h, f) => `#${[1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")}`;
// Light enough that it won't read on white?
const light = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return r * 0.299 + g * 0.587 + b * 0.114 > 165; };

function txt(x, y, value, size, fill, which, o = {}) {
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${CSS[which]}" font-size="${r1(size)}"${which === "plain" ? ' font-weight="800"' : ""} fill="${fill}"`
    + `${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""}${o.spacing ? ` letter-spacing="${r1(o.spacing)}"` : ""}`
    + `${o.opacity != null && o.opacity < 1 ? ` fill-opacity="${o.opacity}"` : ""}${o.filter ? ` filter="url(#${o.filter})"` : ""}>${esc(value)}</text>`;
}
const widthIn = (env, value, size, which) => env.measure(String(value), size, which);
const fit = (env, value, max, maxW, which, min = 10) => {
  const w = widthIn(env, value, max, which);
  return w <= maxW ? max : Math.max(min, Math.floor((max * maxW) / Math.max(1, w)));
};
function img(env, url, x, y, w, h, par = "xMidYMid meet", extra = "") {
  const im = url && env.images?.[url];
  if (!im?.href || w <= 0 || h <= 0) return "";
  return `<image x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="${par}" href="${im.href}"${extra}/>`;
}
const roundRect = (x, y, w, h, r) => `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;

const FRAME = 16;
// The video window (inside its border): [x, y, w, h] — 16:9.
export const FL_WINDOW = [49, 161, 1376, 774];
// The card down the right, under the room left for the host's camera (top
// right, above the card — the ground, nothing drawn): [x, y, w, h].
const CARD = [1477, 355, 411, 700];
export const FL_CAMERA = [1457, 0, 463, 340];
const CARD_LINE = 10;

// input: { first, last, sub ("WR | 6'1\" 195"), table ({ title, cols, rows:
// [{ year, logo, vals, partial }], total } | null), games, number, logo (his
// school's), color (the ground — the site's blue or his school's Color1),
// accent (the window's border and the card's — gold or Color2), title ("FILM
// BREAKDOWN"), live (the red LIVE tag; default on), topLogo (King Cold
// Sports), brandLogo (We-Draft), logoWhite, fillWindow }.
export function flOutline(input, env) {
  const ground = hex(input.color, "#0055a5");
  const accent = hex(input.accent, "#f6a21d");
  // The words on the white card: the ground, darkened if it's too light to read.
  const ink = light(ground) ? shade(ground, 0.45) : ground;
  const defs = (env.fontCss ? `<style>${env.fontCss}</style>` : "")
    + `<filter id="flCard" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000" flood-opacity="0.25"/></filter>`
    + `<filter id="flWhite"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>`;
  const [wx, wy, ww, wh] = FL_WINDOW;
  // The ground everywhere but the window (unless it's filled).
  let body = input.fillWindow
    ? `<rect width="${FL_W}" height="${FL_H}" fill="${ground}"/>`
    : `<path fill-rule="evenodd" fill="${ground}" d="M0 0H${FL_W}V${FL_H}H0Z M${wx} ${wy}H${wx + ww}V${wy + wh}H${wx}Z"/>`;
  // The window's border.
  body += `<path fill-rule="evenodd" fill="${accent}" d="M${wx - FRAME} ${wy - FRAME}H${wx + ww + FRAME}V${wy + wh + FRAME}H${wx - FRAME}Z M${wx} ${wy}H${wx + ww}V${wy + wh}H${wx}Z"/>`;

  // King Cold Sports across the top, We-Draft under the window: centered on it.
  const wcx = wx + ww / 2;
  const top = env.images?.[input.topLogo];
  if (top?.href) {
    const h = 112;
    const w = Math.min(1100, top.w && top.h ? (h * top.w) / top.h : 1100);
    body += img(env, input.topLogo, wcx - w / 2, (wy - FRAME - h) / 2, w, h);
  }
  const brand = env.images?.[input.brandLogo];
  if (brand?.href) {
    const y0 = wy + wh + FRAME + 12;
    const h = FL_H - y0 - 12;
    body += img(env, input.brandLogo, wcx - 560, y0, 1120, h, "xMidYMid meet", input.logoWhite !== false ? ' filter="url(#flWhite)"' : "");
  }

  // The card.
  const [cx0, cy0, cw, ch] = CARD;
  body += `<path d="${roundRect(cx0, cy0, cw, ch, 44)}" fill="${accent}"/>`
    + `<path d="${roundRect(cx0 + CARD_LINE, cy0 + CARD_LINE, cw - CARD_LINE * 2, ch - CARD_LINE * 2, 36)}" fill="${WHITE}"/>`;
  const cx = cx0 + cw / 2;
  const inner = cw - CARD_LINE * 2 - 30;
  // The card's words are drawn apart, to shrink them (about the card's top) if they don't fit.
  const frame = body;
  body = "";
  const start = cy0 + CARD_LINE + 24;
  const bottom = cy0 + ch - CARD_LINE - 20;
  let y = start;

  // LIVE, then FILM BREAKDOWN.
  if (input.live !== false) {
    const ls = 40;
    const h = 58;
    const dot = 9;
    const w = widthIn(env, "LIVE", ls, "headline") + dot * 2 + 16 + 44;
    const x = cx - w / 2;
    body += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${h}" rx="12" fill="${LIVE_RED}"/>`
      + `<circle cx="${r1(x + 22 + dot)}" cy="${r1(y + h / 2)}" r="${dot}" fill="${WHITE}"/>`
      + txt(x + 22 + dot * 2 + 16, y + h / 2 + ls * 0.36, "LIVE", ls, WHITE, "headline");
    y += h + 20;
  }
  const title = String(input.title ?? "FILM BREAKDOWN").toUpperCase().trim();
  if (title) {
    // One line if it fits big enough, else a word a line.
    const one = fit(env, title, 60, inner, "headline", 12);
    const lines = one >= 46 || !title.includes(" ") ? [title] : title.split(/\s+/);
    const ts = Math.min(60, ...lines.map((t) => fit(env, t, 60, inner, "headline", 20)));
    lines.forEach((t, i) => { body += txt(cx, y + ts * 0.8 + i * ts * 0.98, t, ts, ink, "headline", { anchor: "middle" }); });
    y += ts * 0.86 + (lines.length - 1) * ts * 0.98 + 22;
  }
  body += `<rect x="${r1(cx - inner / 2)}" y="${r1(y)}" width="${r1(inner)}" height="5" rx="2.5" fill="${accent}"/>`;
  y += 5 + 22;

  // His name and his line.
  const first = String(input.first || "").toUpperCase();
  const last = String(input.last || "").toUpperCase();
  const ns = Math.min(fit(env, first, 80, inner, "name", 28), fit(env, last, 80, inner, "name", 28));
  if (first || last) {
    body += txt(cx, y + ns * 0.8, first, ns, ink, "name", { anchor: "middle" })
      + txt(cx, y + ns * 1.72, last, ns, ink, "name", { anchor: "middle" });
    y += ns * 1.8 + 10;
  }
  if (input.sub) {
    const ss = fit(env, input.sub, 34, inner, "headline", 16);
    body += txt(cx, y + ss * 0.8, input.sub, ss, INK, "headline", { anchor: "middle" });
    y += ss + 20;
  }

  // The career table: header and career line in the ground's color.
  const t = input.table;
  if (t && t.rows?.length) {
    const x = cx0 + CARD_LINE + 10;
    const w = cw - CARD_LINE * 2 - 20;
    const headH = 40;
    const colH = 28;
    const rowH = t.rows.length > 4 ? 32 : 36;
    const totH = 38;
    const h = headH + colH + rowH * t.rows.length + totH;
    const sznW = 64;
    const teamW = 40;
    const statW = (w - sznW - teamW) / Math.max(1, t.cols.length);
    const colX = (i) => x + sznW + teamW + statW * i + statW / 2;
    const vs = (vals) => Math.min(20, ...vals.map((v) => fit(env, v, 20, statW - 8, "plain", 10)));
    let card = `<path d="M${x} ${r1(y + headH)}V${r1(y + 12)}Q${x} ${r1(y)} ${x + 12} ${r1(y)}H${x + w - 12}Q${x + w} ${r1(y)} ${x + w} ${r1(y + 12)}V${r1(y + headH)}Z" fill="${ink}"/>`;
    const tt = String(t.title).toUpperCase();
    card += txt(x + w / 2, y + 30, tt, fit(env, tt, 26, w - 24, "headline", 14), WHITE, "headline", { anchor: "middle" });
    let ry = y + headH;
    card += `<rect x="${x}" y="${r1(ry)}" width="${w}" height="${colH}" fill="${ink}" fill-opacity="0.12"/>`;
    const hs = 14;
    card += txt(x + sznW / 2, ry + 19, "SZN", hs, INK, "plain", { anchor: "middle" }) + txt(x + sznW + teamW / 2, ry + 19, "TEAM", fit(env, "TEAM", hs, teamW - 4, "plain", 8), INK, "plain", { anchor: "middle" });
    t.cols.forEach((c, i) => { card += txt(colX(i), ry + 19, c, fit(env, c, hs, statW - 6, "plain", 8), INK, "plain", { anchor: "middle" }); });
    ry += colH;
    const rs = vs(t.rows.flatMap((r) => r.vals));
    t.rows.forEach((r, k) => {
      if (k % 2) card += `<rect x="${x}" y="${r1(ry)}" width="${w}" height="${rowH}" fill="${ink}" fill-opacity="0.06"/>`;
      const by = ry + rowH / 2 + rs * 0.36;
      const yr = r.partial ? `${r.year}*` : r.year;
      card += txt(x + sznW / 2 + 2, by, yr, Math.min(rs, 18, fit(env, `${r.year}*`, 18, sznW - 10, "plain", 10)), INK, "plain", { anchor: "middle" });
      const ls = rowH - 8;
      card += img(env, r.logo, x + sznW + (teamW - ls) / 2, ry + 4, ls, ls);
      r.vals.forEach((v, i) => { card += txt(colX(i), by, v, rs, INK, "plain", { anchor: "middle" }); });
      ry += rowH;
    });
    card += `<path d="M${x} ${r1(ry)}H${x + w}V${r1(ry + totH - 12)}Q${x + w} ${r1(ry + totH)} ${x + w - 12} ${r1(ry + totH)}H${x + 12}Q${x} ${r1(ry + totH)} ${x} ${r1(ry + totH - 12)}Z" fill="${ink}"/>`;
    const ts = Math.min(20, vs(t.total));
    card += txt(x + (sznW + teamW) / 2, ry + totH / 2 + 8, "CAREER", 21, WHITE, "headline", { anchor: "middle" });
    t.total.forEach((v, i) => { card += txt(colX(i), ry + totH / 2 + ts * 0.36, v, ts, WHITE, "plain", { anchor: "middle" }); });
    body += card;
    y += h;
    const partial = t.rows.find((r) => r.partial);
    if (partial && input.games) {
      const note = `*${partial.year} STATS THROUGH ${input.games} GAME${input.games === 1 ? "" : "S"}`;
      body += txt(cx, y + 26, note, fit(env, note, 15, w, "plain", 9), INK, "plain", { anchor: "middle", opacity: 0.75 });
      y += 26;
    }
  }

  if (y > bottom) {
    const s = (bottom - start) / (y - start);
    body = `${frame}<g transform="translate(${r1(cx)} ${start}) scale(${s.toFixed(4)}) translate(${r1(-cx)} ${-start})">${body}</g>`;
    y = bottom;
  } else body = frame + body;

  // What's left of the card: his school's logo, faded under his number (or on its own).
  const logoTop = y + 20;
  const logoH = bottom - logoTop;
  const num = String(input.number ?? "").replace(/^#/, "").trim();
  if (logoH > 60 && input.logo) {
    if (num) body += img(env, input.logo, cx0 + 30, logoTop, cw - 60, logoH, "xMidYMid meet", ' opacity="0.22"');
    else body += img(env, input.logo, cx0 + 40, logoTop, cw - 80, Math.min(220, logoH), "xMidYMid meet", ' filter="url(#flCard)"');
  }
  if (num && logoH > 60) {
    const hs = (n) => n * 0.45;
    const half = (n) => widthIn(env, num, n, "headline") / 2 + 6 + widthIn(env, "#", hs(n), "headline");
    const n = Math.min(logoH * 0.85, 200, Math.floor((200 * (inner / 2)) / Math.max(1, half(200))));
    const left = cx - widthIn(env, num, n, "headline") / 2;
    const base = logoTop + logoH / 2 + n * 0.36;
    body += txt(left - 6, base - n * 0.38, "#", hs(n), ink, "headline", { anchor: "end" })
      + txt(cx, base, num, n, ink, "headline", { anchor: "middle" });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FL_W}" height="${FL_H}" viewBox="0 0 ${FL_W} ${FL_H}"><defs>${defs}</defs>${body}</svg>`;
}
export const flOutlineImageUrls = (input) => [...new Set([input.logo, input.topLogo, input.brandLogo, ...(input.table?.rows || []).map((r) => r.logo)].filter(Boolean))];
