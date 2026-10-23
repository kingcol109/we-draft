// src/utils/draftProfileData.js
//
// Firestore loaders behind the draft profiles (utils/draftProfiles.js) —
// shared by StaffPage.jsx, components/ProjectedPicks.jsx and
// NFLTeamPage.jsx. Each one reads its weekly compSnapshots doc first (built
// by utils/snapshotBuilders.js — one read) and falls back to the original
// live queries only when that doc is missing, so a page never breaks for
// want of a snapshot; it just costs more reads. Everything is cached for the
// page session.
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { NFL_TEAMS } from "./coachHistory";
import {
  historicalPickRows, currentPickRows, staffMembers, creditedPicksBySlot, staffFitsAtPosition,
  matchProspectToPicks, fitScore, NFL_FIT_MIN, PROFILE_SKIP,
} from "./draftProfiles";
import { getSiteSnapshot } from "./siteSnapshots";
import { communityFor } from "./communityGrades";

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const once = (cache, key, load) => {
  if (!cache[key]) cache[key] = load().catch((e) => { delete cache[key]; throw e; });
  return cache[key];
};

export const LATEST_DRAFT_YEAR = 2026;
export const FIRST_DRAFT_YEAR = 2000;
export const PROSPECT_YEARS = ["2027", "2028", "2029"];
export const PROFILE_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];

// ── Pick history ──

// Every pick by these teams (abbreviations): `historical` before
// latestYear, plus draftOrder's latestYear draft resolved to players docs.
// The latest class's community traits are baked into each row's rec
// (Strengths/Weaknesses), so callers never need a second lookup.
export async function fetchTeamPickRows(abbrs, latestYear) {
  const names = abbrs.map((a) => NFL_TEAMS[a]).filter(Boolean);
  const nameToAbbr = Object.fromEntries(abbrs.map((a) => [NFL_TEAMS[a], a]));
  const [histSnaps, orderSnaps] = await Promise.all([
    Promise.all(chunk(names, 30).map((c) => getDocs(query(collection(db, "historical"), where("NFL Team", "in", c))))),
    Promise.all(chunk(abbrs, 30).map((c) => getDocs(query(collection(db, "draftOrder"), where("Team", "in", c))))),
  ]);
  const hist = historicalPickRows(histSnaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, data: d.data() }))), nameToAbbr, latestYear);
  const order = orderSnaps.flatMap((s) => s.docs.map((d) => d.data())).filter((o) => typeof o.Selection === "string" && o.Selection.trim());
  const slugs = [...new Set(order.map((o) => o.Selection))];
  const playerSnaps = await Promise.all(chunk(slugs, 30).map((c) => getDocs(query(collection(db, "players"), where("Slug", "in", c)))));
  const bySlug = {};
  playerSnaps.forEach((s) => s.docs.forEach((d) => { const p = { id: d.id, ...d.data() }; bySlug[p.Slug] = p; }));
  const current = currentPickRows(order, bySlug, latestYear);
  const community = current.length ? await communityFor(current.map((p) => p.rec.id)) : {};
  current.forEach((p) => {
    const c = community[p.rec.id];
    p.rec = { ...p.rec, Strengths: c?.strengths || [], Weaknesses: c?.weaknesses || [] };
  });
  return [...hist, ...current];
}

// A staff page's pick rows + the school logos its lists show:
// staffPicks_{coachId}, else every pick by every team in their credits.
// → { rows, schoolLogos } (schoolLogos null on the live path — the page
// looks them up itself then).
const staffPicksCache = {};
export function fetchStaffPickRows(personId, credits) {
  return once(staffPicksCache, personId, async () => {
    const snap = await getSiteSnapshot(`staffPicks_${personId}`);
    if (snap && Array.isArray(snap.rows)) return { rows: snap.rows, schoolLogos: snap.schoolLogos || {} };
    const abbrs = [...new Set(credits.map((c) => c.team))];
    return { rows: abbrs.length ? await fetchTeamPickRows(abbrs, LATEST_DRAFT_YEAR) : [], schoolLogos: null };
  });
}

// ── Prospects ──

// One class's prospects at one position (Live, with a page), each with its
// community traits — prospects_{Position}, else a players query + the
// community grades doc.
const prospectCache = {};
export function fetchProspects(year, position) {
  return once(prospectCache, `${year}|${position}`, async () => {
    const snap = await getSiteSnapshot(`prospects_${position}`);
    if (snap && Array.isArray(snap.rows)) {
      return snap.rows.filter((r) => r.E === String(year)).map((r) => ({
        id: r.i, First: r.F, Last: r.L, Position: position, School: r.S, Eligible: r.E, Slug: r.sl, logo: r.lg || "",
        Height: r.H, Weight: r.W, community: { strengths: r.cs || [], weaknesses: r.cw || [] },
      }));
    }
    const live = await getDocs(query(collection(db, "players"), where("Eligible", "==", year), where("Position", "==", position)));
    const prospects = live.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.Live !== false && p.Slug);
    const community = await communityFor(prospects.map((p) => p.id));
    return prospects.map((p) => ({ ...p, community: community[p.id] }));
  });
}

// Every drafted player's measurement distribution at a position
// (compSnapshots/pct_{Position}), or {} when there's no snapshot.
export function fetchPctTables(position) {
  return getSiteSnapshot(`pct_${position}`).then((snap) => snap?.cutoffs?.all || {});
}

// ── Team Targets ──

// A team page's whole Targets tab: teamTargets_{TEAM} (one read), else the
// same data computed live from the staff's pick history and every active
// prospect. Same shape either way:
// { members: [{ slot, label, picks, person: { id, Name } }],
//   rows: [{ i, F, L, P, S, E, sl, lg, s, GM?, HC?, OC?, DC? }] — every
//     active prospect, best staff fit first,
//   matches: [{ i, sl, pn, pl, y, pt, r, s, k }] } — see
// buildProspectTeamFits in utils/draftProfiles.js.
const SLOT_LABEL = { GM: "General Manager", HC: "Head Coach", OC: "Offensive Coordinator", DC: "Defensive Coordinator" };
const teamTargetsCache = {};
export function fetchTeamTargets(team, staff) {
  return once(teamTargetsCache, team, async () => {
    const snap = await getSiteSnapshot(`teamTargets_${team}`);
    if (snap && Array.isArray(snap.rows)) {
      return {
        members: (snap.members || []).map((m) => ({ slot: m.slot, label: SLOT_LABEL[m.slot], picks: m.picks, person: { id: m.id, Name: m.n } })),
        rows: snap.rows, matches: snap.matches || [], eligible: snap.eligible,
      };
    }
    const live = await teamTargetsLive(team, staff);
    // No staff found = probably not loaded yet — let the next call retry.
    if (!live.members.length) delete teamTargetsCache[team];
    return live;
  });
}

async function teamTargetsLive(team, staff) {
  const members = staffMembers(staff, team, FIRST_DRAFT_YEAR, LATEST_DRAFT_YEAR);
  const abbrs = [...new Set(members.flatMap((m) => m.credits.map((c) => c.team)))];
  const pickRows = abbrs.length ? await fetchTeamPickRows(abbrs, LATEST_DRAFT_YEAR) : [];
  const bySlot = creditedPicksBySlot(members, pickRows);
  const rows = [];
  const matches = [];
  await Promise.all(PROFILE_POSITIONS.filter((pos) => !PROFILE_SKIP.includes(pos)).map(async (pos) => {
    const [tables, lists] = await Promise.all([fetchPctTables(pos), Promise.all(PROSPECT_YEARS.map((y) => fetchProspects(y, pos)))]);
    const prospects = lists.flat();
    if (!prospects.length) return;
    // Traits are already on each rec, so no community map is needed.
    const { bySlot: scored, staff: blended } = staffFitsAtPosition(members, bySlot, {}, LATEST_DRAFT_YEAR, prospects, tables, pos);
    blended.forEach(({ prospect: p, score, parts }) => {
      const row = { i: p.id, F: p.First || "", L: p.Last || "", P: pos, S: p.School || "", E: String(p.Eligible), sl: p.Slug, lg: p.logo || "", s: Math.round(score) };
      parts.forEach((x) => { row[x.slot] = Math.round(x.score); });
      rows.push(row);
    });
    members.forEach((m) => {
      if (!scored[m.slot]) return;
      prospects.forEach((pr) => {
        const best = matchProspectToPicks(pr, scored[m.slot].posPicks, {}, LATEST_DRAFT_YEAR, tables, pos)[0];
        const s = best ? fitScore(best.similarity, "player") : 0;
        if (s < NFL_FIT_MIN) return;
        const pick = best.record.pickRow;
        matches.push({ i: pr.id, sl: m.slot, pn: m.person.Name, pl: pick.player, y: pick.year, pt: pick.team, r: pick.credit.role, s: Math.round(s), k: pick.key });
      });
    });
  }));
  return {
    members: members.map((m) => ({ slot: m.slot, label: m.label, picks: (bySlot[m.slot] || []).length, person: { id: m.person.id, Name: m.person.Name } })),
    rows: rows.sort((a, b) => b.s - a.s), matches: matches.sort((a, b) => b.s - a.s), eligible: PROSPECT_YEARS[0],
  };
}

// ── Shared lookups ──

// NFL team branding { [abbr]: { City, Team, Color1, Color2, Logo1, LogoDark, Wordmark, WordmarkDark } }
// — _nflBranding, else the 32 nfl docs.
const lookupCache = {};
export function fetchNflBranding() {
  return once(lookupCache, "branding", async () => {
    const snap = await getSiteSnapshot("_nflBranding");
    if (snap?.teams) return snap.teams;
    const live = await getDocs(collection(db, "nfl"));
    return Object.fromEntries(live.docs.map((d) => [d.id, d.data()]));
  });
}

// Current coaches [{ id, Name, Current }] — _staffRail, else the coaches query.
export function fetchCurrentStaff() {
  return once(lookupCache, "staff", async () => {
    const snap = await getSiteSnapshot("_staffRail");
    if (snap && Array.isArray(snap.rows)) return snap.rows;
    const live = await getDocs(query(collection(db, "coaches"), where("Status", "==", "current")));
    return live.docs.map((d) => ({ id: d.id, ...d.data() }));
  });
}
