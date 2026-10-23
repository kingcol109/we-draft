// src/utils/draftProfiles.js
//
// Position-by-position draft profiles for NFL decision-makers, and how well
// prospects fit them — shared by the staff pages' Targets tab
// (StaffPage.jsx) and the team page's Targets tab
// (components/ProjectedPicks.jsx). Pure functions, no React or Firebase, so
// scripts can run the same math.
//
// A profile is built from the picks credited to someone at one position
// (see creditForPick in coachHistory.js): the traits those players shared
// (Strengths = valued, Weaknesses = tolerated) and their average
// measurements. Prospects are scored against it with the comparison page's
// engine (findComps in historicalStats.js) on height, weight and traits —
// nothing else is measured before the combine.
import { STAT_METRICS, readMetric, findComps } from "./historicalStats.js";
import { CREDIT_SCOPES, draftCredits, creditForPick } from "./coachHistory.js";

// Prospects aren't measured until the combine — only height and weight are
// on file before then, so only those feed a match (findComps would count
// every other profile average as a miss for every prospect).
export const MATCH_METRICS = ["height", "weight"];
// The profile's top traits each way that feed a match.
export const MATCH_TRAITS = 3;
// Specialists get no profile.
export const PROFILE_SKIP = ["K", "P", "LS"];

// ── Fit score ──
// findComps' raw similarity runs on very different scales here: a prospect
// against a whole profile (the blend of many players' traits) rarely tops
// 60, while a prospect against one drafted player regularly reaches the
// 80s. So each kind is mapped onto one 0–100 fit score, piecewise-linear
// through calibrated anchors, where 70 / 80 / 90 always mean Strong / Very
// Strong / Extremely Strong. Anchors were set from 2027 prospects scored
// against real staffs (DET, DAL, KC; Oct 2026): profile fits — p95 48,
// p99 60, max 74; best player matches — p95 70, p99 79, max 97. Roughly,
// Strong ≈ the top 2–3% of fits, Extremely Strong a handful league-wide.
const FIT_ANCHORS = {
  profile: [[0, 0], [55, 70], [62, 80], [68, 90], [100, 100]],
  player: [[0, 0], [75, 70], [82, 80], [88, 90], [100, 100]],
};
export function fitScore(similarity, kind = "profile") {
  const pts = FIT_ANCHORS[kind];
  const s = Math.max(0, Math.min(100, similarity));
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (s <= x1) return y0 + ((s - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 100;
}

// Tiers on the fit score, strongest first.
export const FIT_TIERS = [
  { key: "extreme", label: "Extremely Strong", min: 90 },
  { key: "very", label: "Very Strong", min: 80 },
  { key: "strong", label: "Strong", min: 70 },
];
export const fitTier = (score) => FIT_TIERS.find((t) => score >= t.min) || null;

// ── Pick rows ──
// One shape for every pick, whichever collection it came from:
// { key, year, team, round, pick, player, position, school, slug, rec }
// rec is the source record — measurements, and Strengths/Weaknesses for
// historical rows.

// `historical` docs → pick rows, deduped the way NFLTeamPage.jsx's archive
// is: one row per year+pick and per year+name. nameToAbbr maps the docs'
// "NFL Team" full name to its abbreviation; years from beforeYear on are
// dropped (draftOrder holds those).
export function historicalPickRows(docs, nameToAbbr, beforeYear) {
  const seen = new Set();
  const rows = [];
  docs.forEach(({ id, data: h }) => {
    const year = parseInt(h.Year);
    if (!year || year >= beforeYear) return;
    const pick = parseInt(h.Pick);
    const name = String(h.Player || "").trim().toLowerCase();
    const k1 = pick && pick !== 999 ? `${year}-${pick}` : null;
    const k2 = name ? `${year}-${name}` : null;
    if ((k1 && seen.has(k1)) || (k2 && seen.has(k2))) return;
    if (k1) seen.add(k1);
    if (k2) seen.add(k2);
    rows.push({
      key: id, year, team: nameToAbbr[h["NFL Team"]],
      round: parseInt(h.Round) || null, pick: pick && pick !== 999 ? pick : null,
      player: h.Player || "", position: h.Position || "", school: h.School || "", slug: null,
      rec: h,
    });
  });
  return rows;
}

// The just-finished draft: draftOrder selections → players docs ({ id, ...data }
// by Slug). rec is the player doc — its traits come from the community.
export function currentPickRows(order, bySlug, year) {
  return order.filter((o) => bySlug[o.Selection]).map((o) => {
    const p = bySlug[o.Selection];
    return {
      key: `cur-${o.Selection}`, year, team: o.Team,
      round: parseInt(o.Round) || null, pick: parseInt(o.Pick) || null,
      player: `${p.First || ""} ${p.Last || ""}`.trim(), position: p.Position || "", school: p.School || "", slug: p.Slug,
      rec: p,
    };
  });
}

// A pick's Strengths/Weaknesses: the admin grade on historical rows, the
// community's for the latest class (community: { [playerId]: { strengths,
// weaknesses } }, from communityFor).
export function pickTraits(p, community, latestYear) {
  const c = p.year === latestYear ? community?.[p.rec?.id] : null;
  const S = c ? c.strengths : p.rec?.Strengths;
  const W = c ? c.weaknesses : p.rec?.Weaknesses;
  return { strengths: Array.isArray(S) ? S : [], weaknesses: Array.isArray(W) ? W : [] };
}

// [trait, count] pairs, most common first.
export function tally(lists) {
  const counts = {};
  lists.forEach((list) => list.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// One position's profile from the picks at it:
// { picks, graded, strengths: [[trait, n]], weaknesses, averages: { [metricKey]: { value, n } } }
export function buildProfile(posPicks, community, latestYear) {
  const graded = posPicks.map((p) => pickTraits(p, community, latestYear)).filter((t) => t.strengths.length || t.weaknesses.length);
  const averages = {};
  STAT_METRICS.forEach((m) => {
    const vals = posPicks.map((p) => (p.rec ? readMetric(p.rec, m).value : null)).filter((v) => v != null);
    if (vals.length) averages[m.key] = { value: vals.reduce((a, v) => a + v, 0) / vals.length, n: vals.length };
  });
  return {
    picks: posPicks.length, graded: graded.length,
    strengths: tally(graded.map((t) => t.strengths)), weaknesses: tally(graded.map((t) => t.weaknesses)), averages,
  };
}

// mean/SD straight from a percentile table's value counts
// (compSnapshots/pct_{Position}) — the scale findComps puts every
// measurement on.
export function tableStats(table) {
  let n = 0, sum = 0, sq = 0;
  table.v.forEach((x, i) => { n += table.c[i]; sum += x * table.c[i]; });
  const mean = sum / n;
  table.v.forEach((x, i) => { sq += table.c[i] * (x - mean) ** 2; });
  return { mean, sd: n > 1 ? Math.sqrt(sq / (n - 1)) : null };
}
const positionStats = (position, pctTables) => ({
  [position]: { metrics: Object.fromEntries(Object.entries(pctTables || {}).map(([k, t]) => [k, tableStats(t)])) },
});

// A prospect nobody has evaluated gets a placeholder trait so they score as
// "no shared traits" rather than findComps' milder missing-traits penalty —
// otherwise ungraded would outrank graded.
const NO_TRAITS = ["—"];

// Prospect ({ id, ...players doc, community: { strengths, weaknesses } })
// → a findComps candidate. findComps only scores drafted records — a
// placeholder Round lets prospects through (no subjectRound is ever passed,
// so it never affects the score).
function prospectRecord(p, position) {
  const c = p.community;
  const graded = c && (c.strengths.length || c.weaknesses.length);
  return { ...p, Position: position, Round: "1", Strengths: graded ? c.strengths : NO_TRAITS, Weaknesses: graded ? c.weaknesses : [] };
}

// The profile as a findComps input, or null when it has nothing to match on.
function profileInput(profile, position) {
  const values = Object.fromEntries(MATCH_METRICS.filter((k) => profile.averages[k]).map((k) => [k, profile.averages[k].value]));
  const strengths = profile.strengths.slice(0, MATCH_TRAITS);
  const weaknesses = profile.weaknesses.slice(0, MATCH_TRAITS);
  if (!Object.keys(values).length && !strengths.length && !weaknesses.length) return null;
  return {
    position, values,
    strengths: strengths.map(([t]) => t), weaknesses: weaknesses.map(([t]) => t),
    traitCounts: Object.fromEntries([...strengths, ...weaknesses]),
  };
}

// Every prospect scored against one profile, best first: findComps results
// ({ record, similarity, traits, … } — record is the prospect, with its
// players-doc fields). limit null = all of them.
export function scoreProspects(profile, prospects, pctTables, position, { limit = null } = {}) {
  const input = profileInput(profile, position);
  if (!input || !pctTables) return [];
  return findComps(input, prospects.map((p) => prospectRecord(p, position)), positionStats(position, pctTables), {
    heightWindowSd: null, requireTraits: false, limit: limit ?? prospects.length,
  });
}

// One prospect against specific drafted players (pick rows at the same
// position): how closely they resemble each, best first — only players
// with traits on file count, so a match always says something about style
// as well as size. Returns findComps results whose record is the pick row's
// rec plus `pickRow`.
export function matchProspectToPicks(prospect, posPicks, community, latestYear, pctTables, position) {
  const c = prospect.community;
  if (!pctTables || !c || !(c.strengths.length || c.weaknesses.length)) return [];
  const values = Object.fromEntries(MATCH_METRICS.map((k) => {
    const m = STAT_METRICS.find((x) => x.key === k);
    return [k, readMetric(prospect, m).value];
  }).filter(([, v]) => v != null));
  const pool = posPicks.map((p) => {
    const t = pickTraits(p, community, latestYear);
    return { ...p.rec, Position: position, Round: String(p.round || 1), Strengths: t.strengths, Weaknesses: t.weaknesses, pickRow: p };
  });
  return findComps(
    { position, values, strengths: c.strengths, weaknesses: c.weaknesses },
    pool, positionStats(position, pctTables),
    { heightWindowSd: null, requireTraits: true, limit: 3, allowSelectOnly: true }
  );
}

// ── Staff blend ──
// A team's "staff pick" score for a prospect is a weighted average of each
// staffer's fit, renormalized over the staffers who have a profile at that
// position (a coordinator only ever has one on their side of the ball).
export const STAFF_WEIGHTS = { GM: 0.65, HC: 0.2, OC: 0.075, DC: 0.075 };

// fits: [{ slot: "GM" | "HC" | "OC" | "DC", similarity }] → blended score.
export function blendStaffFit(fits) {
  let w = 0, sum = 0;
  fits.forEach(({ slot, similarity }) => {
    const weight = STAFF_WEIGHTS[slot] || 0;
    w += weight;
    sum += weight * similarity;
  });
  return w ? sum / w : null;
}

// Staff slots, in display order, and the current roles that fill each.
export const STAFF_SLOTS = [
  { slot: "GM", label: "General Manager", roles: ["GM"] },
  { slot: "HC", label: "Head Coach", roles: ["HC", "IHC"] },
  { slot: "OC", label: "Offensive Coordinator", roles: ["OC", "CO_OC"] },
  { slot: "DC", label: "Defensive Coordinator", roles: ["DC", "CO_DC"] },
];
const ALL_SCOPES = Object.keys(CREDIT_SCOPES);

// A team's staffers (coaches docs, { id, ...data }) by slot, each with their
// draft credits: [{ slot, label, roles, person, credits }].
export function staffMembers(staff, teamKey, firstYear, latestYear) {
  return STAFF_SLOTS.map((s) => {
    const person = staff.find((p) => (p.Current || []).some((c) => c.Team === teamKey && s.roles.includes(c.Role)));
    return person ? { ...s, person, credits: draftCredits(person.Stints, firstYear, latestYear) } : null;
  }).filter(Boolean);
}

// Each staffer's credited picks out of pick rows (any scope — head coach,
// GM, coordinator or front office years; coordinators only on their side of
// the ball), specialists dropped, each row with its `credit`:
// { [slot]: pickRow[] }.
export function creditedPicksBySlot(members, rows) {
  return Object.fromEntries(members.map((m) => [m.slot, rows
    .map((p) => ({ ...p, credit: creditForPick(m.credits, ALL_SCOPES, p.team, p.year, p.position) }))
    .filter((p) => p.credit && !PROFILE_SKIP.includes(p.position))]));
}

// One position's staff scoring: every staffer with picks there scored
// against the prospects, plus each prospect's blended staff fit.
// → { bySlot: { [slot]: { posPicks, results } }, staff: [{ prospect, score, parts }] }
// (score / parts[].score on the fitScore scale).
export function staffFitsAtPosition(members, bySlot, community, latestYear, prospects, pctTables, position) {
  const fits = {};
  const out = {};
  members.forEach((m) => {
    const posPicks = (bySlot[m.slot] || []).filter((p) => p.position === position);
    if (!posPicks.length) return;
    const results = scoreProspects(buildProfile(posPicks, community, latestYear), prospects, pctTables, position);
    results.forEach((r) => { (fits[r.record.id] || (fits[r.record.id] = [])).push({ slot: m.slot, similarity: r.similarity }); });
    out[m.slot] = { posPicks, results };
  });
  const staff = prospects.filter((p) => fits[p.id]).map((p) => ({
    prospect: p,
    score: fitScore(blendStaffFit(fits[p.id])),
    parts: fits[p.id].map(({ slot, similarity }) => ({ slot, score: fitScore(similarity) })),
  }));
  return { bySlot: out, staff };
}

// ── Prospect-side NFL fits (compSnapshots/_nflFits, nflFit_{Position}) ──
// Every active prospect against all 32 current staffs — the team page's
// Targets tab turned around to one player. Built weekly with the other
// snapshots (utils/snapshotBuilders.js): far too many reads to work out per
// page view.
// prospectsByPos: { [position]: prospect[] } (with .community);
// pctByPos: { [position]: percentile tables }; staff: current coaches docs.
// → { fits: { [playerId]: [{ a: team, s: staff score, GM?, HC?, OC?, DC? }] }
//       — every team with a profile at the prospect's position, best
//       first; slot keys are each staffer's own fit (fitScore scale,
//       rounded),
//     staff: { [team]: { [slot]: { n: name, id: coaches doc id } } },
//     teams: { [team]: { members: [{ slot, id, n, picks }],
//       matches: [{ i: prospect id, sl: slot, pn: staffer, pl: drafted
//         player, y: year, pt: drafting team, r: staffer's role, s, k: pick
//         key }] — every Very Strong-or-better prospect ↔ drafted-player
//         match through that team's staff } } }
// Objects throughout, not arrays of pairs — Firestore has no arrays inside
// arrays.
export const NFL_FIT_MIN = 80;
export function buildProspectTeamFits({ rows, community, staff, teams, prospectsByPos, pctByPos, firstYear, latestYear }) {
  const fits = {};
  const staffByTeam = {};
  const teamDetail = {};
  teams.forEach((team) => {
    const members = staffMembers(staff, team, firstYear, latestYear);
    if (!members.length) return;
    staffByTeam[team] = Object.fromEntries(members.map((m) => [m.slot, { n: m.person.Name, id: m.person.id }]));
    const bySlot = creditedPicksBySlot(members, rows);
    const matches = [];
    Object.entries(prospectsByPos).forEach(([pos, prospects]) => {
      const tables = pctByPos[pos];
      if (PROFILE_SKIP.includes(pos) || !tables) return;
      const { bySlot: scored, staff: blended } = staffFitsAtPosition(members, bySlot, community, latestYear, prospects, tables, pos);
      blended.forEach(({ prospect, score, parts }) => {
        const row = { a: team, s: Math.round(score) };
        parts.forEach((p) => { row[p.slot] = Math.round(p.score); });
        (fits[prospect.id] || (fits[prospect.id] = [])).push(row);
      });
      // One specific player a staffer drafted — each prospect's best match.
      members.forEach((m) => {
        if (!scored[m.slot]) return;
        prospects.forEach((pr) => {
          const best = matchProspectToPicks(pr, scored[m.slot].posPicks, community, latestYear, tables, pos)[0];
          const s = best ? fitScore(best.similarity, "player") : 0;
          if (s < NFL_FIT_MIN) return;
          const pick = best.record.pickRow;
          matches.push({ i: pr.id, sl: m.slot, pn: m.person.Name, pl: pick.player, y: pick.year, pt: pick.team, r: pick.credit.role, s: Math.round(s), k: pick.key });
        });
      });
    });
    teamDetail[team] = {
      members: members.map((m) => ({ slot: m.slot, id: m.person.id, n: m.person.Name, picks: (bySlot[m.slot] || []).length })),
      matches: matches.sort((x, y) => y.s - x.s),
    };
  });
  Object.values(fits).forEach((list) => list.sort((x, y) => y.s - x.s));
  return { fits, staff: staffByTeam, teams: teamDetail };
}

// The player page's slice: { [playerId]: [{ t: team, s }] } — only the
// Very Strong-or-better team fits, best first.
export function nflFitRowsFrom(fits, minScore = NFL_FIT_MIN) {
  const out = {};
  Object.entries(fits).forEach(([id, teams]) => {
    const list = teams.filter((t) => t.s >= minScore).map((t) => ({ t: t.a, s: t.s }));
    if (list.length) out[id] = list;
  });
  return out;
}

// ── Staff pages' draft targets (compSnapshots/_staffTargets) ──
// The credit scope(s) of a staffer's current job(s) — what their staff page
// shows by default: "hc" for a head coach (interim included), "gm" for a GM,
// both for someone holding both.
export const pageScopes = (person) => [...new Set((person?.Current || [])
  .map((c) => (c.Role === "GM" ? "gm" : c.Role === "HC" || c.Role === "IHC" ? "hc" : null))
  .filter(Boolean))];

// Every current head coach's and GM's best-fitting prospects in one class —
// their staff page's Targets profiles (default scopes) scored against
// that class, best first, at most two per position. Feeds the staff page's
// Top Draft Targets section and its meta description.
// → { [coachId]: [{ i: playerId, F, L, P, S: school, sl: slug, s }] }
export const STAFF_TARGETS_KEPT = 5;
const TARGETS_PER_POSITION = 2;
export function buildStaffTargets({ rows, community, staff, prospectsByPos, pctByPos, firstYear, latestYear }) {
  const out = {};
  staff.forEach((person) => {
    const scopes = pageScopes(person);
    if (!scopes.length) return;
    const credits = draftCredits(person.Stints, firstYear, latestYear);
    const credited = rows.filter((p) => !PROFILE_SKIP.includes(p.position) && creditForPick(credits, scopes, p.team, p.year, p.position));
    const all = [];
    Object.entries(prospectsByPos).forEach(([pos, prospects]) => {
      const posPicks = credited.filter((p) => p.position === pos);
      if (!posPicks.length || !pctByPos[pos]) return;
      scoreProspects(buildProfile(posPicks, community, latestYear), prospects, pctByPos[pos], pos)
        .forEach((r) => all.push({ p: r.record, pos, s: fitScore(r.similarity) }));
    });
    const perPos = {};
    const top = [];
    all.sort((a, b) => b.s - a.s).forEach((x) => {
      if (top.length >= STAFF_TARGETS_KEPT || (perPos[x.pos] || 0) >= TARGETS_PER_POSITION) return;
      perPos[x.pos] = (perPos[x.pos] || 0) + 1;
      top.push({ i: x.p.id, F: x.p.First || "", L: x.p.Last || "", P: x.pos, S: x.p.School || "", sl: x.p.Slug, s: Math.round(x.s) });
    });
    if (top.length) out[person.id] = top;
  });
  return out;
}
