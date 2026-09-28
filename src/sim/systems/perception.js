// src/sim/systems/perception.js
// ── What each player can actually perceive. Nothing downstream (belief,
// decisions, pursuit) ever reads another player's true state — only the
// perceiving player's `memory` of him, which this system maintains:
//
//   • Vision is a cone from the broad front edge of the body: full strength
//     in the central focus, fading through the periphery, zero behind.
//   • Strength fades with distance.
//   • Bodies block sight lines (an OL between an LB and the RB hides the RB).
//   • Seen players register quickly but their *changes of velocity*
//     register with a lag — that lag is why a hard cut creates separation.
//   • Unseen players are dead-reckoned from the last estimate while
//     confidence decays.
//   • The ball has to be seen and watched before it is "acquired", and the
//     landing estimate starts off wrong and sharpens as it's tracked. ──

import { TUNING } from "../config.js";
import { angDiff, approach, clamp } from "../math.js";
import { predictPath } from "./ball.js";

export function eyePoint(p) {
  const d = TUNING.body.depth / 2;
  return { x: p.x + Math.cos(p.facing) * d, y: p.y + Math.sin(p.facing) * d };
}

// Heights (yd) for line-of-sight. A crouched lineman or pass protector
// doesn't hide a standing QB's head; a standing player does, and a lineman
// does hide a running back's body behind him.
// The QB stands tall and reads over his line; a running back runs low.
const eyeHeight = (p) => (p.role === "QB" ? 1.95 : 1.8);
export function targetHeight(q) {
  return q.role === "QB" ? 1.95 : q.role === "RB" ? 1.4 : 1.6;
}
export function occluderHeight(q) {
  const low =
    q.role === "OL" || q.role === "DL" || q.engagedWith || q.blockers.length || q.assignment.kind === "rbPro";
  return low ? 1.6 : 1.95;
}

// 0..1 perception strength of point (tx, ty, tz) for `observer`.
export function visibility(observer, tx, ty, tz, players, targetId) {
  const V = TUNING.vision;
  const e = eyePoint(observer);
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d > V.range * observer.traits.vision) return 0;
  // Vision points where the head looks — the chest unless he's turned his
  // head (a receiver finding the ball over his shoulder).
  const ang = Math.abs(angDiff(Math.atan2(dy, dx), observer.gaze ?? observer.facing));
  const half = V.fov / 2;
  const focusHalf = V.focus / 2;
  if (ang > half) return d < V.contactSense && tz < 2.5 ? 0.4 : 0; // felt, not seen
  const angular = ang <= focusHalf ? 1 : 1 - (1 - V.peripheralMin) * ((ang - focusHalf) / (half - focusHalf));
  const far =
    d <= V.clearRange ? 1 : 1 - (1 - V.farFactor) * clamp((d - V.clearRange) / (V.range - V.clearRange), 0, 1);

  let occ = 1;
  if (tz < V.occluderHeight && d > 0.5) {
    const targetR = targetId ? 0.35 : 0.15; // torso vs. football
    const at = targetR / d; // target's angular half-size
    for (const q of players) {
      if (q === observer || q.id === targetId) continue;
      const qx = q.x - e.x;
      const qy = q.y - e.y;
      const t = (qx * dx + qy * dy) / (d * d);
      if (t <= 0 || t >= 1) continue;
      const along = t * d;
      if (along < 0.45 || d - along < 0.55) continue; // touching the observer / the target
      const perp = Math.abs(qx * dy - qy * dx) / d;
      if (perp > V.occluderRadius + targetR) continue;
      // Does the sight line pass over him?
      const eh = eyeHeight(observer);
      if (eh + (tz - eh) * t > occluderHeight(q)) continue;
      // Angular overlap of his body with the target — a near body hides a
      // lot, one beside the target only part of it.
      const ao = V.occluderRadius / along;
      const sep = perp / along;
      const overlap = Math.max(0, Math.min(at, sep + ao) - Math.max(-at, sep - ao)) / (2 * at);
      occ *= 1 - (1 - V.occludedFactor) * Math.min(1, overlap);
      if (occ < 0.02) break;
    }
  }
  return angular * far * occ;
}

function newMemory(q, t) {
  return {
    x: q.x, y: q.y, vx: 0, vy: 0, facing: q.facing, facingAt: t,
    conf: 1, vis: 1, lastSeen: t,
    hasBall: q.hasBall, engaged: false,
  };
}

export function updatePerception(p, world, dt) {
  const R = TUNING.react;
  const tr = p.traits;
  for (const q of world.players) {
    if (q.team === p.team) continue;
    let m = p.perception.memory[q.id];
    if (!m) m = p.perception.memory[q.id] = newMemory(q, world.t);
    const vis = visibility(p, q.x, q.y, targetHeight(q), world.players, q.id);
    m.vis = vis;
    if (vis > 0.15) {
      const w = 1 - Math.exp(-dt * R.positionRate * vis);
      m.x += (q.x - m.x) * w;
      m.y += (q.y - m.y) * w;
      // A sharp route runner's break registers late; a man-cover defender
      // with good technique reads his man's break sooner (dynasty).
      const onMan = p.assignment.cover && p.assignment.cover.type === "man" && p.assignment.cover.target === q.id;
      const tau = (R.velocityLag * Math.pow(q.routeBoost || 1, 1.5)) / (tr.recognition * Math.max(vis, 0.3) * (onMan ? tr.man ?? 1 : 1));
      m.vx = approach(m.vx, q.vx, dt, tau);
      m.vy = approach(m.vy, q.vy, dt, tau);
      if (vis > 0.35) {
        m.facing = q.facing;
        m.facingAt = world.t; // when he last got a real look at which way he's facing
      }
      m.conf = Math.min(1, m.conf + dt * 4 * vis);
      m.lastSeen = world.t;
      // A play-action fake hides the ball: the back looks like he has it.
      m.hasBall = q.hasBall || (q.fakeUntil != null && world.t < q.fakeUntil);
      m.engaged = !!q.engagedWith || q.blockers.length > 0;
    } else {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.conf *= Math.exp(-dt / R.memoryDecay);
    }
  }
  updateBallPerception(p, world, dt);
}

function updateBallPerception(p, world, dt) {
  const b = world.ball;
  const bk = p.perception.ball;
  if (b.state !== "air") {
    bk.seeing = false;
    return;
  }
  const vis = visibility(p, b.x, b.y, b.z, world.players, null);
  bk.seeing = vis > 0.2;
  if (!bk.seeing) {
    bk.vis = vis;
    return; // keep whatever (possibly stale) path we had
  }
  bk.vis = vis;
  bk.watch += dt * vis;
  // A fast ball is harder to pick up: the watch time needed scales with its
  // speed (a touch throw hangs; a bullet is on you). Seeing the release helps.
  const hs = Math.hypot(b.vx, b.vy);
  const speedFactor = 1 + clamp((hs - 22) / 8, 0, 1.2);
  const track = p.traits.tracking ?? 1; // ball tracking (dynasty)
  const need = (TUNING.react.ballRecognition * speedFactor * (bk.throwCue > 0.3 ? 0.55 : 1)) / (p.traits.recognition * track);
  if (!bk.acquired && bk.watch >= need) {
    bk.acquired = true;
    bk.acquiredAt = world.t;
    world.log(p, "Acquired the ball", `watched ${bk.watch.toFixed(2)}s`);
  }
  // Prediction: exact ballistics from what's seen, plus a landing error that
  // shrinks the longer the ball is tracked.
  const k = Math.exp(-(bk.watch * track) / TUNING.ball.trackingTau);
  const raw = predictPath(b, world.t);
  const T = raw.length ? raw[raw.length - 1].at - world.t : 1;
  bk.path = raw.map((s) => {
    const f = T > 0 ? (s.at - world.t) / T : 0;
    return { x: s.x + bk.noise.x * k * f, y: s.y + bk.noise.y * k * f, z: s.z, at: s.at };
  });
  bk.errorYds = Math.hypot(bk.noise.x, bk.noise.y) * k;
}
