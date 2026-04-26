import { useEffect, useState, useRef } from "react";
import {
  collection, getDocs, getDoc, doc, setDoc, serverTimestamp, query, where, limit,
} from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Helmet } from "react-helmet-async";
import Logo1 from "../assets/Logo1.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const LOCK_DATE = new Date("2026-06-01T00:00:00-04:00");
const TOTAL_ROUNDS = 7;

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

const gradeDisplay = (g) => {
  const map = {
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

function GradeBadge({ grade }) {
  const gd = gradeDisplay(grade);
  if (!gd) return null;
  return (
    <div style={{
      display: "inline-flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", backgroundColor: gd.bg, border: `2px solid ${gd.border}`,
      borderRadius: "5px", width: "44px", height: "36px", flexShrink: 0,
    }}>
      <span style={{ fontSize: "13px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
      <span style={{ fontSize: "6px", fontWeight: 800, color: "rgba(255,255,255,0.85)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "2px", textAlign: "center", lineHeight: 1.1 }}>{grade}</span>
    </div>
  );
}

export default function MyDraftClass() {
  const { user, login } = useAuth();
  const [draftedPlayers, setDraftedPlayers] = useState([]); // enriched picks from draftOrder
  const [nflTeams, setNflTeams] = useState({});
  const [myPicks, setMyPicks] = useState({}); // { round: playerSlug }
  const [savedPicks, setSavedPicks] = useState(null); // loaded from Firestore
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeRound, setActiveRound] = useState(null); // which round picker is open
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const searchRef = useRef(null);
  const isLocked = new Date() >= LOCK_DATE;
  const [selectedYear, setSelectedYear] = useState("2026");
  const AVAILABLE_YEARS = ["2026"]; // add future years here as drafts complete

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Load NFL teams
  useEffect(() => {
    const fetch = async () => {
      try {
        const snap = await getDocs(collection(db, "nfl"));
        const map = {};
        snap.docs.forEach((d) => { map[d.id] = d.data(); });
        setNflTeams(map);
      } catch (e) { console.error(e); }
    };
    fetch();
  }, []);

  // Load all drafted players from draftOrder + enrich with player data + comm grade
  useEffect(() => {
    const fetchDraft = async () => {
      try {
        const snap = await getDocs(collection(db, "draftOrder"));
        const raw = snap.docs
          .map((d) => ({ docId: d.id, ...d.data() }))
          .filter((p) => p.Selection && p.Selection.trim() !== "")
          .sort((a, b) => a.Round !== b.Round ? a.Round - b.Round : a.Pick - b.Pick);

        const enriched = await Promise.all(
          raw.map(async (pick) => {
            let player = null;
            let commGrade = null;
            try {
              const q = query(collection(db, "players"), where("Slug", "==", pick.Selection), limit(1));
              const pSnap = await getDocs(q);
              if (!pSnap.empty) {
                const pd = pSnap.docs[0];
                player = { id: pd.id, ...pd.data() };
                try {
                  const evalsSnap = await getDocs(collection(db, "players", pd.id, "evaluations"));
                  const grades = [];
                  const gradeScale = {
                    "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
                    "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
                    "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9, UDFA: 10,
                  };
                  const gradeLabels = {
                    1: "Early First Round", 2: "Middle First Round", 3: "Late First Round",
                    4: "Second Round", 5: "Third Round", 6: "Fourth Round",
                    7: "Fifth Round", 8: "Sixth Round", 9: "Seventh Round", 10: "UDFA",
                  };
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
            return { ...pick, player, commGrade };
          })
        );

        setDraftedPlayers(enriched);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchDraft();
  }, []);

  // Load user's saved picks
  useEffect(() => {
    if (!user) return;
    const fetchSaved = async () => {
      try {
        const snap = await getDoc(doc(db, "myDraftClass", `${user.uid}_2026`));
        if (snap.exists()) {
          const data = snap.data();
          setSavedPicks(data.picks || {});
          setMyPicks(data.picks || {});
        }
      } catch (e) { console.error(e); }
    };
    fetchSaved();
  }, [user]);

  const handleSave = async () => {
    if (!user || isLocked) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "myDraftClass", `${user.uid}_2026`), {
        uid: user.uid,
        draftYear: "2026",
        picks: myPicks,
        updatedAt: serverTimestamp(),
      });
      setSavedPicks({ ...myPicks });
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const handleSelectPick = (round, slug) => {
    if (isLocked) return;
    setMyPicks((prev) => ({ ...prev, [round]: slug }));
    setActiveRound(null);
    setSearchQuery("");
  };

  const handleRemovePick = (round) => {
    if (isLocked) return;
    setMyPicks((prev) => {
      const next = { ...prev };
      delete next[round];
      return next;
    });
  };

  // Players eligible for a given round = any player drafted in that round
  const eligibleForRound = (round) => {
    return draftedPlayers.filter((p) => p.Round === round);
  };

  const isDirty = JSON.stringify(myPicks) !== JSON.stringify(savedPicks || {});
  const picksComplete = Object.keys(myPicks).length === TOTAL_ROUNDS;

  // Get enriched pick data for display
  const getPickData = (round) => {
    const slug = myPicks[round];
    if (!slug) return null;
    return draftedPlayers.find((p) => p.Selection === slug) || null;
  };

  const filteredEligible = activeRound
    ? eligibleForRound(activeRound).filter((p) => {
        if (!searchQuery.trim()) return true;
        const name = `${p.player?.First || ""} ${p.player?.Last || ""}`.toLowerCase();
        const school = (p.player?.School || "").toLowerCase();
        const pos = (p.player?.Position || "").toLowerCase();
        return name.includes(searchQuery.toLowerCase()) ||
               school.includes(searchQuery.toLowerCase()) ||
               pos.includes(searchQuery.toLowerCase());
      })
    : [];

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh", fontSize: "18px", fontWeight: 900, color: BLUE, fontFamily: "'Arial Black', Arial, sans-serif" }}>
      Loading Draft Data...
    </div>
  );

  return (
    <>
      <Helmet><title>My Draft Class | We-Draft</title></Helmet>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .pick-row { transition: background 0.12s; }
        .pick-row:hover { background: #f0f5ff !important; }
        .player-option { transition: background 0.1s; cursor: pointer; }
        .player-option:hover { background: #f0f5ff !important; }
      `}</style>

      <div style={{ maxWidth: "820px", margin: "0 auto", padding: isMobile ? "12px 10px 80px" : "24px 20px 80px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

        {/* Header */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <img src={Logo1} alt="We-Draft" style={{ height: isMobile ? "22px" : "28px", objectFit: "contain" }} />
            <div style={{ fontSize: isMobile ? "20px" : "26px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
              My Draft Class
            </div>
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>

        {/* Explainer */}
        <div style={{
          background: `linear-gradient(135deg, ${BLUE} 0%, #003a7a 100%)`,
          borderRadius: "12px", padding: isMobile ? "16px" : "20px 24px",
          marginBottom: "24px", position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", top: 0, right: 0, width: "160px", height: "100%", background: "repeating-linear-gradient(60deg, transparent, transparent 12px, rgba(246,162,29,0.07) 12px, rgba(246,162,29,0.07) 24px)", pointerEvents: "none" }} />
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: isMobile ? "10px" : "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.2em", marginBottom: "6px" }}>
              🏈 2026 NFL Draft · Season Game
            </div>
            <div style={{ fontSize: isMobile ? "16px" : "20px", fontWeight: 900, color: "#fff", marginBottom: "8px", lineHeight: 1.2 }}>
              You hold Pick #1 in every round.
            </div>
            <div style={{ fontSize: isMobile ? "12px" : "13px", fontWeight: 700, color: "rgba(255,255,255,0.8)", lineHeight: 1.6 }}>
              Build your perfect 7-round draft class — but you can only select players who were actually drafted <em>after</em> pick #1 of each round. No taking the guy who went #1. Come back later and see how your class holds up.
            </div>
            {!isLocked && (
              <div style={{ marginTop: "10px", fontSize: "11px", fontWeight: 800, color: GOLD, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                🔒 Picks lock June 1, 2026
              </div>
            )}
            {isLocked && (
              <div style={{ marginTop: "10px", fontSize: "11px", fontWeight: 800, color: "#ff8a80", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                🔒 Picks are locked — submissions closed June 1, 2026
              </div>
            )}
          </div>
        </div>

        {/* Year selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
          <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "#888" }}>Draft Year</div>
          <div style={{ position: "relative", display: "inline-block" }}>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              style={{
                border: `2px solid ${GOLD}`, borderRadius: "8px",
                padding: "8px 36px 8px 14px",
                fontWeight: 900, fontSize: "15px",
                color: BLUE, background: "#fff", cursor: "pointer",
                outline: "none", appearance: "none",
                fontFamily: "'Arial Black', Arial, sans-serif",
              }}
            >
              {AVAILABLE_YEARS.map((yr) => (
                <option key={yr} value={yr}>{yr} Draft Class</option>
              ))}
            </select>
            <div style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: BLUE, fontWeight: 900, fontSize: "12px" }}>▾</div>
          </div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#aaa", fontStyle: "italic" }}>
            Your class is saved per year — one submission per draft
          </div>
        </div>

        {/* Not logged in */}
        {!user && (
          <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", marginBottom: "24px" }}>
            <div style={{ background: BLUE, padding: "10px 16px" }}>
              <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>Sign In Required</div>
            </div>
            <div style={{ height: "3px", background: GOLD }} />
            <div style={{ padding: "32px", textAlign: "center", background: "#fff" }}>
              <div style={{ fontSize: "15px", fontWeight: 900, color: BLUE, marginBottom: "14px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Log in to save your draft class
              </div>
              <button onClick={login} style={{ backgroundColor: BLUE, color: "#fff", border: `2px solid ${GOLD}`, borderRadius: "8px", padding: "10px 28px", fontWeight: 900, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer" }}>
                Login with Google
              </button>
            </div>
          </div>
        )}

        {/* Round picker cards */}
        <div style={{ border: `2px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", marginBottom: "20px" }}>
          <div style={{ background: BLUE, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Your 7 Picks — 2026 Draft Class
            </div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
              {Object.keys(myPicks).length} / {TOTAL_ROUNDS} selected
            </div>
          </div>
          <div style={{ height: "3px", background: GOLD }} />

          {Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1).map((round) => {
            const pickData = getPickData(round);
            const teamData = pickData ? nflTeams[pickData.Team] : null;
            const c1 = teamData?.Color1 || BLUE;
            const c2 = teamData?.Color2 || GOLD;
            const isOpen = activeRound === round;
            const eligible = eligibleForRound(round);

            return (
              <div key={round} style={{ borderBottom: round < TOTAL_ROUNDS ? "1px solid #f0f0f0" : "none" }}>

                {/* Pick row */}
                <div
                  className="pick-row"
                  style={{
                    display: "flex", alignItems: "center",
                    padding: isMobile ? "10px 12px" : "12px 16px",
                    background: isOpen ? "#f0f5ff" : "#fff",
                    cursor: isLocked ? "default" : "pointer",
                  }}
                  onClick={() => {
                    if (isLocked) return;
                    setActiveRound(isOpen ? null : round);
                    setSearchQuery("");
                    setTimeout(() => searchRef.current?.focus(), 50);
                  }}
                >
                  {/* Round badge */}
                  <div style={{
                    flexShrink: 0, width: isMobile ? "44px" : "54px", height: isMobile ? "44px" : "54px",
                    borderRadius: "8px",
                    background: pickData ? c1 : "#f0f0f0",
                    border: `2px solid ${pickData ? c2 : "#ddd"}`,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    marginRight: isMobile ? "10px" : "14px",
                  }}>
                    <div style={{ fontSize: "8px", fontWeight: 800, color: pickData ? "rgba(255,255,255,0.7)" : "#bbb", lineHeight: 1, textTransform: "uppercase" }}>Round</div>
                    <div style={{ fontSize: isMobile ? "18px" : "22px", fontWeight: 900, color: pickData ? "#fff" : "#ccc", lineHeight: 1 }}>{round}</div>
                  </div>

                  {/* Team logo if picked */}
                  {pickData && teamData?.Logo1 && (
                    <div style={{ flexShrink: 0, width: isMobile ? "32px" : "40px", height: isMobile ? "32px" : "40px", display: "flex", alignItems: "center", justifyContent: "center", marginRight: isMobile ? "8px" : "12px", background: "#fff", borderRadius: "6px", border: "1px solid #eee", padding: "3px" }}>
                      <img src={sanitizeUrl(teamData.Logo1)} alt={pickData.Team} style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    </div>
                  )}

                  {/* Player info or prompt */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {pickData ? (
                      <>
                        <Link
                          to={`/player/${pickData.Selection}`}
                          style={{ color: BLUE, fontWeight: 900, fontSize: isMobile ? "15px" : "17px", textDecoration: "none", display: "block", lineHeight: 1.2 }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                        >
                          {pickData.player ? `${pickData.player.First || ""} ${pickData.player.Last || ""}` : pickData.Selection}
                        </Link>
                        {pickData.player && (
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "#555", marginTop: "2px" }}>
                            {pickData.player.Position} · {pickData.player.School}
                          </div>
                        )}
                        <div style={{ fontSize: "10px", fontWeight: 800, color: c1, textTransform: "uppercase", letterSpacing: "0.03em", marginTop: "1px" }}>
                          Real pick: #{pickData.Pick} · {teamData?.Name || pickData.Team}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: isMobile ? "13px" : "14px", fontWeight: 700, color: "#bbb", fontStyle: "italic" }}>
                        {isLocked ? "No pick made" : `Select your Round ${round} pick →`}
                      </div>
                    )}
                  </div>

                  {/* Right side: grade + actions */}
                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "8px", marginLeft: "10px" }}>
                    {pickData?.commGrade && <GradeBadge grade={pickData.commGrade} />}
                    {pickData && !isLocked && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemovePick(round); }}
                        style={{ background: "none", border: "none", color: "#ccc", fontSize: "18px", cursor: "pointer", lineHeight: 1, padding: "0 4px" }}
                        title="Remove pick"
                      >✕</button>
                    )}
                    {!isLocked && (
                      <div style={{ color: isOpen ? BLUE : "#ccc", fontWeight: 900, fontSize: "18px", transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none" }}>›</div>
                    )}
                  </div>
                </div>

                {/* Dropdown player picker */}
                {isOpen && (
                  <div style={{ background: "#f8faff", borderTop: `1px solid #e0e8f5`, padding: "12px 16px", animation: "fadeIn 0.15s ease" }}>
                    {/* Search */}
                    <input
                      ref={searchRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Search Round ${round} (${eligible.length} players)...`}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        border: `2px solid ${GOLD}`, borderRadius: "8px",
                        padding: "8px 14px", fontWeight: 700, fontSize: "13px",
                        color: BLUE, outline: "none", marginBottom: "10px",
                        background: "#fff",
                      }}
                    />

                    {/* Player list */}
                    <div style={{ maxHeight: "280px", overflowY: "auto", border: `1px solid #e0e8f5`, borderRadius: "8px", background: "#fff" }}>
                      {filteredEligible.length === 0 ? (
                        <div style={{ padding: "20px", textAlign: "center", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>
                          No players found
                        </div>
                      ) : filteredEligible.map((pick, i) => {
                        const td = nflTeams[pick.Team];
                        const pc1 = td?.Color1 || BLUE;
                        const pc2 = td?.Color2 || GOLD;
                        const isSelected = myPicks[round] === pick.Selection;
                        return (
                          <div
                            key={pick.docId}
                            className="player-option"
                            onClick={() => handleSelectPick(round, pick.Selection)}
                            style={{
                              display: "flex", alignItems: "center", gap: "10px",
                              padding: "9px 12px",
                              borderBottom: i < filteredEligible.length - 1 ? "1px solid #f0f0f0" : "none",
                              background: isSelected ? "#e8f0fa" : "#fff",
                            }}
                          >
                            {/* Mini pick badge */}
                            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                              <div style={{ fontSize: "9px", fontWeight: 900, color: "#999", lineHeight: 1 }}>#{pick.Pick}</div>
                              <div style={{ width: "32px", height: "32px", background: "#fff", border: `2px solid ${pc1}`, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", padding: "2px" }}>
                                {td?.Logo1 ? (
                                  <img src={sanitizeUrl(td.Logo1)} alt={pick.Team} style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                                ) : (
                                  <div style={{ fontSize: "8px", fontWeight: 900, color: pc1 }}>{pick.Team}</div>
                                )}
                              </div>
                            </div>

                            {/* Name + info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 900, fontSize: "14px", color: BLUE, lineHeight: 1.2 }}>
                                {pick.player ? `${pick.player.First || ""} ${pick.player.Last || ""}` : pick.Selection}
                              </div>
                              {pick.player && (
                                <div style={{ fontSize: "11px", fontWeight: 700, color: "#666", marginTop: "2px" }}>
                                  {pick.player.Position} · {pick.player.School}
                                </div>
                              )}
                            </div>

                            {/* Comm grade */}
                            {pick.commGrade && <GradeBadge grade={pick.commGrade} />}

                            {/* Selected checkmark */}
                            {isSelected && (
                              <div style={{ flexShrink: 0, color: GOLD, fontWeight: 900, fontSize: "18px" }}>✓</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Save button */}
        {user && !isLocked && (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              style={{
                backgroundColor: isDirty ? (saving ? "#888" : BLUE) : "#ccc",
                color: "#fff",
                border: `2px solid ${isDirty ? GOLD : "#bbb"}`,
                borderRadius: "8px",
                padding: isMobile ? "12px 28px" : "14px 40px",
                fontWeight: 900,
                fontSize: isMobile ? "13px" : "15px",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                cursor: isDirty && !saving ? "pointer" : "not-allowed",
                transition: "background 0.15s",
              }}
            >
              {saving ? "Saving..." : isDirty ? (picksComplete ? "Save My Draft Class →" : "Save Progress →") : "✓ Saved"}
            </button>
          </div>
        )}

        {/* Locked state message */}
        {isLocked && savedPicks && Object.keys(savedPicks).length === 0 && (
          <div style={{ textAlign: "center", padding: "20px", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>
            The submission window has closed. You didn't submit a draft class this year.
          </div>
        )}

      </div>
    </>
  );
}