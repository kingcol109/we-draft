// src/components/AdminResearch.js
//
// Admin → Research: NFL teams position group by position group, from PFF's
// depth charts (pffNflRosters/{abbr}, written weekly by
// scripts/syncPffNflRosters.js). PFF data is back office only — this panel
// is the only place it's shown, never the public site.
//
//   League  32 teams × position groups: each cell is the group's
//           snap-weighted PFF grade (colored on PFF's scale, with its rank
//           among the 32) and its snap-weighted age. Sort by any column;
//           click a cell to open that team at that group.
//   Team    one card per group — the group's grade, rank, age and how many
//           of its starters are 30+, then every player by snaps: alignment,
//           age, years in the league, grade + league rank at the position,
//           snap share and injury status.
//
//   Units   32 teams × PFF's team unit grades (offense, passing, rushing,
//           blocking, defense, pass rush, coverage…) with record, points and
//           EPA/play; click a team for its Team view.
//
// The Team view opens with the team's unit report (Offense / Defense /
// Special Teams: unit grades, team stats with PFF's league ranks), and each
// player row expands to his standard stats (GROUP_STATS) for his position.
//
// Both views can also show specific grades (SUBS — pass block, run block,
// pass rush, coverage…): the League view's Grade picker re-colors and
// re-ranks the whole matrix on one of them (columns it doesn't apply to dim
// out), and every Team card shows the ones that matter for its group, for
// the group and for each player.
//
// Players who took snaps for a team this season but aren't on its depth
// chart now (injured, released, traded — off: true) show at the bottom of
// their group, muted and tagged, so snap shares add up; group grades, ages
// and starters describe the current depth chart only.
//
// "Snap-weighted" means each player counts in proportion to his snaps, so a
// starter moves the number and a backup who barely plays doesn't. Before
// anyone has snaps (preseason) the depth-chart starters count equally.
//
// Each Team card also carries the team's need label for the group (OL: OT
// and IOL, as the Draft Sim splits them) — the same labels as Admin → Mock
// Draft → Team Needs (nflTeamNeeds, saved through AdminTeamNeeds.jsx
// writeTeamNeeds the moment one's clicked), with Suggest Need working one
// out from these depth charts and the team's ESPN injury list
// (utils/teamNeedSuggestions.js — which goes by the player tags below
// where they're set). And its depth chart notes (Notes — utils/depthNotes.js):
// a note on the group and the traits it wants (kept with the team), and
// for each player a talent tag, a development tag, Strengths / Weaknesses
// (the college trait lists) and a note of his own (kept with the player,
// by his PFF id — they follow him to a new team), with his roles (engine
// ROLES — Slot WR, Nose Tackle…). Each role then gets a card of its own
// under the position groups (RoleCard): the team's players with that role
// — in an order of the admin's own (Set Order, like Set Starters; its
// first is the one who plays the role) — and the role's need label,
// Suggest Need and all. Set Starters slides
// players into the group's starting slots (the team's depth order — the
// cards' starters and the need suggestions go by it; Reset goes back to
// PFF's snaps).
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { sanitizeUrl } from "./MarginAds";
import { Chip, LABEL_COLOR, byUrgency, applied, writeTeamNeeds } from "./AdminTeamNeeds";
import { NEED_LABELS, NEED_KEY_NAMES, ROLES, ROLE_BY_KEY, rolesForGroup, resolveNeeds } from "../utils/draftSim/engine";
import { suggestNeeds, suggestionReason } from "../utils/teamNeedSuggestions";
import { fetchEspnRoster } from "../utils/nflRoster";
import {
  TALENT_TAGS, DEV_TAGS, MAX_TRAITS, talentTag, devTag, loadTeamNotes, loadPlayerTags, loadTraits, traitsFor,
  saveGroupNote, saveGroupWants, saveGroupOrder, saveRoleOrder, savePlayerTags, cleanPlayerTags,
} from "../utils/depthNotes";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Specific grades — same keys as scripts/syncPffNflRosters.js SUBS (each
// player's x: { [key]: [grade, snaps, rank, of] }, rank among NFL players at
// his PFF position).
const SUBS = {
  pass: { label: "Passing", short: "PASS" },
  run: { label: "Rushing", short: "RUSH" },
  route: { label: "Route Running", short: "ROUTE" },
  hands: { label: "Hands", short: "HANDS" },
  pblk: { label: "Pass Block", short: "PBLK" },
  rblk: { label: "Run Block", short: "RBLK" },
  prush: { label: "Pass Rush", short: "PRSH" },
  rdef: { label: "Run Defense", short: "RDEF" },
  cov: { label: "Coverage", short: "COV" },
  tkl: { label: "Tackling", short: "TKL" },
};
const LENSES = ["overall", ...Object.keys(SUBS)];

// starters: how many of the group's top players (by snaps) count as starters.
// subs: the specific grades that matter for the group, in display order.
const GROUPS = [
  { key: "QB", pos: ["QB"], unit: "o", starters: 1, subs: ["pass", "run"] },
  { key: "RB", pos: ["HB", "FB"], unit: "o", starters: 1, subs: ["run", "route", "pblk"] },
  { key: "WR", pos: ["WR"], unit: "o", starters: 3, subs: ["route", "hands", "rblk"] },
  { key: "TE", pos: ["TE"], unit: "o", starters: 1, subs: ["route", "rblk", "pblk"] },
  { key: "OL", pos: ["T", "G", "C"], unit: "o", starters: 5, subs: ["pblk", "rblk"] },
  { key: "IDL", pos: ["DI"], unit: "d", starters: 2, subs: ["prush", "rdef"] },
  { key: "EDGE", pos: ["ED"], unit: "d", starters: 2, subs: ["prush", "rdef"] },
  { key: "LB", pos: ["LB"], unit: "d", starters: 2, subs: ["rdef", "cov", "prush", "tkl"] },
  { key: "CB", pos: ["CB"], unit: "d", starters: 3, subs: ["cov", "rdef", "tkl"] },
  { key: "S", pos: ["S"], unit: "d", starters: 2, subs: ["cov", "rdef", "tkl"] },
];
const GROUP_OF_POS = Object.fromEntries(GROUPS.flatMap((g) => g.pos.map((p) => [p, g.key])));
// The Draft Sim's need keys (engine NEED_KEYS) for each group.
const NEED_KEYS_OF = { OL: ["OT", "G", "C"] };
const needKeysOf = (group) => NEED_KEYS_OF[group] || [group];

// Player stats — keys from scripts/syncPffNflRosters.js STATS: [label, format].
// Player rates arrive as 0–100.
const STAT_DEFS = {
  p_att: ["Att", "int"], p_cmp: ["Cmp%", "pct"], p_yds: ["Yds", "int"], p_ypa: ["Y/A", "d1"], p_td: ["TD", "int"],
  p_int: ["INT", "int"], p_btt: ["BTT%", "pct"], p_twp: ["TWP%", "pct"], p_acc: ["Acc%", "pct"], p_adot: ["aDOT", "d1"],
  p_ttt: ["TTT", "sec"], p_p2s: ["P2S%", "pct"], p_rtg: ["Rtg", "d1"],
  r_att: ["Att", "int"], r_yds: ["Yds", "int"], r_ypa: ["Y/C", "d1"], r_td: ["TD", "int"], r_yco: ["YCO/A", "d2"],
  r_mtf: ["MTF", "int"], r_elu: ["Elusive", "d1"], r_brk: ["Brkaway%", "pct"], r_fum: ["Fum", "int"],
  r_rec: ["Rec", "int"], r_ryds: ["Rec Yds", "int"], r_yprr: ["YPRR", "d2"],
  c_tgt: ["Tgt", "int"], c_rec: ["Rec", "int"], c_yds: ["Yds", "int"], c_td: ["TD", "int"], c_yprr: ["YPRR", "d2"],
  c_yac: ["YAC/R", "d1"], c_adot: ["aDOT", "d1"], c_drop: ["Drop%", "pct"], c_cc: ["Contest%", "pct"],
  c_slot: ["Slot%", "pct"], c_inl: ["Inline%", "pct"], c_tshare: ["Tgt Share", "pct"], c_rtg: ["Rtg When Tgt", "d1"],
  b_pr: ["Press Allowed", "int"], b_sk: ["Sacks Allowed", "int"], b_prr: ["Press Rate", "pct"],
  b_pbwr: ["PBWR", "pct"], b_pbe: ["PBE", "d1"], b_pen: ["Penalties", "int"],
  rb_zone: ["Zone RBLK", "d1"], rb_gap: ["Gap RBLK", "d1"],
  d_pr: ["Pressures", "int"], d_sk: ["Sacks", "int"], d_hit: ["Hits", "int"], d_hur: ["Hurries", "int"],
  d_prwr: ["PRWR", "pct"], d_prr: ["Press Rate", "pct"], d_dbl: ["Dbl Team%", "pct"],
  d_tkl: ["Tackles", "int"], d_stop: ["Stops", "int"], d_stp: ["Stop%", "pct"], d_mtr: ["Miss Tkl%", "pct"],
  v_tgt: ["Tgt", "int"], v_rec: ["Rec", "int"], v_cr: ["Catch%", "pct"], v_yds: ["Yds", "int"],
  v_ycs: ["Yds/Cov Snap", "d2"], v_td: ["TD", "int"], v_int: ["INT", "int"], v_pbu: ["PBU", "int"],
  v_fir: ["FINC%", "pct"], v_rtg: ["Rtg Allowed", "d1"],
};
// Each group's standard stat line, in display order.
const GROUP_STATS = {
  QB: ["p_yds", "p_ypa", "p_td", "p_int", "p_cmp", "p_acc", "p_btt", "p_twp", "p_adot", "p_ttt", "p_p2s", "p_rtg", "r_yds"],
  RB: ["r_att", "r_yds", "r_ypa", "r_td", "r_yco", "r_mtf", "r_elu", "r_brk", "r_fum", "r_rec", "r_ryds", "r_yprr", "b_pr"],
  WR: ["c_tgt", "c_rec", "c_yds", "c_td", "c_yprr", "c_yac", "c_adot", "c_drop", "c_cc", "c_slot", "c_tshare", "c_rtg"],
  TE: ["c_tgt", "c_rec", "c_yds", "c_td", "c_yprr", "c_yac", "c_drop", "c_inl", "c_slot", "b_pr", "b_sk"],
  OL: ["b_pr", "b_sk", "b_prr", "b_pbwr", "b_pbe", "b_pen", "rb_zone", "rb_gap"],
  IDL: ["d_pr", "d_sk", "d_hit", "d_hur", "d_prwr", "d_prr", "d_dbl", "d_stop", "d_stp", "d_mtr"],
  EDGE: ["d_pr", "d_sk", "d_hit", "d_hur", "d_prwr", "d_prr", "d_dbl", "d_stop", "d_stp", "d_mtr"],
  LB: ["d_tkl", "d_stop", "d_stp", "d_mtr", "v_tgt", "v_cr", "v_ycs", "v_rtg", "v_int", "v_pbu", "d_pr", "d_sk"],
  CB: ["v_tgt", "v_rec", "v_cr", "v_yds", "v_ycs", "v_td", "v_int", "v_pbu", "v_fir", "v_rtg", "d_tkl", "d_mtr", "d_stop"],
  S: ["v_tgt", "v_rec", "v_cr", "v_yds", "v_ycs", "v_td", "v_int", "v_pbu", "v_fir", "v_rtg", "d_tkl", "d_mtr", "d_stop"],
};

// Labels that need more context in one group's line (a QB's rushing yards
// sit next to his passing yards).
const STAT_LABEL_IN_GROUP = { QB: { r_yds: "Rush Yds" } };

// PFF team unit grades (unit.grades, from PFF's team overview): [label, side].
const UNIT_GRADES = {
  overall: ["Overall", ""], off: ["Offense", "o"], pass: ["Passing", "o"], run: ["Rushing", "o"],
  pblk: ["Pass Block", "o"], rblk: ["Run Block", "o"], route: ["Route Running", "o"],
  def: ["Defense", "d"], prush: ["Pass Rush", "d"], cov: ["Coverage", "d"], rdef: ["Run Defense", "d"],
  tkl: ["Tackling", "d"], st: ["Special Teams", "s"],
};
// Team stats (unit.stats[category][key] = [value, PFF league rank, 1 =
// best]): [category, key, label, format, tendency]. Tendencies are style,
// not quality, so their rank isn't colored. Team rates arrive as 0–1.
const TEAM_STAT_SECTIONS = {
  o: [
    ["Overall", "offense-overall-success", [
      ["epaPerPlay", "EPA/play", "d2"], ["successRate", "Success rate", "frac"], ["explosivePlayRate", "Explosive rate", "frac"],
      ["pointsPerDrive", "Points/drive", "d2"], ["thirdDownConversionRate", "3rd down", "frac"], ["redZoneConversionRate", "Red zone TD", "frac"],
      ["offensiveTurnovers", "Turnovers", "int"],
    ]],
    ["Passing", "offense-passing", [
      ["epaPerPassPlay", "EPA/pass", "d2"], ["yardsPerAttempt", "Y/A", "d1"], ["completionPercentage", "Comp %", "frac"],
      ["passerRating", "Passer rating", "d1"], ["explosivePassRate", "Explosive pass", "frac"], ["pressureRateAgainst", "Pressure allowed", "frac"],
      ["sackRateAgainst", "Sack rate allowed", "frac"], ["timeToThrow", "Time to throw", "sec"], ["adot", "aDOT", "d1"],
      ["passPlayPct", "Pass rate", "frac", true], ["playActionRate", "Play action", "frac", true], ["screenRate", "Screen rate", "frac", true],
    ]],
    ["Rushing", "offense-rushing", [
      ["epaPerRunPlay", "EPA/run", "d2"], ["rushSuccessRate", "Rush success", "frac"], ["designedYardsPerCarry", "Y/C (designed)", "d1"],
      ["yardsBeforeContactPerCarry", "YBC/carry", "d2"], ["yardsAfterContactPerCarry", "YAC/carry", "d2"], ["explosiveRunRate", "Explosive run", "frac"],
      ["runStuffRate", "Stuff rate", "frac"], ["zoneRunPct", "Zone runs", "frac", true], ["gapRunPct", "Gap runs", "frac", true],
    ]],
  ],
  d: [
    ["Overall", "defense-overall-success", [
      ["epaPerPlayAllowed", "EPA/play", "d2"], ["successRateAllowed", "Success rate", "frac"], ["explosivePlayRateAllowed", "Explosive rate", "frac"],
      ["pointsPerDriveAllowed", "Points/drive", "d2"], ["thirdDownConversionRateAllowed", "3rd down", "frac"], ["redZoneConversionRateAllowed", "Red zone TD", "frac"],
      ["defensiveTurnovers", "Takeaways", "int"], ["missedTackleRate", "Missed tackle %", "frac"],
    ]],
    ["Pass defense", "defense-passing", [
      ["epaPerPassPlayAllowed", "EPA/pass", "d2"], ["yardsPerAttemptAllowed", "Y/A", "d1"], ["completionPercentageAllowed", "Comp %", "frac"],
      ["passerRatingAllowed", "Passer rating", "d1"], ["pressureRate", "Pressure rate", "frac"], ["sackRate", "Sack rate", "frac"],
      ["sacks", "Sacks", "int"], ["interceptions", "INT", "int"],
      ["blitzRate", "Blitz rate", "frac", true], ["manCoveragePct", "Man coverage", "frac", true], ["zoneCoveragePct", "Zone coverage", "frac", true],
    ]],
    ["Run defense", "defense-rushing", [
      ["epaPerRunPlayAllowed", "EPA/run", "d2"], ["rushSuccessRateAllowed", "Rush success", "frac"], ["designedYardsPerCarryAllowed", "Y/C (designed)", "d1"],
      ["yardsBeforeContactPerCarryAllowed", "YBC/carry", "d2"], ["stuffRate", "Stuff rate", "frac"], ["explosiveRunRateAllowed", "Explosive run", "frac"],
    ]],
  ],
};

function fmtStat(v, f) {
  if (v == null) return "—";
  if (f === "int") return String(Math.round(v));
  if (f === "pct") return `${v.toFixed(1)}%`;
  // Team rates come as 0–1; anything already over 1 is a percentage.
  if (f === "frac") return `${(v <= 1 ? v * 100 : v).toFixed(1)}%`;
  if (f === "sec") return `${v.toFixed(2)}s`;
  if (f === "d2") return v.toFixed(2);
  return v.toFixed(1);
}
// League rank chip color: top quarter green, bottom quarter red.
function rankTone(rank, tendency) {
  if (!rank || tendency) return { bg: "#eef1f5", fg: "#7a8594" };
  if (rank <= 8) return { bg: "#dff3e4", fg: "#1f7a3a" };
  if (rank >= 25) return { bg: "#fbe3df", fg: "#b03323" };
  return { bg: "#f1f3f6", fg: "#555" };
}
const UNITS = [{ key: "OFF" }, { key: "DEF" }];

// PFF's grade scale: 90+ elite, 80s high quality, 70s above average, 60s
// average, below that replaceable/poor.
function gradeTone(g) {
  if (g == null) return { bg: "#f1f3f6", fg: "#9aa3ad" };
  if (g >= 90) return { bg: "#1f7a3a", fg: "#fff" };
  if (g >= 80) return { bg: "#3fa556", fg: "#fff" };
  if (g >= 70) return { bg: "#a6c94a", fg: "#1d2a0c" };
  if (g >= 60) return { bg: "#f0c541", fg: "#3a2d00" };
  if (g >= 50) return { bg: "#ee9135", fg: "#fff" };
  return { bg: "#d4442f", fg: "#fff" };
}
// RBs age out earliest, so their thresholds sit a couple of years lower.
function ageTone(age, group) {
  if (age == null) return "#9aa3ad";
  const shift = group === "RB" ? 2 : 0;
  if (age >= 31 - shift) return "#c0392b";
  if (age >= 29 - shift) return "#e08a1e";
  if (age <= 24) return "#1f7ac9";
  return "#555";
}

const YEAR_MS = 365.2425 * 24 * 3600 * 1000;
const ageOf = (dob) => (dob ? (Date.now() - new Date(`${dob}T12:00:00Z`).getTime()) / YEAR_MS : null);
const fmt1 = (v) => (v == null ? "—" : v.toFixed(1));
const heightOf = (ht) => (ht ? `${Math.floor(ht / 100)}'${ht % 100}"` : "");

// Weighted mean of f(x) over xs, weighted by w(x) (snaps by default);
// preseason (no snaps at all) falls back to an even average.
function weighted(xs, f, w = (x) => x.sn || 0) {
  const vals = xs.map((x) => [f(x), w(x)]).filter(([v]) => v != null);
  if (!vals.length) return null;
  const total = vals.reduce((a, [, w]) => a + w, 0);
  if (!total) return vals.reduce((a, [v]) => a + v, 0) / vals.length;
  return vals.reduce((a, [v, w]) => a + v * w, 0) / total;
}

// A group's (or unit's) specific grade: his grade weighted by his snaps in
// that phase, over everyone who has one.
const subGrade = (players, key) => weighted(players.filter((p) => p.x?.[key]), (p) => p.x[key][0], (p) => p.x[key][1]);

// One team doc → { groups: { QB: {...} }, OFF, DEF }, each with subs:
// { [key]: grade } for the specific grades that apply to it.
// order: the admin's depth order, { [group]: [pffId] } — a group with one
// lists its players in it (anyone not in it after, by snaps) and starts
// the first g.starters.
function summarizeTeam(team, order = {}) {
  const players = (team.players || []).map((p) => ({ ...p, age: ageOf(p.dob), group: GROUP_OF_POS[p.pos] }));
  const groups = {};
  GROUPS.forEach((g) => {
    const slot = new Map((order[g.key] || []).map((id, i) => [String(id), i]));
    const all = players.filter((p) => p.group === g.key)
      .sort((a, b) => (b.sn || 0) - (a.sn || 0) || (a.d || 99) - (b.d || 99));
    const list = all.filter((p) => !p.off).sort((a, b) => (slot.get(String(a.id)) ?? Infinity) - (slot.get(String(b.id)) ?? Infinity));
    const gone = all.filter((p) => p.off);
    const hasSnaps = list.some((p) => p.sn);
    const ordered = list.some((p) => slot.has(String(p.id)));
    const starters = ordered || hasSnaps ? list.slice(0, g.starters) : list.filter((p) => p.d === 1).slice(0, g.starters);
    const pool = hasSnaps ? list : starters;
    groups[g.key] = {
      ordered,
      list,
      gone,
      starterIds: new Set(starters.map((p) => p.id)),
      grade: weighted(pool, (p) => p.g),
      age: weighted(pool, (p) => p.age),
      aging: starters.filter((p) => p.age != null && p.age >= (g.key === "RB" ? 28 : 30)).length,
      starters: starters.length,
      subs: Object.fromEntries(g.subs.map((k) => [k, subGrade(list, k)])),
    };
  });
  const unitOf = (u) => {
    const pool = players.filter((p) => p.u === u && p.group && !p.off);
    const hasSnaps = pool.some((p) => p.sn);
    const used = hasSnaps ? pool : pool.filter((p) => p.d === 1);
    // A unit's specific grade only counts the groups it applies to (OFF pass
    // block = OL + TE + RB blocking, not a WR's stray rep).
    const subs = {};
    Object.keys(SUBS).forEach((k) => {
      const inGroups = pool.filter((p) => GROUPS.find((g) => g.key === p.group)?.subs.includes(k));
      if (inGroups.length) subs[k] = subGrade(inGroups, k);
    });
    return { grade: weighted(used, (p) => p.g), age: weighted(used, (p) => p.age), subs };
  };
  return { groups, OFF: unitOf("o"), DEF: unitOf("d") };
}

// A cell's grade under a lens: its overall grade, or one specific grade —
// null where that grade doesn't apply to the column.
const gradeIn = (cell, lens) => (lens === "overall" ? cell?.grade : cell?.subs?.[lens] ?? null);

// ranks[lens][col]: Map abbr → rank (1 = best) for every lens and column.
function rankColumns(summaries) {
  const ranks = {};
  LENSES.forEach((lens) => {
    ranks[lens] = {};
    [...GROUPS.map((g) => g.key), ...UNITS.map((u) => u.key)].forEach((col) => {
      const val = (s) => gradeIn(s.groups[col] || s[col], lens);
      const sorted = summaries.filter((s) => val(s) != null).sort((a, b) => val(b) - val(a));
      ranks[lens][col] = new Map(sorted.map((s, i) => [s.abbr, i + 1]));
    });
  });
  return ranks;
}

// unitRanks[key]: Map abbr → rank (1 = best) of each PFF team unit grade.
function rankUnitGrades(teams) {
  const out = {};
  Object.keys(UNIT_GRADES).forEach((k) => {
    const val = (t) => t.unit?.grades?.[k];
    const sorted = teams.filter((t) => val(t) != null).sort((a, b) => val(b) - val(a));
    out[k] = new Map(sorted.map((t, i) => [t.abbr, i + 1]));
  });
  return out;
}

export default function AdminResearch() {
  const [teams, setTeams] = useState(null);
  const [nfl, setNfl] = useState({});
  const [error, setError] = useState("");
  // { [abbr]: needs } (nflTeamNeeds), { [abbr]: { groups, wants, order } }
  // (nflDepthNotes), { [pffId]: tags } (nflPlayerTags) and the trait lists.
  const [needs, setNeeds] = useState({});
  const [notes, setNotes] = useState({});
  const [tags, setTags] = useState({});
  const [traits, setTraits] = useState({});

  useEffect(() => {
    let alive = true;
    getDocs(collection(db, "nflTeamNeeds"))
      .then((snap) => alive && setNeeds(Object.fromEntries(snap.docs.map((d) => [d.id, d.data().needs || {}]))))
      .catch((e) => console.error("Team needs load error:", e));
    loadTeamNotes().then((n) => alive && setNotes(n)).catch((e) => console.error("Depth notes load error:", e));
    loadTraits().then((t) => alive && setTraits(t)).catch((e) => console.error("Traits load error:", e));
    loadPlayerTags().then((t) => alive && setTags(t)).catch((e) => console.error("Player tags load error:", e));
    Promise.all([getDocs(collection(db, "pffNflRosters")), getDocs(collection(db, "nfl"))])
      .then(([rosterSnap, nflSnap]) => {
        if (!alive) return;
        const byAbbr = {};
        nflSnap.docs.forEach((d) => { byAbbr[d.id] = d.data(); });
        setNfl(byAbbr);
        setTeams(rosterSnap.docs.map((d) => ({ abbr: d.id, ...d.data() })));
      })
      .catch((e) => {
        console.error("Research load error:", e);
        if (alive) { setError(e.message); setTeams([]); }
      });
    return () => { alive = false; };
  }, []);

  if (!teams) return <div style={{ padding: "40px", textAlign: "center", fontWeight: 800, color: "#888" }}>Loading research…</div>;
  if (!teams.length) {
    return (
      <div style={{ border: "2px dashed #ddd", borderRadius: "12px", padding: "40px 24px", textAlign: "center", background: "#fafafa", color: "#888", fontWeight: 700, fontSize: "13px" }}>
        {error ? `Couldn't load PFF data: ${error}` : "No PFF NFL data yet — run scripts/syncPffNflRosters.js (or the Sync PFF Grades workflow)."}
      </div>
    );
  }
  return <ResearchView teams={teams} nfl={nfl} needs={needs} setNeeds={setNeeds} notes={notes} setNotes={setNotes} tags={tags} setTags={setTags} traits={traits} />;
}

// The panel itself, given the loaded pffNflRosters docs ({ abbr, ...doc })
// and nfl docs by abbreviation (logos + colors); needs / notes / tags (and
// their setters, for what's just been saved): the teams' need labels and
// group notes, and the players' tags; traits: the trait lists ({ [doc]: [trait] }).
export function ResearchView({ teams, nfl, needs = {}, setNeeds, notes = {}, setNotes, tags = {}, setTags, traits = {} }) {
  const [view, setView] = useState("league");
  const [metric, setMetric] = useState("grade");
  const [lens, setLens] = useState("overall");
  const [sort, setSort] = useState({ col: "OFF", dir: "desc" });
  const [teamAbbr, setTeamAbbr] = useState("");
  const [focusGroup, setFocusGroup] = useState(null);
  const summaries = useMemo(() => teams.map((t) => ({ abbr: t.abbr, name: t.name, ...summarizeTeam(t, notes[t.abbr]?.order) })), [teams, notes]);
  const ranks = useMemo(() => rankColumns(summaries), [summaries]);
  const unitRanks = useMemo(() => rankUnitGrades(teams), [teams]);

  const season = teams[0]?.season;
  const synced = teams.map((t) => t.updatedAt?.toDate?.()).filter(Boolean).sort((a, b) => b - a)[0];
  const openTeam = (abbr, group = null) => { setTeamAbbr(abbr); setFocusGroup(group); setView("team"); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {[{ key: "league", label: "League" }, { key: "units", label: "Units" }, { key: "team", label: "Team" }].map((t) => (
          <button key={t.key} onClick={() => { setView(t.key); if (t.key === "team" && !teamAbbr) setTeamAbbr(summaries[0]?.abbr || ""); }}
            style={tabStyle(view === t.key, BLUE)}>{t.label}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 700, color: "#888" }}>
          PFF · {season} season{synced ? ` · synced ${synced.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""} · admin only, never public
        </span>
      </div>

      {view === "league" ? (
        <LeagueMatrix summaries={summaries} ranks={ranks} nfl={nfl} metric={metric} setMetric={setMetric}
          lens={lens} setLens={setLens} sort={sort} setSort={setSort} onOpen={openTeam} />
      ) : view === "units" ? (
        <UnitsTable teams={teams} unitRanks={unitRanks} nfl={nfl} onOpen={openTeam} />
      ) : (
        <TeamBreakdown
          team={teams.find((t) => t.abbr === teamAbbr) || teams[0]}
          summary={summaries.find((s) => s.abbr === teamAbbr) || summaries[0]}
          ranks={ranks} unitRanks={unitRanks} nfl={nfl} teams={teams} season={season}
          onPick={(abbr) => { setTeamAbbr(abbr); setFocusGroup(null); }}
          focusGroup={focusGroup}
          needs={needs} setNeeds={setNeeds} notes={notes} setNotes={setNotes} tags={tags} setTags={setTags} traits={traits}
        />
      )}
    </div>
  );
}

function tabStyle(active, color) {
  return {
    padding: "8px 20px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em",
    border: "2px solid " + color, borderRadius: "8px", cursor: "pointer",
    background: active ? color : "#fff", color: active ? "#fff" : color,
  };
}

function TeamMark({ abbr, nfl, size = 22 }) {
  const logo = nfl[abbr]?.Logo1 || nfl[abbr]?.LogoDark;
  return logo
    ? <img src={sanitizeUrl(logo)} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
    : <span style={{ width: size, flexShrink: 0 }} />;
}

// ── League view ──
function LeagueMatrix({ summaries, ranks, nfl, metric, setMetric, lens, setLens, sort, setSort, onOpen }) {
  const cols = [...GROUPS.map((g) => g.key), ...UNITS.map((u) => u.key)];
  const cellOf = (s, col) => s.groups[col] || s[col];
  const valueOf = (cell) => (metric === "age" ? cell?.age : gradeIn(cell, lens));
  // Columns the chosen specific grade doesn't apply to (pass block on CB).
  const applies = (col) => lens === "overall" || summaries.some((s) => gradeIn(cellOf(s, col), lens) != null);
  const sorted = [...summaries].sort((a, b) => {
    if (sort.col === "team") return sort.dir === "asc" ? a.abbr.localeCompare(b.abbr) : b.abbr.localeCompare(a.abbr);
    const va = valueOf(cellOf(a, sort.col));
    const vb = valueOf(cellOf(b, sort.col));
    if (va == null) return 1;
    if (vb == null) return -1;
    return sort.dir === "asc" ? va - vb : vb - va;
  });
  const clickHeader = (col) => setSort((cur) => (cur.col === col
    ? { col, dir: cur.dir === "desc" ? "asc" : "desc" }
    // Grade: best first. Age: oldest first (that's the question it answers).
    : { col, dir: col === "team" ? "asc" : "desc" }));

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderBottom: "1px solid #eef1f5", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666" }}>Lead with</span>
        {[{ key: "grade", label: "Grade" }, { key: "age", label: "Age" }].map((m) => (
          <button key={m.key} onClick={() => setMetric(m.key)} style={{ ...tabStyle(metric === m.key, GOLD), padding: "5px 14px", fontSize: "11px" }}>{m.label}</button>
        ))}
        <Legend />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 12px", borderBottom: "1px solid #eef1f5", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666", marginRight: "3px" }}>Grade</span>
        {LENSES.map((k) => (
          <button key={k} onClick={() => setLens(k)} style={{
            padding: "4px 10px", fontSize: "11px", fontWeight: 900, borderRadius: "999px", cursor: "pointer",
            border: `1px solid ${lens === k ? BLUE : "#d5dbe3"}`, background: lens === k ? BLUE : "#fff", color: lens === k ? "#fff" : "#445",
          }}>
            {k === "overall" ? "Overall" : SUBS[k].label}
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: "12px" }}>
          <thead>
            <tr>
              <Th onClick={() => clickHeader("team")} active={sort.col === "team"} dir={sort.dir} align="left" sticky>Team</Th>
              {cols.map((c) => (
                <Th key={c} onClick={() => clickHeader(c)} active={sort.col === c} dir={sort.dir} divider={c === "OFF"} dim={!applies(c)}>{c}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.abbr}>
                <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, padding: "6px 10px", borderBottom: "1px solid #f1f3f6", whiteSpace: "nowrap" }}>
                  <button onClick={() => onOpen(s.abbr)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 900, color: "#111", fontSize: "12px" }}>
                    <TeamMark abbr={s.abbr} nfl={nfl} /> {s.abbr}
                  </button>
                </td>
                {cols.map((c) => {
                  const cell = cellOf(s, c);
                  const grade = gradeIn(cell, lens);
                  const tone = gradeTone(grade);
                  const rank = ranks[lens][c]?.get(s.abbr);
                  const ageColor = ageTone(cell?.age, c);
                  const lensName = lens === "overall" ? "grade" : SUBS[lens].label.toLowerCase();
                  if (!applies(c)) {
                    return <td key={c} style={{ borderBottom: "1px solid #f1f3f6", borderLeft: c === "OFF" ? "2px solid #e5e7eb" : "none", background: "#fafbfc" }} />;
                  }
                  return (
                    <td key={c} style={{ padding: "3px", borderBottom: "1px solid #f1f3f6", borderLeft: c === "OFF" ? "2px solid #e5e7eb" : "none" }}>
                      <button
                        onClick={() => onOpen(s.abbr, GROUPS.some((g) => g.key === c) ? c : null)}
                        title={`${s.abbr} ${c}: ${lensName} ${fmt1(grade)}${rank ? ` (#${rank} of 32)` : ""}, age ${fmt1(cell?.age)}${cell?.aging ? ` · ${cell.aging} starter${cell.aging > 1 ? "s" : ""} 30+` : ""}`}
                        style={{
                          width: "100%", minWidth: "58px", border: "none", borderRadius: "6px", cursor: "pointer",
                          padding: "5px 4px", lineHeight: 1.15, textAlign: "center",
                          background: metric === "grade" ? tone.bg : "#f7f8fa",
                          color: metric === "grade" ? tone.fg : ageColor,
                          boxShadow: metric === "age" ? `inset 0 -3px 0 ${tone.bg}` : "none",
                        }}
                      >
                        <div style={{ fontSize: "14px", fontWeight: 900 }}>{fmt1(metric === "grade" ? grade : cell?.age)}</div>
                        <div style={{ fontSize: "10px", fontWeight: 800, opacity: 0.85 }}>
                          {metric === "grade"
                            ? <>#{rank || "—"} · {fmt1(cell?.age)}y</>
                            : <>{fmt1(grade)} · #{rank || "—"}</>}
                          {cell?.aging && cell.aging * 2 >= cell.starters ? " ▲" : ""}
                        </div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, onClick, active, dir, align = "center", sticky, divider, dim }) {
  return (
    <th onClick={onClick} style={{
      opacity: dim ? 0.35 : 1,
      position: sticky ? "sticky" : "static", left: sticky ? 0 : undefined, zIndex: sticky ? 2 : undefined,
      background: BLUE, color: "#fff", padding: "8px 6px", fontSize: "11px", fontWeight: 900, letterSpacing: "0.06em",
      textAlign: align, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
      borderLeft: divider ? "2px solid #003d7a" : "none",
    }}>
      {children}{active ? (dir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );
}

function Legend({ age = true }) {
  const steps = [[90, "90+"], [80, "80s"], [70, "70s"], [60, "60s"], [50, "50s"], [0, "<50"]];
  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", fontSize: "10px", fontWeight: 800, color: "#666" }}>
      {steps.map(([g, label]) => {
        const t = gradeTone(g);
        return <span key={label} style={{ background: t.bg, color: t.fg, padding: "2px 6px", borderRadius: "4px" }}>{label}</span>;
      })}
      {age && <span style={{ marginLeft: "8px" }}>age: <span style={{ color: "#1f7ac9" }}>≤24</span> · <span style={{ color: "#e08a1e" }}>29+</span> · <span style={{ color: "#c0392b" }}>31+</span> (RB 2 yrs younger) · ▲ half+ of starters 30+ (RB 28+)</span>}
    </div>
  );
}

// ── Units view ──
const UNITS_COLS = [
  ...Object.keys(UNIT_GRADES).map((k) => ({ key: k, label: UNIT_GRADES[k][0], side: UNIT_GRADES[k][1], kind: "grade" })),
  { key: "epaO", label: "EPA/play Off", side: "o", kind: "stat", cat: "offense-overall-success", stat: "epaPerPlay" },
  { key: "epaD", label: "EPA/play Def", side: "d", kind: "stat", cat: "defense-overall-success", stat: "epaPerPlayAllowed" },
];
function UnitsTable({ teams, unitRanks, nfl, onOpen }) {
  const [sort, setSort] = useState({ col: "overall", dir: "asc" });
  // Sort by rank (1 = best), so "asc" is best first for every column.
  const rankOf = (t, c) => (c.kind === "grade" ? unitRanks[c.key].get(t.abbr) : t.unit?.stats?.[c.cat]?.[c.stat]?.[1]);
  const sortVal = (t) => {
    if (sort.col === "team") return t.abbr;
    if (sort.col === "record") return -((t.unit?.w || 0) + (t.unit?.t || 0) / 2) / Math.max(1, (t.unit?.w || 0) + (t.unit?.l || 0) + (t.unit?.t || 0));
    if (sort.col === "pd") return -((t.unit?.pf || 0) - (t.unit?.pa || 0));
    return rankOf(t, UNITS_COLS.find((c) => c.key === sort.col)) ?? 99;
  };
  const sorted = [...teams].sort((a, b) => {
    const va = sortVal(a), vb = sortVal(b);
    const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return sort.dir === "asc" ? cmp : -cmp;
  });
  const click = (col) => setSort((cur) => (cur.col === col ? { col, dir: cur.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }));
  const divider = (c, i) => i > 0 && UNITS_COLS[i - 1].side !== c.side;

  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderBottom: "1px solid #eef1f5", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666" }}>PFF team unit grades</span>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#999" }}>· small number = league rank · click a team for its unit report</span>
        <Legend age={false} />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: "12px" }}>
          <thead>
            <tr>
              <Th onClick={() => click("team")} active={sort.col === "team"} dir={sort.dir} align="left" sticky>Team</Th>
              <Th onClick={() => click("record")} active={sort.col === "record"} dir={sort.dir}>W-L</Th>
              <Th onClick={() => click("pd")} active={sort.col === "pd"} dir={sort.dir}>PF / PA</Th>
              {UNITS_COLS.map((c, i) => (
                <Th key={c.key} onClick={() => click(c.key)} active={sort.col === c.key} dir={sort.dir} divider={divider(c, i)}>{c.label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.abbr}>
                <td style={{ position: "sticky", left: 0, background: "#fff", zIndex: 1, padding: "6px 10px", borderBottom: "1px solid #f1f3f6", whiteSpace: "nowrap" }}>
                  <button onClick={() => onOpen(t.abbr)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 900, color: "#111", fontSize: "12px" }}>
                    <TeamMark abbr={t.abbr} nfl={nfl} /> {t.abbr}
                  </button>
                </td>
                <td style={{ textAlign: "center", fontWeight: 900, borderBottom: "1px solid #f1f3f6", whiteSpace: "nowrap", padding: "0 6px" }}>
                  {t.unit ? `${t.unit.w}-${t.unit.l}${t.unit.t ? `-${t.unit.t}` : ""}` : "—"}
                </td>
                <td style={{ textAlign: "center", fontWeight: 800, color: "#555", borderBottom: "1px solid #f1f3f6", whiteSpace: "nowrap", padding: "0 6px" }}>
                  {t.unit ? `${t.unit.pf} / ${t.unit.pa}` : "—"}
                </td>
                {UNITS_COLS.map((c, i) => {
                  const rank = rankOf(t, c);
                  const v = c.kind === "grade" ? t.unit?.grades?.[c.key] : t.unit?.stats?.[c.cat]?.[c.stat]?.[0];
                  const tone = c.kind === "grade" ? gradeTone(v) : rankTone(rank);
                  return (
                    <td key={c.key} style={{ padding: "3px", borderBottom: "1px solid #f1f3f6", borderLeft: divider(c, i) ? "2px solid #e5e7eb" : "none" }}>
                      <button onClick={() => onOpen(t.abbr)} title={`${t.abbr} ${c.label}: ${c.kind === "grade" ? fmt1(v) : fmtStat(v, "d2")}${rank ? ` (#${rank} of 32)` : ""}`}
                        style={{ width: "100%", minWidth: "54px", border: "none", borderRadius: "6px", cursor: "pointer", padding: "5px 4px", lineHeight: 1.15, background: tone.bg, color: tone.fg }}>
                        <div style={{ fontSize: "13px", fontWeight: 900 }}>{c.kind === "grade" ? fmt1(v) : fmtStat(v, "d2")}</div>
                        <div style={{ fontSize: "10px", fontWeight: 800, opacity: 0.85 }}>#{rank || "—"}</div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One team's unit report: Offense / Defense / Special Teams, each with
// PFF's unit grades (ranked among the 32) and its team stats (PFF's ranks).
function TeamUnitReport({ team, unitRanks }) {
  const u = team.unit;
  if (!u) return null;
  const gradeTiles = (side) => Object.entries(UNIT_GRADES).filter(([, [, sd]]) => sd === side).map(([k, [label]]) => {
    const g = u.grades?.[k];
    const t = gradeTone(g);
    const r = unitRanks[k].get(team.abbr);
    return (
      <div key={k} title={`${label}: ${fmt1(g)}${r ? ` (#${r} of 32)` : ""}`} style={{ flex: "1 1 80px", background: t.bg, color: t.fg, borderRadius: "8px", padding: "7px 8px", minWidth: "80px" }}>
        <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.9 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
          <span style={{ fontSize: "20px", fontWeight: 900 }}>{fmt1(g)}</span>
          <span style={{ fontSize: "11px", fontWeight: 800, opacity: 0.85 }}>#{r || "—"}</span>
        </div>
      </div>
    );
  });
  const statSection = ([title, cat, rows]) => (
    <div key={cat} style={{ flex: "1 1 220px", minWidth: "220px" }}>
      <div style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8a95a5", margin: "2px 0 4px" }}>{title}</div>
      {rows.map(([key, label, f, tendency]) => {
        const [v, rank] = u.stats?.[cat]?.[key] || [];
        const tone = rankTone(rank, tendency);
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", borderBottom: "1px solid #f3f4f7", fontSize: "12px" }}>
            <span style={{ flex: 1, color: tendency ? "#8a95a5" : "#333", fontWeight: 700 }}>{label}</span>
            <span style={{ fontWeight: 900, color: "#111" }}>{fmtStat(v, f)}</span>
            <span title={tendency ? "Tendency — not a quality rank" : `#${rank} of 32`} style={{ minWidth: "34px", textAlign: "center", fontSize: "10px", fontWeight: 900, background: tone.bg, color: tone.fg, borderRadius: "999px", padding: "1px 6px" }}>
              {rank ? `#${rank}` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
  const panel = (title, side) => (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ fontSize: "14px", fontWeight: 900, color: "#111", textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>{gradeTiles(side)}</div>
      {TEAM_STAT_SECTIONS[side] && <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>{TEAM_STAT_SECTIONS[side].map(statSection)}</div>}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(560px, 1fr))", gap: "14px", alignItems: "start" }}>
      {panel("Offense", "o")}
      {panel("Defense", "d")}
    </div>
  );
}

// ── Team view ──
function TeamBreakdown({ team, summary, ranks, unitRanks, nfl, teams, season, onPick, focusGroup, needs, setNeeds, notes, setNotes, tags, setTags, traits }) {
  const brand = nfl[team.abbr] || {};
  const c1 = brand.Color1 || BLUE;
  const abbr = team.abbr;
  const teamNeeds = resolveNeeds(needs[abbr]);
  // The group notes, wants and order are the team's; the players' tags are
  // everyone's, by PFF id.
  const mine = notes[abbr] || {};
  const teamNotes = { groups: mine.groups || {}, wants: mine.wants || {}, order: mine.order || {}, roleOrder: mine.roleOrder || {}, players: tags };
  const setTeamField = (field, group, value) => setNotes?.((all) => {
    const t = all[abbr] || { groups: {}, wants: {}, order: {}, roleOrder: {} };
    const next = { ...(t[field] || {}) };
    if (value == null || (Array.isArray(value) && !value.length) || value === "") delete next[group]; else next[group] = value;
    return { ...all, [abbr]: { ...t, [field]: next } };
  });

  // One position's labels → saved at once (with the rest of the team's).
  // Built on the latest edits (latest), not the last render — two quick
  // clicks on different positions both stick.
  const latest = useRef({});
  const saveNeed = async (key, value) => {
    const next = { ...(latest.current[abbr] || teamNeeds), [key]: value };
    latest.current[abbr] = next;
    const stored = await writeTeamNeeds({ [abbr]: next });
    setNeeds?.((all) => ({ ...all, ...stored }));
  };
  // Suggest Need: worked out fresh each time from the league's depth
  // charts, the players' tags as they stand and the team's injury list
  // (fetched once a visit).
  const [espn, setEspn] = useState({});
  const suggestFor = async (key) => {
    let list = espn[abbr];
    if (!list) {
      list = await fetchEspnRoster(abbr).catch(() => []);
      setEspn((cur) => ({ ...cur, [abbr]: list }));
    }
    const orders = Object.fromEntries(Object.entries(notes).map(([a, n]) => [a, n.order || {}]));
    const roleOrders = Object.fromEntries(Object.entries(notes).map(([a, n]) => [a, n.roleOrder || {}]));
    return suggestNeeds(teams.filter((t) => t.abbr), { [abbr]: list }, Date.now(), tags, orders, roleOrders)[abbr]?.[key] || null;
  };
  const saveGroup = async (group, text) => {
    await saveGroupNote(abbr, group, text);
    setTeamField("groups", group, text.trim());
  };
  const saveWants = async (group, list) => {
    await saveGroupWants(abbr, group, list);
    setTeamField("wants", group, list);
  };
  const saveOrder = async (group, ids) => {
    await saveGroupOrder(abbr, group, ids);
    setTeamField("order", group, ids ? ids.map(String) : null);
  };
  const saveRoleOrderFor = async (role, ids) => {
    await saveRoleOrder(abbr, role, ids);
    setTeamField("roleOrder", role, ids ? ids.map(String) : null);
  };
  const savePlayer = async (id, entry) => {
    const full = { ...entry, team: abbr };
    await savePlayerTags(id, full);
    const clean = cleanPlayerTags(full);
    setTags?.((all) => { const next = { ...all }; if (clean) next[id] = clean; else delete next[id]; return next; });
  };

  // A role's players on the depth chart: the role's own order first, then
  // the parent group's players and the rest, each in their group's order.
  const roleList = (r) => {
    const own = new Map((teamNotes.roleOrder[r.key] || []).map((id, i) => [String(id), i]));
    const all = [...(summary.groups[r.parent]?.list || []), ...GROUPS.filter((g) => g.key !== r.parent).flatMap((g) => summary.groups[g.key]?.list || [])]
      .filter((p) => (tags[p.id]?.roles || []).includes(r.key));
    return all.map((p, i) => ({ p, i })).sort((a, b) => (own.get(String(a.p.id)) ?? Infinity) - (own.get(String(b.p.id)) ?? Infinity) || a.i - b.i).map((x) => x.p);
  };

  useEffect(() => {
    if (!focusGroup) return;
    document.getElementById(`research-group-${focusGroup}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusGroup, team.abbr]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", background: `linear-gradient(120deg, ${c1}, ${c1}cc)`, color: "#fff", borderRadius: "10px", padding: "14px 18px" }}>
        <TeamMark abbr={team.abbr} nfl={nfl} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "20px", fontWeight: 900 }}>
            {team.name}
            {team.unit && (
              <span style={{ fontSize: "13px", fontWeight: 800, opacity: 0.9, marginLeft: "10px" }}>
                {team.unit.w}-{team.unit.l}{team.unit.t ? `-${team.unit.t}` : ""} · {team.unit.pf}–{team.unit.pa}
                {" · "}PFF overall {fmt1(team.unit.grades?.overall)} (#{unitRanks.overall.get(team.abbr) || "—"})
                {" · "}ST {fmt1(team.unit.grades?.st)} (#{unitRanks.st.get(team.abbr) || "—"})
              </span>
            )}
          </div>
          <div style={{ fontSize: "12px", fontWeight: 800, opacity: 0.9 }}>
            Depth chart: offense {fmt1(summary.OFF.grade)} (#{ranks.overall.OFF.get(team.abbr) || "—"}) · {fmt1(summary.OFF.age)}y
            {"  ·  "}defense {fmt1(summary.DEF.grade)} (#{ranks.overall.DEF.get(team.abbr) || "—"}) · {fmt1(summary.DEF.age)}y
          </div>
        </div>
        <select value={team.abbr} onChange={(e) => onPick(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: "6px", border: "none", fontSize: "14px", fontWeight: 800, color: "#111" }}>
          {[...teams].sort((a, b) => a.abbr.localeCompare(b.abbr)).map((t) => <option key={t.abbr} value={t.abbr}>{t.abbr} — {t.name}</option>)}
        </select>
      </div>

      <TeamUnitReport team={team} unitRanks={unitRanks} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(520px, 1fr))", gap: "14px", alignItems: "start" }}>
        {GROUPS.map((g) => (
          <GroupCard key={`${team.abbr}-${g.key}`} group={g} data={summary.groups[g.key]} abbr={team.abbr} ranks={ranks}
            season={season} highlight={focusGroup === g.key}
            needs={teamNeeds} onNeed={saveNeed} suggestFor={suggestFor}
            notes={teamNotes} onGroupNote={saveGroup} onPlayerNote={savePlayer}
            onWants={saveWants} onOrder={saveOrder} traits={traitsFor(traits, g.key)} />
        ))}
      </div>

      <div style={{ fontSize: "13px", fontWeight: 900, color: "#111", letterSpacing: "0.04em", marginTop: "4px" }}>
        ROLES <span style={{ fontSize: "11px", fontWeight: 700, color: "#8a95a5", letterSpacing: 0 }}>· tag players with a role in their group&apos;s Notes</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "14px", alignItems: "start" }}>
        {ROLES.map((r) => (
          <RoleCard key={`${team.abbr}-${r.key}`} role={r} players={roleList(r)} ordered={(teamNotes.roleOrder[r.key] || []).length > 0}
            tags={tags} need={teamNeeds[r.key]} onNeed={(v) => saveNeed(r.key, v)} suggest={() => suggestFor(r.key)}
            onOrder={(ids) => saveRoleOrderFor(r.key, ids)} />
        ))}
      </div>
    </div>
  );
}

// A small grade chip: value on PFF's color scale, rank underneath.
function GradeChip({ g, rank, of, title, min = "40px" }) {
  const t = gradeTone(g);
  return (
    <div title={title} style={{ textAlign: "center" }}>
      <span style={{ display: "inline-block", minWidth: min, background: t.bg, color: t.fg, fontWeight: 900, padding: "2px 5px", borderRadius: "5px" }}>{fmt1(g)}</span>
      {rank ? <div style={{ fontSize: "9px", fontWeight: 800, color: "#8a95a5" }}>#{rank}{of ? `/${of}` : ""}</div> : null}
    </div>
  );
}

function GroupCard({ group, data, abbr, ranks, season, highlight, needs, onNeed, suggestFor, notes, onGroupNote, onPlayerNote, onWants, onOrder, traits }) {
  const tone = gradeTone(data.grade);
  const rank = ranks.overall[group.key].get(abbr);
  // Player stat lines: click a row to open it, or Show stats for all.
  const [open, setOpen] = useState(() => new Set());
  const [allOpen, setAllOpen] = useState(false);
  // Notes: the group's note and each player's tags + note, to edit.
  const [editing, setEditing] = useState(false);
  // Set Starters: the depth order, to slide players around.
  const [arranging, setArranging] = useState(false);
  const groupNote = notes.groups?.[group.key] || "";
  const wants = notes.wants?.[group.key] || [];
  const toggle = (id) => setOpen((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const statKeys = GROUP_STATS[group.key] || [];
  const colCount = 5 + group.subs.length;
  return (
    <div id={`research-group-${group.key}`} style={{
      background: "#fff", borderRadius: "10px", overflow: "hidden", scrollMarginTop: "80px",
      border: highlight ? `2px solid ${GOLD}` : "1px solid #e5e7eb",
      boxShadow: highlight ? "0 0 0 3px #fde8c4" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderBottom: "1px solid #eef1f5" }}>
        <div style={{ fontSize: "16px", fontWeight: 900, color: "#111", width: "52px" }}>{group.key}</div>
        <span style={{ background: tone.bg, color: tone.fg, fontWeight: 900, fontSize: "14px", padding: "3px 9px", borderRadius: "6px" }}>{fmt1(data.grade)}</span>
        <span style={{ fontSize: "12px", fontWeight: 800, color: "#555" }}>#{rank || "—"} of 32</span>
        <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 800, color: ageTone(data.age, group.key) }}>avg {fmt1(data.age)}y</span>
        {data.aging > 0 && (
          <span style={{ fontSize: "10px", fontWeight: 900, color: "#fff", background: "#c0392b", padding: "2px 7px", borderRadius: "999px" }}>
            {data.aging}/{data.starters} starters {group.key === "RB" ? "28" : "30"}+
          </span>
        )}
        <button onClick={() => setArranging((v) => !v)} style={pillBtn(arranging, "#15803d")}>{arranging ? "Done" : "Set starters"}</button>
        <button onClick={() => setEditing((v) => !v)} style={pillBtn(editing, GOLD)}>{editing ? "Done" : "Notes"}</button>
        <button onClick={() => { setAllOpen((v) => !v); setOpen(new Set()); }} style={pillBtn(allOpen, BLUE)}>{allOpen ? "Hide stats" : "Show stats"}</button>
      </div>
      {needKeysOf(group.key).map((k) => (
        <NeedsBar key={k} needKey={k} split={needKeysOf(group.key).length > 1} value={needs[k]} onSave={(v) => onNeed(k, v)} suggest={() => suggestFor(k)} />
      ))}
      {arranging && <StarterSlots group={group} list={data.list} ordered={data.ordered} onSave={(ids) => onOrder(group.key, ids)} />}
      {(editing || wants.length > 0) && <GroupWants wants={wants} editing={editing} traits={traits} onSave={(list) => onWants(group.key, list)} />}
      {(editing || groupNote) && (
        <GroupNote text={groupNote} editing={editing} onSave={(t) => onGroupNote(group.key, t)} />
      )}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid #eef1f5", background: "#fafbfd" }}>
        {group.subs.map((k) => {
          const g = data.subs[k];
          const t = gradeTone(g);
          const r = ranks[k][group.key].get(abbr);
          return (
            <span key={k} title={`${group.key} ${SUBS[k].label}: ${fmt1(g)}${r ? ` (#${r} of 32)` : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid #e3e7ee", borderRadius: "999px", padding: "2px 9px 2px 3px", background: "#fff" }}>
              <span style={{ background: t.bg, color: t.fg, fontWeight: 900, fontSize: "11px", padding: "1px 6px", borderRadius: "999px" }}>{fmt1(g)}</span>
              <span style={{ fontSize: "10px", fontWeight: 900, color: "#445", letterSpacing: "0.04em" }}>{SUBS[k].label}</span>
              <span style={{ fontSize: "10px", fontWeight: 800, color: "#8a95a5" }}>#{r || "—"}</span>
            </span>
          );
        })}
      </div>
      {data.list.length + data.gone.length === 0 ? (
        <div style={{ padding: "14px", fontSize: "12px", color: "#aaa", fontStyle: "italic" }}>No players on the depth chart.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ color: "#8a95a5", fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <td style={{ padding: "6px 12px" }}>Player</td>
              <td style={{ textAlign: "right" }}>Age</td>
              <td style={{ textAlign: "right" }}>Exp</td>
              <td style={{ textAlign: "center" }}>Grade</td>
              {group.subs.map((k) => <td key={k} style={{ textAlign: "center" }} title={SUBS[k].label}>{SUBS[k].short}</td>)}
              <td style={{ padding: "0 12px 0 8px" }}>Snaps</td>
            </tr>
          </thead>
          <tbody>
            {[...data.list, ...data.gone].map((p) => {
              const starter = data.starterIds.has(p.id);
              const exp = p.ey ? season - p.ey : null;
              const expanded = allOpen || open.has(p.id);
              const stats = statKeys.filter((k) => p.st?.[k] != null);
              return (
                <Fragment key={p.id}>
                <tr onClick={() => toggle(p.id)} title="Click for his stats" style={{
                  borderTop: p.off && p.id === data.gone[0].id ? "2px dashed #e3e7ee" : "1px solid #f3f4f7",
                  background: p.off ? "#fafafa" : starter ? "#fbfcfe" : "#fff", cursor: "pointer", opacity: p.off ? 0.75 : 1,
                }}>
                  <td style={{ padding: "6px 12px", maxWidth: "190px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "9px", fontWeight: 900, color: "#8a95a5", width: "34px", flexShrink: 0 }}>{p.al}</span>
                      <span style={{ fontWeight: starter ? 900 : 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</span>
                      {p.off && (
                        <span title="Played for this team this season but isn't on its current depth chart (injured, released or traded). Not counted in the group's grade or age."
                          style={{ fontSize: "9px", fontWeight: 900, color: "#666", background: "#e6e9ee", padding: "1px 5px", borderRadius: "3px", flexShrink: 0 }}>OFF DC</span>
                      )}
                      {p.s && <span title={p.s} style={{ fontSize: "9px", fontWeight: 900, color: "#fff", background: "#c0392b", padding: "1px 5px", borderRadius: "3px", textTransform: "uppercase", flexShrink: 0 }}>{p.s.slice(0, 3)}</span>}
                    </div>
                    <div style={{ fontSize: "10px", color: "#9aa3ad", fontWeight: 700, paddingLeft: "40px" }}>
                      {[p.pos, heightOf(p.ht), p.wt ? `${p.wt}` : "", p.no ? `#${p.no}` : ""].filter(Boolean).join(" · ")}
                    </div>
                    <PlayerTags entry={notes.players?.[p.id]} />
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 900, color: ageTone(p.age, group.key) }}>{fmt1(p.age)}</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: "#666" }}>{exp == null ? "—" : exp === 0 ? "R" : exp}</td>
                  <td style={{ padding: "0 4px" }}>
                    <GradeChip g={p.g} rank={p.rk} of={p.of} title={`Overall ${fmt1(p.g)}${p.rk ? ` — #${p.rk} of ${p.of} ${p.pos}` : ""}`} />
                  </td>
                  {group.subs.map((k) => {
                    const v = p.x?.[k];
                    return (
                      <td key={k} style={{ padding: "0 3px" }}>
                        {v ? (
                          <GradeChip g={v[0]} rank={v[2]} of={v[3]} min="34px"
                            title={`${SUBS[k].label} ${fmt1(v[0])} on ${v[1]} snaps${v[2] ? ` — #${v[2]} of ${v[3]} ${p.pos}` : " (too few snaps to rank)"}`} />
                        ) : <div style={{ textAlign: "center", color: "#c5ccd6" }}>—</div>}
                      </td>
                    );
                  })}
                  <td style={{ padding: "0 12px 0 8px", width: "96px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ flex: 1, height: "6px", background: "#eef1f5", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, p.sp || 0)}%`, height: "100%", background: BLUE }} />
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: 800, color: "#666", width: "30px", textAlign: "right" }}>{p.sp != null ? `${Math.round(p.sp)}%` : "—"}</span>
                    </div>
                  </td>
                </tr>
                {editing && (
                  <tr style={{ background: "#fffaf0" }}>
                    <td colSpan={colCount} style={{ padding: "6px 12px 8px 52px", borderTop: "1px dashed #f1e2c4" }}>
                      <PlayerNoteEditor entry={notes.players?.[p.id]} traits={traits} roles={rolesForGroup(group.key)} onSave={(e) => onPlayerNote(p.id, { ...e, n: p.n, g: group.key })} />
                    </td>
                  </tr>
                )}
                {expanded && (
                  <tr style={{ background: "#f7f9fc" }}>
                    <td colSpan={colCount} style={{ padding: "6px 12px 8px 52px", borderTop: "1px dashed #e3e7ee" }}>
                      {stats.length ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                          {stats.map((k) => (
                            <span key={k} style={{ fontSize: "11px", whiteSpace: "nowrap" }}>
                              <span style={{ color: "#8a95a5", fontWeight: 800 }}>{STAT_LABEL_IN_GROUP[group.key]?.[k] || STAT_DEFS[k][0]}</span>{" "}
                              <span style={{ color: "#111", fontWeight: 900 }}>{fmtStat(p.st[k], STAT_DEFS[k][1])}</span>
                            </span>
                          ))}
                        </div>
                      ) : <span style={{ fontSize: "11px", color: "#aaa", fontStyle: "italic" }}>No stats yet.</span>}
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const pillBtn = (on, color) => ({
  fontSize: "10px", fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer",
  border: `1px solid ${on ? color : "#d5dbe3"}`, background: on ? color : "#fff", color: on ? "#fff" : "#445",
  borderRadius: "999px", padding: "3px 9px",
});

// A saved / saving / error line for an edit that saves itself.
function useSaver(save) {
  const [state, setState] = useState("");
  const run = async (...args) => {
    setState("Saving…");
    try {
      await save(...args);
      setState("Saved");
      setTimeout(() => setState((cur) => (cur === "Saved" ? "" : cur)), 1500);
    } catch (e) {
      console.error("Research save error:", e);
      setState(`Couldn't save: ${e.code || e.message}`);
    }
  };
  return [state, run];
}
const SaveState = ({ state }) => (state ? <span style={{ fontSize: "10px", fontWeight: 800, color: state.startsWith("Couldn't") ? "#c8102e" : "#8a95a5" }}>{state}</span> : null);

// A group's need label(s) for one need key — the Draft Sim's (nflTeamNeeds),
// saved the moment a label's clicked — and Suggest Need: the suggestion
// with why, to use or leave. split: the group has more than one key (OL:
// OT and IOL), so each is named. No label = Set.
function NeedsBar({ needKey, split, value, onSave, suggest }) {
  const [state, save] = useSaver(onSave);
  const [sug, setSug] = useState(null);
  const [loading, setLoading] = useState(false);
  const labels = (value?.labels || []).filter((l) => l !== "Set");
  const top = labels[0] || "Set";
  const toggle = (l) => save({ labels: labels.includes(l) ? labels.filter((x) => x !== l) : [...labels, l].sort(byUrgency), note: value?.note || "" });
  const ask = async () => {
    setLoading(true);
    try { setSug((await suggest()) || { none: true }); } catch (e) { setSug({ error: e.message }); } finally { setLoading(false); }
  };
  const same = sug?.label && (labels.length ? labels.join() : "Set") === sug.label;
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eef1f5", background: "#fcfdff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color: "#8a95a5", minWidth: split ? "92px" : "38px" }}>
          {split ? NEED_KEY_NAMES[needKey].toUpperCase() : "NEED"}
        </span>
        <span style={{ fontSize: "12px", fontWeight: 900, color: top === "Set" ? "#8a97ab" : LABEL_COLOR[top], marginRight: "4px" }}>{labels.length ? labels.join(" + ") : "Set"}</span>
        {NEED_LABELS.filter((l) => l !== "Set").map((l) => <Chip key={l} label={l} small on={labels.includes(l)} onClick={() => toggle(l)} />)}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <SaveState state={state} />
          <button onClick={ask} disabled={loading} style={pillBtn(false, BLUE)}>{loading ? "Suggesting…" : "Suggest need"}</button>
        </span>
      </div>
      {sug && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "6px", fontSize: "11px", color: "#5b6b84" }}>
          {sug.error ? <span style={{ color: "#c8102e" }}>Couldn't suggest: {sug.error}</span> : sug.none ? <span>No suggestion for this position.</span> : (
            <>
              <span style={{ fontWeight: 900, color: "#33415a" }}>Suggested</span>
              <Chip label={sug.label} on small />
              <span style={{ flex: "1 1 220px", minWidth: 0 }}>{suggestionReason(sug)}</span>
              {sug.injured?.length > 0 && <span style={{ color: "#d9480f", fontWeight: 700 }}>Counting {sug.injured.map((i) => `${i.name} (${i.status})`).join(", ")} as healthy — without: {sug.without.label}</span>}
              {same ? <span style={{ fontWeight: 800, color: "#15803d" }}>Matches</span> : (
                <button onClick={() => save(applied(value, sug))} style={pillBtn(true, BLUE)}>Use it</button>
              )}
            </>
          )}
          <button onClick={() => setSug(null)} style={{ border: "none", background: "none", color: "#8a95a5", cursor: "pointer", fontSize: "11px", fontWeight: 800 }}>✕</button>
        </div>
      )}
    </div>
  );
}

// The group's note: read-only, or a box to write in (Notes), saved on blur.
function GroupNote({ text, editing, onSave }) {
  const [draft, setDraft] = useState(text);
  const [state, save] = useSaver(onSave);
  useEffect(() => { setDraft(text); }, [text]);
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eef1f5", background: "#fffaf0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: editing ? "4px" : "2px" }}>
        <span style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color: "#b7791f" }}>GROUP NOTES</span>
        <SaveState state={state} />
      </div>
      {editing ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft.trim() !== text.trim()) save(draft); }} rows={3}
          placeholder="How this room looks — who's ascending, who's on the way out, what it needs…"
          style={{ width: "100%", boxSizing: "border-box", border: "1px solid #ead9b8", borderRadius: "6px", padding: "6px 8px", fontSize: "12px", fontFamily: "Arial, sans-serif", resize: "vertical" }} />
      ) : <div style={{ fontSize: "12px", color: "#33415a", whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{text}</div>}
    </div>
  );
}

const tagStyle = (color) => ({ fontSize: "9px", fontWeight: 900, color: "#fff", background: color, padding: "1px 6px", borderRadius: "999px", whiteSpace: "nowrap" });

// A player's talent and development tags and note, under his name.
function PlayerTags({ entry }) {
  const t = talentTag(entry?.talent);
  const d = devTag(entry?.dev);
  const str = entry?.strengths || [];
  const weak = entry?.weaknesses || [];
  const roles = (entry?.roles || []).map((k) => ROLE_BY_KEY[k]).filter(Boolean);
  if (!t && !d && !entry?.note && !str.length && !weak.length && !roles.length) return null;
  return (
    <div style={{ paddingLeft: "40px", marginTop: "2px", display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center", whiteSpace: "normal" }}>
      {t && <span style={tagStyle(t.color)}>{t.label}</span>}
      {d && <span style={tagStyle(d.color)} title={d.label}>{d.short}</span>}
      {roles.map((r) => <span key={r.key} style={{ ...tagStyle("#fff"), color: "#33415a", border: "1px solid #c9d2de" }}>{r.name}</span>)}
      {str.length > 0 && <span style={{ fontSize: "10px", fontWeight: 800, color: "#15803d" }}>+ {str.join(", ")}</span>}
      {weak.length > 0 && <span style={{ fontSize: "10px", fontWeight: 800, color: "#c8102e" }}>− {weak.join(", ")}</span>}
      {entry?.note && <span style={{ fontSize: "10px", color: "#5b6b84", fontStyle: "italic" }}>{entry.note}</span>}
    </div>
  );
}

// Notes, a player's row: one talent tag, one development tag (click the
// one he has to clear it) and a note, saved on blur.
function PlayerNoteEditor({ entry, onSave, traits = [], roles = [] }) {
  const cur = { talent: entry?.talent || null, dev: entry?.dev || null, roles: entry?.roles || [], strengths: entry?.strengths || [], weaknesses: entry?.weaknesses || [], note: entry?.note || "" };
  const [traitsOpen, setTraitsOpen] = useState(false);
  const [note, setNote] = useState(cur.note);
  const [state, save] = useSaver(onSave);
  useEffect(() => { setNote(entry?.note || ""); }, [entry?.note]);
  const pick = (field, key) => save({ ...cur, note, [field]: cur[field] === key ? null : key });
  // Roles: any number of his group's.
  const flipRole = (key) => save({ ...cur, note, roles: cur.roles.includes(key) ? cur.roles.filter((k) => k !== key) : [...cur.roles, key] });
  // Strengths / Weaknesses: never both, MAX_TRAITS each (the college rules).
  const flip = (kind, trait) => {
    const other = kind === "strengths" ? "weaknesses" : "strengths";
    if (cur[other].includes(trait)) return;
    if (cur[kind].includes(trait)) save({ ...cur, note, [kind]: cur[kind].filter((x) => x !== trait) });
    else if (cur[kind].length < MAX_TRAITS) save({ ...cur, note, [kind]: [...cur[kind], trait] });
  };
  const pill = (on, color) => ({ border: `1px solid ${on ? color : "#d5dce6"}`, background: on ? color : "#fff", color: on ? "#fff" : "#33415a", borderRadius: "999px", padding: "2px 8px", fontSize: "10px", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "9px", fontWeight: 900, color: "#8a95a5", width: "62px" }}>TALENT</span>
        {TALENT_TAGS.map((t) => <button key={t.key} onClick={() => pick("talent", t.key)} style={pill(cur.talent === t.key, t.color)}>{t.label}</button>)}
      </div>
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "9px", fontWeight: 900, color: "#8a95a5", width: "62px" }}>DEVELOPMENT</span>
        {DEV_TAGS.map((t) => <button key={t.key} onClick={() => pick("dev", t.key)} style={pill(cur.dev === t.key, t.color)}>{t.label}</button>)}
      </div>
      {roles.length > 0 && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "9px", fontWeight: 900, color: "#8a95a5", width: "62px" }}>ROLES</span>
          {roles.map((r) => <button key={r.key} onClick={() => flipRole(r.key)} style={pill(cur.roles.includes(r.key), "#33415a")}>{r.name}</button>)}
        </div>
      )}
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "9px", fontWeight: 900, color: "#8a95a5", width: "62px" }}>TRAITS</span>
        <button onClick={() => setTraitsOpen((v) => !v)} style={pill(traitsOpen, "#33415a")}>
          Strengths {cur.strengths.length}/{MAX_TRAITS} · Weaknesses {cur.weaknesses.length}/{MAX_TRAITS} {traitsOpen ? "▲" : "▼"}
        </button>
      </div>
      {traitsOpen && (
        traits.length ? ["strengths", "weaknesses"].map((kind) => (
          <div key={kind} style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center", paddingLeft: "66px" }}>
            <span style={{ fontSize: "9px", fontWeight: 900, color: kind === "strengths" ? "#15803d" : "#c8102e", width: "70px" }}>{kind.toUpperCase()}</span>
            {traits.map((tr) => {
              const on = cur[kind].includes(tr);
              const blocked = !on && (cur[kind === "strengths" ? "weaknesses" : "strengths"].includes(tr) || cur[kind].length >= MAX_TRAITS);
              return <button key={tr} onClick={() => flip(kind, tr)} disabled={blocked} style={{ ...pill(on, kind === "strengths" ? "#15803d" : "#c8102e"), opacity: blocked ? 0.35 : 1, cursor: blocked ? "default" : "pointer" }}>{tr}</button>;
            })}
          </div>
        )) : <div style={{ paddingLeft: "66px", fontSize: "11px", color: "#8a95a5" }}>No trait list for this position.</div>
      )}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note.trim() !== cur.note.trim()) save({ ...cur, note }); }}
          placeholder="Note on him (optional)"
          style={{ flex: 1, minWidth: 0, border: "1px solid #ead9b8", borderRadius: "6px", padding: "4px 8px", fontSize: "11px", fontFamily: "Arial, sans-serif" }} />
        <SaveState state={state} />
      </div>
    </div>
  );
}

// Set Starters: the group's players in depth order — the first
// group.starters start (green), the rest are the bench. Drag a row, or
// nudge it with the arrows, to move him; every move saves the whole order.
// Reset goes back to PFF's (most snaps start). ordered: an order's saved.
// title / slotName: the heading and each starter's label (a role's: "Starter").
function StarterSlots({ group, list, ordered, onSave, title = "STARTING SLOTS — DRAG TO REORDER", slotName = (i) => `${group.key}${i + 1}`, resetLabel = "Reset to PFF", defaultLabel = "PFF order (most snaps)" }) {
  const [rows, setRows] = useState(list);
  const [drag, setDrag] = useState(null);
  const [state, save] = useSaver(onSave);
  useEffect(() => { setRows(list); }, [list]);
  const move = (from, to) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    setRows(next);
    save(next.map((x) => x.id));
  };
  const arrow = { border: "1px solid #d5dbe3", background: "#fff", borderRadius: "4px", width: "22px", height: "20px", fontSize: "10px", cursor: "pointer", padding: 0, color: "#445" };
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eef1f5", background: "#f3faf5" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color: "#15803d" }}>{title}</span>
        <SaveState state={state} />
        <span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 800, color: "#8a95a5" }}>{ordered ? "Your order" : defaultLabel}</span>
        {ordered && <button onClick={() => save(null)} style={pillBtn(false, BLUE)}>{resetLabel}</button>}
      </div>
      {rows.map((p, i) => {
        const starter = i < group.starters;
        return (
          <Fragment key={p.id}>
            {i === group.starters && <div style={{ borderTop: "2px dashed #b9dcc4", margin: "4px 0", fontSize: "9px", fontWeight: 900, color: "#8a95a5", letterSpacing: "0.1em", paddingTop: "2px" }}>BENCH</div>}
            <div draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag != null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}
              style={{
                display: "flex", alignItems: "center", gap: "8px", padding: "3px 6px", marginBottom: "2px", borderRadius: "6px", cursor: "grab",
                background: drag === i ? "#e3f1e7" : "#fff", border: `1px solid ${starter ? "#9fd3b0" : "#e3e7ee"}`,
              }}>
              <span style={{ color: "#b0b8c4", fontSize: "12px" }}>⠿</span>
              <span style={{ width: "40px", fontSize: "10px", fontWeight: 900, color: starter ? "#15803d" : "#8a95a5" }}>{starter ? slotName(i) : `#${i + 1}`}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: starter ? 900 : 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</span>
              <span style={{ fontSize: "10px", fontWeight: 800, color: "#8a95a5" }}>{p.pos}{p.sp != null ? ` · ${Math.round(p.sp)}%` : ""}</span>
              <button onClick={() => move(i, i - 1)} disabled={i === 0} style={{ ...arrow, opacity: i === 0 ? 0.3 : 1 }} aria-label="Move up">▲</button>
              <button onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} style={{ ...arrow, opacity: i === rows.length - 1 ? 0.3 : 1 }} aria-label="Move down">▼</button>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// The traits a group wants: chips, or (Notes) its trait list to pick from.
function GroupWants({ wants, editing, traits, onSave }) {
  const [state, save] = useSaver(onSave);
  const toggle = (t) => save(wants.includes(t) ? wants.filter((x) => x !== t) : [...wants, t]);
  const chip = (on) => ({ border: `1px solid ${on ? "#7a3cff" : "#d5dce6"}`, background: on ? "#7a3cff" : "#fff", color: on ? "#fff" : "#33415a", borderRadius: "999px", padding: "2px 8px", fontSize: "10px", fontWeight: 800, cursor: editing ? "pointer" : "default", whiteSpace: "nowrap" });
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eef1f5", background: "#f8f5ff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <span style={{ fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", color: "#7a3cff" }}>WANTS</span>
        <SaveState state={state} />
      </div>
      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
        {editing
          ? (traits.length ? traits.map((t) => <button key={t} onClick={() => toggle(t)} style={chip(wants.includes(t))}>{t}</button>) : <span style={{ fontSize: "11px", color: "#8a95a5" }}>No trait list for this position.</span>)
          : wants.map((t) => <span key={t} style={chip(true)}>{t}</span>)}
      </div>
    </div>
  );
}

// A role as its own group: its need label (NeedsBar, the role's key) and
// the team's players with the role (their tags — players: everyone on the
// current depth chart with it, the parent group's first and in its order;
// the suggestion picks its man the same way, by order, then talent).
function RoleCard({ role, players, ordered, tags, need, onNeed, suggest, onOrder }) {
  const [arranging, setArranging] = useState(false);
  return (
    <div style={{ background: "#fff", borderRadius: "10px", overflow: "hidden", border: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", borderBottom: "1px solid #eef1f5" }}>
        <span style={{ fontSize: "14px", fontWeight: 900, color: "#111" }}>{role.name}</span>
        <span style={{ fontSize: "10px", fontWeight: 900, color: "#8a95a5", letterSpacing: "0.06em" }}>{role.parent} ROLE</span>
        <span style={{ marginLeft: "auto", fontSize: "11px", fontWeight: 800, color: "#8a95a5" }}>{players.length} tagged</span>
        {players.length > 1 && <button onClick={() => setArranging((v) => !v)} style={pillBtn(arranging, "#15803d")}>{arranging ? "Done" : "Set order"}</button>}
      </div>
      <NeedsBar needKey={role.key} value={need} onSave={onNeed} suggest={suggest} />
      {arranging && players.length > 1 && (
        <StarterSlots group={{ key: role.key, starters: 1 }} list={players} ordered={ordered} onSave={onOrder}
          title="ROLE ORDER — DRAG TO REORDER" slotName={() => "Starter"} resetLabel="Reset" defaultLabel="Depth chart order" />
      )}
      {players.length ? players.map((p, i) => {
        const t = talentTag(tags[p.id]?.talent);
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 12px", borderTop: i ? "1px solid #f3f4f7" : "none", fontSize: "12px" }}>
            <span style={{ fontWeight: i === 0 ? 900 : 700, color: "#111", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.n}</span>
            {t && <span style={tagStyle(t.color)}>{t.label}</span>}
            <span style={{ fontSize: "10px", fontWeight: 800, color: "#8a95a5" }}>{p.pos}{p.sp != null ? ` · ${Math.round(p.sp)}%` : ""}</span>
            <GradeChip g={p.g} min="34px" />
          </div>
        );
      }) : (
        <div style={{ padding: "10px 12px", fontSize: "11px", color: "#8a95a5", lineHeight: 1.4 }}>
          No one tagged yet — tag players in the {role.parent} card&apos;s Notes. Until then Suggest Need goes by PFF&apos;s read of the role.
        </div>
      )}
    </div>
  );
}
