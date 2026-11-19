// src/utils/espnRecent.js
//
// A college player's recent games from his ESPN game log — his last game,
// his last 3 added up, which of the two is better, and the short stat line
// ("10 rec, 83 rec yds, 1 rec TD"). Plain fetch, no Firestore, so it runs in
// the browser (profileHub.js re-exports it for the player pages and the
// profile feed; riserRecent.js for the risers) and in Node scripts alike.
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes";

const cache = new Map();
const getJson = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(url);
};

// A player's most recent games from his ESPN game log, newest first — each
// { date, at, opp, oppLogo, result, score, line, groups } (lastGameLine
// below turns one into "10 rec, 83 rec yds, 1 rec TD").
export async function recentGamesOf(espnId, n = 3) {
  if (!espnId) return [];
  const log = await getJson(`${WEB}/${espnId}/gamelog`);
  if (!log?.events) return [];
  const rows = (log.seasonTypes || []).flatMap((t) => (t.categories || []).flatMap((c) => c.events || []));
  const groups = (log.categories || []).map((c) => [c.name, c.count]);
  return Object.values(log.events)
    .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))
    .map((ev) => {
      const row = rows.find((e) => e.eventId === ev.id);
      return row ? {
        date: ev.gameDate, at: ev.atVs, opp: ev.opponent?.abbreviation || "", oppLogo: ev.opponent?.logo || "",
        result: ev.gameResult, score: ev.score, line: (log.labels || []).map((l, i) => [l, row.stats?.[i]]), groups,
      } : null;
    })
    .filter(Boolean)
    .slice(0, n);
}
// His most recent game, or null.
export const lastGameOf = (espnId) => recentGamesOf(espnId, 1).then((g) => g[0] || null);

// Rates and longs don't add up across games; everything else does.
const NOT_SUMMED = new Set(["AVG", "LNG", "CMP%", "PCT", "RTG", "QBR", "YPC", "YPR"]);
const num = (v) => Number(String(v ?? "").replace(/,/g, "")) || 0;
// Several games' lines added together (same shape as one game's, plus
// games: how many, first / last: their dates, record "2-1").
export function sumGames(games) {
  if (!games.length) return null;
  const line = games[0].line.map(([label], i) => {
    if (NOT_SUMMED.has(label)) return [label, ""];
    const t = games.reduce((acc, g) => acc + num(g.line[i]?.[1]), 0);
    return [label, String(Math.round(t * 10) / 10).replace(/\.0$/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")];
  });
  const w = games.filter((g) => g.result === "W").length;
  const l = games.filter((g) => g.result === "L").length;
  return { ...games[0], line, games: games.length, first: games[games.length - 1].date, last: games[0].date, record: `${w}-${l}` };
}
// One stat from a game's line, by its group ("receiving") and label ("YDS").
function stat(g, group, label) {
  let i = 0;
  for (const [name, count] of g.groups) {
    if (name === group) {
      const at = g.line.slice(i, i + count).findIndex(([l]) => l === label);
      return at >= 0 ? num(g.line[i + at][1]) : 0;
    }
    i += count;
  }
  return 0;
}
// How big a line is — a rough fantasy-style score, the same for every
// position so offense and defense both count what they do.
export function gameScore(g) {
  if (!g) return 0;
  const pass = stat(g, "passing", "YDS") * 0.04 + stat(g, "passing", "TD") * 4 - stat(g, "passing", "INT") * 2;
  const rush = stat(g, "rushing", "YDS") * 0.1 + stat(g, "rushing", "TD") * 6;
  const rec = stat(g, "receiving", "REC") * 0.5 + stat(g, "receiving", "YDS") * 0.1 + stat(g, "receiving", "TD") * 6;
  const def = (stat(g, "tackles", "TOT") || stat(g, "defensive", "TOT")) + (stat(g, "tackles", "SACK") || stat(g, "defensive", "SACK")) * 4
    + stat(g, "tackles", "FF") * 3 + stat(g, "interceptions", "INT") * 6 + stat(g, "interceptions", "PD") * 2 + stat(g, "interceptions", "TD") * 6;
  return pass + rush + rec + def;
}
// His best recent line: his last game when it's at least as good as his
// average over the last 3, else the 3 games added up.
// → { kind: "last" | "last3", g } or null.
export async function bestRecentLine(espnId) {
  const games = await recentGamesOf(espnId, 3);
  if (!games.length) return null;
  if (games.length < 3) return { kind: "last", g: games[0] };
  const sum = sumGames(games);
  return gameScore(games[0]) >= gameScore(sum) / games.length ? { kind: "last", g: games[0] } : { kind: "last3", g: sum };
}

// A last-game line, short: "10 rec, 83 yds, 1 TD" — the nonzero headline
// stats of the categories that matter for his position.
export function lastGameLine(pos, g) {
  if (!g) return "";
  const get = (label, group) => {
    let i = 0;
    for (const [name, count] of g.groups) {
      if (name === group) {
        const at = g.line.slice(i, i + count).findIndex(([l]) => l === label);
        return at >= 0 ? g.line[i + at][1] : null;
      }
      i += count;
    }
    return null;
  };
  const p = (pos || "").toUpperCase();
  const bits = [];
  // Only what he added: zero and negative numbers (-2 rush yds) are left out.
  // One of something is singular: "1 sack", not "1 sacks".
  const add = (v, unit) => {
    if (v == null || v === "" || Number(String(v).replace(/,/g, "")) <= 0) return;
    bits.push(`${v} ${String(v) === "1" && unit === "sacks" ? "sack" : unit}`);
  };
  if (p === "QB") { add(get("CMP", "passing") && `${get("CMP", "passing")}/${get("ATT", "passing")}`, "pass"); add(get("YDS", "passing"), "pass yds"); add(get("TD", "passing"), "TD"); add(get("INT", "passing"), "INT"); }
  if (p === "RB" || p === "FB" || p === "QB") { add(get("YDS", "rushing"), "rush yds"); if (p !== "QB") add(get("TD", "rushing"), "rush TD"); }
  if (p === "WR" || p === "TE" || p === "RB") { add(get("REC", "receiving"), "rec"); add(get("YDS", "receiving"), "rec yds"); add(get("TD", "receiving"), "rec TD"); }
  if (!bits.length) { add(get("TOT", "tackles") ?? get("TOT", "defensive"), "tkl"); add(get("SACK", "tackles") ?? get("SACK", "defensive"), "sacks"); add(get("INT", "interceptions"), "INT"); add(get("PD", "interceptions") ?? get("PD", "defensive"), "PBU"); }
  return bits.join(", ");
}
