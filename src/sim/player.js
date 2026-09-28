// src/sim/player.js
// ── The player model. Deliberately plain data — every system reads and
// writes these fields, none of them own the player.
//
// `traits` is the ratings hook: every physical/mental baseline in
// config.js is multiplied through it (see physOf below and the uses of
// traits.* across the systems). `ratings` are his position's archetype
// (ratings.js); `traits` are what he plays with this rep — the ratings,
// or the ratings spread by variance (variance.js). ──

import { TUNING } from "./config.js";
import { ratingsFor, BASELINE_TRAITS } from "./ratings.js";

export { BASELINE_TRAITS };

export function freshBallKnowledge() {
  return {
    seeing: false,
    watch: 0, // accumulated (visibility-weighted) seconds watching the ball
    acquired: false,
    acquiredAt: null,
    throwCue: 0, // how well the QB's release was seen
    noise: { x: 0, y: 0 }, // initial misjudgment of where it'll land
    path: null, // this player's own predicted trajectory (absolute times)
  };
}

export function createPlayer(o) {
  return {
    id: o.id,
    team: o.team, // "O" | "D"
    position: o.position, // display position (DE, MLB, CB, WR, ...)
    role: o.role, // role family used for priorities (OL, DL, LB, CB, S, WR, RB, QB)
    label: o.label || o.id,
    x: o.x,
    y: o.y,
    vx: 0,
    vy: 0,
    facing: o.facing,
    gaze: null, // head direction when turned away from the chest (null = with the chest)
    home: { x: o.x, y: o.y },
    ratings: ratingsFor(o.position),
    traits: ratingsFor(o.position),

    assignment: o.assignment || {},
    intent: null, // committed { key, label, reason, ... }
    pending: null, // challenger intent waiting out the decision delay
    state: "set",
    desired: { dir: null, speed: 0, face: null },

    perception: { memory: {}, ball: freshBallKnowledge() },
    belief: { logit: 0, pRun: 0.5, attention: {}, stare: {}, threat: {}, carrierId: null, screen: 0, screenTarget: null },

    route: null,
    blockTarget: null,
    engagedWith: null, // blocker → defender id
    blockers: [], // defender ← blocker ids
    protectPoint: null, // what a blocker is keeping the defender off of
    shedToward: null, // ball carrier a blocked defender is fighting toward
    reengage: {},
    hasBall: false,
    attempted: false,
    stun: 0,
    tackleCooldown: 0,
    speedCap: Infinity,
    rushSide: 1,
    moveTimer: 0,
    debug: {},
  };
}

// Physical capabilities after traits. Every movement / time-to-reach
// calculation goes through here.
export function physOf(p) {
  const m = TUNING.move;
  const t = p.traits;
  // Route running (dynasty): a crisp route runner gets in and out of his
  // breaks harder while he's on the route.
  const rb = p.routeBoost || 1;
  return {
    top: m.topSpeed * t.speed,
    accel: m.accel * t.accel * rb,
    brake: m.brake * t.accel * rb,
    lateral: m.lateralAccel * t.agility * rb,
    turnStill: m.turnRateStill * t.agility * rb,
    turnFull: m.turnRateFull * t.agility * rb,
  };
}
