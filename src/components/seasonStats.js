// src/components/seasonStats.js
//
// One production number per position group from a CFBD stat line — a
// single game's box score (liveGames/{id}/box/players) or a cfbRosters
// row's season totals (s). Shared by the Video Suggester and CFB Universe's
// Suggested Adds.

const n = (v) => (v == null || v === "" ? 0 : Number(v) || 0);
// Box scores carry kicking as "made/att" strings; season totals as FGM/XPM.
const made = (v) => n(String(v || "").split("/")[0]);
const fmt = (v) => Math.round(v).toLocaleString();

// We-Draft position → stat group.
export function groupOf(pos) {
  const p = (pos || "").toUpperCase();
  if (p === "QB") return "qb";
  if (p === "RB" || p === "WR" || p === "TE") return "skill";
  if (p === "OL") return "ol";
  if (p === "K") return "k";
  if (p === "P") return "p";
  return "def";
}

// One production number per position group — works on a single game's box
// score and on season totals (same category/stat keys, apart from kicking).
export function production(group, s) {
  if (!s) return 0;
  const pass = s.passing || {}, rush = s.rushing || {}, rec = s.receiving || {};
  const def = s.defensive || {}, ints = s.interceptions || {}, k = s.kicking || {}, pnt = s.punting || {};
  switch (group) {
    case "qb": return n(pass.YDS) * 0.04 + n(pass.TD) * 4 - n(pass.INT) * 2 + n(rush.YDS) * 0.1 + n(rush.TD) * 6;
    case "skill": return n(rush.YDS) * 0.1 + n(rush.TD) * 6 + n(rec.REC) * 0.5 + n(rec.YDS) * 0.1 + n(rec.TD) * 6;
    case "def": return n(def.TOT) + n(def.TFL) * 2 + n(def.SACKS) * 3 + n(def.PD) * 1.5 + n(def["QB HUR"]) + n(ints.INT) * 5 + (n(def.TD) + n(ints.TD)) * 6;
    case "k": return (k.FGM != null ? n(k.FGM) : made(k.FG)) * 3 + (k.XPM != null ? n(k.XPM) : made(k.XP));
    case "p": return n(pnt.NO) * 0.5 + n(pnt["In 20"]) * 1.5;
    default: return 0;
  }
}

// "312 pass yds, 3 TD, 45 rush yds" — only the stats that are there.
export function statLine(group, s) {
  if (!s) return "";
  const pass = s.passing || {}, rush = s.rushing || {}, rec = s.receiving || {};
  const def = s.defensive || {}, ints = s.interceptions || {}, k = s.kicking || {};
  const parts = [];
  const add = (v, label) => { if (n(v) > 0) parts.push(`${fmt(n(v))} ${label}`); };
  if (group === "qb") {
    if (pass["C/ATT"]) parts.push(pass["C/ATT"]);
    add(pass.YDS, "pass yds"); add(pass.TD, "pass TD"); add(pass.INT, "INT"); add(rush.YDS, "rush yds"); add(rush.TD, "rush TD");
  } else if (group === "skill") {
    add(rush.YDS, "rush yds"); add(rush.TD, "rush TD"); add(rec.REC, "rec"); add(rec.YDS, "rec yds"); add(rec.TD, "rec TD");
  } else if (group === "def") {
    add(def.TOT, "tkl"); add(def.TFL, "TFL"); add(def.SACKS, n(def.SACKS) === 1 ? "sack" : "sacks"); add(def.PD, "PBU"); add(ints.INT, "INT"); add(n(def.TD) + n(ints.TD), "TD");
  } else if (group === "k") {
    if (k.FG) parts.push(`${k.FG} FG`); else add(k.FGM, "FG");
    if (k.LONG) parts.push(`long ${k.LONG}`);
  }
  return parts.join(", ");
}
