// src/sim/ai/human.js
// ── Human control goes through exactly the same body as the AI: input only
// sets p.desired, and the movement integrator decides what's possible.
//
// QB: WASD = where the feet go, mouse = where the chest (and eyes) point.
// Backpedaling while looking downfield is slower than turning and running —
// the same facing rules as everyone else.
//
// Ball carrier: the mouse is *intent*, not a destination. Direction = where
// he wants to go; distance = how hard (nonlinear — close is patient, far is
// all-out). Within that intent the runner reads what *he* can see and bends
// toward the cleanest lane — pressing the line, reading blocks, cutting. ──

import { physOf } from "../player.js";
import { CX, LOS } from "../field.js";
import { angDiff, clamp } from "../math.js";

const DEG = Math.PI / 180;

export function qbControl(p, input, world) {
  const k = input.keys;
  const mx = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0);
  const my = (k.has("w") ? 1 : 0) - (k.has("s") ? 1 : 0);
  const face = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x);
  // Touching WASD makes him yours for the rest of the play — no more auto
  // drop or rollout.
  if (mx || my) p.qbManual = true;
  const auto = world && !p.qbManual && world.state !== "PRE_SNAP" ? autoQbSpot(p, world) : null;
  if (auto) {
    const d = Math.hypot(auto.x - p.x, auto.y - p.y);
    if (d > 0.2) {
      const dir = Math.atan2(auto.y - p.y, auto.x - p.x);
      // Rolling out, the shoulders turn with the run (the head stays on
      // your eyes); dropping back he stays square downfield.
      let chest = face;
      if (auto.turn) {
        chest = dir + clamp(angDiff(face, dir), -auto.turn * DEG, auto.turn * DEG);
        p.gaze = face;
      }
      p.desired = { dir, speed: Math.min(physOf(p).top * auto.pace, 1.5 + 3 * d), face: chest };
      p.intent = { key: "human", label: auto.label, reason: "eyes are yours · WASD takes him", since: 0 };
      return;
    }
    auto.done();
  }
  if (mx || my) p.desired = { dir: Math.atan2(my, mx), speed: physOf(p).top, face };
  else p.desired = { dir: null, speed: 0, face };
  p.intent = { key: "human", label: "QB (you)", reason: mx || my ? "WASD" : "set", since: 0 };
}

// Where the QB takes himself after the snap until you move him: a 2-yard
// drop on a straight dropback; after a play-action fake, the play's rollout
// (Waggle boots away from the fake to the edge).
const DROP = 2;
function autoQbSpot(p, world) {
  const play = world.play;
  if (world.rpoPass) return null; // pulled on an RPO: he's already where he is
  if (play.rollout && world.fakeSide) {
    if (p.rolled) return null;
    const side = (play.rollout === "boot" ? -1 : 1) * world.fakeSide;
    return {
      x: CX + side * 8, y: LOS - 6.5, pace: 0.9, turn: 55, label: `Rolling out ${side > 0 ? "right" : "left"}`,
      done: () => (p.rolled = true),
    };
  }
  if (p.dropped) return null;
  // (A screen drops deeper — draw the rush up the field.)
  return { x: p.home.x, y: p.home.y - (play.drop ?? DROP), pace: 1, label: play.drop ? "Deep drop — draw the rush" : "Dropping back", done: () => (p.dropped = true) };
}

// ── Jump cut (A = left, D = right). A two-footed hop sideways: the back
// plants, keeps his shoulders square downhill, and bounds laterally —
// trading forward speed for an immediate sideways jump — then keeps sliding
// that way for a beat before he can go again. The faster he's going the
// bigger the jump (there's more momentum to redirect). Its value, like any
// cut, is that defenders read the new direction late. ──
export const JUMP_TIME = 0.3; // s he's committed to the jump
export const JUMP_KEEP = 0.4; // share of forward speed kept through the plant
export const LAND_TIME = 0.35; // s to resettle his feet after landing
export const LAND_SPEED = 2.0; // yd/s he's held under while he does

export function startCut(p, world, side) {
  const sp = Math.hypot(p.vx, p.vy);
  const lateral = clamp(2.5 + 0.5 * sp, 2.5, 5.5);
  const dir = side > 0 ? Math.PI : 0; // left = −x, right = +x
  p.vx = Math.cos(dir) * lateral;
  p.vy = Math.max(0, p.vy) * JUMP_KEEP;
  p.cut = { dir, lateral, start: world.t, until: world.t + JUMP_TIME, land: world.t + JUMP_TIME + LAND_TIME, side };
  if (world.stats) world.stats.cuts++;
  world.log(p, `Jump cut ${side > 0 ? "left" : "right"}`, `from ${sp.toFixed(1)} yd/s — ${lateral.toFixed(1)} yd/s sideways`);
}

// ── Burst (W): hit it downhill — full effort straight at the goal line for
// a beat, still bending within ~20° to the cleanest crease. ──
export const BURST_TIME = 0.5;
export const BURST_ACCEL = 1.2;

export function startBurst(p, world) {
  // Pressed during a jump cut, the burst waits for his feet: it starts when
  // he's landed rather than cancelling the jump.
  const from = p.cut && world.t < p.cut.land ? p.cut.land : world.t;
  p.burst = { from, until: from + BURST_TIME };
  if (world.stats) world.stats.bursts++;
  world.log(p, "Burst downhill", `at ${Math.hypot(p.vx, p.vy).toFixed(1)} yd/s`);
}

const RAC_TAKEOVER_PX = 40; // mouse travel (screen px) after a catch that hands you the runner

export function carrierControl(p, world, input) {
  const ph = physOf(p);
  p.bursting = false;
  // Landing from a jump cut: feet resettle before he can drive again.
  const landing = p.cut && world.t >= p.cut.until && world.t < p.cut.land;
  p.recoverCap = landing ? LAND_SPEED : Infinity;
  if (p.burst && world.t >= p.burst.from && world.t < p.burst.until && !landing && !(p.cut && world.t < p.cut.until)) {
    const lane = bestLane(p, world, Math.PI / 2, 20);
    p.desired = { dir: lane.dir, speed: ph.top, face: null };
    p.bursting = true;
    p.intent = { key: "human", label: "Burst downhill", reason: lane.bend ? `hitting the crease ${lane.bend}° off straight` : "straight downhill", since: 0 };
    return;
  }
  if (p.burst && world.t >= p.burst.until) p.burst = null;
  if (p.cut && world.t < p.cut.until) {
    // Mid-jump: sliding sideways, shoulders square downhill, bleeding speed.
    const k = (world.t - p.cut.start) / JUMP_TIME;
    p.desired = { dir: p.cut.dir, speed: p.cut.lateral * (1 - k) + LAND_SPEED * k, face: Math.PI / 2 };
    p.intent = { key: "human", label: `Jump cut ${p.cut.side > 0 ? "left" : "right"}`, reason: "shoulders square — sliding laterally", since: 0 };
    return;
  }
  if (!landing) p.cut = null;
  // Option / QB draw: until you move the mouse, the QB runs the play —
  // on the draw he sells pass, then takes the cleanest lane upfield; on the
  // option he attacks the pitch key's inside shoulder along the line.
  const auto = qbRunAuto(p, world, input);
  if (auto) {
    p.desired = auto.desired;
    p.intent = { key: "human", label: auto.label, reason: `${auto.reason} · move the mouse to take him`, since: 0 };
    return;
  }
  // Just caught it and you haven't touched the mouse since: he takes it
  // straight for the end zone at full speed (the cursor is still where you
  // threw it — steering at that would stop him dead). Move the mouse and
  // he's yours again.
  if (p.caughtAt != null && (input.moveAccum ?? 0) < RAC_TAKEOVER_PX) {
    const lane = bestLane(p, world, Math.PI / 2, 42);
    // Round the turn upfield instead of snapping it: steer at most 55° off
    // the way he's already running, so a crosser bends to the end zone
    // carrying his speed rather than stopping to square up.
    const v = Math.hypot(p.vx, p.vy);
    const run = v > 2 ? Math.atan2(p.vy, p.vx) : lane.dir;
    const dir = run + clamp(angDiff(lane.dir, run), -55 * DEG, 55 * DEG);
    p.desired = { dir, speed: ph.top, face: null };
    p.intent = {
      key: "human", label: landing ? "Landing — resettling his feet" : "After the catch — upfield",
      reason: `${lane.bend ? `bending ${Math.abs(lane.bend)}° to a cleaner lane · ` : ""}move the mouse to steer`, since: 0,
    };
    if (landing) p.desired.speed = Math.min(p.desired.speed, LAND_SPEED);
    return;
  }
  const dx = input.mouse.x - p.x;
  const dy = input.mouse.y - p.y;
  const d = Math.hypot(dx, dy);
  const intentDir = Math.atan2(dy, dx);
  const intensity = 1 - Math.exp(-d / 6);
  const speed = ph.top * (0.18 + 0.82 * Math.pow(intensity, 1.4));

  const best = bestLane(p, world, intentDir, 42);
  p.desired = { dir: best.dir, speed, face: null };
  const bend = best.bend;
  p.intent = {
    key: "human",
    label: landing ? "Landing — resettling his feet" : `Ball carrier (you) — ${intensity < 0.35 ? "patient" : intensity < 0.7 ? "pressing" : "all-out"}`,
    reason: bend ? `bending ${Math.abs(bend)}° ${bend > 0 ? "left" : "right"} toward a cleaner lane` : "lane on intent is clear",
    since: 0,
  };
  p.debug.intentPoint = { x: input.mouse.x, y: input.mouse.y };
}

function qbRunAuto(p, world, input) {
  const kind = world.play.qbRun;
  if (p.id !== "QB" || !kind) return null;
  // Waiting on the snap.
  if (world.ball.state === "snap") return { desired: { dir: null, speed: 0, face: Math.PI / 2 }, label: "Taking the snap", reason: "shotgun" };
  if (!p.hasBall || (input.moveAccum ?? 0) >= RAC_TAKEOVER_PX) return null;
  const ph = physOf(p);
  if (kind === "draw") {
    if (world.sinceSnap < (world.play.sell || 0.45) + 0.25)
      return {
        desired: { dir: -Math.PI / 2, speed: world.sinceSnap < 0.4 ? 2.6 : 0, face: Math.PI / 2 },
        label: "QB draw — show pass", reason: "eyes downfield, let the rush come",
      };
    const lane = bestLane(p, world, Math.PI / 2, 30);
    return { desired: { dir: lane.dir, speed: ph.top, face: null }, label: "QB draw — hit it", reason: "cleanest lane upfield" };
  }
  // Option: attack the key along the line — downhill but flat, staying
  // behind the line until he's on the key — then turn it up through the
  // cleanest lane (inside the key if he widens to the pitch).
  const z = world.zone;
  const ps = (z && z.ps) || world.play.side || 1;
  const key = z && z.optionKeyId ? p.perception.memory[z.optionKeyId] : null;
  // Turn up when he's on the key, at the line, or the key widens to the
  // pitch man (the lane inside him opens).
  const onKey = !key || ps * (key.x - p.x) < 1.3 || p.y > LOS - 0.2 || (ps * key.vx > 1.2 && ps * (key.x - p.x) < 3.5);
  if (onKey) {
    const lane = bestLane(p, world, Math.PI / 2 - ps * 0.25, 42);
    return { desired: { dir: lane.dir, speed: ph.top, face: null }, label: "Kept it — turn it up", reason: lane.bend ? `bending ${Math.abs(lane.bend)}° to the crease` : "upfield" };
  }
  const tgt = { x: key.x - ps * 0.9, y: LOS - 0.9 };
  const dir = Math.atan2(tgt.y - p.y, tgt.x - p.x);
  return {
    desired: { dir, speed: ph.top * 0.95, face: null },
    label: "Option — attack the pitch key",
    reason: `${z.optionKeyId} — SPACE pitches`,
  };
}

// Lane reading: score directions near the intent by how clear they look
// over the next few yards — defenders as this runner perceives them, and the
// bodies of his own blockers he can see in front of him.
function bestLane(p, world, intentDir, spread) {
  const obstacles = [];
  for (const m of Object.values(p.perception.memory)) {
    if (m.conf >= 0.3) obstacles.push({ x: m.x, y: m.y, w: m.engaged ? 0.5 : 1 }); // a blocked defender is less of a wall
  }
  for (const q of world.offense) {
    if (q !== p && q.role === "OL") obstacles.push({ x: q.x, y: q.y, w: 0.55 });
  }
  let best = { dir: intentDir, score: -Infinity, clear: 0 };
  for (let off = -spread; off <= spread; off += 6) {
    const a = intentDir + off * DEG;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let clear = 3;
    for (const o of obstacles) {
      const rx = o.x - p.x;
      const ry = o.y - p.y;
      const t = rx * ux + ry * uy;
      if (t <= 0 || t > 4.5) continue;
      const perp = Math.abs(rx * uy - ry * ux);
      clear = Math.min(clear, perp / o.w);
    }
    const score = Math.cos(off * DEG) * 1.0 + 0.8 * clamp(clear / 2.5, 0, 1);
    if (score > best.score) best = { dir: a, score, clear };
  }
  best.bend = Math.round(angDiff(best.dir, intentDir) / DEG);
  return best;
}
