// src/utils/draftSim/years.js
//
// The class the sim drafts by default, and every class it can draft
// (/draftsim/2028). On their own (no imports) so the always-loaded SEO tags
// (components/draftSim/DraftSimMeta.jsx) don't pull in the sim's data code.
export const SIM_YEAR = "2027";
export const SIM_YEARS = ["2027", "2028"];
// The most rounds a class's sim drafts, whatever its board could fill —
// 2028's is three, as its Weekly Mock (weeklyMock.js WEEKLY_ROUNDS_BY_YEAR).
export const ROUND_CAPS = { 2028: 3 };
// Past drafts the sim can re-draft (/draftsim/2026): the real order without
// comp picks, each team's needs going in and the real picks — redraft/{year}.json
// from scripts/buildRedraft.mjs. Admin-only for now.
export const REDRAFT_YEARS = Array.from({ length: 2026 - 2000 + 1 }, (_, i) => String(2026 - i));
// Re-drafts with a We-Draft.com board to draft off (we graded the class):
// 2026 only. Older ones draft off Hindsight alone.
export const WEDRAFT_BOARD_YEARS = ["2026"];
