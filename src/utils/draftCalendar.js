// src/utils/draftCalendar.js
//
// The events on /calendar (pages/DraftCalendar.jsx). To add one, append to
// DRAFT_EVENTS: dates are "YYYY-MM-DD" (local, no time zone), `end` only for
// multi-day events, `type` picks the icon + color from EVENT_TYPES.
// `logo` (optional, a /public path) replaces the type icon on that event;
// `accolade` uses that Award Icon instead (accoladeIcons, the one the player
// Career Path shows), the type icon until it loads.
// Pro days are entered in Admin → Events (events/{year}.proDays, utils/events.js).

export const EVENT_TYPES = {
  championship: { label: "College Football", color: "#b8860b", tint: "#fff6dc", icon: "trophy" },
  allstar: { label: "All-Star Game", color: "#c0392b", tint: "#fdecea", icon: "football" },
  practice: { label: "All-Star Practice", color: "#d35400", tint: "#fdf0e6", icon: "whistle" },
  combine: { label: "Scouting Combine", color: "#0055a5", tint: "#e6f0fa", icon: "stopwatch" },
  workout: { label: "Combine Workouts", color: "#0055a5", tint: "#e6f0fa", icon: "stopwatch", noLegend: true },
  proday: { label: "Pro Day", color: "#1e8449", tint: "#e8f6ee", icon: "clipboard" },
  draft: { label: "NFL Draft", color: "#00305c", tint: "#e3e9f2", icon: "podium" },
};

const SENIOR_BOWL_LOGO = "/logos/senior-bowl.png";
const DRAFT_LOGO = "/logos/nfl-draft-2027.png";
const EAST_WEST_LOGO = "/logos/east-west-bowl.png";
const PORTAL_LOGO = "/logos/transfer-portal.svg";
const COMBINE_LOGO = "/logos/nfl-combine.png";

export const DRAFT_EVENTS = [
  {
    id: "portal-open", type: "championship", date: "2027-01-04",
    title: "Transfer Portal Opens", short: "Portal Opens", logo: PORTAL_LOGO,
    blurb: "The college football (FBS/FCS) transfer window opens.",
  },
  {
    id: "portal-close", type: "championship", date: "2027-01-13",
    title: "Transfer Portal Closes", short: "Portal Closes", logo: PORTAL_LOGO,
    blurb: "The college football (FBS/FCS) transfer window closes.",
  },
  {
    id: "cfp-title", type: "championship", date: "2027-01-25",
    title: "CFP National Championship", short: "CFP Title", accolade: "National Champion",
    blurb: "The college season ends — and the final draft-eligible underclassmen have their last game on tape.",
  },
  {
    id: "senior-bowl-practice", type: "practice", date: "2027-01-26", end: "2027-01-28",
    title: "Senior Bowl Practices", short: "Senior Bowl Practice", logo: SENIOR_BOWL_LOGO,
    blurb: "Three days of practice in Mobile, where scouts get their first up-close look at the top seniors.",
  },
  {
    id: "senior-bowl", type: "allstar", date: "2027-01-30",
    title: "Senior Bowl", logo: SENIOR_BOWL_LOGO,
    blurb: "The premier college all-star game.",
  },
  {
    id: "east-west-practice", type: "practice", date: "2027-01-31", end: "2027-02-03",
    title: "East-West Shrine Bowl Practices", short: "E-W Practice", logo: EAST_WEST_LOGO,
    blurb: "Expected practice dates for the Shriners Children's East-West Bowl, leading into the game.",
  },
  {
    id: "east-west", type: "allstar", date: "2027-02-04",
    title: "East-West Shrine Bowl", short: "East-West", logo: EAST_WEST_LOGO,
    blurb: "The Shriners Children's East-West Bowl, at AT&T Stadium in Arlington, Texas.",
  },
  {
    id: "combine", type: "combine", date: "2027-03-01", end: "2027-03-08",
    title: "NFL Scouting Combine", short: "Scouting Combine", logo: COMBINE_LOGO,
    blurb: "Medicals, interviews, measurements and on-field testing for the top prospects in the class.",
  },
  {
    id: "pro-days-start", type: "proday", generic: true, date: "2027-03-09",
    title: "Pro Days Start", short: "Pro Days Start",
    blurb: "With the Combine over, schools start holding their pro days.",
  },
  // On-field workout days, one per position group (COMBINE_SCHEDULE below).
  {
    id: "combine-wo-dl", type: "workout", date: "2027-03-04",
    title: "Combine Workouts: DL, LB & K/P", short: "DL · LB · K/P",
    blurb: "Defensive linemen, linebackers, kickers and punters run their drills.",
  },
  {
    id: "combine-wo-db", type: "workout", date: "2027-03-05",
    title: "Combine Workouts: DB & TE", short: "DB · TE",
    blurb: "Defensive backs and tight ends take the field.",
  },
  {
    id: "combine-wo-qb", type: "workout", date: "2027-03-06",
    title: "Combine Workouts: QB, RB & WR", short: "QB · RB · WR",
    blurb: "Quarterbacks, running backs and receivers work out.",
  },
  {
    id: "combine-wo-ol", type: "workout", date: "2027-03-07",
    title: "Combine Workouts: OL", short: "OL",
    blurb: "The offensive linemen close out the on-field workouts.",
  },
  {
    id: "draft-r1", type: "draft", date: "2027-04-29",
    title: "NFL Draft — Round 1", short: "Round 1", logo: DRAFT_LOGO,
    blurb: "Day 1 of the 2027 NFL Draft: all 32 first-round picks.",
  },
  {
    id: "draft-r23", type: "draft", date: "2027-04-30",
    title: "NFL Draft — Rounds 2–3", short: "Rounds 2–3", logo: DRAFT_LOGO,
    blurb: "Day 2 of the 2027 NFL Draft.",
  },
  {
    id: "draft-r47", type: "draft", date: "2027-05-01",
    title: "NFL Draft — Rounds 4–7", short: "Rounds 4–7", logo: DRAFT_LOGO,
    blurb: "Day 3 of the 2027 NFL Draft.",
  },
];

// The Combine's day-by-day player schedule by position group. Laid over the
// 2026 schedule weekday for weekday (Mon Feb 23, 2026 → Mon Mar 1, 2027) until
// the NFL releases the 2027 one. Activity names pick their icon on the page
// (COMBINE_ACTIVITY in DraftCalendar.jsx).
export const COMBINE_SCHEDULE = {
  basis: "Projected from the 2026 Combine schedule, day for day. We'll update it when the NFL releases the 2027 schedule.",
  groups: [
    {
      id: "dl", label: "DL, LB & K/P", days: [
        ["2027-02-28", ["Early Player Arrivals"]],
        ["2027-03-01", ["Registration", "Pre-Exam", "Orientation", "Team Interviews"]],
        ["2027-03-02", ["General Medical Exam", "Pre-ordered Studies", "Team Interviews"]],
        ["2027-03-03", ["Ortho Exam", "Media Interviews", "Kicking Workout", "NFLPA Meeting", "Team Interviews"]],
        ["2027-03-04", ["Measurements", "On-Field Workout"]],
        ["2027-03-05", ["Bench Press", "Depart"]],
      ],
    },
    {
      id: "db", label: "DB & TE", days: [
        ["2027-03-01", ["Early Player Arrivals"]],
        ["2027-03-02", ["Registration", "Pre-Exam", "Orientation", "Team Interviews"]],
        ["2027-03-03", ["General Medical Exam", "Pre-ordered Studies", "Team Interviews"]],
        ["2027-03-04", ["Ortho Exam", "Media Interviews", "NFLPA Meeting", "Team Interviews"]],
        ["2027-03-05", ["Measurements", "On-Field Workout"]],
        ["2027-03-06", ["Bench Press", "Depart"]],
      ],
    },
    {
      id: "qb", label: "QB, RB & WR", days: [
        ["2027-03-02", ["Registration", "Orientation", "Team Interviews"]],
        ["2027-03-03", ["Pre-Exam", "NFLPA Meeting", "Team Interviews"]],
        ["2027-03-04", ["General Medical Exam", "Pre-ordered Studies", "Team Interviews"]],
        ["2027-03-05", ["Ortho Exam", "Media Interviews", "Team Interviews"]],
        ["2027-03-06", ["Measurements", "On-Field Workout"]],
        ["2027-03-07", ["Bench Press", "Depart"]],
      ],
    },
    {
      id: "ol", label: "OL", days: [
        ["2027-03-03", ["Registration", "Orientation", "Team Interviews"]],
        ["2027-03-04", ["Pre-Exam", "NFLPA Meeting", "Team Interviews"]],
        ["2027-03-05", ["General Medical Exam", "Pre-ordered Studies", "Team Interviews"]],
        ["2027-03-06", ["Ortho Exam", "Media Interviews", "Team Interviews"]],
        ["2027-03-07", ["Measurements", "On-Field Workout"]],
        ["2027-03-08", ["Bench Press", "Depart"]],
      ],
    },
  ],
};

// Round 1 kicks off at 8:00 PM ET, Thu Apr 29, 2027 (EDT = UTC-4) — the
// page's countdown.
export const DRAFT_START = new Date(Date.UTC(2027, 3, 30, 0, 0, 0));

export const PRO_DAYS = [
  // { school: "Ohio State", date: "2027-03-18", note: "" },
];

// "YYYY-MM-DD" → local midnight Date (never `new Date(iso)`, which is UTC).
export const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Every event (pro days included), sorted, with Date objects attached.
// proDays: [{ school, date }] — the year's schedule (utils/events.js
// proDaySchedule, from Admin → Events); PRO_DAYS when not given.
export function allEvents(proDays = PRO_DAYS) {
  const pro = proDays.map((p, i) => ({
    id: `proday-${p.key || i}`, type: "proday", date: p.date,
    title: `${p.school} Pro Day`, short: p.short || p.school, blurb: p.note || "", school: p.school,
  }));
  return [...DRAFT_EVENTS, ...pro]
    .map((e) => ({ ...e, start: parseDay(e.date), finish: parseDay(e.end || e.date) }))
    .sort((a, b) => a.start - b.start || (a.type === "proday" && b.type === "proday" ? String(a.school || a.title).localeCompare(String(b.school || b.title)) : 0));
}

// Map of dayKey → events touching that day.
export function eventsByDay(events) {
  const map = {};
  for (const e of events) {
    for (let d = new Date(e.start); d <= e.finish; d.setDate(d.getDate() + 1)) {
      const k = dayKey(d);
      if (!map[k]) map[k] = [];
      map[k].push(e);
    }
  }
  return map;
}
