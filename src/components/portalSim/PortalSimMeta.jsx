// src/components/portalSim/PortalSimMeta.jsx
//
// The Transfer Portal Sim pages' SEO tags — /portalsim and /portalsim/{team},
// rendered alongside the page by App.js (as DraftSimMeta is for the Draft
// Sim). The tags come from utils/portalSim/meta.js, which the build also
// uses to write each page's static copy for link previews
// (scripts/buildPortalSimPreviewPages.mjs). School names are the built-in
// list (utils/portalSim/simTeams.js), so the tags are there before any data loads.
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { portalSimPage, portalSimMeta } from "../../utils/portalSim/meta";

export default function PortalSimMeta() {
  const { title, description, url, image, imageAlt } = portalSimMeta(portalSimPage(useParams()));
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
