// src/utils/siteUpdates.js
//
// Site updates: articles about We-Draft.com itself (articles/{id}.category ===
// "siteUpdate", set by the Type field in ArticlesManager.js).
//   • Pushed to every signed-in user's feed (MyFeed.js, and the boards
//     page's feed preview, BoardsMarginSidebars.js) whether or not they
//     follow anyone — unless they've turned them off in Settings
//     (UserProfile.js), users/{uid}.feedSiteUpdates === false.
//   • In the main news feed (News.jsx) too, but its Site Updates filter
//     starts off, so they're hidden until a reader turns it on.
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

export const SITE_UPDATE = "siteUpdate";
export const isSiteUpdate = (a) => a?.category === SITE_UPDATE;

// On unless the user has turned them off.
export const siteUpdatesInFeed = (profile) => profile?.feedSiteUpdates !== false;

export function setSiteUpdatesInFeed(uid, on) {
  return updateDoc(doc(db, "users", uid), { feedSiteUpdates: !!on });
}

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

// A user's feed from the published articles: the ones about players they
// follow, plus site updates (withSiteUpdates), newest first — by
// publishedAt only, never updatedAt, so an old article's small edit
// doesn't jump it back to the top.
export function feedFrom(articles, followedIds, withSiteUpdates) {
  return articles
    .filter((a) => (withSiteUpdates && isSiteUpdate(a))
      || (!isSiteUpdate(a) && Array.isArray(a.playerIds) && a.playerIds.some((pid) => followedIds.has(pid))))
    .sort((a, b) => toMs(b.publishedAt) - toMs(a.publishedAt));
}
