// src/sim/systems/tackling.js
// ── Tackles come from the physics of the contact, not from touching:
//   approach angle (squared up vs. reaching from the side/behind)
//   closing speed (running through him vs. chasing)
//   the carrier's momentum across the tackler's path (the juke factor)
//   whether the tackler is tied up with a blocker (arm tackle)
// A miss costs the defender (stumble + cooldown) and slows the carrier. ──

import { TUNING } from "../config.js";
import { angDiff, angleTo, clamp } from "../math.js";

export function resolveTackles(world) {
  const c = world.carrier();
  if (!c) return null;
  const T = TUNING.tackle;
  for (const d of world.players) {
    if (d.team === c.team || d.stun > 0 || d.tackleCooldown > world.t) continue;
    const dx = c.x - d.x;
    const dy = c.y - d.y;
    const dd = Math.hypot(dx, dy);
    if (dd > T.diveRange) continue;
    const nx = dx / dd;
    const ny = dy / dd;
    // Just out of reach and he can't close — the carrier is running away
    // from him and he isn't gaining — a free defender can lay out for the
    // ankles: a long shot, and he's on the ground if he misses. (One who's
    // closing just keeps coming and makes the real tackle.)
    if (dd > T.range) {
      const closing = (d.vx - c.vx) * nx + (d.vy - c.vy) * ny;
      const away = c.vx * nx + c.vy * ny > 2;
      if (d.blockers.length || !away || closing > 1 || closing < -1.5 || Math.hypot(d.vx, d.vy) < 3) continue;
      const pd = T.diveBase * d.traits.tackling * (1 - (dd - T.range) / (T.diveRange - T.range));
      const why = `diving at the ankles from ${dd.toFixed(1)} yd — p ${Math.round(pd * 100)}%`;
      if (world.rng() < pd) return { type: "TACKLE", by: d, carrier: c, detail: why };
      d.tackleCooldown = world.t + T.cooldown * 2;
      d.stun = T.missStun * 2.5;
      c.vx *= 0.92;
      c.vy *= 0.92;
      world.log(d, "Dove and missed", why);
      if (world.stats) world.stats.missed.push({ by: d.id, carrier: c.id, dive: true });
      continue;
    }

    const faceAlign = Math.cos(angDiff(angleTo(d.x, d.y, c.x, c.y), d.facing));
    const fFace = 0.3 + 0.7 * clamp((faceAlign + 0.2) / 1.2, 0, 1);
    const closing = (d.vx - c.vx) * nx + (d.vy - c.vy) * ny;
    const fClose = clamp(0.55 + closing * 0.08, 0.35, 1);
    // The juke: how fast he's moving across the tackler *relative to the
    // tackler* — a pursuer who took the right angle is running with him; a
    // carrier cutting across a man's face leaves him reaching.
    const lateral = Math.abs((c.vx - d.vx) * ny - (c.vy - d.vy) * nx);
    const fLat = clamp(1 - lateral * 0.05, 0.6, 1);
    const fBlock = d.blockers.length ? T.engagedFactor : 1;
    // Size matters a little: a corner squaring up a back vs. a backer.
    const fSize = clamp(Math.sqrt(d.traits.strength / c.traits.strength), 0.85, 1.15);
    // Contact balance (dynasty): a runner who stays up through contact.
    const fBal = 1 / (c.traits.balance ?? 1);
    const p = T.base * d.traits.tackling * fSize * fFace * fClose * fLat * fBlock * fBal;
    const why = `p ${Math.round(p * 100)}% — face ${fFace.toFixed(2)}, closing ${closing.toFixed(1)} yd/s, juke ${fLat.toFixed(
      2
    )}${fBlock < 1 ? ", arm tackle (blocked)" : ""}`;

    if (world.rng() < p) return { type: "TACKLE", by: d, carrier: c, detail: why };
    d.tackleCooldown = world.t + T.cooldown;
    d.stun = T.missStun;
    c.vx *= T.carrierSlowOnMiss;
    c.vy *= T.carrierSlowOnMiss;
    world.log(d, "Missed tackle", why);
    if (world.stats) world.stats.missed.push({ by: d.id, carrier: c.id, dive: false });
  }
  return null;
}
