// server/youtube-analytics/metrics.js
//
// Pure helpers for the YouTube Analytics integration (no I/O): parsing
// legacy video URLs, ISO-8601 durations, Pacific-time calendar days, the
// performance windows computed from daily rows, public-count snapshot
// deltas, Reporting API CSV parsing and the player rollup. Everything that
// decides a number shown in the admin lives here so it can be unit-tested
// (metrics.test.js).
//
// Two kinds of numbers, never mixed:
//   public   — YouTube Data API v3 statistics (viewCount, likeCount,
//              commentCount): lifetime totals as of the moment they're
//              fetched. Near-real-time. Differences between two snapshots
//              are an *approximation* of views in that interval.
//   analytics — YouTube Analytics / Reporting API data: per Pacific-time
//              calendar day, processed by YouTube, usually 1–3 days behind
//              and revised for a few days after. Never real-time, no hourly
//              granularity. "Last 7 days" means the 7 most recent *reported*
//              days, not the last 168 hours.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

// YouTube video ID from any URL form We-Draft has stored in videos.Video
// (youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /embed/ID, /live/ID),
// or a bare ID. null for anything else (e.g. a title pasted into the field).
function parseVideoId(input) {
  const s = String(input || "").trim();
  if (ID_RE.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v");
    if (!id) {
      const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
      id = m ? m[1] : null;
    }
  }
  // Tolerates junk typed after a complete ID (two legacy records end in
  // ".png"), but never a longer ID-like string.
  const m = /^([A-Za-z0-9_-]{11})(?:[^A-Za-z0-9_-]|$)/.exec(String(id || ""));
  return m ? m[1] : null;
}

// "PT1H2M3S" → 3723. "P0D" (upcoming live) → 0. null if unparseable.
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(iso || ""));
  if (!m) return null;
  const [, d, h, min, sec] = m.map((x) => Number(x) || 0);
  return Math.round(d * 86400 + h * 3600 + min * 60 + sec);
}

// YouTube Analytics days are Pacific-time calendar days.
function pacificDay(t = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(t)); // en-CA → YYYY-MM-DD
}
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { // b - a, in whole days
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400e3);
}
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// Analytics API report → array of row objects keyed by column name.
function rowsToObjects(report) {
  const cols = (report?.columnHeaders || []).map((c) => c.name);
  return (report?.rows || []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

// One Analytics API row → the stored daily/totals shape. Missing metrics
// stay null (never 0) so "not reported" and "zero" stay distinguishable.
const METRIC_MAP = {
  views: "views",
  estimatedMinutesWatched: "minutesWatched",
  averageViewDuration: "avgViewDurationSec",
  averageViewPercentage: "avgViewPct",
  subscribersGained: "subsGained",
  subscribersLost: "subsLost",
  likes: "likes",
  comments: "comments",
  shares: "shares",
};
const ANALYTICS_METRICS = Object.keys(METRIC_MAP).join(",");
function normalizeMetrics(row) {
  const out = {};
  for (const [api, key] of Object.entries(METRIC_MAP)) {
    const v = row[api];
    out[key] = v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  }
  return out;
}
// Additive metrics only — averages can't be summed.
const SUMMABLE = ["views", "minutesWatched", "subsGained", "subsLost", "likes", "comments", "shares", "impressions"];

// Sum daily rows ({ date, ...metrics }) whose date is in [from, to].
// Returns null when no row falls in the window at all; days without a row
// count as 0 (a backfilled range stores only days with activity).
function sumWindow(rows, from, to) {
  let any = false;
  const out = Object.fromEntries(SUMMABLE.map((k) => [k, 0]));
  let clicks = 0;
  for (const r of rows || []) {
    if (r.date < from || r.date > to) continue;
    any = true;
    for (const k of SUMMABLE) out[k] += Number(r[k]) || 0;
    if (r.impressions && r.impressionsCtr != null) clicks += r.impressions * r.impressionsCtr;
  }
  if (!any) return null;
  out.impressionsCtr = out.impressions ? clicks / out.impressions : null;
  out.avgViewDurationSec = out.views ? (out.minutesWatched * 60) / out.views : null;
  return { ...out, from, to };
}

// First-N-day performance from a video's daily rows. Day 1 is the Pacific
// calendar day it was published (so "first day" is between a few minutes
// and 24 hours of availability, depending on publish time — not an exact
// 24h window, which the API can't provide). A window is only reported once
// it's fully covered: published that long ago, data reported through its
// last day, and history fetched back to the publish day.
function firstDays(rows, publishDay, through, coveredFrom, n) {
  if (!isDay(publishDay) || !isDay(through)) return null;
  const end = addDays(publishDay, n - 1);
  if (end > through) return { complete: false, days: n };
  if (!coveredFrom || coveredFrom > publishDay) return { complete: false, days: n };
  const s = sumWindow(rows, publishDay, end) || { ...Object.fromEntries(SUMMABLE.map((k) => [k, 0])), from: publishDay, to: end };
  return { complete: true, days: n, views: s.views, minutesWatched: s.minutesWatched, subsGained: s.subsGained, subsLost: s.subsLost, from: publishDay, to: end };
}

// Growth between two equal windows: (cur - prev) / prev. null when prev is
// 0/unknown (growth from nothing isn't a rate).
function growthRate(cur, prev) {
  if (cur == null || prev == null || !prev) return null;
  return (cur - prev) / prev;
}

// ── Public-count snapshots ──
// A small bounded ring on the video doc ([{ t, v }], newest last) gives
// approximate views in the last 24h / 48h from public counts. The answer
// is null unless a snapshot exists within `toleranceH` of the target time —
// no interpolation, no guessing.
const RING_MAX = 24;
function pushRing(ring, t, v, max = RING_MAX) {
  const r = (ring || []).filter((x) => x && Number.isFinite(x.t) && Number.isFinite(x.v));
  if (r.length && r[r.length - 1].v === v && t - r[r.length - 1].t < 3600e3) return r; // nothing new
  return [...r, { t, v }].sort((a, b) => a.t - b.t).slice(-max);
}
function ringDelta(ring, hours, now, toleranceH = 4) {
  const r = ring || [];
  if (!r.length) return null;
  const latest = r[r.length - 1];
  const target = now - hours * 3600e3;
  let best = null;
  for (const x of r) {
    const off = Math.abs(x.t - target);
    if (off <= toleranceH * 3600e3 && (!best || off < Math.abs(best.t - target))) best = x;
  }
  if (!best || best === latest) return null;
  return { views: latest.v - best.v, fromAt: best.t, toAt: latest.t, hours: (latest.t - best.t) / 3600e3 };
}

// ── Reporting API CSV ──
// Minimal RFC-4180 parser (quoted fields, "" escapes). Returns row objects.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// channel_reach_basic_a1 rows → Map("videoId|YYYY-MM-DD" → { impressions,
// impressionsCtr }). Rows for the same video+day are combined (impressions
// summed, CTR impression-weighted) — that report has one row per video per
// day, but a defensive merge costs nothing.
function aggregateReach(csvRows) {
  const acc = new Map();
  for (const r of csvRows) {
    const vid = r.video_id, raw = r.date;
    if (!ID_RE.test(String(vid || "")) || !/^\d{8}$/.test(String(raw || ""))) continue;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const imp = Number(r.video_thumbnail_impressions);
    const ctr = Number(r.video_thumbnail_impressions_ctr);
    if (!Number.isFinite(imp)) continue;
    const k = `${vid}|${date}`;
    const a = acc.get(k) || { videoId: vid, date, impressions: 0, clicks: 0 };
    a.impressions += imp;
    if (Number.isFinite(ctr)) a.clicks += imp * ctr;
    acc.set(k, a);
  }
  for (const a of acc.values()) {
    a.impressionsCtr = a.impressions ? a.clicks / a.impressions : null;
    delete a.clicks;
  }
  return acc;
}

// ── Effective player associations ──
// A video linked to a legacy videos/{doc}: that doc's playerIds (the
// editorial record). Otherwise the admin-set ytVideos playerIds.
function effectivePlayerIds(yv, legacy) {
  if (yv.legacyDocId && legacy) return Array.isArray(legacy.playerIds) ? legacy.playerIds.filter(Boolean) : [];
  return Array.isArray(yv.playerIds) ? yv.playerIds.filter(Boolean) : [];
}

// Player rollup. Every number is a SUM of video-level numbers over that
// player's associated videos (each video counted once per player; a video
// tagged with 3 players counts fully toward each). subsGained is the sum of
// subscribers YouTube attributes to those videos — NOT unique subscribers.
function rollupPlayers(ytVideos, legacyById) {
  const by = new Map();
  for (const v of ytVideos) {
    if (v.review?.status === "ignored") continue;
    const ids = [...new Set(effectivePlayerIds(v, legacyById.get(v.legacyDocId)))];
    for (const pid of ids) {
      const p = by.get(pid) || { playerId: pid, videoCount: 0, publicViews: 0, analyticsViews: 0, views7d: 0, views28d: 0, subsGained: 0, subsLost: 0, minutesWatched: 0, videoIds: [], best: null, latestPublishedAt: null };
      p.videoCount++;
      p.videoIds.push(v.videoId);
      const pv = Number(v.stats?.views) || 0;
      p.publicViews += pv;
      p.analyticsViews += Number(v.analytics?.lifetime?.views) || 0;
      p.views7d += Number(v.analytics?.last7?.views) || 0;
      p.views28d += Number(v.analytics?.last28?.views) || 0;
      p.subsGained += Number(v.analytics?.lifetime?.subsGained) || 0;
      p.subsLost += Number(v.analytics?.lifetime?.subsLost) || 0;
      p.minutesWatched += Number(v.analytics?.lifetime?.minutesWatched) || 0;
      if (!p.best || pv > p.best.views) p.best = { videoId: v.videoId, title: v.yt?.title || null, views: pv };
      const pub = v.yt?.publishedAt || null;
      if (pub && (!p.latestPublishedAt || pub > p.latestPublishedAt)) p.latestPublishedAt = pub;
      by.set(pid, p);
    }
  }
  return by;
}

module.exports = {
  ID_RE, parseVideoId, parseDuration, pacificDay, addDays, daysBetween, isDay,
  rowsToObjects, normalizeMetrics, ANALYTICS_METRICS, SUMMABLE, sumWindow, firstDays, growthRate,
  RING_MAX, pushRing, ringDelta, parseCsv, aggregateReach, effectivePlayerIds, rollupPlayers,
};
