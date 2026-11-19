// src/utils/combineData.js
//
// Combine results for every year we have, for the Combine pages
// (pages/EventPage.jsx: /events/combine — the all-time hub — and
// /events/combine/{year}).
//
// Where each year comes from:
//   2000 – 2025   historical (drafted players; "40 Yard " etc. on the doc)
//   2026          players with Eligible 2026 (the latest drafted class)
//   2027 on       events/{year}.combine — entered in Admin → Events
// Past years are precomputed into compSnapshots by the site snapshot build
// (snapshotBuilders.js → buildCombineSnapshotDocs):
//   _combine_{year}  { version, year, rows: [CombineRow] }
//   _combineIndex    { version, years: { [year]: { players, forty } },
//                      averages: { [pos]: { [metric]: { avg, n } } } }
// CombineRow = { id, name, position, school, slug, round, pick, team,
//                results: { [metric]: number } }
// Pure — no Firebase (the snapshot script imports it under Node).
import { STAT_METRICS, readMetric } from "./historicalStats.js";

export const COMBINE_FIRST_YEAR = 2000;
// The first year whose Combine lives in events/{year} (Admin → Events).
export const COMBINE_EVENT_YEAR = 2027;
export const COMBINE_KEYS = ["height", "weight", "arm", "hand", "forty", "vertical", "broad", "bench", "threeCone", "shuttle"];
// A row counts as a Combine row when it has any of these (height and weight
// alone are on most player docs anyway).
const TESTED_KEYS = ["arm", "hand", "forty", "vertical", "broad", "bench", "threeCone", "shuttle"];
const METRIC = Object.fromEntries(STAT_METRICS.map((m) => [m.key, m]));

// Every Combine year, newest first (through the current event year).
export const combineYears = (through = COMBINE_EVENT_YEAR) => {
  const out = [];
  for (let y = through; y >= COMBINE_FIRST_YEAR; y--) out.push(y);
  return out;
};

// A historical / players record → a CombineRow, or null with no Combine numbers.
export function combineRowFrom(rec, id = "") {
  const results = {};
  COMBINE_KEYS.forEach((k) => {
    const { value } = readMetric(rec, METRIC[k]);
    if (value != null) results[k] = Math.round(value * 1000) / 1000;
  });
  if (!TESTED_KEYS.some((k) => k in results)) return null;
  const name = rec.Player || `${rec.First || ""} ${rec.Last || ""}`.trim();
  return {
    id: id || rec.id || `${name}-${rec.School || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name, position: rec.Position || "", school: rec.School || "", slug: rec.Slug || "",
    round: rec.Round ? Number(rec.Round) || null : null, pick: rec.Pick ? Number(rec.Pick) || null : null, team: rec["NFL Team"] || "",
    results,
  };
}

// Per position: each metric's average and how many it's from.
export function combineAverages(rows) {
  const acc = {};
  rows.forEach((r) => {
    if (!r.position) return;
    const pos = (acc[r.position] = acc[r.position] || {});
    Object.entries(r.results || {}).forEach(([k, v]) => {
      if (!Number.isFinite(v)) return;
      const m = (pos[k] = pos[k] || { sum: 0, n: 0 });
      m.sum += v; m.n += 1;
    });
  });
  return Object.fromEntries(Object.entries(acc).map(([pos, ms]) => [pos, Object.fromEntries(Object.entries(ms)
    .map(([k, { sum, n }]) => [k, { avg: Math.round((sum / n) * 1000) / 1000, n }]))]));
}

// The snapshot docs: one per year with data, and the all-time index.
export function buildCombineSnapshotDocs({ historical = [], players = [], latestDraftYear, version }) {
  const byYear = {};
  const add = (year, row) => { if (row) (byYear[year] = byYear[year] || []).push(row); };
  historical.forEach((r) => {
    if (String(r.Year) === String(latestDraftYear)) return; // the latest class comes from players
    add(String(r.Year), combineRowFrom(r, r.id || r.sheetKey || ""));
  });
  players.filter((p) => String(p.Eligible) === String(latestDraftYear)).forEach((p) => add(String(latestDraftYear), combineRowFrom(p, p.id)));
  const docs = [];
  const years = {};
  Object.entries(byYear).forEach(([year, rows]) => {
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    years[year] = { players: rows.length, forty: rows.filter((r) => r.results.forty != null).length };
    docs.push({ id: `_combine_${year}`, data: { version, year: Number(year), rows } });
  });
  docs.push({ id: "_combineIndex", data: { version, years, averages: combineAverages(Object.values(byYear).flat()) } });
  return docs;
}

// ── Display ──
const EIGHTHS = ["", "1/8", "1/4", "3/8", "1/2", "5/8", "3/4", "7/8"];
const inchesText = (v) => {
  const whole = Math.floor(v + 1e-6);
  const e = Math.round((v - whole) * 8);
  return e === 8 ? `${whole + 1}` : `${whole}${e ? ` ${EIGHTHS[e]}` : ""}`;
};
// A result as it's usually written: 4.42 · 6'2 3/8" · 32 1/2" · 38.5" · 10'4" · 24.
export function formatCombine(key, value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  const v = Number(value);
  switch (key) {
    case "height": return `${Math.floor(v / 12)}'${inchesText(v % 12)}"`;
    case "broad": { const t = Math.round(v); return `${Math.floor(t / 12)}'${t % 12}"`; }
    case "arm": case "hand": return `${inchesText(v)}"`;
    case "vertical": return `${Number.isInteger(v) ? v : v.toFixed(1)}"`;
    case "forty": case "threeCone": case "shuttle": return v.toFixed(2);
    default: return String(Math.round(v));
  }
}
