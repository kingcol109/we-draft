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

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const gradeStyles = {
  Dominant: { background: "#e6f4ea", color: "#1a7f37" },
  Great: { background: "#eaf6ec", color: "#2e7d32" },
  Good: { background: "#eaf1ff", color: BLUE },
  Productive: { background: "#fff8e1", color: "#9c7a00" },
  Average: { background: "#f0f0f0", color: "#666" },
  Bad: { background: "#fdeaea", color: "#c0392b" },
};

// "More Performances" sidebar ordering — Dominant first, then Great, then
// Good (the three tiers with their own glow effect), then whatever's left,
// ungraded last.
const GRADE_PRIORITY = { Dominant: 0, Great: 1, Good: 2, Productive: 3, Average: 4, Bad: 5 };
const gradePriority = (grade) => (grade in GRADE_PRIORITY ? GRADE_PRIORITY[grade] : 6);

// Grade → sidebar-row "pop" effect. Dominant really pops (fast, wide,
// animated glow), Great is a quieter version of the same, Good is a static
// hint of it, and Productive/Average/Bad get nothing — same tiered-glow
// pattern as the "On Fire"/"Breakout"/"Trending Up" sidebar rows on
// PlayerProfile.js, just scaled to grade instead of trend type.
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
  .wd-video-card:hover .wd-video-thumb { transform: scale(1.08); }
  .wd-video-card:hover .wd-video-play { opacity: 1; transform: translate(-50%, -50%) scale(1); }
`;

export default function PerformancePage() {
  const { slug } = useParams();
  const [performance, setPerformance] = useState(null);
  const [player, setPlayer] = useState(null);
  const [video, setVideo] = useState(null);
  const [game, setGame] = useState(null);
  const [mentionedPlayers, setMentionedPlayers] = useState([]);
  const [schoolLogos, setSchoolLogos] = useState({});
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

  // School name → logo, for the "Players Mentioned" row logos. Fetched once
  // (the schools collection is small) rather than per-player.
  useEffect(() => {
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "schools"));
        const map = {};
        snap.docs.forEach((d) => { const data = d.data(); if (data.School) map[data.School] = data.Logo1 || ""; });
        setSchoolLogos(map);
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

  if (loading) return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

  if (notFound || !performance) {
    return (
      <div style={{ textAlign: "center", marginTop: "80px", color: "#999", fontStyle: "italic", fontSize: "16px" }}>
        Performance not found.
      </div>
    );
  }

  const grade = gradeStyles[performance.grade];
  const gameDate = performance.gameDate?.toDate ? performance.gameDate.toDate() : null;
  const dateStr = gameDate?.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
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
  const canonicalUrl = `https://we-draft.com/performance/${performance.slug}`;
  // SEO: title is the long-form headline, description is an excerpt of the
  // write-up itself (collapsed whitespace, ~160 chars — the practical cutoff
  // before Google truncates a meta description anyway).
  const seoDescription = (performance.body || "").replace(/\s+/g, " ").trim().slice(0, 160);

  const SidebarItem = ({ item }) => {
    const d = item.gameDate?.toDate?.()?.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const g = gradeStyles[item.grade];
    return (
      <Link
        to={`/performance/${item.slug}`}
        className={gradeGlowClass(item.grade)}
        style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "12px 14px", textDecoration: "none", background: "#fff", borderBottom: "1px solid #f0f0f0" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
      >
        {d && (
          <div style={{ flexShrink: 0, width: "42px", background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "6px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ background: GOLD, lineHeight: 1, padding: "1px 0", textAlign: "center" }}>
              <span style={{ fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>{d.split(" ")[0]}</span>
            </div>
            <div style={{ padding: "4px 0 4px", textAlign: "center" }}>
              <span style={{ fontSize: "20px", fontWeight: 900, color: BLUE, lineHeight: 1, display: "block" }}>{d.split(" ")[1]}</span>
            </div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: "3px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
            <span style={{ background: "#7c3aed", color: "#fff", fontSize: "7px", fontWeight: 900, padding: "1px 5px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Performance
            </span>
            {g && (
              <span style={{ background: g.background, color: g.color, fontSize: "7px", fontWeight: 900, padding: "1px 5px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {item.grade}
              </span>
            )}
          </div>
          <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: "11px", color: "#222", textTransform: "uppercase", letterSpacing: "0.03em", lineHeight: 1.3 }}>
            {item.titleShort}
          </div>
        </div>
      </Link>
    );
  };

  return (
    <>
      <style>{GRADE_GLOW_STYLE}</style>
      <Helmet>
        <title>{performance.titleLong} | We-Draft</title>
        <meta name="description" content={seoDescription} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={performance.titleLong} />
        <meta property="og:description" content={seoDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />
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

          {/* Performance */}
          <div style={{ order: isMobile ? 2 : 1 }}>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>

              {/* Header bar */}
              <div style={{ background: BLUE, padding: isMobile ? "10px 14px" : "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ background: "#7c3aed", color: "#fff", fontSize: "9px", fontWeight: 900, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    Performance
                  </span>
                  {grade && (
                    <span style={{ background: grade.background, color: grade.color, fontSize: "9px", fontWeight: 900, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      {performance.grade}
                    </span>
                  )}
                  {dateStr && (
                    <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "12px", fontWeight: 700 }}>{dateStr}</span>
                  )}
                </div>
                {performance.author && (
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "12px", fontWeight: 700 }}>By {performance.author}</span>
                )}
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
                <h1 style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontSize: isMobile ? "22px" : "32px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, marginBottom: "10px", marginTop: 0 }}>
                  {performance.titleLong}
                </h1>

                {/* Game meta line — school, opponent, week, and the score if played */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#888" }}>
                    {performance.school}{performance.opponent ? ` vs ${performance.opponent}` : ""}{performance.week ? ` · ${performance.week}` : ""}
                  </span>
                  {played && (
                    <span style={{
                      fontSize: "11px", fontWeight: 900, padding: "3px 10px", borderRadius: "20px",
                      background: "#eaf1ff", color: BLUE, textTransform: "uppercase", letterSpacing: "0.03em",
                    }}>
                      Final: {game.Home} {game.HomeScore} – {game.AwayScore} {game.Away}
                    </span>
                  )}
                </div>

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
          </div>

          {/* Sidebar */}
          <div style={{ position: isMobile ? "static" : "sticky", top: "24px", order: isMobile ? 1 : 2, display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* Video — same thumbnail-card treatment as the player-page video
                sidebar (16:9 thumbnail, gradient scrim, centered play button,
                title overlay), just a single card since a performance only
                ever has the one attached video. */}
            {videoDisplay && (
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
            )}

            {/* Players Mentioned — bigger rows than a typical sidebar list,
                with each player's team logo on the left and their position
                under their name (school context is already established by
                the performance itself). */}
            {mentionedPlayers.length > 0 && (
              <div>
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
                    Players Mentioned
                  </div>
                  <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
                  <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
                </div>
                <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", background: "#fff" }}>
                  {mentionedPlayers.map((p, i) => {
                    const logo = schoolLogos[p.School];
                    return (
                      <Link
                        key={p.id}
                        to={`/player/${p.Slug}`}
                        style={{
                          display: "flex", alignItems: "center", gap: "14px", padding: "16px 18px",
                          textDecoration: "none",
                          borderBottom: i < mentionedPlayers.length - 1 ? "1px solid #f0f0f0" : "none",
                          background: "#fff",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                      >
                        <div style={{
                          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                          width: "52px", height: "52px", borderRadius: "8px",
                          background: "#f8f8f8", border: `2px solid ${GOLD}`, overflow: "hidden",
                        }}>
                          {logo ? (
                            <img
                              src={logo} alt={p.School || ""} style={{ width: "80%", height: "80%", objectFit: "contain" }}
                              referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }}
                            />
                          ) : (
                            <span style={{ color: "#ccc", fontSize: "22px", fontWeight: 900 }}>?</span>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                          <span style={{ color: BLUE, fontWeight: 900, fontSize: "18px", lineHeight: 1.25 }}>
                            {p.First} {p.Last}
                          </span>
                          <span style={{ color: "#777", fontWeight: 700, fontSize: "13px", marginTop: "3px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {p.Position || "—"}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
                  More Performances
                </div>
                <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
                <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
              </div>

              <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ background: BLUE, padding: "8px 14px" }}>
                  <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Latest</div>
                </div>
                <div style={{ height: "3px", background: GOLD }} />
                {sidebarItems.length > 0 ? (
                  sidebarItems.map((item) => <SidebarItem key={item.id} item={item} />)
                ) : (
                  <div style={{ padding: "20px", textAlign: "center", color: "#bbb", fontSize: "13px", fontStyle: "italic", background: "#fff" }}>
                    No other performances
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} />
    </>
  );
}
