// src/pages/DraftPage.js
import { useEffect, useState } from "react";
import { collection, onSnapshot, getDoc, doc, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const ROUNDS = [1, 2, 3, 4, 5, 6, 7];

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

const getGradeRound = (grade) => {
  if (!grade) return null;
  if (grade.includes("First Round")) return 1;
  return gradeScale[grade] || null;
};

function StealBadge() {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      backgroundColor: GOLD, border: `2px solid #e09010`,
      borderRadius: "6px", padding: "4px 10px", flexShrink: 0,
    }}>
      <span style={{ fontSize: "13px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>💰 Steal</span>
    </div>
  );
}

function GradeBadge({ grade }) {
  const gd = gradeDisplay(grade);
  if (!gd) return null;
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `3px solid ${gd.border}`,
      borderRadius: "8px", width: "80px", height: "64px", flexShrink: 0,
    }}>
      <span style={{ fontSize: "28px", fontWeight: 900, color: "#fff", lineHeight: 1, letterSpacing: "-0.02em" }}>{gd.short}</span>
      <span style={{ fontSize: "8px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "3px", textAlign: "center", lineHeight: 1.2 }}>{grade}</span>
    </div>
  );
}

// Shared enrichment function
async function enrichPick(pick) {
  let player = null;
  let teamData = null;
  let commGrade = null;

  if (pick.Selection && pick.Selection.trim()) {
    try {
      const q = query(collection(db, "players"), where("Slug", "==", pick.Selection), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const pd = snap.docs[0];
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
  }

  try {
    const teamSnap = await getDoc(doc(db, "nfl", pick.Team));
    if (teamSnap.exists()) teamData = teamSnap.data();
  } catch {}

  return { ...pick, player, teamData, commGrade };
}

export default function DraftPage() {
  const [allPicks, setAllPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [activeRound, setActiveRound] = useState(1);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "draftOrder"), async (snap) => {
      const raw = snap.docs
        .map((d) => ({ docId: d.id, ...d.data() }))
        .sort((a, b) => a.Round !== b.Round ? a.Round - b.Round : a.Pick - b.Pick);

      const enriched = await Promise.all(raw.map(enrichPick));
      setAllPicks(enriched);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Determine most recent round that has any picks
  useEffect(() => {
    if (!allPicks.length) return;
    const pickedRounds = allPicks.filter((p) => p.Selection).map((p) => p.Round);
    if (pickedRounds.length) setActiveRound(Math.max(...pickedRounds));
  }, [allPicks]);

  const roundPicks = (round) => allPicks.filter((p) => p.Round === round);

  return (
    <>
      <Helmet>
        <title>2026 NFL Draft | We-Draft</title>
      </Helmet>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: isMobile ? "12px 10px 60px" : "24px 20px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* ===== Header ===== */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "26px" : "32px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "28px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, lineHeight: 1 }}>
              2026 NFL Draft
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* Pick counter */}
        <div style={{ marginBottom: "18px", display: "flex", alignItems: "center", gap: "12px" }}>
          {loading && <div style={{ color: "#999", fontSize: "13px", fontWeight: 700 }}>Loading...</div>}
        </div>

        {/* ===== Round tabs ===== */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
          {ROUNDS.map((r) => {
            const count = roundPicks(r).filter((p) => p.Selection).length;
            const total = roundPicks(r).length;
            return (
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
            );
          })}
        </div>

        {/* ===== Picks for active round ===== */}
        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden" }}>
          {/* Card header */}
          <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "13px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Round {activeRound}
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {roundPicks(activeRound).length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "#999", fontStyle: "italic", fontSize: "14px", background: "#fff" }}>
              No picks yet for Round {activeRound}.
            </div>
          ) : (
            <div>
              {roundPicks(activeRound).map((pick, i, arr) => {
                const hasPick = !!pick.Selection;
                const isLast = i === arr.length - 1;
                const teamColor1 = pick.teamData?.Color1 || BLUE;
                const teamColor2 = pick.teamData?.Color2 || GOLD;
                const teamLogo = pick.teamData?.Logo1 || null;
                const teamName = pick.teamData?.Name || pick.Team;
                const gradeRound = getGradeRound(pick.commGrade);
                const isSteal = hasPick && gradeRound !== null && (pick.Round - gradeRound) >= 2;

                return (
                  <div
                    key={pick.docId}
                    style={{
                      display: "flex", alignItems: "center",
                      padding: isMobile ? "12px 12px" : "18px 20px",
                      borderBottom: isLast ? "none" : `1px solid #f0f0f0`,
                      background: "#fff",
                      opacity: hasPick ? 1 : 0.45,
                    }}
                  >
                    {/* Pick number */}
                    <div style={{
                      flexShrink: 0, width: isMobile ? 48 : 68, height: isMobile ? 48 : 68,
                      borderRadius: "10px", background: teamColor1, border: `2px solid ${teamColor2}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      marginRight: isMobile ? "12px" : "18px",
                    }}>
                      <div style={{ fontSize: isMobile ? "18px" : "28px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{pick.Pick}</div>
                      <div style={{ fontSize: "8px", fontWeight: 800, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Pick</div>
                    </div>

                    {/* Team logo */}
                    <div style={{ flexShrink: 0, width: isMobile ? 44 : 68, height: isMobile ? 44 : 68, display: "flex", alignItems: "center", justifyContent: "center", marginRight: isMobile ? "12px" : "18px" }}>
                      {teamLogo ? (
                        <img src={sanitizeUrl(teamLogo)} alt={teamName} style={{ width: "100%", height: "100%", objectFit: "contain" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <div style={{ width: isMobile ? 44 : 64, height: isMobile ? 44 : 64, borderRadius: "50%", background: teamColor1, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "13px" }}>
                          {pick.Team}
                        </div>
                      )}
                    </div>

                    {/* Player info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {hasPick ? (
                        <>
                          <Link
                            to={`/player/${pick.Selection}`}
                            style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "18px" : "26px", textDecoration: "none", lineHeight: 1.2, display: "block" }}
                            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                          >
                            {pick.player ? `${pick.player.First || ""} ${pick.player.Last || ""}` : pick.Selection}
                          </Link>
                          {pick.player && (
                            <div style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 700, color: "#555", marginTop: "3px" }}>
                              {pick.player.Position} · {pick.player.School}
                            </div>
                          )}
                          <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 800, color: teamColor1, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "3px" }}>
                            {teamName}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontWeight: 900, fontSize: isMobile ? "13px" : "15px", color: "#bbb", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                          {teamName}
                        </div>
                      )}
                    </div>

                    {/* Community grade + steal badge */}
                    {hasPick && (pick.commGrade || isSteal) && (
                      <div style={{ flexShrink: 0, marginLeft: "16px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                        {pick.commGrade && (
                          <>
                            <div style={{ fontSize: "9px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em" }}>Comm Grade</div>
                            <GradeBadge grade={pick.commGrade} />
                          </>
                        )}
                        {isSteal && <StealBadge />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Link to home for live feed */}
        <div style={{ textAlign: "center", marginTop: "20px" }}>
          <Link to="/" style={{ color: BLUE, fontWeight: 900, fontSize: "13px", textDecoration: "underline" }}>
            ← Back to Live Feed
          </Link>
        </div>

      </div>
    </>
  );
}