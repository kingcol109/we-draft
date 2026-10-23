// src/utils/coachHistory.js
//
// Shared schema for `coaches/{slug}` — one doc per person (head coaches,
// coordinators, GMs; current and former), each holding their full career as
// a list of stints. Read by Admin → Coach History (AdminCoachHistory.js) and
// scripts/importCoachHistory.mjs, so it stays plain JS with no React or
// Firebase imports.
//
// Doc shape:
//
//   Name          "Kevin O'Connell"
//   Slug          doc id, slugify(Name) unless set explicitly
//   Born          birth year or null
//   College       alma mater (where they played / studied), free text
//   PlayingCareer short free-text note, e.g. "QB, NE/DET/NYJ/MIA/SD 2008–12"
//   Notes, Sources free text
//   Stints        [stint] in career order (see below)
//   Current       [{ Team, Role }] — derived: open NFL stints with a tracked role
//   CurrentTeams  [abbr] — derived, for array-contains queries
//   Status        "current" | "former" — derived
//   createdAt / updatedAt  ISO strings
//
// Stint shape:
//
//   Level       "NFL" | "College" | "Other" (UFL/CFL/XFL/high school/etc.)
//   Org         the org's name AS IT WAS then ("Oakland Raiders", "Ohio State")
//   Team        NFL franchise abbr as it is today (LV for Oakland) — NFL only,
//               so stints line up with draft data regardless of relocations
//   Title       title as written in the bio ("Passing Game Coordinator/QB Coach");
//               for a PLAYER stint, the position played ("Quarterback")
//   Roles       [ROLE key] — the standardized version of Title; a title with
//               two hats gets two keys (AHC + DB)
//   StartYear   first SEASON in the job (a Jan 2022 hire → 2022)
//   StartMonth  1–12 when known, else null
//   EndYear     last SEASON in the job; null = still there (unless EndUnknown)
//   EndMonth    1–12 when known, else null
//   EndUnknown  true when the job ended but the source doesn't say when —
//               keeps a missing EndYear from reading as "still there"
//   Notes       free text ("interim, final 5 games")
//
// Years are seasons, not calendar years: someone hired in January 2022 and
// fired in January 2024 coached the 2022–2023 seasons, so 2022 → 2023. The
// months are what pin down which draft a mid-year move belongs to.

export const LEVELS = ["NFL", "College", "Other"];

// Standardized role keys. `group` drives the picker layout, `side` lets later
// draft-linking filter picks by unit. Keys are stored on docs — rename the
// label freely, never the key.
export const ROLES = [
  { key: "HC", label: "Head Coach", group: "Head / Executive", side: "All" },
  { key: "IHC", label: "Interim Head Coach", group: "Head / Executive", side: "All" },
  { key: "AHC", label: "Assistant Head Coach", group: "Head / Executive", side: "All" },
  { key: "GM", label: "General Manager", group: "Head / Executive", side: "Front Office" },
  { key: "AGM", label: "Assistant GM", group: "Head / Executive", side: "Front Office" },
  { key: "EXEC", label: "President / VP Football Ops", group: "Head / Executive", side: "Front Office" },

  { key: "OC", label: "Offensive Coordinator", group: "Coordinator", side: "Offense" },
  { key: "DC", label: "Defensive Coordinator", group: "Coordinator", side: "Defense" },
  { key: "STC", label: "Special Teams Coordinator", group: "Coordinator", side: "Special Teams" },
  { key: "PGC", label: "Passing Game Coordinator", group: "Coordinator", side: "Offense" },
  { key: "RGC", label: "Run Game Coordinator", group: "Coordinator", side: "Offense" },
  { key: "DPGC", label: "Defensive Pass Game Coordinator", group: "Coordinator", side: "Defense" },
  { key: "DRGC", label: "Defensive Run Game Coordinator", group: "Coordinator", side: "Defense" },
  { key: "CO_OC", label: "Co-Offensive Coordinator", group: "Coordinator", side: "Offense" },
  { key: "CO_DC", label: "Co-Defensive Coordinator", group: "Coordinator", side: "Defense" },
  { key: "RC", label: "Recruiting Coordinator", group: "Coordinator", side: "All" },

  { key: "QB", label: "Quarterbacks", group: "Offense Position", side: "Offense" },
  { key: "RB", label: "Running Backs", group: "Offense Position", side: "Offense" },
  { key: "WR", label: "Wide Receivers", group: "Offense Position", side: "Offense" },
  { key: "TE", label: "Tight Ends", group: "Offense Position", side: "Offense" },
  { key: "OL", label: "Offensive Line", group: "Offense Position", side: "Offense" },
  { key: "OFF_ASST", label: "Offensive Assistant", group: "Offense Position", side: "Offense" },

  { key: "DL", label: "Defensive Line", group: "Defense Position", side: "Defense" },
  { key: "EDGE", label: "Outside LB / Pass Rush", group: "Defense Position", side: "Defense" },
  { key: "LB", label: "Linebackers", group: "Defense Position", side: "Defense" },
  { key: "DB", label: "Defensive Backs", group: "Defense Position", side: "Defense" },
  { key: "CB", label: "Cornerbacks", group: "Defense Position", side: "Defense" },
  { key: "S", label: "Safeties", group: "Defense Position", side: "Defense" },
  { key: "DEF_ASST", label: "Defensive Assistant", group: "Defense Position", side: "Defense" },

  { key: "ST_ASST", label: "Assistant Special Teams", group: "Other Coaching", side: "Special Teams" },
  { key: "QC", label: "Quality Control", group: "Other Coaching", side: "All" },
  { key: "GA", label: "Graduate Assistant", group: "Other Coaching", side: "All" },
  { key: "ANALYST", label: "Analyst", group: "Other Coaching", side: "All" },
  { key: "STRENGTH", label: "Strength & Conditioning", group: "Other Coaching", side: "All" },
  { key: "INTERN", label: "Intern / Fellowship", group: "Other Coaching", side: "All" },
  { key: "COACH_OTHER", label: "Other Coaching Role", group: "Other Coaching", side: "All" },

  { key: "DIR_FO", label: "Director of Football Operations", group: "Front Office", side: "Front Office" },
  { key: "DIR_PP", label: "Director of Player Personnel", group: "Front Office", side: "Front Office" },
  { key: "DIR_CS", label: "Director of College Scouting", group: "Front Office", side: "Front Office" },
  { key: "DIR_PRO", label: "Director of Pro Personnel", group: "Front Office", side: "Front Office" },
  { key: "SCOUT", label: "College Scout (Area / National)", group: "Front Office", side: "Front Office" },
  { key: "PRO_SCOUT", label: "Pro Scout", group: "Front Office", side: "Front Office" },
  { key: "PERSONNEL", label: "Personnel Assistant / Coordinator", group: "Front Office", side: "Front Office" },
  { key: "CAP", label: "Salary Cap / Football Admin", group: "Front Office", side: "Front Office" },
  { key: "FO_OTHER", label: "Other Front Office Role", group: "Front Office", side: "Front Office" },

  // Their own playing days — Title holds the position ("Quarterback").
  // Never tracked or credited with draft picks.
  { key: "PLAYER", label: "Player", group: "Playing", side: "All" },
];

export const ROLE_BY_KEY = Object.fromEntries(ROLES.map((r) => [r.key, r]));
export const ROLE_GROUPS = [...new Set(ROLES.map((r) => r.group))];

// The jobs this project tracks people FOR — anyone holding one of these on
// an NFL team today is "current". Interim HCs count while they're in the job.
// Special teams coordinators aren't tracked; STC still exists as a role for
// the people who held it earlier in their careers.
export const TRACKED_ROLES = ["HC", "IHC", "OC", "DC", "GM"];
// Columns of the admin coverage grid.
export const COVERAGE_ROLES = ["HC", "OC", "DC", "GM"];

export const NFL_TEAMS = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SF: "San Francisco 49ers",
  SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
export const NFL_TEAM_ABBRS = Object.keys(NFL_TEAMS);

// Former names → today's franchise. The original Browns (pre-1996) stay
// CLE, matching the NFL's own franchise record; the Ravens start in 1996.
const FORMER_NAMES = {
  "Oakland Raiders": "LV", "Los Angeles Raiders": "LV",
  "San Diego Chargers": "LAC",
  "St. Louis Rams": "LAR",
  "Houston Oilers": "TEN", "Tennessee Oilers": "TEN",
  "Washington Redskins": "WAS", "Washington Football Team": "WAS",
  "Phoenix Cardinals": "ARI", "St. Louis Cardinals": "ARI",
  "Baltimore Colts": "IND",
};
const NAME_TO_ABBR = Object.fromEntries([
  ...Object.entries(NFL_TEAMS).map(([abbr, name]) => [name.toLowerCase(), abbr]),
  ...Object.entries(FORMER_NAMES).map(([name, abbr]) => [name.toLowerCase(), abbr]),
]);
export const NFL_ORG_NAMES = [...Object.values(NFL_TEAMS), ...Object.keys(FORMER_NAMES)].sort();

// "Oakland Raiders" → "LV", "LV" → "LV", anything else → "".
export function nflAbbrFromOrg(org) {
  const s = String(org || "").trim();
  if (NFL_TEAMS[s.toUpperCase()]) return s.toUpperCase();
  return NAME_TO_ABBR[s.toLowerCase()] || "";
}

export function slugify(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const toInt = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Sort key: start, then end (open-ended last), so concurrent jobs keep order.
// A stint with no start year (bios often skip them for early jobs) sorts with
// the nearest dated stint before it in the list as given, so it stays where
// the bio put it instead of dropping to the end.
function sortStints(stints) {
  let lastYear = null;
  const firstYear = stints.find((s) => s.StartYear)?.StartYear ?? 0;
  const keyed = stints.map((s, i) => {
    if (s.StartYear) lastYear = s.StartYear;
    return { s, i, year: s.StartYear || lastYear || firstYear, dated: !!s.StartYear };
  });
  keyed.sort((a, b) =>
    a.year - b.year ||
    // Same year: an undated stint stays right after the stint it followed.
    (a.dated && b.dated ? 0 : a.i - b.i) ||
    (a.s.StartMonth ?? 0) - (b.s.StartMonth ?? 0) ||
    (a.s.EndYear ?? 9999) - (b.s.EndYear ?? 9999) ||
    a.i - b.i);
  return keyed.map((k) => k.s);
}

// Cleans one stint and reports what's wrong with it. Never throws — bad
// values pass through as-is with a warning so nothing typed is lost.
export function normalizeStint(raw, i = 0) {
  const warnings = [];
  const at = `Stint ${i + 1}`;
  const Level = LEVELS.includes(raw?.Level) ? raw.Level : (nflAbbrFromOrg(raw?.Org || raw?.Team) ? "NFL" : str(raw?.Level) || "Other");
  if (!LEVELS.includes(Level)) warnings.push(`${at}: unknown level "${Level}"`);
  const Org = str(raw?.Org) || (raw?.Team && NFL_TEAMS[raw.Team]) || "";
  const Team = Level === "NFL" ? (str(raw?.Team).toUpperCase() || nflAbbrFromOrg(Org)) : "";
  const Roles = [...new Set((Array.isArray(raw?.Roles) ? raw.Roles : str(raw?.Roles).split(/[,/]/)).map((r) => str(r).toUpperCase()).filter(Boolean))];
  const s = {
    Level, Org, Team,
    Title: str(raw?.Title),
    Roles,
    StartYear: toInt(raw?.StartYear), StartMonth: toInt(raw?.StartMonth),
    EndYear: toInt(raw?.EndYear), EndMonth: toInt(raw?.EndMonth),
    EndUnknown: raw?.EndUnknown === true && (raw?.EndYear === null || raw?.EndYear === undefined || str(raw?.EndYear) === ""),
    Notes: str(raw?.Notes),
  };
  if (!s.Org) warnings.push(`${at}: no organization`);
  if (Level === "NFL" && !NFL_TEAMS[Team]) warnings.push(`${at}: NFL stint "${Org}" isn't matched to a team`);
  if (!Roles.length) warnings.push(`${at}: no roles`);
  Roles.filter((r) => !ROLE_BY_KEY[r]).forEach((r) => warnings.push(`${at}: unknown role "${r}"`));
  ["StartYear", "EndYear"].forEach((k) => {
    if (Number.isNaN(s[k]) || (s[k] !== null && (s[k] < 1920 || s[k] > 2100))) warnings.push(`${at}: bad ${k}`);
  });
  ["StartMonth", "EndMonth"].forEach((k) => {
    if (Number.isNaN(s[k]) || (s[k] !== null && (s[k] < 1 || s[k] > 12))) warnings.push(`${at}: bad ${k}`);
  });
  if (s.StartYear === null) warnings.push(`${at}: no start year`);
  if (s.EndUnknown) warnings.push(`${at}: end year unknown`);
  if (s.StartYear && s.EndYear && s.EndYear < s.StartYear) warnings.push(`${at}: ends before it starts`);
  return { stint: s, warnings };
}

export const isPlayerStint = (s) => (s.Roles || []).includes("PLAYER");

export const isOpenStint = (s) => (s.EndYear === null || s.EndYear === undefined) && !s.EndUnknown;

export function deriveCurrent(stints) {
  const Current = [];
  stints.filter((s) => s.Level === "NFL" && s.Team && isOpenStint(s)).forEach((s) => {
    s.Roles.filter((r) => TRACKED_ROLES.includes(r)).forEach((Role) => Current.push({ Team: s.Team, Role }));
  });
  const CurrentTeams = [...new Set(Current.map((c) => c.Team))];
  return { Current, CurrentTeams, Status: Current.length ? "current" : "former" };
}

// Raw person (from the editor or an import file) → { doc, warnings }. The
// doc is ready to setDoc as-is apart from createdAt, which the caller keeps
// from the saved version.
export function normalizeCoach(raw) {
  const warnings = [];
  const Name = str(raw?.Name);
  if (!Name) warnings.push("No name");
  const Slug = slugify(raw?.Slug || Name);
  const stints = (Array.isArray(raw?.Stints) ? raw.Stints : []).map((s, i) => {
    const r = normalizeStint(s, i);
    warnings.push(...r.warnings);
    return r.stint;
  });
  const sorted = sortStints(stints);
  if (!sorted.length) warnings.push("No stints");
  const born = toInt(raw?.Born);
  if (Number.isNaN(born)) warnings.push("Bad birth year");
  const derived = deriveCurrent(sorted);
  if (!derived.Current.length && sorted.some(isOpenStint)) {
    // An open stint that isn't a tracked NFL job is fine (a former HC now
    // an analyst), but worth a look if it was meant to be current.
    warnings.push("Has an open-ended stint but no current HC/coordinator/GM job");
  }
  return {
    doc: {
      Name, Slug,
      Born: Number.isNaN(born) ? null : born,
      College: str(raw?.College),
      PlayingCareer: str(raw?.PlayingCareer),
      Notes: str(raw?.Notes),
      Sources: str(raw?.Sources),
      Stints: sorted,
      ...derived,
    },
    warnings,
  };
}

// Same span without months, for public pages: "2019–2021", "2019–present".
// Undated (common for playing days: "Harvard, four-year starter") → "".
export function stintYearSpan(s) {
  if (!s.StartYear && !s.EndYear) return "";
  const start = s.StartYear || "?";
  if (isOpenStint(s)) return `${start}–present`;
  if (s.EndUnknown) return `${start}–?`;
  if (!s.EndYear || s.EndYear === s.StartYear) return String(start);
  return `${start}–${s.EndYear}`;
}

// Career path (stints passed newest first) as one block per uninterrupted run with an
// organization: the org's name once, then each job held there. NFL stints
// group by franchise, so a run that spans a relocation or rename (San Diego
// → Los Angeles Chargers) stays one block under the newest name used.
// Playing days never share a block with jobs — someone who played and then
// coached at BYU gets a playing block and a coaching block.
export function groupStints(stints) {
  const groups = [];
  stints.forEach((s) => {
    const org = s.Level === "NFL" && s.Team ? `NFL:${s.Team}` : `${s.Level}:${String(s.Org || "").toLowerCase()}`;
    const key = `${isPlayerStint(s) ? "play" : "job"}|${org}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.stints.push(s);
    else groups.push({ key, org: s.Org, stints: [s] });
  });
  return groups.map((g) => {
    const starts = g.stints.map((s) => s.StartYear).filter(Boolean);
    const ends = g.stints.map((s) => s.EndYear).filter(Boolean);
    const open = g.stints.some(isOpenStint);
    const start = starts.length ? Math.min(...starts) : null;
    const end = open ? "present" : ends.length ? Math.max(...ends) : null;
    const span = !start ? "" : !end || end === start ? String(start) : `${start}–${end}`;
    return { ...g, span };
  });
}

// ── Draft credit ────────────────────────────────────────────────────────
// Which drafts a person was in the building for, and in what capacity.
// The draft is in late April, so the months decide edge years:
//   start — a hire after April misses that year's draft (Beane, May 2017).
//   end   — EndYear is the last season. No month: they were there for that
//           season's April draft. Jan/Feb: left after the season (before
//           the next draft). Mar/Apr: left before that spring's draft.
//           May on: left after it (Veach, July 2017 → had the 2017 draft).
//   EndUnknown — only the first draft is credited; nothing is guessed.
const DRAFT_MONTH = 4;

// { first, last } draft years for one stint (last = Infinity while open),
// or null when the stint covers no draft.
export function stintDraftRange(s) {
  if (!s?.StartYear) return null;
  const first = s.StartMonth && s.StartMonth > DRAFT_MONTH ? s.StartYear + 1 : s.StartYear;
  let last;
  if (isOpenStint(s)) last = Infinity;
  else if (s.EndUnknown || !s.EndYear) last = s.StartYear;
  else if (!s.EndMonth || s.EndMonth <= 2 || s.EndMonth > DRAFT_MONTH) last = s.EndYear;
  else last = s.EndYear - 1;
  return last >= first ? { first, last } : null;
}

// Role groups a draft page can credit picks under. A staff page defaults to
// the group of the job it's for (hc or gm); the others are opt-in. Coordinators are credited only with
// picks on their side of the ball (see POSITION_SIDE).
export const CREDIT_SCOPES = {
  hc: { label: "Head Coach", roles: ["HC", "IHC"] },
  gm: { label: "General Manager", roles: ["GM"] },
  coordinator: { label: "Coordinator", roles: ["OC", "DC", "CO_OC", "CO_DC"] },
  frontOffice: { label: "Front Office", roles: ["AGM", "EXEC", "DIR_FO", "DIR_PP", "DIR_CS", "DIR_PRO", "SCOUT", "PRO_SCOUT", "PERSONNEL", "CAP", "FO_OTHER"] },
};
const SCOPE_PRIORITY = ["hc", "gm", "frontOffice", "coordinator"];
export const scopeOfRole = (role) => SCOPE_PRIORITY.find((k) => CREDIT_SCOPES[k].roles.includes(role)) || null;

// Draft-data positions → side of the ball.
export const POSITION_SIDE = {
  QB: "Offense", RB: "Offense", WR: "Offense", TE: "Offense", OL: "Offense",
  DL: "Defense", EDGE: "Defense", LB: "Defense", DB: "Defense",
  K: "Special Teams", P: "Special Teams", LS: "Special Teams",
};

// Every NFL tenure a person could be credited with: one entry per stint ×
// creditable role, clamped to [minYear, maxYear].
export function draftCredits(stints, minYear, maxYear) {
  const out = [];
  (stints || []).forEach((s) => {
    if (s.Level !== "NFL" || !s.Team) return;
    const range = stintDraftRange(s);
    if (!range) return;
    const first = Math.max(range.first, minYear);
    const last = Math.min(range.last, maxYear);
    if (last < first) return;
    (s.Roles || []).forEach((role) => {
      const scope = scopeOfRole(role);
      if (scope) out.push({ team: s.Team, role, scope, side: ROLE_BY_KEY[role]?.side || "All", first, last, title: s.Title });
    });
  });
  return out;
}

// The best credit for one pick (team, year, position) among the enabled
// scopes, or null — head coach/GM beats front office beats coordinator.
export function creditForPick(credits, scopes, team, year, position) {
  let best = null;
  credits.forEach((c) => {
    if (!scopes.includes(c.scope) || c.team !== team || year < c.first || year > c.last) return;
    if (c.scope === "coordinator" && POSITION_SIDE[position] !== c.side) return;
    if (!best || SCOPE_PRIORITY.indexOf(c.scope) < SCOPE_PRIORITY.indexOf(best.scope)) best = c;
  });
  return best;
}

// Doc id for a new person: their name's slug, or name-1, name-2… when
// someone with the same name is already on file.
export function uniqueSlug(name, takenIds) {
  const base = slugify(name);
  const taken = new Set(takenIds);
  if (!taken.has(base)) return base;
  let n = 1;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// "2019–21", "2019–present", "2019" — compact span for lists.
export function stintSpan(s) {
  const m = (mo) => (mo ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ` : "");
  const start = s.StartYear ? `${m(s.StartMonth)}${s.StartYear}` : "?";
  if (isOpenStint(s)) return `${start}–present`;
  if (s.EndUnknown) return `${start}–?`;
  if (s.EndYear === s.StartYear && !s.StartMonth && !s.EndMonth) return start;
  return `${start}–${m(s.EndMonth)}${s.EndYear}`;
}
