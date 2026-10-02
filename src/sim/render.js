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
import { OFFENSE_PLAYS, ROUTES, FORMATIONS, COVERAGES, FRONTS, TECH } from "./playbook.js";
import { throwFeedback } from "./throwFeedback.js";
import wordmarkSrc from "../assets/Logo2.png"; // "We-Draft.com", white with a gold outline

const C = {
  bg: "#003f7d", // the apron: deep site blue
  stripe: "#F6A21D", // gold border just outside the sidelines
  grass: "#2f6b35",
  grassAlt: "#2b6431",
  endzone: "#0055A5", // site blue
  line: "rgba(255,255,255,0.88)",
  lineSoft: "rgba(255,255,255,0.55)",
  los: "#3b82f6",
  firstDown: "#facc15",
  offense: "#0055A5",
  defense: "#ffffff", // defense: white bodies…
  defenseHead: "#facc15", // …with a yellow head
  body: "#ffffff", // the head square (offense)
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
  // (Dynasty / College: the home team's end zones, in its primary color.)
  const home = engine.config.homeField;
  ctx.fillStyle = (home && home.color) || C.endzone;
  ctx.fillRect(0, 0, W, FIELD.endZone);
  ctx.fillRect(0, goalLineY, W, FIELD.endZone);

  // Gold border around the whole field, just outside the white boundary.
  ctx.strokeStyle = C.stripe;
  ctx.lineWidth = 0.6;
  ctx.strokeRect(-0.55, -0.55, W + 1.1, FIELD.length + 1.1);

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

  drawFieldLogos(ctx, cam, y0, y1, engine.config.homeField);
  fieldTransform(ctx, cam);
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

  // Yard numbers, painted like a real field: each side's numbers read from
  // their own sideline (tops toward the middle of the field). Screen space
  // so the field transform's flip doesn't mirror them.
  screenTransform(ctx, cam);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = `bold ${Math.max(10, cam.scale * 1.7)}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = 20; y <= 100; y += 10) {
    if (y < y0 || y > y1) continue;
    const n = y <= 60 ? y - 10 : 110 - y;
    for (const [nx, rot] of [[FIELD.numbersFromSideline, Math.PI / 2], [W - FIELD.numbersFromSideline, -Math.PI / 2]]) {
      const s = toScreen(cam, nx, y);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(rot);
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }
  }
}

// ── Field branding: the WD at midfield and on both 25s, "We-Draft.com"
// across both end zones. Images load lazily and the field just draws
// without them until they're in (and always without them headless). ──
const WD_ICON = "/wd-icon-512.png"; // public/
const imgCache = {};
function fieldImage(src) {
  if (typeof Image === "undefined" || !src) return null;
  if (!imgCache[src]) {
    const im = new Image();
    im.src = src;
    imgCache[src] = im;
  }
  const im = imgCache[src];
  return im.complete && im.naturalWidth ? im : null;
}

// Draw an image centered on a field point, `w` yards wide (screen space,
// so it isn't flipped by the field transform).
// `rot` (radians, screen clockwise) turns it to face a sideline.
function drawOnField(ctx, cam, im, x, y, w, alpha, rot = 0) {
  const h = (w * im.naturalHeight) / im.naturalWidth;
  const c = toScreen(cam, x, y);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(c.x, c.y);
  ctx.rotate(rot);
  ctx.drawImage(im, (-w / 2) * cam.scale, (-h / 2) * cam.scale, w * cam.scale, h * cam.scale);
  ctx.restore();
}

// The 25s, conference-logo style: between the numbers and the hashes, one
// near each sideline on opposite 25s, each reading from its own sideline.
const LOGO_25_IN = (FIELD.numbersFromSideline + FIELD.hashFromSideline) / 2;
const LOGOS_25 = [
  { y: 35, x: LOGO_25_IN, rot: Math.PI / 2 }, // own 25, left sideline: its top points to midfield
  { y: 85, x: FIELD.width - LOGO_25_IN, rot: -Math.PI / 2 }, // opponent's 25, right sideline
];

// home: a Dynasty / College home field — { logo, wordmark, color }: the
// team's logo at midfield, its (dark) wordmark in the end zones. The WD
// stays on the 25s. Until an image has loaded, the We-Draft one stands in.
function drawFieldLogos(ctx, cam, y0, y1, home) {
  screenTransform(ctx, cam);
  const wd = fieldImage(WD_ICON);
  const homeLogo = home && fieldImage(home.logo);
  if (homeLogo && y0 < 66 && y1 > 54) drawOnField(ctx, cam, homeLogo, CX, 60, 12, 0.95, Math.PI / 2);
  if (wd) {
    if (!homeLogo && y0 < 66 && y1 > 54) drawOnField(ctx, cam, wd, CX, 60, 11, 0.95, Math.PI / 2); // midfield, reads from the left sideline
    for (const l of LOGOS_25) if (y0 < l.y + 4 && y1 > l.y - 4) drawOnField(ctx, cam, wd, l.x, l.y, 5, 0.9, l.rot);
  }
  const mark = (home && fieldImage(home.wordmark)) || fieldImage(wordmarkSrc);
  if (mark) {
    // As wide as fits sideline to sideline, but never taller than 7 yards
    // (a squarer team wordmark would overflow the end zone).
    const w = Math.min(FIELD.width - 10, (7 * mark.naturalWidth) / mark.naturalHeight);
    if (y0 < FIELD.endZone) drawOnField(ctx, cam, mark, CX, FIELD.endZone / 2, w, 1);
    if (y1 > goalLineY) drawOnField(ctx, cam, mark, CX, goalLineY + FIELD.endZone / 2, w, 1);
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
  // Body: offense site blue, defense white (a dynasty team's own primary
  // color when it has one).
  ctx.fillStyle = (p.info && p.info.team && p.info.team.color) || (p.team === "O" ? C.offense : C.defense);
  ctx.strokeStyle = selected ? "#e11d48" : C.outline;
  ctx.lineWidth = selected ? 0.12 : 0.06;
  ctx.fillRect(-B.depth / 2, -B.width / 2, B.depth, B.width);
  ctx.strokeRect(-B.depth / 2, -B.width / 2, B.depth, B.width);
  // Head: a square inside the body, against its front edge (it shows which
  // way he's facing) — white on offense, yellow on defense.
  const inset = 0.03;
  const hx = B.depth / 2 - B.front - inset;
  ctx.fillStyle = p.team === "O" ? C.body : C.defenseHead;
  ctx.fillRect(hx, -B.front / 2, B.front, B.front);
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(hx, -B.front / 2, B.front, B.front);
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
    ctx.font = "900 12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fde047";
    ctx.fillText(pr.type.toUpperCase(), s.x, s.y - 28);
  }
  drawThrowMeter(ctx, cam, engine, nowMs);
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
  // (Not on autopilot — nobody's at the controls to press anything.)
  if (!engine.autopilot && engine.canPitch() && engine.zone && engine.zone.optionKeyId) {
    const r = engine.byId[engine.zone.optionKeyId];
    const sp = toScreen(cam, r.x, r.y + 1.1);
    ctx.font = "bold 12px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#f472b6";
    ctx.fillText("PITCH KEY — SPACE to pitch", sp.x, sp.y);
  }
  // Zone read cue.
  if (!engine.autopilot && engine.canPull() && engine.state !== "PRE_SNAP" && engine.zone && engine.zone.readId) {
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
  // (The controls live in the ? Help panel, not across the field.)
  if (engine.result) drawResult(ctx, cam, engine);
}

// ── Throw meter: pops up at the bottom of the field while a throw is held,
// and sticks — through the ball's flight and the result — until the next
// snap. Live feedback (sim/throwFeedback.js): type and power, who it's for,
// placement vs. where he'll be, the window, hot ball, across the body,
// pressure. Once the ball has got to him, a little upper-body diagram shows
// where it arrived on him. Site-themed: blue plate, gold edge. ──
const METER_TONE = { good: "#4ade80", ok: "#F6A21D", bad: "#f87171" };
function drawThrowMeter(ctx, cam, engine, nowMs) {
  const live = engine.throwCharging;
  const ti = engine.throwInfo;
  const fb = live ? throwFeedback(engine, engine.chargeSeconds(nowMs), engine.input.mouse) : ti && ti.feedback;
  if (!fb) return;
  const place = !live && ti ? ti.placement : null;
  screenTransform(ctx, cam);
  const w = Math.min(cam.W - 24, place ? 470 : 390);
  const h = 96;
  const x = cam.W / 2 - w / 2;
  const y = cam.H - h - 16;
  const bodyW = place ? 86 : 0;
  ctx.save();
  ctx.fillStyle = "#F6A21D";
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = "#0055A5";
  ctx.fillRect(x, y, w, h);
  ctx.textBaseline = "middle";
  const inner = w - bodyW;
  ctx.textAlign = "left";
  ctx.font = "italic 900 18px 'Arial Black', Arial, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(live ? fb.type : `${fb.type} — THROWN`, x + 12, y + 17);
  ctx.textAlign = "right";
  ctx.font = "900 12px Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(fb.who ? `TO ${fb.who}` : "NO TARGET", x + inner - 12, y + 17);
  // Power bar: bullet → lofted.
  const bx = x + 12;
  const bw = inner - 24;
  const by = y + 32;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(bx, by, bw, 10);
  ctx.fillStyle = "#F6A21D";
  ctx.fillRect(bx, by, bw * fb.u, 10);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (const m of [0.18, 0.45, 0.75]) ctx.fillRect(bx + bw * m - 1, by - 2, 2, 14);
  ctx.font = "800 9px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  [["BULLET", 0.09], ["FIRM", 0.315], ["TOUCH", 0.6], ["LOFTED", 0.875]].forEach(([t, m]) => ctx.fillText(t, bx + bw * m, by + 19));
  // Chips, one row.
  ctx.font = "italic 900 11px 'Arial Black', Arial, sans-serif";
  let cx = x + 12;
  const cy = y + h - 30;
  for (const c of fb.chips) {
    const cw = ctx.measureText(c.text).width + 16;
    if (cx + cw > x + inner - 8) break; // (one row — extras are dropped rather than overflow)
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(cx, cy, cw, 18);
    ctx.fillStyle = METER_TONE[c.tone];
    ctx.fillRect(cx, cy, 3, 18);
    ctx.textAlign = "left";
    ctx.fillText(c.text, cx + 9, cy + 9.5);
    cx += cw + 6;
  }
  if (place) {
    // His jersey: team color and number (dynasty), else site blue and 88.
    const rp = engine.byId[place.who];
    const info = rp && rp.info;
    const jersey = { color: (info && info.team && info.team.color) || "#0055A5", number: info && info.number != null ? info.number : 88 };
    drawPlacementBody(ctx, x + inner, y + 6, bodyW - 8, h - 12, place, jersey);
  }
  ctx.restore();
}

// A receiver's upper body, front-on as the passer sees him (head, shoulders,
// chest, the reach of his hands), with a dot where the ball got to him.
// Field units: lat (yd, + = the passer's left), z (yd off the ground).
function drawPlacementBody(ctx, x, y, w, h, pl, jersey) {
  // 2.6 yd of height and ±1.1 yd of width fit the box.
  const sc = Math.min(h / 2.6, w / 2.2);
  const cx = x + w / 2;
  const gy = y + h; // the ground (z = 0) at the bottom of the box
  const P = (lat, z) => ({ x: cx - lat * sc, y: gy - z * sc });
  const dark = "#0b1220";
  const skin = "#c68b59";
  const poly = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([lat, z], k) => {
      const q = P(lat, z);
      if (k) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  };
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  // Reach: the catch window the hands can get to.
  const r0 = P(0.75, 2.35);
  const r1 = P(-0.75, 0.55);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillRect(r0.x, r0.y, r1.x - r0.x, r1.y - r0.y);
  // Jersey, shoulder pads.
  poly([[0.3, 1.6], [-0.3, 1.6], [-0.26, 0.85], [0.26, 0.85]], jersey.color);
  poly([[0.47, 1.5], [0.4, 1.7], [0.16, 1.73], [-0.16, 1.73], [-0.4, 1.7], [-0.47, 1.5]], jersey.color);
  // Number.
  const n = P(0, 1.2);
  ctx.font = `900 ${Math.round(0.34 * sc)}px 'Arial Black', Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2;
  ctx.strokeText(String(jersey.number), n.x, n.y);
  ctx.fillStyle = "#fff";
  ctx.fillText(String(jersey.number), n.x, n.y);
  ctx.lineWidth = 1;
  // Helmet and facemask.
  const hm = P(0, 1.9);
  ctx.beginPath();
  ctx.ellipse(hm.x, hm.y, 0.15 * sc, 0.17 * sc, 0, 0, Math.PI * 2);
  ctx.fillStyle = jersey.color;
  ctx.fill();
  ctx.stroke();
  const f0 = P(0.1, 1.86);
  ctx.fillStyle = skin;
  ctx.fillRect(f0.x, f0.y, 0.2 * sc, 0.13 * sc);
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath();
  for (const z of [1.84, 1.78]) {
    const a = P(0.11, z);
    const b = P(-0.11, z);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  // The ball.
  const out = pl.d > 1.6;
  const b = P(Math.max(-1, Math.min(1, pl.lat)), Math.max(0.15, Math.min(2.5, pl.z)));
  ctx.fillStyle = out ? "#f87171" : "#8b4a1c";
  ctx.strokeStyle = out ? "#7f1d1d" : "#F6A21D";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, 6, 4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// ── The play result: a slanted site-blue plate with a gold edge and big
// italic type — "GAIN OF 12", "TOUCHDOWN!", "SACKED" — whole yards only,
// with a gold tag under it for what it means (FIRST DOWN, LOSS OF 4, OUT
// OF BOUNDS). Pops in as the play ends. ──
function resultCopy(engine) {
  const r = engine.result;
  const y = Math.round(r.yards || 0);
  const firstDown = engine.lineToGain != null && LOS + (r.yards || 0) >= engine.lineToGain;
  switch (r.type) {
    case "TOUCHDOWN":
      return { head: "TOUCHDOWN!", tag: `${y} YARDS`, big: true };
    case "INTERCEPTION":
      return { head: "INTERCEPTED", tag: "TURNOVER" };
    case "INCOMPLETE":
      return { head: "INCOMPLETE", tag: null };
    case "SACK":
      return { head: "SACKED", tag: y < 0 ? `LOSS OF ${-y}` : "NO GAIN" };
    case "SAFETY":
      return { head: "SAFETY", tag: "2 POINTS" };
    default: {
      const head = y > 0 ? `GAIN OF ${y}` : y < 0 ? `LOSS OF ${-y}` : "NO GAIN";
      const tag = firstDown && y > 0 ? "FIRST DOWN" : r.type === "OUT_OF_BOUNDS" ? "OUT OF BOUNDS" : null;
      return { head, tag };
    }
  }
}

function drawResult(ctx, cam, engine) {
  screenTransform(ctx, cam);
  const { head, tag, big } = resultCopy(engine);
  const since = engine.endAt != null ? engine.t - engine.endAt : 1;
  const k = clamp(since / 0.22, 0, 1);
  const pop = 0.82 + 0.18 * (1 - Math.pow(1 - k, 3)); // ease-out pop
  const size = Math.round(clamp(cam.W / (big ? 13 : 17), 26, big ? 64 : 48));
  ctx.save();
  ctx.translate(cam.W / 2, cam.H * 0.27); // (clear of the front bar)
  ctx.scale(pop, pop);
  ctx.globalAlpha = k;
  ctx.font = `italic 900 ${size}px 'Arial Black', Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(head).width;
  const padX = size * 0.75;
  const h = size * 1.45;
  const w = tw + padX * 2;
  const slant = h * 0.28; // parallelogram lean
  const plate = (x0, y0, ww, hh, fill) => {
    ctx.beginPath();
    ctx.moveTo(x0 + slant, y0);
    ctx.lineTo(x0 + ww + slant, y0);
    ctx.lineTo(x0 + ww - slant, y0 + hh);
    ctx.lineTo(x0 - slant, y0 + hh);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Shadow, gold edge, then the plate.
  plate(-w / 2 + 6, -h / 2 + 6, w, h, "rgba(0,0,0,0.35)");
  plate(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, "#F6A21D");
  plate(-w / 2, -h / 2, w, h, big ? "#F6A21D" : "#0055A5");
  if (big) plate(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, "#0055A5");
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillText(head, 3, 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(head, 0, 1);
  if (tag) {
    const ts = Math.round(size * 0.42);
    ctx.font = `italic 900 ${ts}px 'Arial Black', Arial, sans-serif`;
    const tagW = ctx.measureText(tag).width + ts * 1.6;
    const th = ts * 1.6;
    const ty = h / 2 + 2;
    const s2 = th * 0.28;
    ctx.beginPath();
    ctx.moveTo(-tagW / 2 + s2, ty);
    ctx.lineTo(tagW / 2 + s2, ty);
    ctx.lineTo(tagW / 2 - s2, ty + th);
    ctx.lineTo(-tagW / 2 - s2, ty + th);
    ctx.closePath();
    ctx.fillStyle = "#F6A21D";
    ctx.fill();
    ctx.fillStyle = "#0b2f5c";
    ctx.fillText(tag, 0, ty + th / 2 + 1);
  }
  ctx.restore();
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
  // Learn mode's animated explainer for the section being read — pre-snap
  // only; the snap clears the board for the real rep.
  captionKicker = ui.demoKicker || "";
  if (ui.demoFrontBar) drawFrontBar(ctx, cam, engine); // (Learn: demos and Try it)
  if (ui.demo && engine.state === "PRE_SNAP") drawLessonDemo(ctx, cam, engine, ui.demo, ui.demoT ?? 0);
  else if (ui.demo && ui.demoWatch) demoBanner(ctx, cam, ui.demoWatch); // the live rep: what to watch
  drawHud(ctx, cam, engine, ui, nowMs);
}

// ── Learn mode demos (src/sim/lessons.js → a section's `demo`). Each one
// loops on a short timeline over the pre-snap field, drawn from the same
// blocking call the line will make at the snap (previewZoneCall), so what
// it shows is what the players are about to do. ──
const DEMO = { covered: "#f8fafc", combo: "#fde047", climb: "#93c5fd", read: "#f472b6", track: "#86efac", ghost: "rgba(255,255,255,0.85)" };
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// The first fraction f (0-1) of a polyline, by length — how lines "draw
// themselves" in.
function partial(pts, f) {
  if (f >= 1) return pts;
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  let left = total * Math.max(0.001, f);
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (left >= seg[i - 1]) {
      out.push(pts[i]);
      left -= seg[i - 1];
      continue;
    }
    const k = left / (seg[i - 1] || 1);
    out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k });
    break;
  }
  return out.length > 1 ? out : [pts[0], pts[0]];
}
// The point f of the way along a polyline (a ghost runner).
const along = (pts, f) => {
  const q = partial(pts, f);
  return q[q.length - 1];
};

// A label pill at a field point (screen space so the text isn't flipped).
function demoTag(ctx, cam, x, y, text, color, alpha = 1) {
  if (alpha <= 0) return;
  screenTransform(ctx, cam);
  const s = toScreen(cam, x, y);
  ctx.globalAlpha = alpha;
  ctx.font = "900 13px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = "rgba(4,12,28,0.88)";
  ctx.fillRect(s.x - w / 2, s.y - 10, w, 20);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(s.x - w / 2 + 0.75, s.y - 9.25, w - 1.5, 18.5);
  ctx.fillStyle = color;
  ctx.fillText(text, s.x, s.y);
  ctx.globalAlpha = 1;
  fieldTransform(ctx, cam);
}
// The demo's narration: a broadcast-style lower third across the bottom
// of the field — the section as a gold kicker over a big line saying what
// this beat shows. Sized off the canvas so it reads at any width; a new
// line slides in. Also used over the live play (the demo's `watch`).
let captionKicker = "";
const captionSeen = { text: "", at: 0 };
function demoBanner(ctx, cam, text, kicker = captionKicker) {
  screenTransform(ctx, cam);
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  if (text !== captionSeen.text) Object.assign(captionSeen, { text, at: now });
  const k = Math.min(1, (now - captionSeen.at) / 260); // slide-in
  const size = Math.round(clamp(cam.W / 38, 15, 24));
  const pad = Math.round(size * 0.7);
  ctx.font = `900 ${size}px Arial, sans-serif`;
  // Wrap to the field's width.
  const maxW = cam.W - 2 * pad - 40;
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const kSize = Math.round(size * 0.55);
  const lineH = Math.round(size * 1.25);
  const h = pad * 2 + (kicker ? kSize + 6 : 0) + lines.length * lineH - (lineH - size);
  const w = Math.min(cam.W - 24, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2 + 8);
  const x = 12;
  const y = cam.H - h - 14 + (1 - k) * 18;
  ctx.globalAlpha = k;
  ctx.fillStyle = "rgba(4,12,28,0.88)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#F6A21D";
  ctx.fillRect(x, y, 6, h); // gold accent bar
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let ty = y + pad;
  if (kicker) {
    ctx.font = `900 ${kSize}px Arial, sans-serif`;
    ctx.fillStyle = "#F6A21D";
    ctx.fillText(kicker.toUpperCase().split("").join(String.fromCharCode(8202)), x + pad + 6, ty);
    ty += kSize + 6;
  }
  ctx.font = `900 ${size}px Arial, sans-serif`;
  ctx.fillStyle = "#ffffff";
  lines.forEach((l, i) => ctx.fillText(l, x + pad + 6, ty + i * lineH));
  ctx.globalAlpha = 1;
  fieldTransform(ctx, cam);
}
function ring(ctx, p, r, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
function dot(ctx, p, color, r = 0.45) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ── The front bar: across the top, the front the offense is blocking and
// the run strength it set to. ──
function drawFrontBar(ctx, cam, engine) {
  screenTransform(ctx, cam);
  const name = (FRONTS[engine.config.front] || engine.config.front).toUpperCase();
  const str = engine.strength > 0 ? "STRENGTH ▶" : "◀ STRENGTH";
  const size = Math.round(clamp(cam.W / 40, 14, 22));
  ctx.textBaseline = "middle";
  ctx.font = `italic 900 ${size}px 'Arial Black', Arial, sans-serif`;
  const nameW = ctx.measureText(`VS. ${name}`).width;
  ctx.font = `900 ${Math.round(size * 0.62)}px Arial, sans-serif`;
  const strW = ctx.measureText(str).width;
  const pad = size * 0.8;
  const h = size * 2.3;
  const w = pad * 3 + nameW + strW;
  const x = cam.W / 2 - w / 2;
  const y = 10;
  ctx.fillStyle = "#F6A21D";
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = "#0055A5";
  ctx.fillRect(x, y, w, h);
  ctx.textAlign = "left";
  ctx.font = `italic 900 ${size}px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`VS. ${name}`, x + pad, y + h / 2 + 1);
  ctx.font = `900 ${Math.round(size * 0.62)}px Arial, sans-serif`;
  ctx.fillStyle = "#F6A21D";
  ctx.fillText(str, x + pad * 2 + nameW, y + h / 2 + 1);
  fieldTransform(ctx, cam);
}

// ── Defensive front demo: every front player's run fit, drawn from his
// own assignment (playbook DEFENSES gap / force / alley) — the line's one
// gap each, then the linebackers downhill, then force and alley. "quick"
// draws it all at once (the live run demos). ──
const FIT = { DL: "#f87171", LB: "#93c5fd", force: "#F6A21D", alley: "#c084fc" };
function fitTarget(d) {
  const g = d.assignment.gap || "";
  const side = g.endsWith("L") ? -1 : 1;
  if (/^[A-D]-[LR]$/.test(g)) return { x: CX + GAPS[g], y: LOS + (d.role === "DL" ? 0 : 0.5), label: `${g[0]} GAP`, color: d.role === "DL" ? FIT.DL : FIT.LB };
  if (g.startsWith("force")) return { x: CX + side * (2 * OL_SPLIT + 2.6), y: LOS + 1.2, label: "FORCE", color: FIT.force };
  if (g.startsWith("alley")) return { x: CX + side * (2 * OL_SPLIT + 0.8), y: LOS + 2.4, label: "ALLEY", color: FIT.alley };
  return null;
}
function demoFrontFits(ctx, cam, engine, t, quick) {
  // The front: the line, the linebackers, and any safety with a run fit.
  const box = engine.defense.filter((d) => d.role === "DL" || d.role === "LB" || (d.role === "S" && d.y - LOS < 12));
  const groups = [
    box.filter((d) => d.role === "DL" || (d.role === "LB" && d.y - LOS < 2.5 && /^[A-D]-/.test(d.assignment.gap || ""))),
    box.filter((d) => d.role === "LB" && d.y - LOS >= 2.5 && /^[A-D]-/.test(d.assignment.gap || "")),
    box.filter((d) => /^(force|alley)/.test(d.assignment.gap || "")),
  ];
  const at = [1, 3.4, 5.6]; // when each group draws in
  if (!quick)
    demoBanner(
      ctx, cam,
      t < 1 ? "Every man has a gap: the front is built so the run has nowhere to go"
        : t < 3.4 ? "Defensive line: attack your gap, one each"
        : t < 5.6 ? "Linebackers: downhill, inside-out, so the ball bubbles outside"
        : "Force sets the edge and turns it back inside; the alley player fills inside-out"
    );
  else demoBanner(ctx, cam, "Every man has a gap: line attacks, backers fill downhill, force sets the edge");
  groups.forEach((g, gi) =>
    g.forEach((d, i) => {
      const f = quick ? 1 : ease((t - at[gi] - i * 0.3) / 0.6);
      if (f <= 0) return;
      const tg = fitTarget(d);
      if (!tg) return;
      artLine(ctx, partial([{ x: d.x, y: d.y }, toward({ x: d.x, y: d.y }, tg, 0.2)], f), tg.color, { arrow: f >= 1 });
      const ly = d.role === "DL" || d.y - LOS < 2.5 ? d.y + 1.7 : d.y + 1.3;
      demoTag(ctx, cam, d.x, ly, tg.label, tg.color, f);
    })
  );
}

// A demo is "name" or "name:variant" (zoneRead:crash, zoneTrack:bend). It
// plays once before the snap — SimPage snaps when demoLength() is up — so
// `t` is seconds since this rep's pre-snap began (ui.demoT).
export function demoLength(demo) {
  const name = String(demo).split(":")[0];
  if (demo === "frontFits:quick") return 2.6;
  return { zoneBlocking: 9, zoneRead: 4, zoneKick: 4, zoneTrack: 3.4, frontFits: 8 }[name] || 3;
}

function drawLessonDemo(ctx, cam, engine, demo, t) {
  const call = engine.previewZoneCall();
  if (!call) return;
  const [name, variant] = String(demo).split(":");
  fieldTransform(ctx, cam);
  if (name === "zoneBlocking") demoZoneBlocking(ctx, cam, engine, call, t);
  else if (name === "zoneRead") demoZoneRead(ctx, cam, engine, call, t, variant !== "sit");
  else if (name === "zoneKick") demoZoneKick(ctx, cam, engine, call, t);
  else if (name === "zoneTrack") demoZoneTrack(ctx, cam, engine, call, t, variant || "bang");
  else if (name === "frontFits") demoFrontFits(ctx, cam, engine, t, variant === "quick");
}

// Everyone steps play side; each lineman's job draws in, play side first —
// covered (block him), combo (two on one, one comes off to the backer),
// uncovered (climb) — then the receivers' men and the end nobody blocks.
function demoZoneBlocking(ctx, cam, engine, call, t) {
  const by = engine.byId;
  const ps = call.ps;
  const ol = engine.offense.filter((o) => o.role === "OL").sort((a, b) => ps * (b.x - a.x));
  const end = by[call.endId || call.readId || call.kickId];
  // Outside zone: wider steps, the covered man reaches his man's play-side
  // shoulder, and the helper overtakes the block so the covered man climbs.
  const wide = call.scheme === "outside";
  const arrow = ps > 0 ? "→" : "←";
  demoBanner(
    ctx, cam,
    wide
      ? t < 0.9 ? `Wide zone steps: everybody gets play side ${arrow}` : t < 5.2 ? "Covered: reach your man's play-side shoulder. Uncovered: help, then overtake." : t < 7 ? "Overtake: the helper takes the block over and the covered man climbs" : "The backside tackle cuts off the end; the back outruns the backside linebacker"
      : t < 0.9 ? `Everybody steps play side ${arrow}` : t < 5.2 ? "Covered: block the man in your area. Uncovered: help the play-side teammate." : t < 7 ? "Then the helper climbs to a linebacker" : "The backside end is left unblocked"
  );
  // Play-side arrow behind the line.
  const mid = { x: CX, y: LOS - 3.2 };
  artLine(ctx, [{ x: mid.x - 2.5 * ps, y: mid.y }, { x: mid.x + 2.5 * ps, y: mid.y }], "#F6A21D");
  demoTag(ctx, cam, mid.x, mid.y - 1.1, "PLAY SIDE", "#F6A21D");
  ol.forEach((o, i) => {
    const j = call.jobs[o.id];
    const f = ease((t - 0.9 - i * 0.75) / 0.6);
    if (f <= 0) return;
    const step = { x: o.x + (wide ? 1.2 : 0.6) * ps, y: o.y + 0.15 };
    if (j.kind === "climb") {
      const lb = j.lb ? by[j.lb] : null;
      artLine(ctx, partial([{ x: o.x, y: o.y }, step, lb ? toward(step, lb) : { x: step.x + ps, y: LOS + 4 }], f), DEMO.climb, { bar: f >= 1 && !!lb, arrow: f >= 1 && !lb });
      demoTag(ctx, cam, o.x, o.y - 1.6, "UNCOVERED · CLIMB", DEMO.climb, f);
      return;
    }
    const dl = by[j.kind === "combo" ? j.combo.dl : j.dl];
    if (!dl) return;
    // In a combo the play-side man is the covered one; the backside man is
    // the uncovered lineman helping him before he climbs.
    const helping = j.kind === "combo" && j.side === "back";
    const color = helping ? DEMO.combo : DEMO.covered;
    // (Reach: the block lands on his play-side shoulder.)
    const spot = wide && !helping ? { x: dl.x + 0.45 * ps, y: dl.y } : dl;
    artLine(ctx, partial([{ x: o.x, y: o.y }, step, toward(step, spot)], f), color, { bar: f >= 1, arrow: false });
    const label = helping ? (wide ? "UNCOVERED · OVERTAKE" : "UNCOVERED · HELP") : wide ? "COVERED · REACH" : "COVERED";
    demoTag(ctx, cam, o.x, o.y - (i % 2 ? 2.4 : 1.6), label, color, f);
  });
  // Combos: one of the pair peels off to the backer.
  const fc = ease((t - 5.2) / 0.8);
  if (fc > 0)
    for (const c of call.combos) {
      if (!c.lb) continue;
      const dl = by[c.dl];
      const lb = by[c.lb];
      // Outside zone: the covered (play-side) man climbs off the overtake.
      const from = wide ? by[c.play] : { x: dl.x, y: dl.y + 0.3 };
      artLine(ctx, partial([{ x: from.x, y: from.y + (wide ? 0.4 : 0) }, toward(from, lb)], fc), DEMO.combo, { dash: [0.4, 0.3], bar: fc >= 1, arrow: false });
      demoTag(ctx, cam, (dl.x + lb.x) / 2 + 1.6 * ps, (dl.y + lb.y) / 2 + 0.4, wide ? "COVERED MAN CLIMBS" : "CLIMB TO THE LB", DEMO.combo, fc);
    }
  // Receivers: the man lined up on them.
  if (fc > 0)
    for (const [wid, did] of Object.entries(call.stalk)) {
      const w = by[wid];
      artLine(ctx, partial([{ x: w.x, y: w.y }, toward(w, by[did], 0.7)], fc), DEMO.covered, { bar: fc >= 1, arrow: false });
    }
  // The end nobody blocks.
  if (end && t > 7) {
    ring(ctx, end, 1.1 * (0.85 + 0.25 * Math.sin(t * 6)), DEMO.read);
    demoTag(ctx, cam, end.x, end.y + 1.9, "UNBLOCKED", DEMO.read);
  }
}

// The read: the QB's eyes on the end. He crashes → pull it (the QB goes
// where he left); he sits → give it.
function demoZoneRead(ctx, cam, engine, call, t, crash) {
  const by = engine.byId;
  const ps = call.ps;
  const end = by[call.readId || call.endId];
  if (!end) return;
  const qb = by.QB;
  const rb = by.RB;
  const mesh = engine.meshPoint();
  const k = t;
  demoBanner(ctx, cam, crash ? "He crashes down the line → PULL it" : "He sits and waits for the QB → GIVE it");
  // The QB's eyes stay on him.
  artLine(ctx, [{ x: qb.x, y: qb.y }, toward(qb, end, 1.2)], DEMO.read, { dash: [0.3, 0.3], arrow: false });
  ring(ctx, end, 1.1, DEMO.read, 0.9);
  demoTag(ctx, cam, end.x, end.y + 1.9, "THE READ", DEMO.read);
  const fe = ease((k - 0.4) / 1.4);
  if (crash) {
    // He chases the back's track…
    const path = [{ x: end.x, y: end.y }, { x: end.x + 1.2 * ps, y: LOS - 0.6 }, { x: mesh.x + 1.6 * ps, y: mesh.y + 1.2 }];
    artLine(ctx, partial(path, fe), "#f87171", { arrow: fe >= 1 });
    if (fe > 0) dot(ctx, along(path, fe), "rgba(248,113,113,0.85)");
    // …so the QB keeps it and runs where he was.
    const fq = ease((k - 2) / 1.3);
    const qpath = [{ x: qb.x, y: qb.y }, { x: qb.x - 2.2 * ps, y: qb.y + 1.2 }, { x: end.x - 0.6 * ps, y: LOS + 3 }];
    if (fq > 0) {
      artLine(ctx, partial(qpath, fq), DEMO.track, { arrow: fq >= 1 });
      dot(ctx, along(qpath, fq), DEMO.ghost, 0.4);
      demoTag(ctx, cam, end.x - 0.6 * ps, LOS + 4.4, "QB KEEPS", DEMO.track, fq);
    }
  } else {
    // He sits on the QB…
    const path = [{ x: end.x, y: end.y }, { x: end.x + 0.3 * ps, y: LOS - 0.4 }];
    artLine(ctx, partial(path, fe), "#f87171", { arrow: false });
    if (fe > 0) dot(ctx, along(path, fe), "rgba(248,113,113,0.85)");
    // …so it's a give.
    const fr = ease((k - 1.6) / 1.6);
    const rpath = [{ x: rb.x, y: rb.y }, mesh, { x: CX + GAPS["A-R"] * ps, y: LOS - 0.3 }, { x: CX + GAPS["A-R"] * ps, y: LOS + 4 }];
    if (fr > 0) {
      artLine(ctx, partial(rpath, fr), DEMO.track, { arrow: fr >= 1 });
      dot(ctx, along(rpath, fr), DEMO.ghost, 0.4);
      demoTag(ctx, cam, CX + 1.2 * ps, LOS + 5.2, "HAND IT OFF", DEMO.track, fr);
    }
  }
}

// Split zone: no read — the H comes across the formation, behind the
// line, and kicks the end out.
function demoZoneKick(ctx, cam, engine, call, t) {
  const by = engine.byId;
  const k = by[call.kickId || call.endId];
  const h = by.H;
  if (!k || !h) return;
  demoBanner(ctx, cam, "Or don't read him: the H comes across and kicks him out");
  ring(ctx, k, 1.1, DEMO.read, 0.9);
  demoTag(ctx, cam, k.x, k.y + 1.9, "BACKSIDE END", DEMO.read);
  const side = Math.sign(k.x - CX) || 1;
  const via = Math.sign(h.x - CX) === side ? [] : [{ x: CX + side * (2 * OL_SPLIT + 0.2), y: LOS - 1.8 }];
  const path = [{ x: h.x, y: h.y }, ...via, toward({ x: k.x - side * 0.4, y: LOS - 1 }, k, 0.5)];
  const f = ease((t - 0.4) / 2);
  artLine(ctx, partial(path, f), DEMO.covered, { bar: f >= 1, arrow: false });
  if (f > 0 && f < 1) dot(ctx, along(path, f), DEMO.ghost, 0.4);
  demoTag(ctx, cam, h.x, h.y - 1.6, "H · KICK OUT", DEMO.covered, Math.min(1, f * 3));
}

// The back: press the play-side A gap, then take what's there — bang it,
// bend it back, or bounce it. `branch` is the one this rep shows (the
// other two stay faint); the ghost runs it.
function demoZoneTrack(ctx, cam, engine, call, t, branch) {
  const by = engine.byId;
  const ps = call.ps;
  const rb = by.RB;
  const mesh = engine.meshPoint();
  // Inside zone aims at the play-side A gap; outside zone at the outside
  // leg of the tight end (a ghost one with no TE) — and doesn't bounce.
  const wide = call.scheme === "outside";
  const A = { x: CX + (wide ? TECH[7] : GAPS["A-R"]) * ps, y: LOS - 0.5 };
  const press = [{ x: rb.x, y: rb.y }, mesh, A];
  const branches = wide
    ? [
        { name: "BANG", why: "the aiming point is open, hit it", pts: [A, { x: A.x + 0.1 * ps, y: LOS + 2.5 }, { x: A.x + 0.2 * ps, y: LOS + 7 }] },
        { name: "BEND", why: "the defense overflows, cut it back inside", pts: [A, { x: CX + 2.2 * ps, y: LOS + 1 }, { x: CX + 1.2 * ps, y: LOS + 6.5 }] },
      ]
    : [
        { name: "BANG", why: "the A gap opens, hit it", pts: [A, { x: A.x + 0.2 * ps, y: LOS + 2.5 }, { x: A.x + 0.3 * ps, y: LOS + 7 }] },
        { name: "BEND", why: "the defense overflows, cut it back", pts: [A, { x: CX - 0.9 * ps, y: LOS + 1 }, { x: CX - 1.4 * ps, y: LOS + 6.5 }] },
        { name: "BOUNCE", why: "everything inside is closed, take it outside", pts: [A, { x: A.x + 1.6 * ps, y: LOS - 0.3 }, { x: CX + 6.5 * ps, y: LOS + 5.5 }] },
      ];
  const which = Math.max(0, branches.findIndex((br) => br.name === branch.toUpperCase()));
  const k = t;
  const b = branches[which];
  demoBanner(ctx, cam, k < 1.2 ? (wide ? "Press the outside leg of the tight end" : "Press the play-side A gap") : `${b.name}: ${b.why}`);
  ring(ctx, A, 0.8 + 0.12 * Math.sin(t * 6), DEMO.track);
  demoTag(ctx, cam, A.x + (wide ? 3.2 : 2.6) * ps, A.y - 1.2, wide ? "AIM: OUTSIDE LEG OF THE TE" : "AIM: PLAY-SIDE A GAP", DEMO.track);
  artLine(ctx, press, DEMO.track, { arrow: false });
  // Every option faint; the one being shown bright.
  branches.forEach((br, i) => {
    ctx.globalAlpha = i === which ? 1 : 0.28;
    artLine(ctx, br.pts, i === which ? "#F6A21D" : DEMO.track, { dash: i === which ? null : [0.35, 0.3] });
    ctx.globalAlpha = 1;
    const end = br.pts[br.pts.length - 1];
    demoTag(ctx, cam, end.x, end.y + 1.2, br.name, i === which ? "#F6A21D" : DEMO.track, i === which ? 1 : 0.45);
  });
  // The ghost back: press for 1.2s, then the option.
  const g = k < 1.2 ? along(press, ease(k / 1.2)) : along(b.pts, ease((k - 1.2) / 1.4));
  dot(ctx, g, DEMO.ghost, 0.5);
}
