// src/utils/comparisonMeta.js
//
// Text for /comparison/:slug that's built only from what the page actually
// has: the prospect record and the comps findComps() returned (see
// utils/historicalStats.js). Nothing here scores or re-ranks anything — it
// just describes the model's own output, so a missing value is left out
// rather than guessed.
const TARGET_LENGTH = 160;

/**
 * Title / on-page heading / meta description.
 * @param {object} p
 * @param {string} [p.name]      prospect "First Last"; empty = the blank calculator
 * @param {string} [p.school]
 * @param {string} [p.position]
 * @param {string[]} [p.compNames] closest comps in the order shown (only once results exist)
 */
export function buildComparisonMeta({ name = "", school = "", position = "", compNames = [] } = {}) {
  name = name.trim();
  if (!name) {
    const heading = "NFL Player Comparisons and Measurements";
    return {
      heading,
      title: `${heading} | We-Draft`,
      description: "Compare college football prospects to historical NFL Draft picks using physical measurements, athletic testing, and playing traits.",
    };
  }
  const heading = `${name} NFL Player Comparisons and Measurements`;
  const identity = [school.trim(), position.trim()].filter(Boolean).join(" ");
  const base = `Compare ${name}${identity ? `, ${identity},` : ""} to historical NFL Draft picks using physical measurements, athletic testing, and playing traits.`;
  // With comps to name, a tighter lead leaves room for them — the names are
  // the most specific (and most searched) thing this page has.
  const compsLead = `${name}${identity ? ` (${identity})` : ""} NFL player comparisons based on measurements, athletic testing and traits.`;
  const comps = compNames.map((c) => (c || "").trim()).filter(Boolean);
  let description = base;
  for (let n = Math.min(3, comps.length); n > 0; n--) {
    const list = n === 1 ? comps[0] : `${comps.slice(0, n - 1).join(", ")} and ${comps[n - 1]}`;
    const candidate = `${compsLead} Closest historical ${n === 1 ? "match" : "matches"}: ${list}.`;
    if (candidate.length <= TARGET_LENGTH) { description = candidate; break; }
  }
  return { heading, title: `${heading} | We-Draft`, description };
}

/**
 * Per-comp "why" lines for the explanation section: the measurements where
 * the comp is closest to the prospect (smallest standardized gap the model
 * itself computed — findComps' breakdown) and the traits they share.
 * @param {object[]} comps   findComps results (record, values, breakdown, traits, similarity, select?)
 * @param {object}   prospectValues  submitted.values
 * @param {object[]} metrics STAT_METRICS entries ({ key, label })
 * @param {(m, v) => string} format  value formatter
 */
export function describeComps(comps, prospectValues, metrics, format, { maxMetrics = 3 } = {}) {
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
  return comps.map((r) => {
    const closest = Object.entries(r.breakdown || {})
      .filter(([key, z]) => byKey[key] && Number.isFinite(z) && r.values?.[key] != null && prospectValues?.[key] != null)
      .sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))
      .slice(0, maxMetrics)
      .map(([key]) => ({ label: byKey[key].label, comp: format(byKey[key], r.values[key]), prospect: format(byKey[key], prospectValues[key]) }));
    return {
      record: r.record,
      select: !!r.select,
      similarity: r.select ? null : Math.round(r.similarity),
      closest,
      sharedStrengths: r.traits?.sharedStrengths || [],
      sharedWeaknesses: r.traits?.sharedWeaknesses || [],
    };
  });
}
