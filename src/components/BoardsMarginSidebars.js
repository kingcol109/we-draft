// src/components/BoardsMarginSidebars.js
//
// UserBoards.js's ("My Boards") right-rail cards, laid out the way the
// Community Board lays out its rails (a grid column, not floating in the
// page margins), and styled by boardKit's wdb-side / wdb-sidehead:
//   BoardsFeedCard   — a compact preview of the signed-in user's My Feed
//                      (MyFeed.js; users/{uid}/follows, written by the
//                      Follow button on PlayerProfile.js).
//   BoardsFollowCard — the "follow us" social links.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { feedFrom, isSiteUpdate, siteUpdatesInFeed } from "../utils/siteUpdates";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Brand-appropriate button color per platform — same set as MarginSidebars.js.
const SOCIAL_LINKS = [
  { label: "Twitter / X", icon: "𝕏", href: "https://twitter.com/WeDraftSite", bg: "#000000" },
  { label: "Instagram", icon: "📸", href: "https://www.instagram.com/wedraftsite", bg: "linear-gradient(135deg, #f58529, #dd2a7b 45%, #8134af)" },
  { label: "YouTube", icon: "▶", href: "https://www.youtube.com/@kingcoldsports", bg: "#ff0000" },
];

const cardShell = {
  width: "100%", borderRadius: "10px", overflow: "hidden",
  border: `2px solid ${BLUE}`, background: "#fff", fontFamily: "'Arial Black', Arial, sans-serif",
};

function CardHead({ children }) {
  return (
    <>
      <div className="wdb-sidehead" style={{ background: BLUE, padding: "10px 12px", textAlign: "center" }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase" }}>{children}</div>
      </div>
      <div className="wdb-stripe" style={{ height: "3px", background: GOLD }} />
    </>
  );
}

// "Nov 12" — an article's publishedAt (Timestamp, Date or string), or "".
function feedDate(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d || isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function BoardsFeedCard() {
  const { user, profile } = useAuth();
  const withSiteUpdates = siteUpdatesInFeed(profile);
  const [follows, setFollows] = useState([]);
  const [feedItems, setFeedItems] = useState([]);

  // Follows — same subcollection MyFeed.js reads.
  useEffect(() => {
    if (!user) { setFollows([]); return; }
    getDocs(collection(db, "users", user.uid, "follows"))
      .then((snap) => setFollows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch(() => setFollows([]));
  }, [user]);

  // Feed preview — same fetch-the-published-set-and-filter idiom as
  // MyFeed.js, the newest 6. Only `articles` carry playerIds, so plain
  // `news` items are left out here too. publishedAt only, never updatedAt:
  // an old article's small edit mustn't jump it back to the top.
  // Site updates come in too (utils/siteUpdates.js), unless turned off.
  useEffect(() => {
    if (!user) { setFeedItems([]); return; }
    const followedIds = new Set(follows.map((f) => f.id));
    if (followedIds.size === 0 && !withSiteUpdates) { setFeedItems([]); return; }
    getDocs(query(collection(db, "articles"), where("status", "==", "published")))
      .then((snap) => setFeedItems(feedFrom(snap.docs.map((d) => ({ id: d.id, ...d.data() })), followedIds, withSiteUpdates).slice(0, 6)))
      .catch(() => setFeedItems([]));
  }, [user, follows, withSiteUpdates]);

  return (
    <div className="wdb-side" style={cardShell}>
      <style>{".wd-margin-feed-item:hover { background: #f0f5ff; }"}</style>
      <CardHead>🔔 Following Feed</CardHead>
      {follows.length === 0 && feedItems.length === 0 ? (
        <div style={{ padding: "16px 14px", textAlign: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#888", lineHeight: 1.5, marginBottom: "10px", fontFamily: "Arial, sans-serif" }}>
            Follow players from their profile page to see their news here.
          </div>
          <Link to="/community" className="wdb-pill on" style={{ display: "inline-block", fontSize: "11px", fontWeight: 900, color: "#fff", background: BLUE, border: `2px solid ${BLUE}`, borderRadius: "999px", padding: "7px 14px", textDecoration: "none" }}>
            Find Players →
          </Link>
        </div>
      ) : feedItems.length === 0 ? (
        <div style={{ padding: "16px 14px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#888", lineHeight: 1.5, fontFamily: "Arial, sans-serif" }}>
          No recent activity from your {follows.length} followed player{follows.length !== 1 ? "s" : ""} yet.
        </div>
      ) : (
        feedItems.map((item, i) => (
          <Link key={item.id} to={`/news/${item.slug}`} className="wd-margin-feed-item"
            style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 14px", textDecoration: "none", borderBottom: i < feedItems.length - 1 ? "1px solid #eef1f5" : "none" }}>
            <span style={{ width: "22px", height: "22px", marginTop: "2px", flexShrink: 0, borderRadius: "5px", background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px" }}>📰</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {isSiteUpdate(item) && <div style={{ color: GOLD, fontSize: "10px", fontWeight: 900, letterSpacing: "0.08em", marginBottom: "3px" }}>SITE UPDATE</div>}
              {/* The whole headline, up to three lines (one cut-off line was unreadable). */}
              <div className="wdb-ntitle" style={{ color: "#222", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", fontFamily: "Arial, sans-serif" }}>
                {item.title}
              </div>
              {feedDate(item.publishedAt) && <div style={{ marginTop: "4px", fontSize: "11px", fontWeight: 700, color: "#8a94a3", fontFamily: "Arial, sans-serif" }}>{feedDate(item.publishedAt)}</div>}
            </div>
          </Link>
        ))
      )}
      {(follows.length > 0 || feedItems.length > 0) && (
        <Link to="/boards/feed" style={{ display: "block", textAlign: "center", background: BLUE, color: "#fff", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", padding: "9px", textDecoration: "none" }}>
          View My Feed →
        </Link>
      )}
    </div>
  );
}

export function BoardsFollowCard() {
  return (
    <div className="wdb-side" style={cardShell}>
      <style>{".wd-margin-social-link:hover { filter: brightness(1.12); }"}</style>
      <CardHead>📣 Follow We-Draft</CardHead>
      <div style={{ padding: "12px 14px 14px" }}>
        <p style={{ fontSize: "12px", fontWeight: 600, color: "#666", lineHeight: 1.4, textAlign: "center", margin: "0 0 10px", fontFamily: "Arial, sans-serif" }}>
          Get live updates on draft prospects and college football players!
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {SOCIAL_LINKS.map((s) => (
            <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="wd-margin-social-link"
              style={{ display: "flex", alignItems: "center", gap: "8px", background: s.bg, borderRadius: "8px", padding: "8px 12px", textDecoration: "none", color: "#fff", fontWeight: 900, fontSize: "12px", transition: "filter 0.15s ease" }}>
              <span style={{ fontSize: "13px" }}>{s.icon}</span> {s.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
