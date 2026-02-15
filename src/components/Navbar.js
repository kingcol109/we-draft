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

/* ======================
   ALWAYS-FIRST MESSAGE
====================== */
const FALLBACK_MESSAGE =
  "WELCOME TO WE-DRAFT.COM - CREATE DRAFT EVALUATIONS, VIEW COMMUNITY GRADES, DISCOVER HIDDEN GEMS, AND MORE - FOLLOW US ON INSTAGRAM AND X @WEDRAFTSITE FOR DAILY DRAFT CONTENT";

export default function Navbar() {
  const { user, login } = useAuth();

  const [show, setShow] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Start instantly with fallback
  const [tickerText, setTickerText] = useState(FALLBACK_MESSAGE);

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
     LOAD TICKER CONTENT
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
          if (d.data().title) {
            parts.push(`NEWS: ${d.data().title.toUpperCase()}`);
          }
        });
      } catch {}

      try {
        const featuredSnap = await getDoc(doc(db, "config", "featured"));
        if (featuredSnap.exists()) {
          const data = featuredSnap.data();

          if (Array.isArray(data.featured)) {
            parts.push("THIS WEEK'S FEATURED PLAYERS");

            data.featured.forEach((p) => {
  let line = `${p.first || ""} ${p.last || ""}`
    .trim()
    .toUpperCase();

  if (p.position && p.school) {
    line += `, ${p.position}, ${p.school.toUpperCase()}`;
  }

  if (p.strengths?.length) {
    line += ` | STRENGTHS: ${p.strengths.join(", ").toUpperCase()}`;
  }

  if (p.weaknesses?.length) {
    line += ` | WEAKNESSES: ${p.weaknesses.join(", ").toUpperCase()}`;
  }

  if (p.nflFit) {
    line += ` | NFL FIT: ${p.nflFit.toUpperCase()}`;
  }

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

          if (p.Round !== currentRound) {
            currentRound = p.Round;
            parts.push(`ROUND ${currentRound}`);
          }

          if (p.Selection) {
            parts.push(
              `PICK ${p.Pick}: ${p.Team} ${p.Selection.toUpperCase()}`
            );
          } else {
            parts.push(`PICK ${p.Pick}: ${p.Team}`);
          }
        });
      } catch {}

      if (parts.length > 0) {
        setTickerText(FALLBACK_MESSAGE + "  •  " + parts.join("  •  "));
      }
    };

    loadTicker();
  }, []);

  /* ======================
     NAV LINK STYLE
  ====================== */
  const baseStyle = {
    margin: "0 0.5rem",
    padding: "0.5rem 1rem",
    color: "#0055a5",
    border: "2px solid #f6a21d",
    borderRadius: "6px",
    textDecoration: "none",
    fontWeight: "bold",
    backgroundColor: "#ffffff",
    cursor: "pointer",
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: show || isMobile ? 0 : "-140px",
          left: 0,
          right: 0,
          zIndex: 1000,
          transition: isMobile ? "none" : "top 0.3s ease-in-out",
        }}
      >
        {/* ================= NAVBAR ================= */}
        <nav
          style={{
            backgroundColor: "#0055a5",
            padding: "0.75rem 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            position: "relative",
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
            }}
          >
            {[
              { path: "/", label: "Home" },
              { path: "/community", label: "Community Board" },
              { path: "/boards", label: "My Boards" },
              { path: "/mocks", label: "Mock Drafts" },
            ].map((l) => (
              <Link key={l.path} to={l.path} style={baseStyle}>
                {l.label}
              </Link>
            ))}

            {user ? (
              <Link to="/profile" style={baseStyle}>
                Profile
              </Link>
            ) : (
              <button onClick={login} style={baseStyle}>
                Sign In
              </button>
            )}
          </div>

          {/* MOBILE HAMBURGER */}
          <div className="md:hidden">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{
                background: "none",
                border: "none",
                color: "#ffffff",
                fontSize: "2rem",
                cursor: "pointer",
              }}
            >
              ☰
            </button>

            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  backgroundColor: "#ffffff",
                  borderTop: "2px solid #f6a21d",
                  boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  textAlign: "center",
                  zIndex: 2000,
                }}
              >
                {[
                  { path: "/", label: "Home" },
                  { path: "/community", label: "Community Board" },
                  { path: "/boards", label: "My Boards" },
                  { path: "/mocks", label: "Mock Drafts" },
                ].map((l) => (
                  <Link
                    key={l.path}
                    to={l.path}
                    style={{ ...baseStyle, width: "100%" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    {l.label}
                  </Link>
                ))}

                {!user && (
                  <button
                    onClick={() => {
                      login();
                      setMenuOpen(false);
                    }}
                    style={{ ...baseStyle, width: "100%" }}
                  >
                    Sign In
                  </button>
                )}
              </div>
            )}
          </div>
        </nav>

        {/* ================= TICKER ================= */}
        <div
          style={{
            background: "#ffffff",
            borderTop: "2px solid #f6a21d",
            borderBottom: "2px solid #f6a21d",
            overflow: "hidden",
            whiteSpace: "nowrap",
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

      {/* KEYFRAMES */}
      <style>
        {`
          @keyframes tickerMove {
            0% { transform: translateX(15%); }
            100% { transform: translateX(-100%); }
          }
        `}
      </style>
    </>
  );
}
