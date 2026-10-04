// src/utils/wePickScoring.js
//
// We-Pick's per-pick scoring, shared by WePickHub.js (My Picks, Report
// Card, My Stats) and /live's Your Week (LivePage.js). scripts/
// gradeWePickWeek.js keeps its own copy (plain Node, no ESM import) — if the
// scoring spec changes, update both.
//
// Games here are schedule26-shaped ({ Final, HomeScore, AwayScore }); picks
// are schedule26/{id}/picks docs ({ pickedTeam, awayScore, homeScore }).

// Which side a pick calls to win — falls back to comparing the picked
// score, for picks written before the explicit pickedTeam field existed.
export const pickedSideOf = (p) => {
  if (p.pickedTeam === "away" || p.pickedTeam === "home") return p.pickedTeam;
  if (p.awayScore == null || p.homeScore == null) return null;
  if (p.awayScore > p.homeScore) return "away";
  if (p.homeScore > p.awayScore) return "home";
  return null;
};

export const isGameFinal = (g) => g.Final && g.HomeScore != null && g.AwayScore != null;
export const hasScorePick = (p) => !!p && p.awayScore != null && p.homeScore != null;

// The Ranked Standings scoring formula, applied to one pick — 0 for a wrong
// winner, otherwise 100 plus up to 200 more for how close the final score
// was on each side.
// Standings order (wePickStandings2026 entries): points, then correct
// winners, then the smaller total score differential.
export function compareStandingsEntries(a, b) {
  const points = (b.points ?? 0) - (a.points ?? 0);
  if (points !== 0) return points;
  const correct = (b.correct ?? 0) - (a.correct ?? 0);
  if (correct !== 0) return correct;
  return (a.diffTotal ?? Infinity) - (b.diffTotal ?? Infinity);
}

export function scoreGamePick(pick, game) {
  if (!game || !isGameFinal(game) || !hasScorePick(pick)) return 0;
  const side = pickedSideOf(pick);
  const actualWinner = game.AwayScore > game.HomeScore ? "away" : game.HomeScore > game.AwayScore ? "home" : null;
  if (!actualWinner || side !== actualWinner) return 0;
  const awayAcc = Math.max(0, 100 - 10 * Math.abs(game.AwayScore - pick.awayScore));
  const homeAcc = Math.max(0, 100 - 10 * Math.abs(game.HomeScore - pick.homeScore));
  return 100 + awayAcc + homeAcc;
}
