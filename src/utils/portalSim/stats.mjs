// src/utils/portalSim/stats.mjs
//
// Last season's CFBD stats for the Portal Sim's Stats view (pages/
// PortalSim.jsx), packed small for the pool (server/portalSim/pool.js
// writes them, ./pool.js reads them): one comma-joined string of the fields
// below, blank where he has none. No imports — the pool builder loads it.

// [key, CFBD category, CFBD stat].
export const STAT_FIELDS = [
  ["passAtt", "passing", "ATT"], ["passCmp", "passing", "COMPLETIONS"], ["passYds", "passing", "YDS"], ["passTd", "passing", "TD"], ["passInt", "passing", "INT"], ["passPct", "passing", "PCT"], ["passYpa", "passing", "YPA"],
  ["rushCar", "rushing", "CAR"], ["rushYds", "rushing", "YDS"], ["rushTd", "rushing", "TD"], ["rushYpc", "rushing", "YPC"],
  ["rec", "receiving", "REC"], ["recYds", "receiving", "YDS"], ["recTd", "receiving", "TD"], ["recYpr", "receiving", "YPR"],
  ["tkl", "defensive", "TOT"], ["solo", "defensive", "SOLO"], ["tfl", "defensive", "TFL"], ["sacks", "defensive", "SACKS"], ["hur", "defensive", "QB HUR"], ["pd", "defensive", "PD"],
  ["int", "interceptions", "INT"],
  ["fgm", "kicking", "FGM"], ["fga", "kicking", "FGA"], ["fgPct", "kicking", "PCT"], ["fgLong", "kicking", "LONG"], ["xpm", "kicking", "XPM"], ["xpa", "kicking", "XPA"],
  ["punts", "punting", "NO"], ["puntYpp", "punting", "YPP"], ["puntIn20", "punting", "In 20"], ["puntLong", "punting", "LONG"],
];

// CFBD season totals (cfbRosters players[].s) → the packed string ("" for none).
export function packStats(s) {
  if (!s) return "";
  const vals = STAT_FIELDS.map(([, c, k]) => {
    const v = s[c]?.[k];
    return v == null || v === "" || !Number.isFinite(Number(v)) ? "" : String(Number(v));
  });
  return vals.some((v) => v !== "") ? vals.join(",") : "";
}

// The packed string → { [key]: number } (missing keys absent), or null.
export function unpackStats(str) {
  if (!str) return null;
  const parts = String(str).split(",");
  const out = {};
  STAT_FIELDS.forEach(([key], i) => { if (parts[i] !== undefined && parts[i] !== "") out[key] = Number(parts[i]); });
  return out;
}
