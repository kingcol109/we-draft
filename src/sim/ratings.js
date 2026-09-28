// src/sim/ratings.js
// ── Position ratings. Every trait is a multiplier on the shared baselines
// in config.js (1.0 = the league-average athlete those numbers describe),
// fed through the same hooks the systems already use:
//
//   speed        top speed (physOf)                     1.0 = 8.8 yd/s ≈ 18 mph
//   accel        explosiveness — burst from a standstill, closing speed
//   agility      change of direction — cornering, turn rate, lateral force
//   strength     body mass / power in any collision or block
//   block        technique as a blocker (hands, leverage, anchor)
//   shed         technique getting off a block (hands, rip / swim, extension)
//   tackling     finishing a tackle
//   hands        catching (and intercepting)
//   reaction     get-off, how fast he changes his mind
//   recognition  reading run / pass, the QB's eyes, finding the ball
//   vision       how well he sees the field
//
// A win at the point of attack is strength × technique on both sides:
// blocker strength·block against defender strength·shed (blocking.js).
//
// These are position archetypes, not individuals — variance (variance.js)
// spreads each rep around them. The offense is rated too: a DL's speed and
// strength only mean something against the men blocking and running at
// him. ──

export const BASELINE_TRAITS = {
  speed: 1,
  accel: 1,
  agility: 1,
  strength: 1,
  block: 1,
  shed: 1,
  tackling: 1,
  hands: 1,
  reaction: 1,
  recognition: 1,
  vision: 1,
};

// Only what differs from 1.0.
const POSITION = {
  // ── Defensive line: power and hands. The ends are the athletes (edge
  // speed, bend); the tackles are the strongest men on the field; the nose
  // is a two-gap anchor who doesn't run.
  DE: { speed: 0.95, accel: 1.04, agility: 0.9, strength: 1.2, shed: 1.12, tackling: 1.02, hands: 0.55, recognition: 0.98 },
  DT: { speed: 0.88, accel: 0.97, agility: 0.8, strength: 1.35, shed: 1.1, tackling: 0.98, hands: 0.5, recognition: 0.96 },
  NT: { speed: 0.84, accel: 0.9, agility: 0.76, strength: 1.45, shed: 1.05, tackling: 0.95, hands: 0.45, recognition: 0.95 },

  // ── Linebackers: the best tacklers, fast enough to run sideline to
  // sideline, strong enough to take on a guard. The 3-4 OLB is an edge
  // rusher; the Mike is the thumper and the best reader; the Will the
  // fastest, lightest of them.
  OLB: { speed: 0.98, accel: 1.05, agility: 0.95, strength: 1.12, shed: 1.08, tackling: 1.1, hands: 0.65 },
  MLB: { speed: 0.96, accel: 1.02, agility: 0.96, strength: 1.12, shed: 1.02, tackling: 1.16, hands: 0.72, recognition: 1.08 },
  ILB: { speed: 0.96, accel: 1.02, agility: 0.96, strength: 1.12, shed: 1.02, tackling: 1.15, hands: 0.72, recognition: 1.06 },
  SLB: { speed: 0.97, accel: 1.02, agility: 0.95, strength: 1.08, shed: 1.03, tackling: 1.12, hands: 0.7, recognition: 1.02 },
  WLB: { speed: 1.0, accel: 1.05, agility: 1.0, strength: 1.0, shed: 0.92, tackling: 1.1, hands: 0.75, recognition: 1.02 },

  // ── Defensive backs: the fastest, quickest men on the defense. Corners
  // are the best athletes in space (hips, recovery speed, ball skills) but
  // the weakest against a block; the strong safety is the box safety and a
  // real tackler; the free safety the rangier centerfielder.
  CB: { speed: 1.08, accel: 1.08, agility: 1.12, strength: 0.75, shed: 0.72, tackling: 0.9, hands: 0.85, recognition: 1.02 },
  NB: { speed: 1.07, accel: 1.09, agility: 1.12, strength: 0.78, shed: 0.75, tackling: 0.92, hands: 0.84, recognition: 1.03 }, // nickel: the slot corner
  FS: { speed: 1.05, accel: 1.04, agility: 1.04, strength: 0.84, shed: 0.78, tackling: 1.0, hands: 0.85, recognition: 1.08, vision: 1.05 },
  SS: { speed: 1.03, accel: 1.04, agility: 1.02, strength: 0.92, shed: 0.86, tackling: 1.08, hands: 0.8, recognition: 1.05 },

  // ── Offense.
  OL: { speed: 0.82, accel: 0.9, agility: 0.8, strength: 1.35, block: 1.15, tackling: 0.6, hands: 0.4 },
  QB: { speed: 0.95, accel: 0.96, agility: 0.94, strength: 0.85, block: 0.5, tackling: 0.5 },
  RB: { speed: 1.05, accel: 1.1, agility: 1.1, strength: 0.95, block: 0.85, tackling: 0.7, hands: 0.95 },
  FB: { speed: 0.94, accel: 0.98, agility: 0.88, strength: 1.12, block: 1.05, tackling: 0.75, hands: 0.9 },
  WR: { speed: 1.07, accel: 1.06, agility: 1.08, strength: 0.78, block: 0.8, tackling: 0.6, hands: 1.05 },
};

export function ratingsFor(position) {
  return { ...BASELINE_TRAITS, ...(POSITION[position] || {}) };
}
