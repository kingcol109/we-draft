// src/utils/nflRoster.js
//
// An NFL team's roster from ESPN, grouped by position the way the team
// page's Depth Chart tab lays it out (NFLTeamPage.jsx) — also the Draft
// Sim's Roster tab (components/draftSim/SimBroadcast.jsx).
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

// ESPN team ID map (abbreviation → ESPN numeric ID)
export const ESPN_TEAM_IDS = {
  ARI: 22, ATL: 1,  BAL: 33, BUF: 2,  CAR: 29, CHI: 3,  CIN: 4,  CLE: 5,
  DAL: 6,  DEN: 7,  DET: 8,  GB: 9,   HOU: 34, IND: 11, JAX: 30, KC: 12,
  LV: 13,  LAC: 24, LAR: 14, MIA: 15, MIN: 16, NE: 17,  NO: 18,  NYG: 19,
  NYJ: 20, PHI: 21, PIT: 23, SF: 25,  SEA: 26, TB: 27,  TEN: 10, WAS: 28,
};

// Position groups — covers all known ESPN abbreviation variants
export const POSITION_GROUPS = {
  "Quarterbacks":     ["QB"],
  "Running Backs":    ["RB", "FB", "HB"],
  "Wide Receivers":   ["WR"],
  "Tight Ends":       ["TE"],
  "Offensive Line":   ["OL", "OT", "OG", "C", "CTR", "OC", "LT", "RT", "LG", "RG", "G", "T"],
  "Defensive Line":   ["DL", "DE", "DT", "NT", "DE/DT"],
  "Edge Rushers":     ["EDGE", "OLB/DE", "DE/OLB"],
  "Linebackers":      ["LB", "ILB", "OLB", "MLB", "SLB", "WLB"],
  "Cornerbacks":      ["CB", "RCB", "LCB", "NCB"],
  "Safeties":         ["S", "FS", "SS", "SAF"],
  "Defensive Backs":  ["DB"],
  "Specialists":      ["K", "P", "PK", "LS", "KR", "PR"],
};

// Roster status — ESPN's roster comes in groups (offense/defense/
// specialTeam, injuredReserveOrOut, suspended, practiceSquad).
export const ROSTER_GROUP_STATUS = { injuredReserveOrOut: "reserve", suspended: "suspended", practiceSquad: "ps" };
export const STATUS_TIER = { active: 0, reserve: 1, suspended: 1, ps: 2 };

// Depth chart order — nflDepthOrder/{abbr} (scripts/nflTeamNeeds.js) is the
// team's player names by season snaps, most first. Names are matched to the
// ESPN roster loosely: punctuation and suffixes (Jr., III) dropped, then
// first initial + last name as a fallback ("Ken Walker" / "Kenneth Walker").
// Order only — snaps are never shown.
export const depthNameKey = (name) => String(name || "").toLowerCase()
  .replace(/[^a-z\s-]/g, "").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/[\s-]+/g, " ").trim();
export const initialKey = (name) => {
  const parts = depthNameKey(name).split(" ");
  return parts.length > 1 ? `${parts[0][0]} ${parts.slice(1).join(" ")}` : parts[0];
};
export function depthRanker(order) {
  const full = new Map();
  const initial = new Map();
  (order || []).forEach((n, i) => {
    if (!full.has(depthNameKey(n))) full.set(depthNameKey(n), i);
    if (!initial.has(initialKey(n))) initial.set(initialKey(n), i);
  });
  return (p) => full.get(depthNameKey(p.fullName)) ?? initial.get(initialKey(p.fullName)) ?? Infinity;
}

// nflDepthOrder/{abbr}.order, or [] when missing.
export function fetchDepthOrder(abbr) {
  return getDoc(doc(db, "nflDepthOrder", abbr)).then((snap) => (snap.exists() ? snap.data().order || [] : []));
}

// The team's ESPN roster, flattened. [] for an unknown team.
export async function fetchEspnRoster(abbr) {
  const espnId = ESPN_TEAM_IDS[abbr];
  if (!espnId) return [];
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${espnId}/roster`);
  const data = await res.json();
  // ESPN returns athletes grouped by roster status (see ROSTER_GROUP_STATUS)
  return (data.athletes || []).flatMap((group) =>
    (group.items || []).map((a) => ({
      id: a.id,
      firstName: a.firstName,
      lastName: a.lastName,
      fullName: a.fullName,
      position: a.position?.abbreviation || "",
      jersey: a.jersey || "",
      age: a.age,
      height: a.displayHeight,
      weight: a.displayWeight,
      experience: a.experience?.years ?? null,
      college: a.college?.name || "",
      headshot: a.headshot?.href || null,
      rosterStatus: ROSTER_GROUP_STATUS[group.position] || "active",
      injury: a.injuries?.[0]?.status || null,
      injuryDate: a.injuries?.[0]?.date || null,
    }))
  );
}

// { [group]: players } in POSITION_GROUPS order (then "Other") — active
// players first, then IR/suspended, then the practice squad, each in depth
// chart (snap) order; anyone not in the depth order keeps ESPN's order
// after everyone who is.
export function groupRoster(roster, depthOrder) {
  const depthRank = depthRanker(depthOrder);
  const grouped = {};
  const allGroupedPositions = new Set(Object.values(POSITION_GROUPS).flat());
  Object.entries(POSITION_GROUPS).forEach(([group, positions]) => {
    const members = roster
      .map((p, i) => ({ p, i, r: depthRank(p) }))
      .filter(({ p }) => positions.includes(p.position))
      .sort((a, b) => STATUS_TIER[a.p.rosterStatus] - STATUS_TIER[b.p.rosterStatus] || a.r - b.r || a.i - b.i)
      .map(({ p }) => p);
    if (members.length > 0) grouped[group] = members;
  });
  const ungrouped = roster.filter((p) => !allGroupedPositions.has(p.position));
  if (ungrouped.length > 0) grouped["Other"] = ungrouped;
  return grouped;
}
