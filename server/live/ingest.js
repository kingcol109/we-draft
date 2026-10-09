// server/live/ingest.js
//
// The one central We-Draft Live ingestion process. Every CFBD call made on
// behalf of site visitors happens inside runTick(), which is triggered on a
// schedule (Vercel Cron → api/live-ingest.js, every ~30 seconds) — never by
// a page load — so 1 viewer and 10,000 viewers cost the same CFBD calls.
// A Firestore lease (liveMeta/lock) guarantees only one tick runs at a time
// even if triggers overlap.
//
// What a tick does depends on the CFBD plan the key is on (read from /info
// twice a day, see CONFIG.TIER_REFRESH_MS):
//
//   free         /games for the current week every SLATE_REFRESH.free while
//                games are on (scores, final flag), then full play-by-play +
//                player links + box score once each eligible game is final.
//   scoreboard   (Tier 1) + /scoreboard every tick while games are on: real
//                status, clock, possession, situation, last play.
//   live         (Tier 2+) + /live/plays for in-progress games, priority
//                games every tick (~30s) and the rest every LIVE_PLAYS_MS.normal,
//                only when the scoreboard shows something changed.
//
// Outside game windows a tick makes zero CFBD calls (it only reads two
// Firestore docs). Finished games are ingested once and never polled again.

const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");
const { cfbd, getCallCount } = require("./cfbdClient");
const P = require("./provider");
const { detectBigPlays } = require("./bigPlays");
const S = require("./store");
const { syncSchedule } = require("./scheduleSync");
const { presentPlay, learnSpotAbbrs } = require("./playParser");
const { rostersForGame } = require("./rosters");
const { runInsights } = require("./insights");
const { buildBreaks, timeoutExtras } = require("./breaks");

const CONFIG = {
  SEASON: 2026,
  // Ticks run every TICK_INTERVAL_MS (api/live-ingest.js runs two per
  // once-a-minute cron call; scripts/liveIngest.js --loop the same). A tick
  // stops starting new work after TICK_BUDGET_MS so it fits its slot —
  // leftover work just happens next tick. The lock lease is longer, so a
  // crashed/killed run blocks the next ones for 2.5 minutes at most.
  TICK_INTERVAL_MS: 30 * 1000,
  LOCK_MS: 150 * 1000,
  TICK_BUDGET_MS: 25 * 1000,
  // Live play-by-play requests in flight at once — CFBD 429s /live/plays
  // above a small per-key concurrency (observed: 5 fails, 1 is fine).
  LIVE_CONCURRENCY: 2,
  // A game counts as "on" from PRE_KICK_MS before kickoff until it's final
  // (or MAX_GAME_MS after kickoff, in case a final flag never arrives).
  PRE_KICK_MS: 30 * 60 * 1000,
  MAX_GAME_MS: 5 * 3600 * 1000,
  TIER_REFRESH_MS: 12 * 3600 * 1000,
  // How often /games is re-pulled: while games are on (free tier has no
  // other score source; paid tiers get scores from /scoreboard each tick)
  // and otherwise (picks up schedule/time changes).
  SLATE_REFRESH: { free: 20 * 60 * 1000, paid: 60 * 60 * 1000, idle: 6 * 3600 * 1000 },
  // Play-by-play refresh per live game: featured / Game of the Week every
  // tick (~30s), the rest every other tick (~60s). Scores/clocks for every
  // game come from /scoreboard each tick regardless. Budget (Tier 3, 75k
  // calls/month): ~1,200 calls/hour on a full Saturday — all games at 30s
  // would be ~2,000/hour and needs Tier 4.
  LIVE_PLAYS_MS: { priority: 25 * 1000, normal: 55 * 1000 },
  MAX_LIVE_FETCHES_PER_TICK: 20,
  // CFBD /roster fetches allowed per tick (1 per team per day; rosters let
  // live play text be linked to players — see server/live/rosters.js).
  ROSTER_BUILDS_PER_TICK: 6,
  POSTGAME: {
    // Earliest a final game is ingested, measured from kickoff — CFBD's
    // play-by-play and player links settle shortly after the final whistle.
    MIN_AFTER_KICK_MS: 3.5 * 3600 * 1000,
    RETRY_MS: 60 * 60 * 1000,
    MAX_ATTEMPTS: 4,
    PER_TICK: 3,
    // Which final games get full play-by-play on each plan. The free plan's
    // 1,000 calls/month can't cover the whole FBS slate (3 calls per game),
    // so it's limited to games We-Draft featured.
    SCOPE: { free: "featured", scoreboard: "featured", live: "all" },
  },
  // Stop optional calls (postgame, live plays) when the month's remaining
  // CFBD calls drop below this. Slate refreshes keep running.
  RESERVE_CALLS: 100,
  // Season-wide schedule26 kickoff sync (TV windows get announced 6-12
  // days out) — 2 CFBD calls each time.
  SEASON_SYNC_MS: 12 * 3600 * 1000,
  // Feed entries kept on each game doc (liveGames/{id}.feedPlays).
  MAX_GAME_FEED: 40,
  // Insight cards (server/live/insights.js) get at most this long per game
  // per fetch — they run after the plays are written, so a slow or failed
  // run only costs the insight, never the play feed.
  INSIGHT_BUDGET_MS: 5000,
  // The internal clock: a week stays the slate after its games, in REVIEW
  // (finals, big plays, top performances to catch up on), until Monday
  // 6:00 AM Eastern — then the next week takes over (its preview). CFBD
  // weeks end Monday 2:59 AM local time, so that's 3 hours 1 minute after
  // a week ends (in local time, so it holds across daylight saving).
  REVIEW_MS: 3 * 3600 * 1000 + 60 * 1000,
};

const metaRef = (db) => db.collection("liveMeta").doc("ingest");
const lockRef = (db) => db.collection("liveMeta").doc("lock");

// ── Lock ───────────────────────────────────────────────────────────────

async function acquireLock(db, owner, now) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(db));
    const d = snap.data();
    if (d && d.leaseUntil > now && d.owner !== owner) return false;
    tx.set(lockRef(db), { owner, leaseUntil: now + CONFIG.LOCK_MS, acquiredAt: now });
    return true;
  });
}

async function releaseLock(db, owner) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef(db));
    if (snap.data()?.owner === owner) tx.set(lockRef(db), { owner: null, leaseUntil: 0 });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

function tierFromInfo(info, now) {
  const f = info?.features || {};
  return {
    name: info?.tierName || "Unknown",
    level: f.livePlayByPlay ? "live" : f.scoreboard ? "scoreboard" : "free",
    monthlyLimit: info?.monthlyLimit ?? null,
    remainingCalls: info?.remainingCalls ?? null,
    checkedAt: now,
  };
}

// The slate week. Each calendar week is shifted by REVIEW_MS, so a week
// keeps the slate through its review window and the next one starts on
// Monday morning. nextWeekAt: when this one hands over.
function currentWeek(calendar, now) {
  const t = now - CONFIG.REVIEW_MS;
  const weeks = (calendar || []).map((w) => ({ ...w, start: Date.parse(w.startDate), end: Date.parse(w.endDate) }));
  const withFlip = (w) => ({ ...w, nextWeekAt: w.end + CONFIG.REVIEW_MS });
  const cur = weeks.find((w) => w.start <= t && t <= w.end);
  if (cur) return withFlip(cur);
  // Between calendar weeks: use the next one if it starts within 3 days.
  const next = weeks.filter((w) => w.start > t).sort((a, b) => a.start - b.start)[0];
  return next && next.start - t < 3 * 86400e3 ? withFlip(next) : null;
}

const isFbsGame = (g) => g.homeClassification === "fbs" || g.awayClassification === "fbs";

function isOn(g, now) {
  if (g.status === "final") return false;
  const start = Date.parse(g.startDate);
  if (!Number.isFinite(start)) return g.status === "in_progress";
  // Bounded even for in_progress, so a game the provider never marks
  // completed can't keep the slate in game-day polling forever.
  return start - CONFIG.PRE_KICK_MS <= now && now <= start + CONFIG.MAX_GAME_MS;
}

const isPriority = (g) => !!(g.featured || g.gameOfWeek);

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

// ── Game state never goes backward ─────────────────────────────────────
// CFBD's scoreboard is sometimes served stale (verified: Q4 4:40 while the
// play-by-play was already at 0:27), and two sources (scoreboard + live
// plays) both report score/clock. Whichever is further along in game time
// wins; an update that would move the clock or score backward has its live
// fields dropped (status/kickoff/team info still merge).
const LIVE_FIELDS = ["period", "clock", "possession", "down", "distance", "yardsToGoal", "situation", "lastPlayText"];
const clockSecs = (c) => { const m = /^(\d+):(\d+)/.exec(c || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const progressOf = (g) => (g?.period ? g.period * 10000 + (900 - Math.min(900, clockSecs(g.clock) ?? 900)) : null);
const totalPoints = (g) => (g?.home?.points ?? 0) + (g?.away?.points ?? 0);

// source: "plays" (/live/plays) or "scoreboard" — see the score-drop rule below.
function withoutStaleState(prev, next, { source } = {}) {
  if (!prev) return next;
  const out = { ...next };
  const dropLive = () => {
    LIVE_FIELDS.forEach((f) => delete out[f]);
    for (const side of ["home", "away"]) {
      if (out[side]) { out[side] = { ...out[side] }; delete out[side].points; delete out[side].lineScores; }
    }
  };
  if (prev.status === "final" && out.status && out.status !== "final") { delete out.status; dropLive(); return out; }
  if (out.status === "final") return out;
  const p0 = progressOf(prev);
  const p1 = progressOf(out);
  const hasScore = out.home?.points != null && out.away?.points != null;
  const behindScore = hasScore && totalPoints(out) < totalPoints(prev);
  const aheadScore = hasScore && totalPoints(out) > totalPoints(prev);
  // A clock at 0:00 that never turned into a final (CFBD sometimes inserts
  // an early "End of 4th quarter" play mid-quarter) is not trusted as a
  // high-water mark — otherwise every real update after it looks "behind"
  // and the game freezes. Points going up always means newer.
  const prevAtZero = clockSecs(prev.clock) === 0 && prev.status !== "final";
  const behindClock = p0 != null && p1 != null && p1 < p0 && !prevAtZero && !aheadScore;
  // Points coming OFF the board — a touchdown called back on review, a
  // score wiped out by a flag. Trusted when the clock isn't behind: from the
  // play-by-play (what CFBD corrects first) at the same point in the game or
  // later, from the scoreboard only once the clock has moved on. Anything
  // else is a stale snapshot. (Before this, a lower score was always read as
  // stale, so a called-back TD stayed up until more points were scored.)
  const scoreTakenOff = behindScore && p0 != null && p1 != null && (source === "plays" ? p1 >= p0 : p1 > p0);
  // ...and a stale snapshot that still has those points mustn't put them
  // back: the same score from no later in the game than where it came off.
  const r = prev.scoreRevoked;
  const revived = hasScore && r && out.home.points === r.home && out.away.points === r.away && (p1 == null || p1 <= r.at);
  if (behindClock || (behindScore && !scoreTakenOff) || revived) { dropLive(); return out; }
  if (scoreTakenOff) out.scoreRevoked = { home: prev.home.points, away: prev.away.points, at: p0 };
  return out;
}

const ordinal = (n) => ({ 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" }[n] || "");

// Game state carried by a /live/plays response (normalized by provider.js).
// Team names are left out — /games owns those.
function liveStateFromPlays(live, lastPlay) {
  const g = live.game || {};
  const team = (t) => (t ? { providerTeamId: t.providerTeamId, points: t.points ?? null, lineScores: t.lineScores || null } : undefined);
  return {
    providerGameId: g.providerGameId,
    status: g.status,
    period: g.period ?? undefined,
    clock: g.clock ?? undefined,
    possession: g.possession ?? undefined,
    down: g.down ?? undefined,
    distance: g.distance ?? undefined,
    yardsToGoal: g.yardsToGoal ?? undefined,
    situation: g.down && g.distance != null ? `${ordinal(g.down)} & ${g.distance}` : undefined,
    lastPlayText: lastPlay?.text || undefined,
    home: team(g.home),
    away: team(g.away),
  };
}

// schools by CFBD team id, cached per warm process.
let schoolsCache = null;
async function schoolsByTeamId(db) {
  if (schoolsCache && Date.now() - schoolsCache.at < 6 * 3600e3) return schoolsCache.map;
  const snap = await db.collection("schools").select("School", "Short", "Logo1", "LogoDark", "LogoBlack", "Color1", "Color2", "Mascot", "WordmarkDark", "Wordmark", "CFBDTeamId").get();
  const map = new Map();
  snap.docs.forEach((d) => { const s = d.data(); if (s.CFBDTeamId != null) map.set(s.CFBDTeamId, s); });
  schoolsCache = { at: Date.now(), map };
  return map;
}

// Adds the We-Draft side of each game: schedule26 link (id, slug,
// featured flags, ranks) and school branding.
async function enrich(db, games) {
  const ids = games.map((g) => g.providerGameId);
  const sched = new Map();
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection("schedule26").where("CFBDGameId", "in", ids.slice(i, i + 30)).get();
    snap.docs.forEach((d) => sched.set(d.data().CFBDGameId, { id: d.id, ...d.data() }));
  }
  const schools = await schoolsByTeamId(db);
  // We-Draft's own Top 25 for each game's week (rankings/{Week}; Week 0
  // shares Week 1's poll — same rule as src/utils/rankings.js). A week whose
  // poll isn't published yet (next week's games) uses the most recent poll
  // before it. A frozen schedule26 HomeRank/AwayRank (set when an admin
  // finalizes) wins.
  const rankMaps = new Map();
  const weeksNeeded = [...new Set([...sched.values()].map((s) => s.Week).filter(Boolean))];
  if (weeksNeeded.length) {
    const wkNum = (w) => { const m = /(\d+)/.exec(w || ""); return m ? Number(m[1]) : -1; };
    const polls = (await db.collection("rankings").get()).docs
      .map((d) => ({ n: wkNum(d.id), map: new Map((d.data().Top25 || []).filter((e) => e?.School && e?.Rank).map((e) => [e.School, e.Rank])) }))
      .filter((p) => p.map.size)
      .sort((a, b) => a.n - b.n);
    for (const w of weeksNeeded) {
      const n = Math.max(1, wkNum(w)); // Week 0 → Week 1's poll
      const poll = polls.find((p) => p.n === n) || [...polls].reverse().find((p) => p.n < n) || polls[polls.length - 1];
      rankMaps.set(w, poll ? poll.map : new Map());
    }
  }
  const rankOf = (s, side) => (side === "home" ? s?.HomeRank : s?.AwayRank) ?? rankMaps.get(s?.Week)?.get(side === "home" ? s?.Home : s?.Away) ?? null;
  const team = (t, rank) => {
    if (!t) return t;
    const s = schools.get(t.providerTeamId);
    return {
      ...t,
      school: s?.School || null,
      short: s?.Short || null,
      logo: s?.Logo1 || `https://cdn.collegefootballdata.com/logos/500/${t.providerTeamId}.png`,
      logoDark: s?.LogoDark || null,
      // The logo meant for dark backgrounds (the broadcasts use it first).
      logoBlack: s?.LogoBlack || null,
      // Dark-background wordmark (falls back to the regular one) — /live's
      // matchup header uses it as each side's faded backdrop.
      wordmark: s?.WordmarkDark || s?.Wordmark || null,
      color: s?.Color1 || null,
      // Second color — the scoreboard takeover's accents (HeaderTakeover.js).
      color2: s?.Color2 || null,
      mascot: s?.Mascot || null,
      rank: rank ?? null,
    };
  };
  return games.map((g) => {
    const s = sched.get(g.providerGameId);
    return {
      ...g,
      // CFBD home = schedule26 Home unless the mapping noted a swap.
      home: team(g.home, rankOf(s, s?.CFBDMatch?.swapped ? "away" : "home")),
      away: team(g.away, rankOf(s, s?.CFBDMatch?.swapped ? "home" : "away")),
      wedraftGameId: s?.id || null,
      slug: s?.Slug || null,
      featured: !!s?.Featured,
      gameOfWeek: !!s?.GameOfWeek,
      wedraftWeek: s?.Week || null,
      tv: g.tv ?? s?.Channel ?? null,
    };
  });
}

async function loadWeekGames(db, wk) {
  const snap = await db.collection("liveGames")
    .where("season", "==", wk.season).where("week", "==", wk.week).where("seasonType", "==", wk.seasonType).get();
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

// ── Per-game ingestion ─────────────────────────────────────────────────

// Plays → order → athletes → big plays → store. Returns feed-worthy new plays.
// insights: also run the insight engine (live games only — a postgame
// ingest of a finished game never makes cards).
async function storePlays(db, game, plays, playStats, { complete, rosterBudget, insights = false, log = () => {} }) {
  let ordered = P.finishPlays(plays);
  if (playStats) P.attachAthletes(ordered, playStats);
  detectBigPlays(ordered);
  // Display layer on top of the raw text (which is kept as-is in `text`).
  const rosters = await rostersForGame(db, game, rosterBudget).catch(() => ({ home: [], away: [] }));
  // Team abbreviations the play text uses ("WKU"), learned from this
  // game's own ball spots — tells the parser whose penalty a flag is.
  const abbrs = learnSpotAbbrs(ordered);
  for (const p of ordered) p.presentation = presentPlay(p, { athletes: p.athletes, rosters, abbrs });
  const res = await S.savePlays(db, game.providerGameId, ordered, { complete });
  const last = ordered[ordered.length - 1];
  // Compact scoring summary on the game doc itself, so a game page can show
  // every score with one doc read instead of loading the whole play list.
  const scoringPlays = ordered
    .filter((p) => p.scoring && !p.hidden && !/^(Extra Point|Two Point|2pt|Defensive 2pt)/.test(p.type))
    .map((p) => ({
      id: p.id, period: p.period, clock: p.clock, offense: p.offense, type: p.type,
      text: p.text.slice(0, 220), homeScore: p.homeScore, awayScore: p.awayScore,
      label: p.bigPlay?.label || null,
      athletes: (p.athletes || []).map((a) => ({ id: a.id, name: a.name })),
    }));
  // lastPlayText belongs to the scoreboard (fresher, every tick) — only
  // filled from plays when nothing else has set it (free plan).
  // This game's complete Feed (scoring/turnovers/20+ yard gains), newest
  // first — My Feed reads it per chosen game, so a personalized feed has
  // each game's whole history, not just what's still in the slate's
  // rolling cross-game list.
  const gid = S.gameKey(game.providerGameId);
  // Live box score (team + player stat lines from the play-by-play) — one
  // small doc the Stats tab and player pages read instead of every play.
  const { computeGameStats, gameLeaders } = await import("../../src/utils/liveStats.mjs");
  const stats = computeGameStats(ordered);
  await S.saveLiveStats(db, game.providerGameId, stats);
  const feedPlays = S.dedupeFeed(ordered.filter(S.feedWorthy).map((p) => S.slateBigPlay(gid, game, p)).reverse()).slice(0, CONFIG.MAX_GAME_FEED);
  await S.setGameFields(db, game.providerGameId, {
    playCount: ordered.length,
    scoringPlays,
    // This game's best stat lines — merged across the slate into
    // liveSlate/performances (Top Performances) by writeSlate.
    statLeaders: JSON.parse(JSON.stringify(gameLeaders(stats))),
    feedPlays,
    ...(last ? { lastPlayId: last.id, ...(game.lastPlayText ? {} : { lastPlayText: last.text }) } : {}),
  });
  // Feed entries for new plays, plus revised plays (CFBD corrected text, a
  // flag added): still Feed-worthy → refreshed entry; no longer (wiped out
  // by a penalty) or deleted upstream → pulled from the feed.
  const revised = res.changedPlays || [];
  // Insight cards — strictly after everything above is written, so the
  // feed never waits on them; any failure or timeout just means no card.
  let cards = game.insights || [];
  if (insights && (res.added.length || revised.length)) {
    let timer;
    try {
      const out = await Promise.race([
        runInsights(db, game, ordered, { rosters }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("insight budget exceeded")), CONFIG.INSIGHT_BUDGET_MS); }),
      ]);
      if (out?.insights) cards = out.insights;
      if (out?.added) log(`insights ${gid}: +${out.added} (${out.made.map((m) => m.context).join(" | ").slice(0, 200)})`);
    } catch (e) {
      log(`insights ${gid}: ${e.message.slice(0, 160)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  // Break summaries (end of Q1 / halftime / end of Q3) once a break has been
  // reached, and for a live game what its timeout box draws on (each team's
  // third / fourth downs, the game's We-Draft prospects) — server/live/
  // breaks.js. Same rule as the insights: after everything above, isolated,
  // and rewritten only when it changed.
  if (res.added.length || revised.length) {
    try {
      const reached = ordered.some((p) => (p.period || 0) >= 2 || p.presentation?.type === "period");
      const fields = reached ? { breaks: await buildBreaks(db, game, ordered, { rosters, insights: cards }) } : {};
      if (insights) Object.assign(fields, await timeoutExtras(db, rosters, stats, game));
      const h = crypto.createHash("sha1").update(JSON.stringify(fields)).digest("hex").slice(0, 16);
      if (Object.keys(fields).length && h !== game.extrasHash) {
        await S.setGameFields(db, game.providerGameId, { ...JSON.parse(JSON.stringify(fields)), extrasHash: h });
        game.extrasHash = h;
      }
    } catch (e) {
      log(`breaks ${gid}: ${e.message.slice(0, 160)}`);
    }
  }
  return {
    ...res,
    last,
    big: [...res.added, ...revised].filter(S.feedWorthy).map((p) => S.slateBigPlay(gid, game, p)),
    dropKeys: [
      ...revised.filter((p) => !S.feedWorthy(p)).map((p) => `${gid}:${p.id}`),
      ...(res.removedIds || []).map((id) => `${gid}:${id}`),
    ],
  };
}

// Full play-by-play + player links + box score for a finished game.
// 3 CFBD calls. Safe to rerun — unchanged plays aren't rewritten.
async function ingestFinalGame(db, game, tierLevel, rosterBudget = { left: 2 }) {
  const id = game.providerGameId;
  let plays;
  if (tierLevel === "live") {
    const liveData = P.fromLivePlays(await cfbd.livePlays(id), game.home?.name);
    plays = liveData.plays;
    if (liveData.advanced) await S.setGameFields(db, id, { advanced: JSON.parse(JSON.stringify(liveData.advanced)) });
  } else {
    const rows = await cfbd.plays({ year: game.season, week: game.week, seasonType: game.seasonType, team: game.home?.name });
    plays = rows.filter((p) => p.gameId === id).map(P.playFromHistorical);
  }
  const playStats = await cfbd.playStats({ gameId: id });
  const stored = await storePlays(db, game, plays, playStats, { complete: true, rosterBudget });
  const box = P.boxFromCfbd(await cfbd.gamePlayers({ id }));
  const boxRes = await S.saveBox(db, game, box);
  const done = plays.length > 0 && playStats.length > 0 && !!box;
  await S.setGameFields(db, id, {
    postgame: {
      done,
      attempts: FieldValue.increment(1),
      lastAttemptAt: Date.now(),
      plays: plays.length,
      playerLinks: playStats.length,
      boxPlayers: boxRes.players,
    },
  });
  return { plays: plays.length, added: stored.added.length, changed: stored.changed, removed: stored.removed, playerLinks: playStats.length, box: boxRes, big: stored.big, done };
}

// ── Tick ───────────────────────────────────────────────────────────────

async function runTick(db, { now = Date.now(), log = () => {}, forceSlate = false } = {}) {
  const owner = crypto.randomUUID();
  if (!(await acquireLock(db, owner, now))) return { skipped: "locked" };
  const callsAtStart = getCallCount();
  const startedAt = Date.now();
  const summary = { tier: null, week: null, slateRefreshed: false, scoreboard: false, liveFetches: 0, postgame: [], changedGames: 0, newBigPlays: 0, errors: [] };
  try {
    const meta = (await metaRef(db).get()).data() || {};
    const metaUpdate = {};

    // Plan / remaining calls.
    let tier = meta.tier;
    if (!tier || now - tier.checkedAt > CONFIG.TIER_REFRESH_MS) {
      tier = tierFromInfo(await cfbd.info(), now);
      metaUpdate.tier = tier;
      metaUpdate.callsSinceTierCheck = 0;
    }
    summary.tier = tier.level;
    const callsSinceCheck = (metaUpdate.callsSinceTierCheck ?? meta.callsSinceTierCheck ?? 0);
    const remaining = tier.remainingCalls == null ? Infinity : tier.remainingCalls - callsSinceCheck;
    const budgetOk = remaining > CONFIG.RESERVE_CALLS;

    // Season calendar (fetched once per season).
    let calendar = meta.calendarSeason === CONFIG.SEASON ? meta.calendar : null;
    if (!calendar) {
      calendar = (await cfbd.calendar(CONFIG.SEASON)).map((w) => ({ season: w.season, week: w.week, seasonType: w.seasonType, startDate: w.startDate, endDate: w.endDate }));
      metaUpdate.calendar = calendar;
      metaUpdate.calendarSeason = CONFIG.SEASON;
    }
    const wk = currentWeek(calendar, now);
    if (!wk) { summary.idle = "no current week"; return summary; }
    summary.week = `${wk.seasonType} ${wk.week}`;

    const slate = (await db.collection("liveSlate").doc("current").get()).data() || {};
    const sameWeek = slate.season === wk.season && slate.week === wk.week && slate.seasonType === wk.seasonType;
    const anyOn = sameWeek && (slate.games || []).some((g) => isOn(g, now));

    let games = null; // Map(id → liveGames doc) for the week, loaded lazily
    const changed = new Set();
    const newBig = [];
    const dropKeys = []; // Feed entries to pull (see storePlays)

    // 1. Slate refresh from /games.
    const refreshEvery = !anyOn ? CONFIG.SLATE_REFRESH.idle : tier.level === "free" ? CONFIG.SLATE_REFRESH.free : CONFIG.SLATE_REFRESH.paid;
    if (forceSlate || !sameWeek || now - (meta.lastSlateAt || 0) >= refreshEvery) {
      try {
        const rows = (await cfbd.games({ year: wk.season, week: wk.week, seasonType: wk.seasonType })).filter(isFbsGame);
        let normalized = rows.map((g) => P.gameFromCfbdGame(g, now));
        // On paid plans /scoreboard and live plays own in-progress state;
        // /games' coarser status/points (null mid-game) mustn't overwrite it.
        if (tier.level !== "free") {
          normalized = normalized.map((g) => (g.status === "in_progress"
            ? { ...g, status: undefined, home: { ...g.home, points: undefined, lineScores: undefined }, away: { ...g.away, points: undefined, lineScores: undefined } }
            : g));
        }
        normalized = (await enrich(db, normalized)).map((g) => JSON.parse(JSON.stringify(g)));
        const res = await S.upsertGames(db, normalized);
        res.changed.forEach((id) => changed.add(id));
        games = res.current;
        metaUpdate.lastSlateAt = now;
        summary.slateRefreshed = true;
      } catch (e) {
        summary.errors.push(`slate refresh: ${e.message.slice(0, 120)}`);
        log(`error in slate refresh: ${e.message.slice(0, 200)}`);
      }
    }
    if (!games) games = await loadWeekGames(db, wk);

    const weekOn = [...games.values()].some((g) => isOn(g, now));

    // Every step from here on is isolated: one provider error (CFBD returns
    // the odd 503) skips that step or that game, never the whole tick — the
    // slate still gets written with whatever did update.
    const step = async (name, fn) => {
      try { await fn(); } catch (e) { summary.errors.push(`${name}: ${e.message.slice(0, 120)}`); log(`error in ${name}: ${e.message.slice(0, 200)}`); }
    };
    const outOfTime = () => Date.now() - startedAt > CONFIG.TICK_BUDGET_MS;
    const rosterBudget = { left: CONFIG.ROSTER_BUILDS_PER_TICK };

    // 2. Scoreboard (Tier 1+), every tick while games are on.
    let scoreboardIds = null;
    if (tier.level !== "free" && weekOn) {
      await step("scoreboard", async () => {
        const rows = await cfbd.scoreboard({ classification: "fbs" });
        const sb = rows.map(P.gameFromScoreboard)
          .filter((g) => games.has(S.gameKey(g.providerGameId)))
          .map((g) => withoutStaleState(games.get(S.gameKey(g.providerGameId)), g, { source: "scoreboard" }))
          .map((g) => JSON.parse(JSON.stringify(g)));
        const res = await S.upsertGames(db, sb, games);
        res.changed.forEach((id) => changed.add(id));
        scoreboardIds = new Set(res.changed);
        summary.scoreboard = true;
      });
    }

    // 3. Live plays (Tier 2+) for in-progress games that changed. Fetched
    // a few at a time (CFBD can take 30s+ per call on Saturdays), and each
    // one also updates the game's score/clock when it's further along than
    // the scoreboard (the scoreboard is sometimes served stale).
    if (tier.level === "live" && budgetOk && !outOfTime()) {
      const fetchedAt = { ...(meta.playsFetchedAt || {}) };
      const due = [...games.entries()]
        .filter(([, g]) => g.status === "in_progress")
        .filter(([id, g]) => now - (fetchedAt[id] || 0) >= (isPriority(g) ? CONFIG.LIVE_PLAYS_MS.priority : CONFIG.LIVE_PLAYS_MS.normal))
        .filter(([id]) => !scoreboardIds || scoreboardIds.has(id) || !fetchedAt[id])
        .sort(([, a], [, b]) => Number(isPriority(b)) - Number(isPriority(a)))
        .slice(0, CONFIG.MAX_LIVE_FETCHES_PER_TICK);
      await mapLimit(due, CONFIG.LIVE_CONCURRENCY, async ([id, g]) => {
        if (outOfTime()) return;
        await step(`live plays ${id}`, async () => {
          const live = P.fromLivePlays(await cfbd.livePlays(g.providerGameId), g.home?.name);
          if (live.advanced) await S.setGameFields(db, g.providerGameId, { advanced: JSON.parse(JSON.stringify(live.advanced)) });
          const res = await storePlays(db, g, live.plays, null, { complete: true, rosterBudget, insights: true, log });
          newBig.push(...res.big);
          dropKeys.push(...(res.dropKeys || []));
          const state = liveStateFromPlays(live, res.last);
          const fresh = withoutStaleState(games.get(id), state, { source: "plays" });
          if (fresh.period != null || fresh.status === "final") {
            const up = await S.upsertGames(db, [JSON.parse(JSON.stringify(fresh))], games);
            up.changed.forEach((x) => changed.add(x));
          }
          fetchedAt[id] = now;
          summary.liveFetches++;
        });
      });
      metaUpdate.playsFetchedAt = Object.fromEntries(Object.entries(fetchedAt).filter(([id]) => games.has(id)));
    }

    // 4. Postgame: full ingest of finished games, once each.
    if (budgetOk && !outOfTime()) {
      const scope = CONFIG.POSTGAME.SCOPE[tier.level];
      const candidates = [...games.values()]
        .filter((g) => g.status === "final" && !g.postgame?.done)
        .filter((g) => scope === "all" || isPriority(g))
        .filter((g) => now - Date.parse(g.startDate) >= CONFIG.POSTGAME.MIN_AFTER_KICK_MS)
        .filter((g) => (g.postgame?.attempts || 0) < CONFIG.POSTGAME.MAX_ATTEMPTS && now - (g.postgame?.lastAttemptAt || 0) >= CONFIG.POSTGAME.RETRY_MS)
        .slice(0, CONFIG.POSTGAME.PER_TICK);
      for (const g of candidates) {
        if (outOfTime()) break;
        await step(`postgame ${g.providerGameId}`, async () => {
          const res = await ingestFinalGame(db, g, tier.level, rosterBudget);
          newBig.push(...res.big);
          dropKeys.push(...(res.dropKeys || []));
          summary.postgame.push({ id: g.providerGameId, plays: res.plays, added: res.added, done: res.done });
          log(`postgame ${g.providerGameId}: ${res.plays} plays (${res.added} new), ${res.playerLinks} player links, ${res.box.players} box players`);
        });
      }
    }

    // 4b. A game that just went final posts a FINAL entry to the Feed —
    // once (kept on the game doc as finalFeed, which also marks it done).
    for (const id of changed) {
      const g = games.get(id);
      if (g?.status !== "final" || g.finalFeed || g.home?.points == null || g.away?.points == null) continue;
      await step(`final feed ${id}`, async () => {
        const entry = S.finalFeedEntry(id, g, Date.now());
        await S.setGameFields(db, g.providerGameId, { finalFeed: entry });
        g.finalFeed = entry;
        newBig.push(entry);
        log(`final feed ${id}: ${entry.text}`);
      });
    }

    // 5. schedule26 write-back (server/live/scheduleSync.js): final scores
    // the moment a game goes final, kickoff times from this week's slate —
    // what makes We-Pick locking/grading run without an admin.
    const toSync = summary.slateRefreshed
      ? [...games.values()]
      : [...changed].map((id) => games.get(id)).filter((g) => g?.status === "final");
    if (toSync.length) {
      await step("schedule sync", async () => {
        const res = await syncSchedule(db, toSync);
        summary.schedule = { kickoffs: res.kickoffs, finals: res.finals, corrections: res.corrections };
        res.log.forEach((l) => log(l));
      });
    }
    // Also runs as soon as the week changes, so team records (built from the
    // same rows) never miss last week's results.
    const weekKey = S.weekKey(wk);
    if ((now - (meta.lastSeasonSyncAt || 0) >= CONFIG.SEASON_SYNC_MS || meta.recordsWeek !== weekKey) && !outOfTime()) {
      await step("season sync", async () => {
        const rows = [
          ...(await cfbd.games({ year: CONFIG.SEASON, seasonType: "regular" })),
          ...(await cfbd.games({ year: CONFIG.SEASON, seasonType: "postseason" })),
        ];
        const res = await syncSchedule(db, rows.map((g) => P.gameFromCfbdGame(g, now)));
        summary.seasonSync = { kickoffs: res.kickoffs, finals: res.finals, corrections: res.corrections };
        res.log.forEach((l) => log(l));
        await S.saveRecordsBase(db, wk, rows);
        metaUpdate.lastSeasonSyncAt = now;
        metaUpdate.recordsWeek = weekKey;
      });
    }

    // 6. Slate doc — only rewritten when something visible changed.
    summary.changedGames = changed.size;
    summary.newBigPlays = newBig.length;
    // (Also right after the season sync rebuilt team records, so the slate
    // picks them up even when no game changed — e.g. a week in review.)
    if (changed.size || newBig.length || dropKeys.length || !sameWeek || summary.postgame.length || slate.nextWeekAt !== wk.nextWeekAt || metaUpdate.recordsWeek) {
      const fresh = summary.postgame.length || summary.liveFetches ? await loadWeekGames(db, wk) : games;
      // Rosters for live games' last-play lines (full names) — cached
      // copies only, never a new CFBD call here.
      const rostersById = new Map();
      await Promise.all([...fresh.entries()].filter(([, g]) => g.status === "in_progress" && g.lastPlayText).map(async ([id, g]) => {
        rostersById.set(id, await rostersForGame(db, g, { left: 0 }).catch(() => undefined));
      }));
      await S.writeSlate(db, { season: wk.season, week: wk.week, seasonType: wk.seasonType, nextWeekAt: wk.nextWeekAt, games: fresh, newBigPlays: newBig, removeKeys: dropKeys, rostersById });
    }

    const calls = getCallCount() - callsAtStart;
    summary.cfbdCalls = calls;
    await metaRef(db).set({
      ...metaUpdate,
      callsSinceTierCheck: callsSinceCheck + calls - (metaUpdate.tier ? 1 : 0),
      lastTick: { at: now, ...summary, postgame: summary.postgame.length },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return summary;
  } finally {
    await releaseLock(db, owner).catch(() => {});
  }
}

// One game on demand (scripts/liveIngest.js --game) — ignores scope and
// timing rules. Creates the liveGames doc from /games if it doesn't exist.
async function ingestOneGame(db, providerGameId) {
  const ref = db.collection("liveGames").doc(S.gameKey(providerGameId));
  let game = (await ref.get()).data();
  if (!game) {
    const rows = await cfbd.games({ id: providerGameId });
    if (!rows.length) throw new Error(`CFBD has no game ${providerGameId}`);
    const [g] = await enrich(db, [P.gameFromCfbdGame(rows[0])]);
    await S.upsertGames(db, [JSON.parse(JSON.stringify(g))]);
    game = (await ref.get()).data();
  }
  const meta = (await metaRef(db).get()).data() || {};
  const level = meta.tier?.level || "free";
  return ingestFinalGame(db, game, game.status === "final" ? (level === "live" ? "live" : "free") : level);
}

module.exports = { CONFIG, currentWeek, runTick, ingestOneGame, withoutStaleState, enrich, storePlays };
