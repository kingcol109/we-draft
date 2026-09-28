// src/sim/systems/kinematics.js
// ── Shared movement math: how turning and facing limit a player, and the
// time-to-reach estimator. Time-to-reach is the single idea behind every
// pursuit angle, every "can I get to that ball", and every contested catch
// — so it models the same things the movement integrator does: current
// momentum, the turn required, the speed that can be carried through it,
// which way the chest faces, and acceleration. Distance alone never decides
// anything. ──

import { TUNING, DEG } from "../config.js";
import { physOf } from "../player.js";
import { angDiff, lerp } from "../math.js";

// Speed fraction that can be carried through a θ-radian change of direction.
export function cornerFactor(theta) {
  const c = (1 + Math.cos(theta)) / 2;
  return Math.pow(Math.max(0, c), TUNING.move.cornerExp);
}

// Top-speed fraction when travelling phi radians off the chest's facing
// (0 = running forward, 90° = shuffling, 180° = backpedaling).
export function facingSpeedFactor(phi) {
  const m = TUNING.move;
  const a = Math.abs(phi);
  if (a <= 30 * DEG) return 1;
  if (a <= 90 * DEG) return lerp(1, m.lateralFactor, (a - 30 * DEG) / (60 * DEG));
  return lerp(m.lateralFactor, m.backpedalFactor, (a - 90 * DEG) / (90 * DEG));
}

export function facingAccelFactor(phi) {
  const m = TUNING.move;
  const a = Math.abs(phi);
  if (a <= 30 * DEG) return 1;
  if (a <= 90 * DEG) return lerp(1, m.lateralAccelFactor, (a - 30 * DEG) / (60 * DEG));
  return lerp(m.lateralAccelFactor, m.backAccelFactor, (a - 90 * DEG) / (90 * DEG));
}

// Straight-line time to cover d starting at s0, accelerating at a to vmax.
function runTime(d, s0, vmax, a) {
  if (d <= 0) return 0;
  if (s0 >= vmax) return d / vmax;
  const ta = (vmax - s0) / a;
  const da = ((s0 + vmax) / 2) * ta;
  if (d <= da) return (-s0 + Math.sqrt(s0 * s0 + 2 * a * d)) / a;
  return ta + (d - da) / vmax;
}

// ── Estimated seconds for p to reach (tx, ty). `reaction` is time before
// the player even starts responding (unrecognized ball, undecided intent);
// during it he keeps drifting along his current velocity. ──
export function timeToReach(p, tx, ty, reaction = 0) {
  const ph = physOf(p);
  let t = Math.max(0, reaction);
  let x = p.x + p.vx * t;
  let y = p.y + p.vy * t;
  const sp = Math.hypot(p.vx, p.vy);
  let d = Math.hypot(tx - x, ty - y);
  if (d < 0.3) return t;
  let dirTo = Math.atan2(ty - y, tx - x);

  // 1) Momentum: plant and shed whatever speed can't be carried through the turn.
  let s0 = sp;
  let tBrake = 0;
  if (sp > 0.6) {
    const heading = Math.atan2(p.vy, p.vx);
    const theta = Math.abs(angDiff(dirTo, heading));
    const cap = Math.max(TUNING.move.minCornerSpeed, ph.top * cornerFactor(theta));
    if (sp > cap) {
      tBrake = (sp - cap) / ph.brake;
      const drift = ((sp + cap) / 2) * tBrake; // carried past while planting
      x += Math.cos(heading) * drift;
      y += Math.sin(heading) * drift;
      s0 = cap;
      d = Math.hypot(tx - x, ty - y);
      dirTo = Math.atan2(ty - y, tx - x);
    }
    // Only part of the carried speed points at the target.
    s0 *= 0.5 + 0.5 * Math.cos(angDiff(dirTo, heading));
  }

  // 2) Orientation. Option A: rotate the body to face the target, then run.
  const phi = Math.abs(angDiff(dirTo, p.facing));
  const turnRate = (ph.turnStill + ph.turnFull) / 2;
  const tTurn = Math.max(0, phi - 30 * DEG) / turnRate;
  const turnAndRun =
    Math.max(tBrake, tTurn) + runTime(d, tTurn > tBrake ? s0 * 0.6 : s0, ph.top, ph.accel * TUNING.move.accelFalloff);
  // Option B: don't turn — backpedal / shuffle there (only sensible short).
  const noTurn =
    tBrake +
    runTime(d, s0, ph.top * facingSpeedFactor(phi), ph.accel * TUNING.move.accelFalloff * facingAccelFactor(phi));
  return t + Math.min(turnAndRun, noTurn);
}

// ── Pursuit: the earliest point on a mover's projected path that p can get
// to no later than the mover does. `target` is what p *believes* about the
// mover (perceived position + velocity), never the true state. ──
export function interceptMover(p, target, reaction = 0, maxT = 4, step = 0.05) {
  for (let t = 0; t <= maxT; t += step) {
    const x = target.x + target.vx * t;
    const y = target.y + target.vy * t;
    const tMe = timeToReach(p, x, y, reaction);
    if (tMe <= t + 0.05) return { x, y, t, tMe };
  }
  return { x: target.x + target.vx * maxT * 0.5, y: target.y + target.vy * maxT * 0.5, t: maxT, tMe: Infinity };
}

// ── Best place for p to meet a ball, given p's own predicted trajectory.
// Walks the path (absolute times) and returns the earliest catchable-height
// sample p can get to before the ball does, else the closest miss.
// margin > 0 → p beats the ball there by that many seconds. ──
export function bestBallIntercept(p, path, now, reaction = 0) {
  if (!path || !path.length) return null;
  const C = TUNING.catch;
  const reachT = C.reachTracking / physOf(p).top; // don't need to be *on* the spot
  const scan = (zLo, zHi) => {
    let best = null;
    for (const s of path) {
      const tBall = s.at - now;
      if (tBall < 0 || s.z > zHi || s.z < zLo) continue;
      const tMe = Math.max(0, timeToReach(p, s.x, s.y, reaction) - reachT);
      const margin = tBall - tMe;
      const cand = { x: s.x, y: s.y, z: s.z, tBall, tMe, margin };
      if (margin >= 0) return cand;
      if (!best || margin > best.margin) best = cand;
    }
    return best;
  };
  // Prefer where the ball comes down to the hands; fall back to reaching for it.
  const comfy = scan(0.5, 2.2);
  if (comfy && comfy.margin >= 0) return comfy;
  const any = scan(C.minHeight, C.maxHeight);
  return any && (!comfy || any.margin > comfy.margin) ? any : comfy;
}
