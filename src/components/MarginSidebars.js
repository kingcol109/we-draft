// src/components/MarginSidebars.js
//
// News.jsx and PerformancesHub.jsx's margin sidebars — a different pairing
// than MarginAds.js's Homage rails (those stay on player/article pages).
// Left margin: the same "Trending" widget PlayerProfile.js shows, rebuilt
// standalone here rather than imported (since PlayerProfile.js's version is
// entangled with that page's own hover/self-highlight state) and sized for
// more entries — this sidebar has the vertical room a player page doesn't.
// Right margin: a "follow us" social card stacked above a compact feed of
// the *other* content type (performances on the News page, news/articles on
// the Performances page) ending in a link to that page.
import { useEffect, useRef, useState } from "react";
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

// Same class-rank computation PlayerProfile.js's "same draft class" sidebar
// uses, replicated here for the "Top 2027 Prospects" fallback (see the
// trending-fetch effect below) — kept as plain module-level constants since
// nothing here depends on component state.
const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3, "Second Round": 4,
  "Third Round": 5, "Fourth Round": 6, "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, "UDFA": 10,
};
const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round", 4: "Second Round",
  5: "Third Round", 6: "Fourth Round", 7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};
// Same round-color badge map as PlayerProfile.js's own draft-class sidebar
// rows, so the "Top 2027 Prospects" fallback here reads as the same feature
// rather than a lookalike with its own color language.
const gradeDisplay = (g) => {
  const map = {
    "Watchlist":          { short: "W",   bg: "#5F5E5A", border: "#444441" },
    "Early First Round":  { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Late First Round":   { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Second Round":       { short: "2nd", bg: "#0F6E56", border: "#085041" },
    "Third Round":        { short: "3rd", bg: "#185FA5", border: "#0C447C" },
    "Fourth Round":       { short: "4th", bg: "#BA7517", border: "#854F0B" },
    "Fifth Round":        { short: "5th", bg: "#BA7517", border: "#854F0B" },
    "Sixth Round":        { short: "6th", bg: "#993C1D", border: "#712B13" },
    "Seventh Round":      { short: "7th", bg: "#993C1D", border: "#712B13" },
    "UDFA":               { short: "U",   bg: "#A32D2D", border: "#791F1F" },
  };
  return map[g] || { short: g, bg: "#5F5E5A", border: "#444441" };
};

// Same tiered "pop" effect used everywhere else performances show up.
const gradeGlowClass = (grade) => {
  if (grade === "Dominant") return "wd-perf-glow-dominant";
  if (grade === "Great") return "wd-perf-glow-great";
  if (grade === "Good") return "wd-perf-glow-good";
  return "";
};

// Brand-appropriate button color per platform, rather than one uniform blue
// outline for all three — icon stays inline so it reads at a glance.
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

// A visibly solid card (site-standard 2px blue border) with a light,
// grounded shadow rather than a heavy "floating" one — paired with
// anchoring the whole sidebar to scroll with the page (see positionStyle).
const cardShell = {
  width: "100%", borderRadius: "10px", overflow: "hidden",
  border: `2px solid ${BLUE}`, background: "#fff",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
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
  const [layout, setLayout] = useState({ width: 200, leftGutter: 0, rightGutter: 0, topOffset: 40, show: false });
  const [visible, setVisible] = useState(false);
  const [trending, setTrending] = useState([]);
  const [topProspects, setTopProspects] = useState([]);
  const [feedItems, setFeedItems] = useState([]);
  const [schoolLogos, setSchoolLogos] = useState({});
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
    const width = Math.max(190, Math.min(300, minGutter - 16));
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

  // The host page's content height changes for all sorts of reasons this
  // component has no visibility into (switching weeks, switching tabs,
  // toggling filters, data finishing a fetch) — each one moves this
  // component's own anchor point further down or up the document. Without
  // re-measuring on every such change, topOffset goes stale and the
  // sidebar drifts out of alignment with the content instead of staying
  // anchored to it.
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

  // Left — Trending, same source as PlayerProfile.js's sidebar. The
  // trends collection is hand-curated by the admin and is frequently empty —
  // when it is, this sidebar shouldn't just render nothing, so it falls back
  // to a "Top 2027 Prospects" leaderboard using the same avgGrade-from-
  // evaluations computation PlayerProfile.js's own draft-class rank uses.
  useEffect(() => {
    if (isMobile) return;

    const fetchTopProspects = async () => {
      try {
        const q = query(collection(db, "players"), where("Eligible", "==", "2027"));
        const snap = await getDocs(q);
        const list = await Promise.all(
          snap.docs
            .filter((d) => d.data().Live !== false)
            .map(async (d) => {
              const data = d.data();
              let avgGrade = null;
              try {
                const evalsSnap = await getDocs(collection(db, "players", d.id, "evaluations"));
                const grades = [];
                evalsSnap.forEach((ev) => {
                  const g = ev.data().grade;
                  if (g && gradeScale[g]) grades.push(gradeScale[g]);
                });
                if (grades.length > 0) avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
              } catch { }
              return { id: d.id, First: data.First || "", Last: data.Last || "", School: data.School || "", Slug: data.Slug || "", avgGrade };
            })
        );
        list.sort((a, b) => {
          const aLabel = a.avgGrade != null ? gradeLabels[Math.round(a.avgGrade)] : null;
          const bLabel = b.avgGrade != null ? gradeLabels[Math.round(b.avgGrade)] : null;
          const aV = aLabel ? gradeScale[aLabel] : null;
          const bV = bLabel ? gradeScale[bLabel] : null;
          if (aV && bV) return aV - bV;
          if (aV && !bV) return -1;
          if (!aV && bV) return 1;
          return 0;
        });
        setTopProspects(list.filter((p) => p.Slug).slice(0, 8));
      } catch (e) { setTopProspects([]); }
    };

    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "trends"));
        const shown = snap.docs
          .map((d) => ({ slug: d.id, ...d.data() }))
          .filter((t) => t.Shown === true)
          .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
          .slice(0, 8);
        setTrending(shown);
        if (shown.length === 0) fetchTopProspects();
      } catch (e) { setTrending([]); fetchTopProspects(); }
    };
    fetch();
  }, [isMobile]);

  // School name → logo, for the performance feed's team icons.
  useEffect(() => {
    if (isMobile || otherStream !== "performances") return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); if (data.School) map[data.School] = data.Logo1 || ""; });
        setSchoolLogos(map);
      } catch (e) { /* logos are non-critical */ }
    };
    fetch();
  }, [isMobile, otherStream]);

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
            .slice(0, 6);
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
          // Published date only, never last-updated — an old article
          // getting a small edit (which bumps updatedAt) must not jump back
          // to the top of this feed.
          const combined = [...newsItems, ...articleItems]
            .sort((a, b) => toMs(b.publishedAt) - toMs(a.publishedAt))
            .slice(0, 6);
          setFeedItems(combined);
        }
      } catch (e) { setFeedItems([]); }
    };
    fetch();
  }, [isMobile, otherStream]);

  // Anchored to a point just below where the main content starts, in
  // document coordinates — scrolls along with the page like everything
  // else instead of hovering fixed in the viewport regardless of scroll.
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
      <style>{`
        @keyframes wdTrendUpBoxSoft { 0%, 100% { box-shadow: 0 0 0 1px rgba(74,222,128,0.16), 0 0 4px 1px rgba(74,222,128,0.16); } 50% { box-shadow: 0 0 0 1px rgba(74,222,128,0.28), 0 0 7px 2px rgba(74,222,128,0.3); } }
        .wd-margin-trendup { animation: wdTrendUpBoxSoft 3.2s ease-in-out infinite; }
        @keyframes wdBreakoutBoxSoft { 0%, 100% { box-shadow: 0 0 0 1px rgba(143,216,255,0.16), 0 0 4px 1px rgba(143,216,255,0.16); } 50% { box-shadow: 0 0 0 1px rgba(143,216,255,0.28), 0 0 7px 2px rgba(143,216,255,0.3); } }
        .wd-margin-breakout { animation: wdBreakoutBoxSoft 3.2s ease-in-out infinite; }
        @keyframes wdOnFireBoxSoft { 0%, 100% { box-shadow: 0 0 0 1px rgba(255,140,0,0.16), 0 0 4px 1px rgba(255,90,0,0.16); } 50% { box-shadow: 0 0 0 1px rgba(255,140,0,0.3), 0 0 8px 2px rgba(255,90,0,0.32); } }
        .wd-margin-onfire { animation: wdOnFireBoxSoft 3.2s ease-in-out infinite; }
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

      {/* ===== Left: Top 5 Trending, or Top 2027 Prospects when there's no
          trend data to show — this slot should never just be empty. ===== */}
      {trending.length > 0 ? (
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
      ) : topProspects.length > 0 ? (
        <div style={positionStyle("left")}>
          <div style={cardShell}>
            <div style={{ background: BLUE, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                ⭐ Top 2027 Prospects
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            {topProspects.map((p, i) => {
              const gradeLabel = p.avgGrade != null ? gradeLabels[Math.round(p.avgGrade)] : "Watchlist";
              const gd = gradeDisplay(gradeLabel);
              return (
                <Link
                  key={p.id}
                  to={`/player/${p.Slug}`}
                  className="wd-margin-feed-item"
                  style={{
                    display: "flex", alignItems: "center", gap: "9px", padding: "9px 10px",
                    textDecoration: "none", background: "#fff",
                    borderBottom: i < topProspects.length - 1 ? "1px solid #f0f0f0" : "none",
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      width: "24px", height: "24px", borderRadius: "5px",
                      backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
                      color: "#fff", fontSize: "9px", fontWeight: 900,
                    }}
                    title={gradeLabel}
                  >
                    {gd.short}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ color: BLUE, fontWeight: 900, fontSize: "11px", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.First} {p.Last}
                    </span>
                    <span style={{ color: "#888", fontWeight: 700, fontSize: "10px", marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.School || "—"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ===== Right: Follow-us ad + other-stream feed ===== */}
      <div style={positionStyle("right")}>
        <div style={cardShell}>
          {/* Same BLUE-header + GOLD-accent-bar language as every other card
              here, instead of a flat white card with a plain gray label —
              no sponsorship disclosure needed, these are our own socials. */}
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

        {feedItems.length > 0 && (
          <div style={cardShell}>
            <div style={{ background: BLUE, padding: "8px 12px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                {otherStream === "performances" ? "Top Performances" : "Top Stories"}
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            {feedItems.map((item, i) => {
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
                  {isPerf && (
                    logo ? (
                      <img src={logo} alt="" style={{ width: "20px", height: "20px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <span style={{ width: "20px", height: "20px", flexShrink: 0, borderRadius: "4px", background: "#eee", display: "inline-block" }} />
                    )
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11px", fontWeight: 900, color: "#222", lineHeight: 1.3, whiteSpace: isPerf ? "nowrap" : "normal", overflow: isPerf ? "hidden" : "visible", textOverflow: isPerf ? "ellipsis" : "clip" }}>
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
      )}
    </div>
  );
}
