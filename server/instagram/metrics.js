// server/instagram/metrics.js
//
// Pure helpers for Instagram Analytics (sync.js): which metrics to ask Meta
// for, reading Meta's insights responses, Pacific days, and the numbers
// We-Draft works out itself. No I/O.
//
// Meta's numbers (stored under `meta`) are as Meta returns them. We-Draft's
// own (stored under `calc`, labelled "calculated" on screen):
//   engagement      likes + comments + saved + shares (Meta's per-post
//                   insights; like_count / comments_count when an insight
//                   is missing)
//   engagementRate  engagement ÷ reach — the post's unique accounts reached.
//                   One denominator everywhere, so posts compare fairly;
//                   null when reach is 0 or unknown.
//   followers       the account's follower count as seen at each sync
//                   (Meta gives the current count only; the history is ours)
//
// Days are Pacific (America/Los_Angeles): Meta's daily insights end at
// Pacific midnight (end_time 07:00/08:00 UTC).

const TZ = "America/Los_Angeles";

// Account metrics read per day (period=day, metric_type=total_value, one
// day's since/until). profile_views isn't in Meta's current list but still
// answers; when it stops, the day just won't have it.
const ACCOUNT_DAY_METRICS = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares", "replies", "profile_links_taps", "profile_views"];
// Per post, by media_product_type. Album (carousel child) and story metrics aren't read.
const MEDIA_METRICS = {
  FEED: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "profile_visits", "follows", "profile_activity"],
  REELS: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"],
};
const mediaMetrics = (m) => MEDIA_METRICS[m?.media_product_type === "REELS" ? "REELS" : "FEED"];

const DEMOGRAPHIC_BREAKDOWNS = { follower: ["age", "gender", "country", "city"], engaged: ["age", "gender", "country"] };

const parts = (ms) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
  .formatToParts(new Date(ms)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
// A moment → its Pacific day, "YYYY-MM-DD".
function pacificDay(ms) {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}
// A Pacific day → its midnight, in ms (DST-safe: noon UTC is the same Pacific day).
function pacificMidnight(day) {
  const [y, m, d] = day.split("-").map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  const p = parts(noon);
  return noon - ((Number(p.hour) % 24) * 3600e3 + Number(p.minute) * 60e3);
}
const addDays = (day, n) => { const t = new Date(`${day}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// Meta's end_time (the day's end) → the day it covers.
const dayOfEndTime = (endTime) => pacificDay(Date.parse(endTime) - 1000);

// An insights response → { metric: value } (numbers only; breakdowns → { key: value }).
function readInsights(resp) {
  const out = {};
  for (const d of resp?.data || []) {
    const tv = d.total_value;
    if (tv?.breakdowns?.length) {
      out[d.name] = Object.fromEntries((tv.breakdowns[0].results || []).map((r) => [(r.dimension_values || []).join("|"), r.value]));
    } else if (tv && typeof tv.value === "number") {
      out[d.name] = tv.value;
    } else if (Array.isArray(d.values) && d.values.length) {
      const v = d.values[d.values.length - 1].value;
      if (typeof v === "number") out[d.name] = v;
    }
  }
  return out;
}
// A time_series response → { day: value } for one metric.
function readSeries(resp, metric) {
  const d = (resp?.data || []).find((x) => x.name === metric);
  return Object.fromEntries((d?.values || []).filter((v) => typeof v.value === "number").map((v) => [dayOfEndTime(v.end_time), v.value]));
}
// A demographics breakdown → [{ key, value }], biggest first.
function readBreakdown(resp) {
  const d = resp?.data?.[0];
  return ((d?.total_value?.breakdowns?.[0]?.results) || []).map((r) => ({ key: (r.dimension_values || []).join("|"), value: r.value })).sort((a, b) => b.value - a.value);
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// We-Draft's per-post numbers from Meta's (see the top).
function postCalc(meta = {}, counts = {}) {
  const likes = num(meta.likes) ?? num(counts.likes) ?? 0;
  const comments = num(meta.comments) ?? num(counts.comments) ?? 0;
  const engagement = likes + comments + (num(meta.saved) ?? 0) + (num(meta.shares) ?? 0);
  const reach = num(meta.reach);
  return { engagement, engagementRate: reach ? engagement / reach : null };
}

// How often a post's insights are read again, by age: new posts move most.
function insightsDue(m, now) {
  const age = now - (Date.parse(m.timestamp) || 0);
  const last = m.metricsAt || 0;
  const every = age < 7 * 86400e3 ? 5.5 * 3600e3 : age < 60 * 86400e3 ? 20 * 3600e3 : 7 * 86400e3;
  return now - last >= every;
}

// A day's account numbers are final once fetched 3+ days after it ended
// (Meta can lag up to 48 hours); until then each sync reads it again.
const dayFinal = (day, fetchedAt) => !!fetchedAt && fetchedAt >= pacificMidnight(addDays(day, 1)) + 72 * 3600e3;

module.exports = {
  TZ, ACCOUNT_DAY_METRICS, MEDIA_METRICS, DEMOGRAPHIC_BREAKDOWNS, mediaMetrics, pacificDay, pacificMidnight, addDays, dayOfEndTime,
  readInsights, readSeries, readBreakdown, postCalc, insightsDue, dayFinal,
};
