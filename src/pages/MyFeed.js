// src/pages/MyFeed.js
//
// A signed-in user's personalized feed of news/performances for the players
// they follow (see the Follow button on PlayerProfile.js and the
// users/{uid}/follows/{playerId} subcollection it writes to). Reachable from
// the "My Boards" navbar dropdown and from a button on UserBoards.js (the
// "My Draft Board" landing page), which also shows a compact preview of this
// same feed in its left margin sidebar — see BoardsMarginSidebars.js.
import React, { useEffect, useState } from "react";
import { collection, getDocs, doc, deleteDoc, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "../context/AuthContext";
import Logo1 from "../assets/Logo1.png";
import LoadingSpinner from "../components/LoadingSpinner";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Same tiered "pop" effect used everywhere else performances show up
// (MarginSidebars.js, GameMarginSidebars.js, PerformancesHub.jsx).
const gradeGlowClass = (grade) => {
  if (grade === "Dominant") return "wd-perf-glow-dominant";
  if (grade === "Great") return "wd-perf-glow-great";
  if (grade === "Good") return "wd-perf-glow-good";
  return "";
};

const toMs = (ts) => {
  if (!ts) return 0;
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
};

const TYPE_FILTERS = ["All", "Performances", "News"];

export default function MyFeed() {
  const { user, login, profile } = useAuth();
  const displayName = profile?.username?.trim() || null;
  const feedTitle = displayName ? `${displayName}'s Feed` : "My Feed";

  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [follows, setFollows] = useState([]);
  const [followsLoading, setFollowsLoading] = useState(true);
  const [feedItems, setFeedItems] = useState([]);
  const [schoolLogos, setSchoolLogos] = useState({});
  const [yearFilter, setYearFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [unfollowingId, setUnfollowingId] = useState(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Follows — the source of truth for who shows up in this feed.
  useEffect(() => {
    if (!user) { setFollows([]); setFollowsLoading(false); return; }
    const fetch = async () => {
      setFollowsLoading(true);
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "follows"));
        setFollows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); setFollows([]); }
      finally { setFollowsLoading(false); }
    };
    fetch();
  }, [user]);

  // School logos, for performance items' team icons — same lookup MarginSidebars.js uses.
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

  // Feed — published performances/articles for followed players. Fetches the
  // whole published set and filters client-side (same idiom MarginSidebars.js
  // and PerformancesHub.jsx already use) rather than chunking `in`/
  // `array-contains-any` queries into groups of 10, since follow lists are
  // small and this avoids needing new composite indexes.
  useEffect(() => {
    if (follows.length === 0) { setFeedItems([]); return; }
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
        // Only `articles` carry a playerIds array (built from in-body player
        // links) — plain `news` items don't tag specific players, so they
        // can't be attributed to anyone's follow list and are left out.
        const articleItems = articleSnap.docs
          .map((d) => ({ id: d.id, ...d.data(), _kind: "article" }))
          .filter((a) => Array.isArray(a.playerIds) && a.playerIds.some((pid) => followedIds.has(pid)));
        const combined = [...perfItems, ...articleItems]
          .sort((a, b) => toMs(b.gameDate || b.publishedAt || b.updatedAt) - toMs(a.gameDate || a.publishedAt || a.updatedAt));
        setFeedItems(combined);
      } catch (e) { console.error(e); setFeedItems([]); }
    };
    fetch();
  }, [follows]);

  const handleUnfollow = async (playerId) => {
    if (!user) return;
    setUnfollowingId(playerId);
    const prev = follows;
    setFollows((f) => f.filter((x) => x.id !== playerId));
    try {
      await deleteDoc(doc(db, "users", user.uid, "follows", playerId));
    } catch (e) { console.error(e); setFollows(prev); }
    finally { setUnfollowingId(null); }
  };

  const eligibleYears = [...new Set(follows.map((f) => f.playerEligible).filter(Boolean))]
    .sort((a, b) => String(b).localeCompare(String(a)));
  const yearFollowedIds = new Set(
    (yearFilter === "All" ? follows : follows.filter((f) => f.playerEligible === yearFilter)).map((f) => f.id)
  );

  const filteredFeed = feedItems
    .filter((item) => item._kind === "performance" ? yearFollowedIds.has(item.playerId) : item.playerIds.some((pid) => yearFollowedIds.has(pid)))
    .filter((item) => typeFilter === "All" ? true : typeFilter === "Performances" ? item._kind === "performance" : item._kind === "article");

  if (!user) return (
    <div style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: "520px", border: `2px solid ${GOLD}`, borderRadius: "14px", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,85,165,0.14)" }}>
        <div style={{ background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`, padding: "28px 32px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "repeating-linear-gradient(55deg, transparent, transparent 18px, rgba(246,162,29,0.06) 18px, rgba(246,162,29,0.06) 36px)", pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: "42px", marginBottom: "10px" }}>🔔</div>
            <div style={{ fontSize: "26px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.1, marginBottom: "8px" }}>
              My Feed
            </div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: GOLD, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              News & Performances From Players You Follow
            </div>
          </div>
        </div>
        <div style={{ height: "4px", background: `linear-gradient(90deg, ${BLUE}, ${GOLD}, ${BLUE})` }} />
        <div style={{ background: "#fff", padding: "24px 28px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "28px" }}>
            {[
              { icon: "⭐", text: "Follow prospects from any player page" },
              { icon: "📰", text: "See their news and performance write-ups in one place" },
              { icon: "🗓️", text: "Filter by draft class year" },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ fontSize: "20px", flexShrink: 0 }}>{icon}</span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#333", lineHeight: 1.4 }}>{text}</span>
              </div>
            ))}
          </div>
          <button
            onClick={login}
            style={{
              width: "100%", backgroundColor: BLUE, color: "#fff",
              border: `3px solid ${GOLD}`, borderRadius: "10px",
              padding: "16px 32px", fontWeight: 900, fontSize: "17px",
              textTransform: "uppercase", letterSpacing: "0.08em",
              cursor: "pointer", fontFamily: "inherit",
              boxShadow: `0 4px 20px rgba(0,85,165,0.25)`,
              marginBottom: "10px",
            }}
          >
            Sign In to Access My Feed →
          </button>
          <div style={{ textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#aaa" }}>
            Free · Sign in with Google or Email · No spam
          </div>
        </div>
      </div>
    </div>
  );

  if (followsLoading) return <LoadingSpinner label="Loading Feed" size={56} minHeight="100vh" />;

  return (
    <>
      <Helmet><title>{feedTitle} | We-Draft</title></Helmet>
      <style>{`
        @keyframes wdPerfGlowDominant {
          0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.45), 0 0 10px 3px rgba(246,162,29,0.55); }
          50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.7), 0 0 20px 7px rgba(246,162,29,0.9); }
        }
        .wd-perf-glow-dominant { animation: wdPerfGlowDominant 1.6s ease-in-out infinite; border-radius: 8px; }
        @keyframes wdPerfGlowGreat {
          0%, 100% { box-shadow: 0 0 0 1px rgba(246,162,29,0.2), 0 0 5px 1px rgba(246,162,29,0.22); }
          50%      { box-shadow: 0 0 0 1px rgba(246,162,29,0.32), 0 0 9px 2px rgba(246,162,29,0.38); }
        }
        .wd-perf-glow-great { animation: wdPerfGlowGreat 2.6s ease-in-out infinite; border-radius: 8px; }
        .wd-perf-glow-good { box-shadow: 0 0 0 1px rgba(246,162,29,0.18); border-radius: 8px; }
        .wd-feed-item:hover { background: #f3f8ff; }
        .wd-following-pill:hover .wd-unfollow-x { opacity: 1; }
      `}</style>

      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "10px 10px 60px" : "18px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Page Header */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "26px" : "32px", objectFit: "contain" }} />
            <div style={{ fontSize: displayName ? (isMobile ? "22px" : "32px") : (isMobile ? "20px" : "26px"), fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, lineHeight: 1 }}>{feedTitle}</div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {follows.length === 0 ? (
          <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ background: BLUE, padding: "8px 16px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Following</div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            <div style={{ padding: isMobile ? "40px 20px" : "60px 40px", textAlign: "center", background: "#fff" }}>
              <div style={{ fontSize: "40px", marginBottom: "16px" }}>⭐</div>
              <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
                Not Following Anyone Yet
              </div>
              <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "#888", maxWidth: "440px", margin: "0 auto 20px", lineHeight: 1.6 }}>
                Hit the Follow button on any player page to get their news and performances here.
              </div>
              <Link to="/community" style={{ display: "inline-block", padding: "10px 24px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#fff", background: GOLD, border: `2px solid ${BLUE}`, borderRadius: "8px", textDecoration: "none" }}>
                Browse the Community Board →
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* Following pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
              {follows.map((f) => (
                <div key={f.id} className="wd-following-pill" style={{ display: "flex", alignItems: "center", gap: "6px", border: `2px solid ${BLUE}`, borderRadius: "20px", padding: "5px 6px 5px 14px", background: "#fff" }}>
                  <Link to={`/player/${f.playerSlug}`} style={{ color: BLUE, fontWeight: 900, fontSize: "13px", textDecoration: "none", whiteSpace: "nowrap" }}>
                    {f.playerName || "Player"}{f.playerSchool ? ` · ${f.playerSchool}` : ""}
                  </Link>
                  <button
                    onClick={() => handleUnfollow(f.id)}
                    disabled={unfollowingId === f.id}
                    title="Unfollow"
                    className="wd-unfollow-x"
                    style={{ background: "none", border: "none", color: "#aaa", fontWeight: 900, fontSize: "14px", cursor: "pointer", padding: "2px 6px", lineHeight: 1, opacity: unfollowingId === f.id ? 0.4 : 1 }}
                  >✕</button>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
              <button onClick={() => setYearFilter("All")} style={{ border: `2px solid ${GOLD}`, borderRadius: "20px", padding: "6px 16px", fontWeight: 900, fontSize: "13px", cursor: "pointer", background: yearFilter === "All" ? BLUE : "#fff", color: yearFilter === "All" ? "#fff" : BLUE }}>
                All Years
              </button>
              {eligibleYears.map((yr) => (
                <button key={yr} onClick={() => setYearFilter(yr)} style={{ border: `2px solid ${GOLD}`, borderRadius: "20px", padding: "6px 16px", fontWeight: 900, fontSize: "13px", cursor: "pointer", background: yearFilter === yr ? BLUE : "#fff", color: yearFilter === yr ? "#fff" : BLUE }}>
                  {yr}
                </button>
              ))}
              <div style={{ width: "2px", height: "20px", background: "#eee", margin: "0 4px" }} />
              {TYPE_FILTERS.map((t) => (
                <button key={t} onClick={() => setTypeFilter(t)} style={{ border: `2px solid ${BLUE}`, borderRadius: "20px", padding: "6px 16px", fontWeight: 900, fontSize: "13px", cursor: "pointer", background: typeFilter === t ? GOLD : "#fff", color: typeFilter === t ? "#fff" : BLUE }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Feed */}
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Feed</div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
                  {filteredFeed.length} item{filteredFeed.length !== 1 ? "s" : ""}
                </div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {filteredFeed.length === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>
                  No news or performances match your filters yet.
                </div>
              ) : filteredFeed.map((item, i) => {
                const isPerf = item._kind === "performance";
                const href = isPerf ? `/performance/${item.slug || item.id}` : `/news/${item.slug}`;
                const logo = isPerf ? schoolLogos[item.school] : null;
                return (
                  <Link
                    key={item.id}
                    to={href}
                    className={`wd-feed-item ${isPerf ? gradeGlowClass(item.grade) : ""}`}
                    style={{
                      display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", textDecoration: "none",
                      borderBottom: i < filteredFeed.length - 1 ? "1px solid #eee" : "none", background: "#fff",
                    }}
                  >
                    {isPerf ? (
                      logo ? (
                        <img src={logo} alt="" style={{ width: "34px", height: "34px", objectFit: "contain", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <span style={{ width: "34px", height: "34px", flexShrink: 0, borderRadius: "6px", background: "#eee", display: "inline-block" }} />
                      )
                    ) : (
                      <span style={{ width: "34px", height: "34px", flexShrink: 0, borderRadius: "6px", background: BLUE, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px" }}>📰</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "15px", fontWeight: 900, color: "#222", lineHeight: 1.3 }}>
                        {isPerf ? (item.playerName || item.titleShort) : item.title}
                      </div>
                      {isPerf && item.statLine && (
                        <div style={{ fontFamily: "'Courier New', monospace", fontSize: "12px", fontWeight: 700, color: "#666", marginTop: "3px" }}>
                          {item.statLine}
                        </div>
                      )}
                      {!isPerf && item.excerpt && (
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#888", marginTop: "3px", lineHeight: 1.4 }}>{item.excerpt}</div>
                      )}
                    </div>
                    <span style={{ fontSize: "10px", fontWeight: 800, color: "#bbb", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
                      {isPerf ? "Performance" : "News"}
                    </span>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
