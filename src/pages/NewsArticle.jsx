import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  collection, query, where, getDocs, orderBy, limit,
} from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function NewsArticle() {
  const { id } = useParams();
  const [article, setArticle] = useState(null);
  const [sidebarItems, setSidebarItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Inject article content styles
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "article-content-style";
    style.innerHTML = `
      .article-body { font-family: Georgia, 'Times New Roman', serif; font-size: 17px; line-height: 1.85; color: #222; }
      .article-body p { margin-bottom: 1.2em; }
      .article-body h1, .article-body h2, .article-body h3 { font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; color: ${BLUE}; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.5em 0 0.5em; }
      .article-body h1 { font-size: 22px; }
      .article-body h2 { font-size: 18px; }
      .article-body h3 { font-size: 15px; }
      .article-body strong { font-weight: 700; }
      .article-body em { font-style: italic; }
      .article-body a { color: ${GOLD}; font-weight: 600; text-decoration: underline; }
      .article-body a:hover { color: #c98a10; }
      .article-body ul, .article-body ol { margin: 0 0 1.2em 1.5em; }
      .article-body li { margin-bottom: 0.4em; }
      .article-body blockquote { border-left: 4px solid ${GOLD}; margin: 1.5em 0; padding: 0.5em 1em; background: #fdfaf3; font-style: italic; color: #444; }
      .article-body img { max-width: 100%; border-radius: 8px; margin: 1em 0; }
      .article-body hr { border: none; border-top: 2px solid #eee; margin: 2em 0; }
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

  // Fetch sidebar items
  useEffect(() => {
    const fetch = async () => {
      try {
        const [newsSnap, articleSnap] = await Promise.all([
          getDocs(query(collection(db, "news"), where("active", "==", true), orderBy("publishedAt", "desc"), limit(8))),
          getDocs(query(collection(db, "articles"), where("status", "==", "published"), orderBy("updatedAt", "desc"), limit(8))),
        ]);
        const items = [
          ...newsSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: "news" })),
          ...articleSnap.docs.map((d) => ({ id: d.id, ...d.data(), type: "article" })),
        ]
          .filter((item) => item.slug !== id)
          .sort((a, b) => ((b.updatedAt?.seconds || b.publishedAt?.seconds || 0) - (a.updatedAt?.seconds || a.publishedAt?.seconds || 0)))
          .slice(0, 8);
        setSidebarItems(items);
      } catch (err) { console.error("Error loading sidebar:", err); }
    };
    fetch();
  }, [id]);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", fontSize: "18px", fontWeight: 900, color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading…
    </div>
  );

  if (!article) return (
    <div style={{ textAlign: "center", marginTop: "80px", color: "#999", fontStyle: "italic", fontSize: "16px" }}>
      Article not found.
    </div>
  );

  const rawHtml = article.content || article.long || "";
  const cleanHtml = rawHtml;
  const videoLinks = article.videoUrl ? [{ href: article.videoUrl, label: "Watch Video" }] : [];

  const rawText = article.summary || rawHtml.replace(/<[^>]+>/g, "");
  const description = rawText.slice(0, 160);
  const canonicalUrl = `https://we-draft.com/news/${article.slug}`;
  const pubDate = article.publishedAt?.toDate?.();
  const dateStr = pubDate?.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

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
          <div style={{ flexShrink: 0, width: "36px", height: "36px", background: BLUE, border: `2px solid ${GOLD}`, borderRadius: "6px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", lineHeight: 1 }}>
            <span style={{ fontSize: "12px", fontWeight: 900 }}>{d.split(" ")[1]}</span>
            <span style={{ fontSize: "7px", fontWeight: 800, opacity: 0.8, textTransform: "uppercase" }}>{d.split(" ")[0]}</span>
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

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

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

          {/* Article */}
          <div style={{ order: isMobile ? 2 : 1 }}>
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

          {/* Sidebar */}
          <div style={{ position: isMobile ? "static" : "sticky", top: "24px", order: isMobile ? 1 : 2 }}>
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
                isMobile ? (
                  <div style={{ display: "flex", overflowX: "auto", gap: "0", background: "#fff" }}>
                    {sidebarItems.map((item) => {
                      const ts = item.publishedAt || item.updatedAt;
                      const d = ts?.toDate?.()?.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      return (
                        <Link
                          key={item.id}
                          to={`/news/${item.slug}`}
                          style={{ flexShrink: 0, width: "180px", padding: "12px 12px", textDecoration: "none", background: "#fff", borderRight: "1px solid #f0f0f0", display: "flex", flexDirection: "column", gap: "6px" }}
                        >
                          <span style={{ background: item.type === "article" ? GOLD : BLUE, color: "#fff", fontSize: "7px", fontWeight: 900, padding: "1px 5px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em", alignSelf: "flex-start" }}>
                            {item.type === "article" ? "Article" : "News"}
                          </span>
                          {d && <span style={{ fontSize: "10px", fontWeight: 700, color: "#aaa" }}>{d}</span>}
                          <span style={{ fontFamily: "'Arial Black', Arial, sans-serif", fontWeight: 900, fontSize: "11px", color: "#222", textTransform: "uppercase", letterSpacing: "0.03em", lineHeight: 1.3 }}>
                            {item.title}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  sidebarItems.map((item) => (
                    <div key={item.id}>
                      <SidebarItem item={item} />
                    </div>
                  ))
                )
              ) : (
                <div style={{ padding: "20px", textAlign: "center", color: "#bbb", fontSize: "13px", fontStyle: "italic", background: "#fff" }}>
                  No other articles
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}