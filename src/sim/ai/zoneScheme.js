// src/sim/ai/zoneScheme.js
// ── Inside zone (read) blocking call.
//
// Made once at the snap from what the line sees, then run live:
//
//   • Read man: the backside end man on the line of scrimmage is left
//     unblocked — the QB reads him at the mesh (offense.js thinkQbMesh).
//   • Covered: each lineman owns the defender in his area — from his own
//     head-up out to the next lineman playside (the playside-most lineman
//     owns everything outside him). He blocks that man.
//   • Two linemen owning the same DL = a combo (a head-up nose between
//     center and guard, say).
//   • Uncovered: help the playside teammate first — double his DL — then
//     climb off it. A lineman whose playside neighbour isn't covered (or
//     who is the playside-most man) climbs straight to a linebacker.
//   • Areas are re-checked just after the snap: if a defender slants out
//     of one lineman's area into another's, who's covered changes and the
//     jobs are re-made from where everyone is now (once per play).
//   • Every combo has a linebacker: the playside-most one not already
//     accounted for, taken in order from the playside combo back. One of the
//     pair comes off to him — which one is decided live, from how the DL and
//     the LB move (DL slants playside / LB flows backside → the backside man
//     comes off; LB flows over the top → the playside man does).
//   • Receivers block the man aligned on them.
//
// Nothing here knows the front by name; 4-3, 3-4 or anything else falls
// out of where the defenders are standing. ──

import { CX, depthOf } from "../field.js";
import { lineRead } from "./protection.js";
import { OFFENSE_PLAYS } from "../playbook.js";
import { clamp } from "../math.js";
import { timeToReach } from "../systems/kinematics.js";

const FRONT_DEPTH = 2.5; // on the line of scrimmage
const HEADUP = 0.4; // how far backside of his nose a lineman's area starts

// What the line sees of the front: men on the line, and box linebackers
// (out to a gap outside the tackles — a linebacker walked out past that,
// apexed over a slot, belongs to the receiver he's aligned on).
function readFront(world, ol) {
  const seen = [];
  for (const d of world.defense) {
    // Alignment is read where he actually is — the man across from you
    // isn't a guess, and a few tenths off flips who's covered.
    if (lineRead(world, d.id)) seen.push({ id: d.id, x: d.x, dep: depthOf(d.y) });
  }
  const front = seen.filter((d) => d.dep < FRONT_DEPTH && Math.abs(d.x - CX) < 9);
  const boxHalf = Math.max(...ol.map((o) => Math.abs(o.home.x - CX))) + 3;
  const lbs = seen.filter((d) => d.dep >= FRONT_DEPTH && d.dep < 7 && Math.abs(d.x - CX) < boxHalf);
  return { front, lbs };
}

// Receivers block the man aligned on each (not the box players).
function receiverBlocks(world, front, lbs) {
  const box = new Set([...front, ...lbs].map((d) => d.id));
  const stalk = {};
  const taken = new Set();
  for (const w of world.offense) {
    if (w.role !== "WR" || w.assignment.kind !== "stalk") continue;
    let best = null;
    for (const d of world.defense) {
      if (box.has(d.id) || taken.has(d.id)) continue;
      const m = w.perception.memory[d.id];
      if (!m) continue;
      const c = Math.hypot(m.x - w.home.x, (m.y - w.home.y) * 0.5); // alignment is mostly about width
      if (!best || c < best.c) best = { id: d.id, c };
    }
    if (best) {
      stalk[w.id] = best.id;
      taken.add(best.id);
    }
  }
  return stalk;
}

// Two linemen on one DL = a combo (a third just climbs).
function formCombos(ol, jobs, P) {
  const combos = [];
  const byDl = {};
  for (const o of ol) {
    const j = jobs[o.id];
    if (j.kind === "base" || j.kind === "down") (byDl[j.dl] = byDl[j.dl] || []).push(o);
  }
  for (const [dl, men] of Object.entries(byDl)) {
    if (men.length < 2) continue;
    men.sort((a, b) => P(b.home.x) - P(a.home.x));
    const c = { dl, play: men[0].id, back: men[1].id, lb: null, climber: null, down: jobs[men[0].id].kind === "down" };
    combos.push(c);
    jobs[c.play] = { kind: "combo", side: "play", combo: c };
    jobs[c.back] = { kind: "combo", side: "back", combo: c };
    for (const extra of men.slice(2)) jobs[extra.id] = { kind: "climb" };
  }
  return combos;
}

// Covered: a defender between the lineman's PLAYSIDE SHOULDER and the NOSE
// of the next lineman playside (head-up on that next man counts — he's at
// his nose). The playside-most lineman's area runs from his playside
// shoulder outward. So a man head-up or on a lineman's inside (backside)
// half is NOT his: he covers the next lineman backside. Off-ball men and
// the read / kick man aren't in anyone's area. `ol` is playside first,
// and `x` is where each defender actually is.
const SHOULDER = 0.42; // half a lineman's shoulder width (config body.width)
const NOSE_BAND = 0.2; // within this of a lineman's nose is "head-up on him"
function areaOwners(ol, blockable, P, draw) {
  const owner = {};
  ol.forEach((o, i) => {
    // (On the draw and outside zone the backside tackle also owns the end
    // outside him.)
    const lo = draw && i === ol.length - 1 ? -Infinity : P(o.home.x) + SHOULDER;
    // Up to (and including) head-up on the next man; his own playside half
    // up to his shoulder is a no-man's strip that goes to the nearer nose.
    const hi = i === 0 ? Infinity : P(ol[i - 1].home.x) + NOSE_BAND;
    for (const d of blockable) if (P(d.x) > lo && P(d.x) <= hi) (owner[o.id] = owner[o.id] || []).push(d);
  });
  // A man shaded just playside of a lineman's nose (inside his shoulder,
  // past head-up) is in nobody's strip by the letter of the rule — give him
  // to that lineman, the one he's actually lined up on.
  for (const d of blockable) {
    if (Object.values(owner).some((ds) => ds.includes(d))) continue;
    const on = ol.find((o) => P(d.x) > P(o.home.x) + NOSE_BAND && P(d.x) <= P(o.home.x) + SHOULDER);
    if (on) (owner[on.id] = owner[on.id] || []).push(d);
  }
  return owner;
}

// keep: an earlier call this one re-makes after the snap — the read /
// kick / pitch key stay exactly who they were (the end has moved by then).
export function buildZoneCall(world, { silent = false, keep = null } = {}) {
  const ol = world.offense.filter((o) => o.role === "OL");
  if (ol[0].assignment.scheme === "power") return buildPowerCall(world, silent);
  const ps = ol[0].assignment.playside || 1;
  const P = (x) => ps * x; // playside-positive coordinate
  ol.sort((a, b) => P(b.home.x) - P(a.home.x)); // playside first
  const { front, lbs } = readFront(world, ol);
  const play = OFFENSE_PLAYS[world.config.play];

  // The man left alone: the backside end (the QB's read on zone read), or
  // on the speed option the playside end — the pitch key.
  const byP = front.slice().sort((a, b) => P(a.x) - P(b.x));
  // QB draw: nobody is read — everyone on the line gets blocked.
  const draw = play.qbRun === "draw";
  // Outside zone (not the option): the back's running away from the
  // backside end, so the backside tackle cuts him off — nobody is left
  // unblocked on the line, the backside linebacker is outrun instead.
  const cutoff = play.zone === "outside" && !play.option;
  const keptId = keep && (keep.readId || keep.kickId || keep.optionKeyId || keep.endId);
  const read = keep ? (keptId ? { id: keptId } : null) : draw || cutoff ? null : (play.option ? byP[byP.length - 1] : byP[0]) || null;
  const blockable = front.filter((d) => !read || d.id !== read.id);

  // Covered: block the man in your area (the one nearest you if two are).
  const jobs = {};
  const owners = areaOwners(ol, blockable, P, draw || cutoff);
  ol.forEach((o) => {
    const mine = (owners[o.id] || []).sort((a, b) => Math.abs(a.x - o.home.x) - Math.abs(b.x - o.home.x));
    jobs[o.id] = mine.length ? { kind: "base", dl: mine[0].id } : { kind: "uncovered" };
  });

  // Uncovered: help the playside teammate if he's covered (a combo — one
  // of the two climbs off it later), else climb straight to the second
  // level.
  const covered = Object.fromEntries(ol.map((o) => [o.id, jobs[o.id].kind === "base"]));
  ol.forEach((o, i) => {
    if (jobs[o.id].kind !== "uncovered") return;
    const n = ol[i - 1];
    jobs[o.id] = n && covered[n.id] ? { kind: "base", dl: jobs[n.id].dl } : { kind: "climb" };
  });

  const combos = formCombos(ol, jobs, P);

  // Linebackers: playside combo picks first, then the lone climbers.
  const claimed = new Set();
  const pickLB = (anchorX, backX) => {
    let best = null;
    for (const l of lbs) {
      if (claimed.has(l.id)) continue;
      const cost = Math.abs(P(l.x - anchorX) - 1) + (P(l.x - backX) < -0.5 ? 2 : 0);
      if (!best || cost < best.cost) best = { id: l.id, cost };
    }
    if (best) claimed.add(best.id);
    return best ? best.id : null;
  };
  const home = Object.fromEntries(ol.map((o) => [o.id, o.home.x]));
  combos.sort((a, b) => P(home[b.play]) - P(home[a.play]));
  for (const c of combos) c.lb = pickLB(home[c.play], home[c.back]);
  for (const o of ol) if (jobs[o.id].kind === "climb") jobs[o.id].lb = pickLB(o.home.x, o.home.x);

  const stalk = receiverBlocks(world, front, lbs);
  // QB draw: the back takes a rusher nobody on the line has (a five-man
  // front leaves one), else leads on the first linebacker nobody has.
  let leadLB = null;
  if (draw) {
    const owned = new Set(Object.values(jobs).map((j) => j.dl || (j.combo && j.combo.dl)).filter(Boolean));
    const free = front.filter((d) => !owned.has(d.id)).sort((a, b) => Math.abs(a.x - CX) - Math.abs(b.x - CX))[0];
    leadLB = free ? free.id : pickLB(CX + ps * 0.7, CX);
  }

  // The backside end: the QB's read (zone read), kicked out by the H (split
  // zone), or just left unblocked (outside zone). Option: the pitch key.
  const call = {
    ps,
    endId: read && !play.option ? read.id : null,
    readId: read && play.read ? read.id : null,
    kickId: read && play.kick ? read.id : null,
    optionKeyId: read && play.option ? read.id : null,
    leadLB,
    jobs, combos, stalk,
    scheme: ol[0].assignment.scheme || "inside",
    // Who was in whose area when this call was made (the post-snap re-check
    // compares against it).
    areas: Object.fromEntries(Object.entries(owners).map(([id, ds]) => [id, ds.map((d) => d.id).sort().join(",")])),
  };
  if (!silent) world.log(world.byId.C, "Zone call", describe(call));
  return call;
}

// ── Power: a gap scheme, toward the H's side.
//   playside tackle / guard — block down: the man in the gap inside you, or
//                             on the man inside you (two on one = a double
//                             that comes off to the backside linebacker)
//   center                  — block back on the man over the pulling guard
//   backside guard          — pull: skip behind the line and kick out the
//                             playside end man on the line
//   backside tackle         — pull check: step into the gap the guard left,
//                             turn away from the pull, block anyone following
//   H                       — lead up through the hole on the playside
//                             linebacker
//   receivers               — the man on them
// The backside end is left alone. ──
function buildPowerCall(world, silent) {
  const ol = world.offense.filter((o) => o.role === "OL");
  const ps = ol[0].assignment.playside || 1;
  const P = (x) => ps * x;
  ol.sort((a, b) => P(b.home.x) - P(a.home.x));
  const [PT, PG, C, BG, BT] = ol;
  const { front, lbs } = readFront(world, ol);
  const byP = front.slice().sort((a, b) => P(b.x) - P(a.x));
  const kick = byP[0] || null;
  const backEnd = byP.length > 1 ? byP[byP.length - 1] : null;
  const claimed = new Set([kick && kick.id, backEnd && backEnd.id]);
  const pickDL = (lo, hi, near) => {
    const c = front.filter((d) => !claimed.has(d.id) && P(d.x) >= lo && P(d.x) < hi);
    c.sort((a, b) => Math.abs(a.x - near) - Math.abs(b.x - near));
    if (c[0]) claimed.add(c[0].id);
    return c[0] ? c[0].id : null;
  };
  const jobs = {};
  // Down blocks, inside out, so the guard gets his man first.
  const pgDl = pickDL(P(C.home.x) - HEADUP, P(PG.home.x) + HEADUP, PG.home.x);
  jobs[PG.id] = pgDl ? { kind: "down", dl: pgDl } : { kind: "climb" };
  const ptDl = pickDL(P(PG.home.x) - HEADUP, P(PT.home.x) + HEADUP, PT.home.x);
  if (ptDl) jobs[PT.id] = { kind: "down", dl: ptDl };
  else if (pgDl) jobs[PT.id] = { kind: "down", dl: pgDl }; // double the guard's man
  else jobs[PT.id] = { kind: "climb" };
  const cDl = pickDL(P(BG.home.x) - 0.6, P(C.home.x) + HEADUP, C.home.x);
  jobs[C.id] = cDl ? { kind: "down", dl: cDl, back: true } : { kind: "climb" };
  jobs[BG.id] = { kind: "pull", kick: kick ? kick.id : null };
  // Pull check: the man in his inside gap, else the backside end — keep him
  // from crashing down the line after the pull.
  const counter = !!OFFENSE_PLAYS[world.config.play].counter;
  const btDl = counter ? null : pickDL(P(BT.home.x) - 0.6, P(BG.home.x) + HEADUP, BT.home.x);
  const checkEnd = !counter && !btDl && backEnd ? backEnd.id : null;
  jobs[BT.id] = counter ? { kind: "wrap" } : { kind: "hinge", dl: btDl || checkEnd };
  const combos = formCombos(ol, jobs, P);

  // Linebackers: H leads on the playside one; the rest go to the double /
  // climbers, nearest first.
  const lbTaken = new Set();
  const lbByP = lbs.slice().sort((a, b) => P(b.x) - P(a.x));
  const leadLB = lbByP[0] ? lbByP[0].id : null;
  if (leadLB) lbTaken.add(leadLB);
  // Counter: the wrapping tackle is the lead blocker on him.
  if (counter) jobs[BT.id].lb = leadLB;
  const pick = (x) => {
    const c = lbs.filter((l) => !lbTaken.has(l.id)).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
    if (c[0]) lbTaken.add(c[0].id);
    return c[0] ? c[0].id : null;
  };
  for (const c of combos) c.lb = pick(world.byId[c.back].home.x);
  for (const o of ol) if (jobs[o.id].kind === "climb") jobs[o.id].lb = pick(o.home.x);

  const reading = OFFENSE_PLAYS[world.config.play].read;
  const call = {
    ps,
    endId: backEnd && !checkEnd && !reading ? backEnd.id : null,
    readId: backEnd && reading ? backEnd.id : null,
    kickId: null,
    pullKickId: kick ? kick.id : null,
    leadLB,
    jobs, combos,
    stalk: receiverBlocks(world, front, lbs),
    scheme: "power",
    counter,
  };
  if (!silent) world.log(world.byId.C, counter ? "Counter call" : "Power call", describe(call));
  return call;
}

function describe(call) {
  const parts = [];
  for (const [id, j] of Object.entries(call.jobs)) {
    if (j.kind === "base") parts.push(`${id}→${j.dl}`);
    else if (j.kind === "down") parts.push(`${id} ${j.back ? "back" : "down"} on ${j.dl}`);
    else if (j.kind === "pull") parts.push(`${id} pulls, kicks out ${j.kick || "—"}`);
    else if (j.kind === "hinge") parts.push(`${id} pull-checks${j.dl ? " on " + j.dl : ""}`);
    else if (j.kind === "wrap") parts.push(`${id} wraps on ${j.lb || "—"}`);
    else if (j.kind === "climb") parts.push(`${id}→${j.lb || "2nd level"}`);
  }
  for (const c of call.combos) parts.push(`${c.back}+${c.play}→${c.dl} (then ${c.lb || "—"})`);
  if (call.readId) parts.push(`read ${call.readId}`);
  if (call.kickId) parts.push(`H kicks ${call.kickId}`);
  if (call.scheme === "power" && !call.counter) parts.push(`H leads on ${call.leadLB || "—"}`);
  if (call.optionKeyId) parts.push(`pitch key ${call.optionKeyId}`);
  if (call.leadLB && call.scheme !== "power") parts.push(`RB leads on ${call.leadLB}`);
  if (call.endId && !call.readId && (!call.kickId || call.scheme === "power")) parts.push(`${call.endId} unblocked`);
  return parts.join(" · ");
}

// Every step: decide combo releases, then point each blocker at his man.
export function updateZone(world) {
  if (!world.zone) world.zone = buildZoneCall(world);
  const z = world.zone;
  const ps = z.ps;

  // Just after the snap: if a defender has slanted out of one lineman's
  // area into another's, who's covered has changed — re-make the jobs from
  // where everyone is now. Once a play, and early, before the combos start
  // coming off to the linebackers.
  if (!z.rechecked && z.areas && world.sinceSnap > 0.25 && world.sinceSnap < 0.5) {
    const fresh = buildZoneCall(world, { silent: true, keep: z });
    const ids = new Set([...Object.keys(fresh.areas), ...Object.keys(z.areas)]);
    if ([...ids].some((id) => (fresh.areas[id] || "") !== (z.areas[id] || ""))) {
      Object.assign(z, { jobs: fresh.jobs, combos: fresh.combos, areas: fresh.areas, rechecked: true });
      world.log(world.byId.C, "Zone re-check", `a defender changed areas — ${describe(z)}`);
    }
  }

  // Playside combos first: each one's linebacker is whichever unclaimed LB
  // shows where the pair can get to him first — not necessarily the one
  // named at the snap (he may have flowed to the next combo).
  const claimedLB = new Set();
  for (const o of world.offense) {
    const j = z.jobs[o.id];
    if (j && j.kind === "climb" && j.lb) claimedLB.add(j.lb);
  }
  if (z.leadLB) claimedLB.add(z.leadLB); // power: H has him
  for (const c of z.combos) if (c.climber && c.lb) claimedLB.add(c.lb);
  // Linebackers the other combos still have their eyes on (named at the
  // snap and still there) — not up for grabs.
  const eyesOn = new Set(z.combos.filter((c) => !c.climber && c.lb).map((c) => c.lb));
  for (const c of z.combos) {
    if (c.climber || world.sinceSnap < 0.35) continue;
    // Keep the linebacker this combo was given at the snap while he's still
    // over it; only if he's flowed off (3½ yards from the DL) look for
    // whoever the pair can now get to first.
    const cur = c.lb && !claimedLB.has(c.lb) ? lineRead(world, c.lb) : null;
    const D0 = lineRead(world, c.dl);
    if (!(cur && D0 && Math.abs(cur.x - D0.x) < 3.5)) {
      let best = null;
      const wrMen = new Set(Object.values(z.stalk));
      for (const d of world.defense) {
        if (d.role !== "LB" || claimedLB.has(d.id) || wrMen.has(d.id) || (d.id !== c.lb && eyesOn.has(d.id))) continue;
        const m = lineRead(world, d.id);
        if (!m || depthOf(m.y) > 8) continue;
        const t = Math.min(timeToReach(world.byId[c.play], m.x, m.y), timeToReach(world.byId[c.back], m.x, m.y));
        if (!best || t < best.t) best = { id: d.id, t };
      }
      if (best) {
        eyesOn.delete(c.lb);
        c.lb = best.id;
        eyesOn.add(c.lb);
      }
    }
    if (!c.lb) continue;
    const D = lineRead(world, c.dl);
    const L = lineRead(world, c.lb);
    if (!D || !L) continue;
    const lbDepth = depthOf(L.y);
    const declared = world.sinceSnap > 0.9 || lbDepth < 3.2 || Math.abs(L.vx) > 1.5;
    if (!declared) continue;
    // Whoever can get to the linebacker's spot first comes off. The read of
    // the DL and LB breaks ties: + → LB flowing over the top (favours the
    // playside man); − → DL slanting playside / LB coming back inside
    // (favours the backside man).
    const s = clamp(ps * (L.x + L.vx * 0.4 - D.x) - 0.6 * ps * D.vx, -2, 2);
    const spot = { x: L.x + L.vx * 0.4, y: L.y + L.vy * 0.4 };
    // Outside zone leans on the overtake: the uncovered (backside) man takes
    // the DL over at the line so the covered (playside) man can climb.
    const overtake = z.scheme === "outside" ? 0.35 : 0;
    const cost = (id, sign) => timeToReach(world.byId[id], spot.x, spot.y) - sign * 0.15 * s - (sign > 0 ? overtake : 0);
    const climberId = cost(c.play, 1) <= cost(c.back, -1) ? c.play : c.back;
    const stayerId = climberId === c.play ? c.back : c.play;
    // Nobody comes off until the man staying has (or is on) the DL.
    const stayer = world.byId[stayerId];
    const onHim = stayer.engagedWith === c.dl || Math.hypot(stayer.x - D.x, stayer.y - D.y) < 1.1;
    if (!onHim && world.sinceSnap < 1.3) continue;
    claimedLB.add(c.lb);
    c.climber = climberId;
    const climber = world.byId[climberId];
    if (climber.engagedWith === c.dl) {
      climber.engagedWith = null;
      climber.reengage[c.dl] = world.t + 1;
    }
    world.log(
      climber,
      `Off the combo → ${c.lb}`,
      `closest to ${c.lb} (${s > 0 ? "he's flowing over the top" : "he's fitting inside / " + c.dl + " slanting"}) — ${stayerId} takes ${c.dl}`
    );
  }

  for (const o of world.offense) {
    if (o.role === "OL") {
      const j = z.jobs[o.id];
      let target = null;
      if (j.kind === "base" || j.kind === "down" || j.kind === "hinge") target = j.dl || null;
      else if (j.kind === "pull") target = j.kick;
      else if (j.kind === "wrap") target = j.lb || null;
      else if (j.kind === "climb") target = j.lb;
      else if (j.kind === "combo") target = j.combo.climber === o.id ? j.combo.lb : j.combo.dl;
      o.blockTarget = target;
      o.zoneJob = j;
    } else if (o.role === "WR" && o.assignment.kind === "stalk") {
      o.blockTarget = z.stalk[o.id] || null;
    } else if (o.assignment.kind === "kickout") {
      o.blockTarget = z.kickId;
    } else if (o.assignment.kind === "lead") {
      o.blockTarget = z.counter ? null : z.leadLB;
    }
  }
}
