// src/utils/film/ink.js
//
// ✏️ Draw's strokes on a canvas — shared by the PC's film (FilmPlayer) and the
// iPad's drawing layer (/film/remote). No Firebase here: FilmPlayer stays pure.

export const INK_COLORS = ["#f6a21d", "#ffffff", "#ff4d4d", "#3b9cff"];
/** Draw strokes onto a 2D context w × h (the frame). Lines scale with the
 *  frame so the iPad and the PC look the same. */
export function drawInk(ctx, strokes, w, h) {
  const lw = Math.max(2, h * 0.009);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  (strokes || []).forEach((s) => {
    const p = s?.p || [];
    if (p.length < 2) return;
    const pts = [];
    for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i] * w, p[i + 1] * h]);
    const path = () => {
      ctx.beginPath();
      const [a, b] = [pts[0], pts[pts.length - 1]];
      if (s.tool === "circle") {
        ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(1, Math.abs(b[0] - a[0]) / 2), Math.max(1, Math.abs(b[1] - a[1]) / 2), 0, 0, Math.PI * 2);
      } else if (s.tool === "arrow") {
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const hl = lw * 4.5;
        ctx.moveTo(b[0] - hl * Math.cos(ang - 0.45), b[1] - hl * Math.sin(ang - 0.45));
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(b[0] - hl * Math.cos(ang + 0.45), b[1] - hl * Math.sin(ang + 0.45));
      } else {
        ctx.moveTo(pts[0][0], pts[0][1]);
        if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      }
    };
    // A dark edge under the color so it reads on any field.
    path();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = lw * 1.9;
    ctx.stroke();
    path();
    ctx.strokeStyle = s.color || INK_COLORS[0];
    ctx.lineWidth = lw;
    ctx.stroke();
  });
  ctx.restore();
}
