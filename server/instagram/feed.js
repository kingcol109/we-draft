// server/instagram/feed.js
//
// The public Instagram feed on the Home page (pages/HomeInstagram.jsx): the
// latest posts from @wedraftsite, written to config/instagramFeed (public
// read, like every config doc). It's the one piece of Instagram the public
// site shows: published posts only (image, link, caption, date), the
// account's handle, picture and follower count. No analytics, no token.
//
// Instagram's image links expire after a few days (the oe= in their URL),
// so the cron (api/instagram.js) rewrites the doc every hour, and the page
// hides any tile whose image fails anyway.

const FEED_DOC = "config/instagramFeed";
const FEED_SIZE = 12;
const CAPTION_MAX = 220;
const MEDIA_FIELDS = "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url";
const ACCOUNT_FIELDS = "username,name,followers_count,media_count,profile_picture_url";

const kindOf = (m) => (m.media_type === "VIDEO" ? (m.media_product_type === "REELS" ? "reel" : "video") : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : "image");

const clip = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t;
};

// Graph's /media and /{user} answers → the doc. Stories and anything without
// an image or a link are left out.
function buildFeed(media, account, now = Date.now()) {
  const items = (media || [])
    .filter((m) => m && m.permalink && m.media_product_type !== "STORY")
    .map((m) => ({
      id: String(m.id),
      url: m.permalink,
      image: m.thumbnail_url || (m.media_type === "VIDEO" ? null : m.media_url) || null,
      kind: kindOf(m),
      caption: clip(m.caption, CAPTION_MAX),
      at: m.timestamp ? Date.parse(m.timestamp) || null : null,
    }))
    .filter((m) => m.image)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, FEED_SIZE);
  return {
    username: account?.username || "wedraftsite",
    name: account?.name || null,
    followers: account?.followers_count ?? null,
    posts: account?.media_count ?? null,
    picture: account?.profile_picture_url || null,
    items,
    updatedAt: now,
  };
}

// One refresh: two Graph calls, one write. deps: { graph, userId }.
async function refreshFeed(db, { graph, userId }) {
  const [media, account] = await Promise.all([
    graph(`/${userId}/media`, { params: { fields: MEDIA_FIELDS, limit: FEED_SIZE + 6 } }),
    graph(`/${userId}`, { params: { fields: ACCOUNT_FIELDS } }),
  ]);
  const feed = buildFeed(media.data, account);
  await db.doc(FEED_DOC).set(feed);
  return { items: feed.items.length };
}

module.exports = { FEED_DOC, FEED_SIZE, buildFeed, refreshFeed };
