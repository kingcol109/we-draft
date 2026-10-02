// src/sim/ai/defense.js
// ── Defensive AI: ASSIGNMENT + PERCEPTION + BELIEF → options → decide().
//
// Every step, each defender puts all of these on the table, scored by his
// own beliefs and his role's priorities, and the decision system (with its
// delay and switching cost) picks:
//
//   • the thrown ball, once he's acquired it     (role priority: passInAir)
//   • a believed ball carrier                    (committed once his run
//     belief clears his role's threshold — DBs need far more certainty than
//     DL, which is why they backpedal first and fit the run late)
//   • his assignment: rush / zone / man
//   • for LBs, a read step right after the snap
//
// So a DB can go coverage → "that's a run" → close → "no, QB's back to
// passing" → acquire the ball → break on it, without any state machine. ──

import { ROLE_PROFILE, TUNING, DEG } from "../config.js";
import { CX, LOS, OL_SPLIT, GAPS, depthOf } from "../field.js";
import { physOf } from "../player.js";
import { angDiff, angleTo, clamp, fmt, lerp, pct } from "../math.js";
import { interceptMover } from "../systems/kinematics.js";
import { decide, hold } from "./intent.js";
import { ballOption, believedRunner, pursuitOption } from "./common.js";
import { zoneOptions, manOptions } from "./coverage.js";
import { headToward } from "./routes.js";

export function thinkDefender(p, world) {
  p.shedToward = null;
  if (world.sinceSnap < TUNING.react.snap / p.traits.reaction) return hold(p, world, "Reading the snap", "ball just moved");

  const prof = ROLE_PROFILE[p.role];
  const cover = p.assignment.cover;
  const opts = [ballOption(p, world)];

  // A rusher doesn't chase a pass — but he doesn't keep rushing a QB who no
  // longer has the ball either.
  if (world.ball.state === "air" && prof.passInAir === 0) {
    const qbm = p.perception.memory.QB;
    const sees = p.perception.ball.seeing || (qbm && qbm.vis > 0.3 && !qbm.hasBall);
    if (sees)
      opts.push({
        key: "passAway", label: "Pass is away — pull up, find the ball", reason: "rusher: not a pass chaser", score: 2.6,
        moveTo: { x: p.x + (world.ball.x - p.x) * 0.1, y: p.y + (world.ball.y - p.y) * 0.1 }, speed: 2.2,
        face: p.perception.ball.seeing ? { x: world.ball.x, y: world.ball.y } : null,
      });
  }

  opts.push(readEndOption(p, world));
  opts.push(optionKeyOption(p, world));
  opts.push(pitchManOption(p, world));

  const runner = believedRunner(p, world);
  // A safety with the force is still pass-first, but he's the edge: he
  // needs less certainty than a deep defender to come up and fill.
  const forceSafety = p.role === "S" && /^force/.test(p.assignment.gap || "");
  const commit = forceSafety ? FORCE_SAFETY_COMMIT : prof.runCommit;
  if (runner && prof.carrier > 0) {
    // Past his commit threshold, fitting the run outranks a plain drop. A
    // caught ball is a live runner wherever he caught it (a screen behind
    // the line) — nobody keeps dropping on it.
    const caught = world.state === "RUN_AFTER_CATCH" && runner.id !== "QB";
    const score = runner.past || caught ? 3 : 1.8 + 4 * (p.belief.pRun - commit);
    opts.push(runOption(p, world, runner, score));
  }

  opts.push(screenOption(p, world));

  // A linebacker plays run until the offense shows him pass — the linemen
  // set (retreat) or the QB winds up / throws. He never bails into his
  // coverage on a guess: no read, no drop.
  const lbOnRun = p.role === "LB" && cover.type !== "rush" && !passShown(p, world);
  // The force safety: once the run read is solid (and nothing says pass) he
  // comes down to set the edge before the back even has it — outranking his
  // drop. Below that he stays in his coverage: pass first.
  const safetyFill = forceSafety && !passShown(p, world) && p.belief.pRun >= FORCE_SAFETY_COMMIT;
  if (cover.type === "rush") opts.push(rushOption(p, world));
  else if (lbOnRun) opts.push(downhillOption(p, world));
  else if (safetyFill) {
    // Full speed to the edge, right at the line — he's the force, and the
    // edge has to be set before the back gets there.
    const fill = downhillOption(p, world);
    const pt = { x: fill.moveTo.x, y: LOS + 0.6 };
    opts.push({ ...fill, moveTo: pt, debug: { kind: "fit", point: pt }, score: 2.4, speed: physOf(p).top, label: "Run! Fill the force — set the edge" });
  }
  else if (cover.type === "zone") opts.push(...zoneOptions(p, world));
  else if (cover.type === "man") opts.push(...manOrDog(p, world));

  const chosen = decide(p, world, opts);
  // Playing a thrown ball on the run: head around to it.
  if (chosen && chosen.key === "ball" && p.perception.ball.seeing) headToward(p, world.ball);
  // A deep defender running with his hips flipped keeps his head on the QB.
  else if (chosen && chosen.eyesOn) headToward(p, chosen.eyesOn);
  return chosen;
}

// ── Read screen: once he believes it (belief.js), he comes off his drop —
// or his rush — and goes to tackle the man it's for, before the ball gets
// there. A deep defender needs to be surer before he gives up the top. ──
function screenOption(p, world) {
  const sb = p.belief.screen;
  const tid = p.belief.screenTarget;
  const cover = p.assignment.cover;
  const deep = cover.type === "zone" && cover.def && cover.def.kind === "over";
  const need = deep ? 0.75 : p.role === "DL" ? 0.6 : 0.5;
  // The ball's out and he can see it's coming down at (or behind) the line:
  // it's a screen whatever he read before — rally to the man it's for.
  if (world.ball.state === "air") {
    const bk = p.perception.ball;
    if (!bk.acquired || !bk.path || p.role === "DL") return null;
    const land = bk.path.find((q, i) => i > 3 && q.z <= 1.5) || bk.path[bk.path.length - 1];
    if (depthOf(land.y) > 2.5) return null;
    let catcher = null;
    for (const q of world.offense) {
      if (q.role !== "WR" && q.role !== "RB") continue;
      const m = p.perception.memory[q.id];
      if (!m || m.engaged) continue; // a man blocking isn't the one it's for
      if (depthOf(m.y) > 2) continue; // a screen is caught at (or behind) the line
      const d = Math.hypot(m.x - land.x, m.y - land.y);
      if (d < 7 && (!catcher || d < catcher.d)) catcher = { id: q.id, m, d };
    }
    if (!catcher) return null;
    return pursuitOption(p, world, catcher, { key: "screen", label: `Screen thrown — rally to ${catcher.id}`, score: 3.4 });
  }
  if (sb < need || !tid) return null;
  const m = p.perception.memory[tid];
  if (!m) return null;
  return pursuitOption(p, world, { id: tid, m }, {
    key: "screen", label: `Screen! — attack ${tid}`, score: 2.6 + 1.5 * (sb - need),
  });
}

// ── Gaps belong to the offensive line, not the field: A is between the
// center and a guard, B between guard and tackle, C just outside the
// tackle, D outside that. They move with the *line* — its alignment plus
// how far the whole front has flowed (as this defender sees it) — not with
// the one blocker who's on him; otherwise a reach block would just chase
// the gap, and its owner, to the sideline. ──
function gapPoint(p, world, gap) {
  let flow = 0;
  let n = 0;
  for (const o of world.offense) {
    if (o.role !== "OL") continue;
    const m = p.perception.memory[o.id];
    if (!m) continue;
    flow += m.x - o.home.x;
    n++;
  }
  // (With variance on, a sloppy fit is a little off his gap.)
  const miss = p.form ? p.form.landmark.x * 0.45 : 0;
  return CX + (GAPS[gap] || 0) + (n ? flow / n : 0) + miss;
}

// ── Run fits. A gap defender owns his gap: he stays in it until the ball
// is coming to it, the ball carrier is on top of him, or the ball is past
// the line — then he goes to make the play. Force players set the edge and
// keep the ball inside; alley players fill inside-out. ──
function runOption(p, world, runner, score) {
  const gap = p.assignment.gap || "";
  if (gap.startsWith("force")) return forceOption(p, world, runner, score, gap.endsWith("L") ? -1 : 1);
  if (gap.startsWith("alley")) return pursuitOption(p, world, runner, { label: `Alley — inside-out on ${runner.id}`, score });
  if (!/^[A-D]-[LR]$/.test(gap)) return pursuitOption(p, world, runner, { label: `Pursue ${runner.id}`, score });

  const m = runner.m;
  const gx = gapPoint(p, world, gap);
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  // Where will he hit the line? (re-read every step — a cut changes it)
  const tc = m.y < LOS ? clamp((LOS - m.y) / Math.max(m.vy, 1.5), 0, 1.5) : 0;
  const cx = m.x + m.vx * tc;
  const lb = p.role !== "DL";
  // A scripted fit (Learn's demos, engine config.fits) is a commitment: he
  // plays that gap until the ball's on him or past the line — no flowing
  // with the track, no chasing — so the defense moves the way the demo set.
  const scripted = !!(world.config.fits && world.config.fits[p.id]);
  // Linebackers flow with the ball's track, staying on their side of it;
  // a lineman just fights to stay in his gap.
  const fx = lb && !scripted ? gx + clamp(cx - gx, -2.5, 2.5) * 0.6 : gx;
  const toMe = Math.abs(cx - (lb ? fx : gx)) < (lb ? 1.5 : 1.1);
  if (runner.past || d < 2.2 || (toMe && d < 5)) {
    return pursuitOption(p, world, runner, {
      label: runner.past ? `Pursue ${runner.id}` : toMe ? `Fill ${gap} — ball's coming` : `Take on ${runner.id}`,
      score,
    });
  }
  // A back who's hitting it — running hard, or clearly going somewhere else
  // — gets chased: linebackers flow to him with inside-out leverage rather
  // than sitting in a fit he's not coming to. (A patient back keeps them in
  // their gaps; that's what makes pressing and following blocks pay.)
  const csp = Math.hypot(m.vx, m.vy);
  if (lb && !scripted && (csp > 4.5 || Math.abs(cx - gx) > 2.5))
    return pursuitOption(p, world, runner, {
      label: `Flow to ${runner.id} — inside-out`,
      shadeX: -Math.sign(m.vx || 0) * 0.8,
      score,
    });
  // (A linebacker attacks his fit — across the line while the back is still
  // in the backfield — rather than sitting on it.)
  const pt = { x: fx, y: LOS + (lb ? (m.y < LOS - 0.5 ? -0.4 : 1.1) : 0.1) };
  return {
    key: "run", urgent: true, label: lb && Math.abs(fx - gx) > 0.8 ? `Flow — ${gap} side of the ball` : `Hold ${gap}`,
    reason: `run ${pct(p.belief.pRun)} · ${runner.id} aiming ${fmt(cx - CX, 1)} — ${gap} is mine`,
    score, moveTo: pt, speed: physOf(p).top, face: { x: m.x, y: m.y }, debug: { kind: "fit", point: pt },
  };
}

// ── The unblocked end. The end man on the line of scrimmage who finds
// nobody blocking him (nobody on him, no lineman closing on him) plays the
// technique the defense called for this rep:
//   sit   — stay square to the line, squeeze a step, sit for the QB; take
//           the QB if he pulls it and comes this way.
//   crash — run flat down the line at the back's track, shoulders to the
//           sideline; if the QB pulls it he has to recognise it and redirect.
// It outranks his normal run fit until the ball's past the line; then
// normal pursuit takes over. ──
function isEndMan(p, world) {
  if (p.isEnd !== undefined) return p.isEnd;
  const side = Math.sign(p.home.x - CX) || 1;
  // Front players only — a pressed corner out wide isn't on the line.
  const onLine = world.defense.filter((d) => d.home.y - LOS < 2 && (d.role === "DL" || d.role === "LB"));
  p.isEnd = onLine.includes(p) && !onLine.some((d) => d !== p && side * (d.home.x - p.home.x) > 0.3);
  return p.isEnd;
}

// ── Speed option pitch key: the unblocked playside end. His call this
// snap (readTech): "crash" = take the QB, force the pitch early; "sit" =
// feather — stay square between the QB and the pitch man, make the QB
// decide, and take whoever keeps it. Once it's pitched he's a pursuer. ──
function optionKeyOption(p, world) {
  const z = world.zone;
  if (!z || z.optionKeyId !== p.id || p.blockers.length || world.sinceSnap < 0.2) return null;
  const mem = p.perception.memory;
  const qb = mem.QB;
  const rb = mem.RB;
  if (!qb || !qb.hasBall || world.pitched) return null;
  const top = physOf(p).top;
  const side = Math.sign(p.home.x - CX) || 1;
  const d = Math.hypot(qb.x - p.x, qb.y - p.y);
  const upfield = depthOf(qb.y) > -0.3; // at the line: he's keeping it
  if (p.readTech === "crash" || d < 2.0 || upfield)
    return {
      ...pursuitOption(p, world, { id: "QB", m: qb, past: upfield }, { key: "optionQB", score: 3.9 }),
      label: p.readTech === "crash" ? "Pitch key — take the QB (force the pitch)" : upfield ? "Pitch key — QB turned it up: take him" : "Pitch key — QB's on me: take him",
    };
  const px = rb ? lerp(qb.x, rb.x, 0.4) : qb.x + side * 2;
  return {
    key: "optionFeather", label: "Pitch key — feather: between the QB and the pitch", reason: `QB ${fmt(d, 1)} yd away — make him decide`,
    score: 3.9, moveTo: { x: px, y: clamp(p.y, LOS + 0.3, LOS + 1.6) }, speed: Math.min(top, 5.5), face: -Math.PI / 2,
  };
}

// ── Speed option: the force player to the side the option is going has the
// PITCH MAN. The unblocked end (the pitch key) attacks the QB; the force
// mirrors the back from outside-in — a step outside him and in front — so
// that when the ball is pitched he's right there. With variance on he
// doesn't always get it right: now and then he's late off the ball, and now
// and then he plays the QB instead (two men on the QB, nobody on the pitch).
// Once it's pitched, the normal run fit (force: squeeze from outside) takes
// over. ──
const PITCH_WRONG = 0.18; // chance (variance on) he takes the QB instead
const PITCH_LATE = 0.25; // chance (variance on) he's a beat late
function pitchManOption(p, world) {
  const z = world.zone;
  const gap = p.assignment.gap || "";
  if (!world.play.option || !z || !gap.startsWith("force") || world.pitched || world.ball.state === "air") return null;
  const side = gap.endsWith("L") ? -1 : 1;
  if (side !== z.ps) return null; // the backside force stays home
  // His read this rep (rolled once — variance decides if he blows it).
  if (p.pitchRead === undefined) {
    const v = world.config.variance;
    p.pitchRead = v && world.rng() < PITCH_WRONG ? "qb" : "pitch";
    p.pitchDelay = v && world.rng() < PITCH_LATE ? 0.3 + 0.3 * world.rng() : 0;
  }
  if (p.pitchRead === "qb" || world.sinceSnap < 0.15 + p.pitchDelay) return null;
  const rb = p.perception.memory.RB;
  if (!rb) return null;
  const tgt = { x: rb.x + side * 1.3 + rb.vx * 0.35, y: Math.max(rb.y + rb.vy * 0.35 + 1.2, LOS + 0.4) };
  return {
    key: "pitchMan", urgent: true, label: "Speed option — I've got the pitch man",
    reason: `the end has the QB${p.pitchDelay ? " (late)" : ""} — outside-in on the back`,
    score: 2.9, moveTo: tgt, speed: physOf(p).top, face: { x: rb.x, y: rb.y }, debug: { kind: "fit", point: tgt },
  };
}

function readEndOption(p, world) {
  // Takes a beat to know nobody is coming for him.
  if (!isEndMan(p, world) || (world.zone && world.zone.optionKeyId === p.id) || world.ball.state === "air" || world.sinceSnap < 0.18 || world.sinceSnap > 2.5 || p.blockers.length) return null;
  if (p.belief.pRun < 0.4) return null; // reads pass: just rush
  // Once he knows he's free he stays in his technique (unless someone
  // actually gets on him); until then, a lineman near him means he's blocked.
  if (!p.endFree) {
    for (const o of world.offense) {
      if (o.role !== "OL") continue;
      const m = p.perception.memory[o.id];
      if (m && Math.hypot(m.x - p.x, m.y - p.y) < 1.8) return null;
    }
    p.endFree = true;
  }
  const runner = believedRunner(p, world);
  if (runner && runner.past) return null;
  const side = Math.sign(p.home.x - CX) || 1;
  const inside = -side;
  const mem = p.perception.memory;
  const qb = mem.QB;
  const rb = mem.RB;
  const top = physOf(p).top;
  const commit = TUNING.react.readEndCommit;
  // How long has he been seeing the give / the pull?
  const since = (key, cond) => {
    if (!cond) return (p[key] = null), 0;
    if (p[key] == null) p[key] = world.t;
    return world.t - p[key];
  };
  const pullFor = since("pullSeenAt", qb && qb.hasBall && world.sinceSnap > 0.5 && side * qb.vx > 1.2);
  const giveFor = since("giveSeenAt", rb && rb.hasBall);
  // QB pulled it and he's coming this way: the sitter takes him right away;
  // the crasher is committed to the back and only gets off it after a beat.
  if (pullFor > 0 && (p.readTech === "sit" || pullFor > commit))
    return {
      ...pursuitOption(p, world, { id: "QB", m: qb, past: false }, { key: "readEndQB", score: 3.8 }),
      label: p.readTech === "sit" ? "Sat — QB pulled it: take him" : "Crashed — QB pulled it: redirect",
    };
  if (p.readTech === "crash") {
    const tgt = rb ? interceptMover(p, rb) : { x: CX, y: LOS - 4 };
    return {
      key: "readEnd", label: "Unblocked — crash on the back", reason: pullFor > 0 ? `committed — ${pullFor.toFixed(2)}s into the pull, still on the back` : "flat down the line, shoulders to the sideline",
      score: 3.7, moveTo: { x: tgt.x, y: Math.min(tgt.y, LOS + 0.3) }, arrive: false, speed: top,
      face: side < 0 ? 0 : Math.PI, debug: { kind: "pursuit", point: tgt },
    };
  }
  // Sit: he owns the QB. Seeing the give doesn't release him — only after
  // he's held long enough to be sure it's not a pull does he chase the back.
  if (giveFor > commit) return null;
  return {
    key: "readEnd", label: "Unblocked — sit, square, play the QB", reason: giveFor > 0 ? `give seen ${giveFor.toFixed(2)}s — still own the QB` : "stay square — don't chase the back",
    score: 3.7, moveTo: { x: p.home.x + inside * 0.6 + (qb ? clamp((qb.x - CX) * 0.3, -1, 1) : 0), y: LOS + 0.2 },
    speed: 3, face: -Math.PI / 2,
  };
}

function forceOption(p, world, runner, score, side) {
  const m = runner.m;
  const tackle = p.perception.memory[side < 0 ? "LT" : "RT"];
  const edge = (tackle ? tackle.x : CX + side * 2 * OL_SPLIT) + side * 2.5;
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  // Backside force: the ball's going the other way and not coming back —
  // stay home, trail at depth, keep the cutback / reverse in front of you.
  // Commit only when it turns back this way or is gone downfield.
  const away = side * (m.x - CX) < -1 && side * m.vx <= 0.8;
  if (away && depthOf(m.y) < 6) {
    const pt = { x: lerp(edge, m.x, 0.3), y: LOS + clamp(depthOf(m.y) + 4, 2.5, 6) };
    return {
      key: "run", urgent: true, label: "Backside force — stay home",
      reason: `${runner.id} going away — waiting on a cutback / reverse`,
      score, moveTo: pt, speed: physOf(p).top * 0.6, face: { x: m.x, y: m.y }, debug: { kind: "fit", point: pt },
    };
  }
  if (runner.past || d < 3)
    // Squeeze: stay outside the ball — outside of where *he* is, which is
    // the far sideline once he's crossed the field.
    return pursuitOption(p, world, runner, { label: `Force: squeeze ${runner.id} inside`, shadeX: (Math.sign(m.x - CX) || side) * 0.9, score });
  // Stay outside the ball, a few yards past the line, and squeeze.
  const cxp = m.x + m.vx * 0.5;
  const fx = side > 0 ? Math.max(edge, cxp + 1.5) : Math.min(edge, cxp - 1.5);
  const fy = LOS + clamp(depthOf(m.y) + 3, 1, 3.5);
  const pt = { x: fx, y: fy };
  return {
    key: "run", urgent: true, label: "Force: set the edge",
    reason: `keep ${runner.id} inside — outside leverage`,
    score, moveTo: pt, speed: physOf(p).top, face: { x: m.x, y: m.y }, debug: { kind: "fit", point: pt },
  };
}

function rushOption(p, world) {
  const ph = physOf(p);
  const qbm = p.perception.memory.QB;
  const goal = qbm || { x: CX, y: LOS - 5, vx: 0, vy: 0 };

  if (world.sinceSnap < 0.45 && !p.blockers.length) {
    const gx = /^[A-D]-[LR]$/.test(p.assignment.gap || "") ? gapPoint(p, world, p.assignment.gap) : p.home.x;
    return {
      key: "rush", label: `Attack ${p.assignment.gap}`, reason: "get-off to the gap landmark", score: 1.5,
      moveTo: { x: gx, y: LOS - 1.5 }, speed: ph.top, arrive: false,
    };
  }

  if (p.blockers.length) {
    // Work to the blocker's open shoulder; counter when he's squared up.
    const b = world.byId[p.blockers[0]];
    const gdir = angleTo(p.x, p.y, goal.x, goal.y);
    const rel = angDiff(angleTo(p.x, p.y, b.x, b.y), gdir);
    let why;
    if (Math.abs(rel) > 0.35) {
      p.rushSide = rel > 0 ? -1 : 1;
      why = `${b.id} is off my line — attack his open shoulder`;
    } else {
      if (world.t > p.moveTimer) {
        p.rushSide = world.rng() < 0.5 ? -1 : 1;
        p.moveTimer = world.t + 0.5 + world.rng() * 0.7;
      }
      why = `${b.id} squared up — counter move`;
    }
    const dir = gdir + p.rushSide * 65 * DEG;
    return {
      key: "rush", label: `Rush: work ${Math.cos(dir) > 0 ? "right" : "left"} of ${b.id}`, reason: why, score: 1.5,
      dir, speed: ph.top, face: gdir,
    };
  }

  const ip = interceptMover(p, goal);
  return {
    key: "rush", label: "Rush the QB",
    reason: qbm && qbm.vis < 0.15 ? "QB out of sight — estimating" : `free — closing, meet in ${fmt(ip.t)}s`,
    score: 1.5, moveTo: { x: ip.x, y: ip.y }, speed: ph.top, arrive: false, debug: { kind: "pursuit", point: ip },
  };
}

function manOrDog(p, world) {
  const tid = p.assignment.cover.target;
  const m = p.perception.memory[tid];
  const man = manOptions(p, world);
  // His man stayed in to block — nobody to cover, so add to the rush.
  if (m && world.sinceSnap > 0.8 && (m.engaged || (Math.hypot(m.vx, m.vy) < 2.5 && depthOf(m.y) < -2))) {
    const r = rushOption(p, world);
    return [{ ...r, label: `${tid} stayed in — green-dog rush`, reason: r.reason, score: 1.9 }, ...man];
  }
  return man;
}

// ── Has the offense shown pass? A linebacker reads the offensive line: run
// blockers fire out at him, pass protectors set back. Retreating linemen
// (his belief swings to pass), the QB winding up, or a ball in the air —
// that's pass. Anything else he plays as run. ──
const FORCE_SAFETY_COMMIT = 0.52; // run belief a force safety needs to come up (deep DBs need ~0.72)

function passShown(p, world) {
  if (world.ball.state === "air" || world.throwCharging) return true;
  return world.sinceSnap > 0.2 && p.belief.pRun < 0.4;
}

// ── Linebacker on a run read: downhill, now. He fits his gap from the
// inside out, flowing with the back's track, and attacks it to meet the
// back in the backfield — taking away the inside lanes so the ball has to
// bubble outside, to the force player setting the edge. A force / alley
// man keeps his leverage: outside / inside-out, a couple of yards off.
// (Once the back has the ball and is coming, runOption takes over.) ──
function downhillOption(p, world) {
  const gap = p.assignment.gap || "";
  const mem = p.perception.memory;
  const key = mem.RB && mem.RB.conf > 0.3 ? mem.RB : mem.QB;
  const top = physOf(p).top;
  const face = key ? { x: key.x, y: key.y } : null;
  if (gap.startsWith("force") || gap.startsWith("alley")) {
    const side = gap.endsWith("L") ? -1 : 1;
    const pt = gap.startsWith("force") ? { x: Math.max(side * p.home.x, side * (CX + side * 5.5)) * side, y: LOS + 1.5 } : { x: p.home.x, y: LOS + 2.5 };
    return {
      key: "downhill", urgent: true, label: gap.startsWith("force") ? "Set the edge — keep it inside" : "Alley — inside-out, a step behind",
      reason: `run ${pct(p.belief.pRun)} — ${gap}`, score: 2.1, moveTo: pt, speed: top * 0.9, face, debug: { kind: "fit", point: pt },
    };
  }
  // His gap's landmark moves with the offensive line (gapPoint follows their
  // flow — zone steps one way, he steers that way), and he leans toward the
  // back's track: no stopping to read, just a redirect as he comes.
  const gx = /^[A-D]-[LR]$/.test(gap) ? gapPoint(p, world, gap) : p.home.x;
  const scripted = !!(world.config.fits && world.config.fits[p.id]);
  const track = key ? key.x + key.vx * 0.6 : gx;
  const fx = scripted ? gx : gx + clamp(track - gx, -1.5, 1.5) * 0.5;
  // How sure he is where the ball's going: from the snap he's coming
  // downhill to the line at two-thirds speed; as the read firms up he
  // speeds up and runs through it, into the backfield.
  const sure = clamp((p.belief.pRun - 0.45) / 0.3, 0, 1);
  const pt = { x: fx, y: lerp(LOS + 1.2, LOS - 0.6, sure) };
  return {
    key: "downhill", urgent: true, label: sure < 1 ? `Downhill — keying the line, ${gap || "the ball"}` : `Downhill — fit ${gap || "the ball"}, meet the back`,
    reason: `run ${pct(p.belief.pRun)} — line flowing ${fmt(fx - (GAPS[gap] != null ? CX + GAPS[gap] : p.home.x), 1)}`,
    score: 2.1, moveTo: pt, speed: top * (0.65 + 0.35 * sure), face, debug: { kind: "fit", point: pt },
  };
}
