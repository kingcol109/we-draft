// src/sim/ai/routes.js
// ── Route running from landmarks (playbook.ROUTES). Each leg is an intent —
// "stem to 5", "come back to the QB", "break to the corner" — executed with
// ordinary movement physics. The sharpness of a break is simply how hard
// the receiver has to change direction at the landmark: a hitch is a
// near-180° plant, so he sinks his hips (decelerates) into it; a corner is a
// 45° break he can carry speed through. ──

import { ROUTES } from "../playbook.js";
import { CX, FIELD, LOS, OL_SPLIT, depthOf } from "../field.js";
import { physOf } from "../player.js";
import { angDiff, angleTo, clamp, fmt } from "../math.js";

function advance(p, world, why) {
  const r = p.route;
  r.idx += 1;
  r.breakPt = { x: p.x, y: p.y };
  r.legStart = world.t;
  world.log(p, why, `at ${fmt(depthOf(p.y), 1)} yd`);
}

// Head around over the inside shoulder toward the QB, as far as head and
// eyes turn together (~100°) — the shoulders stay on the route.
const NECK = (100 * Math.PI) / 180;
// Signed head turn from `travel` toward pt, the shorter way; only when it's
// almost straight behind is it ambiguous — then it's the inside shoulder
// (toward where the QB is now; a receiver who crossed the formation has
// swapped sides).
function turnToward(p, pt, qb, travel, side) {
  let turn = angDiff(angleTo(p.x, p.y, pt.x, pt.y), travel);
  if (Math.abs(turn) > (160 * Math.PI) / 180) {
    const s = Math.sign(p.x - qb.x) || side;
    if (turn * s < 0) turn += s * 2 * Math.PI;
  }
  return turn;
}

function lookBack(p, qb, travel, side) {
  p.gaze = travel + clamp(turnToward(p, qb, qb, travel, side), -NECK, NECK);
}

// Ball in the air and coming from behind him — a corner has him running
// away from the QB, with the ball ~170° off his line. The neck alone can't
// get there (it only reaches the edge of his peripheral vision), so he
// opens his hips toward it: chest turned part way, head the rest, trading a
// little speed for finding it early. Eyes go to the QB until he has the
// ball in sight, then to the ball. Returns the chest facing.
const FIND = (15 * Math.PI) / 180; // bring it this close to the centre of his eyes
const OPEN_MAX = (60 * Math.PI) / 180; // most he opens up while still running the route
function openToBall(p, world, qb, travel, side) {
  const pt = p.perception.ball.seeing ? world.ball : qb;
  const turn = turnToward(p, pt, qb, travel, side);
  const open = Math.sign(turn) * clamp(Math.abs(turn) - NECK + FIND, 0, OPEN_MAX);
  p.gaze = travel + open + clamp(turn - open, -NECK, NECK);
  return travel + open;
}

// Turn the head toward a point (the ball), chest staying where it is — the
// neck turns from the chest, not from the line he's running (a receiver
// who's opened his hips can see a ball that's behind his path).
export function headToward(p, pt) {
  p.gaze = p.facing + clamp(angDiff(angleTo(p.x, p.y, pt.x, pt.y), p.facing), -NECK, NECK);
}

export function routeOption(p, world) {
  const legs = ROUTES[p.assignment.route];
  if (!p.route) p.route = { idx: 0, breakPt: { x: p.home.x, y: p.home.y }, legStart: world.t, settle: null };
  const r = p.route;
  const leg = legs[r.idx];
  const qb = world.byId.QB;
  const ph = physOf(p);
  const side = Math.sign(p.home.x - CX) || 1;
  const toQB = { x: qb.x, y: qb.y };
  const name = p.assignment.route;

  if (!leg) {
    // Route finished (corner ran out of room) — keep working upfield, head
    // around for the ball.
    const air = world.ball.state === "air";
    if (!air) lookBack(p, qb, Math.PI / 2, side);
    return {
      key: "route", label: "Route done — work upfield", reason: "past last landmark", score: 1,
      moveTo: { x: clamp(p.x, 1.5, FIELD.width - 1.5), y: p.y + 8 }, speed: ph.top, arrive: false,
      face: air ? openToBall(p, world, qb, Math.PI / 2, side) : null,
    };
  }

  switch (leg.type) {
    case "stem": {
      const ty = LOS + leg.depth;
      const remaining = ty - p.y;
      if (remaining <= 0.25) {
        advance(p, world, `Hit ${leg.depth}-yd landmark — break`);
        return routeOption(p, world);
      }
      let speed = ph.top;
      // Sink the hips: decelerate into a hard break so it can be made at all.
      if (leg.sink) speed = Math.min(speed, Math.sqrt(2 * ph.brake * 0.7 * Math.max(0, remaining)) + 2.2);
      return {
        key: "route", label: `Stem (${leg.depth}-yd ${name})`, reason: `${fmt(remaining, 1)} yd to landmark`, score: 1,
        moveTo: { x: leg.fromBreak ? r.breakPt.x : p.home.x, y: ty + 3 }, speed, arrive: false, face: Math.PI / 2,
        debug: { landmark: { x: leg.fromBreak ? r.breakPt.x : p.home.x, y: ty } },
      };
    }
    case "comeback": {
      const g = angleTo(r.breakPt.x, r.breakPt.y, qb.x, qb.y);
      const target = { x: r.breakPt.x + Math.cos(g) * leg.dist, y: r.breakPt.y + Math.sin(g) * leg.dist };
      if (Math.hypot(target.x - p.x, target.y - p.y) < 0.35 || world.t - r.legStart > 1.2) {
        advance(p, world, "Settle — show hands to QB");
        r.settle = { x: p.x, y: p.y };
        return routeOption(p, world);
      }
      return {
        key: "route", label: `Break: ${name} back to QB`, reason: "planted at landmark", score: 1,
        moveTo: target, speed: ph.top, face: toQB, debug: { landmark: target },
      };
    }
    case "settle": {
      // Settle in the window — slide away from the nearest defender he can see.
      const s = r.settle || { x: p.x, y: p.y };
      let near = null;
      for (const [id, m] of Object.entries(p.perception.memory)) {
        if (m.conf < 0.3) continue;
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (d < 3.5 && (!near || d < near.d)) near = { id, d, m };
      }
      let ox = 0;
      if (near) ox = clamp(-(near.m.x - p.x) * 0.6, -1.2, 1.2);
      return {
        key: "route", label: "Settled — facing QB", reason: near ? `sliding off ${near.id} (${fmt(near.d, 1)} yd)` : "open window",
        score: 1, moveTo: { x: s.x + ox, y: s.y }, speed: 3, face: toQB,
      };
    }
    case "spot": {
      // A landmark relative to his alignment: dx outside (+) / inside (−)
      // of where he lined up, dy off the line of scrimmage.
      const pt = { x: clamp(p.home.x + side * leg.dx, 1.5, FIELD.width - 1.5), y: LOS + leg.dy };
      if (Math.hypot(pt.x - p.x, pt.y - p.y) < 0.6) {
        advance(p, world, leg.next || `${name}: at the spot`);
        r.settle = { x: p.x, y: p.y };
        return routeOption(p, world);
      }
      const travel = Math.atan2(pt.y - p.y, pt.x - p.x);
      if (leg.eyes) lookBack(p, qb, travel, side);
      return {
        key: "route", label: leg.label || `${name}`, reason: leg.eyes ? "eyes on the QB" : "to the landmark", score: 1,
        moveTo: pt, speed: ph.top * (leg.pace ?? 1), arrive: false, face: travel, debug: { landmark: pt },
      };
    }
    case "wait": {
      // Sell something else first (a screen back in pass pro), then go.
      if (world.t - r.legStart >= leg.dur) {
        advance(p, world, `${name}: release`);
        return routeOption(p, world);
      }
      return {
        key: "route", label: leg.label || "Hold", reason: `${fmt(leg.dur - (world.t - r.legStart), 1)}s`, score: 1,
        moveTo: { x: qb.x + side * 1.3, y: qb.y + 0.4 }, speed: 3, face: Math.PI / 2,
      };
    }
    case "kickFake": {
      // Run the split-zone kickout path at the backside end (the side away
      // from the fake), behind the line — then release.
      const ps = world.fakeSide || 1;
      const endX = CX - ps * (2 * OL_SPLIT + 1.2);
      const pt = { x: endX + ps * 0.4, y: LOS - 0.8 };
      if (world.t - r.legStart > leg.dur || Math.hypot(pt.x - p.x, pt.y - p.y) < 0.8) {
        advance(p, world, "Kickout fake — release");
        return routeOption(p, world);
      }
      return {
        key: "route", label: leg.label, reason: "sell the kickout", score: 1,
        moveTo: pt, speed: ph.top, arrive: false,
      };
    }
    case "angle": {
      // A straight-line break at `deg` off vertical, toward the sideline
      // ("out") or the middle ("in") — or toward the QB's boot side.
      const a = (leg.deg * Math.PI) / 180;
      const toward = leg.boot ? -(world.fakeSide || 1) : leg.dir === "in" ? -side : side;
      const dir = { x: toward * Math.sin(a), y: Math.cos(a) };
      const end = {
        x: clamp(r.breakPt.x + dir.x * leg.length, 1.5, FIELD.width - 1.5),
        y: r.breakPt.y + dir.y * leg.length,
      };
      if (Math.hypot(end.x - p.x, end.y - p.y) < 1.0) {
        advance(p, world, leg.next || `${name}: leg done`);
        return routeOption(p, world);
      }
      const travel = Math.atan2(end.y - p.y, end.x - p.x);
      const air = world.ball.state === "air";
      const look = air || world.t - r.legStart > 0.35;
      const face = air ? openToBall(p, world, qb, travel, side) : travel;
      if (look && !air) lookBack(p, qb, travel, side);
      const opened = Math.abs(angDiff(face, travel)) > 0.05;
      return {
        key: "route", label: leg.label || `Break: ${name}`,
        reason: opened ? "ball's up — open the hips to find it" : look ? "eyes back to QB — shoulders on the route" : "driving out of the break",
        score: 1, moveTo: end, speed: ph.top, arrive: false, face,
      };
    }
    case "vertical": {
      // Straight up the field: on a landmark `inset` inside the alignment,
      // or (fromBreak) straight up from where the last leg ended — the wheel.
      const lx = leg.fromBreak ? r.breakPt.x : clamp(p.home.x - side * leg.inset, 2, FIELD.width - 2);
      const dep = depthOf(p.y);
      const travel = Math.atan2(8, lx - p.x);
      const look = dep >= leg.lookAfter || world.ball.state === "air";
      if (look) lookBack(p, qb, travel, side);
      return {
        key: "route",
        label: leg.label || `${name === "seam" ? "Seam" : "Go"} route`,
        reason: look ? "head around for the ball — shoulders upfield" : `${fmt(dep, 1)} yd — stacking vertically`,
        score: 1, moveTo: { x: lx, y: p.y + 8 }, speed: ph.top, arrive: false, face: travel,
      };
    }
    default:
      return null;
  }
}
