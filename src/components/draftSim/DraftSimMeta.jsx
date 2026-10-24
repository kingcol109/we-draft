// src/components/draftSim/DraftSimMeta.jsx
//
// The Draft Sim pages' SEO tags — /draftsim, /draftsim/{team}, /draftsim/2028
// and /draftsim/2028/{team}, rendered alongside the page by App.js. Team
// names are the built-in ones (coachHistory NFL_TEAMS), so the tags are
// there before any data loads.
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { NFL_TEAMS } from "../../utils/coachHistory";
import { SIM_YEAR, SIM_YEARS } from "../../utils/draftSim/years";

// The page's team and year, read the same way DraftSim.jsx reads them.
export function simPage(params) {
  const pathYear = params.year || (SIM_YEARS.includes(params.team) ? params.team : null);
  const teamParam = pathYear && !params.year ? null : params.team;
  const team = teamParam && NFL_TEAMS[teamParam.toUpperCase()] ? teamParam.toUpperCase() : null;
  const year = SIM_YEARS.includes(pathYear) ? pathYear : SIM_YEAR;
  return { team, year };
}

export function simMeta({ team, year }) {
  const teamName = team ? NFL_TEAMS[team] : null;
  const path = `/draftsim${year === SIM_YEAR ? "" : `/${year}`}${team ? `/${team.toLowerCase()}` : ""}`;
  return {
    title: teamName ? `${teamName} ${year} Mock Draft Simulator` : `${year} Mock Draft Simulator | Make Every Pick in the Draft`,
    description: teamName
      ? `Make all the picks for the ${teamName} in the ${year} NFL Draft. Trade up or down, draft your board and get a grade for every pick.`
      : `Make every pick in the ${year} NFL Draft. Draft for one team or all 32, make trades and get live analyst reactions and a grade for every pick.`,
    url: `https://we-draft.com${path}`,
  };
}

export default function DraftSimMeta() {
  const { title, description, url } = simMeta(simPage(useParams()));
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:site_name" content="We-Draft.com" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </Helmet>
  );
}
