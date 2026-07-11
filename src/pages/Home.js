import { useEffect, useState } from "react";
import {
  getDoc, doc, getDocs, collection,
  query, where, orderBy, limit,
} from "firebase/firestore";
import { db } from "../firebase";
import logo from "../assets/Logo2.png";
import verifiedBadge from "../assets/verified.png";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Helmet } from "react-helmet-async";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const SITE_TITLE = "We-Draft.com - NFL Draft Scouting Reports, Rankings & Mock Drafts";
const SITE_DESCRIPTION = "Build your NFL Draft board, read scouting reports, compare community evaluations, create mock drafts, and follow thousands of college football prospects with rankings, film links, measurable data, and the latest draft news.";
const SITE_URL = "https://we-draft.com/";

const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
};

const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round",
  4: "Second Round", 5: "Third Round", 6: "Fourth Round",
  7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};

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
  const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(grade);
  const qualifier = isFirstRound ? grade.replace(" First Round", "").toUpperCase() : null;
  const bottomLabel = "ROUND";
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      borderRadius: "5px", width: "52px", height: "42px", flexShrink: 0, gap: "1px",
    }}>
      {qualifier && <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1, textAlign: "center" }}>{qualifier}</span>}
      <span style={{ fontSize: "15px", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.01em", textAlign: "center" }}>{gd.short}</span>
      <span style={{ fontSize: "6.5px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center", lineHeight: 1.1 }}>{grade === "Watchlist" ? "WATCHLIST" : bottomLabel}</span>
    </div>
  );
}

function TopDraftBoard({ isMobile, year }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Link targets: 2027 → /community, 2028 → /community/2028
  const boardLink = year === "2027" ? "/community" : `/community/${year}`;

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const snap = await getDocs(collection(db, "players"));
        const all = await Promise.all(
          snap.docs.map(async (docSnap) => {
            const p = { id: docSnap.id, ...docSnap.data() };
            if (p.Eligible?.toString() !== year) return null;
            if (p.Live === false || p.Live === null || p.Live === 0 || p.Live === "false" || p.Live === "no") return null;
            try {
              const evalsSnap = await getDocs(collection(db, "players", docSnap.id, "evaluations"));
              const grades = [];
              evalsSnap.forEach((d) => {
                const g = d.data().grade;
                if (g && gradeScale[g]) grades.push(gradeScale[g]);
              });
              p.commGradeScore = grades.length > 0
                ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length)
                : null;
              p.commGrade = p.commGradeScore ? gradeLabels[p.commGradeScore] : null;
            } catch {
              p.commGradeScore = null;
              p.commGrade = null;
            }
            return p;
          })
        );

        const ranked = all
          .filter((p) => p !== null && p.commGradeScore !== null)
          .sort((a, b) => a.commGradeScore - b.commGradeScore)
          .slice(0, 10);

        setPlayers(ranked);
      } catch (err) {
        console.error(`Error fetching ${year} players:`, err);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, [year]);

  if (loading) return (
    <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>Loading...</div>
  );

  const rankColors = [
    { num: "#fff", bg: "linear-gradient(135deg, #c9a227 0%, #f6d675 50%, #c9a227 100%)", shadow: "0 4px 20px rgba(198,160,39,0.5)", border: "2px solid #a8841e" },
    { num: "#fff", bg: "linear-gradient(135deg, #8a9ba8 0%, #c8d6df 50%, #8a9ba8 100%)", shadow: "0 4px 14px rgba(138,155,168,0.45)", border: "2px solid #6b7f8c" },
    { num: "#fff", bg: "linear-gradient(135deg, #a0674a 0%, #d4956e 50%, #a0674a 100%)", shadow: "0 4px 14px rgba(160,103,74,0.45)", border: "2px solid #7a4e37" },
  ];

  if (players.length === 0) return (
    <div style={{ borderRadius: "14px", overflow: "hidden", background: `linear-gradient(160deg, ${BLUE} 0%, #003a7a 100%)`, padding: "40px 16px", textAlign: "center" }}>
      <div style={{ fontSize: "28px", marginBottom: "8px" }}>🏈</div>
      <div style={{ color: GOLD, fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>The {year} Class Awaits</div>
      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "12px", fontWeight: 700, marginBottom: "18px" }}>Be the first to evaluate the next generation of NFL talent</div>
      <Link to={boardLink} style={{ display: "inline-block", backgroundColor: GOLD, color: BLUE, borderRadius: "8px", padding: "9px 22px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.1em", textDecoration: "none" }}>
        Start Evaluating →
      </Link>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .prospect-row {
          transition: background 0.15s, box-shadow 0.15s, transform 0.12s;
        }
        .prospect-row:hover {
          background: linear-gradient(90deg, #e8f2ff 0%, #f0f6ff 100%) !important;
          box-shadow: inset 4px 0 0 #0055a5;
          transform: translateX(3px);
        }
        .prospect-row:hover .prospect-name {
          text-decoration: underline;
        }
      `}</style>
      <div style={{
        borderRadius: "14px", overflow: "hidden",
        boxShadow: "0 8px 40px rgba(0,85,165,0.18)",
        border: `2px solid ${BLUE}`,
      }}>
      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
        padding: isMobile ? "14px 14px 12px" : "16px 18px 14px",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: "150px", height: "100%", background: "repeating-linear-gradient(60deg, transparent, transparent 12px, rgba(246,162,29,0.07) 12px, rgba(246,162,29,0.07) 24px)", pointerEvents: "none" }} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: "9px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "3px" }}>
              🏈 Community Rankings
            </div>
            <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.01em" }}>
              {year} NFL Draft
            </div>
            <div style={{ fontSize: isMobile ? "11px" : "13px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>
              Top Prospects
            </div>
          </div>
          <Link to={boardLink} style={{
            background: GOLD, color: BLUE, fontWeight: 900,
            fontSize: "10px", padding: "6px 14px",
            borderRadius: "20px", textDecoration: "none", textTransform: "uppercase",
            letterSpacing: "0.06em", flexShrink: 0,
            boxShadow: "0 2px 10px rgba(246,162,29,0.4)",
            whiteSpace: "nowrap",
          }}>
            Full Board →
          </Link>
        </div>
      </div>
      <div style={{ height: "4px", background: `linear-gradient(90deg, ${GOLD}, #ffd96a, ${GOLD})` }} />

      {/* Rows */}
      <div style={{ background: "#fff" }}>
        {players.map((p, i) => {
          const rank = rankColors[i] || null;
          const isTop3 = i < 3;
          return (
            <Link
              key={p.id}
              to={`/player/${p.Slug}`}
              className="prospect-row"
              style={{
                display: "flex", alignItems: "center",
                padding: isMobile ? "10px 12px" : isTop3 ? "13px 16px" : "10px 16px",
                borderBottom: i < players.length - 1 ? "1px solid #eef2f7" : "none",
                background: isTop3 ? "linear-gradient(90deg, #f7faff 0%, #fff 100%)" : "#fff",
                textDecoration: "none",
                animation: `slideIn 0.3s ease both`,
                animationDelay: `${i * 0.05}s`,
              }}
            >
              {/* Rank badge */}
              <div style={{
                flexShrink: 0,
                width: isTop3 ? "38px" : "30px",
                height: isTop3 ? "38px" : "30px",
                borderRadius: isTop3 ? "8px" : "6px",
                background: rank ? rank.bg : "#f0f0f0",
                border: rank ? rank.border : "2px solid #ddd",
                boxShadow: rank ? rank.shadow : "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginRight: "12px",
                flexShrink: 0,
              }}>
                <span style={{
                  fontSize: isTop3 ? "17px" : "13px",
                  fontWeight: 900, color: rank ? rank.num : "#bbb",
                  lineHeight: 1, textShadow: isTop3 ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
                }}>
                  {i + 1}
                </span>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="prospect-name"
                  style={{
                    color: BLUE, fontWeight: 900,
                    fontSize: isTop3 ? "19px" : "16px",
                    lineHeight: 1.2,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {`${p.First || ""} ${p.Last || ""}`}
                </div>
                <div style={{
                  fontSize: "13px", fontWeight: 700,
                  color: isTop3 ? "#444" : "#888", marginTop: "3px",
                  display: "flex", alignItems: "center", gap: "5px",
                }}>
                  {p.Position && (
                    <span style={{
                      background: BLUE, color: "#fff", fontSize: "10px",
                      fontWeight: 900, padding: "2px 6px", borderRadius: "3px",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      flexShrink: 0,
                    }}>
                      {p.Position}
                    </span>
                  )}
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "13px" }}>{p.School || "—"}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, marginLeft: "6px" }}>
                {p.commGrade && <GradeBadge grade={p.commGrade} />}
                <span style={{ color: "#ccc", fontSize: "14px", fontWeight: 900 }}>›</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Footer CTA */}
      <div style={{
        background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
        padding: isMobile ? "12px 14px" : "14px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: "8px",
      }}>
        <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "10px", fontWeight: 700 }}>
          Community evaluations
        </div>
        <Link
          to={boardLink}
          style={{
            background: GOLD, color: BLUE, fontWeight: 900,
            fontSize: "11px", padding: "8px 16px",
            borderRadius: "8px", textDecoration: "none",
            textTransform: "uppercase", letterSpacing: "0.08em",
            boxShadow: "0 3px 14px rgba(246,162,29,0.45)",
            whiteSpace: "nowrap",
          }}
        >
          Full {year} Board →
        </Link>
      </div>
      </div>
    </>
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
        const snap = await getDocs(query(collection(db, "news"), where("active", "==", true), orderBy("publishedAt", "desc"), limit(6)));
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
          const pd = playerDoc.data();
          if (pd.Live === false || pd.Live === null || pd.Live === 0 || pd.Live === "false" || pd.Live === "no") return;
          const q = query(collection(db, "players", playerDoc.id, "evaluations"), orderBy("updatedAt", "desc"), limit(2));
          evalPromises.push(
            getDocs(q).then((snap) =>
              snap.docs.map((d) => ({
                ...d.data(),
                playerId: playerDoc.id,
                playerName: `${pd.First || ""} ${pd.Last || ""}`.trim(),
                playerSlug: pd.Slug || playerDoc.id,
              }))
            )
          );
        });
        const results = await Promise.all(evalPromises);
        const allEvals = results.flat();
        const publicEvals = allEvals
          .filter((e) => e.visibility === "public" && e.evaluation?.trim())
          .sort((a, b) => (b.updatedAt?.toDate?.()?.getTime?.() || 0) - (a.updatedAt?.toDate?.()?.getTime?.() || 0))
          .slice(0, 6);

        const uniqueUids = [...new Set(publicEvals.map((ev) => ev.uid))];
        const userDocs = await Promise.all(uniqueUids.map((uid) => getDoc(doc(db, "users", uid))));
        const userMap = {};
        userDocs.forEach((snap) => {
          if (snap.exists()) {
            const u = snap.data();
            userMap[snap.id] = { username: u.username || u.email || "User", verified: u.verified || false };
          }
        });
        setRecentEvals(publicEvals.map((ev) => ({
          ...ev,
          username: userMap[ev.uid]?.username || "User",
          verified: userMap[ev.uid]?.verified || false,
        })));
      } catch (err) { console.error("Error fetching evals:", err); }
      finally { setLoading(false); }
    };
    fetch();
  }, []);

  const combinedNews = [...news, ...articles]
    .sort((a, b) => ((b.publishedAt?.seconds || b.updatedAt?.seconds || 0) - (a.publishedAt?.seconds || a.updatedAt?.seconds || 0)))
    .slice(0, 6);

  const SectionTitle = ({ children, linkTo, linkLabel }) => (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
        <div style={{ fontSize: isMobile ? "16px" : "22px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
          {children}
        </div>
        {linkTo && (
          <Link to={linkTo} style={{ color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "underline", flexShrink: 0, marginLeft: "10px" }}>
            {linkLabel || "See all →"}
          </Link>
        )}
      </div>
      <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
      <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
    </div>
  );

  // Mobile quick-link chips (horizontal scroll row)
  const mobileChips = [
    { label: "Evaluate", to: "/community", icon: "📋" },
    { label: "Mock Drafts", to: "/mocks", icon: "🏈" },
    { label: "NFL Teams", to: "/nfl", icon: "🏟️" },
    { label: "Colleges", to: "/cfb", icon: "🎓" },
    { label: "News", to: "/news", icon: "📰" },
    { label: "Past Drafts", to: "/community/2026", icon: "📜" },
  ];

  return (
    <>
      <Helmet>
        <title>{SITE_TITLE}</title>
        <meta name="description" content={SITE_DESCRIPTION} />
        <link rel="canonical" href={SITE_URL} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={SITE_TITLE} />
        <meta property="og:description" content={SITE_DESCRIPTION} />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:site_name" content="We-Draft.com" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={SITE_TITLE} />
        <meta name="twitter:description" content={SITE_DESCRIPTION} />
      </Helmet>

      <style>{`
        .mobile-chip-scroll {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          padding-bottom: 2px;
        }
        .mobile-chip-scroll::-webkit-scrollbar { display: none; }
        .mobile-chip {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.22);
          border-radius: 10px;
          padding: 10px 14px;
          text-decoration: none;
          flex-shrink: 0;
          min-width: 72px;
          transition: background 0.15s;
        }
        .mobile-chip:active { background: rgba(255,255,255,0.22); }
      `}</style>

      <div style={{ width: "100%", padding: isMobile ? "10px 10px 60px" : "20px 4% 60px", fontFamily: "'Arial Black', Arial, sans-serif", boxSizing: "border-box" }}>

        {/* ===== HERO ===== */}
        <div style={{
          display: "flex", alignItems: "stretch",
          marginBottom: isMobile ? "16px" : "28px",
          background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
          borderRadius: "12px", padding: isMobile ? "14px 14px 12px" : "18px 32px",
          border: `2px solid ${GOLD}`, gap: "28px",
          flexDirection: isMobile ? "column" : "row",
        }}>

          {/* ── Left chips: 2x2 grid (desktop only) ── */}
          {!isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "14px", flex: "1 1 0", minWidth: "280px", maxWidth: "420px", alignSelf: "stretch" }}>
              {[
                { label: "Evaluate Players", sub: "Grade every prospect", to: "/community", icon: "📋" },
                { label: "Find Hidden Gems", sub: "Under-the-radar talent", to: "/community/2028", icon: "💎" },
                { label: "Create Mock Drafts", sub: "Build and share your mock", to: "/mocks", icon: "🏈" },
                { label: "Draft News", sub: "Latest prospect analysis", to: "/news", icon: "📰" },
              ].map(({ label, sub, to, icon }) => (
                <Link key={label} to={to} style={{
                  display: "flex", flexDirection: "column", gap: "8px",
                  background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "12px", padding: "18px 18px", textDecoration: "none",
                  transition: "background 0.15s", height: "100%", boxSizing: "border-box",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
                >
                  <span style={{ fontSize: "26px", lineHeight: 1 }}>{icon}</span>
                  <span style={{ fontWeight: 900, fontSize: "13px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.25 }}>{label}</span>
                  <span style={{ fontWeight: 700, fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.35 }}>{sub}</span>
                </Link>
              ))}
            </div>
          )}

          {/* ── Center ── */}
          <div style={{ flex: "1.3 1 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <img
              src={logo}
              alt="We-Draft.com"
              style={{ width: isMobile ? "220px" : "660px", maxWidth: "90vw", height: "auto", marginBottom: isMobile ? "10px" : "16px" }}
            />

            <div style={{ fontSize: isMobile ? "18px" : "32px", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.1, marginBottom: "8px" }}>
              <span style={{ color: "#fff" }}>FOOTBALL. </span>
              <span style={{ color: GOLD }}>YOUR WAY.</span>
            </div>

            <div style={{ fontSize: isMobile ? "12px" : "15px", fontWeight: 700, color: "#fff", lineHeight: 1.65, marginBottom: "18px", maxWidth: "520px" }}>
              Create your own NFL Draft board, publish player evaluations, and compare your rankings with the We-Draft community.
            </div>

            {!user ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                <button onClick={login} style={{
                  backgroundColor: GOLD, color: "#fff",
                  border: "2px solid #fff", borderRadius: "8px",
                  padding: isMobile ? "12px 24px" : "16px 36px",
                  fontWeight: 900, fontSize: isMobile ? "14px" : "18px",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                  cursor: "pointer", fontFamily: "inherit",
                  WebkitTapHighlightColor: "transparent",
                }}>
                  Join Free — Start Scouting →
                </button>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.45)" }}>
                  Free · Google or Email · No spam
                </div>
              </div>
            ) : (
              <p style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "rgba(255,255,255,0.8)", margin: 0 }}>
                Welcome back!{" "}
                <Link to="/boards" style={{ color: GOLD, fontWeight: 900 }}>My Boards</Link>
                {" "}·{" "}
                <Link to="/community" style={{ color: GOLD, fontWeight: 900 }}>Community Board</Link>
              </p>
            )}

            {/* Mobile horizontal chip row */}
            {isMobile && (
              <div className="mobile-chip-scroll" style={{ marginTop: "18px", width: "100%" }}>
                {mobileChips.map(({ label, to, icon }) => (
                  <Link key={label} to={to} className="mobile-chip">
                    <span style={{ fontSize: "20px", lineHeight: 1 }}>{icon}</span>
                    <span style={{ fontWeight: 900, fontSize: "10px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center", lineHeight: 1.2 }}>{label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* ── Right chips: 2x2 grid (desktop only) ── */}
          {!isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "14px", flex: "1 1 0", minWidth: "280px", maxWidth: "420px", alignSelf: "stretch" }}>

              <Link to="/nfl" style={{
                display: "flex", flexDirection: "column", gap: "8px",
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "12px", padding: "18px 18px", textDecoration: "none",
                transition: "background 0.15s", height: "100%", boxSizing: "border-box",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
              >
                <span style={{ fontSize: "26px", lineHeight: 1 }}>🏟️</span>
                <span style={{ fontWeight: 900, fontSize: "13px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.25 }}>NFL Rosters</span>
                <span style={{ fontWeight: 700, fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.35 }}>All 32 NFL teams</span>
              </Link>

              <Link to="/cfb" style={{
                display: "flex", flexDirection: "column", gap: "8px",
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "12px", padding: "18px 18px", textDecoration: "none",
                transition: "background 0.15s", height: "100%", boxSizing: "border-box",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
              >
                <span style={{ fontSize: "26px", lineHeight: 1 }}>🎓</span>
                <span style={{ fontWeight: 900, fontSize: "13px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.25 }}>College Rosters</span>
                <span style={{ fontWeight: 700, fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.35 }}>Prospects by school</span>
              </Link>

              <div style={{
                display: "flex", flexDirection: "column", gap: "8px",
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "12px", padding: "18px 18px", height: "100%", boxSizing: "border-box",
              }}>
                <span style={{ fontSize: "26px", lineHeight: 1 }}>📣</span>
                <span style={{ fontWeight: 900, fontSize: "13px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.25 }}>Stay Up to Date</span>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px", marginTop: "2px" }}>
                  {[
                    { label: "X / Twitter", href: "https://twitter.com/wedraftsite" },
                    { label: "Instagram", href: "https://www.instagram.com/wedraftsite" },
                    { label: "YouTube", href: "https://www.youtube.com/@kingcoldsports" },
                  ].map(({ label, href }) => (
                    <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{
                      color: GOLD, fontWeight: 900, fontSize: "11px",
                      textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.05em",
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                    >
                      → {label}
                    </a>
                  ))}
                </div>
              </div>

              <Link to="/community/2026" style={{
                display: "flex", flexDirection: "column", gap: "8px",
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "12px", padding: "18px 18px", textDecoration: "none",
                transition: "background 0.15s", height: "100%", boxSizing: "border-box",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
              >
                <span style={{ fontSize: "26px", lineHeight: 1 }}>📜</span>
                <span style={{ fontWeight: 900, fontSize: "13px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.25 }}>View Past Drafts</span>
                <span style={{ fontWeight: 700, fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.35 }}>2026 class results</span>
              </Link>

            </div>
          )}

        </div>

        {/* ===== MAIN GRID: 3-col desktop, stacked mobile (board first) ===== */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr 1fr",
          gap: isMobile ? "24px" : "20px",
          marginBottom: isMobile ? "28px" : "40px",
          alignItems: "start",
        }}>

          {/* On mobile: 2027 Board renders first via CSS order */}

          {/* -- Recent Evaluations (LEFT on desktop, 2nd on mobile) -- */}
          <div style={{ order: isMobile ? 2 : 0 }}>
            <SectionTitle linkTo="/community" linkLabel="Community →">Recent Evals</SectionTitle>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 14px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Public</div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {loading ? (
                <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>Loading...</div>
              ) : recentEvals.length > 0 ? recentEvals.map((ev, i) => (
                <div key={i} style={{ padding: "12px 14px", background: "#fff", borderBottom: i < recentEvals.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 900, fontSize: "10px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em" }}>{ev.username}</span>
                    {ev.verified && <img src={verifiedBadge} alt="Verified" style={{ width: "11px", height: "11px" }} />}
                    <span style={{ color: "#ccc", fontSize: "10px" }}>on</span>
                    <Link to={`/player/${ev.playerSlug}`} style={{ fontWeight: 900, fontSize: "10px", color: BLUE, textDecoration: "underline", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {ev.playerName}
                    </Link>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
                    {ev.grade && gradeDisplay(ev.grade) && <GradeBadge grade={ev.grade} />}
                    {ev.evaluation && (
                      <p style={{ fontStyle: "italic", fontSize: "11px", color: "#444", lineHeight: 1.5, margin: 0 }}>
                        "{ev.evaluation.length > 180 ? ev.evaluation.slice(0, 180) + "..." : ev.evaluation}"
                      </p>
                    )}
                  </div>
                  {(ev.strengths?.length > 0 || ev.weaknesses?.length > 0) && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                      {ev.strengths?.length > 0 && (
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
                          <span style={{ flexShrink: 0, background: "#2e7d32", color: "#fff", fontSize: "8px", fontWeight: 900, padding: "2px 6px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "1px" }}>S</span>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "#2e7d32", lineHeight: 1.4 }}>
                            {(Array.isArray(ev.strengths) ? ev.strengths : [ev.strengths]).join(", ")}
                          </span>
                        </div>
                      )}
                      {ev.weaknesses?.length > 0 && (
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
                          <span style={{ flexShrink: 0, background: "#c0392b", color: "#fff", fontSize: "8px", fontWeight: 900, padding: "2px 6px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "1px" }}>W</span>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "#c0392b", lineHeight: 1.4 }}>
                            {(Array.isArray(ev.weaknesses) ? ev.weaknesses : [ev.weaknesses]).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>No recent evaluations yet</div>
              )}
            </div>
          </div>

          {/* -- 2027 + 2028 Boards (CENTER on desktop, 1st on mobile) -- */}
          <div style={{ order: isMobile ? 1 : 0 }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: isMobile ? "24px" : "16px",
              alignItems: "start",
            }}>
              <div>
                <SectionTitle linkTo="/community" linkLabel="Full Board →">2027 Draft Board</SectionTitle>
                <TopDraftBoard isMobile={isMobile} year="2027" />
              </div>
              <div>
                <SectionTitle linkTo="/community/2028" linkLabel="Full Board →">2028 Draft Board</SectionTitle>
                <TopDraftBoard isMobile={isMobile} year="2028" />
              </div>
            </div>
          </div>

          {/* -- News (RIGHT on desktop, 3rd on mobile) -- */}
          <div style={{ order: isMobile ? 3 : 0 }}>
            <SectionTitle linkTo="/news" linkLabel="All News →">News</SectionTitle>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 14px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Latest</div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {combinedNews.length > 0 ? combinedNews.map((n, i) => {
                const ts = n.publishedAt || n.updatedAt;
                const dateStr = ts?.toDate?.().toLocaleDateString(undefined, { month: "short", day: "numeric" });
                const [mon, day] = dateStr ? dateStr.split(" ") : [null, null];
                return (
                  <Link key={n.id} to={`/news/${n.slug}`}
                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", textDecoration: "none", background: "#fff", borderBottom: i < combinedNews.length - 1 ? "1px solid #f0f0f0" : "none" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                  >
                    {mon && day && (
                      <div style={{ flexShrink: 0, width: "36px", background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "5px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        <div style={{ background: GOLD, lineHeight: 1, padding: "2px 0", textAlign: "center" }}>
                          <span style={{ fontSize: "9px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>{mon}</span>
                        </div>
                        <div style={{ padding: "3px 0", textAlign: "center" }}>
                          <span style={{ fontSize: "16px", fontWeight: 900, color: BLUE, lineHeight: 1, display: "block" }}>{day}</span>
                        </div>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: "2px" }}>
                        <span style={{ background: n.type === "article" ? GOLD : BLUE, color: "#fff", fontSize: "7px", fontWeight: 900, padding: "1px 5px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {n.type === "article" ? "Article" : "News"}
                        </span>
                      </div>
                      <div style={{ fontWeight: 900, fontSize: "11px", color: "#222", letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{n.title}</div>
                    </div>
                    <div style={{ flexShrink: 0, fontWeight: 900, fontSize: "12px", color: BLUE }}>→</div>
                  </Link>
                );
              }) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>No news yet</div>
              )}
            </div>
          </div>

        </div>

        {/* ===== SOCIAL LINKS ===== */}
        <div style={{ borderTop: `2px solid #eee`, paddingTop: "24px", textAlign: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "#aaa", marginBottom: "12px" }}>Follow Us</div>
          <div style={{ display: "flex", justifyContent: "center", gap: isMobile ? "20px" : "32px", flexWrap: "wrap" }}>
            {[
              { label: "Instagram", href: "https://www.instagram.com/wedraftsite" },
              { label: "X (Twitter)", href: "https://twitter.com/wedraftsite" },
              { label: "YouTube", href: "https://www.youtube.com/@kingcoldsports" },
            ].map(({ label, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                style={{ color: GOLD, fontWeight: 900, fontSize: isMobile ? "13px" : "16px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
                {label}
              </a>
            ))}
          </div>
        </div>

      </div>
    </>
  );
}