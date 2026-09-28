// src/components/PlayerSidebars.js
//
// PlayerProfile.js's right column — the "Videos" and "In The News" sidebar
// cards — extracted so other player-scoped pages (Comparison.js) can show
// the exact same column without re-deriving it. The fetch logic and markup
// are copied from PlayerProfile.js's own playerNews/playerVideos effects and
// VideosSidebar/NewsSidebar blocks (plus the Watch button's Shorts queue
// from the same videos fetch); PlayerProfile.js still has its own inline
// copies, so a change to either sidebar or to how watchClips is built
// there should be mirrored here.
//
// usePlayerSidebarData(player) -> { news, videos, watchClips }
//   news:   the player's own news + articles first, then their school's to
//           fill out a sparse feed, each group newest-first.
//   videos: long-form videos tagged to the player (Shorts excluded), or —
//           if they have none — the 3 most recent CFB/Draft videos site-wide.
//   watchClips: the player's own Shorts, newest first, shaped exactly like
//           PlayerProfile.js's watchClips ({ video, isDraft, gameInfo }) so
//           they can feed its exported WatchButton — same query as videos,
//           no extra read beyond resolving CFB clips' linked games.
// <PlayerVideosCard videos /> renders nothing for an empty list, same as
// the player page (which only shows Videos when there's at least one).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { db } from "../firebase";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";
const SIDEBAR_NEWS_LIMIT = 8;
const VIDEO_FALLBACK_SCAN = 30;

const toTeamSlug = (school) => {
  if (!school) return "";
  return school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");
};
const toMs = (ts) => (ts?.toDate?.() ? ts.toDate().getTime() : typeof ts === "number" ? ts : Date.parse(ts) || 0);

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

export function usePlayerSidebarData(player) {
  const [news, setNews] = useState([]);
  const [videos, setVideos] = useState([]);
  const [watchClips, setWatchClips] = useState([]);
  const slug = player?.Slug;

  // ── In The News — same three parallel reads as PlayerProfile.js ──
  useEffect(() => {
    if (!slug) { setNews([]); return; }
    let cancelled = false;
    (async () => {
      const schoolSlug = player?.School ? toTeamSlug(player.School) : null;
      const fetchPlayerNews = async () => {
        try {
          const snap = await getDocs(query(collection(db, "news"), where("active", "==", true), where("slugs", "array-contains", slug), orderBy("publishedAt", "desc")));
          return snap.docs.map((d) => ({ id: d.id, type: "news", _priority: 1, ...d.data() }));
        } catch (e) { console.warn("News index missing, skipping:", e); return []; }
      };
      const fetchPlayerArticles = async () => {
        if (!player?.id) return [];
        try {
          const snap = await getDocs(query(collection(db, "articles"), where("status", "==", "published"), where("playerIds", "array-contains", player.id), orderBy("publishedAt", "desc")));
          return snap.docs.map((d) => { const data = d.data(); return { id: d.id, type: "article", _priority: 1, ...data, title: data.titleShort || data.title }; });
        } catch (e) { console.warn("Articles index missing, skipping:", e); return []; }
      };
      const fetchSchoolItems = async () => {
        if (!schoolSlug) return [];
        try {
          const [artSnap, newsSnap] = await Promise.all([
            getDocs(query(collection(db, "articles"), where("status", "==", "published"), where("slugs", "array-contains", schoolSlug), limit(8))),
            getDocs(query(collection(db, "news"), where("active", "==", true), where("slugs", "array-contains", schoolSlug), limit(8))),
          ]);
          return [
            ...artSnap.docs.map((d) => { const data = d.data(); return { id: d.id, type: "article", _priority: 2, ...data, title: data.titleShort || data.title }; }),
            ...newsSnap.docs.map((d) => ({ id: d.id, type: "news", _priority: 2, ...d.data() })),
          ];
        } catch { return []; }
      };
      try {
        const [playerNewsItems, playerArticleItems, schoolItemsRaw] = await Promise.all([fetchPlayerNews(), fetchPlayerArticles(), fetchSchoolItems()]);
        const existingIds = new Set([...playerNewsItems, ...playerArticleItems].map((n) => n.id));
        const schoolItems = schoolItemsRaw.filter((n) => !existingIds.has(n.id));
        const combined = [...playerArticleItems, ...playerNewsItems, ...schoolItems].sort((a, b) => {
          if (a._priority !== b._priority) return a._priority - b._priority;
          return (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0);
        });
        if (!cancelled) setNews(combined);
      } catch { if (!cancelled) setNews([]); }
    })();
    return () => { cancelled = true; };
  }, [slug, player?.id, player?.School]);

  // ── Videos + watchClips from one query — long-form videos for the
  // sidebar (site-wide fallback when none), Shorts for the Watch button ──
  useEffect(() => {
    if (!player?.id) { setVideos([]); setWatchClips([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "videos"), where("playerIds", "array-contains", player.id)));
        const all = snap.docs
          .map((d) => {
            const data = d.data();
            const items = Array.isArray(data.items) ? data.items : [];
            const matched = items.find((it) => it.playerId === player.id) || null;
            const first = items[0] || null;
            return {
              id: d.id, video: data.Video || "", date: data.Date || null, short: data.Short === true,
              tags: Array.isArray(data.Tags) ? data.Tags : [], gameSlug: data.GameSlug || "",
              title: matched?.title || first?.title || data.GenTitle || "",
              thumb: matched?.thumb || first?.thumb || data.GenThumb || "",
              publishAt: data.PublishAt || null,
            };
          })
          .filter((v) => v.video && (!v.publishAt || toMs(v.publishAt) <= Date.now()))
          .sort((a, b) => toMs(b.date) - toMs(a.date));

        // ── Shorts -> watchClips, same shaping as PlayerProfile.js: a CFB-
        // tagged Short's linked schedule26 game (by Slug) becomes
        // { opponent, dateMs, resultLabel }, then the opponent resolves to
        // its schools/{School} Short name + wordmark for the Watch popover.
        const shorts = all.filter((v) => v.short);
        const gameSlugs = [...new Set(shorts.filter((v) => v.tags.includes("CFB") && v.gameSlug).map((v) => v.gameSlug))];
        const gamesBySlug = {};
        if (gameSlugs.length > 0) {
          const gameSnaps = await Promise.all(gameSlugs.map((gs) => getDocs(query(collection(db, "schedule26"), where("Slug", "==", gs)))));
          gameSnaps.forEach((gSnap, i) => { if (!gSnap.empty) gamesBySlug[gameSlugs[i]] = gSnap.docs[0].data(); });
        }
        const buildGameInfo = (g) => {
          if (!g) return null;
          const isHome = g.Home === player.School;
          const opponent = isHome ? g.Away : g.Home;
          let resultLabel = "";
          if (g.Final && g.HomeScore != null && g.AwayScore != null) {
            const own = isHome ? g.HomeScore : g.AwayScore;
            const opp = isHome ? g.AwayScore : g.HomeScore;
            resultLabel = `${own > opp ? "W" : own < opp ? "L" : "T"} ${own}-${opp}`;
          }
          return { opponent, dateMs: toMs(g.Date), resultLabel };
        };
        const rawClips = shorts.map((v) => ({
          video: v.video,
          isDraft: v.tags.includes("Draft"),
          gameInfo: v.tags.includes("CFB") ? buildGameInfo(gamesBySlug[v.gameSlug]) : null,
        }));
        const opponents = [...new Set(rawClips.filter((c) => c.gameInfo).map((c) => c.gameInfo.opponent))];
        const schoolInfoByOpponent = {};
        if (opponents.length > 0) {
          const chunks = [];
          for (let i = 0; i < opponents.length; i += 10) chunks.push(opponents.slice(i, i + 10));
          const schoolSnaps = await Promise.all(chunks.map((chunk) => getDocs(query(collection(db, "schools"), where("School", "in", chunk)))));
          schoolSnaps.forEach((sSnap) => sSnap.docs.forEach((d) => {
            const data = d.data();
            if (data.School) schoolInfoByOpponent[data.School] = { short: data.Short || "", logo: data.Wordmark || data.WordmarkDark || data.Logo1 || "" };
          }));
        }
        if (!cancelled) {
          setWatchClips(rawClips.map((c) => {
            if (!c.gameInfo) return c;
            const info = schoolInfoByOpponent[c.gameInfo.opponent];
            return { ...c, gameInfo: { ...c.gameInfo, opponent: info?.short || c.gameInfo.opponent, logo: info?.logo || "" } };
          }));
        }

        const own = all.filter((v) => !v.short);
        if (own.length > 0) { if (!cancelled) setVideos(own); return; }

        // Newest VIDEO_FALLBACK_SCAN only, not the whole collection (which
        // grows with every upload — 230+ reads and climbing, per visit, for
        // a 3-card fallback). Every video has a Timestamp Date, so this is
        // a plain single-field orderBy; the scan window leaves room for
        // Shorts / non-CFB-or-Draft / not-yet-published ones filtered out
        // below and still yield 3.
        const allSnap = await getDocs(query(collection(db, "videos"), orderBy("Date", "desc"), limit(VIDEO_FALLBACK_SCAN)));
        const fallback = allSnap.docs
          .map((d) => {
            const data = d.data();
            const items = Array.isArray(data.items) ? data.items : [];
            const first = items[0] || null;
            const tags = Array.isArray(data.Tags) ? data.Tags : [];
            return {
              id: d.id, video: data.Video || "", date: data.Date || null, short: data.Short === true,
              title: data.GenTitle || first?.title || "", thumb: data.GenThumb || first?.thumb || "",
              tags: tags.length > 0 ? tags : ["CFB"], publishAt: data.PublishAt || null,
            };
          })
          .filter((v) => v.video && !v.short && v.tags.some((t) => t === "CFB" || t === "Draft") && (!v.publishAt || toMs(v.publishAt) <= Date.now()))
          .sort((a, b) => toMs(b.date) - toMs(a.date))
          .slice(0, 3);
        if (!cancelled) setVideos(fallback);
      } catch { if (!cancelled) { setVideos([]); setWatchClips([]); } }
    })();
    return () => { cancelled = true; };
  }, [player?.id, player?.School]);

  return { news, videos, watchClips };
}

// Same shell as PlayerProfile.js's SidebarCard.
function SidebarCard({ title, children }) {
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${SITE_BLUE}` }}>
      <div style={{ backgroundColor: SITE_BLUE, padding: "12px 14px", textAlign: "center" }}>
        <h2 className="font-black uppercase" style={{ color: "#fff", fontSize: "20px", letterSpacing: "0.08em", textAlign: "center" }}>{title}</h2>
      </div>
      <div style={{ height: "4px", backgroundColor: SITE_GOLD }} />
      <div style={{ background: "#fff" }}>{children}</div>
    </div>
  );
}

const footerButtonStyle = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", width: "100%",
  padding: "10px 14px", textDecoration: "none", background: SITE_BLUE, color: SITE_GOLD,
  border: "none", cursor: "pointer", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em",
};

export function PlayerVideosCard({ videos, accentColor = SITE_BLUE }) {
  const [visibleCount, setVisibleCount] = useState(3);
  useEffect(() => { setVisibleCount(3); }, [videos]);
  if (!videos.length) return null;
  return (
    <SidebarCard title="Videos">
      <style>{`
        .wd-video-card:hover .wd-video-thumb { transform: scale(1.08); }
        .wd-video-card:hover .wd-video-play { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      `}</style>
      {videos.slice(0, visibleCount).map((v, i, arr) => (
        <a
          key={v.id} href={sanitizeUrl(v.video)} target="_blank" rel="noopener noreferrer" className="wd-video-card"
          style={{ display: "block", position: "relative", textDecoration: "none", borderBottom: i < arr.length - 1 ? "1px solid #f0f0f0" : "none" }}
        >
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#111", overflow: "hidden" }}>
            {v.thumb ? (
              <img
                className="wd-video-thumb" src={sanitizeUrl(v.thumb)} alt={v.title || "Video thumbnail"}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 0.4s ease" }}
                referrerPolicy="no-referrer" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }}
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
                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%) scale(0.8)",
                width: "48px", height: "48px", borderRadius: "50%", background: "rgba(255,255,255,0.95)",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: 0, transition: "opacity 0.25s ease, transform 0.25s ease", boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
              }}
            >
              <span style={{ color: accentColor, fontSize: "18px", marginLeft: "3px" }}>▶</span>
            </div>
            {v.title && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "10px 12px" }}>
                <h3 className="font-black uppercase leading-tight" style={{ color: "#fff", fontSize: "13px", letterSpacing: "0.03em", textShadow: "0 1px 4px rgba(0,0,0,0.7)" }}>{v.title}</h3>
              </div>
            )}
          </div>
        </a>
      ))}
      {visibleCount < videos.length && (
        <button
          onClick={() => setVisibleCount((c) => c + 3)}
          style={{ ...footerButtonStyle, display: "block" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#003a7a"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = SITE_BLUE; }}
        >
          Show More Videos ▾
        </button>
      )}
      <Link
        to="/videos"
        style={{ ...footerButtonStyle, borderTop: "1px solid rgba(255,255,255,0.15)" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#003a7a"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = SITE_BLUE; }}
      >
        View More Videos →
      </Link>
    </SidebarCard>
  );
}

export function PlayerNewsCard({ news }) {
  const shown = news.slice(0, SIDEBAR_NEWS_LIMIT);
  return (
    <SidebarCard title="In The News">
      {shown.length === 0 ? (
        <div style={{ padding: "16px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "13px" }}>No recent news.</div>
      ) : shown.map((n, i) => (
        <Link
          key={n.slug || n.id} to={`/news/${n.slug}`}
          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", textDecoration: "none", borderBottom: i < shown.length - 1 ? "1px solid #f0f0f0" : "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#f7f9fc"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
        >
          <div className="flex-shrink-0 rounded overflow-hidden" style={{ width: 36, border: `2px solid ${SITE_BLUE}`, background: "#fff", display: "flex", flexDirection: "column" }}>
            <div style={{ background: SITE_GOLD, lineHeight: 1, padding: "1px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "8px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                {n.publishedAt?.toDate?.().toLocaleDateString(undefined, { month: "short" })}
              </span>
            </div>
            <div style={{ padding: "3px 0 2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "15px", fontWeight: 900, color: SITE_BLUE, lineHeight: 1 }}>
                {n.publishedAt?.toDate?.().toLocaleDateString(undefined, { day: "numeric" })}
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="font-black uppercase leading-tight" style={{ color: "#222", letterSpacing: "0.03em", fontSize: "12px" }}>{n.title}</h3>
          </div>
        </Link>
      ))}
    </SidebarCard>
  );
}
