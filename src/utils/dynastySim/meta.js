// src/utils/dynastySim/meta.js
//
// The Dynasty Draft Sim pages' title, description, canonical URL and
// preview image — /draftsim/dynasty/2027 … 2029. Shared by the page's
// Helmet tags (components/draftSim/DynastySimMeta.jsx) and the static copies
// link previews read (scripts/buildDraftSimPreviewPages.mjs). No React and
// no imports beyond plain data, so the build script can load it.
const SITE = "https://we-draft.com";
export const DYNASTY_META_YEARS = ["2027", "2028", "2029"];

export const dynastyPath = (year) => `/draftsim/dynasty/${year}`;

export function dynastyMeta(year) {
  return {
    title: `${year} Dynasty Draft Simulator | Fantasy Football`,
    description: `Mock your ${year} dynasty rookie draft. Pick the quarterbacks, running backs, receivers and tight ends of the ${year} class against 5 to 19 other teams, snake or linear, up to 7 rounds.`,
    url: `${SITE}${dynastyPath(year)}`,
    image: `${SITE}/draftsim-og/default.png`,
    imageAlt: `${year} Dynasty Draft Simulator on We-Draft.com`,
  };
}
