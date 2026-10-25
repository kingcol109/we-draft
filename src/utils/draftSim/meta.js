// src/utils/draftSim/meta.js
//
// The Draft Sim pages' title, description, canonical URL and preview image —
// /draftsim, /draftsim/{team}, /draftsim/2028 and /draftsim/2028/{team}.
// Shared by the page's Helmet tags (components/draftSim/DraftSimMeta.jsx) and
// the static copies of each page that link previews read before any
// JavaScript runs (scripts/buildDraftSimPreviewPages.mjs). No React here, so
// the build script can import it (hence the .js on its imports).
//
// Images: public/draftsim-og/{TEAM}.png and default.png, drawn by
// scripts/buildDraftSimPreviewImages.mjs (one per team, no year on them, so
// both classes share them).
import { NFL_TEAMS } from "../coachHistory.js";
import { SIM_YEAR, SIM_YEARS } from "./years.js";

const SITE = "https://we-draft.com";

// The page's team and year from its route params, read the same way
// DraftSim.jsx reads them.
export function simPage(params) {
  const pathYear = params.year || (SIM_YEARS.includes(params.team) ? params.team : null);
  const teamParam = pathYear && !params.year ? null : params.team;
  const team = teamParam && NFL_TEAMS[teamParam.toUpperCase()] ? teamParam.toUpperCase() : null;
  const year = SIM_YEARS.includes(pathYear) ? pathYear : SIM_YEAR;
  return { team, year };
}

// The page's path (/draftsim/2028/tb).
export const simPath = ({ team, year }) => `/draftsim${year === SIM_YEAR ? "" : `/${year}`}${team ? `/${team.toLowerCase()}` : ""}`;

export function simMeta({ team, year }) {
  const teamName = team ? NFL_TEAMS[team] : null;
  return {
    title: teamName ? `${teamName} ${year} Mock Draft Simulator` : `${year} Mock Draft Simulator | Make Every Pick in the Draft`,
    description: teamName
      ? `Make all the picks for the ${teamName} in the ${year} NFL Draft. Trade up or down, draft your board and get a grade for every pick.`
      : `Make every pick in the ${year} NFL Draft. Draft for one team or all 32, make trades and get live analyst reactions and a grade for every pick.`,
    url: `${SITE}${simPath({ team, year })}`,
    image: `${SITE}/draftsim-og/${team || "default"}.png`,
    imageAlt: teamName ? `${teamName} Mock Draft Simulator on We-Draft.com` : "We-Draft.com Mock Draft Simulator",
  };
}
