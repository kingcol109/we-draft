// src/utils/events.js
//
// The draft-season event pages (/events/{event}/{year} — pages/EventPage.jsx)
// and who took part in each. /events itself is the calendar
// (pages/DraftCalendar.jsx, dates in utils/draftCalendar.js).
//
// Event pages: the Combine, the Senior Bowl, the East-West Shrine Bowl and
// Pro Days (one page for every school's). The transfer window has no page —
// /events/portal goes to /portal.
//
// Participants and results, one doc per draft year, written in Admin →
// Events (components/AdminEvents.jsx):
//   events/{year} {
//     combine:    { p: { [id]: Participant & { results: { forty, vertical, broad,
//                   bench, threeCone, shuttle, height, weight, arm, hand } } } },
//     seniorBowl: { p: { [id]: Participant & { team: "American" | "National" } } },
//     eastWest:   { p: { [id]: Participant & { team: "East" | "West" } } },
//     proDays:    { s: { [school slug]: { school, date: "YYYY-MM-DD" } },
//                   p: { [id]: Participant & { day: school slug } } },
//   }
//   Participant = { name, position, school, slug (player page), playerId }
//   id = the players doc id, or "m-{name}-{school}" for someone who isn't a
//   We-Draft player.
// Player pages read the same doc for the Career Path (PlayerEligibilityInfo).
import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { DRAFT_EVENTS, parseDay } from "./draftCalendar";
import { isUnreleasedSlug } from "./prospectYears";
import { getSiteSnapshot } from "./siteSnapshots";
import { combineRowFrom, COMBINE_EVENT_YEAR, COMBINE_FIRST_YEAR } from "./combineData";

export const EVENT_YEARS = [2027];
export const CURRENT_EVENT_YEAR = 2027;

export const EVENT_PAGES = {
  combine: {
    slug: "combine", key: "combine", name: "NFL Scouting Combine", short: "Combine",
    logo: "/logos/nfl-combine.png", color: "#0055a5", dark: "#00305c", accent: "#0284c7",
    calendarIds: ["combine"], results: true, location: "Indianapolis, IN",
    about: "The league's annual pre-draft showcase: medical exams, team interviews, measurements and on-field testing for the top prospects in the class.",
  },
  "senior-bowl": {
    slug: "senior-bowl", key: "seniorBowl", name: "Senior Bowl", short: "Senior Bowl",
    logo: "/logos/senior-bowl.png", color: "#d62c26", dark: "#141414", accent: "#f5d000",
    calendarIds: ["senior-bowl-practice", "senior-bowl"], teams: ["American", "National"], location: "Mobile, AL",
    about: "The premier college all-star game. A week of practices in Mobile puts the top seniors in front of every NFL staff before the game.",
  },
  "east-west-bowl": {
    slug: "east-west-bowl", key: "eastWest", name: "East-West Shrine Bowl", short: "East-West Bowl",
    logo: "/logos/east-west-bowl.png", color: "#13224a", dark: "#0b1530", accent: "#1e9ae0", accent2: "#d32f2f",
    calendarIds: ["east-west-practice", "east-west"], teams: ["East", "West"], location: "AT&T Stadium, Arlington, Texas",
    about: "The Shriners Children's East-West Bowl, college football's longest-running all-star game — a week of practices, then the game.",
  },
  "pro-days": {
    slug: "pro-days", key: "proDays", name: "Pro Days", short: "Pro Days",
    logo: null, color: "#1e8449", dark: "#013369", accent: "#3b73b9",
    calendarIds: ["pro-days-start"],
    about: "After the Combine, each school holds its own workout for NFL scouts — the last on-field look before the draft.",
  },
};
export const EVENT_SLUGS = Object.keys(EVENT_PAGES);

// Positions, as players docs spell them.
export const EVENT_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "EDGE", "DL", "LB", "DB", "K", "P"];

export const eventPath = (slug, year = CURRENT_EVENT_YEAR, tab = "", pos = "") =>
  `/events/${slug}/${year}${tab ? `/${tab}` : ""}${pos ? `/${String(pos).toLowerCase()}` : ""}`;

// An event's calendar entries (draftCalendar.js) — its practices, game, days.
export function eventDates(slug) {
  const ids = EVENT_PAGES[slug]?.calendarIds || [];
  const entries = DRAFT_EVENTS.filter((e) => ids.includes(e.id))
    .map((e) => ({ ...e, start: parseDay(e.date), finish: parseDay(e.end || e.date) }))
    .sort((a, b) => a.start - b.start);
  if (!entries.length) return { entries, start: null, end: null };
  return { entries, start: entries[0].start, end: entries.reduce((m, e) => (e.finish > m ? e.finish : m), entries[0].finish) };
}

// The pro day schedule from the year's doc, earliest first.
export function proDaySchedule(data) {
  return Object.entries(data?.proDays?.s || {})
    .filter(([, d]) => d?.date && d?.school)
    .map(([key, d]) => ({ key, school: d.school, date: d.date, start: parseDay(d.date) }))
    .sort((a, b) => a.start - b.start || a.school.localeCompare(b.school));
}

// One event's participants as a list, A–Z by last name.
const lastName = (n) => String(n || "").trim().split(/\s+/).slice(1).join(" ") || String(n || "");
export function participantsOf(data, slug) {
  const key = EVENT_PAGES[slug]?.key;
  return Object.entries(data?.[key]?.p || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => lastName(a.name).localeCompare(lastName(b.name)) || String(a.name).localeCompare(String(b.name)));
}

// A participant's player page, when it's public.
export const playerHref = (p) => (p?.slug && !isUnreleasedSlug(p.slug) ? `/player/${p.slug}` : "");

// A school's team page (the long-form slug, as the Career Path links it).
export const schoolHref = (school) => (school
  ? `/team/${String(school).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-")}`
  : "");

// ── The year's doc, cached for the session ──
const cache = {};
export function fetchEventYear(year) {
  const y = String(year);
  if (!cache[y]) {
    cache[y] = getDoc(doc(db, "events", y)).then((s) => (s.exists() ? s.data() : {}))
      .catch((e) => { delete cache[y]; console.error("Events load error:", e); return {}; });
  }
  return cache[y];
}
// Admin saves: the next read gets the new doc.
export const forgetEventYear = (year) => { delete cache[String(year)]; };

export function useEventYear(year) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    if (!year || !EVENT_YEARS.includes(Number(year))) { setData({}); return undefined; }
    setData(null);
    fetchEventYear(year).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [year]);
  return data;
}

// A player's events in his draft year, newest first — the Career Path's
// rows: [{ slug, name, logo, span, sub, to, school? }].
export function playerEvents(data, playerId, year) {
  if (!data || !playerId) return [];
  const out = [];
  const pd = data.proDays?.p?.[playerId];
  if (pd) {
    const day = data.proDays?.s?.[pd.day];
    const d = day?.date ? parseDay(day.date) : null;
    out.push({
      slug: "pro-days", name: `${day?.school || pd.school} Pro Day`, school: day?.school || pd.school,
      span: d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Pro Day",
      sub: `${year} Pro Days`, to: eventPath("pro-days", year), date: d,
    });
  }
  for (const slug of ["combine", "east-west-bowl", "senior-bowl"]) {
    const ev = EVENT_PAGES[slug];
    const p = data[ev.key]?.p?.[playerId];
    if (!p) continue;
    const { start } = eventDates(slug);
    // Combine: his headline numbers under the row.
    const r = p.results || {};
    const has = (k) => r[k] !== "" && r[k] != null;
    const results = slug === "combine" ? [
      has("forty") && `${r.forty} 40`, has("vertical") && `${r.vertical}" Vert`, has("broad") && `${r.broad} Broad`,
      has("bench") && `${r.bench} Bench`, has("threeCone") && `${r.threeCone} 3-Cone`, has("shuttle") && `${r.shuttle} Shuttle`,
    ].filter(Boolean).join(" · ") : "";
    out.push({
      slug, name: `${year} ${slug === "combine" ? "NFL Combine" : ev.name}`, logo: ev.logo, results,
      span: p.team ? `${p.team} Team` : slug === "combine" ? (start && new Date() >= start ? "Participant" : "Invited") : "Participant",
      sub: ev.location || "", to: eventPath(slug, year), date: start,
    });
  }
  return out;
}

// ── Past Combines (utils/combineData.js) ──
// The all-time index: { years: { [year]: { players, forty } }, averages }, or null.
let combineIndexP = null;
export function fetchCombineIndex() {
  if (!combineIndexP) combineIndexP = getSiteSnapshot("_combineIndex").catch(() => null);
  return combineIndexP;
}
// One past year's rows: its snapshot, else straight from historical (or
// players, for the latest drafted class) until the next snapshot build.
const combineYearCache = {};
export function fetchCombineYear(year) {
  const y = String(year);
  if (!combineYearCache[y]) {
    combineYearCache[y] = getSiteSnapshot(`_combine_${y}`).then(async (snap) => {
      if (snap?.rows) return snap.rows;
      const hist = await getDocs(query(collection(db, "historical"), where("Year", "==", y)));
      const recs = hist.size ? hist.docs.map((d) => ({ id: d.id, ...d.data() }))
        : (await getDocs(query(collection(db, "players"), where("Eligible", "==", y)))).docs.map((d) => ({ id: d.id, ...d.data() }));
      return recs.map((r) => combineRowFrom(r, r.id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    }).catch((e) => { delete combineYearCache[y]; console.error("Combine year load error:", e); return []; });
  }
  return combineYearCache[y];
}
// A past Combine year we can show: in the index (or, with no index yet, in range).
export const isPastCombineYear = (year, index) => {
  const y = Number(year);
  if (!(y >= COMBINE_FIRST_YEAR && y < COMBINE_EVENT_YEAR)) return false;
  return index ? !!index.years?.[y] : true;
};
export function useAsync(fn, key) {
  const [v, setV] = useState(undefined);
  useEffect(() => {
    let live = true;
    setV(undefined);
    Promise.resolve(fn()).then((x) => { if (live) setV(x); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}
