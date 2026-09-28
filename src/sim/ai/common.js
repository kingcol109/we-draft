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
  const r = bestBallIntercept(p, bk.path, world.t, 0);
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
  if (cid === "QB" && !qbRun && depthOf(m.y) < -0.5 && m.vy < 3) return null;
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
