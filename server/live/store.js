// server/live/store.js
//
// Firestore persistence for We-Draft Live (admin SDK — bypasses security
// rules; the public can only read these collections, see firestore.rules).
//
//   liveGames/{providerGameId}                 normalized game state + We-Draft enrichment
//   liveGames/{id}/plays/{playId}              one doc per play (doc id = provider play id)
//   liveGames/{id}/box/players                 box score (per-player stat lines)
//   liveGames/{id}/box/live                    stats computed from the play-by-play (live)
//   liveGames/{id}/private/ingest              ingester bookkeeping (play hashes) — admin only
//   liveSlate/current                          ONE compact doc every /live viewer listens to
//   cfbdPlayers/{athleteId}                    provider player identity (+ optional We-Draft link)
//   cfbdPlayers/{athleteId}/games/{gameId}     game log line
//
// Dedup: each play's normalized content is hashed; a play is written only
// when it's new or its content changed (CFBD does revise play text/yardage
// after the fact). Writes use merge so admin-only fields on a play
// (`hidden`, `override`) are never overwritten by a re-ingest.

const crypto = require("crypto");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { presentPlay } = require("./playParser");

// Key-order-independent JSON — Firestore hands maps back with their keys
// in a different order than they were written, which must not read as a change.
const stable = (v) => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object" && !(typeof v.toMillis === "function")) {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  }
  return v;
};
const hash = (o) => crypto.createHash("sha1").update(JSON.stringify(stable(o))).digest("hex").slice(0, 16);
const gameKey = (providerGameId) => String(providerGameId);

async function commitInBatches(db, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
}

// ── Games ──────────────────────────────────────────────────────────────

// Fields that make up a game's visible state — the doc is only rewritten
// when one of these changes, so an idle tick costs reads, not writes.
const STATE_FIELDS = ["status", "period", "clock", "possession", "down", "distance", "yardsToGoal", "situation", "lastPlayText", "startDate", "tv", "home", "away", "wedraftGameId", "slug", "featured", "gameOfWeek"];
const stateHash = (g) => hash(STATE_FIELDS.map((f) => g[f] ?? null));

// Merge-writes the given games; returns the ids that actually changed.
// `existing` is a Map(id → current doc data) when the caller already has it.
// ── Chat markers ── a system message in a game's chat (liveGames/{id}/chat,
// components/LiveChat.js) at each step of the game — kickoff, each quarter,
// halftime, overtime, final — so the chat reads chronologically later
// ("this was during the 3rd"). Emitted by upsertGames when the game moves
// forward to a new step (chatMarkRank on the game doc keeps it one-way and
// once-only), and only for a game happening now (kicked off within
// CHAT_MARK_WINDOW_MS) — never for a backfilled old game.
const CHAT_MARK_WINDOW_MS = 12 * 3600e3;
const markClockSecs = (c) => { const m = /^(\d+):(\d+)/.exec(c || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function chatMarkOf(g) {
  if (g.status === "final") return { key: "final", rank: 1000 };
  if (g.status !== "in_progress" || !g.period) return null;
  const p = g.period;
  if (p === 2 && markClockSecs(g.clock) === 0) return { key: "half", rank: 25 };
  if (p > 4) return { key: `ot${p - 4}`, rank: 40 + p };
  return { key: p === 1 ? "kickoff" : `q${p}`, rank: p * 10 };
}
function chatMarkText(key, g) {
  const name = (t) => t?.short || t?.school || t?.name || "";
  const score = `${name(g.away)} ${g.away?.points ?? 0} – ${name(g.home)} ${g.home?.points ?? 0}`;
  if (key === "kickoff") return `🏈 Kickoff — ${g.away?.school || name(g.away)} at ${g.home?.school || name(g.home)}`;
  if (key === "half") return `⏸ Halftime · ${score}`;
  if (key === "final") return `🏁 Final · ${score}`;
  if (key.startsWith("ot")) { const n = Number(key.slice(2)); return `🔥 ${n > 1 ? `${n}OT` : "Overtime"} · ${score}`; }
  return `⏱ ${{ q2: "2nd", q3: "3rd", q4: "4th" }[key]} quarter${key === "q3" ? " — second half underway" : ""} · ${score}`;
}

async function upsertGames(db, games, existing) {
  const current = existing || new Map();
  if (!existing) {
    const refs = games.map((g) => db.collection("liveGames").doc(gameKey(g.providerGameId)));
    for (let i = 0; i < refs.length; i += 100) {
      const snaps = await db.getAll(...refs.slice(i, i + 100));
      snaps.forEach((s) => s.exists && current.set(s.id, s.data()));
    }
  }
  const changed = [];
  const ops = [];
  for (const g of games) {
    const id = gameKey(g.providerGameId);
    const prev = current.get(id) || {};
    const merged = deepMerge(prev, g);
    const h = stateHash(merged);
    if (prev.stateHash === h) continue;
    changed.push(id);
    // A new step in the game → its chat marker (see chatMarkOf).
    const mark = chatMarkOf(merged);
    const started = Date.parse(merged.startDate || "");
    const fresh = Number.isFinite(started) && Date.now() - started < CHAT_MARK_WINDOW_MS;
    const newMark = mark && fresh && mark.rank > (prev.chatMarkRank || 0) ? mark : null;
    const markFields = newMark ? { chatMark: newMark.key, chatMarkRank: newMark.rank } : {};
    current.set(id, { ...merged, ...markFields, stateHash: h });
    ops.push((b) => b.set(db.collection("liveGames").doc(id), { ...g, ...markFields, stateHash: h, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
    if (newMark) {
      ops.push((b) => b.set(db.collection("liveGames").doc(id).collection("chat").doc(), {
        system: true, kind: newMark.key, text: chatMarkText(newMark.key, merged),
        uid: "system", name: "We-Draft Live", at: FieldValue.serverTimestamp(), atMs: Date.now(),
      }));
    }
  }
  await commitInBatches(db, ops);
  return { changed, current };
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" ? deepMerge(a[k], v) : v;
  }
  return out;
}

async function setGameFields(db, providerGameId, fields) {
  await db.collection("liveGames").doc(gameKey(providerGameId)).set({ ...fields, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// ── Plays ──────────────────────────────────────────────────────────────

// `complete` = this is the provider's full play list for the game, so any
// previously stored play missing from it was deleted upstream and gets
// flagged `removed` (kept, not deleted, so an admin can see what happened).
async function savePlays(db, providerGameId, plays, { complete = false } = {}) {
  const gameRef = db.collection("liveGames").doc(gameKey(providerGameId));
  const stateRef = gameRef.collection("private").doc("ingest");
  const state = (await stateRef.get()).data() || {};
  const prevHashes = state.playHashes || {};
  const nextHashes = complete ? {} : { ...prevHashes };

  const ops = [];
  const added = [];
  // Plays CFBD revised after first reporting them (a flag wiping out a
  // gain, a corrected passer...) — returned so the caller can fix or pull
  // their Feed entries too.
  const changedPlays = [];
  for (const p of plays) {
    const h = hash(p);
    nextHashes[p.id] = h;
    if (prevHashes[p.id] === h) continue;
    if (prevHashes[p.id]) changedPlays.push(p); else added.push(p);
    const doc = {
      ...p,
      sortAt: p.wallClock ? Timestamp.fromMillis(Date.parse(p.wallClock)) : null,
      removed: false,
      updatedAt: FieldValue.serverTimestamp(),
    };
    ops.push((b) => b.set(gameRef.collection("plays").doc(p.id), doc, { merge: true }));
  }
  const removedIds = [];
  if (complete) {
    for (const id of Object.keys(prevHashes)) {
      if (nextHashes[id]) continue;
      removedIds.push(id);
      ops.push((b) => b.set(gameRef.collection("plays").doc(id), { removed: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
    }
  }
  ops.push((b) => b.set(stateRef, { playHashes: nextHashes, playsSavedAt: FieldValue.serverTimestamp() }));
  await commitInBatches(db, ops);
  return { added, changed: changedPlays.length, changedPlays, removed: removedIds.length, removedIds, total: plays.length };
}

// ── Box score + player identities ──────────────────────────────────────

const normName = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");

// We-Draft players indexed by (normalized name, CFBD team id) — the basis
// for *suggested* links only. A suggestion is never treated as verified:
// an admin confirms it (mappingStatus "verified") or clears it.
let wdIndexCache = null;
async function wedraftPlayerIndex(db) {
  if (wdIndexCache && Date.now() - wdIndexCache.at < 6 * 3600e3) return wdIndexCache.index;
  const [playersSnap, schoolsSnap] = await Promise.all([
    db.collection("players").select("First", "Last", "School", "Slug", "Position", "Eligible", "Live").get(),
    db.collection("schools").select("School", "CFBDTeamId").get(),
  ]);
  const teamBySchool = new Map(schoolsSnap.docs.map((d) => [d.data().School, d.data().CFBDTeamId]));
  const index = new Map();
  // Also by profile slug (live/breaks.js: a roster's linked players → their
  // We-Draft id, position, class and visibility).
  const bySlug = new Map();
  for (const d of playersSnap.docs) {
    const p = d.data();
    if (p.Slug) bySlug.set(p.Slug, { id: d.id, pos: p.Position || null, cls: p.Eligible != null ? String(p.Eligible) : null, live: p.Live });
    const teamId = teamBySchool.get(p.School);
    if (teamId == null || !p.First || !p.Last) continue;
    const key = `${normName(`${p.First} ${p.Last}`)}|${teamId}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ id: d.id, slug: p.Slug || null });
  }
  wdIndexCache = { at: Date.now(), index, bySlug };
  return index;
}
async function wedraftPlayersBySlug(db) {
  await wedraftPlayerIndex(db);
  return wdIndexCache.bySlug;
}

// Writes the box score doc, each player's game-log line, and upserts the
// cfbdPlayers identity docs. Never creates or modifies a We-Draft `players`
// doc — a CFBD player without a We-Draft profile simply has no link.
async function saveBox(db, game, box) {
  if (!box) return { players: 0, suggested: 0 };
  const gid = gameKey(game.providerGameId);
  const teamIdBySide = { home: game.home?.providerTeamId, away: game.away?.providerTeamId };

  const all = box.teams.flatMap((t) => t.players.map((p) => ({ ...p, side: t.side, team: t.name, teamId: teamIdBySide[t.side] ?? null })));
  const refs = all.map((p) => db.collection("cfbdPlayers").doc(p.id));
  const existing = new Map();
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100));
    snaps.forEach((s) => s.exists && existing.set(s.id, s.data()));
  }
  const index = await wedraftPlayerIndex(db);

  // Box doc carries each player's We-Draft link (if any) so the game page
  // can link names without a lookup per player.
  const linkOf = new Map();
  const ops = [];
  let suggested = 0;
  for (const p of all) {
    const prev = existing.get(p.id);
    const identity = { name: p.name, team: p.team, teamId: p.teamId, lastGameId: game.providerGameId, lastSeason: game.season ?? null, provider: "cfbd", updatedAt: FieldValue.serverTimestamp() };
    // Only unlinked players get (re)checked — "suggested", "verified" and
    // an admin's "rejected" are left exactly as they are.
    if (!prev || !prev.mappingStatus || prev.mappingStatus === "none") {
      const hits = p.teamId != null ? index.get(`${normName(p.name)}|${p.teamId}`) || [] : [];
      if (hits.length === 1) {
        Object.assign(identity, { wedraftPlayerId: hits[0].id, wedraftSlug: hits[0].slug, mappingStatus: "suggested", mappingSource: "name+team" });
        suggested++;
      } else if (!prev) {
        Object.assign(identity, { wedraftPlayerId: null, wedraftSlug: null, mappingStatus: "none" });
      }
    }
    const status = identity.mappingStatus || prev?.mappingStatus;
    const slug = identity.wedraftSlug !== undefined ? identity.wedraftSlug : prev?.wedraftSlug;
    if (slug && (status === "verified" || status === "suggested")) linkOf.set(p.id, { slug, status });

    ops.push((b) => b.set(db.collection("cfbdPlayers").doc(p.id), identity, { merge: true }));
    ops.push((b) => b.set(db.collection("cfbdPlayers").doc(p.id).collection("games").doc(gid), {
      providerGameId: game.providerGameId,
      season: game.season ?? null,
      week: game.week ?? null,
      seasonType: game.seasonType ?? null,
      startDate: game.startDate ?? null,
      team: p.team,
      opponent: p.side === "home" ? game.away?.name : game.home?.name,
      // The player page's game log shows the opponent's logo + short name.
      opponentShort: (p.side === "home" ? game.away?.short : game.home?.short) || null,
      opponentLogo: (p.side === "home" ? game.away?.logo : game.home?.logo) || null,
      // Final score from this team's side (the player page's W/L).
      teamPoints: (p.side === "home" ? game.home?.points : game.away?.points) ?? null,
      opponentPoints: (p.side === "home" ? game.away?.points : game.home?.points) ?? null,
      homeAway: p.side,
      wedraftGameSlug: game.slug ?? null,
      stats: p.stats,
      updatedAt: FieldValue.serverTimestamp(),
    }));
  }
  const boxDoc = {
    providerGameId: game.providerGameId,
    teams: box.teams.map((t) => ({
      ...t,
      players: t.players.map((p) => ({ ...p, wedraftSlug: linkOf.get(p.id)?.slug || null, mappingStatus: linkOf.get(p.id)?.status || null })),
    })),
    updatedAt: FieldValue.serverTimestamp(),
  };
  ops.push((b) => b.set(db.collection("liveGames").doc(gid).collection("box").doc("players"), boxDoc));
  await commitInBatches(db, ops);
  return { players: all.length, suggested };
}

// liveGames/{id}/box/live — stats computed from the play-by-play
// (src/utils/liveStats.mjs computeGameStats: { teams, players }). Rewritten
// only when the numbers changed.
async function saveLiveStats(db, providerGameId, stats) {
  const data = JSON.parse(JSON.stringify(stats));
  const ref = db.collection("liveGames").doc(gameKey(providerGameId)).collection("box").doc("live");
  const h = hash(data);
  if ((await ref.get()).data()?.hash === h) return false;
  await ref.set({ ...data, hash: h, updatedAt: FieldValue.serverTimestamp() });
  return true;
}

// ── Team records ───────────────────────────────────────────────────────
// liveMeta/records: each team's W-L from every completed game this season
// BEFORE the current week (built from the season sync's /games rows — no
// extra CFBD calls). The slate adds the current week's result on top once a
// game is final, so a record ticks over the moment the game ends.

const weekKey = (wk) => `${wk.season}-${wk.seasonType}-${wk.week}`;

async function saveRecordsBase(db, wk, rows) {
  const byTeam = {};
  for (const g of rows) {
    if (!g.completed || g.homePoints == null || g.awayPoints == null || g.homePoints === g.awayPoints) continue;
    if (g.season === wk.season && g.seasonType === wk.seasonType && g.week === wk.week) continue;
    const homeWon = g.homePoints > g.awayPoints;
    for (const [id, won] of [[g.homeId, homeWon], [g.awayId, !homeWon]]) {
      if (id == null) continue;
      const r = (byTeam[id] ||= [0, 0]);
      r[won ? 0 : 1]++;
    }
  }
  await db.collection("liveMeta").doc("records").set({ key: weekKey(wk), byTeam, updatedAt: FieldValue.serverTimestamp() });
}

// "5-1" for one side of a slate game: the base record plus this game's
// result when it's final. null when the team has no record on file.
function recordFor(base, g, side) {
  const t = g[side];
  const r = base?.[t?.providerTeamId];
  const other = g[side === "home" ? "away" : "home"];
  let [w, l] = r || [0, 0];
  if (g.status === "final" && t?.points != null && other?.points != null && t.points !== other.points) {
    if (t.points > other.points) w++; else l++;
  }
  return r || g.status === "final" ? `${w}-${l}` : null;
}

// ── Slate ──────────────────────────────────────────────────────────────

const teamSummary = (t = {}, record = null) => ({
  name: t.name || null,
  school: t.school || null,
  short: t.short || null,
  logo: t.logo || null,
  logoDark: t.logoDark || null,
  logoBlack: t.logoBlack || null,
  color: t.color || null,
  color2: t.color2 || null,
  mascot: t.mascot || null,
  rank: t.rank ?? null,
  points: t.points ?? null,
  providerTeamId: t.providerTeamId ?? null,
  record,
});

// rosters (optional): { home, away } CFBD rosters, so the last play shows
// full player names like the play feeds do. records: liveMeta/records byTeam.
function slateGame(id, g, rosters, records) {
  return {
    id,
    slug: g.slug || null,
    status: g.status || "scheduled",
    startDate: g.startDate || null,
    startTimeTBD: !!g.startTimeTBD,
    period: g.period ?? null,
    clock: g.clock ?? null,
    possession: g.possession ?? null,
    situation: g.situation ?? null,
    lastPlayText: g.lastPlayText ?? null,
    // Readable version of the last play for game tiles (raw text above is
    // kept). The scoreboard's last play has no structured fields, so the
    // parser reads everything from its text.
    lastPlay: g.lastPlayText ? compactPresentation(presentPlay({ text: g.lastPlayText, type: null }, rosters ? { rosters } : {})) : null,
    tv: g.tv ?? null,
    featured: !!g.featured,
    // schedule26 link — lets /live match a user's We-Pick Ranked 6
    // (wePickSubmissions/{week}/entries/{uid}.gameIds) to slate games.
    wedraftGameId: g.wedraftGameId || null,
    wedraftWeek: g.wedraftWeek || null,
    gameOfWeek: !!g.gameOfWeek,
    home: teamSummary(g.home, records ? recordFor(records, g, "home") : null),
    away: teamSummary(g.away, records ? recordFor(records, g, "away") : null),
  };
}

const MAX_SLATE_BIG_PLAYS = 60;

// The fields the slate's feeds render — keeps liveSlate/current small.
function compactPresentation(pr) {
  const { v, type, headline, emphasis, line, detail, yards, touchdown, firstDown, turnover, nullified, confidence, fallbackText, penaltyText, creditSide, pat, downsTurnover, flagStory, wasPlay } = pr;
  return JSON.parse(JSON.stringify({ v, type, headline, emphasis, line, detail, yards, touchdown, firstDown, turnover, nullified, confidence, fallbackText, penaltyText, creditSide, pat, downsTurnover, flagStory, wasPlay }));
}

function mergeAthletes(p) {
  const byId = new Map((p.athletes || []).map((a) => [a.id, { id: a.id, name: a.name }]));
  for (const v of Object.values(p.presentation?.players || {})) {
    for (const pl of Array.isArray(v) ? v : [v]) if (pl?.cfbdId && !byId.has(pl.cfbdId)) byId.set(pl.cfbdId, { id: pl.cfbdId, name: pl.name });
  }
  return [...byId.values()];
}

function slateBigPlay(gameId, g, p) {
  const offenseTeam = p.offense ? g[p.offense] : null;
  // The team the play is credited to (defense for a sack/pick/etc. — see
  // playParser.js creditSide), falling back to the team with the ball.
  const creditSide = p.presentation?.creditSide || p.offense;
  const creditTeam = creditSide ? g[creditSide] : null;
  return {
    key: `${gameId}:${p.id}`,
    gameId,
    playId: p.id,
    slug: g.slug || null,
    period: p.period,
    clock: p.clock,
    down: p.down ?? null,
    yardsToGoal: p.yardsToGoal ?? null, // ball spot before the snap (offense's yards to goal)
    distance: p.distance ?? null,
    text: p.text,
    label: p.bigPlay?.label || p.presentation?.headline || p.type,
    tags: p.bigPlay?.tags || [],
    priority: p.bigPlay?.priority ?? 1,
    kinds: feedKinds(p), // "score" | "turnover" | "big" — My Feed's play-type filters
    offense: p.offense,
    offenseName: offenseTeam?.school || offenseTeam?.name || p.offenseName || null,
    offenseLogo: offenseTeam?.logoDark || offenseTeam?.logo || null,
    teamName: creditTeam?.short || creditTeam?.school || creditTeam?.name || null,
    teamLogo: creditTeam?.logoDark || creditTeam?.logo || null,
    teamColor: creditTeam?.color || null,
    creditSide: creditSide || null,
    // Logos for the Feed card's mini scoreboard.
    homeLogo: g.home?.logoDark || g.home?.logo || null,
    awayLogo: g.away?.logoDark || g.away?.logo || null,
    homeShort: g.home?.short || g.home?.school || g.home?.name || null,
    awayShort: g.away?.short || g.away?.school || g.away?.name || null,
    homeScore: p.homeScore,
    awayScore: p.awayScore,
    // CFBD-linked athletes plus any the parser resolved (inferred) — used
    // for follow/My Players matching.
    athletes: mergeAthletes(p),
    presentation: p.presentation ? compactPresentation(p.presentation) : null,
    at: p.wallClock ? Date.parse(p.wallClock) : Date.now(),
  };
}

// Rebuilds liveSlate/current from the given games (Map id → liveGames doc)
// and folds any newly detected big plays into its rolling feed.
// removeKeys: Feed entries to pull — plays CFBD revised so they no longer
// qualify (e.g. wiped out by a flag) or deleted outright. A revised play
// that still qualifies just comes back in newBigPlays and replaces its
// entry (same key), keeping its original place in the feed.
// nextWeekAt: when the next week takes over the slate (ms) — /live shows
// it during review.
async function writeSlate(db, { season, week, seasonType, nextWeekAt = null, games, newBigPlays = [], removeKeys = [], rostersById = new Map() }) {
  const ref = db.collection("liveSlate").doc("current");
  const prev = (await ref.get()).data() || {};
  const sameWeek = prev.season === season && prev.week === week && prev.seasonType === seasonType;
  const byKey = new Map((sameWeek ? prev.bigPlays || [] : []).map((b) => [b.key, b]));
  for (const b of newBigPlays) byKey.set(b.key, byKey.has(b.key) ? { ...b, at: byKey.get(b.key).at } : b);
  for (const k of removeKeys) byKey.delete(k);
  const merged = dedupeFeed([...byKey.values()].sort((a, b) => b.at - a.at));
  byKey.clear();
  for (const b of merged) byKey.set(b.key, b);
  const bigPlays = [...byKey.values()].sort((a, b) => b.at - a.at).slice(0, MAX_SLATE_BIG_PLAYS);

  const rec = (await db.collection("liveMeta").doc("records").get()).data();
  const records = rec?.key === weekKey({ season, week, seasonType }) ? rec.byTeam : null;
  const gamesOut = [...games.entries()].map(([id, g]) => slateGame(id, g, rostersById.get(id), records))
    .sort((a, b) => (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0));
  // liveSlate/performances — the week's top stat lines across every game
  // (/live's Top Performances tab, the only reader). Rewritten only when
  // it changes; its hash rides on the slate doc so checking costs no read.
  const performances = slatePerformances(games);
  const perfHash = hash(performances);
  // liveSlate/status — just the number of games in progress, for the
  // site-wide navbar LIVE button (every page listens to it, so it stays
  // tiny and is only rewritten when the count changes). The count is kept
  // on the slate doc too — this set() replaces the whole doc, so it has to
  // be written here or it reads as changed every time.
  const liveCount = gamesOut.filter((g) => g.status === "in_progress").length;
  // liveSlate/week-{season}-{seasonType}-{week} — the week kept as one doc
  // (its games as the slate has them, each with its statLeaders), so /live's
  // week browser and Last Week read one doc instead of every game's
  // liveGames doc. Only written between games (nothing in progress — a
  // past week is only ever read once it's over) and when it changed; its
  // hash rides on the slate doc like perfHash.
  const archive = weekArchive(gamesOut, games);
  const archiveHash = hash(archive);
  const writeArchive = !liveCount && (!sameWeek || prev.weekArchiveHash !== archiveHash);
  const weekArchiveHash = writeArchive ? archiveHash : sameWeek ? prev.weekArchiveHash || null : null;
  await ref.set({ season, week, seasonType, nextWeekAt, games: gamesOut, bigPlays, statusLiveCount: liveCount, perfHash, weekArchiveHash, updatedAt: FieldValue.serverTimestamp() });
  if (!sameWeek || prev.statusLiveCount !== liveCount) {
    await db.collection("liveSlate").doc("status").set({ liveCount, updatedAt: FieldValue.serverTimestamp() });
  }
  if (!sameWeek || prev.perfHash !== perfHash) {
    await db.collection("liveSlate").doc("performances").set({ season, week, seasonType, ...performances, updatedAt: FieldValue.serverTimestamp() });
  }
  if (writeArchive) {
    await db.collection("liveSlate").doc(weekArchiveId({ season, week, seasonType })).set({ season, week, seasonType, games: archive, updatedAt: FieldValue.serverTimestamp() });
  }
  return { games: gamesOut.length, bigPlays: bigPlays.length };
}

// The week archive's doc id and games: the slate's games without what only
// matters mid-game (clock, down, last play), plus each game's statLeaders
// (/live's Top Performances for a past week are built from them).
const weekArchiveId = ({ season, week, seasonType }) => `week-${season}-${seasonType}-${week}`;
function weekArchive(gamesOut, games) {
  return gamesOut.map(({ clock, possession, situation, lastPlayText, lastPlay, ...g }) => ({
    ...g, statLeaders: JSON.parse(JSON.stringify(games.get(g.id)?.statLeaders || {})),
  }));
}

// ── Play archive ───────────────────────────────────────────────────────
// A final game's whole play-by-play in one or two docs (liveGames/{id}/box/
// pbp0, pbp1 …), so a final game's page reads one doc instead of every
// play. Built from the stored play docs themselves (exactly what a page
// would read), hidden and removed plays left out. The game doc's
// playArchive { rev, chunks, count } says it's there and which plays
// revision (playsRev) it holds.
const ARCHIVE_CHUNK_BYTES = 700 * 1024;
async function writePlayArchive(db, providerGameId, rev = 0) {
  const gameRef = db.collection("liveGames").doc(gameKey(providerGameId));
  const snap = await gameRef.collection("plays").get();
  const plays = snap.docs.map((d) => d.data()).filter((p) => !p.hidden && !p.removed)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const chunks = [[]];
  let bytes = 0;
  for (const p of plays) {
    const n = Buffer.byteLength(JSON.stringify(p));
    if (bytes + n > ARCHIVE_CHUNK_BYTES && chunks[chunks.length - 1].length) { chunks.push([]); bytes = 0; }
    chunks[chunks.length - 1].push(p);
    bytes += n;
  }
  const ops = chunks.map((list, i) => (b) => b.set(gameRef.collection("box").doc(`pbp${i}`), { i, of: chunks.length, plays: list, updatedAt: FieldValue.serverTimestamp() }));
  ops.push((b) => b.set(gameRef, { playArchive: { rev, chunks: chunks.length, count: plays.length, at: Date.now() } }, { merge: true }));
  await commitInBatches(db, ops);
  return { plays: plays.length, chunks: chunks.length };
}

// Every game's statLeaders merged into the week's top MAX_PERFORMANCES per
// category, each tagged with its game id (the page joins teams and the
// live score from liveSlate/current).
const MAX_PERFORMANCES = 15;
const PERF_CATS = ["passing", "rushing", "receiving", "defense"];
function slatePerformances(games) {
  const out = {};
  for (const cat of PERF_CATS) {
    out[cat] = [...games.entries()]
      .flatMap(([gameId, g]) => (g.statLeaders?.[cat] || []).map((e) => ({ ...e, gameId })))
      .sort((a, b) => b.v - a.v)
      .slice(0, MAX_PERFORMANCES);
  }
  return out;
}

// ── The Feed ───────────────────────────────────────────────────────────
// What goes in the Feed (/live's right rail, Big Plays, My Feed): scoring
// plays (TD/FG/safety — not PATs), turnovers (interceptions, lost fumbles —
// not turnovers on downs) and FEED_BIG_YARDS+ pass/run gains. Same 20-yard
// rule as the frontend's big-play styling (src/components/LivePlayCard.js
// HYPE_YARDS). Nullified (NO PLAY) and admin-hidden plays never qualify.
const FEED_BIG_YARDS = 20;
// `scoring` on a live play is inferred from the score changing since the
// play before it — and CFBD lists live plays out of order often enough that
// the change lands on a timeout, an end-of-quarter marker or an incomplete
// pass. Only a play that can actually score counts: a touchdown, a field
// goal, a safety (PATs/two-point tries ride along with their TD).
const SCORE_TYPES = new Set(["field_goal", "safety"]);
function isRealScore(p) {
  const pr = p.presentation || {};
  if (!p.scoring || pr.type === "conversion") return false;
  return !!pr.touchdown || SCORE_TYPES.has(pr.type) || /TOUCHDOWN|SAFETY/i.test(p.text || "");
}
function feedKinds(p) {
  const pr = p.presentation || {};
  if (p.hidden || pr.nullified) return [];
  const kinds = [];
  if (isRealScore(p)) kinds.push("score");
  if (pr.turnover) kinds.push("turnover");
  if ((pr.type === "pass" || pr.type === "rush") && pr.yards >= FEED_BIG_YARDS) kinds.push("big");
  // Turnover on downs makes the Feed only when it matters most: the 4th
  // quarter or overtime.
  if (pr.downsTurnover && (p.period || 0) >= 4 && !kinds.includes("turnover")) kinds.push("turnover");
  return kinds;
}
const feedWorthy = (p) => feedKinds(p).length > 0;

// CFBD sometimes re-issues a play under a new id (a revision) while the old
// one lingers. Two entries for the same game, quarter, clock and kind of
// play are the same play: keep only the first one given (callers pass
// newest first, so the most recent version wins).
function dedupeFeed(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    if (e.clock == null) return true; // FINAL entries etc.
    const sig = `${e.gameId}|${e.period}|${e.clock}|${e.presentation?.type || e.label}|${(e.kinds || []).join(",")}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// The Feed entry posted when a game goes final (kind "final"). Same shape as
// a play entry (slateBigPlay) so every feed renders it with no special data
// path; its presentation.type "final" gets its own card styling.
function finalFeedEntry(gameId, g, at = Date.now()) {
  const hp = g.home?.points ?? 0;
  const ap = g.away?.points ?? 0;
  const winSide = hp >= ap ? "home" : "away";
  const win = g[winSide] || {};
  const lose = g[winSide === "home" ? "away" : "home"] || {};
  const nm = (t) => t.school || t.name || "";
  // Upset: an unranked team beats a ranked one, or the lower-ranked team wins.
  const upset = !!lose.rank && (!win.rank || win.rank > lose.rank);
  return {
    key: `${gameId}:final`,
    gameId,
    playId: "final",
    slug: g.slug || null,
    period: g.period ?? null,
    clock: null,
    down: null,
    distance: null,
    text: `Final: ${nm(g.away)} ${ap}, ${nm(g.home)} ${hp}`,
    label: "Final",
    tags: upset ? ["upset"] : [],
    priority: upset ? 4 : 3,
    kinds: ["final"],
    offense: null,
    teamName: win.short || nm(win) || null,
    teamLogo: win.logoDark || win.logo || null,
    homeLogo: g.home?.logoDark || g.home?.logo || null,
    awayLogo: g.away?.logoDark || g.away?.logo || null,
    homeShort: g.home?.short || nm(g.home) || null,
    awayShort: g.away?.short || nm(g.away) || null,
    homeScore: hp,
    awayScore: ap,
    athletes: [],
    presentation: {
      v: 1, type: "final", emphasis: "final",
      headline: (g.period || 0) > 4 ? "FINAL/OT" : "FINAL",
      line: [{ text: `${nm(win)} wins` }],
      detail: `${nm(win)} ${Math.max(hp, ap)}, ${nm(lose)} ${Math.min(hp, ap)}`,
      upset,
    },
    at,
  };
}

module.exports = { gameKey, weekKey, weekArchiveId, writePlayArchive, saveRecordsBase, saveLiveStats, upsertGames, setGameFields, savePlays, saveBox, writeSlate, slateBigPlay, feedWorthy, wedraftPlayerIndex, normName, compactPresentation, MAX_SLATE_BIG_PLAYS, finalFeedEntry, dedupeFeed, wedraftPlayersBySlug };
