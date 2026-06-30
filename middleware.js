export const config = {
  matcher: '/((?!static|.*\\..*).*)',
};

const BOT_AGENTS = [
  'googlebot', 'bingbot', 'yandex', 'baiduspider',
  'facebookexternalhit', 'twitterbot', 'linkedinbot',
  'slackbot', 'discordbot', 'whatsapp', 'applebot'
];

export default async function middleware(req) {
  const ua = req.headers.get('user-agent')?.toLowerCase() || '';
  const isBot = BOT_AGENTS.some(bot => ua.includes(bot));

  if (isBot) {
    const targetUrl = `https://service.prerender.io/${req.url}`;
    const prerenderRes = await fetch(targetUrl, {
      headers: { 'X-Prerender-Token': process.env.PRERENDER_TOKEN },
    });
    return new Response(await prerenderRes.text(), {
      status: prerenderRes.status,
      headers: { 'content-type': 'text/html' },
    });
  }
}