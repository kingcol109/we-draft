// src/components/videoAssets/ring.js
//
// The circle that identifies a player on the film — shared by the Assets
// sets (Player Identification, Scouting Card). A perfect circle (user,
// 2026-11-25) in the look's ring color (never green — lookOf). Pure canvas.

const ease = (p) => 1 - (1 - p) ** 3;
const alpha = (hex, a) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
};

// The ring's stroke width for a radius.
export const ringWidth = (r) => Math.max(6, Math.round(r * 0.085));

// sweep 0–1: how much of it has drawn on (clockwise from the top); grow ≥ 1:
// its settle from a touch larger; pulse 0–1 or null: the one pulse ring out;
// out 0–1: the clip's fade (multiplies the pulse).
export function drawRing(ctx, { cx, cy, r }, color, { sweep = 1, grow = 1, pulse = null, out = 1 } = {}) {
  const lw = ringWidth(r);
  const arc = (lineW, stroke) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.arc(cx, cy, r * grow, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep);
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowColor = alpha(color === "#ffffff" ? "#000000" : color, 0.55);
  ctx.shadowBlur = 18;
  // A dark under-stroke so a light ring reads on a bright field.
  arc(lw + 6, "rgba(0,0,0,0.35)");
  ctx.shadowBlur = 0;
  arc(lw, color);
  ctx.restore();
  if (pulse != null && pulse > 0 && pulse < 1) {
    ctx.save();
    ctx.globalAlpha *= out * (1 - pulse) * 0.8;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw * (1 - pulse * 0.6);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1 + 0.32 * ease(pulse)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// The line from the circle's edge to the nearest point of a box { x, y, w, h },
// drawn p (0–1) of the way. Nothing when the box sits on the circle.
export function drawConnector(ctx, { cx, cy, r }, box, color, p = 1) {
  if (p <= 0) return;
  const nx = Math.max(box.x, Math.min(box.x + box.w, cx));
  const ny = Math.max(box.y, Math.min(box.y + box.h, cy));
  const dist = Math.hypot(nx - cx, ny - cy);
  const edge = r + ringWidth(r) / 2 + 2;
  if (dist <= edge + 6) return;
  const x0 = cx + ((nx - cx) / dist) * edge;
  const y0 = cy + ((ny - cy) / dist) * edge;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + (nx - x0) * p, y0 + (ny - y0) * p);
  ctx.stroke();
  ctx.restore();
}
