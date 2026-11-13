// src/utils/highSchoolMatch.js
//
// Matches a CFBD high school (recruiting record: school name + state) to a
// doc in our `highSchools` collection — the one with the branding (logos,
// colors) that the high school team pages and a separate project read.
//
// A player links to a high school by exact name: players.HighSchool ==
// highSchools.Name (pages/HighSchoolTeamPage.js), with the state alongside.
// So a CFBD school is always saved under OUR doc's Name, and CFBD's own
// spelling is kept on the doc as an alias (highSchools.CFBDNames) so the
// next match is exact.
//
// Match order, within the same state only (two states can share a name):
//   alias  CFBD's name is already one of the doc's CFBDNames
//   exact  same name once spacing, punctuation, "High School"/"HS" and
//          St./Mt./Ft. are evened out
//   close  also the same once Prep / Academy / College / Institute are
//          set aside ("Chaminade-Madonna" ↔ "Chaminade-Madonna Prep") —
//          shown for the admin to confirm, never applied silently (scripts
//          and the CFB Universe add flow treat it as no match)
// Pure — shared by the admin tabs and Node scripts.

export const STATE_ABBR = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
export const STATE_NAME = Object.fromEntries(Object.entries(STATE_ABBR).map(([n, a]) => [a, n]));
// "FL" or "Florida" → "Florida"; anything else (a country, "") → as given.
export const stateName = (s) => STATE_NAME[String(s || "").toUpperCase()] || String(s || "");

const SAME = { st: "saint", mt: "mount", ft: "fort", "&": "and" };
const GENERIC = new Set(["high", "school", "hs", "the", "senior", "sr"]);
// Only words that name the same school either way. Not Catholic /
// Christian / Central / Regional / County / Charter / Memorial — they tell
// schools apart ("Red Bank Catholic" vs "Red Bank Regional", "Mater Dei
// Catholic" (Chula Vista) vs "Mater Dei" (Santa Ana)).
const LOOSE = new Set(["prep", "preparatory", "academy", "institute", "college", "of"]);

function tokens(name) {
  return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ")
    .filter(Boolean).map((t) => SAME[t] || t).filter((t) => !GENERIC.has(t));
}
export const hsKey = (name) => tokens(name).join(" ");
export const hsLooseKey = (name) => tokens(name).filter((t) => !LOOSE.has(t)).join(" ");

// National boarding schools: one campus, but CFBD lists each player under his
// HOMETOWN state, so a state-scoped match would mint a new "IMG Academy" in
// Texas, Virginia… Matched by name in any state, to our doc in its home
// state. Key → that state.
export const NATIONAL_SCHOOLS = { "img academy": "Florida" };

// → { doc, how: "alias" | "exact" | "close" } or null. docs: highSchools
// rows ({ id, Name, State, CFBDNames? }); state: full name or abbreviation.
export function matchHighSchool(cfbdName, state, docs) {
  if (!cfbdName) return null;
  const home = NATIONAL_SCHOOLS[hsKey(cfbdName)];
  if (home) {
    const national = (docs || []).find((d) => d.State === home && hsKey(d.Name) === hsKey(cfbdName));
    if (national) return { doc: national, how: "exact" };
    state = home;
  }
  const st = stateName(state);
  const inState = (docs || []).filter((d) => !st || d.State === st);
  const alias = inState.find((d) => (d.CFBDNames || []).includes(cfbdName));
  if (alias) return { doc: alias, how: "alias" };
  const k = hsKey(cfbdName);
  const exact = inState.filter((d) => hsKey(d.Name) === k);
  if (exact.length === 1) return { doc: exact[0], how: "exact" };
  const lk = hsLooseKey(cfbdName);
  const close = lk ? inState.filter((d) => hsLooseKey(d.Name) === lk) : [];
  if (close.length === 1) return { doc: close[0], how: "close" };
  return null;
}
