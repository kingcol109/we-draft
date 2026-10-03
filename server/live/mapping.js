// server/live/mapping.js
//
// Matching We-Draft records to provider (CFBD) identities. Pure functions —
// no Firestore or network access here — so the mapping scripts and the
// ingester apply exactly the same rules.
//
// Matches found here are only ever *suggestions* written with
// method: "auto". A manual correction (method: "manual", set from the
// admin panel or by hand) always wins, and the scripts never overwrite one.

// "San José State" / "San Jose State" / "Texas A&M" → "sanjosestate" / "texasaandm"
const norm = (s) => (s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

// schools.School → CFBD team `school` where neither the name nor CFBD's own
// alternateNames line up. Add to this when the team-mapping report lists
// a school as unmatched.
const TEAM_ALIASES = {
  "Louisiana-Monroe": "UL Monroe",
  "Southeastern Louisiana": "SE Louisiana",
  UMass: "Massachusetts",
  Albany: "UAlbany",
};

// Lower number = preferred when one name hits several CFBD teams
// (e.g. an FCS school and a Division III school sharing an alternate name).
const CLASS_RANK = { fbs: 0, fcs: 1, ii: 2, iii: 3 };

// Find the CFBD team for a We-Draft school name.
// Returns { team, via: "exact" | "alias" | "alternate" } or { team: null, candidates }.
function matchTeam(schoolName, cfbdTeams) {
  const target = norm(TEAM_ALIASES[schoolName] || schoolName);
  const via = TEAM_ALIASES[schoolName] ? "alias" : "exact";
  const pick = (list) => [...list].sort((a, b) => (CLASS_RANK[a.classification] ?? 9) - (CLASS_RANK[b.classification] ?? 9));

  const exact = cfbdTeams.filter((t) => norm(t.school) === target);
  if (exact.length === 1) return { team: exact[0], via };
  if (exact.length > 1) {
    const [first, second] = pick(exact);
    if ((CLASS_RANK[first.classification] ?? 9) < (CLASS_RANK[second.classification] ?? 9)) return { team: first, via };
    return { team: null, candidates: exact };
  }
  const alt = cfbdTeams.filter((t) => (t.alternateNames || []).some((n) => norm(n) === target));
  if (alt.length === 1) return { team: alt[0], via: "alternate" };
  if (alt.length > 1) {
    const [first, second] = pick(alt);
    if ((CLASS_RANK[first.classification] ?? 9) < (CLASS_RANK[second.classification] ?? 9)) return { team: first, via: "alternate" };
  }
  return { team: null, candidates: alt };
}

// "YYYY-MM-DD" of an instant in America/New_York — a 7:30pm ET kickoff is
// the next calendar day in UTC, but schedule26's Date is the ET game day.
const etDateKey = (ms) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(ms));

// schedule26.Date is stored as UTC midnight of the game day.
const utcDateKey = (ms) => new Date(ms).toISOString().slice(0, 10);

const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join("-");

// Match schedule26 games to CFBD games.
//   wdGames:   [{ id, Home, Away, Neutral, dateMs, CFBDGameId?, CFBDMatch? }]
//   cfbdGames: CFBD /games rows
//   teamIdBySchool: Map(schools.School → CFBD team id)
// Returns { matches: [{ wdId, cfbdGame, swapped }], problems: [{ wdId, reason, ... }] }.
// Only a single unambiguous match on (ET date + both teams) counts.
// Home/away reversed is accepted (neutral sites, data-entry swaps) but flagged.
function matchGames(wdGames, cfbdGames, teamIdBySchool) {
  const byDayPair = new Map();
  for (const g of cfbdGames) {
    if (!g.startDate || g.homeId == null || g.awayId == null) continue;
    const key = `${etDateKey(Date.parse(g.startDate))}|${pairKey(g.homeId, g.awayId)}`;
    if (!byDayPair.has(key)) byDayPair.set(key, []);
    byDayPair.get(key).push(g);
  }
  const cfbdById = new Map(cfbdGames.map((g) => [g.id, g]));

  const matches = [];
  const problems = [];
  for (const w of wdGames) {
    const homeId = teamIdBySchool.get(w.Home);
    const awayId = teamIdBySchool.get(w.Away);
    if (homeId == null || awayId == null) {
      problems.push({ wdId: w.id, reason: "team-unmapped", detail: [homeId == null && w.Home, awayId == null && w.Away].filter(Boolean).join(", ") });
      continue;
    }
    const candidates = byDayPair.get(`${utcDateKey(w.dateMs)}|${pairKey(homeId, awayId)}`) || [];
    if (candidates.length !== 1) {
      problems.push({ wdId: w.id, reason: candidates.length ? "ambiguous" : "no-cfbd-game", detail: candidates.map((c) => c.id).join(", ") });
      continue;
    }
    const c = candidates[0];
    const swapped = c.homeId !== homeId;
    if (w.CFBDMatch?.method === "manual" && w.CFBDGameId !== c.id) {
      problems.push({ wdId: w.id, reason: "manual-differs", detail: `manual ${w.CFBDGameId} vs auto ${c.id}` });
      continue;
    }
    matches.push({ wdId: w.id, cfbdGame: c, swapped });
  }

  // Two We-Draft games claiming the same CFBD game is a data problem, not a match.
  const claims = new Map();
  for (const m of matches) claims.set(m.cfbdGame.id, (claims.get(m.cfbdGame.id) || 0) + 1);
  const clean = matches.filter((m) => {
    if (claims.get(m.cfbdGame.id) === 1) return true;
    problems.push({ wdId: m.wdId, reason: "duplicate-claim", detail: String(m.cfbdGame.id) });
    return false;
  });

  return { matches: clean, problems, cfbdById };
}

module.exports = { norm, TEAM_ALIASES, matchTeam, matchGames, etDateKey, utcDateKey };
