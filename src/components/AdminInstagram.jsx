// src/components/AdminInstagram.jsx
//
// Admin → Content → Instagram: 1080×1350 posts, drawn by
// utils/instagram/posts.js (SVG — the same a server can draw; see
// scripts/renderInstagram.mjs), rendered here to PNG for upload.
//   Create a post  the default: a blank canvas the admin builds from players,
//                logos, text, images and shapes (utils/instagram/custom.js;
//                CustomPostMaker below).
//   Weekly Mock  a class's published week as a carousel: round 1 over three
//                slides (10, 10, 12 picks), then a slide a round; each slide
//                one PNG, with a caption to copy.
//   Spotlight    a prospect in two slides: the cover (his action shot, school,
//                position, height, weight; an ADVANCE SCOUTING badge for a
//                class past the next draft) and his scouting report as his
//                player page has it (utils/instagram/spotlight.js).
// Wherever a player's photo is drawn, it can be made bigger or smaller and
// moved (PhotoAdjust — or dragged on the preview).
// Any post can be saved (SaveBar) and opened again from Saved posts — see
// instagramPosts below — to edit, or published to @wedraftsite: Publish to
// Instagram sends the slides exactly as previewed (as JPEGs) to
// api/instagram.js, which posts them (server/instagram/publish.js) and
// records the post's Instagram media ID and permalink on it.
//   Player       one prospect over one of his action shots (Admin → Content
//                → Photos), with a kicker and up to three chips (his class
//                rank, his Weekly Mock pick, his grade — or typed).
//   Portal       a player entering the transfer portal, or transferring to a
//                new school: one image or a carousel, two different looks
//                (utils/instagram/transfer.js; TransferMaker below).
// Each of the carousel's round-1 slides (picks 1–16, 17–32) features one of
// its picks over his action shot, its plain backdrop taken out
// (utils/instagram/knockout.js) so he stands on the slide's own colors.
// The font is the bundled Bebas Neue (assets/fonts, SIL OFL), embedded in the
// SVG, since an SVG drawn as an image can't reach the page's fonts. Images
// are read as data URIs for the same reason (and so the PNG exports).
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, documentId, getDoc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { sanitizeImgur } from "./MarginAds";
import { BLUE, GOLD, field, label, btn, linkBtn, fileName, fmtET, envFor, loadFeatureImage, svgToJpegBase64, downloadSvg, focusFor, FOCUS, NO_ADJUST, PhotoAdjust, useDragAdjust, useSvgUrls, toLocalInput, fromLocalInput, nextHour, WhenPicker, svgToBlob, shrinkToFit, thumbOf } from "./SocialMakerKit";
import { headshotsFor } from "./AdminSideGraphics";
import { fetchNflBranding } from "../utils/draftProfileData";
import { getSiteSnapshot } from "../utils/siteSnapshots";
import { WEEKLY_YEARS, MAIN_WEEKLY_YEAR, loadWeeklyMockSummary, weeklyMockDate } from "../utils/weeklyMockNews";
import { NFL_TEAMS } from "../utils/coachHistory";
import {
  IG_W, IG_H, IG_MAX_SLIDES, mockSlides, mockInput, mockCaption, mockSlidePlan, playerPost, playerInput, playerCaption,
} from "../utils/instagram/posts";
import { spotlightSlides, spotlightInput, spotlightCaption, spotlightImageUrls, scoutingReport, spotlightFrame, espnStats, editedStats, statsSeed, MAX_STAT_TILES } from "../utils/instagram/spotlight";
import { fetchEspnCareer } from "./PlayerEspnStats";
import { customInput, customSlides, customCaption, customImageUrls, customCutoutUrls, customPlayerIds, layerBox, newLayer, blankSlide, LAYER_LABELS } from "../utils/instagram/custom";
import { transferSlides, transferInput, transferCaption, transferImageUrls, transferFrame } from "../utils/instagram/transfer";
import { shortInput, shortFrame, shortEnd, shortImageUrls, SHORT_W, SHORT_H } from "../utils/instagram/short";
import { igApi, uploadVideo, videoInfo } from "../utils/instagram/api";
import { postToSite, siteTitle, siteShortTitle, siteSlug } from "../utils/instagram/sitePost";
import { X_MAX_MEDIA, textFromCaption } from "../utils/x/posts";
import { MEDIA_MAX_CHARS, saveXPost } from "../utils/x/store";
import WdLogo from "../assets/Logo2.png";
import WdBadge from "../assets/wd-badge.png";
import ClassLogo2027 from "../assets/class-logo-2027.png";
import ClassLogo2028 from "../assets/class-logo-2028.png";
import ClassLogo2029 from "../assets/class-logo-2029.png";

const CLASS_POSITIONS = ["QB", "RB", "WR", "TE", "OL", "DL", "EDGE", "LB", "DB"];


// A college logo by player id ({ lg, ld }) and each player's class-board row,
// from a class's position snapshots.
const classCache = {};
function loadClassRows(year) {
  if (!classCache[year]) {
    classCache[year] = Promise.all(CLASS_POSITIONS.map((pos) => getSiteSnapshot(`class_${year}_${pos}`).then((s) => (s?.rows || []).map((r) => ({ ...r, pos })))))
      .then((lists) => Object.fromEntries(lists.flat().map((r) => [r.i, r])));
  }
  return classCache[year];
}

// The round-1 slides' picks, by part ({ 1: [...], 2: [...] }) — the ones each can feature.
const roundOneParts = (week) => Object.fromEntries(mockSlidePlan(week.picks.filter((p) => p.player)).filter((sl) => sl.part).map((sl) => [sl.part, sl.picks]));
// Action shots by player id (playerPhotos action[]), 30 ids a query.
async function actionShotsFor(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(collection(db, "playerPhotos"), where(documentId(), "in", ids.slice(i, i + 30)))).catch(() => null);
    (snap?.docs || []).forEach((d) => { out[d.id] = d.data().action || []; });
  }
  return out;
}
// ── Saved posts ──
// instagramPosts/{id} (admin only — firestore.rules):
//   { type: "custom" | "mock" | "spotlight" | "player" | "portal" | "transfer" | "short", name, status, state (the
//     maker's settings, enough to draw the post again — each maker's
//     stateNow), caption, slides (how many), thumb (slide 1 as a small JPEG
//     data URI, for the list), playerIds (the players it features — for
//     Instagram Analytics), subject ({ kind: "mock", year, weekId } |
//     { kind: "player", playerId }), createdAt, updatedAt, createdBy,
//     postedAt, ig (the server's: publishing state, Instagram's mediaId,
//     permalink, publishedAt, error — server/instagram/publish.js) }
// status: draft → ready → publishing → published | failed — the last three
// set only by the server, published only once Instagram confirms. posted:
// marked published by hand (posted outside We-Draft).
const POST_TYPES = { custom: "Create a post", mock: "Weekly Mock carousel", spotlight: "Player spotlight", player: "Player post", portal: "Portal: entered", transfer: "Portal: transferred", short: "Short (video frame)" };
const STATUS = {
  draft: ["Draft", "#8a97ab"], ready: ["Ready to Publish", "#b7791f"], scheduled: ["Scheduled", "#6d28d9"], publishing: ["Publishing", BLUE],
  published: ["Published", "#15803d"], failed: ["Failed", "#a52a1e"], posted: ["Published (by hand)", "#15803d"],
};
// What the page can set itself (firestore.rules agrees).
const CHOOSABLE = ["draft", "ready", "posted"];
const THUMB_W = 216;
const locked = (status) => status === "scheduled" || status === "publishing" || status === "published";

// Runs the post's publish (server) until Instagram is done with it: each
// call goes up to ~4 minutes and returns pending if Instagram is still
// processing, then picks up where it was.
async function runUntilDone(postId, attempt, onPhase) {
  for (let k = 0; k < 6; k++) {
    const r = await igApi("publish", { postId, attempt });
    if (!r.pending) return r;
    onPhase?.("Instagram is still processing…");
    await new Promise((res) => setTimeout(res, 15000));
  }
  return { pending: true };
}
const igLink = { color: BLUE, fontWeight: 900, fontSize: "11px", textDecoration: "none" };

// Slide 1 as a small JPEG data URI.
async function svgThumb(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const c = document.createElement("canvas");
    // The slide's own shape (a Short's is taller).
    const [, sw, sh] = svg.match(/<svg[^>]*?width="(\d+)"[^>]*?height="(\d+)"/) || [0, IG_W, IG_H];
    c.width = THUMB_W;
    c.height = Math.round((THUMB_W * Number(sh)) / Number(sw));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(url);
  }
}
// Firestore takes no undefined: the state as plain JSON.
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

// The clips a carousel takes (server/instagram/videos.js says the same).
const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

// The carousel in order: the drawn slides ({ svg }), each video ({ video:
// its ig-videos path }) put in at its place (at: its slide index).
function carouselOrder(svgs, videos = []) {
  const out = svgs.map((svg) => ({ svg }));
  [...videos].sort((a, b) => a.at - b.at).forEach((v) => out.splice(Math.min(v.at, out.length), 0, { video: v.path }));
  return out;
}
// Sends the drawn slides of a started publish (the server copies the videos itself).
async function sendSlides(postId, attempt, order, setPhase) {
  const drawn = order.filter((s) => s.svg).length;
  let k = 0;
  for (let i = 0; i < order.length; i++) {
    if (!order[i].svg) continue;
    setPhase(`Sending slide ${++k} of ${drawn}…`);
    await igApi("stage", { postId, attempt, index: i, jpeg: await svgToJpegBase64(order[i].svg) });
  }
}
const videoMapOf = (order) => Object.fromEntries(order.map((s, i) => (s.video ? [i, s.video] : null)).filter(Boolean));

// Send to X: starts an X draft from this post: its slides (the first four, X's
// most) and its caption's opening, linked back to this post. It's a separate
// post from then on, with its own text, images and time. Nothing goes to X.
const SendToXContext = createContext(null);
async function makeXDraft({ svgs, caption, name, postId, playerIds, subject, uid }) {
  const images = {};
  const media = [];
  for (let i = 0; i < Math.min(X_MAX_MEDIA, svgs.length); i++) {
    const url = URL.createObjectURL(await svgToBlob(svgs[i], "image/jpeg", 0.92));
    try {
      const { data, w, h } = await shrinkToFit(url, MEDIA_MAX_CHARS);
      images[`ig${i + 1}`] = data;
      media.push({ id: `ig${i + 1}`, kind: "instagram", alt: "", w, h });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return saveXPost(null, {
    name: `${name} (X)`, text: textFromCaption(caption), media, card: { on: false }, thumb: await thumbOf(images.ig1 || ""),
    playerIds: [...new Set((playerIds || []).filter(Boolean))], subject: plain(subject), linkedTo: [{ platform: "instagram", id: postId, label: name }], createdBy: uid || "",
  }, images);
}

// Save, or save as a new post: the post's name, then the buttons. A post
// opened from the list (or once saved) saves over itself. Publish to
// Instagram saves first, then sends these slides — the preview, as is.
// A post that's publishing or published is Instagram's now: only Save as
// new (a fresh draft) from here. videos: [{ at, path }] — uploaded clips in
// the carousel (the Spotlight's); hold: why it can't save or publish yet;
// saveOnly: save it, nothing else (a Short's frame — the video's made elsewhere).
function SaveBar({ type, defaultName, stateNow, caption, svgs, post, setPost, onSaved, setMsg, playerIds = [], subject = null, videos = [], hold = "", saveOnly = false }) {
  const { user } = useAuth();
  const sendToX = useContext(SendToXContext);
  const [name, setName] = useState(post?.name || "");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const shown = name || defaultName;
  const status = post?.status || "draft";
  const isLocked = locked(status);
  const off = busy || !svgs.length || !!hold;
  // Where it's on the site (instagramPosts.site — Post to site below).
  const [site, setSite] = useState(null);
  useEffect(() => {
    setSite(null);
    if (!post?.id || saveOnly) return;
    getDoc(doc(db, "instagramPosts", post.id)).then((d) => setSite(d.data()?.site || null)).catch(() => {});
  }, [post?.id, saveOnly]);
  // → the saved post's id (null when it couldn't save).
  const save = async (asNew, quiet = false) => {
    if (!svgs.length) return null;
    const data = {
      type, name: shown, state: plain(stateNow()), caption, slides: svgs.length + videos.length, thumb: await svgThumb(svgs[0]),
      playerIds: [...new Set(playerIds.filter(Boolean))], subject: plain(subject), updatedAt: serverTimestamp(),
      // The clips it uses (server/instagram/videos.js keeps a clip while a saved post lists it).
      videoPaths: videos.map((v) => v.path),
    };
    let id = asNew ? null : post?.id;
    if (id) await updateDoc(doc(db, "instagramPosts", id), data);
    else id = (await addDoc(collection(db, "instagramPosts"), { ...data, status: "draft", createdAt: serverTimestamp(), createdBy: user?.uid || "" })).id;
    setPost({ id, name: shown, status: asNew ? "draft" : status, ig: asNew ? null : post?.ig || null });
    if (!quiet) setMsg(`Saved "${shown}".`);
    return id;
  };
  const xDraft = async () => {
    setBusy(true);
    try {
      setPhase("Saving…");
      // A locked post's slides are already final; anything else saves first, so the link points at this version.
      const id = isLocked ? post.id : await save(false, true);
      setPhase("Making the X draft…");
      const xId = await makeXDraft({ svgs, caption, name: shown, postId: id, playerIds, subject, uid: user?.uid });
      onSaved();
      sendToX(xId);
    } catch (e) {
      setMsg(`Couldn't make the X draft: ${e.message}`);
    } finally {
      setBusy(false);
      setPhase("");
    }
  };
  // Post to site: the slides (and clips) as an article at /news/{slug}, the
  // caption its body — utils/instagram/sitePost.js. Again: the same article updated.
  // Its titles first, in a little form (siteForm): the long one the
  // article's headline, the short one its cards and — for a new article — its
  // slug with the date, as ArticlesManager.js. An article already up keeps
  // its slug; its titles come from the article itself (it may have been
  // edited in My Articles since).
  const [siteForm, setSiteForm] = useState(null);
  const openSiteForm = async () => {
    let cur = null;
    if (site?.articleId) cur = (await getDoc(doc(db, "articles", site.articleId)).catch(() => null))?.data() || null;
    const title = cur?.title || site?.title || siteTitle(caption, shown);
    setSiteForm({ title, titleShort: cur?.titleShort || site?.titleShort || siteShortTitle(title) });
  };
  const toSite = async () => {
    const title = siteForm?.title.trim();
    const titleShort = siteForm?.titleShort.trim();
    if (!title || !titleShort) return;
    setBusy(true);
    try {
      setPhase("Saving…");
      const id = isLocked ? post.id : await save(false, true);
      const r = await postToSite({ postId: id, order: carouselOrder(svgs, videos), caption, title, titleShort, playerIds, uid: user?.uid, onPhase: setPhase });
      setSite({ ...r, title, titleShort });
      setSiteForm(null);
      setMsg(site ? "Updated on the site." : `On the site: we-draft.com/news/${r.slug}`);
      onSaved();
    } catch (e) {
      setMsg(`Couldn't put it on the site: ${e.message}`);
    } finally {
      setBusy(false);
      setPhase("");
    }
  };
  const saveClick = async (asNew) => {
    setBusy(true);
    try { await save(asNew); onSaved(); } catch (e) { setMsg(`Couldn't save: ${e.message}`); } finally { setBusy(false); }
  };
  // The post as the server left it.
  const reload = async (id) => {
    const d = await getDoc(doc(db, "instagramPosts", id)).catch(() => null);
    if (d?.exists()) setPost({ id, name: d.data().name, status: d.data().status, ig: d.data().ig || null });
  };
  const publish = async () => {
    const order = carouselOrder(svgs, videos);
    const n = order.length;
    if (!svgs.length || busy || hold) return;
    if (!window.confirm(`Publish this ${n > 1 ? `${n}-slide carousel` : "post"} to @wedraftsite now?\n\nIt goes live on Instagram right away, with the caption as written.`)) return;
    setBusy(true);
    let id = null;
    try {
      setPhase("Saving…");
      id = await save(false, true);
      setPhase("Starting…");
      const start = await igApi("publish-start", { postId: id, slides: n, videos: videoMapOf(order) });
      let r = start;
      if (!start.alreadyPublished) {
        await sendSlides(id, start.attempt, order, setPhase);
        setPhase("Publishing — Instagram is processing…");
        r = await runUntilDone(id, start.attempt, setPhase);
      }
      setMsg(r.pending ? "Instagram is still processing it. Saved posts shows it as Publishing — Resume it from there." : "Published to Instagram.");
    } catch (e) {
      setMsg(`Couldn't publish: ${e.message}`);
    } finally {
      if (id) await reload(id);
      setBusy(false);
      setPhase("");
      onSaved();
    }
  };
  // Schedule: the same slides sent now (this browser won't be here at the
  // time), and the server publishes them then. A send that fails part-way
  // calls the schedule off, so nothing half-sent waits to fail.
  const [when, setWhen] = useState("");
  const scheduleIt = async () => {
    const order = carouselOrder(svgs, videos);
    const n = order.length;
    const at = fromLocalInput(when);
    if (!svgs.length || busy || hold || !Number.isFinite(at)) return;
    if (!window.confirm(`Schedule this ${n > 1 ? `${n}-slide carousel` : "post"} for ${fmtET(at)}?\n\nIt posts to @wedraftsite then, with the slides and caption as they are now.`)) return;
    setBusy(true);
    let id = null;
    let started = false;
    try {
      setPhase("Saving…");
      id = await save(false, true);
      const start = await igApi("publish-start", { postId: id, slides: n, scheduledAt: at, videos: videoMapOf(order) });
      started = true;
      await sendSlides(id, start.attempt, order, setPhase);
      await igApi("schedule-confirm", { postId: id, attempt: start.attempt });
      setWhen("");
      setMsg(`Scheduled for ${fmtET(at)}.`);
    } catch (e) {
      if (started) await igApi("schedule-cancel", { postId: id }).catch(() => {});
      setMsg(`Couldn't schedule it: ${e.message}`);
    } finally {
      if (id) await reload(id);
      setBusy(false);
      setPhase("");
      onSaved();
    }
  };
  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc" }}>
      <div style={{ ...label, display: "flex", alignItems: "center", gap: "6px" }}>
        {post?.id ? "Saved post" : "Save this post"}
        {post?.id && <span style={{ color: STATUS[status]?.[1] || "#8a97ab" }}>· {STATUS[status]?.[0] || status}</span>}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} style={field} disabled={isLocked} />
      <div style={{ display: "flex", gap: "6px", marginTop: "6px", alignItems: "center", flexWrap: "wrap" }}>
        {!isLocked && <button onClick={() => saveClick(false)} disabled={off} style={{ ...btn(true), padding: "5px 14px", opacity: off ? 0.5 : 1 }}>{post?.id ? "Save changes" : "Save"}</button>}
        {post?.id && <button onClick={() => saveClick(true)} disabled={off} style={{ ...btn(false), padding: "5px 14px" }}>Save as new</button>}
        {!isLocked && status !== "posted" && !saveOnly && (
          <button onClick={publish} disabled={off} title="Save, then post these slides to @wedraftsite"
            style={{ ...btn(true), background: GOLD, color: "#1d2433", padding: "5px 14px", opacity: off ? 0.5 : 1 }}>
            {status === "failed" ? "Retry publishing" : "Publish to Instagram"}
          </button>
        )}
        {!isLocked && status !== "posted" && !when && !saveOnly && (
          <button onClick={() => setWhen(toLocalInput(nextHour()))} disabled={off} title="Post these slides to @wedraftsite at a time you pick"
            style={{ ...btn(false), padding: "5px 14px", opacity: off ? 0.5 : 1 }}>Schedule…</button>
        )}
        {!saveOnly && (
          <button onClick={() => (siteForm ? setSiteForm(null) : openSiteForm())} disabled={busy || !svgs.length || !!hold} title={site ? "Update the article this post made on the site" : "Make an article on the site from this post: the slides as a gallery, the caption as its text"}
            style={{ ...btn(false), padding: "5px 14px", opacity: busy || !svgs.length || hold ? 0.5 : 1 }}>{site ? "Update on site" : "Post to site"}</button>
        )}
        {site?.slug && !saveOnly && <a href={`/news/${site.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, fontSize: "11px" }}>View on site ↗</a>}
        {sendToX && !saveOnly && (
          <button onClick={xDraft} disabled={off} title="Start an X draft from this post: its first slides and caption, with its own text and time" style={{ ...btn(false), padding: "5px 14px", opacity: off ? 0.5 : 1 }}>Send to X…</button>
        )}
        {busy && <span style={{ fontSize: "11px", fontWeight: 800, color: BLUE }}>{phase || "Saving…"}</span>}
        {hold && !busy && <span style={{ fontSize: "11px", fontWeight: 800, color: "#b7791f" }}>{hold}</span>}
      </div>
      {siteForm && !saveOnly && (
        <div style={{ marginTop: "8px", padding: "8px", border: "1px solid #d5dce6", borderRadius: "6px", background: "#fff", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div>
            <div style={label}>Title</div>
            <input value={siteForm.title} onChange={(e) => setSiteForm((f) => ({ ...f, title: e.target.value }))} style={field} placeholder="The article's headline" />
          </div>
          <div>
            <div style={label}>Short title</div>
            <input value={siteForm.titleShort} onChange={(e) => setSiteForm((f) => ({ ...f, titleShort: e.target.value }))} style={field} placeholder="For cards and the link" />
          </div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", wordBreak: "break-all" }}>
            we-draft.com/news/{site?.slug || siteSlug(siteForm.titleShort, new Date())}{site?.slug ? " (stays the same)" : ""}
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button onClick={toSite} disabled={busy || !siteForm.title.trim() || !siteForm.titleShort.trim()} style={{ ...btn(true), padding: "5px 14px", opacity: busy || !siteForm.title.trim() || !siteForm.titleShort.trim() ? 0.5 : 1 }}>{site ? "Update on site" : "Post to site"}</button>
            <button onClick={() => setSiteForm(null)} disabled={busy} style={linkBtn}>Never mind</button>
          </div>
        </div>
      )}
      {when && !isLocked && (
        <div style={{ display: "flex", gap: "6px", marginTop: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <WhenPicker value={when} onChange={setWhen} />
          <button onClick={scheduleIt} disabled={busy || !!hold || !Number.isFinite(fromLocalInput(when))} style={{ ...btn(true), background: STATUS.scheduled[1], padding: "5px 14px", opacity: busy ? 0.5 : 1 }}>Schedule</button>
          <button onClick={() => setWhen("")} disabled={busy} style={linkBtn}>Never mind</button>
        </div>
      )}
      {status === "scheduled" && (
        <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 800, color: STATUS.scheduled[1] }}>
          Scheduled for {fmtET(post.ig?.scheduledAt)} — change the time or cancel it in Saved posts.
        </div>
      )}
      {status === "published" && (
        <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 800, color: "#15803d" }}>
          On Instagram{post.ig?.publishedAt ? ` since ${new Date(post.ig.publishedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
          {post.ig?.permalink && <> · <a href={post.ig.permalink} target="_blank" rel="noreferrer" style={igLink}>View on Instagram ↗</a></>}
        </div>
      )}
      {status === "publishing" && !busy && <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 800, color: BLUE }}>Publishing — follow it (or resume it) in Saved posts.</div>}
      {status === "failed" && post.ig?.error && <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 700, color: "#a52a1e" }}>Last attempt failed: {post.ig.error.message}</div>}
      {status === "posted" && <div style={{ marginTop: "6px", fontSize: "11px", fontWeight: 700, color: "#5b6b84" }}>Marked as posted by hand. Set it back to Draft in Saved posts to publish it from here.</div>}
    </div>
  );
}

function SavedPosts({ version, onOpen, setMsg }) {
  const [posts, setPosts] = useState(null);
  const [mine, setMine] = useState(0);
  useEffect(() => {
    getDocs(query(collection(db, "instagramPosts"), orderBy("updatedAt", "desc"), limit(60)))
      .then((snap) => setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => { setPosts([]); setMsg(`Couldn't load the saved posts: ${e.message}`); });
  }, [version, mine, setMsg]);
  const setStatus = async (p, status) => {
    await updateDoc(doc(db, "instagramPosts", p.id), { status, ...(status === "posted" ? { postedAt: serverTimestamp() } : {}) });
    setMine((n) => n + 1);
  };
  // A post that went through publishing may have staged slides in Storage:
  // the server deletes it with them.
  const remove = async (p) => {
    const extra = p.status === "published" ? "\n\nIt stays on Instagram — this only deletes We-Draft's copy." : "";
    if (!window.confirm(`Delete the saved post "${p.name}"?${extra}`)) return;
    if (p.ig) await igApi("delete-post", { postId: p.id });
    else await deleteDoc(doc(db, "instagramPosts", p.id));
    setMine((n) => n + 1);
  };
  // A publish left mid-way (a closed tab, Instagram slow): pick it up.
  const [resuming, setResuming] = useState("");
  const resume = async (p) => {
    setResuming(p.id);
    try {
      const r = await runUntilDone(p.id, p.ig.attempt);
      setMsg(r.pending ? "Instagram is still processing it — try Resume again in a minute." : `Published "${p.name}" to Instagram.`);
    } catch (e) {
      setMsg(`Couldn't publish "${p.name}": ${e.message}`);
    } finally {
      setResuming("");
      setMine((n) => n + 1);
    }
  };
  // A scheduled post: a new time (the picker open on it), or called off.
  const [changing, setChanging] = useState({ id: "", when: "" });
  const reschedule = async (p) => {
    const at = fromLocalInput(changing.when);
    try {
      await igApi("schedule-change", { postId: p.id, scheduledAt: at });
      setMsg(`"${p.name}" now posts ${fmtET(at)}.`);
      setChanging({ id: "", when: "" });
    } catch (e) {
      setMsg(`Couldn't change it: ${e.message}`);
    } finally {
      setMine((n) => n + 1);
    }
  };
  const cancelSchedule = async (p) => {
    if (!window.confirm(`Cancel the schedule for "${p.name}" (${fmtET(p.ig?.scheduledAt)})?\n\nIt goes back to a draft; nothing is posted.`)) return;
    try {
      await igApi("schedule-cancel", { postId: p.id });
      setMsg(`Cancelled the schedule for "${p.name}".`);
    } catch (e) {
      setMsg(`Couldn't cancel it: ${e.message}`);
    } finally {
      setMine((n) => n + 1);
    }
  };
  const when = (ts) => ts?.toDate?.()?.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) || "";
  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "10px", background: "#fff" }}>
      <div style={{ padding: "8px 12px" }}>
        <span style={{ ...label, marginBottom: 0 }}>Saved posts{posts ? ` · ${posts.length}` : ""}</span>
      </div>
      <div style={{ padding: "0 12px 10px" }}>
        {!posts && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>Loading…</div>}
        {posts && !posts.length && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>None yet. Make a post under Create and save it.</div>}
        <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" }}>
          {(posts || []).map((p) => (
            <div key={p.id} style={{ flex: "0 0 150px", border: "1px solid #e3e8ef", borderRadius: "8px", overflow: "hidden", background: "#f8fafc" }}>
              <button onClick={() => onOpen(p)} title="Open to edit" style={{ display: "block", width: "100%", border: "none", padding: 0, cursor: "pointer", background: "#0b1426" }}>
                {p.thumb ? <img src={p.thumb} alt="" style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}` }} /> : <div style={{ aspectRatio: `${IG_W} / ${IG_H}` }} />}
              </button>
              <div style={{ padding: "5px 7px" }}>
                <div style={{ fontSize: "12px", fontWeight: 900, color: "#1d2433", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>{p.name}</div>
                <div style={{ fontSize: "10px", fontWeight: 800, color: "#8a97ab" }}>{POST_TYPES[p.type] || p.type} · {p.slides || 1} slide{p.slides === 1 ? "" : "s"}</div>
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#8a97ab" }}>{when(p.updatedAt)}</div>
                {(() => {
                  const s = p.status || "draft";
                  const [text, color] = STATUS[s] || [s, "#8a97ab"];
                  if (locked(s)) {
                    return <div style={{ fontSize: "11px", fontWeight: 900, color, marginTop: "4px" }}>{s === "publishing" && resuming === p.id ? "Publishing…" : text}</div>;
                  }
                  return (
                    <select value={s} onChange={(e) => setStatus(p, e.target.value).catch((er) => setMsg(`Couldn't update it: ${er.message}`))}
                      style={{ ...field, padding: "3px 5px", fontSize: "11px", marginTop: "4px", color }}>
                      {s === "failed" && <option value="failed" disabled>Failed</option>}
                      {CHOOSABLE.map((v) => <option key={v} value={v}>{STATUS[v][0]}</option>)}
                    </select>
                  );
                })()}
                {p.status === "published" && (
                  <div style={{ fontSize: "10px", fontWeight: 700, color: "#5b6b84", marginTop: "3px" }}>
                    {p.ig?.publishedAt ? new Date(p.ig.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                    {p.ig?.permalink ? <> · <a href={p.ig.permalink} target="_blank" rel="noreferrer" style={igLink}>View ↗</a></> : " · link pending"}
                  </div>
                )}
                {p.status === "failed" && p.ig?.error && (
                  <div title={`${p.ig.error.message}${p.ig.error.fbtraceId ? `\nInstagram trace ${p.ig.error.fbtraceId}` : ""}`}
                    style={{ fontSize: "10px", fontWeight: 700, color: "#a52a1e", marginTop: "3px", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {p.ig.error.message}
                  </div>
                )}
                {p.status === "scheduled" && (
                  <div style={{ fontSize: "10px", fontWeight: 800, color: STATUS.scheduled[1], marginTop: "3px" }}>
                    {fmtET(p.ig?.scheduledAt)}
                    {p.ig?.scheduleReady === false && <div style={{ color: "#a52a1e" }}>Slides didn&apos;t all send — cancel and schedule it again.</div>}
                    {changing.id === p.id ? (
                      <div style={{ marginTop: "4px" }}>
                        <input type="datetime-local" value={changing.when} min={toLocalInput(Date.now() + 5 * 60e3)} onChange={(e) => setChanging({ id: p.id, when: e.target.value })}
                          style={{ ...field, padding: "2px 4px", fontSize: "10px" }} />
                        <div style={{ display: "flex" }}>
                          <button onClick={() => reschedule(p)} style={{ ...linkBtn, padding: "3px 0 0" }}>Save time</button>
                          <button onClick={() => setChanging({ id: "", when: "" })} style={{ ...linkBtn, padding: "3px 0 0", marginLeft: "auto", color: "#8a97ab" }}>Back</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex" }}>
                        <button onClick={() => setChanging({ id: p.id, when: toLocalInput(p.ig?.scheduledAt || nextHour()) })} style={{ ...linkBtn, padding: "3px 0 0" }}>Change time</button>
                        <button onClick={() => cancelSchedule(p)} style={{ ...linkBtn, padding: "3px 0 0", marginLeft: "auto", color: "#a52a1e" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                )}
                {p.status === "publishing" && !(p.ig?.leaseUntil > Date.now()) && resuming !== p.id && (
                  <button onClick={() => resume(p)} style={{ ...linkBtn, padding: "3px 0 0" }} title="Pick up where this publish left off">Resume publishing</button>
                )}
                <div style={{ display: "flex", marginTop: "3px" }}>
                  <button onClick={() => onOpen(p)} style={linkBtn}>{p.status === "failed" ? "Open to retry" : "Open"}</button>
                  {p.status !== "publishing" && <button onClick={() => remove(p).catch((er) => setMsg(`Couldn't delete it: ${er.message}`))} style={{ ...linkBtn, marginLeft: "auto", color: "#a52a1e" }}>Delete</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdminInstagram({ openPostId = null, onOpenInX = null }) {
  const [kind, setKind] = useState("custom");
  const [msg, setMsg] = useState("");
  // The post open in the maker (from Saved posts), and a count that starts
  // the maker over when one's opened or New is picked.
  const [opened, setOpened] = useState(null);
  const [run, setRun] = useState(0);
  const [version, setVersion] = useState(0);
  // Create (the maker) or Saved posts. The maker stays mounted behind the
  // other tab, so looking through saved posts doesn't lose a post in progress.
  const [view, setView] = useState("create");
  const start = (type, post = null) => { setKind(type); setOpened(post); setRun((n) => n + 1); setMsg(""); setView("create"); };
  const props = { setMsg, saved: opened && opened.type === kind ? opened : null, onSaved: () => setVersion((v) => v + 1) };
  // Sent here from the Content Calendar: that post, open in its maker.
  useEffect(() => {
    if (!openPostId) return;
    getDoc(doc(db, "instagramPosts", openPostId)).then((d) => {
      if (d.exists()) start(d.data().type, { id: d.id, ...d.data() });
      else setMsg("That post is gone.");
    }).catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, [openPostId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SendToXContext.Provider value={onOpenInX}>
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "4px", borderBottom: "2px solid #e3e8ef" }}>
        {[["create", "Create"], ["saved", "Saved posts"]].map(([v, t]) => (
          <button key={v} data-ig-view={v} onClick={() => { setView(v); setMsg(""); }} style={{
            border: "none", background: "none", padding: "8px 16px", marginBottom: "-2px", cursor: "pointer", fontWeight: 900, fontSize: "13px",
            color: view === v ? BLUE : "#7a8597", borderBottom: `3px solid ${view === v ? BLUE : "transparent"}`,
          }}>{t}</button>
        ))}
      </div>
      {view === "saved" && <SavedPosts version={version} onOpen={(p) => start(p.type, p)} setMsg={setMsg} />}
      <div style={{ display: view === "create" ? "flex" : "none", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ width: "280px" }}>
            <div style={label}>Template</div>
            <select value={kind} data-ig-template onChange={(e) => start(e.target.value)} style={field}>
              {Object.entries(POST_TYPES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </div>
          {opened && <span style={{ fontSize: "12px", fontWeight: 800, color: "#5b6b84", paddingBottom: "7px" }}>Editing &ldquo;{opened.name}&rdquo;</span>}
          <button onClick={() => start(kind)} title="Clear the form and start this template over" style={{ ...btn(false), padding: "5px 14px", marginBottom: "1px" }}>New post</button>
        </div>
        {kind === "custom" && <CustomPostMaker key={run} {...props} />}
        {kind === "mock" && <MockCarousel key={run} {...props} />}
        {kind === "spotlight" && <SpotlightMaker key={run} {...props} />}
        {kind === "player" && <PlayerPostMaker key={run} {...props} />}
        {(kind === "portal" || kind === "transfer") && <TransferMaker key={run} kind={kind} {...props} />}
        {kind === "short" && <ShortMaker key={run} {...props} />}
      </div>
      {msg && <div style={{ fontSize: "12px", fontWeight: 800, color: /^Couldn't|^No /.test(msg) ? "#a52a1e" : "#15803d" }}>{msg}</div>}
    </div>
    </SendToXContext.Provider>
  );
}

// A post's caption: written from the post until it's edited (or opened
// saved), then the admin's — Regenerate writes it fresh.
function useCaption(saved, make) {
  const [caption, setCaption] = useState(saved?.caption || "");
  const [edited, setEdited] = useState(!!saved?.caption);
  useEffect(() => { if (!edited && make) setCaption(make); }, [make, edited]);
  return { caption, edit: (v) => { setCaption(v); setEdited(true); }, regenerate: () => setEdited(false), edited };
}

function CaptionBox({ c }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ ...label, display: "flex", alignItems: "center" }}>
        Caption
        {c.edited && <button onClick={c.regenerate} style={{ ...linkBtn, marginLeft: "auto" }} title="Write it fresh from the post">Regenerate</button>}
        <button onClick={() => navigator.clipboard?.writeText(c.caption).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })} style={{ ...linkBtn, marginLeft: c.edited ? 0 : "auto" }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <textarea value={c.caption} onChange={(e) => c.edit(e.target.value)} rows={12} style={{ ...field, fontWeight: 600, fontFamily: "Arial, sans-serif", resize: "vertical" }} />
    </div>
  );
}

// ── Weekly Mock carousel ──
// One round-1 slide's featured pick: which (its overall; 0 for none), which
// of his action shots, the side kept in frame, and where it sits (adjust —
// dragged on the slide's preview).
function useFeature(picks, shots) {
  const [featured, setFeatured] = useState(0);
  const [shotIdx, setShotIdx] = useState(0);
  const [focus, setFocus] = useState("center");
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const drag = useDragAdjust(setAdjust);
  const pick = picks.find((p) => p.overall === featured) || null;
  const list = pick ? shots[pick.player.id] || [] : [];
  const shot = list[shotIdx] || list[0] || null;
  // A new pick or photo starts where the layout puts it.
  const choose = (overall, idx = 0, action = shots, from = picks) => {
    const p = from.find((x) => x.overall === overall);
    setFeatured(p ? overall : 0);
    setShotIdx(idx);
    setFocus(focusFor(p ? (action[p.player.id] || [])[idx] : null));
    setAdjust(NO_ADJUST);
  };
  // A saved post's: the same pick and photo, framed as it was.
  const restore = (st, action, from) => {
    const p = st ? from.find((x) => x.overall === st.overall) : null;
    const idx = p ? (action[p.player.id] || []).findIndex((a) => a.url === st.photo) : -1;
    if (!p || idx < 0) { choose(0, 0, action, from); return; }
    choose(st.overall, idx, action, from);
    setFocus(st.focus || "center");
    setAdjust({ ...NO_ADJUST, ...st.adjust });
  };
  const feature = useMemo(() => (shot ? { overall: featured, photo: shot.url, focus, adjust } : null), [shot, featured, focus, adjust]);
  return {
    featured, list, shot, focus, setFocus, adjust, setAdjust, drag, feature, choose, restore,
    // To start: the first of the slide's picks with an action shot.
    start: (action, from) => choose(from.find((p) => action[p.player.id]?.length)?.overall || 0, 0, action, from),
  };
}

function FeatureBox({ title, f, picks, shots }) {
  return (
    <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc" }}>
      <div style={label}>{title}</div>
      <select value={f.featured} onChange={(e) => f.choose(Number(e.target.value))} style={field}>
        <option value={0}>None (the plain list)</option>
        {picks.map((p) => {
          const n = (shots[p.player.id] || []).length;
          return <option key={p.overall} value={p.overall} disabled={!n}>{p.overall}. {p.player.First} {p.player.Last}{n ? ` · ${n} action shot${n === 1 ? "" : "s"}` : " · no action shots"}</option>;
        })}
      </select>
      {f.list.length > 0 && (
        <>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
            {f.list.map((a, i) => (
              <button key={a.url} onClick={() => f.choose(f.featured, i)} title={`Action shot ${i + 1}${a.orientation ? ` · facing ${a.orientation}` : ""}`}
                style={{ border: `2px solid ${f.shot?.url === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "60px", height: "76px" }}>
                <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
            {FOCUS.map(([v, t]) => <button key={v} onClick={() => f.setFocus(v)} style={{ ...btn(f.focus === v), padding: "4px 10px" }}>{t}</button>)}
          </div>
          <div style={{ marginTop: "8px" }}><PhotoAdjust value={f.adjust} onChange={f.setAdjust} /></div>
        </>
      )}
      {!picks.some((p) => (shots[p.player.id] || []).length) && (
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginTop: "4px" }}>None of these picks has an action shot yet (Content → Photos) — the slide is a plain list.</div>
      )}
    </div>
  );
}

function MockCarousel({ setMsg, saved, onSaved }) {
  // A saved post's settings, used up as what they need loads (its week, then its features).
  const restoring = useRef(saved?.state || null);
  const st = saved?.state || {};
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [year, setYear] = useState(st.year || MAIN_WEEKLY_YEAR);
  const [weeks, setWeeks] = useState(null);
  const [weekId, setWeekId] = useState("");
  const [theme, setTheme] = useState(st.theme || "dark");
  const [kicker, setKicker] = useState(st.kicker ?? "WE-DRAFT.COM WEEKLY MOCK DRAFT");
  const [title, setTitle] = useState(st.title || "");
  const [dated, setDated] = useState("");
  const [parts, setParts] = useState(null);
  const [slides, setSlides] = useState([]);
  const [busy, setBusy] = useState("");
  // Round 1's action shots ({ [playerId]: [...] }) and each round-1 slide's featured pick.
  const [shots, setShots] = useState({});
  const [cutout, setCutout] = useState(st.cutout ?? true);
  // After round 1: the Draft Sim ad.
  const [simAd, setSimAd] = useState(st.simAd ?? true);

  // The class's published weeks, newest first.
  useEffect(() => {
    setWeeks(null);
    setWeekId("");
    getDocs(query(collection(db, "weeklyMocks"), where("year", "==", String(year)))).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((w) => w.publishedAt && w.picks?.length)
        .sort((a, b) => b.publishedAt.toMillis() - a.publishedAt.toMillis());
      setWeeks(list);
      const want = restoring.current?.weekId;
      setWeekId(want && list.some((w) => w.id === want) ? want : list[0]?.id || "");
    }).catch((e) => { setWeeks([]); setMsg(`Couldn't load the weeks: ${e.message}`); });
  }, [year, setMsg]);

  const week = (weeks || []).find((w) => w.id === weekId) || null;
  const halves = useMemo(() => (week ? roundOneParts(week) : {}), [week]);
  const f1 = useFeature(halves[1] || [], shots);
  const f2 = useFeature(halves[2] || [], shots);
  const feats = { 1: f1, 2: f2 };
  useEffect(() => {
    const r = restoring.current;
    setDated(week && r && r.weekId === week.id && r.dated != null ? r.dated : week ? weeklyMockDate(week.publishedAt, { month: "short", day: "numeric", year: "numeric" }) : "");
  }, [week]);

  // The week's data: team branding, round 1's headshots, college logos.
  useEffect(() => {
    if (!week) { setParts(null); return; }
    let live = true;
    setBusy("Loading the picks…");
    const r1 = week.picks.filter((p) => p.round === 1 && p.player).map((p) => p.player.id);
    const split = roundOneParts(week);
    Promise.all([fetchNflBranding(), headshotsFor(r1), loadClassRows(week.year), actionShotsFor(r1)]).then(([branding, headshots, rows, action]) => {
      if (!live) return;
      const collegeLogos = Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, { lg: r.lg || "", ld: r.ld || "" }]));
      setParts({ branding, headshots, collegeLogos });
      setShots(action);
      // Each slide starts on the first of its picks with an action shot —
      // or, a saved post's week, as it was saved.
      const r = restoring.current;
      if (r && r.weekId === week.id) {
        f1.restore(r.features?.[1], action, split[1] || []);
        f2.restore(r.features?.[2], action, split[2] || []);
      } else {
        f1.start(action, split[1] || []);
        f2.start(action, split[2] || []);
      }
      restoring.current = null;
    }).catch((e) => setMsg(`Couldn't load the picks: ${e.message}`)).finally(() => live && setBusy(""));
    return () => { live = false; };
  }, [week, setMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  const features = useMemo(() => ({ 1: f1.feature, 2: f2.feature }), [f1.feature, f2.feature]);
  const input = useMemo(() => (week && parts ? mockInput({ week, ...parts, theme, dated, brandLogo: WdLogo, kicker, title, features, simAd }) : null), [week, parts, theme, dated, kicker, title, features, simAd]);
  const cap = useCaption(saved, useMemo(() => (input ? mockCaption(input) : ""), [input]));

  // Draw the slides (images load once; redraws are quick after).
  useEffect(() => {
    if (!input) { setSlides([]); return; }
    let live = true;
    setBusy((b) => b || "Drawing…");
    const overrides = Object.fromEntries(Object.values(input.features).map((f) => [f.photo, loadFeatureImage(f.photo, cutout)]));
    envFor(input, overrides).then((env) => {
      if (!live) return;
      setSlides(mockSlides(input, env));
      setBusy("");
      if (env.missing.length) setMsg(`${env.missing.length} image${env.missing.length === 1 ? "" : "s"} couldn't load and ${env.missing.length === 1 ? "is" : "are"} left out.`);
    }).catch((e) => { setBusy(""); setMsg(`Couldn't draw: ${e.message}`); });
    return () => { live = false; };
  }, [input, cutout, setMsg]);

  const svgs = useMemo(() => slides.map((s) => s.svg), [slides]);
  const urls = useSvgUrls(svgs);
  const total = week ? mockSlidePlan(week.picks.filter((p) => p.player)).length : 0;
  const base = `wedraft-${year}-mock-${fileName(dated)}`;

  const downloadAll = async () => {
    for (let i = 0; i < slides.length; i++) {
      setBusy(`Downloading ${i + 1} / ${slides.length}…`);
      await downloadSvg(slides[i].svg, `${base}-${String(i + 1).padStart(2, "0")}-${slides[i].name}`);
      // A beat between files, so the browser takes each download.
      await new Promise((r) => setTimeout(r, 350));
    }
    setBusy("");
    setMsg(`Downloaded ${slides.length} slides.`);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "8px" }}>
          <div>
            <div style={label}>Class</div>
            <select value={year} onChange={(e) => setYear(e.target.value)} style={field}>{WEEKLY_YEARS.map((y) => <option key={y}>{y}</option>)}</select>
          </div>
          <div>
            <div style={label}>Week</div>
            <select value={weekId} onChange={(e) => setWeekId(e.target.value)} style={field} disabled={!weeks?.length}>
              {!weeks && <option>Loading…</option>}
              {weeks && !weeks.length && <option>None published</option>}
              {(weeks || []).map((w, i) => <option key={w.id} value={w.id}>{weeklyMockDate(w.publishedAt, { month: "short", day: "numeric", year: "numeric" })}{i === 0 ? " · latest" : ""}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div style={label}>Look</div>
          <div style={{ display: "flex", gap: "4px" }}>
            {[["dark", "Dark"], ["light", "Light"]].map(([v, t]) => <button key={v} onClick={() => setTheme(v)} style={{ ...btn(theme === v), padding: "5px 12px" }}>{t}</button>)}
          </div>
        </div>
        <div><div style={label}>Kicker</div><input value={kicker} onChange={(e) => setKicker(e.target.value)} style={field} /></div>
        <div><div style={label}>Title</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${year} NFL MOCK DRAFT`} style={field} /></div>
        <div><div style={label}>Date</div><input value={dated} onChange={(e) => setDated(e.target.value)} style={field} /></div>
        {week && [1, 2].filter((part) => halves[part]?.length).map((part) => (
          <FeatureBox key={part} title={`Slide ${part} · picks ${halves[part][0].overall}–${halves[part][halves[part].length - 1].overall} · feature a pick`} f={feats[part]} picks={halves[part]} shots={shots} />
        ))}
        {week && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            <input type="checkbox" checked={cutout} onChange={(e) => setCutout(e.target.checked)} /> Remove the action shots&apos; backdrops
          </label>
        )}
        {week && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            <input type="checkbox" checked={simAd} onChange={(e) => setSimAd(e.target.checked)} /> After round 1: Draft Sim ad (&ldquo;Don&apos;t like the picks? Make your own!&rdquo;)
          </label>
        )}
        {week && (
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#5b6b84" }}>
            {total + (simAd ? 1 : 0)} slides: round 1 on two (picks 1–16, 17–32){simAd ? ", then the Draft Sim ad" : ""}{week.rounds > 1 ? `, then rounds 2–${week.rounds}, one a slide` : ""}. Picks a Draft Sim trade moved say SIM TRADE.
            {total > IG_MAX_SLIDES && <span style={{ color: "#a52a1e" }}> Instagram takes {IG_MAX_SLIDES}; the rest are left off.</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => downloadAll().catch((e) => { setBusy(""); setMsg(`Couldn't export: ${e.message}`); })} disabled={!slides.length || !!busy} style={{ ...btn(true), opacity: slides.length && !busy ? 1 : 0.5 }}>
            Download all ({slides.length})
          </button>
          {busy && <span style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>{busy}</span>}
        </div>
        {input && (
          <SaveBar type="mock" defaultName={`${year} Mock · ${dated || "draft"}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
            playerIds={[1, 2].map((part) => (halves[part] || []).find((p) => p.overall === feats[part].feature?.overall)?.player?.id)} subject={{ kind: "mock", year: String(year), weekId }}
            stateNow={() => ({ year, weekId, theme, kicker, title, dated, cutout, simAd, features: { 1: f1.feature, 2: f2.feature } })} />
        )}
        {input && <CaptionBox c={cap} />}
      </div>

      <div>
        <div style={label}>Preview · {IG_W}×{IG_H} · click a slide to download it</div>
        {!slides.length && <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>{weeks && !weeks.length ? `No published ${year} Weekly Mock yet.` : "Loading…"}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
          {slides.map((s, i) => (
            (() => {
              // A slide with a featured photo: drag it there (a click still downloads).
              const f = s.part && feats[s.part]?.feature ? feats[s.part] : null;
              return (
                <button key={s.name} onClick={() => { if (!(f && f.drag.swallowClick())) downloadSvg(s.svg, `${base}-${String(i + 1).padStart(2, "0")}-${s.name}`).catch((e) => setMsg(`Couldn't export: ${e.message}`)); }}
                  title={f ? "Drag to move his photo · click to download" : "Download this slide"} style={{ border: "1px solid #d5dce6", borderRadius: "8px", padding: 0, background: "#fff", cursor: "pointer", overflow: "hidden", textAlign: "left" }}>
                  {urls[i] && <img src={urls[i]} alt={`Slide ${i + 1}`} {...(f ? f.drag.handlers : {})} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, ...(f ? f.drag.handlers.style : {}) }} />}
                  <div style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", padding: "5px 8px" }}>{i + 1} · {s.ad ? "Draft Sim ad" : `${s.part ? `Round 1 · part ${s.part}` : `Round ${s.round}`} · ${s.picks} picks`}</div>
                </button>
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Player post ──
function PlayerPostMaker({ setMsg, saved, onSaved }) {
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null);
  const [school, setSchool] = useState({});
  const [photos, setPhotos] = useState({ headshot: null, action: [] });
  const [photoUrl, setPhotoUrl] = useState("");
  const [focus, setFocus] = useState("center");
  const [focusY, setFocusY] = useState("top");
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const drag = useDragAdjust(setAdjust);
  // A new photo starts where the layout puts it.
  const choosePhoto = (url) => { setPhotoUrl(url); setAdjust(NO_ADJUST); };
  const [kicker, setKicker] = useState("");
  const [chips, setChips] = useState([{ value: "", label: "" }, { value: "", label: "" }, { value: "", label: "" }]);
  // Chips offered from his data: [{ value, label }].
  const [offers, setOffers] = useState([]);
  const [svg, setSvg] = useState("");

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [setMsg]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);
  // A saved post: its player, then its settings over what he loads with.
  useEffect(() => {
    if (!saved?.state?.playerId) return;
    getDoc(doc(db, "players", saved.state.playerId)).then((d) => { if (d.exists()) pick({ id: d.id, ...d.data() }, saved.state); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (p, restore = null) => {
    setSearch("");
    setMsg("Loading…");
    try {
      const [schoolSnap, photoSnap, rows, summary] = await Promise.all([
        getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))),
        getDoc(doc(db, "playerPhotos", p.id)),
        loadClassRows(String(p.Eligible || "")).catch(() => ({})),
        WEEKLY_YEARS.includes(String(p.Eligible)) ? loadWeeklyMockSummary(String(p.Eligible)) : null,
      ]);
      const ph = photoSnap.exists() ? photoSnap.data() : {};
      const action = ph.action || [];
      setPlayer(p);
      setSchool(schoolSnap.docs[0]?.data() || {});
      setPhotos({ headshot: ph.headshot || null, action });
      const first = action[0] || null;
      choosePhoto(first?.url || "");
      setFocus(first?.orientation === "left" ? "right" : first?.orientation === "right" ? "left" : "center");
      setKicker(`${p.Eligible ? `${p.Eligible} ` : ""}NFL DRAFT PROSPECT`);
      // What his data offers as chips: his class rank at his position, his
      // Weekly Mock pick, his community grade.
      const row = rows[p.id];
      const mock = summary?.players?.[p.id];
      const list = [
        row?.cr && { value: `#${row.cr} ${row.pos}`, label: `${p.Eligible} CLASS` },
        mock && { value: `PICK ${mock.overall}`, label: `${(NFL_TEAMS[mock.team] || mock.team).split(" ").pop()} · WEEKLY MOCK` },
        row?.g && { value: String(row.g), label: "COMMUNITY GRADE" },
      ].filter(Boolean);
      setOffers(list);
      setChips([0, 1, 2].map((i) => list[i] || { value: "", label: "" }));
      if (restore) {
        setPhotoUrl(restore.photoUrl ?? "");
        setFocus(restore.focus || "center");
        setFocusY(restore.focusY || "top");
        setKicker(restore.kicker ?? "");
        if (Array.isArray(restore.chips)) setChips([0, 1, 2].map((i) => restore.chips[i] || { value: "", label: "" }));
        setAdjust({ ...NO_ADJUST, ...restore.adjust });
      }
      setMsg(action.length || restore?.photoUrl ? "" : "No action shots for him yet (Content → Photos) — his school's logo stands in, or paste an image link.");
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };

  const input = useMemo(() => (player ? {
    ...playerInput({ player, school, photo: photoUrl ? { url: photoUrl } : null, kicker, chips, brandLogo: WdLogo }),
    focus, focusY, adjust,
  } : null), [player, school, photoUrl, kicker, chips, focus, focusY, adjust]);
  const capText = input ? playerCaption(input) : "";
  const cap = useCaption(saved, capText);

  useEffect(() => {
    if (!input) { setSvg(""); return; }
    let live = true;
    // His photo's plain backdrop taken out, as slide 1's featured pick's.
    envFor(input, input.photo ? { [input.photo]: loadFeatureImage(input.photo, true) } : {}).then((env) => {
      if (!live) return;
      setSvg(playerPost(input, env));
      if (env.missing.includes(input.photo)) setMsg("Couldn't load that photo — it may not allow downloads (try an imgur link).");
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, setMsg]);
  const svgs = useMemo(() => (svg ? [svg] : []), [svg]);
  const [url] = useSvgUrls(svgs);
  const setChip = (i, f, v) => setChips((c) => c.map((x, j) => (j === i ? { ...x, [f]: v } : x)));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ position: "relative" }}>
          <div style={label}>Player</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? (player ? `${player.First} ${player.Last} — search another…` : "Search a prospect…") : "Loading players…"} style={field} />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
              {matches.map((p) => (
                <button key={p.id} onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                  {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {player && (
          <>
            <div>
              <div style={label}>Photo · click to use</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {photos.action.map((a, i) => (
                  <button key={a.url} onClick={() => { choosePhoto(a.url); setFocus(a.orientation === "left" ? "right" : a.orientation === "right" ? "left" : "center"); }}
                    title={`Action shot ${i + 1}${a.orientation ? ` · facing ${a.orientation}` : ""}`}
                    style={{ border: `2px solid ${photoUrl === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "72px", height: "90px" }}>
                    <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                  </button>
                ))}
                {photos.headshot?.url && (
                  <button onClick={() => choosePhoto(photos.headshot.url)} title="His headshot"
                    style={{ border: `2px solid ${photoUrl === photos.headshot.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "72px", height: "90px", fontSize: "10px", fontWeight: 900, color: "#5b6b84" }}>
                    <img src={photos.headshot.url} alt="" style={{ width: "100%", height: "70%", objectFit: "contain" }} />HEADSHOT
                  </button>
                )}
                <button onClick={() => choosePhoto("")} style={{ border: `2px solid ${!photoUrl ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", cursor: "pointer", width: "72px", height: "90px", fontSize: "10px", fontWeight: 900, color: "#5b6b84" }}>NO PHOTO</button>
              </div>
              <input value={photoUrl} onChange={(e) => choosePhoto(e.target.value)} placeholder="Or any image link…" style={{ ...field, marginTop: "6px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <div>
                <div style={label}>Keep in frame</div>
                <div style={{ display: "flex", gap: "4px" }}>{FOCUS.map(([v, t]) => <button key={v} onClick={() => setFocus(v)} style={{ ...btn(focus === v), padding: "5px 10px" }}>{t}</button>)}</div>
              </div>
              <div>
                <div style={label}>From</div>
                <div style={{ display: "flex", gap: "4px" }}>{[["top", "Top"], ["middle", "Middle"]].map(([v, t]) => <button key={v} onClick={() => setFocusY(v)} style={{ ...btn(focusY === v), padding: "5px 10px" }}>{t}</button>)}</div>
              </div>
            </div>
            {photoUrl && <PhotoAdjust value={adjust} onChange={setAdjust} />}
            <div><div style={label}>Kicker (blank for none)</div><input value={kicker} onChange={(e) => setKicker(e.target.value)} style={field} /></div>
            <div>
              <div style={label}>Chips · up to three</div>
              {chips.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr auto", gap: "6px", marginBottom: "5px" }}>
                  <input value={c.value} onChange={(e) => setChip(i, "value", e.target.value)} placeholder="Value — #3 TE" style={field} />
                  <input value={c.label} onChange={(e) => setChip(i, "label", e.target.value)} placeholder="Label — 2029 CLASS" style={field} />
                  <button onClick={() => setChips((x) => x.map((y, j) => (j === i ? { value: "", label: "" } : y)))} style={{ ...linkBtn, color: "#8a97ab" }}>✕</button>
                </div>
              ))}
              {offers.length > 0 && (
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {offers.map((o) => (
                    <button key={o.label} onClick={() => setChips((x) => { const at = x.findIndex((y) => !y.value && !y.label); return at < 0 ? x : x.map((y, j) => (j === at ? o : y)); })}
                      style={{ border: "1px solid #d5dce6", background: "#fff", borderRadius: "999px", padding: "3px 9px", fontSize: "11px", fontWeight: 800, color: "#33415a", cursor: "pointer" }}>
                      + {o.value} <span style={{ color: "#8a97ab" }}>{o.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div><button onClick={() => downloadSvg(svg, `wedraft-${fileName(`${player.First}-${player.Last}`)}`).catch((e) => setMsg(`Couldn't export: ${e.message}`))} disabled={!svg} style={btn(true)}>Download PNG</button></div>
            <SaveBar type="player" defaultName={`Player · ${player.First} ${player.Last}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
              playerIds={[player.id]} subject={{ kind: "player", playerId: player.id }}
              stateNow={() => ({ playerId: player.id, photoUrl, focus, focusY, kicker, chips, adjust })} />
            <CaptionBox c={cap} />
          </>
        )}
      </div>

      <div>
        <div style={label}>Preview · {IG_W}×{IG_H}</div>
        {url
          ? <img src={url} alt="Post preview" {...(photoUrl ? drag.handlers : {})} title={photoUrl ? "Drag to move his photo" : undefined} style={{ width: "100%", maxWidth: "540px", display: "block", borderRadius: "8px", border: "1px solid #d5dce6", ...(photoUrl ? drag.handlers.style : {}) }} />
          : <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Pick a player.</div>}
      </div>
    </div>
  );
}

// ── Player spotlight ──
// A class past the next draft gets the ADVANCE SCOUTING badge to start.
const isAdvance = (year) => Number(year) > Number(MAIN_WEEKLY_YEAR);
// The cover's top-right logo by class: the NFL Draft shield for the next
// draft, ADVANCE SCOUTING for the classes after (a class without one falls
// back to the drawn badge).
const CLASS_LOGOS = { 2027: ClassLogo2027, 2028: ClassLogo2028, 2029: ClassLogo2029 };

function SpotlightMaker({ setMsg, saved, onSaved }) {
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null);
  // What his page reads: school, photos, and the scouting report.
  const [data, setData] = useState(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [focus, setFocus] = useState("center");
  const [advance, setAdvance] = useState(false);
  // The cover's look (wash | spotlight) and its accent ("" = the school's second color).
  const [look, setLook] = useState("wash");
  // The ADVANCE SCOUTING badge's design (crest | plate).
  const [badge, setBadge] = useState("crest");
  const [accent, setAccent] = useState("");
  // The report's class rank (in by default) and NFL fits (out by default).
  const [showRanks, setShowRanks] = useState(true);
  const [showFits, setShowFits] = useState(false);
  // The stats slide (his ESPN college stats), in when he has them.
  const [showStats, setShowStats] = useState(true);
  // The admin's own stats (utils/instagram/spotlight.js editedStats): null =
  // ESPN's as they are; else { year, team, tiles, lead, table }.
  const [statEdit, setStatEdit] = useState(null);
  // Highlight clips, after the cover: [{ path (ig-videos/…), name, bytes,
  // duration, w, h }]; their preview links by path; the one uploading.
  const [videos, setVideos] = useState([]);
  const [videoUrls, setVideoUrls] = useState({});
  const [uploading, setUploading] = useState(null);
  // The frame to edit his highlight clip under (a transparent PNG to download).
  const [frame, setFrame] = useState("");
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const drag = useDragAdjust(setAdjust);
  // A new photo starts where the layout puts it.
  const choosePhoto = (url) => { setPhotoUrl(url); setAdjust(NO_ADJUST); };
  const [slides, setSlides] = useState([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [setMsg]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);

  // A saved post: its player, then its settings over what he loads with.
  useEffect(() => {
    if (!saved?.state?.playerId) return;
    getDoc(doc(db, "players", saved.state.playerId)).then((d) => { if (d.exists()) pick({ id: d.id, ...d.data() }, saved.state); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (p, restore = null) => {
    setSearch("");
    setBusy("Loading…");
    setMsg("");
    try {
      const [schoolSnap, photoSnap, evalSnap, classSnap, fits, branding] = await Promise.all([
        getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1))),
        getDoc(doc(db, "playerPhotos", p.id)),
        getDocs(collection(db, "players", p.id, "evaluations")),
        getSiteSnapshot(`class_${p.Eligible}_${p.Position}`),
        getSiteSnapshot("_nflFits"),
        fetchNflBranding(),
      ]);
      const ph = photoSnap.exists() ? photoSnap.data() : {};
      const report = scoutingReport({
        player: p, evaluations: evalSnap.docs.map((d) => d.data()), classSnap, nflFits: fits?.rows?.[p.id] || [], branding, teamNames: NFL_TEAMS,
      });
      // His college stats, from ESPN by the id his headshot was matched on,
      // with his national ranks from his linked CFBD player.
      const espnId = ph.headshot?.espnId;
      const [career, cfbd] = espnId ? await Promise.all([
        fetchEspnCareer(espnId),
        getDocs(query(collection(db, "cfbdPlayers"), where("wedraftPlayerId", "==", p.id), limit(1))).catch(() => null),
      ]) : [null, null];
      const stats = career ? espnStats(career, p.Position, cfbd?.docs[0]?.data().seasonRanks || null) : null;
      const action = ph.action || [];
      setPlayer(p);
      setData({ school: schoolSnap.docs[0]?.data() || {}, action, headshot: ph.headshot?.url || "", jersey: ph.jersey || "", report, stats });
      choosePhoto(action[0]?.url || "");
      setFocus(focusFor(action[0]));
      setAdvance(!!CLASS_LOGOS[p.Eligible] || isAdvance(p.Eligible));
      // A new player: his own school's accent.
      setAccent("");
      // His own clips (a saved post's come back below).
      setVideos([]);
      setStatEdit(null);
      if (restore) {
        setPhotoUrl(restore.photoUrl ?? "");
        setFocus(restore.focus || "center");
        setAdvance(!!restore.advance);
        setLook(restore.look || "wash");
        setBadge(restore.badge === "plate" ? "plate" : "crest");
        setAccent(restore.accent || "");
        setShowRanks(restore.showRanks !== false);
        setShowFits(!!restore.showFits);
        setShowStats(restore.showStats !== false);
        setStatEdit(restore.statEdit && Array.isArray(restore.statEdit.tiles) ? restore.statEdit : null);
        setVideos(Array.isArray(restore.videos) ? restore.videos.filter((v) => v?.path) : []);
        setAdjust({ ...NO_ADJUST, ...restore.adjust });
      }
      if (!action.length && !restore?.photoUrl) setMsg("No action shots for him yet (Content → Photos) — the cover shows his school's logo, or paste an image link.");
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    } finally {
      setBusy("");
    }
  };

  const input = useMemo(() => (player && data ? {
    ...spotlightInput({ player, school: data.school, photo: photoUrl ? { url: photoUrl } : null, headshot: data.headshot, report: data.report, advance, brandLogo: WdLogo, badgeLogo: WdBadge, look, accent, badge, showRanks, showFits, highlights: videos.length > 0, stats: editedStats(data.stats, statEdit), showStats, classLogo: advance ? CLASS_LOGOS[player.Eligible] || "" : "", jersey: data.jersey }),
    focus, adjust,
  } : null), [player, data, photoUrl, advance, focus, adjust, look, accent, badge, showRanks, showFits, showStats, statEdit, videos.length]);
  const cap = useCaption(saved, useMemo(() => (input ? spotlightCaption(input) : ""), [input]));

  useEffect(() => {
    if (!input) { setSlides([]); setFrame(""); return; }
    let live = true;
    // His photo's plain backdrop taken out and trimmed, as the mock's feature.
    envFor(input, input.photo ? { [input.photo]: loadFeatureImage(input.photo, true) } : {}, spotlightImageUrls(input)).then((env) => {
      if (!live) return;
      setSlides(spotlightSlides(input, env));
      setFrame(spotlightFrame(input, env));
      if (input.photo && !env.images[input.photo]) setMsg("Couldn't load that photo — it may not allow downloads (try an imgur link).");
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, setMsg]);
  const svgs = useMemo(() => slides.map((s) => s.svg), [slides]);
  const urls = useSvgUrls(svgs);
  const base = player ? `wedraft-spotlight-${fileName(`${player.First}-${player.Last}`)}` : "";

  // A saved clip's preview: a short-lived link from the server (a new upload
  // plays from the file itself). The link lasts an hour; a preview that won't
  // load (it's expired) asks for a new one, once a minute at most.
  const previewLink = (path) => igApi("video-url", { path })
    .then((r) => setVideoUrls((u) => ({ ...u, [path]: r.url })))
    .catch((e) => setMsg(`Couldn't load a video's preview: ${e.message}`));
  useEffect(() => {
    videos.filter((v) => !videoUrls[v.path]).forEach((v) => previewLink(v.path));
  }, [videos]); // eslint-disable-line react-hooks/exhaustive-deps
  const relinkedAt = useRef({});
  const relink = (path) => {
    if (String(videoUrls[path] || "").startsWith("blob:") || Date.now() - (relinkedAt.current[path] || 0) < 60e3) return;
    relinkedAt.current[path] = Date.now();
    previewLink(path);
  };
  const videoUrlsRef = useRef(videoUrls);
  videoUrlsRef.current = videoUrls;
  useEffect(() => () => Object.values(videoUrlsRef.current).forEach((u) => u.startsWith("blob:") && URL.revokeObjectURL(u)), []);
  const addVideo = async (file) => {
    if (!file) return;
    if (!VIDEO_TYPES.includes(file.type)) { setMsg("Instagram takes MP4 or MOV videos."); return; }
    if (file.size > VIDEO_MAX_BYTES) { setMsg(`That clip is ${Math.round(file.size / 1048576)} MB; Instagram takes up to 100 MB.`); return; }
    if (slides.length + videos.length >= IG_MAX_SLIDES) { setMsg(`A carousel takes ${IG_MAX_SLIDES} slides at most.`); return; }
    let info;
    try { info = await videoInfo(file); } catch (e) { setMsg(`Couldn't read that clip: ${e.message}`); return; }
    if (!(info.duration >= 3)) { setMsg("A carousel video has to be at least 3 seconds long."); return; }
    setUploading({ name: file.name, pct: 0 });
    setMsg("");
    try {
      const r = await uploadVideo(file, (pct) => setUploading({ name: file.name, pct }));
      setVideoUrls((u) => ({ ...u, [r.path]: URL.createObjectURL(file) }));
      setVideos((vs) => [...vs, { path: r.path, name: file.name, bytes: r.bytes, duration: Math.round(info.duration * 10) / 10, w: info.w, h: info.h }]);
    } catch (e) {
      setMsg(`Couldn't upload the video: ${e.message}`);
    } finally {
      setUploading(null);
    }
  };
  const frameUrl = useSvgUrls(useMemo(() => (frame ? [frame] : []), [frame]))[0];
  const moveVideo = (k, d) => setVideos((vs) => { const n = [...vs]; [n[k], n[k + d]] = [n[k + d], n[k]]; return n; });
  // The preview's tiles in carousel order: the cover, the clips, the rest.
  const tiles = slides.length ? [{ slide: 0 }, ...videos.map((v) => ({ video: v })), ...slides.slice(1).map((_, k) => ({ slide: k + 1 }))] : [];
  const downloadAll = async () => {
    for (let i = 0; i < slides.length; i++) {
      setBusy(`Downloading ${i + 1} / ${slides.length}…`);
      await downloadSvg(slides[i].svg, `${base}-${i + 1}-${slides[i].name}`);
      await new Promise((r) => setTimeout(r, 350));
    }
    setBusy("");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ position: "relative" }}>
          <div style={label}>Player</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? (player ? `${player.First} ${player.Last} — search another…` : "Search a prospect…") : "Loading players…"} style={field} />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
              {matches.map((p) => (
                <button key={p.id} onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                  {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {player && data && (
          <>
            <div>
              <div style={label}>Cover photo · click to use</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {data.action.map((a, i) => (
                  <button key={a.url} onClick={() => { choosePhoto(a.url); setFocus(focusFor(a)); }} title={`Action shot ${i + 1}${a.orientation ? ` · facing ${a.orientation}` : ""}`}
                    style={{ border: `2px solid ${photoUrl === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "60px", height: "76px" }}>
                    <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                  </button>
                ))}
                <button onClick={() => choosePhoto("")} style={{ border: `2px solid ${!photoUrl ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", cursor: "pointer", width: "60px", height: "76px", fontSize: "10px", fontWeight: 900, color: "#5b6b84" }}>NO PHOTO</button>
              </div>
              <input value={photoUrl} onChange={(e) => choosePhoto(e.target.value)} placeholder="Or any image link…" style={{ ...field, marginTop: "6px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "4px" }}>
                {FOCUS.map(([v, t]) => <button key={v} onClick={() => setFocus(v)} style={{ ...btn(focus === v), padding: "4px 10px" }}>{t}</button>)}
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
                <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> {CLASS_LOGOS[player.Eligible] ? `${player.Eligible} class logo` : "Advance Scouting badge"}
              </label>
              {advance && !CLASS_LOGOS[player.Eligible] && (
                <div style={{ display: "flex", gap: "4px" }}>
                  {[["crest", "Crest"], ["plate", "Plate"]].map(([v, t]) => <button key={v} onClick={() => setBadge(v)} style={{ ...btn(badge === v), padding: "4px 10px" }}>{t}</button>)}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "14px", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <div style={label}>Cover background</div>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[["wash", "Color wash"], ["spotlight", "Spotlight on black"]].map(([v, t]) => <button key={v} onClick={() => setLook(v)} style={{ ...btn(look === v), padding: "5px 12px" }}>{t}</button>)}
                </div>
              </div>
              <div>
                <div style={label}>Accent color</div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input type="color" value={accent || data.school.Color2 || "#f6a21d"} onChange={(e) => setAccent(e.target.value)} style={{ ...field, width: "46px", height: "30px", padding: "2px" }} title="The frame, the stat bars, the glow and the headshot ring" />
                  {accent
                    ? <button onClick={() => setAccent("")} style={{ ...linkBtn, fontSize: "10px" }} title="Back to the school's second color">DEFAULT</button>
                    : <span style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>School&apos;s second color</span>}
                </div>
              </div>
            </div>
            {photoUrl && <PhotoAdjust value={adjust} onChange={setAdjust} />}
            <div>
              <div style={label}>Slides show</div>
              <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                {[["Class rank", showRanks, setShowRanks], ["NFL fits", showFits, setShowFits], ...(data.stats || statEdit ? [["Stats slide", showStats, setShowStats]] : [])].map(([t, on, set]) => (
                  <label key={t} style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
                    <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {t}
                  </label>
                ))}
              </div>
            </div>
            <StatsEditor espn={data.stats} edit={statEdit} onChange={setStatEdit} />
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#5b6b84" }}>
              Report: {data.report.grade.avg == null ? "Watchlist" : data.report.grade.label} · {data.report.evals} evaluation{data.report.evals === 1 ? "" : "s"}
              {data.report.posRank ? ` · #${data.report.posRank} ${player.Position}` : ""}{data.report.fits.length ? ` · ${data.report.fits.length} NFL fit${data.report.fits.length === 1 ? "" : "s"}` : ""}
            </div>
            <div>
              <div style={label}>Highlight videos · after the cover</div>
              {videos.map((v, k) => (
                <div key={v.path} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: "#33415a", marginBottom: "4px" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.name}>
                    {k + 2} · {v.name} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{v.duration ? `${v.duration}s` : ""}{v.bytes ? ` · ${Math.max(1, Math.round(v.bytes / 1048576))} MB` : ""}</span>
                  </span>
                  {k > 0 && <button onClick={() => moveVideo(k, -1)} style={linkBtn} title="Earlier">↑</button>}
                  {k < videos.length - 1 && <button onClick={() => moveVideo(k, 1)} style={linkBtn} title="Later">↓</button>}
                  <button onClick={() => setVideos((vs) => vs.filter((x) => x.path !== v.path))} style={{ ...linkBtn, color: "#a52a1e" }}>REMOVE</button>
                </div>
              ))}
              {videos.some((v) => v.duration > 60) && <div style={{ fontSize: "11px", fontWeight: 700, color: "#b7791f", marginBottom: "4px" }}>A clip over 60 seconds may be refused by Instagram in a carousel.</div>}
              {videos.some((v) => v.w && v.h && Math.abs(v.w / v.h - 0.8) > 0.03) && <div style={{ fontSize: "11px", fontWeight: 700, color: "#b7791f", marginBottom: "4px" }}>Instagram shows a carousel in the cover&apos;s 4:5 shape: a clip of another shape may be cropped.</div>}
              {uploading
                ? <div style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>Uploading {uploading.name}… {Math.round(uploading.pct * 100)}%</div>
                : (
                  <label style={{ ...btn(false), display: "inline-block", padding: "5px 12px", cursor: "pointer" }}>
                    + Add a video
                    <input type="file" accept="video/mp4,video/quicktime" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; addVideo(f); }} />
                  </label>
                )}
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginTop: "4px" }}>MP4 or MOV, up to 100 MB. Saved with the post; Download saves the drawn slides only.</div>
              {frame && (
                <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "8px" }}>
                  <img src={frameUrl} alt="Highlight video frame" style={{ width: "72px", aspectRatio: `${IG_W} / ${IG_H}`, borderRadius: "5px", border: "1px solid #d5dce6", background: "repeating-conic-gradient(#d5dce6 0 25%, #fff 0 50%) 0 0 / 12px 12px" }} />
                  <div>
                    <button onClick={() => downloadSvg(frame, `${base}-highlight-frame`).catch((e) => setMsg(`Couldn't export: ${e.message}`))} style={{ ...btn(false), padding: "5px 12px" }}>Download video frame</button>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginTop: "3px" }}>A {IG_W}×{IG_H} PNG with a clear window: put it on the top track in your editor and the footage under it.</div>
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button onClick={() => downloadAll().catch((e) => { setBusy(""); setMsg(`Couldn't export: ${e.message}`); })} disabled={!slides.length || !!busy} style={{ ...btn(true), opacity: slides.length && !busy ? 1 : 0.5 }}>{videos.length ? "Download slides" : "Download all"}</button>
              {busy && <span style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>{busy}</span>}
            </div>
            <SaveBar type="spotlight" defaultName={`Spotlight · ${player.First} ${player.Last}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
              playerIds={[player.id]} subject={{ kind: "player", playerId: player.id }}
              videos={videos.map((v, k) => ({ at: 1 + k, path: v.path }))} hold={uploading ? "Wait for the video to finish uploading." : ""}
              stateNow={() => ({ playerId: player.id, photoUrl, focus, advance, adjust, look, accent, badge, showRanks, showFits, showStats, statEdit, videos })} />
            <CaptionBox c={cap} />
          </>
        )}
        {busy && !data && <span style={{ fontSize: "12px", fontWeight: 800, color: BLUE }}>{busy}</span>}
      </div>
      <div>
        <div style={label}>Preview · {IG_W}×{IG_H} · click a slide to download it</div>
        {!slides.length && <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Pick a player.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 420px))", gap: "12px" }}>
          {tiles.map((t, n) => {
            if (t.video) {
              return (
                <div key={t.video.path} style={{ border: "1px solid #d5dce6", borderRadius: "8px", background: "#fff", overflow: "hidden" }}>
                  {videoUrls[t.video.path]
                    ? <video src={videoUrls[t.video.path]} onError={() => relink(t.video.path)} controls muted playsInline preload="metadata" style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, objectFit: "cover", background: "#000" }} />
                    : <div style={{ aspectRatio: `${IG_W} / ${IG_H}`, background: "#0b1426" }} />}
                  <div style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", padding: "5px 8px" }}>{n + 1} · Video · {t.video.name}</div>
                </div>
              );
            }
            const i = t.slide;
            const s = slides[i];
            return (
              <button key={s.name} onClick={() => { if (!(i === 0 && photoUrl && drag.swallowClick())) downloadSvg(s.svg, `${base}-${i + 1}-${s.name}`).catch((e) => setMsg(`Couldn't export: ${e.message}`)); }}
                title={i === 0 && photoUrl ? "Drag to move his photo · click to download" : "Download this slide"} style={{ border: "1px solid #d5dce6", borderRadius: "8px", padding: 0, background: "#fff", cursor: "pointer", overflow: "hidden", textAlign: "left" }}>
                {urls[i] && <img src={urls[i]} alt={`Spotlight slide ${n + 1}`} {...(i === 0 && photoUrl ? drag.handlers : {})} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, ...(i === 0 && photoUrl ? drag.handlers.style : {}) }} />}
                <div style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", padding: "5px 8px" }}>{n + 1} · {{ cover: "Cover", "scouting-report": "Scouting report", stats: "Stats", evaluate: "Evaluate him" }[s.name] || s.name}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Short ──
// A vertical frame to cut a highlight clip under and an end screen to close
// on (utils/instagram/short.js): two 1080×1920 PNGs to download. Saved like
// any post, but not published from here — the video is edited elsewhere.
function ShortMaker({ setMsg, saved, onSaved }) {
  const st = saved?.state || {};
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [players, setPlayers] = useState(null);
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null);
  const [school, setSchool] = useState(null);
  const [lines, setLines] = useState(st.lines || "");
  const [kicker, setKicker] = useState(st.kicker || "");
  const [svgs, setSvgs] = useState([]);

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
  }, [setMsg]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);

  const pick = async (p) => {
    setSearch("");
    setMsg("");
    try {
      const snap = await getDocs(query(collection(db, "schools"), where("School", "==", p.School || ""), limit(1)));
      setPlayer(p);
      setSchool(snap.docs[0]?.data() || {});
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };
  // A saved Short: its player.
  useEffect(() => {
    if (!st.playerId) return;
    getDoc(doc(db, "players", st.playerId)).then((d) => { if (d.exists()) pick({ id: d.id, ...d.data() }); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const input = useMemo(() => (player && school ? shortInput({ player, school, lines, kicker, badgeLogo: WdBadge }) : null), [player, school, lines, kicker]);
  useEffect(() => {
    if (!input) { setSvgs([]); return undefined; }
    let live = true;
    envFor(input, {}, shortImageUrls(input)).then((env) => { if (live) setSvgs([shortFrame(input, env), shortEnd(input, env)]); })
      .catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, setMsg]);
  const urls = useSvgUrls(svgs);
  const base = player ? `wedraft-short-${fileName(`${player.First}-${player.Last}`)}` : "";
  const parts = [["frame", "Frame", "Clear window — put it on the top track, the clip under it."], ["end", "End screen", "The last few seconds."]];
  const download = (i) => downloadSvg(svgs[i], `${base}-${parts[i][0]}`, SHORT_W, SHORT_H).catch((e) => setMsg(`Couldn't export: ${e.message}`));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ position: "relative" }}>
          <div style={label}>Player</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={players ? (player ? `${player.First} ${player.Last} — search another…` : "Search a prospect…") : "Loading players…"} style={field} />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
              {matches.map((p) => (
                <button key={p.id} onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                  {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {player && (
          <>
            <div>
              <div style={label}>Stat lines · one a line, up to 3</div>
              <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={3} placeholder={"9 TKL\n1 SACK"} style={{ ...field, resize: "vertical", fontFamily: "inherit" }} />
            </div>
            <div>
              <div style={label}>Over the stats (optional)</div>
              <input value={kicker} onChange={(e) => setKicker(e.target.value)} placeholder="VS LSU · WEEK 11" style={field} />
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button onClick={async () => { await download(0); await new Promise((r) => setTimeout(r, 350)); await download(1); }} disabled={!svgs.length} style={{ ...btn(true), opacity: svgs.length ? 1 : 0.5 }}>Download both</button>
            </div>
            <SaveBar type="short" saveOnly defaultName={`Short · ${player.First} ${player.Last}`} caption="" svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
              playerIds={[player.id]} subject={{ kind: "player", playerId: player.id }}
              stateNow={() => ({ playerId: player.id, lines, kicker })} />
          </>
        )}
      </div>
      <div>
        <div style={label}>Preview · {SHORT_W}×{SHORT_H} · click one to download it</div>
        {!svgs.length && <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Pick a player.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 300px))", gap: "12px" }}>
          {svgs.map((_, i) => (
            <button key={parts[i][0]} onClick={() => download(i)} title={`Download the ${parts[i][1].toLowerCase()}`} style={{ border: "1px solid #d5dce6", borderRadius: "8px", padding: 0, background: "#fff", cursor: "pointer", overflow: "hidden", textAlign: "left" }}>
              {urls[i] && <img src={urls[i]} alt={parts[i][1]} style={{ width: "100%", display: "block", aspectRatio: `${SHORT_W} / ${SHORT_H}`, background: "repeating-conic-gradient(#d5dce6 0 25%, #fff 0 50%) 0 0 / 14px 14px" }} />}
              <div style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", padding: "5px 8px" }}>{parts[i][1]}<div style={{ fontWeight: 700, color: "#8a97ab" }}>{parts[i][2]}</div></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Transfer Portal ──
// One maker, two posts with their own looks (utils/instagram/transfer.js):
// kind "portal" (he's entered it) or "transfer" (he's picked a school).
const SCHOOLS_LIST = "transfer-schools";
function TransferMaker({ kind, setMsg, saved, onSaved }) {
  const isTransfer = kind === "transfer";
  const st = saved?.state || {};
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [players, setPlayers] = useState(null);
  const [schools, setSchools] = useState(null);
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState(null);
  const [data, setData] = useState(null);
  const [fromName, setFromName] = useState(st.fromName || "");
  const [toName, setToName] = useState(st.toName || "");
  const [carousel, setCarousel] = useState(!!st.carousel);
  const [photoUrl, setPhotoUrl] = useState("");
  const [focus, setFocus] = useState("center");
  const [adjust, setAdjust] = useState(NO_ADJUST);
  const drag = useDragAdjust(setAdjust);
  const [kicker, setKicker] = useState(st.kicker || "");
  const [headline, setHeadline] = useState(st.headline || "");
  const [note, setNote] = useState(st.note || "");
  const [slides, setSlides] = useState([]);
  // The frame to edit his highlight clip under (a transparent PNG to download).
  const [frame, setFrame] = useState("");
  const choosePhoto = (url) => { setPhotoUrl(url); setAdjust(NO_ADJUST); };

  useEffect(() => {
    getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
      .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
    getDocs(collection(db, "schools")).then((snap) => setSchools(snap.docs.map((d) => d.data()).filter((s) => s.School).sort((a, b) => a.School.localeCompare(b.School))))
      .catch((e) => setMsg(`Couldn't load schools: ${e.message}`));
  }, [setMsg]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !players) return [];
    return players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 12);
  }, [players, search]);

  const pick = async (p, restore = null) => {
    setSearch("");
    setMsg("");
    try {
      const [photoSnap, evalSnap, classSnap] = await Promise.all([
        getDoc(doc(db, "playerPhotos", p.id)),
        getDocs(collection(db, "players", p.id, "evaluations")),
        getSiteSnapshot(`class_${p.Eligible}_${p.Position}`),
      ]);
      const ph = photoSnap.exists() ? photoSnap.data() : {};
      const action = ph.action || [];
      setPlayer(p);
      setData({ action, report: scoutingReport({ player: p, evaluations: evalSnap.docs.map((d) => d.data()), classSnap, teamNames: NFL_TEAMS }) });
      if (restore) {
        setPhotoUrl(restore.photoUrl ?? "");
        setFocus(restore.focus || "center");
        setAdjust({ ...NO_ADJUST, ...restore.adjust });
      } else {
        choosePhoto(action[0]?.url || "");
        setFocus(focusFor(action[0]));
        // Where his data says he's coming from and going to; both can be changed.
        // A player already resolved to a new school has it as School, the old as PriorSchool.
        const resolved = !p.InPortal && !!p.PriorSchool;
        setFromName(p.PortalOriginalSchool || (isTransfer && resolved ? p.PriorSchool : p.School) || "");
        setToName(isTransfer && resolved ? p.School || "" : "");
        if (!action.length) setMsg("No action shots for him yet (Content → Photos) — the design works without one, or paste an image link.");
      }
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };
  useEffect(() => {
    if (!st.playerId) return;
    getDoc(doc(db, "players", st.playerId)).then((d) => { if (d.exists()) pick({ id: d.id, ...d.data() }, st); })
      .catch((e) => setMsg(`Couldn't open it: ${e.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schoolDoc = (name) => (schools || []).find((s) => s.School === name) || {};
  const input = useMemo(() => (player && data && schools ? {
    ...transferInput({ kind, player, from: schoolDoc(fromName), fromName, to: schoolDoc(toName), toName, photo: photoUrl ? { url: photoUrl } : null, report: data.report, carousel, kicker, headline, note, brandLogo: WdLogo, badgeLogo: WdBadge }),
    focus, adjust,
  } : null), [kind, player, data, schools, fromName, toName, photoUrl, carousel, kicker, headline, note, focus, adjust]); // eslint-disable-line react-hooks/exhaustive-deps
  const cap = useCaption(saved, useMemo(() => (input ? transferCaption(input) : ""), [input]));

  useEffect(() => {
    if (!input) { setSlides([]); setFrame(""); return; }
    let live = true;
    envFor(input, input.photo ? { [input.photo]: loadFeatureImage(input.photo, true) } : {}, transferImageUrls(input)).then((env) => {
      if (!live) return;
      setSlides(transferSlides(input, env));
      setFrame(transferFrame(input, env));
      if (input.photo && !env.images[input.photo]) setMsg("Couldn't load that photo — it may not allow downloads (try an imgur link).");
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [input, setMsg]);
  const svgs = useMemo(() => slides.map((s) => s.svg), [slides]);
  const urls = useSvgUrls(svgs);
  const base = player ? `wedraft-${kind}-${fileName(`${player.First}-${player.Last}`)}` : "";
  const frameUrl = useSvgUrls(useMemo(() => (frame ? [frame] : []), [frame]))[0];
  const known = (name) => !name || (schools || []).some((s) => s.School === name);
  const hold = isTransfer && !toName.trim() ? "Pick the school he's going to." : "";
  const slideNames = { portal: "Cover", "his-file": "His file", "where-next": "Where next?", transfer: "Cover", "what-they-get": "What they get" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 380px) 1fr", gap: "18px", alignItems: "start" }}>
      <datalist id={SCHOOLS_LIST}>{(schools || []).map((s) => <option key={s.School} value={s.School} />)}</datalist>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ position: "relative" }}>
          <div style={label}>Player</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} data-transfer-player placeholder={players ? (player ? `${player.First} ${player.Last} — search another…` : "Search a prospect…") : "Loading players…"} style={field} />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
              {matches.map((p) => (
                <button key={p.id} onClick={() => pick(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                  {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}{p.InPortal ? " · in portal" : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {player && data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isTransfer ? "1fr 1fr" : "1fr", gap: "8px" }}>
              <div>
                <div style={label}>{isTransfer ? "From" : "Leaving"}</div>
                <input list={SCHOOLS_LIST} value={fromName} onChange={(e) => setFromName(e.target.value)} data-transfer-from style={field} />
                {!known(fromName) && <div style={{ fontSize: "11px", fontWeight: 700, color: "#b7791f", marginTop: "2px" }}>Not a We-Draft school: no logo or colors.</div>}
              </div>
              {isTransfer && (
                <div>
                  <div style={label}>Going to</div>
                  <input list={SCHOOLS_LIST} value={toName} onChange={(e) => setToName(e.target.value)} data-transfer-to placeholder="Pick a school…" style={field} />
                  {!known(toName) && <div style={{ fontSize: "11px", fontWeight: 700, color: "#b7791f", marginTop: "2px" }}>Not a We-Draft school: no logo or colors.</div>}
                </div>
              )}
            </div>
            <div>
              <div style={label}>Format</div>
              <div style={{ display: "flex", gap: "4px" }}>
                {[[false, "Single image"], [true, `Carousel (${isTransfer ? 2 : 3} slides)`]].map(([v, t]) => <button key={t} onClick={() => setCarousel(v)} style={{ ...btn(carousel === v), padding: "5px 12px" }}>{t}</button>)}
              </div>
            </div>
            <div>
              <div style={label}>Photo · click to use</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {data.action.map((a, i) => (
                  <button key={a.url} onClick={() => { choosePhoto(a.url); setFocus(focusFor(a)); }} title={`Action shot ${i + 1}${a.orientation ? ` · facing ${a.orientation}` : ""}`}
                    style={{ border: `2px solid ${photoUrl === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "60px", height: "76px" }}>
                    <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                  </button>
                ))}
                <button onClick={() => choosePhoto("")} style={{ border: `2px solid ${!photoUrl ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", cursor: "pointer", width: "60px", height: "76px", fontSize: "10px", fontWeight: 900, color: "#5b6b84" }}>NO PHOTO</button>
              </div>
              <input value={photoUrl} onChange={(e) => choosePhoto(e.target.value)} placeholder="Or any image link…" style={{ ...field, marginTop: "6px" }} />
            </div>
            {photoUrl && (
              <>
                <div style={{ display: "flex", gap: "4px" }}>{FOCUS.map(([v, t]) => <button key={v} onClick={() => setFocus(v)} style={{ ...btn(focus === v), padding: "4px 10px" }}>{t}</button>)}</div>
                <PhotoAdjust value={adjust} onChange={setAdjust} />
              </>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <div><div style={label}>{isTransfer ? "Banner" : "Tape"}</div><input value={kicker} onChange={(e) => setKicker(e.target.value)} placeholder={isTransfer ? "TRANSFER" : "TRANSFER PORTAL"} style={field} /></div>
              {!isTransfer && <div><div style={label}>Headline</div><input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="IN THE PORTAL" style={field} /></div>}
            </div>
            <div><div style={label}>Note under his name (optional)</div><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="2 YEARS OF ELIGIBILITY" style={field} /></div>
            <div><button onClick={() => Promise.all(slides.map((s, i) => downloadSvg(s.svg, `${base}-${i + 1}-${s.name}`))).catch((e) => setMsg(`Couldn't export: ${e.message}`))} disabled={!slides.length} style={{ ...btn(true), opacity: slides.length ? 1 : 0.5 }}>Download {slides.length > 1 ? `all (${slides.length})` : "PNG"}</button></div>
            {frame && (
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <img src={frameUrl} alt="Highlight video frame" style={{ width: "72px", aspectRatio: `${IG_W} / ${IG_H}`, borderRadius: "5px", border: "1px solid #d5dce6", background: "repeating-conic-gradient(#d5dce6 0 25%, #fff 0 50%) 0 0 / 12px 12px" }} />
                <div>
                  <button onClick={() => downloadSvg(frame, `${base}-highlight-frame`).catch((e) => setMsg(`Couldn't export: ${e.message}`))} style={{ ...btn(false), padding: "5px 12px" }}>Download video frame</button>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab", marginTop: "3px" }}>A {IG_W}×{IG_H} PNG with a clear window for his highlight clip, in this post's {isTransfer ? "transfer" : "portal"} look.</div>
                </div>
              </div>
            )}
            <SaveBar type={kind} defaultName={`${isTransfer ? "Transfer" : "Portal"} · ${player.First} ${player.Last}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
              playerIds={[player.id]} subject={{ kind: "player", playerId: player.id }} hold={hold}
              stateNow={() => ({ playerId: player.id, fromName, toName, carousel, photoUrl, focus, adjust, kicker, headline, note })} />
            <CaptionBox c={cap} />
          </>
        )}
      </div>
      <div>
        <div style={label}>Preview · {IG_W}×{IG_H}{slides.length > 1 ? " · click a slide to download it" : ""}</div>
        {!slides.length && <div style={{ fontSize: "13px", fontWeight: 700, color: "#8a97ab" }}>Pick a player.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 420px))", gap: "12px" }}>
          {slides.map((s, i) => {
            const movable = i === 0 && photoUrl;
            return (
              <button key={s.name} data-transfer-slide={s.name} onClick={() => { if (!(movable && drag.swallowClick())) downloadSvg(s.svg, `${base}-${i + 1}-${s.name}`).catch((e) => setMsg(`Couldn't export: ${e.message}`)); }}
                title={movable ? "Drag to move his photo · click to download" : "Download this slide"} style={{ border: "1px solid #d5dce6", borderRadius: "8px", padding: 0, background: "#fff", cursor: "pointer", overflow: "hidden", textAlign: "left" }}>
                {urls[i] && <img src={urls[i]} alt={`Slide ${i + 1}`} {...(movable ? drag.handlers : {})} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}`, ...(movable ? drag.handlers.style : {}) }} />}
                <div style={{ fontSize: "11px", fontWeight: 900, color: "#5b6b84", padding: "5px 8px" }}>{i + 1} · {slideNames[s.name] || s.name}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ── Create a post ──
// A blank canvas (utils/instagram/custom.js): add players, logos, text, images
// and shapes; drag them on the preview, pull a corner to size them. Pictures are
// links, as everywhere on the site (imgur), so a saved post stays small.
const swatch = { ...field, width: "46px", height: "30px", padding: "2px" };
function CustomPostMaker({ setMsg, saved, onSaved }) {
  const st = saved?.state || {};
  const [post, setPost] = useState(saved ? { id: saved.id, name: saved.name, status: saved.status, ig: saved.ig || null } : null);
  const [slides, setSlides] = useState(() => (Array.isArray(st.slides) && st.slides.length ? st.slides : [blankSlide()]));
  const [at, setAt] = useState(0);
  const [selId, setSelId] = useState("");
  const [footerOn, setFooterOn] = useState(st.footerOn !== false);
  const [cta, setCta] = useState(st.cta || "");
  const [adding, setAdding] = useState("");
  const [search, setSearch] = useState("");
  const [link, setLink] = useState("");
  const [players, setPlayers] = useState(null);
  const [logos, setLogos] = useState(null);
  const [shots, setShots] = useState({});
  const [env, setEnv] = useState(null);
  const slide = slides[Math.min(at, slides.length - 1)];
  const sel = slide.layers.find((l) => l.id === selId) || null;

  // ── Editing ──
  const setSlide = (fn) => setSlides((all) => all.map((s, i) => (i === Math.min(at, all.length - 1) ? fn(s) : s)));
  const patchLayer = (id, patch) => setSlide((s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const addLayer = (l) => { setSlide((s) => ({ ...s, layers: [...s.layers, l] })); setSelId(l.id); setAdding(""); setSearch(""); setLink(""); };
  const removeLayer = (id) => { setSlide((s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) })); if (selId === id) setSelId(""); };
  // d: +1 toward the front, -1 toward the back.
  const moveLayer = (id, d) => setSlide((s) => {
    const i = s.layers.findIndex((l) => l.id === id);
    const j = i + d;
    if (j < 0 || j >= s.layers.length) return s;
    const n = [...s.layers];
    [n[i], n[j]] = [n[j], n[i]];
    return { ...s, layers: n };
  });
  const setBg = (patch) => setSlide((s) => ({ ...s, bg: { ...s.bg, ...patch } }));
  const addSlide = (copy) => {
    const fresh = copy ? { bg: { ...slide.bg }, layers: slide.layers.map((l) => ({ ...newLayer(l.kind), ...l, id: newLayer(l.kind).id })) } : blankSlide();
    setSlides((all) => [...all.slice(0, at + 1), fresh, ...all.slice(at + 1)]);
    setAt(at + 1);
    setSelId("");
  };
  const removeSlide = () => {
    if (slides.length < 2 || !window.confirm(`Delete slide ${at + 1}?`)) return;
    setSlides((all) => all.filter((_, i) => i !== at));
    setAt(Math.max(0, at - 1));
    setSelId("");
  };
  const moveSlide = (d) => {
    const j = at + d;
    if (j < 0 || j >= slides.length) return;
    setSlides((all) => { const n = [...all]; [n[at], n[j]] = [n[j], n[at]]; return n; });
    setAt(j);
  };

  // ── What can be added ──
  useEffect(() => {
    if (adding === "player" && !players) {
      getDocs(collection(db, "players")).then((snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.First && p.Last).sort((a, b) => a.Last.localeCompare(b.Last) || a.First.localeCompare(b.First))))
        .catch((e) => setMsg(`Couldn't load players: ${e.message}`));
    }
    if ((adding === "logo" || adding === "colors") && !logos) {
      Promise.all([getDocs(collection(db, "schools")), fetchNflBranding()]).then(([schools, nfl]) => {
        const college = schools.docs.map((d) => d.data()).filter((s) => s.School).map((s) => ({ name: s.School, sub: "College", logo: s.Logo1 || "", dark: s.LogoDark || "", c1: s.Color1 || "", c2: s.Color2 || "" }));
        const pro = Object.entries(nfl || {}).map(([abbr, t]) => ({ name: [t.City, t.Team].filter(Boolean).join(" ") || abbr, sub: "NFL", logo: t.Logo1 || "", dark: t.LogoDark || "", c1: t.Color1 || "", c2: t.Color2 || "" }));
        setLogos([...college, ...pro].sort((a, b) => a.name.localeCompare(b.name)));
      }).catch((e) => setMsg(`Couldn't load logos: ${e.message}`));
    }
  }, [adding, players, logos, setMsg]);
  const q = search.trim().toLowerCase();
  const playerHits = q && players ? players.filter((p) => `${p.First} ${p.Last}`.toLowerCase().includes(q)).slice(0, 10) : [];
  const logoHits = q && logos ? logos.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 10) : [];
  const shotsFor = async (playerId) => {
    if (shots[playerId]) return shots[playerId];
    const d = await getDoc(doc(db, "playerPhotos", playerId));
    const ph = d.exists() ? d.data() : {};
    const out = { action: ph.action || [], headshot: ph.headshot?.url || "" };
    setShots((m) => ({ ...m, [playerId]: out }));
    return out;
  };
  const addPlayer = async (p) => {
    try {
      const ph = await shotsFor(p.id);
      const url = ph.action[0]?.url || ph.headshot;
      if (!url) setMsg(`No photo for ${p.First} ${p.Last} yet (Content → Photos): paste an image link on the layer.`);
      else setMsg("");
      addLayer(newLayer("player", { url: url || "", playerId: p.id, name: `${p.First} ${p.Last}`, cutout: !!ph.action[0] }));
    } catch (e) {
      setMsg(`Couldn't load him: ${e.message}`);
    }
  };
  // Saved posts: a selected player's other photos.
  useEffect(() => { if (sel?.kind === "player" && sel.playerId) shotsFor(sel.playerId).catch(() => {}); }, [sel?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drawing ──
  const input = useMemo(() => customInput({ slides, footerOn, cta, brandLogo: WdLogo }), [slides, footerOn, cta]);
  const urlKey = customImageUrls(input).join("|");
  const cutKey = customCutoutUrls(input).join("|");
  // The images only load again when the set of them changes, not on every drag.
  useEffect(() => {
    let live = true;
    const cut = cutKey ? cutKey.split("|") : [];
    envFor(input, Object.fromEntries(cut.map((u) => [u, loadFeatureImage(u, true)])), urlKey.split("|").filter(Boolean)).then((e) => {
      if (!live) return;
      setEnv(e);
      if (e.missing.length) setMsg(`${e.missing.length} image${e.missing.length === 1 ? "" : "s"} couldn't load. It may not allow downloads (try an imgur link).`);
    }).catch((e) => setMsg(`Couldn't draw: ${e.message}`));
    return () => { live = false; };
  }, [urlKey, cutKey, setMsg]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = useMemo(() => (env ? customSlides(input, env) : []), [input, env]);
  const svgs = useMemo(() => drawn.map((s) => s.svg), [drawn]);
  const urls = useSvgUrls(svgs);
  const cap = useCaption(saved, useMemo(() => customCaption(input), [input]));
  const empty = !slides.some((s) => s.layers.length || s.bg?.image);

  // ── Dragging on the preview ──
  // { id, mode: "move" | "size", x, y (where the pointer was), k (post pixels a screen pixel), layer, box }
  const drag = useRef(null);
  const frame = useRef(0);
  const pending = useRef(null);
  const startDrag = (e, l, mode) => {
    e.stopPropagation();
    e.preventDefault();
    setSelId(l.id);
    const rect = e.currentTarget.closest("[data-custom-stage]").getBoundingClientRect();
    drag.current = { id: l.id, mode, x: e.clientX, y: e.clientY, k: IG_W / rect.width, layer: l, box: layerBox(l, env, WdLogo) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * d.k;
    const dy = (e.clientY - d.y) * d.k;
    let patch;
    if (d.mode === "move") patch = { x: Math.round(d.layer.x + dx), y: Math.round(d.layer.y + dy) };
    else if (d.layer.kind === "text") patch = { size: Math.max(16, Math.round(d.layer.size * Math.max(0.1, (d.box.w + dx) / d.box.w))) };
    else if (d.layer.kind === "shape") patch = { w: Math.max(10, Math.round(d.layer.w + dx)), h: Math.max(10, Math.round(d.layer.h + dy)) };
    else patch = { w: Math.max(30, Math.round(d.layer.w + dx)) };
    pending.current = { id: d.id, patch };
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (pending.current) patchLayer(pending.current.id, pending.current.patch);
      });
    }
  };
  const endDrag = () => { drag.current = null; };

  const pct = (v, of) => `${(v / of) * 100}%`;
  const num = { ...field, width: "72px", padding: "3px 6px", fontSize: "12px" };
  const pictureLabel = (l) => (l.kind === "text" ? (l.value || "Text").split("\n")[0].slice(0, 26) : l.name || LAYER_LABELS[l.kind]);
  const stack = [...slide.layers].reverse();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 400px) 1fr", gap: "18px", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <div style={label}>Add</div>
          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            {[["player", "Player"], ["logo", "Logo"], ["image", "Image"]].map(([k, t]) => (
              <button key={k} data-add={k} onClick={() => { setAdding(adding === k ? "" : k); setSearch(""); setLink(""); }} style={{ ...btn(adding === k), padding: "5px 12px" }}>+ {t}</button>
            ))}
            <button data-add="text" onClick={() => addLayer(newLayer("text"))} style={{ ...btn(false), padding: "5px 12px" }}>+ Text</button>
            <button data-add="shape" onClick={() => addLayer(newLayer("shape"))} style={{ ...btn(false), padding: "5px 12px" }}>+ Shape</button>
            <button data-add="brand" onClick={() => addLayer(newLayer("brand"))} style={{ ...btn(false), padding: "5px 12px" }}>+ We-Draft logo</button>
          </div>
          {(adding === "player" || adding === "logo" || adding === "colors") && (
            <div style={{ position: "relative", marginTop: "6px" }}>
              <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} data-add-search placeholder={adding === "player" ? (players ? "Search a prospect…" : "Loading players…") : (logos ? "Search a school or NFL team…" : "Loading…")} style={field} />
              {(adding === "player" ? playerHits : logoHits).length > 0 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #d5dce6", borderRadius: "6px", zIndex: 5, maxHeight: "260px", overflowY: "auto" }}>
                  {adding === "player" && playerHits.map((p) => (
                    <button key={p.id} onClick={() => addPlayer(p)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "6px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                      {p.First} {p.Last} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{p.Position} · {p.School} · {p.Eligible}</span>
                    </button>
                  ))}
                  {adding !== "player" && logoHits.map((t) => (
                    <button key={`${t.sub}|${t.name}`} onClick={() => {
                      if (adding === "colors") { setBg({ color: t.c1 || slide.bg.color, color2: t.c2 || "" }); setAdding(""); setSearch(""); return; }
                      if (!t.logo && !t.dark) { setMsg(`${t.name} has no logo yet.`); return; }
                      setMsg("");
                      addLayer(newLayer("logo", { url: t.dark || t.logo, name: t.name, light: t.logo, dark: t.dark }));
                    }} style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left", border: "none", background: "#fff", padding: "5px 9px", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}>
                      {(t.logo || t.dark) && <img src={sanitizeImgur(t.logo || t.dark) || t.logo || t.dark} alt="" style={{ width: "22px", height: "22px", objectFit: "contain" }} />}
                      {t.name} <span style={{ color: "#8a97ab", fontWeight: 700 }}>{t.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {adding === "image" && (
            <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
              <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://i.imgur.com/xxxx.jpg" style={field} data-add-link
                onKeyDown={(e) => { if (e.key === "Enter" && /^https:\/\//i.test(link.trim())) addLayer(newLayer("image", { url: link.trim() })); }} />
              <button onClick={() => addLayer(newLayer("image", { url: link.trim() }))} disabled={!/^https:\/\//i.test(link.trim())} style={{ ...btn(true), padding: "5px 12px" }}>Add</button>
            </div>
          )}
        </div>

        <div>
          <div style={label}>Layers · top is in front</div>
          {!stack.length && <div style={{ fontSize: "12px", fontWeight: 700, color: "#8a97ab" }}>Nothing on this slide yet.</div>}
          {stack.map((l) => (
            <div key={l.id} data-layer={l.kind} onClick={() => setSelId(l.id)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 7px", marginBottom: "3px", borderRadius: "6px", cursor: "pointer", border: `1px solid ${selId === l.id ? BLUE : "#e3e8ef"}`, background: selId === l.id ? "#eef5ff" : "#fff" }}>
              <span style={{ fontSize: "10px", fontWeight: 900, color: "#8a97ab", width: "52px", flexShrink: 0, textTransform: "uppercase" }}>{LAYER_LABELS[l.kind].replace("We-Draft logo", "Logo")}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: "12px", fontWeight: 800, color: "#33415a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pictureLabel(l)}</span>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(l.id, 1); }} style={linkBtn} title="Forward">↑</button>
              <button onClick={(e) => { e.stopPropagation(); moveLayer(l.id, -1); }} style={linkBtn} title="Back">↓</button>
              <button onClick={(e) => { e.stopPropagation(); removeLayer(l.id); }} style={{ ...linkBtn, color: "#a52a1e" }} title="Remove" data-layer-remove>✕</button>
            </div>
          ))}
        </div>

        {sel && (
          <div data-layer-props style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px", background: "#f8fafc", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={label}>{LAYER_LABELS[sel.kind]}{sel.name ? ` · ${sel.name}` : ""}</div>
            {sel.kind === "text" && (
              <>
                <textarea value={sel.value} onChange={(e) => patchLayer(sel.id, { value: e.target.value })} rows={2} style={{ ...field, fontFamily: "Arial, sans-serif", resize: "vertical" }} data-text-value />
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <input type="color" value={sel.color} onChange={(e) => patchLayer(sel.id, { color: e.target.value })} style={swatch} title="Color" />
                  <label style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>Size <input type="number" value={sel.size} onChange={(e) => patchLayer(sel.id, { size: Math.max(10, Number(e.target.value) || 10) })} style={num} /></label>
                  <div style={{ display: "flex", gap: "3px" }}>{[["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([v, t]) => <button key={v} onClick={() => patchLayer(sel.id, { align: v })} style={{ ...btn(sel.align === v), padding: "3px 8px", fontSize: "11px" }}>{t}</button>)}</div>
                </div>
              </>
            )}
            {sel.kind === "player" && (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(shots[sel.playerId]?.action || []).map((a) => (
                  <button key={a.url} onClick={() => patchLayer(sel.id, { url: a.url, cutout: true })} style={{ border: `2px solid ${sel.url === a.url ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "50px", height: "64px" }}>
                    <img src={sanitizeImgur(a.url) || a.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "5px" }} />
                  </button>
                ))}
                {shots[sel.playerId]?.headshot && (
                  <button onClick={() => patchLayer(sel.id, { url: shots[sel.playerId].headshot, cutout: false })} style={{ border: `2px solid ${sel.url === shots[sel.playerId].headshot ? BLUE : "#e3e8ef"}`, borderRadius: "8px", background: "#fff", padding: "2px", cursor: "pointer", width: "50px", height: "64px" }}>
                    <img src={shots[sel.playerId].headshot} alt="Headshot" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                  </button>
                )}
                <button data-add-name onClick={() => addLayer(newLayer("text", { value: sel.name, x: 60, y: 1040, size: 110 }))} style={{ ...btn(false), padding: "4px 10px", alignSelf: "center" }}>+ Add his name</button>
              </div>
            )}
            {sel.kind === "logo" && sel.light && sel.dark && sel.light !== sel.dark && (
              <div style={{ display: "flex", gap: "4px" }}>
                {[["dark", "Dark version"], ["light", "Light version"]].map(([v, t]) => <button key={v} onClick={() => patchLayer(sel.id, { url: sel[v] })} style={{ ...btn(sel.url === sel[v]), padding: "3px 10px", fontSize: "11px" }}>{t}</button>)}
              </div>
            )}
            {(sel.kind === "player" || sel.kind === "image") && (
              <>
                <input value={sel.url || ""} onChange={(e) => patchLayer(sel.id, { url: e.target.value })} placeholder="Image link…" style={field} />
                <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
                  <input type="checkbox" checked={!!sel.cutout} onChange={(e) => patchLayer(sel.id, { cutout: e.target.checked })} /> Remove its backdrop
                </label>
              </>
            )}
            {sel.kind === "shape" && (
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <input type="color" value={sel.color} onChange={(e) => patchLayer(sel.id, { color: e.target.value })} style={swatch} title="Color" />
                <label style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>Round <input type="number" min={0} value={sel.radius || 0} onChange={(e) => patchLayer(sel.id, { radius: Math.max(0, Number(e.target.value) || 0) })} style={num} /></label>
              </div>
            )}
            {sel.kind !== "text" && (
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
                See-through
                <input type="range" min={0.05} max={1} step={0.05} value={sel.opacity ?? 1} onChange={(e) => patchLayer(sel.id, { opacity: Number(e.target.value) })} style={{ flex: 1 }} />
                <span style={{ width: "34px", textAlign: "right" }}>{Math.round((sel.opacity ?? 1) * 100)}%</span>
              </label>
            )}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <label style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>X <input type="number" value={sel.x} onChange={(e) => patchLayer(sel.id, { x: Number(e.target.value) || 0 })} style={num} data-layer-x /></label>
              <label style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>Y <input type="number" value={sel.y} onChange={(e) => patchLayer(sel.id, { y: Number(e.target.value) || 0 })} style={num} /></label>
              {sel.kind !== "text" && <label style={{ fontSize: "12px", fontWeight: 800, color: "#33415a" }}>Width <input type="number" value={sel.w} onChange={(e) => patchLayer(sel.id, { w: Math.max(10, Number(e.target.value) || 10) })} style={num} data-layer-w /></label>}
            </div>
          </div>
        )}

        <div style={{ border: "1px solid #e3e8ef", borderRadius: "8px", padding: "8px 10px" }}>
          <div style={label}>Background · this slide</div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <input type="color" value={slide.bg.color || "#070d18"} onChange={(e) => setBg({ color: e.target.value })} style={swatch} title="Color" data-bg-color />
            {slide.bg.color2
              ? <><input type="color" value={slide.bg.color2} onChange={(e) => setBg({ color2: e.target.value })} style={swatch} title="Fades to" /><button onClick={() => setBg({ color2: "" })} style={{ ...linkBtn, color: "#8a97ab" }}>No fade</button></>
              : <button onClick={() => setBg({ color2: "#000000" })} style={linkBtn}>+ Fade to a second color</button>}
            <button onClick={() => { setAdding(adding === "colors" ? "" : "colors"); setSearch(""); }} style={linkBtn}>Use a team&apos;s colors</button>
          </div>
          <input value={slide.bg.image || ""} onChange={(e) => setBg({ image: e.target.value })} placeholder="Or a background image link…" style={{ ...field, marginTop: "6px" }} />
          <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a", marginTop: "8px" }}>
            <input type="checkbox" checked={footerOn} onChange={(e) => setFooterOn(e.target.checked)} data-footer /> We-Draft footer (every slide)
          </label>
          {footerOn && <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Footer text: WE-DRAFT.COM" style={{ ...field, marginTop: "6px" }} />}
        </div>

        <div><button onClick={() => Promise.all(drawn.map((s) => downloadSvg(s.svg, `wedraft-post-${s.name}`))).catch((e) => setMsg(`Couldn't export: ${e.message}`))} disabled={!drawn.length || empty} style={{ ...btn(true), opacity: drawn.length && !empty ? 1 : 0.5 }}>Download {drawn.length > 1 ? `all (${drawn.length})` : "PNG"}</button></div>
        <SaveBar type="custom" defaultName={`Post · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`} caption={cap.caption} svgs={svgs} post={post} setPost={setPost} onSaved={onSaved} setMsg={setMsg}
          playerIds={customPlayerIds(input)} subject={customPlayerIds(input).length === 1 ? { kind: "player", playerId: customPlayerIds(input)[0] } : null} hold={empty ? "Add something to the post first." : ""}
          stateNow={() => ({ slides, footerOn, cta })} />
        <CaptionBox c={cap} />
      </div>

      <div>
        <div style={{ ...label, display: "flex", alignItems: "center", gap: "8px" }}>
          Slide {at + 1} of {slides.length} · {IG_W}×{IG_H} · drag to move, pull the corner to size
        </div>
        <div data-custom-stage onPointerDown={() => setSelId("")} style={{ position: "relative", width: "100%", maxWidth: "540px", aspectRatio: `${IG_W} / ${IG_H}`, borderRadius: "8px", overflow: "hidden", border: "1px solid #d5dce6", background: "#0b1426", touchAction: "none" }}>
          {urls[at] && <img src={urls[at]} alt={`Slide ${at + 1}`} draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", pointerEvents: "none" }} />}
          {env && slide.layers.map((l) => {
            const b = layerBox(l, env, WdLogo);
            const on = l.id === selId;
            return (
              <div key={l.id} data-box={l.kind} onPointerDown={(e) => startDrag(e, l, "move")} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                style={{ position: "absolute", left: pct(b.x, IG_W), top: pct(b.y, IG_H), width: pct(b.w, IG_W), height: pct(b.h, IG_H), cursor: "move", outline: on ? `2px dashed ${GOLD}` : "none", boxSizing: "border-box", touchAction: "none" }}>
                {on && <div data-handle onPointerDown={(e) => startDrag(e, l, "size")} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag} style={{ position: "absolute", right: "-7px", bottom: "-7px", width: "14px", height: "14px", background: GOLD, border: "2px solid #fff", borderRadius: "3px", cursor: "nwse-resize", touchAction: "none" }} />}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap", alignItems: "flex-start" }}>
          {slides.map((_, i) => (
            <button key={i} data-slide-thumb={i} onClick={() => { setAt(i); setSelId(""); }} style={{ border: `2px solid ${i === at ? BLUE : "#e3e8ef"}`, borderRadius: "6px", padding: 0, width: "64px", background: "#0b1426", cursor: "pointer", overflow: "hidden" }}>
              {urls[i] ? <img src={urls[i]} alt={`Slide ${i + 1}`} style={{ width: "100%", display: "block", aspectRatio: `${IG_W} / ${IG_H}` }} /> : <div style={{ aspectRatio: `${IG_W} / ${IG_H}` }} />}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
          <button data-add-slide onClick={() => addSlide(false)} disabled={slides.length >= IG_MAX_SLIDES} style={{ ...btn(false), padding: "4px 10px" }}>+ Slide</button>
          <button data-copy-slide onClick={() => addSlide(true)} disabled={slides.length >= IG_MAX_SLIDES} style={{ ...btn(false), padding: "4px 10px" }}>Copy this slide</button>
          {slides.length > 1 && (
            <>
              <button onClick={() => moveSlide(-1)} disabled={at === 0} style={{ ...btn(false), padding: "4px 10px" }}>← Move</button>
              <button onClick={() => moveSlide(1)} disabled={at === slides.length - 1} style={{ ...btn(false), padding: "4px 10px" }}>Move →</button>
              <button onClick={removeSlide} style={{ ...btn(false), padding: "4px 10px", color: "#a52a1e" }}>Delete slide</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// The stats slide's numbers: ESPN's to start (edit any of them), or the
// admin's own when ESPN has none. Highlight picks the one drawn huge; the
// rest go on cards under it. edit: null = ESPN's untouched.
function StatsEditor({ espn, edit, onChange }) {
  const cur = edit || statsSeed(espn);
  const custom = !!edit;
  const set = (patch) => onChange({ ...cur, ...patch });
  const setTile = (k, patch) => set({ tiles: cur.tiles.map((t, j) => (j === k ? { ...t, ...patch } : t)) });
  const remove = (k) => set({ tiles: cur.tiles.filter((_, j) => j !== k), lead: cur.lead === k ? 0 : cur.lead > k ? cur.lead - 1 : cur.lead });
  const add = () => set({ tiles: [...cur.tiles, { label: "", value: "", rank: "" }] });
  const hasTable = !!(espn?.table || espn?.career);
  const box = { border: "1px solid #c9d3e0", borderRadius: "6px", padding: "5px 7px", fontSize: "12px", fontWeight: 700, color: "#0b1220", minWidth: 0, boxSizing: "border-box" };
  const small = { fontSize: "10px", fontWeight: 900, letterSpacing: "0.06em", color: "#8a97ab", textTransform: "uppercase" };
  const link = { background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "11px", fontWeight: 900, color: BLUE };
  return (
    <div style={{ border: "1px solid #dfe5ee", borderRadius: "10px", padding: "10px 12px", background: "#f8fafc" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
        <span style={{ fontSize: "12px", fontWeight: 900, color: "#0b1220" }}>Stats slide</span>
        <span style={{ fontSize: "11px", fontWeight: 700, color: "#8a97ab" }}>
          {custom ? "Your numbers" : espn?.hero ? "ESPN's numbers — edit any to make them yours" : espn ? "ESPN has a table but no season numbers — add your own" : "No ESPN stats — add your own"}
        </span>
        {custom && espn && <button onClick={() => onChange(null)} style={{ ...link, marginLeft: "auto" }}>RESET TO ESPN</button>}
      </div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
        <label style={{ display: "grid", gap: "2px", width: "90px" }}><span style={small}>Season</span>
          <input value={cur.year} onChange={(e) => set({ year: e.target.value })} placeholder="2025" style={box} /></label>
        <label style={{ display: "grid", gap: "2px", width: "110px" }}><span style={small}>Team</span>
          <input value={cur.team} onChange={(e) => set({ team: e.target.value })} placeholder="ND" style={box} /></label>
      </div>
      {cur.tiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "54px minmax(0,1.6fr) minmax(0,1fr) 64px 20px", gap: "5px 6px", alignItems: "center" }}>
          <span style={small}>Highlight</span><span style={small}>Stat</span><span style={small}>Number</span><span style={small} title="National rank, shown as #N IN FBS">FBS rank</span><span />
          {cur.tiles.map((t, k) => (
            <Fragment key={k}>
              <input type="radio" name="wd-stat-lead" checked={cur.lead === k} onChange={() => set({ lead: k })} title="Draw this one huge" style={{ justifySelf: "center" }} />
              <input value={t.label} onChange={(e) => setTile(k, { label: e.target.value })} placeholder="RECEIVING YARDS" style={box} />
              <input value={t.value} onChange={(e) => setTile(k, { value: e.target.value })} placeholder="1,204" style={box} />
              <input value={t.rank} onChange={(e) => setTile(k, { rank: e.target.value })} placeholder="—" style={box} />
              <button onClick={() => remove(k)} title="Remove" style={{ ...link, color: "#a52a1e", fontSize: "14px" }}>×</button>
            </Fragment>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginTop: "8px", flexWrap: "wrap" }}>
        {cur.tiles.length < MAX_STAT_TILES && <button onClick={add} style={link}>+ ADD A STAT</button>}
        {hasTable && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 800, color: "#33415a" }}>
            <input type="checkbox" checked={cur.table !== false} onChange={(e) => set({ table: e.target.checked })} /> ESPN&apos;s {espn.table ? "season table" : "career totals"} under them
          </label>
        )}
      </div>
    </div>
  );
}
