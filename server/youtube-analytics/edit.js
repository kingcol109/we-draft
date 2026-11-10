// server/youtube-analytics/edit.js
//
// King Cold Sports' edit connection: lets the admin put a thumbnail made in
// Admin → Videos → Graphics → Thumbnail straight onto one of the channel's
// videos (ThumbLibrary.jsx → api/youtube-analytics.js "set-thumbnail"), and
// records it on the saved thumbnail, so Thumb Analytics knows exactly when it
// went up. No uploads of videos: a project that hasn't passed YouTube's API
// audit can only upload private videos; editing an uploaded one doesn't need it.
//
// A third, separate authorization (never shared):
//   - Stream Manager (server/stream-manager/youtube.js) — the We-Draft .com
//     channel, youtube.force-ssl.
//   - YouTube Analytics (google.js) — King Cold Sports, read-only.
//   - this one — King Cold Sports, youtube.force-ssl (edit a video's
//     thumbnail, title, description). Refused unless the channel picked is the
//     analytics channel (ytAnalytics/status.channelId).
// Same OAuth client and redirect URI as the analytics sign-in
// (<site>/api/youtube-analytics); the sign-in state says which it is.
//
// Stored: ytAnalyticsPrivate/editToken (the encrypted refresh token; closed
// to clients); ytAnalytics/status.edit — { connected, channelId,
// channelTitle, connectedAt, connectedBy, needsReconnect, lastError }, no
// secrets, for the admin page.

const crypto = require("crypto");
const { encrypt, decrypt } = require("../stream-manager/youtube");
const g = require("./google");

const EDIT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const TOKEN = "ytAnalyticsPrivate/editToken";
const stateDoc = (nonce) => `ytAnalyticsPrivate/oauth_${nonce}`;
const STATE_TTL_MS = 10 * 60 * 1000;
const API = "https://www.googleapis.com/youtube/v3";
const THUMB_MAX = 2 * 1024 * 1024;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const err = g.httpError;
const fetchT = (url, opts, what) => fetch(url, { ...opts, signal: AbortSignal.timeout(30e3) })
  .catch((e) => { throw err(504, `${what} didn't respond (${e.name === "TimeoutError" ? "timed out" : "network error"}).`); });
const clientCreds = () => {
  const id = process.env.YOUTUBE_CLIENT_ID || process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const secret = process.env.YOUTUBE_CLIENT_SECRET || process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw err(500, "YouTube OAuth isn't configured on the server.");
  return { id, secret };
};
const setStatus = (db, edit) => db.doc(g.STATUS).set({ edit }, { merge: true });

// The channel this may edit: the analytics one (King Cold Sports).
async function editChannel(db) {
  const st = (await db.doc(g.STATUS).get()).data() || {};
  const id = st.channelId || process.env.YOUTUBE_CHANNEL_ID || null;
  if (!id) throw err(409, "Set the channel in Admin → YouTube Analytics first.");
  return id;
}

async function startEditOAuth(db, req, uid) {
  const { id } = clientCreds();
  encrypt("probe");
  await editChannel(db);
  const nonce = crypto.randomBytes(24).toString("hex");
  const redirect = g.redirectUri(req);
  await db.doc(stateDoc(nonce)).set({ uid, redirect, kind: "edit", createdAt: Date.now() });
  const p = new URLSearchParams({
    client_id: id, redirect_uri: redirect, response_type: "code", scope: EDIT_SCOPE,
    access_type: "offline", prompt: "select_account consent", state: nonce,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// Is this sign-in state an edit one? (The callback is shared with the analytics sign-in.)
async function isEditState(db, state) {
  if (!/^[a-f0-9]{48}$/.test(String(state || ""))) return false;
  const s = await db.doc(stateDoc(state)).get();
  return s.exists && s.data().kind === "edit";
}

async function revoke(token) {
  await fetchT(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }, "Google revoke").catch(() => {});
}

async function finishEditOAuth(db, { code, state, error }) {
  const ref = db.doc(stateDoc(state));
  const st = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) tx.delete(ref);
    return s.exists ? s.data() : null;
  });
  if (!st || st.kind !== "edit" || Date.now() - st.createdAt > STATE_TTL_MS) throw err(400, "This YouTube sign-in link expired. Start again from the Thumbnail tab.");
  if (error) throw err(400, `Google sign-in was cancelled (${String(error).slice(0, 60)}).`);
  if (!code) throw err(400, "Google didn't return an authorization code.");
  const { id, secret } = clientCreds();
  const r = await fetchT("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: st.redirect, grant_type: "authorization_code" }),
  }, "Google token exchange");
  const tok = await r.json().catch(() => ({}));
  if (!r.ok) throw err(400, `Google token exchange failed: ${tok.error_description || tok.error || r.status}`);
  if (!String(tok.scope || "").split(" ").includes(EDIT_SCOPE)) throw err(400, "The permission to manage YouTube videos wasn't granted. Connect again and allow it.");
  if (!tok.refresh_token) throw err(400, "Google didn't return a refresh token. Connect again.");
  // Only King Cold Sports: the channel picked has to be the analytics one.
  const want = await editChannel(db);
  const ch = await fetchT(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${tok.access_token}` } }, "YouTube channels.list");
  const cj = await ch.json().catch(() => ({}));
  const channel = cj.items?.[0];
  if (!channel || channel.id !== want) {
    await revoke(tok.refresh_token);
    throw err(400, `That sign-in is for ${channel?.snippet?.title ? `"${channel.snippet.title}"` : "another channel"}, not the analytics channel. Connect again and pick King Cold Sports (its Brand Account).`);
  }
  const { FieldValue } = require("firebase-admin/firestore");
  await db.doc(TOKEN).set({ refreshToken: encrypt(tok.refresh_token), channelId: channel.id, updatedAt: FieldValue.serverTimestamp() });
  cached = { token: tok.access_token, exp: Date.now() + ((tok.expires_in || 3600) - 120) * 1000 };
  const edit = { connected: true, channelId: channel.id, channelTitle: channel.snippet?.title || null, connectedAt: Date.now(), connectedBy: st.uid, needsReconnect: false, lastError: null };
  await setStatus(db, edit);
  return edit;
}

async function disconnectEdit(db) {
  const snap = await db.doc(TOKEN).get();
  if (snap.exists) await revoke(decrypt(snap.data().refreshToken));
  await db.doc(TOKEN).delete();
  await setStatus(db, { connected: false, needsReconnect: false, lastError: null, channelId: null, channelTitle: null });
  cached = null;
}

let cached = null;
async function editToken(db) {
  if (cached && cached.exp > Date.now()) return cached.token;
  const snap = await db.doc(TOKEN).get();
  if (!snap.exists) throw err(409, "King Cold Sports isn't connected for editing. Click Connect in the Thumbnail tab.", { code: "edit_not_connected" });
  const { id, secret } = clientCreds();
  const r = await fetchT("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: decrypt(snap.data().refreshToken), grant_type: "refresh_token" }),
  }, "Google token refresh");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") {
      await setStatus(db, { connected: false, needsReconnect: true, lastError: "Google revoked or expired the edit authorization. Connect again." });
      throw err(409, "The King Cold Sports edit authorization expired or was revoked. Connect again.", { code: "edit_needs_reconnect" });
    }
    throw err(502, `Google token refresh failed: ${j.error_description || j.error || r.status}`);
  }
  cached = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 120) * 1000 };
  return cached.token;
}
const resetEditCache = () => { cached = null; };

// The video, and that it's the channel's.
async function ownVideo(db, token, videoId) {
  if (!VIDEO_ID.test(String(videoId || ""))) throw err(400, "Bad YouTube video id.");
  const want = await editChannel(db);
  const r = await fetchT(`${API}/videos?part=snippet&id=${videoId}`, { headers: { Authorization: `Bearer ${token}` } }, "YouTube videos.list");
  const j = await r.json().catch(() => ({}));
  const v = j.items?.[0];
  if (!r.ok) throw err(502, `YouTube videos.list failed: ${j.error?.message || r.status}`);
  if (!v) throw err(404, "YouTube has no video with that id (or it's not visible to this sign-in).");
  if (v.snippet?.channelId !== want) throw err(403, "That video isn't on the King Cold Sports channel.");
  return v;
}

// A thumbnail onto a video: { videoId, jpeg (base64), thumbId? } → { url,
// liveFrom }. The saved thumbnail (thumbId) is put on the video from now; a
// push is logged on it.
async function setVideoThumbnail(db, uid, { videoId, jpeg, thumbId }) {
  const buf = Buffer.from(String(jpeg || ""), "base64");
  if (!buf.length) throw err(400, "No image.");
  if (buf.length > THUMB_MAX) throw err(400, "The image is over YouTube's 2 MB thumbnail limit.");
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw err(400, "The thumbnail has to be a JPEG.");
  const token = await editToken(db);
  const video = await ownVideo(db, token, videoId);
  const r = await fetchT(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?${new URLSearchParams({ videoId, uploadType: "media" })}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "Content-Length": String(buf.length) }, body: buf,
  }, "YouTube thumbnails/set");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason;
    throw err(r.status >= 500 ? 502 : 400, `YouTube thumbnails/set failed: ${j.error?.message || r.status}${reason ? ` (${reason})` : ""}`);
  }
  const at = Date.now();
  if (thumbId) {
    const { FieldValue } = require("firebase-admin/firestore");
    const ref = db.doc(`ytThumbnails/${String(thumbId).replace(/\//g, "")}`);
    if ((await ref.get()).exists) {
      await ref.set({
        videoId, liveFrom: at, setOnYouTube: { at, by: uid, videoTitle: video.snippet?.title || null },
        pushes: FieldValue.arrayUnion({ at, by: uid, videoId }), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
  return { url: j.items?.[0]?.maxres?.url || j.items?.[0]?.high?.url || null, liveFrom: at, videoTitle: video.snippet?.title || null };
}

module.exports = { EDIT_SCOPE, TOKEN, startEditOAuth, isEditState, finishEditOAuth, disconnectEdit, editToken, resetEditCache, setVideoThumbnail };
