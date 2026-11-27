// src/components/videoAssets/playResult.js
//
// Assets → Play Results (user, 2026-11-25): short animations dropped on at
// the END of a play — what just happened, stamped big: TOUCHDOWN, SACK,
// PICK SIX, DROP… A slanted bar wipes in, the word slams down onto it
// (overshoot, flash, a little shake), an optional detail tag ("+45 YDS", the
// player's name) slides out under it, a shine runs across, and it wipes off.
// ~1.5 s by default (1–4).
//
// Tone: a good play in the look's colors (site blue + gold, or the team's);
// a MISS (drop, missed tackle…) on a dark bar with red — never red on a red
// tag, the look's own fill isn't used for it. Built for the breakdowns'
// vibe: Bebas Neue + Barlow Condensed, flat slanted panels. 1920×1080,
// transparent; draggable and sizable.
import { loadImage } from "../AdminSideGraphics";

export const RESULT_SECONDS = [1, 1.5, 2, 2.5, 3, 4];
export const RESULT_DEFAULT_SECONDS = 1.5;
// The presets, grouped; a miss defaults to the miss tone.
export const RESULT_PRESETS = [
  ["Offense", ["TOUCHDOWN", "FIRST DOWN", "BIG PLAY", "EXPLOSIVE PLAY", "CONTESTED CATCH", "TOE TAP", "BROKEN TACKLE", "HOUSE CALL", "CONVERTED"]],
  ["Defense", ["SACK", "INTERCEPTION", "PICK SIX", "PASS BREAKUP", "FORCED FUMBLE", "FUMBLE RECOVERY", "TACKLE FOR LOSS", "STUFFED", "STOP"]],
  ["Misses", ["DROP", "MISSED TACKLE", "FUMBLE", "INCOMPLETE", "BEATEN", "FLAG"]],
];
export const MISS_PRESETS = RESULT_PRESETS[2][1];
export const DEFAULT_RESULT = {
  preset: "TOUCHDOWN", text: "", detail: "", name: false, tone: "auto", logo: true,
  x: 960, y: 860, s: 1, exit: true,
};
const DISP = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
const disp = (s) => `${s}px ${DISP}`;
const MISS = { fill: "#14171f", fill2: "#262b36", accent: "#d23c3c", ink: "#ffffff" };
const SKEW = -0.21; // ~12°
const BAR_H = 180;
const TEXT = 150;

const ease = (p) => 1 - (1 - p) ** 3;
const easeBack = (p) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// The words: the result, and the detail tag (detail and/or the player's name).
export function resultWords(a) {
  const r = { ...DEFAULT_RESULT, ...(a.result || {}) };
  const main = String(r.text || r.preset || "").trim().toUpperCase();
  const name = r.name ? `${a.first || ""} ${a.last || ""}`.trim().toUpperCase() : "";
  const tag = [name, String(r.detail || "").trim().toUpperCase()].filter(Boolean).join(" · ");
  return { main, tag };
}
// Good or miss: "auto" follows the preset (a miss preset → miss).
export function resultTone(r) {
  const x = { ...DEFAULT_RESULT, ...(r || {}) };
  if (x.tone === "good" || x.tone === "miss") return x.tone;
  return !String(x.text || "").trim() && MISS_PRESETS.includes(x.preset) ? "miss" : "good";
}

// A slanted panel (a parallelogram leaning right).
function slant(ctx, x, y, w, h) {
  const d = -SKEW * h;
  ctx.beginPath();
  ctx.moveTo(x + d, y);
  ctx.lineTo(x + w + d, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

// One frame. a: the asset (+ look, result, seconds); t: 0–1, undefined = still.
// Leaves canvas.resultBox (its bounds, for dragging).
export async function drawPlayResult(canvas, a, t, bg = null) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  const r = { ...DEFAULT_RESULT, ...(a.result || {}) };
  const tone = resultTone(r);
  const L = tone === "miss" ? MISS : { fill: a.look.fill, fill2: a.look.fill2, accent: a.look.accent, ink: a.look.ink };
  const logo = r.logo && a.look.logo ? await loadImage(a.look.logo) : null;
  const { main, tag } = resultWords(a);

  const dur = a.seconds || RESULT_DEFAULT_SECONDS;
  const sec = t == null ? null : t * dur;
  const EXIT = 0.25;
  // The build takes 0.7 s; squeezed into a 1 s clip.
  const k = Math.min(1, (dur - (r.exit ? EXIT : 0) - 0.1) / 0.7);
  const ph = (x, y) => (sec == null ? 1 : ease(clamp01((sec - x * k) / ((y - x) * k))));
  const pop = (x, y) => (sec == null ? 1 : easeBack(clamp01((sec - x * k) / ((y - x) * k))));
  const out = r.exit && sec != null ? ease(clamp01((sec - (dur - EXIT)) / EXIT)) : 0;

  // Measure: the logo block, the word, the bar around them.
  ctx.font = disp(TEXT);
  let size = TEXT;
  while (size > 60 && ctx.measureText(main).width > 1300) { size -= 4; ctx.font = disp(size); }
  const textW = ctx.measureText(main).width;
  const LOGO = logo ? BAR_H : 0;
  const barW = LOGO + 60 + textW + 70;
  ctx.font = disp(58);
  const tagW = tag ? Math.min(1100, ctx.measureText(tag).width) + 70 : 0;
  const S = r.s;
  const x0 = -barW / 2;
  const y0 = -BAR_H / 2;
  canvas.resultBox = { x: r.x + (x0 - 40) * S, y: r.y + y0 * S, w: (barW + 80) * S, h: (BAR_H + (tag ? 90 : 0)) * S };

  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale(S, S);
  // A little shake as the word lands.
  if (sec != null) {
    const q = clamp01((sec - 0.2 * k) / (0.14 * k));
    if (q > 0 && q < 1) ctx.translate(Math.sin(q * 40) * 7 * (1 - q), Math.cos(q * 33) * 4 * (1 - q));
  }

  // The bar: wiped in from the left; wiped off to the right at the exit.
  const pb = ph(0, 0.2);
  const reveal = (fn, extra = 0) => {
    ctx.save();
    ctx.beginPath();
    const left = x0 - 60 - extra + (barW + 120 + extra * 2) * out;
    ctx.rect(left, y0 - 40, (barW + 120 + extra * 2) * pb * (1 - out), BAR_H + 200);
    ctx.clip();
    fn();
    ctx.restore();
  };
  reveal(() => {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 10;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + BAR_H);
    g.addColorStop(0, L.fill);
    g.addColorStop(1, L.fill2);
    ctx.fillStyle = g;
    slant(ctx, x0, y0, barW, BAR_H);
    ctx.fill();
    ctx.restore();
    // Accent edges, and the logo block in the accent.
    ctx.save();
    slant(ctx, x0, y0, barW, BAR_H);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    for (let x = x0 - BAR_H; x < x0 + barW + BAR_H; x += 14) { ctx.beginPath(); ctx.moveTo(x, y0 + BAR_H); ctx.lineTo(x + BAR_H, y0); ctx.stroke(); }
    ctx.fillStyle = L.accent;
    ctx.fillRect(x0 - 60, y0, barW + 120, 9);
    ctx.fillRect(x0 - 60, y0 + BAR_H - 9, barW + 120, 9);
    if (logo) {
      slant(ctx, x0, y0, LOGO, BAR_H);
      ctx.fill();
    }
    // The flash as the word lands.
    const fl = sec == null ? 0 : Math.sin(Math.PI * clamp01((sec - 0.16 * k) / (0.2 * k)));
    if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${0.55 * fl})`; ctx.fillRect(x0 - 60, y0, barW + 120, BAR_H); }
    // The shine.
    const sh = sec == null ? -1 : clamp01((sec - 0.45 * k) / (0.35 * k));
    if (sh > 0 && sh < 1) {
      const sx = x0 - 200 + (barW + 400) * sh;
      const sg = ctx.createLinearGradient(sx - 90, 0, sx + 90, 0);
      sg.addColorStop(0, "rgba(255,255,255,0)");
      sg.addColorStop(0.5, "rgba(255,255,255,0.4)");
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 90, y0, 180, BAR_H);
    }
    ctx.restore();
    if (logo) {
      const pl = pop(0.12, 0.32);
      const lx = x0 + LOGO / 2 - (SKEW * BAR_H) / 2;
      ctx.save();
      ctx.translate(lx, 0);
      ctx.scale(pl, pl);
      const s = Math.min((BAR_H - 50) / logo.width, (BAR_H - 50) / logo.height);
      ctx.drawImage(logo, (-logo.width * s) / 2, (-logo.height * s) / 2, logo.width * s, logo.height * s);
      ctx.restore();
    }
  });

  // The word: slams down (from big to size), with an accent drop behind it.
  const pw = pop(0.1, 0.3);
  if (pw > 0) {
    reveal(() => {
      const tx = x0 + LOGO + 50 + textW / 2;
      ctx.save();
      ctx.translate(tx, 0);
      const sc = 1 + 0.9 * (1 - Math.min(1, pw));
      ctx.scale(sc * (pw > 1 ? pw : 1), sc * (pw > 1 ? pw : 1));
      ctx.globalAlpha *= clamp01(pw * 2);
      ctx.font = disp(size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.transform(1, 0, SKEW * 0.5, 1, 0, 0);
      ctx.fillStyle = L.accent;
      ctx.fillText(main, 7, 10);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(main, 0, 4);
      ctx.restore();
    });
  }

  // The detail tag: slides out from under the bar.
  if (tag) {
    const pt = ph(0.28, 0.45);
    if (pt > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 - 200, y0 + BAR_H - 2, barW + 400, 120);
      ctx.clip();
      ctx.globalAlpha *= 1 - out;
      const ty = y0 + BAR_H - 70 + 78 * pt;
      const tagX = x0 + barW - tagW - 30;
      ctx.fillStyle = L.accent;
      slant(ctx, tagX, ty, tagW, 70);
      ctx.fill();
      ctx.fillStyle = L.ink;
      ctx.font = disp(58);
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      let fs = 58;
      while (fs > 30 && ctx.measureText(tag).width > tagW - 50) { fs -= 2; ctx.font = disp(fs); }
      ctx.fillText(tag, tagX + tagW / 2 + 6, ty + 38);
      ctx.restore();
    }
  }
  ctx.restore();
}
