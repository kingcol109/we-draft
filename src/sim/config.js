// src/sim/config.js
// ── Every tunable number in the football sim lives here. Units are yards,
// seconds and radians throughout (the field itself is laid out in yards —
// see field.js — so a 5-yard hitch really is 5 units of simulation distance).
//
// Nothing in here is a player *rating*. Every player shares these baselines;
// player.js's `traits` object is the single hook future ratings will
// multiply through (physOf / reaction helpers), so none of the systems
// below need to change when ratings arrive. ──

export const DEG = Math.PI / 180;

export const TUNING = {
  // Fixed simulation step. The page runs as many of these per animation
  // frame as real time (x slow-mo factor) calls for.
  dt: 1 / 60,

  // Player body. `width` is the broad shoulder edge (the FRONT of the
  // player), `depth` is chest-to-back. `radius` is the collision circle.
  body: { width: 0.85, depth: 0.44, front: 0.24, radius: 0.36 },

  move: {
    topSpeed: 8.8, // yd/s (~18 mph) — same for everyone
    accel: 6.8, // propulsive yd/s² from a standstill, running forward
    accelFalloff: 0.8, // accel shrinks as speed approaches top speed
    brake: 11.5, // yd/s² a player can shed by planting
    lateralAccel: 10.5, // yd/s² of sideways (centripetal) force — turning radius at speed

    // Change of direction: the speed a player can carry through a turn of
    // θ radians is top * ((1+cos θ)/2)^cornerExp — 15°≈98%, 45°≈81%,
    // 90°≈41%, 120°≈16%, 180°≈0 (full stop, then re-accelerate).
    cornerExp: 1.3,
    minCornerSpeed: 1.4, // speed at which any turn is "free" (you can pivot)

    // Moving in a direction the chest isn't facing.
    lateralFactor: 0.66, // shuffle — top-speed fraction at 90° off facing
    backpedalFactor: 0.62, // backpedal — top-speed fraction at 180° off facing
    lateralAccelFactor: 0.7,
    backAccelFactor: 0.6,

    // How fast the body (and so vision) can rotate. Standing still you can
    // spin quickly; at full speed you can't whip your shoulders around.
    turnRateStill: 9.5, // rad/s
    turnRateFull: 3.4, // rad/s

    engagedSpeedCap: 2.3, // a defender tied up with a blocker
    blockerSpeedCap: 2.8, // a blocker locked onto a defender
    stunSpeedFactor: 0.35, // after a missed tackle / whiff
  },

  vision: {
    fov: 190 * DEG, // total cone, measured from the front (broad) edge
    focus: 60 * DEG, // central cone where perception is full-strength
    peripheralMin: 0.25, // perception strength at the very edge of the cone
    range: 50,
    clearRange: 18, // full-strength out to here, then fades
    farFactor: 0.55, // strength at max range
    occluderRadius: 0.42, // a body blocks sight lines passing this close to it
    occludedFactor: 0.1, // what survives an occluded sight line
    occluderHeight: 2.2, // bodies don't hide a ball above this height
    contactSense: 3.0, // you can *feel* someone this close even if unseen
  },

  react: {
    snap: 0.1, // defenders see the ball move, then go
    decision: 0.16, // time a new intent must stay preferred before committing
    urgentDecision: 0.08, // ... for "the ball is in the air" type decisions
    ballRecognition: 0.16, // continuous watch time needed to acquire a thrown ball
    velocityLag: 0.13, // how long it takes to register another player's change of velocity
    positionRate: 22, // how quickly a seen player's position registers
    memoryDecay: 1.2, // confidence half-life-ish for players you can't see
    hysteresis: 0.12, // score bonus the current intent gets over challengers
    readEndCommit: 0.7, // an unblocked end stays in his sit/crash this long after the mesh declares
  },

  belief: {
    runPassGain: 2.4, // logit per second per unit of run/pass evidence
    maxLogit: 5,
    attentionRise: 0.24, // s — how fast QB eyes build a defender's attention
    attentionFall: 0.65, // s — how slowly it fades once the eyes leave
    eyeWidth: 8 * DEG, // how precisely QB eyes pick out one receiver
    windupBoost: 1.5, // a visible wind-up (held throw) sharpens the read
  },

  ball: {
    gravity: 10.72, // yd/s² (32.17 ft/s²)
    releaseHeight: 2.0,
    catchHeight: 1.4, // throws are aimed to arrive at chest height
    minSpeed: 6,
    maxSpeed: 34, // yd/s (~70 mph)
    fullArcHold: 1.1, // seconds of mouse hold that produce the softest, loftiest throw
    bulletFraction: 1.0, // a quick tap leaves at this share of his top arm speed
    shortSpeed: 15, // yd/s + speedPerYard × distance = the hardest he'll throw at that distance
    speedPerYard: 0.6,
    minAngle: 6 * DEG, // (throw-meter label only)
    maxAngle: 30 * DEG, // long hold — the arc of the softest ball
    inherit: 0.85, // share of the QB's own velocity the ball keeps
    snapTime: 0.32,
    predictionNoise: 2.4, // yd of landing-point error before a player has watched the ball
    trackingTau: 0.35, // s of watching to cut that error by ~63%
  },

  catch: {
    reachTracking: 1.2, // hands-extended radius when tracking the ball
    reachUntracked: 0.55, // a ball that just hits your body
    maxHeight: 3.1, // jumping catch
    minHeight: 0.15,
    base: 0.93,
    interceptFactor: 0.45, // defenders play the ball, not the catch
    deflectFactor: 0.8, // chance a failed defender still gets a hand on it
    contestPenalty: 0.35, // a defender in the receiver's space at arrival
    handsReady: 0.25, // s after picking the ball up until the hands are fully ready
    minReady: 0.5, // catch quality at worst when the ball's on him instantly
  },

  tackle: {
    range: 0.95,
    diveRange: 1.6, // a trailing defender can lay out for the ankles from here
    diveBase: 0.3, // ...with this chance at the near edge, falling to zero at the far one
    base: 0.82,
    cooldown: 0.9,
    missStun: 0.45,
    engagedFactor: 0.2, // arm tackle while tied up with a blocker (rare — a blocked man mostly can't)
    carrierSlowOnMiss: 0.8,
    shedRange: 1.8, // a blocked defender can shed toward a carrier this close
    shedRate: 0.6, // per second
  },

  block: {
    engageDist: 1.05,
    releaseDist: 1.6,
    beatAngle: 72 * DEG, // defender past the blocker's shoulder = beaten
    runBeatAngle: 100 * DEG, // ... for a square run blocker: past the shoulder plane
    facingToEngage: 80 * DEG,
    anchorMass: 0.7, // an engaged, squared-up blocker is harder to move
    reengageDelay: 0.6,
    runLateralSlide: 1.2, // yd/s a defender can slide across a run blocker's chest
  },

  play: { endDelay: 2.4 },
  // Zone-read mesh (read plays only): the back gets to the mesh point `arrive` s after the
  // snap, then the QB rides the ball in his belly for `ride` s — the window
  // to read the end and pull — before it's a give.
  mesh: { arrive: 0.72, ride: 0.45 },
};

// ── Role priorities. These are what make an OL keep blocking while a pass
// is in the air, and a DB drop everything to go get it — not per-position
// `ignoreBall` flags. Every AI decision scores its options through these.
//   passInAir  — how much a thrown ball competes with this role's job
//   carrier    — how much pursuing a known ball carrier does
//   runCommit  — run belief needed before abandoning pass responsibilities
//                (DBs need to be much surer than DL — a wrong guess costs a TD)
export const ROLE_PROFILE = {
  QB: { passInAir: 0, carrier: 0, runCommit: 1 },
  RB: { passInAir: 1, carrier: 0, runCommit: 1 },
  WR: { passInAir: 1, carrier: 0, runCommit: 1 },
  OL: { passInAir: 0, carrier: 0, runCommit: 1 },
  DL: { passInAir: 0, carrier: 1, runCommit: 0.55 },
  LB: { passInAir: 0.8, carrier: 1, runCommit: 0.6 },
  CB: { passInAir: 1, carrier: 1, runCommit: 0.74 },
  S: { passInAir: 1, carrier: 1, runCommit: 0.72 },
};

// Eligible receivers defenders track QB eyes against.
export const ELIGIBLES = ["X", "H", "Y", "Z", "RB"];
