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

const gradeDisplay = (g) => {
  const map = {
    "Watchlist":          { short: "W",   bg: "#5F5E5A" },
    "Early First Round":  { short: "1st", bg: "#3B6D11" },
    "Middle First Round": { short: "1st", bg: "#3B6D11" },
    "Late First Round":   { short: "1st", bg: "#3B6D11" },
    "Second Round":       { short: "2nd", bg: "#0F6E56" },
    "Third Round":        { short: "3rd", bg: "#185FA5" },
    "Fourth Round":       { short: "4th", bg: "#BA7517" },
    "Fifth Round":        { short: "5th", bg: "#BA7517" },
    "Sixth Round":        { short: "6th", bg: "#993C1D" },
    "Seventh Round":      { short: "7th", bg: "#993C1D" },
    "UDFA":               { short: "U",   bg: "#A32D2D" },
  };
  return map[g] || null;
};

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
  const [boardEvals, setBoardEvals] = useState([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

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

  // Load board when user opens the section
  useEffect(() => {
    if (!showBoard || !user?.uid || boardEvals.length > 0) return;
    const fetchBoard = async () => {
      setBoardLoading(true);
      try {
        const snap = await getDocs(collection(db, "users", user.uid, "evaluations"));
        const evals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const gradeScale = {
          "Early First Round": 1, "Middle First Round": 2, "Late First Round": 3,
          "Second Round": 4, "Third Round": 5, "Fourth Round": 6,
          "Fifth Round": 7, "Sixth Round": 8, "Seventh Round": 9,
          "UDFA": 10, "Watchlist": 11,
        };
        evals.sort((a, b) => {
          const aG = gradeScale[a.grade] ?? 99;
          const bG = gradeScale[b.grade] ?? 99;
          if (aG !== bG) return aG - bG;
          return (a.playerName || "").localeCompare(b.playerName || "");
        });
        setBoardEvals(evals);
      } catch (e) { console.error(e); }
      finally { setBoardLoading(false); }
    };
    fetchBoard();
  }, [showBoard, user]);

  const saveProfile = async () => {
    if (!user) return;
    const rawUsername = username.trim();
    const lowerUsername = rawUsername.toLowerCase();
    if (!lowerUsername) { setError("❌ Display name cannot be empty."); return; }
    if (lowerUsername.length < 6) { setError("❌ Display name must be at least 6 characters."); return; }
    if (bannedWords.some((w) => lowerUsername.includes(w.toLowerCase()))) {
      setError("❌ Display name contains inappropriate language."); return;
    }
    const q = query(collection(db, "users"), where("usernameLower", "==", lowerUsername));
    const snap = await getDocs(q);
    if (!snap.empty && snap.docs.some((d) => d.id !== user.uid)) {
      setError("❌ Display name already taken. Please choose another."); return;
    }
    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid, email: user.email,
      username: rawUsername, usernameLower: lowerUsername,
    }, { merge: true });
    setDisplayedUsername(rawUsername);
    setError("");
    alert("✅ Profile updated!");
  };

  const submitRequest = async () => {
    if (!playerName.trim() || !school.trim() || !position.trim()) {
      setRequestMsg("❌ Please fill out all fields."); return;
    }
    try {
      await addDoc(collection(db, "playerRequests"), {
        playerName: playerName.trim(), school: school.trim(), position: position.trim(),
        requestedBy: user.uid, email: user.email, createdAt: serverTimestamp(),
      });
      setRequestMsg("✅ Player request submitted!");
      setPlayerName(""); setSchool(""); setPosition("");
    } catch { setRequestMsg("❌ Error submitting request. Try again."); }
  };

  const submitIssue = async () => {
    if (!issueText.trim()) { setIssueMsg("❌ Please enter a message."); return; }
    if (bannedWords.some((w) => issueText.toLowerCase().includes(w.toLowerCase()))) {
      setIssueMsg("❌ Message contains inappropriate language."); return;
    }
    try {
      await addDoc(collection(db, "userReports"), {
        message: issueText.trim(), submittedBy: user.uid,
        email: user.email, createdAt: serverTimestamp(),
      });
      setIssueMsg("✅ Report submitted! Thank you.");
      setIssueText("");
    } catch { setIssueMsg("❌ Error submitting report. Try again."); }
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
          {count !== undefined && (
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
    width: "100%", border: `2px solid ${BLUE}`, borderRadius: "6px",
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
    border: variant === "primary" ? `2px solid ${GOLD}` : variant === "gold" ? `2px solid ${BLUE}` : `2px solid ${BLUE}`,
    backgroundColor: variant === "primary" ? BLUE : variant === "gold" ? GOLD : "#fff",
    color: variant === "secondary" ? BLUE : "#fff",
    marginBottom: "10px",
  });

  return (
    <div style={{ maxWidth: "520px", margin: "0 auto", padding: isMobile ? "12px 12px 60px" : "28px 16px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>

      {/* Page Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", marginBottom: "6px" }}>
          <img src={Logo} alt="We-Draft" style={{ height: "30px", objectFit: "contain" }} />
          <div style={{ fontSize: "24px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, lineHeight: 1 }}>
            My Profile
          </div>
        </div>
        <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginBottom: "3px" }} />
        <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
      </div>

      {/* Main Card */}
      <div style={{ border: `3px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "#fff" }}>

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
              <Link key={to} to={to} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", boxSizing: "border-box", backgroundColor: "#fff", border: `2px solid ${BLUE}`, borderRadius: "8px", padding: isMobile ? "14px 16px" : "12px 16px", textDecoration: "none" }}
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

          {/* Board Archive */}
          <div style={{ marginBottom: "18px" }}>
            <SectionHeader
              label="Board Archive"
              open={showBoard}
              onToggle={() => setShowBoard((p) => !p)}
              count={boardEvals.length > 0 ? boardEvals.length : undefined}
            />
            {showBoard && (
              <div style={{ marginTop: "8px" }}>
                {boardLoading ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>Loading your board...</div>
                ) : boardEvals.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "#bbb", fontStyle: "italic", fontSize: "13px" }}>
                    No evaluations yet.{" "}
                    <Link to="/community" style={{ color: BLUE, fontWeight: 900 }}>Start scouting →</Link>
                  </div>
                ) : (
                  <div style={{ border: `2px solid ${BLUE}`, borderRadius: "8px", overflow: "hidden" }}>
                    {boardEvals.map((ev, i) => {
                      const gd = gradeDisplay(ev.grade);
                      const isFirstRound = ["Early First Round", "Middle First Round", "Late First Round"].includes(ev.grade);
                      const qualifier = isFirstRound ? ev.grade.replace(" First Round", "") : null;
                      return (
                        <Link key={ev.id} to={`/player/${ev.id}`}
                          style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", textDecoration: "none", background: "#fff", borderBottom: i < boardEvals.length - 1 ? "1px solid #f0f0f0" : "none" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f5ff"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
                        >
                          {gd ? (
                            <div style={{ flexShrink: 0, width: "44px", height: "38px", backgroundColor: gd.bg, borderRadius: "5px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1px" }}>
                              {qualifier && <span style={{ fontSize: "6px", fontWeight: 900, color: "rgba(255,255,255,0.9)", textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: 1 }}>{qualifier}</span>}
                              <span style={{ fontSize: "14px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{gd.short}</span>
                              <span style={{ fontSize: "5.5px", fontWeight: 800, color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1 }}>ROUND</span>
                            </div>
                          ) : (
                            <div style={{ flexShrink: 0, width: "44px", height: "38px", border: "2px solid #ddd", borderRadius: "5px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ color: "#ccc", fontSize: "14px", fontWeight: 900 }}>—</span>
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 900, fontSize: "14px", color: BLUE, lineHeight: 1.2 }}>{ev.playerName || ev.id}</div>
                            {ev.evaluation && (
                              <div style={{ fontSize: "11px", color: "#777", fontStyle: "italic", marginTop: "2px", lineHeight: 1.4, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                                "{ev.evaluation.slice(0, 80)}{ev.evaluation.length > 80 ? "..." : ""}"
                              </div>
                            )}
                          </div>
                          <span style={{ color: "#ccc", fontSize: "14px", fontWeight: 900, flexShrink: 0 }}>›</span>
                        </Link>
                      );
                    })}
                  </div>
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
                {requestMsg && <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "8px", color: requestMsg.startsWith("✅") ? "green" : "red" }}>{requestMsg}</p>}
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
                {issueMsg && <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "8px", color: issueMsg.startsWith("✅") ? "green" : "red" }}>{issueMsg}</p>}
                <button onClick={submitIssue} style={btnStyle("primary")}>Submit Report</button>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}