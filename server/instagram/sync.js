// server/instagram/sync.js
//
// Instagram Analytics' syncs (Admin → Content → Instagram Analytics): Meta's
// numbers for @wedraftsite copied into Firestore, so they can be charted
// over time — Meta keeps some only briefly, and the follower count only as
// "now". Run from the admin page (Sync) or the hourly cron once an admin
// turns the schedule on.
//
//   account   the profile (followers, posts) → igAnalytics/account and
//             today's igAccountDaily row (calc.followers: the count as seen
//             now — that history is ours); each of the last BACKFILL_DAYS
//             Pacific days' account insights → igAccountDaily/{day}.meta,
//             re-read until final (metrics.js dayFinal); demographics once
//             a day → igAnalytics/demographics + igDemographics/{YYYY-MM}
//   media     every post on the account → igMedia/{mediaId} (caption,
//             type, time, permalink, thumbnail, like/comment counts); then
//             the insights of the posts that are due (insightsDue — new
//             posts every sync, older ones less often) → igMedia.meta and
//             calc, and a snapshot a day → igMedia/{id}/daily/{day}
//
// Re-running never duplicates: every write is to a fixed id (the day, the
// media id) and overwrites it. igMedia's postId / playerIds / postName —
// the link to a We-Draft post, set by publish.js — are never written here.
//
// One run at a time (igAnalytics/lock, a lease that expires on its own);
// each run records itself on igAnalytics/status sync.{op}, stops before its
// time budget and when Meta's usage headers pass USAGE_STOP (graph.js), and
// says more: true when there's work left.

const crypto = require("crypto");
const { httpError, usage, USAGE_STOP } = require("./graph");
const M = require("./metrics");

const LOCK = "igAnalytics/lock";
const STATUS = "igAnalytics/status";
const LEASE_MS = 330e3;
const OPS = ["account", "media"];
const BACKFILL_DAYS = 90;
const MAX_ERRORS = 25;

async function runOp(db, op, { trigger = "manual", uid = null, budgetMs = 240e3, graph, userId, now = () => Date.now() } = {}) {
  if (!OPS.includes(op)) throw httpError(400, "Unknown sync.");
  const runId = crypto.randomBytes(8).toString("hex");
  const lockRef = db.doc(LOCK);
  const startedAt = now();
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(lockRef)).data();
    if (cur && cur.expiresAt > startedAt) throw httpError(409, `A ${cur.op} sync is already running (started ${Math.round((startedAt - cur.startedAt) / 1000)}s ago).`, { code: "locked" });
    tx.set(lockRef, { runId, op, trigger, by: uid, startedAt, expiresAt: startedAt + LEASE_MS });
  });
  const statusRef = db.doc(STATUS);
  await statusRef.set({}, { merge: true });
  const prev = ((await statusRef.get()).data()?.sync || {})[op] || {};
  const base = { runId, trigger, by: uid, startedAt, lastSuccessAt: prev.lastSuccessAt || null };
  const counts = {};
  const errors = [];
  const ctx = {
    db, graph, userId, now,
    timeLeft: () => startedAt + budgetMs - now(),
    inc: (k, n = 1) => { counts[k] = (counts[k] || 0) + n; },
    error: (msg) => { if (errors.length < MAX_ERRORS) errors.push(String(msg).slice(0, 300)); counts.errors = (counts.errors || 0) + 1; },
    stop: () => startedAt + budgetMs - now() < 15e3 || usage() >= USAGE_STOP,
  };
  await statusRef.update({ [`sync.${op}`]: { ...base, state: "running", counts: {}, errors: [] } });
  try {
    const r = (await (op === "account" ? syncAccount : syncMedia)(ctx)) || {};
    const finishedAt = now();
    const state = errors.length ? "partial" : "ok";
    await statusRef.update({ [`sync.${op}`]: { ...base, state, finishedAt, durationMs: finishedAt - startedAt, counts, errors, more: !!r.more, message: r.message || null, usagePct: usage(), lastSuccessAt: finishedAt } });
    return { op, state, counts, errors, more: !!r.more, message: r.message || null };
  } catch (e) {
    const finishedAt = now();
    await statusRef.update({ [`sync.${op}`]: { ...base, state: "error", finishedAt, durationMs: finishedAt - startedAt, counts, errors, message: String(e.message || e).slice(0, 400), more: false } }).catch(() => {});
    throw e;
  } finally {
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(lockRef)).data();
      if (cur?.runId === runId) tx.delete(lockRef);
    }).catch((e) => console.error("instagram sync lock release failed:", e.message));
  }
}

// ── account ──
async function syncAccount(ctx) {
  const { db, graph, userId } = ctx;
  const now = ctx.now();
  const today = M.pacificDay(now);
  const prof = await graph(`/${userId}`, { params: { fields: "username,name,followers_count,follows_count,media_count,profile_picture_url" } });
  await db.doc("igAnalytics/account").set({
    username: prof.username || null, name: prof.name || null, followers: prof.followers_count ?? null, follows: prof.follows_count ?? null,
    mediaCount: prof.media_count ?? null, picture: prof.profile_picture_url || null, at: now,
  });
  await db.collection("igAccountDaily").doc(today).set({ day: today, calc: { followers: prof.followers_count ?? null, followersAt: now, mediaCount: prof.media_count ?? null } }, { merge: true });
  ctx.inc("profile");

  const oldest = M.addDays(today, -(BACKFILL_DAYS - 1));
  const have = Object.fromEntries((await db.collection("igAccountDaily").where("day", ">=", oldest).get()).docs.map((d) => [d.id, d.data()]));
  const days = Array.from({ length: BACKFILL_DAYS }, (_, i) => M.addDays(today, -i)).filter((d) => !M.dayFinal(d, have[d]?.fetchedAt));

  // New follows per day, the last 30 days in one call (Meta's limit).
  try {
    const since = Math.floor(M.pacificMidnight(M.addDays(today, -29)) / 1000);
    const series = M.readSeries(await graph(`/${userId}/insights`, { params: { metric: "follower_count", period: "day", since, until: Math.floor(now / 1000) } }), "follower_count");
    for (const [day, v] of Object.entries(series)) await db.collection("igAccountDaily").doc(day).set({ day, meta: { newFollowers: v } }, { merge: true });
    ctx.inc("followerSeries");
  } catch (e) {
    ctx.error(`follower_count: ${e.message}`);
  }

  let more = false;
  for (const day of days) {
    if (ctx.stop()) { more = true; break; }
    const since = Math.floor(M.pacificMidnight(day) / 1000);
    const until = Math.min(Math.floor(M.pacificMidnight(M.addDays(day, 1)) / 1000), Math.floor(now / 1000));
    const ref = db.collection("igAccountDaily").doc(day);
    try {
      const meta = M.readInsights(await graph(`/${userId}/insights`, { params: { metric: M.ACCOUNT_DAY_METRICS.join(","), period: "day", metric_type: "total_value", since, until } }));
      const fu = M.readInsights(await graph(`/${userId}/insights`, { params: { metric: "follows_and_unfollows", period: "day", metric_type: "total_value", breakdown: "follow_type", since, until } })).follows_and_unfollows || {};
      // follow_type FOLLOWER: accounts that followed; NON_FOLLOWER: accounts that unfollowed or left.
      await ref.set({ day, meta: { ...meta, follows: fu.FOLLOWER ?? null, unfollows: fu.NON_FOLLOWER ?? null }, fetchedAt: now, partial: day === today }, { merge: true });
      ctx.inc("days");
    } catch (e) {
      if (e.code === "rate_limited") { ctx.error(`rate limited at ${day}`); more = true; break; }
      // Older than Meta keeps: say so once, and don't ask again.
      if (day < M.addDays(today, -30) && e.metaCode === 100) {
        await ref.set({ day, unavailable: String(e.message).slice(0, 200), fetchedAt: now }, { merge: true });
        ctx.inc("daysUnavailable");
      } else {
        ctx.error(`${day}: ${e.message}`);
      }
    }
  }

  // Demographics, once a day (they change slowly; Meta needs 100+ followers).
  const demoRef = db.doc("igAnalytics/demographics");
  const demo = (await demoRef.get()).data();
  if (!ctx.stop() && (!demo?.at || now - demo.at > 20 * 3600e3)) {
    const out = { follower: {}, engaged: {}, timeframe: "this_month", at: now };
    for (const [kind, breakdowns] of Object.entries(M.DEMOGRAPHIC_BREAKDOWNS)) {
      for (const b of breakdowns) {
        try {
          out[kind][b] = M.readBreakdown(await graph(`/${userId}/insights`, { params: { metric: kind === "follower" ? "follower_demographics" : "engaged_audience_demographics", period: "lifetime", metric_type: "total_value", timeframe: "this_month", breakdown: b } })).slice(0, 45);
        } catch (e) {
          ctx.error(`${kind} ${b}: ${e.message}`);
        }
      }
    }
    await demoRef.set(out);
    await db.collection("igDemographics").doc(today.slice(0, 7)).set({ month: today.slice(0, 7), ...out });
    ctx.inc("demographics");
  }
  return { more, message: more ? "More days left — run it again (the schedule does)." : null };
}

// ── media ──
const MEDIA_FIELDS = "id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,thumbnail_url,media_url";

async function syncMedia(ctx) {
  const { db, graph, userId } = ctx;
  const now = ctx.now();
  const today = M.pacificDay(now);
  const list = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    const r = await graph(`/${userId}/media`, { params: { fields: MEDIA_FIELDS, limit: 100, ...(after ? { after } : {}) } });
    list.push(...(r.data || []));
    after = r.paging?.next ? r.paging?.cursors?.after : null;
    if (!after) break;
  }
  ctx.inc("listed", list.length);
  const have = Object.fromEntries((await db.collection("igMedia").get()).docs.map((d) => [d.id, d.data()]));
  for (let i = 0; i < list.length; i += 400) {
    const batch = db.batch();
    for (const m of list.slice(i, i + 400)) {
      batch.set(db.collection("igMedia").doc(m.id), {
        id: m.id, caption: m.caption || "", mediaType: m.media_type || null, productType: m.media_product_type || null,
        timestamp: m.timestamp || null, timestampMs: Date.parse(m.timestamp) || null, permalink: m.permalink || null,
        // Meta's CDN links expire; each sync refreshes them.
        thumb: m.thumbnail_url || (m.media_type === "VIDEO" ? null : m.media_url) || null,
        counts: { likes: m.like_count ?? null, comments: m.comments_count ?? null }, listedAt: now,
      }, { merge: true });
    }
    await batch.commit();
  }
  // Posts no longer on the account (deleted on Instagram): kept, marked, and
  // left out of the analytics. The list is complete here (every page read).
  const listed = new Set(list.map((m) => m.id));
  for (const [id, m] of Object.entries(have)) {
    if (listed.has(id) || m.deleted) continue;
    await db.collection("igMedia").doc(id).set({ deleted: true, deletedAt: now }, { merge: true });
    ctx.inc("deleted");
  }
  // A post published from We-Draft whose permalink wasn't read back then.
  for (const m of list) {
    const pid = have[m.id]?.postId;
    if (!pid || !m.permalink) continue;
    const ref = db.collection("instagramPosts").doc(pid);
    const p = (await ref.get()).data();
    if (p?.ig?.mediaId === m.id && !p.ig.permalink) await ref.update({ "ig.permalink": m.permalink });
  }

  const due = list.filter((m) => M.insightsDue({ ...m, metricsAt: have[m.id]?.metricsAt }, now))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  let more = false;
  let i = 0;
  const lane = async () => {
    while (i < due.length) {
      if (ctx.stop()) { more = true; return; }
      const m = due[i++];
      try {
        const meta = await mediaInsights(graph, m);
        const counts = { likes: m.like_count ?? null, comments: m.comments_count ?? null };
        const calc = M.postCalc(meta, counts);
        await db.collection("igMedia").doc(m.id).set({ meta, calc, metricsAt: now }, { merge: true });
        await db.collection("igMedia").doc(m.id).collection("daily").doc(today).set({ day: today, meta, counts, calc, at: now });
        ctx.inc("insights");
      } catch (e) {
        if (e.code === "rate_limited") { more = true; ctx.error("rate limited"); i = due.length; return; }
        ctx.error(`${m.id}: ${e.message}`);
      }
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  return { more, message: more ? `${due.length - i} posts' insights left — run it again (the schedule does).` : null };
}

// A post's insights in one call; when Meta refuses the set (a metric this
// post doesn't have), one metric at a time, keeping what answers.
async function mediaInsights(graph, m) {
  const metrics = M.mediaMetrics(m);
  try {
    return M.readInsights(await graph(`/${m.id}/insights`, { params: { metric: metrics.join(",") } }));
  } catch (e) {
    if (e.metaCode !== 100 && e.status !== 400) throw e;
    const out = {};
    for (const metric of metrics) {
      try { Object.assign(out, M.readInsights(await graph(`/${m.id}/insights`, { params: { metric } }))); } catch (er) { if (er.code === "rate_limited") throw er; }
    }
    return out;
  }
}

module.exports = { LOCK, STATUS, OPS, BACKFILL_DAYS, runOp, syncAccount, syncMedia, mediaInsights };
