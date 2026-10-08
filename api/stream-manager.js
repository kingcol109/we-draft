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
      default: return res.status(400).json({ error: "unknown action" });
    }
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("stream-manager failed:", e.message);
    return res.status(status).json({ error: String(e.message || e).slice(0, 500) });
  }
};
