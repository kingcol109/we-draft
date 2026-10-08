// server/stream-manager/broadcasts.js
//
// Stream Manager broadcast records (admin → Stream Manager,
// api/stream-manager.js). One doc per planned We-Draft Live YouTube stream:
//
//   broadcasts/{id}
//     gameId, gameSlug           → liveGames/{gameId} (the game itself lives there,
//     homeTeam, awayTeam, kickoff   these are a display snapshot taken at create)
//     scheduledStart             Timestamp — when the YouTube broadcast is scheduled
//     status                     overall: scheduled | preparing | live | ended | error
//     youtube: {                 the YouTube broadcast
//       title, description, privacyStatus,
//       broadcastId, videoId, streamId, channelId,
//       lifecycleStatus, streamStatus, healthStatus,
//       lastSyncedAt, error, creatingAt }
//     worker: {                  the cloud worker — from the VM agent's reports
//       status, instanceId, startedAt, stoppedAt, lastHeartbeat, error }
//     auto: { ... }              automated orchestration, when the game was
//                                enabled from the schedule picker — see
//                                server/stream-manager/orchestrator.js
//     createdBy, createdAt, updatedAt
//
// Written only here (Admin SDK); firestore.rules gives admins read access and
// no client writes, so every change goes through these checks.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const yt = require("./youtube");

const PRIVACY = ["private", "unlisted", "public"];
const CREATE_LOCK_MS = 90 * 1000;
const { httpError } = yt;

// Overall status from the YouTube and worker groups.
const AUTO_PREPARING = ["preparing", "vm", "worker", "ingest", "going-live"];
function deriveStatus(b) {
  const lc = b.youtube?.lifecycleStatus;
  if (lc === "complete" || lc === "revoked") return "ended";
  if (b.auto?.phase === "completed") return "ended";
  if (b.auto?.phase === "failed") return "error";
  if (b.youtube?.error || b.worker?.error) return "error";
  if (lc === "live") return "live";
  if (["testStarting", "testing", "liveStarting"].includes(lc) || ["starting", "running"].includes(b.worker?.status)) return "preparing";
  if (AUTO_PREPARING.includes(b.auto?.phase)) return "preparing";
  return "scheduled";
}

const teamSnap = (t = {}) => ({ school: t.school || t.name || null, short: t.short || null, logo: t.logo || null, color: t.color || null, rank: t.rank ?? null });
const teamName = (t) => t?.school || t?.short || "TBD";
const defaultTitle = (g) => `We-Draft Live: ${teamName(g.away)} vs ${teamName(g.home)}`;
const defaultDescription = (g) =>
  `${teamName(g.away)} at ${teamName(g.home)} — live scores, play-by-play, stats and analysis from We-Draft Live.\n\nFollow along: https://we-draft.com/live/${g.slug || g.providerGameId || ""}`;

function cleanText(v, field, max, required) {
  const s = String(v ?? "").trim();
  if (required && !s) throw httpError(400, `${field} is required.`);
  if (s.length > max) throw httpError(400, `${field} must be ${max} characters or fewer.`);
  // YouTube rejects < and > in titles and descriptions.
  if (/[<>]/.test(s)) throw httpError(400, `${field} can't contain < or >.`);
  return s;
}

function cleanPrivacy(v, confirmPublic) {
  const p = String(v || "unlisted");
  if (!PRIVACY.includes(p)) throw httpError(400, "Visibility must be private, unlisted or public.");
  if (p === "public" && confirmPublic !== true) throw httpError(400, "Public broadcasts need the explicit public confirmation.");
  return p;
}

function cleanStart(v) {
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) throw httpError(400, "Scheduled start isn't a valid date/time.");
  return Timestamp.fromMillis(ms);
}

async function loadGame(db, gameId) {
  if (!/^\d{1,20}$/.test(String(gameId || ""))) throw httpError(400, "Pick a We-Draft Live game.");
  const snap = await db.collection("liveGames").doc(String(gameId)).get();
  if (!snap.exists) throw httpError(400, "That game isn't in We-Draft Live (liveGames) — only this week's games can be picked.");
  return { providerGameId: snap.id, ...snap.data() };
}

async function loadRecord(db, id) {
  if (!/^[A-Za-z0-9]{1,40}$/.test(String(id || ""))) throw httpError(400, "Bad broadcast id.");
  const ref = db.collection("broadcasts").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, "That broadcast record doesn't exist.");
  return { ref, data: snap.data() };
}

async function createRecord(db, uid, body) {
  const game = await loadGame(db, body.gameId);
  const privacyStatus = cleanPrivacy(body.privacyStatus, body.confirmPublic);
  const title = cleanText(body.title || defaultTitle(game), "Title", 100, true);
  const description = cleanText(body.description ?? defaultDescription(game), "Description", 5000, false);
  const scheduledStart = cleanStart(body.scheduledStart || game.startDate);
  const rec = {
    gameId: game.providerGameId,
    gameSlug: game.slug || null,
    homeTeam: teamSnap(game.home),
    awayTeam: teamSnap(game.away),
    kickoff: game.startDate || null,
    scheduledStart,
    youtube: {
      title, description, privacyStatus,
      broadcastId: null, videoId: null, streamId: null, channelId: null,
      lifecycleStatus: null, streamStatus: null, healthStatus: null,
      lastSyncedAt: null, error: null, creatingAt: null,
    },
    worker: { status: "idle", instanceId: null, startedAt: null, stoppedAt: null, lastHeartbeat: null, error: null },
    createdBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  rec.status = deriveStatus(rec);
  const ref = await db.collection("broadcasts").add(rec);
  return { id: ref.id };
}

// Editable until the YouTube broadcast exists (after that, YouTube Studio is
// the place to change it; Refresh pulls the visibility back in).
async function updateRecord(db, body) {
  const { ref, data } = await loadRecord(db, body.id);
  if (data.youtube?.broadcastId) throw httpError(409, "The YouTube broadcast already exists — change it in YouTube Studio, then Refresh.");
  const upd = {
    "youtube.title": cleanText(body.title, "Title", 100, true),
    "youtube.description": cleanText(body.description, "Description", 5000, false),
    "youtube.privacyStatus": cleanPrivacy(body.privacyStatus, body.confirmPublic),
    scheduledStart: cleanStart(body.scheduledStart),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.update(upd);
  return { ok: true };
}

async function deleteRecord(db, body) {
  const { ref } = await loadRecord(db, body.id);
  await ref.delete();
  return { ok: true };
}

// ── YouTube ──

async function settings(db) {
  return (await db.doc(yt.SETTINGS.join("/")).get()).data() || {};
}

// The worker stream every broadcast binds to: the one chosen in Stream
// Manager → Channel, else the channel's "We-Draft Live Worker" stream, else
// a new one (the worker VM then needs that stream's key from YouTube Studio).
// slotStreamId: the orchestrator's stream slot for this broadcast — used
// as-is, never saved as the channel default.
async function workerStream(db, token, s, slotStreamId) {
  if (slotStreamId) {
    const st = await yt.getStream(token, slotStreamId);
    if (st) return { stream: st, created: false };
    throw httpError(400, "A stream slot's YouTube stream no longer exists on the connected channel — fix the slots in Stream Manager → Auto Broadcasts.");
  }
  if (s.workerStreamId) {
    const st = await yt.getStream(token, s.workerStreamId);
    if (st) return { stream: st, created: false };
    throw httpError(400, "The selected worker stream no longer exists on the connected channel — pick another in Stream Manager → Channel.");
  }
  const existing = (await yt.listStreams(token)).find((x) => x.title === yt.WORKER_STREAM_TITLE);
  const stream = existing || (await yt.insertWorkerStream(token));
  await db.doc(yt.SETTINGS.join("/")).set({ workerStreamId: stream.id, workerStreamTitle: stream.title }, { merge: true });
  return { stream, created: !existing };
}

function youtubeFields(b, stream) {
  return {
    "youtube.broadcastId": b.id,
    "youtube.videoId": b.id, // a live broadcast's id is its video id
    "youtube.streamId": b.boundStreamId || null,
    "youtube.privacyStatus": b.privacyStatus,
    "youtube.lifecycleStatus": b.lifeCycleStatus,
    "youtube.actualStartTime": b.actualStartTime,
    "youtube.actualEndTime": b.actualEndTime,
    "youtube.streamStatus": stream?.streamStatus || null,
    "youtube.healthStatus": stream?.healthStatus || null,
    "youtube.lastSyncedAt": FieldValue.serverTimestamp(),
    "youtube.error": null,
  };
}

async function finish(ref, upd) {
  upd.updatedAt = FieldValue.serverTimestamp();
  await ref.update(upd);
  const data = (await ref.get()).data();
  const status = deriveStatus(data);
  if (status !== data.status) await ref.update({ status });
}

async function fail(ref, e) {
  await ref.update({ "youtube.error": String(e.message || e).slice(0, 500), "youtube.creatingAt": null, status: "error", updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
}

// body.streamId (orchestrator only): bind to that slot's stream, re-binding
// an existing broadcast if it's on a different one.
async function youtubeCreate(db, body) {
  const { ref } = await loadRecord(db, body.id);
  const slotStreamId = body.streamId ? String(body.streamId) : null;
  // One create at a time per record (double clicks, two admins).
  const rec = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    const rebind = slotStreamId && d.youtube?.streamId !== slotStreamId;
    if (d.youtube?.broadcastId && d.youtube?.streamId && !rebind) throw httpError(409, "This record already has a bound YouTube broadcast — use Refresh.");
    if (d.youtube?.creatingAt && Date.now() - d.youtube.creatingAt < CREATE_LOCK_MS) throw httpError(409, "A YouTube create is already running for this broadcast.");
    tx.update(ref, { "youtube.creatingAt": Date.now() });
    return d;
  });

  try {
    await loadGame(db, rec.gameId);
    const s = await settings(db);
    const token = await yt.accessToken(db);
    if (!s.channelId) throw httpError(409, "No YouTube channel is connected.");
    if (rec.youtube.channelId && rec.youtube.channelId !== s.channelId) throw httpError(409, "This broadcast was started on a different YouTube channel than the one connected now.");
    const { stream, created: streamCreated } = await workerStream(db, token, s, slotStreamId);

    let b;
    if (rec.youtube.broadcastId) {
      // An earlier attempt created the broadcast but didn't finish binding.
      b = await yt.getBroadcast(token, rec.youtube.broadcastId);
      if (!b) throw httpError(400, "The YouTube broadcast from the earlier attempt is gone (deleted in Studio?). Delete this record and create a new one.");
    } else {
      const startMs = rec.scheduledStart.toMillis();
      if (startMs < Date.now() + 60 * 1000) throw httpError(400, "The scheduled start is in the past — edit it to a future time first.");
      const privacyStatus = cleanPrivacy(rec.youtube.privacyStatus, rec.youtube.privacyStatus === "public");
      b = await yt.insertBroadcast(token, {
        title: rec.youtube.title,
        description: rec.youtube.description,
        scheduledStart: new Date(startMs).toISOString(),
        privacyStatus,
      });
      // Saved before binding so a retry never makes a second broadcast.
      await ref.update({ "youtube.broadcastId": b.id, "youtube.videoId": b.id, "youtube.channelId": s.channelId });
    }
    if (b.boundStreamId !== stream.id) b = await yt.bindBroadcast(token, b.id, stream.id);
    const st = await yt.getStream(token, stream.id);
    await finish(ref, { ...youtubeFields(b, st), "youtube.channelId": s.channelId, "youtube.creatingAt": null });
    return { ok: true, broadcastId: b.id, streamCreated };
  } catch (e) {
    await fail(ref, e);
    throw e;
  }
}

async function youtubeRefresh(db, body) {
  const { ref, data } = await loadRecord(db, body.id);
  if (!data.youtube?.broadcastId) throw httpError(400, "No YouTube broadcast yet — create it first.");
  try {
    const s = await settings(db);
    if (data.youtube.channelId && s.channelId && data.youtube.channelId !== s.channelId) throw httpError(409, "This broadcast belongs to a different YouTube channel than the one connected now.");
    const token = await yt.accessToken(db);
    const b = await yt.getBroadcast(token, data.youtube.broadcastId);
    if (!b) throw httpError(404, "YouTube no longer has this broadcast (deleted in Studio?).");
    const st = b.boundStreamId ? await yt.getStream(token, b.boundStreamId) : null;
    await finish(ref, youtubeFields(b, st));
    return { ok: true };
  } catch (e) {
    await ref.update({ "youtube.error": String(e.message || e).slice(0, 500), status: "error", updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    throw e;
  }
}

// ── Channel ──

async function channelStatus(db, { withStreams }) {
  const s = await settings(db);
  const out = {
    connected: !!s.connected,
    needsReconnect: !!s.needsReconnect,
    lastError: s.lastError || null,
    channel: s.connected ? { id: s.channelId, title: s.channelTitle, customUrl: s.channelCustomUrl, thumb: s.channelThumb } : null,
    scopes: s.scopes || [],
    connectedAt: s.connectedAt?.toMillis?.() || null,
    workerStream: s.workerStreamId ? { id: s.workerStreamId, title: s.workerStreamTitle } : null,
    configured: !!(process.env.YOUTUBE_OAUTH_CLIENT_ID && process.env.YOUTUBE_OAUTH_CLIENT_SECRET && (process.env.STREAM_MANAGER_TOKEN_KEY || "").length >= 32),
  };
  if (!s.connected || !withStreams) return out;
  const token = await yt.accessToken(db);
  // Live check that the stored authorization still points at the same channel.
  const live = await yt.mineChannel(token);
  out.channelVerified = !!live && live.id === s.channelId;
  if (live && live.id !== s.channelId) out.lastError = `The authorization now resolves to a different channel (${live.title}). Reconnect.`;
  out.streams = await yt.listStreams(token);
  return out;
}

async function setWorkerStream(db, body) {
  const token = await yt.accessToken(db);
  const st = await yt.getStream(token, String(body.streamId || ""));
  if (!st) throw httpError(400, "That stream isn't on the connected channel.");
  await db.doc(yt.SETTINGS.join("/")).set({ workerStreamId: st.id, workerStreamTitle: st.title }, { merge: true });
  return { ok: true };
}

module.exports = {
  deriveStatus, defaultTitle, defaultDescription, cleanPrivacy, loadRecord, settings,
  createRecord, updateRecord, deleteRecord, youtubeCreate, youtubeRefresh, channelStatus, setWorkerStream,
};
