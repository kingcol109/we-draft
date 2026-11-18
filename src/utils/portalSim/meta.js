// src/utils/portalSim/meta.js
//
// The Transfer Portal Sim pages' title, description, canonical URL and
// preview image — /portalsim and /portalsim/{team} (user, 2026-11-18):
//   /portalsim               "2027 Transfer Portal Simulator | College Football"
//   /portalsim/florida-state "Florida State Transfer Portal Simulator | College Football 2027"
// Shared by the page's Helmet tags (components/portalSim/PortalSimMeta.jsx)
// and the static copies of each page that link previews read before any
// JavaScript runs (scripts/buildPortalSimPreviewPages.mjs). No React here,
// so the build script can import it (hence the .js on its imports).
//
// Teams: ./simTeams.js (scripts/buildPortalSimTeams.mjs) — every FBS school
// the sim plays as, so the tags are there before the pool loads.
// Images: public/portalsim-og/{slug}.png and default.png, drawn by
// scripts/buildPortalSimPreviewImages.mjs.
import SIM_TEAMS from "./simTeams.js";
import { activePortalSeason } from "../eligibility.js";

const SITE = "https://we-draft.com";

export { SIM_TEAMS };
// The class the portal feeds (2027 from August 2026 on).
export const portalSimYear = (now) => activePortalSeason(now);

// The page's team from its route params (null: the setup screen, or a slug
// that isn't an FBS school).
export const portalSimPage = (params = {}) => ({ team: params.team && SIM_TEAMS[params.team] ? params.team : null });

export const portalSimPath = ({ team }) => `/portalsim${team ? `/${team}` : ""}`;

export function portalSimMeta({ team }, now) {
  const year = portalSimYear(now);
  const school = team ? SIM_TEAMS[team] : null;
  return {
    title: school
      ? `${school} Transfer Portal Simulator | College Football ${year}`
      : `${year} Transfer Portal Simulator | College Football`,
    description: school
      ? `Run ${school} through the ${year} college football transfer portal: keep your players, make NIL offers, beat every FBS school to your targets and get a grade for your portal class.`
      : `Take over any FBS program in the ${year} college football transfer portal. Keep your players, make NIL offers, recruit against every school and get a grade for your portal class.`,
    url: `${SITE}${portalSimPath({ team: school ? team : null })}`,
    image: `${SITE}/portalsim-og/${school ? team : "default"}.png`,
    imageAlt: school ? `${school} Transfer Portal Simulator on We-Draft.com` : "We-Draft.com Transfer Portal Simulator",
  };
}
