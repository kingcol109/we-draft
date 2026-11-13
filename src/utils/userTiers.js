// src/utils/userTiers.js
//
// Admin → Users: every account sorted into a tier by how often it visits
// and how much it evaluates, over the last 30 days (Eastern-time days):
//   Stars    — on the site at least weekly AND 5+ evaluations saved;
//   Active   — on the site at least weekly (a visit in 3 of the last 4
//              weeks), not a star;
//   Inactive — visited in the last 30 days, but less than weekly;
//   Dogs     — has an account, no visit in the last 30 days.
// Visit days come from siteDailyAccounts plus an account's lastActiveAt. Visit-day tracking started
// recently, so "at least weekly" asks for a visit in every week there's
// data for, up to 3 of 4 — it tightens on its own as history builds up.
// The rules are TIER_RULES; change them there.

export const TIER_RULES = { days: 30, weeks: 4, weeklyMin: 3, starEvals: 5 };

export const TIERS = [
  { id: "star", label: "Stars", color: "#d97706", rule: `At least weekly, and ${TIER_RULES.starEvals}+ evaluations in ${TIER_RULES.days} days` },
  { id: "active", label: "Active", color: "#16a34a", rule: `At least weekly (${TIER_RULES.weeklyMin} of the last ${TIER_RULES.weeks} weeks)` },
  { id: "inactive", label: "Inactive", color: "#64748b", rule: `Visited in the last ${TIER_RULES.days} days, less than weekly` },
  { id: "dog", label: "Dogs", color: "#b91c1c", rule: `No visit in ${TIER_RULES.days} days` },
];

const DAY = 864e5;
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
const ageOf = (today, d) => Math.round((dayMs(today) - dayMs(d)) / DAY);

// visitDays: ["YYYY-MM-DD"]; today: "YYYY-MM-DD"; trackedFrom: the first
// day visit tracking has data for. → { days30, weeks, weekly, lastAge }:
// visit days in the window, weeks (of the last 4) with a visit, whether
// that's "at least weekly", and days since the last visit (null: none).
export function visitStats(visitDays, today, trackedFrom) {
  const ages = [...new Set(visitDays)].map((d) => ageOf(today, d)).filter((a) => a >= 0 && a < TIER_RULES.days);
  const weeks = new Set(ages.filter((a) => a < TIER_RULES.weeks * 7).map((a) => Math.floor(a / 7))).size;
  const tracked = trackedFrom ? Math.max(0, ageOf(today, trackedFrom)) : TIER_RULES.weeks * 7;
  const covered = Math.min(TIER_RULES.weeks, Math.floor(tracked / 7) + 1);
  const need = Math.min(TIER_RULES.weeklyMin, covered);
  return { days30: ages.length, weeks, weekly: ages.length > 0 && weeks >= need, lastAge: ages.length ? Math.min(...ages) : null };
}

// An account's tier. lastActiveDay: its lastActiveAt as a day, counted as a
// visit (it covers the time before day-by-day tracking); evals30: the
// evaluations it saved in the window.
export function tierOf({ visitDays = [], lastActiveDay, evals30 = 0, today, trackedFrom }) {
  const s = visitStats(lastActiveDay ? [...visitDays, lastActiveDay] : visitDays, today, trackedFrom);
  const tier = s.days30 === 0 ? "dog" : !s.weekly ? "inactive" : evals30 >= TIER_RULES.starEvals ? "star" : "active";
  return { tier, ...s, evals30 };
}
