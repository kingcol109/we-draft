// src/sim/engine.js
// ── The simulation loop. Pure JS, no DOM — the page drives it and draws it.
//
// Each fixed step runs the core loop for all 22 players:
//
//   PERCEPTION → BELIEF / ATTENTION → (blocking calls) → INTENT (decide)
//   → blocking engagement → MOVEMENT (physics) → contact → BALL
//   → outcomes (handoff, catch, tackle, sack, out of bounds, score)
//
// and the new positions/orientations feed the next step's perception.
//
// Play states:
//   pass: PRE_SNAP → SNAP → PLAY_DEVELOPMENT → BALL_IN_AIR →
//         (RUN_AFTER_CATCH →) PLAY_END [CATCH/INCOMPLETE/INTERCEPTION/SACK/…]
//   run:  PRE_SNAP → SNAP → RUN_DEVELOPMENT → PLAY_END [TACKLE/OUT_OF_BOUNDS/TOUCHDOWN]
// ──

import { TUNING } from "./config.js";
import { FIELD, LOS, CX, GAPS, goalLineY, inBounds, setLOS } from "./field.js";
import { mulberry32, clamp } from "./math.js";
import { rollForm, formLabel } from "./variance.js";
import { buildOffense, buildDefense, OFFENSE_PLAYS, playsideOf, coveragesFor, runStrength, TECH } from "./playbook.js";
import { freshBallKnowledge } from "./player.js";
import { updatePerception, visibility } from "./systems/perception.js";
import { updateBelief } from "./systems/belief.js";
import { integrate, steer } from "./systems/movement.js";
import { createBall, solveThrow, stepBall, predictPath, catchWindow, acrossBody } from "./systems/ball.js";
import { throwFeedback, pressureOn } from "./throwFeedback.js";
import { updateEngagements, constrainEngaged, resolveCollisions } from "./systems/blocking.js";
import { resolveCatch } from "./systems/catching.js";
import { resolveTackles } from "./systems/tackling.js";
import { thinkOffense, meshTrack } from "./ai/offense.js";
import { thinkDefender } from "./ai/defense.js";
import { hold } from "./ai/intent.js";
import { qbControl, carrierControl, startCut, startBurst } from "./ai/human.js";
import { assignPassPro, assignStalk } from "./ai/protection.js";
import { assignScreen } from "./ai/screens.js";
import { traitsFor, throwScatter } from "./dynasty/traits.js";
import { updateZone, buildZoneCall } from "./ai/zoneScheme.js";

const FAKE_END = 0.8; // s after the snap the play-action fake lasts
// What "juiced" (config.juice) multiplies for the favored team in a demo.
// A QB with no accuracy ratings (the lab's archetype): a solid starter.
const DEFAULT_QB_ACCURACY = { acc: { short: 0.8, mid: 0.72, deep: 0.62 }, onRun: 0.65 };
const JUICE = { strength: 1.2, block: 1.25, shed: 1.25, tackling: 1.25, reaction: 1.2, recognition: 1.2, accel: 1.06, speed: 1.04 };

export class SimEngine {
  constructor(config = {}) {
    this.config = { formation: "spreadWeak", play: "smash", front: "4-3", coverage: "tampa2", readEnd: "random", variance: false, ...config };
    this.fixFormation();
    this.autoReset = true;
    this.input = { keys: new Set(), mouse: { x: CX, y: LOS + 12 } };
    this.dt = TUNING.dt;
    this.reset();
  }

  setConfig(partial) {
    Object.assign(this.config, partial);
    this.fixFormation();
    this.reset();
  }

  // A play only runs from the formations it's drawn up for.
  fixFormation() {
    const allowed = OFFENSE_PLAYS[this.config.play].formations;
    if (!allowed.includes(this.config.formation)) this.config.formation = allowed[0];
    // ...and a front only has the calls it has.
    const calls = coveragesFor(this.config.front);
    if (!calls.includes(this.config.coverage)) this.config.coverage = calls[0];
  }

  // Throwing is live: a pass play, or an RPO the QB pulled.
  get passing() {
    return this.playType === "pass" || this.rpoPass;
  }

  get playType() {
    return OFFENSE_PLAYS[this.config.play].type;
  }

  get play() {
    return OFFENSE_PLAYS[this.config.play];
  }

  reset(seed) {
    // config.seed pins every rep to the same roll (Learn's demos replay
    // identically each loop).
    this.seed = seed ?? this.config.seed ?? (Math.random() * 1e9) >>> 0;
    this.rng = mulberry32(this.seed);
    // Where the ball is (a drive moves it; the lab plays from midfield).
    setLOS(this.config.ballOn ?? 60);
    this.lineToGain = this.config.lineToGain ?? LOS + 10;
    this.finished = false;
    this.offense = buildOffense(this.config.formation, this.config.play);
    // The front sets to the offense's run strength (playbook.js runStrength).
    this.strength = runStrength(this.config.formation);
    this.defense = buildDefense(this.config.front, this.config.coverage, this.strength);
    // Scripted run fits (Learn's demos): { [defenderId]: gap }, play-side
    // relative — "A-play", "C-back", "force-play", "alley-back" — so a
    // demo can set how the defense flows (everyone over the top for a
    // cutback, everyone inside for a bounce). Overrides the call's gap.
    if (this.config.fits) {
      const ps = playsideOf(this.config.formation);
      const side = (s) => s.replace("play", ps > 0 ? "R" : "L").replace("back", ps > 0 ? "L" : "R");
      for (const d of this.defense) {
        const f = this.config.fits[d.id];
        if (!f) continue;
        d.assignment.gap = side(f);
        d.assignment.gapX = GAPS[d.assignment.gap] != null ? CX + GAPS[d.assignment.gap] : undefined;
      }
    }
    this.players = [...this.offense, ...this.defense];
    this.byId = Object.fromEntries(this.players.map((p) => [p.id, p]));
    // Dynasty: rostered players in the slots — their ratings, not the
    // position archetype, are what everyone plays with.
    const lineup = this.config.lineup;
    if (lineup) {
      for (const p of this.players) {
        // (Rosters are slotted for the strength on the right; a mirrored
        // front wears the other side's name — DE-L is the strong end then.)
        const slot = p.team === "D" && this.strength < 0 ? p.id.replace(/-([LR])$/, (_, c) => (c === "L" ? "-R" : "-L")) : p.id;
        const rp = lineup[p.team] && lineup[p.team][slot];
        if (!rp) continue;
        p.info = { id: rp.id, first: rp.first, last: rp.last, number: rp.number, pos: rp.pos, ovr: rp.ovr, team: lineup.teams && lineup.teams[p.team] };
        p.ratings = traitsFor(rp, p);
      }
    }
    // Learn's demos are juiced toward the side of the ball being taught
    // (config.juice "O" | "D"): that team plays a level up — stronger at
    // the point of attack, quicker to read, surer to finish — so the demo
    // shows the concept working, not a coin flip.
    if (this.config.juice) {
      for (const p of this.players) {
        if (p.team !== this.config.juice) continue;
        const r = (p.ratings = { ...p.ratings });
        for (const [k, m] of Object.entries(JUICE)) r[k] = (r[k] ?? 1) * m;
      }
    }
    // Vanilla (every trait 1.0) unless rep-to-rep variance is switched on.
    rollForm(this.players, this.seed, this.config.variance);
    for (const p of this.players) p.moveTimer = 0;
    // A man defender whose man is in the backfield (H as a fullback) lines
    // up over him at linebacker depth instead of out on an empty slot.
    for (const p of this.defense) {
      const c = p.assignment.cover;
      if (c.type !== "man") continue;
      const man = this.byId[c.target];
      if (man.home.y - LOS < -2 && p.role === "LB" && c.target !== "RB") {
        p.x = p.home.x = man.home.x;
        p.y = p.home.y = LOS + 4.5;
      }
    }
    // Man-up safeties show 10 yards, then roll down pre-snap to 5 yards off
    // their man with inside leverage.
    for (const p of this.defense) {
      const c = p.assignment.cover;
      if (p.role !== "S" || c.type !== "man") continue;
      if (this.byId[c.target].home.y - LOS < -2) continue;
      const man = this.byId[c.target];
      const inside = -(Math.sign(man.home.x - CX) || 1);
      p.presnapSpot = { x: man.home.x + inside * 0.8, y: man.home.y + 5 };
    }
    // Mug: show linebacker depth, creep up into the gap.
    for (const p of this.defense) if (p.assignment.creep) p.presnapSpot = p.assignment.creep;
    // Cover 3: the strong safety shows 10, then rolls down to his curl-flat.
    for (const p of this.defense) {
      const c = p.assignment.cover;
      if (p.role === "S" && c.type === "zone" && c.zone === "curlFlat") p.presnapSpot = { x: p.home.x, y: LOS + 6.5 };
    }
    // Screen sense: a lineman rushing the passer only sometimes feels the
    // screen (the rest keep rushing); everyone else reads it normally.
    const sense = mulberry32((this.seed ^ 0x5c3e1d) >>> 0);
    for (const p of this.defense) p.screenSense = p.role === "DL" ? (sense() < 0.35 ? 1 : 0.12) : 1;
    // The defense's call for an unblocked end this rep: sit or crash.
    const tech = this.config.readEnd === "sit" || this.config.readEnd === "crash" ? this.config.readEnd : null;
    for (const p of this.defense) p.readTech = tech || (this.rng() < 0.5 ? "sit" : "crash");
    this.ball = createBall();
    this.ball.x = CX;
    this.ball.y = LOS;
    this.state = "PRE_SNAP";
    this.t = 0;
    this.snapAt = null;
    this.sinceSnap = 0;
    this.result = null;
    this.endAt = null;
    this.events = [];
    this.throwInfo = null;
    // What happened on the snap, for the post-play recap (see recap.js).
    this.stats = { missed: [], beatBlocks: [], cuts: 0, bursts: 0, catch: null, tackler: null, pressure: null };
    this.throwPath = null; // the thrown ball's flight, for the lit-up arc
    this.throwDoneAt = null;
    this.popups = []; // CAUGHT / INCOMPLETE / INTERCEPTED callouts
    this.throwCharging = false;
    this.chargeStart = null;
    this.qbKeep = false;
    this.handedOff = false;
    this.qbScramble = false;
    this.rpoPass = false; // an RPO pulled: the QB can throw it
    this.pitched = false; // speed option: the ball's been pitched
    this.nextAssign = 0;
    this.zone = null;
    this.zonePreview = null;
    this.readMade = false; // autopilot: the QB has made his read this rep
    // Play action: which way the run is faked (the boot goes the other way).
    this.fakeSide = OFFENSE_PLAYS[this.config.play].fake ? playsideOf(this.config.formation) : null;
  }

  // ── Autopilot (Learn mode's demos): nobody's at the controls, the play
  // runs itself. `this.autopilot = { run }` — run is how the back takes it
  // once he's pressed the play-side A gap: "read" (whatever the cleanest
  // lane is), or forced "bang" / "bend" / "bounce" to demonstrate one.
  // It drives the same inputs a person would — Space for the pull, the
  // mouse as the ball carrier's intent — so nothing plays differently. ──
  autopilotStep() {
    const ap = this.autopilot;
    if (!ap || this.state === "PRE_SNAP" || this.state === "PLAY_END" || this.playType !== "run") return;
    const ps = (this.zone && this.zone.ps) || 1;
    // The read: pull it if the end has come down the line after the back;
    // otherwise it's a give (the default — the QB just doesn't pull).
    // (ap.give: the demo is about the back, not the read — always hand off.)
    if (!this.readMade && !ap.give && this.canPull() && this.zone && this.zone.readId) {
      const e = this.byId[this.zone.readId];
      if (ps * (e.x - e.home.x) > 0.8 || ps * e.vx > 2.4) {
        this.readMade = true;
        this.log(this.byId.QB, "Read: the end crashed", "pull it");
        this.pull();
      } else if (this.sinceSnap >= this.giveAt()) this.readMade = true;
    }
    const c = this.carrier();
    if (!c || c.team !== "O" || this.meshing()) return;
    this.input.moveAccum = 1e9; // "the mouse has moved": no auto-run, he steers by intent
    let aim;
    if (c.id === "QB") {
      // Kept it: run where the end left — outside him, then up.
      aim = c.y < LOS ? { x: CX - 7 * ps, y: LOS + 3 } : { x: c.x - 1.5 * ps, y: c.y + 12 };
    } else {
      // He presses his aiming point first — inside zone: the play-side A
      // gap; outside zone: the outside leg of the tight end (or where he'd
      // be) — then:
      //   bang   — the aiming point is open: hit it, straight up
      //   bend   — plant and cut back behind the flow (inside zone: the
      //            backside A gap the defense left; outside zone: inside
      //            the aiming point), then up
      //   bounce — bend it flat outside the play-side tackle, then up
      //   read   — straight up, taking the cleanest lane he sees
      const wide = this.zone && this.zone.scheme === "outside";
      const A = CX + (wide ? TECH[7] : GAPS["A-R"]) * ps;
      const cut = CX + (wide ? 0.4 : -1.3) * ps; // where the bend goes
      const off = ps * (c.x - CX); // + = play side
      const run = ap.run || "read";
      const decided = c.y >= LOS - (wide ? 2.2 : 1.4); // (outside zone decides at the tackle's hip, earlier)
      if (run === "bounce" && c.y >= LOS - 2.4) aim = off < 5 ? { x: CX + 7.5 * ps, y: LOS + 0.3 } : { x: c.x + ps, y: c.y + 10 };
      else if (!decided) aim = { x: A, y: LOS + (wide ? 2 : 4) };
      else if (run === "bang") aim = { x: A, y: c.y + 10 };
      else if (run === "bend") aim = ps * (c.x - cut) > 0.4 && c.y < LOS + 1.5 ? { x: cut, y: LOS + 3 } : { x: c.x - 0.3 * ps, y: c.y + 10 };
      else aim = { x: c.x, y: c.y + 12 };
    }
    this.input.mouse = aim;
  }

  // The QB's automatic run fake on a play-action call, before he's yours.
  faking() {
    return !!this.fakeSide && this.state !== "PRE_SNAP" && this.sinceSnap < FAKE_END;
  }

  carrier() {
    return this.ball.carrierId ? this.byId[this.ball.carrierId] : null;
  }

  // Which player the human is driving right now (and whose eyes the view uses).
  controlledId() {
    const cid = this.ball.carrierId;
    // Whoever has the ball after a catch (a pass, or an RPO throw).
    if (cid && cid !== "QB" && this.byId[cid].team === "O" && (this.playType === "pass" || this.rpoPass || this.state === "RUN_AFTER_CATCH")) return cid;
    if (this.playType === "pass") return "QB";
    if (this.qbKeep || this.play.qbRun) return "QB"; // option / QB draw: the QB's from the snap
    return "RB";
  }

  // A callout on the field where something happened to the ball — a
  // headline and a short reason under it.
  popup(text, x, y, color, sub = "") {
    this.throwDoneAt = this.t; // every ball outcome calls this: the arc fades from here
    this.popups.push({ text, sub, x, y, color, t: this.t });
    if (this.popups.length > 6) this.popups.shift();
  }

  log(p, label, reason, prev) {
    this.events.push({ t: this.snapAt == null ? 0 : this.t - this.snapAt, id: p.id, team: p.team, label, reason, prev });
    if (this.events.length > 300) this.events.shift();
  }

  // ── Controls ──
  snap() {
    if (this.state !== "PRE_SNAP") return;
    this.state = "SNAP";
    this.snapAt = this.t;
    // A pinned seed: restart the roll at the snap, so the play doesn't
    // depend on how long it sat pre-snap (that's frame-rate dependent).
    if (this.config.seed != null) this.rng = mulberry32(this.seed);
    const qb = this.byId.QB;
    this.ball.state = "snap";
    this.ball.snap = { from: { x: CX, y: LOS }, to: { x: qb.x, y: qb.y }, t0: this.t };
    // Option / draw: the QB runs the play himself until you move the mouse.
    if (this.play.qbRun) this.input.moveAccum = 0;
    this.log(this.byId.C, "Snap", this.config.play);
  }

  // Pre-snap look at the blocking call (for the play art) — the same call the
  // line will make at the snap, from what they see of the alignment now.
  previewZoneCall() {
    if (this.playType !== "run" && !this.fakeSide) return null;
    if (!this.zonePreview) {
      for (const p of this.offense) updatePerception(p, this, 0);
      this.zonePreview = buildZoneCall(this, { silent: true });
    }
    return this.zonePreview;
  }

  // Is the human steering a runner (mouse intent) rather than a pocket QB?
  runnerControlled() {
    const id = this.controlledId();
    if (this.state === "PRE_SNAP" || this.state === "PLAY_END") return null;
    if (id === "QB" && this.passing && !this.qbScramble) return null;
    if (this.meshing()) return null; // no cuts until he has the ball
    return this.byId[id];
  }

  // Zone run, ball still with the QB, back on his way to the mesh.
  meshing() {
    return (this.playType === "run" && !this.play.qbRun && !this.handedOff && !this.qbKeep) || this.faking();
  }

  // W: burst downhill for the runner you control.
  burst() {
    const p = this.runnerControlled();
    if (p) startBurst(p, this);
  }

  // A / D: hard cut left / right for the runner you control.
  hardCut(side) {
    const p = this.runnerControlled();
    if (p) startCut(p, this, side);
  }

  // Space bar: snap pre-snap; during the zone-read ride, pull the ball.
  spaceAction() {
    if (this.state === "PRE_SNAP") return this.snap();
    if (this.canPitch()) return this.pitch();
    if (this.canPull()) this.pull();
  }

  canPull() {
    return !!OFFENSE_PLAYS[this.config.play].read && this.ball.carrierId === "QB" && !this.handedOff && !this.qbKeep;
  }

  // The read is yours: it's a give unless you pull it.
  pull() {
    if (!this.canPull()) return;
    const qb = this.byId.QB;
    const readId = this.zone && this.zone.readId;
    this.qbKeep = true;
    this.log(qb, "QB pulls it", readId ? `pulled on ${readId} — ${qb.intent ? qb.intent.reason : ""}` : "pulled");
    // RPO: pulled, he's a passer — throw the route or take it himself.
    if (OFFENSE_PLAYS[this.config.play].rpo) {
      this.rpoPass = true;
      this.state = "PLAY_DEVELOPMENT";
    }
  }

  // Whose eyes the view shows: the QB's while he's reading the mesh, else
  // whoever you're controlling.
  viewerId() {
    if (this.playType === "run" && !this.handedOff && !this.qbKeep) return "QB";
    return this.controlledId();
  }

  // Where the inside zone back takes the ball: across the QB's face, on the
  // line-of-scrimmage side of him.
  meshPoint() {
    const qb = this.byId.QB;
    const ps = this.zone ? this.zone.ps : this.fakeSide || 1;
    return { x: qb.x + 0.3 * ps, y: qb.y + 0.9 };
  }

  // When the ball is given on a zone run: after the back reaches the mesh,
  // plus the ride on a read play (nothing to read otherwise — just give it).
  giveAt() {
    return TUNING.mesh.arrive + (this.play.read ? this.play.ride ?? TUNING.mesh.ride : 0);
  }

  // ── Speed option: SPACE pitches to the back while the QB has it behind
  // (or just past) the line. A soft, flat toss led to where the back will
  // be; he has to see it and catch it like any other ball. ──
  canPitch() {
    const qb = this.byId.QB;
    return !!this.play.option && !this.pitched && this.ball.state === "held" && this.ball.carrierId === "QB" && this.state === "RUN_DEVELOPMENT" && qb.y < LOS + 1.5;
  }

  pitch() {
    if (!this.canPitch()) return;
    const qb = this.byId.QB;
    const rb = this.byId.RB;
    const B = TUNING.ball;
    const z0 = 1.1;
    let tx = rb.x;
    let ty = rb.y;
    let T = 0.4;
    for (let i = 0; i < 3; i++) {
      T = clamp(Math.hypot(tx - qb.x, ty - qb.y) / 9, 0.22, 0.8);
      tx = rb.x + rb.vx * T;
      ty = rb.y + rb.vy * T;
    }
    const b = this.ball;
    b.x = qb.x;
    b.y = qb.y;
    b.z = z0;
    b.vx = (tx - qb.x) / T;
    b.vy = (ty - qb.y) / T;
    b.vz = (B.catchHeight - z0 + 0.5 * B.gravity * T * T) / T;
    b.state = "air";
    b.carrierId = null;
    qb.hasBall = false;
    this.pitched = true;
    this.stats.pitch = { t: this.t, x: qb.x, y: qb.y, keyId: this.zone && this.zone.optionKeyId };
    this.throwInfo = {
      pitch: true, type: "Pitch", intended: "RB", at: this.t, from: { x: qb.x, y: qb.y },
      target: { x: tx, y: ty }, speed: Math.hypot(b.vx, b.vy), miss: {}, missVec: {}, scatter: 0,
    };
    this.catchMoment = null;
    this.throwPath = predictPath(b, this.t);
    for (const p of this.players) {
      if (p.id === "QB") continue;
      const bk = freshBallKnowledge();
      bk.throwCue = visibility(p, qb.x, qb.y, 1.8, this.players, "QB");
      bk.noise = { x: 0, y: 0 }; // a short toss: no misjudging where it's going
      p.perception.ball = bk;
    }
    const key = this.zone && this.zone.optionKeyId;
    this.log(qb, "Pitch", key ? `pitched off ${key}` : "pitched");
  }

  // A pitch nobody caught is a live ball — the offense falls on it where it
  // lands (a backward pass is a fumble, not an incompletion).
  loosePitch(why) {
    const b = this.ball;
    b.state = "ground";
    this.popup("LOOSE BALL", b.x, b.y, "#fde047", "pitch on the ground — offense recovers");
    return this.end("TACKLE", `Pitch on the ground — ${why}`, Math.min(b.y, goalLineY) - LOS);
  }

  // RPO, ball still in the mesh: a click pulls it and starts the throw.
  rpoRideThrow() {
    return !!this.play.rpo && this.state !== "PRE_SNAP" && this.canPull();
  }

  canThrow() {
    if (this.rpoRideThrow()) return true;
    const qb = this.byId.QB;
    return (
      this.passing &&
      this.state === "PLAY_DEVELOPMENT" &&
      !this.faking() &&
      qb.hasBall &&
      qb.y <= LOS &&
      this.controlledId() === "QB"
    );
  }

  beginThrow(nowMs) {
    if (!this.canThrow()) return;
    if (this.rpoRideThrow()) this.pull();
    this.throwCharging = true;
    this.chargeStart = nowMs;
  }

  chargeSeconds(nowMs) {
    return this.throwCharging ? (nowMs - this.chargeStart) / 1000 : 0;
  }

  releaseThrow(nowMs) {
    if (!this.throwCharging) return;
    const hold = this.chargeSeconds(nowMs);
    this.throwCharging = false;
    if (!this.canThrow()) return;
    this.throwBall(hold, this.input.mouse.x, this.input.mouse.y);
  }

  throwBall(hold, tx, ty) {
    const qb = this.byId.QB;
    // A rated QB doesn't put it exactly where you aimed: placement error by
    // distance (short / intermediate / deep accuracy), worse on the move
    // unless he throws well on the run.
    const aimX = tx;
    const aimY = ty;
    // (A QB with no accuracy ratings — the lab's archetype — throws like a
    // solid starter rather than a robot.) Across the body and pressure in
    // his face both spray it.
    const traits = qb.traits.acc ? qb.traits : { ...qb.traits, ...DEFAULT_QB_ACCURACY };
    const across = acrossBody(qb, tx - qb.x);
    const press = pressureOn(this);
    const sd =
      throwScatter(traits, Math.hypot(tx - qb.x, ty - qb.y), Math.hypot(qb.vx, qb.vy)) *
      (1 + 1.8 * across) *
      (1 + 2.2 * press.k);
    // The meter's read on the throw, frozen as it leaves his hand (what he
    // tried to do — the aim, before any of the spray).
    const feedback = throwFeedback(this, hold, { x: tx, y: ty });
    if (sd > 0) {
      const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, this.rng()))) * Math.cos(2 * Math.PI * this.rng());
      tx += g() * sd;
      ty += g() * sd;
    }
    const s = solveThrow(qb, tx, ty, hold);
    const b = this.ball;
    b.x = qb.x + Math.cos(qb.facing) * 0.3;
    b.y = qb.y + Math.sin(qb.facing) * 0.3;
    b.z = TUNING.ball.releaseHeight;
    b.vx = s.vx;
    b.vy = s.vy;
    b.vz = s.vz;
    b.state = "air";
    b.carrierId = null;
    qb.hasBall = false;
    // When it comes into reach: the arc decides (ball.js catchWindow).
    const flight = Math.hypot(tx - b.x, ty - b.y) / Math.max(1, s.speed * Math.cos(s.angle));
    b.catchFrom = this.t + flight - catchWindow(s.u);
    this.throwInfo = { ...s, hold, at: this.t, from: { x: qb.x, y: qb.y }, aim: { x: aimX, y: aimY }, scatter: sd };
    // Pressure at the release: the closest defender to the passer.
    let near = null;
    for (const d of this.defense) {
      const dd = Math.hypot(d.x - qb.x, d.y - qb.y);
      if (!near || dd < near.d) near = { id: d.id, d: dd };
    }
    this.stats.pressure = near;
    this.stats.qbSpeed = Math.hypot(qb.vx, qb.vy);
    // Who he was throwing to: the eligible nearest the spot he aimed at.
    let intended = null;
    for (const p of this.offense) {
      if (p.role !== "WR" && p.role !== "RB") continue;
      const d = Math.hypot(p.x - aimX, p.y - aimY);
      if (!intended || d < intended.d) intended = { id: p.id, d };
    }
    this.throwInfo.intended = intended ? intended.id : null;
    this.throwInfo.feedback = feedback;
    this.throwInfo.placement = null; // filled in as the ball gets to him (trackPlacement)
    // Where each eligible was headed at the release — carried forward to when
    // the ball comes down to his hands. How far the catch point is from that
    // is how good the throw was (on his path vs. he had to go get it).
    // Judged in time as well as space: the closest the ball comes to him, at
    // his hands, if he just keeps going the way he was.
    // Which way it's off matters too (see stride()): split the miss into
    // along his run (+ out in front, − behind him) and across it.
    this.throwInfo.miss = {};
    this.throwInfo.missVec = {};
    const path = predictPath(b, 0, 5, 0.02);
    for (const p of this.offense) {
      if (p.role !== "WR" && p.role !== "RB") continue;
      let best = Infinity;
      let off = null;
      for (const q of path) {
        if (q.z < 0.9 || q.z > 2.0) continue; // hands height: waist to over his head
        const dx = q.x - (p.x + p.vx * q.at);
        const dy = q.y - (p.y + p.vy * q.at);
        const d = Math.hypot(dx, dy);
        if (d < best) {
          best = d;
          off = { dx, dy };
        }
      }
      this.throwInfo.miss[p.id] = best;
      const sp = Math.hypot(p.vx, p.vy);
      if (off && sp > 1)
        this.throwInfo.missVec[p.id] = {
          along: (off.dx * p.vx + off.dy * p.vy) / sp,
          across: Math.abs(off.dx * p.vy - off.dy * p.vx) / sp,
        };
    }
    this.catchMoment = null;
    this.throwPath = predictPath(b, this.t);
    this.state = "BALL_IN_AIR";
    // How well did each player see the release? Receivers know the timing;
    // defenders only know it if they saw it. Everyone still has to *see the
    // ball* to acquire it, and their first read of it is off by a bit.
    for (const p of this.players) {
      if (p.id === "QB") continue;
      const bk = freshBallKnowledge();
      // Only a player who actually saw the release gets the head start.
      bk.throwCue = visibility(p, qb.x, qb.y, 1.8, this.players, "QB");
      const a = this.rng() * Math.PI * 2;
      const mag = TUNING.ball.predictionNoise * (0.4 + 0.6 * this.rng());
      bk.noise = { x: Math.cos(a) * mag, y: Math.sin(a) * mag };
      p.perception.ball = bk;
    }
    const R = Math.hypot(tx - qb.x, ty - qb.y);
    this.log(
      qb,
      `Throw — ${s.type}`,
      `${hold.toFixed(2)}s hold · ${s.speed.toFixed(1)} yd/s @ ${((s.angle * 180) / Math.PI).toFixed(0)}° · ${R.toFixed(
        1
      )} yd${s.short ? " · beyond the arm, will fall short" : ""}${s.bodyFactor < 0.98 ? " · across the body" : ""}`
    );
  }

  // ── Main step ──
  step(dt = TUNING.dt) {
    this.dt = dt;
    this.t += dt;

    if (this.state === "PRE_SNAP") {
      // The QB can already survey the defense with his eyes.
      const qb = this.byId.QB;
      if (this.playType === "pass") {
        qbControl(qb, { keys: new Set(), mouse: this.input.mouse });
        integrate(qb, dt);
      }
      // Pre-snap movement: safeties rolling down into man alignment.
      for (const p of this.defense) {
        if (!p.presnapSpot) continue;
        steer(p, { moveTo: p.presnapSpot, speed: 3, face: -Math.PI / 2 });
        integrate(p, dt);
      }
      return;
    }

    if (this.state === "PLAY_END") {
      for (const p of this.players) {
        p.desired = { dir: null, speed: 0, face: p.desired.face };
        integrate(p, dt);
      }
      this.updateBall(dt);
      if (this.t - this.endAt > TUNING.play.endDelay) {
        if (this.autoReset) this.reset();
        else if (this.onFinished && !this.finished) {
          // Drive mode: hand the result over once the play has settled.
          this.finished = true;
          this.onFinished(this.result);
        }
      }
      return;
    }

    this.sinceSnap = this.t - this.snapAt;

    // 1. Perception, then beliefs built from it.
    for (const p of this.players) updatePerception(p, this, dt);
    for (const p of this.defense) updateBelief(p, this, dt);

    // 2. Blocking calls (a few times a second).
    if (this.playType === "run" || this.fakeSide) updateZone(this);
    else if (this.t >= this.nextAssign) {
      assignPassPro(this);
      assignStalk(this);
      if (this.play.screen) assignScreen(this);
      this.nextAssign = this.t + 0.15;
    }

    // 3. Decisions (and human input — or the autopilot standing in for it).
    // Heads face with the chest unless a decision turns them this step.
    this.autopilotStep();
    const ctrl = this.controlledId();
    for (const p of this.players) p.gaze = null;
    for (const p of this.players) {
      if (p.id === ctrl) {
        if (p.id === "QB" && this.faking()) thinkOffense(p, this); // the fake, then he's yours
        else if (p.id === "QB" && this.passing && !this.qbScramble) qbControl(p, this.input, this);
        else if (this.meshing()) meshTrack(p, this, this.input.mouse);
        else carrierControl(p, this, this.input);
      } else if (p.team === "O") {
        // A slow one (variance on) is a beat late off the ball.
        if (p.form && this.sinceSnap < p.form.getOff) hold(p, this, "Late off the snap", `get-off ${(p.form.getOff * 1000).toFixed(0)}ms slow`);
        else thinkOffense(p, this);
      }
      else thinkDefender(p, this);
    }

    // 4. Physical interaction and movement.
    updateEngagements(this, dt);
    for (const p of this.players) integrate(p, dt);
    constrainEngaged(this, dt);
    resolveCollisions(this);

    // 5. Ball, then outcomes.
    this.updateBall(dt);
    this.checkPlay();
  }

  // ── Where the throw got to the man it was for: at the ball's closest
  // horizontal pass by him — across him as the passer sees it (lat: + = the
  // QB's left), its height, and ahead / behind his run. For the recap's
  // upper-body diagram. ──
  trackPlacement() {
    const ti = this.throwInfo;
    if (!ti || !ti.intended || this.ball.state !== "air") return;
    const pl = this.placementFor(this.byId[ti.intended]);
    if (pl.d > 4 || (ti.placement && pl.d >= ti.placement.d)) return;
    ti.placement = pl;
  }

  placementFor(p) {
    const b = this.ball;
    const hs = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / hs;
    const uy = b.vy / hs;
    const sp = Math.hypot(p.vx, p.vy);
    return {
      d: Math.hypot(b.x - p.x, b.y - p.y),
      lat: (b.x - p.x) * -uy + (b.y - p.y) * ux,
      z: b.z,
      along: sp > 0.5 ? ((b.x - p.x) * p.vx + (b.y - p.y) * p.vy) / sp : 0,
      who: p.id,
    };
  }

  updateBall(dt) {
    const b = this.ball;
    this.trackPlacement();
    if (b.state === "snap") {
      const k = Math.min(1, (this.t - b.snap.t0) / TUNING.ball.snapTime);
      const qb = this.byId.QB;
      b.x = b.snap.from.x + (qb.x - b.snap.from.x) * k;
      b.y = b.snap.from.y + (qb.y - b.snap.from.y) * k;
      b.z = 0.3 + Math.sin(k * Math.PI) * 0.6 + k * 0.8;
      if (k >= 1) {
        b.state = "held";
        b.carrierId = "QB";
        qb.hasBall = true;
        this.state = this.playType === "pass" ? "PLAY_DEVELOPMENT" : "RUN_DEVELOPMENT";
        if (this.play.qbRun) {
          this.qbKeep = true;
          this.log(qb, this.play.option ? "Option — QB attacks the pitch key" : "QB draw — sell pass, then go", "");
        }
      }
    } else if (b.state === "held") {
      const c = this.carrier();
      if (c) {
        b.x = c.x + Math.cos(c.facing) * 0.3;
        b.y = c.y + Math.sin(c.facing) * 0.3;
        b.z = 1.1;
      }
    } else if (b.state === "air") {
      const z0 = b.z;
      stepBall(b, dt);
      // The moment it comes back down to chest height: where was the man it
      // was meant for? (How accurate the throw was is judged from this.)
      const cz = TUNING.ball.catchHeight;
      if (!this.catchMoment && z0 > cz && b.z <= cz && this.throwInfo && this.throwInfo.intended) {
        const r = this.byId[this.throwInfo.intended];
        this.catchMoment = { bx: b.x, by: b.y, rx: r.x, ry: r.y, rvx: r.vx, rvy: r.vy, id: r.id };
      }
    }
  }

  checkPlay() {
    const b = this.ball;
    const qb = this.byId.QB;

    // Inside zone mesh: hand off when the RB arrives; QB keeps if he never does.
    if (this.playType === "run" && b.carrierId === "QB" && !this.handedOff && !this.qbKeep) {
      // Mesh point: the back has to cross the QB's face to it — that ride is
      // the time the QB gets to read the unblocked end.
      const rb = this.byId.RB;
      const ps = this.zone ? this.zone.ps : 1;
      const mesh = this.meshPoint();
      const crossed = ps * (rb.x - qb.x) > -0.6;
      const giveAt = this.giveAt();
      if (this.sinceSnap >= giveAt && crossed && Math.hypot(rb.x - mesh.x, rb.y - mesh.y) < 1.5) {
        this.handedOff = true;
        qb.hasBall = false;
        rb.hasBall = true;
        b.carrierId = "RB";
        this.log(rb, "Handoff", qb.intent ? qb.intent.reason : "mesh complete");
      } else if (this.sinceSnap > giveAt + 0.7) {
        this.qbKeep = true;
        this.log(qb, "QB keeps it", "RB never got to the mesh");
      }
    }

    // A QB who carries it over the line on a pass play is now a runner.
    if (b.carrierId === "QB" && this.passing && !this.qbScramble && qb.y > LOS + 0.2) {
      this.qbScramble = true;
      this.state = "RUN_DEVELOPMENT";
      this.log(qb, "Scramble past the line", "can no longer throw");
    }

    if (b.state === "air") {
      const res = resolveCatch(this);
      // Whoever actually played it (caught, dropped, picked, broke it up) —
      // the diagram shows the ball on him, at that moment.
      if (res && res.player && res.player.team === "O" && this.throwInfo) this.throwInfo.placement = this.placementFor(res.player);
      if (res) {
        if (res.type === "CATCH") {
          const p = res.player;
          b.state = "held";
          b.carrierId = p.id;
          p.hasBall = true;
          this.log(p, "CATCH", res.detail);
          // Judged on the throw: on his path = on the money; he had to go get
          // it = a tough catch (not a great throw, but he made the play).
          const adj = this.throwInfo && this.throwInfo.miss ? this.throwInfo.miss[p.id] ?? null : null;
          const onMoney = adj != null && adj < 0.9;
          const tough = adj != null && adj > 1.6;
          const sub = onMoney
            ? `on the money${res.contested ? " — through contact" : ""}`
            : tough
            ? "tough catch — he had to go get it"
            : res.contested
            ? `contested catch${res.defender ? ` over ${res.defender}` : ""}`
            : "";
          if (!this.throwInfo || !this.throwInfo.pitch) this.popup("CAUGHT", p.x, p.y, "#4ade80", sub);
          this.stats.catch = { id: p.id, x: p.x, y: p.y, t: this.t, onMoney, tough, contested: !!res.contested, defender: res.defender || null };
          this.stride(p);
          if (p.y >= goalLineY) return this.end("TOUCHDOWN", res.detail);
          this.state = "RUN_AFTER_CATCH";
          // He keeps going upfield on his own until you move the mouse.
          p.caughtAt = this.t;
          this.input.moveAccum = 0;
        } else if (res.type === "INTERCEPTION") {
          const p = res.player;
          b.state = "held";
          b.carrierId = p.id;
          p.hasBall = true;
          this.log(p, "INTERCEPTION", res.detail);
          this.popup("INTERCEPTED", p.x, p.y, "#f87171", res.why === "undercut" ? `${p.id} undercut it` : "thrown into coverage");
          return this.end("INTERCEPTION", `${p.id} — ${res.detail}`);
        } else if (this.throwInfo && this.throwInfo.pitch) {
          this.log(res.player, "Pitch not handled", res.detail);
          return this.loosePitch(`${res.player.id} couldn't handle it`);
        } else {
          b.state = "ground";
          this.log(res.player, "Incomplete", res.detail);
          const pl = res.player.id;
          // "Good throw" only if the throw really was on him.
          const miss = this.throwInfo && this.throwInfo.miss ? this.throwInfo.miss[pl] : null;
          if (res.why === "drop:goodThrow" && miss != null && miss > 0.9) res.why = "drop:tough";
          const W = {
            "drop:goodThrow": ["DROPPED", "good throw — it was on him", "#fde047"],
            "drop:hot": ["DROPPED", "a hot one — hands weren't ready", "#e5e7eb"],
            "drop:contested": ["DROPPED", `contested — ${res.defender || "a defender"} on him`, "#e5e7eb"],
            "drop:tough": ["DROPPED", "a tough ball to catch", "#e5e7eb"],
            brokenUp: ["BROKEN UP", `good coverage by ${pl}`, "#fca5a5"],
            batted: ["BATTED DOWN", `off ${pl} at the line`, "#e5e7eb"],
            neverSaw: ["INCOMPLETE", `${pl} never saw it`, "#e5e7eb"],
          }[res.why] || ["INCOMPLETE", "", "#e5e7eb"];
          this.popup(W[0], b.x, b.y, W[2], W[1]);
          return this.end("INCOMPLETE", res.detail);
        }
      } else if (b.z <= 0 && this.throwInfo && this.throwInfo.pitch) {
        return this.loosePitch("nobody got to it");
      } else if (b.z <= 0) {
        b.state = "ground";
        const [head, sub] = this.missReason();
        this.popup(head, b.x, b.y, "#e5e7eb", sub);
        return this.end("INCOMPLETE", `Ball hit the ground — ${head.toLowerCase()}${sub ? ", " + sub : ""}`);
      } else if (!inBounds(b.x, b.y) && b.z < 2) {
        b.state = "ground";
        this.popup("INCOMPLETE — out of bounds", b.x, b.y, "#e5e7eb");
        return this.end("INCOMPLETE", "Out of bounds");
      }
    }

    const c = this.carrier();
    if (c && b.state === "held") {
      const tk = resolveTackles(this);
      if (tk) {
        this.log(tk.by, `Tackle on ${c.id}`, tk.detail);
        this.stats.tackler = tk.by.id;
        const sack = c.id === "QB" && this.passing && !this.qbScramble && c.y < LOS;
        return this.end(sack ? "SACK" : "TACKLE", `${tk.by.id} — ${tk.detail}`);
      }
      if (c.x < 0 || c.x > FIELD.width) return this.end("OUT_OF_BOUNDS", `${c.id} stepped out`);
      if (c.team === "O" && c.y >= goalLineY) return this.end("TOUCHDOWN", `${c.id} broke away`);
    }
  }

  // Hit in stride, a receiver keeps his speed. Anything else costs him: a
  // ball behind him means throttling down and reaching back (the worst), one
  // out in front means stretching for it, one off to the side means twisting
  // for it — then he has to get going again.
  stride(p) {
    const v = this.throwInfo && this.throwInfo.missVec ? this.throwInfo.missVec[p.id] : null;
    const miss = this.throwInfo && this.throwInfo.miss ? this.throwInfo.miss[p.id] : null;
    if (!v || miss == null || miss < 0.7) return;
    let keep = 1;
    if (v.along < -0.4) keep *= clamp(1 - 0.32 * (-v.along - 0.4), 0.15, 1);
    else if (v.along > 0.6) keep *= clamp(1 - 0.14 * (v.along - 0.6), 0.5, 1);
    keep *= clamp(1 - 0.16 * Math.max(0, v.across - 0.5), 0.45, 1);
    if (keep > 0.97) return;
    p.vx *= keep;
    p.vy *= keep;
    const why = v.along < -0.4 ? "behind him — had to throttle down" : v.along > 0.6 ? "out in front — had to stretch" : "off to the side — had to twist for it";
    this.log(p, "Not in stride", `${why} · kept ${Math.round(keep * 100)}% of his speed`);
  }

  // Nobody touched it: how far off was it, and which way? Judged against the
  // man it was meant for at the moment it came down to chest height.
  missReason() {
    const m = this.catchMoment;
    if (!m) return ["INCOMPLETE", ""];
    const r = this.byId[m.id];
    const dx = m.bx - m.rx;
    const dy = m.by - m.ry;
    const d = Math.hypot(dx, dy);
    if (d > 7) return ["THROWN AWAY", "nobody there"];
    if (!r.perception.ball.acquired) return ["INCOMPLETE", `${m.id} never saw it`];
    const sp = Math.hypot(m.rvx, m.rvy);
    const along = sp > 1 ? (dx * m.rvx + dy * m.rvy) / sp : 0; // + = out in front of him
    if (d < 1.4) return ["INCOMPLETE", `right there — ${m.id} couldn't get to it`];
    if (along > 1.2) return ["OVERTHROWN", `ahead of ${m.id}`];
    if (along < -1.2) return [`BEHIND ${m.id}`, "he was past it"];
    return ["OFF TARGET", `wide of ${m.id}`];
  }

  end(type, detail, yardsOverride) {
    // The banner says it plainly, like the callout; the numbers stay in the log.
    const last = this.popups[this.popups.length - 1];
    if (last && this.t - last.t < 0.05) detail = `${last.text[0]}${last.text.slice(1).toLowerCase()}${last.sub ? " — " + last.sub : ""}`;
    const c = this.carrier();
    let yards = 0;
    if (c && c.team === "O" && type !== "INCOMPLETE") yards = Math.min(c.y, goalLineY) - LOS;
    if (yardsOverride != null) yards = yardsOverride;
    this.result = { type, detail, yards };
    this.state = "PLAY_END";
    this.endAt = this.t;
    this.throwCharging = false;
  }

  // Plain-data summary for the page's debug panel (not per frame).
  snapshot() {
    return {
      state: this.state,
      result: this.result,
      sinceSnap: this.snapAt == null ? 0 : this.t - this.snapAt,
      seed: this.seed,
      throwInfo: this.throwInfo,
      players: this.players.map((p) => ({
        id: p.id,
        team: p.team,
        position: p.position,
        intent: p.intent ? p.intent.label : "",
        reason: p.intent ? p.intent.reason : "",
        pending: p.pending ? `${p.pending.label} (${(p.pending.t * 1000).toFixed(0)}ms)` : "",
        pRun: p.team === "D" ? p.belief.pRun : null,
        attention: p.team === "D" ? { ...p.belief.attention } : null,
        threat: p.team === "D" ? { ...p.belief.threat } : null,
        carrierId: p.belief.carrierId,
        ball: p.perception.ball.acquired ? "acquired" : p.perception.ball.seeing ? "seeing" : "",
        speed: Math.hypot(p.vx, p.vy),
        engaged: p.engagedWith || (p.blockers.length ? `← ${p.blockers.join(",")}` : ""),
        form: formLabel(p),
        ratings: p.traits,
        formZ: p.form ? p.form.z : null,
      })),
      events: this.events.slice(-40),
    };
  }
}
