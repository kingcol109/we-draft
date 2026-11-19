// src/utils/recruitSim/lifecycle.js
//
// The recruit decision lifecycle (spec §18–19): open → top 10 → final list
// (2–4) → commitment, on each recruit's own timeline, plus occasional
// demands. Runs after the window's interest and standings are in.
//
// Rules:
//   • A list only includes schools that have him on their board.
//   • Top 10 is binding by default (cfg.lifecycle.top10Binding); the final
//     list always is — schools outside it can't win him.
//   • He can only commit to a school that has him ABOVE the line and still
//     has room (cfg.classLimit).
//   • His pick is weighted by standing: p ∝ exp(sharp × score / best) — a
//     clear favorite usually wins, close races stay live.
//   • Not ready (the leader's interest is still thin) → he waits a week or
//     few. Signing Day: everyone left decides; no eligible school = unsigned.
//   • Every finalist dropped him → he reopens his recruitment.
import { rngFor, intBetween, pickWeighted } from "./rng.js";
import { fallWeek, phaseOf } from "./model.js";
import { logEvent } from "./events.js";
import { KT, K_EXACT } from "./traits.js";
import { applyJump } from "./development.js";

const onBoard = (sc, r) => sc.board.includes(r);
const isAbove = (sc, r) => sc.above.includes(r);
const hasRoom = (state, sc) => sc.commits.length < state.cfg.classLimit;

// Commit r to school s: NIL outstanding → spent there, released everywhere
// else; he leaves every board.
export function commitRecruit(state, r, s, how = "decision") {
  const x = state.recruits[r];
  const rank = state.schools[s].above.indexOf(r) + 1; // his spot on that line
  const list = x.announce ? x.announce.list.slice() : x.list ? x.list.slice() : null;
  x.announce = null;
  // Who was leading when he decided — an upset is part of the story
  // (user, 2026-11-18). Standing order among schools still in it.
  const live = (x.top || []).filter(([t]) => !list || list.includes(t));
  const place = live.findIndex(([t]) => t === s) + 1;
  const jump = live[0] && live[0][0] !== s ? { over: live[0][0], place: place || null, pct: Math.round(((live.find(([t]) => t === s)?.[1] || 0) / (live[0][1] || 1)) * 100) } : null;
  const field = live.slice(0, 4).map(([t, v]) => [t, Math.round((v / (live[0][1] || 1)) * 100)]);
  // Committed to the user: his whole scouting profile opens up (user, 2026-11-17).
  if (s === state.user) state.know.fill(K_EXACT, (s * state.N + r) * KT, (s * state.N + r) * KT + KT);
  x.commit = s;
  x.status = "committed";
  applyJump(state, x); // his potential decides the jump he makes (user, 2026-11-18)
  x.commitStage = state.stage;
  x.demand = null;
  state.schools.forEach((sc, t) => {
    const offer = sc.nil[r] || 0;
    if (t === s) { sc.spent += offer; sc.commits.push(r); sc.paid[r] = offer; }
    delete sc.nil[r];
    if (sc.nilSnap) delete sc.nilSnap[r];
    const was = onBoard(sc, r);
    sc.board = sc.board.filter((v) => v !== r);
    sc.above = sc.above.filter((v) => v !== r);
    sc.staff = sc.staff.map((a) => (a?.kind === "recruit" && a.r === r ? null : a));
    if (state.bond && t !== s) state.bond.fill(0, (t * state.N + r) * 6, (t * state.N + r) * 6 + 6);
    if (t === state.user && t !== s && was) {
      logEvent(state, t, "lostTo", r, { to: s, jump, field });
      // Shown under the board for a window, like a lockout.
      sc.lockedOut = (sc.lockedOut || []).filter((o) => state.stage - o.st < 1);
      sc.lockedOut.push({ r, st: state.stage, stage: "commit", to: s, jump });
    }
  });
  logEvent(state, s, "commit", r, { to: s, how, stars: x.stars, rank, list, jump, field });
}

// A list is out: every school not on it loses him from its board (offer
// released, staff pulled). The user's lockouts show under the board for a
// window — "no longer considering you" (user, 2026-11-17).
function lockOut(state, x, list, stage) {
  state.schools.forEach((sc, s) => {
    if (list.includes(s) || !onBoard(sc, x.i)) return;
    sc.board = sc.board.filter((v) => v !== x.i);
    sc.above = sc.above.filter((v) => v !== x.i);
    delete sc.nil[x.i];
    if (sc.nilSnap) delete sc.nilSnap[x.i];
    sc.staff = sc.staff.map((a) => (a?.kind === "recruit" && a.r === x.i ? null : a));
    if (s === state.user) {
      sc.lockedOut = (sc.lockedOut || []).filter((o) => state.stage - o.st < 1);
      sc.lockedOut.push({ r: x.i, st: state.stage, stage });
      logEvent(state, s, "dropped", x.i, { stage });
    }
  });
}
// A list of one: he's decided (user, 2026-11-17) — commits now if that school
// can take him (above its line, room), else he waits on them.
function topOne(state, x) {
  if (!x.list || x.list.length !== 1) return false;
  const s = x.list[0];
  if (!isAbove(state.schools[s], x.i) || !hasRoom(state, state.schools[s])) return false;
  commitRecruit(state, x.i, s, "topOne");
  return true;
}

// Final list size: a clear leader → 2, a pack → 4.
function finalSize(state, x, rand) {
  const [lo, hi] = state.cfg.lifecycle.finalSize;
  const top = x.list.map((s) => scoreFor(x, s)).sort((a, b) => b - a);
  if (top.length < 2) return lo;
  // Anyone within reach of the leader stays in it (user, 2026-11-18: races
  // shouldn't shrink to two so fast).
  const close = top.slice(1, 4).filter((v) => v >= top[0] * 0.55).length;
  return Math.max(lo, Math.min(hi, lo + close + (rand() < 0.45 ? 1 : 0) - 1));
}
const scoreFor = (x, s) => (x.top || []).find(([t]) => t === s)?.[1] || 0;

// Top schools that have him on their board (in standing order).
function contenders(state, x, limit, within = null) {
  const out = [];
  (x.top || []).forEach(([s, v]) => {
    if (out.length >= limit) return;
    if (within && !within.includes(s)) return;
    if (v < state.cfg.lifecycle.minInterestToList) return;
    if (!onBoard(state.schools[s], x.i)) return;
    out.push(s);
  });
  return out;
}

// Pick among eligible schools (above the line, room).
function decide(state, x, rand, pool) {
  const elig = pool.filter((s) => isAbove(state.schools[s], x.i) && hasRoom(state, state.schools[s]));
  if (!elig.length) return -1;
  const scores = elig.map((s) => scoreFor(x, s));
  const best = Math.max(...scores, 0.0001);
  const sharp = state.cfg.lifecycle.sharp;
  const w = scores.map((v) => Math.exp(sharp * (v / best - 1)));
  return elig[pickWeighted(rand, w)];
}

// Demands (spec §19): resolve the ones from last window, then maybe make new
// ones. A met NIL demand = he commits on the spot.
function resolveDemand(state, x) {
  const d = x.demand;
  if (!d) return false;
  const sc = state.schools[d.s];
  let met = false;
  if (d.type === "nil") met = (sc.nil[x.i] || 0) >= d.amount && isAbove(sc, x.i) && hasRoom(state, sc) && fallWeek(state) >= state.cfg.lifecycle.earliestCommit;
  else if (d.type === "pt") met = !onBoard(sc, d.target);
  if (met) {
    logEvent(state, d.s, "demandMet", x.i, { type: d.type });
    x.demand = null;
    if (d.type === "nil") { commitRecruit(state, x.i, d.s, "demand"); return true; }
    state.interest[d.s * state.N + x.i] += state.cfg.demands.ptGain;
    return false;
  }
  if (state.stage >= d.until) {
    logEvent(state, d.s, "demandLapsed", x.i, { type: d.type });
    state.interest[d.s * state.N + x.i] = Math.max(0, state.interest[d.s * state.N + x.i] - 3);
    x.demand = null;
  }
  return false;
}
function maybeDemand(state, x, rand) {
  const cfg = state.cfg.demands;
  if (x.demand || rand() >= cfg.chance) return;
  // A school in his top 3 that has him above the line.
  const cands = (x.top || []).slice(0, 3).map(([s]) => s).filter((s) => isAbove(state.schools[s], x.i) && (!x.list || x.list.includes(s)));
  if (!cands.length) return;
  const s = cands[Math.floor(rand() * cands.length)];
  const sc = state.schools[s];
  // PT: someone at his position ranked ahead of him on that board.
  const k = sc.above.indexOf(x.i);
  const rival = sc.above.slice(0, k).find((r) => state.recruits[r].pos === x.pos);
  const ptLikely = x.prefs.pt >= 0.2 && rival != null;
  // NIL ultimatums: late, down to a list, and this school in his top 2.
  const nilLikely = x.prefs.nil >= 0.16 && fallWeek(state) >= cfg.nilFromWeek && !!x.list && (x.top || []).slice(0, 2).some(([t]) => t === s);
  if (ptLikely && (rand() < cfg.ptChance || !nilLikely)) {
    x.demand = { s, type: "pt", target: rival, until: state.stage + 1 + cfg.expires };
  } else if (nilLikely) {
    const base = Math.max(x.ask, (sc.nil[x.i] || 0) * 1.15);
    const amount = Math.ceil((base * (cfg.nilOver[0] + rand() * (cfg.nilOver[1] - cfg.nilOver[0]))) / 5000) * 5000;
    x.demand = { s, type: "nil", amount, until: state.stage + 1 + cfg.expires };
  } else return;
  logEvent(state, s, "demand", x.i, { ...x.demand });
}

// Commitment pull (user, 2026-11-18): a clear favorite — he likes them, they
// have him high on their line, nobody else is really in it — makes him ready
// sooner. Chance this window, 0..max.
function pullChance(state, x, pool, summer) {
  const lc = state.cfg.lifecycle;
  const pc = lc.pull;
  const live = (x.top || []).filter(([s]) => pool.includes(s) && onBoard(state.schools[s], x.i));
  if (!live.length) return 0;
  const [L, s1] = live[0];
  const sc = state.schools[L];
  const k = sc.above.indexOf(x.i);
  if (k < 0 || !hasRoom(state, sc)) return 0;
  if (state.interest[L * state.N + x.i] < lc.ready * pc.readyShare * readyFactor(x)) return 0;
  const s2 = live[1]?.[1] || 0;
  const dom = s2 > 0 ? s1 / s2 : 9;
  const rivals = live.slice(1).filter(([, v]) => v >= s1 * pc.rival).length;
  let h = pc.base + pc.dom * Math.max(0, Math.min(1, (dom - pc.domFrom) / pc.domSpan)) + (rivals ? 0 : pc.alone);
  h *= k < pc.lineTop ? 1 : k < pc.lineMid ? 0.6 : 0.3;
  if (summer) h *= pc.summer;
  if (x.rating >= 95) h *= pc.elite;
  return Math.min(pc.max, h);
}
const readyFactor = (x) => 0.6 + 0.4 * (x.rating - 70) / 30;

// He sets a decision date — the end of next window — between his finalists
// (the leader + anyone close, up to 3). One last week to make a push.
function announce(state, x, pool) {
  const ac = state.cfg.lifecycle.announce;
  const live = (x.top || []).filter(([s]) => pool.includes(s) && onBoard(state.schools[s], x.i));
  if (!live.length) return false;
  const lead = live[0][1];
  const list = live.filter(([, v], k) => k === 0 || v >= lead * ac.close).slice(0, ac.finalists).map(([s]) => s);
  x.announce = { st: state.stage + 1, list };
  logEvent(state, -1, "announce", x.i, { list, field: live.slice(0, 4).map(([t, v]) => [t, Math.round((v / lead) * 100)]) });
  return true;
}

// The window's lifecycle pass. Runs after standings (model.computeStandings).
export function runLifecycle(state) {
  const week = fallWeek(state); // 1..12 in fall, 13 on Signing Day, 0 before
  const summer = phaseOf(state) === "summer";
  if (!week && !summer) return;
  const signing = week >= 13;
  const lc = state.cfg.lifecycle;
  state.recruits.forEach((x) => {
    if (x.commit >= 0 || x.status === "unsigned") return;
    const rand = rngFor(state.seed, `life|${state.stage}|${x.i}`);
    if (resolveDemand(state, x)) return;

    // Decision day: he picks between the finalists he named last window.
    if (x.announce && (state.stage >= x.announce.st || signing)) {
      const pool = x.announce.list.filter((s) => onBoard(state.schools[s], x.i));
      const pick = decide(state, x, rand, pool);
      if (pick >= 0) { commitRecruit(state, x.i, pick, "announce"); return; }
      x.announce = null;
      logEvent(state, -1, "delay", x.i); // nobody on his list could take him
    }
    if (x.announce) return;

    // Summer: only a clear favorite moves him this early.
    if (summer) {
      if (x.status === "open" && rand() < pullChance(state, x, contenders(state, x, 10), true)) announce(state, x, contenders(state, x, 10));
      return;
    }

    // Lost every school on his list → back to open.
    if (x.list && !x.list.some((s) => onBoard(state.schools[s], x.i))) {
      x.list = null;
      x.status = "open";
      x.tl.top10 = Math.max(x.tl.top10, week + 1);
      x.tl.final = Math.max(x.tl.final, week + 2);
      logEvent(state, -1, "reopen", x.i);
    }
    // Top 10 (two schools is enough — or one, once he's waited a couple weeks).
    if (x.status === "open" && week >= x.tl.top10 && !signing) {
      const list = contenders(state, x, 10);
      if (list.length >= 2 || week >= x.tl.top10 + 2 || week >= 10) {
        if (list.length) {
          x.list = list;
          x.status = "top10";
          logEvent(state, -1, "top10", x.i, { list });
          lockOut(state, x, list, "top10");
          if (list.length === 1) { x.status = "final"; if (topOne(state, x)) return; }
        }
      } else x.tl.top10 = week + 1;
    }
    // Final list.
    if (x.status === "top10" && week >= x.tl.final && !signing) {
      const within = lc.top10Binding ? x.list : null;
      const size = finalSize(state, x, rand);
      const list = contenders(state, x, size, within);
      if (list.length >= 2 || week >= 11) {
        if (list.length) {
          x.list = list;
          x.status = "final";
          logEvent(state, -1, "final", x.i, { list });
          lockOut(state, x, list, "final");
          if (topOne(state, x)) return;
        }
      } else x.tl.final = week + 1;
    }
    // Commitment: Signing Day decides now; otherwise he sets a date when his
    // time comes (and he's ready) — or sooner, pulled by a clear favorite.
    const pool = x.status === "final" || (x.status === "top10" && lc.top10Binding) ? x.list : contenders(state, x, 10);
    if (signing) {
      const pick = decide(state, x, rand, pool);
      if (pick >= 0) { commitRecruit(state, x.i, pick); return; }
      x.status = "unsigned";
      logEvent(state, -1, "unsigned", x.i);
      return;
    }
    if (week >= lc.earliestCommit) {
      const lead = (x.top || []).find(([s]) => pool.includes(s));
      const due = week >= x.tl.commit && lead && state.interest[lead[0] * state.N + x.i] >= lc.ready * readyFactor(x);
      if ((due || rand() < pullChance(state, x, pool, false)) && week < 12 && announce(state, x, pool)) return;
      if (week >= x.tl.commit) x.tl.commit = week >= 12 ? 13 : Math.min(12, week + intBetween(rand, lc.readyDelay[0], lc.readyDelay[1]));
    }
    if (week >= state.cfg.lifecycle.earliestCommit - 1) maybeDemand(state, x, rand);
  });
}
