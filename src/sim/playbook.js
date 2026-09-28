// src/sim/playbook.js
// ── Formation, plays and defensive calls.
//
// PLAY CALLS ESTABLISH RESPONSIBILITIES. THEY DO NOT DETERMINE OUTCOMES.
// Everything in this file is an *assignment* — a route's landmarks, a zone's
// area, a gap, a man to cover. Nothing here says what happens when a given
// play meets a given coverage; that emerges from perception → belief →
// intent → movement in the systems/ and ai/ folders. ──

import { CX, FIELD, LOS, GAPS, OL_SPLIT } from "./field.js";
import { createPlayer } from "./player.js";

const UP = Math.PI / 2; // offense faces +y
const DOWN = -Math.PI / 2; // defense faces −y

// ── Formations: everything is Spread, with tags. Weak / Strong put the
// back to the QB's left / right; Pistol puts him straight behind the QB.
// King / Queen bring H into the backfield as a fullback, 2 yards behind the
// right / left tackle (with an offset back, he's opposite the H). ──
export const FORMATIONS = {
  spreadWeak: { label: "Spread Weak", rbX: -1.5 },
  spreadStrong: { label: "Spread Strong", rbX: 1.5 },
  spreadWeakKing: { label: "Spread Weak King", rbX: -1.5, fullback: 1 },
  spreadStrongQueen: { label: "Spread Strong Queen", rbX: 1.5, fullback: -1 },
  pistolKing: { label: "Spread Pistol King", rbX: 0, rbDepth: -7.5, fullback: 1 },
  pistolQueen: { label: "Spread Pistol Queen", rbX: 0, rbDepth: -7.5, fullback: -1 },
  // Pistol 2x2: the back 7½ deep straight behind the QB, four wide.
  pistol: { label: "Pistol", rbX: 0, rbDepth: -7.5 },
  // Trips (3x1): three receivers to the strong side — #1 wide, #2 in the
  // slot, #3 tight inside — and one alone backside; the back offset to the
  // single side (he's the protector to the weak side).
  tripsRight: { label: "Trips Right", rbX: -1.5, strong: 1, align: { X: [-18, -0.8], Z: [18, -0.8], Y: [12, -1.4], H: [6.5, -1.4] } },
  tripsLeft: { label: "Trips Left", rbX: 1.5, strong: -1, align: { Z: [18, -0.8], X: [-18, -0.8], H: [-12, -1.4], Y: [-6.5, -1.4] } },
  // Bunch: the three strong-side receivers stacked tight — a point man on
  // the line and two a yard behind him, outside and inside — so they can
  // release off each other (natural picks, free releases vs. press).
  bunchRight: { label: "Bunch Right", rbX: -1.5, strong: 1, bunch: true, align: { X: [-18, -0.8], Y: [9.5, -0.8], Z: [11, -2.0], H: [8, -2.0] } },
  bunchLeft: { label: "Bunch Left", rbX: 1.5, strong: -1, bunch: true, align: { Z: [18, -0.8], H: [-9.5, -0.8], X: [-11, -2.0], Y: [-8, -2.0] } },
};

const SPLIT_SETS = ["spreadWeakKing", "spreadStrongQueen", "pistolKing", "pistolQueen"];
const ALL_SETS = ["spreadWeak", "spreadStrong", "pistol", "spreadWeakKing", "spreadStrongQueen", "pistolKing", "pistolQueen"];
const TWO_BY_TWO = ["spreadWeak", "spreadStrong", "pistol"];
const TRIPS = ["tripsRight", "tripsLeft"];

// How a formation distributes its four receivers: 2x2, 3x1 or a bunch.
export const structureOf = (key) => {
  const f = FORMATIONS[key];
  return f.bunch ? "bunch" : f.strong ? "3x1" : f.fullback ? "fb" : "2x2";
};
// Formations a `sets` concept can run from: every formation whose
// structure it has a version for (a bunch can run a 3x1 concept).
const setsFormations = (sets) =>
  Object.keys(FORMATIONS).filter((k) => {
    const st = structureOf(k);
    return !!sets[st] || (st === "bunch" && !!sets["3x1"]);
  });

// `zone` is the blocking scheme; `read` = the backside end is left for the
// QB to read (Space to pull); `kick` = H kicks him out instead. On outside
// zone he's simply left unblocked.
export const OFFENSE_PLAYS = {
  smash: { label: "Smash", type: "pass", formations: TWO_BY_TWO, routes: { X: "hitch", H: "corner", Y: "corner", Z: "hitch" } },
  fourVerts: { label: "Four Verticals", type: "pass", formations: TWO_BY_TWO, routes: { X: "go", H: "seam", Y: "seam", Z: "go" } },
  doubleSlants: { label: "Double Slants", type: "pass", formations: TWO_BY_TWO, routes: { X: "slant", H: "slantDeep", Y: "slantDeep", Z: "slant" } },
  doublePostWheel: { label: "Double Post Wheel", type: "pass", formations: TWO_BY_TWO, routes: { X: "post", H: "wheel", Y: "wheel", Z: "post" } },
  // Position-based concepts — they run from any formation: `roles` are the
  // routes for outside receivers, slots (slotL / slotR if the two differ),
  // a lone outside receiver with no slot beside him, and H as a fullback.
  hitches: { label: "Hitches", type: "pass", formations: ALL_SETS, roles: { outside: "hitch", slot: "hitch6", fb: "fbFlat" } },
  slantOut: { label: "Slant Out", type: "pass", formations: ALL_SETS, roles: { outside: "slant", slot: "out", fb: "fbFlat" } },
  cornerOut: { label: "Corner Out", type: "pass", formations: ALL_SETS, roles: { outside: "out", slot: "cornerDeep", fb: "fbFlat" } },
  crossers: { label: "Crossers", type: "pass", formations: ALL_SETS, roles: { outside: "go", slotL: "drag", slotR: "crossDeep", fb: "fbFlat" } },
  insideZone: { label: "Inside Zone Read", type: "run", zone: "inside", read: true, formations: [...TWO_BY_TWO, ...TRIPS] },
  outsideZone: { label: "Outside Zone", type: "run", zone: "outside", read: false, formations: [...TWO_BY_TWO, ...TRIPS] },
  splitZone: { label: "Split Zone", type: "run", zone: "inside", read: false, kick: true, formations: SPLIT_SETS },
  power: { label: "Power", type: "run", zone: "power", read: false, lead: true, formations: SPLIT_SETS },
  // Play action off power: fake it toward the H, QB boots back the other way.
  // rollout: after the fake the QB rolls on his own — "boot" = away from
  // the fake, "play" = with it — until you take him with WASD.
  waggle: { label: "Waggle (power pass)", type: "pass", fake: "power", rollout: "boot", formations: SPLIT_SETS },
  // Play action off split zone: the line and back sell split zone, H fakes
  // the kickout on the backside end then runs an out, the QB boots with him.
  splitZoneBoot: { label: "Split Zone Boot", type: "pass", fake: "inside", rollout: "boot", formations: SPLIT_SETS },
  // RPO: inside zone read — the backside slot (the read side) runs a bubble.
  // Space pulls it as always; on the RPO a pulled ball can be thrown.
  izBubble: { label: "Inside Zone RPO (bubble)", type: "run", zone: "inside", read: true, rpo: "bubble", formations: TWO_BY_TWO },
  // ── Option / QB runs: the QB has the ball from the snap (`qbRun`).
  // Speed option: the line reaches (outside zone) and leaves the playside
  // end man alone — he's the pitch key. The QB attacks him; the back runs
  // in pitch relationship (4½ outside, a yard behind). SPACE pitches it;
  // otherwise the QB keeps. `side`: which way it goes.
  speedOptionR: { label: "Speed Option Right", type: "run", zone: "outside", option: "speed", qbRun: "option", side: 1, formations: ["pistol", "spreadStrong", "spreadWeak", "tripsRight"] },
  speedOptionL: { label: "Speed Option Left", type: "run", zone: "outside", option: "speed", qbRun: "option", side: -1, formations: ["pistol", "spreadWeak", "spreadStrong", "tripsLeft"] },
  // QB draw: the line shows pass for a beat, then zone blocks; the back
  // shows pass pro, then leads through the hole on a linebacker.
  qbDraw: { label: "QB Draw", type: "run", zone: "inside", qbRun: "draw", sell: 0.45, formations: [...TWO_BY_TWO, ...TRIPS] },
  // GT counter read: the back jab-steps away, then takes it back across;
  // the backside guard pulls and kicks out the playside end, the backside
  // tackle wraps through the hole on the playside linebacker, everyone
  // playside blocks down, the center blocks back. With both backside
  // linemen gone, the backside end is the QB's read (SPACE pulls it).
  // (A quicker ride than zone read: the counter needs the ball in the
  // back's hands as the pullers arrive.)
  counter: { label: "GT Counter Read", type: "run", zone: "power", counter: true, read: true, ride: 0.15, formations: ["spreadWeak", "spreadStrong", ...TRIPS] },
  // ── Concepts by formation structure. `sets[structure]` lists routes by
  // side, outside-in: `strong` (the trips / bunch side, or the right in
  // 2x2) and `weak`. `rbRoute`: the back's (default: pass pro).
  //
  // Stick: quick game — #1 clears with a fade, #2 sits at 6 (the stick),
  // #3 to the flat: a flat-curl stretch on the outside linebacker.
  stick: {
    label: "Stick", type: "pass",
    sets: { "3x1": { strong: ["go", "stick", "flat"], weak: ["slant"] }, "2x2": { strong: ["go", "stick"], weak: ["go", "stick"] } },
  },
  // Flood (sail): three levels to one side — #1 clears deep, #2 deep out at
  // 12, #3 to the flat. Backside dig.
  flood: { label: "Flood", type: "pass", sets: { "3x1": { strong: ["go", "deepOut", "flat"], weak: ["dig"] } } },
  // Levels: in-breakers at two depths (12 and 5) under a clear-out.
  levels: {
    label: "Levels", type: "pass",
    sets: { "3x1": { strong: ["go", "inHigh", "inShort"], weak: ["slant"] }, "2x2": { strong: ["inHigh", "inShort"], weak: ["go", "seam"] } },
  },
  // Dagger: #2 runs the seam to pull the safety / hook defender, #1 digs in
  // behind him at 14.
  dagger: {
    label: "Dagger", type: "pass",
    sets: { "2x2": { strong: ["dig", "seam"], weak: ["go", "drag"] }, "3x1": { strong: ["dig", "seam", "flat"], weak: ["go"] } },
  },
  // Mesh: two shallow crosses rubbing past each other under the
  // linebackers, a corner over the top.
  mesh: {
    label: "Mesh", type: "pass", rbRoute: "rbCheck",
    sets: { "2x2": { strong: ["corner", "dragHigh"], weak: ["go", "drag"] }, "3x1": { strong: ["go", "cornerDeep", "drag"], weak: ["dragHigh"] } },
  },
  // Curl-flat both ways: a high-low on each flat defender.
  curlFlat: { label: "Curl Flat", type: "pass", sets: { "2x2": { strong: ["curl", "flat"], weak: ["curl", "flat"] } } },
  // Y-cross: the inside trips receiver on a deep cross at 9–10 under a
  // clear-out go and a curl; backside post.
  yCross: { label: "Y-Cross", type: "pass", rbRoute: "rbCheck", sets: { "3x1": { strong: ["go", "curl", "crossDeep"], weak: ["post"] } } },
  // Snag (spot): corner, snag (settle at 5–6 inside), flat — a triangle
  // read on the flat defender and the hook. Best out of a bunch.
  snag: {
    label: "Snag", type: "pass",
    sets: { bunch: { strong: ["corner", "snag", "flat"], weak: ["go"] }, "3x1": { strong: ["corner", "snag", "flat"], weak: ["slant"] } },
  },
  // Screens: the line sells pass for `release` seconds, lets the rush go and
  // leads the screen; `target` is who it's for; `drop` how deep the QB sets.
  tunnelScreen: {
    label: "Tunnel Screen", type: "pass", formations: TWO_BY_TWO,
    screen: { target: "Z", release: 0.45, blockers: ["Y"] },
    routes: { X: "go", H: "seam", Y: "screenBlock", Z: "tunnel" },
  },
  hbScreen: {
    label: "HB Screen", type: "pass", formations: TWO_BY_TWO,
    screen: { target: "RB", release: 1.1, blockers: [] }, drop: 4.5, rbRoute: "hbScreen",
    routes: { X: "go", H: "seam", Y: "seam", Z: "go" },
  },
};

// Concept plays run from whichever formations they have a version for.
for (const p of Object.values(OFFENSE_PLAYS)) if (p.sets && !p.formations) p.formations = setsFormations(p.sets);

// Which way a zone run goes (+1 right, −1 left): away from an offset back
// (he crosses the QB's face to the mesh); from Pistol, toward the H's side
// (so on split zone he comes back across to the backside).
export const playsideOf = (formationKey) => {
  const f = FORMATIONS[formationKey];
  return f.rbX ? -Math.sign(f.rbX) : f.fullback || 1;
};

export const FRONTS = { "4-3": "4-3", "3-4": "3-4", mug: "Double Mug (4-3)", nickel: "Nickel 4-2-5", bear: "Bear (46)", tite: "Tite (3-4, 4i-0-4i)" };
export const COVERAGES = {
  tampa2: "Tampa 2", cover3: "Cover 3", cover4: "Cover 4 (Quarters)", man: "Cover 1 (LB blitz)",
  cover2man: "Cover 2 Man", cover1robber: "Cover 1 Robber", zero: "Cover 0 (6-man blitz)",
};
// The calls a front has (not every front runs every coverage).
export const coveragesFor = (front) => Object.keys(COVERAGES).filter((k) => DEFENSES[front] && DEFENSES[front][k]);

// ── Routes, as landmark sequences. Each leg is an intent the route system
// executes with ordinary movement physics — the break happens because the
// receiver plants and changes direction, not because a path says so. ──
export const ROUTES = {
  // 5-yard hitch: vertical stem, sink at 5, snap back toward the QB, settle.
  hitch: [
    { type: "stem", depth: 5, sink: true },
    { type: "comeback", dist: 1.0 },
    { type: "settle" },
  ],
  // 6-yard corner: vertical stem, break at 6 toward the sideline and up.
  corner: [
    { type: "stem", depth: 6, sink: false },
    { type: "angle", deg: 45, dir: "out", length: 20, label: "Break: corner to the sideline" },
  ],
  // Slant: short stem, break inside at 50° off vertical, across the middle.
  slant: [
    { type: "stem", depth: 2, sink: false },
    { type: "angle", deg: 62, dir: "in", length: 14, label: "Slant — across the face" },
  ],
  // Inside slant: breaks at 3 (a yard deeper than the outside slant) and flat,
  // so the two slants come at two levels.
  slantDeep: [
    { type: "stem", depth: 3, sink: false },
    { type: "angle", deg: 68, dir: "in", length: 14, label: "Slant — second level" },
  ],
  // Post: 11-yard stem, break toward the goalposts.
  post: [
    { type: "stem", depth: 11, sink: false },
    { type: "angle", deg: 40, dir: "in", length: 25, label: "Break: post" },
  ],
  // Slot hitch: a yard deeper than the outside hitch.
  hitch6: [
    { type: "stem", depth: 6, sink: true },
    { type: "comeback", dist: 1.0 },
    { type: "settle" },
  ],
  // Speed out: sink at 5, snap flat to the sideline.
  out: [
    { type: "stem", depth: 5, sink: true },
    { type: "angle", deg: 90, dir: "out", length: 12, label: "Break: out to the sideline" },
  ],
  // 10-yard corner.
  cornerDeep: [
    { type: "stem", depth: 10, sink: false },
    { type: "angle", deg: 45, dir: "out", length: 18, label: "Break: corner" },
  ],
  // Shallow cross (drag): under the linebackers, across the formation.
  drag: [
    { type: "stem", depth: 2, sink: false },
    { type: "angle", deg: 82, dir: "in", length: 30, label: "Shallow cross" },
  ],
  // Deep cross at 9, working across and slightly up.
  crossDeep: [
    { type: "stem", depth: 9, sink: false },
    { type: "angle", deg: 75, dir: "in", length: 30, label: "Deep cross" },
  ],
  // Fullback flat: out of the backfield to his side.
  fbFlat: [{ type: "angle", deg: 70, dir: "out", length: 12, label: "Flat out of the backfield" }],
  // Deep post: longer stem, break to the goalposts.
  deepPost: [
    { type: "stem", depth: 14, sink: false },
    { type: "angle", deg: 38, dir: "in", length: 25, label: "Break: deep post" },
  ],
  // Cross: release, then flatten across the field toward the boot.
  cross: [
    { type: "stem", depth: 5, sink: false },
    { type: "angle", deg: 72, dir: "in", length: 30, label: "Crossing — to the boot side" },
  ],
  // Split Zone Boot H: the same kickout fake, then an out at 4 to the boot
  // side.
  kickFakeOut: [
    { type: "kickFake", dur: 1.25, label: "Kickout fake — at the backside end" },
    { type: "stem", depth: 3.5, sink: true, fromBreak: true },
    { type: "angle", deg: 88, boot: true, length: 14, label: "Out — boot side" },
  ],
  // Bubble: bow back and out, catch it moving to the sideline, turn it up.
  bubble: [
    { type: "spot", dx: 2.2, dy: -2.0, pace: 0.75, eyes: true, label: "Bubble — bow back and out" },
    { type: "spot", dx: 5.0, dy: -1.6, pace: 0.85, eyes: true, label: "Bubble — flat to the sideline" },
    { type: "angle", deg: 15, dir: "out", length: 12, label: "Bubble — turn it up" },
  ],
  // Tunnel: one hard step upfield to sell the go, then back inside behind
  // the line, under the slot's block, facing the QB.
  tunnel: [
    { type: "stem", depth: 1.5, sink: true },
    { type: "spot", dx: -5.5, dy: -1.2, pace: 1, eyes: true, label: "Tunnel — back inside behind the line" },
    { type: "settle" },
  ],
  // HB screen: sell pass pro, then leak out to the flat behind the line.
  hbScreen: [
    { type: "wait", dur: 0.9, label: "Screen — sell pass pro" },
    { type: "spot", dx: 5.2, dy: -2.0, pace: 1, eyes: true, label: "Screen — leak to the flat" },
    { type: "settle" },
  ],
  // Waggle H: run the split-zone kickout path at the backside end, then
  // slip out to the flat on the boot side.
  kickFakeFlat: [
    { type: "kickFake", dur: 0.9, label: "Kickout fake — at the backside end" },
    { type: "angle", deg: 78, boot: true, length: 18, label: "Out to the flat — boot side" },
  ],
  // Wheel: out to the flat, then straight up the sideline.
  wheel: [
    { type: "angle", deg: 72, dir: "out", length: 6, label: "Wheel — out to the flat", next: "Wheel — turn it up" },
    { type: "vertical", fromBreak: true, lookAfter: 6, label: "Wheel — up the sideline" },
  ],
  // Stick: 6 yards, turn to the QB and sit in the window.
  stick: [
    { type: "stem", depth: 6, sink: true },
    { type: "comeback", dist: 0.6 },
    { type: "settle" },
  ],
  // Flat from an inside alignment: widen, then flatten to the sideline.
  flat: [
    { type: "angle", deg: 50, dir: "out", length: 2.5, next: "Flat — flatten out" },
    { type: "angle", deg: 84, dir: "out", length: 12, label: "Flat" },
  ],
  // Dig: 14 yards, square in across the field.
  dig: [
    { type: "stem", depth: 14, sink: true },
    { type: "angle", deg: 90, dir: "in", length: 16, label: "Dig — square in at 14" },
  ],
  // Deep out (sail): 12 yards, out toward the sideline, working a bit deeper.
  deepOut: [
    { type: "stem", depth: 12, sink: true },
    { type: "angle", deg: 80, dir: "out", length: 12, label: "Deep out — sail to the sideline" },
  ],
  // Curl: 11 yards, sink, come back to the QB and sit.
  curl: [
    { type: "stem", depth: 11, sink: true },
    { type: "comeback", dist: 1.5 },
    { type: "settle" },
  ],
  // In routes for Levels: square in at 12 (high) and 5 (low).
  inHigh: [
    { type: "stem", depth: 12, sink: true },
    { type: "angle", deg: 90, dir: "in", length: 14, label: "In at 12 (high level)" },
  ],
  inShort: [
    { type: "stem", depth: 5, sink: true },
    { type: "angle", deg: 90, dir: "in", length: 14, label: "In at 5 (low level)" },
  ],
  // Snag: angle inside to 5–6 yards and settle in the window facing the QB.
  snag: [
    { type: "spot", dx: -2.5, dy: 5.5, pace: 1, label: "Snag — to the window" },
    { type: "settle" },
  ],
  // Mesh high cross: at 5, the other drag rubs under it.
  dragHigh: [
    { type: "stem", depth: 5, sink: false },
    { type: "angle", deg: 86, dir: "in", length: 30, label: "Mesh — high cross at 5" },
  ],
  // Back's checkdown: block first, then leak out and sit in the flat.
  rbCheck: [
    { type: "wait", dur: 0.8, label: "Check release — block first" },
    { type: "spot", dx: 3.5, dy: 2.5, pace: 1, eyes: true, label: "Checkdown — leak to the flat" },
    { type: "settle" },
  ],
  // Go: outside release straight up the field, stay on the landmark
  // (don't drift toward the sideline), find the ball over the inside shoulder.
  go: [{ type: "vertical", inset: 0, lookAfter: 10 }],
  // Seam: bend inside to the seam, then straight up it.
  seam: [{ type: "vertical", inset: 2.5, lookAfter: 8 }],
};

export function buildOffense(formationKey, playKey) {
  const f = FORMATIONS[formationKey];
  const play = OFFENSE_PLAYS[playKey];
  const run = play.type === "run";
  // An option goes the way it's called; everything else by the formation.
  const ps = play.side || playsideOf(formationKey);
  const o = (id, position, role, dx, dd, assignment) =>
    createPlayer({ id, team: "O", position, role, x: CX + dx, y: LOS + dd, facing: UP, assignment });
  // Play action blocks the run it fakes (staying on the line — no linemen
  // downfield on a pass).
  const ol = run
    ? { kind: "zoneBlock", playside: ps, scheme: play.zone, sell: play.sell || 0 }
    : play.fake
    ? { kind: "zoneBlock", playside: ps, scheme: play.fake, pa: true }
    : play.screen
    ? { kind: "screen" }
    : { kind: "passPro" };
  let routes = play.routes || {};
  if (play.roles) {
    // Who's a slot where: H is the left slot unless he's the fullback; Y is
    // the slot on his side (right, or left in Queen).
    const R = play.roles;
    const yx = f.fullback === -1 ? -1 : 1;
    const slotSides = f.fullback ? [yx] : [-1, yx];
    routes = {};
    for (const [id, side] of [["X", -1], ["Z", 1]])
      routes[id] = !slotSides.includes(side) && R.lone ? R.lone : R.outside;
    const slot = (side) => (side < 0 ? R.slotL : R.slotR) || R.slot;
    if (!f.fullback) routes.H = slot(-1);
    routes.Y = slot(yx);
    if (f.fullback) routes.H = R.fb;
  }
  // Concepts by structure: each side's receivers, outside-in.
  const align = (id) => (f.align && f.align[id]) || { X: [-18, -0.8], Y: [f.fullback === -1 ? -11 : 11, -1.4], Z: [18, -0.8], H: [-11, -1.4] }[id];
  if (play.sets) {
    const st = structureOf(formationKey);
    const set = play.sets[st] || play.sets["3x1"];
    const strong = f.strong || 1;
    const ids = ["X", "H", "Y", "Z"].filter((id) => !(id === "H" && f.fullback));
    routes = {};
    for (const [sideKey, sign] of [["strong", strong], ["weak", -strong]]) {
      const mine = ids.filter((id) => Math.sign(align(id)[0]) === sign).sort((a, b) => Math.abs(align(b)[0]) - Math.abs(align(a)[0]));
      const list = set[sideKey] || [];
      for (let i = 0; i < mine.length; i++) routes[mine[i]] = list[Math.min(i, list.length - 1)] || "go";
    }
  }
  if (playKey === "splitZoneBoot") {
    const lone = f.fullback === 1 ? "X" : "Z";
    const other = lone === "X" ? "Z" : "X";
    routes = { [lone]: "go", [other]: "deepPost", Y: "cross", H: "kickFakeOut" };
  }
  if (playKey === "waggle") {
    // The receiver by himself (away from H) runs the go; the one with H
    // runs the deep post; Y crosses; H fakes the kickout then flats.
    const lone = f.fullback === 1 ? "X" : "Z";
    const other = lone === "X" ? "Z" : "X";
    routes = { [lone]: "go", [other]: "deepPost", Y: "cross", H: "kickFakeFlat" };
  }
  // RPO: the backside slot (away from the zone — the read side) runs it.
  const rpoSlot = play.rpo ? (ps > 0 ? "H" : "Y") : null;
  const wr = (id) =>
    id === rpoSlot
      ? { kind: "route", route: play.rpo }
      : run
      ? { kind: "stalk" }
      : routes[id] === "screenBlock"
      ? { kind: "screenBlock" }
      : { kind: "route", route: routes[id] };
  const hJob = play.kick ? { kind: "kickout" } : play.lead ? { kind: "lead" } : run ? { kind: "stalk" } : wr("H");
  const h = f.fullback
    ? o("H", "FB", "WR", f.fullback * 2 * OL_SPLIT, -2.9, hJob)
    : o("H", "WR", "WR", align("H")[0], align("H")[1], wr("H"));
  // The back: pitch man on the option; lead blocker on the QB draw.
  const rbJob = play.option
    ? { kind: "pitchBack" }
    : play.qbRun === "draw"
    ? { kind: "lead", hole: "inside", sell: play.sell || 0 }
    : run
    ? { kind: "zoneBack" }
    : play.fake
    ? { kind: "fakeBack" }
    : play.rbRoute
    ? { kind: "route", route: play.rbRoute }
    : { kind: "rbPro" };
  return [
    o("LT", "OL", "OL", -2 * OL_SPLIT, -0.9, ol),
    o("LG", "OL", "OL", -OL_SPLIT, -0.9, ol),
    o("C", "OL", "OL", 0, -0.75, ol),
    o("RG", "OL", "OL", OL_SPLIT, -0.9, ol),
    o("RT", "OL", "OL", 2 * OL_SPLIT, -0.9, ol),
    o("QB", "QB", "QB", 0, -5, run && !play.qbRun ? { kind: "qbMesh" } : { kind: "human" }),
    o("RB", "RB", "RB", f.rbX, f.rbDepth ?? -5.3, rbJob),
    o("X", "WR", "WR", align("X")[0], align("X")[1], wr("X")),
    h,
    // King / Queen: Y lines up as the slot on the H's side.
    o("Y", "WR", "WR", align("Y")[0], align("Y")[1], wr("Y")),
    o("Z", "WR", "WR", align("Z")[0], align("Z")[1], wr("Z")),
  ];
}

// ── Zones. Boxes are absolute field x and depth-past-LOS. `kind` decides
// how a defender plays a threat in it: "under" = get into the throwing
// lane beneath it, "over" = stay on top of it. `home` is the landmark a
// defender drops to when nothing threatens the zone. ──
export function zoneDef(name, side = 0) {
  const W = FIELD.width;
  switch (name) {
    case "flat":
      return {
        name: side < 0 ? "Flat L" : "Flat R", kind: "under",
        box: side < 0 ? { x0: 0, x1: CX - 9, d0: -1, d1: 12 } : { x0: CX + 9, x1: W, d0: -1, d1: 12 },
        home: { x: CX + side * 16, d: 6 },
      };
    case "hook":
      // Hook-to-curl: from the hash out toward the numbers, 10–12 deep.
      return {
        name: side < 0 ? "Hook-Curl L" : "Hook-Curl R", kind: "under",
        box: side < 0 ? { x0: CX - 15, x1: CX - 1, d0: 2, d1: 14 } : { x0: CX + 1, x1: CX + 15, d0: 2, d1: 14 },
        home: { x: CX + side * 9.5, d: 11 },
      };
    case "hole":
      return { name: "Hole", kind: "under", box: { x0: CX - 6, x1: CX + 6, d0: 3, d1: 13 }, home: { x: CX, d: 8 } };
    case "tampa":
      return { name: "Tampa Middle", kind: "over", box: { x0: CX - 8, x1: CX + 8, d0: 7, d1: 32 }, home: { x: CX, d: 15 } };
    case "deepHalf":
      return {
        name: side < 0 ? "Deep ½ L" : "Deep ½ R", kind: "over",
        box: side < 0 ? { x0: 0, x1: CX + 1, d0: 10, d1: 50 } : { x0: CX - 1, x1: W, d0: 10, d1: 50 },
        home: { x: CX + side * 9, d: 19 },
      };
    // Cover 3.
    case "deepThird":
      return {
        name: side < 0 ? "Deep ⅓ L" : "Deep ⅓ R", kind: "over",
        box: side < 0 ? { x0: 0, x1: CX - 7, d0: 10, d1: 50 } : { x0: CX + 7, x1: W, d0: 10, d1: 50 },
        home: { x: CX + side * 16, d: 16 },
      };
    case "middleThird":
      return { name: "Deep ⅓ Middle", kind: "over", box: { x0: CX - 9, x1: CX + 9, d0: 10, d1: 50 }, home: { x: CX, d: 16 } };
    case "curlFlat":
      return {
        name: side < 0 ? "Curl-Flat L" : "Curl-Flat R", kind: "under",
        box: side < 0 ? { x0: 0, x1: CX - 6, d0: -1, d1: 12 } : { x0: CX + 6, x1: W, d0: -1, d1: 12 },
        home: { x: CX + side * 12, d: 8 },
      };
    case "hookIn":
      return {
        name: side < 0 ? "Hook L" : "Hook R", kind: "under",
        box: side < 0 ? { x0: CX - 9, x1: CX - 0.5, d0: 2, d1: 12 } : { x0: CX + 0.5, x1: CX + 9, d0: 2, d1: 12 },
        home: { x: CX + side * 4.5, d: 9 },
      };
    // Cover 4 (quarters).
    case "quarterOut":
      return {
        name: side < 0 ? "Deep ¼ L (outside)" : "Deep ¼ R (outside)", kind: "over",
        box: side < 0 ? { x0: 0, x1: CX - 10, d0: 8, d1: 50 } : { x0: CX + 10, x1: W, d0: 8, d1: 50 },
        home: { x: CX + side * 17, d: 14 },
      };
    case "quarterIn":
      return {
        name: side < 0 ? "Deep ¼ L (inside)" : "Deep ¼ R (inside)", kind: "over",
        box: side < 0 ? { x0: CX - 13, x1: CX, d0: 8, d1: 50 } : { x0: CX, x1: CX + 13, d0: 8, d1: 50 },
        home: { x: CX + side * 6, d: 14 },
      };
    // Cover 1 robber: the hole at 10, reading the QB's eyes to jump the
    // in-breaker.
    case "robber":
      return { name: "Robber", kind: "under", box: { x0: CX - 8, x1: CX + 8, d0: 5, d1: 16 }, home: { x: CX, d: 10 } };
    case "deepMiddle":
      return { name: "Deep Middle", kind: "over", box: { x0: CX - 15, x1: CX + 15, d0: 10, d1: 50 }, home: { x: CX, d: 15 } };
    default:
      return null;
  }
}

// ── Defensive calls: explicit per front × coverage so every alignment and
// responsibility is readable in one place.
//   gap    — run fit (GAPS key) or "force-L/R" / "alley-L/R"
//   cover  — { type: "zone", zone, side } | { type: "man", target } | { type: "rush" }
const L = -1, R = 1;
const zone = (z, side) => ({ type: "zone", zone: z, side });
const man = (target) => ({ type: "man", target });
const rush = { type: "rush" };

const DEFENSES = {
  "4-3": {
    cover3: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -0.8, 0.9, "A-L", rush],
      ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -3.8, 4.8, "force-L", zone("curlFlat", L)],
      ["MLB", "MLB", "LB", 0.3, 5.2, "B-L", zone("hookIn", L)],
      ["SLB", "SLB", "LB", 3.8, 4.8, "A-R", zone("hookIn", R)],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("deepThird", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("deepThird", R)],
      ["S-L", "FS", "S", 0, 10, "alley-L", zone("middleThird")],
      ["S-R", "SS", "S", 9, 10, "force-R", zone("curlFlat", R)], // rolls down
    ],
    cover4: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -0.8, 0.9, "A-L", rush],
      ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -3.8, 4.8, "B-L", zone("curlFlat", L)],
      ["MLB", "MLB", "LB", 0.3, 5.2, "A-R", zone("hole")],
      ["SLB", "SLB", "LB", 7.0, 5.0, "force-R", zone("curlFlat", R)], // apex
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("quarterOut", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("quarterOut", R)],
      ["S-L", "FS", "S", -9, 10, "force-L", zone("quarterIn", L)],
      ["S-R", "SS", "S", 9, 10, "alley-R", zone("quarterIn", R)],
    ],
    tampa2: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -0.8, 0.9, "A-L", rush],
      ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -3.8, 4.8, "B-L", zone("hook", L)],
      ["MLB", "MLB", "LB", 0.3, 5.2, "A-R", zone("tampa")],
      ["SLB", "SLB", "LB", 7.0, 5.0, "force-R", zone("hook", R)], // apex of Y and RT
      ["CB-L", "CB", "CB", -18.6, 1.7, "alley-L", zone("flat", L)], // press, 2.5 off
      ["CB-R", "CB", "CB", 18.6, 1.7, "alley-R", zone("flat", R)], // press, 2.5 off
      ["S-L", "FS", "S", -9, 10, "force-L", zone("deepHalf", L)],
      ["S-R", "SS", "S", 9, 10, "alley-R", zone("deepHalf", R)],
    ],
    man: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -0.8, 0.9, "A-L", rush],
      ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -10.2, 5.2, "force-L", man("H")],
      ["MLB", "MLB", "LB", 0.3, 5.2, "A-R", man("RB")],
      ["SLB", "SLB", "LB", -1.6, 4.8, "B-L", rush], // blitz
      ["CB-L", "CB", "CB", -17.2, 6, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 17.2, 6, "alley-R", man("Z")],
      ["S-L", "FS", "S", 0, 10, "alley-L", zone("deepMiddle")],
      ["S-R", "SS", "S", 10.2, 10, "force-R", man("Y")],
    ],
    // Cover 2 Man: two deep halves, man across underneath, four rush.
    cover2man: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -0.8, 0.9, "A-L", rush],
      ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -10.2, 5.2, "force-L", man("H")],
      ["MLB", "MLB", "LB", 0.3, 5.2, "A-R", man("RB")],
      ["SLB", "SLB", "LB", 10.2, 5.2, "force-R", man("Y")],
      ["CB-L", "CB", "CB", -18.2, 5, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 18.2, 5, "alley-R", man("Z")],
      ["S-L", "FS", "S", -9, 11, "alley-L", zone("deepHalf", L)],
      ["S-R", "SS", "S", 9, 11, "alley-R", zone("deepHalf", R)],
    ],
    // Cover 1 Robber: free safety in the middle of the field, the strong
    // safety robs the hole, man across, four rush.
    cover1robber: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -0.8, 0.9, "A-L", rush],
      ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -10.2, 5.2, "force-L", man("H")],
      ["MLB", "MLB", "LB", 0.3, 5.2, "A-R", man("RB")],
      ["SLB", "SLB", "LB", 10.2, 5.2, "force-R", man("Y")],
      ["CB-L", "CB", "CB", -17.2, 6, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 17.2, 6, "alley-R", man("Z")],
      ["S-L", "FS", "S", 0, 12, "alley-L", zone("deepMiddle")],
      ["S-R", "SS", "S", 3, 9, "B-L", zone("robber")],
    ],
  },
  "3-4": {
    cover3: [
      ["DE-L", "DE", "DL", -2.4, 0.9, "B-L", rush],
      ["NT", "NT", "DL", -0.1, 0.9, "A-L", rush],
      ["DE-R", "DE", "DL", 2.4, 0.9, "B-R", rush],
      ["OLB-L", "OLB", "LB", -5.2, 1.1, "C-L", zone("curlFlat", L)],
      ["ILB-L", "ILB", "LB", -1.8, 4.8, "A-R", zone("hookIn", L)],
      ["ILB-R", "ILB", "LB", 1.8, 4.8, "alley-R", zone("hookIn", R)],
      ["OLB-R", "OLB", "LB", 5.2, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("deepThird", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("deepThird", R)],
      ["S-L", "FS", "S", 0, 10, "alley-L", zone("middleThird")],
      ["S-R", "SS", "S", 9, 10, "force-R", zone("curlFlat", R)], // rolls down
    ],
    cover4: [
      ["DE-L", "DE", "DL", -2.4, 0.9, "B-L", rush],
      ["NT", "NT", "DL", -0.1, 0.9, "A-L", rush],
      ["DE-R", "DE", "DL", 2.4, 0.9, "B-R", rush],
      ["OLB-L", "OLB", "LB", -5.2, 1.1, "C-L", zone("curlFlat", L)],
      ["ILB-L", "ILB", "LB", -1.8, 4.8, "A-R", zone("hole")],
      ["ILB-R", "ILB", "LB", 1.8, 4.8, "force-R", zone("curlFlat", R)],
      ["OLB-R", "OLB", "LB", 5.2, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("quarterOut", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("quarterOut", R)],
      ["S-L", "FS", "S", -9, 10, "force-L", zone("quarterIn", L)],
      ["S-R", "SS", "S", 9, 10, "alley-R", zone("quarterIn", R)],
    ],
    tampa2: [
      ["DE-L", "DE", "DL", -2.4, 0.9, "B-L", rush],
      ["NT", "NT", "DL", -0.1, 0.9, "A-L", rush],
      ["DE-R", "DE", "DL", 2.4, 0.9, "B-R", rush],
      ["OLB-L", "OLB", "LB", -5.2, 1.1, "C-L", zone("hook", L)],
      ["ILB-L", "ILB", "LB", -1.8, 4.8, "A-R", zone("tampa")],
      ["ILB-R", "ILB", "LB", 1.8, 4.8, "force-R", zone("hook", R)],
      ["OLB-R", "OLB", "LB", 5.2, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -18.6, 1.7, "alley-L", zone("flat", L)], // press, 2.5 off
      ["CB-R", "CB", "CB", 18.6, 1.7, "alley-R", zone("flat", R)], // press, 2.5 off
      ["S-L", "FS", "S", -9, 10, "force-L", zone("deepHalf", L)],
      ["S-R", "SS", "S", 9, 10, "alley-R", zone("deepHalf", R)],
    ],
    man: [
      ["DE-L", "DE", "DL", -2.4, 0.9, "B-L", rush],
      ["NT", "NT", "DL", -0.1, 0.9, "A-L", rush],
      ["DE-R", "DE", "DL", 2.4, 0.9, "B-R", rush],
      ["OLB-L", "OLB", "LB", -5.2, 1.1, "C-L", rush],
      ["ILB-L", "ILB", "LB", -10.2, 5.2, "force-L", man("H")],
      ["ILB-R", "ILB", "LB", 1.8, 4.8, "A-R", rush], // blitz
      ["OLB-R", "OLB", "LB", 5.2, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -17.2, 6, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 17.2, 6, "alley-R", man("Z")],
      ["S-L", "FS", "S", 0, 10, "alley-L", zone("deepMiddle")],
      ["S-R", "SS", "S", 10.2, 10, "force-R", man("Y")],
    ],
    cover2man: [
      ["DE-L", "DE", "DL", -2.4, 0.9, "B-L", rush],
      ["NT", "NT", "DL", -0.1, 0.9, "A-L", rush],
      ["DE-R", "DE", "DL", 2.4, 0.9, "B-R", rush],
      ["OLB-L", "OLB", "LB", -5.2, 1.1, "C-L", man("H")],
      ["ILB-L", "ILB", "LB", -1.8, 4.8, "A-R", man("RB")],
      ["ILB-R", "ILB", "LB", 1.8, 4.8, "B-R", man("Y")],
      ["OLB-R", "OLB", "LB", 5.2, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -18.2, 5, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 18.2, 5, "alley-R", man("Z")],
      ["S-L", "FS", "S", -9, 11, "force-L", zone("deepHalf", L)],
      ["S-R", "SS", "S", 9, 11, "force-R", zone("deepHalf", R)],
    ],
    cover1robber: [
      ["DE-L", "DE", "DL", -2.4, 0.9, "B-L", rush],
      ["NT", "NT", "DL", -0.1, 0.9, "A-L", rush],
      ["DE-R", "DE", "DL", 2.4, 0.9, "B-R", rush],
      ["OLB-L", "OLB", "LB", -5.2, 1.1, "C-L", man("H")],
      ["ILB-L", "ILB", "LB", -1.8, 4.8, "A-R", man("RB")],
      ["ILB-R", "ILB", "LB", 1.8, 4.8, "B-R", man("Y")],
      ["OLB-R", "OLB", "LB", 5.2, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -17.2, 6, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 17.2, 6, "alley-R", man("Z")],
      ["S-L", "FS", "S", 0, 12, "alley-L", zone("deepMiddle")],
      ["S-R", "SS", "S", 3, 9, "force-R", zone("robber")],
    ],
  },
  // Double mug: the WILL and MIKE show at linebacker depth, then creep up
  // into the A gaps pre-snap. From it: an all-out blitz (Cover 0), or they
  // bail out into coverage at the snap.
  mug: {
    // Cover 0 — all six come, man across
    zero: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -1.9, 0.9, "B-L", rush],
      ["DT-R", "DT", "DL", 1.9, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -1.6, 4.6, "A-L", rush, { creep: [-0.75, 1.1] }],
      ["MLB", "MLB", "LB", 1.6, 4.6, "A-R", rush, { creep: [0.75, 1.1] }],
      ["SLB", "SLB", "LB", 7.0, 4.8, "force-R", man("RB")],
      ["CB-L", "CB", "CB", -18.6, 5, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 18.6, 5, "alley-R", man("Z")],
      ["S-L", "FS", "S", -9, 10.5, "alley-L", man("H")],
      ["S-R", "SS", "S", 9, 10.5, "force-R", man("Y")],
    ],
    // muggers drop: WILL hook, MIKE runs the middle
    tampa2: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -1.9, 0.9, "B-L", rush],
      ["DT-R", "DT", "DL", 1.9, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -1.6, 4.6, "A-L", zone("hook", L), { creep: [-0.75, 1.1] }],
      ["MLB", "MLB", "LB", 1.6, 4.6, "A-R", zone("tampa"), { creep: [0.75, 1.1] }],
      ["SLB", "SLB", "LB", 7.0, 4.8, "force-R", zone("hook", R)],
      ["CB-L", "CB", "CB", -18.6, 1.7, "alley-L", zone("flat", L)],
      ["CB-R", "CB", "CB", 18.6, 1.7, "alley-R", zone("flat", R)],
      ["S-L", "FS", "S", -9, 10.5, "force-L", zone("deepHalf", L)],
      ["S-R", "SS", "S", 9, 10.5, "alley-R", zone("deepHalf", R)],
    ],
    // muggers drop to the hooks
    cover3: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -1.9, 0.9, "B-L", rush],
      ["DT-R", "DT", "DL", 1.9, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -1.6, 4.6, "A-L", zone("hookIn", L), { creep: [-0.75, 1.1] }],
      ["MLB", "MLB", "LB", 1.6, 4.6, "A-R", zone("hookIn", R), { creep: [0.75, 1.1] }],
      ["SLB", "SLB", "LB", 7.0, 4.8, "force-R", zone("curlFlat", R)],
      ["CB-L", "CB", "CB", -18.6, 7, "alley-L", zone("deepThird", L)],
      ["CB-R", "CB", "CB", 18.6, 7, "alley-R", zone("deepThird", R)],
      ["S-L", "FS", "S", -9, 10.5, "force-L", zone("curlFlat", L)], // rolls down
      ["S-R", "SS", "S", 9, 10.5, "alley-R", zone("middleThird")], // spins to the middle
    ],
    // muggers drop to the hooks
    cover4: [
      ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
      ["DT-L", "DT", "DL", -1.9, 0.9, "B-L", rush],
      ["DT-R", "DT", "DL", 1.9, 0.9, "B-R", rush],
      ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
      ["WLB", "WLB", "LB", -1.6, 4.6, "A-L", zone("hookIn", L), { creep: [-0.75, 1.1] }],
      ["MLB", "MLB", "LB", 1.6, 4.6, "A-R", zone("hookIn", R), { creep: [0.75, 1.1] }],
      ["SLB", "SLB", "LB", 7.0, 4.8, "force-R", zone("curlFlat", R)],
      ["CB-L", "CB", "CB", -18.6, 7, "alley-L", zone("quarterOut", L)],
      ["CB-R", "CB", "CB", 18.6, 7, "alley-R", zone("quarterOut", R)],
      ["S-L", "FS", "S", -9, 10.5, "force-L", zone("quarterIn", L)],
      ["S-R", "SS", "S", 9, 10.5, "alley-R", zone("quarterIn", R)],
    ],
  },
};

// ── Nickel 4-2-5: the SAM comes off for a nickel corner (NB) over the
// slot — the answer to spread sets. Two linebackers stacked behind a 1- and
// 3-technique. ──
DEFENSES.nickel = (() => {
  const line = [
    ["DE-L", "DE", "DL", -4.2, 0.9, "C-L", rush],
    ["DT-L", "DT", "DL", -0.8, 0.9, "A-L", rush],
    ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
    ["DE-R", "DE", "DL", 4.2, 0.9, "C-R", rush],
  ];
  return {
    cover3: [
      ...line,
      ["WLB", "WLB", "LB", -1.8, 4.8, "B-L", zone("hookIn", L)],
      ["MLB", "MLB", "LB", 1.8, 4.8, "A-R", zone("hookIn", R)],
      ["NB", "NB", "CB", 9.5, 5, "force-R", zone("curlFlat", R)],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("deepThird", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("deepThird", R)],
      ["S-L", "FS", "S", -9, 10.5, "force-L", zone("curlFlat", L)], // rolls down
      ["S-R", "SS", "S", 9, 10.5, "alley-R", zone("middleThird")], // spins to the middle
    ],
    cover4: [
      ...line,
      ["WLB", "WLB", "LB", -1.8, 4.8, "B-L", zone("curlFlat", L)],
      ["MLB", "MLB", "LB", 1.8, 4.8, "A-R", zone("hole")],
      ["NB", "NB", "CB", 9.5, 5, "force-R", zone("curlFlat", R)],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("quarterOut", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("quarterOut", R)],
      ["S-L", "FS", "S", -9, 10, "force-L", zone("quarterIn", L)],
      ["S-R", "SS", "S", 9, 10, "alley-R", zone("quarterIn", R)],
    ],
    tampa2: [
      ...line,
      ["WLB", "WLB", "LB", -1.8, 4.8, "B-L", zone("hook", L)],
      ["MLB", "MLB", "LB", 1.8, 4.8, "A-R", zone("tampa")],
      ["NB", "NB", "CB", 9.5, 5, "force-R", zone("hook", R)],
      ["CB-L", "CB", "CB", -18.6, 1.7, "alley-L", zone("flat", L)],
      ["CB-R", "CB", "CB", 18.6, 1.7, "alley-R", zone("flat", R)],
      ["S-L", "FS", "S", -9, 10, "force-L", zone("deepHalf", L)],
      ["S-R", "SS", "S", 9, 10, "alley-R", zone("deepHalf", R)],
    ],
    cover2man: [
      ...line,
      ["WLB", "WLB", "LB", -1.8, 4.8, "B-L", man("H")],
      ["MLB", "MLB", "LB", 1.8, 4.8, "A-R", man("RB")],
      ["NB", "NB", "CB", 10.5, 5, "force-R", man("Y")],
      ["CB-L", "CB", "CB", -18.2, 5, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 18.2, 5, "alley-R", man("Z")],
      ["S-L", "FS", "S", -9, 11, "force-L", zone("deepHalf", L)],
      ["S-R", "SS", "S", 9, 11, "alley-R", zone("deepHalf", R)],
    ],
    cover1robber: [
      ...line,
      ["WLB", "WLB", "LB", -1.8, 4.8, "B-L", man("H")],
      ["MLB", "MLB", "LB", 1.8, 4.8, "A-R", man("RB")],
      ["NB", "NB", "CB", 10.5, 5, "force-R", man("Y")],
      ["CB-L", "CB", "CB", -17.2, 6, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 17.2, 6, "alley-R", man("Z")],
      ["S-L", "FS", "S", 0, 12, "alley-L", zone("deepMiddle")],
      ["S-R", "SS", "S", 3, 9, "force-L", zone("robber")],
    ],
  };
})();

// ── Bear (46): five on the line and both guards and the center covered —
// 3-techniques on the guards, a nose head-up on the center, the SAM walked
// up as the edge on one side and the end on the other; the strong safety
// down in the box. Built to kill the inside run (no double teams on the
// interior) at the cost of the perimeter. ──
DEFENSES.bear = (() => {
  const line = [
    ["DT-L", "DT", "DL", -2.1, 0.9, "B-L", rush],
    ["NT", "NT", "DL", 0, 0.9, "A-L", rush],
    ["DT-R", "DT", "DL", 2.1, 0.9, "B-R", rush],
    ["DE-R", "DE", "DL", 4.4, 0.9, "C-R", rush],
  ];
  return {
    cover3: [
      ...line,
      ["SLB", "SLB", "LB", -4.4, 1.1, "C-L", zone("curlFlat", L)], // on the line, drops
      ["WLB", "WLB", "LB", -1.4, 4.6, "A-R", zone("hookIn", L)],
      ["MLB", "MLB", "LB", 1.4, 4.6, "D-R", zone("hookIn", R)],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("deepThird", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("deepThird", R)],
      ["S-L", "FS", "S", 0, 11, "alley-L", zone("middleThird")],
      ["S-R", "SS", "S", 7, 5.5, "force-R", zone("curlFlat", R)], // in the box
    ],
    // Cover 1: the SAM comes (five-man rush), man across, free safety
    // deep, the box safety on the Y.
    man: [
      ...line,
      ["SLB", "SLB", "LB", -4.4, 1.1, "C-L", rush],
      ["WLB", "WLB", "LB", -1.4, 4.6, "A-R", man("H")],
      ["MLB", "MLB", "LB", 1.4, 4.6, "D-R", man("RB")],
      ["CB-L", "CB", "CB", -17.2, 6, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 17.2, 6, "alley-R", man("Z")],
      ["S-L", "FS", "S", 0, 11, "alley-L", zone("deepMiddle")],
      ["S-R", "SS", "S", 8, 5.5, "force-R", man("Y")],
    ],
    // Bear blitz, Cover 0: the SAM and the WILL come too — six rush, man
    // across with no help.
    zero: [
      ...line,
      ["SLB", "SLB", "LB", -4.4, 1.1, "C-L", rush],
      ["WLB", "WLB", "LB", -1.4, 4.6, "A-R", rush, { creep: [-0.8, 1.2] }],
      ["MLB", "MLB", "LB", 1.4, 4.6, "D-R", man("RB")],
      ["CB-L", "CB", "CB", -18.6, 5, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 18.6, 5, "alley-R", man("Z")],
      ["S-L", "FS", "S", -9, 9, "alley-L", man("H")],
      ["S-R", "SS", "S", 8, 5.5, "force-R", man("Y")],
    ],
  };
})();

// ── Tite (3-4 Tite): 4i – 0 – 4i. Both ends on the inside shoulders of the
// tackles and a nose on the center: the A and B gaps are closed off with
// three men, so the inside zone has nowhere to cut back. Two edge OLBs. ──
DEFENSES.tite = (() => {
  const line = [
    ["DE-L", "DE", "DL", -2.5, 0.9, "B-L", rush],
    ["NT", "NT", "DL", 0, 0.9, "A-L", rush],
    ["DE-R", "DE", "DL", 2.5, 0.9, "B-R", rush],
  ];
  return {
    cover3: [
      ...line,
      ["OLB-L", "OLB", "LB", -5.0, 1.1, "C-L", zone("curlFlat", L)],
      ["ILB-L", "ILB", "LB", -1.6, 4.8, "A-R", zone("hookIn", L)],
      ["ILB-R", "ILB", "LB", 1.6, 4.8, "alley-R", zone("hookIn", R)],
      ["OLB-R", "OLB", "LB", 5.0, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("deepThird", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("deepThird", R)],
      ["S-L", "FS", "S", 0, 10, "alley-L", zone("middleThird")],
      ["S-R", "SS", "S", 9, 10, "force-R", zone("curlFlat", R)],
    ],
    cover4: [
      ...line,
      ["OLB-L", "OLB", "LB", -5.0, 1.1, "C-L", zone("curlFlat", L)],
      ["ILB-L", "ILB", "LB", -1.6, 4.8, "A-R", zone("hole")],
      ["ILB-R", "ILB", "LB", 1.6, 4.8, "force-R", zone("curlFlat", R)],
      ["OLB-R", "OLB", "LB", 5.0, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -19, 7, "alley-L", zone("quarterOut", L)],
      ["CB-R", "CB", "CB", 19, 7, "alley-R", zone("quarterOut", R)],
      ["S-L", "FS", "S", -9, 10, "force-L", zone("quarterIn", L)],
      ["S-R", "SS", "S", 9, 10, "alley-R", zone("quarterIn", R)],
    ],
    cover1robber: [
      ...line,
      ["OLB-L", "OLB", "LB", -5.0, 1.1, "C-L", man("H")],
      ["ILB-L", "ILB", "LB", -1.6, 4.8, "A-R", man("RB")],
      ["ILB-R", "ILB", "LB", 1.6, 4.8, "B-R", man("Y")],
      ["OLB-R", "OLB", "LB", 5.0, 1.1, "C-R", rush],
      ["CB-L", "CB", "CB", -17.2, 6, "alley-L", man("X")],
      ["CB-R", "CB", "CB", 17.2, 6, "alley-R", man("Z")],
      ["S-L", "FS", "S", 0, 12, "alley-L", zone("deepMiddle")],
      ["S-R", "SS", "S", 3, 9, "force-R", zone("robber")],
    ],
  };
})();

export function buildDefense(front, coverage) {
  const rows = DEFENSES[front][coverage];
  return rows.map(([id, position, role, dx, dd, gap, cover, opts = {}]) => {
    const assignment = { gap, cover: { ...cover } };
    // A defender who shows one spot and walks to another before the snap.
    if (opts.creep) assignment.creep = { x: CX + opts.creep[0], y: LOS + opts.creep[1] };
    if (cover.type === "zone") assignment.cover.def = zoneDef(cover.zone, cover.side);
    if (GAPS[gap] != null) assignment.gapX = CX + GAPS[gap];
    return createPlayer({ id, team: "D", position, role, x: CX + dx, y: LOS + dd, facing: DOWN, assignment });
  });
}
