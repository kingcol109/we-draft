// src/components/GameMarginSidebars.js
//
// GamePage.js's margin sidebars — a third pairing alongside MarginAds.js
// (player/article/performance pages) and MarginSidebars.js (News/Performances
// hubs). Left: sitewide Top Performances, so a reader on one game can jump to
// the best write-ups anywhere. Right: Other Featured Games, so a reader on a
// showcase matchup finds their way to the site's other showcase matchups.
// Same fixed-position gutter-measurement technique as the other two — measure
// contentRef's bounding rect vs viewport, position:fixed + translateY(-50%).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Same tiered "pop" effect used everywhere else performances show up.
const gradeGlowClass = (grade) => {
  if (grade === "Dominant") return "wd-perf-glow-dominant";
  if (grade === "Great") return "wd-perf-glow-great";
  if (grade === "Good") return "wd-perf-glow-good";
  return "";
};

const GRADE_GLOW_STYLE = `
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
`;

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

const timeToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};
const formatTime12h = (t) => {
  const mins = timeToMinutes(t);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
};

// Monday 00:00 UTC → Sunday 23:59:59 UTC around right now — schedule26's
// Date field is stored as UTC midnight (a date-only value), so the week
// boundary has to be computed in UTC too or the edges drift by a day for
// anyone west of it.
function currentWeekBoundsUtc() {
  const now = new Date();
  const utcDay = now.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (utcDay === 0 ? -6 : 1) - utcDay;
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday, 0, 0, 0, 0);
  const sunday = monday + 7 * 24 * 60 * 60 * 1000 - 1;
  return { start: monday, end: sunday };
}

// A visibly solid card (site-standard 2px blue border, same language as
// every other bordered card on the site) with a light, grounded shadow
// rather than a heavy "floating" one — paired with anchoring the whole
// sidebar to scroll with the page (see positionStyle below).
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
 * @param {string} excludeGameId - the current game's doc id, kept out of the
 *   "Other Featured Games" list on the right.
 */
export default function GameMarginSidebars({ contentRef, isMobile, horizontalPadding = 20, excludeGameId }) {
  const [layout, setLayout] = useState({ width: 160, leftGutter: 0, rightGutter: 0, topOffset: 40, show: false });
  const [visible, setVisible] = useState(false);
  const [topPerformances, setTopPerformances] = useState([]);
  const [featuredGames, setFeaturedGames] = useState([]);
  const [newsItems, setNewsItems] = useState([]);
  const [schoolsByName, setSchoolsByName] = useState({});
  // This component renders after (below, in DOM order) the main content it
  // measures — anchorRef marks *this* component's own position so the
  // sidebar cards, positioned absolute beneath it, can be offset by the
  // (negative) distance back up to where the content starts, landing them
  // near its top while still scrolling naturally with the page (unlike the
  // old position:fixed, which ignored scroll entirely).
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
    const width = Math.max(150, Math.min(230, minGutter - 16));
    // Both rects are measured in the same viewport-relative coordinate
    // system at the same instant, so this delta is correct regardless of
    // scroll position or what (if anything) up the tree is positioned.
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

  // Content height can change for reasons that aren't a window resize (data
  // finishing a fetch, images loading in) — re-measure whenever it does so
  // topOffset doesn't go stale and the sidebar drift out of alignment.
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

  // School name → { Logo1, Short }, for the featured-games "bug" rows.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); if (data.School) map[data.School] = data; });
        setSchoolsByName(map);
      } catch (e) { /* logos/short names are non-critical */ }
    };
    fetch();
  }, [isMobile]);

  // Left — sitewide Top Performances (same grade filter the News/Performances
  // margin feeds already use), most recent first.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "performances"), where("status", "==", "published")));
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => ["Dominant", "Great", "Good"].includes(p.grade))
          .sort((a, b) => toMs(b.gameDate) - toMs(a.gameDate))
          .slice(0, 5);
        setTopPerformances(items);
      } catch (e) { setTopPerformances([]); }
    };
    fetch();
  }, [isMobile]);

  // Right — other Featured games happening THIS calendar week (Mon–Sun UTC),
  // so the "This Week's Featured Games" label is actually true rather than
  // just an approximation from sorting by time-proximity.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "schedule26"), where("Featured", "==", true)));
        const { start, end } = currentWeekBoundsUtc();
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((g) => g.id !== excludeGameId && g.Slug)
          .filter((g) => { const ms = toMs(g.Date); return ms >= start && ms <= end; })
          .sort((a, b) => toMs(a.Date) - toMs(b.Date))
          .slice(0, 5);
        setFeaturedGames(items);
      } catch (e) { setFeaturedGames([]); }
    };
    fetch();
  }, [isMobile, excludeGameId]);

  // Right (second card) — latest News, same "other stream" feed
  // MarginSidebars.js shows on the Performances hub: news is unfiltered,
  // articles only count if they're priority 1/2.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const [newsSnap, articleSnap] = await Promise.all([
          getDocs(query(collection(db, "news"), where("active", "==", true))),
          getDocs(query(collection(db, "articles"), where("status", "==", "published"))),
        ]);
        const newsList = newsSnap.docs.map((d) => ({ id: d.id, ...d.data(), _kind: "news" }));
        const articleList = articleSnap.docs
          .map((d) => ({ id: d.id, ...d.data(), _kind: "article" }))
          .filter((a) => [1, 2].includes(a.priority));
        const combined = [...newsList, ...articleList]
          .sort((a, b) => toMs(b.publishedAt || b.updatedAt) - toMs(a.publishedAt || a.updatedAt))
          .slice(0, 4);
        setNewsItems(combined);
      } catch (e) { setNewsItems([]); }
    };
    fetch();
  }, [isMobile]);

  // Anchored to a point just below where the main content starts, in
  // top:40px is relative to the zero-height anchor div this returns inside
  // top uses the measured topOffset (see recompute) so these cards land
  // near the top of the actual content and scroll along with the page,
  // instead of position:fixed hovering in the viewport regardless of scroll.
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
      <style>{GRADE_GLOW_STYLE}</style>

      {/* ===== Left: Top Performances — team logo, player, stat line ===== */}
      {topPerformances.length > 0 && (
        <div style={positionStyle("left")}>
          <div style={cardShell}>
            <div style={{ background: BLUE, padding: "8px 12px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                Top Performances
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            {topPerformances.map((item, i) => {
              const school = schoolsByName[item.school];
              return (
                <Link
                  key={item.id}
                  to={`/performance/${item.slug || item.id}`}
                  className={gradeGlowClass(item.grade)}
                  style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 10px", textDecoration: "none", borderBottom: i < topPerformances.length - 1 ? "1px solid #f0f0f0" : "none" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                >
                  {school?.Logo1 ? (
                    <img src={sanitizeUrl(school.Logo1)} alt="" style={{ width: "22px", height: "22px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <span style={{ width: "22px", height: "22px", flexShrink: 0, borderRadius: "4px", background: "#eee", display: "inline-block" }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 900, color: "#222", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.playerName || item.titleShort}
                    </div>
                    {item.statLine && (
                      <div style={{ fontFamily: "'Courier New', monospace", fontSize: "10.5px", fontWeight: 700, color: "#666", marginTop: "2px" }}>
                        {item.statLine}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== Right: This Week's Featured Games (compact scoreboard "bug"
          per game — short team codes + logos, big score once final or the
          kickoff date/time while still pregame) stacked above Top Stories.
          Each card renders independently so one being empty doesn't hide
          the other. ===== */}
      {(featuredGames.length > 0 || newsItems.length > 0) && (
        <div style={positionStyle("right")}>
          {featuredGames.length > 0 && (
          <div style={cardShell}>
            <div style={{ background: BLUE, padding: "8px 12px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                ⭐ This Week's Featured Games
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            {featuredGames.map((g, i) => {
              const played = g.Final && g.HomeScore != null && g.AwayScore != null;
              const away = schoolsByName[g.Away];
              const home = schoolsByName[g.Home];
              const awayWon = played && g.AwayScore > g.HomeScore;
              const homeWon = played && g.HomeScore > g.AwayScore;
              const dateMs = toMs(g.Date);
              const dateLabel = dateMs ? new Date(dateMs).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "TBD";
              const timeStr = formatTime12h(g.Time);

              const bugRow = (short, school, logo, score, won) => (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "2px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    {logo ? (
                      <img src={sanitizeUrl(logo)} alt="" style={{ width: "18px", height: "18px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span style={{ width: "18px", height: "18px", flexShrink: 0, borderRadius: "3px", background: "#ddd", display: "inline-block" }} />
                    )}
                    <span style={{ fontSize: "12px", fontWeight: 900, color: played ? (won ? "#222" : "#999") : "#333", letterSpacing: "0.02em" }}>
                      {short || school}
                    </span>
                  </div>
                  {played && (
                    <span style={{ fontSize: "18px", fontWeight: 900, color: won ? BLUE : "#bbb", flexShrink: 0 }}>{score}</span>
                  )}
                </div>
              );

              return (
                <Link
                  key={g.id}
                  to={`/game/${g.Slug}`}
                  style={{ display: "block", padding: "10px 12px", textDecoration: "none", borderBottom: i < featuredGames.length - 1 ? "1px solid #f0f0f0" : "none" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                >
                  {bugRow(away?.Short, g.Away, away?.Logo1, g.AwayScore, awayWon)}
                  {bugRow(home?.Short, g.Home, home?.Logo1, g.HomeScore, homeWon)}
                  {!played && (
                    <div style={{ fontSize: "10px", fontWeight: 700, color: "#aaa", marginTop: "3px" }}>
                      {dateLabel}{timeStr ? ` · ${timeStr}` : ""}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
          )}

          {/* Second right-side card — Top Stories, stacked below Featured
              Games so a game-page reader also has a way into the rest of
              the site's coverage, not just other games. Same "Top Stories"
              card MarginSidebars.js shows on the News/Performances hubs —
              same label, same item/button treatment. */}
          {newsItems.length > 0 && (
            <div style={cardShell}>
              <div style={{ background: BLUE, padding: "8px 12px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                  Top Stories
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {newsItems.map((item, i) => (
                <Link
                  key={item.id}
                  to={`/news/${item.slug}`}
                  style={{ display: "block", padding: "9px 10px", textDecoration: "none", borderBottom: i < newsItems.length - 1 ? "1px solid #f0f0f0" : "none" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                >
                  <div style={{ fontSize: "11px", fontWeight: 900, color: "#222", lineHeight: 1.3 }}>{item.title}</div>
                </Link>
              ))}
              <Link
                to="/news"
                style={{
                  display: "block", textAlign: "center", background: BLUE, color: "#fff",
                  fontWeight: 900, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em",
                  padding: "9px", textDecoration: "none",
                }}
              >
                View News →
              </Link>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
