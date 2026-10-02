// src/sim/ai/common.js
// ── Options shared across roles: reacting to a thrown ball, and pursuing
// a ball carrier. Both work purely from the player's own perception (his
// predicted ball path, his memory of the carrier) and both aim at a
// *projected* meeting point from time-to-reach, never at where the target
// is right now. Role priorities (config.ROLE_PROFILE) decide how strongly
// each role cares. ──

import { ROLE_PROFILE } from "../config.js";
import { depthOf } from "../field.js";
import { physOf } from "../player.js";
import { fmt } from "../math.js";
import { bestBallIntercept, interceptMover } from "../systems/kinematics.js";

// How close a thrown ball's catch point has to be for a receiver to break
// off his route and play it.
const BALL_AREA = 6;

export function ballOption(p, world) {
  const prio = ROLE_PROFILE[p.role].passInAir;
  const bk = p.perception.ball;
  if (world.ball.state !== "air" || prio <= 0 || !bk.acquired || !bk.path) return null;
  // Only where the ball is catchable counts — a touch throw is played
  // where it comes down, not where it's flying over.
  const from = world.ball.catchFrom;
  const path = from != null ? bk.path.filter((s) => s.at >= from) : bk.path;
  if (!path.length) return null;
  const r = bestBallIntercept(p, path, world.t, 0);
  if (!r) return null;
  // A role with other responsibilities doesn't abandon them for a ball it
  // can't get near.
  if (r.margin < -1.6 * prio) return null;
  // A receiver keeps running his route unless the ball is his: coming down
  // in his area, somewhere he can get to, and not clearly a teammate's.
  // "His area" is measured from where his route has him when the ball gets
  // there; once he's committed to a ball he stays on it.
  if (p.team === "O") {
    const committed = p.intent && p.intent.key === "ball";
    // Closest his current path comes to the catch point before the ball arrives.
    const pass = (q) => {
      let best = Infinity;
      for (let t = 0; t <= r.tBall + 0.4; t += 0.1) best = Math.min(best, Math.hypot(r.x - (q.x + q.vx * t), r.y - (q.y + q.vy * t)));
      return best;
    };
    const dMe = pass(p);
    if (!committed && (dMe > BALL_AREA || r.margin < -0.4)) return null;
    if (!committed)
      for (const q of world.offense) {
        if (q === p || (q.role !== "WR" && q.role !== "RB")) continue;
        if (pass(q) < dMe - 2) return null; // his, not mine
      }
  }
  const canWin = r.margin >= 0;
  const offense = p.team === "O";
  if (offense) {
    const stride = inStride(p, bk, path, world);
    if (stride) return stride;
  }
  return {
    key: "ball",
    urgent: true,
    label: canWin ? (offense ? "Tracking ball → catch point" : "Breaking on ball") : offense ? "Chasing ball" : "Rallying to catch point",
    reason:
      `ball there in ${fmt(r.tBall)}s, me ${fmt(r.tMe)}s` +
      (bk.errorYds > 0.5 ? ` · read still ±${fmt(bk.errorYds, 1)} yd` : "") +
      (bk.seeing ? "" : " · lost sight, using last read"),
    score: 3 * prio + (canWin ? 1 : 0),
    moveTo: { x: r.x, y: r.y },
    speed: physOf(p).top,
    arrive: r.margin > 0.35, // early: get there and wait in the window
    face: bk.seeing && r.tMe < 0.5 ? { x: world.ball.x, y: world.ball.y } : null,
    debug: { kind: "ball", point: r },
  };
}

// ── A receiver plays the ball where it's GOING: of every point on its path
// he can get to in time (at catchable height), the one closest to where
// his own run is taking him — usually the spot the QB led him to — and he
// runs THROUGH it, timing his speed to get there with the ball, instead of
// pulling up at the first spot he could reach and waiting. ──
function inStride(p, bk, path, world) {
  const now = world.t;
  const top = physOf(p).top;
  let best = null;
  for (const s of path) {
    const tBall = s.at - now;
    if (tBall <= 0.05 || s.z < 0.5 || s.z > 2.2) continue;
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d / top > tBall + 0.15) continue; // can't get there in time
    // Where his current run has him when the ball arrives.
    const off = Math.hypot(s.x - (p.x + p.vx * tBall), s.y - (p.y + p.vy * tBall));
    if (!best || off < best.off) best = { s, tBall, d, off };
  }
  if (!best) return null;
  const { s, tBall, d } = best;
  // Through the catch point, not to it.
  const ux = d > 0.01 ? (s.x - p.x) / d : p.vx / (Math.hypot(p.vx, p.vy) || 1);
  const uy = d > 0.01 ? (s.y - p.y) / d : p.vy / (Math.hypot(p.vx, p.vy) || 1);
  const speed = Math.min(top, Math.max(0.55 * top, d / tBall));
  return {
    key: "ball",
    urgent: true,
    label: best.off < 1 ? "In stride — the ball's leading him" : "Tracking ball → where it's going",
    reason: `meet it in ${fmt(tBall)}s, ${fmt(best.off, 1)} yd off his line`,
    score: 3 * ROLE_PROFILE[p.role].passInAir + 1,
    moveTo: { x: s.x + ux * 2, y: s.y + uy * 2 },
    speed,
    arrive: false,
    // Opens up to it as it gets there — hands to the ball, not a blind catch.
    face: bk.seeing && tBall < 0.5 ? { x: world.ball.x, y: world.ball.y } : null,
    debug: { kind: "ball", point: { x: s.x, y: s.y, tBall, tMe: d / top, margin: tBall - d / top } },
  };
}

// Does this player believe a ball carrier is running with it (as opposed
// to a QB still in the pocket)?
export function believedRunner(p, world) {
  const cid = p.belief.carrierId;
  if (!cid) return null;
  const m = p.perception.memory[cid];
  if (!m) return null;
  // A QB behind the line is still a passer — unless the call is a QB run
  // (option, draw), where the QB with the ball is the runner from the snap.
  const qbRun = world && world.play && world.play.qbRun && world.state === "RUN_DEVELOPMENT";
  // ...and so is one who kept it on a read: a defender who has already
  // read run and sees him running with it (not dropping) plays him as the
  // runner — he doesn't drop into coverage on a QB pull.
  const pulled = Math.hypot(m.vx, m.vy) > 3 && m.vy > -1 && p.belief.pRun > 0.55;
  if (cid === "QB" && !qbRun && !pulled && depthOf(m.y) < -0.5 && m.vy < 3) return null;
  return { id: cid, m, past: depthOf(m.y) > -0.5 };
}

export function pursuitOption(p, world, runner, { key = "run", label, shadeX = 0, score = 2 } = {}) {
  const m = runner.m;
  // From any distance, take the angle as if he'll be at speed — a pursuer
  // who aims at a slow carrier's current pace gets outrun when he hits it.
  const sp = Math.hypot(m.vx, m.vy);
  const dist = Math.hypot(m.x - p.x, m.y - p.y);
  let tgt = m;
  // (Variance on: a defender with a blown angle this rep leads the carrier
  // too much — overrunning him — or too little, chasing from behind.)
  const miss = p.form && p.form.angle && sp > 1 && dist > 3 ? p.form.angle : null;
  if (sp > 1 && dist > 4) {
    const s = Math.max(sp, 0.8 * physOf(p).top) * (miss ? miss.lead : 1);
    tgt = { ...m, vx: (m.vx / sp) * s, vy: (m.vy / sp) * s };
  } else if (sp > 1) {
    // Close in, a carrier who's still building speed (just caught it, just
    // cut) will be going faster by contact — lead that, or overrun it.
    const s = Math.min(Math.max(sp, 0.65 * physOf(p).top), sp + 2.5) * (miss ? miss.lead : 1);
    tgt = { ...m, vx: (m.vx / sp) * s, vy: (m.vy / sp) * s };
  } else if (miss) tgt = { ...m, vx: m.vx * miss.lead, vy: m.vy * miss.lead };
  const ip = interceptMover(p, tgt, 0);
  const lost = m.vis < 0.15;
  p.shedToward = runner.id;
  return {
    key,
    urgent: true,
    label: label || `Pursuing ${runner.id}`,
    reason:
      `meet in ${fmt(ip.t)}s at projected spot` +
      (miss ? ` · ${miss.kind === "over" ? "overrunning it" : "too flat"}` : "") +
      (lost ? ` · can't see ${runner.id} (${fmt(world.t - m.lastSeen, 1)}s) — estimating` : ""),
    score,
    moveTo: { x: ip.x + shadeX, y: ip.y },
    speed: physOf(p).top,
    arrive: false,
    face: null,
    debug: { kind: "pursuit", point: { x: ip.x + shadeX, y: ip.y }, t: ip.t },
  };
}
