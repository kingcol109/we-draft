// api/bot-render-clear.js
//
// Vercel Cron target (hourly, vercel.json): empties Prerender.io's own
// cache for the page types our cache serves (api/_botCachePolicy.js), so
// Prerender.io never re-renders them on its global timer — our cache
// decides when they're rendered. Prerender.io runs one clear job at a
// time, so each run clears one pattern, taking them in turn by the hour
// (every pattern is cleared a few times a day), and skips a run while a
// job is still going.
//
// GET with Authorization: Bearer $CRON_SECRET. Needs PRERENDER_TOKEN.

const crypto = require("crypto");
const { clearQueries } = require("./_botCachePolicy");

function cronAuthorized(header, secret) {
  if (!secret) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(header || ""), h(`Bearer ${secret}`));
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "unauthorized" });
  const token = process.env.PRERENDER_TOKEN;
  if (!token) return res.status(500).json({ error: "PRERENDER_TOKEN not set" });
  const queries = clearQueries();
  if (!queries.length) return res.status(200).json({ skipped: "no live types" });
  const query = queries[new Date().getUTCHours() % queries.length];
  try {
    const status = await fetch(`https://api.prerender.io/cache-clear-status/${token}`);
    if (status.status === 403) return res.status(200).json({ skipped: "a clear is still running" });
    const r = await fetch("https://api.prerender.io/cache-clear", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prerenderToken: token, query }),
    });
    const detail = (await r.text()).slice(0, 200);
    if (!r.ok) {
      console.error("bot-render-clear: Prerender.io said", r.status, detail);
      return res.status(502).json({ error: "clear failed", status: r.status, detail });
    }
    return res.status(200).json({ cleared: query });
  } catch (e) {
    console.error("bot-render-clear failed:", e.message);
    return res.status(500).json({ error: "clear failed", detail: String(e.message || e).slice(0, 200) });
  }
};
