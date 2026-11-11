// Profile hub → Messages: replies from We-Draft to the user's player
// requests and issue reports (utils/userMessages.js). Opening the tab marks
// everything shown as read, which clears the tab and Navbar badges.
import { useEffect, useState } from "react";
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "../../firebase";
import LoadingSpinner from "../LoadingSpinner";
import { fetchUserMessages, markMessagesRead, messageTimeMs } from "../../utils/userMessages";

const BLUE = "#0055a5";

export default function MessagesTab({ uid, isMobile, onSeen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetchUserMessages(uid)
      .then((list) => {
        if (!live) return;
        setRows(list);
        const unread = list.filter((m) => m.read === false).map((m) => m.id);
        if (unread.length) markMessagesRead(unread).then(() => onSeen && onSeen()).catch((e) => console.error("Mark messages read error:", e));
        else if (onSeen) onSeen();
      })
      .catch((e) => { console.error("Messages fetch error:", e); if (live) { setRows([]); setError("Couldn't load your messages — try again."); } });
    return () => { live = false; };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (id) => {
    if (!window.confirm("Delete this message?")) return;
    try {
      await deleteDoc(doc(db, "userMessages", id));
      setRows((prev) => prev.filter((m) => m.id !== id));
    } catch (e) { console.error("Delete message error:", e); alert("Couldn't delete — try again."); }
  };

  const card = { background: "#fff", borderRadius: 14, border: "1px solid #e6ebf2", boxShadow: "0 4px 16px rgba(15,27,45,.08)" };
  if (rows === null) return <LoadingSpinner size={32} minHeight="30vh" />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      {error && <div style={{ ...card, padding: 14, color: "#a52a1e", fontWeight: 700, fontSize: 13 }}>{error}</div>}
      {!error && rows.length === 0 && (
        <div style={{ ...card, padding: isMobile ? 18 : 26, textAlign: "center", color: "#8a96a8", fontWeight: 700, fontSize: 13, fontFamily: "Arial, sans-serif" }}>
          No messages yet. When you request a player or report an issue (Settings tab), our reply shows up here.
        </div>
      )}
      {rows.map((m) => {
        const ms = messageTimeMs(m.createdAt);
        const declined = m.outcome === "declined";
        return (
          <div key={m.id} style={{ ...card, padding: isMobile ? 14 : 18, borderLeft: `4px solid ${declined ? "#8a96a8" : "#2e7d32"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", background: declined ? "#8a96a8" : "#2e7d32", borderRadius: 999, padding: "3px 8px" }}>
                {declined ? "Closed" : "Resolved"}
              </span>
              <span style={{ fontSize: 14, fontWeight: 900, color: BLUE, flex: 1, minWidth: 0 }}>{m.subject || "Message from We-Draft"}</span>
              {ms > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#8a96a8", fontFamily: "Arial, sans-serif" }}>{new Date(ms).toLocaleDateString()}</span>}
            </div>
            {m.original && (
              <div style={{ marginTop: 10, padding: "8px 10px", background: "#f5f7fa", borderRadius: 8, fontSize: 12, color: "#66758a", fontFamily: "Arial, sans-serif", whiteSpace: "pre-wrap" }}>
                <b>You wrote:</b> {m.original}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 14, color: "#1f2a3a", fontFamily: "Arial, sans-serif", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{m.message}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: "#8a96a8", letterSpacing: "0.04em" }}>— We-Draft</span>
              <button onClick={() => remove(m.id)} style={{ background: "none", border: "none", color: "#8a96a8", fontSize: 11, fontWeight: 800, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}>Delete</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
