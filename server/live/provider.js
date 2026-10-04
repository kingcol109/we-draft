// server/live/provider.js
//
// CFBD → We-Draft normalization. Everything stored in Firestore (and so
// everything the frontend reads) goes through these functions, which is
// what keeps CFBD's response shapes out of the rest of the system: a
// different provider means a different provider.js producing the same
// normalized game / play / box score objects.
//
// Normalized GAME:
//   { provider, providerGameId, season, week, seasonType, startDate (ISO),
//     startTimeTBD, neutralSite, status: "scheduled" | "in_progress" | "final",
//     period, clock, possession: "home" | "away" | null, down, distance,
//     yardsToGoal, situation, lastPlayText, tv, venue,
//     home: { providerTeamId, name, classification, points, lineScores },
//     away: { ... } }
//   Fields a source doesn't carry are left undefined (not null) so a merge
//   write never blanks out what a richer source wrote earlier.
//
// Normalized PLAY:
//   { id, providerGameId, seq, driveId, period, clock, clockSeconds,
//     wallClock, offense: "home" | "away" | null, offenseName, down,
//     distance, yardsToGoal, yards, type, text, homeScore, awayScore,
//     scoring, athletes: [{ id, name, stat }], athleteIds }

const PROVIDER = "cfbd";

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// CFBD play ids are "{gameId}{sequence}" — the trailing sequence orders
// plays within a game (same scheme for historical and live plays).
function playSeq(playId, gameId) {
  const id = String(playId);
  const g = String(gameId);
  if (id.startsWith(g)) {
    const n = Number(id.slice(g.length));
    if (Number.isFinite(n)) return n;
  }
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

const pad2 = (n) => String(n).padStart(2, "0");
function clockFromParts(clock) {
  if (clock == null) return { clock: null, clockSeconds: null };
  if (typeof clock === "string") {
    const m = /^(\d+):(\d+)/.exec(clock);
    return m ? { clock: `${Number(m[1])}:${m[2]}`, clockSeconds: Number(m[1]) * 60 + Number(m[2]) } : { clock, clockSeconds: null };
  }
  const min = clock.minutes ?? 0;
  const sec = clock.seconds ?? 0;
  return { clock: `${min}:${pad2(sec)}`, clockSeconds: min * 60 + sec };
}

// ── Games ──────────────────────────────────────────────────────────────

// From /games rows (all tiers). /games has no in-game status field and
// (verified on a live Saturday) leaves points null until the game is
// completed, so a kicked-off, not-completed game reads as in_progress with
// no score — the UI shows "LIVE" rather than a made-up 0-0.
function gameFromCfbdGame(g, nowMs = Date.now()) {
  const started = !g.startTimeTBD && g.startDate && Date.parse(g.startDate) <= nowMs;
  const status = g.completed ? "final" : started ? "in_progress" : "scheduled";
  return compact({
    provider: PROVIDER,
    providerGameId: g.id,
    season: g.season,
    week: g.week,
    seasonType: g.seasonType,
    startDate: g.startDate,
    startTimeTBD: !!g.startTimeTBD,
    neutralSite: !!g.neutralSite,
    venue: g.venue || null,
    status,
    home: { providerTeamId: g.homeId, name: g.homeTeam, classification: g.homeClassification || null, points: g.homePoints ?? null, lineScores: g.homeLineScores || null },
    away: { providerTeamId: g.awayId, name: g.awayTeam, classification: g.awayClassification || null, points: g.awayPoints ?? null, lineScores: g.awayLineScores || null },
  });
}

// From /scoreboard rows (Patreon Tier 1+): real status, clock, possession.
// Verified on live data: `possession` is "home" | "away" | null, and team
// names include the mascot ("Charlotte 49ers") — so `name` is left to the
// /games source ("Charlotte") rather than overwritten from here.
function gameFromScoreboard(s) {
  const side = (v) => (v === "home" || v === "away" ? v : !v ? null : v === s.homeTeam?.name ? "home" : v === s.awayTeam?.name ? "away" : null);
  const team = (t) => ({ providerTeamId: t.id, classification: t.classification || null, points: t.points ?? null, lineScores: t.lineScores || null });
  return compact({
    provider: PROVIDER,
    providerGameId: s.id,
    startDate: s.startDate,
    startTimeTBD: !!s.startTimeTBD,
    neutralSite: !!s.neutralSite,
    status: s.status === "completed" ? "final" : s.status === "in_progress" ? "in_progress" : "scheduled",
    period: s.period ?? null,
    clock: s.clock ? clockFromParts(s.clock).clock : null,
    possession: side(s.possession),
    situation: s.situation || null,
    lastPlayText: s.lastPlay || null,
    tv: s.tv || null,
    home: team(s.homeTeam),
    away: team(s.awayTeam),
  });
}

// ── Plays ──────────────────────────────────────────────────────────────

// /plays (historical, all tiers). Scores on these rows are AFTER the play
// (verified against real data: the TD row already includes the 7 points).
function playFromHistorical(p) {
  const offense = p.offense === p.home ? "home" : p.offense === p.away ? "away" : null;
  const homeScore = offense === "home" ? p.offenseScore : p.defenseScore;
  const awayScore = offense === "home" ? p.defenseScore : p.offenseScore;
  return {
    id: String(p.id),
    providerGameId: p.gameId,
    seq: playSeq(p.id, p.gameId),
    driveId: p.driveId != null ? String(p.driveId) : null,
    period: p.period,
    ...clockFromParts(p.clock),
    wallClock: p.wallclock || null,
    offense,
    offenseName: p.offense || null,
    down: p.down || null,
    distance: p.distance ?? null,
    yardsToGoal: p.yardsToGoal ?? null,
    yards: p.yardsGained ?? 0,
    type: p.playType || "Unknown",
    text: p.playText || "",
    homeScore: homeScore ?? null,
    awayScore: awayScore ?? null,
    scoring: !!p.scoring,
    athletes: [],
    athleteIds: [],
  };
}

// /live/plays (Patreon Tier 2+). Returns { game, plays }.
function fromLivePlays(live, homeName) {
  const teams = live.teams || [];
  const homeT = teams.find((t) => t.homeAway === "home");
  const awayT = teams.find((t) => t.homeAway === "away");
  const home = homeT?.team || homeName;
  const sideOf = (name) => (name === "home" || name === "away" ? name : name === home ? "home" : name && name === awayT?.team ? "away" : null);
  const plays = [];
  for (const d of live.drives || []) {
    for (const p of d.plays || []) {
      plays.push({
        id: String(p.id),
        providerGameId: live.id,
        seq: playSeq(p.id, live.id),
        driveId: d.id != null ? String(d.id) : null,
        period: p.period,
        ...clockFromParts(p.clock),
        wallClock: p.wallClock || null,
        offense: sideOf(p.team),
        offenseName: p.team || null,
        down: p.down || null,
        distance: p.distance ?? null,
        yardsToGoal: p.yardsToGoal ?? null,
        yards: p.yardsGained ?? 0,
        type: p.playType || "Unknown",
        text: p.playText || "",
        homeScore: p.homeScore ?? null,
        awayScore: p.awayScore ?? null,
        scoring: null, // derived from score change in finishPlays()
        athletes: [],
        athleteIds: [],
      });
    }
  }
  const game = compact({
    provider: PROVIDER,
    providerGameId: live.id,
    status: /final|completed/i.test(live.status || "") ? "final" : "in_progress",
    period: live.period ?? null,
    clock: live.clock ? clockFromParts(live.clock).clock : null,
    possession: sideOf(live.possession),
    down: live.down ?? null,
    distance: live.distance ?? null,
    yardsToGoal: live.yardsToGoal ?? null,
  });
  if (homeT && awayT) {
    game.home = { providerTeamId: homeT.teamId, name: homeT.team, points: homeT.points ?? null, lineScores: homeT.lineScores || null };
    game.away = { providerTeamId: awayT.teamId, name: awayT.team, points: awayT.points ?? null, lineScores: awayT.lineScores || null };
  }
  // CFBD's live advanced team metrics, kept for the Stats tab.
  const adv = (t) => (t ? {
    plays: t.plays ?? null, drives: t.drives ?? null,
    scoringOpportunities: t.scoringOpportunities ?? null, pointsPerOpportunity: t.pointsPerOpportunity ?? null,
    successRate: t.successRate ?? null, explosiveness: t.explosiveness ?? null,
    epaPerPlay: t.epaPerPlay ?? null, epaPerPass: t.epaPerPass ?? null, epaPerRush: t.epaPerRush ?? null,
    lineYardsPerRush: t.lineYardsPerRush ?? null,
  } : null);
  const advanced = homeT && awayT ? { home: adv(homeT), away: adv(awayT) } : null;
  return { game, plays, advanced };
}

// Game order: quarter, then game clock counting down, then sequence. Pure
// sequence order is almost right, but CFBD gives timeouts a later sequence
// than the plays they actually preceded. The frontend sorts with the same
// comparator (src/utils/live.js).
const comparePlays = (a, b) =>
  (a.period || 0) - (b.period || 0)
  || (a.clockSeconds != null && b.clockSeconds != null ? b.clockSeconds - a.clockSeconds : 0)
  || a.seq - b.seq;

// Sort into game order and fill `scoring` from score changes where the
// source didn't say (live plays).
function finishPlays(plays) {
  const sorted = [...plays].sort(comparePlays);
  let prevH = 0, prevA = 0;
  for (const p of sorted) {
    const h = p.homeScore ?? prevH;
    const a = p.awayScore ?? prevA;
    if (p.scoring == null) p.scoring = h !== prevH || a !== prevA;
    prevH = h; prevA = a;
  }
  return sorted;
}

// /plays/stats rows → attach athletes to their plays.
function attachAthletes(plays, playStats) {
  const byPlay = new Map();
  for (const s of playStats || []) {
    if (!s.playId || !s.athleteId) continue;
    const key = String(s.playId);
    if (!byPlay.has(key)) byPlay.set(key, []);
    const list = byPlay.get(key);
    if (!list.some((x) => x.id === String(s.athleteId) && x.stat === s.statType)) {
      list.push({ id: String(s.athleteId), name: s.athleteName || "", stat: s.statType || "" });
    }
  }
  for (const p of plays) {
    const list = byPlay.get(p.id);
    if (list) {
      p.athletes = list;
      p.athleteIds = [...new Set(list.map((x) => x.id))];
    }
  }
  return plays;
}

// ── Box score ──────────────────────────────────────────────────────────

// /games/players → { teams: [{ name, side, players: [{ id, name, stats: { passing: { "C/ATT": "16/23", ... } } }] }] }
function boxFromCfbd(gamePlayers) {
  const g = Array.isArray(gamePlayers) ? gamePlayers[0] : gamePlayers;
  if (!g) return null;
  const teams = (g.teams || []).map((t) => {
    const players = new Map();
    for (const cat of t.categories || []) {
      for (const type of cat.types || []) {
        for (const a of type.athletes || []) {
          if (!a.id || Number(a.id) < 0) continue; // CFBD uses negative ids for "Team" rows
          if (!players.has(a.id)) players.set(a.id, { id: String(a.id), name: a.name, stats: {} });
          const p = players.get(a.id);
          (p.stats[cat.name] ||= {})[type.name] = a.stat;
        }
      }
    }
    return { name: t.team, side: t.homeAway === "home" ? "home" : "away", points: t.points ?? null, players: [...players.values()] };
  });
  return { providerGameId: g.id, teams };
}

module.exports = {
  PROVIDER,
  gameFromCfbdGame,
  gameFromScoreboard,
  playFromHistorical,
  fromLivePlays,
  finishPlays,
  comparePlays,
  attachAthletes,
  boxFromCfbd,
  playSeq,
};
