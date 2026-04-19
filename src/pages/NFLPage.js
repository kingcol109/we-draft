import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { Helmet } from "react-helmet-async";

const SITE_BLUE = "#0055a5";
const SITE_GOLD = "#f6a21d";

const DIVISION_ORDER = [
  { conf: "AFC", divisions: ["AFC East", "AFC North", "AFC South", "AFC West"] },
  { conf: "NFC", divisions: ["NFC East", "NFC North", "NFC South", "NFC West"] },
];

export default function NFLPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    async function fetchTeams() {
      try {
        const snapshot = await getDocs(collection(db, "nfl"));
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setTeams(data);
      } catch (err) {
        console.error("Error fetching NFL teams:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchTeams();
  }, []);

  // Group by division
  const grouped = {};
  DIVISION_ORDER.forEach(({ divisions }) => {
    divisions.forEach((div) => {
      grouped[div] = teams
        .filter((t) => `${t.Conference} ${t.Division}` === div)
        .sort((a, b) => a.Team.localeCompare(b.Team));
    });
  });

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", fontSize: 20, fontWeight: 900, color: SITE_BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading Teams…
    </div>
  );

  return (
    <>
      <Helmet>
        <title>NFL Teams | We-Draft</title>
      </Helmet>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "12px 12px 60px" : "24px 24px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
        <style>{`
          .nfl-team-card { transition: transform 0.18s ease, box-shadow 0.18s ease; }
          .nfl-team-card:hover { transform: translateY(-5px) scale(1.04); box-shadow: 0 8px 20px rgba(0,0,0,0.15); }
          .nfl-team-card:hover .nfl-team-logo { transform: scale(1.12); }
          .nfl-team-logo { transition: transform 0.18s ease; }
          .nfl-team-card:hover .nfl-team-accent { height: 5px !important; }
          .nfl-team-accent { transition: height 0.18s ease; }
        `}</style>

        {/* ===== Page Header ===== */}
        <div style={{ marginBottom: isMobile ? "20px" : "28px" }}>
          <div style={{ fontSize: isMobile ? "22px" : "30px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: SITE_BLUE, marginBottom: "6px" }}>
            NFL Teams
          </div>
          <div style={{ height: "3px", backgroundColor: SITE_BLUE, borderRadius: "2px", marginBottom: "4px" }} />
          <div style={{ height: "3px", backgroundColor: SITE_GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== AFC + NFC ===== */}
        {DIVISION_ORDER.map(({ conf, divisions }) => (
          <div key={conf} style={{ marginBottom: isMobile ? "32px" : "48px" }}>

            {/* Conference header */}
            <div style={{ marginBottom: isMobile ? "14px" : "20px" }}>
              <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: SITE_BLUE, marginBottom: "5px" }}>
                {conf}
              </div>
              <div style={{ height: "3px", backgroundColor: SITE_BLUE, borderRadius: "2px", marginBottom: "3px" }} />
              <div style={{ height: "3px", backgroundColor: SITE_GOLD, borderRadius: "2px" }} />
            </div>

            {/* Four divisions side by side */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: isMobile ? "16px" : "20px" }}>
              {divisions.map((div) => {
                const divTeams = grouped[div] || [];
                const divLabel = div.replace(`${conf} `, ""); // "East", "North", etc.
                return (
                  <div key={div}>
                    {/* Division label */}
                    <div style={{ fontSize: isMobile ? "11px" : "13px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.12em", color: SITE_BLUE, marginBottom: "8px", paddingBottom: "4px", borderBottom: `2px solid ${SITE_GOLD}` }}>
                      {divLabel}
                    </div>

                    {/* Teams */}
                    <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? "6px" : "8px" }}>
                      {divTeams.map((team) => {
                        const primary = team.Color1 || SITE_BLUE;
                        const secondary = team.Color2 || SITE_GOLD;
                        const abbr = team.Abbreviation || team.id;

                        return (
                          <Link
                            key={team.id}
                            to={`/nfl/${abbr.toLowerCase()}`}
                            className="nfl-team-card"
                            style={{
                              display: "flex", alignItems: "center", gap: isMobile ? "8px" : "10px",
                              padding: isMobile ? "8px 10px" : "10px 12px",
                              borderRadius: "8px", backgroundColor: "#fff",
                              border: `2px solid ${primary}`,
                              textDecoration: "none", position: "relative", overflow: "hidden",
                            }}
                          >
                            {/* Logo */}
                            <div style={{ flexShrink: 0, width: isMobile ? 32 : 40, height: isMobile ? 32 : 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {team.Logo1 ? (
                                <img
                                  src={team.Logo1}
                                  alt={team.Team}
                                  className="nfl-team-logo"
                                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                                  loading="lazy"
                                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                                />
                              ) : (
                                <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: primary, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 900 }}>
                                  {abbr.charAt(0)}
                                </div>
                              )}
                            </div>

                            {/* Name */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: isMobile ? "9px" : "10px", fontWeight: 800, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1 }}>
                                {team.City}
                              </div>
                              <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 900, color: primary, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {team.Team}
                              </div>
                            </div>

                            {/* Color accent bar on right edge */}
                            <div className="nfl-team-accent" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "4px", background: secondary, borderRadius: "0 6px 6px 0" }} />
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}