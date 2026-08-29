// src/components/MarginSidebars.js
//
// News.jsx and PerformancesHub.jsx's margin sidebars — a different pairing
// than MarginAds.js's Homage rails (those stay on player/article pages).
// Left margin: the same "Trending" widget PlayerProfile.js shows, rebuilt
// standalone here rather than imported (since PlayerProfile.js's version is
// entangled with that page's own hover/self-highlight state) and sized for
// more entries — this sidebar has the vertical room a player page doesn't.
// Right margin: a "follow us" social card, then a Videos feed card (same
// "videos" collection/thumbnail-card treatment as CommunityBoard.js's own
// Videos sidebar), then a compact feed of the *other* content type
// (performances on the News page, news/articles on the Performances page)
// ending in a link to that page.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { gradeStatLineClass, STAT_LINE_GLOW_STYLE } from "./statLineGlow";
import PlayersMentionedList from "./PlayersMentionedList";
// Breakout/On Fire trend icons — same custom images PlayerProfile.js's
// version of this widget uses now instead of the ⚡/🔥 emoji glyphs (Up
// keeps its ▲ triangle text).
import BreakoutIcon from "../assets/breakout1.png";
import OnFireIcon from "../assets/onfire.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// iconClass — same themed per-trend icon animation as PlayerProfile.js's
// own Trending widget (Up a steady bounce, Breakout an electric wobble, On
// Fire a flicker); see the matching keyframes further down.
const TREND_STYLE = {
  up: { icon: "▲", label: "Up", badgeBg: "#16a34a", badgeBorder: "#0f6e33", iconClass: "wd-margin-trendup-icon" },
  breakout: { icon: "⚡", iconImg: BreakoutIcon, label: "Breakout", badgeBg: "#4a535e", badgeBorder: "#2c333b", iconClass: "wd-margin-breakout-icon" },
  "on fire": { icon: "🔥", iconImg: OnFireIcon, label: "On Fire", badgeBg: "#ff0000", badgeBorder: "#a30000", iconClass: "wd-margin-onfire-icon" },
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

// Same input-URL cleanup + "how long ago" bucketing as CommunityBoard.js's
// own Videos sidebar — duplicated here rather than shared, matching this
// codebase's per-file convention for small helpers like this.
const sanitizeUrl = (url) => {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
};

// Only ever called with a video's Date (a date-only value, parsed as UTC
// midnight) — UTC getters on both sides so this reads the same regardless
// of the viewer's own timezone. See CommunityBoard.js's own copy of this
// for the full reasoning.
function formatRelativeTime(input) {
  if (!input) return "";
  const d = input?.toDate ? input.toDate() : typeof input === "number" ? new Date(input) : new Date(input);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startOfDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diffDays = Math.round((startOfToday - startOfDate) / 86400000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "This Week";
  if (diffDays <= 30) {
    const weeks = Math.max(1, Math.floor(diffDays / 7));
    return weeks === 1 ? "Last Week" : weeks + " Weeks Ago";
  }
  if (diffDays <= 60) return "Last Month";
  if (diffDays <= 365) {
    const months = Math.max(1, Math.floor(diffDays / 30));
    return months + " Month" + (months > 1 ? "s" : "") + " Ago";
  }
  return "Last Year";
}

// Sidebar column here is narrower than CommunityBoard.js's own Videos card,
// so this stays shorter — same idea, fewer thumbnails.
const SIDEBAR_VIDEO_LIMIT = 4;

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
  const [sidebarVideos, setSidebarVideos] = useState([]);
  const [schoolInfo, setSchoolInfo] = useState({});
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
              return { id: d.id, First: data.First || "", Last: data.Last || "", Position: data.Position || "", School: data.School || "", Slug: data.Slug || "", avgGrade };
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
        setTopProspects(list.filter((p) => p.Slug).slice(0, 10));
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
      } catch (e) { setTrending([]); }
      // Top 10 Prospects now shows underneath Trending too, not just as a
      // fallback for when there's no trend data — always fetch it.
      fetchTopProspects();
    };
    fetch();
  }, [isMobile]);

  // School name → { logo, logoDark, color1, color2 } — same shape
  // NewsArticle.jsx/PerformancePage.js build, for the performance feed's
  // team icons *and* the "Top 2027 Prospects" chips (PlayersMentionedList.js,
  // see below), so fetched unconditionally now rather than only when
  // otherStream is "performances" — prospects can show up on either page.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const map = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.School) {
            map[data.School] = {
              logo: data.Logo1 || "",
              logoDark: data.LogoDark || "",
              color1: data.Color1 || "",
              color2: data.Color2 || "",
            };
          }
        });
        setSchoolInfo(map);
      } catch (e) { /* logos are non-critical */ }
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

  // Videos card — same "videos" collection + Recruiting-tag exclusion as
  // CommunityBoard.js's own Videos sidebar, so this reads as the exact same
  // feed rather than a differently-curated one.
  useEffect(() => {
    if (isMobile) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "videos"));
        const vids = snap.docs
          .map((d) => {
            const data = d.data();
            const items = Array.isArray(data.items) ? data.items : [];
            const first = items[0] || null;
            return {
              id: d.id,
              video: data.Video || "",
              date: data.Date || null,
              title: data.GenTitle || first?.title || "",
              thumb: data.GenThumb || first?.thumb || "",
              tags: Array.isArray(data.Tags) ? data.Tags : [],
            };
          })
          .filter((v) => !!v.video && !v.tags.includes("Recruiting"))
          .sort((a, b) => toMs(b.date) - toMs(a.date))
          .slice(0, SIDEBAR_VIDEO_LIMIT);
        setSidebarVideos(vids);
      } catch (e) { setSidebarVideos([]); }
    };
    fetch();
  }, [isMobile]);

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
        @keyframes wdOnFireBoxSoft { 0%, 100% { box-shadow: 0 0 0 1px rgba(255,0,0,0.16), 0 0 4px 1px rgba(255,0,0,0.16); } 50% { box-shadow: 0 0 0 1px rgba(255,0,0,0.3), 0 0 8px 2px rgba(255,0,0,0.32); } }
        .wd-margin-onfire { animation: wdOnFireBoxSoft 3.2s ease-in-out infinite; }
        /* Same per-trend icon animations as PlayerProfile.js's own Trending
           widget — Up a steady bounce, Breakout an electric wobble, On Fire
           a flicker. */
        @keyframes wdMarginTrendUpIconZoom {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 2px rgba(74,222,128,0.7)); }
          50%      { transform: scale(1.25); filter: drop-shadow(0 0 4px rgba(74,222,128,1)); }
        }
        .wd-margin-trendup-icon { display:inline-block; transform-origin: center; animation: wdMarginTrendUpIconZoom 4s ease-in-out infinite; }
        @keyframes wdMarginBreakoutIconTwitch {
          0%   { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 2px rgba(143,216,255,0.8)); }
          8%   { transform: scale(1.1) rotate(-9deg) translateX(-1px); filter: drop-shadow(0 0 4px rgba(143,216,255,1)); }
          16%  { transform: scale(0.95) rotate(7deg) translateX(1px); filter: drop-shadow(0 0 2px rgba(143,216,255,0.7)); }
          24%  { transform: scale(1.08) rotate(-5deg); filter: drop-shadow(0 0 3px rgba(143,216,255,1)); }
          32%  { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 2px rgba(143,216,255,0.8)); }
          40%  { transform: scale(1.06) rotate(8deg) translateY(-1px); filter: drop-shadow(0 0 3px rgba(143,216,255,0.9)); }
          48%  { transform: scale(0.94) rotate(-6deg); filter: drop-shadow(0 0 2px rgba(143,216,255,0.7)); }
          56%  { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 2px rgba(143,216,255,0.8)); }
          64%  { transform: scale(1.1) rotate(-7deg) translateX(1px); filter: drop-shadow(0 0 4px rgba(143,216,255,1)); }
          72%  { transform: scale(0.96) rotate(5deg); filter: drop-shadow(0 0 2px rgba(143,216,255,0.7)); }
          100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 2px rgba(143,216,255,0.8)); }
        }
        .wd-margin-breakout-icon { display:inline-block; animation: wdMarginBreakoutIconTwitch 0.7s steps(1, jump-end) infinite; }
        @keyframes wdMarginOnFireIconFlicker {
          0%, 100% { transform: scale(1) rotate(0deg); filter: drop-shadow(0 0 2px rgba(255,0,0,0.9)); }
          25%      { transform: scale(1.1) rotate(-3deg); filter: drop-shadow(0 0 4px rgba(255,0,0,1)); }
          50%      { transform: scale(0.94) rotate(2deg); filter: drop-shadow(0 0 3px rgba(255,0,0,0.85)); }
          75%      { transform: scale(1.08) rotate(-2deg); filter: drop-shadow(0 0 5px rgba(255,0,0,1)); }
        }
        .wd-margin-onfire-icon { display:inline-block; animation: wdMarginOnFireIconFlicker 0.9s ease-in-out infinite; }
        /* Trending row chip — same mechanics as PlayerProfile.js's own Top
           5 Trending chips (whole chip fills solid on hover, name flips
           white, chevron slides in, icon grows out of its box), sized down
           to match this sidebar's narrower column (same scale as the Top
           2027 Prospects fallback's own compact chips just below). */
        .wd-margin-trend-chip {
          display: flex; align-items: center; gap: 10px; padding: 10px 12px;
          text-decoration: none; border-radius: 10px; background: #fff;
          border: 2px solid var(--c1);
          transition: background 0.18s ease;
        }
        .wd-margin-trend-chip:hover { background: var(--c1); }
        .wd-margin-trend-chip-name {
          color: ${BLUE}; font-weight: 900; font-size: 16px; line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          transition: color 0.18s ease;
        }
        .wd-margin-trend-chip:hover .wd-margin-trend-chip-name { color: #fff; }
        .wd-margin-trend-chip-sub {
          color: #777; font-weight: 700; font-size: 11px; margin-top: 2px;
          transition: color 0.18s ease;
        }
        .wd-margin-trend-chip:hover .wd-margin-trend-chip-sub { color: #fff; }
        .wd-margin-trend-chip-logobox {
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border-radius: 7px; overflow: visible;
          background: var(--c1); border: 2px solid var(--c2); color: #fff;
          transition: background 0.35s ease 0.1s, border-color 0.35s ease 0.1s;
        }
        .wd-margin-trend-chip:hover .wd-margin-trend-chip-logobox {
          background: transparent; border-color: transparent;
          transition: background 0.18s ease, border-color 0.18s ease;
        }
        .wd-margin-trend-chip-icon { display: inline-block; transform-origin: center; transition: transform 0.22s ease; }
        .wd-margin-trend-chip:hover .wd-margin-trend-chip-icon { transform: scale(1.6); }
        .wd-margin-trend-chip-chevron {
          flex-shrink: 0; color: var(--c1); font-size: 16px; font-weight: 900;
          opacity: 0; transform: translateX(-6px);
          transition: opacity 0.18s ease, transform 0.18s ease, color 0.18s ease;
        }
        .wd-margin-trend-chip:hover .wd-margin-trend-chip-chevron { opacity: 1; transform: translateX(0); color: #fff; }
        .wd-margin-social-circle {
          width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          color: #fff; text-decoration: none;
          box-shadow: 0 2px 6px rgba(0,0,0,0.25);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .wd-margin-social-circle:hover { transform: translateY(-3px) scale(1.1); box-shadow: 0 8px 16px rgba(0,0,0,0.32); }
        .wd-margin-feed-item:hover { background: #f0f5ff; }
        .wd-video-card:hover .wd-video-thumb { transform: scale(1.08); }
        .wd-video-card:hover .wd-video-play { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        ${STAT_LINE_GLOW_STYLE}
      `}</style>

      {/* ===== Left: Trending stacked above Top 10 Prospects — positionStyle
          is itself a flex column with its own gap, so both cards just drop
          in as siblings and stack with even spacing; Top 10 no longer only
          shows as a fallback for when there's no trend data, it's always
          here underneath (see the fetch effect above — it's fetched
          unconditionally now, not just when trending comes back empty).
          Each card individually guards on having data, so this slot still
          never renders an empty shell. ===== */}
      {(trending.length > 0 || topProspects.length > 0) && (
        <div style={positionStyle("left")}>
          {trending.length > 0 && (
            <div style={cardShell}>
              <div style={{ background: BLUE, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                  🔥 Trending
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {/* Same team-colored chip treatment as the Top 10 Prospects
                  card below (and PlayerProfile.js's own Top 5 Trending
                  sidebar this widget is standing in for) — was still the
                  old cramped 22px-badge flush-row layout here, which read
                  as visibly older/plainer than everything else this trend
                  feature touches now. --c1/--c2 are the trend's own colors,
                  not a school color; the ambient glow class (wd-margin-
                  trendup/breakout/onfire, defined above) and the icon's own
                  themed animation (style.iconClass) both still apply, nested
                  the same way PlayerProfile.js's version nests them so the
                  continuous icon animation and the hover-triggered grow
                  don't fight over the same element's transform. */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "10px" }}>
                {trending.map((t) => {
                  const style = TREND_STYLE[(t.Trend || "").toString().trim().toLowerCase()];
                  if (!style) return null;
                  const glowClass = style === TREND_STYLE.up ? "wd-margin-trendup" : style === TREND_STYLE.breakout ? "wd-margin-breakout" : "wd-margin-onfire";
                  const notesList = (t.Notes || "").toString().split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
                  const iconNode = style.iconImg ? (
                    <img src={style.iconImg} alt={style.label} style={{ width: "18px", height: "18px", objectFit: "contain", display: "block" }} />
                  ) : style.icon;
                  return (
                    <Link
                      key={t.slug}
                      to={`/player/${t.slug}`}
                      className={"wd-margin-trend-chip " + glowClass}
                      style={{ "--c1": style.badgeBg, "--c2": style.badgeBorder }}
                    >
                      <div className="wd-margin-trend-chip-logobox" title={style.label}>
                        <span className="wd-margin-trend-chip-icon">
                          {style.iconClass ? <span className={style.iconClass}>{iconNode}</span> : iconNode}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                        <span className="wd-margin-trend-chip-name">{t.First} {t.Last}</span>
                        <span className="wd-margin-trend-chip-sub">
                          {notesList.length > 0 ? notesList.join(" · ") : ""}
                        </span>
                      </div>
                      <span className="wd-margin-trend-chip-chevron">›</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
          {topProspects.length > 0 && (
            <div style={cardShell}>
              <div style={{ background: BLUE, padding: "10px 12px", textAlign: "center" }}>
                <div style={{ color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.06em", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                  ⭐ Top 2027 Prospects
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {/* Same team-colored chip (and hover animation) as Players
                  Mentioned everywhere else — no round-grade badge; the
                  already-computed avgGrade rank (see fetchTopProspects
                  above) still orders the list, it just isn't shown as its
                  own little box anymore. showHeader=false since this card
                  already has its own BLUE/GOLD header above, matching the
                  rest of this sidebar's cards rather than
                  PlayersMentionedList's own plain-label header treatment. */}
              <PlayersMentionedList players={topProspects} schoolInfo={schoolInfo} showHeader={false} padding="10px" compact />
            </div>
          )}
        </div>
      )}

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
          <div style={{ padding: "14px 14px 16px" }}>
            <p style={{ fontSize: "11px", fontWeight: 600, color: "#666", lineHeight: 1.4, textAlign: "center", margin: "0 0 12px" }}>
              Get live updates on draft prospects and college football players!
            </p>
            {/* A row of brand-colored circular icon buttons, each lifting
                and growing slightly on hover — reads as a much more
                polished "follow us" treatment than the old stacked
                full-width bars. */}
            <div style={{ display: "flex", justifyContent: "center", gap: "12px" }}>
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.label}
                  className="wd-margin-social-circle"
                  style={{ background: s.bg }}
                >
                  <span style={{ fontSize: "18px" }}>{s.icon}</span>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Videos — same "videos" collection feed and thumbnail-card
            treatment as CommunityBoard.js's own Videos sidebar, right
            beneath the Follow card. */}
        {sidebarVideos.length > 0 && (
          <div style={cardShell}>
            <div style={{ background: BLUE, padding: "8px 12px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Arial Black', Arial, sans-serif" }}>
                Videos
              </div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            {sidebarVideos.map((v, i) => {
              const relTime = formatRelativeTime(v.date);
              return (
                <a
                  key={v.id}
                  href={sanitizeUrl(v.video)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wd-video-card"
                  style={{ display: "block", position: "relative", textDecoration: "none", borderBottom: i < sidebarVideos.length - 1 ? "1px solid #f0f0f0" : "none" }}
                >
                  <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#111", overflow: "hidden" }}>
                    {v.thumb ? (
                      <img
                        className="wd-video-thumb"
                        src={sanitizeUrl(v.thumb)}
                        alt={v.title || "Video thumbnail"}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                        referrerPolicy="no-referrer"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                        loading="lazy"
                      />
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ color: "#fff", fontSize: "26px" }}>▶</span>
                      </div>
                    )}
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)", pointerEvents: "none" }} />
                    <div
                      className="wd-video-play"
                      style={{
                        position: "absolute", top: "50%", left: "50%",
                        transform: "translate(-50%, -50%) scale(0.8)",
                        width: "36px", height: "36px", borderRadius: "50%",
                        background: "rgba(255,255,255,0.95)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        opacity: 0, transition: "opacity 0.25s ease, transform 0.25s ease",
                        boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
                      }}
                    >
                      <span style={{ color: BLUE, fontSize: "14px", marginLeft: "2px" }}>▶</span>
                    </div>
                    {relTime && (
                      <div style={{ position: "absolute", top: "6px", right: "6px" }}>
                        <span style={{ background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: "8px", fontWeight: 900, padding: "2px 6px", borderRadius: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {relTime}
                        </span>
                      </div>
                    )}
                    {v.title && (
                      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "8px 10px" }}>
                        <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, color: "#fff", fontSize: "11px", letterSpacing: "0.02em", textShadow: "0 1px 4px rgba(0,0,0,0.7)", lineHeight: 1.25 }}>
                          {v.title}
                        </div>
                      </div>
                    )}
                  </div>
                </a>
              );
            })}
            <Link
              to="/videos"
              style={{
                display: "block", textAlign: "center", background: BLUE, color: GOLD,
                fontWeight: 900, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em",
                padding: "9px", textDecoration: "none",
              }}
            >
              View More Videos →
            </Link>
          </div>
        )}

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
              const logo = isPerf ? schoolInfo[item.school]?.logo : null;
              return (
                <Link
                  key={item.id}
                  to={href}
                  className="wd-margin-feed-item"
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
                      <div className={gradeStatLineClass(item.grade)} style={{ fontFamily: "'Courier New', monospace", fontSize: "10px", fontWeight: 700, color: "#666", marginTop: "2px" }}>
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
