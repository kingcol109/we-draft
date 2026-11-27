// src/components/videoAssets/scoutCard.js
//
// Assets → Scouting Card (user, 2026-11-25): the Draft Breakdowns' opener,
// laid over the player's top play. v2 (user): it sits in the MIDDLE THIRD
// of the frame, so it's built to be read there — 640 px wide (a third of
// 1080p), big type, few words; it matches the breakdown videos (site blue
// and gold or the team's look, Bebas Neue + Barlow Condensed, flat modern
// panels — no paper); and it IDENTIFIES the player — v3 (user): not a
// circle but a FOCUS on him: the whole screen dims (the graphic may cover
// the entire screen — it plays in the intro), a soft spotlight irises in on
// him, focus brackets (never green) snap around him, and a line runs to the
// card.
//
// The card: a gold ribbon (SCOUTING REPORT + the WD badge / team logo), his
// photo, FIRST over a big LAST name, position · school (logo), then three
// tiles — HEIGHT · WEIGHT · CLASS. The verdict is NOT given away (user):
// GRADE / STRENGTHS / WEAKNESSES (/ COMP) are locked "?" tiles. A footer bar
// ("FULL REPORT INSIDE" by default, editable; blank drops it) lands last.
// 4 s by default (3–10); the intro runs on fixed beats and a longer clip
// holds longer; a 3 s one plays the intro faster so the exit still fits.
import { loadImage } from "../AdminSideGraphics";
import { drawConnector, ringWidth } from "./ring";

export const CARD_SECONDS = [3, 4, 5, 6, 8, 10];
export const CARD_DEFAULT_SECONDS = 4;
export const CARD_W = 640;
// The intro's pace: its beats × SPEED in seconds.
export const SPEED = 0.65;
export const DEFAULT_CARD = {
  // The card's center, its scale, and the circle around the player.
  // The focus: on, where the player is (cx, cy), its size (r), and how dark the rest goes.
  x: 960, y: 540, s: 1, focus: true, cx: 470, cy: 520, r: 110, dim: 0.6,
  photo: true, exit: true, stamp: "FULL REPORT INSIDE",
  teaser: { grade: true, strengths: true, weaknesses: true, comp: false },
};
const DISP = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
const BODY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
const disp = (s) => `${s}px ${DISP}`;
const body = (s, w = 800) => `${w} ${s}px ${BODY}`;

// Layout (card space, 640 wide).
const PAD = 24;
const RIBBON = 70;
const NAME_TOP = RIBBON + 22;
const PHOTO = { w: 150, h: 176 };
const TILE_H = 112;
const GAP = 12;
const FACTS_Y = NAME_TOP + PHOTO.h + 22;
const HIDDEN_Y = FACTS_Y + TILE_H + GAP;
const FOOT_H = 58;
export const cardHeight = (stamp) => HIDDEN_Y + TILE_H + PAD + (String(stamp || "").trim() ? FOOT_H : 0);

const ease = (p) => 1 - (1 - p) ** 3;
const easeBack = (p) => 1 + 2.7 * (p - 1) ** 3 + 1.7 * (p - 1) ** 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitFont(ctx, text, maxW, size, min, f) {
  let s = size;
  ctx.font = f(s);
  while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = f(s); }
  return s;
}
function contain(ctx, img, x, y, w, h) {
  const s = Math.min(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

// The card's words.
export function cardFields(a) {
  const dash = (v) => String(v || "").toUpperCase() || "—";
  return {
    first: String(a.first || "").toUpperCase(),
    last: String(a.last || "").toUpperCase(),
    info: [a.pos, a.school].filter(Boolean).join(" · ").toUpperCase(),
    facts: [["HEIGHT", dash(a.height)], ["WEIGHT", a.weight ? `${a.weight} LBS` : "—"], ["CLASS", dash(a.cls)]],
  };
}
// The locked tiles, in order.
export function teaserItems(teaser) {
  return [["grade", "GRADE"], ["strengths", "STRENGTHS"], ["weaknesses", "WEAKNESSES"], ["comp", "COMP"]]
    .filter(([k]) => teaser?.[k]).map(([key, label]) => ({ key, label }));
}

const darken = (hex, d) => {
  const h = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#00264d";
  const c = [1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - d)));
  return `rgb(${c.join(",")})`;
};

// Camera-focus brackets: four corners of a square (half = half its side).
function brackets(ctx, cx, cy, half, len, lw, color) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const corner = (sx, sy) => {
    const x = cx + sx * half;
    const y = cy + sy * half;
    ctx.beginPath();
    ctx.moveTo(x, y - sy * len);
    ctx.lineTo(x, y);
    ctx.lineTo(x - sx * len, y);
    ctx.stroke();
  };
  // A dark under-stroke so they read on a bright field, then the color.
  [["rgba(0,0,0,0.4)", lw + 6], [color, lw]].forEach(([c, w]) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => corner(sx, sy));
  });
  ctx.restore();
}

// A lock (the hidden tiles' mark), centered at x, top y, h tall.
function lock(ctx, x, y, h, color) {
  const w = h * 0.8;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = h * 0.13;
  ctx.beginPath();
  ctx.arc(x, y + h * 0.42, w * 0.3, Math.PI, 0);
  ctx.stroke();
  rr(ctx, x - w / 2, y + h * 0.42, w, h * 0.58, h * 0.1);
  ctx.fill();
  ctx.restore();
}

// One frame. a: the asset (+ look, card, seconds); t: 0–1, undefined = still.
// Leaves canvas.cardBox (the card's bounds, for dragging it).
export async function drawScoutCard(canvas, a, t, bg = null) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  const { look } = a;
  const card = { ...DEFAULT_CARD, ...(a.card || {}), teaser: { ...DEFAULT_CARD.teaser, ...(a.card?.teaser || {}) } };
  const [badge, photo, schoolLogo] = await Promise.all([
    look.logo ? loadImage(look.logo) : null,
    card.photo && a.headshot ? loadImage(a.headshot) : null,
    a.schoolLogo ? loadImage(a.schoolLogo) : null,
  ]);
  const dur = a.seconds || CARD_DEFAULT_SECONDS;
  const sec = t == null ? null : t * dur;
  const EXIT = 0.4;
  // The intro takes 2.5 s (the focus, then the card 0.2 s on); squeezed when
  // the clip is too short to hold it and the exit.
  // Played at 65% of those beats (user, 2026-11-25: it took too long to fill
  // in) — everything is in by ~1.6 s; the rest of the clip holds.
  const OFF = card.focus ? 0.2 : 0;
  const k = Math.min(SPEED, (dur - (card.exit ? EXIT : 0) - 0.2) / (2.3 + OFF));
  const phAt = (x, y) => (sec == null ? 1 : ease(clamp01((sec - x * k) / ((y - x) * k))));
  const popAt = (x, y) => (sec == null ? 1 : easeBack(clamp01((sec - x * k) / ((y - x) * k))));
  const ph = (x, y) => phAt(x + OFF, y + OFF);
  const pop = (x, y) => popAt(x + OFF, y + OFF);
  const out = card.exit && sec != null ? ease(clamp01((sec - (dur - EXIT)) / EXIT)) : 0;
  const fade = 1 - out;

  const S = card.s;
  const stamp = String(card.stamp || "").trim().toUpperCase();
  const CH = cardHeight(stamp);
  const box = { x: card.x - (CARD_W / 2) * S, y: card.y - (CH / 2) * S, w: CARD_W * S, h: CH * S };
  canvas.cardBox = box;

  ctx.save();
  ctx.globalAlpha = fade;
  // The player in focus (user, 2026-11-25 — in place of a circle): the whole
  // screen dims (the graphic may cover all of it, the intro's panel and
  // tracker too), a soft spotlight irises in on him, and focus brackets snap
  // in around him; then the line out to the card. The exit opens it back up.
  if (card.focus) {
    const f = { cx: card.cx, cy: card.cy, r: card.r };
    const hole = f.r * (1 + 2.4 * (1 - phAt(0, 0.5)) + 1.6 * out);
    const layer = document.createElement("canvas");
    layer.width = W;
    layer.height = H;
    const lc = layer.getContext("2d");
    lc.globalAlpha = (card.dim ?? DEFAULT_CARD.dim) * phAt(0, 0.3);
    lc.fillStyle = darken(look.fill, 0.6);
    lc.fillRect(0, 0, W, H);
    // The breakdown frames' fine stripes, across the dimmed screen.
    lc.globalAlpha = 0.06 * phAt(0, 0.3);
    lc.strokeStyle = "#ffffff";
    lc.lineWidth = 2;
    for (let x = -H; x < W; x += 16) { lc.beginPath(); lc.moveTo(x, H); lc.lineTo(x + H, 0); lc.stroke(); }
    // The spotlight: a feathered hole cut out of it.
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = "destination-out";
    const g = lc.createRadialGradient(f.cx, f.cy, hole * 0.75, f.cx, f.cy, hole * 1.3);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    lc.fillStyle = g;
    lc.fillRect(0, 0, W, H);
    ctx.drawImage(layer, 0, 0);
    // Focus brackets: snap in from wide, a touch of overshoot.
    const pb = popAt(0.25, 0.6);
    if (pb > 0) {
      const half = f.r * 1.12 * (1 + 0.7 * (1 - Math.min(1, pb)));
      ctx.save();
      ctx.globalAlpha *= clamp01(pb);
      brackets(ctx, f.cx, f.cy, half, f.r * 0.4, ringWidth(f.r), look.ring);
      ctx.restore();
    }
    drawConnector(ctx, { cx: f.cx, cy: f.cy, r: f.r * 1.12 }, box, look.ring, phAt(0.5, 0.7));
  }

  // The card: rises in and settles; drops away at the exit.
  const pin = ph(0.35, 0.75);
  if (pin <= 0) { ctx.restore(); return; }
  ctx.save();
  ctx.globalAlpha = fade * clamp01(pin * 1.4);
  ctx.translate(card.x, card.y + 40 * (1 - pin) + 30 * out);
  const sc = S * (0.94 + 0.06 * pin);
  ctx.scale(sc, sc);
  ctx.translate(-CARD_W / 2, -CH / 2);

  // Body.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 12;
  const g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, look.fill);
  g.addColorStop(1, look.fill2);
  ctx.fillStyle = g;
  rr(ctx, 0, 0, CARD_W, CH, 16);
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, 0, 0, CARD_W, CH, 16);
  ctx.clip();
  // Fine diagonal stripes, like the breakdown frames.
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 2;
  for (let x = -CH; x < CARD_W; x += 14) { ctx.beginPath(); ctx.moveTo(x, CH); ctx.lineTo(x + CH, 0); ctx.stroke(); }
  // The ribbon, wiped open left to right.
  const pr = ph(0.45, 0.7);
  ctx.fillStyle = look.accent;
  ctx.fillRect(0, 0, CARD_W * pr, RIBBON);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W * pr, RIBBON);
  ctx.clip();
  ctx.fillStyle = look.ink;
  ctx.font = disp(52);
  ctx.textBaseline = "alphabetic";
  ctx.fillText("SCOUTING REPORT", PAD, 54);
  if (badge) contain(ctx, badge, CARD_W - PAD - 56, 7, 56, 56);
  ctx.restore();

  // Photo.
  let tx = PAD;
  if (photo) {
    const p = pop(0.55, 0.85);
    ctx.save();
    ctx.globalAlpha *= clamp01(p);
    const cx = PAD + PHOTO.w / 2;
    const cy = NAME_TOP + PHOTO.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p);
    ctx.translate(-cx, -cy);
    rr(ctx, PAD, NAME_TOP, PHOTO.w, PHOTO.h, 12);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const s = Math.max(PHOTO.w / photo.width, PHOTO.h / photo.height);
    ctx.drawImage(photo, PAD + (PHOTO.w - photo.width * s) / 2, NAME_TOP, photo.width * s, photo.height * s);
    ctx.restore();
    ctx.strokeStyle = look.accent;
    ctx.lineWidth = 4;
    rr(ctx, PAD, NAME_TOP, PHOTO.w, PHOTO.h, 12);
    ctx.stroke();
    ctx.restore();
    tx = PAD + PHOTO.w + 22;
  }
  const textW = CARD_W - tx - PAD;
  const F = cardFields(a);
  // FIRST over LAST, sliding in from the left.
  const slide = (x0, x1) => -40 * (1 - ph(x0, x1));
  ctx.save();
  ctx.beginPath();
  ctx.rect(tx - 4, NAME_TOP - 4, textW + 8, PHOTO.h + 8);
  ctx.clip();
  ctx.globalAlpha *= ph(0.6, 0.85);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  fitFont(ctx, F.first, textW, 54, 30, disp);
  ctx.fillText(F.first, tx + slide(0.6, 0.85), NAME_TOP + 46);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(tx - 4, NAME_TOP - 4, textW + 8, PHOTO.h + 8);
  ctx.clip();
  ctx.globalAlpha *= ph(0.68, 0.95);
  ctx.fillStyle = "#ffffff";
  const ls = fitFont(ctx, F.last, textW, 100, 44, disp);
  ctx.fillText(F.last, tx + slide(0.68, 0.95), NAME_TOP + 46 + ls * 0.88);
  ctx.restore();
  // Position · school.
  ctx.save();
  ctx.globalAlpha *= ph(0.85, 1.05);
  let ix = tx;
  const iy = NAME_TOP + PHOTO.h - 6;
  if (schoolLogo) { contain(ctx, schoolLogo, ix, iy - 34, 40, 40); ix += 48; }
  ctx.fillStyle = look.accent;
  fitFont(ctx, F.info, CARD_W - ix - PAD, 34, 20, body);
  ctx.fillText(F.info, ix, iy);
  ctx.restore();

  // HEIGHT · WEIGHT · CLASS.
  const tileRow = (items, y, at, draw) => {
    const n = items.length;
    const w = (CARD_W - PAD * 2 - GAP * (n - 1)) / n;
    items.forEach((it, i) => {
      const p = pop(at + i * 0.1, at + 0.3 + i * 0.1);
      if (p <= 0) return;
      const x = PAD + i * (w + GAP);
      ctx.save();
      ctx.globalAlpha *= clamp01(p);
      ctx.translate(x + w / 2, y + TILE_H / 2);
      ctx.scale(0.9 + 0.1 * p, 0.9 + 0.1 * p);
      ctx.translate(-(x + w / 2), -(y + TILE_H / 2));
      draw(it, x, w, p);
      ctx.restore();
    });
  };
  tileRow(F.facts, FACTS_Y, 0.95, ([l, v], x, w) => {
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    rr(ctx, x, FACTS_Y, w, TILE_H, 10);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = body(22);
    ctx.fillText(l, x + w / 2, FACTS_Y + 32);
    ctx.fillStyle = "#ffffff";
    fitFont(ctx, v, w - 20, 62, 30, disp);
    ctx.fillText(v, x + w / 2, FACTS_Y + 96);
    ctx.textAlign = "left";
  });
  // The verdict, locked: GRADE / STRENGTHS / WEAKNESSES (/ COMP) as "?".
  const hidden = teaserItems(card.teaser);
  if (hidden.length) {
    tileRow(hidden, HIDDEN_Y, 1.35, (it, x, w, p) => {
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      rr(ctx, x, HIDDEN_Y, w, TILE_H, 10);
      ctx.fill();
      ctx.save();
      ctx.setLineDash([9, 7]);
      ctx.strokeStyle = look.accent;
      ctx.lineWidth = 2.5;
      rr(ctx, x + 1, HIDDEN_Y + 1, w - 2, TILE_H - 2, 10);
      ctx.stroke();
      ctx.restore();
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      fitFont(ctx, it.label, w - 16, 22, 16, body);
      ctx.fillText(it.label, x + w / 2, HIDDEN_Y + 32);
      // The ? wobbles in.
      ctx.save();
      ctx.translate(x + w / 2, HIDDEN_Y + 76);
      ctx.rotate((1 - Math.min(1, p)) * 0.6);
      ctx.fillStyle = look.accent;
      ctx.font = disp(66);
      ctx.fillText("?", 0, 22);
      ctx.restore();
      lock(ctx, x + w - 22, HIDDEN_Y + 10, 20, "rgba(255,255,255,0.45)");
      ctx.textAlign = "left";
    });
  }

  // The footer bar, last: wiped in, then a shine across it.
  if (stamp) {
    const fy = CH - FOOT_H;
    const pf = ph(1.85, 2.1);
    ctx.save();
    rr(ctx, 0, 0, CARD_W, CH, 16);
    ctx.clip();
    ctx.fillStyle = look.accent;
    ctx.fillRect(0, fy, CARD_W * pf, FOOT_H);
    ctx.beginPath();
    ctx.rect(0, fy, CARD_W * pf, FOOT_H);
    ctx.clip();
    ctx.fillStyle = look.ink;
    ctx.textAlign = "center";
    fitFont(ctx, `${stamp}  ▸`, CARD_W - PAD * 2, 40, 24, disp);
    ctx.fillText(`${stamp}  ▸`, CARD_W / 2, fy + 43);
    const sh = sec == null ? -1 : clamp01((sec - (2.1 + OFF) * k) / (0.45 * k));
    if (sh > 0 && sh < 1) {
      const sx = -120 + (CARD_W + 240) * sh;
      const sg = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0);
      sg.addColorStop(0, "rgba(255,255,255,0)");
      sg.addColorStop(0.5, "rgba(255,255,255,0.55)");
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 60, fy, 120, FOOT_H);
    }
    ctx.restore();
  }
  ctx.restore();
  ctx.restore();
}
