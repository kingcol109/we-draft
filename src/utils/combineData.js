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
// plus, through 2026, every invite drafted or not: combineInvites/{year}
// (the nflverse Combine file — mergeCombineInvites below).
// Past years are precomputed into compSnapshots by the site snapshot build
// (snapshotBuilders.js → buildCombineSnapshotDocs):
//   _combine_{year}  { version, year, rows: [CombineRow] }
//   _combineIndex    { version, years: { [year]: { players, forty, undrafted } },
//                      averages: { [pos]: { [metric]: { avg, n } } },
//                      profiles, performers (combineProfiles) }
// CombineRow = { id, name, position, school, slug, round, pick, team,
//                undrafted?: true, results: { [metric]: number } }
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

// The Combine hub's position profiles (/events/combine/{pos}) → { profiles,
// performers }. profiles: per position, per metric — { avg, n,
// top: [10 best ever: { name, school, slug, id, year, round, pick, team, undrafted?, value }] }.
// "Best" is the fastest time, else the biggest number (tallest, longest arms…).
// performers: per position, the best all-around testers — each player's
// percentile (among his position) in every drill he ran and every
// measurement taken (height, weight, arms, hands: bigger is better), averaged
// — each counts once; at least PERFORMER_MIN_DRILLS drills to qualify, not
// counting bench (it still counts in the score).
// [{ ...player, score, drills: { [k]: { value, pct } }, build: { [k]: { value, pct } } }]
// byYear: { [year]: [CombineRow] }.
const PROFILE_TOP = 10;
const PERFORMER_DRILLS = ["forty", "vertical", "broad", "bench", "threeCone", "shuttle"];
const PERFORMER_MIN_DRILLS = 3;
const BUILD_KEYS = ["height", "weight", "arm", "hand"];
const PERFORMERS = 5;
// Records stay clean of typos in the source data: known-bad numbers ("Name|year"
// → the metrics, or "*" for a whole wrong row), plus anything more than
// OUTLIER_SD standard deviations off its position's mean (Daniel Faalele's
// real 384 lbs is 6.2 — the line sits above it).
const OUTLIER_SD = 7;
const BAD_RESULTS = {
  "Will Anderson Jr.|2023": ["weight"], // 353 (he weighed 253)
  "Jimmy Morrissey|2021": ["height"], // 5'3"
  "Eric Johnson|2022": "*", // 215 lbs, 4.16 forty — another player's numbers
  "Lonnie Johnson Jr.|2019": "*", // 281 lbs, 5.12 forty — another player's numbers
};
const isBad = (r, year, k) => { const b = BAD_RESULTS[`${r.name}|${year}`]; return b === "*" || (Array.isArray(b) && b.includes(k)); };
export function combineProfiles(byYear) {
  const acc = {};
  Object.entries(byYear).forEach(([year, rows]) => (rows || []).forEach((r) => {
    if (!r.position) return;
    Object.entries(r.results || {}).forEach(([k, v]) => {
      if (!Number.isFinite(v) || isBad(r, year, k)) return;
      ((acc[r.position] = acc[r.position] || {})[k] = acc[r.position][k] || []).push({ r, year: Number(year), v });
    });
  }));
  const round = (x) => Math.round(x * 1000) / 1000;
  const out = {};
  const performers = {};
  Object.entries(acc).forEach(([pos, metrics]) => {
    out[pos] = {};
    const byPlayer = new Map(); // row → { year, drills, build }
    Object.entries(metrics).forEach(([k, all]) => {
      const mean = all.reduce((t, x) => t + x.v, 0) / all.length;
      const sd = Math.sqrt(all.reduce((t, x) => t + (x.v - mean) ** 2, 0) / all.length);
      const list = all.length >= 10 && sd > 0 ? all.filter((x) => Math.abs(x.v - mean) <= OUTLIER_SD * sd) : all;
      const low = !!METRIC[k]?.lowerIsBetter;
      const best = [...list].sort((a, b) => (low ? a.v - b.v : b.v - a.v) || a.year - b.year);
      const n = best.length;
      out[pos][k] = {
        avg: round(list.reduce((t, x) => t + x.v, 0) / n), n,
        top: best.slice(0, PROFILE_TOP).map(({ r, year, v }) => ({ ...who(r, year), value: v })),
      };
      // Percentile in this drill (or measurement — bigger is better): the
      // share of the position he beat, ties half.
      const isBuild = BUILD_KEYS.includes(k);
      if ((!PERFORMER_DRILLS.includes(k) && !isBuild) || n < 10) return;
      const vals = list.map((x) => x.v);
      list.forEach(({ r, year, v }) => {
        const worse = vals.filter((x) => (low ? x > v : x < v)).length;
        const ties = vals.filter((x) => x === v).length - 1;
        const pct = Math.round(((worse + ties / 2) / (n - 1)) * 1000) / 10;
        if (!byPlayer.has(r)) byPlayer.set(r, { year, drills: {}, build: {} });
        byPlayer.get(r)[isBuild ? "build" : "drills"][k] = { value: v, pct };
      });
    });
    performers[pos] = [...byPlayer.entries()]
      .map(([r, { year, drills, build }]) => {
        // The score: every drill and measurement he has, each counted once.
        const pcts = [...Object.values(drills), ...Object.values(build)].map((d) => d.pct);
        return { ...who(r, year), drills, build, score: Math.round((pcts.reduce((t, x) => t + x, 0) / pcts.length) * 10) / 10 };
      })
      // The minimum counts running and jumping drills — bench doesn't qualify him.
      .filter((x) => Object.keys(x.drills).filter((k) => k !== "bench").length >= PERFORMER_MIN_DRILLS)
      .sort((a, b) => b.score - a.score || Object.keys(b.drills).length - Object.keys(a.drills).length)
      .slice(0, PERFORMERS);
  });
  return { profiles: out, performers };
}
// ── One player's card, for the search on a position page ──
// combinePools(byYear) → { [pos]: { [metric]: values[] } }: what the
// profiles rank against (known-bad numbers and far outliers out, as above).
// combineCardFor(pools, row) → { drills, build: { [k]: { value, pct } },
// score (null when he ran fewer than PERFORMER_MIN_DRILLS, bench aside) } —
// his percentiles and Combine score the way performers get theirs.
export function combinePools(byYear) {
  const acc = {};
  Object.entries(byYear).forEach(([year, rows]) => (rows || []).forEach((r) => {
    if (!r.position) return;
    Object.entries(r.results || {}).forEach(([k, v]) => {
      if (!Number.isFinite(v) || isBad(r, year, k)) return;
      ((acc[r.position] = acc[r.position] || {})[k] = acc[r.position][k] || []).push(v);
    });
  }));
  Object.values(acc).forEach((metrics) => Object.keys(metrics).forEach((k) => {
    const all = metrics[k];
    const mean = all.reduce((t, v) => t + v, 0) / all.length;
    const sd = Math.sqrt(all.reduce((t, v) => t + (v - mean) ** 2, 0) / all.length);
    metrics[k] = all.length >= 10 && sd > 0 ? all.filter((v) => Math.abs(v - mean) <= OUTLIER_SD * sd) : all;
  }));
  return acc;
}
export function combineCardFor(pools, row, year) {
  const pool = pools[row.position] || {};
  const drills = {};
  const build = {};
  Object.entries(row.results || {}).forEach(([k, v]) => {
    const isBuild = BUILD_KEYS.includes(k);
    if (!Number.isFinite(v) || (!isBuild && !PERFORMER_DRILLS.includes(k)) || isBad(row, year, k)) return;
    const vals = pool[k] || [];
    let pct = null;
    if (vals.length >= 10) {
      const low = !!METRIC[k]?.lowerIsBetter;
      const worse = vals.filter((x) => (low ? x > v : x < v)).length;
      const ties = Math.max(0, vals.filter((x) => x === v).length - 1);
      pct = Math.min(100, Math.round(((worse + ties / 2) / (vals.length - 1)) * 1000) / 10);
    }
    (isBuild ? build : drills)[k] = { value: v, pct };
  });
  const pcts = [...Object.values(drills), ...Object.values(build)].map((x) => x.pct).filter((x) => x != null);
  const qualifies = Object.keys(drills).filter((k) => k !== "bench").length >= PERFORMER_MIN_DRILLS && pcts.length;
  return { drills, build, score: qualifies ? Math.round((pcts.reduce((t, x) => t + x, 0) / pcts.length) * 10) / 10 : null };
}
const who = (r, year) => ({
  name: r.name, school: r.school || "", slug: r.slug || "", id: r.id || "", year,
  round: r.round || null, pick: r.pick || null, team: r.team || "", ...(r.undrafted ? { undrafted: true } : {}),
});

// ── Every Combine invite, drafted or not (combineInvites/{year}) ──
// The nflverse Combine file (scripts/importCombineInvites.mjs) — every
// player invited since 2000, with height, weight and the six drills (no arm
// or hand). Merged into each year's drafted rows by mergeCombineInvites:
//   matched (same year, same name, else same last name + build) → our row
//     stays (its school, position, slug, arms and hands); a drill we don't
//     have, or one on BAD_RESULTS, is filled from the invite
//   unmatched → a new row: undrafted (or drafted, for years we don't have),
//     its school renamed to ours where a matched player shows how, its
//     position mapped to our groups
// InviteRow = { name, pos, school, pfr, round, pick, team,
//               height, weight, forty, bench, vertical, broad, threeCone, shuttle }
// nflverse's 2021 list carries 166 extra rows with no Pro Football Reference
// id, some of them junk (a 5'6", 195-lb lineman) — that year, such a row only
// fills in a player we already have.
const ID_ONLY_YEARS = [2021];
const INVITE_KEYS = ["height", "weight", "forty", "bench", "vertical", "broad", "threeCone", "shuttle"];
const SUFFIX = /\b(jr|sr|ii|iii|iv|v)\b/g;
export const normName = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[.'’`-]/g, "").replace(SUFFIX, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const lastName = (s) => normName(s).split(" ").pop();
// nflverse's positions → ours. 3-4 outside linebackers and big ends are
// split by weight, the way our historical rows file them.
function invitePosition(pos, weight) {
  const p = String(pos || "").toUpperCase();
  if (["OT", "OG", "C", "G", "T", "OL"].includes(p)) return "OL";
  if (["DT", "NT", "DL"].includes(p)) return "DL";
  if (p === "DE") return weight >= 285 ? "DL" : "EDGE";
  if (p === "EDGE") return "EDGE";
  if (p === "OLB") return weight >= 240 ? "EDGE" : "LB";
  if (["ILB", "LB", "MLB"].includes(p)) return "LB";
  if (["CB", "S", "SAF", "FS", "SS", "DB", "CB/WR"].includes(p)) return "DB";
  if (p === "FB") return "RB";
  return p;
}

export function mergeCombineInvites(byYear, invites) {
  const out = {};
  const unmatched = []; // [year, invite]
  const schoolVotes = {}; // their school → { our school: n }
  const years = new Set([...Object.keys(byYear), ...Object.keys(invites || {})]);
  years.forEach((year) => {
    const ours = (byYear[year] || []).map((r) => ({ ...r, results: { ...r.results } }));
    const byName = new Map();
    ours.forEach((r) => { const k = normName(r.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); });
    const used = new Set();
    (invites?.[year] || []).forEach((inv) => {
      let match = (byName.get(normName(inv.name)) || []).find((r) => !used.has(r));
      if (!match) {
        // Same last name and the same build (a nickname, a middle name…).
        const ln = lastName(inv.name);
        match = ours.find((r) => !used.has(r) && lastName(r.name) === ln
          && (inv.weight == null || r.results.weight == null || Math.abs(inv.weight - r.results.weight) <= 4)
          && (inv.height == null || r.results.height == null || Math.abs(inv.height - r.results.height) <= 1));
      }
      if (!match) { if (inv.pfr || !ID_ONLY_YEARS.includes(Number(year))) unmatched.push([year, inv]); return; }
      used.add(match);
      INVITE_KEYS.forEach((k) => {
        if (inv[k] == null) return;
        if (match.results[k] == null || isBad(match, year, k)) match.results[k] = inv[k];
      });
      if (inv.school && match.school) {
        const v = (schoolVotes[inv.school] = schoolVotes[inv.school] || {});
        v[match.school] = (v[match.school] || 0) + 1;
      }
    });
    out[year] = ours;
  });
  const schoolName = Object.fromEntries(Object.entries(schoolVotes)
    .map(([theirs, v]) => [theirs, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));
  unmatched.forEach(([year, inv]) => {
    const results = {};
    INVITE_KEYS.forEach((k) => { if (inv[k] != null) results[k] = inv[k]; });
    if (!TESTED_KEYS.some((k) => k in results)) return;
    out[year].push({
      id: `inv-${inv.pfr || normName(inv.name).replace(/ /g, "-")}-${year}`,
      name: inv.name, position: invitePosition(inv.pos, inv.weight), school: schoolName[inv.school] || inv.school || "", slug: "",
      round: inv.round || null, pick: inv.pick || null, team: inv.team || "",
      ...(inv.round ? {} : { undrafted: true }),
      results,
    });
  });
  // A year left empty (no rows of ours and no tested invites) isn't a year.
  Object.keys(out).forEach((y) => { if (!out[y].length) delete out[y]; });
  return out;
}

// ── School names → ours (schools docs' School), so every row gets its logo ──
// nflverse and some of our own rows spell schools their way ("FIU",
// "Arkansas St.", "La-Monroe", "West. Illinois", "Southern Mississippi").
// Matched on School and CFBDName (normalized: "&" → "and", "St." → State,
// "West." → Western, punctuation out), the aliases below, and Short — but
// Short only for an all-caps abbreviation ("FIU", "NDSU"), since short
// names collide ("NSU", "UK").
const SCHOOL_ALIASES = {
  fiu: "florida international", "southern mississippi": "southern miss", citadel: "the citadel",
  "tennessee martin": "ut martin", "texas a and m commerce": "east texas a and m", "prairie view": "prairie view a and m",
  "southeast missouri": "southeast missouri state", "mcneese state": "mcneese", "nicholls state": "nicholls",
  "california davis": "uc davis", "la monroe": "louisiana monroe", "middle tennessee state": "middle tennessee",
  "university of arkansas at pine bluff": "arkansas pine bluff", "ark pine bluff": "arkansas pine bluff",
  "northwestern state la": "northwestern state", "monmouth nj": "monmouth",
};
const schoolKey = (s) => String(s || "").toLowerCase().replace(/&/g, " and ")
  .replace(/\bwest\./g, "western ").replace(/\btenn\./g, "tennessee ").replace(/\bst\.(?=\s|$|\))/g, "state ")
  .replace(/[().,'’–—-]/g, " ").replace(/\bst\b/g, "state").replace(/\s+/g, " ").trim();
export function schoolResolver(schools = []) {
  const byKey = new Map();
  const byShort = new Map();
  schools.forEach((sc) => {
    if (!sc?.School) return;
    [sc.School, sc.CFBDName].filter(Boolean).forEach((n) => { const k = schoolKey(n); if (!byKey.has(k)) byKey.set(k, sc.School); });
    if (sc.Short && !byShort.has(String(sc.Short).toUpperCase())) byShort.set(String(sc.Short).toUpperCase(), sc.School);
  });
  const names = new Set(schools.map((sc) => sc?.School).filter(Boolean));
  const memo = new Map();
  return (name) => {
    if (!name || names.has(name)) return name;
    if (memo.has(name)) return memo.get(name);
    // (No dropping a "(PA)": Indiana (PA) is IUP, not Indiana.)
    const k = schoolKey(name);
    const hit = [k, SCHOOL_ALIASES[k]].filter(Boolean).map((x) => byKey.get(x)).find(Boolean)
      || (/^[A-Z&]{2,6}$/.test(name) ? byShort.get(name) : null) || name;
    memo.set(name, hit);
    return hit;
  };
}

// The snapshot docs: one per year with data, and the all-time index.
// latestPicks: { [player Slug]: { round, pick, team } } — the latest draft's
// picks (draftOrder); with it, the latest class's other players are undrafted.
// schools: the schools docs — every row's school is renamed to ours (schoolResolver).
export function buildCombineSnapshotDocs({ historical = [], players = [], invites = null, latestPicks = null, schools = null, latestDraftYear, version }) {
  let byYear = {};
  const add = (year, row) => { if (row) (byYear[year] = byYear[year] || []).push(row); };
  historical.forEach((r) => {
    if (String(r.Year) === String(latestDraftYear)) return; // the latest class comes from players
    add(String(r.Year), combineRowFrom(r, r.id || r.sheetKey || ""));
  });
  players.filter((p) => String(p.Eligible) === String(latestDraftYear)).forEach((p) => {
    const row = combineRowFrom(p, p.id);
    if (!row || !latestPicks) return add(String(latestDraftYear), row);
    const pk = latestPicks[p.Slug];
    add(String(latestDraftYear), pk ? { ...row, round: pk.round, pick: pk.pick, team: pk.team } : { ...row, undrafted: true });
  });
  if (invites && Object.keys(invites).length) byYear = mergeCombineInvites(byYear, invites);
  if (schools?.length) {
    const ours = schoolResolver(schools);
    Object.values(byYear).forEach((rows) => rows.forEach((r) => { r.school = ours(r.school); }));
  }
  const docs = [];
  const years = {};
  Object.entries(byYear).forEach(([year, rows]) => {
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    years[year] = { players: rows.length, forty: rows.filter((r) => r.results.forty != null).length, undrafted: rows.filter((r) => r.undrafted).length };
    docs.push({ id: `_combine_${year}`, data: { version, year: Number(year), rows } });
  });
  docs.push({ id: "_combineIndex", data: { version, years, averages: combineAverages(Object.values(byYear).flat()), ...combineProfiles(byYear) } });
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
