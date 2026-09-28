// src/sim/render.js
// ── Canvas rendering. Deliberately plain: the field is drawn from the same
// yard coordinates the simulation measures in (the canvas transform maps
// yards → pixels, y up = downfield), players are the broad-shouldered body
// with the colored chest square, and everything else is debug overlay.
//
// The vision mask shows only what the controlled player's eyes can see:
// black outside his cone, dimmed in the periphery, and shadowed behind
// standing bodies — the same geometry perception.js uses. ──

import { TUNING } from "./config.js";
import { clamp } from "./math.js";
import { FIELD, CX, LOS, OL_SPLIT, GAPS, goalLineY } from "./field.js";
import { eyePoint, occluderHeight } from "./systems/perception.js";
import { predictPath, throwProfile, solveThrow } from "./systems/ball.js";
import { OFFENSE_PLAYS, ROUTES, FORMATIONS, COVERAGES, FRONTS } from "./playbook.js";

const C = {
  bg: "#16361b",
  grass: "#2f6b35",
  grassAlt: "#2b6431",
  endzone: "#24542a",
  line: "rgba(255,255,255,0.88)",
  lineSoft: "rgba(255,255,255,0.55)",
  los: "#3b82f6",
  firstDown: "#facc15",
  offense: "#0055A5",
  defense: "#F6A21D",
  body: "#ffffff", // the head square
  outline: "#000000",
  ball: "#8b4a1c",
};

export function createCamera() {
  return { x: CX, y: LOS + 8, scale: 16, W: 800, H: 600, dpr: 1, zoom: 1 };
}

// What the camera needs to keep on screen right now.
function framePoints(engine) {
  const b = engine.ball;
  const pts = [{ x: b.x, y: b.y }];
  const carrier = engine.carrier();
  const runPhase = carrier && carrier.id !== "QB" && carrier.team === "O";
  if (engine.passing && !runPhase && engine.state !== "PLAY_END") {
    // The pass game: QB, every eligible, and where a thrown ball comes down.
    for (const p of engine.offense) if (p.role === "WR" || p.role === "RB" || p.role === "QB") pts.push(p);
    // Before the throw, where the routes are going — so a deep concept is
    // framed from the start instead of the camera chasing it.
    if (b.state !== "air") {
      for (const p of engine.offense) {
        const a = p.assignment;
        if (a.kind !== "route" || !a.route) continue;
        const r = routePath({ ...p, x: p.home.x, y: p.home.y }, a.route, engine.byId.QB, engine.fakeSide || 1);
        const end = r[r.length - 1];
        // A vertical stem doesn't stop where the drawing does: frame the
        // depth it's really threatening.
        const legs = ROUTES[a.route] || [];
        const vertical = legs.length && legs[legs.length - 1].type === "vertical";
        pts.push({ x: end.x, y: vertical ? LOS + 34 : Math.min(end.y, LOS + 26) });
      }
    }
    if (b.state === "air") {
      const path = predictPath(b, 0);
      pts.push(path[path.length - 1]);
    }
  } else {
    // A runner: him, whoever is around him, and the field in front of him —
    // the assumption is he's headed for the end zone.
    const c = carrier || engine.byId[engine.controlledId()];
    pts.push(c);
    for (const p of engine.players) if (Math.hypot(p.x - c.x, p.y - c.y) < 12) pts.push(p);
    if (runPhase) {
      pts.push({ x: c.x + c.vx * 0.5, y: c.y + Math.max(8, c.vy * 1.3) });
      pts.run = true;
    }
  }
  if (engine.state === "PRE_SNAP") pts.push({ x: CX, y: LOS + 12 }, { x: CX, y: LOS - 6 });
  return pts;
}

export function updateCamera(cam, engine, W, H, dpr) {
  cam.W = W;
  cam.H = H;
  cam.dpr = dpr;
  const base = (W / (FIELD.width + 6)) * cam.zoom; // the tightest the camera will be
  const pts = framePoints(engine);
  let y0 = Infinity;
  let y1 = -Infinity;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const q of pts) {
    // Nothing worth framing lives past the end lines (a vertical near the
    // goal line would otherwise zoom out over the stands).
    const qy = clamp(q.y, 0, FIELD.length);
    y0 = Math.min(y0, qy);
    y1 = Math.max(y1, qy);
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
  }
  const PAD = 4;
  // Frame the play: pull back (down to 55% of the chosen zoom) until
  // everything fits, or come in (up to 1.3×) on a short, tight one.
  const fit = Math.min(H / (y1 - y0 + 2 * PAD), W / (x1 - x0 + 2 * PAD));
  const target = Math.max(base * 0.55, Math.min(base * 1.3, fit));
  // Following a ball carrier the camera has to keep up with him — and it
  // catches up fast the moment the carry starts (after a catch it was
  // framing the whole pass).
  if (pts.run && !cam.run) cam.runSince = performance.now();
  cam.run = !!pts.run;
  const catchUp = cam.run && performance.now() - (cam.runSince || 0) < 700;
  const k = catchUp ? 0.3 : cam.run ? 0.2 : 0.12;
  cam.scale = cam.scale ? cam.scale + (target - cam.scale) * k : target;
  // Spare room goes downfield: anchor the bottom just behind the backfield.
  const ty = Math.max((y0 + y1) / 2, y0 - PAD + H / 2 / target);
  cam.y += (ty - cam.y) * k;
  // Keep the view inside the field: stop at the back of either end zone
  // (plus a sliver of sideline apron).
  const halfH = H / 2 / cam.scale;
  const EDGE = 1.5;
  if (2 * halfH >= FIELD.length + 2 * EDGE) cam.y = FIELD.length / 2;
  else cam.y = clamp(cam.y, -EDGE + halfH, FIELD.length + EDGE - halfH);
  const halfW = W / 2 / cam.scale;
  const wide = halfW * 2 >= FIELD.width + 6;
  const tx = wide ? CX : Math.min(FIELD.width + 3 - halfW, Math.max(-3 + halfW, (x0 + x1) / 2));
  cam.x += (tx - cam.x) * (cam.run ? 0.16 : 0.1);
}

export const toScreen = (cam, x, y) => ({
  x: (x - cam.x) * cam.scale + cam.W / 2,
  y: cam.H / 2 - (y - cam.y) * cam.scale,
});

export const toField = (cam, sx, sy) => ({
  x: (sx - cam.W / 2) / cam.scale + cam.x,
  y: cam.y - (sy - cam.H / 2) / cam.scale,
});

function fieldTransform(ctx, cam) {
  const s = cam.scale * cam.dpr;
  ctx.setTransform(s, 0, 0, -s, (cam.W / 2 - cam.x * cam.scale) * cam.dpr, (cam.H / 2 + cam.y * cam.scale) * cam.dpr);
}
function screenTransform(ctx, cam) {
  ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
}

// ── Field ──
function drawField(ctx, cam, engine) {
  screenTransform(ctx, cam);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, cam.W, cam.H);
  fieldTransform(ctx, cam);
  const W = FIELD.width;
  const y0 = Math.max(0, Math.floor(cam.y - cam.H / 2 / cam.scale) - 1);
  const y1 = Math.min(FIELD.length, Math.ceil(cam.y + cam.H / 2 / cam.scale) + 1);

  for (let y = Math.floor(y0 / 5) * 5; y < y1; y += 5) {
    ctx.fillStyle = (y / 5) % 2 === 0 ? C.grass : C.grassAlt;
    ctx.fillRect(0, y, W, 5);
  }
  ctx.fillStyle = C.endzone;
  ctx.fillRect(0, 0, W, FIELD.endZone);
  ctx.fillRect(0, goalLineY, W, FIELD.endZone);

  ctx.strokeStyle = C.line;
  ctx.lineWidth = 0.22;
  ctx.strokeRect(0, 0, W, FIELD.length);

  for (let y = 10; y <= 110; y += 5) {
    if (y < y0 - 1 || y > y1 + 1) continue;
    ctx.lineWidth = y === 10 || y === 110 ? 0.22 : 0.11;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  // Hash marks and sideline ticks, every yard.
  ctx.lineWidth = 0.09;
  ctx.strokeStyle = C.lineSoft;
  const hash = FIELD.hashFromSideline;
  for (let y = Math.max(11, Math.ceil(y0)); y < Math.min(110, y1); y++) {
    if (y % 5 === 0) continue;
    ctx.beginPath();
    for (const hx of [hash, W - hash]) {
      ctx.moveTo(hx - 0.33, y);
      ctx.lineTo(hx + 0.33, y);
    }
    ctx.moveTo(0.3, y);
    ctx.lineTo(0.95, y);
    ctx.moveTo(W - 0.95, y);
    ctx.lineTo(W - 0.3, y);
    ctx.stroke();
  }
  // Line of scrimmage and the line to gain.
  ctx.lineWidth = 0.14;
  ctx.strokeStyle = C.los;
  ctx.beginPath();
  ctx.moveTo(0, LOS);
  ctx.lineTo(W, LOS);
  ctx.stroke();
  const ltg = engine.lineToGain ?? LOS + 10;
  if (ltg < goalLineY) {
    ctx.strokeStyle = C.firstDown;
    ctx.beginPath();
    ctx.moveTo(0, ltg);
    ctx.lineTo(W, ltg);
    ctx.stroke();
  }

  // Yard numbers (screen space so they read upright).
  screenTransform(ctx, cam);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `bold ${Math.max(10, cam.scale * 1.7)}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = 20; y <= 100; y += 10) {
    if (y < y0 || y > y1) continue;
    const n = y <= 60 ? y - 10 : 110 - y;
    for (const nx of [FIELD.numbersFromSideline, W - FIELD.numbersFromSideline]) {
      const s = toScreen(cam, nx, y);
      ctx.fillText(String(n), s.x, s.y);
    }
  }
}

// ── Players ──
function drawPlayer(ctx, p, { selected, dim } = {}) {
  const B = TUNING.body;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.facing);
  if (dim) ctx.globalAlpha = 0.35;
  // Local frame: +x is forward. The broad side (width) is the front edge.
  // Body: team color (a dynasty team's own primary color).
  ctx.fillStyle = (p.info && p.info.team && p.info.team.color) || (p.team === "O" ? C.offense : C.defense);
  ctx.strokeStyle = selected ? "#e11d48" : C.outline;
  ctx.lineWidth = selected ? 0.12 : 0.06;
  ctx.fillRect(-B.depth / 2, -B.width / 2, B.depth, B.width);
  ctx.strokeRect(-B.depth / 2, -B.width / 2, B.depth, B.width);
  // Chest square, centered on the broad front edge.
  ctx.fillStyle = C.body; // head: always white
  ctx.fillRect(B.depth / 2 - B.front / 2, -B.front / 2, B.front, B.front);
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(B.depth / 2 - B.front / 2, -B.front / 2, B.front, B.front);
  ctx.restore();
}

function drawLabels(ctx, cam, players, opts) {
  screenTransform(ctx, cam);
  ctx.font = `bold ${Math.max(9, cam.scale * 0.55)}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const p of players) {
    if (opts.hidden && opts.hidden.has(p.id)) continue;
    const s = toScreen(cam, p.x, p.y - 0.75);
    const tag = p.info ? `${p.info.number}` : p.id; // dynasty: jersey number
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(tag, s.x + 1, s.y + 1);
    ctx.fillStyle = p.team === "O" ? "#cfe3ff" : "#ffe3b3";
    ctx.fillText(tag, s.x, s.y);
  }
}

// ── Ball ──
function drawBall(ctx, ball) {
  if (ball.state === "dead") return;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, 0.22, 0.14, Math.atan2(ball.vy, ball.vx) || 0, 0, Math.PI * 2);
  ctx.fill();
  const up = Math.max(0, ball.z - TUNING.ball.catchHeight) * 0.35; // same as the arcs
  const s = 1 + ball.z * 0.1;
  ctx.fillStyle = C.ball;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y + up, 0.3 * s, 0.18 * s, Math.atan2(ball.vy, ball.vx) || Math.PI / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ── Vision mask ──
function wedge(ctx, e, r, a0, a1) {
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.arc(e.x, e.y, r, a0, a1);
  ctx.closePath();
}

function drawVisionMask(mctx, cam, viewer, players) {
  const V = TUNING.vision;
  screenTransform(mctx, cam);
  mctx.globalCompositeOperation = "source-over";
  mctx.clearRect(0, 0, cam.W, cam.H);
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, cam.W, cam.H);
  fieldTransform(mctx, cam);
  const e = eyePoint(viewer);
  const look = viewer.gaze ?? viewer.facing;
  const half = V.fov / 2;
  const focus = V.focus / 2;
  // Cut the cone out.
  mctx.globalCompositeOperation = "destination-out";
  mctx.fillStyle = "#000";
  wedge(mctx, e, V.range, look - half, look + half);
  mctx.fill();
  // Periphery is dimmer.
  mctx.globalCompositeOperation = "source-over";
  mctx.fillStyle = "rgba(0,0,0,0.38)";
  wedge(mctx, e, V.range, look + focus, look + half);
  mctx.fill();
  wedge(mctx, e, V.range, look - half, look - focus);
  mctx.fill();
  // Far is dimmer.
  const g = mctx.createRadialGradient(e.x, e.y, V.clearRange, e.x, e.y, V.range);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${1 - V.farFactor})`);
  mctx.fillStyle = g;
  wedge(mctx, e, V.range, look - half, look + half);
  mctx.fill();
  // Shadows behind standing bodies.
  mctx.fillStyle = "#000";
  for (const q of players) {
    if (q === viewer || occluderHeight(q) < 1.9) continue;
    const dx = q.x - e.x;
    const dy = q.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.7 || d > V.range) continue;
    const a = Math.atan2(dy, dx);
    const w = Math.asin(Math.min(1, V.occluderRadius / d));
    const r0 = d + 0.3;
    const r1 = V.range + 5;
    mctx.beginPath();
    mctx.moveTo(e.x + Math.cos(a - w) * r0, e.y + Math.sin(a - w) * r0);
    mctx.lineTo(e.x + Math.cos(a - w) * r1, e.y + Math.sin(a - w) * r1);
    mctx.lineTo(e.x + Math.cos(a + w) * r1, e.y + Math.sin(a + w) * r1);
    mctx.lineTo(e.x + Math.cos(a + w) * r0, e.y + Math.sin(a + w) * r0);
    mctx.closePath();
    mctx.fill();
  }
}

// ── Debug overlays (field space) ──
function arrow(ctx, x, y, dx, dy, color, width = 0.08) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dx, y + dy);
  ctx.stroke();
}

function cross(ctx, x, y, r, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x - r, y + r);
  ctx.lineTo(x + r, y - r);
  ctx.stroke();
}

function drawDebugField(ctx, engine, selectedId) {
  const V = TUNING.vision;
  const sel = selectedId ? engine.byId[selectedId] : null;

  // Vision cones.
  for (const p of engine.players) {
    if (p !== sel) continue; // one at a time — 22 cones bury everything
    const e = eyePoint(p);
    ctx.fillStyle = p.team === "O" ? "rgba(0,85,165,0.07)" : "rgba(246,162,29,0.07)";
    ctx.strokeStyle = p.team === "O" ? "rgba(120,170,255,0.35)" : "rgba(255,190,90,0.35)";
    ctx.lineWidth = 0.05;
    wedge(ctx, e, V.range, (p.gaze ?? p.facing) - V.fov / 2, (p.gaze ?? p.facing) + V.fov / 2);
    ctx.fill();
    ctx.stroke();
  }

  // Zone of the selected defender.
  if (sel && sel.assignment.cover && sel.assignment.cover.def) {
    const z = sel.assignment.cover.def;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.setLineDash([0.4, 0.3]);
    ctx.lineWidth = 0.08;
    ctx.strokeRect(z.box.x0, LOS + z.box.d0, z.box.x1 - z.box.x0, z.box.d1 - z.box.d0);
    ctx.setLineDash([]);
  }

  for (const p of engine.players) {
    // Collision region.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.arc(p.x, p.y, TUNING.body.radius, 0, Math.PI * 2);
    ctx.stroke();
    // Velocity (yellow) and desired movement (cyan).
    arrow(ctx, p.x, p.y, p.vx * 0.35, p.vy * 0.35, "#facc15");
    if (p.desired.dir != null && p.desired.speed > 0.1)
      arrow(ctx, p.x, p.y, Math.cos(p.desired.dir) * p.desired.speed * 0.3, Math.sin(p.desired.dir) * p.desired.speed * 0.3, "#22d3ee", 0.05);
    // Engagements.
    if (p.engagedWith) {
      const d = engine.byId[p.engagedWith];
      arrow(ctx, p.x, p.y, d.x - p.x, d.y - p.y, "#ef4444", 0.12);
    }
    // Intent target / projected point.
    const it = p.intent;
    const pt = (it && it.debug && it.debug.point) || (it && it.moveTo);
    if (pt && (!sel || p === sel)) {
      ctx.strokeStyle = p.team === "O" ? "rgba(147,197,253,0.6)" : "rgba(253,186,116,0.6)";
      ctx.setLineDash([0.25, 0.25]);
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.setLineDash([]);
      cross(ctx, pt.x, pt.y, 0.25, it.debug && it.debug.kind === "ball" ? "#f472b6" : "#e5e7eb");
    }
    // Route landmarks.
    if (it && it.debug && it.debug.landmark) {
      ctx.fillStyle = "rgba(96,165,250,0.8)";
      ctx.beginPath();
      ctx.arc(it.debug.landmark.x, it.debug.landmark.y, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Selected player's beliefs about everyone else: where he *thinks* they are.
  if (sel) {
    for (const [id, m] of Object.entries(sel.perception.memory)) {
      const q = engine.byId[id];
      ctx.globalAlpha = Math.max(0.15, m.conf);
      ctx.strokeStyle = m.vis > 0.15 ? "#a7f3d0" : "#f87171";
      ctx.lineWidth = 0.06;
      ctx.setLineDash([0.15, 0.12]);
      ctx.strokeRect(m.x - 0.4, m.y - 0.4, 0.8, 0.8);
      ctx.setLineDash([]);
      if (Math.hypot(m.x - q.x, m.y - q.y) > 0.4) arrow(ctx, m.x, m.y, q.x - m.x, q.y - m.y, "rgba(248,113,113,0.6)", 0.04);
      ctx.globalAlpha = 1;
    }
    const bk = sel.perception.ball;
    if (bk.path && engine.ball.state === "air") {
      ctx.strokeStyle = "rgba(244,114,182,0.8)";
      ctx.setLineDash([0.2, 0.2]);
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      bk.path.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Inside zone: the unblocked read man, and the mesh point.
  if (engine.zone && (engine.zone.readId || engine.zone.optionKeyId)) {
    const r = engine.byId[engine.zone.readId || engine.zone.optionKeyId];
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (engine.playType === "run" && !engine.handedOff && !engine.qbKeep && engine.state !== "PRE_SNAP") {
    const mp = engine.meshPoint();
    cross(ctx, mp.x, mp.y, 0.3, "#a78bfa");
  }

  // True ball trajectory + landing point.
  const b = engine.ball;
  if (b.state === "air") {
    const path = predictPath(b, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.setLineDash([0.3, 0.25]);
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    path.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    const land = path[path.length - 1];
    cross(ctx, land.x, land.y, 0.4, "#ffffff");
  }
}

function drawDebugText(ctx, cam, engine, selectedId) {
  screenTransform(ctx, cam);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const fs = Math.max(9, cam.scale * 0.5);
  for (const p of engine.players) {
    if (!p.intent) continue;
    if (selectedId && p.id !== selectedId && p.team === "O") continue;
    const s = toScreen(cam, p.x, p.y + 0.7);
    ctx.font = `${fs}px Arial, sans-serif`;
    const lines = [p.intent.label];
    if (p.pending) lines.push(`→ ${p.pending.label}`);
    const pt = p.intent.debug && p.intent.debug.point;
    if (pt && pt.tMe != null) lines.push(`me ${pt.tMe.toFixed(2)}s / ball ${pt.tBall.toFixed(2)}s`);
    lines.forEach((ln, i) => {
      const y = s.y - (lines.length - 1 - i) * (fs + 2);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const w = ctx.measureText(ln).width;
      ctx.fillRect(s.x - w / 2 - 2, y - fs - 1, w + 4, fs + 2);
      ctx.fillStyle = i === 0 ? "#fff" : "#fbbf24";
      ctx.fillText(ln, s.x, y);
    });
  }
}

// ── HUD ──
function drawHud(ctx, cam, engine, ui, nowMs) {
  screenTransform(ctx, cam);
  // Throw meter at the cursor, while the throw is being held.
  if (engine.throwCharging) {
    const hold = engine.chargeSeconds(nowMs);
    const pr = throwProfile(hold);
    const s = toScreen(cam, engine.input.mouse.x, engine.input.mouse.y);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 20, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 20, -Math.PI / 2, -Math.PI / 2 + pr.u * Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fde047";
    const th = solveThrow(engine.byId.QB, engine.input.mouse.x, engine.input.mouse.y, hold);
    ctx.fillText(`${pr.type} ${Math.round((th.angle * 180) / Math.PI)}° · ${th.speed.toFixed(0)} yd/s`, s.x, s.y - 28);
  }
  // Carrier intent line.
  const ctrl = engine.byId[engine.controlledId()];
  if (ctrl && ctrl.id !== "QB" && ctrl.debug.intentPoint && engine.state !== "PRE_SNAP") {
    const a = toScreen(cam, ctrl.x, ctrl.y);
    const b = toScreen(cam, engine.input.mouse.x, engine.input.mouse.y);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Speed option: the pitch key.
  if (engine.canPitch() && engine.zone && engine.zone.optionKeyId) {
    const r = engine.byId[engine.zone.optionKeyId];
    const sp = toScreen(cam, r.x, r.y + 1.1);
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#f472b6";
    ctx.fillText("PITCH KEY — SPACE to pitch", sp.x, sp.y);
  }
  // Zone read cue.
  if (engine.canPull() && engine.state !== "PRE_SNAP" && engine.zone && engine.zone.readId) {
    const r = engine.byId[engine.zone.readId];
    const sp = toScreen(cam, r.x, r.y + 1.1);
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#f472b6";
    ctx.fillText(engine.play.rpo ? "READ — SPACE to pull · click to throw" : "READ — SPACE to pull", sp.x, sp.y);
  }
  // Status line.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 13px Arial, sans-serif";
  const t = engine.snapAt == null ? 0 : engine.t - engine.snapAt;
  const status = `${engine.state.replace(/_/g, " ")}   ${t.toFixed(2)}s${ui.paused ? "   ⏸ PAUSED" : ""}${
    ui.speed !== 1 ? `   ${ui.speed}×` : ""
  }`;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(8, 8, ctx.measureText(status).width + 16, 22);
  ctx.fillStyle = "#fff";
  ctx.fillText(status, 16, 12);
  if (engine.state === "PRE_SNAP") {
    const hint =
      engine.playType === "pass"
        ? "SPACE to snap · hold Z / X for offense / defense art · WASD move QB · mouse = eyes · hold/release click to throw"
        : `SPACE to snap · hold Z / X for offense / defense art · mouse = RB intent (direction + distance = aggression) · A/D hard cut · W burst${
            OFFENSE_PLAYS[engine.config.play].option
              ? " · speed option: the QB attacks the pitch key — SPACE pitches (mouse takes the QB)"
              : OFFENSE_PLAYS[engine.config.play].rpo
              ? " · during the ride, click (hold/release) to pull and throw, SPACE to pull and keep — give otherwise"
              : OFFENSE_PLAYS[engine.config.play].read
              ? " · during the ride, SPACE pulls it (give otherwise)"
              : ""
          }`;
    ctx.font = "12px Arial, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(8, 34, ctx.measureText(hint).width + 16, 20);
    ctx.fillStyle = "#e5e7eb";
    ctx.fillText(hint, 16, 38);
  }
  // Result banner.
  if (engine.result) {
    const r = engine.result;
    const yds = r.type === "INCOMPLETE" || r.type === "INTERCEPTION" ? "" : `  ${r.yards >= 0 ? "+" : ""}${r.yards.toFixed(1)} yd`;
    const txt = `${r.type.replace(/_/g, " ")}${yds}`;
    ctx.font = "bold 26px Arial, sans-serif";
    ctx.textAlign = "center";
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(cam.W / 2 - w / 2 - 20, cam.H * 0.14 - 8, w + 40, 64);
    ctx.fillStyle = r.type === "INTERCEPTION" || r.type === "SACK" ? "#fca5a5" : "#fff";
    ctx.fillText(txt, cam.W / 2, cam.H * 0.14);
    ctx.font = "12px Arial, sans-serif";
    ctx.fillStyle = "#d1d5db";
    ctx.fillText((r.detail || "").slice(0, 110), cam.W / 2, cam.H * 0.14 + 34);
  }
}

// ── Play art (hold Z pre-snap): the offense's assignments, drawn from the
// same route landmarks and blocking call the players will execute. ──
const ART = { route: "#fde047", block: "#f8fafc", climb: "#93c5fd", track: "#86efac", read: "#f472b6" };

function artLine(ctx, pts, color, { dash = null, arrow = true, bar = false } = {}) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.16;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (bar) {
    // Block: a "T" at the end.
    const nx = -Math.sin(ang) * 0.5;
    const ny = Math.cos(ang) * 0.5;
    ctx.beginPath();
    ctx.moveTo(b.x - nx, b.y - ny);
    ctx.lineTo(b.x + nx, b.y + ny);
    ctx.stroke();
  } else if (arrow) {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(ang - 0.45) * 0.7, b.y - Math.sin(ang - 0.45) * 0.7);
    ctx.lineTo(b.x - Math.cos(ang + 0.45) * 0.7, b.y - Math.sin(ang + 0.45) * 0.7);
    ctx.closePath();
    ctx.fill();
  }
}

// Stop a block line just short of the man it's on.
function toward(a, b, short = 0.55) {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: b.x - ((b.x - a.x) / d) * short, y: b.y - ((b.y - a.y) / d) * short };
}

function routePath(p, name, qb, fakeSide = 1) {
  const side = Math.sign(p.home.x - CX) || 1;
  const h = { x: p.x, y: p.y };
  const legs = ROUTES[name] || [];
  const pts = [h];
  let cur = h;
  for (const leg of legs) {
    if (leg.type === "stem") {
      cur = { x: leg.fromBreak ? cur.x : p.x, y: LOS + leg.depth };
      pts.push(cur);
    } else if (leg.type === "spot") {
      cur = { x: p.home.x + side * leg.dx, y: LOS + leg.dy };
      pts.push(cur);
    } else if (leg.type === "comeback") {
      const g = Math.atan2(qb.y - cur.y, qb.x - cur.x);
      cur = { x: cur.x + Math.cos(g) * leg.dist, y: cur.y + Math.sin(g) * leg.dist };
      pts.push(cur);
    } else if (leg.type === "kickFake") {
      cur = { x: CX - fakeSide * (2 * OL_SPLIT + 0.8), y: LOS - 0.8 };
      pts.push(cur);
    } else if (leg.type === "angle") {
      const a = (leg.deg * Math.PI) / 180;
      const t = leg.boot ? -fakeSide : leg.dir === "in" ? -side : side;
      const room = t > 0 ? FIELD.width - 1.5 - cur.x : cur.x - 1.5;
      const L = Math.min(leg.length, Math.abs(room / Math.sin(a)));
      cur = { x: cur.x + t * Math.sin(a) * L, y: cur.y + Math.cos(a) * L };
      pts.push(cur);
    } else if (leg.type === "vertical") {
      const x = leg.fromBreak ? cur.x : p.home.x - side * leg.inset;
      if (!leg.fromBreak) pts.push({ x, y: LOS + 7 });
      cur = { x, y: Math.max(cur.y + 15, LOS + 22) };
      pts.push(cur);
    }
  }
  return pts;
}

function drawPlayArt(ctx, engine) {
  const qb = engine.byId.QB;
  const by = engine.byId;
  // Every route on the play — receivers, a screen back, an RPO's bubble.
  const drawRoutes = () => {
    for (const o of engine.offense) {
      const a = o.assignment;
      if (a.kind === "route" && a.route) artLine(ctx, routePath(o, a.route, qb, engine.fakeSide || 1), ART.route);
    }
  };
  if (engine.playType === "pass") {
    drawRoutes();
    const sc = engine.play.screen;
    if (sc) {
      // Screen: the line (and any blockers) release to lead it.
      const t = by[sc.target];
      const tr = t.assignment.route ? routePath(t, t.assignment.route, qb) : [t];
      const spot = tr[tr.length - 1];
      for (const o of engine.offense) {
        const k = o.assignment.kind;
        if (k !== "screen" && k !== "screenBlock") continue;
        const inside = Math.sign(CX - spot.x) || 1;
        artLine(ctx, [{ x: o.x, y: o.y }, { x: lerpN(o.x, spot.x + inside * 1.5, 0.75), y: Math.max(LOS + 1.5, spot.y + 3) }], ART.climb, { dash: [0.35, 0.3] });
      }
      return;
    }
    if (engine.fakeSide) {
      // Play action: the back's fake into the line, the QB's boot the other way.
      const rb = by.RB;
      const ps = engine.fakeSide;
      artLine(ctx, [{ x: rb.x, y: rb.y }, engine.meshPoint(), { x: CX + 2.8 * ps, y: LOS + 0.5 }], ART.track, { dash: [0.35, 0.3] });
      artLine(ctx, [{ x: qb.x, y: qb.y }, { x: qb.x - 0.5 * ps, y: qb.y + 0.3 }, { x: qb.x - 7 * ps, y: qb.y + 0.5 }], ART.read, { dash: [0.3, 0.3] });
    }
    // Protection: kick back and set — or, on play action, the run's blocks.
    if (!engine.fakeSide)
      for (const o of engine.offense) {
        if (o.role !== "OL") continue;
        artLine(ctx, [{ x: o.x, y: o.y }, { x: o.x, y: o.y - 1.4 }], ART.block, { bar: true });
      }
    const rb = by.RB;
    if (!engine.fakeSide) artLine(ctx, [{ x: rb.x, y: rb.y }, { x: qb.x - 1.3, y: qb.y + 0.4 }], ART.block, { bar: true });
    else drawRunBlocking(ctx, engine, true); // play action: the line blocks the fake
    return;
  }
  drawRunBlocking(ctx, engine);
  drawRoutes(); // an RPO's route
}

const lerpN = (a, b, t) => a + (b - a) * t;

function drawRunBlocking(ctx, engine, lineOnly = false) {
  const qb = engine.byId.QB;
  const by = engine.byId;
  const call = engine.previewZoneCall();
  if (!call) return;
  const ps = call.ps;
  // Line: zone step, then to his man (combos converge; the climber goes on).
  for (const o of engine.offense) {
    if (o.role !== "OL") continue;
    const j = call.jobs[o.id];
    if (call.scheme === "power") {
      // Power: down blocks, the pull, the hinge.
      if (j.kind === "pull") {
        // Pull and kick out the playside end, inside-out, behind the line.
        const k = j.kick ? by[j.kick] : null;
        const pts = [{ x: o.x, y: o.y }, { x: o.x + 0.5 * ps, y: LOS - 1.8 }];
        if (k) pts.push({ x: k.x - 1.2 * ps, y: LOS - 1.4 }, toward({ x: k.x - 1.2 * ps, y: LOS - 1.4 }, k, 0.5));
        artLine(ctx, pts, ART.climb, { bar: !!k });
      } else if (j.kind === "hinge") {
        // Pull check: into the vacated gap, shoulders to the backside.
        const d = j.dl ? by[j.dl] : null;
        artLine(ctx, [{ x: o.x, y: o.y }, d ? toward(o, d) : { x: o.x + 0.8 * ps, y: LOS - 1.1 }], ART.block, { bar: true });
      } else if (j.kind === "wrap") {
        // Counter: the backside tackle pulls behind the guard and wraps up
        // through the hole to a linebacker.
        const lb = j.lb ? by[j.lb] : null;
        const turn = { x: o.x + 0.5 * ps, y: LOS - 1.8 };
        const hole = { x: CX + 1.5 * OL_SPLIT * ps, y: LOS - 0.6 };
        artLine(ctx, [{ x: o.x, y: o.y }, turn, hole, lb ? toward(hole, lb) : { x: hole.x, y: LOS + 3 }], ART.climb, { bar: !!lb });
      } else if (j.kind === "climb") {
        const lb = j.lb ? by[j.lb] : null;
        if (lb) artLine(ctx, [{ x: o.x, y: o.y }, toward(o, lb)], ART.climb, { bar: true });
      } else {
        const dl = by[j.kind === "combo" ? j.combo.dl : j.dl];
        if (dl) artLine(ctx, [{ x: o.x, y: o.y }, toward(o, dl)], ART.block, { bar: true });
      }
      continue;
    }
    const step = { x: o.x + 0.6 * ps, y: o.y + 0.15 };
    if (j.kind === "climb") {
      const lb = j.lb ? by[j.lb] : null;
      artLine(ctx, [{ x: o.x, y: o.y }, step, lb ? toward(step, lb) : { x: step.x + ps, y: LOS + 4 }], ART.climb, { bar: !!lb });
      continue;
    }
    const dlId = j.kind === "combo" ? j.combo.dl : j.dl;
    const dl = by[dlId];
    artLine(ctx, [{ x: o.x, y: o.y }, step, toward(step, dl)], ART.block, { bar: true });
  }
  for (const c of call.combos) {
    if (!c.lb) continue;
    const dl = by[c.dl];
    const lb = by[c.lb];
    artLine(ctx, [{ x: dl.x, y: dl.y + 0.3 }, toward(dl, lb)], ART.climb, { dash: [0.4, 0.3], bar: true });
  }
  if (lineOnly) return;
  // Receivers: the man on them.
  for (const [wid, did] of Object.entries(call.stalk)) {
    const w = by[wid];
    artLine(ctx, [{ x: w.x, y: w.y }, toward(w, by[did], 0.7)], ART.block, { bar: true });
  }
  // Read man.
  if (call.readId) {
    const r = by[call.readId];
    ctx.strokeStyle = ART.read;
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Back's track: through the mesh to his aiming point, then up — the
  // playside guard's hip on inside zone, where a tight end would be on
  // outside zone.
  const rb = by.RB;
  const mesh = engine.meshPoint();
  const line = engine.offense.filter((o) => o.role === "OL").sort((a, b) => ps * (a.x - b.x));
  const aim =
    call.scheme === "outside"
      ? { x: line[4].x + 1.4 * ps, y: LOS - 0.4 }
      : call.scheme === "power"
      ? { x: line[4].x + 0.9 * ps, y: LOS - 0.4 } // the hole, behind the puller
      : { x: line[3].x + 0.6 * ps, y: LOS - 0.4 };
  artLine(ctx, [{ x: rb.x, y: rb.y }, mesh, aim, { x: aim.x + 0.3 * ps, y: LOS + 4 }], ART.track);
  if (call.readId) {
    // QB: ride, then (on a pull) the backside.
    artLine(ctx, [{ x: qb.x, y: qb.y }, { x: qb.x - 3.5 * ps, y: qb.y + 2.5 }], ART.read, { dash: [0.3, 0.3] });
  }
  if (call.scheme === "power") {
    // H leads up through the hole on the playside backer.
    const h = by.H;
    const tackle = by[ps > 0 ? "RT" : "LT"];
    const hole = { x: tackle.x + 0.9 * ps, y: LOS - 0.2 };
    const lb = call.leadLB ? by[call.leadLB] : null;
    artLine(ctx, [{ x: h.x, y: h.y }, hole, lb ? toward(hole, lb) : { x: hole.x, y: LOS + 4 }], ART.block, { bar: !!lb });
  }
  if (call.kickId) {
    // Split zone: H across the formation, behind the line, to kick out the end.
    const h = by.H;
    const k = by[call.kickId];
    const side = Math.sign(k.x - CX) || 1;
    const via = Math.sign(h.x - CX) === side ? [] : [{ x: CX + side * (2 * OL_SPLIT + 0.2), y: LOS - 1.8 }]; // split: across the formation
    artLine(ctx, [{ x: h.x, y: h.y }, ...via, toward({ x: k.x - side * 0.4, y: LOS - 1 }, k, 0.5)], ART.block, { bar: true });
  }
}

function drawArtLegend(ctx, cam, engine) {
  screenTransform(ctx, cam);
  const call = engine.playType === "run" ? engine.previewZoneCall() : null;
  const lines = [`PLAY ART — ${FORMATIONS[engine.config.formation].label.split(" (")[0]} · ${OFFENSE_PLAYS[engine.config.play].label}`];
  if (call) {
    for (const [id, j] of Object.entries(call.jobs)) {
      if (j.kind === "base") lines.push(`${id}: ${j.dl}`);
      else if (j.kind === "down") lines.push(`${id}: ${j.back ? "back" : "down"} on ${j.dl}`);
      else if (j.kind === "pull") lines.push(`${id}: pull, kick out ${j.kick || "—"}`);
      else if (j.kind === "hinge") lines.push(`${id}: pull check${j.dl ? " (" + j.dl + ")" : ""}`);
      else if (j.kind === "climb") lines.push(`${id}: climb → ${j.lb || "2nd level"}`);
    }
    for (const c of call.combos) lines.push(`${c.back}+${c.play}: combo ${c.dl} → ${c.lb || "—"}`);
    if (call.readId) lines.push(`Read: ${call.readId} (SPACE to pull)`);
    if (call.kickId) lines.push(`H: kick out ${call.kickId}`);
    if (call.scheme === "power") lines.push(`H: lead on ${call.leadLB || "—"}`);
    if (call.endId && !call.readId && !call.kickId) lines.push(`Unblocked: ${call.endId}`);
  }
  ctx.font = "12px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(cam.W - w - 8, 62, w, lines.length * 16 + 10);
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? "#fde047" : "#e5e7eb";
    ctx.fillText(l, cam.W - w, 67 + i * 16);
  });
}

// ── Defensive play art (hold X pre-snap): every defender's responsibility
// from his call — rush lanes, zone drops (and the zone), man assignments. ──
const DEF_ART = { rush: "#f87171", under: "#38bdf8", over: "#c084fc", man: "#fbbf24" };

function defJob(d) {
  const c = d.assignment.cover;
  if (c.type === "rush") return `rush ${d.assignment.gap || ""}`.trim();
  if (c.type === "man") return `man on ${c.target}`;
  return c.def ? c.def.name : "zone";
}

function drawDefenseArt(ctx, engine) {
  // Zone areas first, underneath everything.
  for (const d of engine.defense) {
    const c = d.assignment.cover;
    if (c.type !== "zone" || !c.def) continue;
    const b = c.def.box;
    const col = c.def.kind === "over" ? "rgba(192,132,252,0.10)" : "rgba(56,189,248,0.10)";
    ctx.fillStyle = col;
    ctx.fillRect(b.x0, LOS + Math.max(b.d0, 0), b.x1 - b.x0, Math.min(b.d1, 28) - Math.max(b.d0, 0));
  }
  for (const d of engine.defense) {
    const c = d.assignment.cover;
    const from = { x: d.x, y: d.y };
    if (c.type === "rush") {
      const gx = GAPS[d.assignment.gap] != null ? CX + GAPS[d.assignment.gap] : d.x;
      artLine(ctx, [from, { x: gx, y: LOS - 0.8 }, { x: CX + (gx - CX) * 0.4, y: LOS - 4 }], DEF_ART.rush);
    } else if (c.type === "man") {
      const m = engine.byId[c.target];
      artLine(ctx, [from, toward(from, m, 0.6)], DEF_ART.man, { dash: [0.35, 0.3] });
    } else if (c.def) {
      const h = { x: c.def.home.x, y: LOS + c.def.home.d };
      artLine(ctx, [from, h], c.def.kind === "over" ? DEF_ART.over : DEF_ART.under);
    }
  }
}

function drawDefArtLegend(ctx, cam, engine) {
  screenTransform(ctx, cam);
  const lines = [`DEFENSE — ${FRONTS[engine.config.front] || engine.config.front} ${COVERAGES[engine.config.coverage]}`];
  for (const d of engine.defense) {
    const g = d.assignment.gap;
    lines.push(`${d.id}: ${defJob(d)}${g && d.assignment.cover.type !== "rush" ? ` · run: ${g}` : ""}`);
  }
  ctx.font = "12px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(8, 62, w, lines.length * 16 + 10);
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? "#fca5a5" : "#e5e7eb";
    ctx.fillText(l, 16, 67 + i * 16);
  });
}

// ── Throw visuals (field space). The ball is drawn lifted by its height
// (see drawBall), so arcs use the same lift and read as the real flight. ──
const LIFT = 0.35;
const PREVIEW_HOLD = 0.3; // s — the throw the pre-press trail shows (a firm ball)

// Height is drawn relative to chest height (where throws are caught), so
// the arc's end sits right on the catch point — and the ball rides on it.
const lift = (z) => Math.max(0, z - TUNING.ball.catchHeight) * LIFT;

// The flight up to where it comes back down to chest height (the catch
// point), not on to the grass.
function toCatchPoint(path) {
  const cz = TUNING.ball.catchHeight;
  const i = path.findIndex((q, k) => k > 0 && q.z <= cz && path[k - 1].z > q.z);
  return i < 0 ? path : path.slice(0, i + 1);
}

function arcPath(ctx, path) {
  ctx.beginPath();
  path.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y + lift(s.z)) : ctx.moveTo(s.x, s.y + lift(s.z))));
}

function drawThrowVisuals(ctx, cam, engine, nowMs) {
  const qb = engine.byId.QB;
  // Aiming trail whenever the QB can throw: exactly the ball a release now
  // would produce (hold → arc and speed, the QB's own movement, his arm).
  // Before the button is pressed it previews a firm throw (dimmer) so you
  // can see the line; held, it shows the throw the current hold would make.
  const aiming = engine.throwCharging || engine.canThrow();
  if (aiming) {
    const hold = engine.throwCharging ? engine.chargeSeconds(nowMs) : PREVIEW_HOLD;
    ctx.save();
    if (!engine.throwCharging) ctx.globalAlpha = 0.55;
    const s = solveThrow(qb, engine.input.mouse.x, engine.input.mouse.y, hold);
    const start = {
      x: qb.x + Math.cos(qb.facing) * 0.3, y: qb.y + Math.sin(qb.facing) * 0.3,
      z: TUNING.ball.releaseHeight, vx: s.vx, vy: s.vy, vz: s.vz,
    };
    // Up to the catch point — where the ball comes back down to chest
    // height, which is what lines up with the cursor.
    const path = toCatchPoint(predictPath(start, 0));
    const land = path[path.length - 1];
    // Ground track (faint), then the arc (dotted).
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.strokeStyle = "rgba(253,224,71,0.85)";
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.35, 0.35]);
    arcPath(ctx, path);
    ctx.stroke();
    ctx.setLineDash([]);
    cross(ctx, land.x, land.y, 0.45, "#fde047");
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(land.x, land.y, 1.1, 0, Math.PI * 2);
    ctx.stroke();
    // Beyond his arm: the ring already shows where it really comes down.
    if (s.short) {
      ctx.save();
      ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
      const sp = toScreen(cam, land.x, land.y);
      ctx.font = "bold 11px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(253,224,71,0.9)";
      ctx.fillText("short", sp.x, sp.y + 26);
      ctx.restore();
    }
    ctx.restore();
  }
  // Thrown: the same dotted arc just lights up — same path, same dashes —
  // brightening and glowing over a moment; it fades once the ball's done.
  const path = engine.throwPath;
  if (path && engine.throwInfo && !engine.throwCharging) {
    const done = engine.ball.state !== "air" && engine.throwDoneAt != null;
    const fade = done ? Math.max(0, 1 - (engine.t - engine.throwDoneAt) / 1.2) : 1;
    const glow = clamp((engine.t - engine.throwInfo.at) / 0.12, 0, 1);
    if (fade > 0) {
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.shadowColor = "#fde047";
      ctx.shadowBlur = 12 * glow;
      ctx.strokeStyle = glow < 1 ? `rgba(254,240,138,${0.85 + 0.15 * glow})` : "#fef08a";
      ctx.lineWidth = 0.12 + 0.04 * glow;
      ctx.setLineDash([0.35, 0.35]);
      arcPath(ctx, toCatchPoint(path));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}

function drawPopups(ctx, cam, engine) {
  screenTransform(ctx, cam);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of engine.popups) {
    const age = engine.t - p.t;
    if (age > 2.4 || age < 0) continue;
    const s = toScreen(cam, p.x, p.y);
    const a = age < 1.8 ? 1 : 1 - (age - 1.8) / 0.6;
    ctx.globalAlpha = Math.max(0, a);
    const y = s.y - 34 - age * 22;
    ctx.font = "bold 20px Arial, sans-serif";
    const w1 = ctx.measureText(p.text).width;
    ctx.font = "13px Arial, sans-serif";
    const w2 = p.sub ? ctx.measureText(p.sub).width : 0;
    const w = Math.max(w1, w2);
    const h = p.sub ? 46 : 28;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(s.x - w / 2 - 10, y - 14, w + 20, h);
    ctx.font = "bold 20px Arial, sans-serif";
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, s.x, y);
    if (p.sub) {
      ctx.font = "13px Arial, sans-serif";
      ctx.fillStyle = "#e5e7eb";
      ctx.fillText(p.sub, s.x, y + 19);
    }
  }
  ctx.globalAlpha = 1;
}

// ── Frame ──
// ── Play-call card: the formation and its play art, drawn from a freshly
// built (never snapped) engine — the same art as holding Z on the field. ──
export function drawPlayCard(ctx, engine, W, H, dpr) {
  const span = 44; // yards across the card
  const scale = W / span;
  const cam = { x: CX, y: LOS + (H / scale) / 2 - 7, scale, W, H, dpr, zoom: 1 };
  screenTransform(ctx, cam);
  ctx.fillStyle = "#14532d";
  ctx.fillRect(0, 0, W, H);
  fieldTransform(ctx, cam);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 0.12;
  for (let y = Math.ceil((LOS - 10) / 5) * 5; y < LOS + 40; y += 5) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(FIELD.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = C.los;
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(0, LOS);
  ctx.lineTo(FIELD.width, LOS);
  ctx.stroke();
  drawPlayArt(ctx, engine);
  for (const p of engine.offense) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 0.75, 0, Math.PI * 2);
    ctx.fillStyle = p.role === "OL" ? "#cbd5e1" : C.offense;
    ctx.fill();
    ctx.lineWidth = 0.15;
    ctx.strokeStyle = "#0f172a";
    ctx.stroke();
  }
}

export function renderFrame(ctx, maskCtx, cam, engine, ui, nowMs) {
  drawField(ctx, cam, engine);
  fieldTransform(ctx, cam);

  const viewer = engine.byId[engine.viewerId()];
  const ctrl = engine.byId[engine.controlledId()];
  if (ui.debug) drawDebugField(ctx, engine, ui.selectedId);
  for (const p of engine.players) drawPlayer(ctx, p, { selected: p.id === ui.selectedId });
  drawBall(ctx, engine.ball);
  drawLabels(ctx, cam, engine.players, {});

  if (ui.mask) {
    drawVisionMask(maskCtx, cam, viewer, engine.players);
    screenTransform(ctx, cam);
    ctx.globalAlpha = ui.debug ? 0.55 : 1;
    ctx.drawImage(maskCtx.canvas, 0, 0, cam.W, cam.H);
    ctx.globalAlpha = 1;
    // You can always see yourself (and the ball in your hands).
    fieldTransform(ctx, cam);
    for (const q of viewer === ctrl ? [viewer] : [viewer, ctrl]) {
      drawPlayer(ctx, q, {});
      if (engine.ball.carrierId === q.id) drawBall(ctx, engine.ball);
    }
    drawLabels(ctx, cam, viewer === ctrl ? [viewer] : [viewer, ctrl], {});
  }
  if (ui.showArt && engine.state === "PRE_SNAP") {
    fieldTransform(ctx, cam);
    drawPlayArt(ctx, engine);
    drawArtLegend(ctx, cam, engine);
  }
  if (ui.showDefArt && engine.state === "PRE_SNAP") {
    fieldTransform(ctx, cam);
    drawDefenseArt(ctx, engine);
    drawDefArtLegend(ctx, cam, engine);
  }
  // Your own throw is always visible, mask or not.
  fieldTransform(ctx, cam);
  drawThrowVisuals(ctx, cam, engine, nowMs);
  drawPopups(ctx, cam, engine);
  if (ui.debug) drawDebugText(ctx, cam, engine, ui.selectedId);
  drawHud(ctx, cam, engine, ui, nowMs);
}
