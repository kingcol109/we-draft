// src/utils/recruitSim/actions.js
//
// Every recruiting decision a school can make, with the rules enforced in
// one place — the user's clicks and the CPU's plans (./cpu.js) both go
// through these, so nobody can break the board limits, the line, the NIL
// cap or the staff rules (spec §12–15, §20, §23 "same rules").
//
// Each returns { ok: true } or { error: "…" } and mutates state in place
// (callers that need React updates copy the top-level object).
import { phaseOf, boardLimits } from "./model.js";
import { ROLES, POS_GROUPS, groupsFor } from "./work.js";
import { REGION_KEYS } from "./regions.js";
import { logEvent } from "./events.js";
import { commitRecruit } from "./lifecycle.js";

const err = (error) => ({ error });
const OK = { ok: true };

// ── NIL accounting (spec §20) ──
export function nilOutstanding(sc) {
  let t = 0;
  Object.values(sc.nil).forEach((v) => { t += v || 0; });
  return t;
}
export function nilAvailable(sc) { return sc.budget - sc.spent - nilOutstanding(sc); }

// ── Board ──
export function addToBoard(state, s, r) {
  const sc = state.schools[s];
  const x = state.recruits[r];
  const lim = boardLimits(state);
  if (!lim.size) return err("The recruiting board opens in Spring.");
  if (!x || x.commit >= 0) return err("He's already committed.");
  if (x.status === "unsigned") return err("His recruitment is over.");
  if (sc.board.includes(r)) return OK;
  if (sc.board.length >= lim.size) return err(`Your board is full (${lim.size}). Remove someone first.`);
  sc.board.push(r);
  logEvent(state, s, "boardAdd", r);
  return OK;
}
// quiet: no history row (he dropped you, not the other way around).
export function removeFromBoard(state, s, r, quiet = false) {
  const sc = state.schools[s];
  if (!sc.board.includes(r)) return OK;
  sc.board = sc.board.filter((v) => v !== r);
  if (sc.above.includes(r)) sc.above = sc.above.filter((v) => v !== r);
  // Pulls his offer (released; the cut costs interest at window's end).
  delete sc.nil[r];
  sc.staff = sc.staff.map((a) => (a?.kind === "recruit" && a.r === r ? null : a));
  if (!quiet) logEvent(state, s, "boardRemove", r);
  return OK;
}
// Above the line: put r at rank k (0-based) — or move him below (k = null).
export function placeOnLine(state, s, r, k) {
  const sc = state.schools[s];
  const lim = boardLimits(state);
  if (!sc.board.includes(r)) return err("Add him to your board first.");
  if (!lim.line) return err(phaseOf(state) === "spring" ? "The line opens in Summer — every spring board spot is equal." : "No line yet.");
  const was = sc.above.indexOf(r);
  const rest = sc.above.filter((v) => v !== r);
  if (k == null) {
    if (was < 0) return OK;
    sc.above = rest;
    delete sc.nil[r]; // only above-the-line recruits carry offers
    logEvent(state, s, "lineDown", r);
    return OK;
  }
  if (was < 0 && rest.length >= lim.line) return err(`The line holds ${lim.line}. Move someone below it first.`);
  const at = Math.max(0, Math.min(rest.length, k));
  rest.splice(at, 0, r);
  sc.above = rest;
  if (was < 0) logEvent(state, s, "lineUp", r, { rank: at + 1 });
  return OK;
}
// Replace the whole line order (drag-and-drop). ids: above-line order.
export function setLine(state, s, ids) {
  const sc = state.schools[s];
  const lim = boardLimits(state);
  const clean = ids.filter((r, i) => sc.board.includes(r) && ids.indexOf(r) === i);
  if (clean.length > lim.line) return err(`The line holds ${lim.line}.`);
  const dropped = sc.above.filter((r) => !clean.includes(r));
  dropped.forEach((r) => { delete sc.nil[r]; logEvent(state, s, "lineDown", r); });
  clean.filter((r) => !sc.above.includes(r)).forEach((r) => logEvent(state, s, "lineUp", r, { rank: clean.indexOf(r) + 1 }));
  sc.above = clean;
  return OK;
}

// ── NIL offers ──
export function setOffer(state, s, r, amount) {
  const sc = state.schools[s];
  const p = phaseOf(state);
  if (p === "winter" || p === "spring") return err("NIL offers open in Summer.");
  if (!sc.above.includes(r)) return err("Only recruits above the line get NIL offers.");
  const cfg = state.cfg;
  let amt = Math.round((Number(amount) || 0) / cfg.offerStep) * cfg.offerStep;
  if (amt > 0 && amt < cfg.minOffer) amt = cfg.minOffer;
  const prev = sc.nil[r] || 0;
  if (amt - prev > nilAvailable(sc)) return err(`That's over your NIL budget — ${Math.max(0, nilAvailable(sc) + prev).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} available for him.`);
  if (amt > 0) sc.nil[r] = amt; else delete sc.nil[r];
  if (amt !== prev) logEvent(state, s, "nilOffer", r, { from: prev, to: amt });
  // His NIL ultimatum, met: he commits right now (user, 2026-11-17).
  const d = state.recruits[r].demand;
  if (d && d.s === s && d.type === "nil" && amt >= d.amount && sc.commits.length < state.cfg.classLimit) {
    logEvent(state, s, "demandMet", r, { type: "nil" });
    commitRecruit(state, r, s, "demand");
    return { ok: true, committed: true };
  }
  return OK;
}

// ── Staff ──
// a: null | { kind: "area", region, pos } | { kind: "recruit", r }
export function assignStaff(state, s, role, a) {
  const si = ROLES.indexOf(role);
  if (si < 0) return err("Unknown staff role.");
  const sc = state.schools[s];
  if (!a) { sc.staff[si] = null; return OK; }
  if (a.kind === "area") {
    if (!REGION_KEYS.includes(a.region)) return err("Pick a region.");
    // pos: "ALL" or any set of the role's position groups.
    let pos = !a.pos || a.pos === "ALL" ? "ALL" : Array.isArray(a.pos) ? [...new Set(a.pos)] : [a.pos];
    if (pos !== "ALL") {
      const bad = pos.find((g) => !POS_GROUPS[g] || !groupsFor(role).includes(g));
      if (bad) return err(`The ${role} doesn't cover ${bad}.`);
      if (!pos.length || pos.length >= groupsFor(role).length) pos = "ALL";
    }
    sc.staff[si] = { kind: "area", region: a.region, pos };
    return OK;
  }
  if (a.kind === "recruit") {
    if (phaseOf(state) === "winter") return err("Individual assignments open in Spring.");
    const x = state.recruits[a.r];
    if (!x || x.commit >= 0) return err("He's already committed.");
    // A coordinator can recruit the other side of the ball — just not as
    // well (work.bondMult, user 2026-11-18).
    sc.staff[si] = { kind: "recruit", r: a.r };
    return OK;
  }
  return err("Bad assignment.");
}

// Put last window's assignments back (staff come home every window).
// Anything no longer valid (he committed, it's winter) is skipped.
export function repeatStaff(state, s) {
  const sc = state.schools[s];
  const last = sc.lastStaff || [];
  let n = 0;
  ROLES.forEach((role, i) => { if (last[i] && assignStaff(state, s, role, last[i]).ok) n += 1; });
  return n ? OK : err("Nothing to repeat from last window.");
}

// Re-order the board (the below-the-line order is for viewing only).
export function reorderBoard(state, s, ids) {
  const sc = state.schools[s];
  const clean = ids.filter((r, i) => sc.board.includes(r) && ids.indexOf(r) === i);
  if (clean.length !== sc.board.length) return err("Board changed — try again.");
  sc.board = clean;
  return OK;
}

// What still blocks the user from closing the window (spec §13: Summer
// needs ten ranked recruits, each with an offer) and what's only a warning.
export function advanceCheck(state, s) {
  const sc = state.schools[s];
  const p = phaseOf(state);
  const lim = boardLimits(state);
  const blocks = [];
  const warns = [];
  if (p === "done") blocks.push("The recruiting season is over.");
  const idle = sc.staff.filter((a) => !a).length;
  if (idle) warns.push(`${idle} staff member${idle > 1 ? "s are" : " is"} unassigned.`);
  if (p === "summer" || p === "fall" || p === "signing") {
    const want = Math.min(lim.line, sc.board.length);
    // The line is yours to fill — or not (user, 2026-11-17).
    if (sc.above.length < want) warns.push(`${lim.line - sc.above.length} open spot${lim.line - sc.above.length > 1 ? "s" : ""} above the line.`);
    const noOffer = sc.above.filter((r) => !(sc.nil[r] > 0));
    if (noOffer.length && state.cfg.requireOffers[p === "summer" ? "summer" : "fall"]) blocks.push(`Give every above-the-line recruit an NIL offer (${noOffer.length} without one).`);
    else if (noOffer.length) warns.push(`${noOffer.length} above-the-line recruit${noOffer.length > 1 ? "s have" : " has"} no NIL offer.`);
  }
  if (p === "spring" && sc.board.length < lim.size) warns.push(`${lim.size - sc.board.length} open board spot${lim.size - sc.board.length > 1 ? "s" : ""}.`);
  return { blocks, warns };
}
