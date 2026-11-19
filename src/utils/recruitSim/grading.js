// src/utils/recruitSim/grading.js
//
// The final class report card (user, 2026-11-18): not just how good the class
// is, but how well it was built. Five parts, each with a letter and a line:
//   talent   final overall (true + potential jump) — class rank in the field
//   nil      value per NIL dollar — rank among schools that signed anyone
//   needs    how the class covers the position plan (holes and pile-ups)
//   eval     how much better the class is than the website said — rank
//   size     signees vs the class limit
// Ranked parts are graded against the field (classGrade); needs and size are
// graded outright. The overall letter is the weighted mix (cfg.report).
import { classRankings, classGrade } from "./engine.js";
import { devOverall } from "./development.js";
import { positionNeeds } from "./suggest.js";

const PTS = { "A+": 4.3, A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7, "C+": 2.3, C: 2, "C-": 1.7, "D+": 1.3, D: 1, "D-": 0.7, F: 0 };
const fromPts = (p) => Object.entries(PTS).find(([, v]) => p >= v - 0.15)?.[0] || "F";
const absGrade = (v) => (v >= 0.97 ? "A+" : v >= 0.92 ? "A" : v >= 0.87 ? "A-" : v >= 0.82 ? "B+" : v >= 0.76 ? "B" : v >= 0.7 ? "B-" : v >= 0.64 ? "C+" : v >= 0.58 ? "C" : v >= 0.52 ? "C-" : v >= 0.42 ? "D" : "F");
const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n > 0 ? `$${Math.round(n / 1e3)}K` : "$0");
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

// One school's value metrics.
function metrics(state, s) {
  const sc = state.schools[s];
  const xs = sc.commits.map((r) => state.recruits[r]);
  const pts = xs.reduce((a, x) => a + Math.pow(Math.max(0, devOverall(x) - 70), 1.5), 0);
  const eff = xs.length ? pts / (sc.spent / 1e6 + 0.15 * sc.budget / 1e6) : -1;
  const over = xs.length ? xs.reduce((a, x) => a + devOverall(x) - x.rating, 0) / xs.length : -99;
  return { n: xs.length, pts, eff, over, steals: xs.filter((x) => devOverall(x) - x.rating >= 2).length };
}
const rankBy = (all, s, key) => {
  const live = all.filter((m) => m.n > 0).sort((a, b) => b[key] - a[key]);
  return [live.findIndex((m) => m.s === s) + 1, live.length];
};

export function classReport(state, s = state.user) {
  const sc = state.schools[s];
  const W = state.cfg.report.weights;
  const all = state.schools.map((_, t) => ({ s: t, ...metrics(state, t) }));
  const me = all[s];
  const parts = [];

  // Talent.
  const truth = classRankings(state, "dev");
  const tAt = truth.findIndex((c) => c.s === s) + 1;
  parts.push({ key: "talent", label: "Talent", grade: me.n ? classGrade(tAt, truth.length) : "F", note: `No. ${tAt} of ${truth.length} by final overall` });

  // NIL value.
  if (me.n) {
    const [k, of] = rankBy(all, s, "eff");
    const per = me.n ? sc.spent / me.n : 0;
    parts.push({ key: "nil", label: "NIL value", grade: classGrade(k, of), note: `${money(sc.spent)} of ${money(sc.budget)} · ${money(per)} a signee · ${ord(k)}-best value` });
  } else parts.push({ key: "nil", label: "NIL value", grade: "F", note: "Nothing to show for it" });

  // Needs.
  const needs = positionNeeds(state, s);
  const want = needs.reduce((a, n) => a + n.want, 0);
  const got = needs.reduce((a, n) => a + Math.min(n.commits, n.want), 0);
  const pile = needs.reduce((a, n) => a + Math.max(0, n.commits - n.want - 1), 0);
  const holes = needs.filter((n) => n.commits === 0);
  const short = needs.filter((n) => n.commits > 0 && n.commits < n.want - 1);
  const fill = Math.max(0, got / want - 0.04 * pile - 0.05 * holes.length);
  const needNote = [
    `${got} of ${want} planned spots filled`,
    holes.length ? `nobody at ${holes.map((n) => n.pos).join(", ")}` : "",
    short.length ? `thin at ${short.map((n) => `${n.pos} (${n.commits}/${n.want})`).join(", ")}` : "",
    pile ? `stacked at ${needs.filter((n) => n.commits > n.want + 1).map((n) => `${n.pos} (${n.commits})`).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  parts.push({ key: "needs", label: "Filled needs", grade: absGrade(fill), note: needNote });

  // Evaluation.
  if (me.n) {
    const [k, of] = rankBy(all, s, "over");
    parts.push({ key: "eval", label: "Evaluation", grade: classGrade(k, of), note: `${me.over >= 0 ? "+" : ""}${me.over.toFixed(1)} a player vs the website · ${me.steals} find${me.steals === 1 ? "" : "s"} · ${ord(k)} in the country` });
  } else parts.push({ key: "eval", label: "Evaluation", grade: "F", note: "No signees to judge" });

  // Size.
  const lim = state.cfg.classLimit;
  parts.push({ key: "size", label: "Class size", grade: absGrade(Math.min(1, me.n / (lim * 0.92))), note: `${me.n} of ${lim} scholarships` });

  const tot = parts.reduce((a, p) => a + (W[p.key] || 0) * PTS[p.grade], 0) / parts.reduce((a, p) => a + (W[p.key] || 0), 0);
  return { grade: fromPts(tot), gpa: Math.round(tot * 100) / 100, parts, trueRank: tAt, field: truth.length };
}
