// server/live/scheduleSync.js
//
// Writes provider data back onto schedule26 — kickoff times and final
// scores — so the schedule, game pages and We-Pick (pick locking via
// KickoffAt in firestore.rules, Sunday grading in scripts/gradeWePickWeek.js,
// which only needs Final/HomeScore/AwayScore) run without an admin typing
// anything in. Takes NORMALIZED games (server/live/provider.js), so it's
// provider-agnostic.
//
// Ownership, per field group, recorded on the schedule26 doc:
//   KickoffSource: "cfbd" | "manual"   — Date / Time / KickoffAt
//   ScoreSource:   "cfbd" | "manual"   — HomeScore / AwayScore / Final
// Automation writes only when the group isn't "manual". AdminPanel.js's CFB
// Schedule save marks a group "manual" when an admin actually changes it,
// so a hand correction always wins. Games an admin finalized before this
// existed (Final with no ScoreSource) are treated as manual and left alone.
// Kickoff times entered by hand before this existed are not — the
// provider's (TV-window) time replaces them unless re-entered by an admin.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { etDateKey } = require("./mapping");

// "HH:MM" (24h) wall-clock time in America/New_York — schedule26.Time's format.
const etTime = (ms) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const h = parts.find((p) => p.type === "hour")?.value;
  const m = parts.find((p) => p.type === "minute")?.value;
  return h && m ? `${h}:${m}` : null;
};

const toMs = (ts) => (ts?.toMillis ? ts.toMillis() : ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);

// Same rules as src/utils/rankings.js (rankingsWeekKey / rankMapFromTop25):
// Week 0 shares Week 1's poll.
const rankingsWeekKey = (week) => {
  const w = (week || "").toString().trim();
  return w.toLowerCase() === "week 0" ? "Week 1" : w;
};

async function loadScheduleDocs(db, ids) {
  const byCfbdId = new Map();
  if (ids.length > 150) {
    const snap = await db.collection("schedule26").get();
    snap.docs.forEach((d) => { const id = d.data().CFBDGameId; if (id != null) byCfbdId.set(id, d); });
    return byCfbdId;
  }
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await db.collection("schedule26").where("CFBDGameId", "in", ids.slice(i, i + 30)).get();
    snap.docs.forEach((d) => byCfbdId.set(d.data().CFBDGameId, d));
  }
  return byCfbdId;
}

// Returns { kickoffs, finals, corrections, log: [...] }.
async function syncSchedule(db, games, { dryRun = false } = {}) {
  const ids = [...new Set(games.map((g) => g.providerGameId).filter((id) => id != null))];
  if (!ids.length) return { kickoffs: 0, finals: 0, corrections: 0, log: [] };
  const docs = await loadScheduleDocs(db, ids);
  const rankCache = new Map();
  const rankMapFor = async (week) => {
    const key = rankingsWeekKey(week);
    if (!key) return {};
    if (!rankCache.has(key)) {
      const snap = await db.collection("rankings").doc(key).get();
      const map = {};
      (snap.data()?.Top25 || []).forEach((e) => { if (e?.School && e?.Rank) map[e.School] = e.Rank; });
      rankCache.set(key, map);
    }
    return rankCache.get(key);
  };

  const updates = [];
  const log = [];
  let kickoffs = 0, finals = 0, corrections = 0;

  for (const g of games) {
    const d = docs.get(g.providerGameId);
    if (!d) continue;
    const s = d.data();
    const upd = {};
    const swapped = !!s.CFBDMatch?.swapped;

    // Kickoff — only a real (non-TBD) start time, and only for games not yet
    // played (a finished game's kickoff no longer matters to anything).
    if (s.KickoffSource !== "manual" && g.status !== "final" && g.startDate && g.startTimeTBD === false) {
      const startMs = Date.parse(g.startDate);
      if (Number.isFinite(startMs)) {
        const gameDay = etDateKey(startMs);
        const time = etTime(startMs);
        // schedule26.Date is the ET game day, stored at UTC midnight by the
        // admin form (older imported docs sit at 04:00/05:00Z — same day,
        // and every reader formats it in UTC). Compared by day, so Date is
        // only rewritten when the game actually moved to another day.
        const dayMoved = new Date(toMs(s.Date)).toISOString().slice(0, 10) !== gameDay;
        if (dayMoved || s.Time !== time || toMs(s.KickoffAt) !== startMs) {
          if (dayMoved) upd.Date = Timestamp.fromMillis(Date.parse(`${gameDay}T00:00:00Z`));
          upd.Time = time;
          upd.KickoffAt = Timestamp.fromMillis(startMs);
          upd.KickoffSource = "cfbd";
          kickoffs++;
          log.push(`kickoff ${s.Slug}: ${s.Time || "—"} → ${time}${dayMoved ? ` (moved to ${gameDay})` : ""}`);
        }
      }
    }

    // Final score.
    const homePts = (swapped ? g.away : g.home)?.points;
    const awayPts = (swapped ? g.home : g.away)?.points;
    const manualScore = s.ScoreSource === "manual" || (s.Final && !s.ScoreSource);
    if (!manualScore && g.status === "final" && homePts != null && awayPts != null) {
      if (!s.Final) {
        const ranks = await rankMapFor(s.Week);
        Object.assign(upd, {
          HomeScore: homePts, AwayScore: awayPts, Final: true, ScoreSource: "cfbd",
          // Frozen at finalization — same snapshot AdminPanel.js's save takes.
          HomeRank: ranks[s.Home] ?? null, AwayRank: ranks[s.Away] ?? null,
        });
        finals++;
        log.push(`final ${s.Slug}: ${s.Away} ${awayPts} – ${s.Home} ${homePts}`);
      } else if (s.HomeScore !== homePts || s.AwayScore !== awayPts) {
        Object.assign(upd, { HomeScore: homePts, AwayScore: awayPts });
        corrections++;
        log.push(`score correction ${s.Slug}: ${s.AwayScore}-${s.HomeScore} → ${awayPts}-${homePts}`);
      }
    }

    if (Object.keys(upd).length) updates.push({ ref: d.ref, upd: { ...upd, updatedAt: FieldValue.serverTimestamp() } });
  }

  if (!dryRun) {
    for (let i = 0; i < updates.length; i += 400) {
      const batch = db.batch();
      updates.slice(i, i + 400).forEach(({ ref, upd }) => batch.update(ref, upd));
      await batch.commit();
    }
  }
  return { kickoffs, finals, corrections, log };
}

module.exports = { syncSchedule, etTime };
