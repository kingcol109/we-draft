// src/sim/variance.js
// ── Rep-to-rep variance ("form"). Off = vanilla: every trait is exactly
// 1.0, so a play runs the same way every time while you're drawing it up.
// On, each player gets his own draw every rep from a normal distribution:
// mostly around average, sometimes a step slow or a step quick, and now and
// then exceptional either way. One overall "form" number moves all of his
// traits together (a guy who's sharp today is sharp at everything), with
// individual noise on top — so a DL can fire off the ball and still lose
// the hand fight.
//
// It spreads each player around his position ratings (ratings.js) — a
// sharp corner is still a corner. Nothing here decides an outcome: it only
// changes the inputs the systems already use (get-off, decision time, read speed, acceleration, strength
// in a block, hands, tackling) and how precisely a player finds his spot. ──

import { clamp, mulberry32 } from "./math.js";

// Spread (1 SD) of each trait around 1.0.
const SD = {
  reaction: 0.2, // get-off at the snap, time to change his mind
  block: 0.1,
  shed: 0.1,
  recognition: 0.18, // reading run/pass, the QB's eyes, picking up the ball
  accel: 0.08,
  speed: 0.035,
  agility: 0.06,
  strength: 0.14, // who wins at the point of attack
  hands: 0.07,
  tackling: 0.1,
  vision: 0.06,
};
const SHARED = 0.7; // how much of each trait comes from his overall form

function gauss(rng) {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function rollForm(players, seed, enabled) {
  if (!enabled) {
    for (const p of players) {
      p.traits = { ...p.ratings };
      p.form = null;
    }
    return;
  }
  // Its own random stream: turning variance on never changes anything else
  // about a seed (read-end call, ball noise...).
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const own = Math.sqrt(1 - SHARED * SHARED);
  for (const p of players) {
    const z = clamp(gauss(rng), -3, 3);
    const t = { ...p.ratings };
    for (const [k, sd] of Object.entries(SD)) {
      const zi = SHARED * z + own * gauss(rng);
      t[k] = p.ratings[k] * clamp(1 + sd * zi, 1 - 3 * sd, 1 + 3 * sd);
    }
    // Your QB and runner stay vanilla physically, so the controls feel the
    // same every rep (and the mesh timing holds).
    const yours = p.role === "QB" || p.role === "RB";
    if (yours) for (const k of ["speed", "accel", "agility"]) t[k] = p.ratings[k];
    p.traits = t;
    // How precisely he finds his landmark (zone drop spot, gap): a sloppy
    // day misses by more.
      const miss = 0.7 * (1 + Math.max(0, -z) * 0.6);
    p.form = {
      z,
      landmark: { x: gauss(rng) * miss, y: gauss(rng) * miss * 0.8 },
      // Offense knows the count, but a slow one is late off the ball.
      getOff: p.team === "O" && !yours ? Math.max(0, (1 - t.reaction) * 0.35) : 0,
      angle: p.team === "D" ? rollAngle(rng, z, p.ratings.angle ?? 1) : null,
    };
  }
}

// Pursuit angles: almost always right. Now and then a defender blows his
// leverage for the rep — overruns the ball (gives up the cutback inside) or
// takes it too flat (gives up the edge outside). Sloppier days miss more
// often; a sharp one hardly ever does.
function rollAngle(rng, z, skill = 1) {
  // Angle tackling (dynasty) makes a blown angle rarer or more common.
  const pMiss = clamp(clamp(0.1 - 0.05 * z, 0.02, 0.25) / (skill * skill), 0.005, 0.4);
  if (rng() >= pMiss) return null;
  const over = rng() < 0.5;
  const k = rng();
  return over
    ? { kind: "over", lead: 1.3 + 0.35 * k, label: "overruns his angle — gives up the cutback inside" }
    : { kind: "under", lead: 0.65 - 0.2 * k, label: "takes it too flat — gives up the edge" };
}

// Short label for the debug panel.
export function formLabel(p) {
  if (!p.form) return "";
  const z = p.form.z;
  const tag = z > 1.8 ? "exceptional" : z > 0.8 ? "sharp" : z < -1.8 ? "way off" : z < -0.8 ? "sluggish" : "average";
  return `${tag} (${z >= 0 ? "+" : ""}${z.toFixed(1)}σ)${p.form.angle ? ` · ${p.form.angle.label}` : ""}`;
}
