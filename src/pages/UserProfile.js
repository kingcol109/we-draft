import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import Logo from "../assets/Logo1.png";
import verifiedBadge from "../assets/verified.png";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const gradeScale = {
  "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
  "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
  "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9,
  "UDFA": 10, "Watchlist": 11,
};

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

function GradeBadge({ grade }) {
  const gd = gradeDisplay(grade);
  if (!gd) return (
    <div style={{ flexShrink: 0, width: "48px", height: "40px", border: "2px solid #ddd", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "#ccc", fontSize: "14px", fontWeight: 900 }}>--</span>
    </div>
  );
  const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(grade);
  const qualifier = isFirstRound ? grade.replace(" First Round", "").toUpperCase() : null;
  return (
    <div style={{
      flexShrink: 0, width: "48px", height: "40px",
      backgroundColor: gd.bg, border: "2px solid " + gd.border,
      borderRadius: "5px", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: "1px",
    }}>
      {qualifier && <span style={{ fontSize: "6px", fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1 }}>{qualifier}</span>}
      <span style={{ fontSize: "14px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
      <span style={{ fontSize: "5.5px", fontWeight: 800, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1 }}>ROUND</span>
    </div>
  );
}

export default function UserProfile() {
  const { user, logout } = useAuth();
  const [username, setUsername] = useState("");
  const [displayedUsername, setDisplayedUsername] = useState("");
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [role, setRole] = useState(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  const [playerName, setPlayerName] = useState("");
  const [school, setSchool] = useState("");
  const [position, setPosition] = useState("");
  const [requestMsg, setRequestMsg] = useState("");

  const [issueText, setIssueText] = useState("");
  const [issueMsg, setIssueMsg] = useState("");

  const [showRequest, setShowRequest] = useState(false);
  const [showIssue, setShowIssue] = useState(false);

  // Board archive state
  const [boardByYear, setBoardByYear] = useState({});
  const [boardYears, setBoardYears] = useState([]);
  const [selectedBoardYear, setSelectedBoardYear] = useState(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [boardFetched, setBoardFetched] = useState(false);

  const bannedWords = [
    "fuck", "shit", "bitch", "tits", "cunt",
    "nigger", "nigga", "faggot", "fucc", "niga",
    "vagina", "penis", "asshole", "retard",
  ];

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const data = snap.data();
        setUsername(data.username || "");
        setDisplayedUsername(data.username || "");
        setVerified(data.verified || false);
        setRole(data.role || "public");
      }
      setLoading(false);
    };
    fetchProfile();
  }, [user]);

  // Load board when section opens — only fetch once per session
  useEffect(() => {
    if (!showBoard || !user?.uid || boardFetched) return;
    const fetchBoard = async () => {
      setBoardLoading(true);
      try {
        // Fetch all of this user's evaluations
        const snap = await getDocs(collection(db, "users", user.uid, "evaluations"));
        const evals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (evals.length === 0) {
          setBoardByYear({});
          setBoardYears([]);
          setBoardFetched(true);
          return;
        }

        // Fetch each player document to get Eligible year, Position, School, Slug
        const playerSnaps = await Promise.all(
          evals.map((ev) => getDoc(doc(db, "players", ev.id)))
        );

        const evalsWithMeta = evals.map((ev, i) => {
          const pd = playerSnaps[i].exists() ? playerSnaps[i].data() : {};
          return {
            ...ev,
            Eligible: String(pd.Eligible || "2027"),
            Position: pd.Position || "",
            School: pd.School || "",
            Slug: pd.Slug || ev.id,
            playerName: ev.playerName || ((pd.First || "") + " " + (pd.Last || "")).trim() || ev.id,
          };
        });

        // Only show 2026 class in Board Archive for now
        const filteredEvals = evalsWithMeta.filter((ev) => ev.Eligible === "2026");

        // Group by Eligible year
        const byYear = {};
        filteredEvals.forEach((ev) => {
          const yr = ev.Eligible;
          if (!byYear[yr]) byYear[yr] = [];
          byYear[yr].push(ev);
        });

        // Sort each year by grade
        Object.keys(byYear).forEach((yr) => {
          byYear[yr].sort((a, b) => (gradeScale[a.grade] || 99) - (gradeScale[b.grade] || 99));
        });

        // Sort years: active first (2027, 2028, 2029), then archive
        const YEAR_ORDER = ["2027", "2028", "2029", "2026"];
        const years = Object.keys(byYear).sort((a, b) => {
          const ai = YEAR_ORDER.indexOf(a);
          const bi = YEAR_ORDER.indexOf(b);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          return b.localeCompare(a);
        });

        setBoardByYear(byYear);
        setBoardYears(years);
        if (years.length > 0) setSelectedBoardYear(years[0]);
        setBoardFetched(true);
      } catch (e) {
        console.error(e);
      } finally {
        setBoardLoading(false);
      }
    };
    fetchBoard();
  }, [showBoard, user, boardFetched]);

  const totalEvals = Object.values(boardByYear).reduce((sum, arr) => sum + arr.length, 0);
  const currentYearEvals = selectedBoardYear ? (boardByYear[selectedBoardYear] || []) : [];

  const yearLabel = (yr) => {
    if (yr === "2026s") return "2026 Supp.";
    return yr;
  };

  const saveProfile = async () => {
    if (!user) return;
    const rawUsername = username.trim();
    const lowerUsername = rawUsername.toLowerCase();
    if (!lowerUsername) { setError("Display name cannot be empty."); return; }
    if (lowerUsername.length < 6) { setError("Display name must be at least 6 characters."); return; }
    if (bannedWords.some((w) => lowerUsername.includes(w.toLowerCase()))) {
      setError("Display name contains inappropriate language."); return;
    }
    const q = query(collection(db, "users"), where("usernameLower", "==", lowerUsername));
    const snap = await getDocs(q);
    if (!snap.empty && snap.docs.some((d) => d.id !== user.uid)) {
      setError("Display name already taken. Please choose another."); return;
    }
    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid, email: user.email,
      username: rawUsername, usernameLower: lowerUsername,
    }, { merge: true });
    setDisplayedUsername(rawUsername);
    setError("");
    alert("Profile updated!");
  };

  const submitRequest = async () => {
    if (!playerName.trim() || !school.trim() || !position.trim()) {
      setRequestMsg("Please fill out all fields."); return;
    }
    try {
      await addDoc(collection(db, "playerRequests"), {
        playerName: playerName.trim(), school: school.trim(), position: position.trim(),
        requestedBy: user.uid, email: user.email, createdAt: serverTimestamp(),
      });
      setRequestMsg("Player request submitted!");
      setPlayerName(""); setSchool(""); setPosition("");
    } catch { setRequestMsg("Error submitting request. Try again."); }
  };

  const submitIssue = async () => {
    if (!issueText.trim()) { setIssueMsg("Please enter a message."); return; }
    if (bannedWords.some((w) => issueText.toLowerCase().includes(w.toLowerCase()))) {
      setIssueMsg("Message contains inappropriate language."); return;
    }
    try {
      await addDoc(collection(db, "userReports"), {
        message: issueText.trim(), submittedBy: user.uid,
        email: user.email, createdAt: serverTimestamp(),
      });
      setIssueMsg("Report submitted! Thank you.");
      setIssueText("");
    } catch { setIssueMsg("Error submitting report. Try again."); }
  };

  if (!user) return <p style={{ textAlign: "center", color: "red", marginTop: "40px" }}>Please sign in first.</p>;
  if (loading) return <p style={{ textAlign: "center", marginTop: "40px", color: BLUE, fontWeight: 900 }}>Loading...</p>;

  const SectionHeader = ({ label, open, onToggle, count }) => (
    <button
      onClick={onToggle}
      style={{
        width: "100%", background: "none", border: "none", cursor: "pointer",
        padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "4px",
      }}
    >
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, display: "flex", alignItems: "center", gap: "8px" }}>
          {label}
          {count !== undefined && count > 0 && (
            <span style={{ fontSize: "12px", fontWeight: 900, background: GOLD, color: "#fff", borderRadius: "12px", padding: "1px 8px" }}>
              {count}
            </span>
          )}
        </div>
        <div style={{ height: "3px", backgroundColor: BLUE, borderRadius: "2px", marginTop: "4px" }} />
      </div>
      <span style={{ color: BLUE, fontWeight: 900, fontSize: "14px", marginLeft: "12px", flexShrink: 0 }}>
        {open ? "▲" : "▼"}
      </span>
    </button>
  );

  const inputStyle = {
    width: "100%", border: "2px solid " + BLUE, borderRadius: "6px",
    padding: isMobile ? "12px 12px" : "10px 12px",
    fontSize: isMobile ? "16px" : "14px",
    fontWeight: 600, boxSizing: "border-box", outline: "none",
    marginBottom: "10px", fontFamily: "inherit",
  };

  const btnStyle = (variant) => ({
    width: "100%", borderRadius: "6px",
    padding: isMobile ? "14px" : "11px",
    fontWeight: 900, fontSize: isMobile ? "15px" : "14px",
    textTransform: "uppercase", letterSpacing: "0.08em", cursor: "pointer",
    border: variant === "primary" ? "2px solid " + GOLD : "2px solid " + BLUE,
    backgroundColor: variant === "primary" ? BLUE : variant === "gold" ? GOLD : "#fff",
    color: variant === "secondary" ? BLUE : "#fff",
    marginBottom: "10px",
  });

  return (
    <div style={{ maxWidth: "520px", margin: "0 auto", padding: isMobile ? "12px 12px 60px" : "28px 16px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

      {/* Page Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", marginBottom: "6px" }}>
          <img src={Logo} alt="We-Draft.com" style={{ height: "30px", objectFit: "contain" }} />
          <div style={{ fontSize: "24px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, lineHeight: 1 }}>
            My Profile
          </div>
        </div>
        <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
        <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
      </div>

      {/* Main Card */}
      <div style={{ border: "3px solid " + BLUE, borderRadius: "10px", overflow: "hidden", backgroundColor: "#fff" }}>

        {/* Card top bar */}
        <div style={{ backgroundColor: BLUE, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {displayedUsername || user.email}
          </span>
          {verified && <img src={verifiedBadge} alt="Verified" style={{ width: "20px", height: "20px" }} />}
        </div>
        <div style={{ height: "4px", backgroundColor: GOLD }} />

        <div style={{ padding: isMobile ? "16px" : "24px" }}>

          {/* Email */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "#999", marginBottom: "4px" }}>Account Email</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#555", padding: "10px 12px", border: "2px solid #eee", borderRadius: "6px", backgroundColor: "#fafafa", wordBreak: "break-all" }}>
              {user.email}
            </div>
          </div>

          {/* Display Name */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: BLUE, marginBottom: "4px" }}>Display Name</div>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} placeholder="Enter display name" />
            {error && <p style={{ color: "red", fontSize: "12px", fontWeight: 700, marginBottom: "8px", marginTop: "-6px" }}>{error}</p>}
            <button onClick={saveProfile} style={btnStyle("primary")}>Save Display Name</button>
          </div>

          <div style={{ height: "1px", backgroundColor: "#eee", margin: "4px 0 16px" }} />

          {/* Quick Links */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
            {[
              { to: "/my-draft-class", emoji: "🏈", label: "My Draft Class", sub: "Build your perfect 2026 draft class" },
              { to: "/boards", emoji: "📋", label: "My Boards", sub: "View and manage your scouting boards" },
              { to: "/whiteboard", emoji: "🗂", label: "Whiteboard", sub: "Organize your draft board" },
            ].map(({ to, emoji, label, sub }) => (
              <Link key={to} to={to} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", boxSizing: "border-box", backgroundColor: "#fff", border: "2px solid " + BLUE, borderRadius: "8px", padding: isMobile ? "14px 16px" : "12px 16px", textDecoration: "none" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
              >
                <div>
                  <div style={{ fontSize: isMobile ? "14px" : "13px", fontWeight: 900, color: BLUE, textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1.2 }}>{emoji} {label}</div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#888", marginTop: "3px" }}>{sub}</div>
                </div>
                <span style={{ color: GOLD, fontWeight: 900, fontSize: "18px" }}>→</span>
              </Link>
            ))}
          </div>

          <button onClick={logout} style={btnStyle("secondary")}>Log Out</button>

          {(role === "admin" || role === "writer") && (
            <button onClick={() => window.location.href = "/admin/articles"} style={btnStyle("gold")}>
              Article Dashboard
            </button>
          )}

          <div style={{ height: "1px", backgroundColor: "#eee", margin: "6px 0 18px" }} />

          {/* ── Board Archive ── */}
          <div style={{ marginBottom: "18px" }}>
            <SectionHeader
              label="Board Archive"
              open={showBoard}
              onToggle={() => setShowBoard((p) => !p)}
              count={boardFetched ? totalEvals : undefined}
            />

            {showBoard && (
              <div style={{ marginTop: "8px" }}>
                {boardLoading ? (
                  <div style={{ textAlign: "center", padding: "28px", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>
                    Loading your board...
                  </div>
                ) : boardYears.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "28px", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>
                    No evaluations yet.{" "}
                    <Link to="/community" style={{ color: BLUE, fontWeight: 900 }}>Start scouting →</Link>
                  </div>
                ) : (
                  <>
                    {/* Year selector tabs */}
                    <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
                      {boardYears.map((yr) => (
                        <button
                          key={yr}
                          onClick={() => setSelectedBoardYear(yr)}
                          style={{
                            border: "2px solid " + GOLD, borderRadius: "20px",
                            padding: "5px 14px",
                            fontWeight: 900, fontSize: "13px",
                            cursor: "pointer",
                            background: selectedBoardYear === yr ? BLUE : "#fff",
                            color: selectedBoardYear === yr ? "#fff" : BLUE,
                            fontFamily: "inherit",
                            display: "flex", alignItems: "center", gap: "6px",
                          }}
                        >
                          {yearLabel(yr)}
                          <span style={{
                            fontSize: "10px", fontWeight: 900,
                            background: selectedBoardYear === yr ? "rgba(255,255,255,0.25)" : GOLD,
                            color: "#fff", borderRadius: "10px", padding: "1px 6px",
                          }}>
                            {boardByYear[yr].length}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Board for selected year */}
                    {currentYearEvals.length > 0 ? (
                      <div style={{ border: "2px solid " + BLUE, borderRadius: "8px", overflow: "hidden" }}>
                        {/* Header bar */}
                        <div style={{ background: BLUE, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ color: GOLD, fontWeight: 900, fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                            {yearLabel(selectedBoardYear)} Draft Class — My Board
                          </div>
                          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "11px", fontWeight: 700 }}>
                            {currentYearEvals.length} player{currentYearEvals.length !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <div style={{ height: "3px", background: GOLD }} />

                        {currentYearEvals.map((ev, i) => (
                          <Link
                            key={ev.id}
                            to={"/player/" + (ev.Slug || ev.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: "12px",
                              padding: "10px 14px", textDecoration: "none", background: "#fff",
                              borderBottom: i < currentYearEvals.length - 1 ? "1px solid #f0f0f0" : "none",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                          >
                            <GradeBadge grade={ev.grade} />

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 900, fontSize: "14px", color: BLUE, lineHeight: 1.2 }}>
                                {ev.playerName}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px", flexWrap: "wrap" }}>
                                {ev.Position && (
                                  <span style={{ background: BLUE, color: "#fff", fontSize: "9px", fontWeight: 900, padding: "1px 6px", borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                    {ev.Position}
                                  </span>
                                )}
                                {ev.School && (
                                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#777" }}>{ev.School}</span>
                                )}
                              </div>
                              {(ev.strengths?.length > 0 || ev.weaknesses?.length > 0) && (
                                <div style={{ display: "flex", gap: "8px", marginTop: "3px", flexWrap: "wrap" }}>
                                  {ev.strengths?.length > 0 && (
                                    <span style={{ fontSize: "10px", fontWeight: 700, color: "#2e7d32" }}>
                                      + {ev.strengths.slice(0, 2).join(", ")}
                                    </span>
                                  )}
                                  {ev.weaknesses?.length > 0 && (
                                    <span style={{ fontSize: "10px", fontWeight: 700, color: "#c0392b" }}>
                                      - {ev.weaknesses.slice(0, 2).join(", ")}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            <span style={{ color: "#ccc", fontSize: "14px", fontWeight: 900, flexShrink: 0 }}>›</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div style={{ textAlign: "center", padding: "20px", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>
                        No evaluations for {yearLabel(selectedBoardYear)}.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Request a Player */}
          <div style={{ marginBottom: "18px" }}>
            <SectionHeader label="Request a Player" open={showRequest} onToggle={() => setShowRequest((p) => !p)} />
            {showRequest && (
              <div style={{ marginTop: "12px" }}>
                <input type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} style={inputStyle} placeholder="Player Name" />
                <input type="text" value={school} onChange={(e) => setSchool(e.target.value)} style={inputStyle} placeholder="School" />
                <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} style={inputStyle} placeholder="Position" />
                {requestMsg && <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "8px", color: requestMsg.startsWith("Player request") ? "green" : "red" }}>{requestMsg}</p>}
                <button onClick={submitRequest} style={btnStyle("primary")}>Submit Request</button>
              </div>
            )}
          </div>

          {/* Report an Issue */}
          <div>
            <SectionHeader label="Report an Issue / Suggestion" open={showIssue} onToggle={() => setShowIssue((p) => !p)} />
            {showIssue && (
              <div style={{ marginTop: "12px" }}>
                <textarea value={issueText} onChange={(e) => setIssueText(e.target.value)} style={{ ...inputStyle, height: "110px", resize: "vertical", marginBottom: "10px" }} placeholder="Describe the issue or suggestion..." />
                {issueMsg && <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "8px", color: issueMsg.startsWith("Report submitted") ? "green" : "red" }}>{issueMsg}</p>}
                <button onClick={submitIssue} style={btnStyle("primary")}>Submit Report</button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}