// src/sim/systems/movement.js
// ── Velocity-based player physics. AI and human input only ever set
// p.desired = { dir, speed, face }; this integrator decides what the body
// can actually do about it this step:
//
//   • the body rotates at a limited rate (slower at speed)
//   • speed through a change of direction is capped by the turn's severity,
//     so a hard cut forces a plant and re-acceleration
//   • braking is strong; propulsion is strongest straight ahead of the
//     chest and weak sideways/backward (shuffle, backpedal)
//   • lateral (turning) force is limited, so fast players carve wide
//
// Nobody teleports, and a player already moving the right way is ahead. ──

import { TUNING } from "../config.js";
import { FIELD } from "../field.js";
import { physOf } from "../player.js";
import { angDiff, clamp, lerp, turnToward } from "../math.js";
import { cornerFactor, facingSpeedFactor, facingAccelFactor } from "./kinematics.js";

const BURST_ACCEL = 1.2; // matches ai/human.js

export function integrate(p, dt) {
  const ph = physOf(p);
  const m = TUNING.move;
  const stunned = p.stun > 0;
  if (stunned) p.stun = Math.max(0, p.stun - dt);
  const speed = Math.hypot(p.vx, p.vy);
  const des = p.desired;

  // 1. Rotate the body toward the desired facing (default: where you're going).
  const turnRate = lerp(ph.turnStill, ph.turnFull, clamp(speed / ph.top, 0, 1)) * (stunned ? 0.5 : 1);
  let faceTarget = des.face;
  if (faceTarget == null) faceTarget = des.speed > 0.4 && des.dir != null ? des.dir : p.facing;
  p.facing = turnToward(p.facing, faceTarget, turnRate * dt);

  // 2. The velocity the player is trying to reach, after physical limits.
  let vdx = 0;
  let vdy = 0;
  if (des.dir != null && des.speed > 0) {
    let target = Math.min(des.speed, p.speedCap, p.recoverCap ?? Infinity);
    if (speed > 1.0) {
      const theta = Math.abs(angDiff(des.dir, Math.atan2(p.vy, p.vx)));
      target = Math.min(target, Math.max(m.minCornerSpeed, ph.top * cornerFactor(theta)));
    }
    target = Math.min(target, ph.top * facingSpeedFactor(angDiff(des.dir, p.facing)));
    if (stunned) target *= m.stunSpeedFactor;
    vdx = Math.cos(des.dir) * target;
    vdy = Math.sin(des.dir) * target;
  }

  let dvx = vdx - p.vx;
  let dvy = vdy - p.vy;

  // 3. Braking — shedding speed along the current heading.
  let bx = 0;
  let by = 0;
  const hx = speed > 0.3 ? p.vx / speed : Math.cos(p.facing);
  const hy = speed > 0.3 ? p.vy / speed : Math.sin(p.facing);
  if (speed > 0.3) {
    const along = dvx * hx + dvy * hy;
    if (along < 0) {
      const b = Math.max(along, -ph.brake * dt, -speed);
      bx = hx * b;
      by = hy * b;
      dvx -= bx;
      dvy -= by;
    }
  }

  // 4. Propulsion — the rest has to come from the legs.
  const pm = Math.hypot(dvx, dvy);
  if (pm > 1e-6) {
    const eff = facingAccelFactor(angDiff(Math.atan2(dvy, dvx), p.facing)) * (stunned ? 0.5 : 1);
    // A ball carrier bursting (W) drives a little harder out of his stance.
    const falloff = Math.max(0.15, 1 - m.accelFalloff * Math.pow(speed / ph.top, 2)) * (p.bursting ? BURST_ACCEL : 1);
    if (speed > 0.3) {
      let along = dvx * hx + dvy * hy;
      let px = dvx - along * hx;
      let py = dvy - along * hy;
      const aMax = ph.accel * eff * falloff * dt;
      along = clamp(along, -aMax, aMax);
      const perp = Math.hypot(px, py);
      const perpMax = ph.lateral * eff * dt;
      if (perp > perpMax) {
        px *= perpMax / perp;
        py *= perpMax / perp;
      }
      dvx = along * hx + px;
      dvy = along * hy + py;
    } else {
      const aMax = ph.accel * eff * dt;
      if (pm > aMax) {
        dvx *= aMax / pm;
        dvy *= aMax / pm;
      }
    }
  }

  p.vx += bx + dvx;
  p.vy += by + dvy;

  // 5. Hard caps: blocked/engaged, and the facing-relative top speed.
  const ns = Math.hypot(p.vx, p.vy);
  if (ns > 0.01) {
    const cap = Math.min(p.speedCap, p.recoverCap ?? Infinity, ph.top * facingSpeedFactor(angDiff(Math.atan2(p.vy, p.vx), p.facing)));
    if (ns > cap) {
      const s = Math.max(cap, ns - ph.brake * dt);
      p.vx *= s / ns;
      p.vy *= s / ns;
    }
  }

  p.x = clamp(p.x + p.vx * dt, -4, FIELD.width + 4);
  p.y = clamp(p.y + p.vy * dt, -2, FIELD.length + 2);
}

// Turn an AI option ({ moveTo | dir, speed, face, arrive }) into p.desired.
export function steer(p, opt) {
  const ph = physOf(p);
  let dir = opt.dir ?? null;
  let speed = opt.speed ?? ph.top;
  if (opt.moveTo) {
    // Nobody's spot is past the end line (deep drops near the goal line).
    const ty = Math.min(opt.moveTo.y, FIELD.length - 0.6);
    const dx = opt.moveTo.x - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    dir = Math.atan2(dy, dx);
    if (opt.arrive !== false) {
      // Decelerate so as to stop on the spot rather than overshoot it.
      speed = Math.min(speed, Math.sqrt(2 * ph.brake * 0.8 * Math.max(0, d - 0.1)));
      if (d < 0.15) speed = 0;
    }
  }
  let face = null;
  if (typeof opt.face === "number") face = opt.face;
  else if (opt.face && typeof opt.face === "object") face = Math.atan2(opt.face.y - p.y, opt.face.x - p.x);
  p.desired = { dir, speed, face };
}
