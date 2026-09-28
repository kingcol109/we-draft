// src/sim/systems/blocking.js
// ── Blocking and body contact. Simplified, but physical: nobody passes
// through anybody, and the pocket / running lanes are whatever these
// interactions leave behind.
//
// A blocker *engages* a defender when he is close and squared up to him.
// While engaged both are slowed (hand-fighting), and contact is resolved
// with momentum exchange — a squared-up, anchored blocker is harder to move.
// A defender *beats* a block by getting level with or past the blocker
// relative to what the blocker is protecting (the QB, or the ball carrier)
// — i.e. by winning the geometry, which he does by moving laterally faster
// than the blocker can mirror him (the blocker's read of him lags, and he
// carries momentum). A defender can also shed a block to make a play on a
// ball carrier who comes within reach. ──

import { TUNING, DEG } from "../config.js";
import { angDiff, angleTo, dist } from "../math.js";

export function updateEngagements(world, dt) {
  const K = TUNING.block;
  const M = TUNING.move;
  const T = TUNING.tackle;
  for (const p of world.players) p.blockers = [];

  // Existing engagements: do they hold?
  for (const b of world.players) {
    if (!b.engagedWith) continue;
    const d = world.byId[b.engagedWith];
    if (!d) {
      b.engagedWith = null;
      continue;
    }
    let why = null;
    const G = b.protectPoint;
    // Defender level with / past the blocker relative to what he protects.
    const past = G && dist(d.x, d.y, G.x, G.y) < dist(b.x, b.y, G.x, G.y) - 0.15;
    if (d.hasBall) why = "released";
    else if (dist(b.x, b.y, d.x, d.y) > K.releaseDist) why = past ? "slipped" : "lost contact";
    else if (past) why = "beaten";
    // A square-shouldered run blocker still has a man beside his shoulder;
    // he's beaten when the defender gets past the shoulder plane.
    const runBlock = RUN_BLOCKS.has(b.assignment.kind);
    const beat = runBlock ? K.runBeatAngle : K.beatAngle;
    if (!why && Math.abs(angDiff(angleTo(b.x, b.y, d.x, d.y), b.facing)) > beat) why = "beaten";
    if (why) {
      b.engagedWith = null;
      b.reengage[d.id] = world.t + K.reengageDelay;
      if ((why === "beaten" || why === "slipped") && world.stats) world.stats.beatBlocks.push({ d: d.id, b: b.id, t: world.t });
      if (why === "beaten") world.log(d, `Beat ${b.id}'s block`, "got past the blocker's shoulder");
      else if (why === "slipped") world.log(d, `Slipped ${b.id}'s block`, "worked laterally faster than he could mirror");
      else if (why === "lost contact") world.log(b, `Lost contact with ${d.id}`, "");
      continue;
    }
    d.blockers.push(b.id);
  }

  // New engagements.
  for (const b of world.players) {
    if (b.engagedWith || !b.blockTarget) continue;
    const d = world.byId[b.blockTarget];
    if (!d || d.hasBall) continue;
    if ((b.reengage[d.id] || 0) > world.t) continue;
    if (dist(b.x, b.y, d.x, d.y) > K.engageDist) continue;
    if (Math.abs(angDiff(angleTo(b.x, b.y, d.x, d.y), b.facing)) > K.facingToEngage) continue;
    // No blocks in the back: a defender running away from him (in pursuit)
    // can't be picked up from behind.
    const moving = Math.hypot(d.vx, d.vy) > 2.5;
    if (moving && Math.abs(angDiff(angleTo(d.x, d.y, b.x, b.y), Math.atan2(d.vy, d.vx))) > 115 * DEG) continue;
    b.engagedWith = d.id;
    d.blockers.push(b.id);
    world.log(b, `Engaged ${d.id}`);
  }

  // Shedding toward a ball carrier within reach.
  for (const d of world.defense) {
    if (!d.blockers.length || !d.shedToward) continue;
    const c = world.byId[d.shedToward];
    if (!c || dist(d.x, d.y, c.x, c.y) > T.shedRange) continue;
    // Leverage: a blocker with his body between the defender and the ball
    // is hard to shed toward it; one beside or behind him isn't.
    let lev = 1;
    for (const id of d.blockers) {
      const b = world.byId[id];
      const off = Math.abs(angDiff(angleTo(d.x, d.y, c.x, c.y), angleTo(d.x, d.y, b.x, b.y)));
      if (off < 60 * DEG) lev = Math.min(lev, 0.25);
      else if (off < 100 * DEG) lev = Math.min(lev, 0.6);
    }
    const str = shedPower(d, world.byId[d.blockers[0]]) / avgBlockPower(world, d.blockers, d);
    if (world.rng() < (T.shedRate * lev * str * dt) / d.blockers.length) {
      for (const id of d.blockers) {
        const b = world.byId[id];
        b.engagedWith = null;
        b.reengage[d.id] = world.t + K.reengageDelay;
      }
      world.log(d, "Shed the block", `ball carrier ${c.id} within ${T.shedRange} yd`);
      d.blockers = [];
    }
  }

  // Hand-fighting slows everyone involved.
  // Whoever is winning the fight moves more freely.
  for (const p of world.players) {
    p.speedCap = Infinity;
    if (p.engagedWith) {
      const d = world.byId[p.engagedWith];
      p.speedCap = M.blockerSpeedCap * (d ? Math.sqrt(blockPower(p, d) / shedPower(d, p)) : 1);
    }
    if (p.blockers.length)
      p.speedCap =
        (M.engagedSpeedCap / Math.sqrt(p.blockers.length)) *
        Math.sqrt(shedPower(p, world.byId[p.blockers[0]]) / avgBlockPower(world, p.blockers, p));
  }
}

// Power at the point of attack: strength × technique (ratings.js), and in
// dynasty the technique for what's happening: a run block is drive vs. run
// defense; in pass pro the rusher's move (his power / speed mix) meets the
// blocker's pass-block power / finesse.
const RUN_BLOCK_KINDS = new Set(["zoneBlock", "stalk", "kickout", "lead"]);
function matchup(b, d) {
  if (!b || !d) return { block: 1, shed: 1 };
  if (RUN_BLOCK_KINDS.has(b.assignment.kind)) return { block: b.traits.runBlock ?? 1, shed: d.traits.runDef ?? 1 };
  const s = d.traits.rushStyle ?? 0.5;
  return {
    block: (b.traits.pbPower ?? 1) * s + (b.traits.pbFinesse ?? 1) * (1 - s),
    shed: (d.traits.rushPower ?? 1) * s + (d.traits.rushSpeed ?? 1) * (1 - s),
  };
}
const blockPower = (b, d) => b.traits.strength * b.traits.block * matchup(b, d).block;
const shedPower = (d, b) => d.traits.strength * d.traits.shed * matchup(b, d).shed;
function avgBlockPower(world, ids, d) {
  let s = 0;
  for (const id of ids) s += blockPower(world.byId[id], d);
  return ids.length ? s / ids.length : 1;
}

// ── Hands inside on a drive block. A defender locked up by a run blocker
// can't just slide down the line: his sideways speed *relative to the
// blocker* is limited (more so against a double team). The blocker keeps
// him only by mirroring — if the blocker stops following him, or turns his
// shoulders, the defender gets to his edge and off the block. ──
const RUN_BLOCKS = new Set(["zoneBlock", "stalk", "kickout", "lead"]);

export function constrainEngaged(world, dt) {
  const lim = TUNING.block.runLateralSlide;
  for (const b of world.players) {
    if (!b.engagedWith || !(RUN_BLOCKS.has(b.assignment.kind))) continue;
    const d = world.byId[b.engagedWith];
    if (!d || d.hasBall) continue;
    const fx = Math.cos(b.facing);
    const fy = Math.sin(b.facing);
    const rvx = d.vx - b.vx;
    const rvy = d.vy - b.vy;
    const lat = -rvx * fy + rvy * fx; // sideways across the blocker's chest
    const max = (lim / d.blockers.length) * (shedPower(d, b) / blockPower(b, d));
    if (Math.abs(lat) <= max) continue;
    const excess = lat - Math.sign(lat) * max;
    d.vx -= -fy * excess;
    d.vy -= fx * excess;
    d.x -= -fy * excess * dt;
    d.y -= fx * excess * dt;
  }
}

// Mass for contact resolution: an engaged blocker squared up to the player
// he's pushing against is anchored.
function massOf(p, other) {
  let m = 1;
  if (p.engagedWith === other.id && Math.abs(angDiff(angleTo(p.x, p.y, other.x, other.y), p.facing)) < 1.05)
    m += TUNING.block.anchorMass * p.traits.block; // anchored: technique
  return m * p.traits.strength;
}

export function resolveCollisions(world) {
  const R2 = TUNING.body.radius * 2;
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      // Teammates pass through each other — except a ball carrier and his
      // own linemen, whose bodies make the holes (he squeezes past them more
      // tightly than he can through a defender).
      if (a.team === b.team) {
        const carrierAndLine = (a.hasBall && b.role === "OL") || (b.hasBall && a.role === "OL");
        if (!carrierAndLine) continue;
      }
      const r2 = a.team === b.team ? R2 * 0.75 : R2;
      if (d >= r2 || d < 1e-6) continue;
      const nx = dx / d;
      const ny = dy / d;
      const ma = massOf(a, b);
      const mb = massOf(b, a);
      const overlap = r2 - d;
      a.x -= nx * overlap * (mb / (ma + mb));
      a.y -= ny * overlap * (mb / (ma + mb));
      b.x += nx * overlap * (ma / (ma + mb));
      b.y += ny * overlap * (ma / (ma + mb));
      // Inelastic along the contact normal: momentum is shared, not reflected.
      const va = a.vx * nx + a.vy * ny;
      const vb = b.vx * nx + b.vy * ny;
      if (va - vb > 0) {
        const vc = (ma * va + mb * vb) / (ma + mb);
        a.vx += (vc - va) * nx;
        a.vy += (vc - va) * ny;
        b.vx += (vc - vb) * nx;
        b.vy += (vc - vb) * ny;
      }
    }
  }
}
