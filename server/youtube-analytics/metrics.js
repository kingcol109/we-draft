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

// ── Per-video reach totals (ytVideos.reach) ──
// { impressions, clicks, ctr, firstDay, lastDay, days: { YYYY-MM-DD: [impressions, clicks] } }
// clicks = impressions × CTR (views that came from a thumbnail impression).
// Setting a day REPLACES that day's earlier numbers in the totals (a
// re-issued Reporting API day), never adds to them. `days` keeps the most
// recent REACH_KEEP_DAYS — longer than YouTube keeps reports (≤60 days), so
// a replaced day is always still in the map.
//
// `after` ({ cutoff, impressions, clicks }) is set when a YouTube Studio
// export through `cutoff` has been imported (studio.js): it sums only the
// API days AFTER the cutoff, so Studio's total + `after` covers each day
// exactly once.
const REACH_KEEP_DAYS = 90;
function emptyReach(cutoff = null) {
  return { impressions: 0, clicks: 0, ctr: null, firstDay: null, lastDay: null, days: {}, after: cutoff ? { cutoff, impressions: 0, clicks: 0 } : null };
}
function applyReachDay(reach, date, impressions, ctr) {
  const r = reach && reach.days ? { ...reach, days: { ...reach.days }, after: reach.after ? { ...reach.after } : null } : emptyReach();
  const [oldI, oldC] = r.days[date] || [0, 0];
  const imp = Number(impressions) || 0;
  const clicks = imp * (Number(ctr) || 0);
  r.impressions += imp - oldI;
  r.clicks += clicks - oldC;
  if (r.after && date > r.after.cutoff) {
    r.after.impressions += imp - oldI;
    r.after.clicks += clicks - oldC;
  }
  r.days[date] = [imp, clicks];
  if (imp > 0) {
    if (!r.firstDay || date < r.firstDay) r.firstDay = date;
    if (!r.lastDay || date > r.lastDay) r.lastDay = date;
  }
  const keep = Object.keys(r.days).sort().slice(-REACH_KEEP_DAYS);
  r.days = Object.fromEntries(keep.map((d) => [d, r.days[d]]));
  r.ctr = r.impressions > 0 ? r.clicks / r.impressions : null;
  return r;
}
// Impressions / CTR over [from, to] from the kept days. null if no day in range.
function reachWindow(reach, from, to) {
  let any = false, impressions = 0, clicks = 0;
  for (const [d, [i, c]] of Object.entries(reach?.days || {})) {
    if (d < from || d > to) continue;
    any = true; impressions += i; clicks += c;
  }
  return any ? { impressions, clicks, ctr: impressions ? clicks / impressions : null } : null;
}

// Sets (or clears, cutoff = null) the Studio cutoff on a reach object,
// summing the API days after it from the kept days. null when an API day
// after the cutoff has already aged out of `days` (can't be summed exactly).
function withStudioCutoff(reach, cutoff) {
  const r = reach && reach.days ? { ...reach, days: { ...reach.days } } : emptyReach();
  if (!cutoff) return { ...r, after: null };
  const kept = Object.keys(r.days).sort();
  if (r.firstDay && r.firstDay <= cutoff && kept.length && kept[0] > addDays(cutoff, 1)) return null;
  let impressions = 0, clicks = 0;
  for (const [d, [i, c]] of Object.entries(r.days)) if (d > cutoff) { impressions += i; clicks += c; }
  return { ...r, after: { cutoff, impressions, clicks } };
}

// ── YouTube Studio export ("Table data.csv" from Analytics → Advanced
// mode, grouped by Content) ──
// Columns are found by name — the video ID column ("Content" / "Video"),
// "Impressions" and "Impressions click-through rate (%)" — so other columns
// and their order don't matter. The "Total" row and rows without a video ID
// are skipped. CTR is a percentage in the export (4.5 = 4.5%).
function parseStudioTable(text) {
  const rows = parseCsv(String(text || "").replace(/^﻿/, ""));
  if (!rows.length) return { error: "The file is empty or isn't a CSV." };
  const headers = Object.keys(rows[0]);
  const find = (re, not) => headers.find((h) => re.test(h.trim()) && !(not && not.test(h)));
  const idCol = find(/^(content|video|video id)$/i);
  const impCol = find(/^impressions$/i);
  const ctrCol = find(/click-?through rate/i);
  const titleCol = find(/^video title$/i);
  const missing = [!idCol && "Content (video ID)", !impCol && "Impressions", !ctrCol && "Impressions click-through rate (%)"].filter(Boolean);
  if (missing.length) return { error: `Missing column(s): ${missing.join(", ")}. In Studio's Advanced mode, show the Content table with the Impressions and Impressions click-through rate metrics, export it, and upload "Table data.csv" from the download.`, headers };
  const num = (s) => {
    const t = String(s ?? "").replace(/[,%\s]/g, "");
    if (!t) return null; // blank cell = unknown, not 0
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const out = new Map();
  let skipped = 0;
  for (const r of rows) {
    const id = String(r[idCol] || "").trim();
    if (!ID_RE.test(id)) { skipped++; continue; }
    const impressions = num(r[impCol]);
    const pct = num(r[ctrCol]);
    if (impressions == null || impressions < 0 || (pct != null && (pct < 0 || pct > 100))) { skipped++; continue; }
    const ctr = pct == null ? null : pct / 100;
    out.set(id, { videoId: id, title: titleCol ? r[titleCol] || null : null, impressions, ctr, clicks: ctr == null ? 0 : impressions * ctr });
  }
  return { rows: [...out.values()], skipped, columns: { id: idCol, impressions: impCol, ctr: ctrCol } };
}

// Lifetime impressions/CTR for a video: the Studio import (through its
// cutoff) plus API days after it; either alone if that's all there is.
function combinedReach(reach, studio) {
  const api = reach && reach.impressions > 0 ? reach : null;
  if (!studio) return api ? { impressions: api.impressions, clicks: api.clicks, ctr: api.ctr, from: api.firstDay, to: api.lastDay, sources: ["api"] } : null;
  const after = reach?.after && reach.after.cutoff === studio.to ? reach.after : null;
  const impressions = studio.impressions + (after?.impressions || 0);
  const clicks = studio.clicks + (after?.clicks || 0);
  return {
    impressions, clicks, ctr: impressions ? clicks / impressions : null,
    from: studio.from || null, to: after?.impressions && reach.lastDay > studio.to ? reach.lastDay : studio.to,
    sources: after?.impressions ? ["studio", "api"] : ["studio"],
  };
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
  REACH_KEEP_DAYS, emptyReach, applyReachDay, reachWindow, withStudioCutoff, parseStudioTable, combinedReach,
};
