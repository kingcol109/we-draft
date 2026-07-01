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

/* =========================
   SUPPLEMENTAL DRAFT SPOTLIGHT
   Fetches players with Eligible === "2026s"
   Displayed as a breaking news banner above the main grid
   ========================= */
function SupplementalDraftSpotlight({ isMobile }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlayers = async () => {
      try {
        const snap = await getDocs(collection(db, "players"));
        const suppPlayers = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.Eligible?.toString() === "2026s" && p.Live !== false && p.Live !== null && p.Live !== 0 && p.Live !== "false" && p.Live !== "no");
        setPlayers(suppPlayers);
      } catch (err) {
        console.error("Error fetching supplemental players:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchPlayers();
  }, []);

  if (loading || players.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes suppPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @keyframes suppSlideIn {
          from { opacity: 0; transform: translateY(-12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .supp-player-row {
          transition: background 0.15s, transform 0.15s;
        }
        .supp-player-row:hover {
          background: #fff8e8 !important;
          transform: translateX(4px);
        }
        .supp-player-row:hover .supp-player-name {
          text-decoration: underline;
        }
      `}</style>

      <div style={{
        marginBottom: isMobile ? "24px" : "32px",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: `0 6px 32px rgba(180,30,30,0.18), 0 2px 8px rgba(246,162,29,0.15)`,
        border: `2px solid #c0392b`,
        animation: "suppSlideIn 0.4s ease both",
      }}>

        {/* Breaking banner ticker */}
        <div style={{
          background: "#c0392b",
          padding: "5px 16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          overflow: "hidden",
        }}>
          <span style={{
            flexShrink: 0,
            background: "#fff",
            color: "#c0392b",
            fontSize: "9px",
            fontWeight: 900,
            padding: "2px 8px",
            borderRadius: "3px",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            animation: "suppPulse 1.4s ease-in-out infinite",
          }}>
            ● Breaking
          </span>
          <span style={{
            color: "rgba(255,255,255,0.9)",
            fontSize: "11px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            whiteSpace: "nowrap",
          }}>
            2026 NFL Supplemental Draft — New prospect{players.length > 1 ? "s" : ""} eligible
          </span>
        </div>

        {/* Main header */}
        <div style={{
          background: `linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)`,
          padding: isMobile ? "16px 16px 14px" : "20px 28px 18px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Diagonal stripe decoration */}
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            background: "repeating-linear-gradient(55deg, transparent, transparent 18px, rgba(192,57,43,0.08) 18px, rgba(192,57,43,0.08) 36px)",
            pointerEvents: "none",
          }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <div style={{ fontSize: isMobile ? "9px" : "10px", fontWeight: 900, color: "#e74c3c", textTransform: "uppercase", letterSpacing: "0.22em", marginBottom: "5px" }}>
                ⚡ 2026 NFL Draft — Supplemental Class
              </div>
              <div style={{ fontSize: isMobile ? "24px" : "34px", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>
                Supplemental Draft
              </div>
              <div style={{ fontSize: isMobile ? "13px" : "17px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: "3px" }}>
                Brendan Sorsby Plans to Enter the Supplemental Draft
              </div>
            </div>
            <div style={{
              background: "linear-gradient(135deg, #c0392b 0%, #e74c3c 100%)",
              border: "2px solid rgba(255,255,255,0.2)",
              borderRadius: "10px",
              padding: isMobile ? "10px 16px" : "12px 20px",
              textAlign: "center",
              flexShrink: 0,
            }}>
              <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: "2px" }}>Eligible</div>
              <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{players.length}</div>
              <div style={{ fontSize: "9px", fontWeight: 900, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: "2px" }}>
                Prospect{players.length > 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>

        {/* Gold divider */}
        <div style={{ height: "4px", background: `linear-gradient(90deg, #c0392b, ${GOLD}, #c0392b)` }} />

        {/* Player rows */}
        <div style={{ background: "#fff" }}>
          {players.map((p, i) => {
            const gradeVal = p.Grade || null;
            const gd = gradeVal ? gradeDisplay(gradeVal) : null;
            return (
              <Link
                key={p.id}
                to={`/player/${p.Slug}`}
                className="supp-player-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: isMobile ? "14px 16px" : "18px 28px",
                  borderBottom: i < players.length - 1 ? "1px solid #fce8e6" : "none",
                  background: "#fff",
                  textDecoration: "none",
                  gap: "16px",
                }}
              >
                {/* Supp badge */}
                <div style={{
                  flexShrink: 0,
                  width: isMobile ? "46px" : "56px",
                  height: isMobile ? "46px" : "56px",
                  borderRadius: "10px",
                  background: `linear-gradient(135deg, #c0392b 0%, #e74c3c 100%)`,
                  border: `2px solid #922b21`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 3px 10px rgba(192,57,43,0.35)",
                }}>
                  <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.1em", lineHeight: 1 }}>SUPP</span>
                  <span style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>'26</span>
                </div>

                {/* Player info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="supp-player-name"
                    style={{ fontWeight: 900, fontSize: isMobile ? "20px" : "26px", color: BLUE, lineHeight: 1.1, letterSpacing: "-0.01em" }}
                  >
                    {`${p.First || ""} ${p.Last || ""}`}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                    {p.Position && (
                      <span style={{ background: BLUE, color: "#fff", fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {p.Position}
                      </span>
                    )}
                    {p.School && (
                      <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: "#444" }}>{p.School}</span>
                    )}
                    <span style={{
                      background: "#fef9e7",
                      border: "1px solid #f6a21d",
                      color: "#7a4a00",
                      fontSize: "9px",
                      fontWeight: 900,
                      padding: "2px 8px",
                      borderRadius: "20px",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}>
                      Supplemental Eligible
                    </span>
                  </div>
                </div>

                {/* Grade + arrow */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                  {gradeVal && gd && <GradeBadge grade={gradeVal} />}
                  <span style={{ color: "#c0392b", fontSize: "22px", fontWeight: 900 }}>›</span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          background: `linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)`,
          padding: isMobile ? "10px 16px" : "12px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
        }}>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "11px", fontWeight: 700 }}>
            Supplemental draft prospects are outside the regular 2026 class
          </div>
          <Link to="/draft" style={{
            color: GOLD,
            fontWeight: 900,
            fontSize: "11px",
            textDecoration: "underline",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}>
            2026 Draft Board →
          </Link>
        </div>
      </div>
    </>
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
            if (p.Live === false || p.Live === null || p.Live === 0 || p.Live === "false" || p.Live === "no") return null; // skip non-live players
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

  // ── Recent Evaluations: only pulls from players that are live (Live !== false) ──
  // Non-live players (added but not yet ready for the boards) are skipped entirely here,
  // so their evaluations — if any — never surface in this public homepage feed.
  useEffect(() => {
    const fetch = async () => {
      try {
        const playersSnap = await getDocs(collection(db, "players"));
        const evalPromises = [];
        playersSnap.forEach((playerDoc) => {
          const pd = playerDoc.data();
          if (pd.Live === false || pd.Live === null || pd.Live === 0 || pd.Live === "false" || pd.Live === "no") return; // skip non-live players
          const q = query(collection(db, "players", playerDoc.id, "evaluations"), orderBy("updatedAt", "desc"), limit(2));
          evalPromises.push(
            getDocs(q).then((snap) =>
              snap.docs.map((d) => {
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
    .sort((a, b) => ((b.publishedAt?.seconds || b.updatedAt?.seconds || 0) - (a.publishedAt?.seconds || a.updatedAt?.seconds || 0)))
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

        {/* ===== SUPPLEMENTAL DRAFT SPOTLIGHT ===== */}
        <SupplementalDraftSpotlight isMobile={isMobile} />

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
                      <div style={{ flexShrink: 0, width: "38px", background: "#fff", border: `2px solid ${BLUE}`, borderRadius: "5px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                        <div style={{ background: GOLD, lineHeight: 1, padding: "1px 0", textAlign: "center" }}>
                          <span style={{ fontSize: "10px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>{dateStr.split(" ")[0]}</span>
                        </div>
                        <div style={{ padding: "3px 0 3px", textAlign: "center" }}>
                          <span style={{ fontSize: "17px", fontWeight: 900, color: BLUE, lineHeight: 1, display: "block" }}>{dateStr.split(" ")[1]}</span>
                        </div>
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