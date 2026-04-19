// src/components/DraftFeed.js
import { useEffect, useState, useRef } from "react";
import { collection, onSnapshot, getDoc, doc, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

// Round 1 pick order: pick# -> team abbreviation
const ROUND_1_ORDER = [
  { pick: 1,  team: "LV"  }, { pick: 2,  team: "NYJ" }, { pick: 3,  team: "ARI" },
  { pick: 4,  team: "TEN" }, { pick: 5,  team: "NYG" }, { pick: 6,  team: "CLE" },
  { pick: 7,  team: "CAR" }, { pick: 8,  team: "NE"  }, { pick: 9,  team: "NO"  },
  { pick: 10, team: "CHI" }, { pick: 11, team: "SF"  }, { pick: 12, team: "DAL" },
  { pick: 13, team: "MIA" }, { pick: 14, team: "IND" }, { pick: 15, team: "ATL" },
  { pick: 16, team: "SEA" }, { pick: 17, team: "JAX" }, { pick: 18, team: "CIN" },
  { pick: 19, team: "LAR" }, { pick: 20, team: "MIN" }, { pick: 21, team: "PIT" },
  { pick: 22, team: "LAC" }, { pick: 23, team: "GB"  }, { pick: 24, team: "HOU" },
  { pick: 25, team: "WAS" }, { pick: 26, team: "BUF" }, { pick: 27, team: "DET" },
  { pick: 28, team: "BAL" }, { pick: 29, team: "PHI" }, { pick: 30, team: "TB"  },
  { pick: 31, team: "KC"  }, { pick: 32, team: "DEN" },
];

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

const gradeLabels = {
  1: "Early First Round", 2: "Middle First Round", 3: "Late First Round",
  4: "Second Round", 5: "Third Round", 6: "Fourth Round",
  7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
};

const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
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
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      borderRadius: "5px", width: "48px", height: "40px", flexShrink: 0,
    }}>
      <span style={{ fontSize: "15px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
      <span style={{ fontSize: "6.5px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "2px", textAlign: "center", lineHeight: 1.1 }}>{grade}</span>
    </div>
  );
}

export default function DraftFeed() {
  const [picks, setPicks] = useState([]);        // enriched picks with player/team data
  const [teamDataMap, setTeamDataMap] = useState({}); // abbr -> nfl doc
  const [loading, setLoading] = useState(true);
  const [newPickId, setNewPickId] = useState(null);
  const prevPickIds = useRef(new Set());
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Pre-fetch all 32 round 1 team logos/colors
  useEffect(() => {
    const fetchTeams = async () => {
      const entries = await Promise.all(
        ROUND_1_ORDER.map(async ({ team }) => {
          try {
            const snap = await getDoc(doc(db, "nfl", team));
            return [team, snap.exists() ? snap.data() : null];
          } catch { return [team, null]; }
        })
      );
      setTeamDataMap(Object.fromEntries(entries));
    };
    fetchTeams();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "draftOrder"), async (snap) => {
      const raw = snap.docs
        .map((d) => ({ docId: d.id, ...d.data() }))
        .filter((p) => p.Selection && p.Selection.trim() !== "")
        .sort((a, b) => a.Round !== b.Round ? a.Round - b.Round : a.Pick - b.Pick);

      // Detect new pick for animation
      const currentIds = new Set(raw.map((p) => p.docId));
      const added = [...currentIds].find((id) => !prevPickIds.current.has(id));
      if (added) setNewPickId(added);
      prevPickIds.current = currentIds;

      // Take the last 10 picks (most recent 10 in order)
      const last10 = raw.slice(-10).reverse(); // newest first

      // Enrich each
      const enriched = await Promise.all(
        last10.map(async (pick) => {
          let player = null;
          let teamData = null;
          let commGrade = null;

          try {
            const q = query(collection(db, "players"), where("Slug", "==", pick.Selection), limit(1));
            const playerSnap = await getDocs(q);
            if (!playerSnap.empty) {
              const pd = playerSnap.docs[0];
              player = { id: pd.id, ...pd.data() };
              try {
                const evalsSnap = await getDocs(collection(db, "players", pd.id, "evaluations"));
                const grades = [];
                evalsSnap.forEach((d) => {
                  const g = d.data().grade;
                  if (g && gradeScale[g]) grades.push(gradeScale[g]);
                });
                if (grades.length > 0) {
                  const avg = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
                  commGrade = gradeLabels[avg];
                }
              } catch {}
            }
          } catch {}

          try {
            const teamSnap = await getDoc(doc(db, "nfl", pick.Team));
            if (teamSnap.exists()) teamData = teamSnap.data();
          } catch {}

          return { ...pick, player, teamData, commGrade };
        })
      );

      setPicks(enriched);
      setLoading(false);

      if (added) setTimeout(() => setNewPickId(null), 3000);
    });

    return () => unsub();
  }, []);

  const noPicks = picks.length === 0;

  return (
    <div style={{ fontFamily: "'Arial Black', Arial, sans-serif", width: "100%" }}>

      {/* Section header */}
      <div style={{ marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              2026 NFL Draft
            </div>
            {!noPicks && (
              <div style={{
                background: "#e53935", color: "#fff", fontWeight: 900, fontSize: "11px",
                padding: "3px 10px", borderRadius: "12px", letterSpacing: "0.06em",
                animation: "livePulse 2s infinite",
              }}>
                LIVE
              </div>
            )}
          </div>
          <Link to="/draft" style={{ color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "underline", flexShrink: 0 }}>
            Full Board →
          </Link>
        </div>
        <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
        <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
      </div>

      {/* On the clock banner — only shows before any picks */}
      {noPicks && !loading && (
        <div style={{
          background: BLUE, border: `3px solid ${GOLD}`,
          borderRadius: "10px", padding: isMobile ? "16px" : "20px 28px",
          marginBottom: "20px", textAlign: "center",
        }}>
          <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 900, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
            The Draft Starts
          </div>
          <div style={{ fontSize: isMobile ? "20px" : "28px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2 }}>
            Wednesday, April 23rd at 8PM ET
          </div>
          <div style={{ fontSize: isMobile ? "15px" : "20px", fontWeight: 900, color: "#fff", marginTop: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            🏈 The Las Vegas Raiders Are On The Clock
          </div>
        </div>
      )}

      {/* Pre-draft: 4×8 grid of all 32 round 1 teams */}
      {noPicks && !loading && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "repeat(4, 1fr)" : "repeat(8, 1fr)",
            gap: isMobile ? "6px" : "8px",
          }}>
            {ROUND_1_ORDER.map(({ pick, team }) => {
              const td = teamDataMap[team];
              const color = td?.Color1 || BLUE;
              const color2 = td?.Color2 || GOLD;
              const logo = td?.Logo1 || null;
              return (
                <div
                  key={pick}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", padding: isMobile ? "8px 4px" : "10px 6px",
                    border: `2px solid ${color}`, borderRadius: "8px",
                    background: "#fff", gap: "4px",
                  }}
                >
                  <div style={{ fontSize: "9px", fontWeight: 900, color: "#bbb", letterSpacing: "0.06em" }}>#{pick}</div>
                  {logo ? (
                    <img src={sanitizeUrl(logo)} alt={team}
                      style={{ width: isMobile ? "28px" : "36px", height: isMobile ? "28px" : "36px", objectFit: "contain" }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <div style={{ width: isMobile ? "28px" : "36px", height: isMobile ? "28px" : "36px", borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "9px", fontWeight: 900 }}>
                      {team}
                    </div>
                  )}
                  <div style={{ fontSize: isMobile ? "8px" : "9px", fontWeight: 900, color, textAlign: "center", letterSpacing: "0.04em" }}>{team}</div>
                  <div style={{ height: "2px", width: "80%", background: color2, borderRadius: "1px" }} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live picks feed — shows once picks start */}
      {!noPicks && (
        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", marginBottom: "16px" }}>
          <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Most Recent Picks
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {picks.map((pick, i) => {
            const teamColor1 = pick.teamData?.Color1 || BLUE;
            const teamColor2 = pick.teamData?.Color2 || GOLD;
            const teamLogo = pick.teamData?.Logo1 || null;
            const teamName = pick.teamData?.Name || pick.Team;
            const isNew = pick.docId === newPickId;

            return (
              <div
                key={pick.docId}
                style={{
                  display: "flex", alignItems: "center",
                  padding: isMobile ? "10px 12px" : "12px 16px",
                  borderBottom: i < picks.length - 1 ? "1px solid #f0f0f0" : "none",
                  background: isNew ? "#fffbe6" : "#fff",
                  transition: "background 1s ease",
                }}
              >
                {/* Round + pick badge */}
                <div style={{
                  flexShrink: 0, width: isMobile ? 44 : 54, height: isMobile ? 44 : 54,
                  borderRadius: "8px", background: teamColor1, border: `2px solid ${teamColor2}`,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  marginRight: isMobile ? "10px" : "14px",
                }}>
                  <div style={{ fontSize: "8px", fontWeight: 800, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1 }}>Rd {pick.Round}</div>
                  <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: "#fff", lineHeight: 1, marginTop: "1px" }}>{pick.Pick}</div>
                </div>

                {/* Team logo */}
                <div style={{ flexShrink: 0, width: isMobile ? 36 : 46, height: isMobile ? 36 : 46, display: "flex", alignItems: "center", justifyContent: "center", marginRight: isMobile ? "10px" : "14px" }}>
                  {teamLogo ? (
                    <img src={sanitizeUrl(teamLogo)} alt={teamName} style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: teamColor1, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "10px" }}>
                      {pick.Team}
                    </div>
                  )}
                </div>

                {/* Player info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link
                    to={`/player/${pick.Selection}`}
                    style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "15px" : "17px", textDecoration: "none", lineHeight: 1.2, display: "block" }}
                    onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                  >
                    {pick.player ? `${pick.player.First || ""} ${pick.player.Last || ""}` : pick.Selection}
                  </Link>
                  {pick.player && (
                    <div style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 700, color: "#555", marginTop: "2px" }}>
                      {pick.player.Position} · {pick.player.School}
                    </div>
                  )}
                  <div style={{ fontSize: "11px", fontWeight: 800, color: teamColor1, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "1px" }}>
                    {teamName}
                  </div>
                </div>

                {/* Grade badge */}
                {pick.commGrade && (
                  <div style={{ flexShrink: 0, marginLeft: "10px" }}>
                    <GradeBadge grade={pick.commGrade} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* View full board button */}
      <div style={{ textAlign: "center" }}>
        <Link
          to="/draft"
          style={{
            display: "inline-block", backgroundColor: BLUE, color: "#fff",
            border: `2px solid ${GOLD}`, borderRadius: "8px",
            padding: isMobile ? "10px 24px" : "12px 32px",
            fontWeight: 900, fontSize: isMobile ? "13px" : "15px",
            textTransform: "uppercase", letterSpacing: "0.08em", textDecoration: "none",
          }}
        >
          View Full Draft Board →
        </Link>
      </div>

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}