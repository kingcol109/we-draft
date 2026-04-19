import { useEffect, useState } from "react";
import {
  getDoc, doc, getDocs, collection,
  query, where, orderBy, limit,
} from "firebase/firestore";
import { db } from "../firebase";
import logo from "../assets/outlinelogo.png";
import verifiedBadge from "../assets/verified.png";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Helmet } from "react-helmet-async";
import DraftFeed from "../components/DraftFeed";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const gradeDisplay = (g) => {
  const map = {
    "Watchlist":          { short: "W",   bg: "#5F5E5A", border: "#444441" },
    "Early First Round":  { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Middle First Round": { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Late First Round":   { short: "1st", bg: "#3B6D11", border: "#27500A" },
    "Second Round":       { short: "2nd", bg: "#0F6E56", border: "#085041" },
    "Third Round":        { short: "3rd", bg: "#185FA5", border: "#0C447C" },
    "Fourth Round":       { short: "4th", bg: "#BA7517", border: "#854F0B" },
    "Fifth Round":        { short: "5th", bg: "#BA7517", border: "#854F0B" },
    "Sixth Round":        { short: "6th", bg: "#993C1D", border: "#712B13" },
    "Seventh Round":      { short: "7th", bg: "#993C1D", border: "#712B13" },
    "UDFA":               { short: "U",   bg: "#A32D2D", border: "#791F1F" },
  };
  return map[g] || null;
};

function GradeBadge({ grade }) {
  const gd = gradeDisplay(grade);
  if (!gd) return null;
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      borderRadius: "5px", width: "48px", height: "40px", flexShrink: 0,
    }}>
      <span style={{ fontSize: "15px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
      <span style={{ fontSize: "7px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "2px", textAlign: "center", lineHeight: 1.1 }}>{grade}</span>
    </div>
  );
}

export default function Home() {
  const [recentEvals, setRecentEvals] = useState([]);
  const [news, setNews] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const { user, login } = useAuth();

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const headlinesRef = collection(db, "news");
        const snap = await getDocs(query(headlinesRef, where("active", "==", true), orderBy("publishedAt", "desc"), limit(6)));
        setNews(snap.docs.map((d) => ({ id: d.id, ...d.data(), type: "news" })));
      } catch (err) { console.error("Error fetching news:", err); }
    };
    fetch();
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const snap = await getDocs(query(collection(db, "articles"), where("status", "==", "published"), orderBy("updatedAt", "desc"), limit(6)));
        setArticles(snap.docs.map((d) => ({ id: d.id, ...d.data(), type: "article" })));
      } catch (err) { console.error("Error fetching articles:", err); }
    };
    fetch();
  }, []);

  useEffect(() => {
    const fetch = async () => {
      try {
        const playersSnap = await getDocs(collection(db, "players"));
        const evalPromises = [];
        playersSnap.forEach((playerDoc) => {
          const q = query(collection(db, "players", playerDoc.id, "evaluations"), orderBy("updatedAt", "desc"), limit(2));
          evalPromises.push(
            getDocs(q).then((snap) =>
              snap.docs.map((d) => {
                const pd = playerDoc.data();
                return { ...d.data(), playerId: playerDoc.id, playerName: `${pd.First || ""} ${pd.Last || ""}`.trim(), playerSlug: pd.Slug || playerDoc.id };
              })
            )
          );
        });
        const results = await Promise.all(evalPromises);
        const allEvals = results.flat();
        const publicEvals = allEvals
          .filter((e) => e.visibility === "public" && e.evaluation?.trim())
          .sort((a, b) => (b.updatedAt?.toDate?.()?.getTime?.() || 0) - (a.updatedAt?.toDate?.()?.getTime?.() || 0))
          .slice(0, 8);

        const uniqueUids = [...new Set(publicEvals.map((ev) => ev.uid))];
        const userDocs = await Promise.all(uniqueUids.map((uid) => getDoc(doc(db, "users", uid))));
        const userMap = {};
        userDocs.forEach((snap) => {
          if (snap.exists()) {
            const u = snap.data();
            userMap[snap.id] = { username: u.username || u.email || "User", verified: u.verified || false };
          }
        });
        setRecentEvals(publicEvals.map((ev) => ({ ...ev, username: userMap[ev.uid]?.username || "User", verified: userMap[ev.uid]?.verified || false })));
      } catch (err) { console.error("Error fetching evals:", err); }
      finally { setLoading(false); }
    };
    fetch();
  }, []);

  const combinedNews = [...news, ...articles]
    .sort((a, b) => ((b.updatedAt?.seconds || b.publishedAt?.seconds || 0) - (a.updatedAt?.seconds || a.publishedAt?.seconds || 0)))
    .slice(0, 6);

  const SectionTitle = ({ children, linkTo, linkLabel }) => (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
        <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
          {children}
        </div>
        {linkTo && (
          <Link to={linkTo} style={{ color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "underline" }}>
            {linkLabel || "See all →"}
          </Link>
        )}
      </div>
      <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
      <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
    </div>
  );

  return (
    <>
      <Helmet><title>We-Draft.com</title></Helmet>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "20px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== HERO ===== */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: isMobile ? "20px" : "28px" }}>
          <img src={logo} alt="We-Draft" style={{ width: isMobile ? "280px" : "520px", maxWidth: "95vw", height: "auto", marginBottom: "12px" }} />

          {!user ? (
            <button
              onClick={login}
              style={{
                backgroundColor: BLUE, color: "#fff", border: `2px solid ${GOLD}`,
                borderRadius: "8px", padding: isMobile ? "10px 20px" : "12px 28px",
                fontWeight: 900, fontSize: isMobile ? "13px" : "15px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
              }}
            >
              Login with Google to create & store your evaluations
            </button>
          ) : (
            <p style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 700, color: "#555", textAlign: "center" }}>
              Welcome back!{" "}
              <Link to="/boards" style={{ color: BLUE, fontWeight: 900, textDecoration: "underline" }}>My Boards</Link>
              {" "}·{" "}
              <Link to="/community" style={{ color: BLUE, fontWeight: 900, textDecoration: "underline" }}>Community Board</Link>
            </p>
          )}
        </div>

        {/* ===== GRADE LOCK BANNER ===== */}
        {new Date() < new Date("2026-04-23T20:00:00-04:00") && (
          <div style={{
            background: GOLD, border: `3px solid ${BLUE}`,
            borderRadius: "10px", padding: isMobile ? "12px 16px" : "14px 24px",
            marginBottom: isMobile ? "20px" : "28px",
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "10px", flexWrap: "wrap", textAlign: "center",
          }}>
            <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              🔒 User grades lock at 8PM ET on April 23rd — submit your evaluations before the draft starts!
            </span>
            <Link
              to="/community"
              style={{
                backgroundColor: BLUE, color: "#fff", border: "2px solid #fff",
                borderRadius: "6px", padding: "6px 16px", fontWeight: 900,
                fontSize: isMobile ? "12px" : "13px", textDecoration: "none",
                textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0,
              }}
            >
              Grade Players →
            </Link>
          </div>
        )}

        {/* ===== LIVE DRAFT FEED — CENTERPIECE ===== */}
        <div style={{ marginBottom: isMobile ? "28px" : "40px" }}>
          <DraftFeed />
        </div>

        {/* ===== TWO COLUMN: NEWS + RECENT EVALS ===== */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: isMobile ? "28px" : "32px",
          marginBottom: "40px",
        }}>

          {/* ── News ── */}
          <div>
            <SectionTitle linkTo="/news" linkLabel="All News →">News</SectionTitle>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Latest</div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {combinedNews.length > 0 ? combinedNews.map((n, i) => {
                const ts = n.publishedAt || n.updatedAt;
                const dateStr = ts?.toDate?.().toLocaleDateString(undefined, { month: "short", day: "numeric" });
                const to = n.type === "article" ? `/article/${n.slug}` : `/news/${n.slug}`;
                return (
                  <Link
                    key={n.id}
                    to={to}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "12px 14px", textDecoration: "none", background: "#fff",
                      borderBottom: i < combinedNews.length - 1 ? "1px solid #f0f0f0" : "none",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                  >
                    {dateStr && (
                      <div style={{
                        flexShrink: 0, width: "40px", height: "40px",
                        background: BLUE, border: `2px solid ${GOLD}`,
                        borderRadius: "6px", display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", color: "#fff", lineHeight: 1,
                      }}>
                        <span style={{ fontSize: "13px", fontWeight: 900 }}>{dateStr.split(" ")[1]}</span>
                        <span style={{ fontSize: "8px", fontWeight: 800, opacity: 0.8, textTransform: "uppercase" }}>{dateStr.split(" ")[0]}</span>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: "2px" }}>
                        <span style={{ background: n.type === "article" ? GOLD : BLUE, color: "#fff", fontSize: "8px", fontWeight: 900, padding: "1px 6px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {n.type === "article" ? "Article" : "News"}
                        </span>
                      </div>
                      <div style={{ fontWeight: 900, fontSize: "12px", color: "#222", letterSpacing: "0.03em", textTransform: "uppercase", lineHeight: 1.3 }}>
                        {n.title}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, fontWeight: 900, fontSize: "14px", color: BLUE }}>→</div>
                  </Link>
                );
              }) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>No news yet</div>
              )}
            </div>
          </div>

          {/* ── Recent Evaluations ── */}
          <div>
            <SectionTitle linkTo="/community" linkLabel="Community Board →">Recent Evaluations</SectionTitle>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 16px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Public</div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {loading ? (
                <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>Loading...</div>
              ) : recentEvals.length > 0 ? recentEvals.map((ev, i) => {
                const gd = ev.grade ? gradeDisplay(ev.grade) : null;
                return (
                  <div
                    key={i}
                    style={{
                      padding: "12px 14px", background: "#fff",
                      borderBottom: i < recentEvals.length - 1 ? "1px solid #f0f0f0" : "none",
                    }}
                  >
                    {/* User + player */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <span style={{ fontWeight: 900, fontSize: "12px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em" }}>{ev.username}</span>
                      {ev.verified && <img src={verifiedBadge} alt="Verified" style={{ width: "14px", height: "14px" }} />}
                      <span style={{ color: "#ccc", fontSize: "11px" }}>on</span>
                      <Link to={`/player/${ev.playerSlug}`} style={{ fontWeight: 900, fontSize: "12px", color: BLUE, textDecoration: "underline", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {ev.playerName}
                      </Link>
                    </div>

                    {/* Grade badge + eval text */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                      {gd && <GradeBadge grade={ev.grade} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {ev.evaluation && (
                          <p style={{ fontStyle: "italic", fontSize: "12px", color: "#444", lineHeight: 1.5, margin: 0 }}>
                            "{ev.evaluation.length > 120 ? ev.evaluation.slice(0, 120) + "…" : ev.evaluation}"
                          </p>
                        )}
                        {(ev.strengths?.length > 0 || ev.weaknesses?.length > 0) && (
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#777", marginTop: "4px" }}>
                            {ev.strengths?.length > 0 && <span>S: {Array.isArray(ev.strengths) ? ev.strengths.join(", ") : ev.strengths} </span>}
                            {ev.weaknesses?.length > 0 && <span>W: {Array.isArray(ev.weaknesses) ? ev.weaknesses.join(", ") : ev.weaknesses}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>No recent evaluations yet</div>
              )}
            </div>
          </div>
        </div>

        {/* ===== SOCIAL LINKS ===== */}
        <div style={{ borderTop: `2px solid #eee`, paddingTop: "24px", textAlign: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "#aaa", marginBottom: "12px" }}>
            Follow Us
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: isMobile ? "16px" : "32px", flexWrap: "wrap" }}>
            {[
              { label: "Instagram", href: "https://www.instagram.com/wedraftsite" },
              { label: "X (Twitter)", href: "https://twitter.com/wedraftsite" },
              { label: "YouTube", href: "https://www.youtube.com/@kingcoldsports" },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: GOLD, fontWeight: 900, fontSize: isMobile ? "14px" : "16px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
              >
                {label}
              </a>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}