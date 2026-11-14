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
