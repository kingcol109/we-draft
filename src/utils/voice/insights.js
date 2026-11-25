// src/utils/voice/insights.js
//
// /voice: what's worth saying first (user, 2026-11-25). Rules, not AI — each
// returns a short fact when there's something notable, else null, and the
// answer leads with it or adds it:
//   - a top rank (top 10 in the class, or first at his position)
//   - a big season for his position (1,000 yards, 25 touchdown passes, 8 sacks…)
//   - a jump or drop from last season (25%+)
//   - his best season yet
//   - recruiting pedigree (a 5-star, a top-100 recruit)
//   - a team's last result
// Pure.
import { statValue, groupOf } from "./stats";

/** Top of the class: { top: "position" | "class", n } | null */
export function topRank(rk) {
  if (!rk) return null;
  if (rk.positionRank === 1) return { top: "position", n: 1 };
  if (rk.classRank && rk.classRank <= 10) return { top: "class", n: rk.classRank <= 5 ? 5 : 10 };
  return null;
}

// What a big season is, by position group: [stat key, at least].
const BIG = {
  QB: [["passYds", 3000], ["passTd", 25], ["rushYds", 700]],
  RB: [["rushYds", 1000], ["rushTd", 12], ["scrimmage", 1300]],
  WR: [["recYds", 1000], ["recTd", 10], ["rec", 75]],
  TE: [["recYds", 700], ["recTd", 7], ["rec", 50]],
  DL: [["sacks", 7], ["tfl", 12]],
  EDGE: [["sacks", 8], ["tfl", 14]],
  LB: [["tackles", 100], ["sacks", 6], ["tfl", 14]],
  DB: [["defInt", 4], ["pd", 12]],
};
/** A big season: the stat key that makes it big, or null. */
export function bigSeason(pos, line) {
  const list = BIG[groupOf(pos)] || [];
  const hit = list.find(([k, min]) => (statValue(line, k) || 0) >= min);
  return hit ? hit[0] : null;
}

/**
 * This season's number against last season's: { dir: "up" | "down", prev, prevYear } | null
 * (a 25% change or more; rates need some volume behind them).
 */
export function seasonChange(data, year, key, minCount = 0) {
  const ys = data?.years || [];
  const i = ys.indexOf(String(year));
  if (i < 1) return null;
  const now = statValue(data.seasons[year], key);
  const prev = statValue(data.seasons[ys[i - 1]], key);
  if (now == null || prev == null || prev === 0) return null;
  if (minCount && (statValue(data.seasons[ys[i - 1]], "carries") || statValue(data.seasons[ys[i - 1]], "rec") || statValue(data.seasons[ys[i - 1]], "att") || 0) < minCount) return null;
  const ch = (now - prev) / Math.abs(prev);
  if (Math.abs(ch) < 0.25) return null;
  return { dir: ch > 0 ? "up" : "down", prev, prevYear: ys[i - 1] };
}

/** Is this season his best yet at the stat (two seasons or more)? */
export function bestSeasonYet(data, year, key) {
  const ys = (data?.years || []).filter((y) => Number(y) <= Number(year));
  if (ys.length < 2) return false;
  const now = statValue(data.seasons[year], key);
  if (now == null) return false;
  return ys.filter((y) => y !== String(year)).every((y) => (statValue(data.seasons[y], key) ?? -Infinity) < now);
}

/** Recruiting pedigree worth a mention: "five-star" | "top-100" | null */
export function pedigree(d) {
  if (Number(d?.RecruitStars) === 5) return "five-star";
  const r = Number(String(d?.RecruitRank || "").replace(/^#/, ""));
  return r > 0 && r <= 100 ? "top-100" : null;
}
