import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
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
    } catch {
      setRequestMsg("❌ Error submitting request. Try again.");
    }
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
    } catch {
      setIssueMsg("❌ Error submitting report. Try again.");
    }
  };

  if (!user) return <p style={{ textAlign: "center", color: "red", marginTop: "40px" }}>Please sign in first.</p>;
  if (loading) return <p style={{ textAlign: "center", marginTop: "40px", color: BLUE, fontWeight: 900 }}>Loading...</p>;

  const SectionHeader = ({ label, open, onToggle }) => (
    <button
      onClick={onToggle}
      style={{
        width: "100%", background: "none", border: "none", cursor: "pointer",
        padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "4px",
      }}
    >
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: "16px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE }}>
          {label}
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
    fontSize: isMobile ? "16px" : "14px", // 16px prevents iOS zoom on focus
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

      {/* ===== Page Header ===== */}
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

      {/* ===== Main Card ===== */}
      <div style={{ border: `3px solid ${BLUE}`, borderRadius: "10px", overflow: "hidden", backgroundColor: "#fff" }}>

        {/* Card top bar — display name + verified */}
        <div style={{ backgroundColor: BLUE, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px", fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {displayedUsername || user.email}
          </span>
          {verified && (
            <img src={verifiedBadge} alt="Verified" style={{ width: "20px", height: "20px" }} />
          )}
        </div>

        {/* Gold accent bar */}
        <div style={{ height: "4px", backgroundColor: GOLD }} />

        {/* Card body */}
        <div style={{ padding: isMobile ? "16px" : "24px" }}>

          {/* Email (read-only) */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: "#999", marginBottom: "4px" }}>
              Account Email
            </div>
            <div style={{ fontSize: isMobile ? "14px" : "14px", fontWeight: 700, color: "#555", padding: "10px 12px", border: "2px solid #eee", borderRadius: "6px", backgroundColor: "#fafafa", wordBreak: "break-all" }}>
              {user.email}
            </div>
          </div>

          {/* Display Name edit */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em", color: BLUE, marginBottom: "4px" }}>
              Display Name
            </div>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={inputStyle}
              placeholder="Enter display name"
            />
            {error && <p style={{ color: "red", fontSize: "12px", fontWeight: 700, marginBottom: "8px", marginTop: "-6px" }}>{error}</p>}
            <button onClick={saveProfile} style={btnStyle("primary")}>Save Display Name</button>
          </div>

          {/* Divider */}
          <div style={{ height: "1px", backgroundColor: "#eee", margin: "4px 0 16px" }} />

          {/* Log Out */}
          <button onClick={logout} style={btnStyle("secondary")}>Log Out</button>

          {/* Article Dashboard — admin/writer only */}
          {(role === "admin" || role === "writer") && (
            <button onClick={() => window.location.href = "/admin/articles"} style={btnStyle("gold")}>
              Article Dashboard
            </button>
          )}

          {/* Divider */}
          <div style={{ height: "1px", backgroundColor: "#eee", margin: "6px 0 18px" }} />

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
                <textarea
                  value={issueText}
                  onChange={(e) => setIssueText(e.target.value)}
                  style={{ ...inputStyle, height: "110px", resize: "vertical", marginBottom: "10px" }}
                  placeholder="Describe the issue or suggestion..."
                />
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