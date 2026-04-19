import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function News() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [newsSnap, articlesSnap] = await Promise.all([
          getDocs(query(collection(db, "news"), where("active", "==", true), orderBy("publishedAt", "desc"))),
          getDocs(query(collection(db, "articles"), where("status", "==", "published"), orderBy("updatedAt", "desc"))),
        ]);

        const newsItems = newsSnap.docs.map((d) => ({ id: d.id, type: "news", ...d.data() }));
        const articleItems = articlesSnap.docs.map((d) => ({ id: d.id, type: "article", ...d.data(), publishedAt: d.data().updatedAt }));

        const combined = [...newsItems, ...articleItems].sort((a, b) =>
          (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0)
        );

        setNews(combined);
      } catch (err) { console.error("Error fetching news:", err); }
      finally { setLoading(false); }
    };
    fetch();
  }, []);

  // Group by month
  const grouped = news.reduce((acc, item) => {
    const date = item.publishedAt?.toDate?.();
    const key = date ? date.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <>
      <Helmet>
        <title>News | We-Draft</title>
      </Helmet>

      <div style={{ maxWidth: "800px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              News
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== Content ===== */}
        {loading ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
            Loading…
          </div>
        ) : news.length === 0 ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
            No news available.
          </div>
        ) : (
          Object.entries(grouped).map(([month, items]) => (
            <div key={month} style={{ marginBottom: "28px" }}>

              {/* Month header */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: BLUE, marginBottom: "4px" }}>
                  {month}
                </div>
                <div style={{ height: "2px", background: BLUE, borderRadius: "1px" }} />
              </div>

              {/* Items */}
              <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ background: BLUE, padding: "8px 16px" }}>
                  <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    {items.length} {items.length === 1 ? "Story" : "Stories"}
                  </div>
                </div>
                <div style={{ height: "3px", background: GOLD }} />

                {items.map((n, i) => {
                  const date = n.publishedAt?.toDate?.();
                  const dayStr = date?.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                  const isLinkable = n.slug;

                  return (
                    <div
                      key={n.slug || n.id}
                      style={{
                        display: "flex", alignItems: "center", gap: isMobile ? "10px" : "14px",
                        padding: isMobile ? "12px 12px" : "14px 18px",
                        borderBottom: i < items.length - 1 ? "1px solid #f0f0f0" : "none",
                        background: "#fff",
                      }}
                    >
                      {/* Date tile */}
                      {date && (
                        <div style={{
                          flexShrink: 0, width: isMobile ? "42px" : "52px", height: isMobile ? "42px" : "52px",
                          background: BLUE, border: `2px solid ${GOLD}`, borderRadius: "8px",
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                          color: "#fff", lineHeight: 1,
                        }}>
                          <span style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 900 }}>
                            {date.getDate()}
                          </span>
                          <span style={{ fontSize: "8px", fontWeight: 800, opacity: 0.8, textTransform: "uppercase" }}>
                            {date.toLocaleDateString(undefined, { month: "short" })}
                          </span>
                        </div>
                      )}

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{
                            background: n.type === "article" ? GOLD : BLUE, color: "#fff",
                            fontSize: "8px", fontWeight: 900, padding: "1px 6px", borderRadius: "3px",
                            textTransform: "uppercase", letterSpacing: "0.08em",
                          }}>
                            {n.type === "article" ? "Article" : "News"}
                          </span>
                          {dayStr && (
                            <span style={{ fontSize: "10px", fontWeight: 700, color: "#bbb" }}>{dayStr}</span>
                          )}
                        </div>

                        {isLinkable ? (
                          <Link
                            to={`/news/${n.slug}`}
                            style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "13px" : "15px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.3, display: "block" }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                          >
                            {n.title}
                          </Link>
                        ) : (
                          <div style={{ color: "#555", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.3 }}>
                            {n.title}
                          </div>
                        )}

                        {n.summary && (
                          <p style={{ margin: "4px 0 0", fontSize: "12px", fontWeight: 600, color: "#666", lineHeight: 1.5 }}>
                            {n.summary}
                          </p>
                        )}
                      </div>

                      {/* Arrow */}
                      {isLinkable && (
                        <div style={{ flexShrink: 0, fontWeight: 900, fontSize: isMobile ? "14px" : "18px", color: BLUE }}>→</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}