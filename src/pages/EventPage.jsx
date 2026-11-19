// src/pages/EventPage.jsx
//
// /events/{event}/{year}(/{tab}(/{pos})) — one draft-season event's page
// (utils/events.js EVENT_PAGES): the Combine, the Senior Bowl, the East-West
// Shrine Bowl and Pro Days.
// The Combine also has every past year we have results for
// (/events/combine/2015 — utils/combineData.js) and an all-time hub at
// /events/combine (<EventPage hub />): averages by position, every year.
//   (no tab)       Overview — dates, countdown to the first day, the schedule,
//                  who's there. Pro Days: the schedule, school by school.
//   participants   Everyone taking part, by position (/participants/qb), by
//                  team for the all-star games, by school for pro days.
//   results        Combine only: every player's measurements and testing,
//                  sortable, by position (/results/qb).
// Participants and results: events/{year} (Admin → Events). Dates:
// utils/draftCalendar.js. Each player links to his page, each school to its.
import { useRef, useState, useEffect, useLayoutEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import MarginAds from "../components/MarginAds";
import { useSchools } from "../components/DraftArchiveList";
import { DRAFT_EVENTS, COMBINE_SCHEDULE, parseDay } from "../utils/draftCalendar";
import { STAT_METRICS, toNumber } from "../utils/historicalStats";
import { GENERIC_PRO_DAY } from "../utils/proDayIcon";
import {
  EVENT_PAGES, EVENT_YEARS, EVENT_POSITIONS, eventPath, eventDates, proDaySchedule, participantsOf, playerHref, schoolHref, useEventYear,
  fetchCombineIndex, fetchCombineYear, isPastCombineYear, useAsync,
} from "../utils/events";
import { formatCombine, COMBINE_EVENT_YEAR, COMBINE_FIRST_YEAR, COMBINE_KEYS } from "../utils/combineData";
import {
  NAVY, GOLD, BODY_FONT, WEEKDAYS, MONTHS, MON, BadgeFont, Icon, ProDayBadge, startOfToday, sameDay, rangeLabel,
  Countdown, useNow, CombineSchedule, SectionHead, useProDayBadges,
} from "../components/events/EventKit";

const COLUMN_WIDTH = 1000;
const SITE = "https://we-draft.com";
const POS_NAMES = { QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", OL: "Offensive Line", EDGE: "Edge Rusher", DL: "Defensive Line", LB: "Linebacker", DB: "Defensive Back", K: "Kicker", P: "Punter" };
const TABS = {
  combine: [["", "Overview"], ["participants", "Participants"], ["results", "Results"]],
  "senior-bowl": [["", "Overview"], ["participants", "Participants"]],
  "east-west-bowl": [["", "Overview"], ["participants", "Participants"]],
  "pro-days": [["", "Schedule"], ["participants", "Participants"]],
};
// The results table's columns (historicalStats STAT_METRICS, by key).
const RESULT_COLS = ["height", "weight", "arm", "hand", "forty", "vertical", "broad", "bench", "threeCone", "shuttle"]
  .map((k) => STAT_METRICS.find((m) => m.key === k)).filter(Boolean);
const SHORT_LABEL = { height: "Ht", weight: "Wt", arm: "Arm", hand: "Hand", forty: "40", vertical: "Vert", broad: "Broad", bench: "Bench", threeCone: "3-Cone", shuttle: "Shuttle" };

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => { const f = () => setM(window.innerWidth < 768); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return m;
}

export default function EventPage({ hub = false }) {
  const params = useParams();
  const event = hub ? "combine" : params.event;
  const { year: yearParam, tab = "", pos: posParam } = params;
  const ev = EVENT_PAGES[event];
  const year = Number(yearParam);
  const tabs = TABS[event] || [];
  const pos = posParam ? String(posParam).toUpperCase() : "";
  const isMobile = useIsMobile();
  const now = useNow();
  const isCombine = event === "combine";
  // A past Combine (before the first Admin → Events year): its results from the snapshots.
  const past = isCombine && !hub && year >= COMBINE_FIRST_YEAR && year < COMBINE_EVENT_YEAR;
  const combineIndex = useAsync(() => (isCombine ? fetchCombineIndex() : null), isCombine ? "index" : "none");
  const pastRows = useAsync(() => (past ? fetchCombineYear(year) : null), past ? `y${year}` : "none");
  const data = useEventYear(EVENT_YEARS.includes(year) ? year : null);
  const contentRef = useRef(null);
  const badgeFor = useProDayBadges(event === "pro-days");

  if (hub) return <CombineHub index={combineIndex} isMobile={isMobile} now={now} />;
  if (!ev || (!EVENT_YEARS.includes(year) && !past)) return <Navigate to={isCombine ? "/events/combine" : "/events"} replace />;
  if (past && combineIndex !== undefined && !isPastCombineYear(year, combineIndex)) return <Navigate to="/events/combine" replace />;
  if (!tabs.some(([k]) => k === tab) || (pos && (!tab || !EVENT_POSITIONS.includes(pos)))) return <Navigate to={eventPath(event, year)} replace />;

  const people = past ? pastRows || [] : participantsOf(data, event);
  const loading = past ? pastRows === undefined : data === null;
  const schedule = event === "pro-days" ? proDaySchedule(data) : [];
  const dates = past ? { entries: [], start: null, end: null } : eventDates(event);
  // Pro days start with the first school's (or the "Pro Days Start" day).
  const start = event === "pro-days" && schedule.length && (!dates.start || schedule[0].start < dates.start) ? schedule[0].start : dates.start;
  const end = event === "pro-days" && schedule.length ? schedule[schedule.length - 1].start : dates.end;

  // SEO
  const posName = pos ? POS_NAMES[pos] || pos : "";
  const base = `${year} ${past ? "NFL Combine" : ev.name}`;
  // The current Combine and the all-star games: "{what} | {year} {event} Updates".
  const updates = `${base} Updates`;
  const seo = isCombine && !past ? {
    title: tab === "results" ? `${pos ? `${posName} Results` : "40 Times and Testing Results"} | ${updates}`
      : tab === "participants" ? `${pos ? `${posName} Invites` : "Invite List"} | ${updates}`
        : `${base} Schedule and Draft Updates`,
    description: tab === "results"
      ? `${pos ? `Every ${posName.toLowerCase()}'s` : "Every"} ${base} result as it comes in: 40-yard dash, vertical, broad jump, bench, 3-cone, shuttle and measurements, sortable by drill.`
      : tab === "participants"
        ? `Every ${pos ? `${posName.toLowerCase()} ` : "prospect "}invited to the ${base}, with school, position and a link to each player's We-Draft.com profile.`
        : `The ${base} schedule — when it starts, which positions work out each day — plus the invite list, results and draft updates from Indianapolis.`,
  } : ev.teams ? {
    title: tab === "participants" ? `${pos ? `${posName} Participants` : `${ev.teams.join(" and ")} Team Rosters`} | ${updates}` : `${base} Participants and Draft Updates`,
    description: tab === "participants"
      ? `Every ${pos ? `${posName.toLowerCase()} ` : "player "}on the ${base} ${ev.teams.join(" and ")} rosters, with school, position and a link to each prospect's We-Draft.com profile.`
      : `${base} participants, practice week dates and draft updates${ev.location ? ` from ${ev.location}` : ""}. ${ev.about}`,
  } : null;
  const title = seo ? seo.title : tab === "results" ? `${base} Results${pos ? `: ${posName}s` : ""} — 40 Times, Measurements and Testing`
    : tab === "participants" ? `${base} ${past ? "Participants" : event === "combine" ? "Invites" : event === "pro-days" ? "Participants" : "Roster"}${pos ? `: ${posName}s` : ""}`
      : past ? `${year} NFL Combine Results, Measurements and Top Performers`
        : event === "pro-days" ? `${year} NFL Pro Day Schedule and Results` : `${base}: Dates, ${event === "combine" ? "Schedule, Invites and Results" : "Practices, Roster and Schedule"}`;
  const description = seo ? seo.description : tab === "results"
    ? `Every ${pos ? `${posName.toLowerCase()} ` : ""}result from the ${base}: 40-yard dash, vertical, broad jump, bench, 3-cone, shuttle and measurements, sortable by event.`
    : tab === "participants"
      ? `Every ${pos ? `${posName.toLowerCase()} ` : "player "}at the ${base}${event === "pro-days" ? ", school by school" : ""}, with links to each prospect's We-Draft.com profile.`
      : past ? `The ${base}: every drafted player's 40-yard dash, vertical, broad jump, bench, 3-cone, shuttle and measurements, plus the top performers in each drill.`
        : `${ev.about} ${start ? `${rangeLabel({ start, finish: end || start })}${ev.location ? ` · ${ev.location}` : ""}.` : ""}`;
  const url = `${SITE}${eventPath(event, year, tab, pos)}`;
  const jsonLd = !tab && start && event !== "pro-days" ? {
    "@context": "https://schema.org", "@type": "SportsEvent", name: base, description: ev.about,
    startDate: start.toISOString().slice(0, 10), endDate: (end || start).toISOString().slice(0, 10), url,
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(ev.location ? { location: { "@type": "Place", name: ev.location, address: ev.location } } : {}),
  } : null;

  return (
    <>
      <Helmet>
        <title>{seo ? title : `${title} | We-Draft.com`}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        {ev.logo && <meta property="og:image" content={`${SITE}${ev.logo}`} />}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {jsonLd && <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>}
      </Helmet>
      <BadgeFont />
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={24} />

      <div ref={contentRef} style={{ maxWidth: COLUMN_WIDTH, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        {/* Breadcrumb */}
        <nav style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a94a6", marginBottom: 10, flexWrap: "wrap" }}>
          <Link to="/events" style={{ color: ev.color, textDecoration: "none" }}>Events</Link><span>›</span>
          {isCombine && <><Link to="/events/combine" style={{ color: ev.color, textDecoration: "none" }}>Combine</Link><span>›</span></>}
          <Link to={eventPath(event, year)} style={{ color: tab ? ev.color : "#5a6475", textDecoration: "none" }}>{isCombine ? year : `${ev.short} ${year}`}</Link>
          {tab && <><span>›</span><span style={{ color: "#5a6475" }}>{tabs.find(([k]) => k === tab)?.[1]}{pos ? ` · ${pos}` : ""}</span></>}
        </nav>

        <Hero ev={ev} year={year} start={start} end={end} now={now} isMobile={isMobile} count={people.length} schools={schedule.length} past={past} />

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, margin: "14px 0 16px", boxShadow: "inset 0 -2px 0 #e2e7ef", overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" }}>
          {tabs.map(([k, label]) => {
            const on = k === tab;
            return (
              <Link key={k || "overview"} to={eventPath(event, year, k)} style={{
                padding: isMobile ? "9px 12px" : "10px 18px", fontSize: isMobile ? 12 : 13, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
                textDecoration: "none", whiteSpace: "nowrap", color: on ? ev.color : "#5a6475", borderBottom: `3px solid ${on ? ev.color : "transparent"}`,
              }}>{label}{k === "participants" && people.length ? ` (${people.length})` : ""}</Link>
            );
          })}
        </div>

        {past && <YearSwitch ev={ev} year={year} tab={tab} pos={pos} index={combineIndex} />}

        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#8a94a6", fontWeight: 800 }}>Loading…</div>
        ) : tab === "results" ? (
          <Results ev={ev} year={year} people={people} pos={pos} isMobile={isMobile} past={past} />
        ) : tab === "participants" ? (
          <Participants ev={ev} year={year} people={people} pos={pos} isMobile={isMobile} schedule={schedule} badgeFor={badgeFor} />
        ) : event === "pro-days" ? (
          <ProDaySchedule ev={ev} year={year} people={people} schedule={schedule} isMobile={isMobile} badgeFor={badgeFor} />
        ) : past ? (
          <PastCombineOverview ev={ev} year={year} people={people} isMobile={isMobile} />
        ) : (
          <Overview ev={ev} year={year} people={people} dates={dates} isMobile={isMobile} />
        )}

        <MoreEvents current={event} year={year} isMobile={isMobile} />
      </div>
    </>
  );
}

// ── Hero: logo, name, dates, countdown to the first day ──
function Hero({ ev, year, start, end, now, isMobile, count, schools, past, title, kicker, note }) {
  const today = startOfToday();
  const over = end && today > end;
  const live = start && !over && now >= start;
  return (
    <div style={{
      position: "relative", borderRadius: 16, padding: isMobile ? "18px 16px" : "26px 30px", overflow: "hidden",
      background: `linear-gradient(120deg, ${ev.dark} 0%, ${ev.color} 75%, ${ev.accent} 140%)`, boxShadow: "0 10px 28px rgba(0,0,0,0.2)",
      display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 16 : 26, alignItems: isMobile ? "stretch" : "center",
    }}>
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", textAlign: isMobile ? "center" : "left", gap: isMobile ? 10 : 22, flex: 1, minWidth: 0 }}>
        <div style={{ width: isMobile ? 90 : 128, height: isMobile ? 90 : 128, flexShrink: 0, display: "grid", placeItems: "center", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.35))" }}>
          {ev.logo ? <img src={ev.logo} alt={`${ev.name} logo`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <ProDayBadge badge={GENERIC_PRO_DAY} id="hero" size={isMobile ? 84 : 128} year={year} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD }}>{kicker || (past ? `${year} NFL Draft Class` : `Road to the ${year} NFL Draft`)}</div>
          <FitTitle text={title || `${year} ${ev.name}`} max={isMobile ? 28 : 38} min={isMobile ? 16 : 22} />
          <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 800, color: "rgba(255,255,255,0.92)", fontFamily: BODY_FONT }}>
            {note || (past ? "Results for the class's drafted players" : `${start ? rangeLabel({ start, finish: end || start }) : "Dates to come"}${ev.location ? ` · ${ev.location}` : ""}`)}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, justifyContent: isMobile ? "center" : "flex-start" }}>
            {count > 0 && <Pill>{count} {ev.slug === "combine" && !past ? "invited" : "players"}</Pill>}
            {schools > 0 && <Pill>{schools} schools</Pill>}
          </div>
        </div>
      </div>
      {start && (
        <div style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 14, padding: "12px 14px", minWidth: isMobile ? 0 : 290 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD, marginBottom: 10 }}>
            {live && <span style={{ width: 8, height: 8, borderRadius: 999, background: "#2ecc71", boxShadow: "0 0 0 3px rgba(46,204,113,0.3)" }} />}
            {over ? "Completed" : live ? "Happening now" : `Starts ${WEEKDAYS[start.getDay()]}, ${MON(start)} ${start.getDate()}`}
          </div>
          {!over && !live ? <Countdown target={start} now={now} isMobile={isMobile} /> : (
            <div style={{ color: "#fff", fontSize: 15, fontWeight: 900 }}>{over ? `Wrapped ${MON(end)} ${end.getDate()}` : `Through ${MON(end || start)} ${(end || start).getDate()}`}</div>
          )}
        </div>
      )}
    </div>
  );
}
// The event's name on one line: as big as max, shrunk to the room its
// column has ("2027 NFL Scouting Combine" would otherwise stack).
let measureCtx = null;
function FitTitle({ text, max, min }) {
  const ref = useRef(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const fit = () => {
      const h = ref.current;
      if (!h) return;
      if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
      measureCtx.font = `900 ${max}px "Arial Black", Arial, sans-serif`;
      const need = measureCtx.measureText(text.toUpperCase()).width;
      const room = h.clientWidth * 0.97;
      setSize(room && need > room ? Math.max(min, Math.floor((max * room) / need)) : max);
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("pagezoomchange", fit);
    return () => { window.removeEventListener("resize", fit); window.removeEventListener("pagezoomchange", fit); };
  }, [text, max, min]);
  return (
    <h1 ref={ref} style={{ margin: "4px 0 6px", fontSize: size, fontWeight: 900, color: "#fff", textTransform: "uppercase", lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {text}
    </h1>
  );
}
const Pill = ({ children }) => <span style={{ padding: "4px 11px", borderRadius: 999, background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: 11, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" }}>{children}</span>;

// ── Overview (Combine, all-star games) ──
function Overview({ ev, year, people, dates, isMobile }) {
  const today = startOfToday();
  return (
    <>
      <p style={{ margin: "0 0 4px", fontSize: isMobile ? 14 : 16, fontWeight: 600, color: "#3a4352", lineHeight: 1.6, fontFamily: BODY_FONT }}>{ev.about}</p>

      <SectionHead icon="calendar" title="Key Dates" isMobile={isMobile} color={ev.color} />
      {ev.slug === "combine" ? <CombineKeyDates ev={ev} year={year} dates={dates} today={today} isMobile={isMobile} /> : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {dates.entries.map((e) => <DateCard key={e.id} e={e} ev={ev} today={today} isMobile={isMobile} />)}
        </div>
      )}

      {ev.slug === "combine" && (
        <>
          <SectionHead icon="stopwatch" title="Day-by-Day Schedule" isMobile={isMobile} color={ev.color} />
          <CombineSchedule isMobile={isMobile} today={today} />
        </>
      )}

      {ev.teams ? (
        // The rosters live on the Participants tab.
        <div style={{ marginTop: 18 }}>
          <Link to={eventPath(ev.slug, year, "participants")} style={ctaStyle(ev)}>{people.length ? `See all ${people.length} participants →` : "Participants →"}</Link>
        </div>
      ) : (
        <>
          <SectionHead icon="users" title="Invites by Position" isMobile={isMobile} color={ev.color} />
          {people.length ? <PositionTiles ev={ev} year={year} people={people} tab="participants" isMobile={isMobile} /> : <Empty ev={ev}>The invite list posts here once the NFL sends it out.<ClassButton ev={ev} year={year} /></Empty>}
          {people.some((p) => p.results && Object.values(p.results).some((v) => v !== "" && v != null)) && (
            <div style={{ marginTop: 12 }}><Link to={eventPath(ev.slug, year, "results")} style={ctaStyle(ev)}>See the results →</Link></div>
          )}
        </>
      )}
    </>
  );
}

// The Combine's key dates as one graphic: the day it opens, then each
// on-field workout day with the positions working out (each → its results).
const POS_LINK = { "K/P": "K" };
function CombineKeyDates({ ev, year, dates, today, isMobile }) {
  const open = dates.entries.find((e) => e.id === "combine") || dates.entries[0];
  const workouts = DRAFT_EVENTS.filter((e) => e.type === "workout").map((e) => ({ ...e, start: parseDay(e.date) })).sort((a, b) => a.start - b.start);
  if (!open) return null;
  const dim = (d) => ({ opacity: d < today ? 0.5 : 1 });
  const big = (d, size) => (
    <>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: GOLD }}>{WEEKDAYS[d.getDay()]}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, color: "#fff", lineHeight: 0.95 }}>
        <span style={{ fontSize: Math.round(size * 0.42), fontWeight: 900, textTransform: "uppercase", opacity: 0.85 }}>{MON(d)}</span>
        <span style={{ fontSize: size, fontWeight: 900 }}>{d.getDate()}</span>
      </div>
    </>
  );
  return (
    <div style={{
      position: "relative", borderRadius: 18, overflow: "hidden", color: "#fff",
      background: `linear-gradient(135deg, ${ev.dark} 0%, ${ev.color} 60%, ${ev.accent} 130%)`, boxShadow: "0 12px 30px rgba(0,30,70,0.25)",
      display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 0.9fr) minmax(0, 2.1fr)",
    }}>
      {/* Faint yard lines behind it all. */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 64px)", pointerEvents: "none" }} />

      {/* Opening day */}
      <div style={{ position: "relative", padding: isMobile ? "18px 18px 16px" : "24px", background: "rgba(0,0,0,0.22)", borderRight: isMobile ? "none" : `4px solid ${GOLD}`, borderBottom: isMobile ? `4px solid ${GOLD}` : "none", display: "flex", alignItems: "center", gap: 16, ...dim(open.finish) }}>
        <img src={ev.logo} alt="" style={{ width: isMobile ? 54 : 64, height: isMobile ? 54 : 64, objectFit: "contain", filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.4))" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>Combine opens</div>
          {big(open.start, isMobile ? 46 : 56)}
          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)", fontFamily: BODY_FONT, marginTop: 6 }}>
            Through {WEEKDAYS[open.finish.getDay()]}, {MON(open.finish)} {open.finish.getDate()} · {ev.location}
          </div>
        </div>
      </div>

      {/* On-field workouts */}
      <div style={{ position: "relative", padding: isMobile ? "16px 14px 18px" : "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12 }}>
          <Icon name="stopwatch" size={16} stroke={2.4} style={{ color: GOLD }} />On-field workouts
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          {workouts.map((w) => {
            const isToday = sameDay(w.start, today);
            return (
              <div key={w.id} style={{
                background: isToday ? "rgba(246,162,29,0.22)" : "rgba(255,255,255,0.1)", border: `1px solid ${isToday ? GOLD : "rgba(255,255,255,0.18)"}`,
                borderTop: `4px solid ${GOLD}`, borderRadius: 12, padding: "10px 12px 12px", ...dim(w.start),
              }}>
                {big(w.start, isMobile ? 34 : 40)}
                {isToday && <div style={{ fontSize: 10, fontWeight: 900, color: GOLD, letterSpacing: "0.12em", marginTop: 2 }}>TODAY</div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                  {w.short.split(" · ").map((g) => (
                    <Link key={g} to={eventPath(ev.slug, year, "results", POS_LINK[g] || g)} title={`${POS_NAMES[POS_LINK[g] || g] || g} results`} style={{
                      padding: "3px 8px", borderRadius: 6, background: "#fff", color: ev.dark, fontSize: 12, fontWeight: 900, textDecoration: "none", letterSpacing: "0.03em",
                    }}>{g}</Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ctaStyle = (ev) => ({ display: "inline-block", padding: "9px 16px", borderRadius: 999, background: ev.color, color: "#fff", fontSize: 12, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase", textDecoration: "none" });

function DateCard({ e, ev, today, isMobile }) {
  const done = today > e.finish;
  const live = !done && today >= e.start;
  return (
    <div style={{ display: "flex", background: "#fff", border: "1px solid #e2e7ef", borderRadius: 12, overflow: "hidden", opacity: done ? 0.65 : 1 }}>
      <div style={{ width: isMobile ? 62 : 72, flexShrink: 0, background: ev.color, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "8px 2px" }}>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.85 }}>{MON(e.start)}</div>
        <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1 }}>{e.start.getDate()}{!sameDay(e.start, e.finish) && e.finish.getMonth() === e.start.getMonth() ? <span style={{ fontSize: 13 }}>–{e.finish.getDate()}</span> : null}</div>
        {e.finish.getMonth() !== e.start.getMonth() && <div style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase" }}>– {MON(e.finish)} {e.finish.getDate()}</div>}
        <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.75, marginTop: 2 }}>{WEEKDAYS[e.start.getDay()]}</div>
      </div>
      <div style={{ padding: "10px 12px", minWidth: 0 }}>
        {live && <div style={{ fontSize: 10, fontWeight: 900, color: "#1e8449", textTransform: "uppercase", letterSpacing: "0.08em" }}>● Happening now</div>}
        <div style={{ fontSize: 15, fontWeight: 900, color: "#1c2330", lineHeight: 1.2 }}>{e.title}</div>
        {e.blurb && <div style={{ fontSize: 12, fontWeight: 600, color: "#5a6475", fontFamily: BODY_FONT, marginTop: 3, lineHeight: 1.4 }}>{e.blurb}</div>}
      </div>
    </div>
  );
}

// Until the invites are out: the class on the Community Board.
const ClassButton = ({ ev, year }) => (
  <div style={{ marginTop: 12 }}>
    <Link to={`/community/${year}`} style={ctaStyle(ev)}>View the {year} class →</Link>
  </div>
);

function Empty({ ev, children }) {
  return (
    <div style={{ border: `2px dashed ${ev.color}44`, background: "#f8fafc", borderRadius: 14, padding: "20px 18px", color: "#5a6475", fontSize: 14, fontWeight: 700, fontFamily: BODY_FONT, textAlign: "center" }}>{children}</div>
  );
}

// Count per position, each linking to that position's list.
function PositionTiles({ ev, year, people, tab, isMobile }) {
  const counts = EVENT_POSITIONS.map((p) => [p, people.filter((x) => x.position === p).length]).filter(([, n]) => n);
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
      {counts.map(([p, n]) => (
        <Link key={p} to={eventPath(ev.slug, year, tab, p)} style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e7ef", borderRadius: 12, padding: "10px 6px", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: ev.color, lineHeight: 1 }}>{n}</div>
          <div style={{ fontSize: 11, fontWeight: 900, color: "#5a6475", letterSpacing: "0.06em", marginTop: 4 }}>{p}</div>
        </Link>
      ))}
    </div>
  );
}

// ── Participants ──
function PosChips({ ev, year, tab, pos, people }) {
  const present = EVENT_POSITIONS.filter((p) => people.some((x) => x.position === p));
  const chip = (on) => ({
    padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 900, letterSpacing: "0.04em", textDecoration: "none",
    background: on ? ev.color : "#fff", color: on ? "#fff" : "#3a4352", border: `2px solid ${on ? ev.color : "#d8dee8"}`,
  });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
      <Link to={eventPath(ev.slug, year, tab)} style={chip(!pos)}>All</Link>
      {(present.length ? present : EVENT_POSITIONS).map((p) => <Link key={p} to={eventPath(ev.slug, year, tab, p)} style={chip(pos === p)}>{p}</Link>)}
    </div>
  );
}

function Participants({ ev, year, people, pos, isMobile, schedule, badgeFor }) {
  const shown = pos ? people.filter((p) => p.position === pos) : people;
  if (!people.length) {
    return <Empty ev={ev}>{ev.slug === "pro-days" ? "Participants post here as each school sets its pro day." : ev.slug === "combine" ? <>The invite list posts here once the NFL sends it out.<ClassButton ev={ev} year={year} /></> : "Rosters post here as invitations go out."}</Empty>;
  }
  return (
    <>
      <PosChips ev={ev} year={year} tab="participants" pos={pos} people={people} />
      {ev.teams ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          {ev.teams.map((team, i) => <TeamColumn key={team} ev={ev} team={team} people={shown.filter((p) => p.team === team)} accent={i ? ev.accent : ev.accent2 || ev.color} year={year} />)}
          {shown.some((p) => !ev.teams.includes(p.team)) && <TeamColumn ev={ev} team="" people={shown.filter((p) => !ev.teams.includes(p.team))} accent="#8a94a6" year={year} />}
        </div>
      ) : ev.slug === "pro-days" ? (
        <div style={{ display: "grid", gap: 12 }}>
          {schedule.map((d) => {
            const list = shown.filter((p) => p.day === d.key);
            if (!list.length) return null;
            return (
              <div key={d.key} style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 14, overflow: "hidden" }}>
                <ProDayHeader d={d} ev={ev} badgeFor={badgeFor} count={list.length} year={year} />
                <PlayerList people={list} />
              </div>
            );
          })}
          {shown.some((p) => !schedule.some((d) => d.key === p.day)) && (
            <div style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 900, color: "#5a6475", textTransform: "uppercase" }}>Pro day to be announced</div>
              <PlayerList people={shown.filter((p) => !schedule.some((d) => d.key === p.day))} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 14, overflow: "hidden" }}>
          <PlayerList people={shown} />
        </div>
      )}
      {!shown.length && <Empty ev={ev}>No {POS_NAMES[pos]?.toLowerCase() || pos}s yet.</Empty>}
    </>
  );
}

function TeamColumn({ ev, team, people, accent, limit = 0, year }) {
  const list = limit ? people.slice(0, limit) : people;
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ background: accent, color: "#fff", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 900, textTransform: "uppercase", flex: 1 }}>{team ? `${team} Team` : "Team TBA"}</span>
        <span style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>{people.length}</span>
      </div>
      {list.length ? <PlayerList people={list} /> : <div style={{ padding: 14, fontSize: 13, fontWeight: 700, color: "#8a94a6", fontFamily: BODY_FONT }}>Roster to come.</div>}
      {limit > 0 && people.length > limit && (
        <Link to={eventPath(ev.slug, year, "participants")} style={{ display: "block", padding: "10px 14px", fontSize: 12, fontWeight: 900, color: ev.color, textDecoration: "none", borderTop: "1px solid #eef1f5" }}>
          All {people.length} →
        </Link>
      )}
    </div>
  );
}

// Rows: school logo, name (→ player page), position, school (→ team page).
function PlayerList({ people }) {
  const brands = useSchools(people.map((p) => p.school));
  return (
    <div>
      {people.map((p, i) => {
        const href = playerHref(p);
        const logo = brands[p.school]?.Logo1;
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderTop: i ? "1px solid #eef1f5" : "none" }}>
            <span style={{ width: 28, height: 28, flexShrink: 0, display: "grid", placeItems: "center" }}>
              {logo ? <img src={logo} alt="" loading="lazy" style={{ width: 28, height: 28, objectFit: "contain" }} /> : null}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "#1c2330", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {href ? <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>{p.name}</Link> : p.name}
              </span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#6b7685", fontFamily: BODY_FONT }}>
                {p.school ? <Link to={schoolHref(p.school)} style={{ color: "inherit", textDecoration: "none" }}>{p.school}</Link> : "—"}
              </span>
            </span>
            <span style={{ fontSize: 11, fontWeight: 900, color: "#3a4352", background: "#eef2f7", borderRadius: 6, padding: "3px 7px" }}>{p.position || "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Pro days ──
function ProDayHeader({ d, ev, badgeFor, count, year }) {
  const badge = badgeFor(d.school);
  return (
    <div id={d.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#f8fafc", borderBottom: "1px solid #eef1f5" }}>
      {badge ? <ProDayBadge badge={badge} id={`h-${d.key}`} size={52} year={year} /> : <span style={{ width: 52 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to={schoolHref(d.school)} style={{ fontSize: 16, fontWeight: 900, color: "#1c2330", textDecoration: "none" }}>{d.school}</Link>
        <div style={{ fontSize: 12, fontWeight: 800, color: ev.color, fontFamily: BODY_FONT }}>{WEEKDAYS[d.start.getDay()]}, {MON(d.start)} {d.start.getDate()}</div>
      </div>
      {count != null && <span style={{ fontSize: 12, fontWeight: 900, color: "#5a6475" }}>{count} player{count === 1 ? "" : "s"}</span>}
    </div>
  );
}

function ProDaySchedule({ ev, year, people, schedule, isMobile, badgeFor }) {
  const byDate = [];
  schedule.forEach((d) => {
    const last = byDate[byDate.length - 1];
    if (last && sameDay(last.date, d.start)) last.days.push(d); else byDate.push({ date: d.start, days: [d] });
  });
  return (
    <>
      <p style={{ margin: "0 0 4px", fontSize: isMobile ? 14 : 16, fontWeight: 600, color: "#3a4352", lineHeight: 1.6, fontFamily: BODY_FONT }}>{ev.about}</p>
      <SectionHead icon="calendar" title={`${year} Pro Day Schedule`} isMobile={isMobile} color={ev.color} />
      {!schedule.length ? <Empty ev={ev}>Schools announce their pro days through the winter — each one posts here as it's set. Pro days start Tue, Mar 9.</Empty> : (
        <div style={{ display: "grid", gap: 14 }}>
          {byDate.map(({ date, days }) => (
            <div key={date.toISOString()}>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8a94a6", margin: "0 0 6px" }}>
                {WEEKDAYS[date.getDay()]}, {MONTHS[date.getMonth()]} {date.getDate()}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                {days.map((d) => {
                  const list = people.filter((p) => p.day === d.key);
                  return (
                    <div key={d.key} style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 14, overflow: "hidden" }}>
                      <ProDayHeader d={d} ev={ev} badgeFor={badgeFor} count={list.length} year={year} />
                      {list.length > 0 && <PlayerList people={list} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Combine results ──
const hasVal = (v) => v !== "" && v != null && Number.isFinite(toNumber(v));
function Results({ ev, year, people, pos, isMobile, past }) {
  const [sort, setSort] = useState({ key: "forty", dir: 0 });
  const metric = RESULT_COLS.find((m) => m.key === sort.key);
  const asc = sort.dir ? sort.dir > 0 : !!metric?.lowerIsBetter;
  const shown = (pos ? people.filter((p) => p.position === pos) : people).filter((p) => p.results && RESULT_COLS.some((m) => hasVal(p.results[m.key])));
  const rows = [...shown].sort((a, b) => {
    const x = a.results?.[sort.key], y = b.results?.[sort.key];
    if (!hasVal(x) && !hasVal(y)) return 0;
    if (!hasVal(x)) return 1;
    if (!hasVal(y)) return -1;
    return asc ? toNumber(x) - toNumber(y) : toNumber(y) - toNumber(x);
  });
  const brands = useSchools(rows.map((p) => p.school));
  const click = (key) => setSort((s) => (s.key === key ? { key, dir: (s.dir || (RESULT_COLS.find((m) => m.key === key)?.lowerIsBetter ? 1 : -1)) * -1 } : { key, dir: 0 }));
  const th = (on) => ({ padding: "9px 8px", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: on ? "#fff" : "#5a6475", background: on ? ev.color : "#f1f4f8", cursor: "pointer", whiteSpace: "nowrap", textAlign: "center", userSelect: "none" });
  return (
    <>
      <PosChips ev={ev} year={year} tab="results" pos={pos} people={people} />
      {!rows.length ? (
        <Empty ev={ev}>
          {pos ? `No ${POS_NAMES[pos]?.toLowerCase() || pos} results ${past ? "on file" : "yet"}. ` : `No results ${past ? "on file" : "yet"}. `}
          {past ? null : <>Results post as each group works out: {COMBINE_SCHEDULE.groups.map((g) => {
            const d = g.days.find(([, items]) => items.includes("On-Field Workout"));
            const day = d ? parseDay(d[0]) : null;
            return day ? `${g.label} on ${WEEKDAYS[day.getDay()]}, ${MON(day)} ${day.getDate()}` : null;
          }).filter(Boolean).join(" · ")}.</>}
        </Empty>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BODY_FONT, minWidth: past ? 940 : 860 }}>
            <thead>
              <tr>
                <th style={{ ...th(false), cursor: "default", width: 36 }}>#</th>
                <th style={{ ...th(false), cursor: "default", textAlign: "left", position: "sticky", left: 0, zIndex: 1 }}>Player</th>
                <th style={{ ...th(false), cursor: "default" }}>Pos</th>
                {past && <th style={{ ...th(false), cursor: "default" }}>Draft</th>}
                {RESULT_COLS.map((m) => (
                  <th key={m.key} onClick={() => click(m.key)} title={`Sort by ${m.label}`} style={th(sort.key === m.key)}>
                    {SHORT_LABEL[m.key]}{sort.key === m.key ? (asc ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const href = playerHref(p);
                return (
                  <tr key={p.id} style={{ borderTop: "1px solid #eef1f5" }}>
                    <td style={{ padding: "8px", textAlign: "center", fontSize: 12, fontWeight: 900, color: "#8a94a6" }}>{hasVal(p.results?.[sort.key]) ? i + 1 : "—"}</td>
                    <td style={{ padding: "8px", position: "sticky", left: 0, background: "#fff", minWidth: isMobile ? 150 : 210 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {brands[p.school]?.Logo1 && <img src={brands[p.school].Logo1} alt="" loading="lazy" style={{ width: 22, height: 22, objectFit: "contain" }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 900, color: "#1c2330", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                            {href ? <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>{p.name}</Link> : p.name}
                          </div>
                          {p.school && <Link to={schoolHref(p.school)} style={{ fontSize: 11, fontWeight: 700, color: "#6b7685", textDecoration: "none" }}>{p.school}</Link>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "8px", textAlign: "center", fontSize: 12, fontWeight: 900, color: "#3a4352" }}>{p.position}</td>
                    {past && (
                      <td style={{ padding: "8px", textAlign: "center", fontSize: 11, fontWeight: 800, color: "#3a4352", whiteSpace: "nowrap" }}>
                        {p.round ? `Rd ${p.round}${p.pick ? ` · #${p.pick}` : ""}` : "—"}
                        {p.team && <div style={{ fontSize: 10, fontWeight: 700, color: "#8a94a6" }}>{p.team}</div>}
                      </td>
                    )}
                    {RESULT_COLS.map((m) => {
                      const v = p.results?.[m.key];
                      return (
                        <td key={m.key} style={{ padding: "8px", textAlign: "center", fontSize: 13, fontWeight: sort.key === m.key ? 900 : 700, color: sort.key === m.key ? ev.color : "#1c2330", background: sort.key === m.key ? `${ev.color}0d` : "transparent", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {hasVal(v) ? formatCombine(m.key, toNumber(v)) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Combine: the year links (every year with results + the next one) ──
function YearSwitch({ ev, year, tab, pos, index }) {
  const years = [COMBINE_EVENT_YEAR, ...Object.keys(index?.years || {}).map(Number).sort((a, b) => b - a)];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, overflowX: "auto", margin: "-6px 0 14px", paddingBottom: 2 }}>
      <Link to="/events/combine" style={{ flexShrink: 0, fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: ev.color, textDecoration: "none", marginRight: 4 }}>All-time</Link>
      {years.map((y) => (
        <Link key={y} to={eventPath("combine", y, tab, pos)} style={{
          flexShrink: 0, padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 900, textDecoration: "none",
          background: y === year ? ev.color : "#eef2f7", color: y === year ? "#fff" : "#5a6475",
        }}>{y}</Link>
      ))}
    </div>
  );
}

// A past Combine's overview: the best in each drill, then who's on file by position.
const DRILLS = ["forty", "vertical", "broad", "bench", "threeCone", "shuttle"];
function PastCombineOverview({ ev, year, people, isMobile }) {
  const top = (key) => {
    const m = RESULT_COLS.find((x) => x.key === key);
    return people.filter((p) => p.results?.[key] != null)
      .sort((a, b) => (m.lowerIsBetter ? a.results[key] - b.results[key] : b.results[key] - a.results[key])).slice(0, 3);
  };
  return (
    <>
      <p style={{ margin: "0 0 4px", fontSize: isMobile ? 14 : 16, fontWeight: 600, color: "#3a4352", lineHeight: 1.6, fontFamily: BODY_FONT }}>
        Combine results and measurements from the {year} draft class — the players who were drafted, with where they went.
      </p>
      <SectionHead icon="stopwatch" title="Top Performers" isMobile={isMobile} color={ev.color} />
      {people.length ? (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {DRILLS.map((k) => {
            const list = top(k);
            if (!list.length) return null;
            return (
              <div key={k} style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "8px 12px", background: ev.color, color: "#fff", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {RESULT_COLS.find((m) => m.key === k)?.label}
                </div>
                {list.map((p, i) => {
                  const href = playerHref(p);
                  return (
                    <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderTop: i ? "1px solid #eef1f5" : "none" }}>
                      <span style={{ width: 16, fontSize: 12, fontWeight: 900, color: "#8a94a6" }}>{i + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 900, color: "#1c2330", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {href ? <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>{p.name}</Link> : p.name}
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#8a94a6", fontFamily: BODY_FONT }}> · {p.position}</span>
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 900, color: ev.color, fontVariantNumeric: "tabular-nums" }}>{formatCombine(k, p.results[k])}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : <Empty ev={ev}>No results on file for {year} yet.</Empty>}
      <SectionHead icon="users" title="Results by Position" isMobile={isMobile} color={ev.color} />
      <PositionTiles ev={ev} year={year} people={people} tab="results" isMobile={isMobile} />
    </>
  );
}

// ── /events/combine — the all-time hub ──
function CombineHub({ index, isMobile, now }) {
  const ev = EVENT_PAGES.combine;
  const contentRef = useRef(null);
  const next = eventDates("combine");
  const years = Object.entries(index?.years || {}).map(([y, v]) => ({ year: Number(y), ...v })).sort((a, b) => b.year - a.year);
  const firstYear = years.length ? years[years.length - 1].year : null;
  const latestPast = years[0]?.year;
  const avg = index?.averages || {};
  const positions = [...EVENT_POSITIONS.filter((p) => avg[p]), ...Object.keys(avg).filter((p) => !EVENT_POSITIONS.includes(p)).sort()];
  const cols = COMBINE_KEYS.filter((k) => positions.some((p) => avg[p]?.[k]));
  const title = `NFL Combine Results, Averages and History${firstYear ? ` (${firstYear}–${COMBINE_EVENT_YEAR})` : ""}`;
  const description = `Every NFL Scouting Combine we have on file${firstYear ? ` since ${firstYear}` : ""}: year-by-year results, average 40 times, verticals, broad jumps and measurements by position, and the ${COMBINE_EVENT_YEAR} Combine schedule and invites.`;
  const url = `${SITE}/events/combine`;
  return (
    <>
      <Helmet>
        <title>{`${title} | We-Draft.com`}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta property="og:image" content={`${SITE}${ev.logo}`} />
        <meta name="twitter:card" content="summary" />
      </Helmet>
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={24} />
      <div ref={contentRef} style={{ maxWidth: COLUMN_WIDTH, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        <nav style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a94a6", marginBottom: 10 }}>
          <Link to="/events" style={{ color: ev.color, textDecoration: "none" }}>Events</Link><span>›</span><span style={{ color: "#5a6475" }}>Combine</span>
        </nav>
        <Hero ev={ev} year={COMBINE_EVENT_YEAR} start={next.start} end={next.end} now={now} isMobile={isMobile}
          title="NFL Scouting Combine" kicker={firstYear ? `Every Combine since ${firstYear}` : "Every Combine"}
          note={`Next: ${COMBINE_EVENT_YEAR} Combine · ${next.start ? rangeLabel({ start: next.start, finish: next.end }) : ""} · ${ev.location}`} />

        <SectionHead icon="calendar" title={`The ${COMBINE_EVENT_YEAR} Combine`} isMobile={isMobile} color={ev.color} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link to={eventPath("combine", COMBINE_EVENT_YEAR)} style={ctaStyle(ev)}>Schedule & key dates →</Link>
          <Link to={eventPath("combine", COMBINE_EVENT_YEAR, "participants")} style={{ ...ctaStyle(ev), background: ev.dark }}>Invites →</Link>
          <Link to={eventPath("combine", COMBINE_EVENT_YEAR, "results")} style={{ ...ctaStyle(ev), background: ev.accent }}>Results →</Link>
        </div>

        <SectionHead icon="stopwatch" title="Average Results by Position" isMobile={isMobile} color={ev.color} />
        {!positions.length ? <Empty ev={ev}>All-time averages are being compiled.</Empty> : (
          <>
            <div style={{ background: "#fff", border: "1px solid #e2e7ef", borderRadius: 14, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: BODY_FONT, minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "#f1f4f8" }}>
                    <th style={{ padding: "9px 10px", fontSize: 11, fontWeight: 900, textTransform: "uppercase", color: "#5a6475", textAlign: "left" }}>Pos</th>
                    {cols.map((k) => <th key={k} style={{ padding: "9px 8px", fontSize: 11, fontWeight: 900, textTransform: "uppercase", color: "#5a6475", whiteSpace: "nowrap" }}>{SHORT_LABEL[k]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p} style={{ borderTop: "1px solid #eef1f5" }}>
                      <td style={{ padding: "8px 10px", fontSize: 13, fontWeight: 900 }}>
                        {latestPast && EVENT_POSITIONS.includes(p)
                          ? <Link to={eventPath("combine", latestPast, "results", p)} style={{ color: ev.color, textDecoration: "none" }}>{p}</Link> : p}
                      </td>
                      {cols.map((k) => (
                        <td key={k} title={avg[p]?.[k] ? `Average of ${avg[p][k].n}` : ""} style={{ padding: "8px", textAlign: "center", fontSize: 13, fontWeight: 700, color: "#1c2330", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {avg[p]?.[k] ? formatCombine(k, avg[p][k].avg) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, fontStyle: "italic", color: "#8a94a6", fontFamily: BODY_FONT }}>
              Averages of every drafted player's results on file{firstYear ? `, ${firstYear}–${latestPast}` : ""}.
            </div>
          </>
        )}

        <SectionHead icon="calendar" title="Every Combine" isMobile={isMobile} color={ev.color} />
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, minmax(0, 1fr))" : "repeat(auto-fill, minmax(118px, 1fr))", gap: 8 }}>
          <Link to={eventPath("combine", COMBINE_EVENT_YEAR)} style={{ textDecoration: "none", background: ev.color, borderRadius: 12, padding: "12px 8px", textAlign: "center", color: "#fff" }}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{COMBINE_EVENT_YEAR}</div>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.85 }}>Upcoming</div>
          </Link>
          {years.map((y) => (
            <Link key={y.year} to={eventPath("combine", y.year)} style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e7ef", borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: ev.color }}>{y.year}</div>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#8a94a6", fontFamily: BODY_FONT }}>{y.players} players</div>
            </Link>
          ))}
        </div>
        {!years.length && <div style={{ marginTop: 8 }}><Empty ev={ev}>Past Combines are being compiled.</Empty></div>}

        <MoreEvents current="combine" year={COMBINE_EVENT_YEAR} isMobile={isMobile} />
      </div>
    </>
  );
}

// ── The other events + the calendar ──
function MoreEvents({ current, year, isMobile }) {
  return (
    <>
      <SectionHead icon="calendar" title="More Draft Events" isMobile={isMobile} color={NAVY} />
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))", gap: 10 }}>
        {Object.values(EVENT_PAGES).filter((e) => e.slug !== current).map((e) => (
          <Link key={e.slug} to={eventPath(e.slug, year)} style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e7ef", borderTop: `4px solid ${e.color}`, borderRadius: 12, padding: "12px 8px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            {e.logo ? <img src={e.logo} alt="" style={{ height: 44, maxWidth: "80%", objectFit: "contain" }} /> : <ProDayBadge badge={GENERIC_PRO_DAY} id={`more-${e.slug}`} size={48} year={year} />}
            <span style={{ fontSize: 12, fontWeight: 900, color: "#1c2330" }}>{e.name}</span>
          </Link>
        ))}
        <Link to="/portal" style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e7ef", borderTop: "4px solid #b8860b", borderRadius: 12, padding: "12px 8px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <img src="/logos/transfer-portal.svg" alt="" style={{ height: 40 }} />
          <span style={{ fontSize: 12, fontWeight: 900, color: "#1c2330" }}>Transfer Portal</span>
        </Link>
        <Link to="/events" style={{ textDecoration: "none", background: NAVY, borderRadius: 12, padding: "12px 8px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: "#fff" }}>
          <Icon name="calendar" size={30} />
          <span style={{ fontSize: 12, fontWeight: 900 }}>Full Calendar</span>
        </Link>
      </div>
    </>
  );
}
