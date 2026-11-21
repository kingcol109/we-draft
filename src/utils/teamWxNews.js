// src/utils/teamWxNews.js
//
// A college team page's In The News items from the WX pages (user,
// 2026-11-20): the Draft Risers boards (utils/risers.js) and Portal News
// (utils/portalNews.js), for this school's players — the team-page side of
// the items player pages already get (riserNewsItem / portalNewsItem).
// Items are shaped like the page's news docs: { id, type, title, href,
// publishedAt (toDate / toMillis) }.
//
//   Risers, one item per class board with his school's players on it:
//     "2027 Draft Risers: Smith On Fire"   (one player — his label)
//     "2027 Draft Risers: Smith, Sayin and Jackson"
//   Portal News: only players the school GETS (user, 2026-11-20) — the
//   board highlights players to break the portal down, so a school whose
//   player leaves (entered, or committed elsewhere) gets nothing:
//     committed to it        "Top Transfer Portal Moves: Atkins to Ohio State"
import { RISER_YEARS, RISER_TYPES, loadRiserBoard, risersRanked, risersPath } from "./risers";
import { loadPortalNewsBoard, newsPath, newsPosGroup, NEWS_POSITIONS } from "./portalNews";
import { SBP_YEARS, loadPerfList, perfRanked, performancesPath } from "./seniorBowlPerf";
import { classIntroTeamItem } from "./classIntro";

const norm = (s) => String(s || "").trim().toLowerCase();
const stamp = (d) => (d ? { toDate: () => d, toMillis: () => d.getTime() } : null);
const toDate = (t) => (t?.toDate ? t.toDate() : t instanceof Date ? t : typeof t === "number" ? new Date(t) : null);
const dayDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? new Date(`${s}T12:00:00`) : null);

function listNames(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

async function riserItems(school) {
  const boards = await Promise.all(RISER_YEARS.map((y) => loadRiserBoard(y).then((b) => [y, b]).catch(() => [y, null])));
  const items = [];
  boards.forEach(([year, board]) => {
    const when = toDate(board?.updatedAt);
    if (!when) return;
    const ours = risersRanked(board.players).filter((r) => norm(r.school) === school);
    if (!ours.length) return;
    const lasts = ours.map((r) => r.last || "").filter(Boolean);
    // Three names at most in a title — a long list reads like a roster.
    const title = ours.length === 1
      ? `${year} Draft Risers: ${lasts[0]} ${RISER_TYPES[ours[0].type]?.label || "Riser"}`
      : `${year} Draft Risers: ${lasts.length > 3 ? `${lasts.slice(0, 3).join(", ")} and More` : listNames(lasts)}`;
    items.push({ id: `risers${year}`, type: "risers", title, href: risersPath(year), publishedAt: stamp(when) });
  });
  return items;
}

async function portalItems(school) {
  const board = await loadPortalNewsBoard();
  const items = [];
  (board?.entries || []).forEach((e) => {
    if (e.status !== "committed" || norm(e.to) !== school) return;
    const g = newsPosGroup(e.pos);
    const when = dayDate(e.date) || board.updatedAt || null;
    items.push({
      id: `portalNews-${e.id}`, type: "portal", title: `Top Transfer Portal Moves: ${e.last || ""} to ${e.to}`,
      href: newsPath(NEWS_POSITIONS.includes(g) ? g : ""), publishedAt: stamp(when),
    });
  });
  return items;
}

// Senior Bowl Top Performers: one item per year with the school's players on it.
async function seniorBowlItems(school) {
  const lists = await Promise.all(SBP_YEARS.map((y) => loadPerfList(y).then((l) => [y, l]).catch(() => [y, null])));
  const items = [];
  lists.forEach(([year, list]) => {
    const when = toDate(list?.updatedAt);
    const ours = perfRanked(list?.players).filter((r) => norm(r.school) === school);
    if (!when || !ours.length) return;
    const lasts = ours.map((r) => r.last || "").filter(Boolean);
    const who = lasts.length > 3 ? `${lasts.slice(0, 3).join(", ")} and More` : listNames(lasts);
    items.push({ id: `sbPerf${year}`, type: "seniorBowl", title: `${year} Senior Bowl Top Performers: ${who}`, href: performancesPath(year), publishedAt: stamp(when) });
  });
  return items;
}

export async function teamWxNewsItems(schoolName) {
  const school = norm(schoolName);
  if (!school) return [];
  const [r, p, sb, ci] = await Promise.all([
    riserItems(school).catch(() => []), portalItems(school).catch(() => []), seniorBowlItems(school).catch(() => []),
    // "Meet the Class of 2030": its signees, once released (utils/classIntro.js).
    classIntroTeamItem(schoolName).then((it) => (it ? [{ ...it, publishedAt: stamp(toDate(it.publishedAt)) }] : [])).catch(() => []),
  ]);
  return [...r, ...p, ...sb, ...ci];
}
