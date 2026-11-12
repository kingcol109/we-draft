// src/utils/instagram/sitePost.js
//
// A saved Instagram post put on the site: an articles doc (the same one
// ArticlesManager.js writes, so it shows in News, the Home page, More News
// and its players' pages) whose `gallery` is the post's slides and clips, in
// carousel order, and whose body is the caption. pages/NewsArticle.jsx shows
// the gallery as a swipeable carousel over the caption, so a visitor sees the
// whole post without leaving We-Draft.
//
// The slides go to the bucket through api/instagram.js (site-slide /
// site-video — server/instagram/sitePost.js; the bucket is closed to
// browsers) under a fresh rev each time; once the article points at them,
// site-clean deletes the post's older revs. The instagramPosts doc keeps
// { site: { articleId, slug, title, titleShort, rev, at } }, so posting again updates the same
// article (its slug and date stay put).
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { igApi } from "./api";
import { svgToBlob } from "../../components/SocialMakerKit";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The caption → the article body: a paragraph a block (blank-line separated),
// <br> within one, and every we-draft.com address a link on the site itself.
export function captionHtml(caption) {
  const linkify = (s) => esc(s).replace(/\b(?:https?:\/\/)?(?:www\.)?we-draft\.com(\/[^\s<]*)?/gi, (m, path = "") => {
    const clean = path.replace(/[.,!?)]+$/, "");
    const tail = path.slice(clean.length);
    return `<a href="${clean || "/"}">${m.slice(0, m.length - tail.length)}</a>${tail}`;
  });
  return String(caption || "").replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${p.split("\n").map(linkify).join("<br>")}</p>`).join("");
}

// The article's title: the caption's first line, without a closing period.
export function siteTitle(caption, fallback = "") {
  const first = String(caption || "").split("\n").map((l) => l.trim()).find(Boolean) || fallback;
  return first.replace(/[.:]+$/, "").slice(0, 140);
}

// The short title to start from: the long one up to its first comma
// ("Today's Player Spotlight: Aiden Flora, RB, Iowa State" → "…: Aiden Flora").
export const siteShortTitle = (title) => String(title || "").split(",")[0].trim();

// As ArticlesManager.js's slugFor: the short title's words, then the date
// (its publish day, as that page builds it — local midnight, in ISO).
export function siteSlug(titleShort, date) {
  const words = String(titleShort || "").trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return [words, day.toISOString().slice(0, 10)].filter(Boolean).join("-");
}

// A short plain-text summary for the article's SEO description.
const summaryOf = (caption) => String(caption || "").split(/\n{2,}/).slice(1).join(" ").replace(/#\w+/g, "").replace(/\s+/g, " ").trim().slice(0, 155);

const newRev = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const sizeOf = (svg) => {
  const m = String(svg).match(/<svg[^>]*?width="(\d+)"[^>]*?height="(\d+)"/);
  return m ? [Number(m[1]), Number(m[2])] : [1080, 1350];
};
async function jpegBase64(svg) {
  const [w, h] = sizeOf(svg);
  let blob = await svgToBlob(svg, "image/jpeg", 0.9, w, h);
  if (blob && blob.size > 3e6) blob = await svgToBlob(svg, "image/jpeg", 0.82, w, h);
  if (!blob) throw new Error("Couldn't make the image.");
  const url = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob); });
  return String(url).split(",")[1];
}

// The post's site article, made or brought up to date. order: [{ svg } |
// { video: path }] in carousel order. → { articleId, slug }.
export async function postToSite({ postId, order, caption, title, titleShort, playerIds = [], uid = "", onPhase = () => {} }) {
  const postRef = doc(db, "instagramPosts", postId);
  const postData = (await getDoc(postRef)).data() || {};
  const prev = postData.site || null;
  const prevArticle = prev?.articleId ? await getDoc(doc(db, "articles", prev.articleId)) : null;
  const rev = newRev();
  const gallery = [];
  for (let i = 0; i < order.length; i++) {
    onPhase(`Uploading ${i + 1} of ${order.length}…`);
    if (order[i].video) {
      const { url } = await igApi("site-video", { postId, rev, index: i, path: order[i].video });
      gallery.push({ type: "video", url });
    } else {
      const { url, w, h } = await igApi("site-slide", { postId, rev, index: i, jpeg: await jpegBase64(order[i].svg) });
      gallery.push({ type: "image", url, w, h });
    }
  }
  onPhase("Saving the article…");
  const fields = {
    title, titleShort: titleShort || title, content: captionHtml(caption), gallery, playerIds: [...new Set(playerIds.filter(Boolean))],
    seoDescription: summaryOf(caption), igPostId: postId, status: "published",
    // The post on Instagram, once it's there (publish.js adds it if that's later).
    igPermalink: postData.ig?.permalink || "",
  };
  let articleId;
  let slug;
  if (prevArticle?.exists()) {
    articleId = prevArticle.id;
    slug = prevArticle.data().slug;
    await updateDoc(doc(db, "articles", articleId), { ...fields, updatedAt: serverTimestamp() });
  } else {
    const now = new Date();
    slug = siteSlug(titleShort || title, now);
    articleId = (await addDoc(collection(db, "articles"), {
      ...fields, slug, priority: 2, author: "We-Draft.com", publishedAt: now,
      teamSlugs: [], schools: [], gameIds: [], videoId: "", authorId: uid, createdAt: serverTimestamp(),
    })).id;
  }
  await updateDoc(postRef, { site: { articleId, slug, title, titleShort: titleShort || title, rev, at: Date.now() } });
  // The files the article doesn't use any more (an earlier posting's).
  await igApi("site-clean", { postId, keep: rev }).catch(() => {});
  return { articleId, slug };
}
