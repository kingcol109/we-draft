// src/utils/portalSim/factors.js
//
// The two school factors that come from history, each 0..1 (user,
// 2026-11-14 — players grade schools on tier, NIL, proximity, playing time,
// recent success and player development):
//   success  recent success — win % over the last seasons, recent ones
//            weighted more (teamRecords.json, scripts/buildPortalSimRecords.mjs)
//   dev      player development, per position — the school's NFL draft picks
//            at that position in recent drafts, earlier rounds and later
//            drafts weighted more (utils/draftSim/draftHistory.json,
//            scripts/buildDraftHistory.mjs), scaled to the best FBS school
//            at that position
// Pure — the loader (./data.js) and headless runs both use it.

const POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB", "K", "P"];
// Draft history's names for a few schools the pool spells differently.
const DRAFT_ALIASES = { FIU: "Florida International" };

// records: teamRecords.json; draft: draftHistory.json; schools: the pool's
// school names. → { [school]: { success, dev: { [pos]: 0..1 } } }
export function buildFactors(records, draft, schools, cfg) {
  const out = {};
  const want = new Set(schools);

  // Recent success: weighted win %, stretched across FBS (worst 0, best 1).
  const rw = cfg.successYearWeights; // newest first
  const pctOf = {};
  schools.forEach((s) => {
    const rows = [...(records?.teams?.[s] || [])].sort((a, b) => b[0] - a[0]);
    let num = 0;
    let den = 0;
    rows.slice(0, rw.length).forEach(([, w, l], i) => {
      if (w + l === 0) return;
      num += rw[i] * (w / (w + l));
      den += rw[i];
    });
    pctOf[s] = den ? num / den : null;
  });
  const known = Object.values(pctOf).filter((v) => v != null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  schools.forEach((s) => {
    out[s] = { success: pctOf[s] == null || hi === lo ? 0.5 : (pctOf[s] - lo) / (hi - lo), dev: {} };
  });

  // Player development: draft picks by school and position.
  const last = draft?.years?.[1] || 0;
  const raw = {};
  (draft?.picks || []).forEach(([year, round, , , pos, si]) => {
    if (year <= last - cfg.devDrafts || !POSITIONS.includes(pos)) return;
    const name = draft.schools[si];
    const school = DRAFT_ALIASES[name] || name;
    if (!want.has(school)) return;
    const roundW = round === 1 ? cfg.devRoundWeight[0] : round <= 3 ? cfg.devRoundWeight[1] : cfg.devRoundWeight[2];
    const recency = year > last - Math.ceil(cfg.devDrafts / 2) ? 1 : cfg.devOlderWeight;
    const r = (raw[school] = raw[school] || {});
    r[pos] = (r[pos] || 0) + roundW * recency;
  });
  POSITIONS.forEach((pos) => {
    const best = Math.max(0, ...schools.map((s) => raw[s]?.[pos] || 0));
    // Square root: the first few picks matter most.
    schools.forEach((s) => { out[s].dev[pos] = best ? Math.sqrt((raw[s]?.[pos] || 0) / best) : 0; });
  });
  return out;
}
