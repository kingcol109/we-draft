// src/components/draftSim/DynastySimMeta.jsx
//
// The Dynasty Draft Sim's SEO tags (/draftsim/dynasty/{year}) — the same
// set DraftSimMeta writes, from utils/dynastySim/meta.js (which the build's
// static preview copies use too).
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { dynastyMeta, DYNASTY_META_YEARS } from "../../utils/dynastySim/meta";

export default function DynastySimMeta() {
  const { year } = useParams();
  const { title, description, url, image, imageAlt } = dynastyMeta(DYNASTY_META_YEARS.includes(year) ? year : DYNASTY_META_YEARS[0]);
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
