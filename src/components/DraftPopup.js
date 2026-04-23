// src/components/DraftPopup.js
import { useEffect, useState, useRef } from "react";
import { collection, onSnapshot, getDoc, doc, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "../firebase";
import { Link } from "react-router-dom";

const BLUE = "#0055a5";
const GOLD = "#f6a21d";

function sanitizeUrl(url) {
  if (!url) return "";
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return `https://${u}`;
  return u;
}

// First 10 picks in round 1 order — shown before any pick is made
const PREVIEW_COUNT = 10;

export default function DraftPopup({ onClose }) {
  const [picks, setPicks] = useState([]);
  const [round1Order, setRound1Order] = useState([]);
  const [teamDataMap, setTeamDataMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [newPickId, setNewPickId] = useState(null);
  const prevPickIds = useRef(new Set());

  // Dragging
  const popupRef = useRef(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: window.innerWidth - 260, y: 140 });
  const isDragging = useRef(false);

  const onMouseDown = (e) => {
    if (e.target.closest("a") || e.target.closest("button")) return;
    isDragging.current = true;
    dragOffset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const newX = Math.max(0, Math.min(window.innerWidth - 240, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.current.y));
      setPos({ x: newX, y: newY });
    };
    const onMouseUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Touch dragging support
  const onTouchStart = (e) => {
    if (e.target.closest("a") || e.target.closest("button")) return;
    const touch = e.touches[0];
    isDragging.current = true;
    dragOffset.current = {
      x: touch.clientX - pos.x,
      y: touch.clientY - pos.y,
    };
  };

  useEffect(() => {
    const onTouchMove = (e) => {
      if (!isDragging.current) return;
      const touch = e.touches[0];
      const newX = Math.max(0, Math.min(window.innerWidth - 240, touch.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 100, touch.clientY - dragOffset.current.y));
      setPos({ x: newX, y: newY });
      e.preventDefault();
    };
    const onTouchEnd = () => { isDragging.current = false; };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Fetch team data for round 1 order
  useEffect(() => {
    if (round1Order.length === 0) return;
    const uniqueTeams = [...new Set(round1Order.map((p) => p.Team).filter(Boolean))];
    const fetchTeams = async () => {
      const entries = await Promise.all(
        uniqueTeams.map(async (team) => {
          try {
            const snap = await getDoc(doc(db, "nfl", team));
            return [team, snap.exists() ? snap.data() : null];
          } catch { return [team, null]; }
        })
      );
      setTeamDataMap(Object.fromEntries(entries));
    };
    fetchTeams();
  }, [round1Order]);

  // Live picks listener
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "draftOrder"), async (snap) => {
      const all = snap.docs
        .map((d) => ({ docId: d.id, ...d.data() }))
        .sort((a, b) => a.Round !== b.Round ? a.Round - b.Round : a.Pick - b.Pick);

      const r1 = all.filter((p) => p.Round === 1);
      setRound1Order(r1);

      const made = all.filter((p) => p.Selection && p.Selection.trim() !== "");

      // Detect new pick
      const currentIds = new Set(made.map((p) => p.docId));
      const added = [...currentIds].find((id) => !prevPickIds.current.has(id));
      if (added) setNewPickId(added);
      prevPickIds.current = currentIds;

      // Most recent pick first, limit 1 for live view
      const last1 = made.slice(-1).reverse();

      const enriched = await Promise.all(
        last1.map(async (pick) => {
          let player = null;
          let teamData = null;
          try {
            const q = query(collection(db, "players"), where("Slug", "==", pick.Selection), limit(1));
            const playerSnap = await getDocs(q);
            if (!playerSnap.empty) {
              const pd = playerSnap.docs[0];
              player = { id: pd.id, ...pd.data() };
            }
          } catch {}
          try {
            const teamSnap = await getDoc(doc(db, "nfl", pick.Team));
            if (teamSnap.exists()) teamData = teamSnap.data();
          } catch {}
          return { ...pick, player, teamData };
        })
      );

      setPicks(enriched);
      setLoading(false);
      if (added) setTimeout(() => setNewPickId(null), 3000);
    });
    return () => unsub();
  }, []);

  const noPicks = picks.length === 0;

  // On the clock = next unpicked slot
  const onTheClock = round1Order.find((p) => !p.Selection || p.Selection.trim() === "");
  const onTheClockTeam = onTheClock?.Team || null;
  const onTheClockTD = teamDataMap[onTheClockTeam] || null;

  // Pre-draft: top 10 from round 1 order
  const previewSlots = round1Order.slice(0, PREVIEW_COUNT);

  return (
    <div
      ref={popupRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: "240px",
        zIndex: 9999,
        fontFamily: "'Arial Black', Arial, sans-serif",
        boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
        borderRadius: "10px",
        userSelect: "none",
      }}
    >
      {/* Header — drag handle */}
      <div
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        style={{
          background: BLUE,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "grab",
          borderRadius: "10px 10px 0 0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ color: GOLD, fontWeight: 900, fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            2026 NFL Draft
          </span>
          {!noPicks && (
            <span style={{
              background: "#e53935", color: "#fff", fontSize: "9px", fontWeight: 900,
              padding: "2px 6px", borderRadius: "10px", letterSpacing: "0.06em",
              animation: "draftLivePulse 2s infinite",
            }}>LIVE</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setMinimized((m) => !m)}
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.7)",
              fontSize: "16px", cursor: "pointer", padding: "0 2px", lineHeight: 1,
            }}
          >
            {minimized ? "▲" : "▼"}
          </button>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.5)",
              fontSize: "18px", cursor: "pointer", padding: "0 2px", lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>
      <div style={{ height: "3px", background: GOLD }} />

      {/* Body */}
      {!minimized && (
        <div style={{ background: "#fff", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>

          {loading && (
            <div style={{ padding: "20px", textAlign: "center", fontSize: "12px", color: "#999", fontWeight: 700 }}>
              Loading...
            </div>
          )}

          {/* PRE-DRAFT: show top 10 picks */}
          {!loading && noPicks && (
            <div>
              <div style={{ padding: "8px 12px 4px", fontSize: "9px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                First 10 Picks
              </div>
              {previewSlots.map((slot) => {
                const td = teamDataMap[slot.Team];
                const c1 = td?.Color1 || BLUE;
                const c2 = td?.Color2 || GOLD;
                const logo = td?.Logo1 || null;
                return (
                  <div key={slot.docId} style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "7px 12px",
                    borderBottom: "1px solid #f0f0f0",
                  }}>
                    <div style={{
                      flexShrink: 0, width: 32, height: 32, borderRadius: "6px",
                      background: c1, border: `2px solid ${c2}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd 1</span>
                      <span style={{ fontSize: "14px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{slot.Pick}</span>
                    </div>
                    <div style={{ flexShrink: 0, width: 28, height: 28, background: "#f8f8f8", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {logo ? (
                        <img src={sanitizeUrl(logo)} alt={slot.Team} style={{ width: "22px", height: "22px", objectFit: "contain" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <span style={{ fontSize: "8px", fontWeight: 900, color: c1 }}>{slot.Team}</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "11px", fontWeight: 900, color: c1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {td?.Name || slot.Team}
                      </div>
                      <div style={{ fontSize: "9px", color: "#888", marginTop: "1px" }}>Pick #{slot.Pick}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* LIVE: most recent pick + on the clock */}
          {!loading && !noPicks && (
            <div>
              {/* Most recent pick */}
              <div style={{ padding: "8px 12px 4px", fontSize: "9px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Most Recent Pick
              </div>
              {picks.map((pick) => {
                const c1 = pick.teamData?.Color1 || BLUE;
                const c2 = pick.teamData?.Color2 || GOLD;
                const logo = pick.teamData?.Logo1 || null;
                const teamName = pick.teamData?.Name || pick.Team;
                const isNew = pick.docId === newPickId;
                return (
                  <div key={pick.docId} style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "10px 12px",
                    background: isNew ? "#fffbe6" : "#fff",
                    transition: "background 1s ease",
                    borderBottom: "1px solid #f0f0f0",
                  }}>
                    <div style={{
                      flexShrink: 0, width: 38, height: 38, borderRadius: "6px",
                      background: c1, border: `2px solid ${c2}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd {pick.Round}</span>
                      <span style={{ fontSize: "18px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{pick.Pick}</span>
                    </div>
                    <div style={{ flexShrink: 0, width: 32, height: 32, background: "#f8f8f8", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {logo ? (
                        <img src={sanitizeUrl(logo)} alt={teamName} style={{ width: "26px", height: "26px", objectFit: "contain" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <span style={{ fontSize: "9px", fontWeight: 900, color: c1 }}>{pick.Team}</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Link
                        to={`/player/${pick.Selection}`}
                        style={{ color: BLUE, fontWeight: 900, fontSize: "12px", textDecoration: "none", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {pick.player ? `${pick.player.First || ""} ${pick.player.Last || ""}` : pick.Selection}
                      </Link>
                      {pick.player && (
                        <div style={{ fontSize: "9px", color: "#666", marginTop: "1px" }}>
                          {pick.player.Position} · {pick.player.School}
                        </div>
                      )}
                      <div style={{ fontSize: "9px", fontWeight: 900, color: c1, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: "1px" }}>
                        {teamName}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* On the clock */}
              {onTheClockTeam && (
                <div>
                  <div style={{ padding: "8px 12px 4px", fontSize: "9px", fontWeight: 900, color: "#999", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    On the Clock
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "10px 12px",
                    background: "#fafafa",
                  }}>
                    <div style={{
                      flexShrink: 0, width: 38, height: 38, borderRadius: "6px",
                      background: onTheClockTD?.Color1 || BLUE,
                      border: `2px solid ${onTheClockTD?.Color2 || GOLD}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    }}>
                      <span style={{ fontSize: "7px", fontWeight: 900, color: "rgba(255,255,255,0.7)", lineHeight: 1 }}>Rd {onTheClock?.Round}</span>
                      <span style={{ fontSize: "18px", fontWeight: 900, color: "#fff", lineHeight: 1 }}>{onTheClock?.Pick}</span>
                    </div>
                    <div style={{ flexShrink: 0, width: 32, height: 32, background: "#f8f8f8", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {onTheClockTD?.Logo1 ? (
                        <img src={sanitizeUrl(onTheClockTD.Logo1)} alt={onTheClockTeam} style={{ width: "26px", height: "26px", objectFit: "contain" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      ) : (
                        <span style={{ fontSize: "9px", fontWeight: 900, color: onTheClockTD?.Color1 || BLUE }}>{onTheClockTeam}</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: 900, color: "#222", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {onTheClockTD?.Name || onTheClockTeam}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "3px" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#e53935", animation: "draftLivePulse 1.5s infinite" }} />
                        <span style={{ fontSize: "9px", fontWeight: 900, color: "#e53935", textTransform: "uppercase", letterSpacing: "0.06em" }}>On the clock</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div style={{ padding: "8px 12px 10px" }}>
            <Link
              to="/draft"
              style={{
                display: "block", textAlign: "center",
                background: BLUE, color: "#fff",
                border: `2px solid ${GOLD}`, borderRadius: "6px",
                padding: "7px", fontSize: "10px", fontWeight: 900,
                textTransform: "uppercase", letterSpacing: "0.08em",
                textDecoration: "none",
              }}
            >
              Order →
            </Link>
          </div>
        </div>
      )}

      <style>{`
        @keyframes draftLivePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}