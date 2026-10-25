// scripts/buildDraftHistory.mjs
//
// Builds src/utils/draftSim/draftHistory.json — every real NFL draft pick
// we have, for the Draft Sim's history analyst, Thad Murphy
// (utils/draftSim/analysts.js thadFacts: "the first Oregon QB in the first
// round since Justin Herbert"):
//
//   years    [first, last] draft year covered.
//   teams    team abbreviations; schools: school names (picks index both).
//   picks    [year, round, overall, team #, position, school #, name] —
//            `historical` (2000 on), then the latest draft (LATEST_DRAFT_YEAR)
//            from `draftOrder` joined to its players by slug, when
//            `historical` doesn't have it yet.
//   staff    { [coach slug]: { college, since: { GM|HC|OC|DC: { team, draft } } } }
//            — each current GM / head coach / coordinator's first draft in
//            that seat (a hire after April waits for the next draft), from
//            `coaches` stints.
//   firstOverall  every No. 1 overall pick since the merger, [year, team,
//            position, school, name] — FIRST_OVERALL below for the years
//            before the picks start, the picks' own after (a No. 1 missing
//            from the picks is added to them from FIRST_OVERALL). "The first WR to go first overall since
//            Keyshawn Johnson in 1996."
//   mascots  { [school]: one player's mascot } ("Texas": "Longhorn"), from
//            `schools` — "4 Longhorn picks since 2026".
//
// No Firestore writes — re-run after each draft (and staff changes) and
// commit the JSON.
// Usage:
//   node --env-file=.env scripts/buildDraftHistory.mjs
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { NFL_TEAMS } from "../src/utils/coachHistory.js";

const require = createRequire(import.meta.url);
const { getFirestore } = require("./firebaseAdmin");

const OUT = "src/utils/draftSim/draftHistory.json";
// Keep in sync with buildSiteSnapshots.mjs.
const LATEST_DRAFT_YEAR = 2026;
const SEATS = ["GM", "HC", "OC", "DC"];
// Coach bios' names for schools the draft data spells differently.
const COLLEGE_ALIASES = { "Miami (FL)": "Miami", "Cal": "California" };

// No. 1 overall picks the draft data doesn't have: 1970–1999 (today's
// franchise and our position groups) and 2007.
const FIRST_OVERALL = [
  [1970, "PIT", "QB", "Louisiana Tech", "Terry Bradshaw"], [1971, "NE", "QB", "Stanford", "Jim Plunkett"],
  [1972, "BUF", "EDGE", "Notre Dame", "Walt Patulski"], [1973, "TEN", "EDGE", "Tampa", "John Matuszak"],
  [1974, "DAL", "EDGE", "Tennessee State", "Ed \"Too Tall\" Jones"], [1975, "ATL", "QB", "California", "Steve Bartkowski"],
  [1976, "TB", "EDGE", "Oklahoma", "Lee Roy Selmon"], [1977, "TB", "RB", "USC", "Ricky Bell"],
  [1978, "TEN", "RB", "Texas", "Earl Campbell"], [1979, "BUF", "LB", "Ohio State", "Tom Cousineau"],
  [1980, "DET", "RB", "Oklahoma", "Billy Sims"], [1981, "NO", "RB", "South Carolina", "George Rogers"],
  [1982, "NE", "EDGE", "Texas", "Kenneth Sims"], [1983, "IND", "QB", "Stanford", "John Elway"],
  [1984, "NE", "WR", "Nebraska", "Irving Fryar"], [1985, "BUF", "EDGE", "Virginia Tech", "Bruce Smith"],
  [1986, "TB", "RB", "Auburn", "Bo Jackson"], [1987, "TB", "QB", "Miami", "Vinny Testaverde"],
  [1988, "ATL", "LB", "Auburn", "Aundray Bruce"], [1989, "DAL", "QB", "UCLA", "Troy Aikman"],
  [1990, "IND", "QB", "Illinois", "Jeff George"], [1991, "DAL", "DL", "Miami", "Russell Maryland"],
  [1992, "IND", "DL", "Washington", "Steve Emtman"], [1993, "NE", "QB", "Washington State", "Drew Bledsoe"],
  [1994, "CIN", "DL", "Ohio State", "Dan Wilkinson"], [1995, "CIN", "RB", "Penn State", "Ki-Jana Carter"],
  [1996, "NYJ", "WR", "USC", "Keyshawn Johnson"], [1997, "LAR", "OL", "Ohio State", "Orlando Pace"],
  [1998, "IND", "QB", "Tennessee", "Peyton Manning"], [1999, "CLE", "QB", "Kentucky", "Tim Couch"],
  [2007, "LV", "QB", "LSU", "JaMarcus Russell"],
];

const db = getFirestore();
const [histSnap, orderSnap, playerSnap, coachSnap, schoolSnap] = await Promise.all([
  db.collection("historical").get(),
  db.collection("draftOrder").get(),
  db.collection("players").where("Eligible", "==", String(LATEST_DRAFT_YEAR)).get(),
  db.collection("coaches").get(),
  db.collection("schools").get(),
]);

const abbrOf = Object.fromEntries(Object.entries(NFL_TEAMS).map(([abbr, name]) => [name, abbr]));
const rows = [];
const unknownTeams = new Set();
histSnap.docs.map((d) => d.data()).forEach((d) => {
  const team = abbrOf[d["NFL Team"]];
  if (!team) { unknownTeams.add(d["NFL Team"]); return; }
  if (!(+d.Year && +d.Pick > 0 && d.Position)) return;
  rows.push({ year: +d.Year, round: +d.Round, overall: +d.Pick, team, pos: d.Position, school: d.School || "", name: d.Player || `${d.First} ${d.Last}` });
});
if (!rows.some((r) => r.year === LATEST_DRAFT_YEAR)) {
  const bySlug = Object.fromEntries(playerSnap.docs.map((d) => [d.data().Slug, d.data()]));
  orderSnap.docs.map((d) => d.data()).filter((d) => d.Selection).forEach((d) => {
    const p = bySlug[d.Selection];
    if (!p) { console.warn(`No player for ${LATEST_DRAFT_YEAR} pick ${d.Pick} (${d.Selection})`); return; }
    rows.push({ year: LATEST_DRAFT_YEAR, round: +d.Round, overall: +d.Pick, team: d.Team, pos: p.Position, school: p.School || "", name: `${p.First} ${p.Last}` });
  });
}
if (unknownTeams.size) console.warn("Unknown teams:", [...unknownTeams]);
// A No. 1 pick missing from a draft the data covers (2007's JaMarcus
// Russell isn't in `historical`) goes into the picks too.
const firstYear = Math.min(...rows.map((r) => r.year));
FIRST_OVERALL.filter(([year]) => year >= firstYear && !rows.some((r) => r.year === year && r.overall === 1)).forEach(([year, team, pos, school, name]) => {
  console.log(`Adding ${year} No. 1 pick ${name} (missing from historical)`);
  rows.push({ year, round: 1, overall: 1, team, pos, school, name });
});
rows.sort((a, b) => a.year - b.year || a.overall - b.overall);

const teams = [...new Set(rows.map((r) => r.team))].sort();
const schools = [...new Set(rows.map((r) => r.school))].sort();
const teamIdx = Object.fromEntries(teams.map((t, i) => [t, i]));
const schoolIdx = Object.fromEntries(schools.map((s, i) => [s, i]));

const staff = {};
coachSnap.docs.map((d) => d.data()).forEach((c) => {
  const since = {};
  (c.Stints || []).filter((s) => s.Level === "NFL" && s.Team && s.EndYear == null && !s.EndUnknown).forEach((s) => {
    SEATS.filter((seat) => (s.Roles || []).includes(seat)).forEach((seat) => {
      since[seat] = { team: s.Team, draft: s.StartYear + (s.StartMonth > 4 ? 1 : 0) };
    });
  });
  if (Object.keys(since).length) staff[c.Slug] = { college: COLLEGE_ALIASES[c.College] || c.College || "", since };
});

// "Longhorns" → "Longhorn", "Huskies" → "Husky"; "Crimson Tide" stays.
const singular = (m) => (/ies$/.test(m) ? m.replace(/ies$/, "y") : /[^s]s$/.test(m) ? m.slice(0, -1) : m);
const drafted = new Set(schools);
const mascots = Object.fromEntries(schoolSnap.docs.map((d) => d.data())
  .filter((d) => d.School && d.Mascot && drafted.has(d.School))
  .map((d) => [d.School, singular(d.Mascot.trim())]));

const firstOverall = [
  ...FIRST_OVERALL.filter(([year]) => year < firstYear),
  ...rows.filter((r) => r.overall === 1).map((r) => [r.year, r.team, r.pos, r.school, r.name]),
].sort((a, b) => a[0] - b[0]);

const years = [rows[0].year, rows[rows.length - 1].year];
writeFileSync(OUT, JSON.stringify({
  years, teams, schools,
  picks: rows.map((r) => [r.year, r.round, r.overall, teamIdx[r.team], r.pos, schoolIdx[r.school], r.name]),
  staff,
  firstOverall,
  mascots,
}));
const perYear = {};
rows.forEach((r) => { perYear[r.year] = (perYear[r.year] || 0) + 1; });
console.log(`Wrote ${OUT}: ${rows.length} picks (${years.join("–")}), ${Object.keys(staff).length} staffers`);
console.log("Latest drafts:", Object.entries(perYear).slice(-3).map(([y, n]) => `${y}: ${n}`).join(", "));
const unmatched = Object.values(staff).map((s) => s.college).filter((c) => c && !schoolIdx[c] && schoolIdx[c] !== 0);
console.log("Staff colleges with no drafted players under that name:", [...new Set(unmatched)].join(" | "));
