// server/live/pickSummaries.js
//
// We-Pick community picks, summarized per game — wePickSummaries/{gameId}
// (gameId: the schedule26 doc id) — so a game page on /live reads one doc
// instead of every user's pick (schedule26/{id}/picks/{uid}), whose count
// grows with the user base. Run by the live ingester every
// CONFIG.PICK_SUMMARY_MS (ingest.js step 4d).
//
//   wePickSummaries/{id}         public: what the pages show
//     count        picks that call a winner (the split's total)
//     split        { away, home } — schedule26's orientation
//     scored       picks with a score; sum { away, home } for the average
//     scores       "away-home" → how many picked exactly that final
//     publicCount  public picks (with a side or a score)
//     recent       the newest RECENT public picks:
//                  [{ uid, name, away, home, side, ranked, prediction, verified, at }]
//     locked       built after kickoff — final, never rebuilt
//   wePickSummaries/{id}/private/index   server only (no rule matches it):
//     picks        uid → [side, away, home, public, ranked, atMs] per pick
//     recent       the public list above, kept for merging
//     verified     uid → users/{uid}.verified for the listed pickers —
//                  looked up fresh at each full build, kept between
//
// Which games: schedule26 games kicking off from 12 hours ago to 9 days
// out (the list refreshed hourly). Each run, per game:
//   - after kickoff, once: a full rebuild (picks lock at kickoff —
//     firestore.rules gameIsPickable — so that's final), then never again;
//   - else the picks changed since the last run (updatedAt), merged into
//     the index — one query, one read when nothing changed; a full rebuild
//     the first time and every FULL_MS (catches deleted picks).
// The run's bookkeeping lives on liveMeta/ingest.pickSummary (the state
// passed in and returned).
const { Timestamp } = require("firebase-admin/firestore");

const COLLECTION = "wePickSummaries";
const RECENT = 24;
const GAMES_MS = 60 * 60 * 1000;
const FULL_MS = 6 * 3600 * 1000;
const WINDOW = { back: 12 * 3600 * 1000, ahead: 9 * 86400 * 1000 };
const CHANGED_LIMIT = 1000;

const toMs = (v) => (v == null ? null : typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : Date.parse(v) || null);
// Same rule as src/utils/wePickScoring.js pickedSideOf / hasScorePick.
const sideOf = (p) => {
  if (p.pickedTeam === "away" || p.pickedTeam === "home") return p.pickedTeam;
  if (p.awayScore == null || p.homeScore == null) return null;
  return p.awayScore > p.homeScore ? "away" : p.homeScore > p.awayScore ? "home" : null;
};
const hasScore = (p) => p.awayScore != null && p.homeScore != null;
const isPublic = (p) => p.visibility !== "private" && (hasScore(p) || !!sideOf(p));

// A pick doc as the index keeps it, and as the public list shows it.
const compact = (p) => [sideOf(p), hasScore(p) ? p.awayScore : null, hasScore(p) ? p.homeScore : null, isPublic(p) ? 1 : 0, p.ranked === true ? 1 : 0, toMs(p.updatedAt) || 0];
const listed = (uid, p) => ({
  uid, name: p.displayName || "Anonymous Fan", side: sideOf(p),
  away: hasScore(p) ? p.awayScore : null, home: hasScore(p) ? p.homeScore : null,
  ranked: p.ranked === true, prediction: p.prediction ? String(p.prediction).slice(0, 280) : "", at: toMs(p.updatedAt) || 0,
});

// The public summary from the index.
function summarize(index, locked, verified) {
  const out = { count: 0, split: { away: 0, home: 0 }, scored: 0, sum: { away: 0, home: 0 }, scores: {}, publicCount: 0 };
  for (const [side, a, h, pub] of Object.values(index.picks)) {
    if (side) { out.count++; out.split[side]++; }
    if (a != null && h != null) {
      out.scored++; out.sum.away += a; out.sum.home += h;
      const k = `${a}-${h}`;
      out.scores[k] = (out.scores[k] || 0) + 1;
    }
    if (pub) out.publicCount++;
  }
  out.recent = index.recent.map((r) => ({ ...r, verified: !!verified[r.uid] }));
  out.locked = !!locked;
  return out;
}

async function lookUpVerified(db, uids, verified) {
  const missing = [...new Set(uids)].filter((u) => !(u in verified));
  if (!missing.length) return;
  const snaps = await db.getAll(...missing.map((u) => db.collection("users").doc(u)));
  snaps.forEach((s, i) => { verified[missing[i]] = !!(s.exists && s.data().verified); });
}

async function save(db, id, index, locked) {
  await lookUpVerified(db, index.recent.map((r) => r.uid), index.verified);
  const ref = db.collection(COLLECTION).doc(id);
  const batch = db.batch();
  batch.set(ref, { gameId: id, ...summarize(index, locked, index.verified), builtAt: Date.now() });
  batch.set(ref.collection("private").doc("index"), index);
  await batch.commit();
}

// Every pick, from scratch — verified badges looked up fresh too (someone
// verified since the last full build gets the badge).
async function fullBuild(db, id, locked) {
  const snap = await db.collection("schedule26").doc(id).collection("picks").get();
  const index = { picks: {}, recent: [], verified: {} };
  let at = 0;
  for (const d of snap.docs) {
    const p = d.data();
    index.picks[d.id] = compact(p);
    at = Math.max(at, toMs(p.updatedAt) || 0);
    if (isPublic(p)) index.recent.push(listed(d.id, p));
  }
  index.recent = index.recent.sort((a, b) => b.at - a.at).slice(0, RECENT);
  await save(db, id, index, locked);
  return { at, picks: snap.size };
}

// The picks changed since `since` (ms), merged in. null when none changed.
async function merge(db, id, since) {
  const picks = db.collection("schedule26").doc(id).collection("picks");
  const snap = await picks.where("updatedAt", ">", Timestamp.fromMillis(since)).orderBy("updatedAt").limit(CHANGED_LIMIT).get();
  if (snap.empty) return null;
  const ref = db.collection(COLLECTION).doc(id).collection("private").doc("index");
  const prev = await ref.get();
  if (!prev.exists) return null;
  const index = prev.data();
  index.picks ||= {};
  index.verified ||= {};
  let recent = (index.recent || []).filter((r) => !snap.docs.some((d) => d.id === r.uid));
  let at = since;
  for (const d of snap.docs) {
    const p = d.data();
    index.picks[d.id] = compact(p);
    at = Math.max(at, toMs(p.updatedAt) || 0);
    if (isPublic(p)) recent.push(listed(d.id, p));
  }
  index.recent = recent.sort((a, b) => b.at - a.at).slice(0, RECENT);
  await save(db, id, index, false);
  return { at, changed: snap.size };
}

// One run. state: { games: [{ id, k }], gamesAt, cur: { id: { at, full, locked } } }.
async function buildPickSummaries(db, { now = Date.now(), state = {}, outOfTime = () => false, log = () => {} } = {}) {
  let games = state.games || [];
  let gamesAt = state.gamesAt || 0;
  if (now - gamesAt >= GAMES_MS || !state.games) {
    const snap = await db.collection("schedule26")
      .where("KickoffAt", ">=", Timestamp.fromMillis(now - WINDOW.back))
      .where("KickoffAt", "<=", Timestamp.fromMillis(now + WINDOW.ahead))
      .select("KickoffAt").get();
    games = snap.docs.map((d) => ({ id: d.id, k: toMs(d.data().KickoffAt) }));
    gamesAt = now;
  }
  const prevCur = state.cur || {};
  const cur = {};
  const built = { full: 0, merged: 0 };
  for (const { id, k } of games) {
    const c = { ...(prevCur[id] || {}) };
    cur[id] = c;
    if (c.locked || outOfTime()) continue;
    const locked = k != null && now >= k;
    try {
      if (locked || !c.full || now - c.full >= FULL_MS || c.at == null) {
        const r = await fullBuild(db, id, locked);
        Object.assign(c, { at: r.at, full: now, locked });
        built.full++;
        if (locked) log(`pick summary ${id}: locked with ${r.picks} picks`);
      } else {
        const r = await merge(db, id, c.at);
        if (r) { c.at = r.at; built.merged++; }
      }
    } catch (e) {
      log(`pick summary ${id}: ${e.message.slice(0, 160)}`);
    }
  }
  return { state: { games, gamesAt, cur }, built };
}

module.exports = { buildPickSummaries, summarize, compact, sideOf, COLLECTION };
