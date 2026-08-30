// scripts/gradeWePickWeek.js
//
// The "trusted process" wePickStandings2026's own firestore.rules comment
// refers to — runs weekly (see .github/workflows/grade-wepick.yml, Sunday
// mornings) via the Admin SDK, which bypasses security rules entirely, so
// none of the client-only restrictions on those collections apply here.
//
// For every schedule26 week where every game has actually gone Final and
// that hasn't already been graded (wePickStandings2026/{week}.graded — the
// idempotency guard that makes reruns/missed-Sunday catch-up safe, since a
// second run over an already-graded week is a costly no-op, never a
// double-count), this:
//   1. Reads that week's picks across every game (schedule26/{id}/picks is
//      public-read specifically so this kind of client- or script-side
//      aggregation is possible — see its own rules comment).
//   2. Computes each participant's Ranked 6 result using the *exact* same
//      scoring formula WePickHub.js's own scoreGamePick/isRankedQualified
//      use for live display — duplicated here rather than imported since
//      this runs in plain Node with no React/browser dependency (same
//      "small pure helper duplicated with a pointer back" tradeoff
//      AdminPanel.js's toHsSlug already makes elsewhere in this codebase).
//      If the scoring spec ever changes, both copies need updating.
//   3. Writes wePickStandings2026/{week}.entries (only qualified
//      participants — falling short zeroes a week for standings purposes,
//      same as not having played it, per that formula's own spec comment).
//   4. Increments four badge counters on each earning user's own
//      users/{uid}/wePickStats/season2026 doc:
//        - sweepCount      — Ranked 6 went 6-0 on the winner this week.
//        - snipeCount      — any single graded pick (ranked or not) matched
//                            the final score exactly; can fire more than
//                            once in the same week.
//        - topDogCount     — tied or outright highest qualified Ranked
//                            score in the community this week.
//        - immaculateCount — every one of the Ranked 6 matched its final
//                            score exactly (implies sweepCount too).
// Once at least one week was newly graded, wePickStandings2026/season is
// fully recomputed from every graded week's entries (a plain sum, not an
// incremental merge — simpler to reason about and self-healing if a past
// week's entries were ever hand-corrected).
//
// Exports `runGrading()` so this can be called two ways, same convention as
// scripts/syncGoogleAnalytics.js:
//   1. Directly as a CLI script:  node scripts/gradeWePickWeek.js
//   2. Required as a module, if an admin-triggered "Grade Now" button ever
//      wants the identical code path a scheduled run uses.

const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const STANDINGS_COLLECTION = "wePickStandings2026";
const SEASON_DOC = "season";
const MYSTATS_COLLECTION = "wePickStats";
const MYSTATS_SEASON_DOC = "season2026";
const FIRESTORE_BATCH_LIMIT = 500; // Firestore's hard cap on ops per batch

// ── Duplicated scoring helpers — see this file's own header comment for why
// these aren't imported from WePickHub.js. Keep in sync with that file's
// isGameFinal/hasScorePick/pickedSideOf/scoreGamePick/rankedStatus. ──
const isGameFinal = (g) => g.Final && g.HomeScore != null && g.AwayScore != null;
const hasScorePick = (p) => !!p && p.awayScore != null && p.homeScore != null;

const pickedSideOf = (p) => {
  if (p.pickedTeam === "away" || p.pickedTeam === "home") return p.pickedTeam;
  if (p.awayScore == null || p.homeScore == null) return null;
  if (p.awayScore > p.homeScore) return "away";
  if (p.homeScore > p.awayScore) return "home";
  return null;
};

function scoreGamePick(pick, game) {
  if (!game || !isGameFinal(game) || !hasScorePick(pick)) return 0;
  const side = pickedSideOf(pick);
  const actualWinner = game.AwayScore > game.HomeScore ? "away" : game.HomeScore > game.AwayScore ? "home" : null;
  if (!actualWinner || side !== actualWinner) return 0;
  const awayAcc = Math.max(0, 100 - 10 * Math.abs(game.AwayScore - pick.awayScore));
  const homeAcc = Math.max(0, 100 - 10 * Math.abs(game.HomeScore - pick.homeScore));
  return 100 + awayAcc + homeAcc;
}

// total === 6, not >= 6 — see WePickHub.js's own rankedStatus (this file's
// copy of that same qualification rule) for why: the client-side "can't
// star a 7th" guard is bypassable by a direct write, and until this was
// `=== 6` every extra ranked game beyond 6 still had its points summed
// into the week's total below, since `total >= 6` never noticed. `=== 6`
// zeroes the whole week for anyone who somehow has more than 6, removing
// any upside from a bypass.
function isRankedQualified(rankedGames, week) {
  const total = rankedGames.length;
  if (week === "Week 0") return total === 6;
  const gotwCount = rankedGames.filter((g) => g.GameOfWeek).length;
  const featuredCount = rankedGames.filter((g) => g.Featured).length;
  return total === 6 && gotwCount >= 1 && featuredCount >= 2;
}

// ── Grades one already-confirmed-all-Final week: fetches its picks, scores
// every participant, writes the week's standings doc, and increments badge
// counters. Returns a small summary for the CLI log. ──
async function gradeWeek(db, week, games) {
  const pickSnaps = await Promise.all(
    games.map((g) => db.collection("schedule26").doc(g.id).collection("picks").get())
  );

  const byUid = new Map(); // uid -> [{ pick, game }]
  games.forEach((game, i) => {
    pickSnaps[i].forEach((snap) => {
      const uid = snap.id;
      const pick = snap.data();
      if (!byUid.has(uid)) byUid.set(uid, []);
      byUid.get(uid).push({ pick, game });
    });
  });

  const uids = [...byUid.keys()];
  const userSnaps = await Promise.all(uids.map((uid) => db.collection("users").doc(uid).get()));
  const usernameByUid = {};
  userSnaps.forEach((snap, i) => {
    usernameByUid[uids[i]] = snap.exists ? (snap.data().username || "").trim() : "";
  });

  const badgeDeltas = new Map(); // uid -> { sweep, snipe, topDog, immaculate }
  const bump = (uid, key, n = 1) => {
    if (!badgeDeltas.has(uid)) badgeDeltas.set(uid, { sweep: 0, snipe: 0, topDog: 0, immaculate: 0 });
    badgeDeltas.get(uid)[key] += n;
  };

  const entries = [];
  let maxPoints = null;

  for (const [uid, rows] of byUid) {
    // Snipe — any perfect-score graded pick this week, ranked or not; can
    // fire more than once per week if more than one game was nailed exactly.
    rows.forEach(({ pick, game }) => {
      if (hasScorePick(pick) && scoreGamePick(pick, game) === 300) bump(uid, "snipe");
    });

    const rankedRows = rows.filter((r) => r.pick?.ranked === true && hasScorePick(r.pick) && !r.game.RankedDisqualified);
    if (!isRankedQualified(rankedRows.map((r) => r.game), week)) continue; // unqualified = didn't play, for standings purposes

    let points = 0;
    let correct = 0;
    let diffTotal = 0;
    let allPerfect = rankedRows.length === 6;
    rankedRows.forEach(({ pick, game }) => {
      const p = scoreGamePick(pick, game);
      points += p;
      if (p > 0) correct++;
      if (p !== 300) allPerfect = false;
      diffTotal += Math.abs(game.AwayScore - pick.awayScore) + Math.abs(game.HomeScore - pick.homeScore);
    });

    entries.push({ uid, displayName: usernameByUid[uid] || "Anonymous Fan", correct, total: rankedRows.length, points, diffTotal });
    if (rankedRows.length === 6 && correct === 6) bump(uid, "sweep");
    if (allPerfect) bump(uid, "immaculate");
    if (maxPoints === null || points > maxPoints) maxPoints = points;
  }

  // Top Dog — every qualified entry tied for the week's highest score, not
  // just a single "winner" (a literal reading of "highest community score",
  // ties included).
  if (maxPoints !== null) {
    entries.forEach((e) => { if (e.points === maxPoints) bump(e.uid, "topDog"); });
  }

  await db.collection(STANDINGS_COLLECTION).doc(week).set({
    entries,
    graded: true,
    gradedAt: FieldValue.serverTimestamp(),
  });

  const badgeEntries = [...badgeDeltas.entries()].filter(([, d]) => d.sweep || d.snipe || d.topDog || d.immaculate);
  for (let i = 0; i < badgeEntries.length; i += FIRESTORE_BATCH_LIMIT) {
    const batch = db.batch();
    badgeEntries.slice(i, i + FIRESTORE_BATCH_LIMIT).forEach(([uid, d]) => {
      const ref = db.collection("users").doc(uid).collection(MYSTATS_COLLECTION).doc(MYSTATS_SEASON_DOC);
      const inc = {};
      if (d.sweep) inc.sweepCount = FieldValue.increment(d.sweep);
      if (d.snipe) inc.snipeCount = FieldValue.increment(d.snipe);
      if (d.topDog) inc.topDogCount = FieldValue.increment(d.topDog);
      if (d.immaculate) inc.immaculateCount = FieldValue.increment(d.immaculate);
      batch.set(ref, inc, { merge: true });
    });
    await batch.commit();
  }

  return { participants: uids.length, qualified: entries.length, topDogPoints: maxPoints, badgesAwarded: badgeEntries.length };
}

// ── Sums every graded week's entries into wePickStandings2026/season — a
// fresh full recompute each time rather than an incremental merge, so a
// hand-corrected past week (or a rerun) can never leave the season total
// out of sync with what the per-week docs actually say. ──
async function recomputeSeasonStandings(db) {
  const snap = await db.collection(STANDINGS_COLLECTION).get();
  const totals = new Map(); // uid -> aggregate entry

  snap.forEach((docSnap) => {
    if (docSnap.id === SEASON_DOC) return;
    const data = docSnap.data();
    if (!data?.graded || !Array.isArray(data.entries)) return;
    data.entries.forEach((e) => {
      if (!totals.has(e.uid)) {
        totals.set(e.uid, { uid: e.uid, displayName: e.displayName, points: 0, correct: 0, total: 0, diffTotal: 0, weeksPlayed: 0 });
      }
      const t = totals.get(e.uid);
      t.displayName = e.displayName || t.displayName;
      t.points += e.points || 0;
      t.correct += e.correct || 0;
      t.total += e.total || 0;
      t.diffTotal += e.diffTotal || 0;
      t.weeksPlayed += 1;
    });
  });

  await db.collection(STANDINGS_COLLECTION).doc(SEASON_DOC).set({
    entries: [...totals.values()],
    graded: true,
    gradedAt: FieldValue.serverTimestamp(),
  });
}

// ── The actual run, callable from anywhere (CLI or a future admin trigger).
// Always returns a plain summary rather than throwing on a single week's
// failure blowing up the whole run — see the per-week try/catch below. ──
async function runGrading() {
  const startedAt = Date.now();
  const db = getFirestore();

  const gamesSnap = await db.collection("schedule26").get();
  const allGames = gamesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const byWeek = new Map();
  allGames.forEach((g) => {
    if (!g.Week) return;
    if (!byWeek.has(g.Week)) byWeek.set(g.Week, []);
    byWeek.get(g.Week).push(g);
  });

  const standingsSnap = await db.collection(STANDINGS_COLLECTION).get();
  const alreadyGraded = new Set();
  standingsSnap.forEach((d) => { if (d.id !== SEASON_DOC && d.data()?.graded) alreadyGraded.add(d.id); });

  const results = [];
  for (const [week, games] of byWeek) {
    if (alreadyGraded.has(week)) continue;
    if (!games.every((g) => isGameFinal(g))) continue; // not fully final yet — try again next run
    try {
      const summary = await gradeWeek(db, week, games);
      results.push({ week, ...summary });
    } catch (e) {
      console.error(`❌ Failed grading ${week}:`, e.message);
    }
  }

  if (results.length > 0) {
    await recomputeSeasonStandings(db);
  }

  return {
    ok: true,
    weeksGraded: results,
    durationMs: Date.now() - startedAt,
  };
}

// ── CLI entry point — only runs when this file is executed directly
// (`node scripts/gradeWePickWeek.js`), not when required as a module. ──
if (require.main === module) {
  runGrading()
    .then((result) => {
      console.log("✅ We-Pick grading complete");
      if (result.weeksGraded.length === 0) {
        console.log("   Nothing new to grade — no fully-Final ungraded week found.");
      } else {
        result.weeksGraded.forEach((w) => {
          console.log(`   ${w.week}: ${w.qualified}/${w.participants} qualified, top score ${w.topDogPoints ?? "—"}, ${w.badgesAwarded} user(s) earned a badge`);
        });
      }
      console.log("   Duration: " + result.durationMs + "ms");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ We-Pick grading failed:", err.message);
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runGrading, scoreGamePick, isRankedQualified };
