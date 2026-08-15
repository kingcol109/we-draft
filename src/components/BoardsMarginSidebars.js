// src/components/BoardsMarginSidebars.js
//
// UserBoards.js's ("My Draft Board") margin sidebars — a fourth pairing
// alongside MarginAds.js (player/article/performance pages),
// MarginSidebars.js (News/Performances hubs), and GameMarginSidebars.js
// (individual game pages). Left: a compact preview of the signed-in user's
// My Feed (see MyFeed.js and the users/{uid}/follows subcollection the
// Follow button on PlayerProfile.js writes to). Right: the same "follow us"
// social card MarginSidebars.js shows, with no feed underneath it since
// there's no second content stream to plug in here.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Same tiered "pop" effect used everywhere else performances show up.
const gradeGlowClass = (grade) => {
  if (grade === "Dominant") return "wd-perf-glow-dominant";
  if (grade === "Great") return "wd-perf-glow-great";
  if (grade === "Good") return "wd-perf-glow-good";
  return "";
};

// Brand-appropriate button color per platform — same set as MarginSidebars.js.
const SOCIAL_LINKS = [
  { label: "Twitter / X", icon: "𝕏", href: "https://twitter.com/WeDraftSite", bg: "#000000" },
  { label: "Instagram", icon: "📸", href: "https://www.instagram.com/wedraftsite", bg: "linear-gradient(135deg, #f58529, #dd2a7b 45%, #8134af)" },
  { label: "YouTube", icon: "▶", href: "https://www.youtube.com/@kingcoldsports", bg: "#ff0000" },
];

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

const cardShell = {
  width: "100%", borderRadius: "10px", overflow: "hidden",
  border: `2px solid ${BLUE}`, background: "#fff",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
};

/**
 * @param {React.RefObject} contentRef - ref on the page's main content
 *   container, used to measure the left/right gutters.
 * @param {boolean} isMobile - hidden entirely on mobile (no gutter room).
 * @param {number} horizontalPadding - contentRef's own left/right padding.
 */
export default function BoardsMarginSidebars({ contentRef, isMobile, horizontalPadding = 20 }) {
  const { user } = useAuth();
  const [layout, setLayout] = useState({ width: 200, leftGutter: 0, rightGutter: 0, topOffset: 40, show: false });
  const [visible, setVisible] = useState(false);
  const [follows, setFollows] = useState([]);
  const [feedItems, setFeedItems] = useState([]);
  const [schoolLogos, setSchoolLogos] = useState({});
  const anchorRef = useRef(null);

  const recompute = useRef(() => {});
  recompute.current = () => {
    if (isMobile || !contentRef.current || !anchorRef.current) { setLayout((p) => ({ ...p, show: false })); return; }
    const rect = contentRef.current.getBoundingClientRect();
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const visibleLeftEdge = rect.left + horizontalPadding;
    const visibleRightEdge = rect.right - horizontalPadding;
    const leftGutter = Math.max(0, visibleLeftEdge);
    const rightGutter = Math.max(0, window.innerWidth - visibleRightEdge);
    const minGutter = Math.min(leftGutter, rightGutter);
    const MIN_USABLE_GUTTER = 170;
    if (minGutter < MIN_USABLE_GUTTER) { setLayout((p) => ({ ...p, show: false })); return; }
    const width = Math.max(190, Math.min(300, minGutter - 16));
    const topOffset = (rect.top - anchorRect.top) + 40;
    setLayout({ width, leftGutter, rightGutter, topOffset, show: true });
  };

  useEffect(() => {
    const handler = () => recompute.current();
    window.addEventListener("resize", handler);
    recompute.current();
    const t1 = setTimeout(() => recompute.current(), 200);
    const t2 = setTimeout(() => recompute.current(), 800);
    return () => { window.removeEventListener("resize", handler); clearTimeout(t1); clearTimeout(t2); };
  }, [isMobile]);

  // Re-anchor whenever the page's own content height changes (year switch,
  // filter toggle, data finishing a fetch) — not just on window resize. See
  // the identical fix in MarginSidebars.js/GameMarginSidebars.js.
  useEffect(() => {
    if (!contentRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recompute.current());
    ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [contentRef]);

  useEffect(() => {
    if (!layout.show) return;
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, [layout.show]);

  // Follows — same subcollection MyFeed.js reads.
  useEffect(() => {
    if (isMobile || !user) { setFollows([]); return; }
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "follows"));
        setFollows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) { setFollows([]); }
    };
    fetch();
  }, [isMobile, user]);

  // School logos, for performance items' team icons.
  useEffect(() => {
    if (isMobile || follows.length === 0) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); if (data.School) map[data.School] = data.Logo1 || ""; });
        setSchoolLogos(map);
      } catch (e) { /* logos are non-critical */ }
    };
    fetch();
  }, [isMobile, follows.length]);

  // Feed preview — same fetch-whole-published-set-and-filter-client-side
  // idiom as MyFeed.js, capped to the newest 6 for this compact card.
  useEffect(() => {
    if (isMobile || follows.length === 0) { setFeedItems([]); return; }
    const followedIds = new Set(follows.map((f) => f.id));
    const fetch = async () => {
      try {
        const [perfSnap, articleSnap] = await Promise.all([
          getDocs(query(collection(db, "performances"), where("status", "==", "published"))),
          getDocs(query(collection(db, "articles"), where("status", "==", "published"))),
        ]);
        const perfItems = perfSnap.docs
          .map((d) => ({ id: d.id, ...d.data(), _kind: "performance" }))
          .filter((p) => followedIds.has(p.playerId));
        const articleItems = articleSnap.docs
          .map((d) => ({ id: d.id, ...d.data(), _kind: "article" }))
          .filter((a) => Array.isArray(a.playerIds) && a.playerIds.some((pid) => followedIds.has(pid)));
        // Performances sort by their own gameDate; articles by publishedAt
        // only, never last-updated — an old article getting a small edit
        // (which bumps updatedAt) must not jump back to the top of this feed.
        const combined = [...perfItems, ...articleItems]
          .sort((a, b) => toMs(b.gameDate || b.publishedAt) - toMs(a.gameDate || a.publishedAt))
          .slice(0, 6);
        setFeedItems(combined);
      } catch (e) { setFeedItems([]); }
    };
    fetch();
  }, [isMobile, follows]);

  const positionStyle = (side) => {
    const gutter = side === "left" ? layout.leftGutter : layout.rightGutter;
    const offset = Math.max(8, (gutter - layout.width) / 2);
    return {
      position: "absolute", top: `${layout.topOffset}px`, [side]: `${offset}px`,
      width: `${layout.width}px`,
      display: "flex", flexDirection: "column", gap: "16px",
      zIndex: 5, opacity: visible ? 1 : 0, transition: "opacity 0.7s ease",
    };
  };

  return (
    <div ref={anchorRef} style={{ position: "relative", height: 0 }}>
      {(!layout.show || isMobile) ? null : (
      <>
      <style>{`
        .wd-margin-social-link:hover { filter: brightness(1.12); }
        .wd-margin-feed-item:hover { background: #f0f5ff; }
        @keyframes wdPerfGlowDominant {
          0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.45), 0 0 10px 3px rgba(246,162,29,0.55); }
          50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.7), 0 0 20px 7px rgba(246,162,29,0.9); }
        }
        .wd-perf-glow-dominant { animation: wdPerfGlowDominant 1.6s ease-in-out infinite; border-radius: 8px; margin: 3px 4px; }
        @keyframes wdPerfGlowGreat {
          0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.2), 0 0 5px 1px rgba(246,162,29,0.22); }
          50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.32), 0 0 9px 2px rgba(246,162,29,0.38); }
        }
        .wd-perf-glow-great { animation: wdPerfGlowGreat 2.6s ease-in-out infinite; border-radius: 8px; margin: 3px 4px; }
        .wd-perf-glow-good { box-shadow: 0 0 0 1px rgba(246,162,29,0.18); border-radius: 8px; margin: 3px 4px; }
      `}</style>

      {/* ===== Left: Following feed preview — never just empty, even with
          zero follows or zero matching activity yet. ===== */}
      <div style={positionStyle("left")}>
        <div style={cardShell}>
          <div style={{ background: BLUE, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif" }}>
              🔔 Following Feed
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          {follows.length === 0 ? (
            <div style={{ padding: "16px 14px", textAlign: "center" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#888", lineHeight: 1.5, marginBottom: "10px" }}>
                Follow players from their profile page to see their news &amp; performances here.
              </div>
              <Link to="/community" style={{ display: "inline-block", fontSize: "11px", fontWeight: 900, color: "#fff", background: GOLD, border: `2px solid ${BLUE}`, borderRadius: "6px", padding: "7px 12px", textDecoration: "none" }}>
                Find Players →
              </Link>
            </div>
          ) : feedItems.length === 0 ? (
            <div style={{ padding: "16px 14px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#888", lineHeight: 1.5 }}>
              No recent activity from your {follows.length} followed player{follows.length !== 1 ? "s" : ""} yet.
            </div>
          ) : (
            feedItems.map((item, i) => {
              const isPerf = item._kind === "performance";
              const href = isPerf ? `/performance/${item.slug || item.id}` : `/news/${item.slug}`;
              const logo = isPerf ? schoolLogos[item.school] : null;
              return (
                <Link
                  key={item.id}
                  to={href}
                  className={`wd-margin-feed-item ${isPerf ? gradeGlowClass(item.grade) : ""}`}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px", padding: "9px 10px", textDecoration: "none",
                    borderBottom: i < feedItems.length - 1 ? "1px solid #f0f0f0" : "none",
                  }}
                >
                  {isPerf ? (
                    logo ? (
                      <img src={logo} alt="" style={{ width: "20px", height: "20px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span style={{ width: "20px", height: "20px", flexShrink: 0, borderRadius: "4px", background: "#eee", display: "inline-block" }} />
                    )
                  ) : (
                    <span style={{ width: "20px", height: "20px", flexShrink: 0, borderRadius: "4px", background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px" }}>📰</span>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11px", fontWeight: 900, color: "#222", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isPerf ? (item.playerName || item.titleShort) : item.title}
                    </div>
                    {isPerf && item.statLine && (
                      <div style={{ fontFamily: "'Courier New', monospace", fontSize: "10px", fontWeight: 700, color: "#666", marginTop: "2px" }}>
                        {item.statLine}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })
          )}
          {follows.length > 0 && (
            <Link
              to="/boards/feed"
              style={{
                display: "block", textAlign: "center", background: BLUE, color: "#fff",
                fontWeight: 900, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em",
                padding: "9px", textDecoration: "none",
              }}
            >
              View My Feed →
            </Link>
          )}
        </div>
      </div>

      {/* ===== Right: Follow-us social card — no feed underneath, unlike
          MarginSidebars.js, since there's no second content stream here. ===== */}
      <div style={positionStyle("right")}>
        <div style={cardShell}>
          <div style={{ background: BLUE, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif" }}>
              📣 Follow We-Draft
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />
          <div style={{ padding: "10px 14px 12px" }}>
            <p style={{ fontSize: "11px", fontWeight: 600, color: "#666", lineHeight: 1.4, textAlign: "center", margin: "0 0 10px" }}>
              Get live updates on draft prospects and college football players!
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wd-margin-social-link"
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    background: s.bg, borderRadius: "8px", padding: "7px 10px",
                    textDecoration: "none", color: "#fff", fontWeight: 900, fontSize: "11px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "filter 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: "13px" }}>{s.icon}</span> {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
