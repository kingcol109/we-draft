// src/sim/dynasty/traits.js
// ── Ratings → what the sim plays with. The engine works in trait
// multipliers (1.0 = the baseline athlete TUNING describes; see
// ratings.js). This turns a rostered player's 1–99 ratings, height and
// weight into those multipliers, for the spot he's playing this snap.
//
// Physical traits are absolute — a 90 in long speed is the same top speed
// at any position:
//   long speed → top speed · explosiveness (+ short-area quickness) →
//   acceleration · change of direction (+ SAQ) → turn rate and lateral
//   force · strength × body weight → power in every collision and block
//
// Skills scale the position's archetype (a guard's hands stay a guard's
// hands), 1.0 at the position's average-starter rating:
//   instincts → reaction, recognition, vision · hands, contact balance,
//   contested catch, ball tracking, route running (short / intermediate /
//   deep) · pass-block power / finesse, drive, hand use · speed / power
//   rush, run defense · zone instincts / man technique (baked in for the
//   coverage he's playing) · angle tackling, tackling technique ·
//   QB arm strength and accuracy by distance, throw on the run. ──

import { ratingsFor } from "../ratings.js";
import { starterMean } from "./attributes.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Skill multiplier: 1.0 at the position's starter mean, ±k per 10 points.
function skill(pos, ratings, key, k) {
  const r = ratings[key];
  if (r == null) return 1;
  return clamp(1 + (k * (r - starterMean(pos, key))) / 10, 0.45, 1.6);
}

// Which roster position's scale to read a rating against when a player
// fills a sim slot (a TE playing H, an EDGE at 3-4 OLB).
export function traitsFor(player, slot) {
  const pos = player.pos;
  const R = player.ratings;
  const base = ratingsFor(slot.position);
  const cover = slot.assignment && slot.assignment.cover ? slot.assignment.cover.type : null;

  // ── Physical (league-wide scale).
  const long = R.longSpeed ?? 70;
  const expl = R.explosiveness ?? 70;
  const cod = R.cod ?? 70;
  const saq = R.saq ?? 70;
  const str = R.strength ?? 70;
  const speed = 0.5 + (0.63 * long) / 100;
  const accel = 0.5 + (0.65 * (0.75 * expl + 0.25 * saq)) / 100;
  const agility = 0.45 + (0.7 * (0.6 * cod + 0.4 * saq)) / 100;
  const strength = Math.pow((player.weight || 230) / 230, 0.6) * (0.7 + (0.6 * str) / 100);

  // ── Mental.
  const inst = skill(pos, R, "instincts", 0.1);
  const quick = skill(pos, R, "saq", 0.05);
  let reaction = clamp(0.5 * inst + 0.5 * quick, 0.6, 1.4);
  let recognition = base.recognition * inst;
  const vision = base.vision * clamp(1 + (inst - 1) * 0.4, 0.8, 1.2);

  const t = {
    speed, accel, agility, strength,
    reaction, recognition, vision,
    block: base.block,
    shed: base.shed,
    tackling: base.tackling * skill(pos, R, "tackling", 0.09),
    hands: base.hands,
    height: player.height || 73,
    weight: player.weight || 230,
  };

  // ── Ball carriers and receivers.
  if (R.hands != null) {
    t.hands = base.hands * skill(pos, R, "hands", 0.06);
    t.balance = skill(pos, R, "contactBalance", 0.1);
    t.contested = skill(pos, R, "contestedCatch", 0.12);
    t.tracking = skill(pos, R, "ballTracking", 0.12);
    t.route = {
      short: skill(pos, R, "routeShort", 0.08),
      mid: skill(pos, R, "routeMid", 0.08),
      deep: skill(pos, R, "routeDeep", 0.08),
    };
  } else {
    t.balance = clamp(0.85 + 0.15 * (strength / 1.2), 0.8, 1.1); // linemen, QBs: mass is their balance
  }

  // ── QB.
  if (R.armStrength != null) {
    t.arm = skill(pos, R, "armStrength", 0.05);
    t.acc = { short: R.accShort / 100, mid: R.accMid / 100, deep: R.accDeep / 100 };
    t.onRun = R.throwOnRun / 100;
  }

  // ── Offensive line: technique multipliers by what he's doing.
  if (R.passBlockPower != null) {
    t.block = base.block * skill(pos, R, "handUse", 0.06);
    t.pbPower = skill(pos, R, "passBlockPower", 0.1);
    t.pbFinesse = skill(pos, R, "passBlockFinesse", 0.1);
    t.runBlock = skill(pos, R, "runBlock", 0.1);
  }

  // ── Pass rushers / run defenders.
  if (R.speedRush != null) {
    t.shed = base.shed * skill(pos, R, "handUse", 0.06);
    t.rushSpeed = skill(pos, R, "speedRush", 0.1);
    t.rushPower = skill(pos, R, "powerRush", 0.1);
    t.runDef = skill(pos, R, "runDefense", 0.1);
    // His go-to move: share of power vs. speed in how he rushes.
    t.rushStyle = clamp(R.powerRush / Math.max(1, R.powerRush + R.speedRush), 0.25, 0.75);
  }

  // ── Coverage: the technique for the call he's in this snap.
  if (R.zone != null) {
    t.zone = skill(pos, R, "zone", 0.1);
    t.man = skill(pos, R, "man", 0.1);
    if (cover === "zone") {
      recognition *= t.zone; // reading the QB, passing off routes
      reaction = clamp(reaction * (0.6 + 0.4 * t.zone), 0.6, 1.45);
    }
    t.hands = base.hands * clamp(1 + ((cover === "man" ? t.man : t.zone) - 1) * 0.5, 0.8, 1.2);
    // Linebackers and safeties take on blocks with strength + instincts.
    t.shed = base.shed * clamp(1 + (inst - 1) * 0.5, 0.85, 1.15);
  }

  // ── Every defender.
  if (R.angleTackling != null) t.angle = skill(pos, R, "angleTackling", 0.12);

  t.reaction = reaction;
  t.recognition = recognition;
  return t;
}

// QB placement error (yd, 1 SD) for a throw of `dist` yards: short accuracy
// under 10 yards, intermediate 10–20, deep beyond, blended across the
// edges; on the move it grows unless he throws well on the run.
export function throwScatter(qbTraits, dist, qbSpeed) {
  const a = qbTraits.acc;
  if (!a) return 0;
  const band = (acc, base, k) => base + k * Math.pow(1 - clamp(acc, 0, 1), 1.3);
  const s = band(a.short, 0.12, 1.1);
  const m = band(a.mid, 0.22, 1.9);
  const d = band(a.deep, 0.35, 3.0);
  let sd;
  if (dist <= 8) sd = s;
  else if (dist <= 12) sd = s + ((m - s) * (dist - 8)) / 4;
  else if (dist <= 18) sd = m;
  else if (dist <= 24) sd = m + ((d - m) * (dist - 18)) / 6;
  else sd = d * (1 + 0.02 * (dist - 24));
  const moving = clamp((qbSpeed - 1.5) / 5, 0, 1);
  sd *= 1 + moving * 1.2 * (1.1 - (qbTraits.onRun ?? 0.7));
  return sd;
}
