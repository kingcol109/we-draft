// src/components/statLineGlow.js
//
// Replaces the old whole-card/row "grade glow" — a pulsing box-shadow
// around the *entire* row for Dominant/Great performances (static for
// Good), duplicated near-verbatim across ~8 files (PlayerProfile.js,
// MyFeed.js, TeamPage.js, GamePage.js, PerformancesHub.jsx,
// MarginSidebars.js, GameMarginSidebars.js, BoardsMarginSidebars.js). Same
// tiered idea, but scoped to just the stat line text itself — a colored,
// pulsing text-glow — instead of the whole card, since that was too much.
//
// gradeStatLineClass(grade) -> a class name (or "" for anything else),
// applied to whatever element renders that performance's own statLine.
// STAT_LINE_GLOW_STYLE is the CSS to interpolate into whichever <style>
// block that file already injects its own CSS through — this doesn't
// mount anything on its own.
export function gradeStatLineClass(grade) {
  if (grade === "Dominant") return "wd-statline-glow-dominant";
  if (grade === "Great") return "wd-statline-glow-great";
  if (grade === "Good") return "wd-statline-glow-good";
  return "";
}

export const STAT_LINE_GLOW_STYLE = `
  @keyframes wdStatLineGlowDominant {
    0%, 100% { text-shadow: 0 0 4px rgba(246,162,29,0.55), 0 0 1px rgba(246,162,29,0.9); }
    50%      { text-shadow: 0 0 11px rgba(246,162,29,0.95), 0 0 3px rgba(246,162,29,1); }
  }
  .wd-statline-glow-dominant { animation: wdStatLineGlowDominant 1.6s ease-in-out infinite; }
  @keyframes wdStatLineGlowGreat {
    0%, 100% { text-shadow: 0 0 2px rgba(246,162,29,0.3); }
    50%      { text-shadow: 0 0 6px rgba(246,162,29,0.65); }
  }
  .wd-statline-glow-great { animation: wdStatLineGlowGreat 2.6s ease-in-out infinite; }
  .wd-statline-glow-good { text-shadow: 0 0 3px rgba(246,162,29,0.35); }
`;
