// api/instagram.js
//
// Instagram for @wedraftsite: publishing from Admin → Content → Instagram
// (components/AdminInstagram.jsx) and Admin → Content → Instagram Analytics
// (components/AdminInstagramAnalytics.jsx). Code in server/instagram/
// (README.md there: setup, the data model, the engagement rate).
//
// POST { action, ... } — Authorization: Bearer <Firebase ID token>, and the
// caller's users/{uid} must have role "admin" (as api/youtube-analytics.js):
//   status          the account (username, followers, posts) and Instagram's
//                   publishing limit — never the token
//   publish-start   { postId, slides, scheduledAt?, videos? } claim a saved
//                   post → { attempt } (scheduledAt, ms: "scheduled" instead;
//                   videos { [slide index]: "ig-videos/…" }: those slides are
//                   the post's clips, copied in rather than sent)
//   video-upload    { type, bytes } a clip's upload session → { path,
//                   uploadUrl } (the browser PUTs the file there —
//                   server/instagram/videos.js)
//   video-done      { path } the upload checked → { path, bytes }
//   video-url       { path } a link to watch it → { url, expires }
//   schedule-confirm { postId, attempt } every slide sent: the schedule's set
//   schedule-change { postId, scheduledAt } a new time
//   schedule-cancel { postId } back to draft/ready, its sent slides deleted
//   stage           { postId, attempt, index, jpeg (base64) } one slide
//   publish         { postId, attempt } containers → media_publish →
//                   { published, mediaId, permalink } or { pending: true }
//                   (call again to resume)
//   delete-post     { postId } a saved post and its staged files
//   sync            { op: "account" | "media" } one analytics run; 409 if
//                   one's running; more: true while work remains
//   set-auto        { enabled } the scheduled analytics sync on/off
// Reads (posts, igMedia, igAccountDaily, igAnalytics/*) come straight from
// Firestore (admin read in firestore.rules); only the server writes them.
//
// GET with Authorization: Bearer $CRON_SECRET — Vercel Cron (vercel.json),
// every minute: publishes a scheduled post that's due (publish.js runDue).
// At :47 each hour it also retries staged-file cleanup for published posts,
// deletes uploaded clips no saved post uses (videos.js sweepOrphans),
// then, once an admin has turned the schedule on, one analytics step
// (account every 6h, media every 6h, whichever is more overdue).
//
// The token stays server-side (server/instagram/graph.js); logs carry error
// messages only.

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

const HOUR = 3600e3;

// Every minute: a scheduled post that's due (one query when none is). Once
// an hour (at :47, as before): cleanup retries and the analytics step.
async function cronTick(db, tickAt = new Date()) {
  const pub = require("../server/instagram/publish");
  const out = {};
  try {
    out.scheduled = await pub.runDue(pub.context(db));
  } catch (e) {
    console.error("instagram schedule tick failed:", e.message);
    out.scheduled = { error: String(e.message).slice(0, 200) };
  }
  if (tickAt.getUTCMinutes() !== 47) return out;
  try {
    out.cleanup = await pub.cleanupPending(pub.context(db));
  } catch (e) {
    console.error("instagram cleanup tick failed:", e.message);
    out.cleanup = { error: String(e.message).slice(0, 200) };
  }
  try {
    out.videos = await require("../server/instagram/videos").sweepOrphans(pub.context(db));
  } catch (e) {
    console.error("instagram video sweep failed:", e.message);
    out.videos = { error: String(e.message).slice(0, 200) };
  }
  const st = (await db.doc("igAnalytics/status").get()).data() || {};
  if (!st.auto?.enabled) return { ...out, skipped: "scheduled sync is off" };
  const last = (op) => st.sync?.[op]?.lastSuccessAt || 0;
  const now = Date.now();
  const due = ["account", "media"].filter((op) => now - last(op) > 6 * HOUR - 10 * 60e3 || (st.sync?.[op]?.more && st.sync?.[op]?.state !== "error"));
  if (!due.length) return { ...out, skipped: "nothing due" };
  const op = due.sort((a, b) => last(a) - last(b))[0];
  try {
    const r = await runSync(db, op, { trigger: "cron" });
    return { ...out, op, state: r.state, counts: r.counts, more: r.more };
  } catch (e) {
    if (e.code === "locked") return { ...out, skipped: e.message };
    throw e;
  }
}

function runSync(db, op, opts) {
  const { graph, credentials } = require("../server/instagram/graph");
  return require("../server/instagram/sync").runOp(db, op, { ...opts, graph, userId: credentials().userId, budgetMs: 240e3 });
}

async function status() {
  const { graph, credentials, tokenKind } = require("../server/instagram/graph");
  const { token, userId } = credentials();
  const [acct, lim] = await Promise.all([
    graph(`/${userId}`, { params: { fields: "username,name,followers_count,media_count,profile_picture_url" } }),
    graph(`/${userId}/content_publishing_limit`, { params: { fields: "config,quota_usage" } }).catch((e) => ({ error: e.message })),
  ]);
  const l = lim.data?.[0];
  return {
    connected: true, login: tokenKind(token) === "instagram-login" ? "instagram" : "unified",
    account: { username: acct.username, name: acct.name || null, followers: acct.followers_count ?? null, posts: acct.media_count ?? null, picture: acct.profile_picture_url || null },
    publishingLimit: l ? { used: l.quota_usage ?? null, total: l.config?.quota_total ?? null, hours: l.config?.quota_duration ? l.config.quota_duration / 3600 : null } : { error: lim.error || "unavailable" },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "unauthorized" });
    try {
      const { getFirestore } = require("../scripts/firebaseAdmin");
      return res.status(200).json(await cronTick(getFirestore()));
    } catch (e) {
      console.error("instagram cron failed:", e.message);
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

    const body = req.body || {};
    const pub = () => require("../server/instagram/publish");
    const vid = () => require("../server/instagram/videos");
    switch (body.action) {
      case "status": return res.status(200).json(await status());
      case "publish-start": return res.status(200).json(await pub().startPublish(pub().context(db), uid, body));
      case "schedule-confirm": return res.status(200).json(await pub().confirmSchedule(pub().context(db), uid, body));
      case "schedule-change": return res.status(200).json(await pub().reschedule(pub().context(db), uid, body));
      case "schedule-cancel": return res.status(200).json(await pub().cancelSchedule(pub().context(db), uid, body));
      case "stage": return res.status(200).json(await pub().stageSlide(pub().context(db), uid, body));
      case "publish": return res.status(200).json(await pub().runPublish(pub().context(db), uid, body));
      case "video-upload": return res.status(200).json(await vid().startUpload(pub().context(db).bucket, { type: body.type, bytes: body.bytes, origin: req.headers.origin || null }));
      case "video-done": return res.status(200).json(await vid().finishUpload(pub().context(db).bucket, body.path));
      case "video-url": return res.status(200).json(await vid().readUrl(pub().context(db).bucket, body.path));
      case "delete-post": return res.status(200).json(await pub().deletePost(pub().context(db), uid, body));
      case "sync": {
        const op = String(body.op || "");
        if (!["account", "media"].includes(op)) return res.status(400).json({ error: "op must be account or media" });
        return res.status(200).json(await runSync(db, op, { trigger: "manual", uid }));
      }
      case "set-auto": {
        const auto = { enabled: body.enabled === true, by: uid, at: Date.now() };
        await db.doc("igAnalytics/status").set({ auto }, { merge: true });
        return res.status(200).json({ auto });
      }
      default: return res.status(400).json({ error: "unknown action" });
    }
  } catch (e) {
    // Meta's own errors are passed on (its message, code, trace id) as a 502:
    // the request was fine, Instagram said no.
    const status = e.meta ? 502 : e.status || 500;
    if (status >= 500) console.error("instagram failed:", e.message);
    return res.status(status).json({
      error: String(e.message || e).slice(0, 500),
      ...(e.code ? { code: e.code } : {}), ...(e.meta ? { meta: { code: e.metaCode ?? null, subcode: e.subcode ?? null, fbtraceId: e.fbtraceId || null } } : {}),
      ...(e.permalink ? { permalink: e.permalink } : {}),
    });
  }
};

module.exports.cronTick = cronTick;
