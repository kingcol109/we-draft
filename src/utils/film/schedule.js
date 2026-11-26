// src/utils/film/schedule.js
//
// Film ↔ the real games (user, 2026-11-25). Each film file is ONE side of a
// game — "FLORIDA STATE O VS. CLEMSON D" is Florida State's offense against
// Clemson's defense; "CLEMSON O VS. FLORIDA STATE D" is the other side of the
// same game. Matching each file to the season's schedule (CFBD — the
// compSnapshots/_filmSchedule_{season} docs, written by the film schedule
// script) gives it a standard name with its week and date, and ties the two
// sides of a game together (filmGames.cfbdGameId).
//
// Schedule rows: { id, week, type ("regular"|"postseason"), date (ISO),
// home, away, neutral, hp, ap (points) }. Pure.

export const FILM_SEASONS = ["2026", "2025", "2024"];

// Film-name spellings → CFBD's team names.
const CFBD_NAMES = {
  "southern methodist": "SMU", "texas christian": "TCU", "louisiana state": "LSU", "mississippi": "Ole Miss",
  "north carolina state": "NC State", "nc state": "NC State", "central florida": "UCF", "brigham young": "BYU",
  "southern california": "USC", "connecticut": "UConn", "alabama-birmingham": "UAB", "alabama birmingham": "UAB",
  "miami (fl)": "Miami", "miami fl": "Miami", "miami florida": "Miami", "florida international": "Florida International",
  "texas-san antonio": "UTSA", "texas san antonio": "UTSA", "texas-el paso": "UTEP", "texas el paso": "UTEP",
  "nevada-las vegas": "UNLV", "nevada las vegas": "UNLV", "hawaii": "Hawai'i", "san jose state": "San José State",
  "louisiana-monroe": "UL Monroe", "louisiana monroe": "UL Monroe", "massachusetts": "UMass",
  "southern mississippi": "Southern Miss", "appalachian state": "App State", "sam houston state": "Sam Houston",
  "fsu": "Florida State", "pitt": "Pittsburgh", "ole miss": "Ole Miss", "uconn": "UConn", "smu": "SMU", "tcu": "TCU",
  "lsu": "LSU", "byu": "BYU", "usc": "USC", "ucf": "UCF", "unc": "North Carolina", "virginia tech": "Virginia Tech",
  "miami ohio": "Miami (OH)", "miami (oh)": "Miami (OH)", "miami oh": "Miami (OH)", "psu": "Penn State", "usf": "South Florida",
  "fiu": "Florida International", "fau": "Florida Atlantic", "garner webb": "Gardner-Webb", "gardner webb": "Gardner-Webb",
};
const letters = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9&]/g, "");
export const cfbdTeam = (name) => CFBD_NAMES[String(name || "").trim().toLowerCase()] || String(name || "").trim();
export const teamKey = (name) => letters(cfbdTeam(name));

// The schedule game a film file is from: { game, candidates }.
// A unique match is the game. A rematch: the file's tag picks it — "(PLAYOFF)"
// / bowl → the postseason game, "(… CHAMPIONSHIP …)" → the conference title
// game (week 14+); untagged → the regular-season game (the tagged files are
// the others). Still several (or none): left to the admin.
const isTitleGame = (g) => g.type === "regular" && g.week >= 14;
export function matchGame(film, games) {
  const a = teamKey(film.offense);
  const b = teamKey(film.defense);
  if (!a || !b) return { game: null, candidates: [] };
  const candidates = (games || []).filter((g) => {
    const h = teamKey(g.home);
    const w = teamKey(g.away);
    return (h === a && w === b) || (h === b && w === a);
  });
  let pick = candidates;
  if (candidates.length > 1) {
    const note = String(film.note || "");
    if (/playoff|bowl|cfp|semi|final|quarter/.test(note) && !/championship game/.test(note)) pick = candidates.filter((g) => g.type === "postseason");
    else if (/championship/.test(note)) pick = candidates.filter(isTitleGame);
    else pick = candidates.filter((g) => g.type === "regular" && !isTitleGame(g));
  }
  return { game: pick.length === 1 ? pick[0] : candidates.length === 1 ? candidates[0] : null, candidates };
}

// "Week 9" / "Bowls" (postseason).
export const weekLabel = (g) => (!g ? "" : g.type === "postseason" ? "Postseason" : `Week ${g.week}`);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "");
// "Florida State at Clemson" (or "vs" at a neutral site).
export const matchup = (g) => (g ? `${g.away} ${g.neutral ? "vs" : "at"} ${g.home}` : "");
export const scoreLine = (g) => (g && g.hp != null && g.ap != null ? `${g.away} ${g.ap}, ${g.home} ${g.hp}` : "");

// A film file's standard name: "2025 · Week 9 · Nov 1 · Florida State at Clemson — Florida State offense".
export function filmName(fg) {
  if (!fg) return "";
  if (!fg.cfbdGameId) return fg.offense && fg.defense ? `${fg.season ? `${fg.season} · ` : ""}${fg.offense} O vs ${fg.defense} D` : String(fg.file || "").replace(/\.[^.]+$/, "");
  const g = { week: fg.week, type: fg.seasonType, home: fg.home, away: fg.away, neutral: fg.neutral };
  return [fg.season, weekLabel(g), fmtDate(fg.date), `${matchup(g)} — ${cfbdTeam(fg.offense)} offense`].filter(Boolean).join(" · ");
}
// The fields a match writes onto a film game.
export const matchFields = (g, how = "auto") => ({
  cfbdGameId: g.id, week: g.week, seasonType: g.type, date: g.date || "", home: g.home, away: g.away, neutral: !!g.neutral,
  hp: g.hp ?? null, ap: g.ap ?? null, matched: how,
});

// The season's games laid out for the film list: weeks → games, each with
// its two sides' film (filmGames matched to it). onlyTeams: show the games of
// these teams (the teams with film), every week.
// The game search (user, 2026-11-25): type the two schools any way —
// "oklahoma texas", "fsu at clemson", "ohio st mich", "texas a&m lsu".
// Every word has to start a word of either school (or be its initials /
// a known short name); "vs", "at", "and" are ignored.
const searchWords = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const SEARCH_STOP = new Set(["vs", "v", "versus", "at", "and", "the", "@"]);
export function gameMatches(query, g) {
  const toks = searchWords(query).filter((w) => !SEARCH_STOP.has(w));
  if (!toks.length) return true;
  const teams = [g.home, g.away].filter(Boolean);
  const hay = teams.flatMap(searchWords);
  const initials = teams.map((t) => searchWords(t).map((w) => w[0]).join(""));
  return toks.every((t) => {
    const alias = CFBD_NAMES[t];
    if (alias && teams.some((x) => teamKey(x) === teamKey(alias))) return true;
    return hay.some((w) => w.startsWith(t)) || initials.includes(t) || teams.some((x) => teamKey(x) === t);
  });
}
export function filmWeeks(games, films, onlyTeams = null) {
  const byGame = {};
  films.forEach((f) => { if (f.cfbdGameId) (byGame[f.cfbdGameId] = byGame[f.cfbdGameId] || []).push(f); });
  const keys = onlyTeams ? new Set([...onlyTeams].map(teamKey)) : null;
  const weeks = new Map();
  [...games].sort((x, y) => String(x.date).localeCompare(String(y.date))).forEach((g) => {
    if (keys && !keys.has(teamKey(g.home)) && !keys.has(teamKey(g.away))) return;
    const wk = weekLabel(g);
    if (!weeks.has(wk)) weeks.set(wk, []);
    const sides = byGame[g.id] || [];
    const side = (team) => sides.find((f) => teamKey(f.offense) === teamKey(team)) || null;
    weeks.get(wk).push({ game: g, away: side(g.away), home: side(g.home) });
  });
  return [...weeks.entries()].map(([label, rows]) => ({ label, rows }));
}
