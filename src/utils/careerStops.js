// src/utils/careerStops.js
//
// A player's college career stops — players.CareerStops, oldest first:
//   [{ School, From, To, Level? }]   Level "JUCO" for a junior college stop
// School is the We-Draft School name when the team has one (so the Info tab
// can show its logo), else CFBD's name (an FCS or lower-level team).
//
// Suggested from CFBD (offseason/careers, server/offseason/careerIndex.js)
// and saved by an admin in the Eligibility Manager. Shown on the player
// page's Info tab (components/PlayerEligibilityInfo.jsx). Pure.

// The stops CFBD suggests: a JUCO stop first (CFBD only has the class they
// signed out of it — the stop runs from their recruit year, or two seasons
// back, to the season before), then each run of seasons at one school.
export function careerStopsFrom(row, recruitYear) {
  if (!row) return [];
  const stops = [];
  if (row.jc?.n && row.jc.y) {
    const to = row.jc.y - 1;
    const ry = Number(recruitYear);
    stops.push({ School: row.jc.n, Level: "JUCO", From: ry && ry <= to ? ry : to - 1, To: to });
  }
  (row.st || []).forEach(([from, to, school]) => stops.push({ School: school, From: from, To: to }));
  return stops;
}

const stopKey = (s) => `${s.School}|${s.From}|${s.To}|${s.Level || ""}`;
export const sameStops = (a, b) => (a || []).map(stopKey).join(";") === (b || []).map(stopKey).join(";");

// "2023–2025", "2026", or "2025–Present" for their current school's stop.
export function stopSpan(stop, { current } = {}) {
  if (current) return `${stop.From}–Present`;
  return stop.From === stop.To ? String(stop.From) : `${stop.From}–${stop.To}`;
}

// "Florida 2023–24 → Ohio State 2025–26" (admin text).
export const stopsText = (stops) => (stops || [])
  .map((s) => `${s.School}${s.Level ? ` (${s.Level})` : ""} ${s.From === s.To ? s.From : `${s.From}–${String(s.To).slice(2)}`}`)
  .join(" → ");

// CFP national champions by season (We-Draft School names). A player on that
// team's roster that season — a saved stop covering it — shows
// "National Champion" on the Info tab's Career Path. Add each new champion.
export const NATIONAL_CHAMPIONS = {
  2020: "Alabama", 2021: "Georgia", 2022: "Georgia", 2023: "Michigan", 2024: "Ohio State", 2025: "Indiana",
};

// The title seasons inside one stop: [2024] for an Ohio State 2023–2025 stop.
export const championSeasons = (stop) => (!stop?.From || stop.Level === "JUCO" ? [] : Object.entries(NATIONAL_CHAMPIONS)
  .filter(([season, school]) => school === stop.School && Number(season) >= stop.From && Number(season) <= stop.To)
  .map(([season]) => Number(season)));
