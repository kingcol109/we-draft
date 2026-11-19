// src/utils/recruitSim/scouting.js
//
// Scouting (spec §7). Each roll picks one of a recruit's traits for one
// school and moves that school's knowledge forward a step — or, about once
// in 100 rolls (cfg.scouting.potentialChance), uncovers his Potential instead:
//   unknown → range (two adjacent letter families, always containing the
//             true grade)  → exact (individual / board rolls only)
// Regional rolls stop at ranges. Several rolls in one window can take a
// trait unknown → range → exact. Rolls prefer what can still be learned.
import { KT, POT_SLOT, TRAIT_MAP, K_UNKNOWN, K_EXACT, isRange, gradeOf, rangeFor, familyOf, rangeCode } from "./traits.js";

// One roll. allowExact: board / individual. Returns what changed:
// { slot, from, to } or null (wasted).
export function scoutRoll(state, s, r, allowExact, rand, out) {
  const x = state.recruits[r];
  const n = TRAIT_MAP[x.pos].length;
  const base = (s * state.N + r) * KT;
  const pk = state.cfg.scouting.pick;
  // Potential: rare (user, 2026-11-18).
  if (!state.know[base + POT_SLOT] && rand() < state.cfg.scouting.potentialChance) {
    state.know[base + POT_SLOT] = K_EXACT;
    const ch = { r, slot: POT_SLOT, from: 0, to: K_EXACT };
    if (out) out.push(ch);
    return ch;
  }
  const w = new Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const k = state.know[base + i];
    w[i] = k === K_UNKNOWN ? pk.unknown : k === K_EXACT ? pk.exact : allowExact ? pk.range : pk.rangeRegional;
    total += w[i];
  }
  w[n] = 0;
  let roll = rand() * total;
  let slot = n;
  for (let i = 0; i <= n; i += 1) { roll -= w[i]; if (roll < 0) { slot = i; break; } }
  if (slot === n) {
    // Potential: a single reveal.
    if (state.know[base + POT_SLOT]) return null;
    state.know[base + POT_SLOT] = K_EXACT;
    const ch = { r, slot: POT_SLOT, from: 0, to: K_EXACT };
    if (out) out.push(ch);
    return ch;
  }
  const k = state.know[base + slot];
  let to = k;
  if (k === K_UNKNOWN) to = 2 + rangeFor(gradeOf(x.t[slot], state.cfg.gradeCuts), rand() < 0.5);
  else if (isRange(k) && allowExact) to = K_EXACT;
  if (to === k) return null;
  state.know[base + slot] = to;
  const ch = { r, slot, from: k, to };
  if (out) out.push(ch);
  return ch;
}

// A trait changed (development): a school holding a range that no longer
// contains the new grade gets the nearest range that does — it doesn't
// learn the exact grade (spec §22). Exact holders read the live value.
export function reconcileRanges(state, r, slot) {
  const x = state.recruits[r];
  const fam = "ABCDF".indexOf(familyOf(gradeOf(x.t[slot], state.cfg.gradeCuts)));
  for (let s = 0; s < state.S; s += 1) {
    const i = (s * state.N + r) * KT + slot;
    const k = state.know[i];
    if (!isRange(k)) continue;
    const top = rangeCode(k);
    if (fam === top || fam === top + 1) continue;
    state.know[i] = 2 + Math.max(0, Math.min(3, fam > top + 1 ? fam - 1 : fam));
  }
}

// Knowledge summary for one school × recruit: counts of unknown / range /
// exact traits and whether potential is known.
export function knowledgeOf(state, s, r) {
  const x = state.recruits[r];
  const n = TRAIT_MAP[x.pos].length;
  const base = (s * state.N + r) * KT;
  let unknown = 0;
  let range = 0;
  let exact = 0;
  for (let i = 0; i < n; i += 1) {
    const k = state.know[base + i];
    if (k === K_UNKNOWN) unknown += 1; else if (k === K_EXACT) exact += 1; else range += 1;
  }
  return { n, unknown, range, exact, pot: !!state.know[base + POT_SLOT] };
}
