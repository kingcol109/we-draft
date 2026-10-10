// server/live/insights.js
//
// We-Draft Live insight cards — the occasional "here's why that play
// matters" item between plays in a live game's feed. The play itself says
// what happened; an insight (a player's night crossing 100 yards, a 3rd
// sack, 21 unanswered points) says why it matters.
//
// Runs inside the ingester (ingest.js storePlays, live games only), AFTER
// the plays, live stats and game fields are written — so the play feed
// never waits on it, and a failure here only means no insight. Uses only
// data already in Firestore: no CFBD calls.
//
//   liveGames/{id}.insights            the cards (newest last, capped) — the
//                                      game doc every viewer already listens to
//   liveGames/{id}/private/insights    the engine's memory for the game: plays
//                                      evaluated, what was shown (cooldowns /
//                                      novelty), each player's season context
//
// How a card is chosen: every new play produces candidates (player facts,
// team trends, game trends), each with a base score for how much it
// matters. Cooldowns and novelty adjust the score (same player recently,
// same stat family, the same fact already shown, an insight a play ago),
// and only a candidate that still clears RULES.THRESHOLD becomes a card —
// most plays produce none. Nothing runs on a fixed "every N plays" clock.
//
// Season facts (season totals, highs, streaks) come from the players' own
// game logs (cfbdPlayers/{id}/games, written from every final game's box
// score), and are only claimed when every earlier game of the team this
// season has been ingested — otherwise a total could be short. Career
// numbers are never used.

const { FieldValue } = require("firebase-admin/firestore");

const RULES = {
  THRESHOLD: 55,
  // An insight within RECENT_PLAYS plays of the last one needs a big score.
  RECENT_PLAYS: 3, RECENT_PENALTY: 25,
  // The same player again within SUBJECT_PLAYS plays (a milestone barely pays).
  SUBJECT_PLAYS: 8, SUBJECT_PENALTY: 20, SUBJECT_PENALTY_MILESTONE: 5,
  // The same stat family (a team's third downs, its sacks...) within FAMILY_PLAYS.
  FAMILY_PLAYS: 15, FAMILY_PENALTY: 35,
  // Each card on a player beyond his first costs this much (60% when he's
  // leading the game in his category — genuinely the story, but still not
  // every catch).
  STORY_PENALTY: 12, STORY_LEADER_FACTOR: 0.6,
  SAME_CATEGORY_PENALTY: 6,
  // A long quiet stretch lowers the bar a little (never forces a card).
  QUIET_PLAYS: 10, QUIET_BONUS: 4,
  // Q4 blowouts: everything matters less.
  BLOWOUT_MARGIN: 28, BLOWOUT_PENALTY: 12,
  // Strong enough to follow another insight closely / be a run's 2nd card.
  MAJOR: 78,
  MAX_PER_RUN: 2,
  // New plays evaluated per run (a backlog after a stall only looks at the newest).
  MAX_EVAL: 6,
  MAX_STORED: 20,
  EXPLOSIVE_YARDS: 20,
};

const SCRIMMAGE = new Set(["pass", "incomplete", "rush", "sack", "interception", "fumble"]);
// Plays that count as "a play" for spacing (not timeouts / quarter markers).
const COUNTED = new Set([...SCRIMMAGE, "field_goal", "punt", "kickoff", "penalty"]);

const other = (s) => (s === "home" ? "away" : s === "away" ? "home" : null);
const ord = (n) => { const v = n % 100; return `${n}${["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"}`; };
const fmt1 = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const num = (v) => { const n = Number(String(v ?? "").split("/")[0]); return Number.isFinite(n) ? n : 0; };
const teamName = (t) => t?.school || t?.name || "";
const teamShort = (t) => t?.short || t?.school || t?.name || "";
const pkOf = (pl, side) => pl.cfbdId || `${side}|${pl.name}`;
const live = (p) => p.presentation && !p.hidden && !p.removed;
const realPlay = (p) => live(p) && !p.presentation.nullified;

// ── Season context (async, cached in the game's state doc) ─────────────

// Process-level caches for one-doc lookups shared by every game.
const cache = { grades: null, teams: null };
async function gradeSnapshots(db) {
  if (cache.grades && Date.now() - cache.grades.at < 6 * 3600e3) return cache.grades;
  const [g, t] = await Promise.all([
    db.collection("compSnapshots").doc("_grades").get(),
    db.collection("compSnapshots").doc("_top").get(),
  ]);
  cache.grades = { at: Date.now(), rows: g.data()?.rows || {}, years: t.data()?.years || {} };
  return cache.grades;
}
async function teamRanks(db) {
  if (cache.teams && Date.now() - cache.teams.at < 6 * 3600e3) return cache.teams;
  const d = (await db.collection("cfbLeaders").doc("teams").get()).data() || {};
  cache.teams = { at: Date.now(), updatedAt: d.updatedAt?.toMillis?.() ?? 0, byId: new Map((d.teams || []).map((t) => [t.id, t])) };
  return cache.teams;
}

// Same scale as the rest of the site (src/utils/snapshotBuilders.js GRADE_SCALE).
const GRADE_LABELS = { 1: "Early First Round", 2: "Middle First Round", 3: "Late First Round", 4: "Second Round", 5: "Third Round", 6: "Fourth Round", 7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA" };

// Each side's earlier games this season — and whether every one of them
// has its box score in (postgame.done), which is what makes season totals
// built from game logs exact.
async function teamCoverage(db, game, side) {
  const teamId = game[side]?.providerTeamId;
  if (teamId == null) return { complete: false, games: [] };
  const kick = Date.parse(game.startDate || "") || Date.now();
  const snaps = await Promise.all(["home", "away"].map((s) => db.collection("liveGames")
    .where(`${s}.providerTeamId`, "==", teamId).where("season", "==", game.season)
    .select("startDate", "status", "postgame", "seasonType").get()));
  const prior = snaps.flatMap((s) => s.docs)
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((g) => g.id !== String(game.providerGameId) && Date.parse(g.startDate || "") < kick)
    .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate));
  return { complete: prior.every((g) => g.status === "final" && g.postgame?.done), games: prior.map((g) => g.id) };
}

// One player's context: identity, We-Draft link + grade, and (when the
// team's season is fully ingested) season-to-date totals, single-game highs
// and streaks from his game logs — all BEFORE this game.
async function loadPlayer(db, id, game, side, coverage, roster, grades) {
  const ref = db.collection("cfbdPlayers").doc(id);
  const [snap, logs] = await Promise.all([
    ref.get(),
    coverage?.complete ? ref.collection("games").where("season", "==", game.season).get() : Promise.resolve(null),
  ]);
  const c = snap.data() || {};
  const ctx = { id, pos: roster?.pos || c.position || null, wd: null, prior: null, ranks: null };

  if (logs) {
    const byGame = new Map(logs.docs.map((d) => [d.id, d.data().stats || {}]));
    const lines = coverage.games.map((gid) => byGame.get(gid) || {}); // newest first; {} = no stats that game
    const P = { g: lines.length, rec: 0, recYds: 0, recTd: 0, car: 0, rushYds: 0, rushTd: 0, passYds: 0, passTd: 0, sacks: 0, defInt: 0,
      hi: { rec: 0, recYds: 0, rushYds: 0, passYds: 0, sacks: 0 }, streak: {} };
    const per = lines.map((s) => ({
      rec: num(s.receiving?.REC), recYds: num(s.receiving?.YDS), recTd: num(s.receiving?.TD),
      car: num(s.rushing?.CAR), rushYds: num(s.rushing?.YDS), rushTd: num(s.rushing?.TD),
      passYds: num(s.passing?.YDS), passTd: num(s.passing?.TD),
      sacks: num(s.defensive?.SACKS), defInt: num(s.interceptions?.INT),
    }));
    for (const x of per) {
      for (const k of ["rec", "recYds", "recTd", "car", "rushYds", "rushTd", "passYds", "passTd", "sacks", "defInt"]) P[k] += x[k];
      for (const k of Object.keys(P.hi)) P.hi[k] = Math.max(P.hi[k], x[k]);
    }
    // Consecutive most-recent team games meeting each condition.
    const run = (f) => { let n = 0; for (const x of per) { if (!f(x)) break; n++; } return n; };
    P.streak = {
      recTd: run((x) => x.recTd > 0), rushTd: run((x) => x.rushTd > 0), passTd: run((x) => x.passTd > 0),
      rec100: run((x) => x.recYds >= 100), rush100: run((x) => x.rushYds >= 100), sack: run((x) => x.sacks > 0),
    };
    P.sacks = Math.round(P.sacks * 10) / 10;
    ctx.prior = P;
  }

  // National ranks from the weekly season sync — only when that sync ran
  // before kickoff (so they describe the season coming in).
  const statsAt = c.seasonStatsAt?.toMillis?.() ?? 0;
  const kick = Date.parse(game.startDate || "") || 0;
  if (statsAt && statsAt < kick && kick - statsAt < 9 * 86400e3) ctx.ranks = c.seasonRanks?.[game.season] || null;

  if (c.wedraftPlayerId && (c.mappingStatus === "verified" || c.mappingStatus === "suggested")) {
    const wd = (await db.collection("players").doc(c.wedraftPlayerId).get()).data();
    if (wd) {
      const row = grades.rows[c.wedraftPlayerId];
      const cls = wd.Eligible != null ? String(wd.Eligible) : null;
      const rankIdx = cls ? (grades.years[cls] || []).findIndex((e) => e.i === c.wedraftPlayerId) : -1;
      ctx.wd = {
        id: c.wedraftPlayerId, slug: wd.Slug || c.wedraftSlug || null, pos: wd.Position || null, cls,
        grade: row ? GRADE_LABELS[Math.round(row[0])] || null : null, gradeAvg: row ? row[0] : null,
        classRank: rankIdx >= 0 ? rankIdx + 1 : null,
        strengths: row?.[2] ? row[2].split("|").filter(Boolean).slice(0, 3) : [],
      };
      if (ctx.wd.pos) ctx.pos = ctx.wd.pos;
    }
  }
  return ctx;
}

// ── Game tallies (pure) ─────────────────────────────────────────────────

const statsBy = (stats) => {
  const m = new Map();
  for (const side of ["home", "away"]) for (const l of stats.players?.[side] || []) m.set(l.key, l);
  return m;
};

// Explosive (20+ yard) gains by a player, or a team, through plays[0..i].
function explosives(plays, i, { key, side, role }) {
  let n = 0;
  for (let k = 0; k <= i; k++) {
    const p = plays[k];
    if (!realPlay(p)) continue;
    const pr = p.presentation;
    if ((pr.type !== "pass" && pr.type !== "rush") || !(pr.yards >= RULES.EXPLOSIVE_YARDS)) continue;
    if (side && p.offense !== side) continue;
    if (key) {
      const pl = role === "receiver" ? pr.players?.receiver : pr.players?.rusher;
      if (!pl || pkOf(pl, p.offense) !== key || (role === "receiver" ? pr.type !== "pass" : pr.type !== "rush")) continue;
    }
    n++;
  }
  return n;
}

// The offense's third-down results, in order, through plays[0..i].
function thirdDowns(plays, i, side) {
  const out = [];
  for (let k = 0; k <= i; k++) {
    const p = plays[k];
    if (!realPlay(p) || p.offense !== side || p.down !== 3 || !SCRIMMAGE.has(p.presentation.type)) continue;
    out.push(!!(p.presentation.firstDown || p.presentation.touchdown));
  }
  return out;
}

// Score after each play (carrying forward plays with no score).
function scoreAt(plays, i) {
  let h = 0, a = 0;
  for (let k = 0; k <= i; k++) { if (plays[k].homeScore != null) h = plays[k].homeScore; if (plays[k].awayScore != null) a = plays[k].awayScore; }
  return { home: h, away: a };
}

// Points `side` has scored since the other team last scored, as of
// plays[0..i] with the settled score `now`.
function scoringRun(plays, i, side, now) {
  const opp = other(side);
  let prev = { home: 0, away: 0 }, start = { home: 0, away: 0 };
  for (let k = 0; k <= i; k++) {
    const sc = { home: plays[k].homeScore ?? prev.home, away: plays[k].awayScore ?? prev.away };
    if (sc[opp] > prev[opp]) start = sc;
    prev = sc;
  }
  return { points: now[side] - start[side], trailedAtStart: start[side] < start[opp], start };
}

// ── Candidates (pure) ───────────────────────────────────────────────────

// Why the play itself is a big moment — added to every candidate it makes.
function playRelevance(p, score) {
  const pr = p.presentation;
  let r = 0;
  if (pr.touchdown) r += 8;
  if (pr.turnover) r += 8;
  if (pr.yards >= 40) r += 6; else if (pr.yards >= RULES.EXPLOSIVE_YARDS) r += 3;
  if (p.down === 3 && p.distance >= 7 && (pr.firstDown || pr.touchdown)) r += 3;
  if (p.down === 4 && (pr.firstDown || pr.touchdown)) r += 4;
  const margin = Math.abs(score.home - score.away);
  if ((p.period || 0) >= 4 && margin <= 8) r += 4;
  if ((p.period || 0) >= 4 && margin >= RULES.BLOWOUT_MARGIN) r -= RULES.BLOWOUT_PENALTY;
  return r;
}

// Threshold crossings: [T] for each T in list with before < T <= after.
const crossed = (list, before, after) => list.filter((T) => before < T && after >= T);

// Facts about one player on this play. Each: { key, text, score, milestone }.
function playerFacts(role, a, b, P, ctx2) {
  const f = [];
  const push = (key, text, score, milestone = false) => f.push({ key, text, score: Math.round(score), milestone });
  const { plays, i, key, play, isFirstTdTonight } = ctx2;
  const yards = play.presentation.yards || 0;

  if (role === "receiver") {
    const A = a.receiving || {}, B = b.receiving || {};
    for (const T of crossed([100, 150, 200, 250], B.yds || 0, A.yds || 0)) {
      const first = T === 100 && P && P.g >= 2 && P.hi.recYds < 100;
      push(`recYds${T}`, first ? `Over 100 receiving yards tonight — his first 100-yard game of the season` : `Now over ${T} receiving yards tonight`, 70 + (T - 100) / 10 + (first ? 8 : 0), true);
    }
    if (yards >= RULES.EXPLOSIVE_YARDS) {
      const n = explosives(plays, i, { key, role });
      if (n >= 2) push(`recExp${n}`, `His ${ord(n)} catch of 20+ yards tonight`, Math.min(72, 48 + 8 * (n - 2)));
    }
    if (play.presentation.touchdown) {
      if (A.td >= 2) push(`recTd${A.td}`, `His ${ord(A.td)} touchdown catch tonight`, 62 + 12 * (A.td - 2), A.td >= 3);
      if (P) {
        const tot = P.recTd + (A.td || 0);
        if (P.recTd === 0 && P.g >= 3 && A.td === 1) push("recTdFirst", "His first receiving touchdown of the season", 56);
        else if (tot >= 5 && tot % 5 === 0) push(`recTdSeason${tot}`, `His ${ord(tot)} receiving touchdown of the season`, 74, true);
        else if (tot >= 8) push(`recTdSeason${tot}`, `His ${ord(tot)} receiving touchdown of the season`, 58);
        if (isFirstTdTonight && P.streak.recTd >= 2) push("recTdStreak", `A touchdown catch in ${P.streak.recTd + 1} straight games`, 64 + 3 * (P.streak.recTd - 2), true);
      }
    }
    if (P && P.g >= 2) {
      if ((B.yds || 0) <= P.hi.recYds && A.yds > P.hi.recYds && A.yds >= 60) push("recYdsHigh", `New season high: ${A.yds} receiving yards (previous best ${P.hi.recYds})`, 66, true);
      if ((B.rec || 0) <= P.hi.rec && A.rec > P.hi.rec && A.rec >= 6) push("recHigh", `Catch No. ${A.rec} tonight — a new season high`, 60, true);
      for (const M of crossed([500, 750, 1000, 1250, 1500], P.recYds + (B.yds || 0), P.recYds + (A.yds || 0))) {
        push(`recSeason${M}`, `Crosses ${M.toLocaleString("en-US")} receiving yards on the season`, M >= 1000 ? 84 : 72, true);
      }
      if (P.streak.rec100 >= 2 && crossed([100], B.yds || 0, A.yds || 0).length) {
        push("rec100Streak", `${P.streak.rec100 + 1} straight 100-yard receiving games`, 72, true);
      }
    }
  }

  if (role === "rusher") {
    const A = a.rushing || {}, B = b.rushing || {};
    for (const T of crossed([100, 150, 200, 250], B.yds || 0, A.yds || 0)) {
      const first = T === 100 && P && P.g >= 2 && P.hi.rushYds < 100;
      push(`rushYds${T}`, first ? `Over 100 rushing yards tonight — his first 100-yard game of the season` : `Now over ${T} rushing yards tonight`, 70 + (T - 100) / 10 + (first ? 8 : 0), true);
    }
    if (yards >= RULES.EXPLOSIVE_YARDS) {
      const n = explosives(plays, i, { key, role });
      if (n >= 2) push(`rushExp${n}`, `His ${ord(n)} run of 20+ yards tonight`, Math.min(72, 50 + 8 * (n - 2)));
    }
    if (play.presentation.touchdown) {
      if (A.td >= 2) push(`rushTd${A.td}`, `His ${ord(A.td)} rushing touchdown tonight`, 62 + 12 * (A.td - 2), A.td >= 3);
      if (P) {
        const tot = P.rushTd + (A.td || 0);
        if (P.rushTd === 0 && P.g >= 3 && A.td === 1) push("rushTdFirst", "His first rushing touchdown of the season", 56);
        else if (tot >= 5 && tot % 5 === 0) push(`rushTdSeason${tot}`, `His ${ord(tot)} rushing touchdown of the season`, 74, true);
        else if (tot >= 8) push(`rushTdSeason${tot}`, `His ${ord(tot)} rushing touchdown of the season`, 58);
        if (isFirstTdTonight && P.streak.rushTd >= 2) push("rushTdStreak", `A rushing touchdown in ${P.streak.rushTd + 1} straight games`, 64 + 3 * (P.streak.rushTd - 2), true);
      }
    }
    if (P && P.g >= 2) {
      if ((B.yds || 0) <= P.hi.rushYds && A.yds > P.hi.rushYds && A.yds >= 70) push("rushYdsHigh", `New season high: ${A.yds} rushing yards (previous best ${P.hi.rushYds})`, 66, true);
      for (const M of crossed([500, 750, 1000, 1250, 1500], P.rushYds + (B.yds || 0), P.rushYds + (A.yds || 0))) {
        push(`rushSeason${M}`, `Crosses ${M.toLocaleString("en-US")} rushing yards on the season`, M >= 1000 ? 84 : 72, true);
      }
      if (P.streak.rush100 >= 2 && crossed([100], B.yds || 0, A.yds || 0).length) push("rush100Streak", `${P.streak.rush100 + 1} straight 100-yard rushing games`, 72, true);
    }
  }

  if (role === "passer") {
    const A = a.passing || {}, B = b.passing || {};
    for (const T of crossed([300, 400, 500], B.yds || 0, A.yds || 0)) push(`passYds${T}`, `Now over ${T} passing yards tonight`, 66 + (T - 300) / 10, true);
    if (play.presentation.touchdown && A.td >= 3) push(`passTd${A.td}`, `His ${ord(A.td)} touchdown pass tonight`, 62 + 8 * (A.td - 3), A.td >= 4);
    if (P) {
      const tot = P.passTd + (A.td || 0);
      if (play.presentation.touchdown && tot >= 10 && tot % 5 === 0) push(`passTdSeason${tot}`, `His ${ord(tot)} touchdown pass of the season`, 72, true);
      if (P.g >= 2 && (B.yds || 0) <= P.hi.passYds && A.yds > P.hi.passYds && A.yds >= 250) push("passYdsHigh", `New season high: ${A.yds} passing yards (previous best ${P.hi.passYds})`, 64, true);
      for (const M of crossed([1000, 1500, 2000, 2500, 3000, 3500, 4000], P.passYds + (B.yds || 0), P.passYds + (A.yds || 0))) {
        push(`passSeason${M}`, `Crosses ${M.toLocaleString("en-US")} passing yards on the season`, M >= 3000 ? 80 : 70, true);
      }
    }
    // An interception thrown (this play is a pick).
    if (play.presentation.type === "interception" && A.int >= 2) push(`intThrown${A.int}`, `${A.int} interceptions thrown tonight`, 56 + 8 * (A.int - 2));
  }

  if (role === "sacker") {
    const A = a.defense?.sacks || 0, B = b.defense?.sacks || 0;
    if (B < 2 && A >= 2) {
      const first = P && P.g >= 2 && P.hi.sacks < 2;
      push("sacks2", first ? `${fmt1(A)} sacks tonight — his first multi-sack game of the season` : `${(play.period || 0) <= 2 ? "Already " : ""}${fmt1(A)} sacks tonight`, 64 + (first ? 6 : 0), true);
    }
    if (B < 3 && A >= 3) push("sacks3", `${fmt1(A)} sacks tonight`, 80, true);
    if (P) {
      if (P.sacks === 0 && P.g >= 3 && A >= 1 && B < 1) push("sackFirst", "His first sack of the season", 50);
      for (const M of crossed([5, 8, 10, 12, 15], P.sacks + B, P.sacks + A)) push(`sackSeason${M}`, `${fmt1(P.sacks + A)} sacks on the season`, 70, true);
      if (B === 0 && A > 0 && P.streak.sack >= 2) push("sackStreak", `A sack in ${P.streak.sack + 1} straight games`, 64, true);
    }
  }

  if (role === "interceptor") {
    const A = a.defense?.int || 0;
    if (A >= 2) push(`int${A}`, `${A} interceptions tonight`, 80, true);
    if (P) {
      const tot = P.defInt + A;
      if (P.defInt === 0 && P.g >= 3 && A === 1) push("intFirst", "His first interception of the season", 58);
      else if (tot >= 3) push(`intSeason${tot}`, `His ${ord(tot)} interception of the season`, 64, true);
    }
  }
  return f;
}

// The stat category a role's card shows.
const ROLE_CAT = { receiver: "receiving", rusher: "rushing", passer: "passing", sacker: "defense", interceptor: "defense", recoverer: "defense" };

// "Season: 712 REC YDS · 6 TD" (season to date INCLUDING tonight).
function seasonLine(role, P, A) {
  if (!P) return null;
  const s = A || {};
  if (role === "receiver") return `Season: ${P.rec + (s.rec || 0)} REC · ${(P.recYds + (s.yds || 0)).toLocaleString("en-US")} YDS · ${P.recTd + (s.td || 0)} TD`;
  if (role === "rusher") return `Season: ${(P.rushYds + (s.yds || 0)).toLocaleString("en-US")} rush YDS · ${P.rushTd + (s.td || 0)} TD`;
  if (role === "passer") return `Season: ${(P.passYds + (s.yds || 0)).toLocaleString("en-US")} pass YDS · ${P.passTd + (s.td || 0)} TD`;
  if (role === "sacker") { const n = P.sacks + (s.sacks || 0); return `Season: ${fmt1(n)} sack${n === 1 ? "" : "s"}`; }
  if (role === "interceptor") return `Season: ${P.defInt + (s.int || 0)} INT`;
  return null;
}

// "Came in 4th in FBS in receiving yards" — only top-25 ranks are worth saying.
function rankLine(role, ranks) {
  const pick = { receiver: [["receiving", "YDS", "receiving yards"], ["receiving", "TD", "receiving TDs"]], rusher: [["rushing", "YDS", "rushing yards"], ["rushing", "TD", "rushing TDs"]],
    passer: [["passing", "YDS", "passing yards"], ["passing", "TD", "passing TDs"]], sacker: [["defensive", "SACKS", "sacks"]], interceptor: [["interceptions", "INT", "interceptions"]] }[role] || [];
  for (const [cat, stat, label] of pick) {
    const r = ranks?.[cat]?.[stat];
    const n = r ? Number(String(r).replace("T-", "")) : null;
    if (n && n <= 25) return `Came in ${String(r).startsWith("T-") ? "tied for " : ""}${ord(n)} in FBS in ${label}`;
  }
  return null;
}

function wdIntroText(wd) {
  if (wd.classRank && wd.cls) return `The No. ${wd.classRank} prospect in the ${wd.cls} class on We-Draft`;
  if (wd.grade) return `We-Draft community grade: ${wd.grade}`;
  return wd.cls ? `On the We-Draft ${wd.cls} draft board` : "On the We-Draft draft board";
}

// The roles on a play worth an insight, as [role, player, side].
function rolesOf(p) {
  const pr = p.presentation;
  const P = pr.players || {};
  const off = p.offense, def = other(off);
  if (pr.type === "pass") return [["receiver", P.receiver, off], ["passer", P.passer, off]];
  if (pr.type === "rush") return [["rusher", P.rusher, off]];
  if (pr.type === "sack") return (P.sackers || (P.sacker ? [P.sacker] : [])).map((s) => ["sacker", s, def]);
  if (pr.type === "interception") return [["interceptor", P.interceptor, def], ["passer", P.passer, off]];
  if (pr.type === "fumble" && pr.turnover) return [["recoverer", P.recoverer, def]];
  return [];
}

// A play big enough that a mapped We-Draft player on it earns his card.
const isMoment = (p) => {
  const pr = p.presentation;
  return pr.touchdown || pr.turnover || pr.type === "sack" || pr.yards >= RULES.EXPLOSIVE_YARDS
    || (p.down === 4 && (pr.firstDown || pr.touchdown)) || (p.down === 3 && p.distance >= 7 && pr.firstDown);
};

function playerCandidates(env, p, i, a, b) {
  const { game, plays, state, statsLib } = env;
  const out = [];
  const aBy = statsBy(a), bBy = statsBy(b);
  const leaders = statsLib.gameLeaders(a, 1);
  for (const [role, pl, side] of rolesOf(p)) {
    if (!pl?.name || !side) continue;
    const key = pkOf(pl, side);
    const la = aBy.get(key), lb = bBy.get(key);
    if (!la) continue;
    const ctx = pl.cfbdId ? state.players[pl.cfbdId] || null : null;
    const P = ctx?.prior || null;
    const cat = ROLE_CAT[role];
    const firstTd = p.presentation.touchdown && (la.stats[cat]?.td || 0) === 1;
    const facts = playerFacts(role, la.stats, lb?.stats || {}, P, { plays, i, key, play: p, isFirstTdTonight: firstTd })
      .filter((f) => !state.facts.includes(`${key}:${f.key}`));
    const wd = ctx?.wd || null;
    // (A quarterback's card is about his passing — not a scramble.)
    const qbRun = role === "rusher" && /QB/.test(ctx?.pos || "");
    // An ungraded prospect with no class rank has no hook of his own — his
    // card (still We-Draft styled) needs a real fact from the play to make it.
    const wdNew = wd && (wd.gradeAvg != null || wd.classRank) && !state.facts.includes(`${key}:wdIntro`) && isMoment(p) && !qbRun;
    if (wdNew) {
      const g = wd.gradeAvg;
      facts.push({ key: "wdIntro", text: wdIntroText(wd), score: 56 + (g != null && g <= 3 ? 10 : g != null && g <= 5 ? 5 : 0) + (wd.classRank && wd.classRank <= 10 ? 5 : 0), milestone: false, wd: true });
    }
    if (!facts.length) continue;
    facts.sort((x, y) => y.score - x.score);
    const primary = facts[0];
    const leader = (leaders[cat === "defense" ? "defense" : cat] || [])[0]?.id === key;
    const t = game[side] || {};
    const extra = [];
    const second = facts.find((f) => f !== primary && !f.wd);
    // The grade / class rank live in the card's We-Draft panel — never
    // repeated as the sentence. When they're the reason for the card, the
    // sentence is the next real fact (or there is none).
    const context = primary.wd ? second?.text || null : primary.text;
    if (second && second.text !== context) extra.push(second.text);
    // (Not under a "first … of the season" fact — it would just repeat it.)
    const sl = [primary, primary.wd ? second : null].some((f) => f && /First$/.test(f.key)) ? null : seasonLine(role, P, la.stats[cat === "defense" ? "defense" : cat]);
    if (sl) extra.push(sl);
    const rl = rankLine(role, ctx?.ranks);
    if (rl && extra.length < 3) extra.push(rl);
    out.push({
      kind: "player",
      key: `${key}:${primary.key}`,
      factKeys: [primary, second].filter(Boolean).map((f) => `${key}:${f.key}`).concat(wd ? [`${key}:wdIntro`] : []),
      subject: `p:${key}`,
      family: `p:${key}:${cat}`,
      score: primary.score + (wd ? 4 : 0) + (leader ? 4 : 0),
      milestone: primary.milestone,
      leader,
      category: wd ? "wedraft" : primary.milestone ? "milestone" : "player_trend",
      side,
      card: {
        title: pl.name,
        subtitle: [ctx?.pos, teamName(t)].filter(Boolean).join(" • "),
        statLine: statsLib.statLine(cat, la.stats[cat]) || null,
        context,
        extra,
        player: { name: pl.name, cfbdId: pl.cfbdId || null, slug: wd?.slug || pl.wedraftSlug || null },
        wd: wd ? { grade: wd.grade, cls: wd.cls, classRank: wd.classRank, strengths: wd.strengths.slice(0, 3), pos: wd.pos } : null,
      },
    });
  }
  return out;
}

function teamCandidates(env, p, i, a, b) {
  const { game, plays, ranks } = env;
  const out = [];
  const pr = p.presentation;
  const off = p.offense, def = other(off);
  if (!off) return out;
  const T = (s) => game[s] || {};

  // Third down.
  if (p.down === 3 && SCRIMMAGE.has(pr.type)) {
    const [c, att] = a.teams[off].third;
    const conv = !!(pr.firstDown || pr.touchdown);
    const seq = thirdDowns(plays, i, off);
    let fails = 0;
    for (let k = seq.length - 1; k >= 0 && !seq[k]; k--) fails++;
    const r = ranks?.byId.get(T(off).providerTeamId);
    const kick = Date.parse(game.startDate || "") || 0;
    const rankOk = r && ranks.updatedAt && ranks.updatedAt < kick;
    const rankNote = (() => {
      const n = rankOk ? Number(String(r.r?.thirdPct || "").replace("T-", "")) : null;
      return n && (n <= 20 || n >= 110) ? `Came in ${String(r.r.thirdPct).startsWith("T-") ? "tied for " : ""}${ord(n)} in FBS on third down (${r.v.thirdPct}%)` : null;
    })();
    if (conv && att >= 6 && c / att >= 0.6) {
      out.push({
        kind: "team", key: `third:${off}:${c}`, subject: `t:${off}`, family: `third:${off}`, category: "team_trend", side: off,
        score: 50 + (p.distance >= 8 ? 10 : 0) + (c / att >= 0.7 ? 4 : 0),
        card: { title: teamName(T(off)), context: `${p.distance >= 7 ? `Converts 3rd & ${p.distance} — ` : ""}${teamName(T(off))} is now ${c}/${att} on third down tonight`, statLine: `3RD DOWN ${c}/${att}`, extra: rankNote ? [rankNote] : [] },
      });
    }
    if (!conv && att >= 5 && fails >= 4) {
      out.push({
        kind: "team", key: `third:${off}:f${att}`, subject: `t:${off}`, family: `third:${off}`, category: "team_trend", side: def,
        score: 52 + 4 * (fails - 4) + (c === 0 ? 4 : 0),
        card: { title: teamName(T(def)), context: c === 0 ? `${teamName(T(off))} is 0-for-${att} on third down tonight` : `${teamName(T(off))} has failed on its last ${fails} third-down attempts`, statLine: `${teamShort(T(off))} 3RD DOWN ${c}/${att}`, extra: rankNote ? [rankNote] : [] },
      });
    }
  }

  // Sacks by the defense.
  if (pr.type === "sack") {
    const n = a.teams[off].sacked;
    if (n >= 3 && n > b.teams[off].sacked) {
      out.push({
        kind: "team", key: `sacks:${def}:${n}`, subject: `t:${def}`, family: `sacks:${def}`, category: "team_trend", side: def,
        score: 50 + 7 * (n - 3),
        card: { title: teamName(T(def)), context: `That's ${teamName(T(def))}'s ${ord(n)} sack tonight`, statLine: `${n} SACKS · ${a.teams[off].sackYds} YDS`, extra: [] },
      });
    }
  }

  // Takeaways.
  if (pr.turnover) {
    const credit = pr.creditSide || def;
    const lost = other(credit);
    const n = a.teams[lost].turnovers;
    if (n >= 2 && n > b.teams[lost].turnovers) {
      const margin = n - a.teams[credit].turnovers;
      out.push({
        kind: "team", key: `take:${credit}:${n}`, subject: `t:${credit}`, family: `take:${credit}`, category: "team_trend", side: credit,
        score: 56 + 8 * (n - 2),
        card: { title: teamName(T(credit)), context: `${teamName(T(credit))}'s ${ord(n)} takeaway tonight`, statLine: `TURNOVER MARGIN ${margin > 0 ? "+" : ""}${margin}`, extra: [] },
      });
    }
  }

  // Explosive plays.
  if ((pr.type === "pass" || pr.type === "rush") && pr.yards >= RULES.EXPLOSIVE_YARDS) {
    const n = explosives(plays, i, { side: off });
    const m = explosives(plays, i, { side: def });
    if (n >= 5 && n - m >= 3) {
      out.push({
        kind: "team", key: `exp:${off}:${n}`, subject: `t:${off}`, family: `exp:${off}`, category: "team_trend", side: off,
        score: 48 + 3 * (n - 5),
        card: { title: teamName(T(off)), context: `${teamName(T(off))}'s ${ord(n)} play of 20+ yards tonight`, statLine: `20+ YD PLAYS ${n}–${m}`, extra: [`${teamName(T(def))} has ${m}`] },
      });
    }
  }

  // Second-half dominance (game trend).
  if ((p.period || 0) >= 3 && SCRIMMAGE.has(pr.type) && (pr.yards || 0) >= 10) {
    const half = env.statsLib.computeGameStats(plays.slice(0, i + 1).filter((x) => (x.period || 0) >= 3));
    const s = half.teams[off].totalYds, o = half.teams[def].totalYds;
    const firstQ3 = plays.findIndex((x) => (x.period || 0) >= 3);
    const atHalf = scoreAt(plays, Math.max(0, firstQ3 - 1));
    const closeAtHalf = Math.abs(atHalf.home - atHalf.away) <= 17;
    if (closeAtHalf && s >= 150 && s - o >= 120 && s >= 3 * Math.max(o, 1)) {
      const sc = scoreAt(plays, i);
      const lead = sc[off] - sc[def];
      out.push({
        kind: "game", key: `dom:${off}`, subject: `t:${off}`, family: `dom:${off}`, category: "game_trend", side: off,
        score: 58 + (lead > 0 && lead <= 14 ? 4 : 0),
        card: { headline: lead > 0 ? `${teamName(T(off))} has taken control` : `${teamName(T(off))} is surging`, title: teamName(T(off)), context: `${teamName(T(off))} has outgained ${teamName(T(def))} ${s}${o < 0 ? " to " : "–"}${o} since halftime`, statLine: null, extra: [] },
      });
    }
  }
  return out;
}

// A score's run context, once the score has settled (a TD's try is in).
function runCandidate(env, i, settled, side) {
  const { game, plays } = env;
  const run = scoringRun(plays, i, side, settled);
  if (run.points < 14) return null;
  const opp = other(side);
  // A run means something when the other team had scored and the game was
  // still a game when it started — not a shutout's running score.
  if (!(run.start[opp] > 0) || run.start[side] - run.start[opp] > 14) return null;
  const lead = settled[side] - settled[opp];
  // One card per touchdown's worth of run (14, 21, 28...): a field goal
  // that stretches 14 to 17 isn't a new story. Only the first says "flipped".
  const step = Math.floor((run.points - 14) / 7);
  const flipped = run.trailedAtStart && lead > 0 && step === 0;
  const T = (s) => game[s] || {};
  return {
    kind: "game", key: `run:${side}:${run.start.home}-${run.start.away}:${step}`, subject: `t:${side}`, family: `run:${side}`, category: "game_trend", side,
    score: 56 + (run.points - 14) * 1.2 + (flipped ? 12 : 0) + (lead >= 17 ? 4 : 0),
    card: {
      headline: flipped ? `${teamName(T(side))} has flipped it` : lead >= 14 ? `${teamName(T(side))} has taken control` : `${teamName(T(side))} is rolling`,
      title: teamName(T(side)),
      context: `${run.points} unanswered points for ${teamName(T(side))}`,
      statLine: null, // the score is on the play card right below
      extra: flipped ? [`Trailed ${run.start[opp]}–${run.start[side]} when the run started`] : [],
    },
  };
}

// ── Choosing (pure) ─────────────────────────────────────────────────────

function adjusted(c, state, idx) {
  if (state.shown.some((s) => s.key === c.key)) return -Infinity;
  let s = c.score;
  const last = state.shown[state.shown.length - 1];
  if (last && idx - last.idx < RULES.RECENT_PLAYS) s -= RULES.RECENT_PENALTY;
  if (state.shown.some((x) => x.subject === c.subject && idx - x.idx < RULES.SUBJECT_PLAYS)) s -= c.milestone ? RULES.SUBJECT_PENALTY_MILESTONE : RULES.SUBJECT_PENALTY;
  if (state.shown.some((x) => x.family === c.family && idx - x.idx < RULES.FAMILY_PLAYS)) s -= RULES.FAMILY_PENALTY;
  const before = state.shown.filter((x) => x.subject === c.subject).length;
  if (c.kind === "player" && before >= 1) s -= (c.leader ? RULES.STORY_PENALTY * RULES.STORY_LEADER_FACTOR : RULES.STORY_PENALTY) * before;
  if (last && last.category === c.category) s -= RULES.SAME_CATEGORY_PENALTY;
  if (!last || idx - last.idx >= RULES.QUIET_PLAYS) s += RULES.QUIET_BONUS;
  return s;
}

// Evaluate the targets (plays to look at now) against the state, returning
// the new insight objects. Mutates state (shown, facts).
function choose(env, targets) {
  const { plays, state, statsLib, game } = env;
  const made = [];
  const counted = [];
  plays.forEach((p, k) => { if (live(p) && COUNTED.has(p.presentation.type)) counted.push(k); });
  const idxOf = (i) => counted.filter((k) => k <= i).length;
  for (const t of targets) {
    if (made.length >= RULES.MAX_PER_RUN) break;
    const { i, mode } = t;
    const p = plays[i];
    const sc = scoreAt(plays, i);
    let cands = [];
    if (mode === "play") {
      const a = statsLib.computeGameStats(plays.slice(0, i + 1));
      const b = statsLib.computeGameStats(plays.slice(0, i));
      cands = [...playerCandidates(env, p, i, a, b), ...teamCandidates(env, p, i, a, b)];
    } else if (mode === "run") {
      const c = runCandidate(env, t.settledAt, t.settled, t.side);
      if (c) cands = [c];
    }
    if (!cands.length) continue;
    const rel = playRelevance(p, sc);
    const idx = idxOf(i);
    const ranked = cands.map((c) => ({ c, s: adjusted({ ...c, score: c.score + rel }, state, idx) })).sort((x, y) => y.s - x.s);
    const best = ranked[0];
    if (!(best.s >= RULES.THRESHOLD)) continue;
    if (made.length && best.c.score + rel < RULES.MAJOR) continue;
    const c = best.c;
    state.shown.push({ key: c.key, subject: c.subject, family: c.family, category: c.category, idx, playId: p.id });
    if (state.shown.length > 80) state.shown = state.shown.slice(-80);
    for (const f of c.factKeys || []) if (!state.facts.includes(f)) state.facts.push(f);
    const t2 = game[c.side] || {};
    made.push(JSON.parse(JSON.stringify({
      id: `${p.id}-${c.key}`.replace(/[^\w:-]/g, "_").slice(0, 120),
      sourcePlayId: p.id,
      sourceSeq: p.seq ?? null,
      period: p.period ?? null,
      clock: p.clock ?? null,
      kind: c.kind,
      category: c.category,
      milestone: !!c.milestone,
      side: c.side,
      teamName: teamShort(t2) || null,
      teamLogo: t2.logoBlack || t2.logoDark || t2.logo || null,
      teamColor: t2.color || null,
      score: Math.round(best.s),
      at: Date.now(),
      ...c.card,
    })));
  }
  return made;
}

// ── Entry point ─────────────────────────────────────────────────────────

const freshState = () => ({ v: 1, seen: [], shown: [], facts: [], players: {}, coverage: null, pending: [], insights: [] });

/**
 * Called by storePlays for a live game after its plays are stored.
 * ordered: the game's plays in game order, each with `presentation`.
 * rosters: { home, away } (cached CFBD rosters — positions).
 * Returns { added, total } or null when nothing changed.
 */
async function runInsights(db, game, ordered, { rosters } = {}) {
  const gid = String(game.providerGameId);
  const stateRef = db.collection("liveGames").doc(gid).collection("private").doc("insights");
  const state = { ...freshState(), ...((await stateRef.get()).data() || {}) };
  const res = await evaluate(db, game, ordered, state, { rosters });
  if (!res) return null;
  await stateRef.set(JSON.parse(JSON.stringify(state)));
  if (res.changed) {
    await db.collection("liveGames").doc(gid).set({ insights: res.insights, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { added: res.made.length, total: res.insights.length, made: res.made, insights: res.insights };
}

// One pass over the game's new plays: loads whatever context it needs
// (reads only), picks the insights, and updates `state` in place. No writes
// — runInsights persists the result (scripts/replayInsights.js replays real
// games through this directly).
async function evaluate(db, game, ordered, state, { rosters } = {}) {
  const plays = ordered.filter(live);
  const seen = new Set(state.seen);
  let fresh = plays.map((p, i) => ({ p, i })).filter(({ p }) => !seen.has(p.id));
  if (!fresh.length && !state.pending.length) return null;

  // First look at a game already under way: only the newest plays count.
  if (!state.seen.length && plays.length > RULES.MAX_EVAL) fresh = fresh.slice(-3);
  else fresh = fresh.slice(-RULES.MAX_EVAL);

  const statsLib = await import("../../src/utils/liveStats.mjs");

  // Season coverage for both teams (once per game).
  if (!state.coverage) {
    const [home, away] = await Promise.all([teamCoverage(db, game, "home"), teamCoverage(db, game, "away")]);
    state.coverage = { home, away };
  }
  // Context for every player on the plays being evaluated (once per player).
  const need = new Map();
  for (const { p } of fresh) {
    if (p.presentation.nullified) continue;
    for (const [, pl, side] of rolesOf(p)) if (pl?.cfbdId && !(pl.cfbdId in state.players)) need.set(pl.cfbdId, side);
  }
  if (need.size) {
    const grades = await gradeSnapshots(db);
    const posOf = new Map([...(rosters?.home || []), ...(rosters?.away || [])].map((r) => [r.id, r]));
    await Promise.all([...need].map(async ([id, side]) => {
      try { state.players[id] = await loadPlayer(db, id, game, side, state.coverage[side], posOf.get(id), grades); }
      catch (e) { state.players[id] = null; }
    }));
  }
  const ranks = await teamRanks(db).catch(() => null);
  const env = { game, plays, state, statsLib, ranks };

  // Targets, in game order: the new plays, plus scoring runs for touchdowns
  // whose try has now come in (the score is settled).
  const targets = [];
  const pending = [];
  const settleRun = (p, i) => {
    const after = plays[i + 1];
    if (!after) return false;
    const settled = { home: after.homeScore ?? p.homeScore ?? 0, away: after.awayScore ?? p.awayScore ?? 0 };
    const prev = scoreAt(plays, i - 1);
    const side = settled.home - prev.home > settled.away - prev.away ? "home" : "away";
    targets.push({ i, mode: "run", settledAt: i + 1, settled, side });
    return true;
  };
  for (const id of state.pending) {
    const i = plays.findIndex((p) => p.id === id);
    if (i >= 0 && realPlay(plays[i]) && !settleRun(plays[i], i)) pending.push(id);
  }
  for (const { p, i } of fresh) {
    if (!realPlay(p)) continue;
    targets.push({ i, mode: "play" });
    const pr = p.presentation;
    const scored = p.scoring && (pr.touchdown || pr.type === "field_goal" || pr.type === "safety");
    if (scored) {
      if (pr.touchdown && !settleRun(p, i)) pending.push(p.id);
      else if (!pr.touchdown) {
        const prev = scoreAt(plays, i - 1);
        const now = scoreAt(plays, i);
        targets.push({ i, mode: "run", settledAt: i, settled: now, side: now.home - prev.home > now.away - prev.away ? "home" : "away" });
      }
    }
  }
  targets.sort((x, y) => x.i - y.i);

  const made = choose(env, targets);

  // Cards whose play was since wiped out (a flag) or pulled are dropped.
  const valid = new Set(plays.filter(realPlay).map((p) => p.id));
  const kept = (state.insights || []).filter((x) => valid.has(x.sourcePlayId));
  const insights = [...kept, ...made].slice(-RULES.MAX_STORED);
  const changed = made.length > 0 || kept.length !== (state.insights || []).length;

  state.seen = plays.map((p) => p.id);
  state.pending = pending;
  state.insights = insights;
  return { made, insights, changed };
}

module.exports = { RULES, runInsights, evaluate, choose, freshState, loadPlayer, teamCoverage, gradeSnapshots, teamRanks, rolesOf, live, realPlay };
