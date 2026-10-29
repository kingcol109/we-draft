// src/utils/subPositions.js
//
// The sub-position filters for the positions that split — tackles and the
// interior line, corners and safeties — shared by the Draft Sim's Draft
// Board tab (SimBroadcast.jsx) and the Community Board (CommunityBoard.js).
// A player listed at more than one (an OT who also plays guard, a
// corner-safety) shows under each.
//
// SUB_TABS: { [position]: [[tab, the sub-positions it takes]] }.
export const SUB_TABS = { OL: [["OT", ["OT"]], ["IOL", ["G", "C"]]], DB: [["CB", ["CB"]], ["S", ["S"]]] };

// A player's sub-positions, from a players doc (the admin's
// SubPositionOverride over the synced SubPosition — Admin → Players → Data
// Management → Sub-positions) or a sim prospect (subPosition): one ("OT")
// or several (["G", "C"]); an old "IOL" is a guard or a center.
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
export function playerSubs(p) {
  const v = [p?.subPosition, p?.SubPositionOverride, p?.SubPosition].map(asList).find((l) => l.length) || [];
  return v.flatMap((x) => (x === "IOL" ? ["G", "C"] : [x]));
}

// Is the player under this sub tab of his position? (No tab: yes.)
export function inSubTab(p, position, tab) {
  const keys = SUB_TABS[position]?.find(([k]) => k === tab)?.[1];
  return !keys || playerSubs(p).some((k) => keys.includes(k));
}
