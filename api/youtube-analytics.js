// api/youtube-analytics.js
//
// Admin → YouTube Analytics (components/AdminYouTubeAnalytics.js). Code in
// server/youtube-analytics/ (README.md there has setup and the data model).
//
// POST { action, ... } — Authorization: Bearer <Firebase ID token>, and the
// caller's users/{uid} must have role "admin" (same check as
// api/stream-manager.js and firestore.rules isAdmin()):
//   config         which server settings exist (booleans only) + redirect URI
//   connect        → { url } Google consent URL (yt-analytics.readonly)
//   disconnect     revoke + forget the stored authorization
//   set-channel    { channel } @handle / channel URL / UC… ID
//   sync           { op: "videos" | "analytics" | "history" } one run; 409 if
//                  any sync is already running. history returns more: true
//                  while backfill remains (the page calls it again)
//   set-auto       { enabled } turn the scheduled sync on/off
//   associate      { videoId, add: [playerId], remove: [playerId] }
//   ignore         { videoId, ignored }
//   publish        { videoId, confirm: true, tags } add to the public site
//   traffic        { videoId } one video's traffic sources
//   studio-import  { csv, fileName, from, to, preview } impressions/CTR from a
//                  YouTube Studio export (server/youtube-analytics/studio.js);
//                  preview: true parses and matches without saving
// Reads (status, videos, daily rows, rollups) come straight from Firestore
// (admin read in firestore.rules); every write goes through here.
//
// GET ?code&state — Google's OAuth redirect back. The redirect URI to
// register on the OAuth client is <site>/api/youtube-analytics
// (production: https://we-draft.com/api/youtube-analytics).
//
// GET with Authorization: Bearer $CRON_SECRET — Vercel Cron (vercel.json):
// one scheduled step, only when an admin has turned the schedule on.
//
// Logs carry error messages only — never tokens.

const crypto = require("crypto");
const WEB_API_KEY = "AIzaSyCdxYPX6WjKEd_x8nKPqpXuqPAsE6k8op4"; // public web key (src/firebase.js)

async function uidFromToken(idToken) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  return (await r.json()).users?.[0]?.localId || null;
}

function cronAuthorized(header, secret) {
  if (!secret) return false;
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(header || ""), h(`Bearer ${secret}`));
}

function back(res, params) {
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(302, { Location: `/admin?section=youtube&${new URLSearchParams(params)}` });
  res.end();
}

async function oauthCallback(req, res) {
  const { getFirestore } = require("../scripts/firebaseAdmin");
  const g = require("../server/youtube-analytics/google");
  try {
    const conn = await g.finishOAuth(getFirestore(), req.query || {});
    return back(res, { yta: "connected", ...(conn.channelVerified === false ? { warn: "channel" } : {}) });
  } catch (e) {
    console.error("youtube-analytics oauth failed:", e.message);
    return back(res, { yta: "error", msg: String(e.message || e).slice(0, 200) });
  }
}

const HOUR = 3600e3;
// One step per cron tick, so a tick never runs past maxDuration: the most
// overdue of videos (every 3h), analytics (daily), history (daily, or until
// the backfill is finished).
async function cronTick(db) {
  const st = (await db.doc("ytAnalytics/status").get()).data() || {};
  if (!st.auto?.enabled) return { skipped: "scheduled sync is off" };
  if (!st.channelId && !process.env.YOUTUBE_CHANNEL_ID) return { skipped: "no channel set" };
  const last = (op) => st.sync?.[op]?.lastSuccessAt || 0;
  const now = Date.now();
  let op = null;
  if (now - last("videos") > 3 * HOUR - 10 * 60e3) op = "videos";
  else if (now - last("analytics") > 20 * HOUR) op = "analytics";
  else if (now - last("history") > 20 * HOUR || (st.backfill?.remaining > 0 && st.sync?.history?.state !== "error")) op = "history";
  if (!op) return { skipped: "nothing due" };
  const { runOp } = require("../server/youtube-analytics/runs");
  try {
    const r = await runOp(db, op, { trigger: "cron", budgetMs: 240e3 }, opFn(op));
    return { op, state: r.state, counts: r.counts };
  } catch (e) {
    if (e.code === "locked") return { skipped: e.message };
    throw e;
  }
}

function opFn(op) {
  if (op === "videos") return require("../server/youtube-analytics/videos").syncVideos;
  if (op === "analytics") return require("../server/youtube-analytics/analytics").syncAnalytics;
  return require("../server/youtube-analytics/history").syncHistory;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET" && (req.query?.state || req.query?.code || req.query?.error)) return oauthCallback(req, res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "unauthorized" });
    try {
      const { getFirestore } = require("../scripts/firebaseAdmin");
      return res.status(200).json(await cronTick(getFirestore()));
    } catch (e) {
      console.error("youtube-analytics cron failed:", e.message);
      return res.status(500).json({ error: "tick failed", detail: String(e.message || e).slice(0, 300) });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const uid = await uidFromToken(token);
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const { getFirestore } = require("../scripts/firebaseAdmin");
    const db = getFirestore();
    const user = (await db.collection("users").doc(uid).get()).data();
    if (user?.role !== "admin") return res.status(403).json({ error: "admins only" });

    const g = require("../server/youtube-analytics/google");
    const body = req.body || {};
    switch (body.action) {
      case "config": return res.status(200).json(g.configCheck(req));
      case "connect": return res.status(200).json({ url: await g.startOAuth(db, req, uid) });
      case "disconnect": await g.disconnect(db); return res.status(200).json({ ok: true });
      case "set-channel": return res.status(200).json(await require("../server/youtube-analytics/videos").setChannel(db, uid, body.channel));
      case "sync": {
        const op = String(body.op || "");
        if (!["videos", "analytics", "history"].includes(op)) return res.status(400).json({ error: "op must be videos, analytics or history" });
        const { runOp } = require("../server/youtube-analytics/runs");
        const r = await runOp(db, op, { trigger: "manual", uid, budgetMs: 240e3 }, opFn(op));
        return res.status(200).json(r);
      }
      case "set-auto": {
        const auto = { enabled: body.enabled === true, by: uid, at: Date.now() };
        await db.doc("ytAnalytics/status").set({ auto }, { merge: true });
        return res.status(200).json({ auto });
      }
      case "associate": return res.status(200).json(await require("../server/youtube-analytics/associations").associate(db, uid, body));
      case "ignore": return res.status(200).json(await require("../server/youtube-analytics/associations").setIgnored(db, uid, body));
      case "publish": return res.status(200).json(await require("../server/youtube-analytics/associations").publishToSite(db, uid, body));
      case "studio-import": {
        const { runOp } = require("../server/youtube-analytics/runs");
        const studio = require("../server/youtube-analytics/studio");
        // A preview writes nothing, so it doesn't take the sync lock.
        if (body.preview) return res.status(200).json(await studio.importStudio({ db, uid, counts: {}, inc() {}, error() {} }, body));
        return res.status(200).json(await runOp(db, "studio", { trigger: "manual", uid, budgetMs: 60e3 }, (ctx) => studio.importStudio(ctx, body)));
      }
      case "traffic": return res.status(200).json(await require("../server/youtube-analytics/analytics").videoTrafficSources(db, body.videoId));
      default: return res.status(400).json({ error: "unknown action" });
    }
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("youtube-analytics failed:", e.message);
    return res.status(status).json({ error: String(e.message || e).slice(0, 500), ...(e.code ? { code: e.code } : {}) });
  }
};

module.exports.cronTick = cronTick;
