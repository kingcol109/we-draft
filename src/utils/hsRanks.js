// src/utils/hsRanks.js
//
// Shared by the high school pages (pages/HighSchoolTeamPage.js) and the HS
// leaderboards (pages/HighSchoolRankings.jsx) — the ranks themselves are
// precomputed by server/highSchools/hsIndex.js (same position groups).
import { STATE_ABBR } from "./highSchoolMatch";

// Position groups, in display order: EDGE counts as DL, CB/S as DB, and
// K/P/LS as Special Teams.
export const POS_GROUPS = [
  ["QB", "Quarterbacks"], ["RB", "Running Backs"], ["WR", "Wide Receivers"], ["TE", "Tight Ends"],
  ["OL", "Offensive Line"], ["DL", "Defensive Line"], ["LB", "Linebackers"], ["DB", "Defensive Backs"],
  ["ST", "Special Teams"],
];

// The two leaderboards' metrics.
export const METRICS = [
  ["cfb", "In College", "Current college football players"],
  ["nfl", "NFL Draft", "Players drafted"],
];

// "#7", or "T-3" for a shared rank; "—" with none.
export const rankText = (r, tie) => (r ? (tie ? `T-${r}` : `#${r}`) : "—");

// A school page's URL from its stored Slug ("hun-school-nj" →
// "/hs/nj/hun-school"): state first, like /hs/{state}. App.js redirects the
// old /hs/{slug} form here.
export const hsPath = (slug) => {
  const m = /^(.+)-([a-z]{2})$/.exec(String(slug || "").toLowerCase());
  return m ? `/hs/${m[2]}/${m[1]}` : `/hs/${slug}`;
};

// "Georgia" → "GA" (an abbreviation passes through).
export const stateAbbr = (s) => STATE_ABBR[s] || s || "";
