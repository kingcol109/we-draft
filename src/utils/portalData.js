// src/utils/portalData.js
//
// The public Transfer Portal's data, shared by the page
// (pages/TransferPortal.jsx) and the admin's Targets / Team Pages tabs:
//
//   compSnapshots/_portal_board(_n)  CFBD portal entries that aren't We-Draft
//                                    players, plus every We-Draft player's
//                                    transfer stars (server/portal/public.js)
//   compSnapshots/_portal_{slug}     a team's projected roster, 2027 signees,
//                                    sim needs and sim targets
//   config/portalGrades              the admin's locked stars (the Grades
//                                    tab) — applied live, so a lock shows
//                                    before the next rebuild
//   config/portalTargets             the admin's recommended targets:
//                                    { teams: { [slug]: { [playerId]: rank } },
//                                      players: { [playerId]: info } } —
//                                    rank 0 = no hand order (last name);
//                                    info: { n, pos, sub, from, s, e, ht, wt,
//                                    st, slug } so the page needs no pool
//   config/portalManual              the admin's own portal entries (user,
//                                    2026-11-17: CFBD lags — enter big moves
//                                    as they happen): { entries: { [key]:
//                                    entry } } — see MANUAL below. Read live
//                                    by the page, so they show at once; the
//                                    next team-page rebuild folds them into
//                                    the sim too (server/portal/public.js)
//
// Stars are the admin's transfer stars (2–6, utils/portalStars.mjs) — the
// same grades the Portal Sim uses.
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { decodeGrade } from "./portalStars.mjs";
import { expandPool } from "./portalSim/pool";
import { attachLocks } from "./portalSim/attach";
import { getSiteSnapshot } from "./siteSnapshots";

const once = {};
const cached = (key, fn) => {
  if (!once[key]) once[key] = fn().catch((e) => { delete once[key]; throw e; });
  return once[key];
};
const read = (col, id) => getDoc(doc(db, col, id)).then((s) => (s.exists() ? s.data() : null));

// { entries, stars, season, builtAt } — every part of the board.
export function fetchPortalBoard() {
  return cached("board", async () => {
    const first = await read("compSnapshots", "_portal_board");
    if (!first) return { entries: [], stars: {}, season: null, builtAt: null };
    const rest = await Promise.all(Array.from({ length: Math.max(0, (first.parts || 1) - 1) }, (_, i) => read("compSnapshots", `_portal_board_${i + 1}`)));
    return { entries: [...(first.entries || []), ...rest.flatMap((d) => d?.entries || [])], stars: first.stars || {}, season: first.season, builtAt: first.builtAt || null };
  });
}

// One team's page data (null until built).
export const fetchPortalTeamPage = (slug) => cached(`team:${slug}`, () => read("compSnapshots", `_portal_${slug}`));

// { [poolId | "wd:"+wdId]: code } — the admin's locks.
export const fetchPortalLocks = () => cached("locks", () => read("config", "portalGrades").then((d) => d?.rows || {}).catch(() => ({})));

// The admin's recommendations. fresh: skip the session cache (admin).
export function fetchPortalTargets({ fresh = false } = {}) {
  if (fresh) delete once.targets;
  return cached("targets", () => read("config", "portalTargets").then((d) => ({ teams: d?.teams || {}, players: d?.players || {} })));
}

// A player's stars: his lock (by pool id, or We-Draft id), else the built grade.
export function starsWithLocks(locks, { id, wdId, stars }) {
  const code = (id && locks?.[id]) || (wdId && locks?.[`wd:${wdId}`]);
  const s = code ? decodeGrade(code).s : null;
  return s || stars || null;
}

// "Jalen Brewster" → "Brewster"; "Eric McFarland III" → "McFarland".
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
export function lastNameOf(name) {
  const parts = String(name || "").trim().split(/\s+/);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] || "";
}

// Recommendations in display order (user, 2026-11-17): always by stars,
// best first; within the same stars, the admin's hand order (rank 1, 2…),
// then everyone unranked by last name.
// list: [{ id, n, s, rank }] → sorted copy.
export function sortRecommendations(list) {
  return [...list].sort((a, b) => (b.s || 0) - (a.s || 0)
    || ((a.rank || Infinity) - (b.rank || Infinity))
    || lastNameOf(a.n).localeCompare(lastNameOf(b.n))
    || String(a.n).localeCompare(String(b.n)));
}

// A team's recommendations, ready to show: [{ id, rank, ...info, s }].
export function teamRecommendations(targets, slug, locks) {
  const ranks = targets?.teams?.[slug] || {};
  return sortRecommendations(Object.entries(ranks).map(([id, rank]) => {
    const info = targets.players?.[id] || { n: "Unknown player" };
    return { id, rank: Number(rank) || 0, ...info, s: starsWithLocks(locks, { id, wdId: info.wd, stars: info.s }) };
  }));
}

// Roster order and labels (the Roster tab).
export const ROSTER_GROUPS = [
  ["QB", "Quarterbacks"], ["RB", "Running Backs"], ["WR", "Wide Receivers"], ["TE", "Tight Ends"], ["OL", "Offensive Line"],
  ["EDGE", "Edge Rushers"], ["DL", "Defensive Line"], ["LB", "Linebackers"], ["DB", "Defensive Backs"], ["ATH", "Athletes"],
  ["K", "Kickers"], ["P", "Punters"], ["LS", "Long Snappers"],
];
// Why a player is off the 2027 roster (fates p, t, n, x — server/portal/public.js).
export const DEPARTURES = [
  ["p", "In the Transfer Portal", "Entered the portal — still uncommitted"],
  ["t", "Transferred", "Committed to another school"],
  ["n", "NFL Draft", "Declared for the NFL Draft"],
  ["x", "Out of Eligibility", "Played his final college season in 2026"],
];
// A need's words (wants kinds — engine wantsOf).
export const WANT_LABEL = { hole: "Starter needed", upgrade: "Upgrade", depth: "Depth" };

// ── Admin: the whole Portal Sim pool (every FBS player, graded FCS) with
// locks applied, plus FBS branding — the Targets and Manual Entries tabs'
// player search. ~2 MB, admins only. → { pool, locks, brand }
export function loadPortalPool() {
  return cached("pool", async () => {
    const [teamsSnap, locksSnap, b] = await Promise.all([
      getDoc(doc(db, "portalSimPool", "teams")), getDoc(doc(db, "config", "portalGrades")), getSiteSnapshot("_cfbTeams"),
    ]);
    const td = teamsSnap.data();
    if (!td) throw new Error("The Portal Sim pool hasn't been built.");
    const chunks = await Promise.all(Array.from({ length: td.chunks || 0 }, (_, i) => getDoc(doc(db, "portalSimPool", `p${i}`)).then((x) => x.data())));
    const locks = locksSnap.data()?.rows || {};
    return { pool: attachLocks(expandPool(td, chunks), locks), locks, brand: b?.teams || {} };
  });
}

// ── Manual portal entries (config/portalManual) ──
// entry: { pid (pool id, when he's in the pool), wd (We-Draft id), n, pos,
//   sub, from (We-Draft School), to (School, committed or withdrawn — to ===
//   from), st: "u" uncommitted | "c" committed | "w" withdrew, d (entered,
//   ms), cd (committed / withdrew, ms), s, e, ht, wt, state, slug, at }
// Precedence (here and in server/portal/public.js): a We-Draft player's own
// portal record wins; then the manual entry — unless CFBD already has him
// committed and the entry doesn't (CFBD caught up, and is further along).
export function fetchPortalManual({ fresh = false } = {}) {
  if (fresh) delete once.manual;
  return cached("manual", () => read("config", "portalManual").then((d) => d?.entries || {}).catch(() => ({})));
}
export const manualKey = (e) => (e.pid ? String(e.pid) : `m:${`${e.n}|${e.from}`.toLowerCase().replace(/[^a-z0-9|]+/g, "-")}`);
// Does a manual entry stand, given CFBD's entry for the same player?
export const manualStands = (m, cfbd) => !(cfbd && cfbd.st === "c" && m.st === "u");
