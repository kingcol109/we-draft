// src/components/MarginSidebars.js
//
// News.jsx and PerformancesHub.jsx's margin sidebars — a different pairing
// than MarginAds.js's Homage rails (those stay on player/article pages).
// Left margin: the same "Top 5 Trending" widget PlayerProfile.js shows,
// rebuilt standalone here rather than imported, since PlayerProfile.js's
// version is entangled with that page's own hover/self-highlight state.
// Right margin: a "follow us" social card stacked above a compact feed of
// the *other* content type (performances on the News page, news/articles on
// the Performances page) ending in a link to that page.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const TREND_STYLE = {
  up: { icon: "▲", label: "Up", badgeBg: "#16a34a", badgeBorder: "#0f6e33" },
  breakout: { icon: "⚡", label: "Breakout", badgeBg: "#4a535e", badgeBorder: "#2c333b" },
  "on fire": { icon: "🔥", label: "On Fire", badgeBg: "#ffcc00", badgeBorder: "#b38600" },
};

const gradeStyles = {
  Dominant: { background: "#e6f4ea", color: "#1a7f37" },
  Great: { background: "#eaf6ec", color: "#2e7d32" },
  Good: { background: "#eaf1ff", color: BLUE },
};

const SOCIAL_LINKS = [
  { label: "Twitter / X", icon: "𝕏", href: "https://twitter.com/WeDraftSite" },
  { label: "Instagram", icon: "📸", href: "https://www.instagram.com/wedraftsite" },
  { label: "YouTube", icon: "▶", href: "https://www.youtube.com/@kingcoldsports" },
];

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

const cardShell = {
  width: "100%", borderRadius: "14px", overflow: "hidden",
  border: "1px solid #eee", background: "#fff",
  boxShadow: "0 4px 18px rgba(0,0,0,0.08)",
};

/**
 * @param {React.RefObject} contentRef - ref on the page's main content
 *   container, used to measure the left/right gutters (same approach as
 *   MarginAds.js).
 * @param {boolean} isMobile - hidden entirely on mobile (no gutter room).
 * @param {number} horizontalPadding - contentRef's own left/right padding.
 * @param {"news"|"performances"} otherStream - which content type the right
 *   card's feed pulls from (the type the *current* page is NOT).
 */
export default function MarginSidebars({ contentRef, isMobile, horizontalPadding = 20, otherStream }) {
  const [layout, setLayout] = useState({ width: 160, leftGutter: 0, rightGutter: 0, show: false });
  const [visible, setVisible] = useState(false);
  const [trending, setTrending] = useState([]);
  const [feedItems, setFeedItems] = useState([]);

  const recompute = useRef(() => {});
  recompute.current = () => {
    if (isMobile || !contentRef.current) { setLayout((p) => ({ ...p, show: false })); return; }
    const rect = contentRef.current.getBoundingClientRect();
    const visibleLeftEdge = rect.left + horizontalPadding;
    const visibleRightEdge = rect.right - horizontalPadding;
    const leftGutter = Math.max(0, visibleLeftEdge);
    const rightGutter = Math.max(0, window.innerWidth - visibleRightEdge);
    const minGutter = Math.min(leftGutter, rightGutter);
    const MIN_USABLE_GUTTER = 170;
    if (minGutter < MIN_USABLE_GUTTER) { setLayout((p) => ({ ...p, show: false })); return; }
    const width = Math.max(150, Math.min(230, minGutter - 16));
    setLayout({ width, leftGutter, rightGutter, show: true });
  };

  useEffect(() => {
    const handler = () => recompute.current();
    window.addEventListener("resize", handler);
    recompute.current();
    const t1 = setTimeout(() => recompute.current(), 200);
    const t2 = setTimeout(() => recompute.current(), 800);
    return () => { window.removeEventListener("resize", handler); clearTimeout(t1); clearTimeout(t2); };
  }, [isMobile]);

  useEffect(() => {
    if (!layout.show) return;
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, [layout.show]);

  // Left — Top 5 Trending, same source as PlayerProfile.js's sidebar.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "trends"));
        const shown = snap.docs
          .map((d) => ({ slug: d.id, ...d.data() }))
          .filter((t) => t.Shown === true)
          .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
          .slice(0, 5);
        setTrending(shown);
      } catch (e) { setTrending([]); }
    };
    fetch();
  }, [isMobile]);

  // Right — the other content type's feed, pre-filtered the same way the
  // hub pages themselves default to: News page's feed only shows
  // Dominant/Great/Good performances; Performances page's feed only shows
  // Priority 1/2 articles (news items have no priority field, so they pass
  // through unfiltered).
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        if (otherStream === "performances") {
          const snap = await getDocs(query(collection(db, "performances"), where("status", "==", "published")));
          const items = snap.docs
            .map((d) => ({ id: d.id, ...d.data(), _kind: "performance" }))
            .filter((p) => ["Dominant", "Great", "Good"].includes(p.grade))
            .sort((a, b) => toMs(b.gameDate) - toMs(a.gameDate))
            .slice(0, 4);
          setFeedItems(items);
        } else {
          const [newsSnap, articleSnap] = await Promise.all([
            getDocs(query(collection(db, "news"), where("active", "==", true))),
            getDocs(query(collection(db, "articles"), where("status", "==", "published"))),
          ]);
          const newsItems = newsSnap.docs.map((d) => ({ id: d.id, ...d.data(), _kind: "news" }));
          const articleItems = articleSnap.docs
            .map((d) => ({ id: d.id, ...d.data(), _kind: "article" }))
            .filter((a) => [1, 2].includes(a.priority));
          const combined = [...newsItems, ...articleItems]
            .sort((a, b) => toMs(b.publishedAt || b.updatedAt) - toMs(a.publishedAt || a.updatedAt))
            .slice(0, 4);
          setFeedItems(combined);
        }
      } catch (e) { setFeedItems([]); }
    };
    fetch();
  }, [isMobile, otherStream]);

  const positionStyle = (side) => {
    const gutter = side === "left" ? layout.leftGutter : layout.rightGutter;
    const offset = Math.max(8, (gutter - layout.width) / 2);
    return {
      position: "fixed", top: "50%", [side]: `${offset}px`,
      transform: "translateY(-50%)", width: `${layout.width}px`,
      display: "flex", flexDirection: "column", gap: "16px",
      zIndex: 5, opacity: visible ? 1 : 0, transition: "opacity 0.7s ease",
    };
  };

  if (!layout.show || isMobile) return null;

  return (
    <>
      <style>{`
        @keyframes wdTrendUpBoxSoft { 0%, 100% { box-shadow: 0 0 0 1px rgba(74,222,128,0.16), 0 0 4px 1px rgba(74,222,128,0.16); } 50% { box-shadow: 0 0 0 1px rgba(74,222,128,0.28), 0 0 7px 2px rgba(74,222,128,0.3); } }
        .wd-margin-trendup { animation: wdTrendUpBoxSoft 3.2s ease-in-out infinite; }
        @keyframes wdBreakoutBoxSoft { 0%, 100% { box-shadow: 0 0 0 1px rgba(143,216,255,0.16), 0 0 4px 1px rgba(143,216,255,0.16); } 50% { box-shadow: 0 0 0 1px rgba(143,216,255,0.28), 0 0 7px 2px rgba(143,216,255,0.3); } }
        .wd-margin-breakout { animation: wdBreakoutBoxSoft 3.2s ease-in-out infinite; }
        @keyframes wdOnFireBoxSoft { 0%, 100% { box-shadow: 0 0 0 1px rgba(255,140,0,0.16), 0 0 4px 1px rgba(255,90,0,0.16); } 50% { box-shadow: 0 0 0 1px rgba(255,140,0,0.3), 0 0 8px 2px rgba(255,90,0,0.32); } }
        .wd-margin-onfire { animation: wdOnFireBoxSoft 3.2s ease-in-out infinite; }
        .wd-margin-social-link:hover { background: #f0f5ff; }
        .wd-margin-feed-item:hover { background: #f0f5ff; }
      `}</style>

      {/* ===== Left: Top 5 Trending ===== */}
      {trending.length > 0 && (
        <div style={positionStyle("left")}>
          <div style={cardShell}>
            <div style={{ background: BLUE, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                🔥 Trending
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            {trending.map((t, i) => {
              const style = TREND_STYLE[(t.Trend || "").toString().trim().toLowerCase()];
              if (!style) return null;
              const softClass = style === TREND_STYLE.up ? "wd-margin-trendup" : style === TREND_STYLE.breakout ? "wd-margin-breakout" : "wd-margin-onfire";
              return (
                <Link
                  key={t.slug}
                  to={`/player/${t.slug}`}
                  className={softClass}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px", padding: "9px 10px",
                    textDecoration: "none", background: "#fff",
                    borderLeft: `3px solid ${style.badgeBorder}`,
                    borderBottom: i < trending.length - 1 ? "1px solid #f0f0f0" : "none",
                  }}
                >
                  <div style={{
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    width: "22px", height: "22px", borderRadius: "4px",
                    background: style.badgeBg, border: `1px solid ${style.badgeBorder}`,
                    fontSize: "10px",
                  }} title={style.label}>
                    {style.icon}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ color: BLUE, fontWeight: 900, fontSize: "11px", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.First} {t.Last}
                    </span>
                    <span style={{ color: "#888", fontWeight: 700, fontSize: "10px", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.School || "—"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Right: Follow-us ad + other-stream feed ===== */}
      <div style={positionStyle("right")}>
        <div style={cardShell}>
          <div style={{ fontSize: "9px", fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "center", padding: "8px 10px 0" }}>
            Sponsored
          </div>
          <div style={{ padding: "8px 14px 12px" }}>
            <div style={{ fontWeight: 900, fontSize: "12px", color: BLUE, textAlign: "center", marginBottom: "6px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
              Follow We-Draft
            </div>
            <p style={{ fontSize: "11px", fontWeight: 600, color: "#666", lineHeight: 1.4, textAlign: "center", margin: "0 0 10px" }}>
              Follow us on social media for live updates of draft prospects and college football players!
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wd-margin-social-link"
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    border: `1px solid ${BLUE}`, borderRadius: "8px", padding: "6px 10px",
                    textDecoration: "none", color: BLUE, fontWeight: 900, fontSize: "11px",
                  }}
                >
                  <span>{s.icon}</span> {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {feedItems.length > 0 && (
          <div style={cardShell}>
            <div style={{ background: BLUE, padding: "8px 12px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                {otherStream === "performances" ? "Top Performances" : "Top Stories"}
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            {feedItems.map((item, i) => {
              const grade = item._kind === "performance" ? gradeStyles[item.grade] : null;
              const href = item._kind === "performance" ? `/performance/${item.slug || item.id}` : `/news/${item.slug}`;
              const title = item._kind === "performance" ? item.titleShort : item.title;
              return (
                <Link
                  key={item.id}
                  to={href}
                  className="wd-margin-feed-item"
                  style={{
                    display: "block", padding: "9px 10px", textDecoration: "none",
                    borderBottom: i < feedItems.length - 1 ? "1px solid #f0f0f0" : "none",
                  }}
                >
                  {grade && (
                    <span style={{ display: "inline-block", marginBottom: "3px", fontSize: "8px", fontWeight: 900, padding: "1px 6px", borderRadius: "3px", background: grade.background, color: grade.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {item.grade}
                    </span>
                  )}
                  <div style={{ fontSize: "11px", fontWeight: 900, color: "#222", lineHeight: 1.3 }}>
                    {title}
                  </div>
                </Link>
              );
            })}
            <Link
              to={otherStream === "performances" ? "/performances" : "/news"}
              style={{
                display: "block", textAlign: "center", background: BLUE, color: "#fff",
                fontWeight: 900, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em",
                padding: "9px", textDecoration: "none",
              }}
            >
              View {otherStream === "performances" ? "Performances" : "News"} →
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
