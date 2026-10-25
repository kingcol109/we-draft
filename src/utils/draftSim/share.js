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

// Mock Draft mode's export (components/draftSim/MockExport.jsx): the sim
// as a mockDrafts doc in the mock editor's shape (pages/CreateMock.jsx) —
// every pick keyed by number, its team and any trade, and the player it
// took. Private until they publish it from the editor; the caller adds
// the timestamps.
export function mockFromSim(sim, { year, name, ownerId }) {
  const picks = {};
  sim.picks.forEach((p) => {
    const pl = sim.byId[p.selection];
    picks[p.overall] = {
      pickNumber: p.overall, round: p.round, originalTeam: p.original, currentTeam: p.owner,
      tradedFrom: p.owner !== p.original ? p.original : null, note: "",
      selection: pl ? { id: pl.id, First: pl.First, Last: pl.Last, Position: pl.Position, School: pl.School || "", Slug: pl.Slug || "" } : null,
    };
  });
  return {
    name, description: "", rounds: Math.max(1, ...sim.picks.map((p) => p.round)), visibility: "private",
    draftClass: String(year), picks, ownerId, source: "draftSim",
  };
}

// Mock Draft mode's share text: every pick, round by round when there's
// more than one ("1. Tennessee Titans — Arch Manning, QB, Texas"), then the
// link. teamName(abbr) → "Tennessee Titans".
export function mockShareText({ year, sim, teamName }) {
  const rounds = [...new Set(sim.picks.map((p) => p.round))];
  return [
    `My ${year} NFL Mock Draft`,
    ...rounds.flatMap((r) => [
      ...(rounds.length > 1 ? ["", `Round ${r}`] : [""]),
      ...sim.picks.filter((p) => p.round === r && p.selection).map((p) => {
        const pl = sim.byId[p.selection];
        return `${p.overall}. ${teamName(p.owner)} — ${pl.First} ${pl.Last}, ${pl.Position}${pl.School ? `, ${pl.School}` : ""}`;
      }),
    ]),
    "",
    simCallToAction(year),
  ].join("\n");
}
