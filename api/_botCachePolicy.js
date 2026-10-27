// api/_botCachePolicy.js — not a route (Vercel skips api/ files starting
// with "_"); shared by api/bot-render.js, api/bot-render-clear.js and
// api/recache-mocks.js.
//
// Our own cache of prerendered pages for bots (prerenderCache in
// Firestore). Prerender.io re-renders everything in its own cache on one
// global timer (our plan can't set it per page), so for the page types
// below bots get our stored copy, and we ask Prerender.io for a fresh
// render only when that type's schedule is up — and Prerender.io's own
// cache for those types is emptied every few hours (bot-render-clear), so
// it never re-renders them on its own timer. Anything not listed here
// (home, community boards, …) stays on Prerender.io's timer as before.
//
// days: how old a stored copy may get before the next bot visit re-renders
// it (Infinity: rendered once, kept for good).
// ENABLED: the types live right now — the rest pass straight through to
// Prerender.io as before. Turned on a few at a time.

const SITE_HOST = "we-draft.com";
// Player-scoped pages for classes before this are past drafts
// (middleware.js FIRST_PROSPECT_YEAR — search bots get the plain app).
const FIRST_PROSPECT_YEAR = 2027;
// The past classes with player pages (the historical archive starts here).
const FIRST_ARCHIVE_YEAR = 2017;
const PAST_YEARS = Array.from({ length: FIRST_PROSPECT_YEAR - FIRST_ARCHIVE_YEAR }, (_, i) => FIRST_ARCHIVE_YEAR + i);

function playerYear(path) {
  const m = /^\/(player|comparison)\/([^/]+)/.exec(path);
  if (!m) return null;
  const y = /-(\d{4})s?(?=-|$)/.exec(decodeURIComponent(m[2]));
  return y ? Number(y[1]) : null;
}

// First match wins. clear: Prerender.io cache patterns (SQL-like, % wildcards).
const TYPES = [
  { type: "mocks", days: 7, test: (p) => /^\/mocks(\/|$)/.test(p), clear: ["/mocks%"] },
  { type: "playerPast", days: Infinity, test: (p) => { const y = playerYear(p); return y != null && y < FIRST_PROSPECT_YEAR; }, clear: PAST_YEARS.flatMap((y) => [`/player/%-${y}%`, `/comparison/%-${y}%`]) },
  { type: "player", days: 30, test: (p) => /^\/(player|comparison)\//.test(p), clear: ["/player/%", "/comparison/%"] },
  { type: "sim", days: 30, test: (p) => /^\/draftsim(\/|$)/.test(p), clear: ["/draftsim%"] },
  { type: "nfl", days: 30, test: (p) => /^\/(nfl|staff)\//.test(p), clear: ["/nfl/%", "/staff/%"] },
  { type: "college", days: 90, test: (p) => /^\/(team\/|cfb(\/|$))/.test(p), clear: ["/team/%", "/cfb%"] },
  { type: "article", days: Infinity, test: (p) => /^\/news\/[^/]+/.test(p), clear: ["/news/%"] },
  { type: "game", days: Infinity, test: (p) => /^\/(game|live)\/[^/]+/.test(p), clear: ["/game/%", "/live/%"] },
];

const ENABLED = new Set(["playerPast", "college", "article", "game"]);

const typeOf = (path) => TYPES.find((t) => t.test(path)) || null;

// Prerender.io cache-clear queries for the live types.
const clearQueries = () => TYPES.filter((t) => ENABLED.has(t.type)).flatMap((t) => t.clear.map((c) => `%${SITE_HOST}${c}`));

module.exports = { TYPES, ENABLED, typeOf, clearQueries, playerYear, SITE_HOST };
