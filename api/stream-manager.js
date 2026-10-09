// api/stream-manager.js
//
// Admin → Stream Manager (components/AdminStreamManager.js). The control
// plane for We-Draft Live YouTube broadcasts; the broadcast worker
// (server/broadcast-worker) is the streaming engine and isn't touched here.
//
// POST { action, ... } — Authorization: Bearer <Firebase ID token>, and the
// caller's users/{uid} must have role "admin" (same check as
// api/portal-sync.js and firestore.rules isAdmin()):
//   channel          connection status (+ live channel check and stream list with { streams: true })
//   connect          → { url } Google consent URL for the streaming channel
//   disconnect       revoke + forget the stored authorization
//   set-stream       { streamId } the worker stream broadcasts bind to
//   create           { gameId, title, description, privacyStatus, scheduledStart, confirmPublic }
//   update           { id, title, description, privacyStatus, scheduledStart, confirmPublic } (before YouTube create)
//   delete           { id } the record only — never the YouTube broadcast
//   youtube-create   { id } create the YouTube broadcast, bind the worker stream
//   youtube-refresh  { id } pull lifecycle / privacy / ingest health from YouTube
//   vm-status        the worker VM's Compute Engine status
//   vm-start         start the worker VM (no-op if already starting/running)
//   vm-stop          { confirmLive } stop it (no-op if stopped; refuses while a
//                    broadcast is live unless confirmLive: true)
// The vm-* actions only ever touch the VM named in GCE_* env vars
// (server/stream-manager/compute.js); a request can't name another one.
//   auto-select      { scheduleId, privacyStatus, confirmPublic, rehearsal } enable a
//                    schedule26 game for automatic broadcast (nothing starts now);
//                    rehearsal: true = simulated, never touches YouTube
//   auto-national    { startAt, endAt, privacyStatus, confirmPublic, rehearsal, title?, description? }
//                    schedule national coverage (/broadcast/national) for a window
//   auto-cancel      { id, confirmEnd } disable it (ends it if on air — confirmEnd)
//   auto-retry       { id } a failed / cancelled one back to selected
//   auto-config      { slotStreamIds, maxConcurrent } stream slots / capacity
//   refresh-statuses { apply } recompute stored statuses of closed records
//                    (dry run unless apply: true; never deletes)
//   metadata-get     { scheduleId } a game's YouTube title / description draft,
//                    the editor's defaults and limits (read-only)
//   metadata-save    { scheduleId, title, description, baseVersion } save the
//                    draft (broadcastMetadata/{CFBDGameId} only — no YouTube
//                    call, no broadcast record, no automation / VM change;
//                    server/stream-manager/metadata.js)
//   metadata-thumbnail-generate { scheduleId } render a thumbnail preview from the
//                    template (server/stream-manager/thumbnail.js) — stores nothing
//   metadata-thumbnail-save     { scheduleId, sha256 } store it (broadcastThumbnails/
//                    {CFBDGameId}) when it matches the previewed image — no upload
//   youtube-thumbnail { id } upload the game's saved thumbnail to that record's
//                    created YouTube broadcast (explicit only)
// The lifecycle itself runs server-side only: api/stream-orchestrator.js
// (cron) and api/broadcast-agent.js (the VM agent) — see
// server/stream-manager/orchestrator.js.
// The broadcast list itself is read straight from Firestore (broadcasts,
// admin read in firestore.rules).
//
// GET ?code&state — Google's OAuth redirect back (the redirect URI
// registered on the OAuth client is <site>/api/stream-manager). Finishes the
// connection and sends the admin back to /admin?section=streams.
//
// Logs carry error messages only — never tokens, never stream data.

const WEB_API_KEY = "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4"; // public web key (src/firebase.js)

async function uidFromToken(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  return (await r.json()).users?.[0]?.localId || null;
}

function back(res, params) {
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(302, { Location: `/admin?section=streams&${new URLSearchParams(params)}` });
  res.end();
}

async function oauthCallback(req, res) {
  const { getFirestore } = require("../scripts/firebaseAdmin");
  const yt = require("../server/stream-manager/youtube");
  try {
    const channel = await yt.finishOAuth(getFirestore(), req.query || {});
    return back(res, { yt: "connected", channel: channel.title || channel.id });
  } catch (e) {
    console.error("stream-manager oauth failed:", e.message);
    return back(res, { yt: "error", msg: String(e.message || e).slice(0, 200) });
  }
}

module.exports = async function handler(req, res) {
  if (req.method === "GET" && (req.query?.state || req.query?.code || req.query?.error)) return oauthCallback(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  res.setHeader("Cache-Control", "no-store");
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const uid = await uidFromToken(token);
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const db = getFirestore();
    const user = (await db.collection("users").doc(uid).get()).data();
    if (user?.role !== "admin") return res.status(403).json({ error: "admins only" });

    const yt = require("../server/stream-manager/youtube");
    const bc = require("../server/stream-manager/broadcasts");
    const vm = require("../server/stream-manager/compute");
    const orch = require("../server/stream-manager/orchestrator");
    const body = req.body || {};
    switch (body.action) {
      case "channel": return res.status(200).json(await bc.channelStatus(db, { withStreams: !!body.streams }));
      case "connect": return res.status(200).json({ url: await yt.startOAuth(db, req, uid) });
      case "disconnect": await yt.disconnect(db); return res.status(200).json({ ok: true });
      case "set-stream": return res.status(200).json(await bc.setWorkerStream(db, body));
      case "create": return res.status(200).json(await bc.createRecord(db, uid, body));
      case "update": return res.status(200).json(await bc.updateRecord(db, body));
      case "delete": return res.status(200).json(await bc.deleteRecord(db, body));
      case "youtube-create": return res.status(200).json(await bc.youtubeCreate(db, body));
      case "youtube-refresh": return res.status(200).json(await bc.youtubeRefresh(db, body));
      case "vm-status": return res.status(200).json(await vm.status());
      case "vm-start": {
        const r = await vm.start(uid);
        await orch.noteManualVm(db, "vm-start", r);
        return res.status(200).json(r);
      }
      case "vm-stop": {
        const r = await vm.stop(db, uid, body);
        await orch.noteManualVm(db, "vm-stop", r, body);
        return res.status(200).json(r);
      }
      case "auto-select": return res.status(200).json(await orch.selectGame(db, uid, body));
      case "auto-national": return res.status(200).json(await orch.selectNational(db, uid, body));
      case "auto-cancel": return res.status(200).json(await orch.cancelGame(db, uid, body));
      case "auto-retry": return res.status(200).json(await orch.retryGame(db, uid, body));
      case "auto-config": return res.status(200).json(await orch.setConfig(db, uid, body));
      case "refresh-statuses": return res.status(200).json(await bc.refreshStatuses(db, body));
      case "metadata-get": return res.status(200).json(await require("../server/stream-manager/metadata").getMetadata(db, body));
      case "metadata-save": return res.status(200).json(await require("../server/stream-manager/metadata").saveMetadata(db, uid, body));
      case "metadata-thumbnail-generate": return res.status(200).json(await require("../server/stream-manager/metadata").generateThumbnail(db, body));
      case "metadata-thumbnail-save": return res.status(200).json(await require("../server/stream-manager/metadata").saveThumbnail(db, uid, body));
      case "youtube-thumbnail": return res.status(200).json(await bc.youtubeThumbnail(db, body));
      default: return res.status(400).json({ error: "unknown action" });
    }
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("stream-manager failed:", e.message);
    return res.status(status).json({ error: String(e.message || e).slice(0, 500), ...(e.fields ? { fields: e.fields } : {}) });
  }
};
