// src/utils/classRanks.js
//
// Class rank + position rank from one class-list snapshot doc
// (compSnapshots/class_{Eligible}_{Position}, built weekly by
// utils/snapshotBuilders.js). This is the single source both PlayerProfile.js
// (its Class Rank box) and CommunityBoard.js (the rank chips) read, so the
// two always show the same numbers:
//   - classRank    = the row's `cr`, the grade-ranked overall class rank
//   - positionRank = 1 + players in this position group with a better cr
// Not-Live players live in the doc's `hidden` map with their own-page
// placement, ranked the same way. A player missing from the doc has no
// entry — callers show nothing rather than a guessed rank.
export function classSnapshotRanks(snapDoc) {
  const out = {};
  const rows = Array.isArray(snapDoc?.rows) ? snapDoc.rows : [];
  const positionRankFor = (cr) => (cr == null ? null : rows.filter((r) => r.cr != null && r.cr < cr).length + 1);
  rows.forEach((r) => { out[r.i] = { classRank: r.cr ?? null, positionRank: positionRankFor(r.cr ?? null) }; });
  Object.entries(snapDoc?.hidden || {}).forEach(([id, h]) => {
    out[id] = { classRank: h.cr ?? null, positionRank: positionRankFor(h.cr ?? null) };
  });
  return out;
}

// Ascending rank compare where a missing rank always sorts after every real
// one, whichever direction the list is sorted in.
export function compareRanks(a, b, order = "asc") {
  const aOk = Number.isFinite(a) && a > 0;
  const bOk = Number.isFinite(b) && b > 0;
  if (aOk && bOk) return order === "asc" ? a - b : b - a;
  if (aOk) return -1;
  if (bOk) return 1;
  return 0;
}
