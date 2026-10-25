// src/components/draftSim/DraftSimMeta.jsx
//
// The Draft Sim pages' SEO tags — /draftsim, /draftsim/{team}, /draftsim/2028
// and /draftsim/2028/{team}, rendered alongside the page by App.js. The
// tags themselves come from utils/draftSim/meta.js, which the build also
// uses to write each page's static copy for link previews
// (scripts/buildDraftSimPreviewPages.mjs). Team names are the built-in ones
// (coachHistory NFL_TEAMS), so the tags are there before any data loads.
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { simPage, simMeta } from "../../utils/draftSim/meta";

export { simPage, simMeta };

export default function DraftSimMeta() {
  const { title, description, url, image, imageAlt } = simMeta(simPage(useParams()));
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={imageAlt} />
      <meta property="og:site_name" content="We-Draft.com" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
}
