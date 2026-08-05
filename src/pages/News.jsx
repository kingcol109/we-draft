import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "../firebase";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";
import LoadingSpinner from "../components/LoadingSpinner";
import MarginSidebars from "../components/MarginSidebars";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

export default function News() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const contentRef = useRef(null);

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

        // Reverse chronological — unchanged.
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
      <style>{`
        .wd-news-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .wd-news-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
      `}</style>
      <Helmet>
        <title>News | We-Draft</title>
      </Helmet>

      <div ref={contentRef} style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "14px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
              <div style={{ fontSize: isMobile ? "20px" : "28px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
                News
              </div>
            </div>
            <div style={{ height: "3px", width: "160px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
            <div style={{ height: "3px", width: "160px", background: GOLD, borderRadius: "2px" }} />
          </div>
          <Link
            to="/performances"
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              background: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
              borderRadius: "24px", padding: "10px 20px", textDecoration: "none",
              fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.05em",
            }}
          >
            View Performances →
          </Link>
        </div>

        {/* ===== Content ===== */}
        {loading ? (
          <LoadingSpinner label="Loading" size={28} minHeight="200px" />
        ) : news.length === 0 ? (
          <div style={{ padding: "60px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "14px" }}>
            No news available.
          </div>
        ) : (
          Object.entries(grouped).map(([month, items]) => (
            <div key={month} style={{ marginBottom: "32px" }}>

              {/* Month header */}
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: BLUE, marginBottom: "4px" }}>
                  {month}
                </div>
                <div style={{ height: "2px", background: BLUE, borderRadius: "1px" }} />
              </div>

              {/* Cards */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: "16px" }}>
                {items.map((n) => {
                  const date = n.publishedAt?.toDate?.();
                  const dayStr = date?.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  const isLinkable = n.slug;
                  const accent = n.type === "article" ? GOLD : BLUE;

                  const card = (
                    <div style={{ height: "5px", background: accent }} />
                  );

                  const body = (
                    <div style={{ padding: "16px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                        <span style={{
                          background: n.type === "article" ? GOLD : BLUE, color: "#fff",
                          fontSize: "10px", fontWeight: 900, padding: "3px 10px", borderRadius: "20px",
                          textTransform: "uppercase", letterSpacing: "0.04em",
                        }}>
                          {n.type === "article" ? "Article" : "News"}
                        </span>
                        {dayStr && (
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "#aaa" }}>{dayStr}</span>
                        )}
                      </div>

                      <div style={{ color: BLUE, fontWeight: 900, fontSize: "16px", textTransform: "uppercase", letterSpacing: "0.02em", lineHeight: 1.3, marginBottom: n.summary ? "6px" : 0 }}>
                        {n.title}
                      </div>

                      {n.summary && (
                        <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, color: "#777", lineHeight: 1.5 }}>
                          {n.summary}
                        </p>
                      )}
                    </div>
                  );

                  const cardStyle = {
                    display: "block", background: "#fff", borderRadius: "12px",
                    border: "2px solid #eee", overflow: "hidden", textDecoration: "none",
                  };

                  return isLinkable ? (
                    <Link key={n.slug || n.id} to={`/news/${n.slug}`} className="wd-news-card" style={cardStyle}>
                      {card}
                      {body}
                    </Link>
                  ) : (
                    <div key={n.slug || n.id} style={cardStyle}>
                      {card}
                      {body}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <MarginSidebars contentRef={contentRef} isMobile={isMobile} horizontalPadding={20} otherStream="performances" />
    </>
  );
}
