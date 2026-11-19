// src/utils/recruitSim/work.js
//
// One school's window of recruiting work (spec §10 steps 2–4): board
// membership and priority, NIL offers and the six staff members' assignments
// turn into interest gains and scouting rolls. Run for the user's school and
// every CPU school with the same code.
//
// Staff (spec §8):
//   HC / OC / DC   coaches — build interest (HC all, OC offense, DC defense;
//                  a coordinator can work the other side, less well),
//                  occasionally come back with a recommendation; never scout
//   HS / OS / DS   scouts — reveal traits (HS all, OS offense, DS defense);
//                  never build interest or recommend
// Assignment: { kind: "area", region, pos } (pos "ALL" = the role's whole
// coverage, else an array of position groups) or { kind: "recruit", r }.
import { rngFor, cumulative, drawCumulative, intBetween, clamp } from "./rng.js";
import { sideOf, OFFENSE, POSITIONS } from "./traits.js";
import { scoutRoll } from "./scouting.js";
import { relMult, nilMult, nilSat, ptContext, phaseOf } from "./model.js";
import { logEvent } from "./events.js";

export const ROLES = ["HC", "OC", "DC", "HS", "OS", "DS"];
export const ROLE_LABEL = { HC: "Head Coach", OC: "Offensive Coordinator", DC: "Defensive Coordinator", HS: "Head Scout", OS: "Offensive Scout", DS: "Defensive Scout" };
export const COACHES = new Set(["HC", "OC", "DC"]);
export const REC_BIT = { HC: 1, OC: 2, DC: 4 };
// Area assignments target position GROUPS — RB and TE scout together (user,
// 2026-11-17).
export const POS_GROUPS = { QB: ["QB"], "RB/TE": ["RB", "TE"], WR: ["WR"], OL: ["OL"], EDGE: ["EDGE"], DL: ["DL"], LB: ["LB"], DB: ["DB"] };
export const groupsFor = (role) => Object.keys(POS_GROUPS).filter((g) => POS_GROUPS[g].some((p) => coverage(role).includes(p)));
// Which positions a role covers.
export const coverage = (role) => (role === "HC" || role === "HS" ? POSITIONS : role === "OC" || role === "OS" ? POSITIONS.filter((p) => OFFENSE.has(p)) : POSITIONS.filter((p) => !OFFENSE.has(p)));
export const covers = (role, pos) => coverage(role).includes(pos);

// An area assignment's position groups: "ALL", one group (older saves) or
// any set of groups (user, 2026-11-17 — the staffer's looks stay the same,
// just spread across more kids).
export const groupList = (a) => (!a?.pos || a.pos === "ALL" ? null : Array.isArray(a.pos) ? a.pos : [a.pos]);
export function areaPositions(role, a) {
  const g = groupList(a);
  return g ? g.flatMap((k) => POS_GROUPS[k] || [k]).filter((p) => covers(role, p)) : coverage(role);
}
export const narrowed = (role, a) => !!groupList(a) && areaPositions(role, a).length < coverage(role).length;

// Relationships (user, 2026-11-18): time each staffer has spent with a kid,
// per school — state.bond[(s·N + r)·6 + role], in quarter-windows (BOND_UNIT):
// a window one-on-one = 4, contact on a regional trip = cfg bond.area × 4
// (once per staffer per window). The more time, the more each visit lands —
// one-on-one or on the road; a coach on his own recommendation ("his guy")
// lands more; a coordinator on the other side of the ball, less.
export const BOND_UNIT = 4;
export const bondAt = (state, s, r) => (s * state.N + r) * ROLES.length;
export function bondMult(state, s, role, r) {
  const b = state.cfg.staff.bond;
  const at = bondAt(state, s, r);
  const si = ROLES.indexOf(role);
  let m = 1;
  if (state.bond) {
    let own = 0;
    let others = 0;
    for (let i = 0; i < ROLES.length; i += 1) { const v = state.bond[at + i] / BOND_UNIT; if (i === si) own = v; else others += v; }
    m += b.own * Math.min(own, b.cap) + b.others * Math.min(others, b.cap);
  }
  if (COACHES.has(role) && state.recMask[s * state.N + r] & REC_BIT[role]) m *= b.hisGuy;
  if (COACHES.has(role) && !covers(role, state.recruits[r].pos)) m *= b.offSide;
  return m;
}
function addBond(state, s, role, r, units = BOND_UNIT) {
  if (!state.bond) return;
  const i = bondAt(state, s, r) + ROLES.indexOf(role);
  state.bond[i] = Math.min(255, state.bond[i] + units);
}
const areaUnits = (state) => Math.max(1, Math.round((state.cfg.staff.bond.area ?? 0.25) * BOND_UNIT));

// Recruits an area assignment reaches (uncommitted).
export function areaPool(state, role, a) {
  const byPos = state.derived.area[a.region] || {};
  const list = [];
  areaPositions(role, a).forEach((p) => {
    if (!covers(role, p)) return;
    (byPos[p] || []).forEach((r) => { if (state.recruits[r].commit < 0) list.push(r); });
  });
  return list;
}

// Board interest for one recruit: above the line by rank, else base.
export function boardGain(state, s, rankIdx, lineSize) {
  const b = state.cfg.board;
  if (rankIdx < 0 || lineSize <= 0) return b.baseGain;
  const t = lineSize <= 1 ? 1 : 1 - rankIdx / (lineSize - 1);
  return b.above.min + (b.above.max - b.above.min) * Math.pow(t, b.above.curve);
}

// rep (user school only): collects the window's reports.
export function runSchool(state, s, rep) {
  const sc = state.schools[s];
  const { N, cfg } = state;
  const rand = rngFor(state.seed, `work|${state.stage}|${s}`);
  const ctx = ptContext(state, s);
  const add = (r, g, why) => {
    state.interest[s * N + r] += g;
    if (rep) rep.gain[r] = (rep.gain[r] || 0) + g;
    if (rep && why) (rep.why[r] = rep.why[r] || new Set()).add(why);
  };
  const phase = phaseOf(state);
  const lineSize = phase === "summer" ? cfg.board.line.summer : phase === "fall" ? cfg.board.line.fall : 0;

  // ── Board (spring on): interest by priority + passive scouting ──
  const aboveIdx = new Map(sc.above.map((r, k) => [r, k]));
  sc.board.forEach((r) => {
    const x = state.recruits[r];
    if (x.commit >= 0) return;
    const k = aboveIdx.has(r) ? aboveIdx.get(r) : -1;
    const df = state.derived.distFit[s * N + r];
    add(r, boardGain(state, s, k, lineSize) * relMult(state, s, r, ctx) * (1 + cfg.board.near.interest * df), k >= 0 ? "above" : "board");
    const rolls = intBetween(rand, cfg.scouting.boardRolls[0], cfg.scouting.boardRolls[1]) + (rand() < cfg.board.near.scout * df ? 1 : 0);
    for (let i = 0; i < rolls; i += 1) scoutRoll(state, s, r, true, rand, rep ? rep.scout.board : null);
    if (rep) state.intel[r] = Math.max(state.intel[r], 2);
  });

  // ── NIL offers (above the line) ──
  Object.entries(sc.nil).forEach(([key, offer]) => {
    const r = Number(key);
    const x = state.recruits[r];
    if (x.commit >= 0 || !(offer > 0)) return;
    add(r, cfg.nilGain * nilMult(x) * nilSat(state, offer, x.ask), "nil");
  });
  // Cuts since the window opened cost interest (smaller if he's regressed).
  Object.entries(sc.nilSnap || {}).forEach(([key, before]) => {
    const r = Number(key);
    const now = sc.nil[r] || 0;
    const x = state.recruits[r];
    if (!(before > now) || x.commit >= 0) return;
    const cut = (before - now) / before;
    const shield = x.ovr < x.ovr0 - 0.5 ? cfg.regressShield : 1;
    state.interest[s * N + r] = Math.max(0, state.interest[s * N + r] - cfg.nilCutPenalty * cut * shield);
    if (rep) rep.cuts.push({ r, before, now });
    logEvent(state, s, "nilCut", r, { before, now });
  });

  // ── Staff ──
  sc.staff.forEach((a, si) => {
    const role = ROLES[si];
    if (!a) return;
    const out = rep ? { role, a, visits: 0, recs: [], reached: new Set(), scout: [] } : null;
    if (COACHES.has(role)) {
      if (a.kind === "recruit") {
        const x = state.recruits[a.r];
        if (x && x.commit < 0) {
          add(a.r, cfg.staff.coachGain[role] * relMult(state, s, a.r, ctx) * bondMult(state, s, role, a.r), `coach:${role}`);
          addBond(state, s, role, a.r);
          if (out) { out.visits = 1; out.reached.add(a.r); state.intel[a.r] = 2; }
          maybeRecommend(state, s, role, a.r, rand, out, cfg.staff.recommend.individualChance);
          if (rep) logEvent(state, s, "coachRecruit", a.r, { role });
        }
      } else if (a.kind === "area") {
        const pool = areaPool(state, role, a);
        if (pool.length) {
          const cum = cumulative(pool.map((r) => Math.pow(Math.max(0.5, state.recruits[r].rating - 62), cfg.staff.areaWeightPow / 2)));
          const visits = cfg.staff.areaVisits[role];
          let recs = 0;
          const met = new Set();
          for (let v = 0; v < visits; v += 1) {
            const r = pool[drawCumulative(rand, cum)];
            met.add(r);
            add(r, cfg.staff.areaGain * relMult(state, s, r, ctx) * bondMult(state, s, role, r), `area:${role}`);
            if (out) { out.visits += 1; out.reached.add(r); state.intel[r] = Math.max(state.intel[r], 1); }
            if (recs < cfg.staff.recommend.maxPerWindow && maybeRecommend(state, s, role, r, rand, out, null)) recs += 1;
          }
          // Regional contact builds the relationship too (user, 2026-11-18).
          met.forEach((r) => addBond(state, s, role, r, areaUnits(state)));
          if (rep) out.reached.forEach((r) => logEvent(state, s, "coachVisit", r, { role, region: a.region }));
        }
      }
    } else {
      // Scouts.
      const changes = out ? out.scout : null;
      const sg = cfg.staff.scoutGain || { recruit: 0, area: 0 };
      if (a.kind === "recruit") {
        const x = state.recruits[a.r];
        if (x) {
          if (x.commit < 0 && sg.recruit) { add(a.r, sg.recruit * relMult(state, s, a.r, ctx) * bondMult(state, s, role, a.r), `scout:${role}`); addBond(state, s, role, a.r); }
          const rolls = cfg.scouting.individual[role][sideOf(x.pos)];
          for (let i = 0; i < rolls; i += 1) scoutRoll(state, s, a.r, true, rand, changes);
          if (out) out.reached.add(a.r);
        }
      } else if (a.kind === "area") {
        const pool = areaPool(state, role, a);
        if (pool.length) {
          const cum = cumulative(pool.map((r) => 0.25 + Math.pow(Math.max(0, state.recruits[r].rating - 65) / 35, cfg.scouting.regionalWeightPow)));
          const rolls = Math.round(cfg.scouting.regional[role] * (narrowed(role, a) ? cfg.scouting.regionalPosFocus : 1));
          const seen = new Set();
          for (let i = 0; i < rolls; i += 1) {
            const r = pool[drawCumulative(rand, cum)];
            scoutRoll(state, s, r, false, rand, changes);
            seen.add(r);
            if (out) out.reached.add(r);
          }
          if (sg.area) seen.forEach((r) => add(r, sg.area * relMult(state, s, r, ctx) * bondMult(state, s, role, r), `scout:${role}`));
          seen.forEach((r) => addBond(state, s, role, r, areaUnits(state)));
        }
      }
    }
    if (rep) rep.staff[role] = out;
  });
}

// A coach falls for a prospect he saw — mostly kids better than their
// public rating, sometimes simply great ones. Never reveals a grade.
function maybeRecommend(state, s, role, r, rand, out, fixedChance) {
  const x = state.recruits[r];
  const bit = REC_BIT[role];
  const key = s * state.N + r;
  if (state.recMask[key] & bit) return false;
  const rc = state.cfg.staff.recommend;
  const under = x.ovr - x.rating;
  let chance = under >= rc.underBy ? (under - rc.underBy + 1) * rc.chancePerPoint : 0;
  if (x.ovr >= rc.eliteOvr) chance += rc.eliteChance;
  if (fixedChance != null) chance = under >= rc.underBy || x.ovr >= rc.eliteOvr ? Math.max(chance, fixedChance) : 0;
  if (!(rand() < clamp(chance, 0, 0.6))) return false;
  state.recMask[key] |= bit;
  if (out) out.recs.push(r);
  logEvent(state, s, "recommend", r, { role });
  return true;
}
