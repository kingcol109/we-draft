// src/utils/voice/draftRows.js
//
// compSnapshots/_draftHistory's row format — shared by the builder script
// (scripts/buildVoiceDraftHistory.mjs, Node) and /voice (utils/voice/draft.js).
// No imports, so Node can load it as-is.
//   one string per pick: "year|round|pick|name|position|school|NFL team"
export const SEP = "|";

// The latest class comes from draftOrder, which keeps the team's abbreviation.
const NFL_NAMES = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs", LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams", MIA: "Miami Dolphins", MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers", SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders", WSH: "Washington Commanders",
};

/** Drafted records (historical's shape) → the snapshot's rows, oldest first. */
export function draftRows(records) {
  return records
    .filter((r) => /^\d+$/.test(String(r.Round || "")) && Number(r.Round) >= 1 && Number(r.Round) <= 7 && r.Year)
    .map((r) => { const team = r["NFL Team"] || r.Team || ""; return [r.Year, r.Round, r.Pick || "", r.Player || `${r.First || ""} ${r.Last || ""}`.trim(), r.Position || "", r.School || "", NFL_NAMES[team] || team]; })
    .map((cols) => cols.map((v) => String(v).replace(/\|/g, "/")).join(SEP))
    .sort((a, b) => { const [ya, , pa] = a.split(SEP); const [yb, , pb] = b.split(SEP); return ya - yb || (Number(pa) || 999) - (Number(pb) || 999); });
}

/** The snapshot's rows → [{ year, round, pick, name, pos, school, team }] */
export const decodeDraft = (rows) => (rows || []).map((s) => {
  const [year, round, pick, name, pos, school, team] = s.split(SEP);
  return { year: Number(year), round: Number(round), pick: Number(pick) || null, name, pos, school, team };
});
