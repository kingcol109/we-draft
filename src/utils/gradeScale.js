// src/utils/gradeScale.js
//
// Community grades' scale (1 = Early First … 10 = UDFA), labels and badge
// looks. No imports, so pages, scripts and the Instagram posts all share
// them (communityGrades.js re-exports them).
export const GRADE_SCALE = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
export const GRADE_LABELS = Object.fromEntries(Object.entries(GRADE_SCALE).map(([label, v]) => [v, label]));

// avg (1 = Early First … 10 = UDFA) → its label, e.g. "Second Round".
export const gradeLabel = (avg) => (avg == null ? null : GRADE_LABELS[Math.round(avg)] || null);

// A grade label's badge look, as player pages brand it (PlayerProfile.js
// GradeBadge): the short round and its colors.
const GRADE_LOOKS = {
  "Watchlist": { short: "W", bg: "#5F5E5A", border: "#444441" },
  "Early First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Late First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
  "Second Round": { short: "2nd", bg: "#0F6E56", border: "#085041" },
  "Third Round": { short: "3rd", bg: "#185FA5", border: "#0C447C" },
  "Fourth Round": { short: "4th", bg: "#BA7517", border: "#854F0B" },
  "Fifth Round": { short: "5th", bg: "#BA7517", border: "#854F0B" },
  "Sixth Round": { short: "6th", bg: "#993C1D", border: "#712B13" },
  "Seventh Round": { short: "7th", bg: "#993C1D", border: "#712B13" },
  "UDFA": { short: "U", bg: "#A32D2D", border: "#791F1F" },
};
// → { short, bg, border, qualifier ("EARLY" / "MIDDLE" / "LATE" on a 1st, else null) }.
export const gradeLook = (label) => ({
  ...(GRADE_LOOKS[label] || { short: label, bg: "#5F5E5A", border: "#444441" }),
  qualifier: /First Round$/.test(label || "") ? label.replace(" First Round", "").toUpperCase() : null,
});
