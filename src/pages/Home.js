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

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

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

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

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

function Top2027Board({ isMobile }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const snap = await getDocs(collection(db, "players"));
        const all = await Promise.all(
          snap.docs.map(async (docSnap) => {
            const p = { id: docSnap.id, ...docSnap.data() };
            if (p.Eligible?.toString() !== "2027") return null;
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
        console.error("Error fetching 2027 players:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, []);

  if (loading) return (
    <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>Loading...</div>
  );

  const rankColors = [
    { num: "#fff", bg: "linear-gradient(135deg, #c9a227 0%, #f6d675 50%, #c9a227 100%)", shadow: "0 4px 20px rgba(198,160,39,0.5)", border: "2px solid #a8841e" },
    { num: "#fff", bg: "linear-gradient(135deg, #8a9ba8 0%, #c8d6df 50%, #8a9ba8 100%)", shadow: "0 4px 14px rgba(138,155,168,0.45)", border: "2px solid #6b7f8c" },
    { num: "#fff", bg: "linear-gradient(135deg, #a0674a 0%, #d4956e 50%, #a0674a 100%)", shadow: "0 4px 14px rgba(160,103,74,0.45)", border: "2px solid #7a4e37" },
  ];

  if (players.length === 0) return (
    <div style={{ borderRadius: "14px", overflow: "hidden", background: `linear-gradient(160deg, ${BLUE} 0%, #003a7a 100%)`, padding: "40px 24px", textAlign: "center" }}>
      <div style={{ fontSize: "32px", marginBottom: "10px" }}>🏈</div>
      <div style={{ color: GOLD, fontWeight: 900, fontSize: "18px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>The 2027 Class Awaits</div>
      <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px", fontWeight: 700, marginBottom: "20px" }}>Be the first to evaluate the next generation of NFL talent</div>
      <Link to="/community" style={{ display: "inline-block", backgroundColor: GOLD, color: BLUE, borderRadius: "8px", padding: "10px 28px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.08em", textDecoration: "none" }}>
        Start Evaluating →
      </Link>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-18px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .prospect-row {
          transition: background 0.15s, transform 0.15s;
          cursor: pointer;
        }
        .prospect-row:hover {
          background: linear-gradient(90deg, #e8f0fa 0%, #f5f8ff 100%) !important;
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
          padding: isMobile ? "16px 16px 14px" : "20px 24px 18px",
          position: "relative", overflow: "hidden",
        }}>
          {/* decorative diagonal stripes */}
          <div style={{ position: "absolute", top: 0, right: 0, width: "200px", height: "100%", background: "repeating-linear-gradient(60deg, transparent, transparent 12px, rgba(246,162,29,0.07) 12px, rgba(246,162,29,0.07) 24px)", pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: isMobile ? "9px" : "10px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "4px" }}>
                  🏈 Community Rankings
                </div>
                <div style={{ fontSize: isMobile ? "22px" : "30px", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.01em" }}>
                  2027 NFL Draft
                </div>
                <div style={{ fontSize: isMobile ? "13px" : "16px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2px" }}>
                  Top Prospects
                </div>
              </div>
              <Link to="/community" style={{
                background: GOLD, color: BLUE, fontWeight: 900,
                fontSize: isMobile ? "11px" : "12px", padding: "8px 16px",
                borderRadius: "20px", textDecoration: "none", textTransform: "uppercase",
                letterSpacing: "0.06em", flexShrink: 0, marginTop: "4px",
                boxShadow: "0 2px 10px rgba(246,162,29,0.4)",
              }}>
                Full Board →
              </Link>
            </div>
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
                  padding: isMobile ? "11px 14px" : isTop3 ? "16px 20px" : "13px 20px",
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
                  width: isMobile ? (isTop3 ? "36px" : "28px") : (isTop3 ? "46px" : "36px"),
                  height: isMobile ? (isTop3 ? "36px" : "28px") : (isTop3 ? "46px" : "36px"),
                  borderRadius: isTop3 ? "10px" : "8px",
                  background: rank ? rank.bg : "#f0f0f0",
                  border: rank ? rank.border : "2px solid #ddd",
                  boxShadow: rank ? rank.shadow : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginRight: isMobile ? "12px" : "16px",
                  flexDirection: "column",
                }}>
                  <span style={{
                    fontSize: isTop3 ? (isMobile ? "15px" : "20px") : (isMobile ? "12px" : "15px"),
                    fontWeight: 900, color: rank ? rank.num : "#bbb",
                    lineHeight: 1, textShadow: isTop3 ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
                  }}>
                    {i + 1}
                  </span>
                </div>

                {/* Player info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="prospect-name"
                    style={{
                      color: BLUE, fontWeight: 900,
                      fontSize: isTop3 ? (isMobile ? "16px" : "20px") : (isMobile ? "14px" : "16px"),
                      lineHeight: 1.2,
                    }}
                  >
                    {`${p.First || ""} ${p.Last || ""}`}
                  </div>
                  <div style={{
                    fontSize: isMobile ? "11px" : "12px", fontWeight: 700,
                    color: isTop3 ? "#444" : "#888", marginTop: "2px",
                    display: "flex", alignItems: "center", gap: "6px",
                  }}>
                    {p.Position && (
                      <span style={{
                        background: BLUE, color: "#fff", fontSize: "9px",
                        fontWeight: 900, padding: "1px 6px", borderRadius: "3px",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                      }}>
                        {p.Position}
                      </span>
                    )}
                    <span>{p.School || "—"}</span>
                  </div>
                </div>

                {/* Grade badge + arrow */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "10px" }}>
                  {p.commGrade && <GradeBadge grade={p.commGrade} />}
                  <span style={{ color: "#ccc", fontSize: "16px", fontWeight: 900 }}>›</span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div style={{
          background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
          padding: isMobile ? "14px" : "18px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: "10px",
        }}>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: isMobile ? "11px" : "12px", fontWeight: 700 }}>
            Rankings based on community evaluations
          </div>
          <Link
            to="/community"
            style={{
              background: GOLD, color: BLUE, fontWeight: 900,
              fontSize: isMobile ? "12px" : "13px", padding: isMobile ? "9px 20px" : "11px 28px",
              borderRadius: "8px", textDecoration: "none",
              textTransform: "uppercase", letterSpacing: "0.08em",
              boxShadow: "0 3px 14px rgba(246,162,29,0.45)",
            }}
          >
            View Full 2027 Board →
          </Link>
        </div>
      </div>
    </>
  );
}

function Top2026Results({ isMobile }) {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPicks = async () => {
      try {
        const snap = await getDocs(collection(db, "draftOrder"));
        const all = snap.docs
          .map((d) => ({ docId: d.id, ...d.data() }))
          .filter((p) => p.Selection && p.Selection.trim() !== "")
          .sort((a, b) => a.Round !== b.Round ? a.Round - b.Round : a.Pick - b.Pick)
          .slice(0, 10);

        const enriched = await Promise.all(
          all.map(async (pick) => {
            let player = null;
            let teamData = null;
            try {
              const q = query(collection(db, "players"), where("Slug", "==", pick.Selection), limit(1));
              const playerSnap = await getDocs(q);
              if (!playerSnap.empty) player = { id: playerSnap.docs[0].id, ...playerSnap.docs[0].data() };
            } catch {}
            try {
              const teamSnap = await getDoc(doc(db, "nfl", pick.Team));
              if (teamSnap.exists()) teamData = teamSnap.data();
            } catch {}
            return { ...pick, player, teamData };
          })
        );
        setPicks(enriched);
      } catch (err) {
        console.error("Error fetching picks:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPicks();
  }, []);

  if (loading) return (
    <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>Loading...</div>
  );
  if (picks.length === 0) return null;

  return (
    <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
      <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Top 10 Picks</div>
        <Link to="/draft" style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em", textDecoration: "underline" }}>
          Full Board →
        </Link>
      </div>
      <div style={{ height: "3px", background: GOLD }} />

      {picks.map((pick, i) => {
        const c1 = pick.teamData?.Color1 || BLUE;
        const c2 = pick.teamData?.Color2 || GOLD;
        const teamLogo = pick.teamData?.Logo1 || null;
        const teamName = pick.teamData?.Name || pick.Team;
        return (
          <div key={pick.docId} style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: i < picks.length - 1 ? "1px solid #f0f0f0" : "none", background: "#fff" }}>
            <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: "6px", background: c1, border: `2px solid ${c2}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginRight: "8px" }}>
              <div style={{ fontSize: "7px", fontWeight: 800, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>#{pick.Pick}</div>
              {teamLogo ? (
                <img src={sanitizeUrl(teamLogo)} alt={teamName} style={{ width: "18px", height: "18px", objectFit: "contain", marginTop: "1px" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : (
                <div style={{ fontSize: "7px", fontWeight: 900, color: "#fff" }}>{pick.Team}</div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/player/${pick.Selection}`} style={{ color: BLUE, fontWeight: 900, fontSize: "13px", textDecoration: "none", lineHeight: 1.2, display: "block" }}
                onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
                {pick.player ? `${pick.player.First || ""} ${pick.player.Last || ""}` : pick.Selection}
              </Link>
              {pick.player && (
                <div style={{ fontSize: "10px", fontWeight: 700, color: "#555" }}>
                  {pick.player.Position} · {pick.player.School}
                </div>
              )}
              <div style={{ fontSize: "10px", fontWeight: 800, color: c1, textTransform: "uppercase", letterSpacing: "0.03em" }}>{teamName}</div>
            </div>
          </div>
        );
      })}

      <div style={{ textAlign: "center", padding: "10px" }}>
        <Link to="/draft" style={{ display: "inline-block", backgroundColor: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "6px", padding: "7px 18px", fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", textDecoration: "none" }}>
          Full 2026 Results →
        </Link>
      </div>
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

      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "20px 16px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== HERO ===== */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: isMobile ? "20px" : "28px" }}>
          <img src={logo} alt="We-Draft" style={{ width: isMobile ? "280px" : "520px", maxWidth: "95vw", height: "auto", marginBottom: "12px" }} />
          {!user ? (
            <button onClick={login} style={{ backgroundColor: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: isMobile ? "10px 20px" : "12px 28px", fontWeight: 900, fontSize: isMobile ? "13px" : "15px", textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer" }}>
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

        {/* ===== MAIN 3-COL: NEWS | 2027 BOARD | EVALS ===== */}
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr 1fr",
          gap: isMobile ? "28px" : "20px",
          marginBottom: isMobile ? "28px" : "40px",
          alignItems: "start",
        }}>

          {/* -- News -- */}
          <div>
            <SectionTitle linkTo="/news" linkLabel="All News →">News</SectionTitle>
            <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ background: BLUE, padding: "8px 14px" }}>
                <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Latest</div>
              </div>
              <div style={{ height: "3px", background: GOLD }} />
              {combinedNews.length > 0 ? combinedNews.map((n, i) => {
                const ts = n.publishedAt || n.updatedAt;
                const dateStr = ts?.toDate?.().toLocaleDateString(undefined, { month: "short", day: "numeric" });
                return (
                  <Link key={n.id} to={`/news/${n.slug}`}
                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", textDecoration: "none", background: "#fff", borderBottom: i < combinedNews.length - 1 ? "1px solid #f0f0f0" : "none" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                  >
                    {dateStr && (
                      <div style={{ flexShrink: 0, width: "32px", height: "32px", background: BLUE, border: `2px solid ${GOLD}`, borderRadius: "5px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", lineHeight: 1 }}>
                        <span style={{ fontSize: "11px", fontWeight: 900 }}>{dateStr.split(" ")[1]}</span>
                        <span style={{ fontSize: "6px", fontWeight: 800, opacity: 0.8, textTransform: "uppercase" }}>{dateStr.split(" ")[0]}</span>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ marginBottom: "2px" }}>
                        <span style={{ background: n.type === "article" ? GOLD : BLUE, color: "#fff", fontSize: "7px", fontWeight: 900, padding: "1px 5px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {n.type === "article" ? "Article" : "News"}
                        </span>
                      </div>
                      <div style={{ fontWeight: 900, fontSize: "11px", color: "#222", letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1.3 }}>{n.title}</div>
                    </div>
                    <div style={{ flexShrink: 0, fontWeight: 900, fontSize: "12px", color: BLUE }}>→</div>
                  </Link>
                );
              }) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>No news yet</div>
              )}
            </div>
          </div>

          {/* -- 2027 Board (center, wider) -- */}
          <div>
            <SectionTitle linkTo="/community" linkLabel="Full Board →">2027 NFL Draft Board</SectionTitle>
            <Top2027Board isMobile={isMobile} />
          </div>

          {/* -- Recent Evaluations -- */}
          <div>
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
                  {/* Header: username on player */}
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 900, fontSize: "10px", color: BLUE, textTransform: "uppercase", letterSpacing: "0.04em" }}>{ev.username}</span>
                    {ev.verified && <img src={verifiedBadge} alt="Verified" style={{ width: "11px", height: "11px" }} />}
                    <span style={{ color: "#ccc", fontSize: "10px" }}>on</span>
                    <Link to={`/player/${ev.playerSlug}`} style={{ fontWeight: 900, fontSize: "10px", color: BLUE, textDecoration: "underline", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {ev.playerName}
                    </Link>
                  </div>
                  {/* Grade + evaluation text */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
                    {ev.grade && gradeDisplay(ev.grade) && <GradeBadge grade={ev.grade} />}
                    {ev.evaluation && (
                      <p style={{ fontStyle: "italic", fontSize: "11px", color: "#444", lineHeight: 1.5, margin: 0 }}>
                        "{ev.evaluation.length > 180 ? ev.evaluation.slice(0, 180) + "..." : ev.evaluation}"
                      </p>
                    )}
                  </div>
                  {/* Strengths + Weaknesses */}
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

        </div>

        {/* ===== 2026 DRAFT RESULTS — SLIM BELOW ===== */}
        <div style={{ marginBottom: isMobile ? "28px" : "40px" }}>
          <SectionTitle linkTo="/draft" linkLabel="Full Results →">2026 Draft Results</SectionTitle>
          <Top2026Results isMobile={isMobile} />
        </div>

        {/* ===== SOCIAL LINKS ===== */}
        <div style={{ borderTop: `2px solid #eee`, paddingTop: "24px", textAlign: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "#aaa", marginBottom: "12px" }}>Follow Us</div>
          <div style={{ display: "flex", justifyContent: "center", gap: isMobile ? "16px" : "32px", flexWrap: "wrap" }}>
            {[
              { label: "Instagram", href: "https://www.instagram.com/wedraftsite" },
              { label: "X (Twitter)", href: "https://twitter.com/wedraftsite" },
              { label: "YouTube", href: "https://www.youtube.com/@kingcoldsports" },
            ].map(({ label, href }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                style={{ color: GOLD, fontWeight: 900, fontSize: isMobile ? "14px" : "16px", textDecoration: "none", textTransform: "uppercase", letterSpacing: "0.06em" }}
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