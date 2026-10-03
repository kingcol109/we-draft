// src/utils/historicalStats.js
//
// Position-by-position distributions (mean / standard deviation /
// quantiles) of the `historical` collection's combine measurements —
// the baseline everything comparative is meant to reference: percentiles
// on player pages, the ±1 SD height window for historical comps, and the
// z-scores the comp tool itself will be built on. Pure functions only (no
// Firestore) so the same math runs in AdminPanel.js's Historical > Stats
// tab today and anywhere else later, on whatever set of records the caller
// already has.
//
// Only drafted players count (Round 1-7 — some rows carry a suffix from
// the source sheet like "4*", hence parseInt rather than an exact match),
// and every position is its own population — never pooled.
//
// min/max here are the same generous plausibility bounds AdminPanel.js's
// HISTORICAL_COMBINE_FIELDS flags against: a value outside them is a data
// error (e.g. the "4.56 inch Hand Size" outliers), not a real measurement,
// and a single one of those would badly skew a position's SD — so they're
// excluded from the stats and counted separately instead.

export const STAT_METRICS = [
  { key: "height", dataKeys: ["Height"], label: "Height", unit: "in", min: 60, max: 90, format: "height" },
  { key: "weight", dataKeys: ["Weight"], label: "Weight", unit: "lbs", min: 140, max: 400, decimals: 0 },
  { key: "arm", dataKeys: ["Arm Length"], label: "Arm Length", unit: "in", min: 26, max: 38, format: "inches" },
  { key: "hand", dataKeys: ["Hand Size"], label: "Hand Size", unit: "in", min: 7.5, max: 11.5, format: "inches" },
  // "40 Yard " (trailing space) is how the historical sheet import stored
  // it; players docs use "40 Yard" — both accepted so this also works on
  // current prospects later.
  { key: "forty", dataKeys: ["40 Yard ", "40 Yard"], label: "40 Yard", unit: "s", min: 4.0, max: 6.0, lowerIsBetter: true, decimals: 2 },
  // suffix: shown after the number wherever it's displayed (36" / 36.5") —
  // trailing .0 dropped, since verticals are whole or half inches.
  { key: "vertical", dataKeys: ["Vertical"], label: "Vertical", unit: "in", min: 18, max: 48, suffix: '"' },
  { key: "broad", dataKeys: ["Broad"], label: "Broad Jump", unit: "in", min: 80, max: 140, format: "feetInches" },
  { key: "bench", dataKeys: ["Bench"], label: "Bench", unit: "reps", min: 0, max: 50, decimals: 0 },
  { key: "threeCone", dataKeys: ["3-Cone"], label: "3-Cone", unit: "s", min: 6.0, max: 9.0, lowerIsBetter: true, decimals: 2 },
  { key: "shuttle", dataKeys: ["Shuttle"], label: "Shuttle", unit: "s", min: 3.7, max: 5.5, lowerIsBetter: true, decimals: 2 },
];

export function draftRound(record) {
  const n = parseInt(record.Round, 10);
  return n >= 1 && n <= 7 ? n : null;
}

export function isDrafted(record) {
  return draftRound(record) != null;
}

// Plain number, feet'inches text ("6'2.5"", "5'11"", "6'2 3/8"") -> total
// inches, or inches + fraction ("33 1/8"") — historical stores Height as
// decimal inches, players docs store it as that feet'inches string, and
// the comp calculator lets these be typed either way.
export function toNumber(raw) {
  const str = String(raw).trim().replace(/"$/, "").trim();
  const frac = (f) => { const [n, d] = f.split("/").map(Number); return d ? n / d : NaN; };
  const fi = /^(\d+)'\s*(\d+(?:\.\d+)?)?(?:\s+(\d+\/\d+))?$/.exec(str);
  if (fi) return Number(fi[1]) * 12 + (fi[2] ? Number(fi[2]) : 0) + (fi[3] ? frac(fi[3]) : 0);
  const wf = /^(\d+(?:\.\d+)?)\s+(\d+\/\d+)$/.exec(str);
  if (wf) return Number(wf[1]) + frac(wf[2]);
  return Number(str);
}

// Numeric value of one metric on a record, or null if missing, non-
// numeric, or outside plausibility bounds. { value, invalid } so callers
// can tell "not measured" apart from "measured but bad data".
export function readMetric(record, metric) {
  let raw = null;
  for (const k of metric.dataKeys) {
    if (record[k] != null && record[k] !== "") { raw = record[k]; break; }
  }
  if (raw == null) return { value: null, invalid: false };
  const num = toNumber(raw);
  if (!Number.isFinite(num) || num < metric.min || num > metric.max) return { value: null, invalid: true };
  return { value: num, invalid: false };
}

// Linear-interpolated quantile of an already-sorted array.
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarize(values) {
  const n = values.length;
  if (!n) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  // Sample SD (n - 1) — these are a sample of all drafted players at the
  // position, not the whole population. Undefined for a single value.
  const sd = n > 1 ? Math.sqrt(sorted.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : null;
  return {
    n, mean, sd, sorted,
    min: sorted[0], max: sorted[n - 1],
    p10: quantile(sorted, 0.1), p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9),
  };
}

// Percentile (0-100) of one value within a metric summary's distribution
// (summarize's `sorted`): the share of values below it, ties counted half
// — so the median lands on 50. lowerIsBetter metrics (40/3-cone/shuttle)
// are flipped, so a faster time is a higher percentile. null when there's
// nothing to compare against.
export function percentileOf(value, summary, lowerIsBetter = false) {
  const sorted = summary?.sorted;
  if (value == null || !sorted?.length) return null;
  let below = 0;
  let equal = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
    else break;
  }
  const pct = ((below + equal / 2) / sorted.length) * 100;
  return lowerIsBetter ? 100 - pct : pct;
}

// { [Position]: { players, metrics: { [metricKey]: summary + invalid } } }
// over drafted records only. opts.fromYear / opts.toYear (inclusive)
// optionally narrow it to a range of draft classes.
export function computePositionStats(records, { fromYear, toYear } = {}) {
  const byPos = {};
  records.forEach((r) => {
    if (!isDrafted(r) || !r.Position) return;
    const year = Number(r.Year);
    if (fromYear && year < Number(fromYear)) return;
    if (toYear && year > Number(toYear)) return;
    const bucket = byPos[r.Position] || (byPos[r.Position] = { players: 0, values: {}, invalid: {} });
    bucket.players += 1;
    STAT_METRICS.forEach((m) => {
      const { value, invalid } = readMetric(r, m);
      if (value != null) (bucket.values[m.key] || (bucket.values[m.key] = [])).push(value);
      else if (invalid) bucket.invalid[m.key] = (bucket.invalid[m.key] || 0) + 1;
    });
  });

  const out = {};
  Object.entries(byPos).forEach(([pos, b]) => {
    const metrics = {};
    STAT_METRICS.forEach((m) => {
      metrics[m.key] = { ...summarize(b.values[m.key] || []), invalid: b.invalid[m.key] || 0 };
    });
    out[pos] = { players: b.players, metrics };
  });
  return out;
}

// A player's community Strengths/Weaknesses from their evaluations —
// same rule as PlayerProfile.js's community section: count every mention,
// a trait tagged both ways goes to whichever side has more (ties go to
// Strengths), top 5 each by count. This is how the latest class gets
// traits to be compared on, since it has no admin retro grade yet.
// counts: { [trait]: mentions on the side it landed on } for the returned
// traits — findComps' input.traitCounts, so a near-unanimous strength
// outweighs one only a few evaluators tagged.
export function communityTraits(evaluations) {
  const sC = {};
  const wC = {};
  evaluations.forEach((e) => {
    if (Array.isArray(e.strengths)) e.strengths.forEach((t) => { sC[t] = (sC[t] || 0) + 1; });
    if (Array.isArray(e.weaknesses)) e.weaknesses.forEach((t) => { wC[t] = (wC[t] || 0) + 1; });
  });
  const top = (entries) => entries.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
  const strengths = top(Object.entries(sC).filter(([t, c]) => c >= (wC[t] ?? -Infinity)));
  const weaknesses = top(Object.entries(wC).filter(([t, c]) => c > (sC[t] ?? -Infinity)));
  const counts = {};
  strengths.forEach((t) => { counts[t] = sC[t]; });
  weaknesses.forEach((t) => { counts[t] = wC[t]; });
  return { strengths, weaknesses, counts };
}

// The most recent class isn't in `historical` yet — those players still
// live in `players`, with their Round/Pick/Team on draftOrder (Selection ==
// Slug, same cross-reference HighSchoolTeamPage.js/TeamPage.js use). This
// reshapes each one that was actually picked into a historical-style row
// so computePositionStats treats both sources identically. A player with
// no draftOrder entry wasn't drafted and is left out.
export function draftedPlayersAsHistorical(players, draftOrder, year) {
  const pickBySlug = {};
  draftOrder.forEach((d) => { if (d.Selection) pickBySlug[d.Selection] = d; });
  return players
    .filter((p) => pickBySlug[p.Slug])
    .map((p) => {
      const pick = pickBySlug[p.Slug];
      return { ...p, Year: String(year), Round: String(pick.Round), Pick: String(pick.Pick), "NFL Team": pick.Team };
    });
}

// ── Historical comps ──
//
// input: { position, values: { [metricKey]: number } } — whatever subset
// of STAT_METRICS was entered. pool: drafted records (historical + latest
// class). stats: computePositionStats(pool) — SDs are what put inches,
// pounds, and seconds on one scale.
//
// Distance is the weighted root-mean-square of per-metric z-differences
// ((input - candidate) / position SD) across every *entered* metric. A
// metric the candidate was never measured on counts as MISSING_Z SDs off
// instead of being skipped — otherwise a candidate sharing only height and
// weight could "match" perfectly and outrank one that's close on eight
// measurements. Similarity = 100 * exp(-d^2 / 2): identical = 100, an
// average miss of 1 SD per metric ~ 61.
//
// Height window (opts.heightWindowSd, default 0.5): candidates more than that
// many position SDs from the entered height are excluded outright — and so
// are candidates with no height at all, since the window can't be checked.
// Pass null to turn it off. Outliers are handled loosely: for the filter
// only, any height (entry or candidate) beyond HEIGHT_CLAMP_SD position SDs
// from the mean is treated as exactly that far out — so an unusually tall
// or short prospect still gets comps, matched against the tallest/shortest
// players on record instead of an empty window. Scoring still uses the
// real heights, so the actual gap still counts against the match.
//
// Strengths/Weaknesses (input.strengths / input.weaknesses — trait names
// from the same traits/{Position} + traits/Generic lists the historical
// records' own Strengths/Weaknesses were picked from) fold in as one extra
// pseudo-metric weighted opts.traitWeight (default TRAIT_WEIGHT, 0 = off).
// The score is absolute, not relative to how many traits were entered:
// score = (min(shared strengths, T) + min(shared weaknesses, T) - conflicts)
//         / 2T, clamped to [0, 1], T = TRAIT_MATCH_TARGET (3)
// where a conflict is one side's strength being the other's weakness —
// each trait weighted by how often the community tagged it when
// input.traitCounts is given (see traitWeights; the formula above is the
// all-weights-1 case). So a
// perfect trait score takes 3 shared strengths AND 3 shared weaknesses —
// entering only 1 strength can never score better than 1/6 on traits, and
// a 100% match overall means same measurements + 3 and 3 shared. That maps
// onto the same z scale as the measurements (full = 0 SD, none =
// TRAIT_MAX_Z SD) so it blends without a separate formula.
// While traits are on, they always count, even when none were entered for
// this search: no traits entered scores the same as zero shared traits
// (TRAIT_MAX_Z), so every candidate takes that on the trait term. It
// doesn't change the ranking, but a measurements-only search can never
// read as a 100% match — and entering traits can only ever raise a score,
// never lower it below leaving them blank. Set traitWeight 0 to match on measurements
// alone. A candidate with no traits recorded also gets MISSING_Z (only
// reachable with requireTraits off, below).
//
// Candidate pool (opts.requireTraits, default true): only players with
// both Strengths and Weaknesses entered — i.e. ones that have actually
// been graded — are eligible comps, whether or not traits were entered for
// this search. stats (the SDs) should still come from every drafted
// player, not just this graded subset.
//
// Day-one/two draft boost (opts.subjectRound, 1-7 or null): when the
// prospect is a 1st-3rd rounder (drafted, or projected by community grade),
// candidates also drafted in rounds 1-3 have their distance shrunk a little
// — more if it's the very same round — so comps lean toward similarly
// drafted players. Small on purpose: it reorders close calls, it doesn't
// lift a poor physical match over a good one. No effect otherwise.
export const MISSING_Z = 1;
export const HEIGHT_CLAMP_SD = 2;
export const TRAIT_WEIGHT = 2;
export const TRAIT_MAX_Z = 2;
export const TRAIT_MATCH_TARGET = 3;
export const EARLY_ROUND_MAX = 3;
export const EARLY_ROUND_BOOST = 0.93; // candidate also went rounds 1-3
export const SAME_ROUND_BOOST = 0.87; // ...and in the prospect's own round

function roundBoost(subjectRound, record) {
  if (!(subjectRound >= 1 && subjectRound <= EARLY_ROUND_MAX)) return 1;
  const r = draftRound(record);
  if (r == null || r > EARLY_ROUND_MAX) return 1;
  return r === subjectRound ? SAME_ROUND_BOOST : EARLY_ROUND_BOOST;
}

function hasTraitList(v) {
  return Array.isArray(v) && v.length > 0;
}

export function isGraded(record) {
  return hasTraitList(record.Strengths) && hasTraitList(record.Weaknesses);
}

// Per-trait weight from how often the community tagged it
// (input.traitCounts, see communityTraits): mentions relative to the
// side's most-mentioned trait, floored at TRAIT_MIN_REL_WEIGHT. So a
// prospect whose top strength is on nearly every eval and whose others are
// scattered matches mostly on that top one — a comp sharing only the minor
// ones scores well below one sharing the headline trait. Traits with no
// count (typed in by hand, or no counts passed at all) weigh 1, which is
// the old unweighted behavior.
export const TRAIT_MIN_REL_WEIGHT = 0.2;

function traitWeights(list, counts) {
  const max = counts ? Math.max(0, ...list.map((t) => counts[t] || 0)) : 0;
  const w = {};
  list.forEach((t) => {
    w[t] = max > 0 && counts[t] != null ? Math.max(TRAIT_MIN_REL_WEIGHT, counts[t] / max) : 1;
  });
  return w;
}

// One side's weighted overlap: shared weight (best T shared) over the
// weight of the input's top T traits, padded with 1s when fewer than T were
// entered — keeps the score absolute (see findComps: 1 strength entered
// still can't reach a full match).
function sideScore(list, shared, w) {
  const T = TRAIT_MATCH_TARGET;
  const desc = (a, b) => b - a;
  const top = list.map((t) => w[t]).sort(desc).slice(0, T);
  const denom = top.reduce((a, x) => a + x, 0) + Math.max(0, T - top.length);
  const num = shared.map((t) => w[t]).sort(desc).slice(0, T).reduce((a, x) => a + x, 0);
  return { num, denom };
}

function traitMatch(input, record) {
  const cS = Array.isArray(record.Strengths) ? record.Strengths : [];
  const cW = Array.isArray(record.Weaknesses) ? record.Weaknesses : [];
  if (!cS.length && !cW.length) return null;
  const sharedStrengths = input.strengths.filter((t) => cS.includes(t));
  const sharedWeaknesses = input.weaknesses.filter((t) => cW.includes(t));
  const conflicts = [...input.strengths.filter((t) => cW.includes(t)), ...input.weaknesses.filter((t) => cS.includes(t))];
  const w = { ...traitWeights(input.strengths, input.traitCounts), ...traitWeights(input.weaknesses, input.traitCounts) };
  const s = sideScore(input.strengths, sharedStrengths, w);
  const k = sideScore(input.weaknesses, sharedWeaknesses, w);
  const conflictWeight = conflicts.reduce((a, t) => a + w[t], 0);
  const score = Math.max(0, Math.min(1, (s.num + k.num - conflictWeight) / (s.denom + k.denom)));
  return { score, sharedStrengths, sharedWeaknesses, conflicts, strengths: cS, weaknesses: cW };
}

export function findComps(input, pool, stats, opts = {}) {
  // allowSelectOnly: records flagged SelectOnly (graded only so they can be
  // hand-picked as a We-Draft.com Select) never surface as model comps —
  // only the Select scoring path passes this.
  const { heightWindowSd = 0.5, weights = {}, traitWeight = TRAIT_WEIGHT, requireTraits = true, limit = 25, subjectRound = null, allowSelectOnly = false } = opts;
  const posStats = stats[input.position];
  if (!posStats) return [];
  const values = input.values || {};
  const traitInput = { strengths: input.strengths || [], weaknesses: input.weaknesses || [], traitCounts: input.traitCounts || null };
  const traitPicks = traitInput.strengths.length + traitInput.weaknesses.length;
  const useTraits = traitWeight > 0;
  const entered = STAT_METRICS.filter((m) => values[m.key] != null && posStats.metrics[m.key]?.sd);
  if (!entered.length && !(useTraits && traitPicks)) return [];
  const totalWeight = entered.reduce((a, m) => a + (weights[m.key] ?? 1), 0) + (useTraits ? traitWeight : 0);
  const heightSd = posStats.metrics.height?.sd;
  const heightMean = posStats.metrics.height?.mean;
  const clampHeight = (h) => Math.min(heightMean + HEIGHT_CLAMP_SD * heightSd, Math.max(heightMean - HEIGHT_CLAMP_SD * heightSd, h));

  const results = [];
  pool.forEach((r) => {
    if (r.Position !== input.position || !isDrafted(r)) return;
    if (requireTraits && !isGraded(r)) return;
    if (r.SelectOnly === true && !allowSelectOnly) return;
    const vals = {};
    STAT_METRICS.forEach((m) => { vals[m.key] = readMetric(r, m).value; });

    if (heightWindowSd != null && values.height != null && heightSd) {
      if (vals.height == null || Math.abs(clampHeight(vals.height) - clampHeight(values.height)) > heightWindowSd * heightSd) return;
    }

    let sumSq = 0;
    let shared = 0;
    const breakdown = {};
    entered.forEach((m) => {
      const w = weights[m.key] ?? 1;
      if (vals[m.key] == null) { sumSq += w * MISSING_Z ** 2; return; }
      const z = (values[m.key] - vals[m.key]) / posStats.metrics[m.key].sd;
      sumSq += w * z ** 2;
      shared += 1;
      breakdown[m.key] = z;
    });
    let traits = null;
    if (useTraits && !traitPicks) {
      sumSq += traitWeight * TRAIT_MAX_Z ** 2;
    } else if (useTraits) {
      traits = traitMatch(traitInput, r);
      const z = traits ? TRAIT_MAX_Z * (1 - traits.score) : MISSING_Z;
      sumSq += traitWeight * z ** 2;
      if (traits) shared += 1;
    }
    if (!shared) return;
    const distance = Math.sqrt(sumSq / totalWeight) * roundBoost(subjectRound, r);
    results.push({
      record: r, values: vals, breakdown, traits, shared, entered: entered.length + (useTraits ? 1 : 0),
      distance, similarity: 100 * Math.exp(-(distance ** 2) / 2),
    });
  });

  return results.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

// ── Comparison snapshots ──
//
// The public comparison page reads one precomputed doc per position
// (compSnapshots/{Position}) instead of querying `historical` + the latest
// class + their evaluations on every visit. Built on demand from the admin
// Historical tab (see AdminPanel.js's CompSnapshotRebuild).
//
// Each doc holds EVERY drafted player at the position, not just graded
// ones: SDs, percentiles, and the height-window clamp all need the full
// population, and storing raw values (not finished stats) lets the page
// recompute them for any class cutoff (a 2026 prospect -> 2025 and
// earlier) exactly as it does from live data. Compact row shape to stay
// well under Firestore's 1 MiB doc limit:
//   { y: Year, r: Round, m: [value | null per STAT_METRICS, in order] }
// plus, for graded players only (the only ones that can surface as comps),
//   { F, L } or { P } (name), sc: School, pk: Pick, t: NFL Team,
//   S: Strengths, W: Weaknesses, sl: player-page Slug (latest-class rows
//   only — they still live in `players`; historical rows have no page),
//   x: 1 when the record is Extended, dx: 1 when Double Extended (see
//   recommendedCompWindow), so: 1 when SelectOnly (see findComps)
// Values are stored post-readMetric, so out-of-bounds data is already null.
// v2 added `x`/`dx` — a v1 doc has neither flag, so the page falls back to
// live reads until the snapshots are rebuilt.
export const COMP_SNAPSHOT_VERSION = 2;

export function encodeCompSnapshotRows(records) {
  return records.filter(isDrafted).map((r) => {
    const row = {
      y: Number(r.Year) || null,
      r: draftRound(r),
      m: STAT_METRICS.map((m) => readMetric(r, m).value),
    };
    if (isGraded(r)) {
      if (r.First || r.Last) { row.F = r.First || ""; row.L = r.Last || ""; } else row.P = r.Player || "";
      row.sc = r.School || "";
      row.pk = r.Pick ? String(r.Pick) : "";
      row.t = r["NFL Team"] || "";
      row.S = r.Strengths;
      row.W = r.Weaknesses;
      if (r.Slug) row.sl = r.Slug;
      if (r.Extended === true) row.x = 1;
      if (r.DoubleExtended === true) row.dx = 1;
      if (r.SelectOnly === true) row.so = 1;
    }
    return row;
  });
}

// Back to historical-record shape, so findComps / computePositionStats /
// the page's result cards take snapshot rows unchanged. Synthetic id per
// row (React keys only).
export function decodeCompSnapshotRows(rows, position) {
  return (rows || []).map((row, i) => {
    const rec = { id: `snap-${position}-${i}`, Position: position, Year: String(row.y ?? ""), Round: String(row.r ?? "") };
    STAT_METRICS.forEach((m, mi) => { const v = row.m?.[mi]; if (v != null) rec[m.dataKeys[0]] = v; });
    if (row.S) {
      if (row.P != null) rec.Player = row.P; else { rec.First = row.F || ""; rec.Last = row.L || ""; }
      rec.School = row.sc || "";
      rec.Pick = row.pk || "";
      rec["NFL Team"] = row.t || "";
      rec.Strengths = row.S;
      rec.Weaknesses = row.W || [];
      if (row.sl) rec.Slug = row.sl;
      if (row.x) rec.Extended = true;
      if (row.dx) rec.DoubleExtended = true;
      if (row.so) rec.SelectOnly = true;
    }
    return rec;
  });
}

// ── We-Draft Recommended comp window ──
//
// A prospect pulls every player from the COMP_CORE_CLASSES drafted classes
// right before their own, plus — reaching back COMP_EXTENDED_CLASSES more —
// only players marked Extended (historical/{id}.Extended, set per record in
// the admin Historical list). "Before their own" is capped at the latest
// drafted class in the pool, so every undrafted class (2027, 2028, 2029)
// shares the same window until the next draft lands; a custom entry
// (beforeYear null) uses that same latest-class window.
//
// Double Extended (historical/{id}.DoubleExtended) adds high-profile
// players from *before* that 15-class window, with no year limit — but only
// for a prospect graded/drafted in round 1 or 2 (doubleExtendedFor). Inside
// the 15 classes it changes nothing: a Double Extended player there is
// treated exactly by the rules above (so flagging a recent player now just
// readies them for when they age out of the window).
export const COMP_CORE_CLASSES = 10;
export const COMP_EXTENDED_CLASSES = 5;
export const DOUBLE_EXTENDED_MAX_ROUND = 2;
export function doubleExtendedFor(subjectRound) {
  return subjectRound >= 1 && subjectRound <= DOUBLE_EXTENDED_MAX_ROUND;
}
export function recommendedCompWindow(pool, beforeYear) {
  const years = (pool || []).map((r) => Number(r.Year)).filter((y) => y && (beforeYear == null || y < beforeYear));
  if (!years.length) return null;
  const to = Math.max(...years);
  const coreFrom = to - COMP_CORE_CLASSES + 1;
  return { to, coreFrom, extFrom: coreFrom - COMP_EXTENDED_CLASSES };
}
export function inRecommendedWindow(r, win, { allowDoubleExtended = false } = {}) {
  const y = Number(r.Year);
  if (!win || !y || y > win.to) return false;
  if (y >= win.coreFrom) return true;
  if (y >= win.extFrom) return r.Extended === true;
  return allowDoubleExtended && r.DoubleExtended === true;
}

// ── Compact percentile tables ──
//
// Everything percentileOf needs, without the raw population: each distinct
// value with how many players had it. Combine numbers repeat heavily
// (heights in eighths, whole-pound weights, 40s to the hundredth), so a
// position's full distribution for a metric is a few hundred numbers
// instead of ~1,400 — small enough to ship to every player page in one
// tiny doc (compSnapshots/pct_{Position}, see utils/snapshotBuilders.js).
// percentileFromTable returns exactly what percentileOf would on the same
// population (share below, ties counted half, lowerIsBetter flipped).
export function encodePercentileTable(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  const v = [...counts.keys()].sort((a, b) => a - b);
  return { v, c: v.map((x) => counts.get(x)) };
}

export function percentileFromTable(value, table, lowerIsBetter = false) {
  if (value == null || !table?.v?.length) return null;
  let below = 0;
  let equal = 0;
  let total = 0;
  table.v.forEach((x, i) => {
    const c = table.c[i];
    total += c;
    if (x < value) below += c;
    else if (x === value) equal += c;
  });
  const pct = ((below + equal / 2) / total) * 100;
  return lowerIsBetter ? 100 - pct : pct;
}

// Every drafted player's valid values per metric for one position ->
// { [metricKey]: table }.
export function positionPercentileTables(records) {
  const out = {};
  STAT_METRICS.forEach((m) => {
    const values = records.filter(isDrafted).map((r) => readMetric(r, m).value).filter((x) => x != null);
    if (values.length) out[m.key] = encodePercentileTable(values);
  });
  return out;
}
