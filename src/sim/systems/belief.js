// src/sim/systems/belief.js
// ── Defensive beliefs, built only from the player's own perception memory.
//
// Run/pass: a log-odds value that starts at 50/50 at the snap and moves with
// evidence *this player can see*, weighted by how well he sees it — OL
// firing out vs. setting, the QB dropping, the RB holding the ball,
// receivers releasing vs. blocking, a ball in the air. A DB facing the
// line gets the same cues as an LB, just from farther away (weaker).
//
// Ball carrier: whoever this player last *saw* holding the ball. A handoff
// the player didn't see hasn't happened, as far as he knows.
//
// QB eyes → attention: for each eligible receiver, a continuous 0..1 value
// that rises while this defender can see the QB looking that way, and
// fades (more slowly) once the eyes move. That rise/fade asymmetry is the
// entire mechanism behind "look off the defender" — there is no scripted
// reaction to any play or coverage. ──

import { TUNING, ELIGIBLES, DEG } from "../config.js";
import { depthOf, LOS } from "../field.js";
import { angDiff, approach, clamp, sigmoid } from "../math.js";

export function updateBelief(p, world, dt) {
  if (p.team !== "D") return;
  const B = TUNING.belief;
  const mem = p.perception.memory;
  const cues = { ol: 0, qb: 0, rb: 0, wr: 0, ball: 0 };

  for (const q of world.offense) {
    const m = mem[q.id];
    if (!m || m.vis < 0.12) continue;
    const w = m.vis;
    const vy = m.vy; // + = toward the defense
    switch (q.role) {
      case "OL":
        if (vy > 0.5) cues.ol += w * 0.35 * Math.min(vy, 3);
        else if (vy < -0.4) cues.ol += w * 0.3 * Math.max(vy, -3);
        break;
      case "QB":
        if (m.hasBall) {
          if (vy < -1) cues.qb -= 0.8 * w;
          if (depthOf(m.y) > -0.5) cues.qb += 2.5 * w; // carrying it past the line
        }
        break;
      case "RB":
        if (m.hasBall) cues.rb += 3 * w;
        else if (world.sinceSnap > 0.9 && Math.hypot(m.vx, m.vy) < 2) cues.rb -= 0.25 * w;
        break;
      case "WR":
        if (m.engaged) cues.wr += 0.7 * w;
        else if (vy > 3) cues.wr -= 0.35 * w;
        break;
      default:
        break;
    }
  }
  if (p.perception.ball.seeing) cues.ball = -6;

  const ev = cues.ol + cues.qb + cues.rb + cues.wr + cues.ball;
  p.belief.logit = clamp(p.belief.logit + ev * B.runPassGain * p.traits.recognition * dt, -B.maxLogit, B.maxLogit);
  p.belief.pRun = sigmoid(p.belief.logit);
  p.belief.cues = cues;

  // Who has the ball — as last seen.
  for (const q of world.offense) {
    const m = mem[q.id];
    if (!m || m.vis < 0.3) continue;
    if (m.hasBall) p.belief.carrierId = q.id;
    else if (p.belief.carrierId === q.id) p.belief.carrierId = null;
  }

  updateAttention(p, world, dt);
  updateScreen(p, world, dt);
}

// ── Screen recognition, from what he sees: while the QB still has the ball,
// offensive linemen out of their sets — moving across or up the field with
// their hands on nobody — and a back or receiver sitting behind the line
// turned to the QB, near where they're going. Linebackers and DBs, facing
// the backfield, read it best; a lineman rushing the passer mostly doesn't
// (screenSense: some do, most don't). ──
const SCREEN_GAIN = { DL: 0.9, LB: 3.2, CB: 2.6, S: 2.0 };
function updateScreen(p, world, dt) {
  const mem = p.perception.memory;
  const qb = mem.QB;
  const b = world.ball;
  const live = b.state === "held" && b.carrierId === "QB" && world.sinceSnap > 0.3 && qb;
  let out = 0;
  let cx = 0;
  let cy = 0;
  let vx = 0;
  if (live)
    for (const q of world.offense) {
      if (q.role !== "OL") continue;
      const m = mem[q.id];
      if (!m || m.vis < 0.2 || m.engaged || m.y < LOS - 2.5) continue;
      if (Math.hypot(m.vx, m.vy) > 1.2 && m.vy > -0.3) {
        out += m.vis;
        cx += m.x * m.vis;
        cy += m.y * m.vis;
        vx += m.vx * m.vis;
      }
    }
  // The other classic tell: a receiver blocking while the QB still has the
  // ball (the slot on a tunnel) — it's a run or a screen, and it's a pass.
  if (live)
    for (const q of world.offense) {
      if (q.role !== "WR") continue;
      const m = mem[q.id];
      if (m && m.vis > 0.3 && m.engaged && m.y < LOS + 4) {
        out += 0.8 * m.vis;
        cx += m.x * 0.8 * m.vis;
        cy += m.y * 0.8 * m.vis;
      }
    }
  let target = null;
  if (out > 0.4) {
    cx /= out;
    cy /= out;
    // Where they're heading, not where they are.
    cx += (vx / out) * 1.2;
    for (const q of world.offense) {
      if (q.role !== "WR" && q.role !== "RB") continue;
      const m = mem[q.id];
      if (!m || m.vis < 0.2 || m.vy > 1.5) continue;
      // Behind the line — or coming back to it (a tunnel) — not running a route.
      const back = m.y < LOS + 0.8 || (m.y < LOS + 3 && m.vy < -0.8);
      if (!back) continue;
      const toQB = Math.atan2(qb.y - m.y, qb.x - m.x);
      const facing = Math.abs(angDiff(m.facing, toQB)) < 75 * DEG;
      // Out where the linemen are heading (across the field, mostly).
      const d = Math.abs(m.x - cx) + 0.3 * Math.abs(m.y - cy);
      const score = (facing ? 1 : 0.65) / (1 + d / 5);
      if (!target || score > target.score) target = { id: q.id, score };
    }
  }
  // A screen line sets like pass first, then releases; a run (or play
  // action) line fires out. So it only reads as a screen to a defender who
  // thinks it's a pass.
  const passLook = Math.pow(clamp(1 - p.belief.pRun, 0, 1), 2);
  let evidence = Math.min(1, out / 1.4) * (target ? 0.7 + target.score : 0.6) * passLook;
  // A rusher's own tell: the man blocking him just let him go.
  if (live && p.role === "DL") {
    if (p.blockers.length) p.lastBlockedAt = world.t;
    else if (p.lastBlockedAt != null && world.t - p.lastBlockedAt < 0.5 && world.sinceSnap > 0.6) evidence += 0.6 * passLook;
  }
  const gain = (SCREEN_GAIN[p.role] || 1) * (p.screenSense ?? 1) * p.traits.recognition;
  if (evidence > 0.05) p.belief.screen = Math.min(1, p.belief.screen + dt * gain * evidence);
  else if (b.state === "held" && b.carrierId === "QB") p.belief.screen = Math.max(0, p.belief.screen - dt * 0.6);
  if (target && target.score > 0.22) p.belief.screenTarget = target.id;
}

function updateAttention(p, world, dt) {
  const B = TUNING.belief;
  const mq = p.perception.memory.QB;
  // How well he knows where the QB's eyes are: what he sees now, or the
  // last clean look — bodies crossing the sight line for a moment don't
  // wipe out a read of a QB who's been locked on one spot.
  const visQB = mq ? Math.max(mq.vis, 0.9 * clamp(1 - (world.t - (mq.facingAt ?? -9)) / 0.8, 0, 1)) : 0;
  const windup = world.throwCharging && visQB > 0.2 ? B.windupBoost : 1;
  for (const id of ELIGIBLES) {
    const mr = p.perception.memory[id];
    if (!mr) continue;
    let target = 0;
    if (mq && visQB > 0.1 && mq.hasBall) {
      // Eyes on him, or on where he's going (a QB leads a route with his
      // eyes too).
      let diff = Infinity;
      for (const h of [0, 0.5, 1.0]) {
        const dir = Math.atan2(mr.y + mr.vy * h - mq.y, mr.x + mr.vx * h - mq.x);
        diff = Math.min(diff, Math.abs(angDiff(dir, mq.facing)));
      }
      target = visQB * Math.exp(-((diff / B.eyeWidth) ** 2)) * Math.min(1, mr.conf * 1.2);
    }
    const cur = p.belief.attention[id] || 0;
    const tau = target > cur ? B.attentionRise / (windup * p.traits.recognition) : B.attentionFall;
    p.belief.attention[id] = approach(cur, target, dt, tau);
  }
  // How long the eyes have stayed on one man: a QB staring a route down
  // gives it away. Builds for whoever has the eyes most, drains for the rest.
  let top = null;
  for (const id of ELIGIBLES) {
    const a = p.belief.attention[id] || 0;
    if (a > 0.45 && (!top || a > p.belief.attention[top])) top = id;
  }
  for (const id of ELIGIBLES) {
    const st = p.belief.stare[id] || 0;
    p.belief.stare[id] = id === top ? st + dt : Math.max(0, st - 1.5 * dt);
  }
}
