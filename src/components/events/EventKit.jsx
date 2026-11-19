// src/components/events/EventKit.jsx
//
// What the events calendar (pages/DraftCalendar.jsx) and the event pages
// (pages/EventPage.jsx) share: the icons, an event's logo or badge, the pro
// day badges, date helpers, the countdown, the Combine schedule and the
// section headings.
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { EVENT_TYPES, COMBINE_SCHEDULE, parseDay } from "../../utils/draftCalendar";
import { getSiteSnapshot } from "../../utils/siteSnapshots";
import { portalTeamSlug } from "../../utils/portalTeams";
import { proDayIconSvg, PRO_DAY_SIZE, PRO_DAY_CONFIG, GENERIC_PRO_DAY, isDarkLogoField, proDayLook } from "../../utils/proDayIcon";
import BebasNeue from "../../assets/fonts/BebasNeue-Regular.ttf";

export const BLUE = "#0055a5";
export const NAVY = "#00305c";
export const GOLD = "#f6a21d";
export const BODY_FONT = "Arial, sans-serif";
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MON = (d) => MONTHS[d.getMonth()].slice(0, 3);
export const DAY_MS = 86400000;

// Bebas Neue for the pro day badges' "PRO DAY".
export const BadgeFont = () => <style>{`@font-face{font-family:"Bebas Neue";src:url(${BebasNeue}) format("truetype");}`}</style>;

const ICON_PATHS = {
  trophy: (
    <>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
    </>
  ),
  football: (
    <>
      <path d="M4.6 19.4C3 14.5 5 9 9.4 6s10-2.4 10-2.4 1.4 5.6-1.6 10S9.5 21 4.6 19.4z" />
      <path d="M9.5 14.5l5-5M10.5 11.5l2 2M12.5 9.5l2 2M8.5 13.5l2 2" />
    </>
  ),
  whistle: (
    <>
      <circle cx="8.5" cy="14.5" r="5" />
      <path d="M11.5 10.5L21 8v4l-7.6 2.2" />
      <path d="M3 4l2.5 2.5M8 2.5v3M12.5 4L11 6.5" />
    </>
  ),
  stopwatch: (
    <>
      <circle cx="12" cy="14" r="8" />
      <path d="M12 14v-4M10 2h4M12 2v4M18.5 7.5L20 6" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2.5h6V4M9 11.5l2 2 4-4M9 17h6" />
    </>
  ),
  podium: (
    <>
      <path d="M3 21h18M4 21v-6h5v6M9 21V10h6v11M15 21v-8h5v8" />
      <path d="M12 3l1 2 2 .3-1.5 1.4.4 2.1L12 7.8l-1.9 1 .4-2.1L9 5.3l2-.3z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  plane: <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  depart: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  badge: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M14 10h4M14 14h4" />
    </>
  ),
  medical: <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />,
  scan: <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 8M22 21v-1a6 6 0 0 0-4-5.7" />
    </>
  ),
  ruler: <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0zM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2" />,
  dumbbell: <path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11" />,
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
};
export const ICON_FOR = Object.fromEntries(Object.entries(EVENT_TYPES).map(([k, v]) => [k, v.icon]));

export function Icon({ name, size = 18, stroke = 2, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      {ICON_PATHS[name]}
    </svg>
  );
}

// An event's logo when it has one, else its type icon.
export function EventMark({ e, size = 18, stroke }) {
  if (e.badge) return <ProDayBadge badge={e.badge} id={e.id} size={size} />;
  if (e.logo) return <img src={e.logo} alt="" style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />;
  return <Icon name={ICON_FOR[e.type]} size={size} stroke={stroke} />;
}

// A school's pro day badge (utils/proDayIcon.js) with its saved logo and
// colors (Admin → Branding → Pro Day), drawn inline so its logo can load.
export function ProDayBadge({ badge, id, size, year = 2027 }) {
  const svg = useMemo(() => proDayIconSvg({
    ...badge, logo: badge.logo ? { href: badge.logo } : null, year: String(year), id: `pdb-${id}-${size}`,
  }).replace(`width="${PRO_DAY_SIZE}" height="${PRO_DAY_SIZE}"`, `width="${size}" height="${size}"`), [badge, id, size, year]);
  return <span style={{ width: size, height: size, flexShrink: 0, display: "inline-block", lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ── Date helpers ──
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const sameDay = (a, b) => a.getTime() === b.getTime();
export function rangeLabel(e) {
  const s = e.start, f = e.finish;
  if (sameDay(s, f)) return `${WEEKDAYS[s.getDay()]}, ${MON(s)} ${s.getDate()}`;
  if (s.getMonth() === f.getMonth()) return `${MON(s)} ${s.getDate()}–${f.getDate()}`;
  return `${MON(s)} ${s.getDate()} – ${MON(f)} ${f.getDate()}`;
}
export function status(e, today) {
  if (today > e.finish) return { label: "Completed", color: "#8a94a6" };
  if (today >= e.start) return { label: "Happening now", color: "#1e8449", live: true };
  const days = Math.round((e.start - today) / DAY_MS);
  return { label: days === 1 ? "Tomorrow" : `In ${days} days`, color: BLUE };
}


// The clock, ticking every second (countdowns).
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// Days / hours / minutes / seconds to `target`, as tiles.
export function Countdown({ target, now, isMobile, dark = true }) {
  const ms = Math.max(0, target - now);
  const parts = [
    ["Days", Math.floor(ms / DAY_MS)],
    ["Hrs", Math.floor((ms % DAY_MS) / 3600000)],
    ["Min", Math.floor((ms % 3600000) / 60000)],
    ["Sec", Math.floor((ms % 60000) / 1000)],
  ];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {parts.map(([label, n]) => (
        <div key={label} style={{ flex: 1, textAlign: "center", background: dark ? "rgba(0,0,0,0.25)" : "#eef2f7", borderRadius: 10, padding: "8px 2px", minWidth: 52 }}>
          <div style={{ color: dark ? "#fff" : NAVY, fontSize: isMobile ? 22 : 26, fontWeight: 900, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{label === "Days" ? n : String(n).padStart(2, "0")}</div>
          <div style={{ color: dark ? "rgba(255,255,255,0.65)" : "#8a94a6", fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// Pro day badges: each school's branding + its saved choice (Admin →
// Branding → Pro Day), else the defaults. → badgeFor(school name) → badge | null
export function useProDayBadges(enabled = true) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    Promise.all([getSiteSnapshot("_cfbTeams").catch(() => null), getDoc(doc(db, ...PRO_DAY_CONFIG)).catch(() => null)])
      .then(([snap, cfg]) => { if (live) setSrc({ teams: snap?.teams || {}, prefs: (cfg?.exists() && cfg.data().schools) || {} }); });
    return () => { live = false; };
  }, [enabled]);
  return useMemo(() => (school) => {
    if (!school) return GENERIC_PRO_DAY;
    const slug = portalTeamSlug(school);
    const team = src?.teams?.[slug];
    if (!team) return null;
    const look = proDayLook(team, src.prefs[slug] || null);
    return {
      logo: look.logo, color1: team.Color1, color2: team.Color2, swap: look.swap,
      logoX: look.logoX, logoY: look.logoY, logoScale: look.logoScale, darkLogo: isDarkLogoField(look.logoField),
    };
  }, [src]);
}

// ── The Combine's day-by-day schedule, one position group at a time ──
const COMBINE_ACTIVITY = {
  "Early Player Arrivals": ["plane", "#64748b"],
  Registration: ["badge", "#475569"],
  Orientation: ["badge", "#475569"],
  "Pre-Exam": ["medical", "#c0392b"],
  "General Medical Exam": ["medical", "#c0392b"],
  "Ortho Exam": ["medical", "#c0392b"],
  "Pre-ordered Studies": ["scan", "#c0392b"],
  "Team Interviews": ["chat", "#0055a5"],
  "Media Interviews": ["mic", "#7c3aed"],
  "NFLPA Meeting": ["users", "#475569"],
  "Kicking Workout": ["football", "#0284c7"],
  Measurements: ["ruler", "#0284c7"],
  "On-Field Workout": ["stopwatch", "#0284c7"],
  "Bench Press": ["dumbbell", "#0284c7"],
  Depart: ["depart", "#64748b"],
};
const WORKOUT = "On-Field Workout";

export function CombineSchedule({ isMobile, today }) {
  const groups = COMBINE_SCHEDULE.groups;
  const [groupId, setGroupId] = useState(groups[0].id);
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const workoutDay = (g) => parseDay(g.days.find(([, items]) => items.includes(WORKOUT))[0]);
  const C = EVENT_TYPES.workout.color;

  return (
    <div>
      {/* On-field workout days, one tile per group; a tile picks its group. */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {groups.map((g) => {
          const d = workoutDay(g);
          const on = g.id === group.id;
          return (
            <button key={g.id} type="button" onClick={() => setGroupId(g.id)} aria-pressed={on} style={{
              textAlign: "left", fontFamily: "inherit", cursor: "pointer", borderRadius: 14, padding: isMobile ? "12px" : "14px 16px",
              border: on ? `2px solid ${C}` : "2px solid #e2e7ef",
              background: on ? `linear-gradient(135deg, ${NAVY}, ${C})` : "#fff",
              color: on ? "#fff" : "#1c2330", boxShadow: on ? "0 8px 20px rgba(2,132,199,0.28)" : "0 2px 10px rgba(0,30,70,0.06)",
              opacity: d < today ? 0.65 : 1,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: on ? GOLD : C }}>
                <Icon name="stopwatch" size={14} stroke={2.4} />On-field workout
              </div>
              <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, marginTop: 6, lineHeight: 1 }}>
                {WEEKDAYS[d.getDay()]}, {MON(d)} {d.getDate()}
              </div>
              <div style={{ fontSize: isMobile ? 12 : 13, fontWeight: 800, marginTop: 6, fontFamily: BODY_FONT, color: on ? "rgba(255,255,255,0.9)" : "#5a6475" }}>{g.label}</div>
            </button>
          );
        })}
      </div>

      {/* The chosen group's week. */}
      <div style={{ marginTop: 14, background: "#fff", borderRadius: 16, border: "1px solid #e2e7ef", boxShadow: "0 4px 18px rgba(0,30,70,0.07)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: isMobile ? "12px" : "14px 18px", borderBottom: `3px solid ${GOLD}` }}>
          <img src="/logos/nfl-combine.png" alt="" style={{ width: 40, height: 40, objectFit: "contain" }} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8a94a6" }}>Player schedule</div>
            <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 900, color: NAVY, textTransform: "uppercase" }}>{group.label}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {groups.map((g) => (
              <button key={g.id} type="button" onClick={() => setGroupId(g.id)} aria-pressed={g.id === group.id} style={{
                border: "none", borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em",
                background: g.id === group.id ? EVENT_TYPES.combine.color : "#eef2f7", color: g.id === group.id ? "#fff" : "#5a6475",
              }}>{g.label}</button>
            ))}
          </div>
        </div>

        {group.days.map(([date, items], i) => {
          const d = parseDay(date);
          const isWorkout = items.includes(WORKOUT);
          const isToday = sameDay(d, today);
          return (
            <div key={date} style={{
              display: "flex", alignItems: "stretch", borderTop: i ? "1px solid #eef1f5" : "none",
              background: isWorkout ? "#f0f9ff" : "#fff", opacity: d < today ? 0.6 : 1,
            }}>
              <div style={{
                width: isMobile ? 62 : 86, flexShrink: 0, padding: "12px 4px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                borderRight: `4px solid ${isWorkout ? C : "#e2e7ef"}`, color: isWorkout ? C : NAVY,
              }}>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.8 }}>{WEEKDAYS[d.getDay()]}</div>
                <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, lineHeight: 1.05 }}>{d.getDate()}</div>
                <div style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.7 }}>{MON(d)}{isToday ? " · Today" : ""}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "10px" : "12px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                {items.map((a) => {
                  const [icon, color] = COMBINE_ACTIVITY[a] || ["clipboard", "#475569"];
                  const big = a === WORKOUT;
                  return (
                    <span key={a} style={{
                      display: "inline-flex", alignItems: "center", gap: 6, padding: big ? "6px 12px 6px 9px" : "5px 10px 5px 8px", borderRadius: 999,
                      background: big ? C : `${color}12`, color: big ? "#fff" : color, border: big ? "none" : `1px solid ${color}30`,
                      fontSize: isMobile ? 11.5 : 12.5, fontWeight: 800, fontFamily: BODY_FONT, whiteSpace: "nowrap",
                    }}>
                      <Icon name={icon} size={big ? 16 : 14} stroke={2.2} />{a}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, fontStyle: "italic", color: "#8a94a6", fontFamily: BODY_FONT }}>{COMBINE_SCHEDULE.basis}</div>
    </div>
  );
}

export function SectionHead({ icon, title, isMobile, color = NAVY }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: isMobile ? "26px 0 12px" : "34px 0 14px", color }}>
      <Icon name={icon} size={22} stroke={2.2} />
      <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.03em" }}>{title}</h2>
      <div style={{ flex: 1, height: 3, background: GOLD, borderRadius: 2, marginLeft: 6 }} />
    </div>
  );
}
