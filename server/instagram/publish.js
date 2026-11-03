// server/instagram/publish.js
//
// Publishing a saved post (instagramPosts/{id}, made in Admin → Content →
// Instagram) to @wedraftsite. The browser draws the slides exactly as the
// preview shows them and sends each one as a JPEG; the server does the rest.
//
//   1. start   claims the post in a transaction: status "publishing" and a
//              new attempt id. A post that's publishing, published, or was
//              marked posted by hand can't be claimed — so a second click,
//              tab or admin gets a 409, never a second post.
//   2. stage   one slide → Storage (staging.js), checked against Instagram's
//              image rules first.
//   3. run     signs the slides' URLs and creates Instagram's containers
//              (one image, or a carousel's items then the carousel), waits
//              for each to say FINISHED, then calls media_publish once and
//              reads the new media back. Only then is the post "published",
//              with its media ID, permalink and time. The staged files are
//              deleted after that, never before.
//
// run holds a lease (ig.leaseUntil) so two runs never overlap, and saves
// every container ID as soon as Instagram returns it, so a run cut short
// (Vercel's time limit, a closed tab) resumes where it was instead of
// making new containers. ig.step says how far it got:
//   staging → containers → publishing → done
// Before media_publish the step becomes "publishing": a run that finds it
// there asks the container first — PUBLISHED means Instagram has the post,
// and the media is found (recover) rather than published again.
//
// Fails → status "failed", ig.error { message, code, subcode, fbtraceId,
// step, at } as Meta said it; the staged files stay for a retry or a look.
//
// Every function takes ctx: { db, bucket, graph, userId, now, sleep,
// pollMs } — the API builds the real one (context()); tests pass fakes.

const { graph: realGraph, credentials, httpError, sleep: realSleep } = require("./graph");
const staging = require("./staging");

const POSTS = "instagramPosts";
const MAX_SLIDES = 20;
const LEASE_MS = 290e3; // under api/instagram.js maxDuration (300s)
const RUN_BUDGET_MS = 240e3;
// Polling a container: quick at first (images take seconds), then slower.
const POLL_MS = [2000, 3000, 5000, 5000, 10000];
const CAPTION_MAX = 2200;

function context(db) {
  return {
    db,
    bucket: staging.bucket(),
    graph: realGraph,
    userId: credentials().userId,
    now: () => Date.now(),
    sleep: realSleep,
    pollMs: POLL_MS,
  };
}

// What Instagram refuses in a caption, or null.
function captionProblem(caption) {
  const c = String(caption || "");
  if (c.length > CAPTION_MAX) return `The caption is ${c.length} characters; Instagram takes ${CAPTION_MAX}.`;
  const tags = c.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length > 30) return `The caption has ${tags.length} hashtags; Instagram takes 30.`;
  const mentions = c.match(/@[A-Za-z0-9._]+/g) || [];
  if (mentions.length > 20) return `The caption has ${mentions.length} @mentions; Instagram takes 20.`;
  return null;
}

const postRef = (ctx, postId) => {
  if (!postId || typeof postId !== "string" || postId.includes("/")) throw httpError(400, "No post.");
  return ctx.db.collection(POSTS).doc(postId);
};
const metaError = (e, step, now) => ({
  message: String(e.message || e).slice(0, 500), code: e.metaCode ?? e.code ?? null, subcode: e.subcode ?? null,
  fbtraceId: e.fbtraceId || null, step, at: now,
});
// Prefixed ig.* fields for an update.
const igFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`ig.${k}`, v]));

async function containerStatus(ctx, id) {
  const r = await ctx.graph(`/${id}`, { params: { fields: "status_code,status" } });
  return { code: r.status_code, detail: r.status || "" };
}

// ── 1. start ──
async function startPublish(ctx, uid, { postId, slides } = {}) {
  const n = Number(slides);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLIDES) throw httpError(400, `A post takes 1–${MAX_SLIDES} slides.`);
  const ref = postRef(ctx, postId);
  const before = (await ref.get()).data();
  if (!before) throw httpError(404, "That post isn't saved (or was deleted).");
  // A failed attempt Instagram may have published after all (media_publish
  // was called, then something broke): settle that before anything new.
  if (before.status === "failed" && before.ig?.container && before.ig?.step === "publishing") {
    const st = await containerStatus(ctx, before.ig.container).catch(() => null);
    if (st?.code === "PUBLISHED") {
      const found = await recover(ctx, ref, before);
      if (found) return { alreadyPublished: true, ...found };
      throw httpError(409, "Instagram says this post's last attempt was published, but it can't be found on @wedraftsite. Check the account before publishing again.", { code: "published_unconfirmed" });
    }
  }
  const attempt = staging.newAttempt();
  const now = ctx.now();
  await ctx.db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p) throw httpError(404, "That post isn't saved (or was deleted).");
    if (p.status === "published" || p.ig?.mediaId) throw httpError(409, "This post is already published.", { code: "published", permalink: p.ig?.permalink || null });
    if (p.status === "posted") throw httpError(409, "This post is marked as posted by hand. Set it back to Draft to publish it.", { code: "posted" });
    if (p.status === "publishing") throw httpError(409, "This post is already publishing.", { code: "publishing" });
    if (p.ig?.error?.code === "published_unconfirmed") throw httpError(409, p.ig.error.message, { code: "published_unconfirmed" });
    const problem = captionProblem(p.caption);
    if (problem) throw httpError(400, problem);
    tx.update(ref, {
      status: "publishing",
      ig: {
        attempt, by: uid || null, startedAt: now, slides: n, step: "staging", staged: {}, files: [], children: {}, container: null,
        leaseUntil: null, error: null, prevStatus: p.status || "draft", lastError: p.ig?.error || null,
      },
    });
  });
  return { attempt };
}

// The attempt's post, or a 409 saying why it can't take this step.
async function attemptPost(ref, attempt) {
  const p = (await ref.get()).data();
  if (!p) throw httpError(404, "That post isn't saved (or was deleted).");
  if (p.status !== "publishing" || !attempt || p.ig?.attempt !== attempt) throw httpError(409, "This publish attempt is over — start again.", { code: "stale_attempt" });
  return p;
}

// ── 2. stage ──
async function stageSlide(ctx, uid, { postId, attempt, index, jpeg } = {}) {
  const ref = postRef(ctx, postId);
  const p = await attemptPost(ref, attempt);
  if (p.ig.step !== "staging") throw httpError(409, "The slides are already sent.", { code: "staged" });
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= p.ig.slides) throw httpError(400, `No slide ${index}.`);
  const buf = Buffer.from(String(jpeg || ""), "base64");
  const info = staging.checkSlide(buf);
  const path = staging.slidePath(postId, attempt, i);
  await staging.saveSlide(ctx.bucket, path, buf);
  await ref.update({ [`ig.staged.${i}`]: path });
  return { index: i, bytes: buf.length, w: info.w, h: info.h };
}

// Waits for every container to be FINISHED → "FINISHED" | "PUBLISHED" (the
// one container already published) | "pending" (out of time; resume later).
// ERROR / EXPIRED throw.
async function waitFinished(ctx, ids, deadline) {
  let round = 0;
  for (;;) {
    const sts = await Promise.all(ids.map((id) => containerStatus(ctx, id)));
    const bad = sts.find((s) => s.code === "ERROR" || s.code === "EXPIRED");
    if (bad) throw httpError(502, `Instagram couldn't process the ${ids.length > 1 ? "slides" : "image"}: ${bad.code}${bad.detail ? ` — ${bad.detail}` : ""}`, { code: `container_${bad.code.toLowerCase()}` });
    if (ids.length === 1 && sts[0].code === "PUBLISHED") return "PUBLISHED";
    if (sts.every((s) => s.code === "FINISHED" || s.code === "PUBLISHED")) return "FINISHED";
    const wait = ctx.pollMs[Math.min(round++, ctx.pollMs.length - 1)];
    if (ctx.now() + wait > deadline) return "pending";
    await ctx.sleep(wait);
  }
}

// ── 3. run ──
async function runPublish(ctx, uid, { postId, attempt } = {}) {
  const ref = postRef(ctx, postId);
  const start = ctx.now();
  let p;
  // The lease: one run at a time.
  await ctx.db.runTransaction(async (tx) => {
    p = (await tx.get(ref)).data();
    if (p?.status === "published" && p.ig?.attempt === attempt) return;
    if (!p || p.status !== "publishing" || !attempt || p.ig?.attempt !== attempt) throw httpError(409, "This publish attempt is over — start again.", { code: "stale_attempt" });
    if (p.ig.leaseUntil && p.ig.leaseUntil > start) throw httpError(409, "This post is publishing right now.", { code: "running" });
    tx.update(ref, { "ig.leaseUntil": start + LEASE_MS, "ig.runBy": uid || null });
  });
  if (p.status === "published") return done(p);
  const ig = { ...p.ig };
  const set = async (o) => { Object.assign(ig, o); await ref.update(igFields(o)); };
  const deadline = start + RUN_BUDGET_MS;
  try {
    if (ig.step === "staging") {
      const paths = Array.from({ length: ig.slides }, (_, i) => ig.staged?.[i] || ig.staged?.[String(i)] || null);
      const missing = paths.filter((x) => !x).length;
      if (missing) throw httpError(409, `${missing} of ${ig.slides} slides never arrived. Open the post and publish it again.`, { code: "not_staged" });
      for (const f of paths) if (!(await staging.exists(ctx.bucket, f))) throw httpError(409, "A staged slide is missing from Storage. Open the post and publish it again.", { code: "not_staged" });
      const lim = (await ctx.graph(`/${ctx.userId}/content_publishing_limit`, { params: { fields: "config,quota_usage" } })).data?.[0];
      if (lim && lim.config?.quota_total != null && lim.quota_usage >= lim.config.quota_total) {
        throw httpError(429, `Instagram's publishing limit is used up (${lim.quota_usage} of ${lim.config.quota_total} in 24 hours). Try again later.`, { code: "quota" });
      }
      await set({ step: "containers", files: paths, stagedAt: ctx.now() });
    }

    if (ig.step === "containers") {
      const urls = await Promise.all(ig.files.map((f) => staging.signedUrl(ctx.bucket, f, ctx.now())));
      if (ig.slides > 1) {
        const children = { ...ig.children };
        for (let i = 0; i < ig.slides; i++) {
          if (children[i]) continue;
          const c = await ctx.graph(`/${ctx.userId}/media`, { method: "POST", params: { image_url: urls[i], is_carousel_item: "true" }, retries: 0 });
          children[i] = c.id;
          await set({ children: { ...children } });
        }
        const ids = Array.from({ length: ig.slides }, (_, i) => children[i]);
        if (!ig.container) {
          const items = await waitFinished(ctx, ids, deadline);
          if (items === "pending") return await pending(ref, ig);
          const c = await ctx.graph(`/${ctx.userId}/media`, { method: "POST", params: { media_type: "CAROUSEL", children: ids.join(","), caption: p.caption || "" }, retries: 0 });
          await set({ container: c.id });
        }
      } else if (!ig.container) {
        const c = await ctx.graph(`/${ctx.userId}/media`, { method: "POST", params: { image_url: urls[0], caption: p.caption || "" }, retries: 0 });
        await set({ container: c.id });
      }
      const st = await waitFinished(ctx, [ig.container], deadline);
      if (st === "pending") return await pending(ref, ig);
      // From here on, the container may become a post: mark it first.
      await set({ step: "publishing", publishCalledAt: ctx.now() });
    }

    if (ig.step === "publishing" && !ig.mediaId) {
      const st = await containerStatus(ctx, ig.container);
      if (st.code === "PUBLISHED") {
        const found = await recover(ctx, ref, { ...p, ig });
        if (found) return found;
        throw httpError(409, "Instagram says this post was published, but it can't be found on @wedraftsite. Check the account before publishing again.", { code: "published_unconfirmed" });
      }
      if (st.code !== "FINISHED") throw httpError(502, `Instagram's container is ${st.code}${st.detail ? ` — ${st.detail}` : ""}.`, { code: `container_${String(st.code).toLowerCase()}` });
      const r = await ctx.graph(`/${ctx.userId}/media_publish`, { method: "POST", params: { creation_id: ig.container }, retries: 0 });
      if (!r?.id) throw httpError(502, "Instagram didn't return the published post's ID.", { code: "no_media_id" });
      await set({ mediaId: r.id });
    }
    return await confirm(ctx, ref, { ...p, ig });
  } catch (e) {
    // Published is published: a failure after Instagram returned the media
    // ID is a bookkeeping problem, never a "failed" post.
    if (ig.mediaId) return await confirm(ctx, ref, { ...p, ig }).catch(() => ({ published: true, mediaId: ig.mediaId, permalink: null }));
    await ref.update({ status: "failed", "ig.error": metaError(e, ig.step, ctx.now()), "ig.leaseUntil": null }).catch((er) => console.error("instagram publish: couldn't record the failure:", er.message));
    throw e;
  }
}

async function pending(ref, ig) {
  await ref.update({ "ig.leaseUntil": null });
  return { pending: true, step: ig.step };
}

const done = (p) => ({ published: true, mediaId: p.ig?.mediaId || null, permalink: p.ig?.permalink || null, cleanup: p.ig?.cleanup || null });

// Instagram has the post (ig.mediaId): read it back, mark the post
// published, link the media to the post and its players (igMedia), then
// clear the staged files.
async function confirm(ctx, ref, p) {
  const ig = p.ig;
  let media = null;
  try {
    media = await ctx.graph(`/${ig.mediaId}`, { params: { fields: "id,permalink,timestamp,media_type,media_product_type" } });
  } catch (e) {
    console.error("instagram publish: published, but reading it back failed:", e.message);
  }
  const at = media?.timestamp ? Date.parse(media.timestamp) : ctx.now();
  await ref.update({
    status: "published",
    ...igFields({
      step: "done", mediaId: ig.mediaId, permalink: media?.permalink || null, publishedAt: new Date(at).toISOString(), publishedAtMs: at,
      mediaType: media?.media_type || (ig.slides > 1 ? "CAROUSEL_ALBUM" : "IMAGE"), error: null, leaseUntil: null, cleanup: "pending",
    }),
  });
  await ctx.db.collection("igMedia").doc(ig.mediaId).set({
    id: ig.mediaId, postId: ref.id, postType: p.type || null, postName: p.name || null, playerIds: Array.isArray(p.playerIds) ? p.playerIds : [],
    subject: p.subject || null, publishedVia: "we-draft", linkedAt: ctx.now(),
    ...(media?.permalink ? { permalink: media.permalink } : {}),
  }, { merge: true });
  const cleanup = await cleanupPost(ctx, ref);
  return { published: true, mediaId: ig.mediaId, permalink: media?.permalink || null, publishedAt: new Date(at).toISOString(), cleanup };
}

// The post's staged files deleted — only for a published post. → "done" |
// "pending" (some wouldn't delete; the scheduled run tries again).
async function cleanupPost(ctx, ref) {
  const p = (await ref.get()).data();
  if (p?.status !== "published") return null;
  try {
    const r = await staging.deletePostFiles(ctx.bucket, ref.id);
    const state = r.failed.length ? "pending" : "done";
    await ref.update(igFields({ cleanup: state, cleanedAt: ctx.now(), cleanupFailed: r.failed.length }));
    return state;
  } catch (e) {
    console.error("instagram cleanup failed:", ref.id, e.message);
    await ref.update(igFields({ cleanup: "pending", cleanupError: String(e.message).slice(0, 200) })).catch(() => {});
    return "pending";
  }
}

// Published posts whose files didn't all delete — retried from the cron.
async function cleanupPending(ctx, max = 20) {
  const snap = await ctx.db.collection(POSTS).where("ig.cleanup", "==", "pending").limit(max).get();
  const out = { tried: 0, done: 0 };
  for (const d of snap.docs) {
    out.tried++;
    if ((await cleanupPost(ctx, d.ref)) === "done") out.done++;
  }
  return out;
}

// The container is PUBLISHED but the media ID was never saved: the account's
// newest media, published since the attempt and with this caption.
async function recover(ctx, ref, p) {
  const since = (p.ig?.publishCalledAt || p.ig?.startedAt || 0) - 120e3;
  const list = (await ctx.graph(`/${ctx.userId}/media`, { params: { fields: "id,caption,timestamp", limit: 10 } })).data || [];
  const hit = list.find((m) => Date.parse(m.timestamp) >= since && String(m.caption || "").trim() === String(p.caption || "").trim());
  if (!hit) {
    await ref.update({ status: "failed", "ig.error": metaError(httpError(409, "Instagram says this was published, but it can't be found on @wedraftsite. Check the account before publishing again.", { code: "published_unconfirmed" }), "publishing", ctx.now()), "ig.leaseUntil": null });
    return null;
  }
  await ref.update(igFields({ mediaId: hit.id, step: "publishing" }));
  return confirm(ctx, ref, { ...p, ig: { ...p.ig, mediaId: hit.id } });
}

// A post deleted from the list, its staged files with it. Not while it's
// publishing; a file that won't delete keeps the post (try again).
async function deletePost(ctx, uid, { postId } = {}) {
  const ref = postRef(ctx, postId);
  const p = (await ref.get()).data();
  if (!p) return { deleted: true };
  if (p.status === "publishing") throw httpError(409, "This post is publishing — wait for it to finish.", { code: "publishing" });
  const r = await staging.deletePostFiles(ctx.bucket, postId);
  if (r.failed.length) throw httpError(502, `${r.failed.length} staged file${r.failed.length === 1 ? "" : "s"} wouldn't delete, so the post was kept. Try again.`);
  await ref.delete();
  return { deleted: true, files: r.deleted };
}

module.exports = { POSTS, MAX_SLIDES, LEASE_MS, POLL_MS, context, captionProblem, startPublish, stageSlide, runPublish, cleanupPost, cleanupPending, deletePost, recover };
