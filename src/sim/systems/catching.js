// src/sim/systems/catching.js
// ── Catch resolution. There is no "the ball hit the receiver's pixel" — a
// player gets a chance when the ball passes within his catch region, and
// the quality of that chance is physical:
//
//   distance from body · ball speed · ball height · which way the ball comes
//   from relative to the chest · whether he's actually tracking it (seen +
//   acquired) · how close an opponent is at arrival
//
// When several players are in the region, whoever the ball reaches first
// gets the first touch. A defender plays the ball — intercept or knock it
// down — and a receiver fighting a defender at the catch point is contested. ──

import { TUNING } from "../config.js";
import { angDiff, clamp } from "../math.js";

function quality(p, b, d, reach, tracking, now) {
  const C = TUNING.catch;
  // Hands need a moment to get up after he's picked the ball up — a bullet
  // that's on him before they are is a hard catch.
  const acq = p.perception.ball.acquiredAt;
  const fReady = tracking && acq != null ? clamp((now - acq) / C.handsReady, C.minReady, 1) : 1;
  const speed = Math.hypot(b.vx, b.vy);
  const from = Math.atan2(-b.vy, -b.vx); // direction the ball arrives from
  const faceAlign = Math.cos(angDiff(from, p.facing)); // +1 = arriving in front of him
  const fDist = 1 - 0.45 * clamp((d - 0.3) / Math.max(0.01, reach - 0.3), 0, 1);
  const fOrient = tracking ? 0.55 + 0.45 * clamp((faceAlign + 0.3) / 1.3, 0, 1) : 0.25;
  const fSpeed = speed > 28 ? 0.85 : 1;
  const fHeight = b.z > 2.5 ? 0.75 : b.z < 0.5 ? 0.7 : 1;
  return {
    q: C.base * p.traits.hands * fDist * fOrient * fSpeed * fHeight * fReady,
    parts: { fDist, fOrient, fSpeed, fHeight, fReady },
  };
}

function nearestDefender(world, p) {
  let best = null;
  for (const d of world.defense) {
    const dd = Math.hypot(d.x - p.x, d.y - p.y);
    if (!best || dd < best.d) best = { id: d.id, d: dd };
  }
  return best ? best.id : null;
}

export function resolveCatch(world) {
  const b = world.ball;
  if (b.state !== "air") return null;
  const C = TUNING.catch;
  if (b.z > C.maxHeight || b.z < C.minHeight) return null;
  // A touch / lofted ball isn't catchable until it comes down where it was
  // thrown (ball.js catchWindow) — it's over everyone's heads till then.
  if (b.catchFrom != null && world.t < b.catchFrom) return null;

  const cands = [];
  for (const p of world.players) {
    if (p.attempted || p.id === "QB") continue;
    const bk = p.perception.ball;
    const tracking = bk.acquired && bk.seeing;
    // A taller man (longer arms) gets a little more catch radius.
    const tall = 1 + 0.012 * clamp((p.traits.height ?? 73) - 73, -6, 8);
    const reach = (tracking ? C.reachTracking : C.reachUntracked) * tall;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d > reach) continue;
    // Not tracking it: only a ball that actually hits his body counts.
    if (!tracking && b.z > 1.9) continue;
    // A player tracking the ball lets it come in to his body and down to his
    // hands — he plays it at its closest point, not the moment it's in reach.
    if (tracking) {
      const dt = world.dt;
      const nz = b.z + b.vz * dt;
      const dn = Math.hypot(b.x + b.vx * dt - (p.x + p.vx * dt), b.y + b.vy * dt - (p.y + p.vy * dt));
      const stillComing = dn < d - 0.005 && nz > 0.3;
      const tooHigh = b.z > 2.2 && dn <= reach && nz > 0.3;
      if (stillComing || tooHigh) continue;
    }
    cands.push({ p, d, reach, tracking });
  }
  if (!cands.length) return null;

  const hs = Math.hypot(b.vx, b.vy) || 1;
  const ux = b.vx / hs;
  const uy = b.vy / hs;
  for (const c of cands) c.along = (c.p.x - b.x) * ux + (c.p.y - b.y) * uy;
  cands.sort((a, z) => a.along - z.along);

  for (const c of cands) {
    const p = c.p;
    p.attempted = true;
    const { q, parts } = quality(p, b, c.d, c.reach, c.tracking, world.t);
    const r = world.rng();
    const detail = `q ${Math.round(q * 100)}% (dist ${parts.fDist.toFixed(2)}, orient ${parts.fOrient.toFixed(2)}${
      parts.fHeight < 1 ? `, height ${b.z.toFixed(1)} yd` : ""
    }${parts.fSpeed < 1 ? ", hot ball" : ""}${parts.fReady < 1 ? `, hands not ready ${parts.fReady.toFixed(2)}` : ""}${c.tracking ? "" : ", not tracking"})`;

    // Who the ball reached first matters for the story: did the defender
    // beat the receiver there?
    const firstTouch = c === cands[0];
    if (p.team === "D") {
      if (r < q * C.interceptFactor) return { type: "INTERCEPTION", player: p, detail, why: firstTouch ? "undercut" : "coverage" };
      if (r < q * C.deflectFactor) return { type: "INCOMPLETE", player: p, detail: `Broken up by ${p.id} — ${detail}`, why: "brokenUp" };
      world.log(p, "Missed the ball", detail);
      continue;
    }
    if (p.role === "OL" || !c.tracking) {
      // Ineligible, or never saw it coming: the ball just hits him.
      if (r < 0.5)
        return { type: "INCOMPLETE", player: p, detail: `Deflected off ${p.id} — ${detail}`, why: p.role === "OL" ? "batted" : "neverSaw" };
      continue;
    }
    // Offense: contested by the nearest defender at arrival.
    let dn = Infinity;
    let dm = null;
    for (const o of world.defense) {
      const dd = Math.hypot(o.x - p.x, o.y - p.y);
      if (dd < dn) {
        dn = dd;
        dm = o;
      }
    }
    // Contested catch skill and the height matchup at the catch point.
    const hGap = dm ? (p.traits.height ?? 73) - (dm.traits.height ?? 73) : 0;
    const penalty = (C.contestPenalty * clamp(1 - 0.05 * hGap, 0.7, 1.3)) / (p.traits.contested ?? 1);
    const contest = 1 - clamp(penalty, 0, 0.9) * clamp((1.8 - dn) / 1.2, 0, 1);
    const qc = q * contest;
    const cd = `${detail}${contest < 1 ? `, contested ×${contest.toFixed(2)} (DB ${dn.toFixed(1)} yd)` : ""}`;
    const nearD = contest < 0.9 ? nearestDefender(world, p) : null;
    if (r < qc) return { type: "CATCH", player: p, detail: cd, q, contested: contest < 0.9, defender: nearD };
    // Why it was dropped: a catchable ball on him (the throw was right), a
    // ball his hands weren't ready for, or a fight at the catch point.
    const why = contest < 0.85 ? "contested" : parts.fReady < 0.8 ? "hot" : q >= 0.6 ? "goodThrow" : "tough";
    return { type: "INCOMPLETE", player: p, detail: `Dropped by ${p.id} — ${cd}`, why: `drop:${why}`, defender: nearD };
  }
  return null;
}
