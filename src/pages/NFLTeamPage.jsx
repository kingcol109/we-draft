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
              fontSize: 42,
              fontWeight: 500,
              color: team.Color1,
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
            }}
          >
            {team.Team}
          </div>
        </div>

        <img
          src={team.Logo2}
          alt="alt logo"
          style={{ position: "absolute", right: 0, width: 300 }}
        />
      </div>

      {/* CONFERENCE */}
      <div
        style={{
          textAlign: "center",
          fontSize: 18,
          fontWeight: 700,
          color: team.Color1,
        }}
      >
        {team.Conference} {team.Division}
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
        <div style={{ padding: 28, textAlign: "center" }}>
          {picks.map((p, i) => {
            const player = playersBySlug[p.Selection];

            return (
              <div
                key={i}
                style={{
                  marginBottom: 18,
                  fontSize: player ? 26 : 20,
                  fontWeight: player ? 900 : 800,
                  color: team.Color1,
                  textTransform: "uppercase",
                }}
              >
                {player ? (
                  <>
                    ROUND {p.Round} PICK {p.Pick}:{" "}
                    <span
                      style={{
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                      onClick={() => navigate(`/player/${player.Slug}`)}
                    >
                      {player.First} {player.Last}
                    </span>
                  </>
                ) : (
                  <>ROUND {p.Round} PICK {p.Pick}</>
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
        border: `2px solid ${color}`,
        borderRadius: 10,
        padding: 16,
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value || "—"}</div>
      {scheme && (
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.6 }}>
          {scheme}
        </div>
      )}
    </div>
  );
}
