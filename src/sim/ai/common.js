// src/sim/ai/common.js
// ── Options shared across roles: reacting to a thrown ball, and pursuing
// a ball carrier. Both work purely from the player's own perception (his
// predicted ball path, his memory of the carrier) and both aim at a
// *projected* meeting point from time-to-reach, never at where the target
// is right now. Role priorities (config.ROLE_PROFILE) decide how strongly
// each role cares. ──

import { ROLE_PROFILE, ELIGIBLES, TUNING } from "../config.js";
import { depthOf } from "../field.js";
import { physOf } from "../player.js";
import { fmt, angDiff } from "../math.js";
import { bestBallIntercept, interceptMover, timeToReach } from "../systems/kinematics.js";

// How close a thrown ball's catch point has to be for a receiver to break
// off his route and play it.
const BALL_AREA = 6;
// Hands height: where a ball is caught in stride.
const HANDS_LO = 0.5;
const HANDS_HI = 2.2;

// Where his route was taking him at time `at` — the run the throw was led
// to, frozen at the release. Measuring against this (not his velocity
// right now) is what keeps a receiver from talking himself out of a ball:
// ease off a step, the spot "his run" reaches moves back, so he eases off
// more, and he ends up coming back for a ball he could have run under.
function runAt(p, bk, at, now) {
  const r = bk.run || { x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: now };
  const dt = Math.max(0, at - r.t);
  return { x: r.x + r.vx * dt, y: r.y + r.vy * dt };
}

// Of the points where the ball comes down to his hands, the one closest to
// where his route was taking him — where the QB led him (as he reads it).
function ledSpot(p, bk, path, now) {
  let best = null;
  for (const s of path) {
    const tBall = s.at - now;
    if (tBall <= 0.05 || s.z < HANDS_LO || s.z > HANDS_HI) continue;
    const run = runAt(p, bk, s.at, now);
    const off = Math.hypot(s.x - run.x, s.y - run.y);
    if (!best || off < best.off) best = { s, tBall, off };
  }
  return best;
}

// Where a defender who can't beat the ball there goes: where it'll be
// caught — the point on its path nearest a receiver (as he sees them) —
// or, with nobody near it, where it comes down. Never the ball's current
// spot overhead.
function catchPoint(p, path, world) {
  const now = world.t;
  let best = null;
  let land = null;
  for (const s of path) {
    const tBall = s.at - now;
    if (tBall <= 0 || s.z < HANDS_LO || s.z > HANDS_HI) continue;
    land = s;
    for (const id of ELIGIBLES) {
      const m = p.perception.memory[id];
      if (!m) continue;
      const d = Math.hypot(s.x - (m.x + m.vx * tBall), s.y - (m.y + m.vy * tBall));
      if (d < 4 && (!best || d < best.d)) best = { s, d };
    }
  }
  return best ? best.s : land || path[path.length - 1];
}

// Opening up to the ball as it gets to him — hands to it, not a blind
// catch. Only to a ball coming in front of him or from the side: one coming
// over his shoulder (a deep ball he is running under) he looks in with his
// head and keeps running — turning his chest to it would stop him.
function openUp(p, bk, world, t) {
  if (!bk.seeing || t >= 0.5) return null;
  const b = world.ball;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > 2 && Math.abs(angDiff(Math.atan2(b.y - p.y, b.x - p.x), Math.atan2(p.vy, p.vx))) > (100 * Math.PI) / 180) return null;
  return { x: b.x, y: b.y };
}

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
  if (p.team === "O") {
    // A receiver keeps running his route unless the ball is his: coming
    // down where his route was taking him, somewhere he can get to, and not
    // clearly a teammate's. Once he's committed to a ball he stays on it.
    const led = ledSpot(p, bk, path, world.t);
    if (!led) return null;
    const committed = p.intent && p.intent.key === "ball";
    if (!committed && (led.off > BALL_AREA || r.margin < -0.4)) return null;
    if (!committed) {
      // Closest a teammate's current path comes to the spot before the ball does.
      const pass = (q) => {
        let best = Infinity;
        for (let t = 0; t <= led.tBall + 0.4; t += 0.1) best = Math.min(best, Math.hypot(led.s.x - (q.x + q.vx * t), led.s.y - (q.y + q.vy * t)));
        return best;
      };
      for (const q of world.offense) {
        if (q === p || (q.role !== "WR" && q.role !== "RB")) continue;
        if (pass(q) < led.off - 2) return null; // his, not mine
      }
    }
    const under = runUnder(p, bk, path, world);
    if (under) return under;
    // Can't get there at hands height but can get a hand on it — high-point
    // it, going up for it at the first spot he can reach.
    if (r.margin >= 0)
      return {
        key: "ball",
        urgent: true,
        label: "Going up for it",
        reason: `ball there in ${fmt(r.tBall)}s at ${fmt(r.z, 1)} yd, me ${fmt(r.tMe)}s`,
        score: 3 * prio + 1,
        moveTo: { x: r.x, y: r.y },
        speed: physOf(p).top,
        arrive: r.margin > 0.35,
        face: openUp(p, bk, world, r.tMe),
        debug: { kind: "ball", point: r },
      };
    // Can't get there at all: go hard at where it's coming down and lay
    // out for it.
    return {
      key: "ball",
      urgent: true,
      label: "Chasing ball → where it's coming down",
      reason: `lands in ${fmt(led.tBall)}s, ${fmt(led.off, 1)} yd off his line` + (bk.seeing ? "" : " · lost sight, using last read"),
      score: 3 * prio,
      moveTo: { x: led.s.x, y: led.s.y },
      speed: physOf(p).top,
      arrive: false,
      face: openUp(p, bk, world, led.tBall),
      debug: { kind: "ball", point: { x: led.s.x, y: led.s.y, tBall: led.tBall } },
    };
  }
  const canWin = r.margin >= 0;
  // Beat it there: the earliest point he can undercut. Can't: rally to
  // where it'll be caught.
  const pt = canWin ? r : catchPoint(p, path, world);
  return {
    key: "ball",
    urgent: true,
    label: canWin ? "Breaking on ball" : "Rallying to catch point",
    reason:
      `ball there in ${fmt(r.tBall)}s, me ${fmt(r.tMe)}s` +
      (bk.errorYds > 0.5 ? ` · read still ±${fmt(bk.errorYds, 1)} yd` : "") +
      (bk.seeing ? "" : " · lost sight, using last read"),
    score: 3 * prio + (canWin ? 1 : 0),
    moveTo: { x: pt.x, y: pt.y },
    speed: physOf(p).top,
    arrive: canWin && r.margin > 0.35, // early: get there and wait in the window
    face: bk.seeing && r.tMe < 0.5 ? { x: world.ball.x, y: world.ball.y } : null,
    debug: { kind: "ball", point: canWin ? r : { x: pt.x, y: pt.y, tBall: pt.at - world.t } },
  };
}

// ── Running under it. He picks his spot from where his route was taking
// him at the release (usually where the QB led him) — pinned there, so
// easing off can't walk the spot, and him, back toward the QB. Near that
// line he takes the ball at the first point he can get to, rather than
// letting it come down past a defender who's reading it too — unless it's a
// deep ball coming over his shoulder with nobody on him, which he lets drop
// in where the QB put it. Either way he runs THROUGH the spot, timed to get
// there with the ball. While it's still well out he holds his speed — he
// doesn't brake on a first read — and only fine-tunes his arrival as it
// comes down. A ball that's behind him (underthrown, hung up) he comes back
// to and settles under. Where he thinks the spot is, is his read of the
// ball (perception.js): a good tracker has it early and runs a clean line;
// a poor one is still drifting onto it — late, or a step short — as it
// comes down. ──
const LINE_SLACK = 1.5; // yd off his best line he'll go to take it earlier
const CONTEST_T = 0.3; // s: a defender who can get to his spot within this of him contests it
const COMMIT = 0.7; // s out from the ball's arrival when he starts timing his steps

// Can a defender — where he sees them — get to that spot about when he can?
function contested(p, c, world) {
  for (const d of world.defense) {
    const m = p.perception.memory[d.id];
    if (!m || m.conf < 0.3 || ROLE_PROFILE[d.role].passInAir <= 0) continue;
    const ghost = { ...d, x: m.x, y: m.y, vx: m.vx, vy: m.vy, facing: m.facing };
    if (timeToReach(ghost, c.s.x, c.s.y) <= Math.max(c.tMe, c.tBall) + CONTEST_T) return true;
  }
  return false;
}

function runUnder(p, bk, path, world) {
  const now = world.t;
  const top = physOf(p).top;
  const reachT = TUNING.catch.reachTracking / top; // hands out: needn't be *on* the spot
  const cands = [];
  let minOff = Infinity;
  for (const s of path) {
    const tBall = s.at - now;
    if (tBall <= 0.05 || s.z < HANDS_LO || s.z > HANDS_HI) continue;
    const tMe = Math.max(0, timeToReach(p, s.x, s.y) - reachT);
    if (tMe > tBall + 0.1) continue; // can't get there in time
    const run = runAt(p, bk, s.at, now);
    const off = Math.hypot(s.x - run.x, s.y - run.y);
    cands.push({ s, tBall, tMe, off });
    minOff = Math.min(minOff, off);
  }
  // A ball travelling the way he runs (a deep ball over his shoulder), with
  // nobody near it, he lets drop in on his line. One coming at him or across
  // him, or with a defender who can get there too, he attacks — the first
  // spot near his line (path is in time order).
  const r = bk.run || p;
  const rs = Math.hypot(r.vx, r.vy);
  const bs = Math.hypot(world.ball.vx, world.ball.vy) || 1;
  const withHim = rs > 3 && (r.vx * world.ball.vx + r.vy * world.ball.vy) / (rs * bs) > 0.5;
  const line = cands.find((c) => c.off <= minOff);
  const open = withHim && line && !contested(p, line, world);
  const best = open ? line : cands.find((c) => c.off <= minOff + LINE_SLACK);
  if (!best) return null;
  const { s, tBall, tMe } = best;
  const d = Math.hypot(s.x - p.x, s.y - p.y);
  const ux = d > 0.01 ? (s.x - p.x) / d : p.vx / (Math.hypot(p.vx, p.vy) || 1);
  const uy = d > 0.01 ? (s.y - p.y) / d : p.vy / (Math.hypot(p.vx, p.vy) || 1);
  // Behind him: he has to come back for it.
  const sp = Math.hypot(p.vx, p.vy);
  const back = sp > 1 && d > 1 && (ux * p.vx + uy * p.vy) / sp < -0.2;
  const floor = back || tBall < COMMIT ? 0.5 : 0.85;
  return {
    key: "ball",
    urgent: true,
    label: back ? "Coming back for it" : best.off < 1 ? "In stride — the ball's leading him" : "Running under it",
    reason: `meet it in ${fmt(tBall)}s (me ${fmt(tMe)}s), ${fmt(best.off, 1)} yd off his line` + (bk.errorYds > 0.5 ? ` · read ±${fmt(bk.errorYds, 1)} yd` : ""),
    score: 3 * ROLE_PROFILE[p.role].passInAir + 1,
    // Coming back: to the spot, and wait to step into it. Otherwise through it.
    moveTo: back ? { x: s.x, y: s.y } : { x: s.x + ux * 2, y: s.y + uy * 2 },
    speed: Math.max(floor * top, Math.min(top, d / tBall)),
    arrive: back,
    // Opens up to it as it gets there — hands to the ball, not a blind catch.
    face: openUp(p, bk, world, tBall),
    debug: { kind: "ball", point: { x: s.x, y: s.y, tBall, tMe, margin: tBall - tMe } },
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
