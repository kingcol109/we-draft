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
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import Logo from "../assets/Logo1.png";
import verifiedBadge from "../assets/verified.png";
import ArticlesManager from "../components/ArticlesManager";
import LoadingSpinner from "../components/LoadingSpinner";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

const bannedWords = [
  "fuck", "shit", "bitch", "tits", "cunt",
  "nigger", "nigga", "faggot", "fucc", "niga",
  "vagina", "penis", "asshole", "retard",
];

// ── Friend codes — same scheme as We-Pick's own Friends tab
// (WePickHub.js), duplicated here rather than imported cross-page (this
// codebase's usual approach for small shared pieces). Excludes 0/O and
// 1/I/L, the pairs people most often misread when a code's read aloud or
// handwritten. ──
const FRIEND_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateFriendCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += FRIEND_CODE_CHARS[Math.floor(Math.random() * FRIEND_CODE_CHARS.length)];
  return code;
}

// Batch-fetches users/{uid}.username for a list of uids — live current
// name, never trusted from anything denormalized (see GamePage.js's own
// namesByUid for why: a name baked in anywhere else goes stale the moment
// someone changes their display name).
async function fetchNamesByUid(uids) {
  const unique = [...new Set(uids)].filter(Boolean);
  if (unique.length === 0) return {};
  const snaps = await Promise.all(unique.map((uid) => getDoc(doc(db, "users", uid))));
  const map = {};
  snaps.forEach((s, i) => {
    if (s.exists()) {
      const uname = s.data().username?.trim();
      if (uname) map[unique[i]] = uname;
    }
  });
  return map;
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
  const [showFriends, setShowFriends] = useState(false);

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
  if (loading) return <LoadingSpinner label="Loading" size={48} minHeight="60vh" />;

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
    <div style={{ maxWidth: role === "writer" ? "1200px" : "520px", margin: "0 auto", padding: isMobile ? "12px 12px 60px" : "28px 16px 60px", fontFamily: "'Arial Black', Arial, sans-serif" }}>
    <div style={{ maxWidth: "520px", margin: role === "writer" ? "0 auto 32px" : "0 auto" }}>

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

          {role === "admin" && (
            <button onClick={() => window.location.href = "/admin"} style={btnStyle("gold")}>
              Admin Panel
            </button>
          )}

          <div style={{ height: "1px", backgroundColor: "#eee", margin: "6px 0 18px" }} />

          {/* Friends — code, add-by-code, requests, friend list. Same
              functionality as We-Pick's own Friends tab (WePickHub.js),
              see FriendsPanel below. */}
          <div style={{ marginBottom: "18px" }}>
            <SectionHeader label="👥 Friends" open={showFriends} onToggle={() => setShowFriends((p) => !p)} />
            {showFriends && <FriendsPanel isMobile={isMobile} />}
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

    {role === "writer" && (
      <div>
        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "20px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: BLUE, lineHeight: 1 }}>
            My Articles
          </div>
          <div style={{ height: "3px", background: BLUE, borderRadius: "2px", marginTop: "6px", marginBottom: "3px" }} />
          <div style={{ height: "3px", background: GOLD, borderRadius: "2px" }} />
        </div>
        <ArticlesManager />
      </div>
    )}
    </div>
  );
}

// ── Friends — friend code (own + add-by-code), pending requests, and the
// resulting friend list. Same functionality/data (friendRequests,
// friendships, users/{uid}.friendCode — see firestore.rules) as We-Pick's
// own Friends tab (WePickHub.js), duplicated here rather than imported
// cross-page and reskinned for this page's light card look instead of
// We-Pick's dark theme. Always rendered signed-in — UserProfile itself
// already gates the whole page on that before this ever mounts — so
// there's no separate "sign in first" state to handle here. ──
function FriendsPanel({ isMobile }) {
  const { user } = useAuth();
  const [friendCode, setFriendCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(true);
  const [codeCopied, setCodeCopied] = useState(false);

  const [inputCode, setInputCode] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addMessage, setAddMessage] = useState("");

  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [respondingId, setRespondingId] = useState(null);

  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [removingUid, setRemovingUid] = useState(null);

  // Own friend code — generated once and saved the first time this panel
  // is opened without one on file yet. Retries (up to 8x, vanishingly
  // unlikely to ever need more than one) on the rare chance a freshly
  // generated code collides with one that's already taken.
  useEffect(() => {
    if (!user) { setCodeLoading(false); return; }
    let cancelled = false;
    const ensureCode = async () => {
      setCodeLoading(true);
      try {
        const ownSnap = await getDoc(doc(db, "users", user.uid));
        const existing = ownSnap.exists() ? ownSnap.data().friendCode : null;
        if (existing) {
          if (!cancelled) setFriendCode(existing);
          return;
        }
        let candidate = "";
        for (let attempt = 0; attempt < 8; attempt++) {
          candidate = generateFriendCode();
          const dupeSnap = await getDocs(query(collection(db, "users"), where("friendCode", "==", candidate)));
          if (dupeSnap.empty) break;
        }
        await setDoc(doc(db, "users", user.uid), { friendCode: candidate }, { merge: true });
        if (!cancelled) setFriendCode(candidate);
      } catch (e) {
        console.error("Friend code fetch/generate error:", e);
      } finally {
        if (!cancelled) setCodeLoading(false);
      }
    };
    ensureCode();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadRequests = async () => {
      setRequestsLoading(true);
      try {
        const [inSnap, outSnap] = await Promise.all([
          getDocs(query(collection(db, "friendRequests"), where("toUid", "==", user.uid), where("status", "==", "pending"))),
          getDocs(query(collection(db, "friendRequests"), where("fromUid", "==", user.uid), where("status", "==", "pending"))),
        ]);
        const inRows = inSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const outRows = outSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const nameMap = await fetchNamesByUid([...inRows.map((r) => r.fromUid), ...outRows.map((r) => r.toUid)]);
        if (cancelled) return;
        setIncoming(inRows.map((r) => ({ ...r, name: nameMap[r.fromUid] || "Anonymous Fan" })));
        setOutgoing(outRows.map((r) => ({ ...r, name: nameMap[r.toUid] || "Anonymous Fan" })));
      } catch (e) {
        console.error("Friend requests fetch error:", e);
        if (!cancelled) { setIncoming([]); setOutgoing([]); }
      } finally {
        if (!cancelled) setRequestsLoading(false);
      }
    };

    const loadFriends = async () => {
      setFriendsLoading(true);
      try {
        const snap = await getDocs(query(collection(db, "friendships"), where("uids", "array-contains", user.uid)));
        const rows = snap.docs
          .map((d) => ({ id: d.id, uid: (d.data().uids || []).find((u) => u !== user.uid) }))
          .filter((r) => r.uid);
        const nameMap = await fetchNamesByUid(rows.map((r) => r.uid));
        if (cancelled) return;
        setFriends(rows.map((r) => ({ ...r, name: nameMap[r.uid] || "Anonymous Fan" })).sort((a, b) => a.name.localeCompare(b.name)));
      } catch (e) {
        console.error("Friends fetch error:", e);
        if (!cancelled) setFriends([]);
      } finally {
        if (!cancelled) setFriendsLoading(false);
      }
    };

    loadRequests();
    loadFriends();
    return () => { cancelled = true; };
  }, [user]);

  const handleSendRequest = async () => {
    const code = inputCode.trim().toUpperCase();
    if (!code) { setAddMessage("Enter a friend code first."); return; }
    setAddSaving(true);
    setAddMessage("");
    try {
      const targetSnap = await getDocs(query(collection(db, "users"), where("friendCode", "==", code)));
      if (targetSnap.empty) { setAddMessage("No one has that code — double check it."); return; }
      const targetDoc = targetSnap.docs[0];
      const targetUid = targetDoc.id;
      if (targetUid === user.uid) { setAddMessage("That's your own code."); return; }
      if (friends.some((f) => f.uid === targetUid)) { setAddMessage("You're already friends."); return; }
      if (outgoing.some((r) => r.toUid === targetUid)) { setAddMessage("Request already sent — waiting on them."); return; }
      if (incoming.some((r) => r.fromUid === targetUid)) { setAddMessage("They already sent you a request — accept it below instead."); return; }
      const payload = { fromUid: user.uid, toUid: targetUid, status: "pending", createdAt: serverTimestamp() };
      const ref = await addDoc(collection(db, "friendRequests"), payload);
      const targetName = targetDoc.data().username?.trim() || "Anonymous Fan";
      setOutgoing((prev) => [...prev, { id: ref.id, ...payload, name: targetName }]);
      setInputCode("");
      setAddMessage(`Request sent to ${targetName}.`);
    } catch (e) {
      console.error("Send friend request error:", e);
      setAddMessage("Failed to send — try again.");
    } finally {
      setAddSaving(false);
    }
  };

  // Shared by both "Decline" (on an incoming request) and "Cancel" (on an
  // outgoing one) — deleting is allowed for either side of a request.
  const handleRemoveRequest = async (requestId, setList) => {
    try {
      await deleteDoc(doc(db, "friendRequests", requestId));
      setList((prev) => prev.filter((r) => r.id !== requestId));
    } catch (e) {
      console.error("Cancel/decline request error:", e);
      alert("Failed to update — check console.");
    }
  };

  const handleAcceptRequest = async (request) => {
    setRespondingId(request.id);
    try {
      const friendshipRef = doc(collection(db, "friendships"));
      const batch = writeBatch(db);
      batch.set(friendshipRef, { uids: [request.fromUid, user.uid], requestId: request.id, createdAt: serverTimestamp() });
      batch.delete(doc(db, "friendRequests", request.id));
      await batch.commit();
      setIncoming((prev) => prev.filter((r) => r.id !== request.id));
      setFriends((prev) => [...prev, { id: friendshipRef.id, uid: request.fromUid, name: request.name }].sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      console.error("Accept friend request error:", e);
      alert("Failed to accept — check console.");
    } finally {
      setRespondingId(null);
    }
  };

  const handleRemoveFriend = async (friend) => {
    if (!window.confirm(`Remove ${friend.name} from your friends?`)) return;
    setRemovingUid(friend.uid);
    try {
      await deleteDoc(doc(db, "friendships", friend.id));
      setFriends((prev) => prev.filter((f) => f.uid !== friend.uid));
    } catch (e) {
      console.error("Remove friend error:", e);
      alert("Failed to remove — check console.");
    } finally {
      setRemovingUid(null);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(friendCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch (e) {
      console.error("Copy friend code error:", e);
    }
  };

  const codeInputStyle = {
    flex: "1 1 140px", border: "2px solid " + BLUE, borderRadius: "6px",
    padding: isMobile ? "12px 12px" : "10px 12px", fontSize: isMobile ? "16px" : "14px",
    fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'Courier New', monospace",
    boxSizing: "border-box", outline: "none",
  };

  return (
    <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Your Friend Code */}
      <div style={{ border: "2px solid " + GOLD, borderRadius: "8px", padding: "14px 16px", textAlign: "center" }}>
        <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
          Your Friend Code
        </div>
        {codeLoading ? (
          <LoadingSpinner label="Loading" size={20} minHeight="34px" />
        ) : (
          <>
            <div style={{ fontSize: "26px", fontWeight: 900, color: BLUE, letterSpacing: "0.12em", fontFamily: "'Courier New', monospace" }}>
              {friendCode}
            </div>
            <button
              onClick={handleCopyCode}
              style={{ marginTop: "8px", background: "none", border: "2px solid " + BLUE, borderRadius: "6px", color: BLUE, fontWeight: 900, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 14px", cursor: "pointer" }}
            >
              {codeCopied ? "Copied!" : "Copy Code"}
            </button>
          </>
        )}
      </div>

      {/* Add a Friend */}
      <div>
        <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
          Add A Friend
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <input
            value={inputCode}
            onChange={(e) => { setInputCode(e.target.value.toUpperCase()); setAddMessage(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleSendRequest(); }}
            placeholder="Enter code..."
            maxLength={6}
            style={codeInputStyle}
          />
          <button
            onClick={handleSendRequest}
            disabled={addSaving || !inputCode.trim()}
            style={{
              background: BLUE, color: "#fff", border: "2px solid " + GOLD, borderRadius: "6px",
              padding: isMobile ? "12px 18px" : "10px 18px", fontWeight: 900, fontSize: "13px",
              textTransform: "uppercase", letterSpacing: "0.04em",
              cursor: addSaving || !inputCode.trim() ? "default" : "pointer", opacity: addSaving || !inputCode.trim() ? 0.6 : 1,
            }}
          >
            {addSaving ? "Sending..." : "Send"}
          </button>
        </div>
        {addMessage && (
          <p style={{ fontSize: "12px", fontWeight: 700, marginTop: "6px", color: addMessage.startsWith("Request sent") ? "green" : "red" }}>
            {addMessage}
          </p>
        )}
      </div>

      {/* Requests — incoming needs a response, outgoing is just "sent". */}
      {!requestsLoading && (incoming.length > 0 || outgoing.length > 0) && (
        <div>
          <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
            Friend Requests
          </div>
          <div style={{ border: "2px solid #eee", borderRadius: "8px", overflow: "hidden" }}>
            {incoming.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 14px", borderBottom: "1px solid #f0f0f0", background: "#fff8e6" }}>
                <div style={{ fontSize: "13px", fontWeight: 800, color: "#333" }}>{r.name}</div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleAcceptRequest(r)}
                    disabled={respondingId === r.id}
                    style={{ background: "#2e7d32", color: "#fff", border: "none", borderRadius: "5px", padding: "5px 12px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: respondingId === r.id ? "default" : "pointer" }}
                  >
                    {respondingId === r.id ? "…" : "Accept"}
                  </button>
                  <button
                    onClick={() => handleRemoveRequest(r.id, setIncoming)}
                    style={{ background: "#fff", color: "#999", border: "2px solid #ddd", borderRadius: "5px", padding: "5px 12px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: "pointer" }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
            {outgoing.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 14px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: "13px", fontWeight: 800, color: "#888" }}>
                  {r.name} <span style={{ fontSize: "10px", fontWeight: 700, color: "#bbb", textTransform: "uppercase" }}>· Pending</span>
                </div>
                <button
                  onClick={() => handleRemoveRequest(r.id, setOutgoing)}
                  style={{ background: "#fff", color: "#999", border: "2px solid #ddd", borderRadius: "5px", padding: "5px 12px", fontWeight: 900, fontSize: "10px", textTransform: "uppercase", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Friend list */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
          <div style={{ fontSize: "10px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Your Friends
          </div>
          <div style={{ fontSize: "11px", fontWeight: 900, color: BLUE }}>{friends.length}</div>
        </div>
        <div style={{ border: "2px solid #eee", borderRadius: "8px", overflow: "hidden" }}>
          {friendsLoading ? (
            <LoadingSpinner label="Loading" size={20} minHeight="50px" />
          ) : friends.length === 0 ? (
            <div style={{ padding: "18px 14px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#999" }}>
              No friends added yet — share your code or enter theirs above.
            </div>
          ) : (
            friends.map((f, i) => (
              <div key={f.uid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "10px 14px", borderBottom: i < friends.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <div style={{ fontSize: "13px", fontWeight: 800, color: "#333" }}>{f.name}</div>
                <button
                  onClick={() => handleRemoveFriend(f)}
                  disabled={removingUid === f.uid}
                  style={{ background: "none", border: "none", color: "#c0392b", cursor: removingUid === f.uid ? "default" : "pointer", fontSize: "10px", fontWeight: 800, textDecoration: "underline", padding: 0 }}
                >
                  {removingUid === f.uid ? "…" : "Remove"}
                </button>
              </div>
            ))
          )}
        </div>
        {friends.length > 0 && (
          <div style={{ textAlign: "center", marginTop: "10px" }}>
            <Link to="/we-pick/standings" style={{ fontSize: "11px", fontWeight: 900, color: GOLD, textTransform: "uppercase", letterSpacing: "0.04em", textDecoration: "none" }}>
              🏆 See Friend Standings →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}