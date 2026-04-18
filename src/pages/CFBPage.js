import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

export default function CFBPage() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  const conferenceOrder = [
    "ACC",
    "Big 10",
    "Big 12",
    "SEC",
    "Pac 12",
    "Independent",
    "AAC",
    "CUSA",
    "MAC",
    "Mountain West",
    "Sun Belt",
  ];

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    async function fetchSchools() {
      try {
        const snapshot = await getDocs(collection(db, "schools"));
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const filtered = data.filter((school) =>
          conferenceOrder.includes(school.Conference)
        );
        setSchools(filtered);
      } catch (err) {
        console.error("Error fetching schools:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSchools();
  }, []);

  const grouped = conferenceOrder.reduce((acc, conf) => {
    acc[conf] = schools
      .filter((s) => s.Conference === conf)
      .sort((a, b) => a.School.localeCompare(b.School));
    return acc;
  }, {});

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontSize: 20,
          fontWeight: 900,
          color: SITE_BLUE,
          fontFamily: "'Arial Black', Arial, sans-serif",
        }}
      >
        Loading Teams...
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: isMobile ? "12px 12px 60px" : "24px 24px 60px",
        fontFamily: "'Arial Black', Arial, sans-serif",
      }}
    >
      <style>{`
        .team-card {
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .team-card:hover {
          transform: translateY(-5px) scale(1.04);
          box-shadow: 0 8px 20px rgba(0,0,0,0.15);
          opacity: 1 !important;
        }
        .team-card:hover .team-logo {
          transform: scale(1.12);
        }
        .team-logo {
          transition: transform 0.18s ease;
        }
        .team-card:hover .team-accent {
          height: 5px !important;
        }
        .team-accent {
          transition: height 0.18s ease;
        }
      `}</style>
      {/* ===== Page Header ===== */}
      <div className="mb-8">
        <div
          style={{
            fontSize: isMobile ? "22px" : "30px",
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: SITE_BLUE,
            marginBottom: "6px",
          }}
        >
          College Football Teams
        </div>
        <div
          style={{
            height: "3px",
            backgroundColor: SITE_BLUE,
            borderRadius: "2px",
            marginBottom: "4px",
          }}
        />
        <div
          style={{
            height: "3px",
            backgroundColor: SITE_GOLD,
            borderRadius: "2px",
          }}
        />
      </div>

      {/* ===== Conference Sections ===== */}
      {conferenceOrder.map((conf) => {
        const teams = grouped[conf];
        if (!teams || teams.length === 0) return null;

        return (
          <div key={conf} style={{ marginBottom: isMobile ? "28px" : "40px" }}>

            {/* Conference header */}
            <div style={{ marginBottom: isMobile ? "10px" : "14px" }}>
              <div
                style={{
                  fontSize: isMobile ? "16px" : "20px",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: SITE_BLUE,
                  marginBottom: "5px",
                }}
              >
                {conf}
              </div>
              <div
                style={{
                  height: "3px",
                  backgroundColor: SITE_BLUE,
                  borderRadius: "2px",
                }}
              />
            </div>

            {/* Teams grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? "repeat(3, 1fr)"
                  : "repeat(auto-fill, minmax(140px, 1fr))",
                gap: isMobile ? "8px" : "12px",
              }}
            >
              {teams.map((team) => {
                const slug = team.School.toLowerCase()
                  .replace(/&/g, "and")
                  .replace(/[^a-z0-9\s]/g, "")
                  .trim()
                  .replace(/\s+/g, "-");

                const primary = team.Color1 || SITE_BLUE;
                const secondary = team.Color2 || SITE_GOLD;

                return (
                  <Link
                    key={team.id}
                    to={`/team/${slug}`}
                    className="team-card"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: isMobile ? "10px 6px" : "14px 10px",
                      borderRadius: "8px",
                      backgroundColor: "#fff",
                      border: `2px solid ${primary}`,
                      textDecoration: "none",
                      textAlign: "center",
                      gap: isMobile ? "5px" : "8px",
                    }}
                  >
                    {/* Logo */}
                    {team.Logo1 ? (
                      <img
                        src={team.Logo1}
                        alt={team.School}
                        className="team-logo"
                        style={{
                          width: isMobile ? "36px" : "48px",
                          height: isMobile ? "36px" : "48px",
                          objectFit: "contain",
                        }}
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <div
                        style={{
                          width: isMobile ? "36px" : "48px",
                          height: isMobile ? "36px" : "48px",
                          borderRadius: "50%",
                          backgroundColor: primary,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          fontSize: isMobile ? "10px" : "12px",
                          fontWeight: 900,
                        }}
                      >
                        {team.School.charAt(0)}
                      </div>
                    )}

                    {/* School name */}
                    <div
                      style={{
                        fontSize: isMobile ? "10px" : "12px",
                        fontWeight: 900,
                        color: primary,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        lineHeight: 1.2,
                      }}
                    >
                      {team.School}
                    </div>

                    {/* Color accent bar */}
                    <div
                      className="team-accent"
                      style={{
                        width: "100%",
                        height: "3px",
                        backgroundColor: secondary,
                        borderRadius: "2px",
                      }}
                    />
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}