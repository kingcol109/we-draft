// src/utils/nflTargets.js
//
// NFL team draft targets as WX content (user, 2026-11-21): the admin
// curates each team's 2027 list — 5 featured players with a write-up and his
// draft card (utils/instagram/draftCard.js), then up to 30 more in a list —
// and it replaces the team page's Targets tab (/nfl/{team}) once published.
// One living list per team (no editions — user's call).
//
// The coach-fit system stays (utils/draftProfiles.js → the weekly
// compSnapshots/teamTargets_{TEAM}, fetchTeamTargets): it suggests players
// while the admin builds a list, and any picked player who fits the staff
// gets that fit on his snapshot on the page. 2028 and 2029 keep the legacy
// coach-fit view (components/ProjectedPicks.jsx), offered only when the
// class has a fit for the team.
//
//   nflTargets/{TEAM} {
//     year: "2027", published: false, intro, updatedAt, publishedAt,
//     featured: [Entry] (≤ 5, with note), list: [Entry] (≤ 30)
//   }
//   Entry = { id (players doc), slug, first, last, pos, school, note, shot
//             (a placed action shot's url), order }
// Unpublished: admin-only (firestore.rules) — the team keeps the legacy
// view for 2027 too, and an admin sees the list as a preview.
import { FIT_TIERS, fitTier } from "./draftProfiles.js";

export const TARGETS_YEAR = "2027";
export const NFL_TARGETS_DOC = "nflTargets";
export const FEATURED_MAX = 5;
export const LIST_MAX = 30;
// The classes after the curated one that keep the legacy view.
export const LEGACY_YEARS = ["2028", "2029"];

const STRONG = FIT_TIERS.find((t) => t.key === "strong").min;
const EXTREME = FIT_TIERS.find((t) => t.key === "extreme").min;
const MATCH_MIN = FIT_TIERS.find((t) => t.key === "very").min;

// A featured player's draft card as the server draws it (api/draft-card.js,
// server/draftCardImage.mjs) — the permanent image URL the team page shows,
// Google Images indexes and link previews use. One per player and team (the
// team's list picks his action shot): a descriptive filename, then
// ?team=nyj&v={the list's last save, ms} (cached for good — a save is a new v).
// small: the 600px copy; fmt: "webp" (the page) or "png" (link previews).
export const draftCardImageUrl = (slug, year, team, { small = false, fmt = "png", v = "" } = {}) =>
  `https://we-draft.com/api/draft-cards/${year}/${encodeURIComponent(slug)}-nfl-draft-prospect${small ? "-600" : ""}.${fmt === "webp" ? "webp" : "png"}`
  + `?team=${String(team || "").toLowerCase()}${v ? `&v=${v}` : ""}`;

export const byOrder = (l) => [...(l || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// His fit with this team's staff (the teamTargets data — rows + matches), or
// null when he doesn't fit: the staff blend when it's Strong or better; each
// GM / head coach fit that's Strong or better on its own and each
// coordinator's that's Extremely Strong (the legacy tab's own bars); and
// his Very Strong (or better) matches to players they drafted.
//   → { score, tier, parts: [{ slot, score, tier }], matches: [m] }
export function fitFor(targets, id) {
  if (!targets || !id) return null;
  const row = (targets.rows || []).find((r) => r.i === id);
  const parts = row ? ["GM", "HC", "OC", "DC"].filter((sl) => row[sl] != null && row[sl] >= (sl === "OC" || sl === "DC" ? EXTREME : STRONG))
    .map((sl) => ({ slot: sl, score: row[sl], tier: fitTier(row[sl]) })) : [];
  const seen = new Set();
  const matches = (targets.matches || []).filter((m) => m.i === id && m.s >= MATCH_MIN)
    .sort((a, b) => b.s - a.s).filter((m) => (seen.has(m.k) ? false : seen.add(m.k)));
  const blend = row && row.s >= STRONG ? row.s : null;
  if (blend == null && !parts.length && !matches.length) return null;
  return { score: blend, tier: blend != null ? fitTier(blend) : null, parts, matches };
}

// The suggestions while building a list: the class's prospects who fit,
// best first — { id, first, last, pos, school, slug, logo, fit }.
export function fitSuggestions(targets, year = TARGETS_YEAR) {
  if (!targets?.rows) return [];
  const ids = new Set([
    ...targets.rows.filter((r) => r.E === year).map((r) => r.i),
  ]);
  return [...ids].map((id) => {
    const r = targets.rows.find((x) => x.i === id);
    const fit = fitFor(targets, id);
    return fit && { id, first: r.F, last: r.L, pos: r.P, school: r.S, slug: r.sl, logo: r.lg, fit };
  }).filter(Boolean)
    .sort((a, b) => Math.max(b.fit.score || 0, ...b.fit.matches.map((m) => m.s)) - Math.max(a.fit.score || 0, ...a.fit.matches.map((m) => m.s)));
}

// The legacy classes worth offering for this team: those with any fit
// (a Strong staff / GM / HC fit, an Extremely Strong coordinator fit, or a
// draft-history match).
export function legacyYearsWithFits(targets) {
  if (!targets?.rows) return [];
  return LEGACY_YEARS.filter((y) => targets.rows.some((r) => r.E === y && fitFor(targets, r.i)));
}
