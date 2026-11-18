// scripts/buildPortalSimPreviewPages.mjs
//
// After `react-scripts build`: a static copy of build/index.html for every
// Transfer Portal Sim page — /portalsim and /portalsim/{team} — with that
// page's own title, description, canonical URL and preview image already in
// its <head>, as scripts/buildDraftSimPreviewPages.mjs does for the Draft
// Sim. Link previews and crawlers that don't run the app read these.
//
// Written as build/portalsim.html and build/portalsim/florida-state.html;
// firebase.json's cleanUrls serves /portalsim/florida-state from it ahead of
// the catch-all rewrite. Each copy is still the full app, and the tags carry
// data-rh so the page's own Helmet (components/portalSim/PortalSimMeta.jsx)
// takes them over. Tags: utils/portalSim/meta.js. No network, no Firestore.
// Usage (run by `npm run build`):
//   node scripts/buildPortalSimPreviewPages.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { portalSimMeta, portalSimPath, SIM_TEAMS } from "../src/utils/portalSim/meta.js";

const BUILD = "build";
const html = readFileSync(`${BUILD}/index.html`, "utf8");
if (!/<title>[^<]*<\/title>/.test(html)) throw new Error("build/index.html has no <title> to replace");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pageFor(page) {
  const m = portalSimMeta(page);
  const tag = (attr, key, content) => `<meta data-rh="true" ${attr}="${key}" content="${esc(content)}"/>`;
  const tags = [
    tag("name", "description", m.description),
    `<link data-rh="true" rel="canonical" href="${esc(m.url)}"/>`,
    tag("property", "og:type", "website"),
    tag("property", "og:title", m.title),
    tag("property", "og:description", m.description),
    tag("property", "og:url", m.url),
    tag("property", "og:image", m.image),
    tag("property", "og:image:width", "1200"),
    tag("property", "og:image:height", "630"),
    tag("property", "og:image:alt", m.imageAlt),
    tag("property", "og:site_name", "We-Draft.com"),
    tag("name", "twitter:card", "summary_large_image"),
    tag("name", "twitter:title", m.title),
    tag("name", "twitter:description", m.description),
    tag("name", "twitter:image", m.image),
  ].join("");
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
    .replace("</head>", `${tags}</head>`);
}

let n = 0;
[null, ...Object.keys(SIM_TEAMS)].forEach((team) => {
  const file = `${BUILD}${portalSimPath({ team })}.html`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, pageFor({ team }));
  n += 1;
});
console.log(`Portal Sim preview pages: wrote ${n} (setup + ${n - 1} teams)`);
