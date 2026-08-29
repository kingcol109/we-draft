// scripts/backfillKickoffAt.js
//
// One-time backfill: computes and writes `KickoffAt` (a real UTC Timestamp)
// onto every schedule26 doc that already has both Date and Time set but no
// KickoffAt yet. AdminPanel.js's CFBScheduleSection now writes this field
// itself going forward (see its own handleSave) — this just catches every
// game entered before that existed, so firestore.rules can enforce the
// pick-lock-at-kickoff check (schedule26/{id}/picks/{uid}) against every
// game, not only ones saved after this backfill ran.
//
// Same ET-wall-clock-to-UTC conversion as GamePage.js's kickoffMsFromDate /
// WePickHub.js's kickoffMs / AdminPanel.js's own copy — duplicated here
// per this codebase's small-helper convention (see gradeWePickWeek.js's own
// header comment for the same tradeoff).
//
// Run with: node scripts/backfillKickoffAt.js

const { getFirestore } = require("./firebaseAdmin");

const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};

const ET_OFFSET_FALLBACK_MIN = -300; // EST — only used if Intl's parse ever fails
const etOffsetMinutesAt = (ms) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(ms));
    const tz = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(tz);
    if (!m) return ET_OFFSET_FALLBACK_MIN;
    const h = parseInt(m[1], 10);
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    return h * 60 + (h < 0 ? -mins : mins);
  } catch {
    return ET_OFFSET_FALLBACK_MIN;
  }
};

const kickoffMsFromDate = (dateMs, time) => {
  const mins = timeToMinutes(time);
  if (!dateMs || mins == null) return null;
  return dateMs + mins * 60000 - etOffsetMinutesAt(dateMs) * 60000;
};

const toMs = (ts) => (ts?.toDate ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);

async function run() {
  const db = getFirestore();
  const snap = await db.collection("schedule26").get();

  let updated = 0, skippedHasIt = 0, skippedNoTime = 0;
  const batchSize = 400; // under Firestore's 500-op batch cap, leaving room
  let batch = db.batch();
  let opsInBatch = 0;

  for (const doc of snap.docs) {
    const g = doc.data();
    if (g.KickoffAt) { skippedHasIt++; continue; }
    const dateMs = toMs(g.Date);
    const kickoffMs = kickoffMsFromDate(dateMs, g.Time);
    if (kickoffMs == null) { skippedNoTime++; continue; }
    batch.update(doc.ref, { KickoffAt: new Date(kickoffMs) });
    opsInBatch++;
    updated++;
    if (opsInBatch >= batchSize) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  console.log(`KickoffAt backfill done: ${updated} updated, ${skippedHasIt} already had it, ${skippedNoTime} skipped (no Date/Time).`);
}

run().catch((e) => { console.error(e); process.exit(1); });
