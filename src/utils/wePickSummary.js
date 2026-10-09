// src/utils/wePickSummary.js
//
// A We-Pick game's community picks as one summary — the same shape as the
// wePickSummaries/{id} doc the live ingester keeps
// (server/live/pickSummaries.js), all in schedule26's orientation:
//   { count, split { away, home }, scored, sum { away, home },
//     scores ("away-home" → n), publicCount, recent [...] }
// Used by /live's pick card, recap and halftime card (LivePage.js
// useGamePicks) — built here only for a game without a summary doc.
import { pickedSideOf, hasScorePick } from "./wePickScoring";
import { toMs } from "./wePickLocks";

// The summary's picture of picks, built here (same as the server's —
// server/live/pickSummaries.js): for a game without a summary doc.
export const PICK_RECENT = 24;
export const pickPublic = (p) => p.visibility !== "private" && (hasScorePick(p) || !!pickedSideOf(p));
export const listedPick = (p) => ({
  uid: p.uid, name: p.displayName || "Anonymous Fan", side: pickedSideOf(p),
  away: hasScorePick(p) ? p.awayScore : null, home: hasScorePick(p) ? p.homeScore : null,
  ranked: p.ranked === true, prediction: p.prediction || "", at: toMs(p.updatedAt) || 0,
});
export function summarizePicks(picks) {
  let out = { count: 0, split: { away: 0, home: 0 }, scored: 0, sum: { away: 0, home: 0 }, scores: {}, publicCount: 0, recent: [] };
  for (const p of picks) out = addPick(out, p, 1);
  out.recent = picks.filter(pickPublic).map(listedPick).sort((a, b) => b.at - a.at).slice(0, PICK_RECENT);
  return out;
}
// The summary with one pick counted in (k 1) or taken out (k -1).
export function addPick(s, p, k) {
  if (!p) return s;
  const out = { ...s, split: { ...s.split }, sum: { ...s.sum }, scores: { ...s.scores } };
  const side = pickedSideOf(p);
  if (side) { out.count += k; out.split[side] += k; }
  if (hasScorePick(p)) {
    out.scored += k; out.sum.away += k * p.awayScore; out.sum.home += k * p.homeScore;
    const key = `${p.awayScore}-${p.homeScore}`;
    out.scores[key] = (out.scores[key] || 0) + k;
  }
  if (pickPublic(p)) out.publicCount += k;
  return out;
}
// What a card shows: the summary with the viewer's own latest pick folded
// in (mineLocal: one just saved here) — so your pick counts the moment you
// make it, not when the summary next catches up.
export function pickView(data, uid, mineLocal = null) {
  if (!data) return null;
  const mine = mineLocal ? { ...(data.mine || {}), ...mineLocal, uid } : data.mine;
  let summary = data.summary;
  if (mine && (mineLocal || !data.mineCounted)) summary = addPick(addPick(summary, data.mineCounted ? data.mine : null, -1), mine, 1);
  // (signed in with no pick of your own: one you deleted drops off the
  // list now, not at the summary's next rebuild)
  const recent = (summary.recent || []).filter((r) => r.uid !== uid);
  if (mine && pickPublic(mine)) recent.unshift({ ...listedPick(mine), verified: (data.summary.recent || []).find((r) => r.uid === uid)?.verified });
  return { sched: data.sched, summary: { ...summary, recent }, mine };
}
