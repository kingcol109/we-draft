// src/sim/systems/ball.js
// ── The football as a physical object. Once thrown it is just a projectile:
// position + velocity + gravity. Nobody "receives" it — players have to
// see it, predict it, and physically get to it (see catching.js). ──

import { TUNING, DEG } from "../config.js";
import { CX, LOS } from "../field.js";
import { angDiff, clamp, lerp } from "../math.js";

export function createBall() {
  return {
    x: CX, y: LOS, z: 0.25,
    vx: 0, vy: 0, vz: 0,
    state: "dead", // dead | snap | held | air | ground
    carrierId: null,
    snap: null,
    throw: null,
  };
}

// ── Mouse hold duration → throw character. Continuous: a quick tap is a
// line drive, a long hold a moonball, everything in between in between. ──
export function throwProfile(hold) {
  const B = TUNING.ball;
  const u = clamp(hold / B.fullArcHold, 0, 1);
  const angle = lerp(B.minAngle, B.maxAngle, Math.pow(u, 0.85));
  const type = u < 0.18 ? "Bullet" : u < 0.45 ? "Firm" : u < 0.75 ? "Touch" : "Lofted";
  return { u, angle, type };
}

// ── Solve the launch for a target point. The hold decides how hard it's
// thrown: a quick tap is near the top of his arm on a flat line, a long
// hold the softest ball that still gets there on a lofted arc, anything
// between blends the two. The launch angle is then whatever gets that speed
// to chest height on the target (the flat solution). Past his arm the ball
// falls short. The ball also carries the QB's own motion, and he aims off
// it, so it still arrives where he's aiming; on the run the cost is arm
// speed across the body, not placement. ──
function speedForAngle(R, angle, dh) {
  const c = Math.cos(angle);
  return Math.sqrt((TUNING.ball.gravity * R * R) / (2 * c * c * (R * Math.tan(angle) + dh)));
}

// The flat launch angle that gets speed v to the target (null if it can't).
function flatAngle(R, v, dh) {
  const a = (TUNING.ball.gravity * R * R) / (2 * v * v);
  const disc = R * R - 4 * a * (a - dh);
  if (disc < 0) return null;
  return Math.atan((R - Math.sqrt(disc)) / (2 * a));
}

// ── Across the body: the QBs are right-handed, so rolling right and
// throwing back to the left means throwing across his body — he can't get
// his hips into it. 0 (not at all) → 1 (sprinting right, throwing straight
// left). Costs velocity here and accuracy in the scatter (engine). ──
export function acrossBody(qb, dx) {
  if (dx >= 0 || qb.vx <= 1.2) return 0;
  const toLeft = clamp(-dx / Math.max(1, Math.abs(dx) + 4), 0, 1); // how far left the throw goes
  return clamp((qb.vx - 1.2) / 4.5, 0, 1) * toLeft;
}

export function solveThrow(qb, targetX, targetY, hold) {
  const B = TUNING.ball;
  const { type, u } = throwProfile(hold);
  const rx = qb.x + Math.cos(qb.facing) * 0.3; // the ball leaves from in front of him
  const ry = qb.y + Math.sin(qb.facing) * 0.3;
  const dh = B.releaseHeight - B.catchHeight;
  let ax = targetX;
  let ay = targetY;
  let v = 0;
  let angle = 0;
  let dir = 0;
  let short = false;
  let bodyFactor = 1;
  let across = 0;
  for (let i = 0; i < 4; i++) {
    const dx = ax - rx;
    const dy = ay - ry;
    const R = Math.max(1, Math.hypot(dx, dy));
    dir = Math.atan2(dy, dx);
    // Throwing well off the line of the shoulders costs arm speed.
    const off = Math.abs(angDiff(dir, qb.facing));
    bodyFactor = 1 - 0.45 * clamp((off - 25 * DEG) / (120 * DEG), 0, 1);
    // Across the body (a righty rolling right, throwing left) costs up to a
    // third of his arm.
    across = acrossBody(qb, targetX - qb.x);
    const vMax = B.maxSpeed * bodyFactor * (1 - 0.33 * across) * (qb.traits.arm ?? 1); // arm strength (dynasty)
    const vLoft = speedForAngle(R, B.maxAngle, dh);
    // Even his hardest throw scales with the distance — nobody throws a
    // 7-yard flat at full velocity.
    const vFast = Math.max(vLoft, Math.min(vMax, B.shortSpeed + B.speedPerYard * R) * B.bulletFraction);
    v = clamp(lerp(vFast, vLoft, Math.pow(u, 0.85)), B.minSpeed, vMax);
    // …and whatever the throw, across the body it comes out slower.
    v = Math.max(B.minSpeed, v * (1 - 0.25 * across));
    const fa = flatAngle(R, v, dh);
    short = fa == null;
    angle = short ? 40 * DEG : fa; // can't get there: his best, and it falls short
    const T = R / (v * Math.cos(angle)); // flight time to the aim point
    ax = targetX - qb.vx * B.inherit * T;
    ay = targetY - qb.vy * B.inherit * T;
  }
  const c = Math.cos(angle);
  const vh = v * c;
  return {
    vx: Math.cos(dir) * vh + qb.vx * B.inherit,
    vy: Math.sin(dir) * vh + qb.vy * B.inherit,
    vz: v * Math.sin(angle),
    speed: v, angle, type, u, short, bodyFactor, across,
    target: { x: targetX, y: targetY },
  };
}

// ── Where a thrown ball is catchable depends on how it was thrown. A
// bullet is a line drive: catchable (and tippable, pickable) the whole way.
// The more air under it, the more of its flight it spends over everyone's
// heads — a touch or lofted ball only comes down into reach right where it
// was aimed. Seconds before its arrival at the aim point that it becomes
// catchable, by hold fraction u (throwProfile). ──
export function catchWindow(u) {
  return u < 0.18 ? Infinity : u < 0.45 ? 0.7 : u < 0.75 ? 0.35 : 0.28;
}

export function stepBall(ball, dt) {
  if (ball.state !== "air") return;
  const g = TUNING.ball.gravity;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt - 0.5 * g * dt * dt;
  ball.vz -= g * dt;
}

// Ballistic prediction from a ball state. `startAt` stamps samples with
// absolute sim time so a player's (possibly stale) prediction stays usable.
export function predictPath(s, startAt, maxT = 5, step = 0.04) {
  const g = TUNING.ball.gravity;
  const out = [];
  for (let t = 0; t <= maxT; t += step) {
    const z = s.z + s.vz * t - 0.5 * g * t * t;
    out.push({ x: s.x + s.vx * t, y: s.y + s.vy * t, z: Math.max(0, z), at: startAt + t });
    if (z <= 0) break;
  }
  return out;
}
