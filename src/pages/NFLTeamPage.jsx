import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";

export default function NFLTeamPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const teamKey = teamId?.toUpperCase();

  const [team, setTeam] = useState(null);
  const [picks, setPicks] = useState([]);
  const [playersBySlug, setPlayersBySlug] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamKey) return;

    const loadData = async () => {
      const teamSnap = await getDoc(doc(db, "nfl", teamKey));
      if (!teamSnap.exists()) {
        setLoading(false);
        return;
      }
      setTeam(teamSnap.data());

      const picksQ = query(
        collection(db, "draftOrder"),
        where("Team", "==", teamKey),
        orderBy("Round"),
        orderBy("Pick")
      );

      const picksSnap = await getDocs(picksQ);
      const picksData = picksSnap.docs.map((d) => d.data());
      setPicks(picksData);

      const slugs = [
        ...new Set(
          picksData
            .map((p) => p.Selection)
            .filter((s) => typeof s === "string" && s.trim())
        ),
      ];

      const playerMap = {};
      for (const slug of slugs) {
        const q = query(
          collection(db, "players"),
          where("Slug", "==", slug)
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          playerMap[slug] = snap.docs[0].data();
        }
      }

      setPlayersBySlug(playerMap);
      setLoading(false);
    };

    loadData();
  }, [teamKey]);

  if (loading) {
    return (
      <div style={{ marginTop: 100, textAlign: "center" }}>
        Loading team…
      </div>
    );
  }

  if (!team) {
    return (
      <div style={{ marginTop: 100, textAlign: "center", color: "red" }}>
        Team not found
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      {/* HEADER */}
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <img
          src={team.Logo1}
          alt="logo"
          style={{ position: "absolute", left: 0, width: 300 }}
        />

        <div style={{ textAlign: "center" }}>
<div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: team.Color2,
              letterSpacing: 6,
              textTransform: "uppercase",
            }}
          >
            {team.City}
          </div>

          <div
            style={{
              fontSize: 96,
              fontWeight: 900,
              lineHeight: 1,
              color: team.Color1,
              WebkitTextStroke: `3px ${team.Color2}`,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {team.Team}
          </div>

          <div
            style={{
              marginTop: 8,
              fontSize: 16,
              fontWeight: 800,
              color: team.Color1,
              letterSpacing: 4,
              textTransform: "uppercase",
              borderTop: `2px solid ${team.Color2}`,
              borderBottom: `2px solid ${team.Color2}`,
              padding: "6px 20px",
            }}
          >
            {team.Conference} · {team.Division}
          </div>
        </div>

        <img
          src={team.Logo2}
          alt="alt logo"
          style={{ position: "absolute", right: 0, width: 300 }}
        />
      </div>

      {/* STAFF */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginTop: 24,
        }}
      >
        <StaffCard color={team.Color1} label="Head Coach" value={team.HeadCoach} />
        <StaffCard color={team.Color1} label="General Manager" value={team.GeneralManager} />
        <StaffCard
          color={team.Color1}
          label="Offensive Coordinator"
          value={team.OffensiveCoordinator}
          scheme={team.OffensiveScheme}
        />
        <StaffCard
          color={team.Color1}
          label="Defensive Coordinator"
          value={team.DefensiveCoordinator}
          scheme={team.DefensiveScheme}
        />
      </div>

      {/* DRAFT PICKS */}
      <div
        style={{
          marginTop: 36,
          border: `4px solid ${team.Color2}`,
          borderRadius: 14,
          background: "#fff",
          overflow: "hidden",
        }}
      >
        {/* HEADER BAND */}
        <div
          style={{
            background: team.Color1,
            color: "#fff",
            fontSize: 24,
            fontWeight: 900,
            padding: "14px 0",
            textAlign: "center",
            letterSpacing: 1,
          }}
        >
          DRAFT PICKS
        </div>

{/* PICKS */}
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          {picks.map((p, i) => {
            const player = playersBySlug[p.Selection];

            return (
              <div
                key={i}
                onClick={() => player && navigate(`/player/${player.Slug}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr auto",
                  alignItems: "center",
                  border: `2px solid ${team.Color2}`,
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: player ? "pointer" : "default",
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={(e) => { if (player) e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                {/* ROUND/PICK BADGE */}
                <div
                  style={{
                    background: team.Color1,
                    color: "#fff",
                    padding: "14px 10px",
                    textAlign: "center",
                    fontWeight: 900,
                    fontSize: 14,
                    letterSpacing: 0.5,
                    lineHeight: 1.4,
                  }}
                >
                  <div>ROUND {p.Round}</div>
                  <div style={{ fontSize: 20 }}>PICK {p.Pick}</div>
                </div>

                {/* PLAYER INFO */}
                <div style={{ padding: "12px 18px" }}>
                  {player ? (
                    <>
                      <div
                        style={{
                          fontSize: 22,
                          fontWeight: 900,
                          color: team.Color1,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        {player.First} {player.Last}
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#555",
                          marginTop: 2,
                        }}
                      >
                        {player.Position} · {player.School}
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: "#999",
                        fontStyle: "italic",
                      }}
                    >
                      Pick not yet made
                    </div>
                  )}
                </div>

                {/* ARROW */}
                {player && (
                  <div
                    style={{
                      paddingRight: 18,
                      fontSize: 20,
                      color: team.Color2,
                      fontWeight: 900,
                    }}
                  >
                    →
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* STAFF CARD */
function StaffCard({ label, value, scheme, color }) {
  return (
    <div
      style={{
        border: `3px solid ${color}`,
        borderRadius: 10,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        style={{
          background: color,
          color: "#fff",
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: 1,
          textTransform: "uppercase",
          padding: "6px 12px",
        }}
      >
        {label}
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#111" }}>
          {value || "—"}
        </div>
        {scheme && (
          <div style={{ marginTop: 4, fontSize: 12, color: "#666", fontWeight: 600 }}>
            {scheme}
          </div>
        )}
      </div>
    </div>
  );
}