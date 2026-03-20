import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";

export default function CFBPage() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);

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
    async function fetchSchools() {
      try {
        const snapshot = await getDocs(collection(db, "schools"));

        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

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

  if (loading) return <div style={{ padding: 20 }}>Loading teams...</div>;

  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      <h1>College Football Teams</h1>

      {conferenceOrder.map((conf) => {
        const teams = grouped[conf];
        if (!teams || teams.length === 0) return null;

        return (
          <div key={conf} style={{ marginTop: "30px" }}>
            {/* Conference Header */}
            <h2
              style={{
                borderBottom: "2px solid #ccc",
                paddingBottom: "5px",
              }}
            >
              {conf}
            </h2>

            {/* Teams Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: "12px",
                marginTop: "15px",
              }}
            >
              {teams.map((team) => {
                const slug = team.School.toLowerCase().replace(/\s+/g, "-");

                return (
                  <Link
                    key={team.id}
                    to={`/team/${slug}`}
                    style={{
                      padding: "12px",
                      borderRadius: "10px",
                      background: "#f5f5f5",
                      border: `2px solid ${team.Color1 || "#ddd"}`,
                      textDecoration: "none",
                      color: "#000",
                      textAlign: "center",
                      fontWeight: "500",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "scale(1.03)";
                      e.currentTarget.style.boxShadow = `0 4px 12px ${
                        team.Color1 || "#999"
                      }40`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "scale(1)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    {/* Logo */}
                    {team.Logo1 && (
                      <img
                        src={team.Logo1}
                        alt={team.School}
                        style={{
                          width: "40px",
                          height: "40px",
                          objectFit: "contain",
                          marginBottom: "6px",
                        }}
                      />
                    )}

                    {/* Name */}
                    <div>{team.School}</div>
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