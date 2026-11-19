// src/pages/DraftCalendar.jsx
//
// /events (was /calendar) — the draft season's key dates (CFP title game,
// transfer window, all-star games, Combine, pro days, the draft itself) as
// a month calendar plus a timeline, and the way into each event's page
// (/events/{event}/{year} — EventPage.jsx). Dates: utils/draftCalendar.js;
// pro days: events/{year} (utils/events.js).
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import MarginAds from "../components/MarginAds";
import { TopProspectsRail, RecentVideosRail } from "../components/DraftSideRails";
import { viewportCssWidth } from "../utils/pageZoom";
import { useAccoladeIcons } from "../utils/accoladeIcons";
import { EVENT_TYPES, DRAFT_START, allEvents, eventsByDay, dayKey } from "../utils/draftCalendar";
import { Link } from "react-router-dom";
import { fetchDraft, UPCOMING_DRAFTS } from "../components/UpcomingPicks";
import { fetchNflBranding } from "../utils/draftProfileData";
import { NFL_TEAMS } from "../utils/coachHistory";
import { GENERIC_PRO_DAY } from "../utils/proDayIcon";
import { EVENT_PAGES, eventPath, eventDates, proDaySchedule, useEventYear } from "../utils/events";
import {
  BLUE, NAVY, GOLD, BODY_FONT, WEEKDAYS, MONTHS, MON, DAY_MS, BadgeFont, Icon, ICON_FOR, EventMark, ProDayBadge,
  startOfToday, sameDay, rangeLabel, status, SectionHead, useProDayBadges,
} from "../components/events/EventKit";

const DRAFT_YEAR = 2027;

const COLUMN_WIDTH = 1000;
const RAIL_WIDTH = 220;
const RAIL_GAP = 16;
const SIDE = RAIL_WIDTH + RAIL_GAP;
const railsFit = () => viewportCssWidth() >= COLUMN_WIDTH + 2 * SIDE + 32;


// A calendar entry's page: the event's own, the portal, the draft order.
const PAGE_OF = {
  ...Object.fromEntries(Object.values(EVENT_PAGES).flatMap((ev) => ev.calendarIds.map((id) => [id, eventPath(ev.slug)]))),
  "combine-wo-dl": eventPath("combine"), "combine-wo-db": eventPath("combine"), "combine-wo-qb": eventPath("combine"), "combine-wo-ol": eventPath("combine"),
  "portal-open": "/portal", "portal-close": "/portal",
  "draft-r1": "/draftorder", "draft-r23": "/draftorder", "draft-r47": "/draftorder",
};
const pageOf = (e) => (e.type === "proday" ? eventPath("pro-days") : PAGE_OF[e.id] || "");

export default function DraftCalendar() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [showRails, setShowRails] = useState(() => typeof window !== "undefined" && railsFit());
  const [now, setNow] = useState(() => new Date());
  const contentRef = useRef(null);

  useEffect(() => {
    const onResize = () => { setIsMobile(window.innerWidth < 768); setShowRails(railsFit()); };
    window.addEventListener("resize", onResize);
    window.addEventListener("pagezoomchange", onResize);
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pagezoomchange", onResize);
      clearInterval(tick);
    };
  }, []);
  const rails = showRails && !isMobile;

  // Whoever holds the 2027 No. 1 pick (draftOrders — the /draftorder data).
  const [firstPick, setFirstPick] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([fetchDraft(UPCOMING_DRAFTS[0]), fetchNflBranding().catch(() => ({}))])
      .then(([draft, brands]) => {
        const p = (draft?.picks || []).find((x) => x.Round === 1 && x.Pick === 1);
        const abbr = p && (p.Traded || p.Team);
        if (!abbr || !live) return;
        const b = brands?.[abbr] || {};
        setFirstPick({ abbr, name: NFL_TEAMS[abbr] || abbr, nick: (NFL_TEAMS[abbr] || abbr).split(" ").pop(), logo: b.LogoDark || b.Logo1 || "" });
      })
      .catch((e) => console.error("First pick load error:", e));
    return () => { live = false; };
  }, []);

  // The year's pro day schedule (Admin → Events) and each school's badge.
  const yearData = useEventYear(DRAFT_YEAR);
  const schedule = useMemo(() => proDaySchedule(yearData), [yearData]);
  const badgeFor = useProDayBadges(schedule.length > 0);

  const icons = useAccoladeIcons();
  const events = useMemo(() => allEvents(schedule).map((e) => {
    if (e.generic) return { ...e, badge: GENERIC_PRO_DAY };
    if (e.type === "proday") {
      const badge = badgeFor(e.school);
      return badge ? { ...e, badge } : e;
    }
    const icon = e.accolade && icons?.award?.[e.accolade.toLowerCase()];
    return icon ? { ...e, logo: icon } : e;
  }), [icons, schedule, badgeFor]);
  const byDay = useMemo(() => eventsByDay(events), [events]);
  const today = startOfToday();
  const next = events.find((e) => e.finish >= today) || null;

  // The months the calendar can show: first event's month through the last's.
  const months = useMemo(() => {
    if (!events.length) return [];
    const out = [];
    const first = events[0].start;
    const last = events.reduce((m, e) => (e.finish > m ? e.finish : m), first);
    for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(d);
    return out;
  }, [events]);
  const initialMonth = () => {
    const anchor = next ? next.start : events[events.length - 1]?.start;
    const i = anchor ? months.findIndex((m) => m.getFullYear() === anchor.getFullYear() && m.getMonth() === anchor.getMonth()) : 0;
    return Math.max(0, i);
  };
  const [monthIdx, setMonthIdx] = useState(initialMonth);
  const [selected, setSelected] = useState(() => (next ? dayKey(next.start) : null));

  const month = months[monthIdx];
  const title = `${DRAFT_YEAR} NFL Draft Events Calendar — Key Dates`;
  const description = `Every key date on the road to the ${DRAFT_YEAR} NFL Draft: the CFP National Championship, the transfer window, the Senior Bowl, the East-West Shrine Bowl, the NFL Scouting Combine, pro days and all three days of the draft.`;
  const url = "https://we-draft.com/events";

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
      </Helmet>

      <BadgeFont />
      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={rails ? 0 : 24} watch={[rails]} />

      <div ref={contentRef} style={{ position: "relative", maxWidth: rails ? COLUMN_WIDTH + 2 * SIDE : COLUMN_WIDTH, margin: "0 auto", padding: rails ? `0 ${SIDE}px` : 0, boxSizing: "border-box" }}>
        {rails && (
          <>
            <div style={{ position: "absolute", top: 24, bottom: 60, left: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16 }}><TopProspectsRail year={DRAFT_YEAR} /></div>
            </div>
            <div style={{ position: "absolute", top: 24, bottom: 60, right: 0, width: RAIL_WIDTH }}>
              <div style={{ position: "sticky", top: 16 }}><RecentVideosRail /></div>
            </div>
          </>
        )}

        <div style={{ maxWidth: COLUMN_WIDTH, margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
          <Hero isMobile={isMobile} now={now} firstPick={firstPick} />

          {month && (
            <MonthGrid
              isMobile={isMobile} month={month} byDay={byDay} today={today}
              selected={selected} onSelect={setSelected}
              canPrev={monthIdx > 0} canNext={monthIdx < months.length - 1}
              onPrev={() => setMonthIdx((i) => i - 1)} onNext={() => setMonthIdx((i) => i + 1)}
              months={months} monthIdx={monthIdx} onMonth={setMonthIdx}
            />
          )}

          {/* ── Legend ── */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {Object.entries(EVENT_TYPES).filter(([, t]) => !t.noLegend).map(([k, t]) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px 5px 8px", borderRadius: 999, background: t.tint, color: t.color, fontSize: 11, fontWeight: 900, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                <Icon name={ICON_FOR[k]} size={15} />{t.label}
              </span>
            ))}
          </div>

          {selected && byDay[selected] && (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {byDay[selected].map((e) => <EventCard key={e.id} e={e} today={today} isMobile={isMobile} compact href={pageOf(e)} />)}
            </div>
          )}

          {/* ── Timeline ── */}
          <SectionHead icon="calendar" title="Every Key Date" isMobile={isMobile} />
          <div style={{ position: "relative", paddingLeft: isMobile ? 0 : 6 }}>
            {events.map((e, i) => {
              const showMonth = i === 0 || events[i - 1].start.getMonth() !== e.start.getMonth();
              return (
                <div key={e.id}>
                  {showMonth && (
                    <div style={{ margin: i === 0 ? "0 0 8px" : "18px 0 8px", fontSize: 12, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "#8a94a6" }}>
                      {MONTHS[e.start.getMonth()]} {e.start.getFullYear()}
                    </div>
                  )}
                  <div style={{ marginBottom: 10 }}>
                    <EventCard e={e} today={today} isMobile={isMobile} highlight={next && next.id === e.id} href={pageOf(e)} onClick={() => {
                      setSelected(dayKey(e.start));
                      const mi = months.findIndex((m) => m.getFullYear() === e.start.getFullYear() && m.getMonth() === e.start.getMonth());
                      if (mi >= 0) setMonthIdx(mi);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Event pages ── */}
          <SectionHead icon="calendar" title="Event Pages" isMobile={isMobile} />
          <EventPagesGrid isMobile={isMobile} today={today} proDayCount={schedule.length} />
        </div>
      </div>
    </>
  );
}

// ── Hero, with the countdown to Round 1 and who's on the clock ──
function Hero({ isMobile, now, firstPick }) {
  const ms = Math.max(0, DRAFT_START - now);
  const started = ms === 0;
  const parts = [
    ["Days", Math.floor(ms / DAY_MS)],
    ["Hrs", Math.floor((ms % DAY_MS) / 3600000)],
    ["Min", Math.floor((ms % 3600000) / 60000)],
    ["Sec", Math.floor((ms % 60000) / 1000)],
  ];
  return (
    <div style={{
      position: "relative", borderRadius: 16, padding: isMobile ? "20px 16px" : "30px 32px", marginBottom: 18, overflow: "hidden",
      background: `linear-gradient(120deg, ${NAVY} 0%, ${BLUE} 60%, #1d6fc0 100%)`, boxShadow: "0 10px 28px rgba(0,0,0,0.2)",
      display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 18 : 28, alignItems: isMobile ? "stretch" : "center",
    }}>
      <div style={{ position: "absolute", right: -30, top: -30, color: "rgba(255,255,255,0.06)", pointerEvents: "none" }}>
        <Icon name="calendar" size={isMobile ? 160 : 240} stroke={1.4} />
      </div>
      <div style={{ flex: 1, position: "relative" }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD }}>Road to the {DRAFT_YEAR} NFL Draft</div>
        <h1 style={{ margin: "6px 0 10px", fontSize: isMobile ? 28 : 42, fontWeight: 900, color: "#fff", textTransform: "uppercase", lineHeight: 1.05 }}>
          {DRAFT_YEAR} Draft Calendar
        </h1>
        <p style={{ margin: 0, maxWidth: 480, fontSize: isMobile ? 13 : 15, fontWeight: 600, color: "rgba(255,255,255,0.88)", lineHeight: 1.55, fontFamily: BODY_FONT }}>
          The national title game, the all-star games, the Combine, every pro day and all three days of the draft — the whole
          pre-draft process in one place.
        </p>
      </div>

      <div style={{ position: "relative", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 14, padding: "14px 18px", minWidth: isMobile ? 0 : 320, backdropFilter: "blur(4px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logos/nfl-draft-2027.png" alt="" style={{ width: 44, height: 44, objectFit: "contain", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: GOLD }}>Round 1 · {DRAFT_YEAR} NFL Draft</div>
            <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 700, fontFamily: BODY_FONT, marginTop: 2 }}>Thu, Apr 29 · 8:00 PM ET</div>
          </div>
        </div>

        {/* Who's on the clock */}
        {firstPick && (
          <Link to={`/nfl/${firstPick.abbr.toLowerCase()}`} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "8px 10px", borderRadius: 10, background: "rgba(0,0,0,0.22)", textDecoration: "none" }}>
            {firstPick.logo && <img src={firstPick.logo} alt="" style={{ width: 36, height: 36, objectFit: "contain", flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: isMobile ? 15 : 17, fontWeight: 900, lineHeight: 1.15 }}>
                {started ? `The ${firstPick.nick} are picking` : `The ${firstPick.nick} are on the clock`}
              </div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 700, fontFamily: BODY_FONT, marginTop: 2 }}>No. 1 overall pick</div>
            </div>
          </Link>
        )}

        {started ? (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, color: "#fff", fontSize: 16, fontWeight: 900 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: "#2ecc71", boxShadow: "0 0 0 3px rgba(46,204,113,0.3)" }} />
            The draft is underway
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {parts.map(([label, n]) => (
              <div key={label} style={{ flex: 1, textAlign: "center", background: "rgba(0,0,0,0.22)", borderRadius: 10, padding: "8px 2px" }}>
                <div style={{ color: "#fff", fontSize: isMobile ? 22 : 26, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{label === "Days" ? n : String(n).padStart(2, "0")}</div>
                <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Month grid ──
function MonthGrid({ isMobile, month, byDay, today, selected, onSelect, canPrev, canNext, onPrev, onNext, months, monthIdx, onMonth }) {
  const y = month.getFullYear(), m = month.getMonth();
  const lead = new Date(y, m, 1).getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7) cells.push(null);

  const navBtn = (on) => ({
    width: 36, height: 36, borderRadius: 10, border: "2px solid #d8dee8", background: "#fff", color: on ? BLUE : "#c5ccd8",
    display: "grid", placeItems: "center", cursor: on ? "pointer" : "default", padding: 0,
  });
  const PAD = isMobile ? 3 : 6;

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e7ef", boxShadow: "0 4px 18px rgba(0,30,70,0.07)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "12px 12px" : "14px 18px", borderBottom: `3px solid ${GOLD}` }}>
        <button type="button" aria-label="Previous month" onClick={onPrev} disabled={!canPrev} style={navBtn(canPrev)}><Icon name="left" size={18} stroke={2.6} /></button>
        <div style={{ flex: 1, textAlign: "center", fontSize: isMobile ? 18 : 22, fontWeight: 900, color: NAVY, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {MONTHS[m]} <span style={{ color: BLUE }}>{y}</span>
        </div>
        <button type="button" aria-label="Next month" onClick={onNext} disabled={!canNext} style={navBtn(canNext)}><Icon name="right" size={18} stroke={2.6} /></button>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "10px 12px 4px", flexWrap: "wrap" }}>
        {months.map((mo, i) => (
          <button key={i} type="button" onClick={() => onMonth(i)} aria-pressed={i === monthIdx} style={{
            border: "none", borderRadius: 999, padding: "4px 11px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase",
            background: i === monthIdx ? BLUE : "#eef2f7", color: i === monthIdx ? "#fff" : "#5a6475",
          }}>{MON(mo)}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", padding: isMobile ? "6px 6px 8px" : "8px 12px 14px" }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ textAlign: "center", padding: "6px 0 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a94a6" }}>
            {isMobile ? w[0] : w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={{ minHeight: isMobile ? 54 : 96, borderTop: "1px solid #eef1f5", background: "#fafbfd" }} />;
          const k = dayKey(d);
          const evs = byDay[k] || [];
          const isToday = sameDay(d, today);
          const isSel = selected === k;
          const past = d < today;
          const draftEv = evs.find((e) => e.type === "draft");
          const proDays = evs.filter((e) => e.type === "proday");
          const others = evs.filter((e) => e.type !== "proday");
          const proLabel = proDays.length > 1 ? `${proDays.length} Pro Days` : proDays[0]?.short || "";
          const proTitle = proDays.map((e) => e.school).join(", ");
          const proMark = (size) => (proDays.length > 1
            ? <ProDayBadge badge={GENERIC_PRO_DAY} id={`multi-${k}`} size={size} />
            : <EventMark e={proDays[0]} size={size} />);
          return (
            <button key={i} type="button" onClick={() => onSelect(isSel ? null : k)} aria-label={`${MONTHS[m]} ${d.getDate()}${evs.length ? ": " + evs.map((e) => e.title).join(", ") : ""}`}
              style={{
                minHeight: isMobile ? 54 : 96, padding: `${PAD}px`, borderTop: "1px solid #eef1f5", borderLeft: "none", borderRight: "none", borderBottom: "none",
                background: isSel ? "#fff8e8" : "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 3,
                boxShadow: isSel ? `inset 0 0 0 2px ${GOLD}` : "none", opacity: past && !evs.length ? 0.55 : 1, overflow: "visible", minWidth: 0,
              }}>
              <span style={{
                alignSelf: isMobile ? "center" : "flex-start", minWidth: 22, height: 22, padding: "0 4px", borderRadius: 999, display: "grid", placeItems: "center",
                fontSize: 12, fontWeight: 900, background: isToday ? BLUE : "transparent", color: isToday ? "#fff" : "#2a3140",
              }}>{d.getDate()}</span>
              {draftEv ? (
                <span title={`${draftEv.title} · ${rangeLabel(draftEv)}`} style={{
                  flex: 1, margin: isMobile ? "0 -3px -3px" : "0 -2px -2px", borderRadius: 8, background: `linear-gradient(160deg, ${EVENT_TYPES.draft.tint}, #fff)`,
                  border: `1px solid ${EVENT_TYPES.draft.color}22`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                  padding: isMobile ? "2px 0" : "4px 2px", opacity: past ? 0.6 : 1,
                }}>
                  <EventMark e={draftEv} size={isMobile ? 30 : 48} />
                  {!isMobile && <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: EVENT_TYPES.draft.color, whiteSpace: "nowrap" }}>{draftEv.short || draftEv.title}</span>}
                </span>
              ) : isMobile ? (
                <span style={{ display: "flex", justifyContent: "center", gap: 2, flexWrap: "wrap" }}>
                  {others.map((e) => {
                    const t = EVENT_TYPES[e.type];
                    return (
                      <span key={e.id} title={e.title} style={{ width: 22, height: 22, borderRadius: 7, background: e.logo || e.badge ? "transparent" : t.color, color: "#fff", display: "grid", placeItems: "center", opacity: past ? 0.6 : 1 }}>
                        <EventMark e={e} size={e.logo || e.badge ? 24 : 14} />
                      </span>
                    );
                  })}
                  {proDays.length > 0 && (
                    <span title={proTitle} style={{ position: "relative", width: 26, height: 26, display: "grid", placeItems: "center", opacity: past ? 0.6 : 1 }}>
                      {proMark(26)}
                      {proDays.length > 1 && <span style={{ position: "absolute", top: -4, right: -5, minWidth: 14, height: 14, borderRadius: 999, background: GOLD, color: "#fff", fontSize: 9, fontWeight: 900, display: "grid", placeItems: "center", padding: "0 3px" }}>{proDays.length}</span>}
                    </span>
                  )}
                </span>
              ) : (
                <>
                {others.map((e) => {
                  const t = EVENT_TYPES[e.type];
                  const isStart = sameDay(d, e.start);
                  const isEnd = sameDay(d, e.finish);
                  const weekStart = d.getDay() === 0 || d.getDate() === 1;
                  const weekEnd = d.getDay() === 6 || d.getDate() === daysIn;
                  const capL = isStart || weekStart, capR = isEnd || weekEnd;
                  return (
                    <span key={e.id} title={`${e.title} · ${rangeLabel(e)}`} style={{
                      display: "flex", alignItems: "center", gap: 5, minWidth: 0, height: 22, padding: "0 6px",
                      marginLeft: capL ? 0 : -PAD, marginRight: capR ? 0 : -PAD,
                      borderRadius: `${capL ? 6 : 0}px ${capR ? 6 : 0}px ${capR ? 6 : 0}px ${capL ? 6 : 0}px`,
                      background: t.color, color: "#fff", fontSize: 10.5, fontWeight: 800, fontFamily: BODY_FONT, opacity: past ? 0.6 : 1,
                    }}>
                      {capL && (e.logo
                        ? <span style={{ width: 20, height: 20, marginLeft: -3, borderRadius: 5, background: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}><EventMark e={e} size={18} /></span>
                        : <Icon name={ICON_FOR[e.type]} size={13} stroke={2.2} />)}
                      {capL && <span style={capR ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : { whiteSpace: "nowrap", position: "relative", zIndex: 2 }}>{e.short || e.title}</span>}
                    </span>
                  );
                })}
                {proDays.length > 0 && (
                  <span title={proDays.length > 1 ? `Pro days: ${proTitle}` : `${proDays[0].title} · ${rangeLabel(proDays[0])}`}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0, opacity: past ? 0.6 : 1 }}>
                    {proMark(others.length ? 38 : 46)}
                    <span style={{ maxWidth: "100%", fontSize: 9, fontWeight: 900, color: EVENT_TYPES.proday.color, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{proLabel}</span>
                  </span>
                )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── One event, as a card ──
function EventCard({ e, today, isMobile, compact, highlight, onClick, href }) {
  const t = EVENT_TYPES[e.type];
  const st = status(e, today);
  const done = st.label === "Completed";
  const press = onClick ? { role: "button", tabIndex: 0, onClick, onKeyDown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onClick(); } } } : {};
  return (
    <div {...press} style={{
      width: "100%", textAlign: "left", fontFamily: "inherit", cursor: onClick ? "pointer" : "default",
      display: "flex", alignItems: "stretch", gap: 0, background: "#fff", borderRadius: 14, overflow: "hidden", padding: 0,
      border: highlight ? `2px solid ${GOLD}` : "1px solid #e2e7ef", boxShadow: highlight ? "0 6px 20px rgba(246,162,29,0.22)" : "0 2px 10px rgba(0,30,70,0.05)",
      opacity: done ? 0.65 : 1,
    }}>
      {/* Date block */}
      <div style={{ width: isMobile ? 64 : 82, flexShrink: 0, background: t.color, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "10px 4px" }}>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.85 }}>{MON(e.start)}</div>
        <div style={{ fontSize: isMobile ? 24 : 30, fontWeight: 900, lineHeight: 1 }}>
          {e.start.getDate()}
          {!sameDay(e.start, e.finish) && e.finish.getMonth() === e.start.getMonth() && <span style={{ fontSize: isMobile ? 13 : 15, opacity: 0.85 }}>–{e.finish.getDate()}</span>}
        </div>
        {/* A range into the next month gets its own line: "– FEB 3". */}
        {e.finish.getMonth() !== e.start.getMonth() && (
          <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.9, marginTop: 2, whiteSpace: "nowrap" }}>– {MON(e.finish)} {e.finish.getDate()}</div>
        )}
        <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.75, marginTop: 3 }}>{WEEKDAYS[e.start.getDay()]}</div>
      </div>
      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "10px 12px" : "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: 12, background: t.tint, color: t.color, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <EventMark e={e} size={e.logo || e.badge ? (isMobile ? 34 : 42) : (isMobile ? 20 : 24)} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: t.color }}>{t.label}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: st.color, background: `${st.color}14`, padding: "2px 8px", borderRadius: 999 }}>
              {st.live && <span style={{ width: 6, height: 6, borderRadius: 999, background: st.color }} />}
              {st.label}
            </span>
          </div>
          <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 900, color: "#1c2330", marginTop: 3, lineHeight: 1.2 }}>{e.title}</div>
          {!compact || !isMobile ? (
            e.blurb ? <div style={{ fontSize: 13, fontWeight: 600, color: "#5a6475", fontFamily: BODY_FONT, marginTop: 3, lineHeight: 1.45 }}>{e.blurb}</div> : null
          ) : null}
        </div>
        {href && (
          <Link to={href} onClick={(ev) => ev.stopPropagation()} style={{
            flexShrink: 0, alignSelf: "center", padding: isMobile ? "6px 10px" : "7px 14px", borderRadius: 999, background: t.tint, color: t.color,
            fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", textDecoration: "none", whiteSpace: "nowrap",
          }}>{isMobile ? "→" : href.startsWith("/events/") ? "Event page →" : href === "/portal" ? "Portal →" : "Draft order →"}</Link>
        )}
      </div>
    </div>
  );
}

// ── The event pages, one card each (+ the transfer portal) ──
function EventPagesGrid({ isMobile, today, proDayCount }) {
  const cards = [
    ...Object.values(EVENT_PAGES).map((ev) => {
      const { start, end } = eventDates(ev.slug);
      return { key: ev.slug, to: eventPath(ev.slug), name: ev.name, logo: ev.logo, color: ev.color, start, end,
        note: ev.slug === "pro-days" ? (proDayCount ? `${proDayCount} pro day${proDayCount === 1 ? "" : "s"} scheduled` : "Schedule coming soon") : ev.location || "" };
    }),
    { key: "portal", to: "/portal", name: "Transfer Portal", logo: "/logos/transfer-portal.svg", color: EVENT_TYPES.championship.color, ...portalWindow(), note: "Transfer window" },
  ].sort((a, b) => (a.start || 0) - (b.start || 0));
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
      {cards.map((c) => {
        const days = c.start ? Math.round((c.start - today) / DAY_MS) : null;
        const when = !c.start ? "" : today > c.end ? "Completed" : today >= c.start ? "Happening now" : days === 1 ? "Tomorrow" : `In ${days} days`;
        return (
          <Link key={c.key} to={c.to} style={{ textDecoration: "none", background: "#fff", border: "1px solid #e2e7ef", borderTop: `4px solid ${c.color}`, borderRadius: 14, padding: "14px 12px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6, boxShadow: "0 2px 10px rgba(0,30,70,0.05)" }}>
            {c.logo ? <img src={c.logo} alt="" style={{ height: 54, maxWidth: "80%", objectFit: "contain" }} /> : <ProDayBadge badge={GENERIC_PRO_DAY} id="grid" size={58} />}
            <div style={{ fontSize: 14, fontWeight: 900, color: "#1c2330", lineHeight: 1.15 }}>{c.name}</div>
            {c.start && <div style={{ fontSize: 12, fontWeight: 700, color: "#5a6475", fontFamily: BODY_FONT }}>{rangeLabel({ start: c.start, finish: c.end })}</div>}
            {c.note && <div style={{ fontSize: 11, fontWeight: 600, color: "#8a94a6", fontFamily: BODY_FONT }}>{c.note}</div>}
            {when && <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: c.color }}>{when}</div>}
          </Link>
        );
      })}
    </div>
  );
}

// The transfer window's open and close days (draftCalendar.js).
function portalWindow() {
  const evs = allEvents([]).filter((e) => e.id === "portal-open" || e.id === "portal-close");
  return evs.length ? { start: evs[0].start, end: evs[evs.length - 1].finish } : {};
}

