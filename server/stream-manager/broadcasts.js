// server/stream-manager/broadcasts.js
//
// Stream Manager broadcast records (admin → Stream Manager,
// api/stream-manager.js). One doc per planned We-Draft Live YouTube stream:
//
//   broadcasts/{id}
//     kind                       "national" for national coverage (no one game —
//                                gameId null, gameSlug "national", national:
//                                { startAt, endAt }; orchestrator.js selectNational)
//     gameId, gameSlug           → liveGames/{gameId} (the game itself lives there,
//     homeTeam, awayTeam, kickoff   these are a display snapshot taken at create)
//     scheduledStart             Timestamp — when the YouTube broadcast is scheduled
//     status                     overall: scheduled | preparing | live | ended | cancelled | error
//                                (| rehearsal — an open rehearsal record, rehearsal: true)
//     youtube: {                 the YouTube broadcast
//       title, description, privacyStatus,
//       metadataSource, metadataVersion   where a created broadcast's title /
//                                description came from: "draft" | "generated" (metadata.js) | "record"
//       thumbnailSha256, thumbnailVersion, thumbnailUploadedAt   the generated
//                                thumbnail last uploaded (youtubeThumbnail)
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
// YouTube lifecycles where the broadcast is (or may be) on the air.
const ON_AIR = ["testStarting", "testing", "liveStarting", "live"];
// …and the ones that prove it's off the air.
const OFF_AIR = ["complete", "revoked", "ready", "created"];

// An automation ending that couldn't confirm YouTube went off the air
// (orchestrator.js giveUp → auto.ytUnconfirmed). Until Refresh YouTube
// Status confirms it's off the air, nothing may restart, re-enable, rebuild
// or forget that broadcast.
const UNCONFIRMED_MSG = "The YouTube broadcast may still be on the air — its end was never confirmed. Check it in YouTube Studio (end it there if it's live), then Refresh YouTube Status; once YouTube confirms it's off the air this can be retried.";
function assertConfirmedOffAir(b) {
  if (b?.auto?.ytUnconfirmed === true) throw httpError(409, UNCONFIRMED_MSG);
}
function deriveStatus(b) {
  // A rehearsal never has a real YouTube state: it's "rehearsal" while open.
  if (b.rehearsal === true) {
    const ph = b.auto?.phase;
    return ph === "completed" ? "ended" : ph === "cancelled" ? "cancelled" : ph === "failed" ? "error" : "rehearsal";
  }
  const lc = b.youtube?.lifecycleStatus;
  // A failed automation is an error even if YouTube was safely completed.
  if (b.auto?.phase === "failed") return "error";
  if (lc === "complete" || lc === "revoked") return "ended";
  if (b.auto?.phase === "completed") return "ended";
  // Cancelled automation is done — unless YouTube still shows it on air
  // (completing it failed), which needs attention.
  if (b.auto?.phase === "cancelled") return ON_AIR.includes(lc) ? "error" : "cancelled";
  if (b.youtube?.error || b.worker?.error) return "error";
  if (lc === "live") return "live";
  if (["testStarting", "testing", "liveStarting"].includes(lc) || ["starting", "running"].includes(b.worker?.status)) return "preparing";
  if (AUTO_PREPARING.includes(b.auto?.phase)) return "preparing";
  return "scheduled";
}

// A record's name in lists and logs.
const recordName = (b) => (b?.kind === "national" ? "National Coverage" : `${teamName(b?.awayTeam)} vs ${teamName(b?.homeTeam)}`);
// A national record's own title / description (the stream's standard text,
// without the window's top-game hashtag, which the generated text adds at
// broadcast creation — metadata.js).
const nationalTitle = () => require("./metadata").NATIONAL_TITLE;
const nationalDescription = () => require("./metadata").nationalDescriptionText(null);
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

// Deletes the record only (never a YouTube broadcast) — and refuses while
// anything could still be running, so nothing on YouTube or the VM is
// left without a record to manage it.
async function deleteRecord(db, body) {
  const { ref } = await loadRecord(db, body.id);
  await db.runTransaction(async (tx) => {
    const b = (await tx.get(ref)).data();
    if (!b) throw httpError(404, "That broadcast record doesn't exist.");
    // Deleting would drop the only record of a broadcast that may be on air.
    assertConfirmedOffAir(b);
    if (b.auto?.open || b.auto?.active) {
      throw httpError(409, "This broadcast is still under automation — disable it in Auto Schedule (or let it finish) and wait until it shows Cancelled or Ended before deleting.");
    }
    if (["starting", "running"].includes(b.worker?.status)) {
      throw httpError(409, "Its worker may still be running — wait until the worker shows Stopped before deleting.");
    }
    if (ON_AIR.includes(b.youtube?.lifecycleStatus)) {
      throw httpError(409, "Its YouTube broadcast is testing or live — end it first (YouTube Studio, then Refresh YouTube Status) so it isn't left without a record.");
    }
    tx.delete(ref);
  });
  return { ok: true };
}

// Recomputes the stored overall status of records the orchestrator no
// longer touches (closed automation, manual records) — e.g. cancelled
// records saved as "scheduled" before the cancelled status existed — and
// turns auto.enabled off on cancelled ones. Open automation records are
// skipped (the orchestrator owns them). Never deletes anything.
// { apply: true } writes; anything else is a dry run listing the changes.
async function refreshStatuses(db, body = {}) {
  const apply = body.apply === true;
  const snap = await db.collection("broadcasts").get();
  const changes = [];
  for (const d of snap.docs) {
    const b = d.data();
    if (b.auto?.open) continue;
    const upd = {};
    const status = deriveStatus(b);
    if (status !== b.status) upd.status = status;
    if (b.auto?.phase === "cancelled" && b.auto.enabled !== false) upd["auto.enabled"] = false;
    if (!Object.keys(upd).length) continue;
    changes.push({
      id: d.id,
      matchup: recordName(b),
      from: b.status ?? null,
      to: upd.status ?? b.status ?? null,
      disableAuto: "auto.enabled" in upd,
    });
    if (apply) await d.ref.update({ ...upd, updatedAt: FieldValue.serverTimestamp() });
  }
  if (apply) console.log(`stream-manager refresh-statuses applied=${changes.length}`);
  return { applied: apply, changes };
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

// The title / description a new YouTube broadcast is created with. useDraft
// (the orchestrator's creates): the game's saved metadata draft
// (metadata.js, broadcastMetadata/{gameId}) when there's a valid one, else
// the generated text for the game (metadata.js generatedForBroadcast —
// matchup, ranks, kickoff as of now); else — and always for manual
// creates — the record's own. National coverage the same way, from the
// national draft (broadcastMetadata/national) and the window's generated
// text. Metadata that can't be read never blocks the broadcast. Never
// writes the draft.
async function broadcastText(db, rec, useDraft) {
  const own = { title: rec.youtube.title, description: rec.youtube.description, source: "record", version: null };
  if (!useDraft || rec.rehearsal === true) return own;
  const md = require("./metadata");
  const key = rec.kind === "national" ? md.NATIONAL_KEY : rec.gameId;
  try {
    const d = await md.draftForBroadcast(db, key);
    if (d) return { title: d.title, description: d.description, source: "draft", version: d.version };
  } catch (e) {
    console.error(`stream-manager metadata draft unreadable game=${rec.gameId}: ${e.message}`);
  }
  try {
    const gen = await md.generatedForBroadcast(db, rec);
    if (gen) return { ...gen, source: "generated", version: null };
  } catch (e) {
    console.error(`stream-manager generated metadata failed game=${rec.gameId}: ${e.message}`);
  }
  return own;
}

// body.streamId (orchestrator only): bind to that slot's stream, re-binding
// an existing broadcast if it's on a different one. body.useDraft
// (orchestrator only): a new broadcast takes the game's metadata draft.
// Server-side guard for every YouTube create/bind (manual or orchestrator):
// never for a rehearsal record, never in rehearsal-only mode.
function assertRealYoutube(data) {
  assertConfirmedOffAir(data);
  if (data?.rehearsal === true) throw httpError(409, "This is a rehearsal record — it never creates or touches a YouTube broadcast.");
  if (process.env.STREAM_REHEARSAL_ONLY === "1") throw httpError(409, "The server is in rehearsal-only mode (STREAM_REHEARSAL_ONLY) — YouTube broadcasts can't be created.");
}

async function youtubeCreate(db, body) {
  const { ref, data: first } = await loadRecord(db, body.id);
  assertRealYoutube(first);
  const slotStreamId = body.streamId ? String(body.streamId) : null;
  // One create at a time per record (double clicks, two admins).
  const rec = await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    assertRealYoutube(d);
    const rebind = slotStreamId && d.youtube?.streamId !== slotStreamId;
    if (d.youtube?.broadcastId && d.youtube?.streamId && !rebind) throw httpError(409, "This record already has a bound YouTube broadcast — use Refresh.");
    if (d.youtube?.creatingAt && Date.now() - d.youtube.creatingAt < CREATE_LOCK_MS) throw httpError(409, "A YouTube create is already running for this broadcast.");
    tx.update(ref, { "youtube.creatingAt": Date.now() });
    return d;
  });

  try {
    if (rec.kind !== "national") await loadGame(db, rec.gameId);
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
      const meta = await broadcastText(db, rec, body.useDraft === true);
      b = await yt.insertBroadcast(token, {
        title: meta.title,
        description: meta.description,
        scheduledStart: new Date(startMs).toISOString(),
        privacyStatus,
      });
      // Saved before binding so a retry never makes a second broadcast —
      // with the title / description it was created with.
      await ref.update({
        "youtube.broadcastId": b.id, "youtube.videoId": b.id, "youtube.channelId": s.channelId,
        "youtube.title": meta.title, "youtube.description": meta.description,
        "youtube.metadataSource": meta.source, "youtube.metadataVersion": meta.version,
      });
    }
    if (b.boundStreamId !== stream.id) b = await yt.bindBroadcast(token, b.id, stream.id);
    const st = await yt.getStream(token, stream.id);
    await finish(ref, { ...youtubeFields(b, st), "youtube.channelId": s.channelId, "youtube.creatingAt": null });
    // Automatic broadcasts take the game's (or national's) saved thumbnail
    // too — best-effort, after the broadcast is bound, never failing it.
    const thumbnail = body.useDraft === true ? await autoThumbnail(db, ref, token) : null;
    return { ok: true, broadcastId: b.id, streamCreated, ...(thumbnail ? { thumbnail } : {}) };
  } catch (e) {
    await fail(ref, e);
    throw e;
  }
}

async function youtubeRefresh(db, body) {
  const { ref, data } = await loadRecord(db, body.id);
  if (data.rehearsal === true) throw httpError(409, "This is a rehearsal record — it has no YouTube broadcast.");
  if (!data.youtube?.broadcastId) throw httpError(400, "No YouTube broadcast yet — create it first.");
  try {
    const s = await settings(db);
    if (data.youtube.channelId && s.channelId && data.youtube.channelId !== s.channelId) throw httpError(409, "This broadcast belongs to a different YouTube channel than the one connected now.");
    const token = await yt.accessToken(db);
    const b = await yt.getBroadcast(token, data.youtube.broadcastId);
    if (!b) throw httpError(404, "YouTube no longer has this broadcast (deleted in Studio?).");
    const st = b.boundStreamId ? await yt.getStream(token, b.boundStreamId) : null;
    const upd = youtubeFields(b, st);
    // Read-only toward YouTube. A read that shows the broadcast off the air is
    // the only thing that clears an unconfirmed ending; the record's failed /
    // error status is left as it is (finish() re-derives it from auto.phase).
    const confirmed = data.auto?.ytUnconfirmed === true && OFF_AIR.includes(b.lifeCycleStatus);
    if (confirmed) Object.assign(upd, { "auto.ytUnconfirmed": false, "auto.offAirConfirmedAt": Date.now() });
    await finish(ref, upd);
    return { ok: true, ...(data.auto?.ytUnconfirmed === true ? { offAirConfirmed: confirmed } : {}) };
  } catch (e) {
    await ref.update({ "youtube.error": String(e.message || e).slice(0, 500), status: "error", updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    throw e;
  }
}

// Uploads the game's saved generated thumbnail (metadata.js /
// thumbnail.js, broadcastThumbnails/{gameId}, or …/national for national
// coverage) to this record's YouTube broadcast, on an admin's Upload
// Thumbnail — never for a rehearsal. (Automation and thumbnail saves also
// send it on their own: autoThumbnail below.)
async function youtubeThumbnail(db, body) {
  const { ref, data } = await loadRecord(db, body.id);
  if (data.rehearsal === true) throw httpError(409, "This is a rehearsal record — it has no YouTube broadcast.");
  if (!data.youtube?.broadcastId) throw httpError(400, "No YouTube broadcast yet — the thumbnail can be uploaded once it's created.");
  const md = require("./metadata");
  const t = await md.thumbnailForBroadcast(db, data.kind === "national" ? md.NATIONAL_KEY : data.gameId);
  if (!t) throw httpError(404, `${data.kind === "national" ? "National coverage" : "This game"} has no saved thumbnail — generate and save one in Auto Schedule → Edit Metadata.`);
  const s = await settings(db);
  if (data.youtube.channelId && s.channelId && data.youtube.channelId !== s.channelId) throw httpError(409, "This broadcast belongs to a different YouTube channel than the one connected now.");
  const token = await yt.accessToken(db);
  await yt.setThumbnail(token, data.youtube.broadcastId, t.png);
  await ref.update({ "youtube.thumbnailSha256": t.sha256, "youtube.thumbnailVersion": t.version, "youtube.thumbnailUploadedAt": Date.now(), updatedAt: FieldValue.serverTimestamp() });
  return { ok: true, sha256: t.sha256 };
}

// The saved thumbnail becomes the YouTube thumbnail automatically:
//   - when automation creates a broadcast (youtubeCreate with useDraft), and
//   - when an admin saves a thumbnail while a real broadcast for that game
//     (or an open national one) already exists on YouTube and hasn't ended
//     (syncSavedThumbnail, called after metadata-thumbnail-save).
// Best-effort: an upload failure is recorded as youtube.thumbnailError and
// never throws, so it can't fail a broadcast or a save. Skipped for
// rehearsals, in rehearsal-only mode, and when YouTube already has this
// exact image (youtube.thumbnailSha256).
async function autoThumbnail(db, ref, token = null) {
  try {
    const data = (await ref.get()).data();
    if (!data || data.rehearsal === true || process.env.STREAM_REHEARSAL_ONLY === "1") return null;
    const y = data.youtube || {};
    if (!y.broadcastId || OFF_AIR_ENDED.includes(y.lifecycleStatus)) return null;
    const md = require("./metadata");
    const t = await md.thumbnailForBroadcast(db, data.kind === "national" ? md.NATIONAL_KEY : data.gameId);
    if (!t) return null;
    if (y.thumbnailSha256 === t.sha256) return { skipped: "already uploaded" };
    try {
      await yt.setThumbnail(token || (await yt.accessToken(db)), y.broadcastId, t.png);
    } catch (e) {
      const msg = String(e.message || e).slice(0, 300);
      await ref.update({ "youtube.thumbnailError": msg, updatedAt: FieldValue.serverTimestamp() });
      console.error(`stream-manager auto-thumbnail failed id=${ref.id}: ${msg}`);
      return { error: msg };
    }
    await ref.update({ "youtube.thumbnailSha256": t.sha256, "youtube.thumbnailVersion": t.version, "youtube.thumbnailUploadedAt": Date.now(), "youtube.thumbnailError": null, updatedAt: FieldValue.serverTimestamp() });
    console.log(`stream-manager auto-thumbnail id=${ref.id}`);
    return { uploaded: true };
  } catch (e) {
    console.error(`stream-manager auto-thumbnail skipped id=${ref.id}: ${String(e.message || e).slice(0, 200)}`);
    return { error: String(e.message || e).slice(0, 300) };
  }
}
const OFF_AIR_ENDED = ["complete", "revoked"];

// After a thumbnail is saved: push it to every real broadcast that uses it
// and is already created on YouTube. key: a CFBD game id or "national".
async function syncSavedThumbnail(db, key) {
  const md = require("./metadata");
  const q = key === md.NATIONAL_KEY
    ? db.collection("broadcasts").where("kind", "==", "national")
    : db.collection("broadcasts").where("gameId", "==", String(key));
  const docs = (await q.get()).docs.filter((d) => {
    const x = d.data();
    return x.rehearsal !== true && x.youtube?.broadcastId && !OFF_AIR_ENDED.includes(x.youtube.lifecycleStatus)
      && (key !== md.NATIONAL_KEY || x.auto?.open);
  });
  const out = [];
  for (const d of docs) out.push({ id: d.id, ...((await autoThumbnail(db, d.ref)) || { skipped: true }) });
  return out;
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
  deriveStatus, defaultTitle, defaultDescription, cleanPrivacy, cleanText, loadRecord, settings, refreshStatuses, ON_AIR, OFF_AIR,
  recordName, nationalTitle, nationalDescription,
  assertConfirmedOffAir, UNCONFIRMED_MSG,
  createRecord, updateRecord, deleteRecord, youtubeCreate, youtubeRefresh, youtubeThumbnail, syncSavedThumbnail, channelStatus, setWorkerStream,
};
