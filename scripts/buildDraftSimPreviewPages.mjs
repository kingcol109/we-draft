// scripts/buildDraftSimPreviewPages.mjs
//
// After `react-scripts build`: a static copy of build/index.html for every
// Draft Sim page — /draftsim, /draftsim/{team}, /draftsim/2028 and
// /draftsim/2028/{team} — with that page's own title, description,
// canonical URL and preview image already in its <head>. Link previews
// (iMessage, X, Discord, Slack…) read the raw HTML and never run the app,
// so without these every team link previews as the generic site.
//
// Written as build/draftsim/nyj.html etc.; firebase.json's cleanUrls serves
// /draftsim/nyj from it ahead of the catch-all rewrite. Each copy is still
// the full app — it boots exactly like index.html, and the tags carry
// data-rh so the page's own Helmet (DraftSimMeta.jsx) takes them over
// instead of doubling them. Tags: utils/draftSim/meta.js, the same ones
// Helmet sets. No network, no Firestore.
// Usage (run by `npm run build`):
//   node scripts/buildDraftSimPreviewPages.mjs
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { simMeta, simPath } from "../src/utils/draftSim/meta.js";
import { SIM_YEARS } from "../src/utils/draftSim/years.js";
import { NFL_TEAM_ABBRS } from "../src/utils/coachHistory.js";

const BUILD = "build";
const html = readFileSync(`${BUILD}/index.html`, "utf8");
if (!/<title>[^<]*<\/title>/.test(html)) throw new Error("build/index.html has no <title> to replace");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pageFor(page) {
  const m = simMeta(page);
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
SIM_YEARS.forEach((year) => {
  [null, ...NFL_TEAM_ABBRS].forEach((team) => {
    const file = `${BUILD}${simPath({ team, year })}.html`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pageFor({ team, year }));
    n += 1;
  });
});
console.log(`Draft Sim preview pages: wrote ${n} (${SIM_YEARS.join(", ")} × setup + ${NFL_TEAM_ABBRS.length} teams)`);
