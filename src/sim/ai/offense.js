// src/sim/ai/offense.js
// ── Offensive AI by assignment. Blockers keep blocking when the ball is in
// the air (their role gives a thrown pass zero priority); receivers switch
// from route to ball once *they* have acquired it; after a catch, the
// other receivers turn into blockers for the new ball carrier. ──

import { CX, LOS, OL_SPLIT } from "../field.js";
import { physOf } from "../player.js";
import { angDiff, angleTo, clamp, fmt, lerp } from "../math.js";
import { DEG, TUNING } from "../config.js";
import { decide } from "./intent.js";
import { ballOption } from "./common.js";
import { routeOption, headToward } from "./routes.js";
import { ROUTES } from "../playbook.js";
import { interceptMover } from "../systems/kinematics.js";
import { screenReleased, screenFocus } from "./screens.js";

export function thinkOffense(p, world) {
  switch (p.assignment.kind) {
    case "route":
      return thinkReceiver(p, world);
    case "stalk":
      return thinkStalk(p, world);
    case "passPro":
      return thinkPassPro(p, world);
    case "screen":
    case "screenBlock":
      return thinkScreenBlock(p, world);
    case "zoneBlock":
      return thinkZoneBlock(p, world);
    case "rbPro":
      return thinkRbPro(p, world);
    case "qbMesh":
      return thinkQbMesh(p, world);
    case "zoneBack":
      return thinkZoneBack(p, world);
    case "kickout":
      return thinkKickout(p, world);
    case "fakeBack":
      return thinkFakeBack(p, world);
    case "lead":
      return thinkLead(p, world);
    case "pitchBack":
      return thinkPitchBack(p, world);
    case "human":
      if (world.faking()) return thinkQbFake(p, world);
    // falls through
    default:
      // A human-assigned player who isn't currently under control (the QB
      // after he's thrown) — ease up and watch.
      return decide(p, world, [
        { key: "idle", label: "Watching the play", reason: "not under control", score: 1, speed: 0, face: world.ball },
      ]);
  }
}

// Stay between a defender and the thing being protected, squared up to him.
function blockBetween(p, m, protect, label, reason, drive = 0.7) {
  const g = angleTo(m.x, m.y, protect.x, protect.y);
  return {
    key: `block:${m.id}`,
    label,
    reason,
    score: 1,
    moveTo: { x: m.x + Math.cos(g) * drive, y: m.y + Math.sin(g) * drive },
    speed: physOf(p).top,
    arrive: false,
    face: { x: m.x, y: m.y },
  };
}

function withId(p, id) {
  const m = p.perception.memory[id];
  return m ? { ...m, id } : null;
}

// Route running (dynasty): how crisp he is on this route — short (breaks
// inside 6 yards), intermediate (to 12) or deep — applies while he runs it.
function routeBand(name) {
  let depth = 0;
  for (const leg of ROUTES[name] || []) if (leg.type === "stem") depth = Math.max(depth, leg.depth);
  return depth <= 6 ? "short" : depth <= 12 ? "mid" : "deep";
}

function thinkReceiver(p, world) {
  const chosen = receiverIntent(p, world);
  p.routeBoost = chosen && chosen.key === "route" && p.traits.route ? p.traits.route[routeBand(p.assignment.route)] : 1;
  // Chasing a thrown ball: head around to it, shoulders where he's running.
  if (chosen && chosen.key === "ball" && p.perception.ball.seeing) headToward(p, world.ball);
  return chosen;
}

function receiverIntent(p, world) {
  const opts = [ballOption(p, world)];
  const carrier = world.carrier();
  if (carrier && carrier.team === "O" && carrier.id !== "QB" && carrier !== p) {
    // After the catch: block for him.
    p.protectPoint = { x: carrier.x, y: carrier.y };
    const m = p.blockTarget ? withId(p, p.blockTarget) : null;
    if (m)
      opts.push({
        ...blockBetween(p, m, carrier, `Blocking ${m.id} for ${carrier.id}`, "ball caught — convoy"),
        key: "convoy",
        score: 2,
      });
    else
      opts.push({
        key: "convoy", label: `Convoy for ${carrier.id}`, reason: "no defender near", score: 2,
        moveTo: { x: lerp(p.x, carrier.x, 0.5), y: carrier.y + 4 }, speed: physOf(p).top * 0.8,
      });
  } else {
    opts.push(routeOption(p, world));
  }
  return decide(p, world, opts);
}

function thinkStalk(p, world) {
  const carrier = world.carrier() || world.byId.RB;
  p.protectPoint = { x: carrier.x, y: carrier.y };
  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  if (!m)
    return decide(p, world, [
      { key: "stalk", label: "Stalk — find a man", reason: "no DB in range", score: 1, moveTo: { x: p.x, y: p.y + 3 }, speed: 4 },
    ]);
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  const o = blockBetween(
    p, m, carrier,
    p.engagedWith ? `Stalk block on ${m.id}` : `Stalk: approach ${m.id}`,
    p.engagedWith ? "engaged — stay between him and the ball" : `${fmt(d, 1)} yd — break down before contact`
  );
  if (!p.engagedWith && d > 2.5) o.speed = d > 5 ? physOf(p).top : 4;
  o.key = "stalk";
  return decide(p, world, [o]);
}

// ── Screens: sell pass (the line), then lead it — take the man
// assignScreen gave you and stay between him and the ball; nobody yet, get
// out in front of it. ──
function thinkScreenBlock(p, world) {
  if (!screenReleased(p, world)) return thinkPassPro(p, world);
  const focus = screenFocus(world);
  p.protectPoint = { x: focus.x, y: focus.y };
  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  if (!m) {
    const inside = Math.sign(CX - focus.x) || 1;
    return decide(p, world, [
      {
        key: "screenLead", label: "Screen — release, get in front", reason: `leading for ${focus.id}`, score: 1,
        moveTo: { x: focus.x + inside * 1.5, y: Math.max(focus.y + 3, LOS + 1.5) }, speed: physOf(p).top, arrive: false,
      },
    ]);
  }
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  const o = blockBetween(p, m, focus, p.engagedWith ? `Screen block on ${m.id}` : `Screen — go get ${m.id}`, `${fmt(d, 1)} yd — keep him off ${focus.id}`);
  o.key = "screenBlock";
  return decide(p, world, [o]);
}

function thinkPassPro(p, world) {
  const qb = world.byId.QB;
  p.protectPoint = { x: qb.x, y: qb.y };
  const setY = LOS - 1.4 - Math.min(1.0, world.sinceSnap * 0.8);
  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  if (!m)
    return decide(p, world, [
      {
        key: "set", label: "Pass set — no rusher", reason: "scanning for threats", score: 1,
        moveTo: { x: p.home.x, y: setY }, speed: 4, face: Math.PI / 2,
      },
    ]);
  const d = Math.hypot(m.x - p.x, m.y - p.y);
  let o;
  if (d > 3) {
    // Kick-slide to a set point between the rusher's path and the pocket.
    o = {
      key: `block:${m.id}`, label: `Pass set vs ${m.id}`, reason: `${fmt(d, 1)} yd away`, score: 1,
      moveTo: { x: lerp(p.home.x, m.x, 0.45), y: Math.max(setY - 0.6, Math.min(setY, m.y - 1.5)) },
      speed: physOf(p).top, face: { x: m.x, y: m.y },
    };
  } else {
    o = blockBetween(p, m, qb, p.engagedWith ? `Pass pro: on ${m.id}` : `Pass pro: meet ${m.id}`, "keep him off the QB");
    // Unengaged, a pass protector gives ground to his set depth and lets the
    // rusher come to him — he doesn't go get him.
    if (!p.engagedWith) o.moveTo.y = Math.min(o.moveTo.y, setY);
    // Never give up the inside: shade to the rusher's inside half (the short
    // way to the QB goes through the chest), and don't chase a wide rusher
    // out of the pocket — a tackle kicks out a couple of yards and makes the
    // edge take the long way around him.
    const out = Math.sign(p.home.x - CX);
    o.moveTo.x -= out * 0.35;
    const reach = out ? 2.0 : 1.5;
    o.moveTo.x = out > 0 ? Math.min(o.moveTo.x, p.home.x + reach) : out < 0 ? Math.max(o.moveTo.x, p.home.x - reach) : clamp(o.moveTo.x, p.home.x - reach, p.home.x + reach);
  }
  return decide(p, world, [o]);
}

function thinkRbPro(p, world) {
  const qb = world.byId.QB;
  p.protectPoint = { x: qb.x, y: qb.y };
  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  if (!m)
    return decide(p, world, [
      {
        key: "scan", label: "Pass pro — scanning", reason: "no free rusher", score: 1,
        moveTo: { x: qb.x + (Math.sign(p.home.x - CX) || -1) * 1.3, y: qb.y + 0.3 }, speed: 5, face: Math.PI / 2,
      },
    ]);
  return decide(p, world, [blockBetween(p, m, qb, `Picking up ${m.id}`, "free rusher toward the QB")]);
}

const UP = Math.PI / 2;
// Shoulders stay square to the line: turn toward the man only so far.
const square = (p, m, limit = 35) => UP + clamp(angDiff(angleTo(p.x, p.y, m.x, m.y), UP), -limit * DEG, limit * DEG);

// Where a climbing lineman aims for a linebacker: his playside number while
// he's reading — but once he triggers toward the ball, get in between him
// and it (a backer fitting back inside can't be run past). A man coming
// downhill gets met, not waited for: lead him less once close, and never
// give ground back toward the backfield.
function climbPoint(p, m, dx, world) {
  const lead = Math.hypot(m.x - p.x, m.y - p.y) < 2.5 ? 0.15 : 0.5;
  const aim = { x: m.x + m.vx * lead + dx, y: m.y + m.vy * lead - 0.3 };
  const ball = world.byId[world.ball.carrierId] || world.byId.RB;
  if (ball && ball.team === "O") {
    const bx = ball.x - m.x;
    const by = ball.y - m.y;
    const L = Math.hypot(bx, by) || 1;
    const toward = (m.vx * bx + m.vy * by) / L; // his speed toward the ball
    const w = clamp(toward / 3, 0, 1);
    const between = { x: m.x + m.vx * lead + (bx / L) * 1.0, y: m.y + m.vy * lead + (by / L) * 1.0 };
    aim.x = lerp(aim.x, between.x, w);
    aim.y = lerp(aim.y, between.y, w);
  }
  aim.y = Math.max(aim.y, p.y + 0.2);
  return aim;
}

function thinkZoneBlock(p, world) {
  if (p.assignment.scheme === "power") return thinkPowerBlock(p, world);
  const chosen = zoneBlockIntent(p, world);
  // Play action: sell the run, but no lineman goes downfield on a pass.
  if (p.assignment.pa && p.y > LOS + 0.6 && p.desired.dir != null && Math.sin(p.desired.dir) > 0) {
    p.desired.dir = Math.cos(p.desired.dir) >= 0 ? 0 : Math.PI;
  }
  return chosen;
}

function zoneBlockIntent(p, world) {
  // Zone blocks are won or lost at the shoulder, not by who's nearer the
  // back: a DL washed to the backside is exactly what the scheme wants.
  p.protectPoint = null;
  const ps = p.assignment.playside || 1;
  const job = p.zoneJob || { kind: "climb" };
  const top = physOf(p).top;
  // Outside zone: the same rules, but everything is wider — a bigger reach
  // step and aiming points on the defender's outside number.
  const wide = p.assignment.scheme === "outside";

  // QB draw: show pass set first — kick back, hands up — then run block.
  if (p.assignment.sell && world.sinceSnap < p.assignment.sell)
    return decide(p, world, [
      {
        key: "sell", label: "Draw — show pass set", reason: `run block in ${(p.assignment.sell - world.sinceSnap).toFixed(2)}s`, score: 1,
        moveTo: { x: p.home.x, y: LOS - 1.6 }, speed: 3.2, face: UP,
      },
    ]);
  // First step: lateral, playside, square to the line of scrimmage.
  if (world.sinceSnap < 0.22)
    return decide(p, world, [
      {
        key: "zoneStep", label: wide ? "Reach step — wide, square" : "Zone step — lateral, square", reason: `playside ${ps > 0 ? "right" : "left"}`, score: 1,
        moveTo: { x: p.home.x + (wide ? 1.1 : 0.6) * ps, y: p.home.y + 0.1 }, speed: wide ? 4.2 : 3.2, face: UP,
      },
    ]);

  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  if (!m)
    return decide(p, world, [
      {
        key: "climb", label: "Climb — nobody home", reason: "no one in my area or at the 2nd level", score: 1,
        moveTo: { x: p.home.x + 1.5 * ps, y: LOS + 3.5 }, speed: top, face: UP,
      },
    ]);

  const combo = job.kind === "combo" ? job.combo : null;
  const onLB = (combo && combo.climber === p.id) || job.kind === "climb";
  const partner = combo ? (combo.play === p.id ? combo.back : combo.play) : null;
  let o;
  if (onLB) {
    // Up to the linebacker: cut off where he's going, keep playside leverage.
    o = {
      key: `block:${m.id}`,
      label: p.engagedWith ? `Walling off ${m.id}` : `Climb to ${m.id}`,
      reason: combo ? `came off the ${combo.dl} combo — ${partner} has him` : "uncovered — second level",
      score: 1,
      // A linebacker coming downhill gets met, not waited for: close in,
      // lead him less, and never give ground back toward the backfield.
      moveTo: climbPoint(p, m, 0.4 * ps, world),
      speed: top, arrive: false, face: square(p, m, 60),
    };
  } else if (p.engagedWith) {
    // Drive him: feet keep driving straight up the field while the blocker
    // slides to keep his head on the defender's playside number (backside
    // number for the backside man of a combo). Shoulders stay square —
    // aiming *through* him instead just slides the blocker around him.
    // Once his partner climbs, the man left on the DL takes over his playside.
    // Outside zone: work to get outside his outside shoulder.
    // He runs his feet to stay on him: match the defender's movement (as he
    // reads it) and keep his body on the fit — on the defender's side of
    // him, never driving past a man who's working back down the line.
    const fit = combo && combo.back === p.id && !combo.climber ? -0.3 : wide ? 0.75 : 0.3;
    const mv = p.perception.memory[m.id] || m;
    const fx = m.x + fit * ps;
    const fy = m.y - 0.75;
    let vx = mv.vx + 2.4 * (fx - p.x);
    let vy = mv.vy + 2.4 * (fy - p.y);
    // He's in front of me and square: drive him.
    if (m.y - p.y > 0.4) vy += 1.2;
    const sp = Math.hypot(vx, vy);
    o = {
      key: `block:${m.id}`,
      label: combo ? `Combo on ${m.id} (eyes ${combo.lb || "—"})` : wide ? `Reach block ${m.id}` : `Drive block ${m.id}`,
      reason: combo
        ? combo.climber
          ? `${partner} climbed — I take over ${m.id}`
          : `double with ${partner} until ${combo.lb || "the LB"} declares`
        : "he's in my playside gap",
      score: 1,
      dir: Math.atan2(vy, vx), speed: Math.min(top, sp), face: square(p, m, 45),
    };
  } else {
    // Get to him — playside half on a base block or as the playside man of
    // a combo; backside half as the backside man.
    const aimX = combo && combo.back === p.id ? (wide ? 0.1 : -0.25) : wide ? 0.85 : 0.25;
    o = {
      key: `block:${m.id}`,
      label: combo ? `Combo step → ${m.id}` : wide ? `Reach → ${m.id}'s outside shoulder` : `Zone step → ${m.id}`,
      reason: combo ? `${m.id} shared with ${partner}` : "covered — he's in my area",
      score: 1,
      moveTo: { x: m.x + aimX * ps, y: m.y - 0.55 }, speed: top, arrive: false, face: square(p, m),
    };
  }
  return decide(p, world, [o]);
}

// ── Split zone: H comes across the formation behind the line and kicks out
// the backside end — inside-out: he aims at the end's inside number (so the
// end can't squeeze underneath him) and drives him toward the sideline. ──
function thinkKickout(p, world) {
  p.protectPoint = null;
  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  if (!m)
    return decide(p, world, [{ key: "kick", label: "Kickout — nobody to kick", reason: "", score: 1, moveTo: { x: p.x, y: LOS - 1 }, speed: 4 }]);
  return kickoutAction(p, world, m, "Split — cross the formation");
}

// Kick a man out, inside-out: hunt where he's going to be, get to his inside
// number staying behind the line, then drive him to the sideline.
function kickoutAction(p, world, m, travelLabel) {
  const top = physOf(p).top;
  const side = Math.sign(m.x - CX) || 1; // the side he's kicking to
  if (p.engagedWith) {
    const lateral = 2.2 * (m.x - side * 0.35 - p.x) - 0.6 * (p.vx - m.vx) + side * 1.5; // stay inside, push out
    return decide(p, world, [
      {
        key: `block:${m.id}`, label: `Kicking out ${m.id}`, reason: "inside-out — drive him to the sideline", score: 1,
        dir: Math.atan2(0.6, lateral), speed: top, face: { x: m.x, y: m.y },
      },
    ]);
  }
  // Hunt him where he's going to be — squeezing, crashing or sitting — and
  // get to his inside number, staying behind the line on the way across.
  const ip = interceptMover(p, m);
  const pt = { x: ip.x - side * 0.4, y: Math.min(ip.y - 0.3, LOS - 0.3) };
  const across = side * (p.x - CX) > 2 * OL_SPLIT - 1;
  return decide(p, world, [
    {
      key: `block:${m.id}`, label: across ? `Kick out ${m.id}` : travelLabel,
      reason: `${m.id} is the backside end — meet him in ${ip.t.toFixed(2)}s`,
      score: 1, moveTo: pt, speed: top, arrive: false, face: { x: m.x, y: m.y },
    },
  ]);
}

// ── Power technique (the call is in zoneScheme.js buildPowerCall). ──
function thinkPowerBlock(p, world) {
  const chosen = powerBlockIntent(p, world);
  // Play action: sell the run, but no lineman goes downfield on a pass.
  if (p.assignment.pa && p.y > LOS + 0.6 && p.desired.dir != null && Math.sin(p.desired.dir) > 0) {
    p.desired.dir = Math.cos(p.desired.dir) >= 0 ? 0 : Math.PI;
  }
  return chosen;
}

function powerBlockIntent(p, world) {
  p.protectPoint = null;
  const ps = p.assignment.playside || 1;
  const job = p.zoneJob || { kind: "climb" };
  const top = physOf(p).top;
  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  // Play action: a lineman with no one to block on the line holds the line
  // (in a real power he'd climb; on a pass he can't).
  if (p.assignment.pa && job.kind === "climb")
    return decide(p, world, [
      {
        key: "paHold", label: "Play action — hold the line", reason: "can't go downfield on a pass", score: 1,
        moveTo: { x: p.home.x, y: LOS - 0.6 }, speed: 3, face: UP,
      },
    ]);
  if (job.kind === "pull") {
    if (world.sinceSnap < 0.18)
      return decide(p, world, [
        {
          key: "pull", label: "Pull — open step", reason: "backside guard pulls", score: 1,
          moveTo: { x: p.home.x + 0.5 * ps, y: p.home.y - 0.9 }, speed: 4, face: ps > 0 ? 0 : Math.PI,
        },
      ]);
    if (!m)
      return decide(p, world, [{ key: "pull", label: "Pull — nobody to kick", reason: "", score: 1, moveTo: { x: p.x + 2 * ps, y: LOS - 1.2 }, speed: top }]);
    return kickoutAction(p, world, m, "Pull — skip behind the line");
  }
  if (job.kind === "hinge") return pullCheck(p, world, job, ps);
  if (job.kind === "wrap") return wrapAction(p, world, m, ps);
  const combo = job.kind === "combo" ? job.combo : null;
  const onLB = (combo && combo.climber === p.id) || job.kind === "climb";
  if (!m)
    return decide(p, world, [
      {
        key: "climb", label: "Climb — nobody home", reason: "no one down or to the second level", score: 1,
        moveTo: { x: p.home.x - ps, y: LOS + 3.5 }, speed: top, face: UP,
      },
    ]);
  if (onLB)
    return decide(p, world, [
      {
        key: `block:${m.id}`, label: p.engagedWith ? `Walling off ${m.id}` : `Climb to ${m.id}`,
        reason: combo ? `came off the ${combo.dl} double` : "no one down — backer", score: 1,
        moveTo: climbPoint(p, m, -0.4 * ps, world), speed: top, arrive: false, face: square(p, m, 60),
      },
    ]);
  // Down block (or block back): get your head across his playside number
  // and drive him toward the backside.
  const back = job.back;
  const label = combo ? `Double down on ${m.id} (eyes ${combo.lb || "—"})` : back ? `Block back on ${m.id}` : `Down block ${m.id}`;
  if (p.engagedWith) {
    const lateral = 2.2 * (m.x + 0.35 * ps - p.x) - 0.6 * (p.vx - m.vx) - 1.2 * ps;
    return decide(p, world, [
      {
        key: `block:${m.id}`, label, reason: "head across, drive him to the backside", score: 1,
        dir: Math.atan2(0.7, lateral), speed: top, face: square(p, m, 70),
      },
    ]);
  }
  return decide(p, world, [
    {
      key: `block:${m.id}`, label, reason: "step down — take away his playside", score: 1,
      moveTo: { x: m.x + 0.4 * ps, y: m.y - 0.45 }, speed: top, arrive: false, face: square(p, m, 70),
    },
  ]);
}

// ── Counter wrap (the backside tackle): open and pull behind the guard,
// turn up through the hole outside the playside tackle's down block, and
// lead on the playside linebacker. ──
function wrapAction(p, world, m, ps) {
  const top = physOf(p).top;
  if (world.sinceSnap < 0.25)
    return decide(p, world, [
      {
        key: "wrap", label: "Wrap — open and pull", reason: "backside tackle follows the guard", score: 1,
        moveTo: { x: p.home.x + 0.4 * ps, y: p.home.y - 1.2 }, speed: 4.2, face: ps > 0 ? 0 : Math.PI,
      },
    ]);
  const tackle = world.byId[ps > 0 ? "RT" : "LT"];
  const holeX = tackle.home.x + 0.6 * ps;
  if (!p.leadUp && p.y < LOS - 0.3 && ps * (holeX - p.x) > 0.8)
    return decide(p, world, [
      {
        key: "wrap", label: "Wrap — behind the guard to the hole", reason: `inside the kick-out, outside ${tackle.id}`, score: 1,
        moveTo: { x: holeX, y: LOS - 0.6 }, speed: top, arrive: false,
      },
    ]);
  p.leadUp = true;
  if (!m)
    return decide(p, world, [
      { key: "wrap", label: "Wrap — up through the hole", reason: "no backer to lead on", score: 1, moveTo: { x: holeX, y: LOS + 4 }, speed: top, arrive: false },
    ]);
  return decide(p, world, [
    {
      key: `block:${m.id}`, label: p.engagedWith ? `Wrap — on ${m.id}` : `Wrap — up the hole on ${m.id}`, reason: "playside backer", score: 1,
      moveTo: { x: m.x + m.vx * 0.4, y: m.y + m.vy * 0.4 - 0.4 }, speed: top, arrive: false, face: { x: m.x, y: m.y },
    },
  ]);
}

// ── Pull check (the tackle next to the pulling guard): step inside, turn
// the shoulders away from the pull — toward the backside — and keep the man
// he's got (the man in his inside gap, or the backside end) from crashing
// down after it: stay between him and the gap the guard left. With nobody
// assigned, take the first man who shows up in that gap. ──
function pullCheck(p, world, job, ps) {
  const gap = { x: p.home.x + 0.8 * ps, y: LOS - 1.1 };
  const away = UP + ps * 0.8; // shoulders turned to the backside
  let m = job.dl ? withId(p, job.dl) : null;
  if (!m) {
    // Anyone closing on the vacated gap.
    let best = null;
    for (const [id, mm] of Object.entries(p.perception.memory)) {
      if (mm.conf < 0.3) continue;
      const d = Math.hypot(mm.x - gap.x, mm.y - gap.y);
      if (d < 3 && (!best || d < best.d)) best = { d, m: { ...mm, id } };
    }
    if (best) m = best.m;
  }
  if (m) {
    p.blockTarget = m.id;
    const o = blockBetween(p, m, gap, `Pull check — wall off ${m.id}`, "shoulders away from the pull — he doesn't crash down");
    return decide(p, world, [{ ...o, key: "pullCheck" }]);
  }
  return decide(p, world, [
    {
      key: "pullCheck", label: "Pull check — sit in the gap", reason: "shoulders away from the pull", score: 1,
      moveTo: gap, speed: 4, face: away,
    },
  ]);
}

// ── Power lead (H): up through the hole — just outside the playside down
// block, inside the kickout — and on the playside linebacker. ──
function thinkLead(p, world) {
  p.protectPoint = null;
  const ps = (world.zone && world.zone.ps) || 1;
  const top = physOf(p).top;
  const m = p.blockTarget ? withId(p, p.blockTarget) : null;
  // QB draw: stay in pass pro for the sell, then lead through the A/B gap.
  if (p.assignment.sell && world.sinceSnap < p.assignment.sell + 0.1) {
    const qb = world.byId.QB;
    return decide(p, world, [
      {
        key: "lead", label: "Draw — show pass pro", reason: "sell it, then lead", score: 1,
        moveTo: { x: qb.x + 1.2 * (Math.sign(p.home.x - qb.x) || 1), y: qb.y + 0.6 }, speed: 3, face: UP,
      },
    ]);
  }
  const inside = p.assignment.hole === "inside";
  const tackle = world.byId[ps > 0 ? "RT" : "LT"];
  const guard = world.byId[ps > 0 ? "RG" : "LG"];
  const holeX = inside ? guard.home.x - 0.7 * ps : tackle.x + 0.9 * ps;
  // Get to the hole first, then turn up on the backer.
  if (!p.leadUp && p.y < LOS - 0.3 && Math.abs(p.x - holeX) > 0.8)
    return decide(p, world, [
      {
        key: "lead", label: "Lead — to the hole", reason: `outside ${tackle.id}'s down block`, score: 1,
        moveTo: { x: holeX, y: LOS - 0.2 }, speed: top, arrive: false,
      },
    ]);
  // His man is a rusher coming off the edge (the draw vs. a five-man
  // front): pick him up between him and the QB.
  if (m && m.y < LOS + 1 && inside) {
    const o = blockBetween(p, m, world.byId.QB, `Draw — pick up ${m.id}`, "the rusher nobody on the line has");
    return decide(p, world, [{ ...o, key: "lead" }]);
  }
  p.leadUp = true;
  if (!m)
    return decide(p, world, [
      { key: "lead", label: "Lead — up through the hole", reason: "no backer to lead on", score: 1, moveTo: { x: holeX, y: LOS + 4 }, speed: top, arrive: false },
    ]);
  return decide(p, world, [
    {
      key: "lead", label: p.engagedWith ? `Leading on ${m.id}` : `Lead — up through the hole on ${m.id}`,
      reason: "first backer playside", score: 1,
      moveTo: { x: m.x + m.vx * 0.4, y: m.y + m.vy * 0.4 - 0.4 }, speed: top, arrive: false, face: { x: m.x, y: m.y },
    },
  ]);
}

// ── Play action. The QB rides the back as on the real play; the back takes
// the track, gets "the ball" at the mesh (the fake — defenders who see it
// think he has it, see perception.js) and runs the fake into the line. ──
const fakeName = (world) => (world.play.fake === "inside" ? "split zone" : world.play.fake);

function thinkQbFake(p, world) {
  const rb = world.byId.RB;
  return decide(p, world, [
    {
      key: "fake", label: `Play-action — fake ${fakeName(world)}`, reason: "ride the back, then he's yours", score: 1,
      moveTo: { x: CX, y: LOS - 5 }, speed: 2, face: { x: rb.x, y: rb.y },
    },
  ]);
}

function thinkFakeBack(p, world) {
  const ps = world.fakeSide || 1;
  if (world.sinceSnap < TUNING.mesh.arrive && !p.faked) return meshTrack(p, world, { x: CX + 4 * ps, y: LOS + 4 });
  if (!p.faked) {
    p.faked = true;
    p.fakeUntil = world.t + 0.45;
    world.log(p, "Fake handoff", `sell ${fakeName(world)}`);
  }
  return decide(p, world, [
    {
      key: "fake", label: "Carry out the fake", reason: `sell ${fakeName(world)}`, score: 1,
      moveTo: { x: CX + 2.8 * ps, y: LOS + 1 }, speed: physOf(p).top, arrive: false,
    },
  ]);
}

// ── The mesh track: until he has the ball the back is on rails to the mesh
// point — timed to get there as the ride starts — so the exchange always
// happens. On a zone read he then rides across the QB's face (ball in the
// belly) until the give; on play action the fake is the exchange. Control
// is the player's the moment the ball is. ──
export function meshTrack(p, world, aim) {
  const M = TUNING.mesh;
  const qb = world.byId.QB;
  const ps = (world.zone && world.zone.ps) || 1;
  const mesh = world.meshPoint();
  p.debug.intentPoint = { x: aim.x, y: aim.y };
  if (!world.fakeSide && world.play.read && world.sinceSnap >= M.arrive) {
    // The ride: slow, square downhill, drifting across the QB's face.
    const end = { x: mesh.x + 0.9 * ps, y: mesh.y + 0.35 };
    const left = Math.max(0.1, world.giveAt() - world.sinceSnap);
    const d = Math.hypot(end.x - p.x, end.y - p.y);
    return decide(p, world, [
      {
        key: "meshTrack", label: "Mesh — riding the ball", reason: `give in ${left.toFixed(2)}s unless the QB pulls it`, score: 1,
        moveTo: end, speed: clamp(d / left, 0.8, 3), face: Math.PI / 2,
      },
    ]);
  }
  // Counter: a jab step away from the play first — sell the backside run.
  if (world.play.counter && world.sinceSnap < 0.28)
    return decide(p, world, [
      {
        key: "meshTrack", label: "Counter step", reason: "jab away — then come back across", score: 1,
        moveTo: { x: p.home.x - 0.9 * ps, y: p.home.y + 0.25 }, speed: 4, face: null,
      },
    ]);
  // From straight behind the QB (pistol), come around him, not through him.
  const behind = Math.abs(p.x - qb.x) < 0.8 && p.y < qb.y - 0.5;
  const target = behind ? { x: qb.x + 0.9 * ps, y: qb.y - 0.2 } : mesh;
  const d = Math.hypot(target.x - p.x, target.y - p.y) + (behind ? Math.hypot(mesh.x - target.x, mesh.y - target.y) : 0);
  const left = Math.max(0.15, M.arrive - world.sinceSnap);
  const speed = clamp(d / left, 2, physOf(p).top);
  return decide(p, world, [
    {
      key: "meshTrack", label: "Mesh track", reason: `to the mesh in ${left.toFixed(2)}s`, score: 1,
      moveTo: target, speed, arrive: false, face: null,
    },
  ]);
}

// ── Speed option pitch man: keep the relationship — 4½ yards outside the
// QB and a yard behind him — with his head on the QB; when it's pitched,
// go get it (ballOption); if the QB keeps, get in front of him. ──
function thinkPitchBack(p, world) {
  const qb = world.byId.QB;
  const ps = (world.zone && world.zone.ps) || world.play.side || 1;
  const top = physOf(p).top;
  const opts = [ballOption(p, world)];
  if (!world.pitched) {
    const past = qb.y > LOS + 0.8;
    const tgt = past
      ? { x: p.x + ps * 0.5, y: qb.y + 3 } // he kept it — lead him upfield
      : { x: qb.x + ps * 4.5 + qb.vx * 0.25, y: Math.min(qb.y - 1.0, LOS - 0.4) + qb.vy * 0.25 };
    opts.push({
      key: "pitch", label: past ? "QB kept it — get in front" : "Pitch relationship — 4½ out, 1 back",
      reason: past ? "lead downfield" : "eyes on the QB", score: 1, moveTo: tgt, speed: top, arrive: false,
    });
  } else {
    opts.push({ key: "pitch", label: "Pitch — find the ball", reason: "", score: 0.5, moveTo: { x: p.x + ps, y: p.y + 1 }, speed: top, arrive: false });
  }
  const chosen = decide(p, world, opts);
  if (!p.hasBall) headToward(p, world.ball.state === "air" ? world.ball : qb);
  return chosen;
}

// Inside zone back when the QB has pulled it (or before the human takes
// him): carry out the fake — keep running the track into the line.
function thinkZoneBack(p, world) {
  const ps = world.byId.LT.assignment.playside || 1;
  return decide(p, world, [
    {
      key: "fake", label: "Carry out the fake", reason: "QB pulled it", score: 1,
      moveTo: { x: CX + 2.2 * ps, y: LOS + 3 }, speed: physOf(p).top, arrive: false,
    },
  ]);
}

// ── Zone read: ride the back with eyes on the unblocked backside end.
// The pull decision is the player's (Space) — the QB just reports what he
// sees: where he believes the read man will be in half a second, and
// whether that's squeezing inside the tackle / closing on the back's track. ──
function thinkQbMesh(p, world) {
  const rb = world.byId.RB;
  if (p.hasBall && world.ball.carrierId === "QB" && !world.qbKeep) {
    const z = world.zone;
    const readId = z && z.readId;
    const m = readId ? p.perception.memory[readId] : null;
    let reason = "no read man";
    // Reads off what he last saw — the back crossing his face blocks the
    // view for a moment, it doesn't erase the read.
    if (m && m.conf >= 0.4) {
      const ps = z.ps;
      const px = m.x + m.vx * 0.5;
      const py = m.y + m.vy * 0.5;
      const backTackle = world.byId[ps > 0 ? "LT" : "RT"];
      const inside = clamp((ps * (px - backTackle.home.x) + 0.3) / 1.2, 0, 1);
      const onTrack = clamp(1 - Math.hypot(px - (CX + 0.5 * ps), py - (LOS - 3.5)) / 4, 0, 1);
      const flat = clamp((ps * m.vx) / 3.5, 0, 1); // running flat down the line at the back
      // His shoulders: square to the line = sitting; turned to the sideline
      // (chest facing inside, down the line) = crashing.
      const inward = m.x < CX ? 0 : Math.PI;
      const shoulders = clamp(Math.cos(angDiff(m.facing, inward)), 0, 1);
      const crash = clamp(Math.max(inside, onTrack, flat, 0.9 * shoulders), 0, 1);
      reason = `${readId} ${crash > 0.6 ? "crashing — shoulders to the sideline" : crash > 0.3 ? "squeezing" : "sitting — square"} (crash ${Math.round(
        crash * 100
      )}%) — SPACE to pull`;
    } else if (m) reason = `can't see ${readId}`;
    else if (z && z.scheme === "power") reason = `power — give; guard kicks ${z.pullKickId || "—"}, H leads on ${z.leadLB || "—"}`;
    else if (z && z.kickId) reason = `split zone — give; H kicks out ${z.kickId}`;
    else if (z && z.endId) reason = `outside zone — give; ${z.endId} left unblocked`;
    return decide(p, world, [
      {
        key: "mesh", label: readId ? `Mesh — reading ${readId}` : "Mesh", reason, score: 1,
        moveTo: { x: CX, y: LOS - 5 }, speed: 2, face: m ? { x: m.x, y: m.y } : { x: rb.x, y: rb.y },
      },
    ]);
  }
  if (!p.hasBall && !world.handedOff && !world.qbKeep)
    return decide(p, world, [
      { key: "snap", label: "Take the snap", reason: "shotgun", score: 1, moveTo: { x: CX, y: LOS - 5 }, speed: 2, face: Math.PI / 2 },
    ]);
  return decide(p, world, [
    {
      key: "fake", label: "Carry out the fake", reason: "ball handed off", score: 1,
      moveTo: { x: CX - 4 * ((world.zone && world.zone.ps) || 1), y: LOS - 7 }, speed: 5,
    },
  ]);
}
