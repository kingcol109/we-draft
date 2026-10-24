// src/utils/draftSim/share.js
//
// A finished Draft Sim as text: per team, "My 2027 New York Jets Draft Sim",
// the grade, then one line per pick; a call to action with the link last.
// Shared by the results screen (components/draftSim/SimResults.jsx) and the
// saved drafts tab (components/draftSim/SavedSims.jsx), so a sim shares the
// same either way.
import { SIM_YEAR } from "./years";

// The user's teams' hauls (engine teamHaul) → what's saved and shared:
// [{ team, grade, picks: [{ overall, round, via, grade, id, slug, first, last, pos, school }] }].
export function haulRecords(hauls) {
  return hauls.filter((h) => h.rows.length).map((h) => ({
    team: h.team, grade: h.letter,
    picks: h.rows.map(({ pick, prospect, letter }) => ({
      overall: pick.overall, round: pick.round, via: pick.via || null, grade: letter,
      id: prospect.id, slug: prospect.Slug || "", first: prospect.First, last: prospect.Last,
      pos: prospect.Position, school: prospect.School || "",
    })),
  }));
}

export const simUrl = (year) => `We-Draft.com/draftsim${String(year) === SIM_YEAR ? "" : `/${year}`}`;
export const simCallToAction = (year) => `Create Your Own On ${simUrl(year)}`;

// teams: haulRecords' shape; teamName(abbr) → "New York Jets".
export function simShareText({ year, teams, teamName }) {
  return [
    ...teams.flatMap((t, i) => [
      ...(i ? [""] : []),
      `My ${year} ${teamName(t.team)} Draft Sim`,
      `Grade: ${t.grade}`,
      ...(t.picks || []).map((p) => `${p.overall}. ${p.first} ${p.last}, ${p.pos}${p.school ? `, ${p.school}` : ""}`),
    ]),
    "",
    simCallToAction(year),
  ].join("\n");
}
