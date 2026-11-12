// src/utils/whiteboardGraphic.js
//
// The /whiteboard share graphic: one position group from a user's board as
// a 1080×1350 PNG (Instagram portrait — also what a text shows best).
//   top5  — five big rows: rank, headshot (school logo when there's none),
//           name, school, round.
//   top10 — ten slimmer rows, same pieces.
//   list  — the whole group by round, two columns past 18 rows, the rest
//           as "+ N more".
// The order is the board's own: Round 1's column top to bottom, then
// Round 2's, … then UDFA. Drawn on a canvas in the browser; images load
// with CORS (ESPN's CDN allows it; imgur goes through i.imgur.com), and one
// that won't is just left out rather than tainting the canvas.
import siteLogo from "../assets/Logo2.png";
import { corsFriendlyImageUrl } from "./clipboardImage";

export const W = 1080;
export const H = 1350;
const NAVY = "#04203f";
const INK = "#0b1220";
const GOLD = "#f6a21d";
const FONT = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const BODY = "Arial, 'Helvetica Neue', sans-serif";
const ROUND_SHORT = { "ROUND 1": "R1", "ROUND 2": "R2", "ROUND 3": "R3", "ROUND 4": "R4", "ROUND 5": "R5", "ROUND 6": "R6", "ROUND 7": "R7", UDFA: "UDFA" };

export const GRAPHIC_MODES = [
  { id: "top5", label: "Top 5", count: 5 },
  { id: "top10", label: "Top 10", count: 10 },
  { id: "list", label: "Full list", count: Infinity },
];

export function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = corsFriendlyImageUrl(url);
  });
}

const plural = (pos) => (/s$/i.test(pos) ? pos : `${pos}s`);
const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

function font(ctx, size, weight = 900, family = FONT) { ctx.font = `${weight} ${size}px ${family}`; }

// Largest size ≤ max (≥ min) at which text fits maxW; past min, cut with "…".
function fitText(ctx, text, maxW, max, min, weight, family) {
  let size = max;
  font(ctx, size, weight, family);
  while (size > min && ctx.measureText(text).width > maxW) { size -= 2; font(ctx, size, weight, family); }
  let t = String(text);
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1).trimEnd();
    t = `${t}…`;
  }
  return { text: t, size };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draws img inside the box, scaled to fit, bottom-aligned (a headshot
// cutout stands on the row's floor) or centered.
function drawContained(ctx, img, x, y, w, h, align = "center") {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  const dy = align === "bottom" ? y + h - dh : y + (h - dh) / 2;
  ctx.drawImage(img, x + (w - dw) / 2, dy, dw, dh);
}

function pill(ctx, text, rightX, cy, { size = 26, bg = "rgba(255,255,255,0.14)", fg = "#fff", padX = 16, h = 44 } = {}) {
  font(ctx, size);
  const w = ctx.measureText(text).width + padX * 2;
  roundRect(ctx, rightX - w, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = fg; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText(text, rightX - w / 2, cy + 1);
  ctx.textAlign = "left";
  return w;
}

function marks(ctx, p, rightX, cy, size) {
  let x = rightX;
  font(ctx, size, 900, BODY);
  ctx.textBaseline = "middle"; ctx.textAlign = "right";
  if (p.flagged) { ctx.fillStyle = "#ff5a5a"; ctx.fillText("⚑", x, cy); x -= size + 6; }
  if (p.starred) { ctx.fillStyle = GOLD; ctx.fillText("★", x, cy); x -= size + 6; }
  ctx.textAlign = "left";
  return rightX - x;
}

function background(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0a3a6e");
  g.addColorStop(0.55, NAVY);
  g.addColorStop(1, INK);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // The position's color, glowing from the top right.
  const r = ctx.createRadialGradient(W, 0, 40, W, 0, 900);
  r.addColorStop(0, `${color}aa`);
  r.addColorStop(1, `${color}00`);
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  // A faint whiteboard grid.
  ctx.strokeStyle = "rgba(255,255,255,0.045)"; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
}

// The header: angled speed stripes and a giant outlined mark (the position,
// or "BIG") in the position's color behind it; a gold "2027 NFL DRAFT" pill;
// the owner in gold ("TESTER'S", or "MY" with no username); then the
// headline, huge, with a hard drop shadow in the position's color.
function header(ctx, { owner, pos, color, classYear, mode, total }) {
  const pad = 64;
  const accent = pos === "ALL" ? GOLD : color;

  // Speed stripes, right side, fading toward the left.
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, 330); ctx.clip();
  for (let i = 0; i < 9; i++) {
    const x = 470 + i * 78;
    ctx.globalAlpha = 0.05 + i * 0.018;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.moveTo(x + 120, 0); ctx.lineTo(x + 150, 0); ctx.lineTo(x + 30, 330); ctx.lineTo(x, 330); ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // Giant outlined mark, tilted, bleeding off the right edge.
  ctx.save();
  ctx.translate(W - 30, 250); ctx.rotate(-0.08);
  font(ctx, pos === "ALL" ? 250 : 290);
  ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 0.22; ctx.lineWidth = 4; ctx.strokeStyle = accent;
  ctx.strokeText(pos === "ALL" ? "BIG" : pos, 0, 0);
  ctx.globalAlpha = 0.06; ctx.fillStyle = accent;
  ctx.fillText(pos === "ALL" ? "BIG" : pos, 0, 0);
  ctx.restore();

  // "2027 NFL DRAFT" pill, then "MY WHITEBOARD".
  font(ctx, 22);
  const pillText = `${classYear} NFL DRAFT`;
  const pw = ctx.measureText(pillText).width + 36;
  roundRect(ctx, pad, 58, pw, 44, 22);
  ctx.fillStyle = GOLD; ctx.fill();
  ctx.fillStyle = INK; ctx.textBaseline = "middle";
  ctx.fillText(pillText, pad + 18, 81);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("MY WHITEBOARD", pad + pw + 18, 81);

  // Owner line, then the headline. All caps, but a plural keeps its small
  // "s" (QBs, not QBS). pos "ALL" is the Big Board.
  ctx.textBaseline = "alphabetic";
  const who = owner ? possessive(owner).toUpperCase() : "MY";
  const n = Math.min(mode === "top5" ? 5 : 10, total);
  const headline = mode === "list"
    ? `${pos === "ALL" ? "BIG" : pos} BOARD`
    : `TOP ${n} ${pos === "ALL" ? "PROSPECTS" : plural(pos)}`;
  const w1 = fitText(ctx, who, W - pad * 2, 48, 30);
  ctx.fillStyle = GOLD;
  ctx.fillText(w1.text, pad, 164);
  const t = fitText(ctx, headline, W - pad * 2 - 10, 112, 56);
  const baseY = 164 + 14 + t.size * 0.86;
  ctx.fillStyle = accent; ctx.fillText(t.text, pad + 7, baseY + 7);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 18;
  ctx.fillStyle = "#fff"; ctx.fillText(t.text, pad, baseY);
  ctx.restore();

  const lineY = baseY + 26;
  ctx.fillStyle = accent; ctx.fillRect(pad, lineY, 180, 10);
  ctx.fillStyle = GOLD; ctx.fillRect(pad + 180, lineY, 48, 10);
  ctx.fillStyle = "#fff"; ctx.fillRect(pad + 228, lineY, 14, 10);
  return lineY + 38;
}

function footer(ctx, logo) {
  const top = H - 110;
  ctx.fillStyle = "rgba(4,12,26,0.92)"; ctx.fillRect(0, top, W, 110);
  ctx.fillStyle = GOLD; ctx.fillRect(0, top, W, 5);
  if (logo) drawContained(ctx, logo, 56, top + 26, 300, 62, "center");
  font(ctx, 28);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
  ctx.fillText("BUILD YOURS:", W - 56, top + 40);
  ctx.fillStyle = GOLD;
  ctx.fillText("WE-DRAFT.COM/WHITEBOARD", W - 56, top + 76);
  ctx.textAlign = "left";
}

function avatar(ctx, p, x, y, w, h, color) {
  if (p.headshotImg) { drawContained(ctx, p.headshotImg, x, y, w, h, "bottom"); return; }
  if (p.logoImg) { drawContained(ctx, p.logoImg, x + w * 0.12, y + h * 0.1, w * 0.76, h * 0.8, "center"); return; }
  const r = Math.min(w, h) * 0.38;
  ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = `${color}66`; ctx.fill();
  font(ctx, Math.round(r * 0.8));
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(`${(p.First || "").charAt(0)}${(p.Last || "").charAt(0)}`, x + w / 2, y + h / 2 + 2);
  ctx.textAlign = "left";
}

// The school line: "QB · Ohio State" on the Big Board, else the school;
// its short name when the full one won't fit even at the smallest size.
function schoolFit(ctx, p, maxW, max, min) {
  const pre = p.posLabel ? `${p.posLabel} · ` : "";
  font(ctx, min, 700, BODY);
  const full = pre + (p.School || "");
  if (p.SchoolShort && ctx.measureText(full).width > maxW) return fitText(ctx, pre + p.SchoolShort, maxW, max, min, 700, BODY);
  return fitText(ctx, full, maxW, max, min, 700, BODY);
}

function rankedRows(ctx, players, top, bottom, color, big) {
  const pad = 56;
  const n = players.length;
  const gap = big ? 16 : 10;
  const rowH = Math.min(big ? 170 : 86, Math.floor((bottom - top - gap * (n - 1)) / Math.max(n, 1)));
  players.forEach((p, i) => {
    const y = top + i * (rowH + gap);
    roundRect(ctx, pad, y, W - pad * 2, rowH, big ? 22 : 14);
    ctx.fillStyle = i === 0 ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.07)"; ctx.fill();
    ctx.save(); roundRect(ctx, pad, y, W - pad * 2, rowH, big ? 22 : 14); ctx.clip();
    // Rank block.
    const rankW = big ? 118 : 78;
    ctx.fillStyle = p.color || color; ctx.fillRect(pad, y, rankW, rowH);
    font(ctx, big ? 78 : 42);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), pad + rankW / 2, y + rowH / 2 + 3);
    ctx.textAlign = "left";
    // Headshot / logo.
    const avW = big ? 200 : 104;
    const avX = pad + rankW + (big ? 12 : 8);
    avatar(ctx, p, avX, y + (big ? 10 : 6), avW, rowH - (big ? 10 : 6), color);
    ctx.restore();
    // Round pill + marks on the right.
    const cy = y + rowH / 2;
    const pillW = pill(ctx, ROUND_SHORT[p.round] || "", W - pad - 22, cy, big ? {} : { size: 22, h: 38, padX: 13 });
    const markW = marks(ctx, p, W - pad - 22 - pillW - 14, cy, big ? 34 : 26);
    // Name and school.
    const textX = avX + avW + (big ? 22 : 16);
    const maxW = W - pad - 22 - pillW - 14 - markW - 10 - textX;
    ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#fff";
    if (big) {
      const first = fitText(ctx, (p.First || "").toUpperCase(), maxW, 30, 20, 700, BODY);
      ctx.fillStyle = "rgba(255,255,255,0.78)"; ctx.fillText(first.text, textX, y + 52);
      const last = fitText(ctx, (p.Last || "").toUpperCase(), maxW, 58, 30);
      ctx.fillStyle = "#fff"; ctx.fillText(last.text, textX, y + 52 + last.size * 0.95);
      const school = schoolFit(ctx, p, maxW, 26, 18);
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillText(school.text, textX, y + rowH - 22);
    } else {
      const name = fitText(ctx, `${p.First || ""} ${p.Last || ""}`.trim().toUpperCase(), maxW, 34, 20);
      ctx.fillText(name.text, textX, y + rowH / 2 + 2);
      const school = schoolFit(ctx, p, maxW, 21, 15);
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillText(school.text, textX, y + rowH / 2 + 30);
    }
  });
}

function listRows(ctx, players, top, bottom, color) {
  const pad = 56;
  // One line per player plus a header line per round.
  const lines = [];
  let lastRound = null;
  players.forEach((p, i) => {
    if (p.round !== lastRound) { lines.push({ round: p.round }); lastRound = p.round; }
    lines.push({ p, rank: i + 1 });
  });
  const lineH = 50;
  const perCol = Math.floor((bottom - top) / lineH);
  const twoCols = lines.length > perCol;
  const cols = twoCols ? 2 : 1;
  const capacity = perCol * cols;
  let shown = lines;
  let more = 0;
  if (lines.length > capacity) {
    shown = lines.slice(0, capacity - 1);
    while (shown.length && shown[shown.length - 1].round) shown.pop();
    more = players.length - shown.filter((l) => l.p).length;
  }
  const colW = (W - pad * 2 - (twoCols ? 28 : 0)) / cols;
  shown.forEach((l, i) => {
    const c = Math.floor(i / perCol);
    const x = pad + c * (colW + 28);
    const y = top + (i % perCol) * lineH;
    if (l.round) {
      roundRect(ctx, x, y + 6, colW, lineH - 10, 10);
      ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fill();
      ctx.fillStyle = color; ctx.fillRect(x, y + 6, 8, lineH - 10);
      font(ctx, 22); ctx.fillStyle = GOLD; ctx.textBaseline = "middle";
      ctx.fillText(l.round === "UDFA" ? "UNDRAFTED" : l.round, x + 22, y + lineH / 2 + 1);
      return;
    }
    const { p, rank } = l;
    ctx.textBaseline = "middle";
    font(ctx, 24); ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "right"; ctx.fillText(String(rank), x + 44, y + lineH / 2 + 1); ctx.textAlign = "left";
    const markW = marks(ctx, p, x + colW - 6, y + lineH / 2, 24);
    const schoolMax = twoCols ? 0 : 300;
    const nameMax = colW - 60 - markW - 10 - (schoolMax ? schoolMax + 16 : 0);
    // Big Board rows: the position, in its color, ahead of the name.
    let nameX = x + 60;
    if (p.posLabel) {
      font(ctx, 18); ctx.fillStyle = p.color || GOLD;
      ctx.fillText(p.posLabel, nameX, y + lineH / 2 + 1);
      nameX += ctx.measureText(p.posLabel).width + 10;
    }
    const name = fitText(ctx, `${p.First || ""} ${p.Last || ""}`.trim(), nameMax - (nameX - x - 60), 28, 18, 900);
    ctx.fillStyle = "#fff"; ctx.fillText(name.text, nameX, y + lineH / 2 + 1);
    if (schoolMax) {
      const school = schoolFit(ctx, p, schoolMax, 22, 15);
      ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.textAlign = "right";
      ctx.fillText(school.text, x + colW - 6 - markW - 10, y + lineH / 2 + 1); ctx.textAlign = "left";
    }
  });
  if (more > 0) {
    font(ctx, 24); ctx.fillStyle = GOLD; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    ctx.fillText(`+ ${more} MORE`, W - pad, bottom - lineH / 2);
    ctx.textAlign = "left";
  }
}

// players: the group in board order, each { First, Last, School, round,
// starred, flagged, headshot, logo } (headshot / logo: URLs or "").
export async function drawWhiteboardGraphic({ owner, pos, color, classYear, mode, players }) {
  const count = (GRAPHIC_MODES.find((m) => m.id === mode) || GRAPHIC_MODES[0]).count;
  const list = players.slice(0, count);
  const withImages = mode !== "list";
  const [logo, ...imgs] = await Promise.all([
    loadImage(siteLogo),
    ...(withImages ? list.flatMap((p) => [loadImage(p.headshot), p.headshot ? Promise.resolve(null) : loadImage(p.logo)]) : []),
  ]);
  const rows = list.map((p, i) => ({ ...p, headshotImg: withImages ? imgs[i * 2] : null, logoImg: withImages ? imgs[i * 2 + 1] : null }));

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  background(ctx, color);
  const top = header(ctx, { owner, pos, color, classYear, mode, total: list.length });
  const bottom = H - 110 - 40;
  if (mode === "list") listRows(ctx, rows, top, bottom, color);
  else rankedRows(ctx, rows, top, bottom, color, mode === "top5");
  footer(ctx, logo);
  return canvas;
}

export const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), "image/png");
});
