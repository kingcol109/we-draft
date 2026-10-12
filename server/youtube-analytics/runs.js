// server/youtube-analytics/runs.js
//
// One sync run at a time. Every sync operation (videos, analytics, history)
// runs inside runOp(), which
//   - takes a lease on ytAnalytics/lock in a transaction — a second run
//     (another admin's click, a double click, the cron) gets a 409 while one
//     is in progress; a crashed run's lease expires after LEASE_MS, so a
//     stuck lock clears itself;
//   - records the run on ytAnalytics/status sync.<op>: state, trigger, counts,
//     errors, progress while it runs, and lastSuccessAt (kept from earlier
//     runs until this one completes);
//   - gives the operation a deadline so it stops cleanly before Vercel's
//     maxDuration and reports `more: true` instead of being killed.
// Error strings stored here are the same credential-free messages
// google.js produces.

const crypto = require("crypto");
const { httpError } = require("./google");

const LOCK = "ytAnalytics/lock";
const STATUS = "ytAnalytics/status";
const LEASE_MS = 330 * 1000; // > api/youtube-analytics.js maxDuration (300s)
const OPS = ["videos", "analytics", "history"];
const MAX_ERRORS = 25;

async function acquire(db, op, trigger, uid) {
  const ref = db.doc(LOCK);
  const runId = crypto.randomBytes(8).toString("hex");
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (cur && cur.expiresAt > now) {
      throw httpError(409, `A ${cur.op} sync is already running (started ${Math.round((now - cur.startedAt) / 1000)}s ago). Wait for it to finish.`, { code: "locked" });
    }
    tx.set(ref, { runId, op, trigger, by: uid || null, startedAt: now, expiresAt: now + LEASE_MS });
  });
  return runId;
}

async function release(db, runId) {
  const ref = db.doc(LOCK);
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (cur?.runId === runId) tx.delete(ref);
  }).catch((e) => console.error("youtube-analytics lock release failed:", e.message));
}

async function runOp(db, op, { trigger = "manual", uid = null, budgetMs = 240 * 1000 } = {}, fn) {
  if (!OPS.includes(op)) throw httpError(400, "Unknown sync operation.");
  const runId = await acquire(db, op, trigger, uid);
  const startedAt = Date.now();
  const statusRef = db.doc(STATUS);
  await statusRef.set({}, { merge: true }); // update() below needs the doc to exist
  const prev = ((await statusRef.get()).data()?.sync || {})[op] || {};
  const base = { runId, trigger, by: uid, startedAt, lastSuccessAt: prev.lastSuccessAt || null, lastSuccessCounts: prev.lastSuccessCounts || null };
  const errors = [];
  const counts = {};
  let lastProgressWrite = 0;
  const ctx = {
    db, op, runId, trigger, uid,
    deadline: startedAt + budgetMs,
    timeLeft: () => startedAt + budgetMs - Date.now(),
    counts,
    inc: (k, n = 1) => { counts[k] = (counts[k] || 0) + n; },
    error: (msg) => { if (errors.length < MAX_ERRORS) errors.push(String(msg).slice(0, 300)); counts.errors = (counts.errors || 0) + 1; },
    // Throttled to one status write every 2s.
    progress: async (p, force = false) => {
      if (!force && Date.now() - lastProgressWrite < 2000) return;
      lastProgressWrite = Date.now();
      await statusRef.update({ [`sync.${op}`]: { ...base, state: "running", counts: { ...counts }, errors: [...errors], progress: p || null } }).catch(() => {});
    },
  };
  await statusRef.update({ [`sync.${op}`]: { ...base, state: "running", counts: {}, errors: [], progress: null } });
  try {
    const result = (await fn(ctx)) || {};
    const finishedAt = Date.now();
    const state = errors.length ? "partial" : "ok";
    await statusRef.update({
      [`sync.${op}`]: {
        ...base, state, finishedAt, durationMs: finishedAt - startedAt,
        counts: { ...counts }, errors: [...errors], progress: result.progress || null, more: !!result.more,
        message: result.message || null,
        lastSuccessAt: finishedAt, lastSuccessCounts: { ...counts },
      },
    });
    return { op, state, counts: { ...counts }, errors: [...errors], ...result };
  } catch (e) {
    const finishedAt = Date.now();
    await statusRef.update({
      [`sync.${op}`]: { ...base, state: "error", finishedAt, durationMs: finishedAt - startedAt, counts: { ...counts }, errors: [...errors], message: String(e.message || e).slice(0, 400), more: false },
    }).catch(() => {});
    throw e;
  } finally {
    await release(db, runId);
  }
}

// Map with bounded concurrency; stops starting new items once `shouldStop`
// says so. Item failures are reported to onError and don't stop the rest
// (except quota/auth problems, which would fail every remaining item too).
async function pool(items, limit, worker, { shouldStop = () => false, onError } = {}) {
  let i = 0, fatal = null;
  async function lane() {
    while (i < items.length && !fatal && !shouldStop()) {
      const idx = i++;
      try { await worker(items[idx], idx); } catch (e) {
        if (e.code === "quota" || e.code === "needs_reconnect" || e.code === "not_connected") { fatal = e; return; }
        if (onError) onError(e, items[idx]); else throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (fatal) throw fatal;
  return i;
}

module.exports = { LOCK, STATUS, LEASE_MS, OPS, runOp, pool, acquire, release };
