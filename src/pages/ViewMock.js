import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import Logo1 from "../assets/Logo1.png";
import { Helmet } from "react-helmet-async";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

export default function ViewMock() {
  const { mockId } = useParams();
  const navigate = useNavigate();
  const [mock, setMock] = useState(null);
  const [teams, setTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeRound, setActiveRound] = useState(1);
  const [ownerLabel, setOwnerLabel] = useState("");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "mockDrafts", mockId));
        if (!snap.exists()) { setLoading(false); return; }
        const data = { id: snap.id, ...snap.data() };
        setMock(data);

        // Load NFL teams
        const { getDocs, collection } = await import("firebase/firestore");
        const teamSnap = await getDocs(collection(db, "nfl"));
        const teamMap = {};
        teamSnap.forEach((t) => (teamMap[t.id] = t.data()));
        setTeams(teamMap);

        // Load owner name
        if (data.ownerId) {
          const userSnap = await getDoc(doc(db, "users", data.ownerId));
          if (userSnap.exists()) {
            const u = userSnap.data();
            setOwnerLabel(u.username || u.email || data.ownerId);
          }
        }
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    load();
  }, [mockId]);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", fontSize: "18px", fontWeight: 900, color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading…
    </div>
  );

  if (!mock) return (
    <div style={{ maxWidth: "600px", margin: "80px auto", padding: "0 20px", textAlign: "center", fontFamily: "'Arial Black', Arial, sans-serif" }}>
      <div style={{ fontWeight: 900, fontSize: "18px", color: BLUE, marginBottom: "16px" }}>Mock draft not found.</div>
      <button onClick={() => navigate("/mocks")} style={{ background: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "10px 24px", fontWeight: 900, fontSize: "14px", textTransform: "uppercase", cursor: "pointer" }}>
        ← Mock Hub
      </button>
    </div>
  );

  // Build picks array sorted by pick number
  const picksArray = Object.values(mock.picks || {}).sort((a, b) => a.pickNumber - b.pickNumber);
  const rounds = mock.rounds || 1;
  const availableRounds = [...new Set(picksArray.map((p) => p.round))].sort((a, b) => a - b);
  const roundPicks = picksArray.filter((p) => p.round === activeRound);
  const totalPicks = picksArray.filter((p) => p.selection).length;

  return (
    <>
      <Helmet><title>{mock.name || "Mock Draft"} | We-Draft</title></Helmet>

      <div style={{ maxWidth: "1000px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "20px" : "26px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "18px" : "24px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: BLUE, flex: 1, minWidth: 0 }}>
              {mock.name || "Untitled Mock Draft"}
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <button onClick={() => navigate(`/mocks/${mockId}`)} style={{ background: GOLD, color: "#fff", border: `2px solid #c98a10`, borderRadius: "8px", padding: isMobile ? "7px 14px" : "8px 18px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", cursor: "pointer" }}>
                Edit →
              </button>
              <button onClick={() => navigate("/mocks")} style={{ background: "#fff", color: BLUE, border: `2px solid ${BLUE}`, borderRadius: "8px", padding: isMobile ? "7px 14px" : "8px 18px", fontWeight: 900, fontSize: "12px", textTransform: "uppercase", cursor: "pointer" }}>
                Hub
              </button>
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* ===== Meta row ===== */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
          {ownerLabel && (
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#666" }}>
              By <span style={{ color: BLUE, fontWeight: 900 }}>{ownerLabel}</span>
            </div>
          )}
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#bbb" }}>
            {rounds} Round{rounds !== 1 ? "s" : ""} · {totalPicks} picks made
          </div>
          {mock.visibility === "public" && (
            <span style={{ background: "#e8f5e9", color: "#2e7d32", fontSize: "8px", fontWeight: 900, padding: "2px 8px", borderRadius: "4px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Public</span>
          )}
          {mock.updatedAt?.toDate && (
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#ccc" }}>
              Updated {mock.updatedAt.toDate().toLocaleDateString()}
            </div>
          )}
        </div>

        {/* ===== Round tabs ===== */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
          {availableRounds.map((r) => (
            <button
              key={r}
              onClick={() => setActiveRound(r)}
              style={{
                padding: isMobile ? "6px 14px" : "8px 20px",
                fontWeight: 900, fontSize: isMobile ? "13px" : "14px",
                textTransform: "uppercase", letterSpacing: "0.05em",
                border: `2px solid ${GOLD}`, borderRadius: "8px", cursor: "pointer",
                background: activeRound === r ? BLUE : "#fff",
                color: activeRound === r ? "#fff" : BLUE,
              }}
            >
              Rd {r}
            </button>
          ))}
        </div>

        {/* ===== Picks card ===== */}
        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
          <div style={{ background: BLUE, padding: "8px 16px" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Round {activeRound}
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {roundPicks.map((pick, i) => {
            const team = teams[pick.currentTeam];
            const player = pick.selection;
            const teamColor1 = team?.Color1 || BLUE;
            const teamColor2 = team?.Color2 || GOLD;
            const teamLogo = team?.Logo1 || null;
            const teamName = team ? `${team.City} ${team.Team}` : pick.currentTeam;
            const hasPick = !!player;

            return (
              <div
                key={pick.pickNumber}
                style={{
                  display: "flex", alignItems: "center",
                  padding: isMobile ? "10px 12px" : "14px 18px",
                  borderBottom: i < roundPicks.length - 1 ? "1px solid #f0f0f0" : "none",
                  background: "#fff",
                  opacity: hasPick ? 1 : 0.4,
                }}
              >
                {/* Pick number badge */}
                <div style={{
                  flexShrink: 0, width: isMobile ? "44px" : "60px", height: isMobile ? "44px" : "60px",
                  borderRadius: "8px", background: teamColor1, border: `2px solid ${teamColor2}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  marginRight: isMobile ? "10px" : "14px",
                }}>
                  <div style={{ fontSize: isMobile ? "18px" : "24px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{pick.pickNumber}</div>
                  <div style={{ fontSize: "8px", fontWeight: 800, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pick</div>
                </div>

                {/* Team logo */}
                <div style={{ flexShrink: 0, width: isMobile ? "36px" : "52px", height: isMobile ? "36px" : "52px", display: "flex", alignItems: "center", justifyContent: "center", marginRight: isMobile ? "10px" : "14px" }}>
                  {teamLogo ? (
                    <img src={sanitizeUrl(teamLogo)} alt={teamName} style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: teamColor1, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "10px" }}>
                      {pick.currentTeam}
                    </div>
                  )}
                </div>

                {/* Player / team info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {hasPick ? (
                    <>
                      <Link
                        to={`/player/${player.Slug}`}
                        style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "15px" : "20px", textDecoration: "none", lineHeight: 1.2, display: "block" }}
                        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                      >
                        {player.First} {player.Last}
                      </Link>
                      <div style={{ fontSize: isMobile ? "11px" : "13px", fontWeight: 700, color: "#555", marginTop: "2px" }}>
                        {player.Position} · {player.School}
                      </div>
                    </>
                  ) : null}
                  <div style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 800, color: teamColor1, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: hasPick ? "2px" : 0 }}>
                    {teamName}
                    {pick.tradedFrom && (
                      <span style={{ color: "#bbb", fontWeight: 700, fontSize: "10px", marginLeft: "8px" }}>
                        (via {pick.tradedFrom})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </>
  );
}