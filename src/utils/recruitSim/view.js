// src/utils/recruitSim/view.js
//
// What the user's staff KNOWS — the only door from engine state to the UI.
// Hidden values (true overall, unscouted traits, potential, exact interest,
// preference weights, NIL asks) never leave this file except as what the
// user's school has legitimately uncovered (spec §26 "keep hidden
// information hidden"):
//   • traits: unknown / range (two letter families) / exact grade
//   • categories: exact when every trait in it is exact; a range when every
//     trait is at least ranged; else unknown
//   • staff grade: the user's own evaluation from what's uncovered (no bias),
//     shown as a letter once at least half his traits are known
//   • interest: a level and (with enough contact) your place, never a number
//   • potential: hidden until uncovered (~1 look in 500); his Physical
//     grades and his senior-season trend are the clues
//   • trend: the direction his season is going (never the number), once
//     your staff has seen him at all
import { TRAIT_MAP, CATS, KT, POT_SLOT, K_EXACT, K_UNKNOWN, isRange, rangeCode, rangeLabel, rangeBounds, gradeOf, categoryValues } from "./traits.js";
import { evaluate, placeOf, ptContext, ptAt, nilAttr, seenByUser, fallWeek } from "./model.js";
import { miles } from "./regions.js";
import { logKnots } from "./rng.js";
import { expectedJump, trendOf } from "./development.js";
import { REC_BIT, ROLES, bondMult, bondAt, BOND_UNIT } from "./work.js";

const FAMS = "ABCDF";

export function traitView(state, r) {
  const x = state.recruits[r];
  const s = state.user;
  const base = (s * state.N + r) * KT;
  const cuts = state.cfg.gradeCuts;
  return TRAIT_MAP[x.pos].map(([name, cat], i) => {
    const k = state.know[base + i];
    const arrow = 0; // no in-season trait changes
    if (k === K_EXACT) return { name, cat, state: "exact", label: gradeOf(x.t[i], cuts), arrow };
    if (isRange(k)) return { name, cat, state: "range", label: rangeLabel(rangeCode(k)), arrow };
    return { name, cat, state: "unknown", label: "?", arrow };
  });
}
export function potentialView(state, r) {
  const k = state.know[(state.user * state.N + r) * KT + POT_SLOT];
  return k ? gradeOf(state.recruits[r].pot, state.cfg.gradeCuts) : null;
}
// What potential means for him: the direction of his jump (known only).
export function ceilingView(state, r) {
  const g = potentialView(state, r);
  if (!g) return null;
  const j = expectedJump(state.cfg, state.recruits[r].pot);
  return { grade: g, dir: j >= 1.5 ? 1 : j <= -1.5 ? -1 : 0, label: j >= 4 ? "Big jump coming" : j >= 1.5 ? "Should jump up" : j > -1.5 ? "About what he is" : j > -4 ? "Likely to slide" : "Big slide risk" };
}

// His senior-season trend as your staff reads it (user, 2026-11-18): any
// contact at all is enough to know which way he's going — not by how much.
export const TREND_LABEL = { 2: "Breaking out", 1: "Trending up", 0: "Steady", "-1": "Trending down", "-2": "Struggling" };
export function trendView(state, r) {
  if (!fallWeek(state)) return null;
  const x = state.recruits[r];
  if (x.commit >= 0 && x.commit !== state.user) return null;
  if (!seenByUser(state, r)) return { dir: null, label: "Unknown — get eyes on him" };
  const t = trendOf(state, x);
  return t ? { dir: t.dir, label: TREND_LABEL[t.dir] } : null;
}

// Relationships: windows each of your staffers has spent on him one-on-one,
// and how much more their next visit lands (bondMult) — your side, not hidden.
export function bondView(state, r) {
  const at = bondAt(state, state.user, r);
  return ROLES.map((role, i) => ({ role, n: state.bond ? state.bond[at + i] / BOND_UNIT : 0, mult: Math.round(bondMult(state, state.user, role, r) * 100) / 100 }));
}

// A decision date: who he's choosing between, and your staff's prediction
// (from where he stands — the same read the interest bars give you).
export function decisionView(state, r) {
  const x = state.recruits[r];
  if (!x.announce || x.commit >= 0) return null;
  const top = (x.top || []).filter(([s]) => x.announce.list.includes(s));
  const lead = top[0]?.[1] || 1;
  const field = top.map(([s, v]) => ({ s, pct: Math.round((v / lead) * 100) }));
  const second = field[1]?.pct || 0;
  const conf = second >= 85 ? "Toss-up" : second >= 60 ? "Leaning" : "Confident";
  return { list: x.announce.list.slice(), field, pick: field[0]?.s ?? null, conf, inIt: x.announce.list.includes(state.user) };
}

// Category grades from what's uncovered.
export function categoryView(state, r, traits = traitView(state, r)) {
  const x = state.recruits[r];
  const cuts = state.cfg.gradeCuts;
  const out = {};
  CATS.forEach((c) => {
    const rows = traits.map((t, i) => [t, i]).filter(([t]) => t.cat === c);
    if (rows.every(([t]) => t.state === "exact")) {
      out[c] = { state: "exact", label: gradeOf(categoryValues(x.pos, x.t)[c], cuts) };
    } else if (rows.every(([t]) => t.state !== "unknown")) {
      // Lowest / highest the category could be, then the families that spans.
      const lo = x.t.slice();
      const hi = x.t.slice();
      rows.forEach(([t, i]) => {
        if (t.state === "range") { const [a, b] = rangeBounds(rangeCode(state.know[(state.user * state.N + r) * KT + i]), cuts); lo[i] = a; hi[i] = b - 0.01; }
      });
      const fLo = FAMS.indexOf(gradeOf(categoryValues(x.pos, lo)[c], cuts)[0]);
      const fHi = FAMS.indexOf(gradeOf(categoryValues(x.pos, hi)[c], cuts)[0]);
      out[c] = fLo === fHi ? { state: "range", label: `~${FAMS[fHi]}` } : { state: "range", label: `${FAMS[fHi]}–${FAMS[fLo]}` };
    } else out[c] = { state: "unknown", label: "?" };
  });
  return out;
}

// Your staff's grade of him — accurate, no bias, from uncovered info only.
export function staffGrade(state, r) {
  const { est, known } = evaluate(state, state.user, r);
  if (known < 0.5) return null;
  return { label: gradeOf(est, state.cfg.gradeCuts), sure: known >= 0.95 };
}
// Scouting progress 0..1 (exact = 1, range = 0.5 per trait).
export function scoutProgress(state, r) {
  const x = state.recruits[r];
  const base = (state.user * state.N + r) * KT;
  const n = TRAIT_MAP[x.pos].length;
  let p = 0;
  for (let i = 0; i < n; i += 1) { const k = state.know[base + i]; p += k === K_EXACT ? 1 : k === K_UNKNOWN ? 0 : 0.5; }
  return p / n;
}

// Interest, as your staff reads it.
export const INTEREST_LEVELS = ["Cold", "Low", "Medium", "High", "Very High"];
// Level = your score vs his leader's. trend: −1 / 0 / 1 since last window.
export function interestView(state, r) {
  const x = state.recruits[r];
  const intel = state.intel[r];
  if (x.commit >= 0) return { level: null, place: null, intel, committed: x.commit, mine: x.commit === state.user };
  if (!intel) return { level: null, place: null, intel };
  const [place, mine] = placeOf(x, state.user);
  const lead = x.top?.[0]?.[1] || 0;
  const ratio = lead > 0 ? mine / lead : 0;
  const lvl = !place ? 0 : ratio >= 0.9 ? 4 : ratio >= 0.7 ? 3 : ratio >= 0.45 ? 2 : ratio >= 0.2 ? 1 : 0;
  const t = state.trend?.[r] || [];
  let trend = 0;
  if (t.length >= 2) {
    const [, p1, a] = t[t.length - 2];
    const [, p2, b] = t[t.length - 1];
    trend = (p2 && (!p1 || p2 < p1)) || b - a >= 8 ? 1 : (p1 && (!p2 || p2 > p1)) || a - b >= 8 ? -1 : 0;
  }
  return { level: INTEREST_LEVELS[lvl], lvl, pct: Math.round(ratio * 100), place: intel >= 2 ? place || null : null, intel, trend };
}

// Interest bars: you and the schools you're up against, each as a share of
// his leader (no raw numbers) — shown whether or not you've made contact
// (user, 2026-11-17); once his list is public, it's the list. Each school
// also shows its NIL offer and whether it's pushing hard (a coach on him, or
// near the top of its line).
export function competitionView(state, r) {
  const x = state.recruits[r];
  if (x.commit >= 0) return [];
  const top = x.top || [];
  const lead = top[0]?.[1] || 0;
  if (!lead) return [];
  const u = state.user;
  // The schools actually recruiting him: on their board (his list once it's
  // out), in his order. Nobody yet → the top three in his eyes.
  const recruiting = top.filter(([s]) => (x.list ? x.list.includes(s) : state.schools[s].board.includes(r)));
  const pool = (recruiting.length ? recruiting : top.slice(0, 3)).slice(0, 7);
  const extra = (s) => ({ nil: state.schools[s].nil[r] || 0, push: pushing(state, s, r), onBoard: state.schools[s].board.includes(r), above: state.schools[s].above.includes(r) });
  const rows = pool.map(([s, v]) => ({ s, pct: Math.round((v / lead) * 100), you: s === u, place: top.findIndex(([t]) => t === s) + 1, ...extra(s) }));
  if (!rows.some((row) => row.you)) {
    const [place, mine] = placeOf(x, u);
    rows.push({ s: u, pct: Math.round((mine / lead) * 100), you: true, place: place || null, out: !!x.list, ...extra(u) });
  }
  return rows;
}
// A school pushing hard for him: a coach assigned to him, or top 5 on its line.
export function pushing(state, s, r) {
  const sc = state.schools[s];
  const k = sc.above.indexOf(r);
  return (k >= 0 && k < 5) || sc.staff.some((a, i) => i < 3 && a?.kind === "recruit" && a.r === r);
}

// Trait stacks for rows (user, 2026-11-17): each category's grade with its
// three traits under it — what you know, no click needed.
const ABBR = (name) => {
  const w = name.split(" ");
  return w.length === 1 ? name.slice(0, 4) : w.map((v) => v[0]).join("").slice(0, 3);
};
export function traitStackView(state, r) {
  const traits = traitView(state, r);
  const cats = categoryView(state, r, traits);
  return CATS.map((c) => ({ cat: c, ...cats[c], traits: traits.filter((t) => t.cat === c).map((t) => ({ ...t, abbr: ABBR(t.name) })) }));
}

// After he commits to you, the truth: true overall, the jump his potential
// gives him, where he ends up — vs his public rating.
export function revealView(state, r) {
  const x = state.recruits[r];
  if (x.commit !== state.user) return null;
  const now = Math.round(x.ovr * 10) / 10;
  const jump = x.devJump || 0;
  const ovr = x.ovrDev != null ? x.ovrDev : now;
  const delta = Math.round((ovr - x.rating) * 10) / 10;
  const tag = delta >= 5 ? "STEAL" : delta >= 2 ? "UNDERRATED" : delta > -2 ? "AS ADVERTISED" : delta > -5 ? "OVERRATED" : "BUST";
  return { ovr, now, jump, pot: gradeOf(x.pot, state.cfg.gradeCuts), rating: x.rating, delta, tag };
}

// Where his recruitment is: open → top 10 → final → committed.
export const STAGE_STEPS = ["Open", "Top 10", "Final", "Committed"];
export function stageView(state, r) {
  const x = state.recruits[r];
  if (x.commit >= 0) return { step: 3, label: "Committed", school: x.commit };
  if (x.status === "unsigned") return { step: 3, label: "Unsigned" };
  if (x.announce) return { step: 2, label: "Decision", decision: true, inIt: x.announce.list.includes(state.user) };
  if (x.status === "final") return { step: 2, label: `Final ${x.list.length}`, inIt: x.list.includes(state.user) };
  if (x.status === "top10") return { step: 1, label: `Top ${x.list.length}`, inIt: x.list.includes(state.user) };
  return { step: 0, label: "Open" };
}

// How your school stacks up on what he weighs (your program's side — not
// hidden). His priorities are flagged only once your staff has learned them.
export function factorView(state, r) {
  const x = state.recruits[r];
  const u = state.user;
  const sc = state.schools[u];
  const known = new Set(prefsView(state, r));
  const ctx = ptContext(state, u);
  const pt = ptAt(state, u, r, ctx);
  const ahead = ctx.ahead.has(r) ? ctx.ahead.get(r) : ctx.aboveCount[x.pos] || 0;
  const commits = ctx.commits[x.pos] || 0;
  const dist = Math.round(miles(sc.loc, x.loc));
  const offer = sc.nil[r] || 0;
  const hope = askHint(state, r);
  const rate = (v) => (v >= 0.7 ? "Strong" : v >= 0.4 ? "Okay" : "Weak");
  const rows = [
    { key: "brand", v: sc.brand, note: `Tier ${sc.tier} program` },
    { key: "dist", v: state.derived.distFit[u * state.N + r], note: `${dist} miles from home` },
    { key: "dev", v: sc.dev[x.pos] ?? 0.3, note: `NFL pipeline at ${x.pos}` },
    { key: "win", v: sc.win, note: "Recent winning" },
    { key: "nil", v: offer ? nilAttr(state, u, r) : 0, note: offer ? (hope ? `${offer >= hope ? "Meets" : "Below"} what he's hoping for` : "Offer on the table") : "No offer yet" },
    { key: "pt", v: pt, note: ahead || commits ? `${ahead ? `${ahead} ${x.pos}${ahead > 1 ? "s" : ""} ranked ahead of him` : ""}${ahead && commits ? " · " : ""}${commits ? `${commits} ${x.pos} commit${commits > 1 ? "s" : ""}` : ""}` : "Clear path" },
  ];
  // What matters most to him first (user, 2026-11-17).
  const w = x.prefs || {};
  return rows.map((row) => ({ ...row, label: PREF_LABEL[row.key], rating: rate(row.v), priority: known.has(PREF_LABEL[row.key]), w: w[row.key] || 0 }))
    .sort((a, b) => (b.priority - a.priority) || (b.w - a.w));
}

// Typical NIL for his public ranking (the market, not his own ask).
export function marketNil(state, r) {
  const v = logKnots(state.cfg.askKnots, state.recruits[r].rank);
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}
// The NIL box's starting number: what he's hoping for, else the market.
export const nilDefault = (state, r) => askHint(state, r) || marketNil(state, r);

// Players who dropped you last window ("no longer considering you").
export function lockedOutView(state) {
  return (state.schools[state.user].lockedOut || []).filter((o) => o.st === state.stage - 1);
}

// What matters to him — revealed with contact: his top factor at intel 1,
// top two at intel 2 (names only, never weights).
export const PREF_LABEL = { brand: "Program prestige", dist: "Close to home", dev: "NFL development", nil: "NIL", pt: "Playing time", win: "Winning" };
export function prefsView(state, r) {
  const intel = state.intel[r];
  if (!intel) return [];
  const p = state.recruits[r].prefs;
  return Object.entries(p).sort((a, b) => b[1] - a[1]).slice(0, intel >= 2 ? 2 : 1).map(([k]) => PREF_LABEL[k]);
}

// Schools you can see in on him: his public list once announced; before
// that, with good contact, the top three your staff hears about.
export function competitorsView(state, r) {
  const x = state.recruits[r];
  if (x.list) return { kind: x.status === "final" ? "final" : "top10", schools: x.list.slice() };
  if (state.intel[r] >= 2) return { kind: "heard", schools: (x.top || []).slice(0, 4).map(([s]) => s).filter((s) => s !== state.user).slice(0, 3) };
  return { kind: "none", schools: [] };
}

export function recommendedBy(state, r) {
  const m = state.recMask[state.user * state.N + r];
  return Object.entries(REC_BIT).filter(([, b]) => m & b).map(([role]) => role);
}
export const arrows = () => null; // in-season development retired (2026-11-18)

// Public status line.
export function statusLabel(state, r) {
  const x = state.recruits[r];
  if (x.commit >= 0) return "Committed";
  if (x.status === "unsigned") return "Unsigned";
  if (x.status === "final") return `Final ${x.list.length}`;
  if (x.status === "top10") return `Top ${x.list.length}`;
  return "Open";
}

// His NIL expectation as your staff hears it — only after real contact, and
// only roughly (± a little, rounded) — never his exact number.
export function askHint(state, r) {
  if (state.intel[r] < 2) return null;
  const x = state.recruits[r];
  const wobble = 1 + (((x.i * 2654435761) >>> 0) % 21 - 10) / 100; // fixed ±10% per recruit
  const v = x.ask * wobble;
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}
