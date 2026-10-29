// src/utils/teamNeedSuggestions.js
//
// Suggested team needs — what Admin → Mock Draft → Team Needs' "Suggest
// changes" proposes for each team's positions, for the admin to accept or
// dismiss (the labels themselves are the admin's: nflTeamNeeds/{abbr}).
// Pure: takes the PFF NFL depth charts (pffNflRosters/{abbr}, admin-only —
// scripts/syncPffNflRosters.js) and who's injured (ESPN rosters), returns
// suggestions. PFF numbers in the reasons are for the back office only.
//
// A position is judged on its starters (the top `starters` players by
// season snaps, snap-weighted grade and age), ranked against the league:
//   Upgrade Needed  starters rank 28th or worse, or grade under 50
//   Upgrade Wanted  starters rank 20th–27th
//   Aging Talent    starters rank top 19, but their snap-weighted age is at
//                   or past the position's `old` age
//   Depth Needed    starters are fine, but fewer than `backups` backups
//                   have played real snaps at a 60+ grade
//   Crowded Room    starters rank top 16 and at least `crowd` backups have
//                   played real snaps at a 65+ grade
//   Set             otherwise
// Expiring Contract is never suggested — there's no contract data.
//
// Player tags (the admin's, utils/depthNotes.js — nflPlayerTags, by PFF
// id, so they follow a player to a new team) come first where they're set.
// Once any of a position's starters is tagged, its upgrade call goes by
// talent tier instead of league rank (tagUpgrade) — an untagged starter
// beside him counts at the tier his PFF grade suggests (gradeTier):
//   one starter (QB, RB, TE): Plus Starter or better — no upgrade (a
//     Franchise / Difference Maker quarterback is never Upgrade Needed or
//     Wanted); Average Starter — Upgrade Wanted; a depth player — Needed.
//   several: fewer than all-but-one of them Plus Starter or better —
//     Upgrade Needed (one good receiver and two average ones), or Wanted
//     when it's two starters and neither's below average; else a starter
//     tagged as depth — Upgrade Wanted (two good receivers, the third
//     depth); else no upgrade (two good and an average third — Set).
// The admin's depth order (depthNotes.js nflDepthNotes order — starters
// set in Research) picks a position's starters when there is one: the first
// `starters` of the players in it, in order; otherwise the most snaps do.
// Aging, depth and a crowded room are judged after that as before, but a
// tagged backup counts by his tags: High-End Depth or better, or a
// High-End Developmental player, is a real backup (no Depth Needed for a
// raw but promising one); Average Starter or better, a starter-quality one.
//
// Roles (engine ROLES — 3rd Down RB, Slot Corner…) go by the admin's role
// tags (nflPlayerTags roles) when any of a team's players has the role:
// its man is the first of them in the role's own order (nflDepthNotes
// roleOrder), else in the depth order, else the most talented
// (his talent tier, or his PFF grade's), else the most snaps — and the
// call is a one-starter position's by his tier (tagUpgrade), then Aging
// Talent (the parent's age line), else Set. With nobody tagged, PFF's read
// stands in (ROLE_DETECT: the players PFF lines up there, or who fit it by
// size or depth of target, most snaps first), graded on the sub-grade
// that role is about (receiving and pass blocking for a 3rd down back,
// pass rush for a pass rusher, coverage for a sub linebacker…), ranked
// against the league: Upgrade Needed / Upgrade Wanted / Aging Talent /
// Set — no depth or crowded-room calls for a single role. A team with
// nobody in a role is Upgrade Needed, same as an empty position.
//
// Injuries: a player PFF has dropped off the depth chart who's still on
// the team's ESPN roster as injured (IR / out / PUP) counts as healthy —
// the draft is months away — so a hurt starter doesn't read as a hole.
// Each suggestion also carries what the position looks like without him
// (`without`), so the admin can judge a long-term or career-threatening
// injury differently.
import { depthNameKey, initialKey } from "./nflRoster";
import { ROLES } from "./draftSim/engine";

// starters: how many of the group's top players by snaps start; old: the
// starters' age where the group counts as aging; backups: how many proven
// backups it should carry; crowd: how many starter-quality backups make the
// room crowded. OL and DB are split (OT / G / C, CB / S) so a team that
// needs a corner isn't marked as needing "a DB" and handed a safety.
export const NEED_POSITIONS = [
  { key: "QB", pos: ["QB"], starters: 1, old: 35, backups: 0, crowd: 1 },
  { key: "RB", pos: ["HB", "FB"], starters: 1, old: 28, backups: 1, crowd: 2 },
  { key: "WR", pos: ["WR"], starters: 3, old: 30, backups: 1, crowd: 2 },
  { key: "TE", pos: ["TE"], starters: 1, old: 31, backups: 1, crowd: 2 },
  { key: "OT", pos: ["T"], starters: 2, old: 31, backups: 1, crowd: 2 },
  { key: "G", pos: ["G"], starters: 2, old: 31, backups: 1, crowd: 2 },
  { key: "C", pos: ["C"], starters: 1, old: 31, backups: 1, crowd: 1 },
  { key: "IDL", pos: ["DI"], starters: 2, old: 31, backups: 1, crowd: 2 },
  { key: "EDGE", pos: ["ED"], starters: 2, old: 30, backups: 1, crowd: 2 },
  { key: "LB", pos: ["LB"], starters: 2, old: 30, backups: 1, crowd: 2 },
  { key: "CB", pos: ["CB"], starters: 3, old: 29, backups: 1, crowd: 2 },
  { key: "S", pos: ["S"], starters: 2, old: 30, backups: 1, crowd: 2 },
];
const EXTREME_RANK = 28;
const TALENT_RANK = 20;
const EXTREME_GRADE = 50;
const BACKUP_GRADE = 60;
const MIN_BACKUP_SNAPS = 15;
const CROWDED_RANK = 16;
const CROWDED_GRADE = 65;
// An injured player only matters if he was really playing (% of snaps).
const INJURED_MIN_SNAP_PCT = 20;

// Talent tiers (depthNotes.js TALENT_TAGS — kept here too, so this stays
// pure): Franchise 7 … Low-End Depth 1.
const TIER = { franchise: 7, difference: 6, plus: 5, average: 4, highDepth: 3, avgDepth: 2, lowDepth: 1 };
const TIER_LABEL = { franchise: "Franchise", difference: "Difference Maker", plus: "Plus Starter", average: "Average Starter", highDepth: "High-End Depth", avgDepth: "Average Depth", lowDepth: "Low-End Depth" };
const PLUS_STARTER = 5;
const STARTER = 4;
const REAL_BACKUP = 3;
// An untagged player's likely tier from his PFF grade.
export const gradeTier = (g) => (g == null ? 2 : g >= 85 ? 6 : g >= 76 ? 5 : g >= 66 ? 4 : g >= 56 ? 3 : g >= 45 ? 2 : 1);
const tierOf = (p, tags) => TIER[tags[p.id]?.talent] ?? null;

// A position's upgrade call from its starters' tiers (best to worst; a
// missing starter is 0) → "Upgrade Needed" | "Upgrade Wanted" | null.
export function tagUpgrade(starters, tiers) {
  const t = [...tiers].sort((a, b) => b - a);
  while (t.length < starters) t.push(0);
  if (starters === 1) return t[0] >= PLUS_STARTER ? null : t[0] === STARTER ? "Upgrade Wanted" : "Upgrade Needed";
  const good = t.filter((x) => x >= PLUS_STARTER).length;
  const depth = t.filter((x) => x < STARTER).length;
  if (good <= starters - 2 && (starters >= 3 || depth >= 1)) return "Upgrade Needed";
  if (depth >= 1 || good <= starters - 2) return "Upgrade Wanted";
  return null;
}

const ageOf = (dob, now) => (dob ? (now - Date.parse(dob)) / (365.25 * 24 * 3600 * 1000) : null);
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
function weighted(list, value, weight) {
  const vals = list.map((p) => [value(p), weight(p)]).filter(([v, w]) => v != null && w > 0);
  const total = vals.reduce((a, [, w]) => a + w, 0);
  return total ? vals.reduce((a, [v, w]) => a + v * w, 0) / total : null;
}
const bySnaps = (a, b) => (b.sn || 0) - (a.sn || 0) || (a.d || 99) - (b.d || 99);

// ESPN roster → name lookup of who's injured: Map(nameKey → status text).
// rosterStatus "reserve" is ESPN's IR / out group (utils/nflRoster.js).
export function injuredLookup(espnRoster = []) {
  const byName = new Map();
  espnRoster.forEach((a) => {
    const status = a.rosterStatus === "reserve" ? (a.injury || "Injured Reserve") : /out|reserve|pup|physically/i.test(a.injury || "") ? a.injury : null;
    if (!status) return;
    byName.set(depthNameKey(a.fullName), status);
    byName.set(initialKey(a.fullName), status);
  });
  return byName;
}
const injuryOf = (p, lookup) => lookup?.get(depthNameKey(p.n)) || lookup?.get(initialKey(p.n)) || (p.s === "out" ? "Out" : null);

// One team → { [key]: summary } for its players. withInjured: count injured
// players (still on the team) as available. tags: { [pffId]: { talent, dev } }.
// order: the team's depth order, { [group]: [pffId] }.
function summarize(team, lookup, withInjured, now, tags = {}, order = {}) {
  const slot = new Map();
  Object.values(order || {}).forEach((ids) => (ids || []).forEach((id, i) => slot.set(String(id), i)));
  const byOrder = (a, b) => (slot.get(String(a.id)) ?? Infinity) - (slot.get(String(b.id)) ?? Infinity) || bySnaps(a, b);
  const players = (team.players || []).filter((p) => !p.off || (withInjured && injuryOf(p, lookup) && (p.sp || 0) >= INJURED_MIN_SNAP_PCT));
  const out = {};
  NEED_POSITIONS.forEach((P) => {
    const ordered = players.some((p) => P.pos.includes(p.pos) && slot.has(String(p.id)));
    const list = players.filter((p) => P.pos.includes(p.pos)).sort(ordered ? byOrder : bySnaps);
    const hasSnaps = list.some((p) => p.sn);
    const starters = ordered || hasSnaps ? list.slice(0, P.starters) : list.filter((p) => p.d === 1).slice(0, P.starters);
    const ids = new Set(starters.map((p) => p.id));
    // A backup by his tags when he has them, else by his PFF grade on real snaps.
    const proven = (p, grade) => (p.g || 0) >= grade && (p.sn || 0) >= MIN_BACKUP_SNAPS;
    const backups = list.filter((p) => !ids.has(p.id));
    const isBackup = (p) => (tags[p.id] ? (tierOf(p, tags) ?? 0) >= REAL_BACKUP || tags[p.id].dev === "high" || (!tags[p.id].talent && proven(p, BACKUP_GRADE)) : proven(p, BACKUP_GRADE));
    const isStrong = (p) => (tierOf(p, tags) != null ? tierOf(p, tags) >= STARTER : proven(p, CROWDED_GRADE));
    const taggedStarters = starters.filter((p) => tierOf(p, tags) != null);
    out[P.key] = {
      starters: starters.map((p) => p.n),
      grade: weighted(starters, (p) => p.g, (p) => (hasSnaps ? p.sn || 0 : 1)),
      age: weighted(starters, (p) => ageOf(p.dob, now), (p) => (hasSnaps ? p.sn || 0 : 1) || 1),
      backups: backups.filter(isBackup).length,
      strongBackups: backups.filter(isStrong).length,
      // By tags once any starter's tagged: the upgrade call, and the tags it went on.
      tagged: taggedStarters.length > 0,
      upgrade: taggedStarters.length ? tagUpgrade(P.starters, starters.map((p) => tierOf(p, tags) ?? gradeTier(p.g))) : null,
      tags: list.filter((p) => tags[p.id]?.talent || tags[p.id]?.dev).map((p) => ({ name: p.n, talent: TIER_LABEL[tags[p.id].talent] || null, dev: tags[p.id].dev || null, starter: ids.has(p.id) })),
    };
  });
  return out;
}

// Every team's summaries → { [abbr]: { [key]: { label, rank, grade, age, starters, backups } } }.
function label(summaries) {
  const abbrs = Object.keys(summaries);
  const result = Object.fromEntries(abbrs.map((a) => [a, {}]));
  NEED_POSITIONS.forEach((P) => {
    const ranked = abbrs.filter((a) => summaries[a][P.key].grade != null).sort((a, b) => summaries[b][P.key].grade - summaries[a][P.key].grade);
    abbrs.forEach((abbr) => {
      const s = summaries[abbr][P.key];
      const rank = ranked.includes(abbr) ? ranked.indexOf(abbr) + 1 : null;
      let need;
      // Tagged: the tiers make the upgrade call; untagged: the league rank.
      if (s.tagged && s.upgrade) need = s.upgrade;
      else if (!s.tagged && (rank == null || rank >= EXTREME_RANK || s.grade < EXTREME_GRADE)) need = "Upgrade Needed";
      else if (!s.tagged && rank >= TALENT_RANK) need = "Upgrade Wanted";
      else if (s.age != null && s.age >= P.old) need = "Aging Talent";
      else if (s.backups < P.backups) need = "Depth Needed";
      else if ((s.tagged || rank <= CROWDED_RANK) && s.strongBackups >= P.crowd) need = "Crowded Room";
      else need = "Set";
      result[abbr][P.key] = { label: need, rank, grade: round1(s.grade), age: round1(s.age), starters: s.starters, backups: s.backups, byTags: s.tagged, tags: s.tags };
    });
  });
  return result;
}

// teams: pffNflRosters docs (with abbr). injuredByTeam: { [abbr]: ESPN
// roster } (missing → no injury info for that team). →
// { [abbr]: { [key]: { label, rank, grade, age, starters, backups,
//   injured: [{ name, status, snapPct }], without: same minus injured | null } } }
// PFF height (feet × 100 + inches, 606 = 6'6") → inches.
const pffInches = (ht) => (ht ? Math.floor(ht / 100) * 12 + (ht % 100) : null);
// A PFF sub-grade [grade, snaps, …] → its grade, when he's played enough
// snaps of it to mean something.
const sub = (p, k, min = 30) => (p.x?.[k] && p.x[k][1] >= min ? p.x[k][0] : null);
const avg = (...v) => { const n = v.filter((x) => x != null); return n.length ? n.reduce((a, c) => a + c, 0) / n.length : null; };

// PFF's read of each role, for a team with nobody tagged in it: who plays
// it (plays) and what grades him in it (grade).
export const ROLE_DETECT = {
  RB3: { pos: ["HB"], plays: (p) => sub(p, "route") != null, grade: (p) => avg(sub(p, "route"), sub(p, "pblk", 10)) },
  SLOTWR: { pos: ["WR"], plays: (p) => p.al === "SWR" || (p.st?.c_slot || 0) >= 50, grade: (p) => sub(p, "route") ?? p.g },
  BIGWR: { pos: ["WR"], plays: (p) => pffInches(p.ht) >= 75 && (p.wt || 0) >= 200, grade: (p) => p.g },
  DEEPWR: { pos: ["WR"], plays: (p) => (p.st?.c_adot || 0) >= 13, grade: (p) => sub(p, "route") ?? p.g },
  BLOCKTE: { pos: ["TE"], plays: (p) => sub(p, "rblk", 50) != null, grade: (p) => sub(p, "rblk", 50) },
  RUSHEDGE: { pos: ["ED"], plays: (p) => sub(p, "prush", 50) != null, grade: (p) => sub(p, "prush", 50) },
  RUSHDL: { pos: ["DI"], plays: (p) => sub(p, "prush", 50) != null, grade: (p) => sub(p, "prush", 50) },
  RUNDL: { pos: ["DI"], plays: (p) => sub(p, "rdef", 50) != null, grade: (p) => sub(p, "rdef", 50) },
  NOSE: { pos: ["DI"], plays: (p) => p.al === "NT" || (p.wt || 0) >= 310, grade: (p) => sub(p, "rdef") ?? p.g },
  SUBLB: { pos: ["LB"], plays: (p) => sub(p, "cov", 50) != null, grade: (p) => sub(p, "cov", 50) },
  SS: { pos: ["S"], plays: (p) => p.al === "SS", grade: (p) => p.g },
  FS: { pos: ["S"], plays: (p) => p.al === "FS", grade: (p) => p.g },
  SLOTCB: { pos: ["CB", "S"], plays: (p) => p.al === "SCB", grade: (p) => sub(p, "cov") ?? p.g },
};

// Every team's roles → { [abbr]: { [key]: { label, rank, grade, age,
// starters, byTags, tags } } }. withInjured as summarize; tags / orders as
// suggestNeeds.
function roleLabels(teams, lookups, withInjured, now, tags = {}, orders = {}, roleOrders = {}) {
  const roles = {};
  teams.forEach((t) => {
    const lookup = lookups[t.abbr];
    const players = (t.players || []).filter((p) => !p.off || (withInjured && injuryOf(p, lookup) && (p.sp || 0) >= INJURED_MIN_SNAP_PCT));
    const slot = new Map();
    Object.values(orders[t.abbr] || {}).forEach((ids) => (ids || []).forEach((id, i) => slot.set(String(id), i)));
    const tierOf = (p) => TIER[tags[p.id]?.talent] ?? gradeTier(p.g);
    roles[t.abbr] = Object.fromEntries(ROLES.map((r) => {
      const own = new Map((roleOrders[t.abbr]?.[r.key] || []).map((id, i) => [String(id), i]));
      const at = (m, p) => m.get(String(p.id)) ?? Infinity;
      const tagged = players.filter((p) => (tags[p.id]?.roles || []).includes(r.key))
        .sort((a, b) => at(own, a) - at(own, b) || at(slot, a) - at(slot, b) || tierOf(b) - tierOf(a) || bySnaps(a, b));
      if (tagged.length) {
        const who = tagged[0];
        return [r.key, {
          starters: [who.n], grade: who.g ?? null, age: ageOf(who.dob, now), tier: tierOf(who), byTags: true,
          tags: tagged.map((p) => ({ name: p.n, talent: TIER_LABEL[tags[p.id]?.talent] || null, dev: tags[p.id]?.dev || null, starter: p === who })),
        }];
      }
      const R = ROLE_DETECT[r.key];
      const who = players.filter((p) => R.pos.includes(p.pos) && R.plays(p) && R.grade(p) != null).sort(bySnaps)[0];
      return [r.key, who ? { starters: [who.n], grade: R.grade(who), age: ageOf(who.dob, now) } : { starters: [], grade: null, age: null }];
    }));
  });
  const out = Object.fromEntries(teams.map((t) => [t.abbr, {}]));
  ROLES.forEach((role) => {
    const old = NEED_POSITIONS.find((P) => P.key === role.parent)?.old ?? 30;
    // PFF's read is ranked against the other teams PFF reads it for.
    const ranked = teams.map((t) => t.abbr).filter((a) => !roles[a][role.key].byTags && roles[a][role.key].grade != null)
      .sort((a, c) => roles[c][role.key].grade - roles[a][role.key].grade);
    teams.forEach(({ abbr }) => {
      const r = roles[abbr][role.key];
      const rank = ranked.includes(abbr) ? ranked.indexOf(abbr) + 1 : null;
      const aging = r.age != null && r.age >= old;
      let need;
      if (r.byTags) need = tagUpgrade(1, [r.tier]) || (aging ? "Aging Talent" : "Set");
      else if (rank == null || rank >= EXTREME_RANK || r.grade < EXTREME_GRADE) need = "Upgrade Needed";
      else if (rank >= TALENT_RANK) need = "Upgrade Wanted";
      else if (aging) need = "Aging Talent";
      else need = "Set";
      out[abbr][role.key] = {
        label: need, rank: r.byTags ? null : rank, grade: round1(r.grade), age: round1(r.age), starters: r.starters, backups: 0,
        ...(r.byTags ? { byTags: true, tags: r.tags } : {}),
      };
    });
  });
  return out;
}

// tags: the admin's player tags, { [pffId]: { talent, dev, roles } } (depthNotes.js
// loadPlayerTags) — none, PFF alone. orders: the admin's depth orders,
// { [abbr]: { [group]: [pffId] } } (depthNotes.js loadTeamNotes' order);
// roleOrders: the same for roles, { [abbr]: { [role]: [pffId] } } (roleOrder).
export function suggestNeeds(teams, injuredByTeam = {}, now = Date.now(), tags = {}, orders = {}, roleOrders = {}) {
  const lookups = Object.fromEntries(teams.map((t) => [t.abbr, injuredLookup(injuredByTeam[t.abbr])]));
  const healthy = label(Object.fromEntries(teams.map((t) => [t.abbr, summarize(t, lookups[t.abbr], true, now, tags, orders[t.abbr])])));
  const current = label(Object.fromEntries(teams.map((t) => [t.abbr, summarize(t, lookups[t.abbr], false, now, tags, orders[t.abbr])])));
  const out = {};
  teams.forEach((t) => {
    out[t.abbr] = {};
    NEED_POSITIONS.forEach((P) => {
      const injured = (t.players || [])
        .filter((p) => P.pos.includes(p.pos) && p.off && (p.sp || 0) >= INJURED_MIN_SNAP_PCT && injuryOf(p, lookups[t.abbr]))
        .map((p) => ({ name: p.n, status: injuryOf(p, lookups[t.abbr]), snapPct: Math.round(p.sp || 0) }));
      const h = healthy[t.abbr][P.key];
      out[t.abbr][P.key] = { ...h, injured, without: injured.length ? current[t.abbr][P.key] : null };
    });
  });
  // Roles: an injured player only matters if he's the one who plays the
  // role when healthy.
  const roleHealthy = roleLabels(teams, lookups, true, now, tags, orders, roleOrders);
  const roleCurrent = roleLabels(teams, lookups, false, now, tags, orders, roleOrders);
  teams.forEach((t) => {
    ROLES.forEach((r) => {
      const h = roleHealthy[t.abbr][r.key];
      const starter = (t.players || []).find((p) => p.n === h.starters[0]);
      const injured = starter?.off && injuryOf(starter, lookups[t.abbr])
        ? [{ name: starter.n, status: injuryOf(starter, lookups[t.abbr]), snapPct: Math.round(starter.sp || 0) }] : [];
      out[t.abbr][r.key] = { ...h, injured, without: injured.length ? roleCurrent[t.abbr][r.key] : null };
    });
  });
  return out;
}

// One position group's players for the admin's team editor, most snaps
// first: [{ name, grade, age, snapPct, injury, starter }]. The team's
// current depth chart plus anyone PFF dropped from it who's still on the
// ESPN roster as injured (released / traded players are left out). injury:
// any ESPN status (Questionable, Out, Injured Reserve…), else PFF's. age:
// from PFF's birth date, else ESPN's (PFF's off-chart rows have no dob).
export function positionPlayers(team, espnRoster = [], key, now = Date.now()) {
  const P = NEED_POSITIONS.find((x) => x.key === key);
  if (!P || !team) return [];
  const anyInjury = new Map();
  const espnAge = new Map();
  espnRoster.forEach((a) => {
    if (a.age != null) { espnAge.set(depthNameKey(a.fullName), a.age); espnAge.set(initialKey(a.fullName), a.age); }
    const status = a.rosterStatus === "reserve" ? (a.injury || "Injured Reserve") : a.injury;
    if (!status) return;
    anyInjury.set(depthNameKey(a.fullName), status);
    anyInjury.set(initialKey(a.fullName), status);
  });
  const out = injuredLookup(espnRoster);
  const list = (team.players || [])
    .filter((p) => P.pos.includes(p.pos) && (!p.off || injuryOf(p, out)))
    .sort(bySnaps);
  const starters = new Set((list.some((p) => p.sn) ? list : list.filter((p) => p.d === 1)).slice(0, P.starters).map((p) => p.id));
  return list.map((p) => {
    const pffStatus = p.s ? p.s[0].toUpperCase() + p.s.slice(1) : null;
    return {
      name: p.n, grade: p.g ?? null, age: round1(ageOf(p.dob, now)) ?? espnAge.get(depthNameKey(p.n)) ?? espnAge.get(initialKey(p.n)) ?? null, snapPct: p.sp != null ? Math.round(p.sp) : null,
      injury: anyInjury.get(depthNameKey(p.n)) || anyInjury.get(initialKey(p.n)) || pffStatus, starter: starters.has(p.id),
    };
  });
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

// One line on why, for the review list — the tags first when they made the call.
const DEV_SHORT = { high: "high dev", medium: "med dev", low: "low dev" };
export function suggestionReason(s) {
  const parts = [];
  const tagged = (s.tags || []).map((t) => `${t.name} (${[t.talent, DEV_SHORT[t.dev]].filter(Boolean).join(", ")})`);
  if (s.byTags) parts.push(`by tags: ${tagged.join(", ")}`);
  if (s.rank) parts.push(`starters rank ${ordinal(s.rank)} (grade ${s.grade})`);
  else parts.push("no starter with snaps");
  if (s.age) parts.push(`age ${s.age}`);
  if (s.starters?.length) parts.push(s.starters.join(", "));
  if (!s.byTags && tagged.length) parts.push(`tagged: ${tagged.join(", ")}`);
  return parts.join(" · ");
}

// Every team's stars — its players tagged Franchise or Difference Maker,
// for the Draft Sim's war room and desk to name ("We need to get Josh
// Allen somebody to throw to"). Only who they are, never PFF numbers, so
// it's public (compSnapshots/_teamStars). teams: pffNflRosters docs (where
// each plays now — off the depth chart doesn't count); tags: nflPlayerTags.
// → { [abbr]: [{ n, k (need key — QB, OT, EDGE…), t (franchise |
// difference), ro? (role keys) }] }, franchise first.
export const STAR_TAGS = ["franchise", "difference"];
export function teamStars(teams, tags = {}) {
  const keyOf = (pos) => NEED_POSITIONS.find((P) => P.pos.includes(pos))?.key || null;
  return Object.fromEntries(teams.filter((t) => t.abbr).map((t) => [t.abbr, (t.players || [])
    .filter((p) => !p.off && STAR_TAGS.includes(tags[p.id]?.talent) && keyOf(p.pos))
    .map((p) => ({ n: p.n, k: keyOf(p.pos), t: tags[p.id].talent, ...(tags[p.id].roles?.length ? { ro: tags[p.id].roles } : {}) }))
    .sort((a, b) => STAR_TAGS.indexOf(a.t) - STAR_TAGS.indexOf(b.t))]));
}
