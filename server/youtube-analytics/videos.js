// server/youtube-analytics/videos.js
//
// "Sync Videos": discover the channel's uploads and keep ytVideos/{videoId}
// up to date with YouTube's metadata and current public statistics.
//
// Legacy data is never touched. We-Draft's editorial video records live in
// videos/{docId} (Video URL, GenTitle, GenThumb, items[] with per-player
// titles/thumbs, playerIds, Tags, Short, PublishAt, …) and public pages
// read them directly. This sync only READS that collection, to link each
// YouTube video to its legacy record by the video ID parsed from the
// stored URL (metrics.parseVideoId) — never by title. It writes only
// ytVideos/{videoId} (admin-only) and its snapshots subcollection, and on
// those documents only the machine-owned fields below; the admin-owned
// fields (playerIds, review, associatedBy/At) are never in a sync write.
//
// Machine-owned fields on ytVideos/{videoId}:
//   videoId, channelId, yt{title, description, publishedAt, durationSec,
//   thumbnails, privacyStatus, liveBroadcastContent, wasLive, …}, type,
//   typeSource, shortsProbe, stats{views, likes, comments, fetchedAt, ring,
//   delta24h, delta48h}, legacyDocId, inUploads, unavailable, firstSeenAt,
//   discoveredVia, lastSyncedAt.
//
// Quota (Data API v3, 10,000 units/day default): playlistItems.list and
// videos.list cost 1 unit per call of up to 50 items, so a channel of 500
// videos costs ~20 units per sync. channels.list (resolving a handle) is 1.

const g = require("./google");
const m = require("./metrics");
const { pool } = require("./runs");

const STATUS = "ytAnalytics/status";
const MAX_UPLOADS = 5000;
const SHORT_MAX_SEC = 180;      // Shorts can be up to 3 minutes
const MAX_PROBES_PER_RUN = 40;

// ── Channel ──

// "@handle", a handle without @, a channel URL, or a UC… channel ID →
// { id, title, customUrl, thumb, uploadsPlaylistId } via the Data API.
async function resolveChannel(input) {
  let s = String(input || "").trim();
  const urlM = /youtube\.com\/(?:channel\/(UC[\w-]{22})|(@[\w.-]+))/i.exec(s);
  if (urlM) s = urlM[1] || urlM[2];
  if (!s) throw g.httpError(400, "Enter the channel's @handle or channel ID (UC…).");
  const params = /^UC[\w-]{22}$/.test(s) ? { id: s } : { forHandle: s.startsWith("@") ? s : `@${s}` };
  if (params.forHandle && !/^@[\w.-]{3,100}$/.test(params.forHandle)) throw g.httpError(400, "That doesn't look like a YouTube handle.");
  const j = await g.dataApi("channels", { part: "snippet,contentDetails", ...params });
  const c = j.items?.[0];
  if (!c) throw g.httpError(404, `No YouTube channel found for ${s}.`);
  return {
    id: c.id,
    title: c.snippet?.title || null,
    customUrl: c.snippet?.customUrl || null,
    thumb: c.snippet?.thumbnails?.default?.url || null,
    uploadsPlaylistId: c.contentDetails?.relatedPlaylists?.uploads || `UU${c.id.slice(2)}`,
  };
}

// Admin sets the analytics channel. When YouTube is connected, the
// authorization must be able to read that channel's analytics — otherwise
// every analytics call would fail later with a less useful error.
async function setChannel(db, uid, input) {
  const ch = await resolveChannel(input);
  let verified = null;
  if (await g.refreshTokenSource(db)) verified = await g.canReadChannel(db, ch.id);
  await db.doc(STATUS).set({
    channelId: ch.id,
    channel: { ...ch, setBy: uid, setAt: Date.now() },
    connection: { channelVerified: verified, lastError: verified === false ? `The connected Google sign-in can't read analytics for ${ch.title || ch.id}. Reconnect and pick that channel (or its Brand Account).` : null },
  }, { merge: true });
  return { channel: ch, verified };
}

async function configuredChannel(db) {
  const st = (await db.doc(STATUS).get()).data() || {};
  const id = st.channelId || process.env.YOUTUBE_CHANNEL_ID || null;
  if (!id) throw g.httpError(409, "No YouTube channel is set — enter the channel's @handle under Connection first.", { code: "no_channel" });
  return { id, uploadsPlaylistId: st.channel?.id === id ? st.channel.uploadsPlaylistId : `UU${id.slice(2)}`, status: st };
}

// ── Firestore helpers ──

async function writeBatched(db, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    for (const o of ops.slice(i, i + 400)) b.set(o.ref, o.data, { merge: o.merge !== false });
    await b.commit();
  }
}

// Every legacy videos doc, keyed by YouTube video ID. Duplicate IDs (two
// legacy docs for one video) link to the earliest-dated doc and are
// reported, never merged.
async function loadLegacy(db) {
  const snap = await db.collection("videos").get();
  const byYt = new Map(), byDoc = new Map(), dupes = [], unparsed = [];
  for (const d of snap.docs) {
    const data = d.data();
    byDoc.set(d.id, data);
    const id = m.parseVideoId(data.Video);
    if (!id) { unparsed.push(d.id); continue; }
    const prev = byYt.get(id);
    if (prev) {
      dupes.push(id);
      const t = (x) => (x?.Date?.toMillis ? x.Date.toMillis() : Date.parse(x?.Date) || Infinity);
      if (t(data) < t(byDoc.get(prev))) byYt.set(id, d.id);
    } else byYt.set(id, d.id);
  }
  return { byYt, byDoc, dupes, unparsed };
}

async function loadTracked(db) {
  const snap = await db.collection("ytVideos").get();
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

// ── Type ──
function classify(item, existing, legacy) {
  const durationSec = m.parseDuration(item.contentDetails?.duration);
  const live = item.liveStreamingDetails;
  const lbc = item.snippet?.liveBroadcastContent;
  if (legacy?.Short === true) return { type: "short", typeSource: "editorial" };
  if (lbc === "upcoming") return { type: "upcoming", typeSource: "api" };
  if (lbc === "live") return { type: "live", typeSource: "api" };
  if (live && (live.actualStartTime || live.scheduledStartTime)) return { type: "live", typeSource: "api" }; // past livestream or premiere
  if (existing?.shortsProbe === true) return { type: "short", typeSource: "shorts-url" };
  if (existing?.shortsProbe === false) return { type: "long", typeSource: "shorts-url" };
  if (durationSec != null && durationSec > SHORT_MAX_SEC) return { type: "long", typeSource: "duration" };
  return { type: null, typeSource: "unknown", needsProbe: durationSec != null && durationSec > 0 };
}

// The Data API doesn't say whether a video is a Short. youtube.com/shorts/ID
// answers 200 for a Short and redirects to /watch for anything else — no
// quota cost. Inconclusive answers leave the type unknown (never guessed).
async function probeShort(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8000) });
    if (r.status === 200) return true;
    if (r.status >= 300 && r.status < 400) return false;
    return null;
  } catch { return null; }
}

function ytFields(item) {
  const sn = item.snippet || {};
  const th = sn.thumbnails || {};
  return {
    title: sn.title || null,
    description: (sn.description || "").slice(0, 5000),
    publishedAt: sn.publishedAt || null,
    durationSec: m.parseDuration(item.contentDetails?.duration),
    thumbnails: Object.fromEntries(["default", "medium", "high", "standard", "maxres"].map((k) => [k, th[k]?.url || null])),
    privacyStatus: item.status?.privacyStatus || null,
    uploadStatus: item.status?.uploadStatus || null,
    liveBroadcastContent: sn.liveBroadcastContent || null,
    wasLive: !!item.liveStreamingDetails,
    liveActualStart: item.liveStreamingDetails?.actualStartTime || null,
    categoryId: sn.categoryId || null,
  };
}
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Fetch metadata for `ids` and upsert ytVideos docs (machine fields only).
// Shared by Sync Videos and by Sync Analytics (for owned videos the
// analytics report knows about but the public uploads list doesn't show).
async function fetchAndUpsert(ctx, ids, { legacy, tracked, uploadsSet, discoveredVia, now = Date.now() }) {
  const { db } = ctx;
  const items = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const j = await g.dataApi("videos", { part: "snippet,contentDetails,statistics,status,liveStreamingDetails", id: ids.slice(i, i + 50).join(","), maxResults: "50" });
    for (const it of j.items || []) items.set(it.id, it);
    await ctx.progress({ step: "metadata", done: Math.min(i + 50, ids.length), total: ids.length });
  }

  const ops = [];
  const probeQueue = [];
  const hourKey = new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, ""); // YYYYMMDDHH (UTC)
  for (const id of ids) {
    const ex = tracked.get(id);
    const legacyDocId = legacy.byYt.get(id) || null;
    const ref = db.collection("ytVideos").doc(id);
    const it = items.get(id);
    ctx.inc("processed");
    if (!it) {
      // Deleted, made private, or otherwise not visible to the API key.
      // Kept (never deleted) and flagged.
      if (ex) {
        ops.push({ ref, data: { unavailable: true, inUploads: uploadsSet ? uploadsSet.has(id) : (ex.inUploads ?? null), legacyDocId, lastSyncedAt: now } });
        ctx.inc("unavailable");
      }
      continue;
    }
    const cls = classify(it, ex, legacyDocId ? legacy.byDoc.get(legacyDocId) : null);
    const views = num(it.statistics?.viewCount);
    const ring = views == null ? ex?.stats?.ring || [] : m.pushRing(ex?.stats?.ring, now, views);
    const data = {
      videoId: id,
      channelId: it.snippet?.channelId || null,
      yt: ytFields(it),
      type: cls.type,
      typeSource: cls.typeSource,
      stats: {
        views, likes: num(it.statistics?.likeCount), comments: num(it.statistics?.commentCount),
        fetchedAt: now, ring,
        delta24h: m.ringDelta(ring, 24, now), delta48h: m.ringDelta(ring, 48, now),
      },
      legacyDocId,
      inUploads: uploadsSet ? uploadsSet.has(id) : (ex?.inUploads ?? false),
      unavailable: false,
      lastSyncedAt: now,
    };
    if (!ex) {
      data.firstSeenAt = now;
      data.discoveredVia = discoveredVia;
      ctx.inc("new");
      if (!legacyDocId) ctx.inc("newUnlinked");
    } else {
      ctx.inc("updated");
      if (legacyDocId && !ex.legacyDocId) ctx.inc("newlyLinked");
    }
    if (legacyDocId) ctx.inc("linked");
    ops.push({ ref, data });
    // Full snapshot history: one doc per hour at most, only when the public
    // count moved — deterministic ID, so a re-run in the same hour
    // overwrites rather than duplicates.
    const lastV = ex?.stats?.ring?.length ? ex.stats.ring[ex.stats.ring.length - 1].v : null;
    if (views != null && views !== lastV) {
      ops.push({ ref: ref.collection("snapshots").doc(hourKey), data: { t: now, views, likes: data.stats.likes, comments: data.stats.comments }, merge: false });
      ctx.inc("snapshots");
    }
    if (cls.needsProbe && ex?.shortsProbe === undefined) probeQueue.push(id);
    tracked.set(id, { ...(ex || {}), ...data });
  }
  await writeBatched(db, ops);

  // Shorts detection for short-duration videos we haven't checked yet.
  const toProbe = probeQueue.slice(0, MAX_PROBES_PER_RUN);
  const probeOps = [];
  await pool(toProbe, 4, async (id) => {
    const isShort = await probeShort(id);
    if (isShort == null) { ctx.inc("probeInconclusive"); return; }
    ctx.inc("probed");
    probeOps.push({ ref: db.collection("ytVideos").doc(id), data: { shortsProbe: isShort, type: isShort ? "short" : "long", typeSource: "shorts-url" } });
  }, { shouldStop: () => ctx.timeLeft() < 20000 });
  await writeBatched(db, probeOps);
  return items;
}

async function syncVideos(ctx) {
  const { db } = ctx;
  const { id: channelId, uploadsPlaylistId } = await configuredChannel(db);

  // 1. Every upload ID (newest first), paginated.
  const uploads = [];
  let pageToken;
  do {
    const j = await g.dataApi("playlistItems", { part: "contentDetails", playlistId: uploadsPlaylistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    for (const it of j.items || []) if (it.contentDetails?.videoId) uploads.push(it.contentDetails.videoId);
    pageToken = j.nextPageToken;
    await ctx.progress({ step: "uploads", found: uploads.length });
  } while (pageToken && uploads.length < MAX_UPLOADS);
  const uploadsSet = new Set(uploads);

  // 2. Match against legacy records and what's already tracked.
  const [legacy, tracked] = await Promise.all([loadLegacy(db), loadTracked(db)]);
  const ids = [...new Set([...uploads, ...tracked.keys()])];
  await fetchAndUpsert(ctx, ids, { legacy, tracked, uploadsSet, discoveredVia: "uploads" });

  for (const [id, v] of tracked) if (!uploadsSet.has(id) && !v.unavailable) ctx.inc("notInUploads");

  // Legacy records whose video isn't on this channel: reported, not tracked
  // (the Analytics API only covers the authorized channel's own videos).
  const notOnChannel = [...legacy.byYt.keys()].filter((id) => !tracked.has(id));
  ctx.counts.legacyNotOnChannel = notOnChannel.length;
  ctx.counts.legacyUnparsed = legacy.unparsed.length;
  if (legacy.dupes.length) ctx.counts.legacyDuplicateIds = legacy.dupes.length;

  await db.doc(STATUS).set({
    videosSummary: {
      channelId, uploads: uploads.length, tracked: tracked.size,
      legacyNotOnChannel: notOnChannel.slice(0, 50), legacyNotOnChannelCount: notOnChannel.length,
      legacyUnparsed: legacy.unparsed.slice(0, 20), legacyDuplicateIds: legacy.dupes.slice(0, 20),
      at: Date.now(),
    },
  }, { merge: true });
  return { message: `${uploads.length} uploads on the channel; ${tracked.size} videos tracked.` };
}

module.exports = { resolveChannel, setChannel, configuredChannel, syncVideos, fetchAndUpsert, loadLegacy, loadTracked, writeBatched, classify, probeShort };
