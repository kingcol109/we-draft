// src/components/draftSim/MockExport.jsx
//
// Mock Draft mode's results panel (SimResults.jsx): save the finished sim as
// a mock draft post — a private mockDrafts doc (utils/draftSim/share.js
// mockFromSim) — and open it in the mock editor (pages/CreateMock.jsx) for
// an intro, notes on any pick and publishing.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../context/AuthContext";
import { mockFromSim } from "../../utils/draftSim/share";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";
const BODY = "Arial, sans-serif";

// onUndo: back into the draft with the last pick taken back.
export default function MockExport({ sim, year, isMobile, onUndo }) {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(`${year} Mock Draft`);
  const [status, setStatus] = useState("idle");
  const exportMock = async () => {
    if (!user) { login(); return; }
    setStatus("saving");
    try {
      const now = Timestamp.now();
      const mock = mockFromSim(sim, { year, name: name.trim() || `${year} Mock Draft`, ownerId: user.uid });
      const ref = await addDoc(collection(db, "mockDrafts"), { ...mock, createdAt: now, updatedAt: now });
      navigate(`/mocks/${ref.id}`);
    } catch (e) {
      console.error("Mock export error:", e);
      setStatus("error");
    }
  };
  return (
    <div style={{ border: "1px solid #1f2b42", borderRadius: 16, padding: isMobile ? 16 : 20, marginBottom: 12, background: `linear-gradient(120deg, #00305c 0%, ${BLUE} 55%, #0b1220 120%)` }}>
      <div style={{ color: GOLD, fontSize: 11, fontWeight: 900, letterSpacing: "0.16em" }}>MOCK DRAFT</div>
      <div style={{ color: "#fff", fontSize: isMobile ? 20 : 26, fontWeight: 900, textTransform: "uppercase", marginTop: 2 }}>Post it as a mock draft</div>
      <div style={{ color: "#c9d4e5", fontSize: 13, fontFamily: BODY, marginTop: 4, maxWidth: 640 }}>
        Saves to your mock drafts as a private draft and opens it in the editor — add an intro and notes on any pick, then publish.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Mock draft name"
          style={{ flex: "1 1 220px", minWidth: 0, background: "#0e1626", border: "1px solid #2a3a58", borderRadius: 999, color: "#fff", padding: "9px 16px", fontSize: 14, fontFamily: BODY, outline: "none" }} />
        <button onClick={exportMock} disabled={status === "saving"} style={{
          border: "none", borderRadius: 999, padding: "11px 20px", cursor: status === "saving" ? "wait" : "pointer", fontFamily: "inherit",
          fontWeight: 900, fontSize: 13, letterSpacing: "0.06em", background: GOLD, color: "#fff", whiteSpace: "nowrap",
        }}>
          {status === "saving" ? "SAVING…" : user ? "EXPORT AS MOCK DRAFT →" : "SIGN IN TO EXPORT"}
        </button>
        {onUndo && (
          <button onClick={onUndo} style={{
            border: "1px solid #2a3a58", borderRadius: 999, padding: "10px 16px", cursor: "pointer", fontFamily: "inherit",
            fontWeight: 900, fontSize: 12, letterSpacing: "0.06em", background: "#0e1626", color: "#fff", whiteSpace: "nowrap",
          }}>↶ UNDO LAST PICK</button>
        )}
      </div>
      {status === "error" && <div style={{ color: "#ff8a8a", fontSize: 13, fontFamily: BODY, marginTop: 8 }}>Couldn&apos;t save it — try again.</div>}
    </div>
  );
}
