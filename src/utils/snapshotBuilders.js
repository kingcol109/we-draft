// src/utils/snapshotBuilders.js
//
// Builds every precomputed doc in `compSnapshots` — the read-saving
// snapshots the public pages load instead of scanning whole collections on
// every visit. Pure: takes plain arrays, returns [{ id, data }], touches no
// Firestore SDK — so the exact same build runs from both places that write
// them:
//   - the admin "Rebuild Site Snapshots" button (AdminPanel.js's
//     CompSnapshotRebuild, client SDK), and
//   - the weekly scheduled job (scripts/buildSiteSnapshots.mjs, Admin SDK,
//     .github/workflows/build-site-snapshots.yml).
// Each caller only does its own fetching + writing (adding builtAt).
//
// Docs produced (all carry version: COMP_SNAPSHOT_VERSION — readers ignore
// a doc from a different version and fall back to live reads):
//   {Position}              Comparison.js comp pool — every drafted player
//                           at the position (see encodeCompSnapshotRows).
//   _search                 Comparison.js prospect search box list.
//   class_{Eligible}_{Pos}  Class sidebar lists (PlayerProfile.js +
//                           Comparison.js): Live players only, already in
//                           ranked order, each row with avg community
//                           grade (g), overall class rank (cr), school
//                           logo (lg), an OL/DB's sub-position (sp —
//                           OT / IOL / CB / S: SubPositionOverride, else
//                           SubPosition), and height in inches (ht) and
//                           weight (wt) when known — the Draft Sim's
//                           specific needs size players with them;
//                           classSize on the doc; `hidden` holds
//                           each not-Live player's own-page placement
//                           plus his name/school/size (the Draft Sim's
//                           Expanded Board).
//                           The latest drafted class's docs are instead
//                           ordered by draft pick (order: "draft"), each
//                           row adding rd/pk (round, overall pick), tm
//                           (team abbreviation), tl (team logo) — drafted
//                           players first in pick order, then undrafted
//                           ones in grade order.
//   pct_{Position}          Percentile tables for the player page's
//                           measurement pills (see encodePercentileTable):
//                           cutoffs.all = every drafted player at the
//                           position; cutoffs[latestDraftYear] = classes
//                           before it, so the latest class's own pages
//                           aren't ranked against themselves (same rule
//                           Comparison.js applies).
//   _ads                    Homage margin ads (PlayerProfile.js,
//                           MarginAds.js).
//   _draftTicker            Navbar ticker's draft-pick lines.
//   _grades                 Every player's community grade + traits: rows
//                           { [playerId]: [avg, count, "s1|s2|s3",
//                           "w1|w2|w3"] } (graded players only; top 3
//                           traits each, "|"-joined since Firestore has no
//                           arrays inside arrays) — read through
//                           utils/communityGrades.js instead of one
//                           evaluations query per player.
//   _top                    Top TOP_PER_CLASS graded Live prospects per
//                           active class, best first: years { [Eligible]:
//                           [{ i, F, L, P, S, E, sl, g }] } — the home page
//                           boards and the margin sidebar's leaderboard.
//   _nflFits                Player pages' "We-Draft.com NFL Fit" card:
//                           rows { [playerId]: [{ t: team, s: score }, …] } —
//                           every active prospect's Very Strong-or-better
//                           staff fits (utils/draftProfiles.js
//                           buildProspectTeamFits). Only built when the
//                           caller passes `coaches`.
//   nflFit_{Position}       Comparison.js's NFL Fit tab: rows
//                           { [playerId]: [{ a: team, s, GM, HC, OC, DC }] }
//                           — every active prospect at the position against
//                           all 32 staffs — plus staff { [team]: { [slot]:
//                           { n, id } } } for the names (see
//                           buildProspectTeamFits). Also only with `coaches`.
//   _staffTargets           Staff pages' Top Draft Targets + meta
//                           description: rows { [coachId]: [{ i, F, L, P,
//                           S, sl, s }] } — each current head coach's and
//                           GM's best fits in the next class (see
//                           buildStaffTargets). Also only with `coaches`.
//   teamTargets_{TEAM}      NFL team page's Targets tab (+ its SEO): members
//                           [{ slot, id, n, picks }], rows [{ i, F, L, P, S,
//                           E, sl, lg, s, GM, HC, OC, DC }] (every active
//                           prospect, best staff fit first), matches
//                           [{ i, sl, pn, pl, y, pt, r, s, k }]. Only with
//                           `coaches`, like everything below.
//   prospects_{Position}    Staff pages' Targets matching: rows [{ i, F, L,
//                           S, E, sl, lg, H, W, cs, cw }] (cs/cw: community
//                           strengths/weaknesses, top 3).
//   staffPicks_{coachId}    Staff page pick history: rows (pick rows, rec
//                           trimmed to measurements + traits) + schoolLogos.
//   _staffRail              Current coaches { id, Name, Current } for the
//                           staff pages' side rail.
//   _nflBranding            teams { [abbr]: { City, Team, Color1, Color2,
//                           Logo1, LogoDark, Wordmark, WordmarkDark } }.
//   _meta                   Summary for the admin panel.
// _grades and _top are also rebuilt on their own, more often, by
// scripts/buildGradeSnapshots.mjs (buildGradeSnapshotDocs below) so
// community grades don't wait for the weekly full build.
import {
  COMP_SNAPSHOT_VERSION, encodeCompSnapshotRows, draftedPlayersAsHistorical,
  communityTraits, isGraded, positionPercentileTables,
} from "./historicalStats.js";
import { communityAverage, countedGrades } from "./gradeWindow.js";
import { NFL_TEAMS, NFL_TEAM_ABBRS, draftCredits, creditForPick } from "./coachHistory.js";
import { historicalPickRows, currentPickRows, buildProspectTeamFits, nflFitRowsFrom, buildStaffTargets, pageScopes } from "./draftProfiles.js";

// Same scale PlayerProfile.js / Comparison.js rank the class list by.
const GRADE_SCALE = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
const GRADE_LABELS = Object.fromEntries(Object.entries(GRADE_SCALE).map(([label, v]) => [v, label]));

// A player's Height ("6'1\"", "6-1", or plain inches like "73.5") → inches.
function heightInches(h) {
  if (h == null || h === "") return null;
  const m = String(h).match(/^\s*(\d)\s*['-]\s*(\d{1,2}(?:\.\d+)?)/);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  const n = parseFloat(h);
  return n > 48 && n < 96 ? n : null;
}

// A player's community grade — only the grades that count for his class
// (utils/gradeWindow.js: 2027 and 2028 count grades saved since Aug 2026).
export function averageGrade(evaluations, eligible) {
  return communityAverage(evaluations, eligible, GRADE_SCALE);
}

// PlayerProfile.js's class ranking, exactly: sort by the *rounded* grade
// label's scale value, ungraded last, ties left in input order (callers
// pass players in Firestore's natural document-ID order, which is what the
// live query returns — Array.prototype.sort is stable, so that order
// survives for ties).
export function rankByGrade(list, gradeOf = (x) => x.avgGrade) {
  const rank = (x) => { const g = gradeOf(x); return g != null ? GRADE_SCALE[GRADE_LABELS[Math.round(g)]] : null; };
  return list.sort((a, b) => {
    const aV = rank(a), bV = rank(b);
    if (aV && bV) return aV - bV;
    if (aV && !bV) return -1;
    if (!aV && bV) return 1;
    return 0;
  });
}

const TOP_PER_CLASS = 25;
// Live values the home page boards have always treated as hidden.
const HIDDEN_LIVE = [false, null, 0, "false", "no"];

/**
 * The two grade docs (_grades, _top) on their own — shared by the full
 * build below and scripts/buildGradeSnapshots.mjs.
 * @param {object} input
 * @param {object[]} input.players          every players doc, { id, ...data }
 * @param {object}   input.evalsByPlayerId  { [playerId]: evaluation data[] }
 * @param {string[]} input.activeYears      e.g. ["2027","2028","2029"]
 */
export function buildGradeSnapshotDocs({ players, evalsByPlayerId, activeYears }) {
  const version = COMP_SNAPSHOT_VERSION;
  const rows = {};
  const avgById = {};
  players.forEach((p) => {
    const evals = evalsByPlayerId[p.id] || [];
    const avg = averageGrade(evals, p.Eligible);
    // Traits come from every evaluation; a player whose only grades are from
    // before the refresh keeps his traits with no grade (avg null).
    const { strengths, weaknesses } = communityTraits(evals);
    if (avg == null && !strengths.length && !weaknesses.length) return;
    if (avg != null) avgById[p.id] = avg;
    rows[p.id] = [avg == null ? null : Math.round(avg * 1000) / 1000, countedGrades(evals, p.Eligible, GRADE_SCALE).length, strengths.slice(0, 3).join("|"), weaknesses.slice(0, 3).join("|")];
  });
  const years = {};
  activeYears.forEach((yr) => {
    const graded = [...players].sort(byDocId)
      .filter((p) => String(p.Eligible) === String(yr) && !HIDDEN_LIVE.includes(p.Live) && p.Slug && avgById[p.id] != null);
    years[yr] = rankByGrade(graded, (p) => avgById[p.id]).slice(0, TOP_PER_CLASS).map((p) => ({
      i: p.id, F: p.First || "", L: p.Last || "", P: p.Position || "", S: p.School || "", E: String(p.Eligible), sl: p.Slug, g: avgById[p.id],
    }));
  });
  return [
    { id: "_grades", data: { version, rows } },
    { id: "_top", data: { version, years } },
  ];
}

// Firestore returns documents in ascending document-ID order (byte-wise);
// a plain JS string comparison matches that for these ASCII auto-ids.
const byDocId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param {object} input
 * @param {object[]} input.historical   historical docs' data
 * @param {object[]} input.players      every players doc, { id, ...data }
 * @param {object[]} input.draftOrder   draftOrder docs' data
 * @param {object}   input.evalsByPlayerId  { [playerId]: evaluation data[] }
 * @param {object[]} input.schools      schools docs' data
 * @param {object[]} input.ads          ads docs' data
 * @param {object[]} [input.nflTeams]   nfl docs, { id: abbreviation, ...data }
 *                                       (team logos for the drafted class's
 *                                       class lists)
 * @param {object[]} [input.coaches]  current coaches docs, { id, ...data }
 *                                       (staff for _nflFits; skipped without)
 * @param {string}   input.latestDraftYear  e.g. "2026"
 * @param {string[]} input.activeYears  e.g. ["2027","2028","2029"]
 */
export function buildSiteSnapshotDocs({ historical, players, draftOrder, evalsByPlayerId, schools, ads, nflTeams = [], coaches = null, latestDraftYear, activeYears }) {
  const docs = [];
  const version = COMP_SNAPSHOT_VERSION;
  const evalsOf = (id) => evalsByPlayerId[id] || [];

  // ── Comp pools: historical + the latest drafted class (community traits) ──
  const latestRows = draftedPlayersAsHistorical(
    players.filter((p) => String(p.Eligible) === String(latestDraftYear)),
    draftOrder,
    latestDraftYear
  ).map((r) => {
    const { strengths, weaknesses } = communityTraits(evalsOf(r.id));
    return { ...r, Strengths: strengths, Weaknesses: weaknesses };
  });
  const pool = [...historical.filter((r) => String(r.Year) !== String(latestDraftYear)), ...latestRows];
  const positions = [...new Set(pool.map((r) => r.Position).filter(Boolean))].sort();
  const positionSummary = {};
  const pctByPos = {};
  positions.forEach((pos) => {
    const rows = encodeCompSnapshotRows(pool.filter((r) => r.Position === pos));
    positionSummary[pos] = { rows: rows.length, graded: rows.filter((r) => r.S).length };
    docs.push({ id: pos, data: { version, position: pos, rows } });
    const posPool = pool.filter((r) => r.Position === pos);
    pctByPos[pos] = positionPercentileTables(posPool);
    docs.push({
      id: `pct_${pos}`,
      data: {
        version, position: pos,
        cutoffs: {
          all: pctByPos[pos],
          [String(latestDraftYear)]: positionPercentileTables(posPool.filter((r) => Number(r.Year) < Number(latestDraftYear))),
        },
      },
    });
  });

  // ── Prospect search index ──
  const searchRows = players
    .filter((p) => activeYears.includes(String(p.Eligible)) && p.Slug)
    .sort((a, b) => `${a.Last || ""} ${a.First || ""}`.localeCompare(`${b.Last || ""} ${b.First || ""}`))
    .map((p) => ({ i: p.id, F: p.First || "", L: p.Last || "", P: p.Position || "", S: p.School || "", E: String(p.Eligible || ""), sl: p.Slug }));
  docs.push({ id: "_search", data: { version, rows: searchRows } });

  // ── Class lists (ranked, with overall class rank + size) ──
  // A not-Live player's own page still shows the sidebar with *them*
  // slotted in (PlayerProfile.js ranks the Live class + self), but they're
  // not in anyone else's list — so each one gets a precomputed placement in
  // its group doc's `hidden` map: { cr: overall rank with them added, pi:
  // their index in the position list, g, lg }. classSize on the doc is the
  // Live count; their page adds 1.
  const logoBySchool = Object.fromEntries(schools.filter((s) => s.School).map((s) => [s.School, s.Logo1 || ""]));
  const darkLogoBySchool = Object.fromEntries(schools.filter((s) => s.School).map((s) => [s.School, s.LogoBlack || s.LogoDark || s.Logo1 || ""]));
  const avgGradeById = {};
  const byClass = {};
  const hiddenByClass = {};
  [...players].sort(byDocId).forEach((p) => {
    if (!p.Eligible) return;
    avgGradeById[p.id] = averageGrade(evalsOf(p.id), p.Eligible);
    const bucket = p.Live === false ? hiddenByClass : byClass;
    (bucket[String(p.Eligible)] || (bucket[String(p.Eligible)] = [])).push(p);
  });
  const gradeOf = (p) => avgGradeById[p.id];
  let classListCount = 0;
  [...new Set([...Object.keys(byClass), ...Object.keys(hiddenByClass)])].forEach((eligible) => {
    const classPlayers = byClass[eligible] || [];
    const ranked = rankByGrade([...classPlayers], gradeOf);
    const classSize = ranked.length;
    const groups = {};
    const group = (pos) => groups[pos] || (groups[pos] = { rows: [], hidden: {} });
    ranked.forEach((p, idx) => {
      if (!p.Position) return;
      group(p.Position).rows.push({
        i: p.id, F: p.First || "", L: p.Last || "", s: p.School || "", sl: p.Slug || "",
        g: gradeOf(p), cr: idx + 1, lg: logoBySchool[p.School] || "", ld: darkLogoBySchool[p.School] || "",
        ...((p.SubPositionOverride || p.SubPosition) ? { sp: p.SubPositionOverride || p.SubPosition } : {}),
        ...(heightInches(p.Height) ? { ht: heightInches(p.Height) } : {}),
        ...(parseFloat(p.Weight) > 0 ? { wt: parseFloat(p.Weight) } : {}),
      });
    });
    (hiddenByClass[eligible] || []).forEach((self) => {
      if (!self.Position) return;
      const withSelf = rankByGrade([...classPlayers, self].sort(byDocId), gradeOf);
      group(self.Position).hidden[self.id] = {
        cr: withSelf.indexOf(self) + 1,
        pi: withSelf.filter((p) => p.Position === self.Position).indexOf(self),
        g: gradeOf(self),
        lg: logoBySchool[self.School] || "",
        F: self.First || "", L: self.Last || "", s: self.School || "", sl: self.Slug || "", ld: darkLogoBySchool[self.School] || "",
        ...((self.SubPositionOverride || self.SubPosition) ? { sp: self.SubPositionOverride || self.SubPosition } : {}),
        ...(heightInches(self.Height) ? { ht: heightInches(self.Height) } : {}),
        ...(parseFloat(self.Weight) > 0 ? { wt: parseFloat(self.Weight) } : {}),
      };
    });
    const isDraftedClass = eligible === String(latestDraftYear);
    if (isDraftedClass) {
      const pickBySlug = Object.fromEntries(draftOrder.filter((d) => d.Selection).map((d) => [d.Selection, d]));
      const teamLogo = Object.fromEntries(nflTeams.map((t) => [t.id, t.Logo1 || t.LogoDark || ""]));
      const slugById = Object.fromEntries(players.map((p) => [p.id, p.Slug]));
      // Drafted first by overall pick, undrafted after in their existing
      // (grade) order — ties can't happen between real picks.
      const orderKey = (id, fallbackIdx) => { const d = pickBySlug[slugById[id]]; return d ? Number(d.Pick) : 100000 + fallbackIdx; };
      Object.values(groups).forEach((g) => {
        g.rows.forEach((r) => {
          const d = pickBySlug[r.sl];
          if (d) { r.rd = Number(d.Round); r.pk = Number(d.Pick); r.tm = d.Team || ""; r.tl = teamLogo[d.Team] || ""; }
        });
        const keyed = g.rows.map((r, idx) => ({ r, k: orderKey(r.i, idx) }));
        keyed.sort((a, b) => a.k - b.k);
        g.rows = keyed.map((x) => x.r);
        Object.entries(g.hidden).forEach(([id, h]) => {
          const d = pickBySlug[slugById[id]];
          if (d) { h.rd = Number(d.Round); h.pk = Number(d.Pick); h.tm = d.Team || ""; h.tl = teamLogo[d.Team] || ""; }
          const selfKey = orderKey(id, h.pi);
          h.pi = keyed.filter((x) => x.k < selfKey).length;
        });
      });
    }
    Object.entries(groups).forEach(([pos, { rows, hidden }]) => {
      classListCount += 1;
      docs.push({ id: `class_${eligible}_${pos}`, data: { version, eligible, position: pos, classSize, rows, hidden, ...(isDraftedClass ? { order: "draft" } : {}) } });
    });
  });

  // ── Ads (only complete, unpaused ones, same filter every reader applies) ──
  // teamLogos: { [abbr]: Logo1 } for the NFL team picker under the cards.
  docs.push({ id: "_ads", data: {
    version,
    rows: ads.filter((a) => a.Active !== false && a.Link && a.Image1),
    teamLogos: Object.fromEntries(nflTeams.map((t) => [t.id, t.Logo1 || t.LogoDark || ""]).filter(([, l]) => l)),
  } });

  // ── Navbar ticker's draft lines: rounds 1-2 in pick order, same text ──
  const parts = [];
  let currentRound = null;
  draftOrder
    .filter((p) => Number(p.Round) <= 2)
    .sort((a, b) => Number(a.Round) - Number(b.Round) || Number(a.Pick) - Number(b.Pick))
    .forEach((p) => {
      if (p.Round !== currentRound) { currentRound = p.Round; parts.push(`ROUND ${currentRound}`); }
      parts.push(p.Selection ? `PICK ${p.Pick}: ${p.Team} ${p.Selection.toUpperCase()}` : `PICK ${p.Pick}: ${p.Team}`);
    });
  docs.push({ id: "_draftTicker", data: { version, parts } });

  docs.push(...buildGradeSnapshotDocs({ players, evalsByPlayerId, activeYears }));

  // ── Player-page NFL fits ──
  // Same inputs the team page's Targets tab reads live: every pick row,
  // community traits as _grades stores them (top 3 each way), and the
  // active prospects by position.
  let nflFitPlayers = null;
  if (coaches) {
    const latest = Number(latestDraftYear);
    const community = {};
    const top3 = (id) => {
      const { strengths, weaknesses } = communityTraits(evalsOf(id));
      return { strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3) };
    };
    const nameToAbbr = Object.fromEntries(Object.entries(NFL_TEAMS).map(([abbr, name]) => [name, abbr]));
    const bySlug = Object.fromEntries(players.filter((p) => p.Slug).map((p) => [p.Slug, p]));
    const order = draftOrder.filter((o) => typeof o.Selection === "string" && o.Selection.trim());
    const rows = [
      ...historicalPickRows(historical.map((h) => ({ id: h.id, data: h })), nameToAbbr, latest),
      ...currentPickRows(order, bySlug, latest),
    ];
    rows.forEach((p) => { if (p.year === latest && p.rec?.id) community[p.rec.id] = top3(p.rec.id); });
    const prospectsByPos = {};
    players
      .filter((p) => activeYears.includes(String(p.Eligible)) && p.Live !== false && p.Slug && p.Position)
      .forEach((p) => { (prospectsByPos[p.Position] || (prospectsByPos[p.Position] = [])).push({ ...p, community: top3(p.id) }); });
    const { fits, staff: fitStaff, teams: teamDetail } = buildProspectTeamFits({
      rows, community, staff: coaches, teams: NFL_TEAM_ABBRS, prospectsByPos, pctByPos, firstYear: 2000, latestYear: latest,
    });
    const fitRows = nflFitRowsFrom(fits);
    nflFitPlayers = Object.keys(fitRows).length;
    docs.push({ id: "_nflFits", data: { version, rows: fitRows } });
    Object.keys(prospectsByPos).forEach((pos) => {
      const posRows = {};
      prospectsByPos[pos].forEach((p) => { if (fits[p.id]) posRows[p.id] = fits[p.id]; });
      if (Object.keys(posRows).length) docs.push({ id: `nflFit_${pos}`, data: { version, position: pos, rows: posRows, staff: fitStaff } });
    });
    // ── Team pages' Targets tab, precomputed: every active prospect's staff
    // fit for the team (with each staffer's part), its draft-history
    // matches, and the staff strip — the page filters by class/position and
    // ranks from here instead of querying players + history live.
    const logoOf = (school) => logoBySchool[school] || "";
    const prospectById = {};
    Object.values(prospectsByPos).flat().forEach((p) => { prospectById[p.id] = p; });
    const perTeam = {};
    Object.entries(fits).forEach(([id, teamsFit]) => {
      teamsFit.forEach((t) => { (perTeam[t.a] || (perTeam[t.a] = [])).push({ id, t }); });
    });
    Object.entries(teamDetail).forEach(([team, detail]) => {
      const rowsForTeam = (perTeam[team] || []).map(({ id, t }) => {
        const p = prospectById[id];
        const { a: _team, ...scores } = t;
        return { i: id, F: p.First || "", L: p.Last || "", P: p.Position || "", S: p.School || "", E: String(p.Eligible), sl: p.Slug, lg: logoOf(p.School), ...scores };
      }).sort((x, y) => y.s - x.s);
      docs.push({ id: `teamTargets_${team}`, data: { version, team, eligible: String(activeYears[0]), members: detail.members, rows: rowsForTeam, matches: detail.matches } });
    });

    // ── Prospects by position — what the staff pages' Targets matching
    // needs about each active prospect (height, weight, community traits,
    // school logo), instead of a players query + the _grades doc. ──
    Object.entries(prospectsByPos).forEach(([pos, list]) => {
      docs.push({ id: `prospects_${pos}`, data: { version, position: pos, rows: list.map((p) => ({
        i: p.id, F: p.First || "", L: p.Last || "", S: p.School || "", E: String(p.Eligible), sl: p.Slug, lg: logoOf(p.School),
        H: p.Height ?? null, W: p.Weight ?? null, cs: p.community.strengths, cw: p.community.weaknesses,
      })) } });
    });

    // ── Staff pages' pick history: each current head coach's / GM's
    // credited picks (any scope — the page's role toggles filter further),
    // trimmed to what the page reads, plus the school logos its lists show.
    // Replaces querying every pick of every team they've worked for. ──
    const KEEP = ["Height", "Weight", "Arm Length", "Hand Size", "40 Yard ", "40 Yard", "Vertical", "Broad", "Bench", "3-Cone", "Shuttle"];
    const trimRec = (p) => {
      const rec = {};
      KEEP.forEach((k) => { if (p.rec?.[k] != null && p.rec[k] !== "") rec[k] = p.rec[k]; });
      // The latest class's traits are the community's (no admin grade yet).
      const c = p.year === latest ? community[p.rec?.id] : null;
      const S = c ? c.strengths : p.rec?.Strengths;
      const W = c ? c.weaknesses : p.rec?.Weaknesses;
      if (Array.isArray(S) && S.length) rec.Strengths = S;
      if (Array.isArray(W) && W.length) rec.Weaknesses = W;
      return rec;
    };
    const ALL_CREDIT_SCOPES = ["hc", "gm", "coordinator", "frontOffice"];
    coaches.filter((person) => pageScopes(person).length).forEach((person) => {
      const credits = draftCredits(person.Stints, 2000, latest);
      const mine = rows.filter((p) => creditForPick(credits, ALL_CREDIT_SCOPES, p.team, p.year, p.position));
      const schoolLogos = {};
      mine.forEach((p) => { if (p.school && !(p.school in schoolLogos)) schoolLogos[p.school] = logoOf(p.school); });
      docs.push({ id: `staffPicks_${person.id}`, data: { version, rows: mine.map((p) => ({
        key: p.key, year: p.year, team: p.team, round: p.round, pick: p.pick, player: p.player,
        position: p.position, school: p.school, slug: p.slug, rec: trimRec(p),
      })), schoolLogos } });
    });

    // ── Small shared lookups: current staff (staff pages' side rail) and
    // NFL team branding (staff pages, the team directory rail). ──
    docs.push({ id: "_staffRail", data: { version, rows: coaches.map((p) => ({ id: p.id, Name: p.Name || "", Current: p.Current || [] })) } });
    docs.push({ id: "_nflBranding", data: { version, teams: Object.fromEntries(nflTeams.map((t) => [t.id, {
      City: t.City || "", Team: t.Team || "", Color1: t.Color1 || "", Color2: t.Color2 || "", Logo1: t.Logo1 || "", LogoDark: t.LogoDark || "",
      Wordmark: t.Wordmark || "", WordmarkDark: t.WordmarkDark || "",
    }])) } });

    // The next class only (activeYears[0]) — the one a staff is drafting from.
    const nextClass = Object.fromEntries(Object.entries(prospectsByPos)
      .map(([pos, list]) => [pos, list.filter((p) => String(p.Eligible) === String(activeYears[0]))]));
    docs.push({ id: "_staffTargets", data: {
      version, eligible: String(activeYears[0]),
      rows: buildStaffTargets({ rows, community, staff: coaches, prospectsByPos: nextClass, pctByPos, firstYear: 2000, latestYear: latest }),
    } });
  }

  const gradedComps = Object.values(positionSummary).reduce((a, s) => a + s.graded, 0);
  docs.push({
    id: "_meta",
    data: {
      version, positions: positionSummary, searchRows: searchRows.length, classLists: classListCount,
      ads: ads.length, gradedComps, gradedHistorical: historical.filter(isGraded).length,
      ...(nflFitPlayers != null ? { nflFitPlayers } : {}),
    },
  });
  return docs;
}

// Writers commit the docs in chunks: a whole build is several MB, and one
// Firestore commit is capped at 10 MiB / 500 writes. → [[{ id, data }]]
export const SNAPSHOT_COMMIT_BYTES = 3 * 1024 * 1024;
export function snapshotCommitChunks(docs, maxBytes = SNAPSHOT_COMMIT_BYTES, maxDocs = 400) {
  const chunks = [];
  let cur = [];
  let bytes = 0;
  docs.forEach((d) => {
    const size = JSON.stringify(d.data).length;
    if (cur.length && (bytes + size > maxBytes || cur.length >= maxDocs)) { chunks.push(cur); cur = []; bytes = 0; }
    cur.push(d);
    bytes += size;
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}
