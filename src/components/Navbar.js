import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEffect, useState } from "react";
import Logo2 from "../assets/Logo2.png";

import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";

const FALLBACK_MESSAGE =
  "WELCOME TO WE-DRAFT.COM - CREATE DRAFT EVALUATIONS, VIEW COMMUNITY GRADES, DISCOVER HIDDEN GEMS, AND MORE - FOLLOW US ON INSTAGRAM AND X @WEDRAFTSITE FOR DAILY DRAFT CONTENT";

const conferenceOrder = [
  "ACC", "Big 10", "Big 12", "SEC", "Pac 12", "Independent",
  "AAC", "CUSA", "MAC", "Mountain West", "Sun Belt",
];

export default function Navbar() {
  const { user, login } = useAuth();

  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tickerText, setTickerText] = useState(FALLBACK_MESSAGE);
  const [schools, setSchools] = useState([]);
  const [cfbOpen, setCfbOpen] = useState(false);
  const [cfbTimeout, setCfbTimeout] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  /* ======================
     MOBILE DETECTION
  ====================== */
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  /* ======================
     SCROLL HIDE (DESKTOP)
  ====================== */
  useEffect(() => {
    if (isMobile) return;
    const handleScroll = () => {
      setShow(window.scrollY < lastScrollY);
      setLastScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY, isMobile]);

  /* ======================
     LOAD TICKER
  ====================== */
  useEffect(() => {
    const loadTicker = async () => {
      const parts = [];
      try {
        const newsQ = query(
          collection(db, "news"),
          where("active", "==", true),
          where("priority", "==", 1),
          orderBy("publishedAt", "desc")
        );
        const newsSnap = await getDocs(newsQ);
        newsSnap.forEach((d) => {
          if (d.data().title) parts.push(`NEWS: ${d.data().title.toUpperCase()}`);
        });
      } catch {}

      try {
        const featuredSnap = await getDoc(doc(db, "config", "featured"));
        if (featuredSnap.exists()) {
          const data = featuredSnap.data();
          if (Array.isArray(data.featured)) {
            parts.push("THIS WEEK'S FEATURED PLAYERS");
            data.featured.forEach((p) => {
              let line = `${p.first || ""} ${p.last || ""}`.trim().toUpperCase();
              if (p.position && p.school) line += `, ${p.position}, ${p.school.toUpperCase()}`;
              if (p.grade) line += ` | GRADE: ${p.grade.toUpperCase()}`;
              if (p.strengths?.length) line += ` | STRENGTHS: ${p.strengths.join(", ").toUpperCase()}`;
              if (p.weaknesses?.length) line += ` | WEAKNESSES: ${p.weaknesses.join(", ").toUpperCase()}`;
              if (p.nflFit) line += ` | NFL FIT: ${p.nflFit.toUpperCase()}`;
              if (line) parts.push(line);
            });
          }
        }
      } catch {}

      try {
        const draftQ = query(
          collection(db, "draftOrder"),
          where("Round", "<=", 2),
          orderBy("Round"),
          orderBy("Pick")
        );
        const draftSnap = await getDocs(draftQ);
        let currentRound = null;
        draftSnap.forEach((d) => {
          const p = d.data();
          if (p.Round !== currentRound) { currentRound = p.Round; parts.push(`ROUND ${currentRound}`); }
          parts.push(p.Selection ? `PICK ${p.Pick}: ${p.Team} ${p.Selection.toUpperCase()}` : `PICK ${p.Pick}: ${p.Team}`);
        });
      } catch {}

      if (parts.length > 0) setTickerText(FALLBACK_MESSAGE + "  •  " + parts.join("  •  "));
    };
    loadTicker();
  }, []);

  /* ======================
     LOAD SCHOOLS
  ====================== */
  useEffect(() => {
    async function fetchSchools() {
      try {
        const snapshot = await getDocs(collection(db, "schools"));
        const data = snapshot.docs.map((d) => d.data());
        const filtered = data.filter((s) => conferenceOrder.includes(s.Conference));
        filtered.sort((a, b) => a.School.localeCompare(b.School));
        setSchools(filtered);
      } catch (err) {
        console.error("Error loading schools:", err);
      }
    }
    fetchSchools();
  }, []);

  const grouped = conferenceOrder.reduce((acc, conf) => {
    acc[conf] = schools.filter((s) => s.Conference === conf);
    return acc;
  }, {});

  const filteredSchools = searchTerm.trim()
    ? schools.filter((s) => s.School.toLowerCase().includes(searchTerm.toLowerCase()))
    : null;

  const toSlug = (school) =>
    school.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\s]/g, "").trim().replace(/\s+/g, "-");

  /* ======================
     STYLES
  ====================== */
  const baseStyle = {
    margin: "0 0.35rem",
    padding: "0.45rem 0.9rem",
    color: "#0055a5",
    border: "2px solid #f6a21d",
    borderRadius: "6px",
    textDecoration: "none",
    fontWeight: "bold",
    backgroundColor: "#ffffff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "14px",
    whiteSpace: "nowrap",
  };

  return (
    <>
      <style>{`
        .cfb-team-link {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          text-decoration: none;
          color: #222;
          border-radius: 6px;
          font-weight: 700;
          font-size: 13px;
          transition: background 0.12s ease;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cfb-team-link:hover {
          background: #f0f5ff;
          color: #0055a5;
        }
        .mobile-nav-link {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 900;
          font-size: 15px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: #fff;
          color: #0055a5;
          border: 2px solid #f6a21d;
          transition: background 0.12s ease;
        }
        .mobile-nav-link:active {
          background: #f0f5ff;
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          top: show || isMobile ? 0 : "-140px",
          left: 0,
          right: 0,
          zIndex: 10000,
          transition: isMobile ? "none" : "top 0.3s ease-in-out",
        }}
      >
        {/* ================= NAVBAR ================= */}
        <nav
          style={{
            backgroundColor: "#0055a5",
            padding: "0.75rem 1.25rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
            zIndex: 10001,
          }}
        >
          {/* LOGO */}
          <Link to="/">
            <img src={Logo2} alt="We-Draft" style={{ height: 42 }} />
          </Link>

          {/* DESKTOP NAV */}
          <div
            className="hidden md:flex"
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              alignItems: "center",
            }}
          >
            {[
              { path: "/community", label: "Community Board" },
              { path: "/boards", label: "My Boards" },
              { path: "/mocks", label: "Mock Drafts" },
            ].map((l) => (
              <Link key={l.path} to={l.path} style={baseStyle}>{l.label}</Link>
            ))}

            {/* CFB DROPDOWN */}
            <div
              style={{ position: "relative" }}
              onMouseEnter={() => { if (cfbTimeout) clearTimeout(cfbTimeout); setCfbOpen(true); }}
              onMouseLeave={() => { const t = setTimeout(() => setCfbOpen(false), 150); setCfbTimeout(t); }}
            >
              <Link to="/cfb" style={baseStyle}>CFB</Link>

              {cfbOpen && (
                <div
                  onMouseEnter={() => { if (cfbTimeout) clearTimeout(cfbTimeout); setCfbOpen(true); }}
                  onMouseLeave={() => setCfbOpen(false)}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "580px",
                    maxHeight: "480px",
                    background: "#ffffff",
                    border: "2px solid #0055a5",
                    borderRadius: "10px",
                    boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
                    zIndex: 10002,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Dropdown header */}
                  <div style={{
                    backgroundColor: "#0055a5",
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    flexShrink: 0,
                  }}>
                    <div style={{ color: "#f6a21d", fontWeight: 900, fontSize: "13px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      College Football
                    </div>
                    {/* Search */}
                    <input
                      type="text"
                      placeholder="Search team..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{
                        flex: 1,
                        maxWidth: "200px",
                        padding: "5px 10px",
                        borderRadius: "6px",
                        border: "2px solid #f6a21d",
                        fontSize: "13px",
                        fontWeight: 700,
                        outline: "none",
                      }}
                      onClick={(e) => e.preventDefault()}
                    />
                    <Link
                      to="/cfb"
                      onClick={() => setCfbOpen(false)}
                      style={{ color: "rgba(255,255,255,0.8)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em", textDecoration: "underline", whiteSpace: "nowrap" }}
                    >
                      View All →
                    </Link>
                  </div>

                  {/* Accent bar */}
                  <div style={{ height: "3px", backgroundColor: "#f6a21d", flexShrink: 0 }} />

                  {/* Team list */}
                  <div style={{ overflowY: "auto", padding: "10px 12px", flex: 1 }}>
                    {filteredSchools ? (
                      // Search results flat list
                      filteredSchools.length > 0 ? (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" }}>
                          {filteredSchools.map((team) => (
                            <Link
                              key={team.School}
                              to={`/team/${toSlug(team.School)}`}
                              className="cfb-team-link"
                              onClick={() => { setCfbOpen(false); setSearchTerm(""); }}
                            >
                              {team.Logo1 && (
                                <img src={team.Logo1} alt={team.School} style={{ width: "20px", height: "20px", objectFit: "contain", flexShrink: 0 }}
                                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
                              )}
                              {team.School}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p style={{ color: "#999", fontSize: "13px", fontStyle: "italic", padding: "8px" }}>No teams found</p>
                      )
                    ) : (
                      // Grouped by conference
                      conferenceOrder.map((conf) => {
                        const teams = grouped[conf];
                        if (!teams || teams.length === 0) return null;
                        return (
                          <div key={conf} style={{ marginBottom: "12px" }}>
                            <div style={{
                              fontSize: "10px", fontWeight: 900, color: "#0055a5",
                              textTransform: "uppercase", letterSpacing: "0.12em",
                              borderBottom: "2px solid #0055a5", paddingBottom: "3px", marginBottom: "6px",
                            }}>
                              {conf}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" }}>
                              {teams.map((team) => (
                                <Link
                                  key={team.School}
                                  to={`/team/${toSlug(team.School)}`}
                                  className="cfb-team-link"
                                  onClick={() => setCfbOpen(false)}
                                >
                                  {team.Logo1 && (
                                    <img src={team.Logo1} alt={team.School} style={{ width: "18px", height: "18px", objectFit: "contain", flexShrink: 0 }}
                                      onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                  )}
                                  {team.School}
                                </Link>
                              ))}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {user ? (
              <Link to="/profile" style={baseStyle}>Profile</Link>
            ) : (
              <button onClick={login} style={baseStyle}>Sign In</button>
            )}
          </div>

          {/* MOBILE HAMBURGER */}
          <div className="md:hidden">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{ background: "none", border: "none", color: "#ffffff", fontSize: "2rem", cursor: "pointer", lineHeight: 1 }}
            >
              {menuOpen ? "✕" : "☰"}
            </button>
          </div>
        </nav>

        {/* MOBILE MENU */}
        {isMobile && menuOpen && (
          <div
            style={{
              backgroundColor: "#ffffff",
              borderTop: "3px solid #f6a21d",
              borderBottom: "3px solid #0055a5",
              boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              zIndex: 10001,
              position: "relative",
            }}
          >
            {[
              { path: "/community", label: "Community Board" },
              { path: "/boards", label: "My Boards" },
              { path: "/mocks", label: "Mock Drafts" },
              { path: "/cfb", label: "CFB Teams" },
            ].map((l) => (
              <Link
                key={l.path}
                to={l.path}
                className="mobile-nav-link"
                onClick={() => setMenuOpen(false)}
              >
                {l.label}
              </Link>
            ))}

            {user ? (
              <Link to="/profile" className="mobile-nav-link" onClick={() => setMenuOpen(false)}>
                Profile
              </Link>
            ) : (
              <button
                onClick={() => { login(); setMenuOpen(false); }}
                className="mobile-nav-link"
                style={{ border: "2px solid #f6a21d", cursor: "pointer" }}
              >
                Sign In
              </button>
            )}
          </div>
        )}

        {/* ================= TICKER ================= */}
        <div
          style={{
            background: "#ffffff",
            borderTop: "2px solid #f6a21d",
            borderBottom: "2px solid #f6a21d",
            overflow: "hidden",
            whiteSpace: "nowrap",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "0.55rem 0",
              fontWeight: 800,
              color: "#0055a5",
              animation: "tickerMove 300s linear infinite",
              willChange: "transform",
            }}
          >
            {tickerText}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes tickerMove {
          0%   { transform: translateX(15%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </>
  );
}