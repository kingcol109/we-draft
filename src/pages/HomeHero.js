// src/pages/HomeHero.js
//
// The Home page's top banner (logo, tagline, the Draft Sim front and
// center, then sign-up, quick-link tiles) plus its <Helmet> tags — shared by both designs. Home.js renders
// this immediately, before config/home has said which design is live, so
// the page has its header on the first paint instead of sitting blank for
// that read. Only the tiles below depend on the mode: in-season swaps in
// We-Pick for Watch / Past Drafts. Until the mode resolves, Home.js passes
// its best guess (last-seen mode, or off-season).
import { useEffect, useState } from "react";
import logo from "../assets/Logo2.png";
import { Link } from "react-router-dom";
import { SIM_YEAR } from "../utils/draftSim/years";
import { wePickHref } from "../utils/wePickRoutes";
import { useAuth } from "../context/AuthContext";
import { Helmet } from "react-helmet-async";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const SITE_TITLE = "We-Draft.com - NFL Draft Scouting Reports, Rankings & Mock Drafts";
const SITE_DESCRIPTION = "Build your NFL Draft board, read scouting reports, compare community evaluations, create mock drafts, and follow thousands of college football prospects with rankings, film links, measurable data, and the latest draft news.";
const SITE_URL = "https://we-draft.com/";

export default function HomeHero({ mode }) {
  const inSeason = mode === "inseason";
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const { user, login } = useAuth();

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Mobile quick-link chips (horizontal scroll row)
  const mobileChips = [
    { label: "Draft Sim", to: "/draftsim", icon: "⏱️", hot: true },
    { label: "Evaluate", to: "/community", icon: "📋" },
    { label: "Mock Drafts", to: "/mocks", icon: "🏈" },
    { label: "NFL Teams", to: "/nfl", icon: "🏟️" },
    { label: "Colleges", to: "/cfb", icon: "🎓" },
    { label: "News", to: "/news", icon: "📰" },
    inSeason
      ? { label: "We-Pick", to: wePickHref(), icon: "🔮" }
      : { label: "Past Drafts", to: "/community/2026", icon: "📜" },
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
        .mobile-chip.hot { background: ${GOLD}; border-color: #fff; }
        .wdh-sim-cta { transition: transform 0.15s, box-shadow 0.15s; }
        .wdh-sim-cta:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0,0,0,0.35); }
        .wdh-sim-tile { position: relative; }
      `}</style>

        {/* ===== HERO ===== */}
        <div className="wdh-hero" style={{
          display: "flex", alignItems: "stretch",
          marginBottom: isMobile ? "16px" : "28px",
          background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
          borderRadius: "12px", padding: isMobile ? "14px 14px 12px" : "18px 32px",
          border: `2px solid ${GOLD}`, gap: "28px",
          flexDirection: isMobile ? "column" : "row",
        }}>

          {/* ── Left chips: 2x2 grid (desktop only) ── */}
          {!isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "14px", flex: "1 1 0", minWidth: "240px", maxWidth: "420px", alignSelf: "stretch" }}>
              {[
                { label: "Evaluate Players", sub: "Grade every prospect", to: "/community", icon: "📋" },
                inSeason
                  ? { label: "We-Pick", sub: "Predict this week's games", to: wePickHref(), icon: "🔮" }
                  : { label: "Watch", sub: "Player Shorts, one after another", to: "/watch", icon: "▶" },
                { label: "Mock Draft Simulator", sub: "Make every pick, live", to: "/draftsim", icon: "⏱️", hot: true },
                { label: "Draft News", sub: "Latest prospect analysis", to: "/news", icon: "📰" },
              ].map(({ label, sub, to, icon, hot }) => (
                <Link key={label} to={to} className={`wdh-tile${hot ? " wdh-sim-tile" : ""}`} style={{
                  display: "flex", flexDirection: "column", gap: "8px",
                  background: hot ? "rgba(246,162,29,0.22)" : "rgba(255,255,255,0.1)", border: hot ? `2px solid ${GOLD}` : "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "12px", padding: "18px 18px", textDecoration: "none",
                  transition: "background 0.15s", height: "100%", boxSizing: "border-box",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = hot ? "rgba(246,162,29,0.34)" : "rgba(255,255,255,0.18)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = hot ? "rgba(246,162,29,0.22)" : "rgba(255,255,255,0.1)"; }}
                >
                  {hot && <span style={{ position: "absolute", top: "10px", right: "10px", background: "#c8102e", color: "#fff", borderRadius: "5px", padding: "2px 7px", fontSize: "10px", fontWeight: 900, letterSpacing: "0.1em" }}>NEW</span>}
                  <span style={{ fontSize: "26px", lineHeight: 1 }}>{icon}</span>
                  <span style={{ fontWeight: 900, fontSize: "13px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.25 }}>{label}</span>
                  <span style={{ fontWeight: 700, fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.35 }}>{sub}</span>
                </Link>
              ))}
            </div>
          )}

          {/* ── Center ── */}
          <div style={{ flex: "1.3 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <img
              src={logo}
              alt="We-Draft.com"
              style={{ width: isMobile ? "220px" : "660px", maxWidth: "min(100%, 90vw)", height: "auto", marginBottom: isMobile ? "10px" : "16px" }}
            />

            <div style={{ fontSize: isMobile ? "18px" : "32px", fontWeight: 900, letterSpacing: "0.04em", lineHeight: 1.1, marginBottom: "8px" }}>
              <span style={{ color: "#fff" }}>FOOTBALL. </span>
              <span style={{ color: GOLD }}>YOUR WAY.</span>
            </div>

            <div style={{ fontSize: isMobile ? "12px" : "15px", fontWeight: 700, color: "#fff", lineHeight: 1.65, marginBottom: "16px", maxWidth: "540px" }}>
              Run the {SIM_YEAR} NFL Draft live in the Mock Draft Simulator, build your own board, and compare your rankings with the We-Draft community.
            </div>

            {/* The Draft Sim, front and center. */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", width: isMobile ? "100%" : "auto", marginBottom: "14px" }}>
              <Link to="/draftsim" className="wdh-cta wdh-sim-cta" style={{
                display: "block", boxSizing: "border-box", width: isMobile ? "100%" : "auto",
                backgroundColor: GOLD, color: "#fff", border: "2px solid #fff", borderRadius: "10px",
                padding: isMobile ? "13px 20px" : "16px 38px", textDecoration: "none", textAlign: "center",
                fontWeight: 900, fontSize: isMobile ? "15px" : "19px", textTransform: "uppercase", letterSpacing: "0.06em",
                boxShadow: "0 8px 22px rgba(0,0,0,0.28)", WebkitTapHighlightColor: "transparent",
              }}>
                Run the {SIM_YEAR} Mock Draft Simulator →
              </Link>
            </div>

            {!user ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                <button onClick={login} className="wdh-cta" style={{
                  backgroundColor: "transparent", color: "#fff",
                  border: `2px solid ${GOLD}`, borderRadius: "8px",
                  padding: isMobile ? "9px 18px" : "10px 24px",
                  fontWeight: 900, fontSize: isMobile ? "12px" : "14px",
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
                {mobileChips.map(({ label, to, icon, hot }) => (
                  <Link key={label} to={to} className={`mobile-chip${hot ? " hot" : ""}`}>
                    <span style={{ fontSize: "20px", lineHeight: 1 }}>{icon}</span>
                    <span style={{ fontWeight: 900, fontSize: "10px", color: hot ? "#111" : "#fff", textTransform: "uppercase", letterSpacing: "0.04em", textAlign: "center", lineHeight: 1.2 }}>{label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* ── Right chips: 2x2 grid (desktop only) ── */}
          {!isMobile && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "14px", flex: "1 1 0", minWidth: "240px", maxWidth: "420px", alignSelf: "stretch" }}>

              <Link to="/nfl" className="wdh-tile" style={{
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

              <Link to="/cfb" className="wdh-tile" style={{
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

              <div className="wdh-tile" style={{
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

              <Link to={inSeason ? wePickHref() : "/community/2026"} className="wdh-tile" style={{
                display: "flex", flexDirection: "column", gap: "8px",
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "12px", padding: "18px 18px", textDecoration: "none",
                transition: "background 0.15s", height: "100%", boxSizing: "border-box",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
              >
                <span style={{ fontSize: "26px", lineHeight: 1 }}>{inSeason ? "🔮" : "📜"}</span>
                <span style={{ fontWeight: 900, fontSize: "13px", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.25 }}>{inSeason ? "We-Pick" : "View Past Drafts"}</span>
                <span style={{ fontWeight: 700, fontSize: "11px", color: "rgba(255,255,255,0.6)", lineHeight: 1.35 }}>{inSeason ? "Predict every game" : "2026 class results"}</span>
              </Link>

            </div>
          )}

        </div>
    </>
  );
}
