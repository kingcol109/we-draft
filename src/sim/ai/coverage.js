// src/sim/ai/coverage.js
// ── Coverage, written once for every zone and every man assignment — there
// is no play-specific or coverage-vs-route code anywhere.
//
// ZONE: for every eligible this defender perceives, project where he'll be
// shortly and ask how much that projection intrudes on my zone
// (relevance). Threat = relevance × (baseline + QB attention on him). Each
// threat becomes a candidate intent with a defend point:
//   "under" zones → get into the throwing lane beneath the receiver, tighter
//                   the more the QB is looking there, never deeper than the
//                   zone allows
//   "over"  zones → stay on top of him
// The decision system commits to the most threatening one — with a delay
// and a switching cost. So an underneath defender caught between a short
// receiver and one going over his head (a high-low) is pulled by the QB's
// eyes, and has to physically recover when the eyes move.
//
// MAN: play the receiver from what's *perceived* of him — leverage, cushion,
// open-and-run when he threatens deep, drive when he breaks back. The read
// of his velocity lags, so a hard cut wins separation. ──

import { ELIGIBLES, DEG } from "../config.js";
import { CX, LOS, depthOf } from "../field.js";
import { physOf } from "../player.js";
import { angDiff, clamp, fmt, lerp, pct } from "../math.js";

// Distance from a point to a zone. `shortWeight` > 1 makes being short of
// a deep zone count extra — a settled hitch isn't a deep threat.
function boxDist(x, d, b, shortWeight = 1) {
  const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
  const dd = d < b.d0 ? (b.d0 - d) * shortWeight : d > b.d1 ? d - b.d1 : 0;
  return Math.hypot(dx, dd);
}

function perceivedQB(p) {
  const m = p.perception.memory.QB;
  return m ? { x: m.x, y: m.y } : { x: CX, y: LOS - 5 };
}

function defendPoint(z, qb, r, att) {
  if (z.kind === "under") {
    const dx = r.x - qb.x;
    const dy = r.y - qb.y;
    const L = Math.hypot(dx, dy) || 1;
    // No read: sit level with / just behind him in his lane. The more the QB
    // is looking there, the further in front of him to jump the throw.
    const undercut = lerp(-1.2, 1.1, Math.pow(att, 0.8));
    const x = r.x - (dx / L) * undercut;
    const y = r.y - (dy / L) * undercut;
    return {
      x: clamp(x, z.box.x0 - 2, z.box.x1 + 2),
      y: LOS + clamp(depthOf(y), z.box.d0, z.box.d1),
    };
  }
  // Deep: stay over him. With no read, split the difference toward the
  // landmark with a big cushion; the more the QB is looking at him, the more
  // the defender leans to him and tightens up.
  return {
    x: lerp(r.x, z.home.x, 0.35 * (1 - att)),
    y: LOS + Math.max(depthOf(r.y) + lerp(4.5, 2.5, att), z.box.d0),
  };
}

// ── A deep defender backpedals with his eyes on the QB, feeling the
// receivers around him — until one is threatening to get even with him
// (or his spot is far off to the side); then he flips his hips and runs,
// eyes still back toward the QB as far as the body allows. ──
function deepFace(p, pt, qb, threatDepth, threatVy = 0, urgent = false) {
  const cushion = threatDepth == null ? Infinity : depthOf(p.y) - threatDepth;
  // Flip when he'll be even soon, not just when he's close — a vertical at
  // full speed eats a backpedal's cushion fast.
  const closing = threatVy - Math.max(0, p.vy);
  const soon = closing > 0.5 && cushion / closing < 1.5;
  const far = Math.abs(pt.x - p.x) > 6; // a long way sideways — can't pedal there
  // The QB has told him where it's going: stop pedaling and go get there.
  const go = urgent && Math.hypot(pt.x - p.x, pt.y - p.y) > 2.5;
  if (cushion < 2.5 || soon || far || go) return { face: eyesBack(p, pt, qb), flipped: true };
  return { face: qb, flipped: false };
}

// Turning to run to a deep spot: the chest goes with the feet, but the
// eyes stay on the QB as far as the body allows (so he still sees the
// throw — or the handoff).
function eyesBack(p, pt, qb, limit = 70) {
  const travel = Math.atan2(pt.y - p.y, pt.x - p.x);
  const toQB = Math.atan2(qb.y - p.y, qb.x - p.x);
  return travel + clamp(angDiff(toQB, travel), -limit * DEG, limit * DEG);
}

// Real distance to cover to a spot that's deeper → flip the hips and run
// there (eyes back); close, or coming forward → shuffle/pedal facing the QB.
function dropFace(p, pt, qb) {
  const far = Math.hypot(pt.x - p.x, pt.y - p.y) > 3 && depthOf(pt.y) - depthOf(p.y) > 1;
  return far ? eyesBack(p, pt, qb) : qb;
}

// Has a teammate's zone got this receiver (and is that teammate closer)?
function passedOff(p, world, r) {
  const mine = Math.hypot(r.x - p.x, r.y - p.y);
  for (const d of world.defense) {
    if (d === p) continue;
    const c = d.assignment.cover;
    if (c.type !== "zone" || !c.def) continue;
    // A deep defender only hands a man to another deep defender — never a
    // vertical to someone sitting in the flat.
    if (p.assignment.cover.def.kind === "over" && c.def.kind !== "over") continue;
    const b = c.def.box;
    const dep = depthOf(r.y);
    if (r.x < b.x0 || r.x > b.x1 || dep < b.d0 || dep > b.d1) continue;
    if (Math.hypot(r.x - d.x, r.y - d.y) < mine) return true;
  }
  return false;
}

export function zoneOptions(p, world) {
  const z = p.assignment.cover.def;
  const mem = p.perception.memory;
  const qb = perceivedQB(p);
  const ph = physOf(p);
  const opts = [];
  const threats = {};

  // Underneath zones react to what's about to be in them; deep zones have to
  // see routes coming — a receiver *heading* into an empty deep zone (a
  // corner route breaking toward the sideline) is that defender's work
  // before he gets there.
  const horizons = z.kind === "over" ? [0.6, 1.2, 1.8, 2.4] : [0.6];
  const slack = z.kind === "over" ? 6 : 4;
  // Deep defenders stay deeper than everybody near them.
  let deepest = -Infinity;
  if (z.kind === "over")
    for (const id of ELIGIBLES) {
      const m = mem[id];
      if (!m || m.conf < 0.2) continue;
      const px = m.x + m.vx * 0.5;
      if (px < z.box.x0 - 8 || px > z.box.x1 + 8) continue;
      deepest = Math.max(deepest, depthOf(m.y + m.vy * 0.5));
    }
  const deepFloor = deepest + 2;
  // First pass: how much each receiver is (or is about to be) in my zone,
  // and how deep he's going to get.
  const seen = [];
  for (const id of ELIGIBLES) {
    const m = mem[id];
    if (!m || m.conf < 0.15) continue;
    let relevance = 0;
    let r = null;
    let reach = depthOf(m.y);
    horizons.forEach((h, i) => {
      const px = m.x + m.vx * h;
      const py = m.y + m.vy * h;
      const rel = clamp(1 - boxDist(px, depthOf(py), z.box, z.kind === "over" ? 2 : 1) / slack, 0, 1) * (1 - 0.12 * i);
      if (rel > 0.1) reach = Math.max(reach, depthOf(py));
      if (rel > relevance) {
        relevance = rel;
        r = { x: px, y: py };
      }
    });
    relevance *= Math.min(1, m.conf);
    seen.push({ id, m, relevance, r, reach });
  }
  // A deep defender's man is the deepest threat in his zone: someone
  // working across at 12 under a vertical at 20 is the underneath
  // defenders' problem, and a receiver running straight up the field is
  // more dangerous than one drifting.
  let deepestReach = -Infinity;
  if (z.kind === "over") for (const c of seen) if (c.relevance > 0.15) deepestReach = Math.max(deepestReach, c.reach);
  for (const { id, m, reach, ...c } of seen) {
    let { relevance, r } = c;
    if (!r) r = { x: m.x + m.vx * 0.6, y: m.y + m.vy * 0.6 };
    // QB eyes on him — and the longer they've stayed there, the more it
    // counts: a route stared down from the snap is jumped hard.
    const stare = p.belief.stare[id] || 0;
    const att = Math.min(1, (p.belief.attention[id] || 0) + 0.55 * clamp(stare / 1.0, 0, 1));
    // Pass him off only once a teammate's zone has him (and that teammate is
    // closer); until then a receiver the QB is looking at stays mine even as
    // he leaves my zone.
    const handed = passedOff(p, world, r);
    if (handed) relevance *= 0.35;
    else if (att > 0.3 && Math.hypot(r.x - p.x, r.y - p.y) < (z.kind === "over" ? 16 : 9)) relevance = Math.max(relevance, 0.9 * att);
    if (relevance <= 0.02) continue;
    // Deep defenders weight the QB's eyes more heavily.
    let threat = relevance * (0.3 + 1.3 * att);
    if (z.kind === "over") {
      // (Unless the QB is looking there — his eyes outrank the depth.)
      const depthPri = Math.max(att, clamp(1 - (deepestReach - reach) / 7, 0.2, 1));
      const vertical = clamp((m.vy - 1) / 5, 0, 1);
      threat = threat * depthPri + 0.4 * relevance * vertical * depthPri;
    }
    threats[id] = { threat, att, relevance };
    const pt = defendPoint(z, qb, r, att);
    if (z.kind === "over") pt.y = Math.max(pt.y, LOS + deepFloor);
    // A receiver still running vertically isn't something to jump yet —
    // underneath, carry him while getting to landmark depth.
    const carry = z.kind === "under" && m.vy > 0.8;
    if (carry) pt.y = Math.max(pt.y, LOS + z.home.d * 0.9);
    const deeper = depthOf(pt.y) - depthOf(p.y);
    const deep = z.kind === "over" ? deepFace(p, pt, qb, depthOf(m.y + m.vy * 0.4), m.vy, att > 0.6) : null;
    const verb = deep
      ? deep.flipped ? "Flip & run over" : att > 0.35 ? "Lean to" : "Backpedal over"
      : carry ? "Carry" : deeper < -0.5 ? "Drive on" : deeper > 0.5 ? "Sink under" : "Wall off";
    opts.push({
      key: `zone:${id}`,
      label: `${verb} ${id}`,
      reason: `QB eyes ${pct(att)} · ${id} in ${z.name} ${pct(relevance)}${handed ? " · passed off" : ""}${deep && !deep.flipped ? " · eyes on QB" : ""}`,
      score: 1.5 + threat,
      moveTo: pt,
      speed: z.kind === "over" ? ph.top : ph.top * (0.6 + 0.4 * Math.min(1, threat * 1.5)),
      // Underneath: eyes on the QB unless the spot is far behind — then turn
      // and run. Deep: backpedal, eyes on the QB, until he's threatened.
      face: deep ? deep.face : dropFace(p, pt, qb),
      eyesOn: deep && deep.flipped ? qb : null, // running: head stays back on the QB
      debug: { kind: "zone", point: pt, threat },
      _deep: z.kind === "over" && !handed ? { id, pt, threat, m } : null,
    });
  }
  p.belief.threat = threats;
  // Two deep threats in one deep zone and nothing to say which (no QB eyes):
  // he doesn't guess — he splits them, deep and between, keeping both in
  // front of him until one declares (breaks off, or the QB looks there).
  if (z.kind === "over") {
    const d = opts.map((o) => o._deep).filter(Boolean).sort((a, b) => b.threat - a.threat);
    if (d.length >= 2 && d[1].threat > 0.3 && d[1].threat > 0.65 * d[0].threat) {
      const [a, b] = d;
      const wa = a.threat * a.threat;
      const wb = b.threat * b.threat;
      const pt = {
        x: (a.pt.x * wa + b.pt.x * wb) / (wa + wb),
        y: Math.max(a.pt.y, b.pt.y),
      };
      const dm = depthOf(a.m.y) > depthOf(b.m.y) ? a.m : b.m;
      const deep = deepFace(p, pt, qb, depthOf(dm.y + dm.vy * 0.4), dm.vy);
      opts.push({
        key: `zone:split:${[a.id, b.id].sort().join("")}`,
        label: `Split ${a.id} & ${b.id}`,
        reason: `two deep in ${z.name} — stay between and over both`,
        score: 1.5 + a.threat + 0.4 * b.threat, // two threats outweigh either one
        moveTo: pt,
        speed: ph.top,
        face: deep.face,
        eyesOn: deep.flipped ? qb : null,
        debug: { kind: "zone", point: pt, threat: a.threat },
      });
    }
  }
  for (const o of opts) delete o._deep;
  // The landmark shifts toward where the QB is facing; deep landmarks keep
  // getting deeper as the play goes and stay over the deepest man.
  // (With variance on, how precisely he finds his spot varies rep to rep.)
  const lm = p.form ? p.form.landmark : { x: 0, y: 0 };
  const home = { x: z.home.x + lm.x, y: LOS + z.home.d + lm.y };
  const qm = mem.QB;
  if (qm && qm.vis > 0.2 && Math.sin(qm.facing) > 0.2) {
    const t = (home.y - qm.y) / Math.sin(qm.facing);
    const fx = qm.x + Math.cos(qm.facing) * t;
    home.x = clamp(lerp(home.x, fx, 0.35 * Math.min(1, qm.vis * 1.5)), z.box.x0, z.box.x1);
  }
  if (z.kind === "over" && world.ball.state !== "air") {
    home.y += Math.min(6, 2.5 * Math.max(0, world.sinceSnap - 0.5));
    home.y = Math.max(home.y, LOS + deepFloor);
  }
  // Deep: backpedal to the landmark, eyes on the QB, as long as nobody is
  // about to run past him.
  let nearest = null;
  let nearestVy = 0;
  if (z.kind === "over")
    for (const id of ELIGIBLES) {
      const m = mem[id];
      if (m && m.conf > 0.2 && (nearest == null || depthOf(m.y) > nearest)) {
        nearest = depthOf(m.y + m.vy * 0.4);
        nearestVy = m.vy;
      }
    }
  const homeDeep = z.kind === "over" ? deepFace(p, home, qb, nearest, nearestVy) : null;
  opts.push({
    key: "zone:home",
    label: homeDeep ? (homeDeep.flipped ? `Flip & run to ${z.name}` : `Backpedal to ${z.name}`) : `Drop to ${z.name}`,
    reason: homeDeep && !homeDeep.flipped ? "eyes on the QB, feeling the receivers" : "nothing threatening the zone yet",
    score: 1.62,
    moveTo: home,
    speed: ph.top * 0.85,
    face: homeDeep ? homeDeep.face : dropFace(p, home, qb),
    eyesOn: homeDeep && homeDeep.flipped ? qb : null,
    debug: { kind: "zone", point: home },
  });
  return opts;
}

export function manOptions(p, world) {
  const tid = p.assignment.cover.target;
  const m = p.perception.memory[tid];
  const ph = physOf(p);
  if (!m) return [];
  const side = Math.sign(m.x - CX) || 1;
  const inside = -side;
  const cushion = depthOf(p.y) - depthOf(m.y);
  const lead = 0.35;
  const px = m.x + m.vx * lead;
  const py = m.y + m.vy * lead;
  let pt;
  let face;
  let label;
  let reason;
  if (m.vy < -0.8) {
    pt = { x: px + inside * 0.3, y: py - 0.6 };
    face = null;
    label = `Drive on ${tid}`;
    reason = `${tid} coming back (${fmt(-m.vy, 1)} yd/s)`;
  } else if (cushion > 2.2 && m.vy > 1) {
    pt = { x: px + inside * 0.9, y: py + Math.max(2.0, cushion * 0.8) };
    face = { x: m.x, y: m.y };
    label = `Backpedal on ${tid}`;
    reason = `cushion ${fmt(cushion, 1)} yd, inside leverage`;
  } else if (m.vy > 3) {
    pt = { x: px + inside * 0.7, y: py + 0.6 };
    face = null;
    label = `Turn & run with ${tid}`;
    reason = `cushion gone (${fmt(cushion, 1)} yd) — open the hips`;
  } else {
    pt = { x: px + inside * 0.5, y: py + 0.8 };
    face = { x: m.x, y: m.y };
    label = `Mirror ${tid}`;
    reason = `${tid} breaking/settling`;
  }
  // Match his (perceived) velocity, plus a correction toward the leverage
  // spot — trailing, not magnetized.
  const gain = 2.5 * (p.traits.man ?? 1); // man technique (dynasty): tighter to the leverage spot
  const vx = m.vx + gain * (pt.x - p.x);
  const vy = m.vy + gain * (pt.y - p.y);
  const travel = Math.atan2(vy, vx);
  const toMan = Math.atan2(m.y - p.y, m.x - p.x);
  if (m.vis < 0.25) {
    // Lost him — turn to find him (and pay for it), rather than run blind.
    face = { x: m.x, y: m.y };
    label = `Lost ${tid} — finding him`;
    reason = `no eyes on ${tid} for ${fmt(world.t - m.lastSeen, 1)}s — estimating`;
  } else if (face === null) {
    // Running with him: eyes stay on his hip, within what the body allows.
    face = travel + clamp(angDiff(toMan, travel), -75 * DEG, 75 * DEG);
  }
  return [
    {
      key: `man:${tid}`,
      label,
      reason,
      score: 1.8,
      dir: travel,
      speed: Math.min(ph.top, Math.hypot(vx, vy)),
      face,
      debug: { kind: "man", point: pt },
    },
  ];
}
