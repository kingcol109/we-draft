// server/live/cfbdClient.js
//
// The ONLY place in the codebase that talks to CollegeFootballData (CFBD)
// or reads CFBD_API_KEY. Server-side only — lives outside src/ so Create
// React App never bundles it, and the key is read from process.env at call
// time (Vercel env var in production, the project's .env locally via
// `node --env-file=.env`). Never prefix the variable with REACT_APP_: CRA
// inlines those into the public JavaScript bundle.
//
// The key never leaves this module: it isn't logged, isn't included in
// thrown errors, and nothing here returns it. Callers get parsed JSON only.
//
// Everything above this file (provider.js, ingest.js) works in We-Draft's
// own normalized shapes, so swapping data providers later means writing a
// new client + provider pair, not touching the frontend.

const BASE_URL = "https://api.collegefootballdata.com";
// Generous: CFBD can take 30s+ to answer on busy Saturdays.
const TIMEOUT_MS = 60000;

// Calls made by this process — lets ingestion runs/scripts report their
// own API usage against the monthly CFBD budget (see /info below for the
// authoritative remaining count).
let callCount = 0;

class CfbdError extends Error {
  constructor(message, status, path) {
    super(message);
    this.name = "CfbdError";
    this.status = status;
    this.path = path;
  }
}

function apiKey() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new CfbdError("CFBD_API_KEY env var is not set.", 0, null);
  return key;
}

// Retried statuses: 429 (CFBD caps concurrent requests per endpoint, e.g.
// /live/plays) and any 5xx (seen on busy Saturdays: 503 from CFBD, 525
// from its Cloudflare edge). Short backoff — a tick has a time budget.
const isRetryable = (status) => status === 429 || status >= 500;
const RETRY_DELAYS_MS = [1500, 4000];

// GET a CFBD endpoint. `params` values that are null/undefined are skipped.
async function get(path, params = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getOnce(path, params);
    } catch (e) {
      if (!isRetryable(e.status) || attempt >= RETRY_DELAYS_MS.length) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function getOnce(path, params) {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  callCount++;
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (e) {
    throw new CfbdError(`CFBD request failed (${e.name === "AbortError" ? "timeout" : "network"})`, 0, path);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // Body text only — never the request headers (which carry the key).
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new CfbdError(`CFBD ${res.status} on ${path}: ${body}`, res.status, path);
  }
  return res.json();
}

// Thin, named wrappers for the endpoints We-Draft uses — verified against
// CFBD's OpenAPI spec (v5.32.1). Tier notes are from collegefootballdata.com/api-tiers.
const cfbd = {
  // Patreon level + remaining monthly calls (all tiers).
  info: () => get("/info"),
  // FBS teams for a season: [{ id, school, mascot, abbreviation, alternateNames, conference, ... }]
  fbsTeams: (year) => get("/teams/fbs", { year }),
  // All teams (FBS + FCS + lower) — needed to map FCS opponents in schedule26.
  teams: (year) => get("/teams", { year }),
  // Week-by-week season calendar: [{ season, week, seasonType, startDate, endDate, ... }]
  calendar: (year) => get("/calendar", { year }),
  // Games: [{ id, season, week, startDate, completed, homeId, homeTeam, homePoints, awayId, awayTeam, ... }]
  games: (params) => get("/games", params),
  // Historical play-by-play for a week (all tiers). Requires year + week.
  plays: (params) => get("/plays", params),
  playTypes: () => get("/plays/types"),
  // Play ↔ athlete links (athleteId per playId, statType like "Rush",
  // "Reception", "Completion"). Pass { gameId }; capped at 2,000 rows.
  playStats: (params) => get("/plays/stats", params),
  // Box score player stats; pass { id: gameId } for one game.
  gamePlayers: (params) => get("/games/players", params),
  // Season aggregates: [{ playerId, player, position, team, category, statType, stat }]
  seasonPlayerStats: (params) => get("/stats/player/season", params),
  roster: (params) => get("/roster", params),
  // Transfer portal for one season: [{ season, firstName, lastName, position, origin, destination, transferDate, rating, stars, eligibility }] — no player id.
  portal: (params) => get("/player/portal", params),
  // Recruits for one class: [{ id, athleteId, year, ranking, name, position, stars, rating, committedTo, ... }]
  recruits: (params) => get("/recruiting/players", params),
  // Live — Patreon Tier 1+ (scoreboard) / Tier 2+ (live plays).
  scoreboard: (params) => get("/scoreboard", params),
  livePlays: (gameId) => get("/live/plays", { gameId }),
};

module.exports = { cfbd, CfbdError, getCallCount: () => callCount };
