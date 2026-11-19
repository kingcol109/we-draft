// src/utils/riserRecent.js
//
// A riser's recent line as plain fields — what his row's "Last game / Last 3
// games" box shows (pages/Risers.jsx LastGame). The live page builds it from
// his ESPN game log on every view (espnRecent.js bestRecentLine); an edition
// stores it as it read the day it was published (AdminRisers.jsx), so a past
// edition shows that day's line, not today's. Firestore-safe: strings and
// numbers only (a game log's line is nested arrays, which Firestore can't hold).
import { bestRecentLine, lastGameLine } from "./espnRecent.js";

// best: bestRecentLine's { kind, g } → { kind: "last" | "last3", line,
// at, opp, oppLogo, result, score, date, first, last, games } or null.
export function recentSummary(pos, best) {
  const g = best?.g;
  if (!g) return null;
  const three = best.kind === "last3";
  return {
    kind: three ? "last3" : "last",
    line: lastGameLine(pos, g) || "",
    ...(three
      ? { games: g.games || 3, first: g.first || "", last: g.last || "" }
      : { at: g.at || "", opp: g.opp || "", oppLogo: g.oppLogo || "", result: g.result || "", score: g.score || "", date: g.date || "" }),
  };
}

// His recent line now, from ESPN (espnId: his headshot's) — null without one.
export async function fetchRecentSummary(pos, espnId) {
  if (!espnId) return null;
  return recentSummary(pos, await bestRecentLine(espnId).catch(() => null));
}
