import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  collection, query, where, getDocs, orderBy, limit, doc, getDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginAds from "../components/MarginAds";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function NewsArticle() {
  const { id } = useParams();
  const [article, setArticle] = useState(null);
  const [sidebarItems, setSidebarItems] = useState([]);
  const [mentionedPlayers, setMentionedPlayers] = useState([]);
  const [schoolLogos, setSchoolLogos] = useState({});
  const [loading, setLoading] = useState(true);
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

  // Inject article content styles
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "article-content-style";
    style.innerHTML = `
      .article-body { font-family: Georgia, 'Times New Roman', serif; font-size: 17px; line-height: 1.85; color: #222; word-wrap: break-word; overflow-wrap: break-word; }
      .article-body p { margin-bottom: 1.2em; }
      .article-body h1, .article-body h2, .article-body h3 { font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; color: ${BLUE}; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.5em 0 0.5em; }
      .article-body h1 { font-size: 20px; }
      .article-body h2 { font-size: 17px; }
      .article-body h3 { font-size: 14px; }
      .article-body strong { font-weight: 700; }
      .article-body em { font-style: italic; }
      .article-body a { color: ${GOLD}; font-weight: 600; text-decoration: underline; word-break: break-all; }
      .article-body a:hover { color: #c98a10; }
      .article-body ul, .article-body ol { margin: 0 0 1.2em 1.5em; }
      .article-body li { margin-bottom: 0.4em; }
      .article-body blockquote { border-left: 4px solid ${GOLD}; margin: 1.5em 0; padding: 0.5em 1em; background: #fdfaf3; font-style: italic; color: #444; }
      .article-body img { max-width: 100%; height: auto; border-radius: 8px; margin: 1em 0; display: block; }
      .article-body hr { border: none; border-top: 2px solid #eee; margin: 2em 0; }
      .article-body table { max-width: 100%; overflow-x: auto; display: block; }
      @media (max-width: 600px) {
        .article-body { font-size: 15px; line-height: 1.7; }
      }
    `;
    document.head.appendChild(style);
    return () => { const s = document.getElementById("article-content-style"); if (s) s.remove(); };
  }, []);

  // Fetch main article
  useEffect(() => {
    const fetch = async () => {
      try {
        const newsSnap = await getDocs(query(collection(db, "news"), where("slug", "==", id), where("active", "==", true)));
        if (!newsSnap.empty) { setArticle({ id: newsSnap.docs[0].id, ...newsSnap.docs[0].data(), type: "news" }); return; }
        const articleSnap = await getDocs(query(collection(db, "articles"), where("slug", "==", id), where("status", "==", "published")));
        if (!articleSnap.empty) setArticle({ id: articleSnap.docs[0].id, ...articleSnap.docs[0].data(), type: "article" });
      } catch (err) { console.error("Error loading article:", err); }
      finally { setLoading(false); }
    };
    fetch();
  }, [id]);

  // Players mentioned — only articles carry a playerIds array (built from
  // the "+Player" links the editor inserts into the body); news items don't
  // have this field, so there's nothing to show for those.
  useEffect(() => {
    setMentionedPlayers([]);
    if (article?.type !== "article" || !article.playerIds?.length) return;
    const fetch = async () => {
      try {
        const snaps = await Promise.all(article.playerIds.map((pid) => getDoc(doc(db, "players", pid))));
        setMentionedPlayers(snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() })));
      } catch (err) { console.error("Error loading mentioned players:", err); }
    };
    fetch();
  }, [article]);

  // Fetch sidebar items
  useEffect(() => {
    const fetch = async () => {
      try {
        const [newsSnap, articleSnap] = await Promise.all([
          getDocs(query(collection(db, "news"), where("active", "==", true), orderBy("publishedAt", "desc"), limit(8))),
          getDocs(query(collection(db, "articles"), where("status", "==", "published"), orderBy("publishedAt", "desc"), limit(8))),
        ]);
        const items = [
          ...newsSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: "news" })),
          ...articleSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: "article" })),
        ]
          .filter((item) => item.slug !== id)
          .sort((a, b) => ((b.publishedAt?.seconds || b.updatedAt?.seconds || 0) - (a.publishedAt?.seconds || a.updatedAt?.seconds || 0)))
          .slice(0, 8);
        setSidebarItems(items);
      } catch (err) { console.error("Error loading sidebar:", err); }
    };
    fetch();
  }, [id]);

  if (loading) return <LoadingSpinner label="Loading" size={56} minHeight="60vh" />;

  if (!article) return (
    <div style={{ textAlign: "center", marginTop: "80px", color: "#999", fontStyle: "italic", fontSize: "16px" }}>
      Article not found.
    </div>
  );

  const rawHtml = article.content || article.long || "";
  const cleanHtml = rawHtml;
  const videoLinks = article.videoUrl ? [{ href: article.videoUrl, label: "Watch Video" }] : [];

  const rawText = article.summary || rawHtml.replace(/<[^>]+>/g, "");
  const canonicalUrl = `https://we-draft.com/news/${article.slug}`;
  const pubDate = article.publishedAt?.toDate?.();
  const dateStr = pubDate?.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  // SEO/social description — articles lead with the published date and
  // mentioned players (mentionedPlayers only ever populates for
  // type:"article", never "news"), then ArticlesManager.js's own SEO
  // Description field. Falls back to a plain body-text snippet for news
  // items, or any article saved before the SEO Description field existed.
  const mentionedNames = mentionedPlayers.map((p) => `${p.First} ${p.Last}`).join(", ");
  const seoParts = [];
  if (article.type === "article") {
    if (dateStr) seoParts.push(dateStr);
    if (mentionedNames) seoParts.push(`featuring ${mentionedNames}`);
    if (article.seoDescription?.trim()) seoParts.push(article.seoDescription.trim());
  }
  const description = seoParts.length > 0 ? seoParts.join(" — ") : rawText.slice(0, 160);

  const SidebarItem = ({ item }) => {
    const ts = item.publishedAt || item.updatedAt;
    const d = ts?.toDate?.()?.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return (
      <Link
        to={`/news/${item.slug}`}
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
          <div style={{ marginBottom: "3px" }}>
            <span style={{ background: item.type === "article" ? GOLD : BLUE, color: "#fff", fontSize: "7px", fontWeight: 900, padding: "1px 5px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {item.type === "article" ? "Article" : "News"}
            </span>
          </div>
          <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: "11px", color: "#222", textTransform: "uppercase", letterSpacing: "0.03em", lineHeight: 1.3 }}>
            {item.title}
          </div>
        </div>
      </Link>
    );
  };

  // ── Players Mentioned + More News — split out of the sidebar column so
  // mobile can lay them out as their own separately-ordered grid items
  // (article first, then mentioned players, then other articles) instead
  // of as one "sidebar" block that used to come before the article on
  // mobile. Desktop is unaffected — it still stacks both inside a single
  // sticky sidebar column exactly as before. ──
  const PlayersMentionedBlock = mentionedPlayers.length > 0 && (
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
              className="wd-mentioned-player-link"
              style={{
                display: "flex", alignItems: "center", gap: "14px", padding: "16px 18px",
                textDecoration: "none",
                borderBottom: i < mentionedPlayers.length - 1 ? "1px solid #f0f0f0" : "none",
                background: "#fff",
              }}
            >
              <div className="wd-mentioned-player-logo" style={{
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
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span style={{ color: BLUE, fontWeight: 900, fontSize: "18px", lineHeight: 1.25 }}>
                  {p.First} {p.Last}
                </span>
                <span style={{ color: "#777", fontWeight: 700, fontSize: "13px", marginTop: "3px" }}>
                  <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{p.Position || "—"}</span>
                  {p.School && <span> · {p.School}</span>}
                </span>
              </div>
              <span className="wd-mentioned-player-chevron" style={{ flexShrink: 0, color: GOLD, fontSize: "22px", fontWeight: 900 }}>›</span>
            </Link>
          );
        })}
      </div>
    </div>
  );

  const MoreNewsBlock = (
    <div>
      <div style={{ marginBottom: "14px" }}>
        <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, marginBottom: "5px" }}>
          More News
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
        sidebarItems.map((item) => (
          <div key={item.id}>
            <SidebarItem item={item} />
          </div>
        ))
      ) : (
        <div style={{ padding: "20px", textAlign: "center", color: "#bbb", fontSize: "13px", fontStyle: "italic", background: "#fff" }}>
          No other articles
        </div>
      )}
    </div>
    </div>
  );

  return (
    <>
      <Helmet>
        <title>{article.title} | We-Draft</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="article" />
        <meta property="og:title" content={article.title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="We-Draft" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={article.title} />
        <meta name="twitter:description" content={description} />
        {article.publishedAt?.toDate && <meta property="article:published_time" content={article.publishedAt.toDate().toISOString()} />}
        {article.updatedAt?.toDate && <meta property="article:modified_time" content={article.updatedAt.toDate().toISOString()} />}
        {article.author && <meta property="article:author" content={article.author} />}
        <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "NewsArticle",
          "headline": article.title, "description": description, "url": canonicalUrl,
          "datePublished": article.publishedAt?.toDate?.()?.toISOString() || "",
          "dateModified": article.updatedAt?.toDate?.()?.toISOString() || article.publishedAt?.toDate?.()?.toISOString() || "",
          "author": { "@type": "Person", "name": article.author || "We-Draft" },
          "publisher": { "@type": "Organization", "name": "We-Draft", "url": "https://we-draft.com", "logo": { "@type": "ImageObject", "url": "https://we-draft.com/logo512.png" } },
          "mainEntityOfPage": { "@type": "WebPage", "@id": canonicalUrl }
        })}</script>
      </Helmet>

      {/* Players Mentioned row hover — a lift + shadow + gold glow on the
          logo, plus a chevron that slides in, instead of just a flat
          background swap. */}
      <style>{`
        .wd-mentioned-player-link {
          transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        }
        .wd-mentioned-player-link:hover {
          transform: translateX(4px);
          background: #f7f9fc;
          box-shadow: inset 3px 0 0 ${GOLD};
        }
        .wd-mentioned-player-logo {
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .wd-mentioned-player-link:hover .wd-mentioned-player-logo {
          transform: scale(1.08);
          box-shadow: 0 0 0 3px rgba(246,162,29,0.35);
        }
        .wd-mentioned-player-chevron {
          opacity: 0; transform: translateX(-6px);
          transition: opacity 0.15s ease, transform 0.15s ease;
        }
        .wd-mentioned-player-link:hover .wd-mentioned-player-chevron {
          opacity: 1; transform: translateX(0);
        }
      `}</style>

      <div ref={contentRef} style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Page header */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              News
            </div>
            <Link to="/news" style={{ marginLeft: "auto", color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "underline" }}>
              ← All News
            </Link>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* Main layout */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 300px", gap: isMobile ? "20px" : "32px", alignItems: "start" }}>

          {/* Article — always first, on both mobile and desktop. */}
          <div style={{ order: 1 }}>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>

              {/* Article header bar */}
              <div style={{ background: BLUE, padding: isMobile ? "10px 14px" : "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ background: GOLD, color: "#fff", fontSize: "9px", fontWeight: 900, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {article.type === "article" ? "Article" : "News"}
                  </span>
                  {dateStr && (
                    <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "12px", fontWeight: 700 }}>{dateStr}</span>
                  )}
                </div>
                {article.author && (
                  <span style={{ color: "rgba(255,255,255,0.75)", fontSize: "12px", fontWeight: 700 }}>By {article.author}</span>
                )}
              </div>
              <div style={{ height: "3px", background: GOLD }} />

              {/* Article body */}
              <div style={{ background: "#fff", padding: isMobile ? "20px 16px" : "32px 36px" }}>

                {/* Title */}
                <h1 style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontSize: isMobile ? "22px" : "32px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, marginBottom: "16px", marginTop: 0 }}>
                  {article.title}
                </h1>

                {/* Video buttons — shown below title if present */}
                {videoLinks.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "20px" }}>
                    {videoLinks.map((v, i) => (
                      <a
                        key={i}
                        href={v.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "8px",
                          backgroundColor: BLUE, color: "#fff",
                          border: `2px solid ${GOLD}`, borderRadius: "8px",
                          padding: isMobile ? "10px 18px" : "12px 24px",
                          fontFamily: "'Arial Black', Arial, sans-serif",
                          fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
                          textDecoration: "none", textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#003a7a"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = BLUE; }}
                      >
                        <span style={{ fontSize: "16px" }}>▶</span>
                        {v.label.replace("▶ ", "").replace("▶", "").trim() || "Watch Video"}
                      </a>
                    ))}
                  </div>
                )}

                {/* Divider */}
                <div style={{ height: "2px", background: GOLD, borderRadius: "1px", marginBottom: "24px" }} />

                {/* Content — video links stripped out */}
                <div
                  className="article-body"
                  dangerouslySetInnerHTML={{ __html: cleanHtml }}
                />

                {/* Footer */}
                <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: `2px solid #eee`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                  {dateStr && (
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#aaa" }}>Published {dateStr}</span>
                  )}
                  <Link to="/news" style={{ background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "6px", padding: "7px 18px", fontWeight: 900, fontSize: "12px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    ← All News
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar — on mobile, split into its own separately-ordered grid
              items (see PlayersMentionedBlock/MoreNewsBlock above) so the
              stacked single-column layout reads article → mentioned players
              → other articles, instead of the old single "sidebar" grid item
              (order 1) landing above the article (order 2) entirely. Desktop
              is unchanged: one sticky column with both blocks stacked. */}
          {isMobile ? (
            <>
              {PlayersMentionedBlock && <div style={{ order: 2 }}>{PlayersMentionedBlock}</div>}
              <div style={{ order: 3 }}>{MoreNewsBlock}</div>
            </>
          ) : (
            <div style={{ position: "sticky", top: "24px", order: 2, display: "flex", flexDirection: "column", gap: "24px" }}>
              {PlayersMentionedBlock}
              {MoreNewsBlock}
            </div>
          )}

        </div>
      </div>

      <MarginAds contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} />
    </>
  );
}