// src/sim/throwFeedback.js
// ── The read on a throw, shared by the throw meter on the field (render.js,
// live while it's held), the engine (frozen at the release, with the
// placement filled in as the ball arrives) and the play-call recap
// (components/SimRecap.js). Plain data, no drawing.
//
//   type, u      — Bullet → Lofted, and the hold fraction (the power bar)
//   who          — the eligible his throw is going to (the man whose run takes
//                  him closest to the aim point)
//   place        — where it puts the ball vs. where he'll be when it gets there
//   window       — the nearest defender to the catch point at arrival
//   hot          — thrown harder than he can comfortably handle
//   across       — thrown across the body (a righty rolling right, throwing left)
//   pressure     — a defender in the QB's face at the release
// Each chip is { text, tone: good | ok | bad }. ──

import { solveThrow } from "./systems/ball.js";

// How much heat is on the QB right now: 0 (clean) → 1 (a man on him), from
// the nearest defender. Also used to scatter the throw (engine.throwBall).
export function pressureOn(engine) {
  const qb = engine.byId.QB;
  let d = Infinity;
  for (const p of engine.defense) d = Math.min(d, Math.hypot(p.x - qb.x, p.y - qb.y));
  return { d, k: Math.max(0, Math.min(1, (3.2 - d) / 2.2)) };
}

export function throwFeedback(engine, hold, aim) {
  const qb = engine.byId.QB;
  const th = solveThrow(qb, aim.x, aim.y, hold);
  const R = Math.hypot(aim.x - qb.x, aim.y - qb.y);
  const T = R / Math.max(1, th.speed * Math.cos(th.angle)); // flight time to the aim point
  let tgt = null;
  for (const p of engine.offense) {
    if (p.role !== "WR" && p.role !== "RB") continue;
    const px = p.x + p.vx * T;
    const py = p.y + p.vy * T;
    const d = Math.hypot(aim.x - px, aim.y - py);
    if (!tgt || d < tgt.d) tgt = { p, px, py, d };
  }
  let place = { text: "NOBODY THERE", tone: "bad" };
  let window = null;
  if (tgt && tgt.d < 8) {
    const p = tgt.p;
    const sp = Math.hypot(p.vx, p.vy);
    const ux = sp > 0.5 ? p.vx / sp : 0;
    const uy = sp > 0.5 ? p.vy / sp : 1;
    const ex = aim.x - tgt.px;
    const ey = aim.y - tgt.py;
    const along = ex * ux + ey * uy;
    const acrossRun = Math.abs(-ex * uy + ey * ux);
    if (th.short) place = { text: "SHORT — BEYOND HIS ARM", tone: "bad" };
    else if (tgt.d < 1.2) place = { text: sp > 2 ? "IN STRIDE" : "ON THE MONEY", tone: "good" };
    else if (along > 3 || (along > 1.2 && acrossRun < 2)) place = { text: along > 3 ? "OVERTHROWN" : "LEADING HIM", tone: along > 3 ? "bad" : "ok" };
    else if (along < -1.2) place = { text: "BEHIND HIM", tone: along < -3 ? "bad" : "ok" };
    else place = { text: acrossRun > 2.5 ? "OFF TARGET" : "CATCHABLE", tone: acrossRun > 2.5 ? "bad" : "ok" };
    let dn = Infinity;
    for (const d of engine.defense) dn = Math.min(dn, Math.hypot(d.x + d.vx * T - aim.x, d.y + d.vy * T - aim.y));
    window = dn > 3 ? { text: "OPEN", tone: "good" } : dn > 1.5 ? { text: "TIGHT WINDOW", tone: "ok" } : { text: "COVERED", tone: "bad" };
  }
  const press = pressureOn(engine);
  const chips = [
    place,
    window,
    Math.hypot(th.vx, th.vy) > 28 ? { text: "HOT BALL", tone: "ok" } : null,
    th.across > 0.25 ? { text: "ACROSS THE BODY", tone: th.across > 0.6 ? "bad" : "ok" } : null,
    press.k > 0.2 ? { text: press.k > 0.65 ? "HEAT IN HIS FACE" : "PRESSURE", tone: press.k > 0.65 ? "bad" : "ok" } : null,
  ].filter(Boolean);
  return { type: th.type.toUpperCase(), u: th.u, who: tgt && tgt.d < 8 ? tgt.p.id : null, chips };
}

// ── Where the ball got to him, in words (engine.trackPlacement's
// placement: lat + = the passer's left, i.e. the receiver's right; z off the
// ground; d = how far off his body; along = ahead / behind his run). ──
export function placementZone(pl) {
  if (pl.d > 1.6) return pl.along > 1 ? "Overthrown — out of reach" : pl.along < -1 ? "Behind him — out of reach" : "Out of his reach";
  const side = Math.abs(pl.lat) < 0.35 ? "" : pl.lat > 0 ? " — to his right" : " — to his left";
  if (pl.z > 2.25) return "High — over his head" + side;
  if (pl.z > 1.75) return "High — at his face" + side;
  if (pl.z > 1.1) return (Math.abs(pl.lat) < 0.35 ? "On the numbers" : "At his chest") + side;
  if (pl.z > 0.6) return "Low — at his waist" + side;
  return "Low — at his knees" + side;
}
