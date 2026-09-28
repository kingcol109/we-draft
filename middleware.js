export const config = {
  matcher: '/((?!static|.*\\..*).*)',
};

// Search crawlers — re-crawl constantly, so every page they reach gets
// cached (and then periodically re-rendered, each one billed) by
// Prerender.io.
const SEARCH_BOTS = ['googlebot', 'bingbot', 'yandex', 'baiduspider', 'applebot'];
// Link-preview bots — only fetch a page when someone actually shares its
// link, and can't run JavaScript at all (no prerender = no title/image in
// the preview), so they're always sent through Prerender.io.
const SOCIAL_BOTS = [
  'facebookexternalhit', 'twitterbot', 'linkedinbot',
  'slackbot', 'discordbot', 'whatsapp',
];

// Player-scoped pages for past classes don't need regular prerendering —
// only current prospect classes change week to week. /player/<slug> and
// /comparison/<slug> for a class before FIRST_PROSPECT_YEAR skip
// Prerender.io for *search* crawlers (Google/Bing render the page's
// JavaScript themselves); social bots still get the prerendered page so a
// shared link keeps its preview. Everything else (teams, news, boards,
// current prospects, ...) is prerendered for every bot, as before.
// Bump FIRST_PROSPECT_YEAR each year once a class is drafted.
const FIRST_PROSPECT_YEAR = 2027;

// Class year from a player slug — "kanye-udoh-2027-rb",
// "ashton-hampton-2027-db-1", a supplemental "…-2026s-qb", or year-last
// ("sam-darnold-qb-2017") all work. null if the path isn't a player-scoped
// page or its slug carries no year.
function playerPageYear(pathname) {
  const m = /^\/(player|comparison)\/([^/]+)/.exec(pathname);
  if (!m) return null;
  const y = /-(\d{4})s?(?=-|$)/.exec(decodeURIComponent(m[2]));
  return y ? Number(y[1]) : null;
}

export default async function middleware(req) {
  const ua = req.headers.get('user-agent')?.toLowerCase() || '';
  const isSearchBot = SEARCH_BOTS.some((bot) => ua.includes(bot));
  const isSocialBot = SOCIAL_BOTS.some((bot) => ua.includes(bot));
  if (!isSearchBot && !isSocialBot) return;

  if (isSearchBot && !isSocialBot) {
    const year = playerPageYear(new URL(req.url).pathname);
    if (year != null && year < FIRST_PROSPECT_YEAR) return; // past class: serve the normal app
  }

  const targetUrl = `https://service.prerender.io/${req.url}`;
  const prerenderRes = await fetch(targetUrl, {
    headers: { 'X-Prerender-Token': process.env.PRERENDER_TOKEN },
    cache: 'no-store', // never let Vercel's edge cache this response — always ask Prerender.io fresh, so Prerender.io's own cache/recache logic is actually in control
  });
  return new Response(await prerenderRes.text(), {
    status: prerenderRes.status,
    headers: { 'content-type': 'text/html' },
  });
}
