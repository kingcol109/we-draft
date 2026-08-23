// src/pages/VideosPage.js
//
// Public "browse all videos" page — every video in the `videos` collection
// (AdminPanel.js's Videos tab / the synced Google Sheet), newest first.
// Each video's title/thumb here always uses the video's own GenTitle/
// GenThumb (its site-wide fallback) rather than a specific player's
// override — unlike PlayerProfile.js's own Videos sidebar, this page isn't
// scoped to one player, so there's no "this player's tag" to prefer.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginSidebars from "../components/MarginSidebars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const PAGE_SIZE = 12;

// Same imgur/Google Drive URL cleanup every other page with user-entered
// image/video links runs input through (PlayerProfile.js's own
// sanitizeUrl chain) — duplicated here rather than shared, matching this
// codebase's per-file convention for small helpers like this.
function sanitizeImgur(url) {
  if (!url) return "";
  if (/^https?:\/\/i\.imgur\.com\/.+\.(png|jpe?g|gif|webp)$/i.test(url)) return url;
  const singleMatch = url.match(/^https?:\/\/imgur\.com\/(?!a\/|gallery\/)([A-Za-z0-9]+)$/i);
  if (singleMatch) return `https://i.imgur.com/${singleMatch[1]}.png`;
  if (/^https?:\/\/imgur\.com\/(a|gallery)\//i.test(url)) return "";
  return url;
}
function sanitizeGoogleDrive(url) {
  if (!url) return "";
  const m = url.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/]+)\//i);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return url;
}
function sanitizeUrl(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (u.includes("imgur.com")) u = sanitizeImgur(u);
  if (u.includes("drive.google.com")) u = sanitizeGoogleDrive(u);
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

const PAGE_TITLE = "College Football Analysis | All 22 Breakdowns";
const PAGE_DESCRIPTION = "Watch All-22 film breakdowns and college football video analysis on top NFL Draft prospects — every breakdown from We-Draft's scouting team.";

// Same three tags AdminPanel.js's Videos tab offers (VIDEO_TAGS there).
// Recruiting starts off, matching CommunityBoard.js's own permanent
// Recruiting exclusion — this page just makes that a visitor-adjustable
// choice instead of a hard rule.
const VIDEO_TAGS = ["CFB", "Draft", "Recruiting"];
const DEFAULT_TAGS = ["CFB", "Draft"];

export default function VideosPage() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedTags, setSelectedTags] = useState(DEFAULT_TAGS);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const contentRef = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Same prerenderReady handling as CommunityBoard.js/TeamPage.js: reset to
  // false on mount so Prerender.io's headless browser doesn't snapshot
  // before the real video list has loaded, with an 8s safety timer so a
  // slow/failed fetch never leaves it waiting forever.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.prerenderReady = false;
    const safetyTimer = setTimeout(() => { window.prerenderReady = true; }, 8000);
    return () => clearTimeout(safetyTimer);
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [videosSnap, playersSnap] = await Promise.all([
          getDocs(collection(db, "videos")),
          getDocs(collection(db, "players")),
        ]);
        const playersById = {};
        playersSnap.forEach((d) => { playersById[d.id] = { id: d.id, ...d.data() }; });

        const toMs = (ts) => ts?.toDate?.() ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0;
        const vids = videosSnap.docs
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
              players: items
                .map((it) => (it.playerId ? playersById[it.playerId] : null))
                .filter(Boolean),
            };
          })
          .filter((v) => v.video)
          .sort((a, b) => toMs(b.date) - toMs(a.date));
        setVideos(vids);
      } catch (e) {
        console.error("Videos fetch error:", e);
        setVideos([]);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!loading) window.prerenderReady = true;
  }, [loading]);

  // An untagged video (nothing set yet in AdminPanel.js's Videos tab) is
  // treated as CFB rather than hidden outright — otherwise every video
  // predating this feature would just disappear from the page the moment
  // filtering shipped, regardless of which tags are selected.
  const filteredVideos = videos.filter((v) => (v.tags.length > 0 ? v.tags : ["CFB"]).some((t) => selectedTags.includes(t)));
  const visible = filteredVideos.slice(0, visibleCount);

  const toggleTag = (tag) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <>
      <style>{`
        .wd-video-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .wd-video-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
        .wd-video-card:hover .wd-video-thumb { transform: scale(1.04); }
      `}</style>
      <Helmet>
        <title>{PAGE_TITLE}</title>
        <meta name="description" content={PAGE_DESCRIPTION} />
        <link rel="canonical" href="https://we-draft.com/videos" />
        <meta name="robots" content="index, follow" />
        <meta property="og:title" content={PAGE_TITLE} />
        <meta property="og:description" content={PAGE_DESCRIPTION} />
        <meta property="og:url" content="https://we-draft.com/videos" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="We-Draft" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={PAGE_TITLE} />
        <meta name="twitter:description" content={PAGE_DESCRIPTION} />
        {/* Home → Videos — index/hub page, no Video schema here since
            individual videos live off-site (YouTube/etc.), not on a
            /video/:slug page of our own to attach it to. */}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://we-draft.com/" },
            { "@type": "ListItem", "position": 2, "name": "Videos", "item": "https://we-draft.com/videos" },
          ],
        })}</script>
      </Helmet>

      <div ref={contentRef} style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "28px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              Videos
            </div>
          </div>
          <div style={{ height: "3px", width: "160px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", width: "160px", background: GOLD, borderRadius: "2px" }} />
          <p style={{ marginTop: "12px", fontSize: "13px", fontWeight: 700, color: "#888", maxWidth: "560px" }}>
            All-22 film breakdowns and college football video analysis on top NFL Draft prospects.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "16px" }}>
            {VIDEO_TAGS.map((tag) => {
              const active = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  style={{
                    padding: "8px 16px", fontWeight: 900, fontSize: "12px",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                    border: `2px solid ${GOLD}`, borderRadius: "20px", cursor: "pointer",
                    background: active ? BLUE : "#fff",
                    color: active ? "#fff" : BLUE,
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* ===== Content ===== */}
        {loading ? (
          <LoadingSpinner label="Loading" size={28} minHeight="200px" />
        ) : videos.length === 0 ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
            No videos available yet.
          </div>
        ) : filteredVideos.length === 0 ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
            No videos match the selected tags.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "16px" }}>
              {visible.map((v) => {
                const d = v.date?.toDate?.();
                // timeZone: "UTC" — Date is a date-only value entered via
                // AdminPanel.js's <input type="date">, stored as UTC
                // midnight; formatting it in the viewer's local zone
                // instead shifts it a day early for anyone west of UTC.
                const dateStr = d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
                return (
                  <div key={v.id} className="wd-video-card" style={{ background: "#fff", borderRadius: "12px", border: "2px solid #eee", overflow: "hidden" }}>
                    <a
                      href={sanitizeUrl(v.video)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "block", textDecoration: "none" }}
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
                            <span style={{ color: "#fff", fontSize: "32px" }}>▶</span>
                          </div>
                        )}
                        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)", pointerEvents: "none" }} />
                        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 12px" }}>
                          <h3 style={{ margin: 0, color: "#fff", fontWeight: 900, fontSize: "13px", letterSpacing: "0.03em", textShadow: "0 1px 4px rgba(0,0,0,0.7)", lineHeight: 1.3 }}>
                            {v.title || "Untitled Breakdown"}
                          </h3>
                        </div>
                      </div>
                    </a>
                    {(dateStr || v.players.length > 0) && (
                      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        {dateStr && <span style={{ fontSize: "11px", fontWeight: 700, color: "#aaa" }}>{dateStr}</span>}
                        {v.players.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {v.players.map((p) => (
                              <Link
                                key={p.id}
                                to={`/player/${p.Slug || p.id}`}
                                style={{ fontSize: "11px", fontWeight: 800, color: BLUE, background: "#eaf1ff", borderRadius: "10px", padding: "2px 8px", textDecoration: "none" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "#dce9ff"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "#eaf1ff"; }}
                              >
                                {p.First} {p.Last}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {visibleCount < filteredVideos.length && (
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                style={{
                  display: "block", width: "100%", marginTop: "24px",
                  padding: "12px", background: BLUE, color: GOLD,
                  border: "none", borderRadius: "8px", cursor: "pointer",
                  fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#003a7a"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = BLUE; }}
              >
                Show More Videos ▾
              </button>
            )}
          </>
        )}
      </div>

      <MarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} otherStream="news" />
    </>
  );
}
