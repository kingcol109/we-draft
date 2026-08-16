// src/pages/PerformancePage.js
//
// Public detail page for a single performance write-up, authored from the
// Admin Panel's Performances tab (see PerformancesManager.js) and linked to
// from the player's "In The News" sidebar and the /performances week hub.
// Styled to match NewsArticle.jsx's layout — same bordered blue/gold card,
// header bar, and "More ..." sidebar — since these are meant to read as the
// same family of content as articles, just game-scoped. The write-up body
// is plain text (not HTML), so it's rendered with whiteSpace: pre-wrap
// rather than dangerouslySetInnerHTML.
import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { db } from "../firebase";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import Logo1 from "../assets/Logo1.png";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginAds from "../components/MarginAds";
import EngagementSection, { useEngagement, LikeButton } from "../components/EngagementSection";
import PlayersMentionedList from "../components/PlayersMentionedList";
import MorePerformancesList, { timeAgo } from "../components/MorePerformancesList";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// "More Performances" sidebar ordering — Dominant first, then Great, then
// Good, then whatever's left, ungraded last. (The tiered glow this used to
// justify is gone — that list now uses the same team-colored chip
// treatment as Players Mentioned, see MorePerformancesList.js — but the
// tier ranking itself is still a reasonable "best stuff first" ordering.)
const GRADE_PRIORITY = { Dominant: 0, Great: 1, Good: 2, Productive: 3, Average: 4, Bad: 5 };
const gradePriority = (grade) => (grade in GRADE_PRIORITY ? GRADE_PRIORITY[grade] : 6);

// video-card hover (VideoBlock), the header bar's own game-link chevron
// (see wd-perf-header-* below, next to the header bar's own JSX), and the
// "N minutes ago" dot under the title — same live-pulse keyframe as its
// own copy of this dot on each row in MorePerformancesList.js.
const PAGE_STYLE = `
  .wd-video-card:hover .wd-video-thumb { transform: scale(1.08); }
  .wd-video-card:hover .wd-video-play { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  .wd-perf-header-link { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; transition: opacity 0.15s ease; }
  .wd-perf-header-link:hover { opacity: 0.8; }
  .wd-perf-header-chevron { display: inline-block; transition: transform 0.15s ease; }
  .wd-perf-header-link:hover .wd-perf-header-chevron { transform: translateX(3px); }
  .wd-perf-created-dot { animation: wdFreshDotPulse 1.4s ease-in-out infinite; }
  @keyframes wdFreshDotPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
`;

export default function PerformancePage() {
  const { slug } = useParams();
  const [performance, setPerformance] = useState(null);
  const [player, setPlayer] = useState(null);
  const [video, setVideo] = useState(null);
  const [game, setGame] = useState(null);
  const [mentionedPlayers, setMentionedPlayers] = useState([]);
  const [schoolInfo, setSchoolInfo] = useState({}); // School name -> { logo, logoDark, color1, color2 }
  const [sidebarItems, setSidebarItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const contentRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // School name → { logo, logoDark, color1, color2 } — same shape
  // NewsArticle.jsx builds, for the "More Performances" sidebar icons and
  // the team-colored "Players Mentioned" chips (PlayersMentionedList.js).
  // Fetched once (the schools collection is small) rather than per-player.
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    setPerformance(null);
    setPlayer(null);
    setVideo(null);
    setGame(null);
    setMentionedPlayers([]);
    setNotFound(false);
    setLoading(true);

    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "performances"), where("slug", "==", slug), where("status", "==", "published")));
        if (snap.empty) {
          setNotFound(true);
          return;
        }
        const data = { id: snap.docs[0].id, ...snap.docs[0].data() };
        setPerformance(data);

        // Legacy performances (saved before `playerIds` existed) only have
        // the single `playerId` — fall back to that so they still show one.
        const mentionedIds = data.playerIds?.length ? data.playerIds : [data.playerId].filter(Boolean);

        const [playerRes, videoRes, gameRes, mentionedSnaps] = await Promise.all([
          data.playerId ? getDoc(doc(db, "players", data.playerId)) : null,
          data.videoId ? getDoc(doc(db, "videos", data.videoId)) : null,
          // Fetched live rather than relying on any denormalized score — the
          // game may not have been played yet when the write-up was authored.
          data.gameId ? getDoc(doc(db, "schedule26", data.gameId)) : null,
          Promise.all(mentionedIds.map((id) => getDoc(doc(db, "players", id)))),
        ]);
        if (playerRes?.exists()) setPlayer({ id: playerRes.id, ...playerRes.data() });
        if (videoRes?.exists()) setVideo({ id: videoRes.id, ...videoRes.data() });
        if (gameRes?.exists()) setGame({ id: gameRes.id, ...gameRes.data() });
        setMentionedPlayers(mentionedSnaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
      } catch (e) {
        console.error("Performance load error:", e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [slug]);

  // Sidebar — "More Performances." Same-week performances first, ranked
  // Dominant > Great > Good > everything else (so the glow-tiered ones
  // naturally lead), capped at 5. After that, one more slot for the
  // selected player's (this performance's primary subject) most recent
  // *other* performance, if one exists and isn't already in the top 5 —
  // so their own other outings surface even if this week wasn't their week.
  useEffect(() => {
    if (!performance) return;
    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "performances"), where("status", "==", "published")));
        const all = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.id !== performance.id);

        const sameWeek = all
          .filter((p) => p.week && p.week === performance.week)
          .sort((a, b) => {
            const gp = gradePriority(a.grade) - gradePriority(b.grade);
            if (gp !== 0) return gp;
            return (b.gameDate?.toMillis?.() || 0) - (a.gameDate?.toMillis?.() || 0);
          })
          .slice(0, 5);

        const shownIds = new Set(sameWeek.map((p) => p.id));
        const playerOther = all
          .filter((p) => !shownIds.has(p.id) && (p.playerIds?.length ? p.playerIds.includes(performance.playerId) : p.playerId === performance.playerId))
          .sort((a, b) => (b.gameDate?.toMillis?.() || 0) - (a.gameDate?.toMillis?.() || 0))[0];

        setSidebarItems(playerOther ? [...sameWeek, playerOther] : sameWeek);
      } catch (e) { /* sidebar is non-critical */ }
    };
    fetch();
  }, [performance]);

  // Called unconditionally (hooks can't follow the early returns below) —
  // useEngagement's own `ready` check treats an empty/incomplete docPath as
  // inert, which covers "performance not loaded yet". Built once here, not
  // inside EngagementSection below, so the header bar's own LikeButton
  // shares this exact instance instead of triggering a second parallel
  // fetch for the same doc.
  const engagement = useEngagement(performance?.id ? ["performances", performance.id] : []);

  if (loading) return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

  if (notFound || !performance) {
    return (
      <div style={{ textAlign: "center", marginTop: "80px", color: "#999", fontStyle: "italic", fontSize: "16px" }}>
        Performance not found.
      </div>
    );
  }

  const gameDate = performance.gameDate?.toDate ? performance.gameDate.toDate() : null;
  // Date-only field is stored as UTC midnight — format in UTC too, or a
  // viewer west of it sees the game roll back a calendar day.
  const dateStr = gameDate?.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  // "School vs Opponent" — the pre-game form of the header bar's own game
  // label (see gameLabel below, which prefers the final score once there
  // is one).
  const matchupText = performance.opponent ? `${performance.school} vs ${performance.opponent}` : (performance.school || "");
  // Same per-player title/thumb override resolution as PlayerProfile.js's
  // video cards — prefer the item tagged to this performance's subject,
  // fall back to the first item, then the video's generic title/thumb.
  const videoItems = Array.isArray(video?.items) ? video.items : [];
  const videoMatched = videoItems.find((it) => it.playerId === performance.playerId) || null;
  const videoFirst = videoItems[0] || null;
  const videoDisplay = video ? {
    title: videoMatched?.title || videoFirst?.title || video.GenTitle || "",
    thumb: videoMatched?.thumb || videoFirst?.thumb || video.GenThumb || "",
  } : null;
  const played = game?.HomeScore != null && game?.AwayScore != null;
  // The header bar's own text — this used to be a separate "Game meta
  // line" in the body (a Final: X-Y badge once the game's over, or the
  // plain matchup + week before that), now folded into the header bar
  // itself (see the header JSX below) since showing the same information
  // twice on the page was redundant.
  const gameLabel = played
    ? `${game.Home} ${game.HomeScore} – ${game.AwayScore} ${game.Away}`
    : matchupText + (performance.week ? ` · ${performance.week}` : "");
  const canonicalUrl = `https://we-draft.com/performance/${performance.slug}`;
  // SEO: title is the long-form headline, description is an excerpt of the
  // write-up itself (collapsed whitespace, ~160 chars — the practical cutoff
  // before Google truncates a meta description anyway).
  const seoDescription = (performance.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
  // Same red "N minutes ago" tag as this performance's own row in
  // MorePerformancesList.js, shown here below the title instead of inside
  // a chip.
  const createdLabel = timeAgo(performance.createdAt);

  // ── Video / Players Mentioned / More Performances — split out of the
  // sidebar column so mobile can lay them out as their own separately-
  // ordered grid items (performance first, then mentioned players, then
  // other performances) instead of the old single "sidebar" block that
  // rendered entirely above the performance write-up on mobile. Desktop is
  // unaffected — still one sticky column stacking all three, same order
  // as before. ──
  const VideoBlock = videoDisplay && (
    <div>
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
          Video
        </div>
        <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
        <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
      </div>
      <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
        <a
          href={video.Video}
          target="_blank"
          rel="noopener noreferrer"
          className="wd-video-card"
          style={{ display: "block", position: "relative", textDecoration: "none" }}
        >
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#111", overflow: "hidden" }}>
            {videoDisplay.thumb ? (
              <img
                className="wd-video-thumb"
                src={videoDisplay.thumb}
                alt={videoDisplay.title || "Video thumbnail"}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                referrerPolicy="no-referrer"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                loading="lazy"
              />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: "32px" }}>▶</span>
              </div>
            )}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)", pointerEvents: "none" }} />
            <div
              className="wd-video-play"
              style={{
                position: "absolute", top: "50%", left: "50%",
                transform: "translate(-50%, -50%) scale(0.8)",
                width: "48px", height: "48px", borderRadius: "50%",
                background: "rgba(255,255,255,0.95)",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: 0, transition: "opacity 0.25s ease, transform 0.25s ease",
                boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
              }}
            >
              <span style={{ color: BLUE, fontSize: "18px", marginLeft: "3px" }}>▶</span>
            </div>
            {videoDisplay.title && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 12px" }}>
                <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, textTransform: "uppercase", color: "#fff", fontSize: "13px", letterSpacing: "0.03em", textShadow: "0 1px 4px rgba(0,0,0,0.7)", lineHeight: 1.3 }}>
                  {videoDisplay.title}
                </div>
              </div>
            )}
          </div>
        </a>
      </div>
    </div>
  );

  // Team-colored chips, shared with NewsArticle.jsx — see
  // PlayersMentionedList.js for the styling/hover behavior itself.
  const PlayersMentionedBlock = mentionedPlayers.length > 0 && (
    <PlayersMentionedList players={mentionedPlayers} schoolInfo={schoolInfo} />
  );

  // Team-colored chips, same look as Players Mentioned — see
  // MorePerformancesList.js for the statLine-subtitle/white-hover details.
  // Hidden entirely rather than an empty-state card when there's nothing
  // else this week, matching VideoBlock/PlayersMentionedBlock's own
  // && guards below (this used to always render, with its own "No other
  // performances" message).
  const MorePerformancesBlock = sidebarItems.length > 0 && (
    <MorePerformancesList performances={sidebarItems} schoolInfo={schoolInfo} />
  );

  return (
    <>
      <style>{PAGE_STYLE}</style>
      <Helmet>
        <title>{performance.titleLong} | We-Draft</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={performance.titleLong} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={performance.titleLong} />
        <meta name="twitter:description" content={seoDescription} />
        {/* videoDisplay.thumb is the only reliable existing image tied to a
            performance — performances have no image field of their own,
            but this page already fetches and renders this exact thumbnail
            (see the Video sidebar card below) whenever a video is attached.
            No video attached -> no twitter:image, rather than guessing. */}
        {videoDisplay?.thumb && <meta name="twitter:image" content={videoDisplay.thumb} />}
        <meta name="robots" content="index, follow" />

        {/* Home → Performances → Performance Title, using the existing
            /performances hub route and this page's own /performance/:slug
            canonical URL. */}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://we-draft.com/" },
            { "@type": "ListItem", "position": 2, "name": "Performances", "item": "https://we-draft.com/performances" },
            { "@type": "ListItem", "position": 3, "name": performance.titleLong, "item": canonicalUrl },
          ],
        })}</script>

        {/* Article (not NewsArticle) — performances are short, rapid-
            response game write-ups, not long-form journalism, so the
            lighter-weight "Article" type is the more accurate fit. Dates
            come from the performance doc's own createdAt/updatedAt (already
            fetched as part of `performance`, just not previously read by
            this page — set on every save, see PerformancesManager.js) rather
            than gameDate, since createdAt is when the write-up itself was
            actually published. "about" links the Person this performance is
            about, when the player doc resolved successfully. */}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "Article",
          "headline": performance.titleLong, "description": seoDescription, "url": canonicalUrl,
          "datePublished": performance.createdAt?.toDate?.()?.toISOString() || "",
          "dateModified": performance.updatedAt?.toDate?.()?.toISOString() || performance.createdAt?.toDate?.()?.toISOString() || "",
          "author": { "@type": "Person", "name": performance.author || "We-Draft" },
          "publisher": { "@type": "Organization", "name": "We-Draft", "url": "https://we-draft.com", "logo": { "@type": "ImageObject", "url": "https://we-draft.com/logo512.png" } },
          "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl },
          ...(videoDisplay?.thumb ? { "image": videoDisplay.thumb } : {}),
          ...(player?.Slug ? { "about": { "@type": "Person", "name": `${player.First || ""} ${player.Last || ""}`.trim(), "url": `https://we-draft.com/player/${player.Slug}` } } : {}),
        })}</script>
      </Helmet>

      <div ref={contentRef} style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Page header */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              Performances
            </div>
            <Link to="/performances" style={{ marginLeft: "auto", color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "underline" }}>
              ← All Performances
            </Link>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* Main layout */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 300px", gap: isMobile ? "20px" : "32px", alignItems: "start" }}>

          {/* Performance — always first, on both mobile and desktop. */}
          <div style={{ order: 1 }}>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>

              {/* Header bar — Like button lives here now, same place/style as
                  NewsArticle.jsx's own header-bar Like. "Performance" badge
                  and the grade badge (Dominant/Great/...) are dropped. The
                  game label (matchup pre-game, final score once there is
                  one — see gameLabel above) replaced the old body-only
                  "Game meta line" entirely rather than duplicating it — the
                  label itself is now the click-through to the game's own
                  page, with a chevron marking it as clickable, instead of a
                  separate link further down the page. */}
              <div style={{ background: BLUE, padding: isMobile ? "10px 14px" : "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                {(gameLabel || dateStr) && (
                  game?.Slug ? (
                    <Link to={`/game/${game.Slug}`} className="wd-perf-header-link">
                      <span style={{ color: "#fff", fontSize: isMobile ? "14px" : "16px", fontWeight: 900 }}>
                        {gameLabel}{gameLabel && dateStr ? " · " : ""}{dateStr}
                      </span>
                      <span className="wd-perf-header-chevron" style={{ color: "#fff", fontSize: "18px", fontWeight: 900 }}>›</span>
                    </Link>
                  ) : (
                    <span style={{ color: "#fff", fontSize: isMobile ? "14px" : "16px", fontWeight: 900 }}>
                      {gameLabel}{gameLabel && dateStr ? " · " : ""}{dateStr}
                    </span>
                  )
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {performance.author && (
                    <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "12px", fontWeight: 700 }}>By {performance.author}</span>
                  )}
                  <LikeButton engagement={engagement} itemLabel="this performance" />
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />

              {/* Body */}
              <div style={{ background: "#fff", padding: isMobile ? "20px 16px" : "32px 36px" }}>

                {/* Player + game context */}
                {player?.Slug && (
                  <Link to={`/player/${player.Slug}`} style={{ color: BLUE, fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.04em", textDecoration: "none", display: "inline-block", marginBottom: "8px" }}>
                    ← {player.First} {player.Last}
                  </Link>
                )}

                {/* Title */}
                <h1 style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontSize: isMobile ? "22px" : "32px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, marginBottom: createdLabel ? "8px" : "20px", marginTop: 0 }}>
                  {performance.titleLong}
                </h1>

                {/* Same red "N minutes ago" freshness tag as this
                    performance's own chip in MorePerformancesList.js. */}
                {createdLabel && (
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "20px" }}>
                    <span className="wd-perf-created-dot" style={{ flexShrink: 0, width: "6px", height: "6px", borderRadius: "50%", background: "#c0392b" }} />
                    <span style={{ color: "#c0392b", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {createdLabel}
                    </span>
                  </div>
                )}

                {/* Divider */}
                <div style={{ height: "2px", background: GOLD, borderRadius: "1px", marginBottom: "24px" }} />

                {/* Write-up — plain text, not HTML */}
                <div style={{
                  fontFamily: "Georgia, 'Times New Roman', serif", fontSize: isMobile ? "15px" : "17px",
                  lineHeight: 1.85, color: "#222", whiteSpace: "pre-wrap", wordWrap: "break-word",
                }}>
                  {performance.body}
                </div>

                {/* Footer */}
                <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: "2px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                  {dateStr && (
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#aaa" }}>Game played {dateStr}</span>
                  )}
                  <Link to="/performances" style={{ background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "6px", padding: "7px 18px", fontWeight: 900, fontSize: "12px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    ← All Performances
                  </Link>
                </div>
              </div>
            </div>

            {/* Comments — same rules/shape as GamePage.js's own game
                comments, via the shared EngagementSection component. Its own
                Like row is hidden (showLikeRow=false): the header bar above
                already has one, sharing this same `engagement` instance
                rather than fetching a second time. */}
            <EngagementSection engagement={engagement} itemLabel="this performance" showLikeRow={false} />
          </div>

          {/* Sidebar — on mobile, split into its own separately-ordered grid
              items (see VideoBlock/PlayersMentionedBlock/MorePerformancesBlock
              above) so the stacked single-column layout reads performance →
              video → mentioned players → other performances, instead of the
              old single "sidebar" grid item (order 1) landing above the
              write-up entirely. Desktop is unchanged: one sticky column with
              all three stacked in the same order as before. */}
          {isMobile ? (
            <>
              {VideoBlock && <div style={{ order: 2 }}>{VideoBlock}</div>}
              {PlayersMentionedBlock && <div style={{ order: 3 }}>{PlayersMentionedBlock}</div>}
              {MorePerformancesBlock && <div style={{ order: 4 }}>{MorePerformancesBlock}</div>}
            </>
          ) : (
            <div style={{ position: "sticky", top: "24px", order: 2, display: "flex", flexDirection: "column", gap: "24px" }}>
              {VideoBlock}
              {PlayersMentionedBlock}
              {MorePerformancesBlock}
            </div>
          )}

        </div>
      </div>

      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} />
    </>
  );
}
