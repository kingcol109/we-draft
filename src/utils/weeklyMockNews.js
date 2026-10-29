// src/utils/weeklyMockNews.js
//
// The current Weekly Mocks as news items: one small summary per class,
// AdminWeeklyMock.jsx writes on Publish (and Update team pages) —
// config/weeklyMock for 2027, config/weeklyMock{year} for the later classes'
// (summaryDocId) — { mockId, weekId, prevWeekId (the weeklyMocks docs of
// this week and the one before, for the team pages), year, rounds,
// publishedAt, teams: { [abbr]: { name, first: { name, overall, pos,
// school } } }, players: { [playerId]: { team, overall, round } } }. Player
// pages (In The News) and NFL team pages link to the team's mock page from
// it. Only the latest — the pages update every week. One read a class,
// cached for the visit; no engine imports, so the pages that use it stay
// light.
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";
import { NFL_TEAMS } from "./coachHistory";

// The classes with a Weekly Mock, the first the main one: its team pages are
// /mocks/{team}; the others' add the year (/mocks/{team}/2028). A class
// outside TEAM_PAGE_YEARS is only its whole mock (/mocks/{year}): no team
// pages, and not on NFL team pages. (2029 is ready for that — one round, a
// random order, weeklyMock.js RANDOM_ORDER_YEARS — but off for now: add it
// here to turn it on, and to generate-sitemap.js's WEEKLY_CLASSES.)
export const WEEKLY_YEARS = ["2027", "2028"];
export const MAIN_WEEKLY_YEAR = WEEKLY_YEARS[0];
export const TEAM_PAGE_YEARS = ["2027", "2028"];
export const hasTeamPages = (year) => TEAM_PAGE_YEARS.includes(String(year));
// (2027's kept its original id.)
export const summaryDocId = (year) => (String(year) === "2027" ? "weeklyMock" : `weeklyMock${year}`);

const cached = {};
export function loadWeeklyMockSummary(year = MAIN_WEEKLY_YEAR) {
  const y = String(year);
  if (!cached[y]) cached[y] = getDoc(doc(db, "config", summaryDocId(y))).then((s) => (s.exists() ? s.data() : null)).catch(() => null);
  return cached[y];
}

// A player's page's link to a Weekly Mock: "2027 Mock Draft: Chiefs Take
// Simmons" (team: who took him; last: his last name).
export const weeklyMockPlayerTitle = (year, team, last) => `${year} Mock Draft: ${(NFL_TEAMS[team] || team).split(" ").pop()} Take ${last}`;

// "Miami Dolphins 7-Round Mock Draft 2027".
export const weeklyMockTitle = (summary, abbr) => `${summary.teams?.[abbr]?.name || abbr} ${summary.rounds || 7}-Round Mock Draft ${summary.year}`;
export const weeklyMockHref = (abbr, year = MAIN_WEEKLY_YEAR) =>
  `/mocks/${String(abbr).toLowerCase()}${String(year) === MAIN_WEEKLY_YEAR ? "" : `/${year}`}`;
// A class's whole Weekly Mock — its current week, at a permanent URL (ViewMock.js).
export const weeklyYearHref = (year = MAIN_WEEKLY_YEAR) => `/mocks/${year}`;

// The next class's picks that a trade in the main class's mock moved
// (weeklyMock.js carryTrades — the week's carriedTrades: [{ round, original,
// from, to }]): the one behind a pick ({ round, original, owner }), while
// that team still holds it, or null.
export const carriedTradeOf = (carried, pick) =>
  (carried || []).find((c) => c.round === pick.round && c.original === pick.original && c.to === pick.owner) || null;

// A publish date as the site shows it — "October 20, 2026" (opts: other
// toLocaleDateString fields) — always in Eastern time, so a crawler's
// renderer on UTC and a reader in Pacific see the same day. "" without one.
export const WEEKLY_TIME_ZONE = "America/New_York";
export const weeklyMockDate = (ts, opts = { month: "long", day: "numeric", year: "numeric" }) =>
  ts?.toDate?.()?.toLocaleDateString("en-US", { ...opts, timeZone: WEEKLY_TIME_ZONE }) || "";

// The published weeks as items for the home page's News box and /news —
// { id, type: "weeklyMock", title, summary, publishedAt, href }, newest
// first. A class's latest week links to /mocks/{year}; older weeks to their
// own post (/mocks/{mockId}/view, which says it's a past week). max: how
// many weeks (all of them without one). [] if the read fails.
export function loadWeeklyMockNews(max) {
  const q = query(collection(db, "weeklyMocks"), orderBy("publishedAt", "desc"), ...(max ? [limit(max)] : []));
  return getDocs(q).then((snap) => {
    const seen = new Set();
    return snap.docs.map((d) => {
      const w = d.data();
      const year = String(w.year);
      const latest = !seen.has(year);
      seen.add(year);
      const first = (w.picks || []).find((p) => p.overall === 1 && p.player);
      const fp = first?.player;
      return {
        id: `weekly-${d.id}`, type: "weeklyMock", publishedAt: w.publishedAt,
        title: `${year} Weekly Mock Draft — ${w.rounds || 7} Round${(w.rounds || 7) === 1 ? "" : "s"}`,
        summary: fp ? `No. 1 pick: ${fp.First} ${fp.Last}, ${fp.Position}${fp.School ? `, ${fp.School}` : ""} (${NFL_TEAMS[first.owner] || first.owner})` : "",
        href: latest ? weeklyYearHref(year) : `/mocks/${w.mockId}/view`,
      };
    });
  }).catch(() => []);
}

// The summary doc for a published week's picks ([{ overall, round, owner,
// player }]) and its names ({ [abbr]: "Miami Dolphins" }).
export function weeklyMockSummary({ mockId, weekId = null, prevWeekId = null, year, rounds, publishedAt, picks, names }) {
  const teams = {};
  const players = {};
  [...picks].sort((a, b) => a.overall - b.overall).forEach((p) => {
    if (!teams[p.owner]) teams[p.owner] = { name: names[p.owner] || p.owner, first: null };
    if (!p.player) return;
    if (!teams[p.owner].first) teams[p.owner].first = { name: `${p.player.First} ${p.player.Last}`, overall: p.overall, pos: p.player.Position, school: p.player.School || "" };
    players[p.player.id] = { team: p.owner, overall: p.overall, round: p.round };
  });
  return { mockId, weekId, prevWeekId, year, rounds, publishedAt, teams, players };
}
