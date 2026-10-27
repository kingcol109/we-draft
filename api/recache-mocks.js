// api/recache-mocks.js
//
// Vercel Cron target (vercel.json): every Tuesday at 8am Eastern, asks
// Prerender.io to re-render the Weekly Mock pages — each team's page for
// every class (/mocks/{team}, /mocks/{team}/2028) and each class's full
// mock (/mocks/2027, /mocks/2028) — so crawlers and link previews get the
// new week rather than waiting on Prerender.io's own recache schedule.
//
// Vercel Cron runs on UTC, so it's scheduled at both 12:00 and 13:00 UTC
// on Tuesdays (8am EDT / 8am EST) and only the run that lands on 8am in
// New York sends anything. ?force=1 skips that check (a manual run).
//
// Our own stored copies of them (api/bot-render.js) are marked stale at the
// same time, so the next bot visit takes the fresh render.
//
// GET with Authorization: Bearer $CRON_SECRET. Needs PRERENDER_TOKEN (the
// same one middleware.js uses).

const crypto = require("crypto");

const SITE = "https://we-draft.com";
// Classes with a Weekly Mock (utils/weeklyMockNews.js WEEKLY_YEARS — the
// first is the main class, whose team pages have no year in the path).
const WEEKLY_YEARS = ["2027", "2028"];
const TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LV", "LAC", "LAR", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS",
];
const RUN_HOUR_ET = 8;

// Every Weekly Mock page (weeklyMockHref / weeklyYearHref).
function mockUrls() {
  const urls = WEEKLY_YEARS.map((y) => `${SITE}/mocks/${y}`);
  WEEKLY_YEARS.forEach((y, i) => TEAMS.forEach((t) => urls.push(`${SITE}/mocks/${t.toLowerCase()}${i === 0 ? "" : `/${y}`}`)));
  return urls;
}

function cronAuthorized(header, secret) {
  if (!secret) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(header || ""), h(`Bearer ${secret}`));
}

const easternHour = (d = new Date()) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(d));

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "unauthorized" });
  const force = String(req.query?.force || "") === "1";
  if (!force && easternHour() !== RUN_HOUR_ET) return res.status(200).json({ skipped: `not ${RUN_HOUR_ET}am Eastern` });
  if (!process.env.PRERENDER_TOKEN) return res.status(500).json({ error: "PRERENDER_TOKEN not set" });
  const urls = mockUrls();
  try {
    // Our own copies of them (api/bot-render.js) go stale too, so the next
    // bot visit picks up the new week.
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const db = getFirestore();
    const ours = await db.collection("prerenderCache").where("type", "==", "mocks").get();
    if (!ours.empty) {
      const batch = db.batch();
      ours.docs.forEach((d) => batch.update(d.ref, { stale: true }));
      await batch.commit();
    }
    const r = await fetch("https://api.prerender.io/recache", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prerenderToken: process.env.PRERENDER_TOKEN, urls }),
    });
    const detail = (await r.text()).slice(0, 300);
    if (!r.ok) {
      console.error("recache-mocks: Prerender.io said", r.status, detail);
      return res.status(502).json({ error: "recache failed", status: r.status, detail });
    }
    return res.status(200).json({ recached: urls.length });
  } catch (e) {
    console.error("recache-mocks failed:", e.message);
    return res.status(500).json({ error: "recache failed", detail: String(e.message || e).slice(0, 300) });
  }
};
