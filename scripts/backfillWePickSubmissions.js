// scripts/backfillWePickSubmissions.js
//
// One-off: find users whose picks already meet the Ranked 6 qualification
// bar (same isRankedQualified spec gradeWePickWeek.js uses) but have no
// matching wePickSubmissions/{week}/entries/{uid} doc — i.e. exactly what
// WePickHub.js's new auto-lock-in effect would have written for them had
// they loaded the page after that change shipped. Grading itself (see
// gradeWePickWeek.js) reads straight from schedule26/{id}/picks and never
// touches wePickSubmissions, so this is purely a UI-consistency backfill
// (the "✓ locked in" badge, friends' submitted list) — it does not change
// anyone's score.
//
// Usage: node scripts/backfillWePickSubmissions.js        (dry run, reports only)
//        node scripts/backfillWePickSubmissions.js --write (actually writes)
const { getFirestore } = require("./firebaseAdmin");
const { FieldValue } = require("firebase-admin/firestore");

const SUBMISSIONS_COLLECTION = "wePickSubmissions";
const WRITE = process.argv.includes("--write");

const hasScorePick = (p) => !!p && p.awayScore != null && p.homeScore != null;

function isRankedQualified(rankedGames, week) {
  const total = rankedGames.length;
  if (week === "Week 0") return total === 6;
  const gotwCount = rankedGames.filter((g) => g.GameOfWeek).length;
  const featuredCount = rankedGames.filter((g) => g.Featured).length;
  return total === 6 && gotwCount >= 1 && featuredCount >= 2;
}

async function run() {
  const db = getFirestore();

  const scheduleSnap = await db.collection("schedule26").get();
  const gamesByWeek = new Map();
  scheduleSnap.forEach((d) => {
    const g = { id: d.id, ...d.data() };
    if (!g.Week) return;
    if (!gamesByWeek.has(g.Week)) gamesByWeek.set(g.Week, []);
    gamesByWeek.get(g.Week).push(g);
  });

  const usernameCache = new Map();
  const getUsername = async (uid) => {
    if (usernameCache.has(uid)) return usernameCache.get(uid);
    const snap = await db.collection("users").doc(uid).get();
    const name = (snap.exists && snap.data().username || "").trim() || "Anonymous Fan";
    usernameCache.set(uid, name);
    return name;
  };

  let totalQualified = 0;
  let totalMissingOrStale = 0;
  const toWrite = [];

  for (const [week, games] of gamesByWeek) {
    const pickSnaps = await Promise.all(
      games.map((g) => db.collection("schedule26").doc(g.id).collection("picks").get())
    );
    const byUid = new Map();
    games.forEach((game, i) => {
      pickSnaps[i].forEach((snap) => {
        const uid = snap.id;
        const pick = snap.data();
        if (!byUid.has(uid)) byUid.set(uid, []);
        byUid.get(uid).push({ pick, game });
      });
    });

    for (const [uid, rows] of byUid) {
      const rankedRows = rows.filter((r) => r.pick?.ranked === true && hasScorePick(r.pick) && !r.game.RankedDisqualified);
      const rankedGames = rankedRows.map((r) => r.game);
      if (!isRankedQualified(rankedGames, week)) continue;
      totalQualified++;

      const gameIds = rankedGames.map((g) => g.id).sort();
      const predictions = {};
      rankedRows.forEach(({ pick, game }) => {
        predictions[game.id] = { awayScore: pick.awayScore, homeScore: pick.homeScore };
      });

      const subSnap = await db.collection(SUBMISSIONS_COLLECTION).doc(week).collection("entries").doc(uid).get();
      const existing = subSnap.exists ? subSnap.data() : null;
      const existingIds = (existing?.gameIds || []).slice().sort();
      const idsMatch = gameIds.length === existingIds.length && gameIds.every((id, i) => id === existingIds[i]);
      const predictionsMatch = idsMatch && gameIds.every((id) => {
        const submitted = existing?.predictions?.[id];
        return !!submitted && predictions[id].awayScore === submitted.awayScore && predictions[id].homeScore === submitted.homeScore;
      });

      if (idsMatch && predictionsMatch) continue; // already correctly locked in

      totalMissingOrStale++;
      const displayName = await getUsername(uid);
      console.log(`${existing ? "STALE " : "MISSING"} ${week} — ${displayName} (${uid}): ${gameIds.length} ranked games`);
      toWrite.push({ week, uid, payload: { uid, displayName, week, gameIds, predictions, submittedAt: FieldValue.serverTimestamp() } });
    }
  }

  console.log(`\n${totalQualified} qualified (week, user) pair(s) found across ${gamesByWeek.size} week(s); ${totalMissingOrStale} missing or stale submission doc(s).`);

  if (!WRITE) {
    console.log(toWrite.length > 0 ? "\nDry run — rerun with --write to lock these in." : "\nNothing to fix.");
    return;
  }

  for (const { week, uid, payload } of toWrite) {
    await db.collection(SUBMISSIONS_COLLECTION).doc(week).collection("entries").doc(uid).set(payload);
  }
  console.log(`\nWrote ${toWrite.length} submission doc(s).`);
}

run().catch((e) => { console.error(e); process.exit(1); });
