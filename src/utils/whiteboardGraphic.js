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
// Round 2's, … then UDFA.
// Themed lists (utils/whiteboardLists.js — Risers, Fallers, Late Round
// Gems, Sleepers, Safe Picks, Busts) take the top5 / top10 rows with their
// own colors, a motif in the header (arrows, a gem, a moon, a shield,
// caution tape) and each row's pills in place of the round. Drawn on a canvas in the browser; images load
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

// Each themed list's look: accent, background stops, header motif.
export const THEMES = {
  risers: { accent: "#22c55e", bg: ["#0b5a33", "#053321", "#03140c"], motif: "up" },
  fallers: { accent: "#ef4444", bg: ["#6b1018", "#3a0a0e", "#160406"], motif: "down" },
  gems: { accent: "#2dd4bf", bg: ["#0d5952", "#063431", "#031514"], motif: "gem" },
  sleepers: { accent: "#a78bfa", bg: ["#2f1d69", "#170d3c", "#070418"], motif: "moon" },
  safe: { accent: "#60a5fa", bg: ["#124179", "#0a2649", "#04101f"], motif: "shield" },
  busts: { accent: "#f97316", bg: ["#4a1707", "#220b04", "#0a0402"], motif: "hazard" },
};

function background(ctx, color, stops = ["#0a3a6e", NAVY, INK]) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, stops[0]);
  g.addColorStop(0.55, stops[1]);
  g.addColorStop(1, stops[2]);
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

// The draft class, big, top left — "2027" in the accent with "NFL DRAFT"
// beside it — so the year can't be missed. The made-on date sits under
// "NFL DRAFT" without its year (a "2026" there read as the class).
const OWNER_Y = 196;
function yearBlock(ctx, classYear, accent, date) {
  const pad = 64;
  ctx.textBaseline = "alphabetic";
  font(ctx, 92);
  const yw = ctx.measureText(String(classYear)).width;
  ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillText(String(classYear), pad + 5, 138 + 5);
  ctx.fillStyle = accent; ctx.fillText(String(classYear), pad, 138);
  const x = pad + yw + 22;
  font(ctx, 38); ctx.fillStyle = "#fff"; ctx.fillText("NFL DRAFT", x, 98);
  const d = date ? String(date).replace(/,?\s*\d{4}$/, "") : "";
  font(ctx, 20); ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(d ? `MY WHITEBOARD · ${d}` : "MY WHITEBOARD", x + 2, 134);
}

// The header: angled speed stripes and a giant outlined mark (the position,
// or "BIG") in the position's color behind it; the class year (yearBlock);
// the owner in gold ("TESTER'S", or "MY" with no username); then the
// headline, huge, with a hard drop shadow in the position's color.
function header(ctx, { owner, pos, color, classYear, mode, total, date }) {
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

  yearBlock(ctx, classYear, GOLD, date);

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
  ctx.fillText(w1.text, pad, OWNER_Y);
  const t = fitText(ctx, headline, W - pad * 2 - 10, 112, 56);
  const baseY = OWNER_Y + 14 + t.size * 0.86;
  ctx.fillStyle = accent; ctx.fillText(t.text, pad + 7, baseY + 7);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 18;
  ctx.fillStyle = "#fff"; ctx.fillText(t.text, pad, baseY);
  ctx.restore();

  return baseY + 44;
}

// The motif behind a themed header, in the accent, on the right.
function motif(ctx, kind, accent) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, 340); ctx.clip();
  ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (kind === "up" || kind === "down") {
    // Three stacked chevrons, brightest at the leading end.
    const dir = kind === "up" ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      const cx = 880;
      const cy = 170 + (i - 1) * 95 * dir;
      ctx.globalAlpha = 0.12 + i * 0.1;
      ctx.lineWidth = 34;
      ctx.beginPath(); ctx.moveTo(cx - 150, cy - dir * 70); ctx.lineTo(cx, cy + dir * 70); ctx.lineTo(cx + 150, cy - dir * 70); ctx.stroke();
    }
  } else if (kind === "gem") {
    ctx.translate(870, 175); ctx.rotate(-0.12);
    const w = 330; const top = -125; const mid = -45; const bot = 175; const t = w / 2 - 60;
    ctx.globalAlpha = 0.1;
    ctx.beginPath(); ctx.moveTo(-t, top); ctx.lineTo(t, top); ctx.lineTo(w / 2, mid); ctx.lineTo(0, bot); ctx.lineTo(-w / 2, mid); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.45; ctx.lineWidth = 5; ctx.stroke();
    ctx.globalAlpha = 0.28; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-w / 2, mid); ctx.lineTo(w / 2, mid);
    ctx.moveTo(-t, top); ctx.lineTo(-t * 0.45, mid); ctx.lineTo(0, top); ctx.lineTo(t * 0.45, mid); ctx.lineTo(t, top);
    ctx.moveTo(-t * 0.45, mid); ctx.lineTo(0, bot); ctx.lineTo(t * 0.45, mid);
    ctx.stroke();
    // A glint.
    ctx.globalAlpha = 0.7; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(170, 60); ctx.lineTo(170, 110); ctx.moveTo(145, 85); ctx.lineTo(195, 85); ctx.stroke();
  } else if (kind === "moon") {
    // A crescent (a disc with a disc cut out), stars and Zs.
    const c = document.createElement("canvas");
    c.width = 300; c.height = 300;
    const m = c.getContext("2d");
    m.fillStyle = accent; m.beginPath(); m.arc(150, 150, 130, 0, Math.PI * 2); m.fill();
    m.globalCompositeOperation = "destination-out";
    m.beginPath(); m.arc(210, 100, 118, 0, Math.PI * 2); m.fill();
    ctx.globalAlpha = 0.3; ctx.drawImage(c, 730, 20);
    ctx.globalAlpha = 0.55;
    [[640, 70, 4], [700, 250, 3], [1010, 290, 4], [790, 30, 3], [1050, 50, 3], [690, 330, 3]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 0.4; ctx.textBaseline = "alphabetic";
    font(ctx, 64); ctx.fillText("Z", 960, 250);
    font(ctx, 44); ctx.fillText("Z", 1012, 200);
    font(ctx, 30); ctx.fillText("Z", 1046, 162);
  } else if (kind === "shield") {
    ctx.translate(880, 36);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(70, 30, 130, 30, 150, 25); ctx.lineTo(150, 130);
    ctx.bezierCurveTo(150, 210, 70, 260, 0, 290); ctx.bezierCurveTo(-70, 260, -150, 210, -150, 130);
    ctx.lineTo(-150, 25); ctx.bezierCurveTo(-130, 30, -70, 30, 0, 0); ctx.closePath();
    ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = 0.45; ctx.lineWidth = 8; ctx.stroke();
    ctx.globalAlpha = 0.55; ctx.lineWidth = 26;
    ctx.beginPath(); ctx.moveTo(-62, 140); ctx.lineTo(-14, 190); ctx.lineTo(72, 92); ctx.stroke();
  } else if (kind === "hazard") {
    // Caution tape across the top-right corner, clear of the text.
    ctx.translate(935, 105); ctx.rotate(0.62);
    const bw = 760; const bh = 76;
    ctx.globalAlpha = 0.8; ctx.fillStyle = "#facc15"; ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.save(); ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.clip();
    ctx.fillStyle = "#111";
    for (let x = -bw / 2 - bh; x < bw / 2; x += 80) { ctx.beginPath(); ctx.moveTo(x, bh / 2); ctx.lineTo(x + 40, bh / 2); ctx.lineTo(x + 40 + bh, -bh / 2); ctx.lineTo(x + bh, -bh / 2); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.globalAlpha = 1; font(ctx, 40); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const tw = ctx.measureText("CAUTION").width + 36;
    ctx.fillStyle = "#facc15"; ctx.fillRect(-tw / 2, -28, tw, 56);
    ctx.fillStyle = "#111"; ctx.fillText("CAUTION", 0, 2);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

// A themed list's header: the motif, a pill (the class, in the accent),
// "MY WHITEBOARD", the owner, the list's headline and its subtitle.
function themedHeader(ctx, { owner, classYear, theme, headline, sub, date }) {
  const pad = 64;
  const accent = theme.accent;
  motif(ctx, theme.motif, accent);

  yearBlock(ctx, classYear, accent, date);

  ctx.textBaseline = "alphabetic";
  const who = owner ? possessive(owner).toUpperCase() : "MY";
  const w1 = fitText(ctx, who, W - pad * 2, 48, 30);
  ctx.fillStyle = accent;
  ctx.fillText(w1.text, pad, OWNER_Y);
  const t = fitText(ctx, headline, W - pad * 2 - 10, 112, 56);
  const baseY = OWNER_Y + 14 + t.size * 0.86;
  ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillText(t.text, pad + 6, baseY + 6);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 18;
  ctx.fillStyle = "#fff"; ctx.fillText(t.text, pad, baseY);
  ctx.restore();

  // The subtitle, then the list.
  const s = fitText(ctx, sub || "", W - pad * 2, 28, 18);
  ctx.fillStyle = accent; ctx.fillText(s.text, pad, baseY + 54);
  return baseY + 92;
}

function footer(ctx, logo, accent = GOLD) {
  const top = H - 110;
  ctx.fillStyle = "rgba(4,12,26,0.92)"; ctx.fillRect(0, top, W, 110);
  ctx.fillStyle = accent; ctx.fillRect(0, top, W, 5);
  if (logo) drawContained(ctx, logo, 56, top + 26, 300, 62, "center");
  font(ctx, 28);
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
  ctx.fillText("BUILD YOURS:", W - 56, top + 40);
  ctx.fillStyle = accent;
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
    ctx.fillStyle = p.pills ? color : p.color || color; ctx.fillRect(pad, y, rankW, rowH);
    font(ctx, big ? 78 : 42);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), pad + rankW / 2, y + rowH / 2 + 3);
    ctx.textAlign = "left";
    // Headshot / logo.
    const avW = big ? 200 : 104;
    const avX = pad + rankW + (big ? 12 : 8);
    avatar(ctx, p, avX, y + (big ? 10 : 6), avW, rowH - (big ? 10 : 6), color);
    ctx.restore();
    // Round pill (a themed list: its pills, right to left) + marks.
    const cy = y + rowH / 2;
    const look = big ? {} : { size: 22, h: 38, padX: 13 };
    let pillW = 0;
    const pillLook = (pl) => (pl.tone === "accent" ? { ...look, bg: color, fg: "#fff" } : look);
    if (p.pills && big) {
      // Top 5: stacked, right-aligned, so the name keeps its room.
      const h = 44; const gapY = 10;
      const y0 = cy - ((p.pills.length * h + (p.pills.length - 1) * gapY) / 2) + h / 2;
      p.pills.forEach((pl, k) => { pillW = Math.max(pillW, pill(ctx, pl.text, W - pad - 22, y0 + k * (h + gapY), pillLook(pl))); });
    } else if (p.pills) {
      [...p.pills].reverse().forEach((pl, k) => {
        if (k) pillW += 10;
        pillW += pill(ctx, pl.text, W - pad - 22 - pillW, cy, pillLook(pl));
      });
    } else pillW = pill(ctx, ROUND_SHORT[p.round] || "", W - pad - 22, cy, look);
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

// A themed list with nobody on it yet: its numbered slots, dashed, and
// "ADD PLAYERS BELOW" across them (the dialog's picker is under the preview).
function emptySlots(ctx, top, bottom, accent, n) {
  const pad = 56;
  const big = n <= 5;
  const gap = big ? 16 : 10;
  const rowH = Math.min(big ? 170 : 86, Math.floor((bottom - top - gap * (n - 1)) / n));
  ctx.save();
  ctx.setLineDash([14, 10]); ctx.lineWidth = 3;
  for (let i = 0; i < n; i++) {
    const y = top + i * (rowH + gap);
    roundRect(ctx, pad, y, W - pad * 2, rowH, big ? 22 : 14);
    ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.stroke();
    font(ctx, big ? 64 : 36); ctx.fillStyle = `${accent}88`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), pad + (big ? 59 : 44), y + rowH / 2 + 3);
  }
  ctx.restore();
  const mid = top + (n * rowH + gap * (n - 1)) / 2;
  const label = "ADD PLAYERS BELOW";
  font(ctx, 54);
  const lw = ctx.measureText(label).width + 80;
  roundRect(ctx, (W - lw) / 2, mid - 50, lw, 100, 50);
  ctx.fillStyle = accent; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, W / 2, mid + 3);
  ctx.textAlign = "left";
}

// players: the group in board order, each { First, Last, School, round,
// starred, flagged, headshot, logo } (headshot / logo: URLs or "").
// list: a themed list's id (THEMES) — then headline / sub are its titles
// (utils/whiteboardLists.js listTitles) and each player carries pills.
export async function drawWhiteboardGraphic({ owner, pos, color, classYear, mode, players, list, headline, sub, date }) {
  const theme = THEMES[list];
  if (theme && mode === "list") mode = "top10";
  const count = (GRAPHIC_MODES.find((m) => m.id === mode) || GRAPHIC_MODES[0]).count;
  const shown = players.slice(0, count);
  const withImages = mode !== "list";
  const [logo, ...imgs] = await Promise.all([
    loadImage(siteLogo),
    ...(withImages ? shown.flatMap((p) => [loadImage(p.headshot), p.headshot ? Promise.resolve(null) : loadImage(p.logo)]) : []),
  ]);
  const rows = shown.map((p, i) => ({ ...p, headshotImg: withImages ? imgs[i * 2] : null, logoImg: withImages ? imgs[i * 2 + 1] : null }));

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (theme) {
    background(ctx, theme.accent, theme.bg);
    const top = themedHeader(ctx, { owner, classYear, theme, headline, sub, date });
    if (rows.length) rankedRows(ctx, rows, top, H - 110 - 40, theme.accent, mode === "top5");
    else emptySlots(ctx, top, H - 110 - 40, theme.accent, count);
    footer(ctx, logo, theme.accent);
    return canvas;
  }
  background(ctx, color);
  const top = header(ctx, { owner, pos, color, classYear, mode, total: rows.length, date });
  const bottom = H - 110 - 40;
  if (mode === "list") listRows(ctx, rows, top, bottom, color);
  else rankedRows(ctx, rows, top, bottom, color, mode === "top5");
  footer(ctx, logo);
  return canvas;
}

export const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the image"))), "image/png");
});
